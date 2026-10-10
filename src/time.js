function resetDescription(resetsAt, now) {
  if (resetsAt === null) return 'Resets at an unknown time';
  const reset = new Date(resetsAt);
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
  const totalMinutes = Math.max(0, Math.ceil((resetsAt - now) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  const countdown = [
    days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`
  ].filter(Boolean).join(' ');
  return `${totalMinutes ? `Resets in ${countdown}` : 'Reset due'} · ${day} at ${time}`;
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

module.exports = { resetDescription, updateAge };
