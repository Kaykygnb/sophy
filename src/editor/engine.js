'use strict';
const KEY = 'bloco.doc.v1',
  $ = (s) => document.querySelector(s),
  page = $('#page'),
  titleEl = $('#title'),
  menuEl = $('#menu'),
  actsEl = $('#acts'),
  toolsEl = $('#tools'),
  dropEl = $('#drop');
const TYPES = [
  ['text', 'Texto', 'T', '', 'text paragrafo paragraph'],
  ['h1', 'Título 1', 'H1', '#', 'heading titulo h1'],
  ['h2', 'Título 2', 'H2', '##', 'heading titulo h2'],
  ['h3', 'Título 3', 'H3', '###', 'heading titulo h3'],
  ['h4', 'Título 4', 'H4', '####', 'heading titulo h4'],
  ['h5', 'Título 5', 'H5', '#####', 'heading titulo h5'],
  ['h6', 'Título 6', 'H6', '######', 'heading titulo h6'],
  ['th1', 'Título alternante 1', '▸1', '# >', 'toggle heading titulo alternante recolher h1'],
  ['th2', 'Título alternante 2', '▸2', '## >', 'toggle heading titulo alternante recolher h2'],
  ['th3', 'Título alternante 3', '▸3', '### >', 'toggle heading titulo alternante recolher h3'],
  ['th4', 'Título alternante 4', '▸4', '#### >', 'toggle heading titulo alternante recolher h4'],
  ['th5', 'Título alternante 5', '▸5', '##### >', 'toggle heading titulo alternante recolher h5'],
  ['th6', 'Título alternante 6', '▸6', '###### >', 'toggle heading titulo alternante recolher h6'],
  ['bullet', 'Lista com marcadores', '•', '-', 'bullet list lista'],
  ['number', 'Lista numerada', '1.', '1.', 'numbered list lista numero'],
  ['todo', 'Lista de tarefas', '☑', '[]', 'todo to-do tarefa check'],
  ['toggle', 'Lista recolhível', '▸', '>', 'toggle recolher'],
  ['quote', 'Citação', '”', '"', 'quote citacao'],
  ['callout', 'Destaque', '!', '', 'callout aviso destaque'],
  ['code', 'Código', '</>', '```', 'code codigo'],
  ['table', 'Tabela', '▦', '', 'table tabela'],
  ['divider', 'Divisor', '—', '---', 'divider divisor hr'],
];
const LABEL = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));
const CONTINUE = new Set(['bullet', 'number', 'todo', 'toggle']),
  EDITLESS = new Set(['divider', 'table']);
let uid = 0;
const newId = () => Date.now().toString(36) + (uid++).toString(36);
const mk = (type = 'text', html = '', x = {}) => ({ id: newId(), type, html, children: [], ...x });
const mkTable = () =>
  mk('table', '', {
    rows: [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ],
  });
let state = { title: '', blocks: [mk()] },
  hist = [],
  redo = [],
  lastT = 0,
  lastCaret = null,
  selected = new Set(),
  menu = null,
  dismissed = null,
  actId = null,
  savedRange = null,
  rememberedEdit = null;

/* ---- sanitização ---- */
const INLINE = {
  B: 'b',
  STRONG: 'b',
  I: 'i',
  EM: 'i',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  CODE: 'code',
  A: 'a',
  BR: 'br',
};
function cleanNode(n, out) {
  for (const c of [...n.childNodes]) {
    if (c.nodeType === 3) {
      out.appendChild(document.createTextNode(c.textContent.replace(/​/g, '')));
      continue;
    }
    if (c.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|META|LINK|TITLE)$/.test(c.tagName))
      continue;
    if (c.tagName === 'IMG') {
      try {
        const encoded =
            c.getAttribute('data-asset-ref') ||
            (c.getAttribute('src') || '').replace(/^sophy-asset:/, ''),
          target = decodeURIComponent(encoded);
        if (
          !/^Anexos\/.+\.(png|jpe?g|webp|gif)$/i.test(target) ||
          target.startsWith('/') ||
          target.includes('\\') ||
          target.split('/').some((part) => !part || part === '.' || part === '..')
        )
          continue;
        const image = document.createElement('img');
        image.className = 'embedded-attachment';
        image.src = 'sophy-asset:' + encodeURIComponent(target);
        image.dataset.assetRef = encodeURIComponent(target);
        image.alt = (c.getAttribute('alt') || '').slice(0, 200);
        out.appendChild(image);
      } catch {}
      continue;
    }
    const t = INLINE[c.tagName];
    if (c.tagName === 'SPAN' && /^(tc|bg)-(gray|amber|rose|sage|sky|plum)$/.test(c.className)) {
      const sp = document.createElement('span');
      sp.className = c.className;
      cleanNode(c, sp);
      out.appendChild(sp);
      continue;
    }
    if (!t) {
      cleanNode(c, out);
      continue;
    }
    const e = document.createElement(t);
    if (t === 'a') {
      const h = c.getAttribute('href') || '';
      if (NoteLinks.safeHref(h)) {
        e.setAttribute('href', h);
        e.setAttribute('target', '_blank');
        e.setAttribute('rel', 'noopener noreferrer');
        if (h.startsWith('notas1-wiki:')) e.className = 'internal-link';
      } else {
        cleanNode(c, out);
        continue;
      }
    }
    if (t !== 'br') cleanNode(c, e);
    out.appendChild(e);
  }
  return out;
}
function clean(html) {
  const d = new DOMParser().parseFromString('<body>' + html, 'text/html'),
    o = document.createElement('div');
  cleanNode(d.body, o);
  const r = o.innerHTML;
  return r === '<br>' ? '' : r;
}
const inert = document.implementation.createHTMLDocument('');
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function highlight(t) {
  return t.replace(
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|class|new|import|from|export|def|async|await|true|false|null|None|try|catch)\b|[&<>]/g,
    (m, c, s, n, k) =>
      c
        ? `<span class=m>${esc(c)}</span>`
        : s
          ? `<span class=s>${esc(s)}</span>`
          : n
            ? `<span class=n>${n}</span>`
            : k
              ? `<span class=k>${k}</span>`
              : esc(m),
  );
}

/* ---- árvore ---- */
function find(id, list = state.blocks, parent = null) {
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.id === id) return { b, list, i, parent };
    const r = find(id, b.children, b);
    if (r) return r;
  }
  return null;
}
function flat(list = state.blocks, out = [], all = false) {
  for (const b of list) {
    out.push(b);
    if (all || !isFold(b) || b.open) flat(b.children, out, all);
  }
  return out;
}
const isFold = (b) => b.type === 'toggle' || !!b.fold;
const editable = (b) => !EDITLESS.has(b.type);
function clone(b) {
  return { ...JSON.parse(JSON.stringify(b)), id: newId(), children: b.children.map(clone) };
}
function validate(d) {
  const fix = (l) =>
    Array.isArray(l)
      ? l
          .filter((b) => b && LABEL[b.type])
          .map((b) => ({
            ...b,
            id: String(b.id || newId()),
            html: b.type === 'code' ? String(b.html || '') : clean(String(b.html || '')),
            children: fix(b.children),
            rows:
              b.type === 'table'
                ? (b.rows || [['']]).map((r) => r.map((c) => clean(String(c))))
                : undefined,
            widths:
              b.type === 'table' &&
              Array.isArray(b.widths) &&
              b.widths.every((x) => Number.isFinite(x) && x > 0)
                ? b.widths
                : undefined,
          }))
      : [];
  const blocks = fix(d && d.blocks);
  const L = (d && d.layout) || {};
  return {
    meta: validMeta(d?.meta),
    properties: validProperties(d?.properties),
    icon:
      typeof d?.icon === 'string' && /^custom:[a-f\d-]{36}$/i.test(d.icon)
        ? d.icon
        : typeof d?.icon === 'string'
          ? d.icon.slice(0, 32)
          : '',
    cover: validCover(d?.cover),
    comments: Array.isArray(d?.comments)
      ? d.comments
          .filter((c) => c && typeof c.text === 'string')
          .map((c) => ({
            id: String(c.id || newId()),
            text: c.text,
            created: String(c.created || ''),
            resolved: !!c.resolved,
          }))
      : [],
    title: String((d && d.title) || ''),
    blocks: blocks.length ? blocks : [mk()],
    layout: {
      font: ['serif', 'sans', 'mono'].includes(L.font) ? L.font : 'sans',
      small: !!L.small,
      wide: !!L.wide,
      toc: !!L.toc,
    },
  };
}

/* ---- persistência e histórico ---- */
let saveT,
  dirty = false;
function save() {
  state.meta = validMeta(state.meta);
  state.meta.updatedAt = new Date().toISOString();
  renderNoteInfo();
  updateToc();
  dirty = true;
  $('#status').textContent = 'Alterações pendentes';
  if (window.noteChanged) window.noteChanged();
}
function load() {}
function pushHistory(coalesce) {
  if (xapplying) return;
  const now = Date.now();
  if (coalesce && now - lastT < 800) {
    lastT = now;
    return;
  }
  lastT = coalesce ? now : 0;
  const json = JSON.stringify(state);
  if (hist.length && hist[hist.length - 1].json === json) return;
  hist.push({ json, caret: lastCaret });
  if (hist.length > 200) hist.shift();
  redo = [];
}
function restore(from, to) {
  if (!from.length) return;
  to.push({ json: JSON.stringify(state), caret: lastCaret });
  const e = from.pop();
  state = JSON.parse(e.json);
  lastT = 0;
  selected.clear();
  render();
  titleEl.textContent = state.title;
  if (e.caret) focusBlock(e.caret.id, e.caret.off, e.caret.cell);
  save();
}
function mutate(fn, focus) {
  pushHistory(false);
  fn();
  render();
  if (focus) focusBlock(focus[0], focus[1], focus[2]);
  save();
}

/* ---- render ---- */
let rendering = false;
function render() {
  renderPageMeta();
  renderProperties();
  const f = document.createDocumentFragment();
  renderList(state.blocks, f);
  rendering = true;
  try {
    page.replaceChildren(f);
  } finally {
    rendering = false;
  }
  applyLayout();
  updateToc();
}
function renderList(list, host) {
  let n = 0;
  for (const b of list) {
    n = b.type === 'number' ? n + 1 : 0;
    host.appendChild(blockEl(b, n));
  }
}
function ed(b, ph) {
  const e = document.createElement('div');
  e.className = 'edit';
  e.contentEditable = 'true';
  e.spellcheck = b.type !== 'code';
  e.dataset.id = b.id;
  if (ph) e.dataset.ph = ph;
  if (b.type === 'code') {
    e.innerHTML = highlight(b.html);
    e.spellcheck = false;
  } else e.innerHTML = b.html;
  return e;
}
function blockEl(b, n) {
  const w = document.createElement('div');
  w.className = `block t-${b.type}${b.color ? ' c-' + b.color : ''}${b.checked ? ' done' : ''}${selected.has(b.id) ? ' sel' : ''}`;
  w.dataset.id = b.id;
  const r = document.createElement('div');
  r.className = 'row';
  const g = document.createElement('div');
  g.className = 'gut';
  g.innerHTML =
    '<button class="add" title="Adicionar bloco abaixo (Alt: acima)" aria-label="Adicionar bloco">+</button><button class="handle" title="Clique para ações, arraste para mover" aria-label="Ações do bloco">⠿</button>';
  r.appendChild(g);
  const m = (c, t) => {
    const s = document.createElement('span');
    s.className = 'mark';
    s.textContent = t;
    r.appendChild(s);
    return s;
  };
  switch (b.type) {
    case 'bullet':
      m('', '•');
      r.appendChild(ed(b, 'Item'));
      break;
    case 'number':
      m('', n + '.');
      r.appendChild(ed(b, 'Item'));
      break;
    case 'todo': {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.className = 'check';
      c.checked = !!b.checked;
      c.setAttribute('aria-label', 'Concluída');
      r.appendChild(c);
      r.appendChild(ed(b, 'Tarefa'));
      break;
    }
    case 'toggle': {
      const a = document.createElement('button');
      a.className = 'arrow' + (b.open ? ' open' : '');
      a.textContent = '▸';
      a.setAttribute('aria-label', b.open ? 'Recolher' : 'Expandir');
      r.appendChild(a);
      r.appendChild(ed(b, 'Recolhível'));
      break;
    }
    case 'divider':
      r.appendChild(document.createElement('hr'));
      break;
    case 'table':
      r.appendChild(tableEl(b));
      break;
    case 'callout':
      m('', '💡');
      r.appendChild(ed(b, 'Escreva um destaque'));
      break;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      if (b.fold) {
        const a = document.createElement('button');
        a.className = 'arrow' + (b.open ? ' open' : '');
        a.textContent = '▸';
        a.setAttribute('aria-label', b.open ? 'Recolher' : 'Expandir');
        a.setAttribute('aria-expanded', !!b.open);
        r.appendChild(a);
      }
      r.appendChild(ed(b, LABEL[b.type]));
      break;
    case 'quote':
      r.appendChild(ed(b, 'Citação'));
      break;
    case 'code':
      r.appendChild(ed(b, '// código  (Ctrl+Enter sai do bloco)'));
      break;
    default: {
      const e = ed(b, 'Digite / para ver os blocos');
      e.classList.add('hint');
      r.appendChild(e);
    }
  }
  w.appendChild(r);
  const closed = isFold(b) && !b.open;
  if (!closed && b.children.length) {
    const k = document.createElement('div');
    k.className = 'kids';
    renderList(b.children, k);
    w.appendChild(k);
  } else if (isFold(b) && b.open) {
    const x = document.createElement('div');
    x.className = 'empty-t';
    x.textContent = 'Recolhível vazio. Clique para adicionar um bloco.';
    w.appendChild(x);
  }
  return w;
}
function tableEl(b) {
  const tw = document.createElement('div');
  tw.className = 'tw';
  const w = document.createElement('div');
  w.className = 'tablewrap';
  const t = document.createElement('table');
  b.rows.forEach((row, i) => {
    const tr = t.insertRow();
    row.forEach((c, j) => {
      const td = tr.insertCell(),
        e = document.createElement('div');
      e.className = 'edit';
      e.contentEditable = 'true';
      e.spellcheck = true;
      e.dataset.id = b.id;
      e.dataset.cell = i + ',' + j;
      e.innerHTML = c;
      td.appendChild(e);
    });
  });
  if (b.widths && b.widths.length === b.rows[0].length) {
    const cg = document.createElement('colgroup');
    b.widths.forEach((x) => {
      const c = document.createElement('col');
      c.style.width = x + 'px';
      cg.appendChild(c);
    });
    t.prepend(cg);
    t.className = 'fixed';
    t.style.width = b.widths.reduce((a, x) => a + x, 0) + 'px';
  }
  w.appendChild(t);
  tw.appendChild(w);
  const tb = document.createElement('div');
  tb.className = 'tb';
  tb.innerHTML =
    '<button class="ta ta-row" data-t="row" aria-label="Adicionar linha" title="Adicionar linha">+</button><button class="ta ta-col" data-t="col" aria-label="Adicionar coluna" title="Adicionar coluna">+</button>';
  tw.appendChild(tb);
  tw.insertAdjacentHTML(
    'beforeend',
    '<button class="tg tg-col" aria-label="Opções da coluna" title="Opções da coluna">⋯</button><button class="tg tg-row" aria-label="Opções da linha" title="Opções da linha">⋯</button><div class="rz" aria-hidden="true"></div>',
  );
  return tw;
}

/* ---- cursor ---- */
const editOf = (id, cell) =>
  page.querySelector(
    `.edit[data-id="${id}"]${cell ? `[data-cell="${cell}"]` : ':not([data-cell])'}`,
  );
function getCaret(el) {
  const s = getSelection();
  if (!s.rangeCount) return 0;
  const r = s.getRangeAt(0),
    p = r.cloneRange();
  p.selectNodeContents(el);
  p.setEnd(r.startContainer, r.startOffset);
  return p.toString().replace(/​/g, '').length;
}
function setCaret(el, off) {
  el.focus();
  const s = getSelection(),
    r = document.createRange();
  if (off === 'end') {
    r.selectNodeContents(el);
    r.collapse(false);
  } else {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n,
      left = off,
      done = false;
    while ((n = w.nextNode())) {
      const l = n.textContent.length;
      if (left <= l) {
        r.setStart(n, left);
        r.collapse(true);
        done = true;
        break;
      }
      left -= l;
    }
    if (!done) {
      r.selectNodeContents(el);
      r.collapse(false);
    }
  }
  s.removeAllRanges();
  s.addRange(r);
}
function focusBlock(id, off = 0, cell) {
  const e = editOf(id, cell);
  if (e) setCaret(e, off);
}
function readEdit(el) {
  const f = find(el.dataset.id);
  if (!f) return;
  if (el.dataset.cell) {
    const [i, j] = el.dataset.cell.split(',').map(Number);
    f.b.rows[i][j] = clean(el.innerHTML);
  } else if (f.b.type === 'code') f.b.html = el.innerText.replace(/​/g, '').replace(/\n$/, '');
  else f.b.html = clean(el.innerHTML);
}
const curEdit = () => {
  const a = document.activeElement;
  return a && a.classList && a.classList.contains('edit') ? a : null;
};
function rememberCaret() {
  const el = curEdit();
  if (!el) return;
  readEdit(el);
  rememberedEdit = {
    id: el.dataset.id,
    cell: el.dataset.cell || '',
    offset: getCaret(el),
  };
}
page.addEventListener('pointerup', () => requestAnimationFrame(rememberCaret));
page.addEventListener('keyup', rememberCaret);
page.addEventListener('input', () => requestAnimationFrame(rememberCaret));
window.insertAttachments = (items) => {
  if (!Array.isArray(items) || !items.length) return false;
  let el = curEdit();
  if (!el && rememberedEdit) el = editOf(rememberedEdit.id, rememberedEdit.cell);
  if (!el || !find(el.dataset.id)) return false;
  if (el.contentEditable === 'false') el.contentEditable = 'true';
  el.focus();
  if (rememberedEdit?.id === el.dataset.id) setCaret(el, rememberedEdit.offset);
  const selection = getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    if (index) fragment.append(document.createElement('br'));
    if (item.embed) {
      const image = document.createElement('img');
      image.className = 'embedded-attachment';
      image.src = 'sophy-asset:' + encodeURIComponent(item.path);
      image.dataset.assetRef = encodeURIComponent(item.path);
      image.alt = item.name || item.path.split('/').at(-1);
      fragment.append(image);
    } else {
      const template = document.createElement('template');
      template.innerHTML = NoteLinks.anchor(item.path);
      fragment.append(template.content);
    }
  });
  const marker = document.createTextNode('\u200b');
  fragment.append(marker);
  range.insertNode(fragment);
  const caret = document.createRange();
  caret.setStart(marker, 1);
  caret.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caret);
  readEdit(el);
  save();
  rememberedEdit = { id: el.dataset.id, cell: el.dataset.cell || '', offset: getCaret(el) };
  return true;
};

/* ---- operações ---- */
function setType(b, t) {
  const fold = /^th[1-6]$/.test(t);
  if (fold) t = 'h' + t.slice(2);
  if (b.type === 'code' && t !== 'code') b.html = esc(b.html);
  const was = b.type;
  b.type = t;
  if (fold) {
    b.fold = true;
    b.open = false;
  } else delete b.fold;
  if (t === 'toggle') b.open = b.open ?? false;
  if (t === 'table') {
    b.rows = [
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ];
    b.html = '';
  }
  if (t === 'divider') b.html = '';
  if (t !== was) delete b.rawMarkdown;
  if (t === 'code' && was !== 'code') b.html = textOf(b.html);
  delete b.checked;
}
const textOf = (h) => {
  const d = inert.createElement('div');
  d.innerHTML = h;
  return d.textContent;
};
function ensureAfter(f) {
  if (f.i === f.list.length - 1) {
    const n = mk();
    f.list.push(n);
    return n;
  }
  const nx = f.list[f.i + 1];
  return editable(nx) ? nx : null;
}
function insertAfter(id, b) {
  const f = find(id);
  f.list.splice(f.i + 1, 0, b);
}
function indent(id) {
  const f = find(id);
  if (!f || f.i === 0) return;
  const prev = f.list[f.i - 1];
  mutate(() => {
    f.list.splice(f.i, 1);
    prev.children.push(f.b);
    if (isFold(prev)) prev.open = true;
  }, [id, 'end']);
}
function outdent(id, off = 'end') {
  const f = find(id);
  if (!f || !f.parent) return false;
  const p = find(f.parent.id);
  mutate(() => {
    f.list.splice(f.i, 1);
    p.list.splice(p.i + 1, 0, f.b);
  }, [id, off]);
  return true;
}
function removeBlocks(ids) {
  const vis = flat().filter(editable),
    first = vis.findIndex((b) => ids.has(b.id));
  let target = null;
  for (let i = first - 1; i >= 0; i--) {
    if (!ids.has(vis[i].id)) {
      target = vis[i];
      break;
    }
  }
  mutate(() => {
    const rm = (l) => {
      for (let i = l.length - 1; i >= 0; i--) {
        if (ids.has(l[i].id)) l.splice(i, 1);
        else rm(l[i].children);
      }
    };
    rm(state.blocks);
    selected.clear();
    if (!state.blocks.length) state.blocks.push((target = mk()));
    if (target && !find(target.id)) target = state.blocks[0];
  }, null);
  const t = target || flat().find(editable);
  if (t) focusBlock(t.id, 'end');
}
function splitEnter(el, f) {
  const b = f.b,
    s = getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  r.deleteContents();
  const tail = document.createRange();
  tail.selectNodeContents(el);
  tail.setStart(r.endContainer, r.endOffset);
  const frag = tail.extractContents(),
    box = document.createElement('div');
  box.appendChild(frag);
  const tailHtml = clean(box.innerHTML),
    headHtml = clean(el.innerHTML);
  const nt = CONTINUE.has(b.type) ? b.type : 'text',
    nb = mk(nt, tailHtml);
  if (nt === 'toggle') nb.open = false;
  pushHistory(false);
  b.html = headHtml;
  const toChild = isFold(b) ? !!b.open : b.children.length > 0;
  if (toChild) {
    const k = mk('text', tailHtml);
    b.children.unshift(k);
    render();
    focusBlock(k.id, 0);
  } else {
    f.list.splice(f.i + 1, 0, nb);
    render();
    focusBlock(nb.id, 0);
  }
  save();
}
function onBackspaceStart(el, f) {
  const b = f.b;
  readEdit(el);
  if (b.type !== 'text') {
    mutate(() => {
      if (b.type === 'code') b.html = esc(b.html);
      b.type = 'text';
      delete b.fold;
    }, [b.id, 0]);
    return;
  }
  if (f.parent && outdent(b.id, 0)) return;
  const vis = flat(),
    i = vis.findIndex((x) => x.id === b.id),
    prev = vis[i - 1];
  if (!prev) {
    if (!b.html && !b.children.length) {
      setCaret(titleEl, 'end');
    }
    return;
  }
  if (prev.type === 'divider') {
    mutate(() => {
      const p = find(prev.id);
      p.list.splice(p.i, 1);
    }, [b.id, 0]);
    return;
  }
  if (prev.type === 'table') {
    if (!b.html)
      mutate(() => {
        f.list.splice(f.i, 1);
      }, [prev.id, 'end', '0,0']);
    return;
  }
  if (prev.type === 'code') {
    if (!b.html)
      mutate(() => {
        f.list.splice(f.i, 1);
      }, [prev.id, 'end']);
    return;
  }
  const d = inert.createElement('div');
  d.innerHTML = prev.html;
  const off = d.textContent.length;
  mutate(() => {
    prev.html += b.html;
    prev.children.push(...b.children);
    const c = find(b.id);
    c.list.splice(c.i, 1);
  }, [prev.id, off]);
}
function move(ids, tid, where) {
  if (ids.includes(tid)) return;
  const bs = ids.map((i) => find(i)?.b).filter(Boolean);
  if (bs.some((x) => flat(x.children, [], true).some((k) => k.id === tid))) return;
  mutate(() => {
    for (const b of bs) {
      const a = find(b.id);
      a.list.splice(a.i, 1);
    }
    const t = find(tid);
    if (where === 'child') {
      t.b.children.push(...bs);
      if (isFold(t.b)) t.b.open = true;
    } else t.list.splice(t.i + (where === 'after' ? 1 : 0), 0, ...bs);
  });
}

/* ---- atalhos de Markdown ---- */
const BLOCK_RE = [
  [/^######\s>\s/, 'th6', { open: true }],
  [/^#####\s>\s/, 'th5', { open: true }],
  [/^####\s>\s/, 'th4', { open: true }],
  [/^###\s>\s/, 'th3', { open: true }],
  [/^##\s>\s/, 'th2', { open: true }],
  [/^#\s>\s/, 'th1', { open: true }],
  [/^######\s/, 'h6'],
  [/^#####\s/, 'h5'],
  [/^####\s/, 'h4'],
  [/^###\s/, 'h3'],
  [/^##\s/, 'h2'],
  [/^#\s/, 'h1'],
  [/^[-*+]\s/, 'bullet'],
  [/^1\.\s/, 'number'],
  [/^\[\s?\]\s/, 'todo'],
  [/^\[x\]\s/i, 'todo', { checked: true }],
  [/^>\s/, 'toggle'],
  [/^"\s/, 'quote'],
  [/^```/, 'code'],
  [/^---$/, 'divider'],
];
function stripPrefix(el, n) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  while (n > 0 && (t = w.nextNode())) {
    const k = Math.min(n, t.length);
    t.deleteData(0, k);
    n -= k;
  }
}
function blockShortcut(el, f) {
  const tx = el.textContent.replace(/​/g, '');
  if (/^h[1-6]$/.test(f.b.type) && !f.b.fold && /^>\s/.test(tx)) {
    const off = Math.max(0, getCaret(el) - 2);
    stripPrefix(el, 2);
    f.b.html = clean(el.innerHTML);
    f.b.fold = true;
    f.b.open = true;
    render();
    focusBlock(f.b.id, off);
    return true;
  }
  if (f.b.type !== 'text' || el.dataset.cell) return false;
  for (const [re, t, x] of BLOCK_RE) {
    const m = tx.match(re);
    if (!m) continue;
    const off = Math.max(0, getCaret(el) - m[0].length);
    stripPrefix(el, m[0].length);
    f.b.html = clean(el.innerHTML);
    setType(f.b, t);
    if (x) Object.assign(f.b, x);
    if (t === 'divider') {
      const n =
        ensureAfter(find(f.b.id)) ||
        (() => {
          const k = mk();
          insertAfter(f.b.id, k);
          return k;
        })();
      render();
      focusBlock(n.id, 0);
    } else {
      render();
      focusBlock(f.b.id, off);
    }
    return true;
  }
  return false;
}
const INLINE_RE = [
  [/\*\*([^*\n]+)\*\*/, 'b'],
  [/~~([^~\n]+)~~/, 's'],
  [/`([^`\n]+)`/, 'code'],
  [/(?:^|[^*])(\*([^*\s][^*\n]*)\*)(?!\*)/, 'i', 1],
];
function inlineShortcut(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  const nodes = [];
  while ((t = w.nextNode())) nodes.push(t);
  const s = getSelection(),
    caretNode = s.anchorNode,
    caretOff = s.anchorOffset;
  let changed = false;
  for (const node of nodes) {
    if (node.parentElement.closest('code')) continue;
    for (const [re, tag, g] of INLINE_RE) {
      const m = node.textContent.match(re);
      if (!m) continue;
      const whole = g ? m[1] : m[0],
        inner = g ? m[2] : m[1],
        start = m.index + m[0].length - whole.length,
        end = start + whole.length,
        txt = node.textContent;
      const e = document.createElement(tag);
      e.textContent = inner;
      const after = document.createTextNode('​' + txt.slice(end));
      node.textContent = txt.slice(0, start);
      node.after(e, after);
      const r = document.createRange();
      const c = node === caretNode ? Math.max(caretOff - end, 0) + 1 : 1;
      r.setStart(after, Math.min(c, after.length));
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
      changed = true;
      break;
    }
    if (changed) break;
  }
  if (changed) inlineShortcut(el);
  return changed;
}

/* ---- menu / ---- */
function slashCheck(el, f) {
  if (f.b.type === 'code' || el.dataset.cell) {
    closeMenu();
    return;
  }
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed) {
    closeMenu();
    return;
  }
  const p = s.getRangeAt(0).cloneRange();
  p.selectNodeContents(el);
  p.setEnd(s.anchorNode, s.anchorOffset);
  const before = p.toString();
  const m = before.match(/(?:^|\s)\/([^\/\n]*)$/);
  if (!m) {
    closeMenu();
    dismissed = null;
    return;
  }
  if (dismissed === f.b.id) return;
  const prev = menu;
  menu = {
    id: f.b.id,
    query: m[1],
    idx: prev && prev.query === m[1] ? prev.idx : 0,
    mode: 'slash',
    len: m[1].length + 1,
    plus: prev && prev.plus,
  };
  if (/\s/.test(m[1]) && !menuItems().length) {
    closeMenu();
    return;
  }
  renderMenu(el);
}
function menuItems() {
  const q = (menu.query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return [
    ...TYPES,
    [
      'linknote',
      'Link para nota',
      '↗',
      '[[',
      'link interno nota wikilink vincular referencia obsidian',
    ],
  ].filter((t) => {
    const h = (t[1] + ' ' + t[4])
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return q.every((w) => h.includes(w));
  });
}
function renderMenu(el) {
  const items = menuItems();
  if (menu.idx >= items.length) menu.idx = 0;
  const groups = [
    { label: 'Básico', items: items.filter((t) => t[0] === 'text') },
    { label: 'Títulos', items: items.filter((t) => /^h[1-6]$/.test(t[0])) },
    { label: 'Títulos alternantes', items: items.filter((t) => /^th[1-6]$/.test(t[0])) },
    { label: 'Blocos', items: items.filter((t) => !/^(text|h[1-6]|th[1-6])$/.test(t[0])) },
  ].filter((group) => group.items.length);
  let index = 0;
  menuEl.innerHTML = groups.length
    ? groups
        .map(
          (group) =>
            `<div class="lbl menu-group">${group.label}</div>` +
            group.items
              .map((t) => {
                const selected = index++ === menu.idx;
                return `<button class="it${selected ? ' on' : ''}" data-t="${t[0]}"><i>${esc(t[2])}</i>${t[1]}${t[3] ? `<small>${esc(t[3])}</small>` : ''}</button>`;
              })
              .join(''),
        )
        .join('')
    : '<div class="none">Nenhum resultado</div>';
  menuEl.style.display = 'block';
  const s = getSelection();
  let rc = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
  if (!rc || (!rc.width && !rc.height && !rc.top)) rc = el.getBoundingClientRect();
  place(menuEl, rc.left, rc.bottom + 6, rc.top - 6);
  const on = menuEl.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
function place(p, x, y, above) {
  const w = p.offsetWidth,
    h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  p.style.top =
    (y + h > innerHeight - 8 && above - h > 8
      ? above - h
      : Math.max(8, Math.min(y, innerHeight - h - 8))) + 'px';
}
function closeMenu() {
  menu = null;
  menuEl.style.display = 'none';
}
function applyMenu(type) {
  if (type === 'linknote') {
    const command = menu;
    closeMenu();
    if (typeof beginWikiCommand === 'function') beginWikiCommand(command);
    return;
  }
  const m = menu,
    el = editOf(m.id);
  closeMenu();
  const f = find(m.id);
  if (!f || !el) return;
  if (m.mode === 'slash') {
    const s = getSelection(),
      r = s.getRangeAt(0),
      off = getCaret(el);
    setCaret(el, off);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n,
      left = off,
      end = null;
    while ((n = w.nextNode())) {
      if (left <= n.length) {
        end = [n, left];
        break;
      }
      left -= n.length;
    }
    if (end) {
      const d = document.createRange();
      d.setEnd(end[0], end[1]);
      d.setStart(end[0], Math.max(0, end[1] - m.len));
      d.deleteContents();
    }
  }
  const html = clean(el.innerHTML);
  mutate(() => {
    f.b.html = html;
    let tgt = f.b;
    if (html) {
      tgt = mk();
      f.list.splice(f.i + 1, 0, tgt);
    }
    setType(tgt, type);
    if (type === 'toggle') tgt.open = false;
    let foc = tgt;
    if (type === 'divider') {
      const c = find(tgt.id),
        n = mk();
      c.list.splice(c.i + 1, 0, n);
      foc = n;
    }
    m.focus = foc;
  }, null);
  if (m.focus.type === 'table') focusBlock(m.focus.id, 0, '0,0');
  else focusBlock(m.focus.id, 0);
}

/* ---- ações do bloco ---- */
function actTargets() {
  return selected.size > 1 && selected.has(actId) ? selectedList().map((b) => b.id) : [actId];
}
function openActs(id, btn) {
  actId = id;
  if (!(selected.size > 1 && selected.has(id))) selected = new Set([id]);
  render();
  const many = selected.size > 1,
    b = find(id).b,
    colors = [
      ['', 'Sem cor'],
      ['amber', 'Âmbar'],
      ['rose', 'Rosa'],
      ['sage', 'Sálvia'],
      ['sky', 'Céu'],
    ];
  actsEl.innerHTML =
    (many ? `<div class="lbl">${selected.size} blocos selecionados</div>` : '') +
    `<button class="it" data-a="dup"><i>⧉</i>Duplicar<small>Ctrl+D</small></button><button class="it" data-a="del"><i>✕</i>Excluir<small>Del</small></button><div class="lbl">Transformar em</div>` +
    TYPES.filter((t) => many || t[0] !== b.type)
      .map((t) => `<button class="it" data-turn="${t[0]}"><i>${esc(t[2])}</i>${t[1]}</button>`)
      .join('') +
    '<div class="lbl">Cor de fundo</div>' +
    colors
      .map(
        (c) => `<button class="it" data-color="${c[0]}"><i>${c[0] ? '●' : '○'}</i>${c[1]}</button>`,
      )
      .join('');
  actsEl.style.display = 'block';
  const r = (page.querySelector(`.block[data-id="${id}"] .handle`) || btn).getBoundingClientRect();
  place(actsEl, r.right + 6, r.top, r.bottom);
  actsEl.scrollTop = 0;
}
const closeActs = () => {
  actsEl.style.display = 'none';
  actId = null;
};
function duplicate(ids) {
  let last;
  mutate(() => {
    for (const id of ids) {
      const f = find(id),
        c = clone(f.b);
      f.list.splice(f.i + 1, 0, c);
      last = c;
    }
    selected.clear();
  });
  if (last && editable(last)) focusBlock(last.id, 'end');
}
actsEl.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || !actId) return;
  const id = actId,
    ids = actTargets();
  closeActs();
  if (t.dataset.a === 'del') return removeBlocks(new Set(ids));
  if (t.dataset.a === 'dup') return duplicate(ids);
  const many = ids.length > 1;
  if (!many) selected.clear();
  if (t.dataset.turn) {
    const ty = t.dataset.turn;
    mutate(() => {
      for (const i of ids) {
        const f = find(i);
        setType(f.b, ty);
        if (ty === 'divider' && f.i === f.list.length - 1) f.list.push(mk());
      }
    });
    const f = find(id);
    if (!many && editable(f.b)) focusBlock(id, 'end');
  } else if ('color' in t.dataset)
    mutate(() => {
      for (const i of ids) find(i).b.color = t.dataset.color || undefined;
    });
});

/* ---- barra de formatação ---- */
const TOOLS = [
  ['color', '<span style="border-bottom:2px solid var(--accent)">A</span>', 'Cor do texto e fundo'],
  ['bold', '<b>N</b>', 'Negrito'],
  ['italic', '<i>I</i>', 'Itálico'],
  ['underline', '<u>S</u>', 'Sublinhado'],
  ['strikeThrough', '<s>T</s>', 'Tachado'],
  ['code', '&lt;/&gt;', 'Código'],
  ['link', '🔗', 'Link'],
  ['clear', '⌫', 'Limpar formatação'],
];
toolsEl.innerHTML = TOOLS.map(
  (t) => `<button data-c="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${t[1]}</button>`,
).join('');
function updateTools() {
  if (xapplying || toolsEl.querySelector('input')) return;
  {
    const lk = toolsEl.querySelector('[data-c=link]');
    if (lk) lk.style.display = xsel ? 'none' : '';
  }
  if (xsel) {
    const q = getSelection();
    if (!q.rangeCount || q.isCollapsed || !q.toString().trim()) {
      toolsEl.style.display = 'none';
      hideColors();
      return;
    }
    toolsEl.style.display = 'flex';
    const rs = q.getRangeAt(0).getClientRects(),
      l = rs[rs.length - 1] || q.getRangeAt(0).getBoundingClientRect();
    place(toolsEl, l.left, l.bottom + 8, l.top - 8);
    if (colorsEl.style.display === 'block') {
      const t = toolsEl.getBoundingClientRect();
      place(colorsEl, t.left, t.bottom + 4, t.top - 4);
    }
    return;
  }
  const s = getSelection(),
    el = curEdit();
  if (
    !el ||
    !s.rangeCount ||
    s.isCollapsed ||
    !s.toString().trim() ||
    !el.contains(s.anchorNode) ||
    !el.contains(s.focusNode) ||
    find(el.dataset.id)?.b.type === 'code'
  ) {
    toolsEl.style.display = 'none';
    hideColors();
    return;
  }
  toolsEl.style.display = 'flex';
  const r = s.getRangeAt(0).getBoundingClientRect();
  place(toolsEl, r.left, r.bottom + 8, r.top - 8);
  if (colorsEl.style.display === 'block') {
    const t = toolsEl.getBoundingClientRect();
    place(colorsEl, t.left, t.bottom + 4, t.top - 4);
  }
  for (const b of toolsEl.querySelectorAll('[data-c]')) {
    const c = b.dataset.c;
    if (/bold|italic|underline|strike/.test(c))
      b.classList.toggle('on', document.queryCommandState(c));
  }
}
function applyTool(c, el) {
  pushHistory(false);
  if (c === 'code') {
    const s = getSelection(),
      r = s.getRangeAt(0),
      inC = r.commonAncestorContainer.parentElement?.closest?.('code');
    if (inC) {
      inC.replaceWith(...inC.childNodes);
    } else {
      const e = document.createElement('code');
      e.textContent = r.toString();
      r.deleteContents();
      r.insertNode(e);
      const nr = document.createRange();
      nr.selectNodeContents(e);
      s.removeAllRanges();
      s.addRange(nr);
    }
  } else if (c === 'clear') {
    setInline(el, 'tc', '');
    setInline(el, 'bg', '');
    document.execCommand('removeFormat');
    document.execCommand('unlink');
    const s = getSelection(),
      inC = s.anchorNode.parentElement?.closest?.('code');
    if (inC) inC.replaceWith(...inC.childNodes);
  } else document.execCommand(c);
  readEdit(el);
  save();
  updateTools();
}
toolsEl.addEventListener('mousedown', (e) => {
  if (e.target.tagName !== 'INPUT') e.preventDefault();
});
toolsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-c]'),
    el = curEdit();
  if (!b || (!el && !xsel)) return;
  if (b.dataset.c === 'color') {
    if (colorsEl.style.display === 'block') return hideColors();
    colorsEl.style.display = 'block';
    const r = toolsEl.getBoundingClientRect();
    place(colorsEl, r.left, r.bottom + 4, r.top - 4);
    return;
  }
  hideColors();
  if (xsel) return xTool(b.dataset.c);
  if (b.dataset.c !== 'link') return applyTool(b.dataset.c, el);
  savedRange = { r: getSelection().getRangeAt(0).cloneRange(), el };
  const keep = toolsEl.innerHTML;
  toolsEl.innerHTML =
    '<input type="url" placeholder="https://… e Enter" aria-label="Endereço do link">';
  const inp = toolsEl.firstChild;
  inp.focus();
  const end = (apply) => {
    toolsEl.innerHTML = keep;
    const { r, el: e2 } = savedRange;
    e2.focus();
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    if (apply && /^(https?:\/\/|mailto:)/i.test(inp.value)) {
      pushHistory(false);
      document.execCommand('createLink', false, inp.value);
      readEdit(e2);
      render();
      save();
      toolsEl.style.display = 'none';
    } else updateTools();
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      end(true);
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      end(false);
    }
  });
});

/* ---- cor do texto e fundo do trecho selecionado ---- */
const COLORS = [
  ['gray', 'Cinza'],
  ['amber', 'Âmbar'],
  ['rose', 'Rosa'],
  ['sage', 'Verde'],
  ['sky', 'Azul'],
  ['plum', 'Roxo'],
];
const colorsEl = $('#colors');
colorsEl.innerHTML = [
  ['tc', 'Cor do texto'],
  ['bg', 'Fundo do texto'],
]
  .map(
    ([k, l]) =>
      `<div class="lbl">${l}</div><div class="sws"><button data-k="${k}" data-v="" title="Padrão" aria-label="${l}: padrão" class="sw0">A</button>` +
      COLORS.map(
        (c) =>
          `<button data-k="${k}" data-v="${c[0]}" title="${c[1]}" aria-label="${l}: ${c[1]}" class="${k}-${c[0]}">A</button>`,
      ).join('') +
      '</div>',
  )
  .join('');
const hideColors = () => {
  colorsEl.style.display = 'none';
};
function setInline(el, kind, val) {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0),
    isKind = (n) => n.nodeType === 1 && n.tagName === 'SPAN' && n.className.startsWith(kind + '-');
  const chain = [];
  for (let n = r.commonAncestorContainer; n && n !== el; n = n.parentNode)
    if (n.nodeType === 1) chain.push(n);
  const top = chain[chain.length - 1];
  let frag = r.extractContents();
  for (const x of [...frag.querySelectorAll('span')]) if (isKind(x)) x.replaceWith(...x.childNodes);
  for (const a of chain) {
    if (isKind(a)) continue;
    const c = a.cloneNode(false);
    c.appendChild(frag);
    const f = document.createDocumentFragment();
    f.appendChild(c);
    frag = f;
  }
  if (val) {
    const w = document.createElement('span');
    w.className = kind + '-' + val;
    w.appendChild(frag);
    const f = document.createDocumentFragment();
    f.appendChild(w);
    frag = f;
  }
  if (top) {
    const tail = document.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEndAfter(top);
    const t = tail.extractContents();
    top.after(t);
    tail.setStartAfter(top);
    tail.collapse(true);
    r.setStart(tail.startContainer, tail.startOffset);
    r.collapse(true);
  }
  const first = frag.firstChild,
    last = frag.lastChild;
  r.insertNode(frag);
  for (const x of [...el.querySelectorAll('span,b,i,u,s,code,a')])
    if (!x.textContent && !x.querySelector('br')) x.remove();
  const nr = document.createRange();
  nr.setStartBefore(first);
  nr.setEndAfter(last);
  s.removeAllRanges();
  s.addRange(nr);
}
colorsEl.addEventListener('mousedown', (e) => e.preventDefault());
colorsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]'),
    el = curEdit();
  if (!b) return;
  if (xsel) {
    xApply((x) => {
      setInline(x, b.dataset.k, b.dataset.v);
      return null;
    });
    return;
  }
  if (!el) return;
  pushHistory(false);
  setInline(el, b.dataset.k, b.dataset.v);
  readEdit(el);
  save();
  updateTools();
});

/* ---- colar ---- */
function parseHtml(html) {
  const d = new DOMParser().parseFromString(html, 'text/html'),
    out = [];
  const inlineHtml = (ns) => {
    const b = d.createElement('div');
    ns.forEach((n) => b.appendChild(n.cloneNode(true)));
    return clean(b.innerHTML).trim();
  };
  const BLOCK =
    /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV)$/;
  const walk = (nodes, into) => {
    let run = [];
    const flush = () => {
      const h = inlineHtml(run);
      run = [];
      if (textOf(h).trim()) into.push(mk('text', h));
    };
    for (const n of nodes) {
      if (n.nodeType !== 1 || !BLOCK.test(n.tagName)) {
        if (n.nodeType === 3 && !n.textContent.trim() && !run.length) continue;
        run.push(n);
        continue;
      }
      flush();
      const T = n.tagName;
      if (/^H[1-6]$/.test(T))
        into.push(mk('h' + Math.min(+T[1], 3), inlineHtml([...n.childNodes])));
      else if (T === 'UL' || T === 'OL') {
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue;
          const nested = [...li.childNodes].filter(
              (c) => c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName),
            ),
            rest = [...li.childNodes].filter((c) => !nested.includes(c));
          const chk = li.querySelector(':scope>input[type=checkbox]');
          const b = mk(chk ? 'todo' : T === 'OL' ? 'number' : 'bullet', inlineHtml(rest));
          if (chk && chk.checked) b.checked = true;
          walk(nested, b.children);
          into.push(b);
        }
      } else if (T === 'BLOCKQUOTE') into.push(mk('quote', inlineHtml([...n.childNodes])));
      else if (T === 'PRE') into.push(mk('code', n.textContent.replace(/\n$/, '')));
      else if (T === 'HR') into.push(mk('divider'));
      else if (T === 'TABLE') {
        const rows = [...n.rows].map((r) => [...r.cells].map((c) => inlineHtml([...c.childNodes])));
        if (rows.length) {
          const w = Math.max(...rows.map((r) => r.length));
          into.push(
            mk('table', '', {
              rows: rows.map((r) => {
                while (r.length < w) r.push('');
                return r;
              }),
            }),
          );
        }
      } else if (T === 'P' && ![...n.children].some((c) => BLOCK.test(c.tagName))) {
        const h = inlineHtml([...n.childNodes]);
        if (textOf(h).trim()) into.push(mk('text', h));
      } else walk([...n.childNodes], into);
    }
    flush();
  };
  walk([...d.body.childNodes], out);
  return out;
}
function parseText(t) {
  const out = [];
  let code = null;
  for (const line of t.replace(/\r/g, '').split('\n')) {
    if (/^```/.test(line)) {
      if (code) {
        out.push(code);
        code = null;
      } else code = mk('code', '');
      continue;
    }
    if (code) {
      code.html += (code.html ? '\n' : '') + line;
      continue;
    }
    const l = line.trim();
    if (!l) continue;
    let m;
    if ((m = l.match(/^(#{1,6})\s+>\s+(.*)/)))
      out.push(mk('h' + m[1].length, esc(m[2]), { fold: true, open: true }));
    else if ((m = l.match(/^(#{1,6})\s+(.*)/))) out.push(mk('h' + m[1].length, esc(m[2])));
    else if (/^(-{3,}|\*{3,})$/.test(l)) out.push(mk('divider'));
    else if ((m = l.match(/^[-*+]\s+\[( |x)\]\s+(.*)/i)))
      out.push(mk('todo', esc(m[2]), m[1] === ' ' ? {} : { checked: true }));
    else if ((m = l.match(/^[-*+]\s+(.*)/))) out.push(mk('bullet', esc(m[1])));
    else if ((m = l.match(/^\d+\.\s+(.*)/))) out.push(mk('number', esc(m[1])));
    else if ((m = l.match(/^>\s+(.*)/))) out.push(mk('quote', esc(m[1])));
    else out.push(mk('text', esc(l)));
  }
  if (code) out.push(code);
  return out;
}
function onPaste(e, el) {
  const f = find(el.dataset.id),
    dt = e.clipboardData;
  if (!f || !dt) return;
  e.preventDefault();
  closeMenu();
  const text = dt.getData('text/plain'),
    html = dt.getData('text/html');
  if (f.b.type === 'code' || el.dataset.cell) {
    document.execCommand('insertText', false, text);
    return;
  }
  const bl = html ? parseHtml(html) : parseText(text);
  if (!bl.length) return;
  if (bl.length === 1 && bl[0].type === 'text' && !bl[0].children.length) {
    document.execCommand('insertHTML', false, bl[0].html || esc(text));
    return;
  }
  readEdit(el);
  const last = bl[bl.length - 1];
  mutate(() => {
    const emptyCur = !f.b.html && f.b.type === 'text' && !f.b.children.length;
    f.list.splice(f.i + (emptyCur ? 0 : 1), emptyCur ? 1 : 0, ...bl);
  });
  const lastEd = flat(bl, [], true).filter(editable).pop();
  if (lastEd) focusBlock(lastEd.id, 'end');
  else if (last) selected.clear();
}
function toMd(list = state.blocks, d = 0) {
  const pad = '  '.repeat(d);
  let n = 0;
  return list
    .map((b) => {
      n = b.type === 'number' ? n + 1 : 0;
      const t = inlineMd(b.html);
      const line = /^h[1-6]$/.test(b.type)
        ? '#'.repeat(+b.type[1]) + (b.fold ? ' > ' : ' ') + t
        : ({
            bullet: '- ' + t,
            number: n + '. ' + t,
            todo: `- [${b.checked ? 'x' : ' '}] ` + t,
            toggle: '- ' + t,
            quote: '> ' + t,
            callout: '> 💡 ' + t,
            divider: '---',
            code: '```\n' + b.html + '\n```',
          }[b.type] ?? t);
      const tb =
        b.type === 'table'
          ? b.rows
              .map(
                (r, i) =>
                  '| ' +
                  r.map(inlineMd).join(' | ') +
                  ' |' +
                  (i === 0 ? '\n|' + r.map(() => ' --- |').join('') : ''),
              )
              .join('\n')
          : line;
      return pad + tb + (b.children.length ? '\n' + toMd(b.children, d + 1) : '');
    })
    .join('\n');
}
function inlineMd(h) {
  const d = inert.createElement('div');
  d.innerHTML = h || '';
  const w = (n) =>
    [...n.childNodes]
      .map((c) => {
        if (c.nodeType === 3) return c.textContent;
        const t = c.tagName,
          i = w(c);
        return t === 'B'
          ? `**${i}**`
          : t === 'I'
            ? `*${i}*`
            : t === 'S'
              ? `~~${i}~~`
              : t === 'CODE'
                ? '`' + i + '`'
                : t === 'A'
                  ? `[${i}](${c.getAttribute('href')})`
                  : t === 'BR'
                    ? '\n'
                    : i;
      })
      .join('');
  return w(d);
}

/* ---- eventos do editor ---- */
page.addEventListener('input', (e) => {
  if (xapplying) return;
  const el = e.target.closest('.edit');
  if (!el) return;
  pushHistory(e.data !== ' ' && e.inputType !== 'insertLineBreak');
  if (!el.textContent && !el.querySelector('img') && el.innerHTML) el.innerHTML = '';
  readEdit(el);
  const f = find(el.dataset.id);
  if (!e.isComposing && f) {
    if (blockShortcut(el, f)) {
      closeMenu();
      save();
      return;
    }
    if (f.b.type !== 'code' && !el.dataset.cell && inlineShortcut(el)) readEdit(el);
    else if (f.b.type !== 'code' && el.dataset.cell && inlineShortcut(el)) readEdit(el);
    slashCheck(el, f);
  }
  save();
});
page.addEventListener('paste', (e) => {
  const el = e.target.closest('.edit');
  if (el) onPaste(e, el);
});
page.addEventListener('focusin', () => {
  if (selected.size) {
    selected.clear();
    page.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  }
});
page.addEventListener('focusout', (e) => {
  if (rendering || xapplying) return;
  const el = e.target.closest && e.target.closest('.edit');
  if (!el) return;
  readEdit(el);
  const f = find(el.dataset.id);
  if (f && f.b.type === 'code' && !el.dataset.cell && !e.relatedTarget?.closest?.('.pop'))
    el.innerHTML = highlight(f.b.html);
});
page.addEventListener('keydown', (e) => {
  const el = e.target.closest('.edit');
  if (!el) return;
  const f = find(el.dataset.id);
  if (!f) return;
  const b = f.b,
    mod = e.ctrlKey || e.metaKey,
    s = getSelection();
  if (menu) {
    const items = menuItems();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) {
        menu.idx = (menu.idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        renderMenu(el);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[menu.idx]) applyMenu(items[menu.idx][0]);
      else closeMenu();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      const plus = menu.plus;
      dismissed = b.id;
      closeMenu();
      if (plus && /^\/\S*$/.test(el.textContent)) {
        el.innerHTML = '';
        b.html = '';
        dismissed = null;
        save();
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      return;
    }
  }
  if (el.dataset.cell) {
    cellKeys(e, el, b);
    if (e.defaultPrevented) return;
  } else if (e.key === 'Enter' && mod && isFold(b)) {
    e.preventDefault();
    readEdit(el);
    const off = getCaret(el);
    mutate(() => {
      b.open = !b.open;
    }, [b.id, off]);
    return;
  } else if (e.key === 'Enter' && mod) {
    e.preventDefault();
    readEdit(el);
    const n = mk();
    mutate(() => {
      f.list.splice(f.i + 1, 0, n);
    }, [n.id, 0]);
    return;
  } else if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (b.type === 'code') {
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (e.shiftKey) {
      document.execCommand('insertLineBreak');
      return;
    }
    readEdit(el);
    if (!b.html && !b.children.length && b.type !== 'text') {
      if (f.parent && CONTINUE.has(b.type)) {
        outdent(b.id, 0);
        return;
      }
      mutate(() => {
        setType(b, 'text');
      }, [b.id, 0]);
      return;
    }
    if (!b.html && f.parent && b.type === 'text') {
      outdent(b.id, 0);
      return;
    }
    splitEnter(el, f);
    return;
  }
  if (e.key === 'Tab' && !el.dataset.cell) {
    e.preventDefault();
    readEdit(el);
    if (b.type === 'code' && !e.shiftKey) {
      document.execCommand('insertText', false, '  ');
      return;
    }
    if (e.shiftKey) outdent(b.id);
    else indent(b.id);
    return;
  }
  if (e.key === 'Backspace' && s.isCollapsed && getCaret(el) === 0 && !el.dataset.cell) {
    e.preventDefault();
    onBackspaceStart(el, f);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    readEdit(el);
    el.blur();
    selected = new Set([b.id]);
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'a' && !el.dataset.cell) {
    const all =
      s.toString().replace(/​/g, '').length >= el.textContent.replace(/​/g, '').length &&
      (!s.isCollapsed || !el.textContent);
    if (all) {
      e.preventDefault();
      readEdit(el);
      el.blur();
      getSelection().removeAllRanges();
      selected = new Set(state.blocks.map((x) => x.id));
      render();
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    readEdit(el);
    duplicate([b.id]);
    return;
  }
  if (
    (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
    !mod &&
    !e.shiftKey &&
    !el.dataset.cell &&
    s.isCollapsed
  ) {
    const up = e.key === 'ArrowUp',
      rc = s.getRangeAt(0).getClientRects()[0],
      er = el.getBoundingClientRect(),
      lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const edge = !rc || (up ? rc.top - er.top < lh * 0.7 : er.bottom - rc.bottom < lh * 0.7);
    if (edge) {
      const vis = flat().filter(editable),
        i = vis.findIndex((x) => x.id === b.id),
        t = vis[i + (up ? -1 : 1)];
      if (t) {
        e.preventDefault();
        readEdit(el);
        focusBlock(t.id, up ? 'end' : 0);
      } else if (up) {
        e.preventDefault();
        setCaret(titleEl, 'end');
      }
    }
  }
});
function cellKeys(e, el, b) {
  const [i, j] = el.dataset.cell.split(',').map(Number);
  const go = (r, c) => {
    readEdit(el);
    focusBlock(b.id, 'end', r + ',' + c);
  };
  if (e.key === 'Tab') {
    e.preventDefault();
    const w = b.rows[0].length;
    if (e.shiftKey) {
      if (j > 0) go(i, j - 1);
      else if (i > 0) go(i - 1, w - 1);
    } else if (j < w - 1) go(i, j + 1);
    else if (i < b.rows.length - 1) go(i + 1, 0);
    else {
      readEdit(el);
      mutate(() => {
        b.rows.push(Array(w).fill(''));
      }, [b.id, 0, i + 1 + ',0']);
    }
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (i < b.rows.length - 1) go(i + 1, j);
    else {
      readEdit(el);
      mutate(() => {
        b.rows.push(Array(b.rows[0].length).fill(''));
      }, [b.id, 0, i + 1 + ',' + j]);
    }
  } else if (e.key === 'ArrowUp' && i > 0) {
    e.preventDefault();
    go(i - 1, j);
  } else if (e.key === 'ArrowDown' && i < b.rows.length - 1) {
    e.preventDefault();
    go(i + 1, j);
  }
}
page.addEventListener('click', (e) => {
  const t = e.target;
  if (t.classList.contains('check')) {
    const id = t.closest('.block').dataset.id,
      b = find(id).b;
    mutate(() => {
      b.checked = t.checked;
    });
    return;
  }
  if (t.classList.contains('arrow')) {
    const id = t.closest('.block').dataset.id,
      b = find(id).b;
    mutate(() => {
      b.open = !b.open;
    });
    return;
  }
  if (t.classList.contains('empty-t')) {
    const b = find(t.closest('.block').dataset.id).b,
      n = mk();
    mutate(() => {
      b.children.push(n);
    }, [n.id, 0]);
    return;
  }
  if (t.classList.contains('add')) {
    const id = t.closest('.block').dataset.id,
      f = find(id),
      n = mk('text', '/');
    mutate(() => {
      f.list.splice(f.i + (e.altKey ? 0 : 1), 0, n);
    }, [n.id, 1]);
    dismissed = null;
    menu = { id: n.id, query: '', idx: 0, mode: 'slash', len: 1, plus: true };
    renderMenu(editOf(n.id));
    return;
  }
  if (t.dataset.t === 'row' || t.dataset.t === 'col') {
    const b = find(t.closest('.block').dataset.id).b;
    mutate(() => {
      if (t.dataset.t === 'row') b.rows.push(Array(b.rows[0].length).fill(''));
      else {
        b.rows.forEach((r) => r.push(''));
        if (b.widths) b.widths.push(b.widths[b.widths.length - 1]);
      }
    });
    return;
  }
});

/* arrastar pela alça */
let drag = null;
page.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.handle');
  if (!h || e.button) return;
  e.preventDefault();
  const el = curEdit();
  if (el) readEdit(el);
  const hid = h.closest('.block').dataset.id;
  drag = {
    id: hid,
    ids: selected.size > 1 && selected.has(hid) ? selectedList().map((b) => b.id) : [hid],
    x: e.clientX,
    y: e.clientY,
    moved: false,
    target: null,
    btn: h,
  };
});
function dropTarget(x, y) {
  let best = null;
  for (const w of page.querySelectorAll('.block')) {
    const r = w.querySelector(':scope>.row').getBoundingClientRect();
    if (drag.ids.some((i) => w.closest(`.block[data-id="${i}"]`))) continue;
    const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (!best || d < best.d) best = { d, w, r };
  }
  if (!best) return null;
  const before = y < best.r.top + best.r.height / 2,
    child = !before && x > best.r.left + 60;
  return { id: best.w.dataset.id, where: before ? 'before' : child ? 'child' : 'after', r: best.r };
}
function dragUpdate(e) {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
  drag.moved = true;
  drag.target = dropTarget(e.clientX, e.clientY);
  const t = drag.target;
  if (t) {
    const ind = t.where === 'child' ? 26 : 0;
    dropEl.style.cssText = `display:block;left:${t.r.left + ind}px;width:${t.r.width - ind}px;top:${(t.where === 'before' ? t.r.top : t.r.bottom) - 1}px`;
  }
}
addEventListener('pointermove', dragUpdate);
addEventListener('pointerup', (e) => {
  if (!drag) return;
  dragUpdate(e);
  const d = drag;
  drag = null;
  dropEl.style.display = 'none';
  if (!d.moved) {
    openActs(d.id, d.btn);
    return;
  }
  if (d.target) move(d.ids, d.target.id, d.target.where);
});

/* seleção por área a partir das margens */
let box = null;
const boxEl = $('#box');
function isMargin(t) {
  return (
    t === document.documentElement ||
    t === document.body ||
    t.id === 'main' ||
    t.id === 'page' ||
    (t.classList && (t.classList.contains('kids') || t.classList.contains('block')))
  );
}
document.addEventListener('pointerdown', (e) => {
  if (
    e.button ||
    e.pointerType === 'touch' ||
    !isMargin(e.target) ||
    e.clientX >= document.documentElement.clientWidth
  )
    return;
  box = {
    x: e.clientX,
    y: e.clientY + scrollY,
    cx: e.clientX,
    cy: e.clientY,
    moved: false,
    target: e.target,
  };
});
function boxPaint() {
  const x0 = Math.min(box.x, box.cx),
    x1 = Math.max(box.x, box.cx),
    yNow = box.cy + scrollY,
    y0 = Math.min(box.y, yNow),
    y1 = Math.max(box.y, yNow);
  boxEl.style.cssText = `display:block;left:${x0}px;top:${y0 - scrollY}px;width:${x1 - x0}px;height:${y1 - y0}px`;
  const next = new Set();
  for (const w of page.querySelectorAll('.block')) {
    const r = w.querySelector(':scope>.row').getBoundingClientRect();
    if (r.left < x1 && r.right > x0 && r.top + scrollY < y1 && r.bottom + scrollY > y0)
      next.add(w.dataset.id);
  }
  selected = next;
  for (const w of page.querySelectorAll('.block'))
    w.classList.toggle('sel', next.has(w.dataset.id));
}
function boxLoop() {
  if (!box || !box.moved) return;
  const m = 40,
    dy = box.cy < m ? -12 : box.cy > innerHeight - m ? 12 : 0;
  if (dy) {
    scrollBy(0, dy);
    boxPaint();
  }
  requestAnimationFrame(boxLoop);
}
addEventListener('pointermove', (e) => {
  if (!box) return;
  box.cx = e.clientX;
  box.cy = e.clientY;
  if (!box.moved) {
    if (Math.hypot(e.clientX - box.x, e.clientY + scrollY - box.y) < 5) return;
    box.moved = true;
    document.body.classList.add('boxing');
    closeMenu();
    const el = curEdit();
    if (el) {
      readEdit(el);
      el.blur();
    }
    if (document.activeElement === titleEl) titleEl.blur();
    getSelection().removeAllRanges();
    requestAnimationFrame(boxLoop);
  }
  boxPaint();
});
addEventListener('pointerup', (e) => {
  if (!box) return;
  const b = box;
  if (b.moved) {
    b.cx = e.clientX;
    b.cy = e.clientY;
    boxPaint();
  }
  box = null;
  boxEl.style.display = 'none';
  document.body.classList.remove('boxing');
  if (!b.moved && (b.target.id === 'main' || b.target.id === 'page')) {
    const l = state.blocks[state.blocks.length - 1];
    if (l.type === 'text' && !l.html && !l.children.length) focusBlock(l.id, 0);
    else {
      const n = mk();
      mutate(() => state.blocks.push(n), [n.id, 0]);
    }
  }
});
addEventListener('pointercancel', () => {
  box = null;
  boxEl.style.display = 'none';
  document.body.classList.remove('boxing');
});
document.addEventListener('mousedown', (e) => {
  if (isMargin(e.target)) e.preventDefault();
});

/* ---- aparência e layout da página ---- */
const LAYOUT_DEFAULT = { font: 'sans', small: false, wide: false, toc: false };
const layout = () => ({ ...LAYOUT_DEFAULT, ...state.layout });
function applyLayout() {
  const l = layout(),
    m = $('#main');
  m.className = [
    l.font === 'serif' ? '' : 'f-' + l.font,
    l.small ? 'small' : '',
    l.wide ? 'wide' : '',
  ]
    .filter(Boolean)
    .join(' ');
  document.body.classList.toggle('has-toc', l.toc);
}
function updateToc() {
  const box = $('#toc');
  if (!layout().toc) {
    box.replaceChildren();
    return;
  }
  const hs = flat(state.blocks, [], true).filter(
    (b) => /^h[1-6]$/.test(b.type) && textOf(b.html).trim(),
  );
  box.replaceChildren(
    ...hs.map((b) => {
      const x = document.createElement('button');
      x.className = 'l' + b.type[1];
      x.dataset.id = b.id;
      x.textContent = textOf(b.html);
      return x;
    }),
  );
  if (!hs.length) {
    const n = document.createElement('div');
    n.style.cssText = 'color:var(--muted);padding:3px 6px';
    n.textContent = 'Sem títulos ainda';
    box.appendChild(n);
  }
}
function renderLayout() {
  const l = layout(),
    el = $('#layoutBody'),
    F = [
      ['serif', 'Serifada', 'Georgia,serif'],
      ['sans', 'Sem serifa', 'system-ui,sans-serif'],
      ['mono', 'Mono', 'ui-monospace,monospace'],
    ],
    S = [
      ['small', 'Texto pequeno'],
      ['wide', 'Largura total'],
      ['toc', 'Sumário'],
    ];
  el.innerHTML =
    '<h4>Fonte</h4><div class="fonts">' +
    F.map(
      (f) =>
        `<button data-font="${f[0]}" class="${l.font === f[0] ? 'on' : ''}" aria-pressed="${l.font === f[0]}"><b style="font-family:${f[2]}">Ag</b>${f[1]}</button>`,
    ).join('') +
    '</div><h4>Aparência</h4>' +
    S.map(
      (o) =>
        `<button class="sw" role="switch" aria-checked="${l[o[0]]}" data-sw="${o[0]}">${o[1]}<u></u></button>`,
    ).join('');
}
function setLayout(ch) {
  const el = curEdit();
  if (el) readEdit(el);
  const off = el ? getCaret(el) : 0,
    id = el && el.dataset.id,
    cell = el && el.dataset.cell;
  mutate(
    () => {
      state.layout = { ...layout(), ...ch };
    },
    id ? [id, off, cell] : null,
  );
  renderLayout();
}
const closeLayout = () => {
  $('#layout').style.display = 'none';
  $('#more').setAttribute('aria-expanded', 'false');
};
$('#more').addEventListener('click', () => {
  const el = $('#layout');
  if (el.style.display === 'block') return closeLayout();
  renderLayout();
  el.style.display = 'block';
  const r = $('#more').getBoundingClientRect();
  el.style.left = Math.max(8, r.right - el.offsetWidth) + 'px';
  el.style.top = r.bottom + 6 + 'px';
  $('#more').setAttribute('aria-expanded', 'true');
});
$('#layout').addEventListener('mousedown', (e) => e.preventDefault());
$('#layout').addEventListener('click', (e) => {
  const f = e.target.closest('[data-font]'),
    w = e.target.closest('[data-sw]');
  if (f) setLayout({ font: f.dataset.font });
  else if (w) setLayout({ [w.dataset.sw]: !layout()[w.dataset.sw] });
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#layout') && !e.target.closest('#more')) closeLayout();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLayout();
});
$('#toc').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  const r = page.querySelector(`.block[data-id="${b.dataset.id}"]`);
  if (!r) {
    const path = find(b.dataset.id);
    let p = path && path.parent;
    while (p) {
      p.open = true;
      const u = find(p.id);
      p = u.parent;
    }
    render();
  }
  page
    .querySelector(`.block[data-id="${b.dataset.id}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  focusBlock(b.dataset.id, 'end');
});

/* ---- várias abas e importação ---- */
$('#import').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text();
  const bl = parseText(text);
  let title = state.title;
  if (bl[0] && bl[0].type === 'h1') {
    title = textOf(bl.shift().html);
  }
  mutate(() => {
    state.title = title;
    state.blocks = bl.length ? bl : [mk()];
  });
  titleEl.textContent = title;
  document.title = (title || 'Sem título') + ' · Sophy';
  $('#status').textContent = 'Importado (Ctrl+Z desfaz)';
});

/* ---- controles da tabela ---- */
const tmenu = $('#tmenu');
let tctx = null,
  rzd = null;
const closeTMenu = () => {
  tmenu.style.display = 'none';
  tctx = null;
};
function placeTableUi(td) {
  const tw = td.closest('.tw');
  if (!tw) return;
  const t = tw.querySelector('table'),
    b = tw.getBoundingClientRect(),
    c = td.getBoundingClientRect(),
    tr = t.getBoundingClientRect(),
    i = td.parentElement.rowIndex,
    j = td.cellIndex;
  const col = tw.querySelector('.tg-col'),
    row = tw.querySelector('.tg-row'),
    rz = tw.querySelector('.rz');
  col.dataset.j = j;
  col.style.left = c.left - b.left + c.width / 2 - 14 + 'px';
  col.style.top = '0px';
  col.classList.add('on');
  row.dataset.i = i;
  row.style.left = '1px';
  row.style.top = c.top - b.top + c.height / 2 - 14 + 'px';
  row.classList.add('on');
  rz.dataset.j = j;
  rz.style.left = c.right - b.left + 'px';
  rz.style.top = tr.top - b.top + 'px';
  rz.style.height = tr.height + 'px';
  rz.classList.add('on');
}
page.addEventListener('pointerover', (e) => {
  if (rzd) return;
  const td = e.target.closest && e.target.closest('td');
  if (td) placeTableUi(td);
});
page.addEventListener('focusin', (e) => {
  const td = e.target.closest && e.target.closest('td');
  if (td) placeTableUi(td);
});
function tableOp(b, op, n) {
  const cell = (() => {
    const el = curEdit();
    if (el && el.dataset.id === b.id) readEdit(el);
    return el;
  })();
  const w = b.rows[0].length;
  let foc = '0,0';
  if ((op === 'rowDel' && b.rows.length === 1) || (op === 'colDel' && w === 1))
    return removeBlocks(new Set([b.id]));
  mutate(() => {
    const blank = () => Array(w).fill('');
    if (op === 'rowAbove') {
      b.rows.splice(n, 0, blank());
      foc = n + ',0';
    }
    if (op === 'rowBelow') {
      b.rows.splice(n + 1, 0, blank());
      foc = n + 1 + ',0';
    }
    if (op === 'rowDel') {
      b.rows.splice(n, 1);
      foc = Math.max(0, n - 1) + ',0';
    }
    const wid = (x) => {
      if (b.widths) {
        x === 'del' ? b.widths.splice(n, 1) : b.widths.splice(x, 0, b.widths[n]);
      }
    };
    if (op === 'colLeft') {
      b.rows.forEach((r) => r.splice(n, 0, ''));
      wid(n);
      foc = '0,' + n;
    }
    if (op === 'colRight') {
      b.rows.forEach((r) => r.splice(n + 1, 0, ''));
      wid(n + 1);
      foc = '0,' + (n + 1);
    }
    if (op === 'colDel') {
      b.rows.forEach((r) => r.splice(n, 1));
      wid('del');
      foc = '0,' + Math.max(0, n - 1);
    }
  }, [b.id, 0, foc]);
}
tmenu.addEventListener('mousedown', (e) => e.preventDefault());
tmenu.addEventListener('click', (e) => {
  const t = e.target.closest('[data-op]');
  if (!t || !tctx) return;
  const { b, n } = tctx;
  closeTMenu();
  tableOp(b, t.dataset.op, n);
});
page.addEventListener('mousedown', (e) => {
  if (e.target.closest('.tg,.rz,.ta')) e.preventDefault();
});
page.addEventListener('click', (e) => {
  const g = e.target.closest('.tg');
  if (!g) return;
  const b = find(g.closest('.block').dataset.id).b,
    isCol = g.classList.contains('tg-col'),
    n = +(isCol ? g.dataset.j : g.dataset.i);
  tctx = { b, n };
  const it = (op, ic, l) => `<button class="it" data-op="${op}"><i>${ic}</i>${l}</button>`;
  tmenu.innerHTML = isCol
    ? it('colLeft', '←', 'Inserir à esquerda') +
      it('colRight', '→', 'Inserir à direita') +
      it('colDel', '✕', 'Excluir coluna')
    : it('rowAbove', '↑', 'Inserir acima') +
      it('rowBelow', '↓', 'Inserir abaixo') +
      it('rowDel', '✕', 'Excluir linha');
  tmenu.style.display = 'block';
  const r = g.getBoundingClientRect();
  place(tmenu, r.left, r.bottom + 4, r.top - 4);
});
page.addEventListener('pointerdown', (e) => {
  const z = e.target.closest('.rz');
  if (!z || e.button) return;
  e.preventDefault();
  const tw = z.closest('.tw'),
    t = tw.querySelector('table'),
    b = find(tw.closest('.block').dataset.id).b,
    el = curEdit();
  if (el) readEdit(el);
  const widths = [...t.rows[0].cells].map((c) => c.getBoundingClientRect().width);
  rzd = {
    b,
    t,
    z,
    j: +z.dataset.j,
    x: e.clientX,
    widths,
    w0: widths[+z.dataset.j],
    base: parseFloat(z.style.left),
  };
  applyWidths(t, widths);
  z.classList.add('drag');
  document.body.classList.add('resizing');
});
function applyWidths(t, w) {
  let cg = t.querySelector('colgroup');
  if (!cg) {
    cg = document.createElement('colgroup');
    w.forEach(() => cg.appendChild(document.createElement('col')));
    t.prepend(cg);
  }
  [...cg.children].forEach((c, i) => (c.style.width = w[i] + 'px'));
  t.classList.add('fixed');
  t.style.width = w.reduce((a, x) => a + x, 0) + 'px';
}
addEventListener('pointermove', (e) => {
  if (!rzd) return;
  const nw = Math.max(60, rzd.w0 + e.clientX - rzd.x);
  rzd.widths[rzd.j] = nw;
  applyWidths(rzd.t, rzd.widths);
  rzd.z.style.left = rzd.base + nw - rzd.w0 + 'px';
});
addEventListener('pointerup', () => {
  if (!rzd) return;
  const d = rzd;
  rzd = null;
  document.body.classList.remove('resizing');
  mutate(() => {
    d.b.widths = d.widths.map(Math.round);
  });
});
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#tmenu') && !e.target.closest('.tg')) closeTMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTMenu();
});

/* ---- seleção de texto entre blocos ---- */
let xsel = null,
  xdown = null,
  xapplying = false;
function pointFromXY(x, y) {
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r && [r.startContainer, r.startOffset];
  }
  if (document.caretPositionFromPoint) {
    const r = document.caretPositionFromPoint(x, y);
    return r && [r.offsetNode, r.offset];
  }
  return null;
}
const textOff = (el, n, o) => {
  const p = document.createRange();
  p.selectNodeContents(el);
  p.setEnd(n, o);
  return p.toString().replace(/​/g, '').length;
};
const textEdits = () => [...page.querySelectorAll('.edit:not([data-cell])')];
function hitEdit(x, y) {
  const u = document.elementFromPoint(x, y),
    e = u && u.closest && u.closest('.edit');
  if (e && !e.dataset.cell) {
    const pt = pointFromXY(x, y);
    if (pt && e.contains(pt[0])) return { id: e.dataset.id, off: textOff(e, pt[0], pt[1]) };
    return { id: e.dataset.id, off: 0 };
  }
  let best = null;
  for (const c of textEdits()) {
    const r = c.getBoundingClientRect(),
      d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    if (!best || d < best.d) best = { d, c, r };
  }
  if (!best) return null;
  return {
    id: best.c.dataset.id,
    off: y < best.r.top ? 0 : best.c.textContent.replace(/​/g, '').length,
  };
}
function pointAt(el, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n,
    left = off;
  while ((n = w.nextNode())) {
    if (left <= n.length) return [n, left];
    left -= n.length;
  }
  return [el, el.childNodes.length];
}
const lockEdits = () =>
  page.querySelectorAll('.edit').forEach((e) => (e.contentEditable = 'false'));
function xOrdered() {
  const vis = flat()
      .filter(editable)
      .map((b) => b.id),
    a = vis.indexOf(xsel.a.id),
    f = vis.indexOf(xsel.f.id);
  if (a < 0 || f < 0) return null;
  const fwd = a < f || (a === f && xsel.a.off <= xsel.f.off);
  return {
    s: fwd ? xsel.a : xsel.f,
    e: fwd ? xsel.f : xsel.a,
    ids: vis.slice(Math.min(a, f), Math.max(a, f) + 1),
  };
}
function xPaint() {
  const ea = editOf(xsel.a.id),
    ef = editOf(xsel.f.id);
  if (!ea || !ef) return;
  const [an, ao] = pointAt(ea, xsel.a.off),
    [fn, fo] = pointAt(ef, xsel.f.off);
  getSelection().setBaseAndExtent(an, ao, fn, fo);
  updateTools();
}
function xEnter(a, f) {
  const el = curEdit();
  if (el) readEdit(el);
  closeMenu();
  xsel = { a, f };
  render();
  lockEdits();
  document.activeElement?.blur?.();
  xPaint();
}
function xExit() {
  if (!xsel) return;
  xsel = null;
  getSelection().removeAllRanges();
  page.querySelectorAll('.edit').forEach((e) => (e.contentEditable = 'true'));
  toolsEl.style.display = 'none';
  hideColors();
}
function sliceHtml(el, off, side) {
  const [n, o] = pointAt(el, off),
    r = document.createRange();
  r.selectNodeContents(el);
  side === 'head' ? r.setEnd(n, o) : r.setStart(n, o);
  const b = inert.createElement('div');
  b.appendChild(r.cloneContents());
  return clean(b.innerHTML);
}
function xDelete() {
  const o = xOrdered();
  if (!o) return xExit();
  const sb = find(o.s.id).b,
    eb = find(o.e.id).b,
    se = editOf(o.s.id),
    ee = editOf(o.e.id);
  const code = sb.type === 'code',
    txt = (x) => x.textContent.replace(/​/g, '');
  const head = code ? txt(se).slice(0, o.s.off) : sliceHtml(se, o.s.off, 'head');
  let tail;
  if (eb.type === 'code') {
    const t = txt(ee).slice(o.e.off);
    tail = code ? t : esc(t);
  } else tail = code ? textOf(sliceHtml(ee, o.e.off, 'tail')) : sliceHtml(ee, o.e.off, 'tail');
  const rm = new Set();
  const vis = flat(),
    i0 = vis.findIndex((b) => b.id === o.s.id),
    i1 = vis.findIndex((b) => b.id === o.e.id);
  for (let i = i0 + 1; i <= i1; i++) rm.add(vis[i].id);
  xsel = null;
  pushHistory(false);
  sb.html = head + tail;
  const prune = (l) => {
    for (let i = l.length - 1; i >= 0; i--) {
      const b = l[i];
      prune(b.children);
      if (rm.has(b.id)) {
        if (isFold(b) && !b.open) l.splice(i, 1);
        else l.splice(i, 1, ...b.children);
      }
    }
  };
  prune(state.blocks);
  render();
  save();
  focusBlock(sb.id, o.s.off);
  getSelection().isCollapsed;
  return sb;
}
function xSegments() {
  const o = xOrdered();
  if (!o) return [];
  return o.ids
    .map((id) => {
      const b = find(id).b,
        el = editOf(id),
        len = el.textContent.replace(/​/g, '').length;
      return { id, b, from: id === o.s.id ? o.s.off : 0, to: id === o.e.id ? o.e.off : len };
    })
    .filter((x) => x.b.type !== 'code' && x.from < x.to);
}
function xApply(fn) {
  const segs = xSegments();
  if (!segs.length) return;
  pushHistory(false);
  xapplying = true;
  let target = null;
  const saved = xsel;
  try {
    for (const g of segs) {
      const el = editOf(g.id);
      el.contentEditable = 'true';
      el.focus();
      const [a, ao] = pointAt(el, g.from),
        [b, bo] = pointAt(el, g.to);
      getSelection().setBaseAndExtent(a, ao, b, bo);
      target = fn(el, target);
      readEdit(el);
      el.contentEditable = 'false';
      el.blur();
    }
  } finally {
    xapplying = false;
  }
  xsel = saved;
  render();
  lockEdits();
  xPaint();
  save();
}
function xTool(c) {
  if (/^(bold|italic|underline|strikeThrough)$/.test(c)) {
    xApply((el, t) => {
      const st = document.queryCommandState(c);
      const goal = t === null ? !st : t;
      if (st !== goal) document.execCommand(c);
      return goal;
    });
    return;
  }
  xApply((el) => {
    applyTool(c, el);
    return null;
  });
}
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button || e.pointerType === 'touch') return;
    if (xsel && !e.target.closest('.pop')) {
      if (e.shiftKey) {
        const h = hitEdit(e.clientX, e.clientY);
        if (h) {
          xsel.f = h;
          xPaint();
          e.preventDefault();
        }
        return;
      }
      xExit();
    }
    const ed = e.target.closest && e.target.closest('.edit');
    if (!ed || ed.dataset.cell) {
      xdown = null;
      return;
    }
    if (
      e.shiftKey &&
      lastCaret &&
      !lastCaret.cell &&
      lastCaret.id !== ed.dataset.id &&
      find(lastCaret.id)
    ) {
      const h = hitEdit(e.clientX, e.clientY);
      if (h) {
        const a = { id: lastCaret.id, off: lastCaret.off };
        e.preventDefault();
        xEnter(a, h);
      }
      xdown = null;
      return;
    }
    const h = hitEdit(e.clientX, e.clientY);
    xdown = h && { ...h };
  },
  true,
);
document.addEventListener(
  'mousedown',
  (e) => {
    if (e.shiftKey && xsel && !e.target.closest('.pop')) e.preventDefault();
  },
  true,
);
addEventListener('pointermove', (e) => {
  if (!(e.buttons & 1)) {
    if (!xsel) xdown = null;
    return;
  }
  if (!xdown) return;
  const h = hitEdit(e.clientX, e.clientY);
  if (!h) return;
  if (!xsel) {
    if (h.id !== xdown.id) xEnter(xdown, h);
    return;
  }
  xsel.f = h;
  xPaint();
});
addEventListener('pointerup', () => {
  xdown = null;
  if (xsel) xPaint();
});
document.addEventListener(
  'keydown',
  (e) => {
    if (!xsel) return;
    const mod = e.ctrlKey || e.metaKey,
      k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      xExit();
      return;
    }
    if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      xDelete();
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const b = xDelete();
      const el = b && editOf(b.id);
      if (el && b.type !== 'code') splitEnter(el, find(b.id));
      return;
    }
    if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      xDelete();
      document.execCommand('insertText', false, k);
      return;
    }
    if (mod && k.toLowerCase() === 'z') {
      xExit();
      return;
    }
    if (mod && k.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      xExit();
      selected = new Set(state.blocks.map((x) => x.id));
      render();
      return;
    }
  },
  true,
);
function xClip(e) {
  const s = getSelection();
  if (!s.rangeCount) return;
  const b = inert.createElement('div');
  b.appendChild(s.getRangeAt(0).cloneContents());
  e.clipboardData.setData('text/plain', s.toString());
  e.clipboardData.setData('text/html', b.innerHTML);
  e.preventDefault();
}
document.addEventListener(
  'copy',
  (e) => {
    if (xsel) {
      xClip(e);
      e.stopImmediatePropagation();
    }
  },
  true,
);
document.addEventListener(
  'cut',
  (e) => {
    if (xsel) {
      xClip(e);
      e.stopImmediatePropagation();
      xDelete();
    }
  },
  true,
);
document.addEventListener(
  'paste',
  (e) => {
    if (!xsel) return;
    const b = xDelete(),
      el = b && editOf(b.id);
    e.stopImmediatePropagation();
    if (el) onPaste(e, el);
  },
  true,
);

/* ---- globais ---- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey,
    k = e.key.toLowerCase();
  if (mod && k === 'z' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    closeMenu();
    closeActs();
    const el = curEdit();
    if (el) readEdit(el);
    if (e.shiftKey) restore(redo, hist);
    else restore(hist, redo);
    return;
  }
  if (mod && k === 'y' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    restore(redo, hist);
    return;
  }
  if (e.key === 'Escape' && actsEl.style.display === 'block') {
    closeActs();
    selected.clear();
    render();
    return;
  }
  if (
    selected.size &&
    !curEdit() &&
    document.activeElement !== titleEl &&
    e.target.tagName !== 'INPUT'
  ) {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      closeActs();
      removeBlocks(new Set(selected));
    } else if (k === 'a' && mod) {
      e.preventDefault();
      selected = new Set(state.blocks.map((x) => x.id));
      render();
    } else if (e.key === 'Escape') {
      selected.clear();
      render();
    } else if (mod && k === 'd') {
      e.preventDefault();
      closeActs();
      duplicate(selectedList().map((b) => b.id));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      closeActs();
      const b = flat()
        .filter(editable)
        .filter((x) => selected.has(x.id))
        .pop();
      selected.clear();
      render();
      if (b) focusBlock(b.id, 'end');
    }
  }
});
function selectedList(l = state.blocks, o = []) {
  for (const b of l) {
    if (selected.has(b.id)) o.push(b);
    else selectedList(b.children, o);
  }
  return o;
}
document.addEventListener('copy', (e) => {
  if (!selected.size || curEdit()) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', toMd(selectedList()));
});
document.addEventListener('cut', (e) => {
  if (!selected.size || curEdit()) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', toMd(selectedList()));
  removeBlocks(new Set(selected));
});
document.addEventListener('selectionchange', () => {
  const el = curEdit();
  if (el) lastCaret = { id: el.dataset.id, cell: el.dataset.cell, off: getCaret(el) };
  updateTools();
  if (
    menu &&
    menu.mode === 'slash' &&
    el &&
    document.activeElement === el &&
    getSelection().isCollapsed
  ) {
    const f = find(el.dataset.id);
    if (f) {
      const p = getSelection().getRangeAt(0).cloneRange();
      p.selectNodeContents(el);
      p.setEnd(getSelection().anchorNode, getSelection().anchorOffset);
      if (!/(?:^|\s)\/[^\/\n]*$/.test(p.toString())) closeMenu();
    }
  }
});
document.addEventListener('mousedown', (e) => {
  if (menu && !e.target.closest('#menu')) closeMenu();
  if (
    actsEl.style.display === 'block' &&
    !e.target.closest('#acts') &&
    !e.target.closest('.handle')
  ) {
    closeActs();
    selected.clear();
    render();
  } else if (selected.size && !e.target.closest('.pop') && !e.target.closest('.handle')) {
    selected.clear();
    page.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  }
});
menuEl.addEventListener('mousedown', (e) => e.preventDefault());
menuEl.addEventListener('click', (e) => {
  const t = e.target.closest('[data-t]');
  if (t && menu) applyMenu(t.dataset.t);
});
titleEl.addEventListener('input', () => {
  pushHistory(true);
  if (!titleEl.textContent) titleEl.innerHTML = '';
  state.title = titleEl.textContent;
  document.title = (state.title || 'Sem título') + ' · Sophy';
  save();
});
titleEl.addEventListener('keydown', (e) => {
  if (!titleEl.isContentEditable) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const off = getCaret(titleEl),
      t = titleEl.textContent,
      first = state.blocks[0];
    if (off >= t.length && first.type === 'text' && !first.html && !first.children.length) {
      focusBlock(first.id, 0);
      return;
    }
    const n = mk('text', esc(t.slice(off)));
    titleEl.textContent = t.slice(0, off);
    mutate(() => {
      state.title = t.slice(0, off);
      state.blocks.unshift(n);
    }, [n.id, 0]);
  } else if (e.key === 'ArrowDown') {
    const b = flat().find(editable);
    if (b) {
      e.preventDefault();
      focusBlock(b.id, 0);
    }
  }
});
titleEl.addEventListener('paste', (e) => {
  e.preventDefault();
  document.execCommand(
    'insertText',
    false,
    (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '),
  );
});
document.addEventListener('beforeinput', (e) => {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') e.preventDefault();
});
$('#export').addEventListener('click', () => {
  const a = document.createElement('a'),
    md = (state.title ? `# ${state.title}\n\n` : '') + toMd();
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = (state.title || 'pagina').replace(/[^\w\- ]+/g, '') + '.md';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
});
addEventListener(
  'scroll',
  () => {
    closeMenu();
    updateTools();
  },
  { passive: true },
);
/* ---- identidade da página e comentários locais ---- */
const COVER_COLORS = ['#c6d7c2', '#e9c6ae', '#b9cddb', '#d0c2db', '#d9c995', '#bbcbc7'];
function validCover(c) {
  return typeof c === 'string' &&
    (COVER_COLORS.includes(c) || /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(c))
    ? c
    : '';
}
function renderPageMeta() {
  const icon = state.icon || '',
    cover = validCover(state.cover),
    count = (state.comments || []).filter((c) => !c.resolved).length;
  $('#pageIcon').hidden = !icon;
  const pageIcon = $('#pageIcon');
  pageIcon.replaceChildren();
  if (icon.startsWith('custom:')) {
    const custom = (window.sophyCustomIcons || []).find((item) => item.id === icon.slice(7));
    if (custom?.src) {
      const image = document.createElement('img');
      image.src = custom.src;
      image.alt = '';
      pageIcon.append(image);
    }
  } else pageIcon.textContent = icon;
  $('#addIcon').textContent = icon ? 'Alterar ícone' : '☺ Adicionar ícone';
  $('#pageCover').hidden = !cover;
  $('#pageCover').style.backgroundImage = cover.startsWith('data:') ? `url("${cover}")` : 'none';
  $('#pageCover').style.backgroundColor = cover.startsWith('#') ? cover : '';
  $('#addCover').textContent = cover ? '▧ Alterar capa' : '▧ Adicionar capa';
  const commentsButton = $('#openComments');
  commentsButton.replaceChildren(SophyIcons.icon('comment'));
  commentsButton.title = count ? `Comentários (${count})` : 'Comentários';
  if (count) {
    const badge = document.createElement('span');
    badge.className = 'comment-count';
    badge.textContent = count;
    commentsButton.append(badge);
  }
}
function pageModal(title) {
  closeMenu();
  closeActs();
  closeLayout();
  $('#dialogTitle').textContent = title;
  $('#dialogContent').replaceChildren();
  if (!$('#pageDialog').open) $('#pageDialog').showModal();
  return $('#dialogContent');
}
$('#dialogClose').onclick = () => $('#pageDialog').close();
$('#pageDialog').addEventListener('click', (e) => {
  if (e.target === $('#pageDialog')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      e.target.close();
  }
});
function iconPicker() {
  const host = pageModal('Ícone da página');
  host.innerHTML =
    '<div class="custom-icon-grid" id="customIconGrid"></div><div class="emoji-grid"></div><label for="customIcon">Emoji ou símbolo personalizado</label><input id="customIcon" maxlength="32" placeholder="Ex.: 🌿"><div class="comment-controls"><button id="removeIcon">Remover ícone</button><button id="saveIcon" class="primary">Aplicar</button></div>';
  for (const item of window.sophyCustomIcons || []) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.title = item.name;
    choice.setAttribute('aria-label', 'Usar ícone ' + item.name);
    const image = document.createElement('img');
    image.src = item.src;
    image.alt = '';
    choice.append(image);
    choice.onclick = () => {
      mutate(() => {
        state.icon = 'custom:' + item.id;
      });
      $('#pageDialog').close();
    };
    host.querySelector('#customIconGrid').append(choice);
  }
  for (const emoji of [
    '📝',
    '📚',
    '💡',
    '🌿',
    '✨',
    '🎯',
    '📌',
    '🧠',
    '🚀',
    '🎨',
    '💻',
    '❤️',
    '🌙',
    '🏠',
    '📅',
    '🔬',
    '🎵',
    '🗂️',
  ]) {
    const b = document.createElement('button');
    b.textContent = emoji;
    b.setAttribute('aria-label', 'Usar ícone ' + emoji);
    b.onclick = () => {
      mutate(() => {
        state.icon = emoji;
      });
      $('#pageDialog').close();
    };
    host.querySelector('.emoji-grid').append(b);
  }
  $('#customIcon').value = state.icon || '';
  $('#saveIcon').onclick = () => {
    mutate(() => {
      state.icon = $('#customIcon').value.trim();
    });
    $('#pageDialog').close();
  };
  $('#removeIcon').onclick = () => {
    mutate(() => {
      state.icon = '';
    });
    $('#pageDialog').close();
  };
}
$('#addIcon').onclick = $('#pageIcon').onclick = iconPicker;
function coverPicker() {
  const host = pageModal('Capa da página');
  host.innerHTML =
    '<div class="cover-grid"></div><label for="coverUpload">Enviar imagem</label><input id="coverUpload" type="file" accept="image/png,image/jpeg,image/webp"><p id="coverFeedback" role="status">PNG, JPG ou WebP. A imagem será ajustada para a capa.</p><button id="removeCover">Remover capa</button>';
  COVER_COLORS.forEach((color, i) => {
    const b = document.createElement('button');
    b.style.background = color;
    b.setAttribute('aria-label', 'Capa cor ' + (i + 1));
    b.onclick = () => {
      mutate(() => (state.cover = color));
      $('#pageDialog').close();
    };
    host.querySelector('.cover-grid').append(b);
  });
  $('#removeCover').onclick = () => {
    mutate(() => (state.cover = ''));
    $('#pageDialog').close();
  };
  $('#coverUpload').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size > 20 * 1024 * 1024
      )
        throw Error('Escolha PNG, JPG ou WebP de até 20 MB.');
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement('canvas'),
        ratio = Math.min(1, 1600 / bitmap.width, 900 / bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const cover = canvas.toDataURL('image/jpeg', 0.8);
      mutate(() => (state.cover = cover));
      $('#pageDialog').close();
    } catch (err) {
      $('#coverFeedback').textContent = err.message || 'Não foi possível abrir a imagem.';
    }
  };
}
$('#addCover').onclick = $('#changeCover').onclick = coverPicker;
function commentsPanel() {
  const host = pageModal('Comentários da página');
  host.innerHTML =
    '<p id="commentFeedback">Comentários pessoais salvos neste navegador.</p><div id="commentList"></div><form id="commentForm"><label for="commentText">Seu comentário</label><textarea id="commentText" rows="3" maxlength="10000" placeholder="Escreva um comentário…" required></textarea><div class="comment-controls"><button type="submit" class="primary">Comentar</button></div></form>';
  const list = $('#commentList');
  for (const c of state.comments || []) {
    const item = document.createElement('article');
    item.className = 'comment' + (c.resolved ? ' resolved' : '');
    const author = document.createElement('strong');
    author.textContent = c.resolved ? 'Você · Resolvido' : 'Você';
    const date = document.createElement('time');
    date.dateTime = c.created;
    date.textContent =
      ' · ' +
      (Number.isFinite(Date.parse(c.created)) ? new Date(c.created).toLocaleString('pt-BR') : '');
    const text = document.createElement('p');
    text.textContent = c.text;
    const resolve = document.createElement('button');
    resolve.textContent = c.resolved ? 'Reabrir' : 'Resolver';
    resolve.onclick = () => {
      mutate(() => (c.resolved = !c.resolved));
      commentsPanel();
    };
    item.append(author, date, text, resolve);
    list.append(item);
  }
  if (!list.children.length) list.textContent = 'Nenhum comentário ainda.';
  $('#commentForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#commentText').value.trim();
    if (!text) return;
    mutate(() => {
      state.comments ??= [];
      state.comments.push({
        id: newId(),
        text,
        created: new Date().toISOString(),
        resolved: false,
      });
    });
    commentsPanel();
    $('#commentText').focus();
  };
}
$('#openComments').onclick = commentsPanel;

/* ---- propriedades do sistema e campos definidos pelo usuário ---- */
const PROPERTY_TYPES = {
  text: 'Texto',
  number: 'Número',
  select: 'Seleção',
  multi: 'Múltipla seleção',
  date: 'Data',
  checkbox: 'Checkbox',
  url: 'URL',
};
const PROPERTY_SYMBOLS = {
  text: 'Aa',
  number: '#',
  select: '◉',
  multi: '≡',
  date: '◷',
  checkbox: '☑',
  url: '↗',
};
function validMeta(m) {
  const now = new Date().toISOString();
  return {
    id: typeof m?.id === 'string' ? m.id : newId(),
    createdAt: Number.isFinite(Date.parse(m?.createdAt)) ? m.createdAt : now,
    updatedAt: Number.isFinite(Date.parse(m?.updatedAt)) ? m.updatedAt : now,
  };
}
function validProperties(ps) {
  return Array.isArray(ps)
    ? ps
        .filter((p) => p && Object.hasOwn(PROPERTY_TYPES, p.type))
        .map((p) => ({
          id: String(p.id || newId()),
          name: String(p.name || 'Propriedade').slice(0, 80),
          type: p.type,
          options: Array.isArray(p.options) ? [...new Set(p.options.map(String))] : [],
          value:
            p.type === 'checkbox'
              ? !!p.value
              : p.type === 'multi'
                ? Array.isArray(p.value)
                  ? p.value.map(String)
                  : []
                : String(p.value ?? ''),
        }))
    : [];
}
function renderNoteInfo() {
  const host = $('#noteInfoValues');
  host.replaceChildren();
  const m = state.meta;
  if (!m) return;
  for (const [label, value] of [
    ['Criada em', new Date(m.createdAt).toLocaleString('pt-BR')],
    ['Atualizada em', new Date(m.updatedAt).toLocaleString('pt-BR')],
    ['ID', m.id],
  ]) {
    const dt = document.createElement('dt'),
      dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    host.append(dt, dd);
  }
}
function propertyChange(p, value) {
  pushHistory(false);
  p.value = value;
  save();
}
function renderProperties() {
  const host = $('#noteProperties');
  host.replaceChildren();
  state.properties ??= [];
  state.meta = validMeta(state.meta);
  renderNoteInfo();
  if (!state.properties.length) {
    const empty = document.createElement('p');
    empty.className = 'properties-empty';
    empty.textContent = 'Um espaço para os detalhes da sua nota.';
    host.append(empty);
  }
  for (const p of state.properties) {
    const row = document.createElement('div');
    row.className = 'property-row';
    const name = document.createElement('button');
    name.className = 'property-name';
    const symbol = document.createElement('span');
    symbol.className = 'property-symbol';
    symbol.textContent = PROPERTY_SYMBOLS[p.type];
    const label = document.createElement('span');
    label.textContent = p.name;
    name.append(symbol, label);
    name.title = 'Editar propriedade: ' + p.name;
    name.setAttribute('aria-label', 'Editar propriedade ' + p.name);
    name.onclick = () => propertyEditor(p);
    let input;
    if (p.type === 'checkbox') {
      input = document.createElement('label');
      input.className = 'property-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !!p.value;
      check.setAttribute('aria-label', p.name);
      const text = document.createElement('span');
      text.textContent = check.checked ? 'Sim' : 'Não';
      check.onchange = () => {
        propertyChange(p, check.checked);
        text.textContent = check.checked ? 'Sim' : 'Não';
      };
      input.append(check, text);
    } else if (p.type === 'multi') {
      input = document.createElement('button');
      input.type = 'button';
      input.className = 'property-value property-tags';
      if (p.value.length) {
        p.value.forEach((v, i) => {
          const chip = document.createElement('span');
          chip.className = 'property-tag tag-' + (i % 4);
          chip.textContent = v;
          input.append(chip);
        });
      } else input.textContent = 'Vazio';
      input.onclick = () => {
        const host = pageModal(p.name);
        const hint = document.createElement('p');
        hint.className = 'properties-empty';
        hint.textContent = 'Selecione uma ou mais opções.';
        host.append(hint);
        for (const value of p.options) {
          const label = document.createElement('label');
          label.className = 'option-choice';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = p.value.includes(value);
          checkbox.onchange = () => {
            propertyChange(
              p,
              checkbox.checked ? [...p.value, value] : p.value.filter((v) => v !== value),
            );
            renderProperties();
          };
          const text = document.createElement('span');
          text.textContent = value;
          label.append(checkbox, text);
          host.append(label);
        }
        const done = document.createElement('button');
        done.className = 'primary';
        done.textContent = 'Concluído';
        done.onclick = () => $('#pageDialog').close();
        const actions = document.createElement('div');
        actions.className = 'comment-controls';
        actions.append(done);
        host.append(actions);
      };
    } else if (p.type === 'select') {
      input = document.createElement('select');
      input.multiple = p.type === 'multi';
      if (!input.multiple) {
        const o = document.createElement('option');
        o.value = '';
        o.textContent = 'Vazio';
        input.append(o);
      }
      for (const value of p.options) {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = value;
        o.selected = input.multiple ? p.value.includes(value) : p.value === value;
        input.append(o);
      }
      if (input.multiple) input.size = Math.min(3, Math.max(2, p.options.length));
      input.onchange = () =>
        propertyChange(
          p,
          input.multiple ? [...input.selectedOptions].map((o) => o.value) : input.value,
        );
    } else {
      input = document.createElement('input');
      input.type = { text: 'text', number: 'number', date: 'date', url: 'url' }[p.type];
      if (p.type === 'number') input.step = 'any';
      input.value = p.value;
      input.placeholder = 'Vazio';
      input.onchange = () => {
        if (!input.checkValidity()) {
          input.reportValidity();
          return;
        }
        propertyChange(p, input.value);
      };
    }
    if (p.type !== 'checkbox') {
      if (p.type !== 'multi') input.className = 'property-value property-' + p.type;
      input.setAttribute('aria-label', p.name);
    }
    const remove = document.createElement('button');
    remove.className = 'property-delete';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remover propriedade ' + p.name);
    remove.title = 'Remover propriedade (Ctrl+Z desfaz)';
    remove.onclick = () =>
      mutate(() => (state.properties = state.properties.filter((x) => x.id !== p.id)));
    row.append(name, input, remove);
    host.append(row);
  }
  const add = document.createElement('button');
  add.id = 'addProperty';
  add.setAttribute('aria-label', '+ Adicionar propriedade');
  add.innerHTML = '<span aria-hidden="true">＋</span> Adicionar propriedade';
  add.onclick = () => propertyEditor();
  host.append(add);
}
function propertyEditor(existing) {
  const host = pageModal(existing ? 'Editar propriedade' : 'Nova propriedade');
  host.innerHTML =
    '<form id="propertyForm"><label for="propertyName">Nome</label><input id="propertyName" maxlength="80" placeholder="Ex.: Status, Tags, Prazo" required><label for="propertyType">Tipo</label><select id="propertyType"></select><div id="propertyOptionsField"><label for="propertyOptions">Opções, uma por linha</label><textarea id="propertyOptions" rows="4" placeholder="Rascunho\nEm andamento\nConcluída"></textarea></div><p id="propertyError" role="status"></p><div class="comment-controls"><button type="button" id="propertyCancel">Cancelar</button><button type="submit" class="primary">Salvar propriedade</button></div></form>';
  const type = $('#propertyType');
  for (const [value, label] of Object.entries(PROPERTY_TYPES)) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    type.append(o);
  }
  $('#propertyName').value = existing?.name || '';
  type.value = existing?.type || 'text';
  type.disabled = !!existing;
  $('#propertyOptions').value = (existing?.options || []).join('\n');
  const update = () =>
    ($('#propertyOptionsField').hidden = !['select', 'multi'].includes(type.value));
  type.onchange = update;
  update();
  $('#propertyCancel').onclick = () => $('#pageDialog').close();
  $('#propertyForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#propertyName').value.trim(),
      options = [
        ...new Set(
          $('#propertyOptions')
            .value.split('\n')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
    if (!name) return;
    if (
      state.properties.some(
        (p) => p.id !== existing?.id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      $('#propertyError').textContent = 'Já existe uma propriedade com esse nome.';
      return;
    }
    if (['select', 'multi'].includes(type.value) && !options.length) {
      $('#propertyError').textContent = 'Adicione pelo menos uma opção.';
      return;
    }
    mutate(() => {
      if (existing) {
        existing.name = name;
        existing.options = options;
        if (existing.type === 'select' && !options.includes(existing.value)) existing.value = '';
        if (existing.type === 'multi')
          existing.value = existing.value.filter((v) => options.includes(v));
      } else
        state.properties.push({
          id: newId(),
          name,
          type: type.value,
          options,
          value: type.value === 'checkbox' ? false : type.value === 'multi' ? [] : '',
        });
    });
    $('#pageDialog').close();
  };
  $('#propertyName').focus();
}

load();
titleEl.textContent = state.title;
if (state.title) document.title = state.title + ' · Sophy';
render();
