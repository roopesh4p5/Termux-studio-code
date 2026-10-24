// In-app folder browser for choosing a project folder or clone destination.
import { fs, sync } from './native.js';
import { h, openOverlay, prompt, errorToast } from './ui.js';
import { icon } from './icons.js';
import { basename, dirname, join } from './path.js';
import { recentProjects } from './settings.js';

let lastDir = null;

function storageRoot() {
  try {
    return sync('platform').externalRoot;
  } catch {
    return '/storage/emulated/0';
  }
}

export const folderPicker = {
  /** Resolves to the chosen absolute folder path, or null. */
  pick({ title = 'Open Folder', okLabel = 'Open', start } = {}) {
    return new Promise((resolve) => {
      const home = storageRoot();
      let dir = start ?? lastDir ?? home;
      let result = null;
      const pathEl = h('div', { class: 'fp-path' });
      const list = h('div', { class: 'fp-list' });
      const okBtn = h('button', { class: 'btn primary' }, okLabel);
      const shortcuts = h('div', { class: 'fp-shortcuts' });

      const places = [
        ['Internal storage', home],
        ['Download', join(home, 'Download')],
        ['Documents', join(home, 'Documents')],
      ];
      for (const [label, p] of places) {
        shortcuts.append(h('button', { class: 'chip', onClick: () => go(p) }, label));
      }

      const box = h(
        'div',
        { class: 'dialog folder-picker' },
        h('div', { class: 'dialog-title' }, title),
        shortcuts,
        pathEl,
        list,
        h(
          'div',
          { class: 'dialog-buttons' },
          h('button', {
            class: 'btn',
            onClick: async () => {
              const name = await prompt('New Folder', { placeholder: 'folder name' });
              if (!name) return;
              try {
                await fs.mkdir(join(dir, name), false);
                go(join(dir, name));
              } catch (e) {
                errorToast('Could not create folder', e);
              }
            },
          }, h('span', { html: icon('newFolder') }), 'New Folder'),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', onClick: () => close() }, 'Cancel'),
          okBtn,
        ),
      );
      const close = openOverlay(box, { onClose: () => resolve(result) });
      okBtn.addEventListener('click', () => {
        result = dir;
        lastDir = dir;
        close();
      });

      async function go(next) {
        let entries;
        try {
          entries = await fs.list(next);
        } catch (e) {
          errorToast(`Cannot open ${basename(next) || next}`, e);
          return;
        }
        dir = next;
        pathEl.innerHTML = '';
        // Clickable path segments.
        const parts = dir.split('/').filter(Boolean);
        parts.forEach((p, i) => {
          const full = '/' + parts.slice(0, i + 1).join('/');
          pathEl.append(h('button', { class: 'crumb', onClick: () => go(full) }, p));
          if (i < parts.length - 1) pathEl.append(h('span', { class: 'crumb-sep', html: icon('chevronRight') }));
        });
        pathEl.scrollLeft = pathEl.scrollWidth;
        list.innerHTML = '';
        if (dir !== '/') {
          list.append(h('div', { class: 'fp-row', onClick: () => go(dirname(dir)) }, h('span', { html: icon('back') }), '..'));
        }
        const dirs = entries.filter((e) => e.dir).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        const files = entries.filter((e) => !e.dir).length;
        const isRepo = entries.some((e) => e.dir && e.name === '.git');
        for (const e of dirs) {
          if (e.name === '.git') continue;
          list.append(
            h('div', { class: 'fp-row', onClick: () => go(join(dir, e.name)) }, h('span', { class: 'folder-icon', html: icon('folder') }), e.name),
          );
        }
        list.append(
          h('div', { class: 'fp-info muted small' }, `${dirs.length} folder${dirs.length === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}${isRepo ? ' · Git repository' : ''}`),
        );
        okBtn.textContent = `${okLabel} “${basename(dir) || '/'}”`;
      }

      go(dir).catch(() => go(home));
    });
  },

  recent: recentProjects,
};
