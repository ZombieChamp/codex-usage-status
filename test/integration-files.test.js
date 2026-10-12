const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeJson } = require('../integration/configuration-helper/write-json');

async function directory(t) {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-usage-json-fixture-'));
  t.after(() => fs.rm(value, { recursive: true, force: true }));
  return value;
}

test('readers see complete JSON while a fixture is repeatedly replaced', async t => {
  const root = await directory(t);
  const file = path.join(root, 'settings-reply.json');
  await writeJson(file, { id: 0, payload: '' });
  let finished = false;
  let reads = 0;
  const writing = (async () => {
    try {
      for (let id = 1; id <= 100; id++) {
        await writeJson(file, { id, payload: 'x'.repeat(id % 2 ? 65536 : 1) });
      }
    } finally {
      finished = true;
    }
  })();
  const reading = (async () => {
    do {
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.ok(Number.isInteger(value.id) && value.id >= 0 && value.id <= 100);
      assert.equal(value.payload, value.id === 0 ? '' : 'x'.repeat(value.id % 2 ? 65536 : 1));
      reads++;
    } while (!finished);
  })();
  const results = await Promise.allSettled([writing, reading]);
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }
  assert.ok(reads > 1, 'The reader must run during fixture updates.');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).id, 100);
  assert.deepEqual(await fs.readdir(root), ['settings-reply.json']);
});

test('failed publication removes its temporary files and preserves the destination', async t => {
  const root = await directory(t);
  const file = path.join(root, 'settings-reply.json');
  await fs.mkdir(file);
  const sentinel = path.join(file, 'preserved');
  await fs.writeFile(sentinel, 'existing data');
  await assert.rejects(writeJson(file, { id: 1 }));
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'existing data');
  assert.deepEqual(await fs.readdir(root), ['settings-reply.json']);
});
