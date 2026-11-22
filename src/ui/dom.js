// Tiny helper to build elements: h('div', { class: 'card' }, 'text', child)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function progressBar(pct, extraClass = '') {
  const bar = h('div', { class: `bar ${extraClass}` }, h('div', { class: 'bar-fill' }));
  setBar(bar, pct);
  return bar;
}

export function setBar(bar, pct) {
  bar.firstChild.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
}

export function errorBox(text) {
  return h('div', { class: 'alert alert-error' }, text);
}

export function busy(button, isBusy, label) {
  button.disabled = isBusy;
  if (label) button.textContent = label;
}

// Shows a file name as "name" + a small extension badge, which reads cleanly in Hebrew.
export function fileName(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0 || name.length - i > 6) return h('bdi', {}, name);
  return h('span', { class: 'fname' }, h('bdi', {}, name.slice(0, i)), ' ', h('span', { class: 'ext' }, name.slice(i + 1).toUpperCase()));
}
