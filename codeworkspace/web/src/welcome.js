// Welcome page shown when no editor tab is open.
import { app } from './app.js';
import { h } from './ui.js';
import { icon } from './icons.js';
import { basename, dirname } from './path.js';
import { recentProjects, removeRecentProject } from './settings.js';

function action(iconName, label, cmd) {
  return h('button', { class: 'welcome-action', onClick: () => app.commands.run(cmd) }, h('span', { html: icon(iconName) }), label);
}

const SHORTCUTS = [
  ['Quick Open', 'Ctrl+P'],
  ['Command Palette', 'Ctrl+Shift+P'],
  ['Find in Files', 'Ctrl+Shift+F'],
  ['Save', 'Ctrl+S'],
  ['Go to Line', 'Ctrl+G'],
  ['Go to Symbol', 'Ctrl+Shift+O'],
  ['Format Document', 'Shift+Alt+F'],
  ['Toggle Sidebar', 'Ctrl+B'],
  ['Toggle Terminal', 'Ctrl+`'],
];

export const welcome = {
  render() {
    const ws = app.workspace;
    const recent = recentProjects();
    const recentList = h('div', { class: 'welcome-recent' });
    for (const r of recent.slice(0, 8)) {
      const item = h(
        'div',
        { class: 'recent-row' },
        h('button', { class: 'link', onClick: () => ws.open(r.path) }, basename(r.path) || r.path),
        h('span', { class: 'muted small' }, dirname(r.path)),
        h('button', {
          class: 'icon-btn small',
          title: 'Remove from recent',
          html: icon('close'),
          onClick: () => {
            removeRecentProject(r.path);
            item.remove();
          },
        }),
      );
      recentList.append(item);
    }
    if (!recent.length) recentList.append(h('div', { class: 'muted' }, 'No recent folders'));

    const start = ws.root
      ? [action('search', 'Go to File…', 'quickOpen'), action('newFile', 'New File…', 'newFile'), action('git', 'Source Control', 'showScm'), action('terminal', 'New Terminal', 'newTerminal')]
      : [action('folderOpen', 'Open Folder…', 'openFolder'), action('download', 'Clone Repository…', 'gitClone')];

    return h(
      'div',
      { class: 'welcome' },
      h(
        'div',
        { class: 'welcome-hero' },
        h('div', { class: 'welcome-logo' }, '</>'),
        h('div', {}, h('h1', {}, 'Termux Studio Code'), h('div', { class: 'muted' }, ws.root ? `Working in ${ws.name}` : 'A focused code workspace for your tablet')),
      ),
      h(
        'div',
        { class: 'welcome-grid' },
        h('section', {}, h('h3', {}, 'Start'), ...start, ws.root ? null : null),
        h('section', {}, h('h3', {}, 'Recent'), recentList),
        h(
          'section',
          { class: 'welcome-keys' },
          h('h3', {}, 'Keyboard'),
          ...SHORTCUTS.map(([l, k]) => h('div', { class: 'key-row' }, h('span', {}, l), h('kbd', {}, k))),
        ),
      ),
      h('div', { class: 'welcome-footer muted' }, 'Termux Studio Code v0.2.1 · Developed by Roopesh'),
    );
  },
};
