export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '\u20660 B\u2069';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  // wrapped in LTR isolation marks so numbers read correctly inside Hebrew text
  return `\u2066${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}\u2069`;
}

export function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h} ש' ${m} ד'`;
  if (m) return `${m} ד' ${sec} שנ'`;
  return `${sec} שנ'`;
}

// Makes a safe Drive file name from a post caption (first line, no forbidden characters).
export function nameFromCaption(caption, maxLen = 90) {
  if (!caption) return '';
  const first = caption.split('\n').map((l) => l.trim()).find(Boolean) || '';
  return first.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export function percent(done, total) {
  if (!total) return 0;
  return Math.min(100, (done / total) * 100);
}
