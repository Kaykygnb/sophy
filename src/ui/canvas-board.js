/**
 * Geometria e quadro do canvas. O arquivo continua JSON Canvas.
 * Esta parte não lê disco: quem chama grava pelo motor.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyCanvas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const GRID = 20;
  const MINI_W = 120;
  const MINI_H = 80;
  const SHAPES = ['text', 'rectangle', 'ellipse', 'diamond', 'triangle'];
  const PALETTE = ['1', '2', '3', '4', '5', '6'];

  function snap(value, grid = GRID) {
    return Math.round(value / grid) * grid;
  }

  function alignNodes(nodes, axis) {
    if (nodes.length < 2) return nodes.map((node) => ({ ...node }));
    const key = axis === 'x' ? 'x' : 'y';
    const edge = Math.min(...nodes.map((node) => node[key]));
    return nodes.map((node) => ({ ...node, [key]: snap(edge) }));
  }

  function sidePoint(node, side) {
    const x = node.x;
    const y = node.y;
    if (side === 'left') return { x, y: y + node.height / 2 };
    if (side === 'right') return { x: x + node.width, y: y + node.height / 2 };
    if (side === 'top-left') return { x, y };
    if (side === 'top-right') return { x: x + node.width, y };
    if (side === 'bottom-left') return { x, y: y + node.height };
    if (side === 'bottom-right') return { x: x + node.width, y: y + node.height };
    if (side === 'top') return { x: x + node.width / 2, y };
    return { x: x + node.width / 2, y: y + node.height };
  }

  function curve(from, to) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} Q ${midX} ${from.y} ${midX} ${midY} T ${to.x} ${to.y}`;
  }

  function paintVar(node) {
    const fill = node.color ? `var(--shelf-${node.color})` : '';
    const border = node.borderColor ? `var(--shelf-${node.borderColor})` : '';
    const parts = [
      fill ? `--cv-fill:${fill}` : '',
      border ? `--cv-borda:${border}` : '',
    ].filter(Boolean);
    return parts.length ? `;${parts.join(';')}` : '';
  }

  function mount(host, options) {
    const state = {
      camera: { x: 80, y: 48, zoom: 1 },
      selected: new Set(),
      tool: 'select',
      document: structuredClone(options.document),
      peekTarget: '',
    };
    host.innerHTML = '';
    host.classList.add('canvas-app');
    const area = document.createElement('div');
    area.className = 'canvas-area';
    area.innerHTML = `<div class="canvas-mundo"></div>
      <div class="cv-contador" hidden></div>
      <div class="cv-barra canvas-ferramentas" role="toolbar" aria-label="Ferramentas do canvas"></div>
      <div class="cv-cores" hidden role="group" aria-label="Cores do card"></div>
      <div class="cv-peek" hidden></div>
      <div class="canvas-zoom"></div>
      <canvas class="canvas-mini" width="${MINI_W}" height="${MINI_H}" aria-label="Minimapa"></canvas>`;
    host.append(area);
    const world = area.querySelector('.canvas-mundo');
    const counter = area.querySelector('.cv-contador');
    const tools = area.querySelector('.canvas-ferramentas');
    const colors = area.querySelector('.cv-cores');
    const peek = area.querySelector('.cv-peek');
    const zoomBar = area.querySelector('.canvas-zoom');
    const mini = area.querySelector('.canvas-mini');

    const toolIcon = (id) =>
      options.icon(
        id === 'rectangle'
          ? 'rectangle'
          : id === 'ellipse'
            ? 'circle'
            : id === 'diamond'
              ? 'diamond'
              : id === 'connect'
                ? 'flow-arrow'
                : id === 'undo'
                  ? 'arrow-counter-clockwise'
                  : id === 'redo'
                    ? 'arrow-clockwise'
                    : 'cursor',
      );
    const toolBtn = ([id, label, key]) =>
      `<button type="button" class="btn btn--icone" data-tool="${id}" aria-label="${label}" title="${label}${key ? ` (${key})` : ''}">${toolIcon(id)}</button>`;
    tools.innerHTML = [
      toolBtn(['select', 'Selecionar', 'V']),
      '<span class="cv-sep" aria-hidden="true"></span>',
      toolBtn(['rectangle', 'Retângulo', 'R']),
      toolBtn(['ellipse', 'Elipse', 'O']),
      toolBtn(['diamond', 'Losango', 'D']),
      toolBtn(['connect', 'Seta', 'C']),
      '<span class="cv-sep" aria-hidden="true"></span>',
      toolBtn(['undo', 'Desfazer', '']),
      toolBtn(['redo', 'Refazer', '']),
    ].join('');

    const swatch = (kind, id) =>
      `<button type="button" class="cv-cor${id ? '' : ' cv-cor--limpo'}" data-${kind}="${id}" aria-label="${kind === 'fill' ? 'Fundo' : 'Borda'} ${id || 'padrão'}" title="${kind === 'fill' ? 'Fundo' : 'Borda'} ${id || 'padrão'}"${id ? ` style="--amostra:var(--shelf-${id})"` : ''}></button>`;
    colors.innerHTML = `<span class="cv-cores__rotulo">Fundo</span>${['', ...PALETTE].map((id) => swatch('fill', id)).join('')}<span class="cv-sep" aria-hidden="true"></span><span class="cv-cores__rotulo">Borda</span>${['', ...PALETTE].map((id) => swatch('border', id)).join('')}`;

    zoomBar.innerHTML = `<button type="button" class="btn btn--icone" data-zoom="out" aria-label="Afastar">${options.icon('magnifying-glass-minus')}</button><span class="canvas-zoom__valor">100%</span><button type="button" class="btn btn--icone" data-zoom="in" aria-label="Aproximar">${options.icon('magnifying-glass-plus')}</button><button type="button" class="btn btn--icone" data-zoom="fit" aria-label="Ajustar">${options.icon('arrows-in-simple')}</button>`;

    const applyCamera = () => {
      const camera = state.camera;
      world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      zoomBar.querySelector('.canvas-zoom__valor').textContent =
        `${Math.round(camera.zoom * 100)}%`;
    };

    const applyNodeBox = (node) => {
      const el = world.querySelector(`[data-node="${node.id}"]`);
      if (!el) return;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${node.width}px`;
      el.style.height = `${node.height}px`;
    };

    /** Losango/elipse: texto útil é só uma fração da caixa; cresce 1:1 ao digitar. */
    const fitLockedShape = (node, editor) => {
      if (!node || (node.shape !== 'diamond' && node.shape !== 'ellipse')) return;
      const usable = node.shape === 'diamond' ? 0.48 : 0.7;
      const min = 200;
      const max = 720;
      const prev = {
        maxHeight: editor.style.maxHeight,
        height: editor.style.height,
        overflow: editor.style.overflow,
        width: editor.style.width,
      };
      editor.style.maxHeight = 'none';
      editor.style.height = 'auto';
      editor.style.width = '100%';
      editor.style.overflow = 'hidden';
      const need = Math.max(editor.scrollHeight, Math.ceil(editor.scrollWidth * 0.9), 48);
      editor.style.maxHeight = prev.maxHeight;
      editor.style.height = prev.height;
      editor.style.overflow = prev.overflow;
      editor.style.width = prev.width;
      const size = Math.min(max, Math.max(min, Math.ceil(need / usable) + 12));
      const current = Math.max(node.width || 0, node.height || 0);
      if (size <= current) return;
      node.width = size;
      node.height = size;
      applyNodeBox(node);
    };

    const paint = () => {
      const empty = area.querySelector('.canvas-vazio');
      if (!state.document.nodes.length) {
        if (!empty) {
          const note = document.createElement('div');
          note.className = 'canvas-vazio';
          note.innerHTML =
            '<div class="canvas-vazio__cartao"><p class="canvas-vazio__selo">Canvas</p><h2>Comece pelo primeiro card</h2><p>Escreva, use [[wikilinks]] e ligue as ideias com conexões.</p><div class="canvas-vazio__acoes"><button type="button" class="btn btn--primario" data-canvas-start>Adicionar card</button><button type="button" class="btn btn--secundario" data-canvas-diamond>Losango</button></div><p class="canvas-vazio__dica"><kbd class="kbd">R</kbd> retângulo · <kbd class="kbd">D</kbd> losango · <kbd class="kbd">E</kbd> elipse</p></div>';
          note.querySelector('[data-canvas-start]').onclick = () => {
            place('rectangle', 280, 160);
          };
          note.querySelector('[data-canvas-diamond]').onclick = () => {
            place('diamond', 220, 220);
          };
          area.append(note);
        }
      } else empty?.remove();
      applyCamera();
      tools.querySelectorAll('[data-tool]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.tool === state.tool ? 'true' : 'false');
      });
      counter.style.display = state.selected.size < 2 ? 'none' : 'inline-flex';
      counter.textContent = `${state.selected.size} selecionados`;
      world.innerHTML = `<svg class="cv-seta">${edgesMarkup()}</svg>${nodesMarkup()}`;
      bindNodes();
      paintColors();
      paintMini();
    };

    const paintColors = () => {
      const id = [...state.selected][0];
      const node = state.document.nodes.find((item) => item.id === id);
      const shape = node && SHAPES.includes(node.shape || (node.type === 'text' ? 'text' : ''));
      const show = state.selected.size === 1 && shape && (node.shape || 'text') !== 'text';
      colors.hidden = !show;
      if (!show) return;
      colors.querySelectorAll('[data-fill]').forEach((button) => {
        button.setAttribute('aria-pressed', (node.color || '') === button.dataset.fill ? 'true' : 'false');
      });
      colors.querySelectorAll('[data-border]').forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          (node.borderColor || '') === button.dataset.border ? 'true' : 'false',
        );
      });
    };

    const edgesMarkup = () => {
      const byId = new Map(state.document.nodes.map((node) => [node.id, node]));
      return (
        (state.document.edges || [])
          .map((edge) => {
            const from = byId.get(edge.fromNode);
            const to = byId.get(edge.toNode);
            if (!from || !to) return '';
            const a = sidePoint(from, edge.fromCorner || edge.fromSide || 'right');
            const b = sidePoint(to, edge.toCorner || edge.toSide || 'left');
            const selected = state.selected.has(edge.id) ? ' is-selecionada' : '';
            const label = edge.label
              ? `<foreignObject x="${(a.x + b.x) / 2 - 40}" y="${(a.y + b.y) / 2 - 14}" width="80" height="24"><div class="cv-rotulo${selected ? ' is-selecionado' : ''}">${escape(edge.label)}</div></foreignObject>`
              : '';
            return `<path class="${selected}" data-edge="${escape(edge.id)}" d="${curve(a, b)}" marker-end="url(#cv-ponta)" />${label}`;
          })
          .join('') +
        `<defs><marker id="cv-ponta" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" fill="currentColor"></path></marker></defs>`
      );
    };

    const nodesMarkup = () =>
      [...state.document.nodes]
        .sort((a, b) => Number(a.type !== 'group') - Number(b.type !== 'group'))
        .map((node) => {
          const selected = state.selected.has(node.id) ? 'true' : 'false';
          const style = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px${paintVar(node)}`;
          if (node.type === 'group') {
            return `<div class="cv-grupo" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}"><span class="cv-grupo__rotulo">${escape(node.label || 'Grupo')}</span></div>`;
          }
          if (node.type === 'file') {
            const preview = options.preview(node.file) || {
              title: node.file,
              body: '',
              path: node.file,
            };
            const shelf = options.shelf(preview.path || node.file);
            const tint = shelf?.color ? `;--estante-cor: var(--shelf-${shelf.color})` : '';
            return `<article class="cv-cartao" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}${tint}">
              <div class="cv-cartao__titulo">${options.icon('note')}<span>${escape(preview.title || node.file)}</span><button type="button" class="btn btn--icone" data-open="${escape(preview.path || node.file)}" aria-label="Abrir nota">${options.icon('arrow-square-out')}</button></div>
              <div class="cv-cartao__texto">${preview.html || escape(preview.body || '')}</div>
              <div class="cv-cartao__caminho">${escape(preview.path || node.file || '')}</div>
              ${ports()}
            </article>`;
          }
          if (node.type === 'link') {
            if (node.shape === 'image' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(node.url || '')) {
              return `<article class="cv-cartao cv-elemento cv-imagem" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}">
                <img src="${escape(node.url)}" alt="${escape(node.label || 'Imagem do canvas')}">${ports()}
              </article>`;
            }
            return `<article class="cv-cartao cv-cartao--texto" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}">
              <div class="cv-cartao__titulo">${options.icon('arrow-square-out')}<span>${escape(node.label || node.url || 'Link')}</span></div>
              <p class="cv-cartao__caminho">${escape(node.url || '')}</p>${ports()}
            </article>`;
          }
          const shape = SHAPES.includes(node.shape) ? node.shape : 'rectangle';
          return `<article class="cv-cartao cv-elemento cv-forma cv-forma--${shape}" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}">
            <div class="cv-texto" contenteditable="true" data-text="${escape(node.id)}" data-placeholder="Escreva algo… use [[ para ligar">${inline(node.text || '')}</div>${ports()}
          </article>`;
        })
        .join('');

    const ports = () =>
      ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
        .map(
          (side) =>
            `<span class="cv-porta cv-porta--${side.includes('-') ? side : side[0] === 't' ? 'n' : side[0] === 'b' ? 's' : side[0] === 'l' ? 'l' : 'o'}" data-port="${side}" title="Arraste para conectar"></span>`,
        )
        .join('') +
      ['ne', 'no', 'se', 'so']
        .map(
          (corner) =>
            `<span class="cv-alca cv-alca--${corner}" data-resize="${corner}" aria-hidden="true"></span>`,
        )
        .join('');

    const bindNodes = () => {
      world.querySelectorAll('[data-node]').forEach((element) => {
        element.addEventListener('pointerdown', (event) => startNode(event, element.dataset.node));
      });
      world.querySelectorAll('[data-open]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          options.openNote(button.dataset.open);
        });
      });
      world.querySelectorAll('[data-text]').forEach((editor) => {
        editor.addEventListener('pointerdown', (event) => {
          if ((event.ctrlKey || event.metaKey) && event.target.closest('[data-target]')) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (state.tool === 'connect') {
            event.stopPropagation();
            startConnect(event, editor.dataset.text, 'right');
          }
        });
        editor.addEventListener('focus', () => {
          editor.dataset.editing = '1';
        });
        const field = window.SophyWriting.bindField(editor, {
          broken: (raw) => options.brokenLink?.(raw) || false,
          onChange: (text) => {
            const node = state.document.nodes.find((item) => item.id === editor.dataset.text);
            if (node) {
              node.text = text;
              fitLockedShape(node, editor);
            }
            offerWiki(editor, text, field.caret());
          },
          onBlur: () => commitText(editor),
        });
        editor._sophyField = field;
      });
      world.querySelectorAll('[data-edge]').forEach((path) => {
        path.style.pointerEvents = 'stroke';
        path.addEventListener('pointerdown', (event) => {
          event.stopPropagation();
          select(path.dataset.edge, event.shiftKey);
          paint();
        });
      });
    };

    const select = (id, shift) => {
      if (!shift) state.selected.clear();
      if (state.selected.has(id) && shift) state.selected.delete(id);
      else state.selected.add(id);
    };

    const startNode = (event, id) => {
      const resize = event.target.closest('[data-resize]');
      if (resize) {
        startResize(event, id, resize.dataset.resize || 'se');
        return;
      }
      if (event.target.closest('[data-port]')) {
        startConnect(event, id, event.target.dataset.port);
        return;
      }
      if (state.tool === 'connect') {
        startConnect(event, id, 'right');
        return;
      }
      if (event.target.closest('button')) {
        select(id, event.shiftKey);
        paint();
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      select(id, event.shiftKey);
      const node = state.document.nodes.find((item) => item.id === id);
      const fromText = !!event.target.closest('[contenteditable="true"]');
      const origin = { x: event.clientX, y: event.clientY, nx: node.x, ny: node.y };
      let dragged = false;
      const move = (ev) => {
        const dist = Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y);
        if (!dragged && dist < 5) return;
        dragged = true;
        if (fromText && document.activeElement?.closest?.('[data-text]')) {
          document.activeElement.blur();
        }
        node.x = origin.nx + (ev.clientX - origin.x) / state.camera.zoom;
        node.y = origin.ny + (ev.clientY - origin.y) / state.camera.zoom;
        applyNodeBox(node);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!dragged) {
          if (fromText) {
            const editor = world.querySelector(`[data-text="${id}"]`);
            editor?.focus();
          }
          paintColors();
          return;
        }
        node.x = snap(node.x);
        node.y = snap(node.y);
        paint();
        commit();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      paintColors();
      tools.querySelectorAll('[data-tool]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.tool === state.tool ? 'true' : 'false');
      });
      world.querySelectorAll('[data-node]').forEach((el) => {
        el.setAttribute('aria-selected', state.selected.has(el.dataset.node) ? 'true' : 'false');
      });
    };

    const startResize = (event, id, corner) => {
      event.stopPropagation();
      select(id, false);
      const node = state.document.nodes.find((item) => item.id === id);
      if (!node) return;
      world.querySelectorAll('[data-node]').forEach((el) => {
        el.setAttribute('aria-selected', el.dataset.node === id ? 'true' : 'false');
      });
      paintColors();
      const origin = {
        x: event.clientX,
        y: event.clientY,
        ox: node.x,
        oy: node.y,
        width: node.width,
        height: node.height,
      };
      const minW = 80;
      const minH = 80;
      const lock = node.shape === 'ellipse' || node.shape === 'diamond';
      const move = (ev) => {
        const dx = (ev.clientX - origin.x) / state.camera.zoom;
        const dy = (ev.clientY - origin.y) / state.camera.zoom;
        let width = origin.width;
        let height = origin.height;
        let x = origin.ox;
        let y = origin.oy;
        if (corner.includes('e')) width = Math.max(minW, origin.width + dx);
        if (corner.includes('o')) {
          width = Math.max(minW, origin.width - dx);
          x = origin.ox + origin.width - width;
        }
        if (corner.includes('s')) height = Math.max(minH, origin.height + dy);
        if (corner.includes('n')) {
          height = Math.max(minH, origin.height - dy);
          y = origin.oy + origin.height - height;
        }
        if (lock) {
          const size = Math.max(width, height);
          if (corner.includes('o')) x = origin.ox + origin.width - size;
          if (corner.includes('n')) y = origin.oy + origin.height - size;
          width = size;
          height = size;
        }
        node.width = width;
        node.height = height;
        node.x = x;
        node.y = y;
        applyNodeBox(node);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        node.width = snap(node.width);
        node.height = snap(node.height);
        node.x = snap(node.x);
        node.y = snap(node.y);
        paint();
        commit();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };

    const startConnect = (event, id, side) => {
      event.stopPropagation();
      const up = (ev) => {
        window.removeEventListener('pointerup', up);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-node]');
        if (!target || target.dataset.node === id) return;
        const edge = {
          id: options.nextId(),
          fromNode: id,
          fromSide: side.includes('-') ? side.startsWith('top') ? 'top' : 'bottom' : side,
          fromCorner: side.includes('-') ? side : undefined,
          toNode: target.dataset.node,
          toSide: 'left',
          toEnd: 'arrow',
        };
        state.document.edges = [...(state.document.edges || []), edge];
        paint();
        commit();
      };
      window.addEventListener('pointerup', up);
    };

    const offerWiki = (editor, source, caret) => {
      const text =
        source ??
        (editor._sophyField ? editor._sophyField.read() : window.SophyWriting.markdown(editor));
      const at = caret ?? (editor._sophyField ? editor._sophyField.caret() : text.length);
      const found = window.SophyCommands.wikiQuery(text, at);
      document.querySelectorAll('.menu-flutuante').forEach((menu) => menu.remove());
      if (!found) return;
      const menu = document.createElement('div');
      menu.className = 'menu menu--wiki menu-flutuante';
      const notes = (options.notes || []).filter((note) =>
        note.path.toLocaleLowerCase().includes(found.query.toLocaleLowerCase()),
      );
      menu.innerHTML = notes
        .slice(0, 6)
        .map(
          (note) =>
            `<button type="button" class="menu__item" data-insert="[[${escape(note.path.replace(/\.md$/i, ''))}]]">${escape(note.title || note.path)}</button>`,
        )
        .join('');
      if (!notes.length) return;
      document.body.append(menu);
      const rect = editor.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.querySelectorAll('[data-insert]').forEach((button) => {
        button.onmousedown = (event) => {
          event.preventDefault();
          const node = state.document.nodes.find((item) => item.id === editor.dataset.text);
          const end = found.start + 2 + found.query.length;
          node.text = `${text.slice(0, found.start)}${button.dataset.insert}${text.slice(end)}`;
          menu.remove();
          paint();
          commit();
          setTimeout(() => world.querySelector(`[data-text="${node.id}"]`)?.focus(), 0);
        };
      });
    };

    const commitText = (editor) => {
      const node = state.document.nodes.find((item) => item.id === editor.dataset.text);
      if (!node) return;
      const text = editor._sophyField
        ? editor._sophyField.read()
        : window.SophyWriting.markdown(editor);
      delete editor.dataset.editing;
      if (!text.trim()) {
        if (node.shape && node.shape !== 'text') {
          node.text = '';
          commit();
          paint();
          return;
        }
        state.document.nodes = state.document.nodes.filter((item) => item.id !== node.id);
        commit();
        paint();
        return;
      }
      node.text = text;
      commit();
      paint();
    };

    const commit = () => options.onChange(structuredClone(state.document));

    async function showPeek(target) {
      const path = target.endsWith('.md') ? target : `${target}.md`;
      if (state.peekTarget === path && !peek.hidden) return;
      state.peekTarget = path;
      peek.hidden = false;
      peek.innerHTML = `<strong>${escape(path.replace(/\.md$/i, ''))}</strong><div class="cv-peek__corpo">Carregando…</div>`;
      const cached = options.preview?.(path) || options.preview?.(target);
      if (cached) {
        peek.innerHTML = `<strong>${escape(cached.title || path)}</strong><div class="cv-peek__corpo">${cached.html || escape(cached.body || '')}</div>`;
        return;
      }
      if (!options.peekNote) {
        peek.innerHTML = `<strong>${escape(path.replace(/\.md$/i, ''))}</strong><div class="cv-peek__corpo">Nota não encontrada.</div>`;
        return;
      }
      const note = await options.peekNote(path);
      if (state.peekTarget !== path) return;
      if (!note) {
        peek.innerHTML = `<strong>${escape(path.replace(/\.md$/i, ''))}</strong><div class="cv-peek__corpo">Nota não encontrada.</div>`;
        return;
      }
      peek.innerHTML = `<strong>${escape(note.title || path)}</strong><div class="cv-peek__corpo">${note.html || escape(note.body || '')}</div>`;
    }

    function hidePeek() {
      state.peekTarget = '';
      peek.hidden = true;
      peek.innerHTML = '';
    }

    const place = (type, x, y, extra = {}) => {
      const id = options.nextId();
      const isShape = SHAPES.includes(type);
      const node = {
        id,
        type: isShape ? 'text' : type,
        x: snap(x),
        y: snap(y),
        width: type === 'ellipse' || type === 'diamond' ? 200 : 240,
        height: type === 'ellipse' || type === 'diamond' ? 200 : 160,
        ...extra,
      };
      if (isShape) {
        node.text = '';
        node.shape = type;
      }
      state.document.nodes.push(node);
      state.selected = new Set([id]);
      if (isShape) state.tool = 'select';
      paint();
      commit();
      if (isShape) {
        const created = id;
        setTimeout(() => world.querySelector(`[data-text="${created}"]`)?.focus(), 0);
      }
    };

    area.addEventListener('pointerdown', (event) => {
      if (event.target !== area && event.target !== world) return;
      const point = worldPoint(event);
      if (['rectangle', 'ellipse', 'diamond'].includes(state.tool)) {
        return place(state.tool, point.x, point.y);
      }
      state.selected.clear();
      paint();
    });
    area.addEventListener('dblclick', (event) => {
      if (event.target !== area && event.target !== world) return;
      const point = worldPoint(event);
      place('rectangle', point.x, point.y);
    });
    area.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
        state.camera.zoom = Math.min(2.2, Math.max(0.35, state.camera.zoom * factor));
        applyCamera();
      },
      { passive: false },
    );
    let pan = null;
    area.addEventListener('pointerdown', (event) => {
      if (event.target !== area && !event.target.classList.contains('canvas-mundo')) return;
      pan = { x: event.clientX, y: event.clientY, cx: state.camera.x, cy: state.camera.y };
    });
    window.addEventListener('pointermove', (event) => {
      if (!pan) return;
      state.camera.x = pan.cx + event.clientX - pan.x;
      state.camera.y = pan.cy + event.clientY - pan.y;
      applyCamera();
    });
    window.addEventListener('pointerup', () => {
      if (pan) paintMini();
      pan = null;
    });
    tools.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (!button) return;
      const id = button.dataset.tool;
      if (id === 'undo') return options.undo();
      if (id === 'redo') return options.redo();
      state.tool = id;
      paint();
    });
    colors.addEventListener('click', (event) => {
      const fill = event.target.closest('[data-fill]');
      const border = event.target.closest('[data-border]');
      const id = [...state.selected][0];
      const node = state.document.nodes.find((item) => item.id === id);
      if (!node) return;
      if (fill) {
        if (fill.dataset.fill) node.color = fill.dataset.fill;
        else delete node.color;
      }
      if (border) {
        if (border.dataset.border) node.borderColor = border.dataset.border;
        else delete node.borderColor;
      }
      paint();
      commit();
    });
    zoomBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-zoom]');
      if (!button) return;
      if (button.dataset.zoom === 'in') state.camera.zoom = Math.min(2.2, state.camera.zoom * 1.15);
      if (button.dataset.zoom === 'out')
        state.camera.zoom = Math.max(0.35, state.camera.zoom / 1.15);
      if (button.dataset.zoom === 'fit') state.camera = { x: 80, y: 48, zoom: 1 };
      paint();
    });
    host.addEventListener('dragover', (event) => event.preventDefault());
    host.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer.getData('text/plain');
      if (!file) return;
      const point = worldPoint(event);
      const id = options.nextId();
      state.document.nodes.push({
        id,
        type: 'file',
        x: snap(point.x),
        y: snap(point.y),
        width: 260,
        height: 150,
        file,
      });
      state.selected = new Set([id]);
      paint();
      commit();
    });
    host.addEventListener('keydown', (event) => {
      if (event.target.closest('[contenteditable="true"], input, textarea')) return;
      const key = event.key.toLocaleLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === '0') {
        event.preventDefault();
        state.camera = { x: 80, y: 48, zoom: 1 };
        paint();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && ['v', 'r', 'o', 'd', 'c'].includes(key)) {
        state.tool = {
          v: 'select',
          r: 'rectangle',
          o: 'ellipse',
          d: 'diamond',
          c: 'connect',
        }[key];
        paint();
        return;
      }
      if (event.key === 'Escape') {
        state.tool = 'select';
        state.selected.clear();
        hidePeek();
        paint();
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      state.document.nodes = state.document.nodes.filter((node) => !state.selected.has(node.id));
      state.document.edges = (state.document.edges || []).filter(
        (edge) =>
          !state.selected.has(edge.id) &&
          !state.selected.has(edge.fromNode) &&
          !state.selected.has(edge.toNode),
      );
      state.selected.clear();
      paint();
      commit();
    });

    function worldPoint(event) {
      const rect = area.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left - state.camera.x) / state.camera.zoom,
        y: (event.clientY - rect.top - state.camera.y) / state.camera.zoom,
      };
    }

    function paintMini() {
      const ctx = mini.getContext('2d');
      ctx.clearRect(0, 0, MINI_W, MINI_H);
      ctx.fillStyle =
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f4f2ef';
      ctx.fillRect(0, 0, MINI_W, MINI_H);
      const nodes = state.document.nodes;
      if (!nodes.length) return;
      const minX = Math.min(...nodes.map((node) => node.x));
      const minY = Math.min(...nodes.map((node) => node.y));
      const maxX = Math.max(...nodes.map((node) => node.x + node.width));
      const maxY = Math.max(...nodes.map((node) => node.y + node.height));
      const scale = Math.min(
        (MINI_W - 16) / Math.max(maxX - minX, 1),
        (MINI_H - 16) / Math.max(maxY - minY, 1),
      );
      for (const node of nodes) {
        ctx.fillStyle = node.type === 'group' ? 'rgba(110,114,176,0.28)' : '#918DA6';
        ctx.fillRect(
          (node.x - minX) * scale + 8,
          (node.y - minY) * scale + 8,
          Math.max(3, node.width * scale),
          Math.max(3, node.height * scale),
        );
      }
    }

    function inline(text) {
      return window.SophyWriting.inlineHtml(text || '', (raw) => options.brokenLink?.(raw) || false);
    }

    world.addEventListener('click', (event) => {
      const link = event.target.closest('[data-target]');
      if (!link) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      options.openNote(
        link.dataset.target.endsWith('.md') ? link.dataset.target : `${link.dataset.target}.md`,
      );
    });

    world.addEventListener('pointerover', (event) => {
      const link = event.target.closest('[data-target]');
      if (!link || !(event.ctrlKey || event.metaKey)) return;
      showPeek(link.dataset.target);
    });
    world.addEventListener('pointerout', (event) => {
      const link = event.target.closest('[data-target]');
      if (!link) return;
      const next = event.relatedTarget?.closest?.('[data-target]');
      if (next && next.dataset.target === link.dataset.target) return;
      hidePeek();
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Control' || event.key === 'Meta') hidePeek();
    });

    paint();
    return {
      select(id) {
        state.selected = new Set([id]);
        paint();
      },
      destroy() {
        hidePeek();
        host.innerHTML = '';
      },
    };
  }

  function escape(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  }

  return { GRID, snap, alignNodes, sidePoint, curve, mount };
});
