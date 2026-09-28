const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexClient } = require('../src/client');

const server = `
const rl = require('node:readline').createInterface({ input: process.stdin });
let initialized = false;
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialized') {
    initialized = true;
    return;
  }
  if (m.method === 'hang') return;
  if (m.method === 'exit') process.exit(0);
  const reply = m.method === 'initialize'
    ? { id: m.id, result: {} }
    : initialized && m.method === 'account/rateLimits/read'
      ? {
          id: m.id,
          result: {
            rateLimits: {
              primary: { usedPercent: 25 }
            }
          }
        }
      : { id: m.id, error: { code: -1, message: 'Denied' } };
  process.stdout.write(JSON.stringify(reply) + '\\n');
});`;

test('initialises before reading usage and propagates protocol errors', async t => {
  const client = new CodexClient(process.execPath, { args: ['-e', server] });
  t.after(() => client.dispose());

  await client.initialize();
  const result = await client.request('account/rateLimits/read');
  assert.equal(result.rateLimits.primary.usedPercent, 25);
  await assert.rejects(client.request('unknown'), /Denied/);
});

test('times out hung requests and rejects requests when the server exits', async t => {
  const client = new CodexClient(process.execPath, {
    args: ['-e', server],
    timeout: 500
  });
  t.after(() => client.dispose());

  await client.initialize();
  await assert.rejects(client.request('hang'), /timed out/);
  await assert.rejects(client.request('exit'), /stopped/);
  assert.equal(client.pending.size, 0);
});

test('missing executable rejects without an unhandled process error', async t => {
  const client = new CodexClient('/nonexistent/codex-usage-test');
  t.after(() => client.dispose());
  await assert.rejects(client.initialize(), /ENOENT/);
});
