const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const { CodexClient } = require('./client');
const { windows } = require('./usage');

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
  let client;
  let timer;
  let busy = false;
  let disposed = false;
  let generation = 0;
  let data = [];
  let updatedAt;
  let error;
  let loading = false;

  function render() {
    const config = vscode.workspace.getConfiguration('codexUsage');
    const stale = data.length > 0 && (
      error ||
      Date.now() - updatedAt >
        config.get('refreshIntervalSeconds', 60) * 2000 ||
      data.some(w => w.resetsAt && w.resetsAt <= Date.now())
    );
    item.text = data.length
      ? `$(pulse) Codex: ${data.map(w => `${w.label} ${w.remaining}%`).join(' · ')} remaining${stale ? ' (stale)' : ''}`
      : loading
        ? '$(sync~spin) Codex usage'
        : '$(warning) Codex: unavailable';
    item.backgroundColor = data.some(w => w.remaining <= config.get('warningThresholdPercent', 20))
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText('Codex remaining allowance\n\n');
    for (const w of data) {
      tooltip.appendText(
        `${w.label}: ${w.remaining}% remaining. Resets ${
          w.resetsAt
            ? new Date(w.resetsAt).toLocaleString()
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
    item.tooltip = tooltip;
    item.accessibilityInformation = { label: item.text.replace(/\$\([^)]+\) /g, '') };
    item.show();
  }

  function accept(result) {
    data = windows(result);
    updatedAt = Date.now();
    error = data.length ? undefined : 'Codex returned no allowance windows for this account.';
    render();
  }

  async function refresh() {
    if (disposed || busy) return;
    busy = true;
    loading = true;
    const current = generation;
    render();
    try {
      if (!client || client.closed) {
        client?.dispose();
        client = new CodexClient(executable());
        await client.initialize();
      }
      const result = await client.request('account/rateLimits/read');
      if (!disposed && current === generation) accept(result);
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
      loading = false;
      if (!disposed) {
        render();
        if (current !== generation) void refresh();
      }
    }
  }

  function configure() {
    generation++;
    client?.dispose();
    client = undefined;
    data = [];
    updatedAt = undefined;
    error = undefined;
    clearInterval(timer);
    const seconds = Math.max(
      30,
      vscode.workspace.getConfiguration('codexUsage').get('refreshIntervalSeconds', 60)
    );
    timer = setInterval(() => {
      render();
      void refresh();
    }, seconds * 1000);
    void refresh();
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
      if (event.affectsConfiguration('codexUsage')) configure();
    }),
    {
      dispose() {
        disposed = true;
        clearInterval(timer);
        client?.dispose();
      }
    }
  );
  configure();
}

module.exports = { activate };
