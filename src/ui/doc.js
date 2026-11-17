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

  function fenceMark(line) {
    const match = lineText(line).match(/^(```+|~~~+)/);
    return match ? match[1] : '';
  }

  function isFence(line) {
    return fenceMark(line).length >= 3;
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

  function isTableLine(line) {
    const text = lineText(line);
    return text.startsWith('|') && text.endsWith('|') && text.length > 1;
  }

  function parseBlocks(body) {
    const lines = splitLines(body);
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (isFence(line)) {
        const open = fenceMark(line);
        const chunk = [line];
        index += 1;
        while (index < lines.length) {
          const mark = fenceMark(lines[index]);
          const trimmed = lineText(lines[index]);
          chunk.push(lines[index]);
          index += 1;
          if (mark && mark[0] === open[0] && mark.length >= open.length && trimmed === mark) break;
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
      if (isTableLine(line)) {
        const chunk = [];
        while (index < lines.length && isTableLine(lines[index])) {
          chunk.push(lines[index]);
          index += 1;
        }
        blocks.push({ type: 'table', raw: chunk.join('') });
        continue;
      }
      if (isBlank(line)) {
        index += 1;
        continue;
      }
      blocks.push({ type: 'paragraph', raw: line.endsWith('\n') ? line : `${line}\n` });
      index += 1;
    }
    return blocks;
  }

  function isListBlock(block) {
    return block && (block.type === 'item' || block.type === 'task');
  }

  function serializeBlocks(blocks) {
    let out = '';
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const prev = blocks[index - 1];
      if (prev && !(isListBlock(prev) && isListBlock(block))) {
        if (!out.endsWith('\n')) out += '\n';
        if (!out.endsWith('\n\n')) out += '\n';
      }
      out += block.raw.endsWith('\n') || block.raw === '' ? block.raw : `${block.raw}\n`;
    }
    return out;
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

  function parseBody(markdown) {
    const text = typeof markdown === 'string' ? markdown : '';
    return { bom: '', prefix: null, body: text, blocks: parseBlocks(text) };
  }

  function codeParts(raw) {
    const text = String(raw || '');
    const openMatch = text.match(/^(```+|~~~+)([^\n]*)\n/);
    if (!openMatch) return { fence: '```', info: '', body: text.replace(/\n$/, '') };
    const fence = openMatch[1];
    const info = openMatch[2];
    let rest = text.slice(openMatch[0].length);
    if (rest.endsWith(`\n${fence}\n`)) rest = rest.slice(0, -(fence.length + 2));
    else if (rest.endsWith(`\n${fence}`)) rest = rest.slice(0, -(fence.length + 1));
    else if (rest.endsWith('\n')) rest = rest.slice(0, -1);
    return { fence, info, body: rest };
  }

  function codeRaw(fence, info, body) {
    return `${fence}${info || ''}\n${body}\n${fence}\n`;
  }

  function splitCells(line) {
    let raw = String(line || '').trim();
    if (raw.startsWith('|')) raw = raw.slice(1);
    if (raw.endsWith('|')) raw = raw.slice(0, -1);
    const cells = [];
    let current = '';
    let wiki = 0;
    for (let index = 0; index < raw.length; index += 1) {
      if (raw[index] === '\\' && raw[index + 1] === '|') {
        current += '\\|';
        index += 1;
        continue;
      }
      if (raw.startsWith('[[', index)) {
        wiki += 1;
        current += '[[';
        index += 1;
        continue;
      }
      if (wiki && raw.startsWith(']]', index)) {
        wiki -= 1;
        current += ']]';
        index += 1;
        continue;
      }
      if (raw[index] === '|' && wiki === 0) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += raw[index];
    }
    cells.push(current.trim());
    return cells;
  }

  function tableModel(raw) {
    const lines = String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('|') && line.endsWith('|'));
    const rows = [];
    let align = null;
    for (const line of lines) {
      const cells = splitCells(line);
      if (cells.length && cells.every((cell) => /^:?-+:?$/.test(cell))) {
        align = cells;
        continue;
      }
      rows.push(cells);
    }
    return { rows, align };
  }

  function tableRaw(rows, align) {
    const width = Math.max(align?.length || 0, ...rows.map((row) => row.length), 1);
    const fit = (row) => Array.from({ length: width }, (_, index) => row[index] || '');
    const aligned = align ? fit(align) : fit(rows[0] || []).map(() => '---');
    const body = (rows.length ? rows : [['']]).map(fit);
    const lines = [
      `| ${body[0].join(' | ')} |`,
      `| ${aligned.join(' | ')} |`,
      ...body.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ];
    return `${lines.join('\n')}\n`;
  }

  function serializeDocument(doc) {
    return doc.bom + (doc.prefix ?? '') + serializeBlocks(doc.blocks);
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
    const pattern = /!?\[\[[^\[\]\n]*\]\]/g;
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
    if (block.type === 'code') return codeParts(block.raw).body;
    if (block.type === 'blank') return '';
    return raw;
  }

  function rewriteVisible(block, text) {
    if (block.type === 'code') {
      const parts = codeParts(block.raw);
      return { ...block, raw: codeRaw(parts.fence, parts.info, text) };
    }
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

  function renumberNumbered(doc) {
    const blocks = doc.blocks.slice();
    let count = 0;
    let run = false;
    for (let index = 0; index < blocks.length; index += 1) {
      const match = blocks[index].type === 'item' && String(blocks[index].raw).match(/^(\s*)(\d+)\. ([\s\S]*)$/);
      if (!match) {
        run = false;
        count = 0;
        continue;
      }
      if (!run) {
        run = true;
        count = 0;
      }
      count += 1;
      if (Number(match[2]) !== count) blocks[index] = { ...blocks[index], raw: `${match[1]}${count}. ${match[3]}` };
    }
    return withBlocks(doc, blocks);
  }

  function isEmbedBlock(block) {
    return !!block && /^!\[\[[^\]\n]+\]\]$/.test(String(block.raw || '').trim());
  }

  function splitBlock(doc, index, offset) {
    const block = doc.blocks[index];
    if (block?.type === 'code') {
      const parts = codeParts(block.raw);
      if (offset >= parts.body.length) {
        const blocks = doc.blocks.slice();
        blocks.splice(index + 1, 0, { type: 'paragraph', raw: '\n' });
        return { doc: withBlocks(doc, blocks), caret: { index: index + 1, offset: 0 } };
      }
      const next = `${parts.body.slice(0, offset)}\n${parts.body.slice(offset)}`;
      const blocks = doc.blocks.slice();
      blocks[index] = { ...block, raw: codeRaw(parts.fence, parts.info, next) };
      return { doc: withBlocks(doc, blocks), caret: { index, offset: offset + 1 } };
    }
    const text = visibleOf(block);
    const before = text.slice(0, offset);
    const after = text.slice(offset);
    if (block.type === 'item' || block.type === 'task' || block.type === 'quote') {
      if (!before.trim() && !after.trim()) {
        const blocks = doc.blocks.slice();
        blocks.splice(index, 1, { type: 'paragraph', raw: '\n' });
        return { doc: withBlocks(doc, blocks), caret: { index, offset: 0 } };
      }
      if (!before.trim()) {
        const blocks = doc.blocks.slice();
        if (block.type === 'task' && block.task) {
          const emptyTask = {
            indent: block.task.indent,
            marker: block.task.marker,
            status: ' ',
            title: '',
            suffix: '',
            due: null,
            priority: null,
          };
          const keptTask = { ...block.task, title: after.replace(/\n/g, ' ') };
          blocks.splice(
            index,
            1,
            { type: 'task', task: emptyTask, raw: `${serializeTask(emptyTask)}\n` },
            { type: 'task', task: keptTask, raw: `${serializeTask(keptTask)}\n` },
          );
        } else {
          blocks.splice(index, 1, rewriteVisible(block, ''), rewriteVisible(block, after));
        }
        return { doc: withBlocks(doc, blocks), caret: { index: index + 1, offset: 0 } };
      }
    }
    if (block.type === 'task' && block.task) {
      const leftTask = { ...block.task, title: before.replace(/\n/g, ' ') };
      const rightTask = {
        indent: block.task.indent,
        marker: block.task.marker,
        status: ' ',
        title: after.replace(/\n/g, ' '),
        suffix: '',
        due: null,
        priority: null,
      };
      const blocks = doc.blocks.slice();
      blocks.splice(
        index,
        1,
        { type: 'task', task: leftTask, raw: `${serializeTask(leftTask)}\n` },
        { type: 'task', task: rightTask, raw: `${serializeTask(rightTask)}\n` },
      );
      return { doc: withBlocks(doc, blocks), caret: { index: index + 1, offset: 0 } };
    }
    if (block.type === 'quote') {
      const blocks = doc.blocks.slice();
      blocks.splice(index, 1, rewriteVisible(block, before), rewriteVisible(block, after));
      return { doc: withBlocks(doc, blocks), caret: { index: index + 1, offset: 0 } };
    }
    if (block.type === 'item') {
      const blocks = doc.blocks.slice();
      const left = rewriteVisible(block, before);
      const numbered = String(block.raw).match(/^(\s*)(\d+)\./);
      const right = numbered
        ? { type: 'item', raw: `${numbered[1]}${Number(numbered[2]) + 1}. ${after}\n` }
        : rewriteVisible(block, after);
      blocks.splice(index, 1, left, right);
      return { doc: renumberNumbered(withBlocks(doc, blocks)), caret: { index: index + 1, offset: 0 } };
    }
    const left = rewriteVisible(block, before);
    const right = { type: 'paragraph', raw: `${after}\n` };
    const blocks = doc.blocks.slice();
    blocks.splice(index, 1, left, right);
    return { doc: withBlocks(doc, blocks), caret: { index: index + 1, offset: 0 } };
  }

  function replaceBlock(doc, index, raw) {
    const parsed = parseDocument(raw).blocks;
    const clean = parsed.filter((block, position) => parsed.length === 1 || block.type !== 'blank' || position !== parsed.length - 1);
    const blocks = doc.blocks.slice();
    blocks.splice(index, 1, ...(clean.length ? clean : [{ type: 'paragraph', raw: '\n' }]));
    return withBlocks(doc, blocks);
  }

  function isEmptyJoin(block) {
    if (!block) return false;
    if (block.type === 'blank') return true;
    return (block.type === 'paragraph' || block.type === 'heading') && visibleOf(block).trim() === '';
  }

  function joinBlocks(doc, index) {
    if (index <= 0) return { doc, caret: { index: 0, offset: 0 } };
    const above = doc.blocks[index - 1];
    if (isEmptyJoin(above)) {
      const blocks = doc.blocks.slice();
      blocks.splice(index - 1, 1);
      const target = index - 2;
      if (target < 0) return { doc: withBlocks(doc, blocks), caret: { index: 0, offset: 0 } };
      return { doc: withBlocks(doc, blocks), caret: { index: target, offset: visibleOf(blocks[target]).length } };
    }
    if (isEmbedBlock(above) || isEmbedBlock(doc.blocks[index])) {
      return { doc, caret: { index, offset: 0 } };
    }
    if (above.type === 'task' && above.task && doc.blocks[index].type === 'task' && doc.blocks[index].task) {
      const upper = above.task;
      const lower = doc.blocks[index].task;
      const keeper = lower.suffix || lower.due || lower.priority || lower.status !== ' ' ? lower : upper;
      const gap = upper.title && lower.title ? ' ' : '';
      const task = { ...keeper, title: `${upper.title}${gap}${lower.title}`.trim() };
      const blocks = doc.blocks.slice();
      blocks.splice(index - 1, 2, { type: 'task', task, raw: `${serializeTask(task)}\n` });
      return { doc: withBlocks(doc, blocks), caret: { index: index - 1, offset: `${upper.title}${gap}`.length } };
    }
    const left = visibleOf(above);
    const right = visibleOf(doc.blocks[index]);
    const gap = left && right && !/\s$/.test(left) && !/^\s/.test(right) ? ' ' : '';
    const blocks = doc.blocks.slice();
    blocks.splice(index - 1, 2, rewriteVisible(above, `${left}${gap}${right}`));
    return { doc: withBlocks(doc, blocks), caret: { index: index - 1, offset: left.length + gap.length } };
  }

  function joinForward(doc, index) {
    if (!doc.blocks[index + 1])
      return { doc, caret: { index, offset: visibleOf(doc.blocks[index]).length } };
    if (doc.blocks[index + 1].type === 'blank' && doc.blocks[index + 2]) {
      const blocks = doc.blocks.slice();
      blocks.splice(index + 1, 1);
      return joinBlocks(withBlocks(doc, blocks), index + 1);
    }
    return joinBlocks(doc, index + 1);
  }

  function pasteLines(doc, index, offset, pasted, end = offset) {
    const block = doc.blocks[index] || { type: 'paragraph', raw: '\n' };
    if (block.type === 'code') {
      const parts = codeParts(block.raw);
      const from = Math.min(offset, end);
      const to = Math.max(offset, end);
      const body = parts.body.slice(0, from) + String(pasted) + parts.body.slice(to);
      const blocks = doc.blocks.slice();
      blocks[index] = { ...block, raw: codeRaw(parts.fence, parts.info, body) };
      return { doc: withBlocks(doc, blocks), caret: { index, offset: from + String(pasted).length } };
    }
    const text = visibleOf(block);
    const from = Math.min(offset, end);
    const to = Math.max(offset, end);
    const before = text.slice(0, from);
    const after = text.slice(to);
    const source = `${before}${String(pasted).replace(/\r\n/g, '\n')}${after}`;
    const parsed = parseBody(source.endsWith('\n') ? source : `${source}\n`).blocks;
    const created = parsed.length ? parsed : [{ type: 'paragraph', raw: '\n' }];
    const blocks = doc.blocks.slice();
    const at = doc.blocks[index] ? index : blocks.length;
    blocks.splice(at, doc.blocks[index] ? 1 : 0, ...created);
    const caretIndex = at + created.length - 1;
    const last = visibleOf(blocks[caretIndex]);
    return {
      doc: withBlocks(doc, blocks),
      caret: { index: caretIndex, offset: Math.max(0, last.length - after.length) },
    };
  }

  function insertInBlock(doc, index, offset, chunk) {
    const block = doc.blocks[index];
    if (block?.type === 'code') {
      const parts = codeParts(block.raw);
      const body = parts.body.slice(0, offset) + chunk + parts.body.slice(offset);
      const blocks = doc.blocks.slice();
      blocks[index] = { ...block, raw: codeRaw(parts.fence, parts.info, body) };
      return { doc: withBlocks(doc, blocks), caret: { index, offset: offset + chunk.length } };
    }
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
    parseBody,
    codeParts,
    codeRaw,
    splitCells,
    tableModel,
    tableRaw,
    serializeDocument,
    serializeBlocks,
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
    replaceBlock,
    joinBlocks,
    joinForward,
    pasteLines,
    insertInBlock,
    wrapPlain,
    wrapBlock,
    moveBlock,
  };
});
