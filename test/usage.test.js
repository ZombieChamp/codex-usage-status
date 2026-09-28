const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windows } = require('../src/usage');

test('uses returned windows and converts reset timestamps to milliseconds', () => {
  const input = {
    rateLimits: {
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1800000000 },
      secondary: { usedPercent: 59, windowDurationMins: 10080 }
    }
  };
  const expected = [
    { label: '5h', remaining: 72, resetsAt: 1800000000000 },
    { label: 'Weekly', remaining: 41, resetsAt: null }
  ];

  assert.deepEqual(windows(input), expected);
});

test('prefers multiple buckets over legacy data without duplicating them', () => {
  const result = windows({
    rateLimits: { primary: { usedPercent: 0 } },
    rateLimitsByLimitId: {
      codex: {
        primary: { usedPercent: 110, windowDurationMins: 15 }
      },
      special: {
        limitName: 'Special',
        secondary: { usedPercent: -1, windowDurationMins: 1440 }
      }
    }
  });

  assert.deepEqual(
    result.map(w => [w.label, w.remaining]),
    [['codex 15m', 0], ['Special 1d', 100]]
  );
});

test('does not report missing or invalid data as a full allowance', () => {
  for (const value of [
    null,
    {},
    { rateLimits: { primary: { usedPercent: null } } }
  ]) {
    assert.deepEqual(windows(value), []);
  }
});
