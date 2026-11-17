/**
 * Nota visual ↔ Markdown.
 * O arquivo continua .md puro. O que não foi editado volta byte a byte,
 * inclusive frontmatter, wikilinks e a linha de tarefa com 📅 e ⏫.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyDoc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function splitLines(body) {
    const lines = [];
    let index = 0;
    while (index < body.length) {
      const newline = body.indexOf('\n', index);
      if (newline < 0) {
        lines.push(body.slice(index));
        break;
      }
      lines.push(body.slice(index, newline + 1));
      index = newline + 1;
    }
    return lines;
  }

  function lineText(line) {
    return line.replace(/\r?\n$/, '');
  }

  function isFence(line) {
    return lineText(line).startsWith('```');
  }

  function isHeading(line) {
    return /^#{1,6}( |$)/.test(lineText(line));
  }

  function isRule(line) {
    return /^(-{3,}|\*{3,}|_{3,})$/.test(lineText(line));
  }

  function isList(line) {
    return /^(\s*)([-*+]|\d+\.) /.test(lineText(line));
  }

  function isQuote(line) {
    return lineText(line).startsWith('>');
  }

  function isBlank(line) {
    return lineText(line).trim() === '';
  }

  function parseBlocks(body) {
    const lines = splitLines(body);
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (isFence(line)) {
        const chunk = [line];
        index += 1;
        while (index < lines.length && !isFence(lines[index])) {
          chunk.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) {
          chunk.push(lines[index]);
          index += 1;
        }
        blocks.push({ type: 'code', raw: chunk.join('') });
        continue;
      }
      if (isHeading(line)) {
        const marks = lineText(line).match(/^#+/)[0].length;
        blocks.push({ type: 'heading', level: marks, raw: line });
        index += 1;
        continue;
      }
      if (isRule(line)) {
        blocks.push({ type: 'hr', raw: line });
        index += 1;
        continue;
      }
      if (isList(line)) {
        const task = parseTask(line);
        blocks.push({ type: task ? 'task' : 'item', raw: line, task });
        index += 1;
        continue;
      }
      if (isQuote(line)) {
        const chunk = [];
        while (index < lines.length && isQuote(lines[index])) {
          chunk.push(lines[index]);
          index += 1;
        }
        blocks.push({ type: 'quote', raw: chunk.join('') });
        continue;
      }
      if (isBlank(line)) {
        blocks.push({ type: 'blank', raw: line });
        index += 1;
        continue;
      }
      const chunk = [];
      while (
        index < lines.length &&
        !isBlank(lines[index]) &&
        !isFence(lines[index]) &&
        !isHeading(lines[index]) &&
        !isRule(lines[index]) &&
        !isList(lines[index]) &&
        !isQuote(lines[index])
      ) {
        chunk.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: 'paragraph', raw: chunk.join('') });
    }
    return blocks;
  }

  function parseDocument(markdown) {
    const text = typeof markdown === 'string' ? markdown : '';
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const source = bom ? text.slice(1) : text;
    let prefix = null;
    let body = source;
    if (source.startsWith('---\n') || source.startsWith('---\r\n')) {
      const match = source.match(/^---\r?\n[\s\S]*?\r?\n---/);
      if (match) {
        let end = match[0].length;
        if (source[end] === '\r') end += 1;
        if (source[end] === '\n') end += 1;
        prefix = source.slice(0, end);
        body = source.slice(end);
      }
    }
    const blocks = parseBlocks(body);
    return { bom, prefix, body, blocks };
  }

  function serializeDocument(doc) {
    return doc.bom + (doc.prefix ?? '') + doc.blocks.map((block) => block.raw).join('');
  }

  function withBlockRaw(doc, index, raw) {
    const blocks = doc.blocks.map((block, position) =>
      position === index ? { ...block, raw, task: parseTask(raw) } : block,
    );
    return { ...doc, blocks, body: blocks.map((block) => block.raw).join('') };
  }

  function parseInlines(text) {
    const parts = [];
    const pattern = /!?\[\[[^\]\n]*\]\]/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) parts.push({ type: 'text', text: text.slice(last, at) });
      const raw = match[0];
      const inner = raw.slice(raw.startsWith('!') ? 3 : 2, -2);
      parts.push({
        type: raw.startsWith('!') ? 'embed' : 'wikilink',
        raw,
        inner,
        label: linkLabel(inner),
        target: linkTarget(inner),
      });
      last = at + raw.length;
    }
    if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
    if (parts.length === 0) parts.push({ type: 'text', text: '' });
    return parts;
  }

  function serializeInlines(parts) {
    return parts.map((part) => (part.type === 'text' ? part.text : part.raw)).join('');
  }

  function linkTarget(inner) {
    const cut = inner.split('|')[0];
    const hash = cut.indexOf('#');
    return (hash < 0 ? cut : cut.slice(0, hash)).trim();
  }

  function linkLabel(inner) {
    const alias = inner.indexOf('|');
    if (alias >= 0) return inner.slice(alias + 1).trim() || linkTarget(inner);
    const target = linkTarget(inner);
    return target.split('/').pop() || inner.trim();
  }

  function parseTask(line) {
    const text = lineText(line);
    const match = text.match(/^(\s*)([-*+]|\d+\.) \[([ xX/\-])\]\s?(.*)$/);
    if (!match) return null;
    const rest = match[4];
    const emoji = rest.search(/📅|🛫|⏳|✅|⏫|🔼|🔽/);
    const title = (emoji < 0 ? rest : rest.slice(0, emoji)).replace(/\s+$/, '');
    const suffix = emoji < 0 ? '' : rest.slice(emoji);
    return {
      indent: match[1],
      marker: match[2],
      status: match[3],
      title,
      suffix,
      due: dateOf(suffix, '📅'),
      priority: priorityOf(suffix),
    };
  }

  function dateOf(suffix, mark) {
    const match = suffix.match(new RegExp(mark + '\\s*(\\d{4}-\\d{2}-\\d{2})'));
    return match ? match[1] : null;
  }

  function priorityOf(suffix) {
    if (suffix.includes('⏫')) return 'alta';
    if (suffix.includes('🔼')) return 'media';
    if (suffix.includes('🔽')) return 'baixa';
    return null;
  }

  function serializeTask(task) {
    const gap = task.suffix ? ` ${task.suffix.trim()}` : '';
    return `${task.indent}${task.marker} [${task.status}] ${task.title}${gap}`;
  }

  function setTaskStatus(raw, status) {
    return raw.replace(/^(\s*(?:[-*+]|\d+\.) )\[([ xX/\-])\]/, `$1[${status}]`);
  }

  return {
    parseDocument,
    serializeDocument,
    withBlockRaw,
    parseInlines,
    serializeInlines,
    parseTask,
    serializeTask,
    setTaskStatus,
    linkLabel,
    linkTarget,
  };
});
