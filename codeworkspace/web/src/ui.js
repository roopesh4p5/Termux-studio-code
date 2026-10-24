// DOM helpers and shared UI primitives: overlays, dialogs, toasts, context menus, quick pick.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Renders text with the characters at `indices` wrapped in <b>. */
export function highlightIndices(text, indices) {
  if (!indices?.length) return esc(text);
  const set = new Set(indices);
  let out = '';
  for (let i = 0; i < text.length; i++) out += set.has(i) ? `<b>${esc(text[i])}</b>` : esc(text[i]);
  return out;
}

export function iconButton(name, title, onClick, cls = '') {
  return h('button', {
    class: `icon-btn ${cls}`,
    title,
    'aria-label': title,
    html: icon(name),
    onClick: (e) => {
      e.stopPropagation();
      onClick(e);
    },
  });
}

// ------------------------------------------------------------------ overlays

const overlays = [];

/** Shows `el` on top of everything; returns a close() function. Back button closes the topmost. */
export function openOverlay(el, { onClose, backdrop = true, cls = '' } = {}) {
  const layer = h('div', { class: `overlay ${backdrop ? 'with-backdrop' : ''} ${cls}` }, el);
  const entry = {
    layer,
    close: () => {
      const i = overlays.indexOf(entry);
      if (i < 0) return;
      overlays.splice(i, 1);
      layer.remove();
      onClose?.();
    },
  };
  layer.addEventListener('pointerdown', (e) => {
    if (e.target === layer) {
      e.preventDefault();
      entry.close();
    }
  });
  overlays.push(entry);
  document.body.append(layer);
  return entry.close;
}

export function closeTopOverlay() {
  const top = overlays[overlays.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function hasOverlay() {
  return overlays.length > 0;
}

// ------------------------------------------------------------------- dialogs

/**
 * Generic modal dialog. buttons: [{label, value, primary, danger}].
 * Resolves to the clicked button's value, or null when dismissed.
 */
export function dialog({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], cls = '', onOpen }) {
  return new Promise((resolve) => {
    let result = null;
    const footer = h('div', { class: 'dialog-buttons' });
    const box = h(
      'div',
      { class: `dialog ${cls}`, role: 'dialog' },
      title ? h('div', { class: 'dialog-title' }, title) : null,
      h('div', { class: 'dialog-body' }, body ?? ''),
      footer,
    );
    const close = openOverlay(box, { onClose: () => resolve(result) });
    for (const b of buttons) {
      footer.append(
        h(
          'button',
          {
            class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`,
            onClick: async () => {
              if (b.validate && !(await b.validate())) return;
              result = typeof b.value === 'function' ? b.value() : b.value;
              close();
            },
          },
          b.label,
        ),
      );
    }
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        footer.querySelector('.primary')?.click();
      }
    });
    onOpen?.(box, close);
  });
}

export async function prompt(title, { value = '', placeholder = '', okLabel = 'OK', select, message, type = 'text' } = {}) {
  const input = h('input', { class: 'input', type, value, placeholder, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  const body = h('div', {}, message ? h('div', { class: 'dialog-message' }, message) : null, input);
  return dialog({
    title,
    body,
    buttons: [
      { label: 'Cancel', value: null },
      { label: okLabel, value: () => input.value, primary: true },
    ],
    onOpen: () =>
      setTimeout(() => {
        input.focus();
        if (select) input.setSelectionRange(select[0], select[1]);
        else input.select();
      }, 50),
  });
}

export async function confirm(title, message, { okLabel = 'OK', danger = false } = {}) {
  const r = await dialog({
    title,
    body: h('div', { class: 'dialog-message' }, message),
    buttons: [
      { label: 'Cancel', value: false },
      { label: okLabel, value: true, primary: !danger, danger },
    ],
  });
  return r === true;
}

export function choose(title, message, buttons) {
  return dialog({ title, body: h('div', { class: 'dialog-message' }, message), buttons });
}

// -------------------------------------------------------------------- toasts

let toastHost;
export function toast(message, { type = 'info', timeout = 3500, action } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast ${type}` }, h('span', { class: 'toast-msg' }, message));
  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (action) {
    el.append(h('button', { class: 'btn small', onClick: () => { dismiss(); action.run(); } }, action.label));
  }
  el.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') dismiss();
  });
  toastHost.append(el);
  if (timeout) setTimeout(dismiss, timeout);
  return { dismiss, update: (msg) => (el.querySelector('.toast-msg').textContent = msg) };
}

export function errorToast(prefix, err) {
  console.error(prefix, err);
  return toast(`${prefix}: ${err?.message ?? err}`, { type: 'error', timeout: 6000 });
}

// -------------------------------------------------------------- context menu

/** items: [{label, icon, run, danger, disabled, shortcut} | '-'] */
export function contextMenu(x, y, items) {
  const menu = h('div', { class: 'menu', role: 'menu' });
  let close;
  for (const it of items) {
    if (it === '-') {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (!it) continue;
    menu.append(
      h(
        'button',
        {
          class: `menu-item ${it.danger ? 'danger' : ''}`,
          disabled: it.disabled,
          onClick: () => {
            close();
            it.run();
          },
        },
        h('span', { class: 'menu-icon', html: it.icon ? icon(it.icon) : '' }),
        h('span', { class: 'menu-label' }, it.label),
        it.shortcut ? h('span', { class: 'menu-shortcut' }, it.shortcut) : null,
      ),
    );
  }
  close = openOverlay(menu, { backdrop: false, cls: 'menu-layer' });
  // Keep the menu on screen.
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  menu.style.left = Math.max(4, Math.min(x, vw - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, vh - r.height - 4)) + 'px';
  return close;
}

/** Context menu anchored below an element. */
export function menuAt(el, items) {
  const r = el.getBoundingClientRect();
  return contextMenu(r.left, r.bottom + 2, items);
}

// ---------------------------------------------------------------- quick pick

/**
 * VS Code-style quick pick.
 * provider(query) -> items | Promise<items>; item: {label, description, detail, icon, highlights, ...}
 * onAccept(item, query) is called when an item is chosen; return false to keep the picker open.
 */
export function quickPick({ placeholder = '', value = '', provider, onAccept, onQueryChange, emptyText = 'No results' }) {
  const input = h('input', { class: 'input qp-input', placeholder, value, autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'qp-list', role: 'listbox' });
  const box = h('div', { class: 'quick-pick' }, input, list);
  let items = [];
  let active = 0;
  let token = 0;
  const close = openOverlay(box, { cls: 'qp-layer' });

  function renderList() {
    list.innerHTML = '';
    if (!items.length) {
      list.append(h('div', { class: 'qp-empty' }, emptyText));
      return;
    }
    items.forEach((it, i) => {
      if (it.separator) {
        list.append(h('div', { class: 'qp-sep' }, it.separator));
        return;
      }
      const row = h(
        'div',
        { class: `qp-item ${i === active ? 'active' : ''}`, role: 'option', onClick: () => accept(i) },
        it.icon ? h('span', { class: 'qp-icon', html: it.icon }) : null,
        h(
          'div',
          { class: 'qp-text' },
          h('span', { class: 'qp-label', html: highlightIndices(it.label, it.highlights) }),
          it.description ? h('span', { class: 'qp-desc' }, it.description) : null,
          it.detail ? h('div', { class: 'qp-detail' }, it.detail) : null,
        ),
        it.shortcut ? h('span', { class: 'qp-shortcut' }, it.shortcut) : null,
      );
      list.append(row);
    });
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  async function update() {
    const my = ++token;
    onQueryChange?.(input.value);
    const res = await provider(input.value);
    if (my !== token) return;
    items = res ?? [];
    active = items.findIndex((it) => !it.separator);
    if (active < 0) active = 0;
    renderList();
  }

  async function accept(i) {
    const it = items[i];
    if (!it || it.separator) return;
    const keep = await onAccept(it, input.value, { setValue });
    if (keep !== false) close();
  }

  function setValue(v) {
    input.value = v;
    update();
    input.focus();
  }

  function move(d) {
    if (!items.length) return;
    let i = active;
    do i = (i + d + items.length) % items.length;
    while (items[i].separator && i !== active);
    active = i;
    renderList();
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); accept(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  setTimeout(() => input.focus(), 30);
  update();
  return { close, setValue, refresh: update };
}

// ---------------------------------------------------------------- fuzzy match

/** Subsequence fuzzy match. Returns {score, indices} or null. */
export function fuzzy(query, text) {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -2;
  const indices = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    indices.push(i);
    score += i === last + 1 ? 6 : 1;
    if (i === 0 || '/\\._- '.includes(text[i - 1])) score += 4;
    else if (text[i] !== t[i] && text[i - 1] === t[i - 1]) score += 3; // camelCase hump
    last = i;
    qi++;
  }
  if (qi < q.length) return null;
  score -= text.length * 0.02;
  return { score, indices };
}

// -------------------------------------------------------------- long press

/** Adds contextmenu (right click / long press) handling to an element. */
export function onContext(el, handler) {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handler(e.clientX, e.clientY, e);
  });
}
