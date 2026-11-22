/**
 * Cor e fundo no Markdown: <span data-cor="azul" data-fundo="amarelo">texto</span>.
 * Só a paleta fechada passa; style, script e on* saem.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyRich = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COLORS = ['cinza', 'marrom', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa', 'vermelho'];
  const COLOR_SET = new Set(COLORS);

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isColor(value) {
    return COLOR_SET.has(String(value || '').toLowerCase());
  }

  function attrsOf(openTag) {
    const attrs = {};
    for (const match of String(openTag).matchAll(/\b(data-cor|data-fundo)="([a-z]+)"/gi)) {
      const key = match[1].toLowerCase();
      const value = match[2].toLowerCase();
      if (isColor(value)) attrs[key] = value;
    }
    return attrs;
  }

  function openSpan(attrs) {
    const parts = [];
    if (attrs['data-cor']) parts.push(`data-cor="${attrs['data-cor']}"`);
    if (attrs['data-fundo']) parts.push(`data-fundo="${attrs['data-fundo']}"`);
    if (!parts.length) return '';
    return `<span ${parts.join(' ')}>`;
  }

  function decodeEntities(text) {
    return String(text)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function stripDangerous(source) {
    return String(source || '')
      .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  function sanitize(source) {
    let text = stripDangerous(source);
    let out = '';
    let cursor = 0;
    const openRe = /<span\b([^>]*)>/gi;
    while (cursor < text.length) {
      openRe.lastIndex = cursor;
      const open = openRe.exec(text);
      if (!open) {
        out += text.slice(cursor).replace(/<\/?span\b[^>]*>/gi, '');
        break;
      }
      out += text.slice(cursor, open.index).replace(/<\/?span\b[^>]*>/gi, '');
      const attrs = attrsOf(open[0]);
      const after = open.index + open[0].length;
      const closeAt = text.toLowerCase().indexOf('</span>', after);
      if (!Object.keys(attrs).length || closeAt < 0) {
        cursor = after;
        continue;
      }
      const inner = sanitize(text.slice(after, closeAt));
      const openTag = openSpan(attrs);
      if (openTag) out += `${openTag}${inner}</span>`;
      else out += inner;
      cursor = closeAt + 7;
    }
    return out;
  }

  function stripMarkup(source) {
    return sanitize(source)
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<\/?[a-z][^>]*>/gi, '');
  }

  function renderSpans(source, renderInner) {
    const clean = sanitize(source);
    let out = '';
    let cursor = 0;
    const openRe = /<span\b([^>]*)>/gi;
    while (cursor < clean.length) {
      openRe.lastIndex = cursor;
      const open = openRe.exec(clean);
      if (!open) {
        out += renderInner(clean.slice(cursor));
        break;
      }
      out += renderInner(clean.slice(cursor, open.index));
      const attrs = attrsOf(open[0]);
      const after = open.index + open[0].length;
      const closeAt = clean.toLowerCase().indexOf('</span>', after);
      if (!Object.keys(attrs).length || closeAt < 0) {
        out += renderInner(open[0]);
        cursor = after;
        continue;
      }
      const classes = ['marca-cor'];
      if (attrs['data-cor']) classes.push(`marca-cor--${attrs['data-cor']}`);
      if (attrs['data-fundo']) classes.push(`marca-fundo--${attrs['data-fundo']}`);
      const attrHtml = [
        attrs['data-cor'] ? ` data-cor="${attrs['data-cor']}"` : '',
        attrs['data-fundo'] ? ` data-fundo="${attrs['data-fundo']}"` : '',
      ].join('');
      out += `<span class="${classes.join(' ')}"${attrHtml}>${renderSpans(clean.slice(after, closeAt), renderInner)}</span>`;
      cursor = closeAt + 7;
    }
    return out;
  }

  function wrapSelection(text, start, end, patch) {
    const selected = text.slice(start, end);
    if (!selected) return { text, start, end };
    const match = selected.match(/^<span\b([^>]*)>([\s\S]*)<\/span>$/i);
    let attrs = {};
    let inner = selected;
    if (match) {
      attrs = attrsOf(match[0]);
      inner = match[2];
    }
    if (patch.cor === null) delete attrs['data-cor'];
    else if (patch.cor) attrs['data-cor'] = patch.cor;
    if (patch.fundo === null) delete attrs['data-fundo'];
    else if (patch.fundo) attrs['data-fundo'] = patch.fundo;
    const open = openSpan(attrs);
    const next = open ? `${open}${inner}</span>` : inner;
    return {
      text: text.slice(0, start) + next + text.slice(end),
      start,
      end: start + next.length,
    };
  }

  function spanFromNode(el) {
    if (!el || el.tagName !== 'SPAN') return null;
    const attrs = {};
    const cor = el.getAttribute('data-cor');
    const fundo = el.getAttribute('data-fundo');
    if (isColor(cor)) attrs['data-cor'] = cor.toLowerCase();
    if (isColor(fundo)) attrs['data-fundo'] = fundo.toLowerCase();
    if (!Object.keys(attrs).length) return null;
    return attrs;
  }

  return {
    COLORS,
    isColor,
    sanitize,
    stripMarkup,
    renderSpans,
    wrapSelection,
    spanFromNode,
    openSpan,
    escapeHtml,
    decodeEntities,
  };
});
