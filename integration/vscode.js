const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { promisify } = require('node:util');
const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');
const { chromium } = require('playwright-core');
const { isolatedEnvironment, applicationCommand, runWorker } = require('../scripts/compatibility-processes');
const { writeJson } = require('./configuration-helper/write-json');
const manifest = require('../package.json');

const repository = path.resolve(__dirname, '..');
const runCommand = promisify(execFile);

async function waitFor(check, description, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function logFiles(directory, pattern) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? logFiles(file, pattern) : pattern.test(entry.name) ? [file] : [];
  }));
  return files.flat();
}

async function reportActivationErrors(directory) {
  for (const file of await logFiles(directory, /^exthost\.log$/)) {
    const content = await fs.readFile(file, 'utf8');
    const errors = content.split('\n').filter(line =>
      !line.includes('[trace]') && /codex-usage-status|Cannot find module|Object\.hasOwn|\[error\]/.test(line)
    ).slice(-15);
    if (errors.length) console.error(`Extension host diagnostics from ${file}:\n${errors.join('\n')}`);
  }
}

async function run(directory, version, probe) {
  const cachePath = path.join(directory, 'downloads');
  const portable = path.join(directory, 'portable');
  const userData = path.join(portable, 'user-data');
  const extensions = path.join(portable, 'extensions');
  const workspace = path.join(directory, 'workspace');
  const runtime = path.join(directory, 'runtime');
  const settingsFile = path.join(userData, 'User/settings.json');
  const executable = path.join(directory, 'fake-codex');
  const alternative = path.join(directory, 'fake-codex-alternative');
  const snapshotFile = `${executable}.json`;
  const logFile = path.join(directory, 'requests.jsonl');
  const settingsRequest = path.join(directory, 'settings-request.json');
  const settingsReply = path.join(directory, 'settings-reply.json');
  const runtimeFile = path.join(directory, 'runtime.json');
  for (const folder of [path.dirname(settingsFile), extensions, workspace, runtime]) {
    await fs.mkdir(folder, { recursive: true });
  }
  await fs.chmod(runtime, 0o700);
  const wrapper = '#!/bin/sh\nCODEX_USAGE_TEST_EXECUTABLE="$0" exec "$CODEX_USAGE_TEST_NODE" "$CODEX_USAGE_TEST_SERVER" "$@"\n';
  for (const file of [executable, alternative]) {
    await fs.writeFile(file, wrapper, { mode: 0o700 });
  }
  const settings = {
    'codexUsage.executablePath': executable,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
    'workbench.enableExperiments': false,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none'
  };
  const response = {
    result: {
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: Date.now() / 1000 + 3600 },
        secondary: { usedPercent: 35, windowDurationMins: 10080 }
      },
      rateLimitResetCredits: { availableCount: 2, credits: null }
    }
  };
  const updateResponse = () => writeJson(snapshotFile, response);
  const records = async () => (await fs.readFile(logFile, 'utf8')).trim().split('\n').map(JSON.parse);
  await writeJson(settingsFile, settings);
  await updateResponse();
  const alternativeResponse = structuredClone(response);
  alternativeResponse.result.rateLimits.primary.usedPercent = 60;
  await writeJson(`${alternative}.json`, alternativeResponse);

  const env = {
    ...isolatedEnvironment(),
    VSCODE_PORTABLE: portable,
    XDG_RUNTIME_DIR: runtime,
    XDG_CACHE_HOME: path.join(directory, 'os-cache'),
    XDG_CONFIG_HOME: path.join(directory, 'os-config'),
    XDG_DATA_HOME: path.join(directory, 'os-data'),
    CODEX_USAGE_TEST_ROOT: directory,
    CODEX_USAGE_TEST_NODE: process.execPath,
    CODEX_USAGE_TEST_SERVER: path.join(__dirname, 'fake-codex.js')
  };
  const downloadOptions = { version, cachePath };
  const vscodeExecutablePath = await downloadAndUnzipVSCode(downloadOptions);
  const packageArgs = [path.join(repository, 'scripts/package.py'), '--out-dir', path.join(directory, 'vsix')];
  if (probe && version !== 'stable') packageArgs.push('--vscode-engine', `^${version}`);
  const vsix = execFileSync('python3', packageArgs, { encoding: 'utf8' }).trim();
  const cli = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
  const isolationArgs = [
    '--disable-keytar', `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`
  ];
  const installed = await runCommand(cli, [
    ...isolationArgs, '--install-extension', vsix, '--force'
  ], { env });
  assert.doesNotMatch(installed.stderr, /not in the list of known options|unknown option/i,
    'VS Code must recognize the credential isolation option.');
  console.log(installed.stdout.trim());
  const listed = await runCommand(cli, [...isolationArgs, '--list-extensions'], { env });
  assert.ok(listed.stdout.toLowerCase().includes(`${manifest.publisher}.${manifest.name}`.toLowerCase()),
    'The VSIX must install into the temporary extensions directory.');

  const helper = path.join(directory, 'configuration-helper');
  await fs.cp(path.join(__dirname, 'configuration-helper'), helper, { recursive: true });

  let browser;
  try {
    const { endpoint } = await applicationCommand({
      type: 'launch-application',
      executablePath: vscodeExecutablePath,
      args: [
        workspace, ...isolationArgs, `--extensionDevelopmentPath=${helper}`, '--new-window', '--locale=en',
        '--disable-updates', '--skip-welcome', '--skip-release-notes',
        '--disable-workspace-trust', '--log=trace',
        '--disable-gpu', '--no-sandbox'
      ],
      env
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: 60000, noDefaults: true });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent('page', { timeout: 15000 });
    page.setDefaultTimeout(15000);
    await page.locator('.monaco-workbench').waitFor();
    /** @type {import('./configuration-helper/main').RuntimeInfo} */
    let actual;
    await waitFor(async () => {
      actual = await fs.readFile(runtimeFile, 'utf8').then(JSON.parse, () => undefined);
      return actual !== undefined;
    }, 'the helper extension to report its runtime');
    if (version !== 'stable') assert.equal(actual.version, version);
    assert.equal(actual.portablePath, portable, 'VS Code must retain the temporary portable directory.');
    await fs.access(path.join(actual.portablePath, 'argv.json'));
    const relativeStorage = path.relative(userData, actual.globalStoragePath);
    assert.ok(relativeStorage && !relativeStorage.startsWith('..') && !path.isAbsolute(relativeStorage),
      'The helper must use global storage inside the temporary profile.');
    await waitFor(async () => {
      const files = await logFiles(path.join(userData, 'logs'), /^(main|renderer)\.log$/);
      const contents = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
      return contents.some(content =>
        /Using in-memory credential store|\[SecretStorageService\].*in-memory storage/.test(content)
      );
    }, 'VS Code to confirm its in-memory credential backend');
    console.log('PASS: portable startup configuration, profile storage, and in-memory credentials.');
    console.log(`Running VS Code ${actual.version} with a temporary profile.`);
    console.log(`Extension host Node.js ${actual.node}, Object.hasOwn ${actual.hasOwn ? 'available' : 'unavailable'}.`);

    const primary = page.locator('[id$="codexUsage.window.codex.primary"]');
    const weekly = page.locator('[id$="codexUsage.window.codex.secondary"]');
    const text = async item => (await item.textContent() ?? '').replace(/\s+/g, ' ').trim();
    const hasText = async (item, pattern) => {
      await waitFor(async () => pattern.test(await text(item).catch(() => '')), pattern.toString());
    };
    const command = async title => {
      await page.keyboard.press('F1');
      const input = page.locator('.quick-input-widget input[type="text"]');
      await input.fill(`>${title}`);
      await page.locator('.quick-input-list .monaco-list-row')
        .filter({ hasText: title }).first().waitFor();
      await input.press('Enter');
    };
    const refresh = () => command('Codex Usage: Refresh');
    let settingsId = 0;
    const changeSettings = async changes => {
      const id = ++settingsId;
      await writeJson(settingsRequest, { id, changes });
      await command('Codex Usage Test: Apply Settings');
      let reply;
      await waitFor(async () => {
        reply = await fs.readFile(settingsReply, 'utf8').then(JSON.parse, () => undefined);
        return reply?.id === id;
      }, 'the configuration API to apply settings');
      assert.ok(!reply.error, reply.error);
    };
    const checkColour = async (item, colour) => {
      await waitFor(() => item.evaluate((element, colour) => {
        const probe = document.createElement('span');
        probe.style.color = `var(--vscode-terminal-ansi${colour})`;
        element.appendChild(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(element.querySelector('.codicon')).color === expected;
      }, colour), `${colour.toLowerCase()} allowance colour`);
    };
    const tooltip = async () => {
      await primary.hover();
      const hover = page.locator('.monaco-hover').filter({ hasText: 'Codex · 5h allowance' }).last();
      await hover.waitFor();
      return hover;
    };

    await hasText(primary, /5h\s+80%/);
    await hasText(weekly, /Weekly\s+65%/);
    await checkColour(primary, 'Green');
    await checkColour(weekly, 'Yellow');
    for (const id of ['codex-usage-chatgpt', 'codex-usage-gauge-80']) {
      const icon = primary.locator(`.codicon-${id}`);
      const character = String.fromCodePoint(parseInt(manifest.contributes.icons[id].default.fontCharacter.slice(1), 16));
      await waitFor(() => icon.evaluate((element, character) => {
        const style = getComputedStyle(element, '::before');
        const family = style.fontFamily.replace(/["']/g, '');
        return style.content.includes(character) && [...document.fonts].some(font =>
          font.status === 'loaded' && family.includes(font.family.replace(/["']/g, ''))
        );
      }, character), `packaged ${id} font loading`);
    }
    const hover = await tooltip();
    assert.match(await text(hover), /80% remaining/);
    assert.match(await text(hover), /2 account reset credits available/);
    const dashboard = hover.locator('a').filter({ hasText: 'Open usage dashboard' });
    await dashboard.waitFor();
    const dashboardUrl = await dashboard.getAttribute('data-href') ?? await dashboard.getAttribute('href');
    assert.equal(dashboardUrl, 'https://chatgpt.com/settings/usage?tab=overview');
    await page.mouse.move(0, 0);
    console.log('PASS: packaged activation, allowance colours, icon font loading, and tooltip.');

    response.result.rateLimits.primary.usedPercent = 90;
    await updateResponse();
    await refresh();
    await hasText(primary, /5h\s+10%/);
    await checkColour(primary, 'Red');

    response.error = 'Test refresh failed';
    await updateResponse();
    await refresh();
    await hasText(primary, /10%.*stale/);
    assert.match(await text(await tooltip()), /Test refresh failed/);
    await page.mouse.move(0, 0);

    delete response.error;
    response.result.rateLimits.primary.usedPercent = 20;
    await updateResponse();
    await refresh();
    await hasText(primary, /5h\s+80%$/);
    console.log('PASS: refresh through the real client, stale values on error, and recovery.');

    await changeSettings({ criticalThresholdPercent: 90 });
    await checkColour(primary, 'Red');
    await changeSettings({ criticalThresholdPercent: 33, refreshIntervalSeconds: 90 });
    await checkColour(primary, 'Green');
    const originalPids = (await records()).filter(event => event.event === 'start').map(event => event.pid);
    await changeSettings({ executablePath: alternative });
    let replacementPid;
    await waitFor(async () => {
      const replacement = (await records()).find(event => event.event === 'start' && event.executable === alternative);
      replacementPid = replacement?.pid;
      return replacement !== undefined;
    }, 'the configured replacement executable to start');
    assert.ok(!originalPids.includes(replacementPid), 'Executable replacement must start a new client.');
    await hasText(primary, /5h\s+40%$/);
    await checkColour(primary, 'Yellow');
    await waitFor(async () => {
      const events = await records();
      return originalPids.every(pid => events.some(event => event.event === 'exit' && event.pid === pid));
    }, 'the previous client processes to stop after executable replacement');
    const requests = await records();
    const replacementRequests = requests.filter(event => event.pid === replacementPid && event.method);
    assert.deepEqual(replacementRequests.slice(0, 3).map(event => event.method), [
      'initialize', 'initialized', 'account/rateLimits/read'
    ]);
    assert.equal(replacementRequests[0].params.clientInfo.version, manifest.version);
    console.log('PASS: configuration changes and executable replacement.');
  } catch (error) {
    await reportActivationErrors(path.join(userData, 'logs')).catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    await applicationCommand({ type: 'close-application' });
  }
  await waitFor(async () => {
    const events = await records();
    return events.filter(event => event.event === 'start').every(start =>
      events.some(event => event.event === 'exit' && event.pid === start.pid)
    );
  }, 'fake Codex processes to stop when VS Code closes');
  console.log('PASS: VS Code closes its test client processes.');
}

if (require.main === module) {
  runWorker(() => run(process.argv[2], process.argv[3], process.argv[4] === 'true'));
}
