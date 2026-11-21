/* Comportamentos de escrita do editor Bloco, adaptados ao modelo Markdown atual.
 * Este módulo não define estilos, cores, dimensões ou componentes visuais. */
(function (root, factory) {
  const api = factory(root.marked, root.SophyDoc);
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../editor/marked'), require('./doc'));
  else root.SophyWriting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (marked, Doc) {
  const escape = (text) =>
    String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const textTags = { strong: 'strong', em: 'em', del: 's', codespan: 'code' };

  function inlineHtml(source, broken = () => false) {
    const plain = (text) => {
      const pattern = /(!?\[\[[^\[\]\n]+\]\]|==[^=\n]+==)/g;
      let result = '',
        start = 0;
      for (const match of String(text).matchAll(pattern)) {
        result += escape(text.slice(start, match.index));
        if (match[0].startsWith('=='))
          result += `<mark class="marca">${inlineHtml(match[0].slice(2, -2), broken)}</mark>`;
        else {
          const raw = match[0],
            inner = raw.slice(raw.startsWith('!') ? 3 : 2, -2);
          result += `<a href="#" class="wikilink${broken(raw) ? ' wikilink--quebrado' : ''}" contenteditable="false" data-raw="${escape(raw)}" data-target="${escape(Doc.linkTarget(inner))}">${escape(Doc.linkLabel(inner))}</a>`;
        }
        start = match.index + match[0].length;
      }
      return result + escape(text.slice(start));
    };
    const render = (tokens) =>
      tokens
        .map((token) => {
          if (token.type === 'codespan') return `<code>${escape(token.text)}</code>`;
          if (textTags[token.type])
            return `<${textTags[token.type]}>${render(token.tokens || [])}</${textTags[token.type]}>`;
          if (token.type === 'br') return '<br>';
          if (token.type === 'link')
            return `<a href="#" class="wikilink" data-href="${escape(token.href)}" data-target="${escape(token.href)}">${render(token.tokens || [])}</a>`;
          if (token.type === 'html')
            return /^<\/?u>$|^<br\s*\/?>$/i.test(token.raw) ? token.raw : escape(token.raw);
          if (token.type === 'escape') return escape(token.text);
          return plain(token.text === undefined ? token.raw : token.text);
        })
        .join('');
    return render(marked.Lexer.lexInline(String(source)));
  }

  function markdown(node) {
    const wrap = (value, mark) => {
      if (!value.trim()) return value;
      const left = value.match(/^\s*/)[0],
        right = value.match(/\s*$/)[0];
      return left + mark + value.slice(left.length, value.length - right.length) + mark + right;
    };
    const walk = (el) => {
      if (el.nodeType === 3) return el.textContent.replace(/\u200b/g, '').replace(/\u00a0/g, ' ');
      if (el.nodeType !== 1 && el.nodeType !== 11) return '';
      if (el.dataset?.raw) return el.dataset.raw;
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|META|LINK)$/.test(el.tagName)) return '';
      if (el.tagName === 'BR') return '  \n';
      const inner = [...el.childNodes].map(walk).join('');
      if (/^(B|STRONG)$/.test(el.tagName)) return wrap(inner, '**');
      if (/^(I|EM)$/.test(el.tagName)) return wrap(inner, '*');
      if (/^(S|DEL|STRIKE)$/.test(el.tagName)) return wrap(inner, '~~');
      if (el.tagName === 'MARK') return wrap(inner, '==');
      if (el.tagName === 'U') return `<u>${inner}</u>`;
      if (el.tagName === 'CODE') {
        if (!inner) return '';
        const fence = '`'.repeat(
          Math.max(1, ...[...inner.matchAll(/`+/g)].map((match) => match[0].length + 1)),
        );
        return `${fence}${/^`|`$/.test(inner) ? ' ' : ''}${inner}${/^`|`$/.test(inner) ? ' ' : ''}${fence}`;
      }
      if (el.tagName === 'A') {
        const href = el.dataset?.href || el.getAttribute('href') || '';
        if (/^(javascript|data|vbscript):/i.test(href)) return inner;
        return `[${inner}](${href.replace(/\)/g, '%29')})`;
      }
      return inner;
    };
    return [...node.childNodes].map(walk).join('');
  }

  function editable(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return (
      el?.closest('#coluna [data-block][contenteditable="true"], #coluna [data-writing-locked]') ||
      null
    );
  }

  function slice(el, node, offset, side) {
    const range = document.createRange();
    range.selectNodeContents(el);
    if (side === 'head') range.setEnd(node, offset);
    else range.setStart(node, offset);
    const box = document.createElement('div');
    box.append(range.cloneContents());
    return el.matches('pre') ? box.textContent : markdown(box);
  }

  function selection() {
    const current = getSelection();
    if (!current?.rangeCount) return null;
    const range = current.getRangeAt(0);
    const first = editable(range.startContainer),
      last = editable(range.endContainer);
    if (!first || !last) return null;
    return {
      range,
      first,
      last,
      start: Number(first.dataset.block),
      end: Number(last.dataset.block),
      collapsed: range.collapsed,
    };
  }

  function point(el, offset) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    if (offset <= 0) return [el, 0];
    return [el, el.childNodes.length];
  }

  function place(el, offset = 0) {
    if (!el) return;
    el.focus();
    getSelection().setBaseAndExtent(...point(el, offset), ...point(el, offset));
  }

  function normalizeInline(el) {
    const current = getSelection();
    const range = current?.rangeCount ? current.getRangeAt(0) : null;
    const inside = range && el.contains(range.startContainer) && el.contains(range.endContainer);
    const offset = (node, at) => {
      const prefix = document.createRange();
      prefix.selectNodeContents(el);
      prefix.setEnd(node, at);
      return prefix.toString().length;
    };
    const start = inside ? offset(range.startContainer, range.startOffset) : 0;
    const end = inside ? offset(range.endContainer, range.endOffset) : 0;
    let changed = false;
    for (const node of el.querySelectorAll('b,i,strike')) {
      const replacement = document.createElement(
        { B: 'strong', I: 'em', STRIKE: 's' }[node.tagName],
      );
      replacement.append(...node.childNodes);
      node.replaceWith(replacement);
      changed = true;
    }
    if (inside && changed) current.setBaseAndExtent(...point(el, start), ...point(el, end));
  }

  const LIVE_MARK =
    /(\[\[[^\[\]\n]+\]\]|\*\*[^*\n]+?\*\*|~~[^~\n]+?~~|==[^=\n]+?==|`[^`\n]+?`|(?<!\*)\*(?!\s)[^*\n]+?\*(?!\*))/;

  function caretOffset(el) {
    const current = getSelection();
    if (!current?.rangeCount || !el.contains(current.anchorNode)) return markdown(el).length;
    const range = current.getRangeAt(0).cloneRange();
    range.selectNodeContents(el);
    range.setEnd(current.anchorNode, current.anchorOffset);
    const box = document.createElement('div');
    box.append(range.cloneContents());
    return markdown(box).length;
  }

  function liveMarks(el, toHtml = inlineHtml) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) {
      if (current.parentElement?.closest('strong, em, s, code, mark, a')) continue;
      nodes.push(current);
    }
    for (const node of nodes) {
      const match = node.textContent.match(LIVE_MARK);
      if (!match) continue;
      const start = match.index || 0;
      const html = toHtml(match[0]);
      const holder = document.createElement('span');
      holder.innerHTML = html;
      const frag = document.createDocumentFragment();
      if (start > 0) frag.append(document.createTextNode(node.textContent.slice(0, start)));
      let placed = null;
      [...holder.childNodes].forEach((child) => {
        if (!placed && child.nodeType === Node.ELEMENT_NODE) placed = child;
        frag.append(child);
      });
      if (start + match[0].length < node.textContent.length) {
        frag.append(document.createTextNode(node.textContent.slice(start + match[0].length)));
      }
      node.parentNode.replaceChild(frag, node);
      const selection = getSelection();
      const range = document.createRange();
      if (placed) range.setStartAfter(placed);
      else range.setStart(el, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    return false;
  }

  function bindField(el, hooks = {}) {
    const broken = hooks.broken || (() => false);
    const html = (source) => inlineHtml(source, broken);
    const sync = () => {
      normalizeInline(el);
      liveMarks(el, html);
      const text = markdown(el).replace(/\u200b/g, '');
      hooks.onChange?.(text, el);
    };
    el.addEventListener('compositionstart', () => {
      el.dataset.composing = '1';
    });
    el.addEventListener('compositionend', () => {
      delete el.dataset.composing;
      sync();
    });
    el.addEventListener('input', (event) => {
      if (event.isComposing || el.dataset.composing) return;
      sync();
    });
    el.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopPropagation();
        document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()]);
        normalizeInline(el);
        sync();
      }
    });
    el.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text/plain');
      if (text == null) return;
      event.preventDefault();
      document.execCommand('insertText', false, text);
    });
    el.addEventListener('blur', () => {
      const text = markdown(el).replace(/\u200b/g, '');
      hooks.onBlur?.(text, el);
    });
    return { sync, html, read: () => markdown(el).replace(/\u200b/g, ''), caret: () => caretOffset(el) };
  }

  function create(options) {
    const { getDoc, setDoc, checkpoint, paint, save, sync } = options;
    let locked = [];
    const editList = () => [
      ...document.querySelectorAll(
        '#coluna [data-block][contenteditable="true"], #coluna [data-writing-locked]',
      ),
    ];
    const unlock = () => {
      for (const el of locked) {
        el.contentEditable = 'true';
        delete el.dataset.writingLocked;
      }
      locked = [];
    };
    const commit = (doc, index, offset = 0, cell) => {
      setDoc(doc);
      paint();
      place(
        document.querySelector(
          `#coluna [data-block="${index}"][${cell ? `data-cell="${cell}"` : 'contenteditable="true"'}]`,
        ),
        offset,
      );
      save();
    };
    const replaceAcross = (text = '') => {
      const found = selection();
      if (
        !found ||
        found.first === found.last ||
        found.first.dataset.cell ||
        found.last.dataset.cell
      )
        return false;
      unlock();
      checkpoint(true);
      const { first, last, start, end, range } = found;
      const head = slice(first, range.startContainer, range.startOffset, 'head');
      const tail = slice(last, range.endContainer, range.endOffset, 'tail');
      let doc = Doc.setVisible(getDoc(), start, head + text + tail);
      const blocks = doc.blocks.slice();
      blocks.splice(start + 1, end - start);
      commit({ ...doc, blocks }, start, 0);
      // Os offsets Markdown também contam marcas invisíveis; posicionar pela fatia DOM.
      const el = document.querySelector(`#coluna [data-block="${start}"][contenteditable="true"]`);
      const box = document.createElement('div');
      box.innerHTML = inlineHtml(head);
      place(el, box.textContent.length + text.length);
      return true;
    };

    function format(prefix) {
      const found = selection();
      if (!found) return false;
      const command = { '**': 'bold', '*': 'italic', '~~': 'strikeThrough', '<u>': 'underline' }[
        prefix
      ];
      if (!command && prefix !== '==' && prefix !== '`') return false;
      unlock();
      checkpoint(true);
      const { first, last, range } = found;
      const edits = editList();
      const targets = edits.slice(edits.indexOf(first), edits.indexOf(last) + 1);
      options.applying(true);
      try {
        for (const el of targets) {
          const selected = document.createRange();
          selected.selectNodeContents(el);
          if (el === first) selected.setStart(range.startContainer, range.startOffset);
          if (el === last) selected.setEnd(range.endContainer, range.endOffset);
          el.focus();
          getSelection().removeAllRanges();
          getSelection().addRange(selected);
          if (command) document.execCommand(command);
          else {
            const tag = prefix === '`' ? 'code' : 'mark';
            const ancestor = (
              selected.commonAncestorContainer.nodeType === 1
                ? selected.commonAncestorContainer
                : selected.commonAncestorContainer.parentElement
            ).closest(tag);
            if (ancestor && el.contains(ancestor) && selected.collapsed) {
              const head = document.createRange(),
                tail = document.createRange();
              head.selectNodeContents(ancestor);
              head.setEnd(selected.startContainer, selected.startOffset);
              tail.selectNodeContents(ancestor);
              tail.setStart(selected.endContainer, selected.endOffset);
              const before = ancestor.cloneNode(false),
                after = ancestor.cloneNode(false),
                cursor = document.createTextNode('\u200b');
              before.append(head.cloneContents());
              after.append(tail.cloneContents());
              ancestor.replaceWith(
                ...(before.textContent.replace(/\u200b/g, '') ? [before] : []),
                cursor,
                ...(after.textContent.replace(/\u200b/g, '') ? [after] : []),
              );
              getSelection().setBaseAndExtent(cursor, 1, cursor, 1);
            } else if (ancestor && el.contains(ancestor))
              ancestor.replaceWith(...ancestor.childNodes);
            else {
              const mark = document.createElement(tag);
              if (tag === 'mark') mark.className = 'marca';
              mark.append(selected.extractContents());
              if (!mark.childNodes.length) mark.textContent = '\u200b';
              selected.insertNode(mark);
              place(mark, mark.textContent.length);
            }
          }
          if (!found.collapsed) normalizeInline(el);
          sync(el);
        }
      } finally {
        options.applying(false);
      }
      save();
      return true;
    }

    function tableKey(event, el) {
      if (
        !['Tab', 'Enter', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
        event.ctrlKey ||
        event.metaKey
      )
        return false;
      if (event.key === 'Enter' && event.shiftKey) return false;
      event.preventDefault();
      const index = Number(el.dataset.block),
        [row, column] = el.dataset.cell.split(':').map(Number);
      const model = Doc.tableModel(getDoc().blocks[index].raw);
      let nextRow = row,
        nextColumn = column;
      if (event.key === 'Tab') {
        const next = Math.max(0, row * model.rows[0].length + column + (event.shiftKey ? -1 : 1));
        nextRow = Math.floor(next / model.rows[0].length);
        nextColumn = next % model.rows[0].length;
      } else nextRow = Math.max(0, row + (event.key === 'ArrowUp' ? -1 : 1));
      if (nextRow >= model.rows.length) {
        if (event.key.startsWith('Arrow')) return true;
        checkpoint(true);
        model.rows.push(model.rows[0].map(() => ''));
        commit(
          Doc.withBlockRaw(getDoc(), index, Doc.tableRaw(model.rows, model.align)),
          index,
          0,
          `${nextRow}:${nextColumn}`,
        );
      } else
        place(
          document.querySelector(`[data-block="${index}"][data-cell="${nextRow}:${nextColumn}"]`),
        );
      return true;
    }

    function key(event, el) {
      if (event.isComposing || event.keyCode === 229) return true;
      const mod = event.ctrlKey || event.metaKey,
        block = getDoc()?.blocks[Number(el.dataset.block)];
      if (!block || document.querySelector('.menu-flutuante[role="listbox"]')) return false;
      if (el.dataset.cell && tableKey(event, el)) return true;
      if (
        mod &&
        !event.altKey &&
        ['b', 'i', 'u'].includes(event.key.toLowerCase()) &&
        block.type !== 'code'
      ) {
        event.preventDefault();
        event.stopPropagation();
        return format({ b: '**', i: '*', u: '<u>' }[event.key.toLowerCase()]);
      }
      if (mod && event.key.toLowerCase() === 'a' && !el.dataset.cell) {
        const current = getSelection();
        if (
          !el.textContent ||
          (!current.isCollapsed && current.toString().length >= el.textContent.length)
        ) {
          event.preventDefault();
          const edits = [
            ...document.querySelectorAll('#coluna [data-block][contenteditable="true"]'),
          ].filter((node) => !node.dataset.cell);
          if (edits.length)
            current.setBaseAndExtent(
              ...point(edits[0], 0),
              ...point(edits.at(-1), edits.at(-1).textContent.length),
            );
          return true;
        }
      }
      if (
        event.key === 'Tab' &&
        !event.altKey &&
        !el.dataset.cell &&
        (block.type === 'item' || block.type === 'task')
      ) {
        event.preventDefault();
        checkpoint(true);
        const index = Number(el.dataset.block),
          doc = getDoc();
        if (!event.shiftKey && index === 0) return true;
        const raw = event.shiftKey ? block.raw.replace(/^ {1,2}/, '') : '  ' + block.raw;
        const offset = getSelection().anchorOffset;
        commit(Doc.renumberNumbered(Doc.withBlockRaw(doc, index, raw)), index, offset);
        return true;
      }
      if (
        ['ArrowUp', 'ArrowDown'].includes(event.key) &&
        !mod &&
        !event.shiftKey &&
        !el.dataset.cell &&
        getSelection().isCollapsed
      ) {
        const rect = getSelection().getRangeAt(0).getBoundingClientRect(),
          bounds = el.getBoundingClientRect();
        const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
        const up = event.key === 'ArrowUp';
        if (
          rect.height &&
          (up ? rect.top - bounds.top < line * 0.7 : bounds.bottom - rect.bottom < line * 0.7)
        ) {
          const edits = [
            ...document.querySelectorAll('#coluna [data-block][contenteditable="true"]'),
          ].filter((node) => !node.dataset.cell);
          const next = edits[edits.indexOf(el) + (up ? -1 : 1)];
          if (next) {
            event.preventDefault();
            place(next, up ? next.textContent.length : 0);
            return true;
          }
        }
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'd' && !el.dataset.cell) {
        event.preventDefault();
        checkpoint(true);
        const index = Number(el.dataset.block),
          doc = getDoc(),
          blocks = doc.blocks.slice();
        blocks.splice(index + 1, 0, structuredClone(block));
        commit({ ...doc, blocks }, index + 1, el.textContent.length);
        return true;
      }
      if (block.type === 'code' && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault();
        checkpoint(true);
        const index = Number(el.dataset.block);
        if (mod && event.key === 'Enter') {
          const doc = getDoc(),
            blocks = doc.blocks.slice();
          blocks.splice(index + 1, 0, { type: 'paragraph', raw: '\n' });
          commit({ ...doc, blocks }, index + 1);
        } else {
          const found = selection();
          const head = slice(el, found.range.startContainer, found.range.startOffset, 'head');
          const tail = slice(el, found.range.endContainer, found.range.endOffset, 'tail');
          const chunk = event.key === 'Tab' ? '  ' : '\n';
          commit(
            Doc.setVisible(getDoc(), index, head + chunk + tail),
            index,
            head.length + chunk.length,
          );
        }
        return true;
      }
      if (event.key === 'Enter' && !mod && !el.dataset.cell && el.dataset.toggle !== '1') {
        event.preventDefault();
        checkpoint(true);
        if (event.shiftKey) {
          document.execCommand('insertLineBreak');
          sync(el);
          save();
          return true;
        }
        const found = selection();
        if (!found || found.first !== el || found.last !== el) return false;
        const { range } = found,
          index = Number(el.dataset.block);
        const head = slice(el, range.startContainer, range.startOffset, 'head');
        const tail = slice(el, range.endContainer, range.endOffset, 'tail');
        if (
          !head.trim() &&
          !tail.trim() &&
          /^(?:item|task)$/.test(block.type) &&
          /^ {2}/.test(block.raw)
        ) {
          commit(Doc.withBlockRaw(getDoc(), index, block.raw.slice(2)), index);
          return true;
        }
        const base = Doc.setVisible(getDoc(), index, head + tail);
        let result = Doc.splitBlock(base, index, head.length);
        if (result.doc.blocks.length > base.blocks.length) {
          result.doc = Doc.setVisible(result.doc, index, head);
          result.doc = Doc.setVisible(result.doc, index + 1, tail);
        }
        commit(result.doc, result.caret.index);
        return true;
      }
      if (
        event.key === 'Backspace' &&
        !mod &&
        !el.dataset.cell &&
        getSelection().isCollapsed &&
        block.type !== 'paragraph' &&
        block.type !== 'task'
      ) {
        const found = selection();
        if (found && !slice(el, found.range.startContainer, found.range.startOffset, 'head')) {
          event.preventDefault();
          checkpoint(true);
          const index = Number(el.dataset.block),
            doc = getDoc(),
            blocks = doc.blocks.slice();
          blocks[index] = { type: 'paragraph', raw: Doc.visibleOf(block) + '\n' };
          commit({ ...doc, blocks }, index);
          return true;
        }
      }
      return false;
    }

    function paste(event, el) {
      const html = event.clipboardData?.getData('text/html');
      if (!html || el.dataset.cell || getDoc().blocks[Number(el.dataset.block)]?.type === 'code')
        return false;
      const inert = new DOMParser().parseFromString(html, 'text/html');
      inert
        .querySelectorAll('script,style,iframe,object,embed,meta,link')
        .forEach((node) => node.remove());
      const lines = [];
      function blocks(node, depth = 0) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) {
            if (child.textContent.trim()) lines.push(child.textContent);
            continue;
          }
          if (child.nodeType !== 1) continue;
          if (child.matches('ul,ol')) {
            let count = 1;
            for (const li of child.children) {
              const clone = li.cloneNode(true);
              clone.querySelectorAll('ul,ol').forEach((list) => list.remove());
              lines.push(
                '  '.repeat(depth) +
                  (child.tagName === 'OL' ? `${count++}. ` : '- ') +
                  markdown(clone),
              );
              for (const nested of li.querySelectorAll(':scope > ul,:scope > ol'))
                blocks(nested.parentNode === li ? { childNodes: [nested] } : nested, depth + 1);
            }
          } else if (/^H[1-6]$/.test(child.tagName))
            lines.push('#'.repeat(Number(child.tagName[1])) + ' ' + markdown(child));
          else if (child.tagName === 'PRE') lines.push('```\n' + child.textContent + '\n```');
          else if (child.tagName === 'TABLE') {
            const rows = [...child.querySelectorAll('tr')].map((row) =>
              [...row.querySelectorAll('th,td')].map((cell) =>
                markdown(cell).replace(/\|/g, '\\|'),
              ),
            );
            if (rows.length) lines.push(Doc.tableRaw(rows));
          } else if (child.tagName === 'BLOCKQUOTE') lines.push('> ' + markdown(child));
          else if (child.querySelector('p,div,ul,ol,h1,h2,h3,pre,blockquote')) blocks(child, depth);
          else lines.push(markdown(child));
        }
      }
      blocks(inert.body);
      if (!lines.length) return false;
      event.preventDefault();
      checkpoint(true);
      const found = selection();
      if (found?.first !== found?.last && replaceAcross('')) el = editable(document.activeElement);
      const selected = selection();
      const head = selected
        ? slice(el, selected.range.startContainer, selected.range.startOffset, 'head')
        : markdown(el);
      const tail = selected
        ? slice(el, selected.range.endContainer, selected.range.endOffset, 'tail')
        : '';
      const index = Number(el.dataset.block),
        doc = getDoc();
      const parsed = Doc.parseBody(head + lines.join('\n\n') + tail + '\n');
      const list = doc.blocks.slice();
      list.splice(index, 1, ...parsed.blocks);
      commit({ ...doc, blocks: list }, index + parsed.blocks.length - 1, Number.MAX_SAFE_INTEGER);
      return true;
    }

    document.addEventListener(
      'keydown',
      (event) => {
        const found = selection();
        if (!found || found.first === found.last || options.blockSelection()) return;
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          unlock();
          place(found.first);
          return;
        }
        if (mod && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          event.stopPropagation();
          format({ b: '**', i: '*', u: '<u>' }[event.key.toLowerCase()]);
        } else if (
          event.key === 'Backspace' ||
          event.key === 'Delete' ||
          event.key === 'Enter' ||
          (event.key.length === 1 && !mod && !event.altKey)
        ) {
          event.preventDefault();
          event.stopPropagation();
          replaceAcross(event.key.length === 1 ? event.key : '');
          if (event.key === 'Enter') key(event, editable(document.activeElement));
        }
      },
      true,
    );
    for (const name of ['copy', 'cut'])
      document.addEventListener(
        name,
        (event) => {
          const found = selection();
          if (!found || found.first === found.last || options.blockSelection()) return;
          event.preventDefault();
          const box = document.createElement('div');
          const edits = editList();
          for (const el of edits.slice(edits.indexOf(found.first), edits.indexOf(found.last) + 1)) {
            const range = document.createRange();
            range.selectNodeContents(el);
            if (el === found.first)
              range.setStart(found.range.startContainer, found.range.startOffset);
            if (el === found.last) range.setEnd(found.range.endContainer, found.range.endOffset);
            const paragraph = document.createElement('p');
            paragraph.append(range.cloneContents());
            box.append(paragraph);
          }
          event.clipboardData.setData(
            'text/plain',
            [...box.children].map((node) => node.textContent).join('\n\n'),
          );
          event.clipboardData.setData('text/html', box.innerHTML);
          if (name === 'cut') replaceAcross('');
        },
        true,
      );
    let pointerStart = null,
      pointerDragged = false;
    const hit = (event) => {
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      return range && editable(range.startContainer)
        ? {
            node: range.startContainer,
            offset: range.startOffset,
            el: editable(range.startContainer),
          }
        : null;
    };
    document.addEventListener('pointerdown', (event) => {
      unlock();
      pointerDragged = false;
      pointerStart =
        event.button === 0 && !event.shiftKey && editable(event.target) ? hit(event) : null;
    });
    document.addEventListener('pointermove', (event) => {
      if (!pointerStart || !(event.buttons & 1) || !pointerStart.node.isConnected) return;
      const end = hit(event);
      if (
        !end ||
        (end.el === pointerStart.el && !locked.length) ||
        end.el.dataset.cell ||
        pointerStart.el.dataset.cell
      )
        return;
      event.preventDefault();
      pointerDragged = true;
      if (!locked.length) {
        locked = editList();
        for (const el of locked) {
          el.dataset.writingLocked = '1';
          el.contentEditable = 'false';
        }
        document.activeElement?.blur();
      }
      getSelection().setBaseAndExtent(pointerStart.node, pointerStart.offset, end.node, end.offset);
    });
    document.addEventListener('pointerup', () => {
      pointerStart = null;
    });
    document.addEventListener(
      'beforeinput',
      (event) => {
        const found = selection();
        if (!found || found.first === found.last || options.blockSelection() || event.isComposing)
          return;
        if (event.inputType.startsWith('insert') || event.inputType.startsWith('delete')) {
          event.preventDefault();
          replaceAcross(event.data || '');
        }
      },
      true,
    );
    document.addEventListener('click', (event) => {
      if (pointerDragged) {
        pointerDragged = false;
        return;
      }
      if (!options.isWriting() || !event.target.matches('#centro, #coluna')) return;
      const doc = getDoc();
      if (!doc) return;
      const last = doc.blocks.at(-1),
        index = doc.blocks.length - 1;
      if (last && last.type === 'paragraph' && !Doc.visibleOf(last).trim()) {
        place(document.querySelector(`#coluna [data-block="${index}"][contenteditable="true"]`));
        return;
      }
      checkpoint(true);
      commit({ ...doc, blocks: [...doc.blocks, { type: 'paragraph', raw: '\n' }] }, index + 1);
    });
    return { key, paste, format, selection, replaceAcross };
  }
  return { inlineHtml, markdown, create, normalizeInline, liveMarks, caretOffset, bindField };
});
