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

  function decorateText(text) {
    const pattern =
      /(\*\*[^*\n]+?\*\*|~~[^~\n]+?~~|==[^=\n]+?==|`[^`\n]+?`|(?<!\*)\*(?!\*)[^*\n]+?\*(?!\*))/g;
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) parts.push({ type: 'text', text: text.slice(last, at) });
      const raw = match[0];
      let type = 'text';
      let inner = raw;
      if (raw.startsWith('**')) {
        type = 'bold';
        inner = raw.slice(2, -2);
      } else if (raw.startsWith('~~')) {
        type = 'strike';
        inner = raw.slice(2, -2);
      } else if (raw.startsWith('==')) {
        type = 'highlight';
        inner = raw.slice(2, -2);
      } else if (raw.startsWith('`')) {
        type = 'code';
        inner = raw.slice(1, -1);
      } else if (raw.startsWith('*')) {
        type = 'italic';
        inner = raw.slice(1, -1);
      }
      parts.push({ type, text: inner, raw });
      last = at + raw.length;
    }
    if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
    return parts.length ? parts : [{ type: 'text', text }];
  }

  function parseInlines(text) {
    const parts = [];
    const pattern = /!?\[\[[^\]\n]*\]\]/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) parts.push(...decorateText(text.slice(last, at)));
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
    if (last < text.length) parts.push(...decorateText(text.slice(last)));
    if (parts.length === 0) parts.push({ type: 'text', text: '' });
    return parts;
  }

  function serializeInlines(parts) {
    return parts.map((part) => part.raw || part.text || '').join('');
  }

  function moveBlock(doc, from, to) {
    if (from === to || from < 0 || to < 0 || from >= doc.blocks.length || to >= doc.blocks.length) return doc;
    const blocks = doc.blocks.slice();
    const [item] = blocks.splice(from, 1);
    blocks.splice(to, 0, item);
    return withBlocks(doc, blocks);
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

  function visibleOf(block) {
    const raw = String(block.raw || '').replace(/\n$/, '');
    if (block.type === 'heading') return raw.replace(/^#{1,6}\s?/, '');
    if (block.type === 'task' && block.task) return block.task.title;
    if (block.type === 'item') return raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '');
    if (block.type === 'quote')
      return raw
        .split('\n')
        .map((line) => line.replace(/^>\s?/, ''))
        .join('\n');
    if (block.type === 'code') return raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '');
    if (block.type === 'blank') return '';
    return raw;
  }

  function rewriteVisible(block, text) {
    const clean = text.replace(/\n$/, '');
    if (block.type === 'heading')
      return { ...block, raw: `${'#'.repeat(block.level || 1)} ${clean.replace(/\n/g, ' ')}\n` };
    if (block.type === 'task' && block.task) {
      const task = { ...block.task, title: clean.replace(/\n/g, ' ') };
      return { ...block, task, raw: `${serializeTask(task)}\n` };
    }
    if (block.type === 'item') {
      const marker = (block.raw.match(/^\s*(?:[-*+]|\d+\.)/) || ['-'])[0];
      return { ...block, raw: `${marker} ${clean}\n` };
    }
    if (block.type === 'quote')
      return {
        ...block,
        raw:
          clean
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n') + '\n',
      };
    if (block.type === 'blank' && clean === '') return { type: 'blank', raw: '\n' };
    if (clean === '') return { type: 'paragraph', raw: '\n' };
    return { type: block.type === 'paragraph' || block.type === 'blank' ? 'paragraph' : block.type, raw: `${clean}\n` };
  }

  function withBlocks(doc, blocks) {
    return { ...doc, blocks, body: blocks.map((block) => block.raw).join('') };
  }

  function splitBlock(doc, index, offset) {
    const block = doc.blocks[index];
    const text = visibleOf(block);
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    const left = rewriteVisible(block, before);
    const right = { type: 'paragraph', raw: `${after}\n` };
    const blocks = doc.blocks.slice();
    const separate = block.type === 'paragraph' || block.type === 'heading' || block.type === 'blank';
    if (separate) blocks.splice(index, 1, left, { type: 'blank', raw: '\n' }, right);
    else blocks.splice(index, 1, left, right);
    return {
      doc: withBlocks(doc, blocks),
      caret: { index: index + (separate ? 2 : 1), offset: 0 },
    };
  }

  function joinBlocks(doc, index) {
    if (index <= 0) return { doc, caret: { index: 0, offset: 0 } };
    let target = index - 1;
    let removeFrom = target;
    if (doc.blocks[target]?.type === 'blank' && target > 0) {
      target -= 1;
      removeFrom = target;
    }
    const offset = visibleOf(doc.blocks[target]).length;
    const merged = visibleOf(doc.blocks[target]) + visibleOf(doc.blocks[index]);
    const blocks = doc.blocks.slice();
    blocks.splice(removeFrom, index - removeFrom + 1, rewriteVisible(doc.blocks[target], merged));
    return { doc: withBlocks(doc, blocks), caret: { index: removeFrom, offset } };
  }

  function pasteLines(doc, index, offset, pasted) {
    const lines = String(pasted).replace(/\r\n/g, '\n').split('\n');
    const block = doc.blocks[index];
    const text = visibleOf(block);
    lines[0] = text.slice(0, offset) + lines[0];
    lines[lines.length - 1] += text.slice(offset);
    const created = [];
    lines.forEach((line, position) => {
      if (position === 0) created.push(rewriteVisible(block, line));
      else {
        created.push({ type: 'blank', raw: '\n' });
        created.push(line === '' ? { type: 'paragraph', raw: '\n' } : { type: 'paragraph', raw: `${line}\n` });
      }
    });
    const blocks = doc.blocks.slice();
    blocks.splice(index, 1, ...created);
    const caretIndex = index + created.length - 1;
    return {
      doc: withBlocks(doc, blocks),
      caret: { index: caretIndex, offset: visibleOf(blocks[caretIndex]).length - text.slice(offset).length },
    };
  }

  function insertInBlock(doc, index, offset, chunk) {
    const block = doc.blocks[index];
    const text = visibleOf(block);
    const next = text.slice(0, offset) + chunk + text.slice(offset);
    const blocks = doc.blocks.slice();
    blocks[index] = rewriteVisible(block.type === 'blank' ? { type: 'paragraph', raw: '\n' } : block, next);
    return { doc: withBlocks(doc, blocks), caret: { index, offset: offset + chunk.length } };
  }

  function wrapPlain(text, start, end, prefix, suffix = prefix) {
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (from === to) {
      return {
        text: text.slice(0, from) + prefix + suffix + text.slice(to),
        cursor: from + prefix.length,
      };
    }
    return {
      text: text.slice(0, from) + prefix + text.slice(from, to) + suffix + text.slice(to),
      cursor: to + prefix.length + suffix.length,
    };
  }

  function wrapBlock(doc, index, start, end, prefix, suffix) {
    const block = doc.blocks[index];
    const wrapped = wrapPlain(visibleOf(block), start, end, prefix, suffix);
    const blocks = doc.blocks.slice();
    blocks[index] = rewriteVisible(block.type === 'blank' ? { type: 'paragraph', raw: '\n' } : block, wrapped.text);
    return { doc: withBlocks(doc, blocks), caret: { index, offset: wrapped.cursor } };
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
    visibleOf,
    splitBlock,
    joinBlocks,
    pasteLines,
    insertInBlock,
    wrapPlain,
    wrapBlock,
    moveBlock,
  };
});
