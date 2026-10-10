const { test } = require('node:test');
const assert = require('node:assert/strict');
const { windows, gauge } = require('../src/usage');

test('uses returned windows and converts reset timestamps to milliseconds', () => {
  const input = {
    rateLimits: {
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1800000000 },
      secondary: { usedPercent: 59, windowDurationMins: 10080 }
    }
  };
  const expected = [
    { id: 'codex.primary', label: '5h', remaining: 72, resetsAt: 1800000000000 },
    { id: 'codex.secondary', label: 'Weekly', remaining: 41, resetsAt: null }
  ];

  assert.deepEqual(windows(input), expected);
});

test('normalises reset timestamps to valid milliseconds or null', () => {
  const cases = [
    [undefined, null],
    [null, null],
    [NaN, null],
    [Infinity, null],
    [-Infinity, null],
    ['1800000000', null],
    [8640000000001, null],
    [-8640000000001, null],
    [Number.MAX_VALUE, null],
    [-Number.MAX_VALUE, null],
    [0, 0],
    [0.0005, 0.5],
    [1800000000, 1800000000000],
    [8640000000000, 8640000000000000],
    [-8640000000000, -8640000000000000]
  ];

  for (const [resetsAt, expected] of cases) {
    const [window] = windows({ rateLimits: { primary: { usedPercent: 20, resetsAt } } });
    assert.equal(window.resetsAt, expected, `Reset timestamp for ${resetsAt}`);
    assert.equal(window.remaining, 80);
  }
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
    result.map(w => [w.id, w.label, w.remaining]),
    [['codex.primary', 'codex 15m', 0], ['special.secondary', 'Special 1d', 100]]
  );
});

test('preserves window identity between legacy and bucketed responses', () => {
  const bucket = {
    limitId: 'special',
    primary: { usedPercent: 20, windowDurationMins: 300 },
    secondary: { usedPercent: 40, windowDurationMins: 10080 }
  };
  const legacy = windows({ rateLimits: bucket });
  const bucketed = windows({ rateLimitsByLimitId: { special: bucket } });

  assert.deepEqual(legacy.map(window => window.id), ['special.primary', 'special.secondary']);
  assert.deepEqual(bucketed, legacy);
});

test('window identity is independent of display names and durations', () => {
  const bucket = {
    limitName: 'Original',
    primary: { usedPercent: 20, windowDurationMins: 300 },
    secondary: { usedPercent: 40, windowDurationMins: 300 }
  };
  const result = { rateLimitsByLimitId: { special: bucket } };
  const originalIds = windows(result).map(window => window.id);

  bucket.limitName = 'Renamed';
  bucket.primary.windowDurationMins = 60;

  assert.deepEqual(originalIds, ['special.primary', 'special.secondary']);
  assert.deepEqual(windows(result).map(window => window.id), originalIds);
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

test('gauges round fractional percentages and clamp out-of-range values', () => {
  const cases = [
    [-1, '$(codex-usage-gauge-0)'],
    [0.49, '$(codex-usage-gauge-0)'],
    [0.5, '$(codex-usage-gauge-1)'],
    [12.49, '$(codex-usage-gauge-12)'],
    [12.5, '$(codex-usage-gauge-13)'],
    [99.49, '$(codex-usage-gauge-99)'],
    [99.5, '$(codex-usage-gauge-100)'],
    [101, '$(codex-usage-gauge-100)']
  ];
  for (const [remaining, expected] of cases) {
    assert.equal(gauge(remaining), expected, `Gauge at ${remaining}% remaining`);
  }
});
