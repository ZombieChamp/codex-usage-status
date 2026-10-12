const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { minimumVersion, parseArguments, isolatedEnvironment, runIsolated } = require('../scripts/vscode-compatibility');
const { checkTypeVersion } = require('../scripts/check-vscode-api');
const manifest = require('../package.json');

async function fixture(t, source) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-usage-runner-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workerPath = path.join(directory, 'worker.js');
  await fs.writeFile(workerPath, source);
  const sentinel = path.join(directory, 'existing-editor-settings.json');
  await fs.writeFile(sentinel, '{"preserved":true}\n');
  return { directory, workerPath, sentinel };
}

async function typeCheck(t, source) {
  const { directory } = await fixture(t, '');
  const sourceFile = path.join(directory, 'runtime-api.js');
  const project = path.join(directory, 'tsconfig.json');
  await fs.writeFile(sourceFile, source);
  await fs.writeFile(project, JSON.stringify({
    extends: path.resolve(__dirname, '../tsconfig.compatibility.json'),
    compilerOptions: { typeRoots: [path.resolve(__dirname, '../node_modules/@types')] },
    include: [sourceFile]
  }));
  return spawnSync(process.execPath, [
    require.resolve('typescript/bin/tsc'), '--project', project
  ], { encoding: 'utf8' });
}

async function electronFixture(t, { launchTimeout = 60000, blockWorker = false, ready = false, stderr = '' } = {}) {
  const { directory, workerPath } = await fixture(t, '');
  const executable = path.join(directory, 'fake-electron');
  const pidFile = path.join(directory, 'electron.pid');
  const blockedFile = path.join(directory, 'worker-blocked');
  const readyFile = path.join(directory, 'worker-ready');
  let appPid;
  t.after(() => {
    if (!appPid) return;
    try { process.kill(-appPid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  await fs.writeFile(executable, `#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.on('SIGTERM', () => {});
process.stderr.write(${JSON.stringify(stderr)});
${ready ? "process.stderr.write('DevTools listening on ws://127.0.0.1:12345/test\\n');" : ''}
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await fs.writeFile(workerPath, `
const { applicationCommand, runWorker } = require(${JSON.stringify(require.resolve('../scripts/compatibility-processes'))});
${blockWorker ? `
const fs = require('node:fs');
process.on('SIGTERM', () => {});
setInterval(() => {
  if (fs.existsSync(${JSON.stringify(pidFile)})) {
    fs.writeFileSync(${JSON.stringify(blockedFile)}, 'blocked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
}, 20);
` : ''}
runWorker(async () => {
  const { endpoint } = await applicationCommand({
    type: 'launch-application', executablePath: ${JSON.stringify(executable)}, args: [], env: process.env
  }, ${launchTimeout});
  require('node:assert/strict').equal(endpoint, 'ws://127.0.0.1:12345/test');
  require('node:fs').writeFileSync(${JSON.stringify(readyFile)}, 'ready');
  setInterval(() => {}, 1000);
});
`);
  return {
    workerPath,
    async started() {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        appPid = await fs.readFile(pidFile, 'utf8').then(Number, () => undefined);
        if (appPid && (!ready || await fs.access(readyFile).then(() => true, () => false))) return appPid;
        await delay(20);
      }
      assert.fail('The Electron fixture must start.');
    },
    async blocked() {
      const end = Date.now() + 5000;
      while (!(await fs.access(blockedFile).then(() => true, () => false))) {
        assert.ok(Date.now() < end, 'The worker must block during application startup.');
        await delay(20);
      }
    }
  };
}

async function assertStopped(pid) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    try { process.kill(pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    if (process.platform === 'linux') {
      // A stopped orphan can remain a zombie until its new parent reaps it.
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!stat || stat.split(') ')[1][0] === 'Z') return;
    }
    await delay(20);
  }
  assert.fail('The detached test application must stop.');
}

test('derives the minimum from the manifest and requires an explicit probe below it', () => {
  const baseline = { engines: { vscode: '^1.66.0' } };
  assert.equal(minimumVersion(baseline), '1.66.0');
  assert.equal(minimumVersion({ engines: { vscode: '^1.67.0' } }), '1.67.0');
  assert.deepEqual(parseArguments([], baseline), { versions: ['1.66.0', 'stable'], probe: false });
  assert.deepEqual(parseArguments(['--version', 'minimum'], baseline), { versions: ['1.66.0'], probe: false });
  assert.deepEqual(parseArguments(['--version', 'minimum'], { engines: { vscode: '^1.67.0' } }),
    { versions: ['1.67.0'], probe: false });
  assert.throws(() => parseArguments(['--version', '1.65.2'], baseline), /Use --probe/);
  assert.deepEqual(parseArguments(['--version', '1.65.2', '--probe'], baseline), { versions: ['1.65.2'], probe: true });
  assert.throws(() => parseArguments(['--version'], baseline), /requires/);
});

test('normalises release spellings before enforcing the engine requirement', () => {
  const baseline = { engines: { vscode: '^1.66.0' } };
  for (const version of ['v1.66.0', '1.66.0+build', 'v1.66.0+build']) {
    assert.deepEqual(parseArguments(['--version', version], baseline), { versions: ['1.66.0'], probe: false });
  }
  assert.throws(() => parseArguments(['--version', 'v1.65.2+build'], baseline), /Use --probe/);
  assert.deepEqual(parseArguments(['--version', 'v1.65.2+build', '--probe'], baseline),
    { versions: ['1.65.2'], probe: true });
});

test('rejects prereleases and unsupported download identifiers even when probing', () => {
  for (const version of ['1.66.0-rc.1', 'v1.66.0-rc.1+build', 'insiders', '^1.66.0', 'a'.repeat(40)]) {
    assert.throws(() => parseArguments(['--version', version, '--probe']), /exact stable VS Code release/);
  }
});

test('rejects API types that differ from the declared minimum or can drift to newer releases', () => {
  assert.equal(checkTypeVersion(), minimumVersion());
  const changed = structuredClone(manifest);
  changed.engines.vscode = '^1.67.0';
  assert.throws(() => checkTypeVersion(changed), /Pin @types\/vscode to 1.67.0/);
  const ranged = structuredClone(manifest);
  ranged.devDependencies['@types/vscode'] = '^1.66.0';
  assert.throws(() => checkTypeVersion(ranged), /Pin @types\/vscode/);
  assert.throws(() => checkTypeVersion(manifest, { version: '1.67.0' }), /Pin @types\/vscode/);
});

test('the pinned API check rejects an API introduced after the minimum', async t => {
  const result = await typeCheck(t, "const vscode = require('vscode');\nvscode.lm.selectChatModels();\n");
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Property 'lm' does not exist/);
});

test('the runtime type check rejects globals and APIs absent from Node.js 16.13', async t => {
  const result = await typeCheck(t, [
    "fetch('https://example.com');",
    "new BroadcastChannel('test');",
    'AbortSignal.timeout(1000);'
  ].join('\n'));
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Cannot find name 'fetch'/);
  assert.match(result.stdout, /Cannot find name 'BroadcastChannel'/);
  assert.match(result.stdout, /Property 'timeout' does not exist/);
});

test('removes inherited editor routing and portable paths before launching a test process', () => {
  assert.deepEqual(isolatedEnvironment({
    PATH: '/test/bin', DISPLAY: ':99',
    VSCODE_IPC_HOOK_CLI: '/existing/editor.sock',
    VSCODE_PORTABLE: '/existing/profile',
    ELECTRON_RUN_AS_NODE: '1'
  }), { PATH: '/test/bin', DISPLAY: ':99' });
});

for (const exitCode of [0, 7]) {
  test(`removes temporary profiles and downloads after a worker exits with code ${exitCode}`, async t => {
    const { workerPath, sentinel } = await fixture(t, `
      const fs = require('node:fs');
      const path = require('node:path');
      const assert = require('node:assert/strict');
      assert.equal(require('node:os').tmpdir(), process.argv[2]);
      for (const folder of ['downloads', 'user-data', 'extensions']) {
        fs.mkdirSync(path.join(process.argv[2], folder));
        fs.writeFileSync(path.join(process.argv[2], folder, 'temporary'), 'test');
      }
      process.exit(${exitCode});
    `);
    let temporary;
    const running = runIsolated('fixture', { workerPath, onDirectory: value => { temporary = value; } });
    if (exitCode) await assert.rejects(running, /exit code 7/);
    else await running;
    await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
    assert.equal(await fs.readFile(sentinel, 'utf8'), '{"preserved":true}\n');
  });
}

test('stops a cancelled worker before removing its temporary directory', async t => {
  const { workerPath, sentinel } = await fixture(t, `
    const fs = require('node:fs');
    const path = require('node:path');
    fs.writeFileSync(path.join(process.argv[2], 'ready'), 'ready');
    setInterval(() => {}, 1000);
  `);
  let temporary;
  const controller = new AbortController();
  t.after(() => controller.abort(new Error('fixture cancelled')));
  const completed = assert.rejects(runIsolated('fixture', {
    workerPath, signal: controller.signal, onDirectory: value => { temporary = value; }
  }), /fixture cancelled/);
  const end = Date.now() + 5000;
  while (!temporary || !(await fs.access(path.join(temporary, 'ready')).then(() => true, () => false))) {
    assert.ok(Date.now() < end, 'The fixture must start before cancellation.');
    await delay(20);
  }
  controller.abort(new Error('fixture cancelled'));
  await completed;
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), '{"preserved":true}\n');
});

test('a timeout stops the worker and removes its files', async t => {
  const { workerPath } = await fixture(t, 'setInterval(() => {}, 1000);');
  let temporary;
  await assert.rejects(runIsolated('fixture', {
    workerPath, timeout: 200, onDirectory: value => { temporary = value; }
  }), /tests timed out/);
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('a failed launch stops the application without waiting for the runner timeout', {
  skip: process.platform === 'win32'
}, async t => {
  const { workerPath, started } = await electronFixture(t, {
    launchTimeout: 1000, stderr: 'The application could not open its display.\n'
  });
  let temporary;
  const completed = assert.rejects(runIsolated('fixture', {
    workerPath, timeout: 5000, onDirectory: value => { temporary = value; }
  }), /exit code 1[\s\S]*The application could not open its display/);
  const pid = await started();
  await completed;
  await assertStopped(pid);
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('cancellation stops an application before its debugging endpoint is ready', {
  skip: process.platform === 'win32'
}, async t => {
  const { workerPath, started } = await electronFixture(t);
  let temporary;
  const controller = new AbortController();
  t.after(() => controller.abort(new Error('fixture cancelled')));
  const completed = assert.rejects(runIsolated('fixture', {
    workerPath, signal: controller.signal, onDirectory: value => { temporary = value; }
  }), /fixture cancelled/);
  const pid = await started();
  controller.abort(new Error('fixture cancelled'));
  await completed;
  await assertStopped(pid);
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('a runner timeout stops an application before its debugging endpoint is ready', {
  skip: process.platform === 'win32'
}, async t => {
  const { workerPath, started } = await electronFixture(t, { stderr: 'Application startup stalled.\n' });
  let temporary;
  const completed = assert.rejects(runIsolated('fixture', {
    workerPath, timeout: 2000, onDirectory: value => { temporary = value; }
  }), /tests timed out[\s\S]*Application startup stalled/);
  const pid = await started();
  await completed;
  await assertStopped(pid);
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('cancellation stops an application after its debugging endpoint is ready', {
  skip: process.platform === 'win32'
}, async t => {
  const { workerPath, started } = await electronFixture(t, { ready: true });
  let temporary;
  const controller = new AbortController();
  t.after(() => controller.abort(new Error('fixture cancelled')));
  const completed = assert.rejects(runIsolated('fixture', {
    workerPath, signal: controller.signal, onDirectory: value => { temporary = value; }
  }), /fixture cancelled/);
  const appPid = await started();
  controller.abort(new Error('fixture cancelled'));
  await completed;
  await assertStopped(appPid);
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

for (const cancelled of [false, true]) {
  test(`${cancelled ? 'cancellation' : 'a timeout'} reaps the application when its worker blocks during startup`, {
    skip: process.platform === 'win32', timeout: 15000
  }, async t => {
    const { workerPath, started, blocked } = await electronFixture(t, { blockWorker: true });
    let temporary;
    const controller = new AbortController();
    t.after(() => controller.abort(new Error('fixture cancelled')));
    const completed = assert.rejects(runIsolated('fixture', {
      workerPath, signal: controller.signal, timeout: cancelled ? 10000 : 2000,
      onDirectory: value => { temporary = value; }
    }), cancelled ? /fixture cancelled/ : /tests timed out/);
    const appPid = await started();
    await blocked();
    if (cancelled) controller.abort(new Error('fixture cancelled'));
    await completed;
    assert.throws(() => process.kill(appPid, 0), { code: 'ESRCH' });
    await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
  });
}

test('a failed application spawn stops its worker and removes the test directory', async t => {
  const { workerPath } = await fixture(t, `
    const { applicationCommand, runWorker } = require(${JSON.stringify(require.resolve('../scripts/compatibility-processes'))});
    runWorker(() => applicationCommand({
      type: 'launch-application', executablePath: '/nonexistent/codex-usage-application', args: [], env: process.env
    }));
  `);
  let temporary;
  await assert.rejects(runIsolated('fixture', {
    workerPath, timeout: 5000, onDirectory: value => { temporary = value; }
  }), { code: 'ENOENT' });
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('startup failures include a bounded stderr tail, including a final line without a newline', async t => {
  const application = `
    process.stderr.end('Discarded startup output\\n' + 'x'.repeat(32768) +
      '\\nRequired shared library is missing.', () => process.exit(9));
  `;
  const { workerPath } = await fixture(t, `
    const { applicationCommand, runWorker } = require(${JSON.stringify(require.resolve('../scripts/compatibility-processes'))});
    runWorker(() => applicationCommand({
      type: 'launch-application', executablePath: process.execPath,
      args: ['-e', ${JSON.stringify(application)}, '--'], env: process.env
    }));
  `);
  let temporary;
  await assert.rejects(runIsolated('fixture', {
    workerPath, timeout: 5000, onDirectory: value => { temporary = value; }
  }), error => {
    assert.match(error.message, /application stopped with exit code 9/);
    const stderr = error.message.split('application stderr:\n')[1];
    assert.ok(stderr && stderr.length <= 16 * 1024);
    assert.ok(!stderr.includes('Discarded startup output'));
    assert.ok(stderr.endsWith('Required shared library is missing.'));
    assert.equal(error.cause.message, 'VS Code fixture application stopped with exit code 9.');
    return true;
  });
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

test('the supervisor launches and closes an application before removing its profile', {
  skip: process.platform === 'win32'
}, async t => {
  const { directory, workerPath } = await fixture(t, '');
  const executable = path.join(directory, 'fake-electron');
  const exitFile = path.join(directory, 'application-exited');
  await fs.writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.equal(process.env.NODE_OPTIONS, undefined);
process.stderr.write('DevTools listening on ws://127.0.0.1:12345/test\\n');
process.on('SIGTERM', () => {
  assert.ok(fs.existsSync(process.argv[2]), 'The profile must exist until the application exits.');
  fs.writeFileSync(${JSON.stringify(exitFile)}, 'closed');
  process.exit(0);
});
setInterval(() => {}, 1000);
`, { mode: 0o700 });
  await fs.writeFile(workerPath, `
const { applicationCommand, runWorker } = require(${JSON.stringify(require.resolve('../scripts/compatibility-processes'))});
runWorker(async () => {
  const { endpoint } = await applicationCommand({
    type: 'launch-application', executablePath: ${JSON.stringify(executable)}, args: [process.argv[2]],
    env: { ...process.env, NODE_OPTIONS: '--require=/nonexistent/codex-usage-test-hook' }
  });
  require('node:assert/strict').equal(endpoint, 'ws://127.0.0.1:12345/test');
  await applicationCommand({ type: 'close-application' });
});
`);
  let temporary;
  await runIsolated('fixture', {
    workerPath, timeout: 5000, onDirectory: value => { temporary = value; }
  });
  assert.equal(await fs.readFile(exitFile, 'utf8'), 'closed');
  await assert.rejects(fs.access(temporary), { code: 'ENOENT' });
});

for (const engine of [undefined, '^1.65.2', '>=1.65.2 <1.66.0']) {
  test(`builds a VSIX with ${engine ?? 'the declared engine'} without modifying the source manifest`, async t => {
    const { directory } = await fixture(t, '');
    const repository = path.resolve(__dirname, '..');
    const before = await fs.readFile(path.join(repository, 'package.json'), 'utf8');
    const args = [path.join(repository, 'scripts/package.py'), '--out-dir', path.join(directory, 'vsix')];
    if (engine) args.push('--vscode-engine', engine);
    const vsix = execFileSync('python3', args, { encoding: 'utf8' }).trim();
    const contents = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
from zipfile import ZipFile
from xml.etree import ElementTree
with ZipFile(sys.argv[1]) as archive:
    package_contents = archive.read('extension/package.json').decode()
    root = ElementTree.fromstring(archive.read('extension.vsixmanifest'))
    properties = {
        element.get('Id'): element.get('Value')
        for element in root.iter('{http://schemas.microsoft.com/developer/vsx-schema/2011}Property')
    }
    print(json.dumps({
        'package': json.loads(package_contents),
        'packageContents': package_contents,
        'manifestEngine': properties['Microsoft.VisualStudio.Code.Engine'],
        'files': archive.namelist()
    }))
`, vsix], { encoding: 'utf8' }));
    const expected = engine ?? manifest.engines.vscode;
    assert.deepEqual(contents.package, { ...manifest, engines: { ...manifest.engines, vscode: expected } });
    assert.equal(contents.manifestEngine, expected);
    if (!engine) assert.equal(contents.packageContents, before);
    for (const file of ['src/extension.js', 'src/client.js', 'media/gauges.woff']) {
      assert.ok(contents.files.includes(`extension/${file}`));
    }
    assert.equal(await fs.readFile(path.join(repository, 'package.json'), 'utf8'), before);
  });
}
