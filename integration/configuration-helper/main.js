const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const { writeJson } = require('./write-json');

/**
 * @typedef {{version: string, node: string, globalStoragePath: string, portablePath: string, hasOwn: boolean}} RuntimeInfo
 */

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  const directory = process.env.CODEX_USAGE_TEST_ROOT;
  const portablePath = process.env.VSCODE_PORTABLE;
  if (!directory || !portablePath) {
    throw new Error('The configuration helper requires the disposable test directory and portable profile.');
  }
  const requestFile = path.join(directory, 'settings-request.json');
  const replyFile = path.join(directory, 'settings-reply.json');
  context.subscriptions.push(vscode.commands.registerCommand('codexUsageTest.applySettings', async () => {
    /** @type {{id: number, changes: Record<string, unknown>}} */
    const request = JSON.parse(await fs.readFile(requestFile, 'utf8'));
    /** @type {{id: number, error?: string}} */
    const reply = { id: request.id };
    try {
      const config = vscode.workspace.getConfiguration('codexUsage');
      for (const [key, value] of Object.entries(request.changes)) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    } catch (error) {
      reply.error = error.message;
    }
    await writeJson(replyFile, reply);
  }));
  await context.secrets.get('codexUsageTest.isolationProbe');
  /** @type {RuntimeInfo} */
  const runtime = {
    version: vscode.version,
    node: process.versions.node,
    globalStoragePath: context.globalStorageUri.fsPath,
    portablePath,
    hasOwn: typeof Object.hasOwn === 'function'
  };
  await writeJson(path.join(directory, 'runtime.json'), runtime);
}

module.exports = { activate };
