// Markdown preview (marked + DOMPurify). Relative images load through the /__fs/ asset route.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { app } from './app.js';
import { call } from './native.js';
import { h } from './ui.js';
import { dirname, join } from './path.js';

marked.setOptions({ gfm: true, breaks: false });

function isExternal(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export const markdown = {
  render(container, text, path) {
    container.classList.add('md-preview');
    const html = DOMPurify.sanitize(marked.parse(text), { USE_PROFILES: { html: true } });
    const article = h('article', { class: 'markdown-body', html });
    const base = dirname(path);

    for (const img of article.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src');
      if (!isExternal(src) && !src.startsWith('//')) {
        const abs = src.startsWith('/') ? src : join(base, decodeURI(src));
        img.src = '/__fs' + encodeURI(abs);
      }
    }
    article.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        article.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth' });
      } else if (isExternal(href)) {
        if (/^https?:|^mailto:/i.test(href)) call('app.openUrl', { url: href });
      } else {
        const [file] = href.split('#');
        app.editor.openFile(file.startsWith('/') ? file : join(base, decodeURI(file)));
      }
    });
    // Heading ids so in-page anchors work.
    for (const hd of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      hd.id = hd.textContent.trim().toLowerCase().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
    }
    container.append(article);
  },
};
