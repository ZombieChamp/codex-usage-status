const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const { CodexClient } = require('./client');
const { windows, gauge } = require('./usage');

function allowanceColour(remaining, criticalThreshold, warningThreshold) {
  if (remaining <= criticalThreshold) return 'terminal.ansiRed';
  if (remaining <= warningThreshold) return 'terminal.ansiYellow';
  return 'terminal.ansiGreen';
}

function executable() {
  const configured = vscode.workspace
    .getConfiguration('codexUsage')
    .get('executablePath', '')
    .trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error('Set Codex Usage: Executable Path to an absolute path');
    }
    return configured;
  }
  const extension = vscode.extensions.getExtension('openai.chatgpt');
  const platform = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (extension && platform && arch) {
    const candidate = path.join(
      extension.extensionPath,
      'bin',
      `${platform}-${arch}`,
      process.platform === 'win32' ? 'codex.exe' : 'codex'
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'codex';
}

function activate(context) {
  const item = vscode.window.createStatusBarItem('codexUsage', vscode.StatusBarAlignment.Right, 100);
  item.name = 'Codex remaining allowance';
  item.command = 'codexUsage.refresh';
  const allowanceItems = new Map();
  let client;
  let timer;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let data = [];
  let updatedAt;
  let error;

  function renderAllowances(config, tooltip, stale) {
    const criticalThreshold = config.get('criticalThresholdPercent', 33);
    const warningThreshold = config.get('warningThresholdPercent', 66);
    const ids = new Set(data.map(window => window.id));
    for (const [id, allowance] of allowanceItems) {
      if (!ids.has(id)) {
        allowance.dispose();
        allowanceItems.delete(id);
      }
    }
    for (const [index, window] of data.entries()) {
      const priority = 99 - index;
      let allowance = allowanceItems.get(window.id);
      // VS Code fixes priority at creation. Keep the ID when an item moves.
      if (!allowance || allowance.priority !== priority) {
        allowance?.dispose();
        allowance = vscode.window.createStatusBarItem(
          `codexUsage.window.${window.id}`, vscode.StatusBarAlignment.Right, priority
        );
        allowance.command = 'codexUsage.refresh';
        allowanceItems.set(window.id, allowance);
      }
      allowance.name = `Codex ${window.label} remaining allowance`;
      allowance.text = `${gauge(window.remaining)} ${window.label} ${window.remaining}%${stale ? ' (stale)' : ''}`;
      allowance.color = new vscode.ThemeColor(
        allowanceColour(window.remaining, criticalThreshold, warningThreshold)
      );
      allowance.accessibilityInformation = {
        label: `Codex ${window.label}: ${window.remaining}% remaining${stale ? ', stale' : ''}`
      };
      allowance.tooltip = tooltip;
      allowance.show();
    }
  }

  function createTooltip(stale) {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText('Codex remaining allowance\n\n');
    for (const window of data) {
      tooltip.appendText(
        `${window.label}: ${window.remaining}% remaining. Resets ${
          window.resetsAt
            ? new Date(window.resetsAt).toLocaleString()
            : 'at an unknown time'
        }.\n\n`
      );
    }
    if (updatedAt) {
      tooltip.appendText(`Last checked: ${new Date(updatedAt).toLocaleString()}\n\n`);
    }
    if (error) {
      tooltip.appendText(
        `${error}\n\nCheck that Codex is installed and signed in with your ChatGPT account.\n\n`
      );
    }
    if (stale) tooltip.appendText('These values are stale.\n\n');
    tooltip.appendText('Click to refresh.');
    tooltip.appendMarkdown(' [Open usage dashboard](https://chatgpt.com/settings/usage?tab=overview)');
    return tooltip;
  }

  function render() {
    const config = vscode.workspace.getConfiguration('codexUsage');
    const now = Date.now();
    const stale = data.length > 0 && (
      Boolean(error) ||
      now - updatedAt > config.get('refreshIntervalSeconds', 60) * 2000 ||
      data.some(window => window.resetsAt && window.resetsAt <= now)
    );
    if (data.length) {
      item.text = `Codex:${stale ? ' (stale)' : ''}`;
    } else if (busy) {
      item.text = '$(sync~spin) Codex usage';
    } else {
      item.text = '$(warning) Codex: unavailable';
    }
    item.tooltip = createTooltip(stale);
    renderAllowances(config, item.tooltip, stale);
    item.accessibilityInformation = { label: item.text.replace(/\$\([^)]+\) /g, '') };
    item.show();
  }

  async function refresh() {
    if (disposed || busy) return;
    busy = true;
    const current = generation;
    render();
    try {
      let connection = client;
      if (!connection || connection.closed) {
        connection?.dispose();
        connection = new CodexClient(executable());
        client = connection;
        await connection.initialize();
      }
      const result = await connection.request('account/rateLimits/read');
      if (!disposed && current === generation) {
        data = windows(result);
        updatedAt = Date.now();
        error = data.length ? undefined : 'Codex returned no allowance windows for this account.';
      }
    } catch (reason) {
      if (!disposed && current === generation) {
        error = reason.code === 'ENOENT'
          ? 'Codex executable not found. Install Codex or set Codex Usage: Executable Path.'
          : reason.message;
        client?.dispose();
        client = undefined;
      }
    } finally {
      busy = false;
      if (!disposed) {
        render();
        if (current !== generation) void refresh();
      }
    }
  }

  function restartConnection() {
    generation++;
    client?.dispose();
    client = undefined;
    data = [];
    updatedAt = undefined;
    error = undefined;
    render();
    void refresh();
  }

  function scheduleRefresh() {
    clearInterval(timer);
    const seconds = Math.max(
      30,
      vscode.workspace.getConfiguration('codexUsage').get('refreshIntervalSeconds', 60)
    );
    timer = setInterval(() => {
      render();
      void refresh();
    }, seconds * 1000);
  }

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand('codexUsage.refresh', refresh),
    vscode.commands.registerCommand('codexUsage.openDashboard', () =>
      vscode.env.openExternal(
        vscode.Uri.parse('https://chatgpt.com/settings/usage?tab=overview')
      )
    ),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('codexUsage')) return;
      if (event.affectsConfiguration('codexUsage.refreshIntervalSeconds')) scheduleRefresh();
      if (event.affectsConfiguration('codexUsage.executablePath')) restartConnection();
      else render();
    }),
    {
      dispose() {
        disposed = true;
        clearInterval(timer);
        for (const allowance of allowanceItems.values()) allowance.dispose();
        allowanceItems.clear();
        client?.dispose();
      }
    }
  );
  scheduleRefresh();
  void refresh();
}

module.exports = { activate };
