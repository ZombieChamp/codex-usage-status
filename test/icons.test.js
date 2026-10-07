const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gauge } = require('../src/usage');
const manifest = require('../package.json');

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

test('registers the ChatGPT logo at a distinct codepoint in the gauge font', () => {
  const icons = manifest.contributes.icons;
  const logo = icons['codex-usage-chatgpt'];
  assert.ok(logo, 'Missing ChatGPT logo icon');
  assert.match(logo.default.fontCharacter, /^\\[0-9a-f]+$/i);
  const logoCodepoint = Number.parseInt(logo.default.fontCharacter.slice(1), 16);
  const fontPath = path.resolve(__dirname, '..', logo.default.fontPath);
  assert.ok(fs.existsSync(fontPath), 'Missing ChatGPT logo font');
  for (let percent = 0; percent <= 100; percent++) {
    const gauge = icons[`codex-usage-gauge-${percent}`].default;
    assert.equal(path.resolve(__dirname, '..', gauge.fontPath), fontPath);
    assert.notEqual(logoCodepoint, Number.parseInt(gauge.fontCharacter.slice(1), 16),
      `ChatGPT logo shares a codepoint with the ${percent}% gauge`);
  }
});
