const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { gauge } = require('../src/usage');
const manifest = require('../package.json');

const settle = () => new Promise(resolve => setImmediate(resolve));

async function createExtension(t, settings = {}) {
  const items = [];
  const hiddenItems = new Set();
  const clients = [];
  const timers = [];
  const commands = new Map();
  const subscriptions = [];
  let configurationListener;
  const response = {
    error: undefined,
    result: {
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300 },
        secondary: { usedPercent: 34, windowDurationMins: 10080 }
      }
    }
  };
  const dispose = () => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
  };
  t.after(dispose);

  const vscode = {
    StatusBarAlignment: { Right: 2 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class {
      value = '';
      appendText(text) { this.value += text; }
      appendMarkdown(text) { this.value += text; }
    },
    window: {
      createStatusBarItem(id, alignment, priority) {
        const item = {
          id, priority,
          show() { this.visible = !hiddenItems.has(id); },
          dispose() { this.disposed = true; }
        };
        items.push(item);
        return item;
      }
    },
    workspace: {
      getConfiguration: () => ({
        get: (key, fallback) => settings[key] ??
          manifest.contributes.configuration.properties[`codexUsage.${key}`]?.default ?? fallback
      }),
      onDidChangeConfiguration(listener) {
        configurationListener = listener;
        return { dispose() { configurationListener = undefined; } };
      }
    },
    extensions: { getExtension: () => undefined },
    commands: {
      registerCommand(name, fn) {
        commands.set(name, fn);
        return { dispose() {} };
      }
    }
  };
  class CodexClient {
    constructor(executable) {
      this.executable = executable;
      this.requests = 0;
      clients.push(this);
    }
    async initialize() {}
    async request() {
      this.requests++;
      if (response.pending) return response.pending;
      if (response.error) throw response.error;
      return response.result;
    }
    dispose() { this.closed = true; }
  }
  const sandbox = {
    require(name) {
      if (name === 'vscode') return vscode;
      if (name === './client') return { CodexClient };
      if (name === './usage') return require('../src/usage');
      return require(name);
    },
    module: { exports: {} }, process,
    setInterval(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearInterval(id) {
      if (id !== undefined) timers[id - 1].cleared = true;
    }
  };
  const source = fs.readFileSync(require.resolve('../src/extension'), 'utf8');
  vm.runInNewContext(source, sandbox);
  sandbox.module.exports.activate({ subscriptions });
  await settle();
  const [label, primary, secondary] = items;
  return {
    items, label, primary, secondary, response, clients, timers, dispose,
    refresh: commands.get('codexUsage.refresh'),
    hide(id) {
      hiddenItems.add(id);
      for (const item of items) {
        if (item.id === id) item.visible = false;
      }
    },
    async changeSettings(changes) {
      Object.assign(settings, changes);
      const sections = new Set(Object.keys(changes).map(key => `codexUsage.${key}`));
      configurationListener({
        affectsConfiguration: section => section === 'codexUsage' || sections.has(section)
      });
      await settle();
    }
  };
}

test('every whole percentage has a distinct registered gauge', () => {
  const icons = manifest.contributes.icons;
  const characters = new Set();
  for (let percent = 0; percent <= 100; percent++) {
    const id = `codex-usage-gauge-${percent}`;
    assert.equal(gauge(percent), `$(${id})`);
    assert.ok(icons[id], `Missing icon for ${percent}% remaining`);
    characters.add(icons[id].default.fontCharacter);
  }
  assert.equal(characters.size, 101);
});

test('renders independent allowance items with refresh commands and tooltips', async t => {
  const { items, label, primary, secondary } = await createExtension(t);

  assert.equal(items.length, 3);
  assert.equal(label.text, 'Codex:');
  assert.equal(primary.text, '$(codex-usage-gauge-80) 5h 80%');
  assert.equal(secondary.text, '$(codex-usage-gauge-66) Weekly 66%');
  assert.equal(primary.color.id, 'terminal.ansiGreen');
  assert.equal(secondary.color.id, 'terminal.ansiYellow');
  assert.ok(label.priority > primary.priority);
  assert.ok(primary.priority > secondary.priority);
  for (const item of items) {
    assert.equal(item.command, 'codexUsage.refresh');
    assert.ok(item.visible);
    assert.match(item.tooltip.value, /Last checked:/);
  }
});

test('marks retained allowances stale with the Codex label hidden and clears the error on recovery', async t => {
  const { label, primary, secondary, response, refresh, hide } = await createExtension(t);
  hide(label.id);

  response.error = new Error('Connection lost');
  await refresh();

  assert.equal(label.visible, false);
  assert.match(label.text, /stale/);
  assert.equal(primary.text, '$(codex-usage-gauge-80) 5h 80% (stale)');
  assert.equal(secondary.text, '$(codex-usage-gauge-66) Weekly 66% (stale)');
  assert.ok(primary.visible);
  assert.ok(secondary.visible);
  assert.match(primary.accessibilityInformation.label, /80% remaining, stale/);
  assert.match(primary.tooltip.value, /Connection lost/);

  response.error = undefined;
  await refresh();

  assert.equal(label.visible, false);
  assert.equal(label.text, 'Codex:');
  assert.equal(primary.text, '$(codex-usage-gauge-80) 5h 80%');
  assert.equal(secondary.text, '$(codex-usage-gauge-66) Weekly 66%');
  assert.doesNotMatch(primary.accessibilityInformation.label, /stale/);
  assert.doesNotMatch(primary.tooltip.value, /Connection lost/);
});

test('preserves weekly identity and visibility when the primary window disappears and returns', async t => {
  const { items, primary, secondary, response, refresh, hide } = await createExtension(t);
  const original = [primary, secondary].map(({ id, name }) => ({ id, name }));
  const originalPrimary = response.result.rateLimits.primary;
  hide(secondary.id);

  delete response.result.rateLimits.primary;
  await refresh();
  const weekly = items.find(item => !item.disposed && item.name === original[1].name);
  assert.equal(weekly.id, original[1].id);
  assert.equal(weekly.visible, false);

  response.result.rateLimits.primary = originalPrimary;
  await refresh();
  const restoredPrimary = items.find(item => !item.disposed && item.name === original[0].name);
  const restoredWeekly = items.find(item => !item.disposed && item.name === original[1].name);
  assert.equal(restoredPrimary.id, original[0].id);
  assert.equal(restoredPrimary.visible, true);
  assert.equal(restoredWeekly.id, original[1].id);
  assert.equal(restoredWeekly.visible, false);
  assert.ok(restoredPrimary.priority > restoredWeekly.priority);
});

test('preserves bucket visibility preferences and display order when buckets are reordered', async t => {
  const { items, response, refresh, hide } = await createExtension(t);
  const codex = { primary: { usedPercent: 20, windowDurationMins: 300 } };
  const special = {
    limitName: 'Special',
    secondary: { usedPercent: 40, windowDurationMins: 10080 }
  };
  response.result = { rateLimitsByLimitId: { codex, special } };
  await refresh();
  const original = items.filter(item => !item.disposed).slice(1)
    .map(({ id, name }) => ({ id, name }));
  hide(original[1].id);

  response.result.rateLimitsByLimitId = { special, codex };
  await refresh();
  const reordered = items.filter(item => !item.disposed).slice(1);
  const codexItem = reordered.find(item => item.name === original[0].name);
  const specialItem = reordered.find(item => item.name === original[1].name);
  assert.equal(codexItem.id, original[0].id);
  assert.equal(codexItem.visible, true);
  assert.equal(specialItem.id, original[1].id);
  assert.equal(specialItem.visible, false);
  assert.ok(specialItem.priority > codexItem.priority);
});

test('recolours cached allowances without reading usage or restarting the connection', async t => {
  const { label, primary, secondary, response, clients, timers, changeSettings } = await createExtension(t);
  const tooltip = label.tooltip.value;
  response.error = new Error('Network unavailable');

  await changeSettings({ criticalThresholdPercent: 90 });
  assert.equal(primary.color.id, 'terminal.ansiRed');
  await changeSettings({ criticalThresholdPercent: 0, warningThresholdPercent: 85 });
  assert.equal(primary.color.id, 'terminal.ansiYellow');
  assert.equal(clients.length, 1);
  assert.equal(clients[0].requests, 1);
  assert.ok(!clients[0].closed);
  assert.equal(timers.length, 1);
  assert.ok(!timers[0].cleared);
  assert.ok(!primary.disposed);
  assert.ok(!secondary.disposed);
  assert.equal(label.text, 'Codex:');
  assert.equal(label.tooltip.value, tooltip);
});

test('threshold changes retain stale allowances and their refresh error', async t => {
  const { label, primary, response, refresh, clients, changeSettings } = await createExtension(t);
  response.error = new Error('Connection lost');
  await refresh();

  await changeSettings({ criticalThresholdPercent: 90 });

  assert.equal(clients.length, 1);
  assert.equal(clients[0].requests, 2);
  assert.ok(!primary.disposed);
  assert.equal(primary.color.id, 'terminal.ansiRed');
  assert.match(label.text, /stale/);
  assert.match(primary.tooltip.value, /Connection lost/);
});

test('reschedules polling while retaining the connection and cached allowances', async t => {
  const { label, primary, response, clients, timers, changeSettings } = await createExtension(t);
  response.error = new Error('Network unavailable');

  await changeSettings({ refreshIntervalSeconds: 120 });

  assert.equal(clients.length, 1);
  assert.equal(clients[0].requests, 1);
  assert.ok(!clients[0].closed);
  assert.ok(!primary.disposed);
  assert.equal(label.text, 'Codex:');
  assert.equal(timers.length, 2);
  assert.ok(timers[0].cleared);
  assert.equal(timers[1].delay, 120000);

  timers[1].callback();
  await settle();
  assert.equal(clients[0].requests, 2);
  assert.match(label.text, /stale/);
  assert.ok(!primary.disposed);
});

test('restarts the connection and checks usage when the executable changes', async t => {
  const { items, label, primary, response, clients, timers, changeSettings } = await createExtension(t);
  response.result.rateLimits.primary.usedPercent = 50;

  await changeSettings({ executablePath: '/new/codex' });

  assert.equal(clients.length, 2);
  assert.ok(clients[0].closed);
  assert.equal(clients[1].executable, '/new/codex');
  assert.equal(clients[1].requests, 1);
  assert.equal(timers.length, 1);
  assert.ok(!timers[0].cleared);
  assert.equal(label.text, 'Codex:');
  const replacement = items.find(item => !item.disposed && item.id === primary.id);
  assert.equal(replacement.text, '$(codex-usage-gauge-50) 5h 50%');
});

test('ignores an old reply when the executable changes during a refresh', async t => {
  const { items, primary, response, refresh, clients, changeSettings } = await createExtension(t);
  let resolveOld;
  response.pending = new Promise(resolve => { resolveOld = resolve; });
  const pendingRefresh = refresh();
  response.pending = undefined;
  response.result.rateLimits.primary.usedPercent = 55;

  await changeSettings({ executablePath: '/new/codex' });
  resolveOld({ rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } } });
  await pendingRefresh;
  await settle();

  assert.equal(clients.length, 2);
  assert.ok(clients[0].closed);
  assert.equal(clients[1].executable, '/new/codex');
  const current = items.find(item => !item.disposed && item.id === primary.id);
  assert.equal(current.text, '$(codex-usage-gauge-45) 5h 45%');
});

const colourCases = [
  { name: 'green above the default warning threshold', remaining: 67, colour: 'Green' },
  { name: 'yellow at the default warning threshold', remaining: 66, colour: 'Yellow' },
  { name: 'yellow above the default critical threshold', remaining: 34, colour: 'Yellow' },
  { name: 'red at the default critical threshold', remaining: 33, colour: 'Red' },
  {
    name: 'red at a custom critical threshold', remaining: 10, colour: 'Red',
    settings: { criticalThresholdPercent: 10 }
  },
  {
    name: 'yellow above a custom critical threshold', remaining: 11, colour: 'Yellow',
    settings: { criticalThresholdPercent: 10 }
  },
  {
    name: 'critical threshold takes precedence over the warning threshold',
    remaining: 10, colour: 'Red',
    settings: { criticalThresholdPercent: 10, warningThresholdPercent: 0 }
  },
  {
    name: 'green above zero thresholds', remaining: 10, colour: 'Green',
    settings: { criticalThresholdPercent: 0, warningThresholdPercent: 0 }
  },
  {
    name: 'red at a zero critical threshold', remaining: 0, colour: 'Red',
    settings: { criticalThresholdPercent: 0, warningThresholdPercent: 0 }
  },
  {
    name: 'red at a full critical threshold', remaining: 100, colour: 'Red',
    settings: { criticalThresholdPercent: 100 }
  }
];

for (const { name, remaining, colour, settings } of colourCases) {
  test(name, async t => {
    const { primary, response, refresh } = await createExtension(t, settings);
    response.result.rateLimits.primary.usedPercent = 100 - remaining;

    await refresh();

    assert.equal(primary.color.id, `terminal.ansi${colour}`);
  });
}

test('disposes removed allowances and creates new items when data returns', async t => {
  const { items, label, primary, secondary, response, refresh, dispose } = await createExtension(t);

  delete response.result.rateLimits.secondary;
  await refresh();
  assert.ok(secondary.disposed);
  assert.ok(!primary.disposed);

  response.result = {};
  await refresh();
  assert.match(label.text, /unavailable/);
  assert.ok(primary.disposed);

  response.result = { rateLimits: { primary: { usedPercent: 0 } } };
  await refresh();
  const replacement = items.at(-1);
  assert.notEqual(replacement, primary);
  assert.equal(replacement.text, '$(codex-usage-gauge-100) Window 100%');
  assert.ok(replacement.visible);
  assert.ok(!replacement.disposed);

  dispose();
  assert.ok(items.every(item => item.disposed));
});
