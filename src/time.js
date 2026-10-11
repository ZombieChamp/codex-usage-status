function timestamp(seconds) {
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : NaN;
  return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : null;
}

function timeDescription(timestamp, now, future, due, unknown) {
  if (timestamp === null) return unknown;
  const reset = new Date(timestamp);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = reset.toDateString() === today.toDateString()
    ? 'Today'
    : reset.toDateString() === tomorrow.toDateString()
      ? 'Tomorrow'
      : reset.toLocaleDateString(undefined, {
        day: 'numeric', month: 'short',
        ...(reset.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
      });
  const time = reset.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const totalMinutes = Math.max(0, Math.ceil((timestamp - now) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  const countdown = [
    days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`
  ].filter(Boolean).join(' ');
  return `${totalMinutes ? `${future} in ${countdown}` : due} · ${day} at ${time}`;
}

function resetDescription(resetsAt, now) {
  return timeDescription(resetsAt, now, 'Resets', 'Reset due', 'Resets at an unknown time');
}

function expiryDescription(expiresAt, now, prefix = 'Expires') {
  return timeDescription(expiresAt, now, prefix, 'Expired', `${prefix} at an unknown time`);
}

function updateAge(updatedAt, now) {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60000));
  if (minutes === 0) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

module.exports = { timestamp, resetDescription, expiryDescription, updateAge };
