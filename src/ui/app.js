// Simple screen switcher. Each screen is a function (ctx) => HTMLElement.
const root = () => document.getElementById('app');
let cleanup = null;

export const ctx = {
  settings: null,
  channel: null, // { entity, id, title }
  scan: null, // { items, lastId }
  transfer: null,
};

export function show(screen, ...args) {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const el = root();
  el.replaceChildren();
  const node = screen(ctx, ...args);
  el.append(node);
  if (node.cleanup) cleanup = node.cleanup;
  window.scrollTo(0, 0);
}
