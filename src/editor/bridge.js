'use strict';
let noteSession = null,
  noteInfo = null,
  noteReadOnly = false,
  requestedAssets = new Set();
let statsTimer;
let rememberedReadingCaret = { blockIndex: -1, offset: 0 };
function markDuplicateTitle() {
  const first = page.querySelector(':scope > .block');
  const heading = first?.querySelector('.edit');
  const sameTitle =
    first?.classList.contains('t-h1') &&
    !first.contains(document.activeElement) &&
    heading?.textContent.trim().toLocaleLowerCase() ===
      titleEl.textContent.trim().toLocaleLowerCase();
  first?.classList.toggle('redundant-title', !!sameTitle);
}
function captureReadingPosition() {
  if (!noteSession) return;
  const edits = [...page.querySelectorAll('.edit')];
  const edit = document.activeElement.closest?.('.edit');
  if (edit) rememberedReadingCaret = { blockIndex: edits.indexOf(edit), offset: getCaret(edit) };
  const viewState = { scrollY, ...rememberedReadingCaret };
  parent.postMessage({ type: 'note:view-state', session: noteSession, viewState }, '*');
}
window.addEventListener('scroll', captureReadingPosition, { passive: true });
window.addEventListener('blur', captureReadingPosition);
document.addEventListener('selectionchange', captureReadingPosition);
function reportReadingStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => {
    if (!noteSession) return;
    markDuplicateTitle();
    const text = [...page.querySelectorAll('.edit')].map((edit) => edit.textContent).join(' ');
    const words = (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
    parent.postMessage({ type: 'note:stats', session: noteSession, words }, '*');
  }, 180);
}
SophyIcons.set(document.getElementById('openComments'), 'comment');
document.addEventListener('focusout', reportReadingStats);
SophyIcons.set(document.getElementById('more'), 'sliders');
document.querySelector('.page-options > summary').append(SophyIcons.icon('file'));
new MutationObserver(reportReadingStats).observe(page, {
  childList: true,
  subtree: true,
  characterData: true,
});
function inlineMarkdown(html) {
  const doc = new DOMParser().parseFromString('<body>' + html, 'text/html');
  const rawLiteral = (value) =>
    value.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/(^|\n)([#>+-]|\d+\.) /g, '$1\\$2 ');
  const literal = (value) => {
    const refs = NoteLinks.scan(value).filter((r) => r.format === 'wiki');
    let result = '',
      at = 0;
    for (const ref of refs) {
      result += rawLiteral(value.slice(at, ref.start)) + ref.raw;
      at = ref.end;
    }
    return result + rawLiteral(value.slice(at));
  };
  const walk = (node) =>
    [...node.childNodes]
      .map((c) => {
        if (c.nodeType === 3) return literal(c.textContent);
        const tag = c.tagName,
          value = walk(c);
        if (tag === 'IMG' && c.dataset.assetRef) {
          try {
            const target = decodeURIComponent(c.dataset.assetRef),
              alt = c.getAttribute('alt') || '',
              alias = alt && alt !== NoteLinks.basename(target) ? '|' + alt : '';
            return '![[' + target + alias + ']]';
          } catch {
            return '';
          }
        }
        if (tag === 'CODE') {
          const t = c.textContent,
            fence = '`'.repeat(Math.max(1, ...(t.match(/`+/g) || []).map((x) => x.length + 1)));
          return fence + (t.startsWith('`') ? ' ' : '') + t + (t.endsWith('`') ? ' ' : '') + fence;
        }
        if (tag === 'B' || tag === 'STRONG') return '**' + value + '**';
        if (tag === 'I' || tag === 'EM') return '*' + value + '*';
        if (tag === 'S' || tag === 'DEL') return '~~' + value + '~~';
        if (tag === 'A' && c.getAttribute('href')?.startsWith('notas1-wiki:')) {
          const original = decodeURIComponent(c.getAttribute('href').slice(12));
          return (
            '[[' +
            (c.textContent === NoteLinks.label(original)
              ? original
              : NoteLinks.parse(original).target + '|' + c.textContent) +
            ']]'
          );
        }
        if (tag === 'A')
          return '[' + value + '](' + c.getAttribute('href').replace(/\)/g, '%29') + ')';
        if (tag === 'BR') return '  \n';
        if (tag === 'U') return '<u>' + value + '</u>';
        if (tag === 'SPAN' && /^(tc|bg)-/.test(c.className))
          return '<span class="' + c.className + '">' + value + '</span>';
        return value;
      })
      .join('');
  return walk(doc.body);
}
window.noteChanged = () => {
  if (!noteSession || noteReadOnly) return;
  const active = curEdit();
  if (active) readEdit(active);
  const content = NoteMarkdown.encode(state, noteInfo, inlineMarkdown);
  parent.postMessage({ type: 'note:changed', session: noteSession, content }, '*');
};
window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data) return;
  const msg = event.data;
  if (msg.type === 'note:load') {
    try {
      noteSession = null;
      noteInfo = NoteMarkdown.decode(msg.content);
      requestedAssets = new Set();
      state = validate({ ...noteInfo.metadata, title: msg.title, blocks: noteInfo.blocks });
      noteSession = msg.session;
      rememberedReadingCaret = msg.viewState || { blockIndex: -1, offset: 0 };
      hist = [];
      redo = [];
      lastCaret = null;
      selected.clear();
      closeMenu();
      closeActs();
      closeLayout();
      xsel = null;
      titleEl.textContent = msg.title;
      document.getElementById('notePath').textContent = msg.location || '';
      titleEl.contentEditable = 'false';
      render();
      markDuplicateTitle();
      const restoreSession = noteSession;
      if (msg.viewState)
        document.fonts.ready.then(() =>
          requestAnimationFrame(() => {
            if (noteSession !== restoreSession) return;
            const view = msg.viewState;
            const edit = page.querySelectorAll('.edit')[view.blockIndex];
            if (edit && view.offset >= 0)
              setCaret(edit, Math.min(view.offset, edit.textContent.length));
            scrollTo(0, Math.max(0, Number(view.scrollY) || 0));
          }),
        );
      reportReadingStats();
      requestEmbeddedAssets();
      document.title = msg.title;
      noteReadOnly = false;
      dirty = false;
      $('#status').textContent = 'Salvo no arquivo .md';
      window.noteContext = { notes: msg.notes || [], assets: msg.assets || [], path: msg.path };
      document.dispatchEvent(new CustomEvent('note-context', { detail: window.noteContext }));
      parent.postMessage({ type: 'note:loaded', session: noteSession }, '*');
    } catch (error) {
      parent.postMessage(
        {
          type: 'note:error',
          session: msg.session,
          message:
            'Não foi possível interpretar esta nota no editor visual. O Markdown original foi preservado.',
        },
        '*',
      );
    }
  } else if (msg.type === 'note:resume' && msg.session === noteSession) {
    requestedAssets.clear();
    requestEmbeddedAssets();
    window.noteContext = {
      ...window.noteContext,
      notes: msg.notes || [],
      assets: msg.assets || [],
    };
    document.dispatchEvent(new CustomEvent('note-context', { detail: window.noteContext }));
    const view = msg.viewState;
    if (view)
      requestAnimationFrame(() => {
        const edit = page.querySelectorAll('.edit')[view.blockIndex];
        if (edit) setCaret(edit, Math.min(view.offset, edit.textContent.length));
        scrollTo(0, Math.max(0, Number(view.scrollY) || 0));
      });
    reportReadingStats();
  } else if (msg.type === 'note:reading') {
    SophyAppearance.applyReading(msg.preferences);
  } else if (msg.type === 'note:focus' && msg.session === noteSession) {
    document.body.classList.toggle('writing-focus', !!msg.enabled);
  } else if (msg.type === 'note:theme') {
    if (msg.theme === 'dark' || msg.theme === 'light')
      document.documentElement.dataset.theme = msg.theme;
    if (/^#[\da-f]{6}$/i.test(msg.accent || '')) {
      const accent = msg.accent.toUpperCase();
      const panel = msg.theme === 'dark' ? '#252A33' : '#FFFFFF';
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty(
        '--on-accent',
        SophyAppearance.contrastInk(accent),
      );
      document.documentElement.style.setProperty(
        '--sel',
        `color-mix(in srgb, ${accent} 16%, ${panel})`,
      );
      document.documentElement.style.setProperty(
        '--hover',
        `color-mix(in srgb, ${accent} 9%, ${panel})`,
      );
    }
  } else if (msg.type === 'note:icons' && Array.isArray(msg.icons)) {
    window.sophyCustomIcons = msg.icons
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.src === 'string' &&
          /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(item.src),
      )
      .slice(0, 18);
    if (typeof window.renderPageMeta === 'function') window.renderPageMeta();
  } else if (msg.type === 'note:asset' && msg.session === noteSession) {
    const encoded = encodeURIComponent(msg.target);
    document.querySelectorAll('img[data-asset-ref]').forEach((image) => {
      if (image.dataset.assetRef === encoded && typeof msg.data === 'string') image.src = msg.data;
    });
  } else if (msg.type === 'note:insert-attachments' && msg.session === noteSession) {
    if (!window.insertAttachments?.(msg.items))
      parent.postMessage({ type: 'note:attachment-insert-failed', session: noteSession }, '*');
    else {
      requestEmbeddedAssets();
      parent.postMessage({ type: 'note:attachments-inserted', session: noteSession }, '*');
    }
  } else if (msg.session === noteSession && msg.type === 'note:status') {
    $('#status').textContent = msg.text;
    dirty = !!msg.dirty;
  } else if (msg.session === noteSession && msg.type === 'note:flush') {
    if (curEdit()) readEdit(curEdit());
  }
});
function requestEmbeddedAssets() {
  if (!noteSession) return;
  document.querySelectorAll('img[data-asset-ref]').forEach((image) => {
    if (image.src.startsWith('data:')) return;
    let target;
    try {
      target = decodeURIComponent(image.dataset.assetRef || '');
    } catch {
      return;
    }
    if (!target || requestedAssets.has(target)) return;
    requestedAssets.add(target);
    parent.postMessage({ type: 'note:asset-request', session: noteSession, target }, '*');
  });
}
document.addEventListener(
  'click',
  (e) => {
    const a = e.target.closest('a');
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute('href') || '';
      if (href.startsWith('notas1-wiki:')) {
        try {
          parent.postMessage(
            {
              type: 'note:link',
              session: noteSession,
              target: decodeURIComponent(href.slice(12)),
              format: 'wiki',
            },
            '*',
          );
        } catch {}
      } else if (!/^[a-z][a-z\d+.-]*:/i.test(href))
        parent.postMessage(
          { type: 'note:link', session: noteSession, target: href, format: 'markdown' },
          '*',
        );
    }
  },
  true,
);
if (document.readyState === 'loading')
  document.addEventListener(
    'DOMContentLoaded',
    () => parent.postMessage({ type: 'note:ready' }, '*'),
    { once: true },
  );
else parent.postMessage({ type: 'note:ready' }, '*');

document.addEventListener(
  'keydown',
  (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      parent.postMessage({ type: 'note:focus-request', session: noteSession }, '*');
      return;
    }
    if (
      e.key === 'Escape' &&
      document.body.classList.contains('writing-focus') &&
      !document.querySelector('dialog[open]') &&
      !document.querySelector('.pop[style*="display: block"]')
    ) {
      parent.postMessage({ type: 'note:focus-request', session: noteSession, exit: true }, '*');
    }
    if ((e.ctrlKey || e.metaKey) && (key === 'k' || key === 'p' || (key === 'f' && e.shiftKey))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      parent.postMessage(
        {
          type: 'note:palette',
          session: noteSession,
          mode: key === 'k' ? 'commands' : key === 'p' ? 'notes' : 'search',
        },
        '*',
      );
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      parent.postMessage({ type: 'note:save', session: noteSession }, '*');
    }
  },
  true,
);
