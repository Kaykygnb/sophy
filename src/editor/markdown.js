/* Markdown interoperability for the Bloco editor. Extended presentation lives in frontmatter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('marked').marked);
  else root.NoteMarkdown = factory(root.marked.marked || root.marked);
})(typeof window === 'object' ? window : globalThis, function (marked) {
  const links =
    typeof module === 'object' && module.exports ? require('../note-links') : window.NoteLinks;
  links.install(marked);
  const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const hash = (text) => {
    text = text.replace(/\r\n/g, '\n');
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  };
  let counter = 0;
  const block = (type, html, extra = {}) => ({
    id: 'md-' + Date.now().toString(36) + '-' + counter++,
    type,
    html,
    children: [],
    ...extra,
  });
  function split(source) {
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    let frontmatter = match ? match[1].replace(/\r/g, '') : '',
      meta = null;
    const line = frontmatter.match(/^notas1_editor: (\{.*\})\s*$/m);
    if (line) {
      try {
        meta = JSON.parse(line[1]);
        frontmatter = frontmatter.replace(line[0], '').replace(/^\n|\n$/g, '');
      } catch {}
    }
    return {
      body: match ? source.slice(match[0].length) : source,
      frontmatter,
      meta,
      eol,
      hadFrontmatter: !!match,
    };
  }
  function decode(source) {
    const info = split(source);
    function convert(tokens) {
      const out = [];
      for (const t of tokens) {
        if (t.type === 'space') continue;
        if (t.type === 'heading' && t.depth <= 6) {
          const alternate = /^>\s+/.test(t.text);
          out.push(
            block(
              'h' + t.depth,
              marked.parseInline(alternate ? t.text.replace(/^>\s+/, '') : t.text),
              alternate ? { fold: true, open: true } : {},
            ),
          );
        } else if (
          ['paragraph', 'text'].includes(t.type) &&
          !/!\[[\s\S]*?\]\(/.test(t.raw) &&
          !t.tokens?.some((x) => x.type === 'image')
        )
          out.push(block('text', marked.parseInline(t.text)));
        else if (t.type === 'list') {
          for (const item of t.items) {
            const nested = [],
              text = [];
            let unsupported = false;
            for (const child of item.tokens) {
              if (child.type === 'list') nested.push(child);
              else if (['text', 'paragraph'].includes(child.type))
                text.push(marked.parseInline(child.text));
              else if (!['space', 'checkbox'].includes(child.type)) unsupported = true;
            }
            if (unsupported || /!\[/.test(item.text)) {
              out.push(block('code', item.raw, { rawMarkdown: true }));
              continue;
            }
            out.push(
              block(item.task ? 'todo' : t.ordered ? 'number' : 'bullet', text.join('<br>'), {
                checked: !!item.checked,
                children: convert(nested),
              }),
            );
          }
        } else if (
          t.type === 'blockquote' &&
          t.tokens.every((x) => ['paragraph', 'space'].includes(x.type))
        )
          out.push(
            block(
              'quote',
              t.tokens
                .filter((x) => x.type === 'paragraph')
                .map((x) => marked.parseInline(x.text))
                .join('<br>'),
            ),
          );
        else if (t.type === 'code') out.push(block('code', t.text, { language: t.lang || '' }));
        else if (t.type === 'hr') out.push(block('divider', ''));
        else if (t.type === 'table')
          out.push(
            block('table', '', {
              rows: [t.header, ...t.rows].map((row) =>
                row.map((cell) => marked.parseInline(cell.text)),
              ),
            }),
          );
        else out.push(block('code', t.raw || '', { rawMarkdown: true }));
      }
      return out;
    }
    const snapshot =
      info.meta?.bodyHash === hash(info.body) && Array.isArray(info.meta?.structure)
        ? info.meta.structure
        : null;
    const blocks = snapshot || convert(marked.lexer(info.body));
    if (!blocks.length) blocks.push(block('text', ''));
    const hints = info.meta?.bodyHash === hash(info.body) ? info.meta.presentation : null;
    const restore = (list, specs) =>
      list.forEach((b, i) => {
        const spec = specs?.[i];
        if (!spec) return;
        for (const key of ['id', 'type', 'color', 'fold', 'open', 'widths', 'language'])
          if (spec[key] !== undefined) b[key] = spec[key];
        if (b.type === 'callout' && b.html.startsWith('💡 ')) b.html = b.html.slice(3);
        restore(b.children, spec.children);
      });
    if (!snapshot && Array.isArray(hints)) restore(blocks, hints);
    return { ...info, blocks, metadata: info.meta?.metadata || {} };
  }
  function body(blocks, inline) {
    const serialize = (list, level = 0) => {
      let number = 0;
      const lines = [];
      let prev = null;
      for (const b of list) {
        number = b.type === 'number' ? number + 1 : 0;
        const indent = '    '.repeat(level),
          text = inline(b.html || '');
        let value;
        if (b.rawMarkdown && b.type === 'code') value = b.html.replace(/\n$/, '');
        else if (b.type === 'code') {
          const matches = b.html.match(/`+/g) || [];
          const fence = '`'.repeat(Math.max(3, ...matches.map((x) => x.length + 1)));
          value = fence + (b.language || '') + '\n' + b.html + '\n' + fence;
        } else if (/^h[1-6]$/.test(b.type))
          value = '#'.repeat(+b.type[1]) + (b.fold ? ' > ' : ' ') + text;
        else if (['bullet', 'number', 'todo', 'toggle'].includes(b.type))
          value =
            (b.type === 'number'
              ? number + '. '
              : b.type === 'todo'
                ? `- [${b.checked ? 'x' : ' '}] `
                : '- ') + text;
        else if (b.type === 'quote' || b.type === 'callout')
          ((value = (b.type === 'callout' ? '💡 ' : '') + text),
            (value = value
              .split('\n')
              .map((l) => '> ' + l)
              .join('\n')));
        else if (b.type === 'divider') value = '---';
        else if (b.type === 'table') {
          const cells = b.rows.map((r) =>
            r.map((c) => inline(c).replace(/\|/g, '\\|').replace(/\n/g, '<br>')),
          );
          value = cells
            .map(
              (r, i) =>
                '| ' +
                r.join(' | ') +
                ' |' +
                (i === 0 ? '\n| ' + r.map(() => '---').join(' | ') + ' |' : ''),
            )
            .join('\n');
        } else value = text;
        value = value
          .split('\n')
          .map((line) => indent + line)
          .join('\n');
        if (b.children.length) value += '\n' + serialize(b.children, level + 1);
        if (
          lines.length &&
          !(
            prev &&
            ['bullet', 'number', 'todo', 'toggle'].includes(prev.type) &&
            ['bullet', 'number', 'todo', 'toggle'].includes(b.type)
          )
        )
          lines.push('');
        lines.push(value);
        prev = b;
      }
      return lines.join('\n');
    };
    return serialize(blocks) + '\n';
  }
  function encode(state, info, inline) {
    const content = body(state.blocks, inline);
    const presentation = (list) =>
      list.map((b) => {
        const p = {};
        for (const k of ['id', 'type', 'color', 'fold', 'open', 'widths', 'language'])
          if (b[k] !== undefined) p[k] = b[k];
        p.children = presentation(b.children);
        return p;
      });
    const metadata = {};
    for (const key of ['icon', 'cover', 'comments', 'meta', 'properties', 'layout'])
      if (state[key] !== undefined) metadata[key] = state[key];
    const meta = {
      version: 1,
      bodyHash: hash(content),
      metadata,
      presentation: presentation(state.blocks),
    };
    const complex = (list) =>
      list.some(
        (b) =>
          (b.children.length && !['bullet', 'number', 'todo', 'toggle'].includes(b.type)) ||
          complex(b.children),
      );
    if (complex(state.blocks)) meta.structure = state.blocks;
    const frontmatter = info.frontmatter ? info.frontmatter + '\n' : '';
    return (
      '---\n' +
      frontmatter +
      'notas1_editor: ' +
      JSON.stringify(meta) +
      '\n---\n' +
      content
    ).replace(/\n/g, info.eol || '\n');
  }
  return { decode, encode, split, body, hash, escape };
});
