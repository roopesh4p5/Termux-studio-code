// Optional Termux integration: open a session in the project folder or run a command there.
import { app } from './app.js';
import { call, fs } from './native.js';
import { toast, errorToast, quickPick, prompt, dialog, h } from './ui.js';
import { icon } from './icons.js';
import { join } from './path.js';

let retry = null;

window.__onPermission = (code) => {
  if (code === 2 && retry) {
    const fn = retry;
    retry = null;
    fn();
  }
};

async function run(cwd, command = '') {
  try {
    const res = await call('termux.run', { cwd, command });
    if (res === 'permission') {
      retry = () => run(cwd, command);
      toast('Allow Termux Studio Code to run commands in Termux, then it will continue.', { timeout: 6000 });
    } else if (res === 'fallback') {
      showSetupHelp(true);
    }
  } catch (e) {
    if (e.code === 'ENOTERMUX') {
      toast('Termux is not installed. Install it from F-Droid to run commands.', { type: 'warn', timeout: 6000 });
    } else {
      errorToast('Could not start Termux', e);
    }
  }
}

function showSetupHelp(fallback) {
  dialog({
    title: 'Termux setup',
    body: h(
      'div',
      { class: 'dialog-message' },
      fallback ? h('p', {}, 'Termux was opened, and a "cd" command for the project was copied to your clipboard.') : null,
      h('p', {}, 'To let Termux Studio Code open sessions directly in your project folder, run this once in Termux:'),
      h('pre', { class: 'code-block' }, "mkdir -p ~/.termux && echo 'allow-external-apps=true' >> ~/.termux/termux.properties && termux-reload-settings"),
      h('p', {}, 'Termux also needs storage access (run "termux-setup-storage").'),
    ),
    buttons: [{ label: 'Copy command', value: 'copy' }, { label: 'OK', value: true, primary: true }],
  }).then((v) => {
    if (v === 'copy') app.copy("mkdir -p ~/.termux && echo 'allow-external-apps=true' >> ~/.termux/termux.properties && termux-reload-settings");
  });
}

async function packageScripts(root) {
  try {
    const { text } = await fs.readText(join(root, 'package.json'));
    return Object.keys(JSON.parse(text).scripts ?? {});
  } catch {
    return [];
  }
}

export const termux = {
  open(dir = app.workspace.root) {
    if (!dir) return toast('Open a folder first', { type: 'warn' });
    return run(dir);
  },

  async runCommand(command) {
    const root = app.workspace.root;
    if (!root) return toast('Open a folder first', { type: 'warn' });
    if (command == null) {
      command = (await prompt('Run in Termux', { placeholder: 'e.g. npm test', message: `Runs in ${app.workspace.name}` }))?.trim();
      if (!command) return;
    }
    await app.editor.saveAll();
    return run(root, command);
  },

  /** Quick pick with "Open in Termux", npm scripts and a custom command. */
  async menu() {
    const root = app.workspace.root;
    const scripts = root ? await packageScripts(root) : [];
    quickPick({
      placeholder: 'Termux — open a session or run a command in the project',
      provider: () => [
        { label: 'Open project in Termux', icon: icon('terminal'), run: () => termux.open() },
        { label: 'Run command…', icon: icon('play'), run: () => termux.runCommand() },
        ...(scripts.length ? [{ separator: 'package.json scripts' }] : []),
        ...scripts.map((s) => ({ label: `npm run ${s}`, icon: icon('play'), run: () => termux.runCommand(`npm run ${s}`) })),
        { separator: 'Help' },
        { label: 'Termux setup instructions', icon: icon('info'), run: () => showSetupHelp(false) },
      ],
      onAccept: (it) => {
        setTimeout(it.run, 0);
      },
    });
  },
};
