const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexClient } = require('../src/client');

const server = `
const rl = require('node:readline').createInterface({ input: process.stdin });
let handshake = 'new';
rl.on('line', line => {
  const m = JSON.parse(line);
  if (m.method === 'initialized') {
    handshake = handshake === 'initialize-replied' && m.id === undefined ? 'ready' : 'invalid';
    return;
  }
  if (m.method === 'initialize' && handshake === 'new') {
    handshake = 'initialize-replied';
    process.stdout.write(JSON.stringify({ id: m.id, result: {} }) + '\\n');
    return;
  }
  if (m.method === 'hang') return;
  if (m.method === 'exit') process.exit(0);
  const reply = handshake === 'ready' && m.method === 'account/rateLimits/read'
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
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('exit'), /stopped/);
  assert.equal(client.pending.size, 0);
});

test('missing executable rejects without an unhandled process error or pipe signal', async t => {
  let pipeSignals = 0;
  if (process.platform !== 'win32') {
    const onSigpipe = () => pipeSignals++;
    process.on('SIGPIPE', onSigpipe);
    t.after(() => process.off('SIGPIPE', onSigpipe));
  }
  const client = new CodexClient('/nonexistent/codex-usage-test');
  const closed = new Promise(resolve => client.proc.once('close', resolve));
  t.after(() => client.dispose());
  await assert.rejects(client.initialize(), /ENOENT/);
  await closed;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pipeSignals, 0);
});

test('ignores malformed envelopes until a valid reply arrives, including a null result', async t => {
  const malformedServer = `
const rl = require('node:readline').createInterface({ input: process.stdin });
rl.on('line', line => {
  const request = JSON.parse(line);
  if (typeof request.method !== 'string') return;
  const id = request.id;
  const invalid = [
    null, true, 42, 'text', [], [{ id, result: 'invalid' }], {}, { id },
    { id, method: null, result: 'invalid' },
    { id, method: 42, result: 'invalid' },
    { id, method: '', result: 'invalid' },
    { id, result: 'invalid', error: { code: -1, message: 'Invalid' } },
    { id, error: null },
    { id, error: 'invalid' },
    { id, error: [] },
    { id, error: {} },
    { id, error: { code: -1, message: 42 } },
    { id, error: { code: 'invalid', message: 'Invalid' } }
  ];
  process.stdout.write('{not JSON}\\n');
  for (const message of invalid) process.stdout.write(JSON.stringify(message) + '\\n');
  process.stdout.write(JSON.stringify({ id, result: null }) + '\\n');
});`;
  const client = new CodexClient(process.execPath, {
    args: ['-e', malformedServer], timeout: 1000
  });
  t.after(() => client.dispose());

  assert.equal(await client.request('read'), null);
  assert.equal(client.pending.size, 0);
  assert.equal(client.closed, false);
});

test('handles notifications and rejects unsupported server requests', async t => {
  const eventServer = `
const rl = require('node:readline').createInterface({ input: process.stdin });
let requestId;
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'events') {
    requestId = message.id;
    process.stdout.write(JSON.stringify({
      method: 'account/rateLimits/updated',
      params: { rateLimits: { primary: { usedPercent: 25 } } }
    }) + '\\n');
    process.stdout.write(JSON.stringify({ id: 'server-request', method: 'unsupported' }) + '\\n');
  } else if (message.id === 'server-request') {
    process.stdout.write(JSON.stringify({ id: requestId, result: message.error }) + '\\n');
  }
});`;
  const updates = [];
  const client = new CodexClient(process.execPath, {
    args: ['-e', eventServer], timeout: 1000,
    onUpdate: update => updates.push(update)
  });
  t.after(() => client.dispose());

  const result = await client.request('events');
  assert.equal(result.code, -32601);
  assert.deepEqual(updates, [{ rateLimits: { primary: { usedPercent: 25 } } }]);
});
