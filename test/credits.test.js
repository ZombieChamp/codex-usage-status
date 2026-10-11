const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetCredits, resetCreditLines } = require('../src/credits');

function snapshot(availableCount, credits, readAt = 0) {
  return resetCredits({
    rateLimitResetCredits: {
      availableCount,
      credits: credits.map((credit, index) => ({
        id: `credit-${index}`, resetType: 'codexRateLimits', status: 'available',
        grantedAt: 0, title: 'Rate-limit reset', description: null, ...credit
      }))
    }
  }, readAt);
}

test('keeps unavailable and invalid reported counts distinct from zero', () => {
  for (const result of [null, {}, { rateLimitResetCredits: null },
    { rateLimitResetCredits: { credits: [] } }]) {
    assert.equal(resetCredits(result, 0), null);
  }
  for (const availableCount of [null, undefined, '2', true, -1, 1.5, NaN, Infinity, 2 ** 53]) {
    assert.equal(resetCredits({ rateLimitResetCredits: { availableCount } }, 0), null);
  }
  assert.deepEqual(resetCreditLines(snapshot(0, []), 0), ['0 account reset credits available']);
  assert.deepEqual(resetCreditLines(null, 0), []);
});

test('uses the reported total when credit details are absent or unusable', () => {
  for (const credits of [undefined, null, [], 'invalid', [null, true, 42]]) {
    const data = resetCredits({ rateLimitResetCredits: { availableCount: 2, credits } }, 0);
    assert.deepEqual(resetCreditLines(data, 0), ['2 account reset credits available']);
  }
});

test('counts available credits and shows expiry independently of titles and reset types', () => {
  for (const title of [
    '5 hr reset', 'Weekly reset', 'Full reset (Weekly + 5 hr)',
    'Full reset (Weekly + short-term)', 'Rate-limit reset', 'Réinitialisation', '', null, 42
  ]) {
    for (const resetType of ['codexRateLimits', 'unknown', 'future-type', undefined, null]) {
      const data = snapshot(1, [{ title, resetType, expiresAt: 300 }]);
      const lines = resetCreditLines(data, 0);
      const message = `Title ${title}, reset type ${resetType}`;
      assert.equal(lines.length, 2, message);
      assert.equal(lines[0], '1 account reset credit available', message);
      assert.match(lines[1], /^Next credit expires in 5m · /, message);
    }
  }
});

test('finds the nearest account expiry across credits with different display titles', () => {
  const data = snapshot(4, [
    { title: 'Full reset (Weekly + 5 hr)', expiresAt: 300 },
    { title: 'Weekly reset', expiresAt: 100 },
    { title: '5-hour reset', expiresAt: 200 },
    { title: '15 hr reset', expiresAt: 50 }
  ]);
  const lines = resetCreditLines(data, 0);
  assert.equal(lines[0], '4 account reset credits available');
  assert.match(lines[1], /^Next credit expires in 1m · /);
});

test('keeps unknown availability unresolved and excludes historical rows from expiry details', () => {
  for (const status of ['unknown', 'future-status', undefined, 'redeeming', 'redeemed']) {
    const data = snapshot(1, [{ status, expiresAt: 60 }]);
    assert.deepEqual(resetCreditLines(data, 0), ['1 account reset credit available'], status);
    assert.deepEqual(resetCreditLines(data, 60000), ['1 account reset credit available'], status);
  }
  const partial = snapshot(2, [
    { expiresAt: 300 }, { status: 'redeemed', expiresAt: 100 }
  ]);
  const lines = resetCreditLines(partial, 0);
  assert.equal(lines[0], '2 account reset credits available');
  assert.match(lines[1], /^Earliest known credit expires in 5m · /);
});

test('accounts for credits that expire before a response is read without restoring them', () => {
  for (const availableCount of [1, 3]) {
    for (const readAt of [60000, 60001]) {
      const data = snapshot(availableCount, [{ expiresAt: 60 }], readAt);
      const expected = [`${availableCount - 1} account reset credits available`];
      assert.deepEqual(resetCreditLines(data, readAt), expected);
      assert.deepEqual(resetCreditLines(data, 3600000), expected);
      assert.deepEqual(resetCreditLines(data, 0), expected);
    }
  }
});

test('removes known expiries without mutating the snapshot', () => {
  const data = snapshot(4, [
    { expiresAt: 300 }, { expiresAt: 200 }, { expiresAt: 100 },
    { status: 'redeemed', expiresAt: 150 }, { expiresAt: 120 }
  ], 100000);
  const original = structuredClone(data);
  for (const [now, count, expiry] of [
    [100000, '3 account reset credits available', /^Next credit expires in 1m · /],
    [120000, '2 account reset credits available', /^Next credit expires in 2m · /],
    [200000, '1 account reset credit available', /^Next credit expires in 2m · /]
  ]) {
    const lines = resetCreditLines(data, now);
    assert.equal(lines[0], count);
    assert.match(lines[1], expiry);
  }
  assert.deepEqual(resetCreditLines(data, 300000), ['0 account reset credits available']);
  assert.deepEqual(data, original);
});

test('deducts known expiries from capped totals while retaining unresolved credits', () => {
  const data = snapshot(3, [{ expiresAt: 60 }]);
  const lines = resetCreditLines(data, 0);
  assert.equal(lines[0], '3 account reset credits available');
  assert.match(lines[1], /^Earliest known credit expires in 1m · /);
  assert.deepEqual(resetCreditLines(data, 60000), ['2 account reset credits available']);
  assert.deepEqual(resetCreditLines(data, 3600000), ['2 account reset credits available']);
});

test('keeps non-expiring credits distinct from missing or invalid expiry information', () => {
  const never = snapshot(1, [{ expiresAt: null }]);
  assert.deepEqual(resetCreditLines(never, 1000000),
    ['1 account reset credit available', 'This credit does not expire']);
  const plural = snapshot(2, [{ expiresAt: null }, { expiresAt: null }]);
  assert.deepEqual(resetCreditLines(plural, 0),
    ['2 account reset credits available', 'These credits do not expire']);
  for (const expiresAt of [undefined, '200', Infinity, 8640000000001]) {
    const data = snapshot(1, [{ expiresAt }]);
    assert.deepEqual(resetCreditLines(data, 0),
      ['1 account reset credit available', 'Next credit expires at an unknown time']);
  }
});

test('only unresolved credits and unknown expiry times make the nearest expiry incomplete', () => {
  const timed = { expiresAt: 300 };
  const complete = snapshot(2, [{ expiresAt: null }, timed]);
  const lines = resetCreditLines(complete, 0);
  assert.equal(lines[0], '2 account reset credits available');
  assert.match(lines[1], /^Next credit expires in 5m · /);
  for (const data of [
    snapshot(2, [{ expiresAt: undefined }, timed]),
    snapshot(3, [{ expiresAt: null }, timed])
  ]) {
    assert.match(resetCreditLines(data, 0)[1], /^Earliest known credit expires in 5m · /);
  }
  const partialNever = snapshot(2, [{ expiresAt: null }]);
  assert.deepEqual(resetCreditLines(partialNever, 0),
    ['2 account reset credits available', 'Next credit expires at an unknown time']);
});

test('preserves reported totals when detail counts conflict', () => {
  const conflicting = snapshot(1, [{ expiresAt: 60 }, { expiresAt: 120 }]);
  assert.deepEqual(resetCreditLines(conflicting, 0), ['1 account reset credit available']);
  assert.deepEqual(resetCreditLines(conflicting, 120000), ['1 account reset credit available']);
  const zero = snapshot(0, [{ expiresAt: null }]);
  assert.deepEqual(resetCreditLines(zero, 0), ['0 account reset credits available']);
});

test('preserves conflicting totals regardless of when the response is read', () => {
  const credits = [{ expiresAt: 60 }, { expiresAt: 120 }];
  for (const readAt of [0, 59999, 60000, 60001, 119999, 120000, 120001]) {
    const data = snapshot(1, credits, readAt);
    assert.deepEqual(resetCreditLines(data, readAt), ['1 account reset credit available'],
      `Total when read at ${readAt}`);
    assert.deepEqual(resetCreditLines(data, 180000), ['1 account reset credit available'],
      `Total after expiry when read at ${readAt}`);
  }
});
