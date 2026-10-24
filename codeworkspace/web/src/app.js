// Shared app singleton + tiny event bus. Modules register themselves on `app`
// (app.editor, app.workspace, ...) so they can reach each other at runtime
// without circular import problems.

export const app = {};

const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, data) {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch (e) {
        console.error(`listener for ${event} failed`, e);
      }
    }
  },
};
