const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetDescription, updateAge } = require('../src/time');

function localTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
}

test('describes an unknown reset time', () => {
  assert.equal(resetDescription(null, 0), 'Resets at an unknown time');
});

test('formats compact reset times for short and weekly allowances', () => {
  const now = new Date(2026, 9, 7, 21, 3, 50).getTime();
  const primaryReset = now + 150 * 60000;
  const secondaryReset = now + 7560 * 60000;
  const weeklyDate = new Date(2026, 9, 13).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short'
  });

  assert.equal(resetDescription(primaryReset, now),
    `Resets in 2h 30m · Today at ${localTime(new Date(2026, 9, 7, 23, 33))}`);
  assert.equal(resetDescription(secondaryReset, now),
    `Resets in 5d 6h · ${weeklyDate} at ${localTime(new Date(2026, 9, 13, 3, 3))}`);
});

test('rounds reset countdowns up to a minute and identifies resets that are due', () => {
  const now = new Date(2026, 9, 7, 12).getTime();
  const cases = [
    [-60000, 'Reset due'],
    [0, 'Reset due'],
    [1, 'Resets in 1m'],
    [60000, 'Resets in 1m'],
    [60001, 'Resets in 2m'],
    [3600000, 'Resets in 1h'],
    [3600001, 'Resets in 1h 1m']
  ];

  for (const [remaining, description] of cases) {
    const resetsAt = now + remaining;
    assert.equal(resetDescription(resetsAt, now),
      `${description} · Today at ${localTime(new Date(resetsAt))}`,
      `The reset description is correct with ${remaining} milliseconds remaining`);
  }
});

test('uses tomorrow across the end of the year and includes the year on later dates', () => {
  const now = new Date(2026, 11, 31, 23, 30).getTime();
  const tomorrow = new Date(2027, 0, 1, 1);
  assert.equal(resetDescription(tomorrow.getTime(), now),
    `Resets in 1h 30m · Tomorrow at ${localTime(tomorrow)}`);

  const reset = new Date(2027, 0, 2, 1);
  const date = reset.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric'
  });
  assert.equal(resetDescription(reset.getTime(), now),
    `Resets in 1d 1h 30m · ${date} at ${localTime(reset)}`);
});

test('uses local calendar days for tomorrow when clocks change', () => {
  for (const [month, day] of [[2, 8], [2, 29], [9, 25], [10, 1]]) {
    const now = new Date(2026, month, day, 0, 30).getTime();
    const reset = new Date(2026, month, day + 1, 0, 15);
    assert.ok(resetDescription(reset.getTime(), now).endsWith(
      ` · Tomorrow at ${localTime(reset)}`
    ));
  }
});

test('formats update ages at minute, hour and day boundaries', () => {
  const cases = [
    [-30000, 'just now'],
    [0, 'just now'],
    [59999, 'just now'],
    [60000, '1 min ago'],
    [120000, '2 min ago'],
    [3599999, '59 min ago'],
    [3600000, '1 hour ago'],
    [7200000, '2 hours ago'],
    [86399999, '23 hours ago'],
    [86400000, '1 day ago'],
    [172800000, '2 days ago']
  ];

  for (const [elapsed, age] of cases) {
    assert.equal(updateAge(0, elapsed), age,
      `The update age is correct ${elapsed} milliseconds after the last successful check`);
  }
});
