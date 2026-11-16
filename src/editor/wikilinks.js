'use strict';
let linkCatalog = window.noteContext?.notes || [],
  linkNotePath = window.noteContext?.path || '',
  linkAssets = window.noteContext?.assets || [],
  linkMenu = null;
const picker = document.createElement('div');
picker.id = 'wikiPicker';
picker.className = 'wiki-picker';
picker.setAttribute('role', 'listbox');
picker.setAttribute('aria-label', 'Vincular nota');
picker.hidden = true;
document.body.append(picker);
function closeWiki() {
  linkMenu = null;
  picker.hidden = true;
}
function currentWiki() {
  const el = curEdit();
  if (!el) return null;
  const b = find(el.dataset.id)?.b;
  if (!b || b.type === 'code') return null;
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  const before = range.toString(),
    match = before.match(/(?<!\\)(!)?\[\[([^\[\]\n]*)$/);
  return match
    ? {
        el,
        embed: !!match[1],
        query: match[2],
        start: before.length - match[0].length,
        end: before.length,
      }
    : null;
}
function wikiOptions(query, embed = false) {
  const spec = NoteLinks.parse(query);
  if (embed) {
    const q = query.toLocaleLowerCase();
    return linkAssets
      .filter((asset) => asset.image && asset.path.toLocaleLowerCase().includes(q))
      .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }))
      .slice(0, 8)
      .map((asset) => ({
        label: asset.title,
        detail: 'Imagem · ' + asset.path,
        target: asset.path,
        asset: true,
      }));
  }
  if (query.includes('|')) return [];
  if (query.includes('#')) {
    const target = NoteLinks.resolve(
      spec.note,
      linkNotePath,
      linkCatalog.map((n) => n.path),
    );
    const note = linkCatalog.find((n) => n.path === (spec.note ? target.path : linkNotePath));
    const localHeadings = spec.note
      ? note?.headings
      : flat(state.blocks, [], true)
          .filter((b) => /^h[1-6]$/.test(b.type))
          .map((b) => ({ text: textOf(b.html) }));
    return (localHeadings || [])
      .filter((h) => h.text.toLocaleLowerCase().includes(spec.anchor.toLocaleLowerCase()))
      .slice(0, 8)
      .map((h) => ({
        label: h.text,
        detail: spec.note || 'Nesta nota',
        target: spec.note + '#' + h.text,
      }));
  }
  const q = query.trim().toLocaleLowerCase();
  const list = linkCatalog
    .filter((n) => n.path.toLocaleLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(b.title.toLocaleLowerCase().startsWith(q)) -
          Number(a.title.toLocaleLowerCase().startsWith(q)) || a.path.localeCompare(b.path),
    )
    .slice(0, 8)
    .map((n) => ({ label: n.title, detail: n.path, target: n.path.replace(/\.md$/i, '') }));
  const assets = linkAssets
    .filter((asset) => asset.path.toLocaleLowerCase().includes(q))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }))
    .map((asset) => ({
      label: asset.title,
      detail: 'Anexo · ' + asset.path,
      target: asset.path,
      asset: true,
    }));
  list.push(...assets.slice(0, Math.max(0, 8 - list.length)));
  const isUncreatedAttachment = /\.[^/]+$/.test(query) && !/\.md$/i.test(query);
  if (
    q &&
    !isUncreatedAttachment &&
    NoteLinks.createPath(query, linkNotePath) &&
    !linkCatalog.some(
      (n) =>
        n.path.toLocaleLowerCase() === (query.replace(/\.md$/i, '') + '.md').toLocaleLowerCase(),
    )
  )
    list.push({
      label: 'Criar “' + query + '”',
      detail: 'Ao abrir o link, você confirma a criação.',
      target: query,
      create: true,
    });
  return list;
}
function showWiki() {
  const context = currentWiki();
  if (!context) {
    closeWiki();
    return;
  }
  const options = wikiOptions(context.query, context.embed);
  if (!options.length) {
    closeWiki();
    return;
  }
  linkMenu = {
    ...context,
    options,
    index: linkMenu?.query === context.query ? Math.min(linkMenu.index, options.length - 1) : 0,
  };
  drawWiki();
}
function drawWiki() {
  picker.replaceChildren();
  const title = document.createElement('div');
  title.className = 'wiki-picker-heading';
  title.textContent = linkMenu.embed
    ? 'INSERIR IMAGEM'
    : /\.[^/]+$/.test(linkMenu.query) && !/\.md$/i.test(linkMenu.query)
      ? 'LINKS E ANEXOS'
      : linkMenu.query.includes('#')
        ? 'IR PARA SEÇÃO'
        : 'VINCULAR NOTA';
  picker.append(title);
  linkMenu.options.forEach((option, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', i === linkMenu.index);
    const label = document.createElement('strong'),
      detail = document.createElement('small');
    label.textContent = option.label;
    detail.textContent = option.detail;
    button.append(label, detail);
    button.onclick = () => chooseWiki(i);
    picker.append(button);
  });
  picker.hidden = false;
  const range = getSelection().getRangeAt(0),
    rect = range.getBoundingClientRect(),
    fallback = linkMenu.el.getBoundingClientRect();
  picker.style.left =
    Math.max(8, Math.min((rect.width || rect.height ? rect : fallback).left, innerWidth - 310)) +
    'px';
  const top = (rect.height ? rect.bottom : fallback.bottom) + 8;
  picker.style.top = Math.max(8, Math.min(top, innerHeight - picker.offsetHeight - 8)) + 'px';
}
function chooseWiki(index) {
  if (!linkMenu) return;
  const menu = linkMenu,
    option = menu.options[index];
  const el = menu.el;
  const text = el.textContent;
  const end = menu.end + (text.slice(menu.end).startsWith(']]') ? 2 : 0);
  const [a, ao] = pointAt(el, menu.start),
    [b, bo] = pointAt(el, end);
  el.focus();
  getSelection().setBaseAndExtent(a, ao, b, bo);
  closeWiki();
  if (menu.embed) {
    const encoded = encodeURIComponent(option.target),
      alt = NoteLinks.esc(option.label);
    document.execCommand(
      'insertHTML',
      false,
      `<img class="embedded-attachment" src="sophy-asset:${encoded}" data-asset-ref="${encoded}" alt="${alt}"><span>​</span>`,
    );
  } else document.execCommand('insertHTML', false, NoteLinks.anchor(option.target) + '&#8203;');
  readEdit(el);
  save();
  requestEmbeddedAssets();
}
function completeWiki(el) {
  if (!el || find(el.dataset.id)?.b.type === 'code') return;
  const caret = getCaret(el);
  let offset = 0,
    newCaret = caret,
    changed = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  let preservedCaret = false;
  for (const textNode of nodes) {
    const length = textNode.length;
    if (textNode.parentElement.closest('a,code')) {
      offset += length;
      continue;
    }
    const refs = NoteLinks.scan(textNode.data).filter(
      (r) => ['wiki', 'embed'].includes(r.format) && offset + r.end <= caret,
    );
    if (!refs.length) {
      offset += length;
      continue;
    }
    const fragment = document.createDocumentFragment();
    let at = 0;
    let caretMarker = null;
    for (const ref of refs) {
      fragment.append(document.createTextNode(textNode.data.slice(at, ref.start)));
      const target = ref.target + (ref.alias !== null ? '|' + ref.alias : '');
      if (ref.format === 'embed' && /\.(png|jpe?g|webp|gif)$/i.test(ref.note)) {
        const encoded = encodeURIComponent(ref.note),
          image = document.createElement('img'),
          marker = document.createTextNode('\u200b');
        image.className = 'embedded-attachment';
        image.src = 'sophy-asset:' + encoded;
        image.dataset.assetRef = encoded;
        image.alt = ref.alias ?? NoteLinks.basename(ref.note);
        fragment.append(image, marker);
        if (offset + ref.end === caret) caretMarker = marker;
        newCaret -= ref.raw.length;
      } else {
        const template = document.createElement('template');
        template.innerHTML = NoteLinks.anchor(target);
        fragment.append(template.content);
        newCaret -= ref.raw.length - NoteLinks.label(target).length;
      }
      at = ref.end;
    }
    fragment.append(document.createTextNode(textNode.data.slice(at)));
    textNode.replaceWith(fragment);
    changed = true;
    offset += length;
    if (caretMarker) {
      const selection = getSelection(),
        range = document.createRange();
      range.setStart(caretMarker, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      preservedCaret = true;
    }
  }
  if (changed) {
    if (!preservedCaret) setCaret(el, newCaret);
    readEdit(el);
    save();
    requestEmbeddedAssets();
  }
}
page.addEventListener('input', (event) => {
  if (event.isComposing) return;
  const el = event.target.closest('.edit');
  if (!el) return;
  completeWiki(el);
  showWiki();
});
document.addEventListener(
  'keydown',
  (event) => {
    if (!linkMenu) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWiki();
      return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      linkMenu.index =
        (linkMenu.index + (event.key === 'ArrowDown' ? 1 : -1) + linkMenu.options.length) %
        linkMenu.options.length;
      drawWiki();
    } else if (['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      chooseWiki(linkMenu.index);
    }
  },
  true,
);
picker.addEventListener('mousedown', (event) => event.preventDefault());
document.addEventListener('mousedown', (event) => {
  if (!picker.contains(event.target)) closeWiki();
});
addEventListener('scroll', closeWiki, { passive: true });
document.addEventListener('note-context', (event) => {
  linkCatalog = event.detail.notes || [];
  linkAssets = event.detail.assets || [];
  linkNotePath = event.detail.path;
  closeWiki();
});
function jumpToAnchor(anchor) {
  if (!anchor) return true;
  let requested;
  try {
    requested = decodeURIComponent(anchor);
  } catch {
    requested = anchor;
  }
  const norm = (value) => value.normalize('NFC').trim().toLocaleLowerCase();
  const slug = (value) =>
    norm(value)
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
  const heading = requested.split('#').at(-1);
  const block = flat(state.blocks, [], true).find((b) =>
    requested.startsWith('^')
      ? new RegExp(
          '(?:^|\\s)\\^' + requested.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$',
        ).test(textOf(b.html))
      : /^h[1-6]$/.test(b.type) &&
        (norm(textOf(b.html)) === norm(heading) || slug(textOf(b.html)) === norm(heading)),
  );
  if (!block) return false;
  let p = find(block.id)?.parent;
  while (p) {
    p.open = true;
    p = find(p.id)?.parent;
  }
  render();
  const target = page.querySelector('.block[data-id="' + CSS.escape(block.id) + '"]');
  target?.scrollIntoView({ block: 'center' });
  target?.classList.add('link-jump');
  setTimeout(() => target?.classList.remove('link-jump'), 1800);
  return true;
}
window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  const msg = event.data;
  if (msg?.type === 'note:catalog') {
    linkCatalog = msg.notes || [];
    linkAssets = msg.assets || [];
    if (linkMenu) showWiki();
  } else if (msg?.type === 'note:jump' && msg.session === noteSession) {
    parent.postMessage(
      { type: 'note:jump-result', session: noteSession, found: jumpToAnchor(msg.anchor) },
      '*',
    );
  }
});

/* / command shares the same picker as [[. It inserts at the current caret. */
function beginWikiCommand(command) {
  const el = editOf(command.id);
  if (!el) return;
  el.focus();
  const end = getCaret(el),
    start = Math.max(0, end - command.len);
  const [a, ao] = pointAt(el, start),
    [b, bo] = pointAt(el, end);
  getSelection().setBaseAndExtent(a, ao, b, bo);
  document.execCommand('insertText', false, '[[');
  readEdit(el);
  save();
  showWiki();
}

/* Ctrl-hover preview: read-only, no navigation and no writes on hover. */
let hoveredNoteLink = null,
  previewTimer = null,
  hidePreviewTimer = null,
  previewRequest = 0,
  previewModifier = false;
const notePreview = document.createElement('section');
notePreview.id = 'noteHoverPreview';
notePreview.className = 'note-hover-preview';
notePreview.setAttribute('role', 'dialog');
notePreview.setAttribute('aria-label', 'Prévia da nota');
notePreview.hidden = true;
document.body.append(notePreview);
function linkSpec(anchor) {
  if (!anchor) return null;
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('notas1-wiki:')) {
    try {
      return { target: decodeURIComponent(href.slice(12)), format: 'wiki' };
    } catch {
      return null;
    }
  }
  if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('//'))
    return { target: href, format: 'markdown' };
  return null;
}
function closeNotePreview() {
  clearTimeout(previewTimer);
  clearTimeout(hidePreviewTimer);
  previewRequest++;
  notePreview.hidden = true;
}
function previewPosition() {
  if (!hoveredNoteLink?.isConnected) return;
  const r = hoveredNoteLink.getBoundingClientRect();
  const width = Math.min(390, innerWidth - 24);
  notePreview.style.width = width + 'px';
  notePreview.style.left = Math.max(12, Math.min(r.left, innerWidth - width - 12)) + 'px';
  const height = Math.min(notePreview.offsetHeight, innerHeight - 24);
  notePreview.style.top = Math.max(12, Math.min(r.bottom + 9, innerHeight - height - 12)) + 'px';
}
function requestNotePreview() {
  clearTimeout(previewTimer);
  clearTimeout(hidePreviewTimer);
  const spec = linkSpec(hoveredNoteLink);
  if (!previewModifier || !spec) return;
  const requestId = ++previewRequest;
  previewTimer = setTimeout(() => {
    if (requestId !== previewRequest || !previewModifier) return;
    notePreview.replaceChildren();
    const text = document.createElement('p');
    text.className = 'preview-hint';
    text.textContent = 'Carregando prévia…';
    notePreview.append(text);
    notePreview.hidden = false;
    previewPosition();
    parent.postMessage({ type: 'note:preview', session: noteSession, requestId, ...spec }, '*');
  }, 150);
}
function previewBlock(block) {
  const e = document.createElement(
    /^h[1-6]$/.test(block.type)
      ? 'h' + block.type[1]
      : block.type === 'code'
        ? 'pre'
        : block.type === 'quote'
          ? 'blockquote'
          : 'div',
  );
  e.className = 'preview-block preview-' + block.type;
  if (block.type === 'divider') return document.createElement('hr');
  if (block.type === 'code') e.textContent = block.html;
  else if (block.type === 'table') {
    const table = document.createElement('table');
    for (const row of block.rows || []) {
      const tr = table.insertRow();
      for (const cell of row) tr.insertCell().innerHTML = clean(cell);
    }
    e.append(table);
  } else {
    if (['bullet', 'number', 'todo', 'toggle'].includes(block.type)) {
      const mark = document.createElement('span');
      mark.className = 'preview-marker';
      mark.textContent =
        block.type === 'todo'
          ? block.checked
            ? '☑ '
            : '☐ '
          : block.type === 'number'
            ? '1. '
            : block.type === 'toggle'
              ? '▸ '
              : '• ';
      e.append(mark);
    }
    const inline = document.createElement('span');
    inline.innerHTML = clean(block.html || '');
    e.append(inline);
  }
  for (const child of block.children || []) e.append(previewBlock(child));
  return e;
}
function showNotePreview(data) {
  if (data.requestId !== previewRequest || !previewModifier || notePreview.hidden) return;
  notePreview.replaceChildren();
  const header = document.createElement('div');
  header.className = 'preview-heading';
  const label = document.createElement('span');
  label.textContent = data.title || 'Prévia da nota';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Fechar prévia');
  close.onclick = closeNotePreview;
  header.append(label, close);
  notePreview.append(header);
  if (data.path) {
    const path = document.createElement('div');
    path.className = 'preview-path';
    path.textContent = data.path;
    notePreview.append(path);
  }
  const content = document.createElement('div');
  content.className = 'preview-content';
  if (data.image) {
    const image = document.createElement('img');
    image.className = 'preview-attachment-image';
    image.src = data.image;
    image.alt = data.title || 'Imagem anexada';
    content.append(image);
  } else if (data.message) {
    const message = document.createElement('p');
    message.className = 'preview-hint';
    message.textContent = data.message;
    content.append(message);
  } else if (data.content !== undefined) {
    try {
      const decoded = NoteMarkdown.decode(data.content);
      const blocks = decoded.blocks;
      let start = 0;
      if (data.anchor) {
        const wanted = decodeURIComponent(data.anchor).normalize('NFC').toLocaleLowerCase();
        const i = blocks.findIndex(
          (b) =>
            /^h[1-6]$/.test(b.type) &&
            textOf(b.html).normalize('NFC').toLocaleLowerCase() === wanted,
        );
        if (i >= 0) start = i;
      }
      for (const b of blocks.slice(start, start + 35)) content.append(previewBlock(b));
      if (!content.textContent.trim()) {
        const empty = document.createElement('p');
        empty.textContent = 'Esta nota ainda está vazia.';
        content.append(empty);
      }
    } catch {
      content.textContent =
        'Não foi possível montar a prévia. Abra a nota para ver o Markdown original.';
    }
  } else {
    const message = document.createElement('p');
    message.className = 'preview-hint';
    message.textContent = data.message || 'Esta nota ainda não existe.';
    content.append(message);
  }
  notePreview.append(content);
  const footer = document.createElement('div');
  footer.className = 'preview-footer';
  const hint = document.createElement('span');
  hint.textContent = 'Somente leitura · solte Ctrl para fechar';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = data.attachment
    ? data.path
      ? 'Ver anexo ↗'
      : 'Abrir link ↗'
    : data.content !== undefined
      ? 'Abrir nota ↗'
      : data.missing
        ? 'Criar e abrir ↗'
        : 'Escolher nota ↗';
  const spec = linkSpec(hoveredNoteLink);
  open.onclick = () => {
    closeNotePreview();
    if (data.attachment && data.path)
      parent.postMessage(
        { type: 'note:link', session: noteSession, target: data.path, format: 'wiki' },
        '*',
      );
    else if (spec) parent.postMessage({ type: 'note:link', session: noteSession, ...spec }, '*');
  };
  footer.append(hint, open);
  notePreview.append(footer);
  previewPosition();
}
document.addEventListener('pointerover', (event) => {
  const anchor = event.target.closest('#page a');
  if (!linkSpec(anchor)) return;
  if (anchor !== hoveredNoteLink) {
    hoveredNoteLink = anchor;
    closeNotePreview();
  }
  previewModifier = event.ctrlKey || event.metaKey;
  if (previewModifier) requestNotePreview();
});
document.addEventListener('pointerout', (event) => {
  const anchor = event.target.closest('#page a');
  if (anchor !== hoveredNoteLink) return;
  if (anchor?.contains(event.relatedTarget) || notePreview.contains(event.relatedTarget)) return;
  clearTimeout(hidePreviewTimer);
  hidePreviewTimer = setTimeout(() => {
    if (!notePreview.matches(':hover')) {
      hoveredNoteLink = null;
      closeNotePreview();
    }
  }, 180);
});
notePreview.addEventListener('pointerenter', () => clearTimeout(hidePreviewTimer));
notePreview.addEventListener('pointerleave', (event) => {
  if (!hoveredNoteLink?.contains(event.relatedTarget)) {
    hoveredNoteLink = null;
    closeNotePreview();
  }
});
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Control' || event.key === 'Meta') {
      if (!previewModifier) {
        previewModifier = true;
        requestNotePreview();
      }
    }
    if (event.key === 'Escape' && !notePreview.hidden) {
      event.preventDefault();
      closeNotePreview();
    }
  },
  true,
);
document.addEventListener(
  'keyup',
  (event) => {
    if (event.key === 'Control' || event.key === 'Meta') {
      previewModifier = event.ctrlKey || event.metaKey;
      if (!previewModifier) closeNotePreview();
    }
  },
  true,
);
window.addEventListener('blur', () => {
  previewModifier = false;
  hoveredNoteLink = null;
  closeNotePreview();
});
window.addEventListener('scroll', closeNotePreview, { passive: true });
document.addEventListener('note-context', closeNotePreview);
window.addEventListener('message', (event) => {
  if (
    event.source === parent &&
    event.data?.type === 'note:preview-result' &&
    event.data.session === noteSession
  )
    showNotePreview(event.data);
});

window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.data?.type !== 'note:modifier' ||
    event.data.session !== noteSession
  )
    return;
  previewModifier = !!event.data.held;
  if (previewModifier) requestNotePreview();
  else closeNotePreview();
});
