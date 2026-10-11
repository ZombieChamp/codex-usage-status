const { timestamp, expiryDescription } = require('./time');

function creditExpiry(seconds) {
  if (seconds === null) return { kind: 'never' };
  const at = timestamp(seconds);
  return at === null ? { kind: 'unknown' } : { kind: 'at', at };
}

function unexpired(expiry, now) {
  return expiry.kind !== 'at' || expiry.at > now;
}

// Establish availability at the read time, before later expiry updates.
function resetCredits(result, readAt) {
  const reported = result?.rateLimitResetCredits;
  const count = reported?.availableCount;
  if (!Number.isSafeInteger(count) || count < 0) return null;
  const rows = Array.isArray(reported.credits) ? reported.credits : [];
  const listed = rows.filter(row => row?.status === 'available')
    .map(credit => creditExpiry(credit.expiresAt));

  // Conflicting details cannot override the reported total as they expire.
  if (listed.length > count) return { unresolvedCount: count, expiries: [] };
  return {
    unresolvedCount: count - listed.length,
    expiries: listed.filter(expiry => unexpired(expiry, readAt))
  };
}

function nextExpiry(expiries, incomplete) {
  if (!expiries.length) return null;
  const times = expiries.filter(expiry => expiry.kind === 'at').map(expiry => expiry.at);
  const unknown = incomplete || expiries.some(expiry => expiry.kind === 'unknown');
  if (times.length) {
    return { kind: unknown ? 'earliest-known' : 'next', at: Math.min(...times) };
  }
  return { kind: unknown ? 'unknown' : 'never' };
}

function resetCreditLines(data, now) {
  if (!data) return [];
  const available = data.expiries.filter(expiry => unexpired(expiry, now));
  const count = data.unresolvedCount + available.length;
  const expiry = nextExpiry(available, data.unresolvedCount > 0);
  const lines = [`${count} account reset ${count === 1 ? 'credit' : 'credits'} available`];
  if (expiry?.kind === 'never') {
    lines.push(`${count === 1 ? 'This credit does' : 'These credits do'} not expire`);
  } else if (expiry) {
    const prefix = expiry.kind === 'earliest-known'
      ? 'Earliest known credit expires' : 'Next credit expires';
    const at = expiry.kind === 'unknown' ? null : expiry.at;
    lines.push(expiryDescription(at, now, prefix));
  }
  return lines;
}

module.exports = { resetCredits, resetCreditLines };
