import { getItem, setItem } from '../core/storage.js';

// 'light' | 'dark' | null (null = follow the device)
export function initTheme() {
  apply(getItem('theme', null));
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  setItem('theme', next);
  apply(next);
}

function apply(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
