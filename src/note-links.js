/* Shared internal-link syntax and resolution. Paths are always confined to one area. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoteLinks = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  const blank = (value) => value.replace(/[^\r\n]/g, ' ');
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const norm = (s) => s.normalize('NFC').toLocaleLowerCase();
  function parse(target) {
    const pipe = target.indexOf('|');
    const destination = (pipe < 0 ? target : target.slice(0, pipe)).trim();
    const hash = destination.indexOf('#');
    return {
      target: destination,
      note: (hash < 0 ? destination : destination.slice(0, hash)).trim(),
      anchor: hash < 0 ? '' : destination.slice(hash + 1),
      alias: pipe < 0 ? null : target.slice(pipe + 1),
    };
  }
  function normalize(p, base = '') {
    if (typeof p !== 'string' || /[\x00-\x1f\\:]/.test(p) || p.startsWith('/')) return null;
    const out = base ? base.split('/').filter(Boolean) : [];
    for (const piece of p.split('/')) {
      if (!piece || piece === '.') continue;
      if (piece === '..') {
        if (!out.length) return null;
        out.pop();
      } else {
        if (piece.startsWith('.')) return null;
        out.push(piece);
      }
    }
    return out.join('/');
  }
  const folder = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const basename = (p) => {
    const name = p.split('/').pop();
    return /^Anexos\//i.test(p) ? name : name.replace(/\.md$/i, '');
  };
  function resolve(target, source, paths, format = 'wiki', assetPaths = []) {
    const spec = parse(target);
    let note = spec.note;
    if (format === 'markdown') {
      try {
        note = decodeURIComponent(note);
      } catch {
        return { ...spec, path: null, candidates: [], invalid: true };
      }
    }
    if (!note) return { ...spec, path: source, candidates: [source] };
    if (/[\\:\x00-\x1f]/.test(note) || note.startsWith('/'))
      return { ...spec, path: null, candidates: [], invalid: true };
    if (/^Anexos\//i.test(note) || (!/\.md$/i.test(note) && /\.[^/]+$/.test(note))) {
      const relative = normalize(
        note,
        format === 'markdown' || /^\.\.?\//.test(note) ? folder(source) : '',
      );
      if (relative === null) return { ...spec, path: null, candidates: [], invalid: true };
      let found = assetPaths.filter((asset) => norm(asset) === norm(relative));
      if (!found.length && !note.includes('/') && !/^\.\.?\//.test(note))
        found = assetPaths.filter((asset) => norm(basename(asset)) === norm(note));
      return {
        ...spec,
        path: found.length === 1 ? found[0] : null,
        candidates: found,
        kind: 'attachment',
        invalid: false,
      };
    }
    const suffixed = /\.md$/i.test(note) ? note : note + '.md';
    const by = (p) => (p === null ? [] : paths.filter((x) => norm(x) === norm(p)));
    let found = [];
    if (format === 'markdown' || /^\.\.?\//.test(note))
      found = by(normalize(suffixed, folder(source)));
    else if (note.includes('/')) found = by(normalize(suffixed));
    else {
      found = by(normalize(suffixed, folder(source)));
      if (!found.length) found = paths.filter((x) => norm(basename(x)) === norm(basename(note)));
    }
    return {
      ...spec,
      path: found.length === 1 ? found[0] : null,
      candidates: found,
      invalid:
        normalize(
          suffixed,
          format === 'markdown' || /^\.\.?\//.test(note) ? folder(source) : '',
        ) === null,
    };
  }
  function createPath(target, source, format = 'wiki') {
    const p = parse(target);
    let name = p.note;
    if (format === 'markdown') {
      try {
        name = decodeURIComponent(name);
      } catch {
        return null;
      }
    }
    if (!name) return null;
    const directory = format === 'markdown' || /^\.\.?\//.test(name) ? folder(source) : '';
    const out = normalize(/\.md$/i.test(name) ? name : name + '.md', directory);
    return out &&
      out.split('/').every((x) => x.length <= 160 && !/[<>"|?*]/.test(x) && !/[. ]$/.test(x))
      ? out
      : null;
  }
  function mask(source) {
    let result = source.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (m) => blank(m));
    result = result.replace(/<!--[^]*?-->/g, (m) => blank(m));
    let fence = null;
    result = result
      .split(/(?<=\n)/)
      .map((line) => {
        const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
          const end = m && m[1][0] === fence[0] && m[1].length >= fence.length;
          const hidden = blank(line);
          if (end) fence = null;
          return hidden;
        }
        if (m) {
          fence = m[1];
          return blank(line);
        }
        if (/^(?: {4}|\t)/.test(line) && !/^\s*[-*+\d]/.test(line)) return blank(line);
        return line;
      })
      .join('');
    return result.replace(/(`+)([^]*?)\1/g, (m) => blank(m));
  }
  function scan(source) {
    const masked = mask(source),
      out = [];
    let m;
    const embeds = /(?<!\\)!\[\[([^\[\]\n]+)\]\]/g;
    while ((m = embeds.exec(masked))) {
      const targetStart = m.index + 3;
      out.push({
        ...parse(m[1]),
        format: 'embed',
        start: m.index,
        end: m.index + m[0].length,
        targetStart,
        targetEnd: targetStart + (m[1].includes('|') ? m[1].indexOf('|') : m[1].length),
        raw: source.slice(m.index, m.index + m[0].length),
      });
    }
    const wiki = /(?<!!|\\)\[\[([^\[\]\n]+)\]\]/g;
    while ((m = wiki.exec(masked))) {
      const spec = parse(m[1]);
      if (!spec.target) continue;
      const targetStart = m.index + 2;
      out.push({
        ...spec,
        format: 'wiki',
        start: m.index,
        end: m.index + m[0].length,
        targetStart,
        targetEnd: targetStart + (m[1].includes('|') ? m[1].indexOf('|') : m[1].length),
        raw: source.slice(m.index, m.index + m[0].length),
      });
    }
    const markdown = /(?<!!|\\)\[([^\[\]\n]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
    while ((m = markdown.exec(masked))) {
      if (
        /^[a-z][a-z\d+.-]*:/i.test(m[2]) ||
        !(/\.[a-z\d]{1,12}(?:#|$)/i.test(m[2]) || m[2].startsWith('#'))
      )
        continue;
      const start = m.index + m[0].indexOf('](') + 2;
      out.push({
        ...parse(m[2]),
        format: 'markdown',
        alias: m[1],
        start: m.index,
        end: m.index + m[0].length,
        targetStart: start,
        targetEnd: start + m[2].length,
        raw: source.slice(m.index, m.index + m[0].length),
      });
    }
    return out.sort((a, b) => a.start - b.start);
  }
  function label(target) {
    const p = parse(target);
    return p.alias ?? (p.note ? basename(p.note) + (p.anchor ? ' › ' + p.anchor : '') : p.anchor);
  }
  function anchor(target) {
    const p = parse(target);
    return `<a href="notas1-wiki:${encodeURIComponent(target)}" class="internal-link" title="Abrir ${esc(p.target)}">${esc(label(target))}</a>`;
  }
  function safeHref(href) {
    return (
      /^(https?:|mailto:|notas1-wiki:)/i.test(href) ||
      (!/^[a-z][a-z\d+.-]*:/i.test(href) &&
        !href.startsWith('//') &&
        !href.startsWith('/') &&
        !/[\x00-\x1f\\]/.test(href))
    );
  }
  function install(marked) {
    marked.use({
      extensions: [
        {
          name: 'assetEmbed',
          level: 'inline',
          start: (src) => src.indexOf('![['),
          tokenizer(src) {
            const m = /^!\[\[([^\[\]\n]+)\]\]/.exec(src);
            if (m) return { type: 'assetEmbed', raw: m[0], target: m[1] };
          },
          renderer(token) {
            const spec = parse(token.target),
              ref = encodeURIComponent(spec.note),
              alt = spec.alias ?? basename(spec.note);
            return `<img class="embedded-attachment" src="sophy-asset:${ref}" data-asset-ref="${ref}" alt="${esc(alt)}">`;
          },
        },
        {
          name: 'wikilink',
          level: 'inline',
          start: (src) => src.indexOf('[['),
          tokenizer(src) {
            const m = /^\[\[([^\[\]\n]+)\]\]/.exec(src);
            if (m) return { type: 'wikilink', raw: m[0], target: m[1] };
          },
          renderer(token) {
            return anchor(token.target);
          },
        },
      ],
    });
  }
  function headings(source) {
    const text = mask(source);
    return [...text.matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)]
      .map((m) => ({
        text: m[2]
          .replace(/^>\s+/, '')
          .replace(/\[\[([^\]]+)\]\]/g, (_, s) => label(s))
          .replace(/[*_`]/g, ''),
        level: m[1].length,
      }))
      .filter((h) => h.level <= 6);
  }
  return {
    parse,
    resolve,
    createPath,
    scan,
    mask,
    label,
    anchor,
    safeHref,
    install,
    headings,
    normalize,
    esc,
    basename,
  };
});
