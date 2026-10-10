function duration(minutes) {
  if (minutes === 10080) return 'Weekly';
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Window';
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function windows(result) {
  const buckets = result?.rateLimitsByLimitId;
  const entries = buckets && Object.keys(buckets).length
    ? Object.entries(buckets)
    : result?.rateLimits
      ? [[result.rateLimits.limitId || 'codex', result.rateLimits]]
      : [];

  return entries.flatMap(([id, bucket]) =>
    ['primary', 'secondary'].flatMap(key => {
      const window = bucket?.[key];
      if (!window || !Number.isFinite(window.usedPercent)) return [];
      const resetsAt = Number.isFinite(window.resetsAt) ? window.resetsAt * 1000 : NaN;
      return [{
        id: `${id}.${key}`,
        label: `${entries.length > 1 ? `${bucket.limitName || id} ` : ''}${duration(window.windowDurationMins)}`,
        remaining: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        resetsAt: Number.isFinite(new Date(resetsAt).getTime()) ? resetsAt : null
      }];
    })
  );
}

function gauge(remaining) {
  const percent = Math.round(Math.max(0, Math.min(100, remaining)));
  return `$(codex-usage-gauge-${percent})`;
}

module.exports = { windows, duration, gauge };
