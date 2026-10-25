// Unified diff viewer with old/new line numbers and intra-line change highlighting.
import { app } from './app.js';
import { h, esc } from './ui.js';
import { icon } from './icons.js';

const MAX_LINES = 6000;
let fullFile = false;
// The diff library loads with the first diff, not at app startup.
let diffLib = null;
let renderSeq = 0;

function inlineDiff(oldLine, newLine, { diffWordsWithSpace }) {
  // Skip intra-line highlighting for very different or very long lines.
  if (oldLine.length + newLine.length > 2000) return [esc(oldLine), esc(newLine)];
  const parts = diffWordsWithSpace(oldLine, newLine);
  let a = '';
  let b = '';
  let same = 0;
  for (const p of parts) {
    const t = esc(p.value);
    if (p.added) b += `<span class="ch">${t}</span>`;
    else if (p.removed) a += `<span class="ch">${t}</span>`;
    else {
      a += t;
      b += t;
      same += p.value.length;
    }
  }
  if (same < Math.min(oldLine.length, newLine.length) * 0.3) return [esc(oldLine), esc(newLine)];
  return [a, b];
}

function row(cls, oldNo, newNo, sign, html, onClick) {
  return h(
    'div',
    { class: `dl ${cls}`, onClick },
    h('span', { class: 'dn' }, oldNo ?? ''),
    h('span', { class: 'dn' }, newNo ?? ''),
    h('span', { class: 'ds' }, sign),
    h('span', { class: 'dt', html: html || ' ' }),
  );
}

export const diffView = {
  async render(container, tab) {
    container.classList.add('diff-view');
    const seq = ++renderSeq;
    diffLib ??= import('diff');
    const lib = await diffLib;
    // The editor may have shown something else in the container meanwhile.
    if (seq !== renderSeq || !container.classList.contains('diff-view')) return;
    const d = tab.diff ?? {};
    const toolbar = h(
      'div',
      { class: 'diff-toolbar' },
      h('span', { class: 'diff-title' }, tab.diffLabel ?? ''),
      h('span', { class: 'diff-stats' }),
      h('button', {
        class: `btn small ${fullFile ? 'on' : ''}`,
        onClick: () => {
          fullFile = !fullFile;
          container.innerHTML = '';
          diffView.render(container, tab);
        },
      }, fullFile ? 'Changes only' : 'Full file'),
      tab.path && d.status !== 'D'
        ? h('button', { class: 'btn small', onClick: () => app.editor.openFile(tab.path) }, h('span', { html: icon('files') }), 'Open File')
        : null,
    );
    container.append(toolbar);
    if (d.loading) return container.append(h('div', { class: 'muted pad' }, 'Loading diff…'));
    if (d.error) return container.append(h('div', { class: 'error-text pad' }, d.error));
    if (d.binary) return container.append(h('div', { class: 'muted pad' }, 'Binary file — no text diff available.'));

    const patch = lib.structuredPatch('a', 'b', d.oldText, d.newText, '', '', { context: fullFile ? 1e7 : 3 });
    const body = h('div', { class: 'diff-body' });
    let added = 0;
    let removed = 0;
    let shown = 0;
    const open = (line) => () => tab.path && d.status !== 'D' && app.editor.openFile(tab.path, { line });

    for (const hunk of patch.hunks) {
      if (shown > MAX_LINES) break;
      if (!fullFile) {
        body.append(row('hunk', null, null, '', esc(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)));
      }
      let o = hunk.oldStart;
      let n = hunk.newStart;
      const lines = hunk.lines.filter((l) => !l.startsWith('\\'));
      for (let i = 0; i < lines.length && shown <= MAX_LINES; ) {
        const l = lines[i];
        if (l[0] === ' ') {
          body.append(row('ctx', o, n, '', esc(l.slice(1)), open(n)));
          o++, n++, i++, shown++;
          continue;
        }
        // Collect a block of removals followed by additions and pair them for inline diff.
        const rem = [];
        const add = [];
        while (i < lines.length && lines[i][0] === '-') rem.push(lines[i++].slice(1));
        while (i < lines.length && lines[i][0] === '+') add.push(lines[i++].slice(1));
        removed += rem.length;
        added += add.length;
        const paired = rem.length === add.length && rem.length <= 50;
        const remHtml = [];
        const addHtml = [];
        for (let k = 0; k < rem.length; k++) {
          if (!paired) {
            remHtml.push(esc(rem[k]));
            continue;
          }
          const [a, b] = inlineDiff(rem[k], add[k], lib);
          remHtml.push(a);
          addHtml.push(b);
        }
        if (!paired) for (let k = 0; k < add.length; k++) addHtml.push(esc(add[k]));
        for (const html of remHtml) body.append(row('del', o++, null, '−', html)), shown++;
        for (const html of addHtml) {
          const line = n++;
          body.append(row('add', null, line, '+', html, open(line)));
          shown++;
        }
      }
    }
    if (!patch.hunks.length) body.append(h('div', { class: 'muted pad' }, d.oldText === d.newText ? 'No changes.' : 'Only whitespace/line-ending changes.'));
    if (shown > MAX_LINES) body.append(h('div', { class: 'muted pad' }, 'Diff truncated — too many lines.'));
    toolbar.querySelector('.diff-stats').innerHTML = `<span class="plus">+${added}</span> <span class="minus">−${removed}</span>`;
    container.append(body);
  },
};
