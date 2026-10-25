// Search side panel: project-wide find / replace (search runs natively in Java).
import { app, bus } from './app.js';
import { call } from './native.js';
import { h, iconButton, confirm, toast, errorToast, esc } from './ui.js';
import { icon, fileBadge } from './icons.js';
import { basename, dirname, join } from './path.js';
import { excludeList } from './settings.js';

const opts = { caseSensitive: false, wholeWord: false, regex: false };
let els = {};
let timer = null;
let lastResult = null;
let showReplace = false;
let showFilters = false;
const collapsed = new Set();
// Result lines rendered at once; "Show all" lifts it (thousands of rows are slow to lay out).
const RENDER_LIMIT = 1000;
let showAll = false;

function toggle(label, title, key) {
  const b = h('button', {
    class: `toggle ${opts[key] ? 'on' : ''}`,
    title,
    'aria-pressed': String(opts[key]),
    onClick: () => {
      opts[key] = !opts[key];
      b.classList.toggle('on', opts[key]);
      b.setAttribute('aria-pressed', String(opts[key]));
      runSearch();
    },
  }, label);
  return b;
}

const inputAttrs = { class: 'input', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' };

export const searchView = {
  el: null,

  build() {
    els.query = h('input', { ...inputAttrs, placeholder: 'Search', enterkeyhint: 'search' });
    els.replace = h('input', { ...inputAttrs, placeholder: 'Replace' });
    els.include = h('input', { ...inputAttrs, placeholder: 'files to include  e.g. *.js, src/' });
    els.exclude = h('input', { ...inputAttrs, placeholder: 'files to exclude  e.g. dist/, *.min.js' });
    els.summary = h('div', { class: 'search-summary muted' });
    els.results = h('div', { class: 'search-results' });

    const expandBtn = h('button', {
      class: 'icon-btn replace-toggle',
      title: 'Toggle Replace',
      html: icon('chevronRight'),
      onClick: () => {
        showReplace = !showReplace;
        expandBtn.innerHTML = icon(showReplace ? 'chevronDown' : 'chevronRight');
        els.replaceRow.hidden = !showReplace;
        render();
      },
    });
    els.replaceRow = h(
      'div',
      { class: 'search-row', hidden: true },
      els.replace,
      iconButton('replace', 'Replace All', replaceAll),
    );
    els.filters = h('div', { class: 'search-filters', hidden: true }, els.include, els.exclude);

    this.el = h(
      'div',
      { class: 'panel search-panel' },
      h(
        'div',
        { class: 'panel-header' },
        h('span', { class: 'panel-title' }, 'SEARCH'),
        h(
          'div',
          { class: 'panel-actions' },
          iconButton('refresh', 'Refresh', runSearch),
          iconButton('more', 'Toggle file filters', () => {
            showFilters = !showFilters;
            els.filters.hidden = !showFilters;
          }),
          iconButton('collapse', 'Collapse All', () => {
            for (const f of lastResult?.files ?? []) collapsed.add(f.path);
            render();
          }),
        ),
      ),
      h(
        'div',
        { class: 'search-form' },
        h(
          'div',
          { class: 'search-main' },
          expandBtn,
          h(
            'div',
            { class: 'search-inputs' },
            h('div', { class: 'search-row' }, els.query, toggle('Aa', 'Match Case', 'caseSensitive'), toggle('ab', 'Match Whole Word', 'wholeWord'), toggle('.*', 'Use Regular Expression', 'regex')),
            els.replaceRow,
          ),
        ),
        els.filters,
      ),
      els.summary,
      els.results,
    );

    els.query.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 350);
    });
    els.query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        runSearch();
      }
    });
    for (const i of [els.include, els.exclude]) i.addEventListener('keydown', (e) => e.key === 'Enter' && runSearch());
    let replaceTimer = null;
    els.replace.addEventListener('input', () => {
      clearTimeout(replaceTimer);
      replaceTimer = setTimeout(render, 150);
    });
    bus.on('workspace', () => {
      lastResult = null;
      render();
    });
    return this.el;
  },

  /** Shows the search panel, optionally prefilled. */
  show({ query, include } = {}) {
    app.layout.showView('search');
    if (query != null) els.query.value = query;
    if (include != null) {
      els.include.value = include;
      showFilters = true;
      els.filters.hidden = false;
    }
    setTimeout(() => {
      els.query.focus();
      els.query.select();
    }, 50);
    if (els.query.value) runSearch();
  },
};

function request() {
  return {
    root: app.workspace.root,
    query: els.query.value,
    ...opts,
    include: els.include.value,
    excludeGlobs: els.exclude.value,
    exclude: excludeList(),
    max: 3000,
  };
}

async function runSearch() {
  const q = els.query.value;
  if (!app.workspace.root) {
    els.summary.textContent = 'Open a folder to search.';
    return;
  }
  if (!q) {
    lastResult = null;
    call('search.cancel');
    render();
    return;
  }
  els.summary.textContent = 'Searching…';
  const started = performance.now();
  try {
    const res = await call('search.text', request());
    if (els.query.value !== q) return;
    lastResult = res;
    lastResult.ms = Math.round(performance.now() - started);
    showAll = false;
    render();
  } catch (e) {
    if (e.code === 'ECANCELED') return;
    lastResult = null;
    els.results.innerHTML = '';
    els.summary.textContent = e.message;
  }
}

function render() {
  const res = lastResult;
  els.results.innerHTML = '';
  if (!res) {
    els.summary.textContent = '';
    return;
  }
  const n = res.files.length;
  els.summary.textContent = res.total
    ? `${res.total}${res.truncated ? '+' : ''} result${res.total === 1 ? '' : 's'} in ${n} file${n === 1 ? '' : 's'}`
    : 'No results found.';
  const replacing = showReplace && els.replace.value !== '' ? els.replace.value : null;
  const frag = document.createDocumentFragment();
  let budget = showAll ? Infinity : RENDER_LIMIT;
  let truncated = false;
  for (const f of res.files) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const isCollapsed = collapsed.has(f.path);
    const dir = dirname('/' + f.path).slice(1);
    frag.append(
      h(
        'div',
        {
          class: 'result-file',
          onClick: () => {
            if (isCollapsed) collapsed.delete(f.path);
            else collapsed.add(f.path);
            render();
          },
        },
        h('span', { class: 'chev', html: icon(isCollapsed ? 'chevronRight' : 'chevronDown') }),
        h('span', { class: 'row-icon', html: fileBadge(f.path) }),
        h('span', { class: 'row-name' }, basename(f.path)),
        h('span', { class: 'result-dir' }, dir),
        h('span', { class: 'count-badge' }, String(f.matches.length)),
      ),
    );
    if (isCollapsed) continue;
    for (const m of f.matches) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget--;
      const pre = m.preview.slice(0, m.previewCol).trimStart();
      const hit = m.preview.slice(m.previewCol, m.previewCol + m.len);
      const post = m.preview.slice(m.previewCol + m.len);
      const matchHtml = replacing != null
        ? `<del>${esc(hit)}</del><ins>${esc(replacing)}</ins>`
        : `<mark>${esc(hit)}</mark>`;
      frag.append(
        h('div', {
          class: 'result-line',
          title: `Line ${m.line + 1}`,
          html: `<span class="ln">${m.line + 1}</span><span class="txt">${m.leading ? '…' : ''}${esc(pre)}${matchHtml}${esc(post)}</span>`,
          onClick: async () => {
            await app.editor.openFile(join(app.workspace.root, f.path), { line: m.line + 1, col: m.col + 1, length: m.len, focus: false });
            app.layout.autoHideSidebar();
          },
        }),
      );
    }
  }
  if (truncated) {
    frag.append(
      h('div', { class: 'muted pad' },
        `Showing the first ${RENDER_LIMIT} results. `,
        h('button', { class: 'btn small', onClick: () => { showAll = true; render(); } }, 'Show all'),
      ),
    );
  }
  els.results.append(frag);
}

async function replaceAll() {
  const res = lastResult;
  if (!res?.total) return toast('Nothing to replace', { type: 'warn' });
  const root = app.workspace.root;
  const paths = res.files.map((f) => f.path);
  const dirty = app.editor.dirtyTabs().filter((t) => paths.some((p) => join(root, p) === t.path));
  if (dirty.length) {
    return toast(`Save ${dirty.map((t) => t.title).join(', ')} before replacing`, { type: 'warn', timeout: 6000 });
  }
  const ok = await confirm(
    'Replace All',
    `Replace ${res.total} occurrence${res.total === 1 ? '' : 's'} across ${paths.length} file${paths.length === 1 ? '' : 's'} with "${els.replace.value}"?`,
    { okLabel: 'Replace', danger: true },
  );
  if (!ok) return;
  try {
    const out = await call('search.replace', { ...request(), replacement: els.replace.value, paths });
    toast(`Replaced ${out.count} occurrence${out.count === 1 ? '' : 's'} in ${out.files.length} file${out.files.length === 1 ? '' : 's'}`);
    await app.editor.reloadPaths(out.files.map((p) => join(root, p)));
    app.workspace.refreshGit();
    runSearch();
  } catch (e) {
    errorToast('Replace failed', e);
  }
}
