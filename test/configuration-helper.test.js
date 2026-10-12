const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = require.resolve('../integration/configuration-helper/main');
const requireHelper = createRequire(helperPath);

for (const runtime of [
  { version: '1.66.0', node: '16.13.0', hasOwn: true },
  { version: '1.65.2', node: '14.16.0', hasOwn: false }
]) {
  test(`reports the Node.js ${runtime.node} extension host and its profile before a settings command runs`, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-usage-helper-fixture-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const requests = path.join(directory, 'requests');
    await fs.mkdir(requests);
    const portablePath = path.join(directory, 'portable');
    const globalStoragePath = path.join(portablePath, 'user-data', 'User/globalStorage/test-helper');
    const commands = new Map();
    let secretReads = 0;
    const sandbox = vm.createContext({
      module: { exports: {} },
      process: { env: { CODEX_USAGE_TEST_ROOT: requests, VSCODE_PORTABLE: portablePath }, versions: { node: runtime.node } },
      require(name) {
        if (name === 'vscode') return {
          version: runtime.version,
          commands: {
            registerCommand(id, handler) {
              commands.set(id, handler);
              return { dispose() { commands.delete(id); } };
            }
          },
          workspace: {
            getConfiguration() {
              assert.fail('Runtime reporting must not need a configuration command.');
            }
          }
        };
        return requireHelper(name);
      }
    });
    if (!runtime.hasOwn) vm.runInContext('Object.hasOwn = undefined;', sandbox);
    vm.runInContext(await fs.readFile(helperPath, 'utf8'), sandbox, { filename: helperPath });
    const subscriptions = [];
    await sandbox.module.exports.activate({
      globalStorageUri: { fsPath: globalStoragePath }, subscriptions,
      secrets: {
        async get(key) {
          assert.equal(key, 'codexUsageTest.isolationProbe');
          secretReads++;
        }
      }
    });

    assert.deepEqual(JSON.parse(await fs.readFile(path.join(requests, 'runtime.json'), 'utf8')),
      { ...runtime, globalStoragePath, portablePath });
    assert.equal(secretReads, 1, 'Runtime reporting must initialize the credential backend.');
    assert.ok(commands.has('codexUsageTest.applySettings'));
    assert.deepEqual(await fs.readdir(requests), ['runtime.json']);
    for (const subscription of subscriptions) subscription.dispose();
  });
}

test('requires a portable profile before reading secrets or registering commands', async () => {
  for (const env of [{}, { CODEX_USAGE_TEST_ROOT: '/disposable-test-directory' }]) {
    const sandbox = vm.createContext({
      module: { exports: {} }, process: { env },
      require(name) {
        if (name === 'vscode') return {
          commands: {
            registerCommand() { assert.fail('The helper must reject a missing portable profile first.'); }
          }
        };
        return requireHelper(name);
      }
    });
    vm.runInContext(await fs.readFile(helperPath, 'utf8'), sandbox, { filename: helperPath });
    await assert.rejects(sandbox.module.exports.activate({
      subscriptions: [],
      secrets: { get() { assert.fail('The helper must reject a missing portable profile first.'); } }
    }), /portable profile/);
  }
});
