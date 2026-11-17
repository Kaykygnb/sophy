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
    if (side === 'top') return { x: x + node.width / 2, y };
    return { x: x + node.width / 2, y: y + node.height };
  }

  function curve(from, to) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} Q ${midX} ${from.y} ${midX} ${midY} T ${to.x} ${to.y}`;
  }

  function mount(host, options) {
    const state = {
      camera: { x: 80, y: 48, zoom: 1 },
      selected: new Set(),
      tool: 'select',
      document: structuredClone(options.document),
    };
    host.innerHTML = '';
    host.classList.add('canvas-app');
    const area = document.createElement('div');
    area.className = 'canvas-area';
    area.innerHTML = `<div class="canvas-mundo"></div>
      <div class="cv-contador" hidden></div>
      <div class="cv-barra canvas-ferramentas" role="toolbar" aria-label="Ferramentas do canvas"></div>
      <div class="canvas-zoom"></div>
      <canvas class="canvas-mini" width="200" height="136" aria-label="Minimapa"></canvas>`;
    host.append(area);
    const world = area.querySelector('.canvas-mundo');
    const counter = area.querySelector('.cv-contador');
    const tools = area.querySelector('.canvas-ferramentas');
    const zoomBar = area.querySelector('.canvas-zoom');
    const mini = area.querySelector('.canvas-mini');
    tools.innerHTML = [
      ['select', 'Selecionar', 'V'],
      ['text', 'Texto', 'T'],
      ['group', 'Grupo', 'G'],
      ['connect', 'Conector', 'C'],
      ['align', 'Alinhar', ''],
      ['undo', 'Desfazer', ''],
      ['redo', 'Refazer', ''],
    ]
      .map(
        ([id, label, key]) =>
          `<button type="button" class="btn btn--icone" data-tool="${id}" aria-label="${label}" title="${label}${key ? ' ' + key : ''}">${options.icon(id === 'text' ? 'nota-adesiva' : id === 'group' ? 'agrupar' : id === 'connect' ? 'link' : id === 'undo' ? 'desfazer' : id === 'redo' ? 'refazer' : id === 'align' ? 'divisor' : 'mais')}<span class="sr-only">${label}</span></button>`,
      )
      .join('');
    const covers = document.createElement('div');
    covers.className = 'capa-opcoes';
    const names = ['rede', 'estante', 'jardim', 'horizonte', 'cerrado', 'ondas'];
    covers.innerHTML = names
      .map(
        (id) =>
          `<button type="button" class="capa-opcao" data-capa="sophy:${id}" aria-label="Capa ${id}"><svg class="capa__arte" viewBox="0 0 1600 400"><use href="#capa-${id}"/></svg></button>`,
      )
      .join('');
    tools.after(covers);
    const paintCover = () => {
      const capa = state.document.capa;
      const id = typeof capa === 'string' && capa.startsWith('sophy:') ? capa.slice(6) : '';
      const on = /^(rede|estante|jardim|horizonte|cerrado|ondas|[1-6])$/.test(id);
      area.classList.toggle('tem-capa', on);
      let art = area.querySelector('.capa-quadro');
      if (!on) {
        art?.remove();
        return;
      }
      const name = { 1: 'rede', 2: 'estante', 3: 'jardim', 4: 'horizonte', 5: 'cerrado', 6: 'ondas' }[id] || id;
      if (!art) {
        art = document.createElement('div');
        art.className = 'capa capa-quadro';
        area.prepend(art);
      }
      art.innerHTML = `<div class="capa__recorte"><svg class="capa__arte" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice"><use href="#capa-${name}"/></svg></div>`;
    };
    paintCover();
    covers.querySelectorAll('[data-capa]').forEach((button) => {
      button.onclick = () => {
        state.document.capa = button.dataset.capa;
        paintCover();
        options.onChange?.(state.document);
      };
    });
    zoomBar.innerHTML = `<button type="button" class="btn btn--icone" data-zoom="out" aria-label="Afastar">−</button><span class="canvas-zoom__valor">100%</span><button type="button" class="btn btn--icone" data-zoom="in" aria-label="Aproximar">+</button><button type="button" class="btn btn--secundario" data-zoom="fit">Ajustar</button>`;

    const paint = () => {
      const empty = area.querySelector('.canvas-vazio');
      if (!state.document.nodes.length) {
        if (!empty) {
          const note = document.createElement('div');
          note.className = 'canvas-vazio vazio-ensina';
          note.innerHTML = '<h2>Quadro vazio</h2><p>Use Texto, Grupo ou Conector. Se a leitura falhar, o quadro mostra o erro em vez de um cartão.</p>';
          area.append(note);
        }
      } else empty?.remove();
      const camera = state.camera;
      world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      zoomBar.querySelector('.canvas-zoom__valor').textContent =
        `${Math.round(camera.zoom * 100)}%`;
      tools.querySelectorAll('[data-tool]').forEach((button) => {
        button.setAttribute('aria-pressed', button.dataset.tool === state.tool ? 'true' : 'false');
      });
      counter.style.display = state.selected.size < 2 ? 'none' : 'inline-flex';
      counter.textContent = `${state.selected.size} selecionados`;
      world.innerHTML = `<svg class="cv-seta">${edgesMarkup()}</svg>${nodesMarkup()}`;
      bindNodes();
      paintMini();
    };

    const edgesMarkup = () => {
      const byId = new Map(state.document.nodes.map((node) => [node.id, node]));
      return (
        (state.document.edges || [])
          .map((edge) => {
            const from = byId.get(edge.fromNode);
            const to = byId.get(edge.toNode);
            if (!from || !to) return '';
            const a = sidePoint(from, edge.fromSide || 'right');
            const b = sidePoint(to, edge.toSide || 'left');
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
          const style = `left:${node.x}px;top:${node.y}px;width:${node.width}px;height:${node.height}px`;
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
            const color = shelf?.color ? ` style="--estante-cor: var(--shelf-${shelf.color})"` : '';
            return `<article class="cv-cartao" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}"${color}>
              <div class="cv-cartao__titulo">${options.icon('nota')}<span>${escape(preview.title || node.file)}</span><button type="button" class="btn btn--icone" data-open="${escape(preview.path || node.file)}" aria-label="Abrir nota">${options.icon('externo')}</button></div>
              <div class="cv-cartao__texto">${preview.html || escape(preview.body || '')}</div>
              <div class="cv-cartao__caminho">${escape(preview.path || node.file || '')}</div>
              ${ports()}
            </article>`;
          }
          if (node.type === 'link') {
            return `<article class="cv-cartao cv-cartao--texto" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}">
              <div class="cv-cartao__titulo">${options.icon('externo')}<span>${escape(node.label || node.url || 'Link')}</span></div>
              <p class="cv-cartao__caminho">${escape(node.url || '')}</p>${ports()}
            </article>`;
          }
          return `<article class="cv-cartao cv-cartao--texto" data-node="${escape(node.id)}" aria-selected="${selected}" style="${style}">
            <div class="cv-texto" contenteditable="true" data-text="${escape(node.id)}">${inline(node.text || '')}</div>${ports()}
          </article>`;
        })
        .join('');

    const ports = () =>
      ['top', 'right', 'bottom', 'left']
        .map(
          (side) =>
            `<span class="cv-porta cv-porta--${side[0] === 't' ? 'n' : side[0] === 'b' ? 's' : side[0] === 'l' ? 'l' : 'o'}" data-port="${side}"></span>`,
        )
        .join('') +
      ['ne', 'no', 'se', 'so']
        .map((corner) => `<span class="cv-alca cv-alca--${corner}"></span>`)
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
        editor.addEventListener('pointerdown', (event) => event.stopPropagation());
        editor.addEventListener('input', () => offerWiki(editor));
        editor.addEventListener('blur', () => commitText(editor));
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
      if (event.target.closest('[data-port]')) {
        startConnect(event, id, event.target.dataset.port);
        return;
      }
      if (event.target.closest('[contenteditable="true"], button')) {
        select(id, event.shiftKey);
        paint();
        return;
      }
      event.stopPropagation();
      select(id, event.shiftKey);
      const node = state.document.nodes.find((item) => item.id === id);
      const origin = { x: event.clientX, y: event.clientY, nx: node.x, ny: node.y };
      const move = (ev) => {
        node.x = origin.nx + (ev.clientX - origin.x) / state.camera.zoom;
        node.y = origin.ny + (ev.clientY - origin.y) / state.camera.zoom;
        paint();
      };
      const up = () => {
        node.x = snap(node.x);
        node.y = snap(node.y);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        paint();
        commit();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      paint();
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
          fromSide: side,
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

    const offerWiki = (editor) => {
      const text = editor.textContent || '';
      const caret = text.length;
      const found = window.SophyCommands.wikiQuery(text, caret);
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
      document.body.append(menu);
      const rect = editor.getBoundingClientRect();
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 6}px`;
      menu.querySelectorAll('[data-insert]').forEach((button) => {
        button.onmousedown = (event) => {
          event.preventDefault();
          const node = state.document.nodes.find((item) => item.id === editor.dataset.text);
          node.text = `${(node.text || '').replace(/\[\[[^\n]*$/, '')}${button.dataset.insert}`;
          menu.remove();
          paint();
          commit();
        };
      });
    };

    const commitText = (editor) => {
      const node = state.document.nodes.find((item) => item.id === editor.dataset.text);
      if (!node) return;
      node.text = readEditable(editor);
      commit();
    };

    const commit = () => options.onChange(structuredClone(state.document));

    const place = (type, x, y) => {
      const id = options.nextId();
      const node = {
        id,
        type,
        x: snap(x),
        y: snap(y),
        width: type === 'group' ? 420 : 260,
        height: type === 'group' ? 280 : type === 'text' ? 140 : 120,
      };
      if (type === 'text') node.text = '';
      if (type === 'group') node.label = 'Grupo';
      state.document.nodes.push(node);
      state.selected = new Set([id]);
      paint();
      commit();
    };

    area.addEventListener('pointerdown', (event) => {
      if (event.target !== area && event.target !== world) return;
      const point = worldPoint(event);
      if (state.tool === 'text') return place('text', point.x, point.y);
      if (state.tool === 'group') return place('group', point.x, point.y);
      state.selected.clear();
      paint();
    });
    area.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
        state.camera.zoom = Math.min(2.2, Math.max(0.35, state.camera.zoom * factor));
        paint();
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
      paint();
    });
    window.addEventListener('pointerup', () => {
      pan = null;
    });
    tools.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (!button) return;
      const id = button.dataset.tool;
      if (id === 'align') {
        const chosen = state.document.nodes.filter((node) => state.selected.has(node.id));
        const aligned = alignNodes(chosen, 'y');
        for (const node of aligned) {
          const current = state.document.nodes.find((item) => item.id === node.id);
          current.y = node.y;
        }
        paint();
        commit();
        return;
      }
      if (id === 'undo') return options.undo();
      if (id === 'redo') return options.redo();
      state.tool = id;
      paint();
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
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (event.target.closest('[contenteditable="true"], input, textarea')) return;
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
      ctx.clearRect(0, 0, 200, 136);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg');
      ctx.fillRect(0, 0, 200, 136);
      const nodes = state.document.nodes;
      if (!nodes.length) return;
      const minX = Math.min(...nodes.map((node) => node.x));
      const minY = Math.min(...nodes.map((node) => node.y));
      const maxX = Math.max(...nodes.map((node) => node.x + node.width));
      const maxY = Math.max(...nodes.map((node) => node.y + node.height));
      const scale = Math.min(180 / Math.max(maxX - minX, 1), 110 / Math.max(maxY - minY, 1));
      for (const node of nodes) {
        ctx.fillStyle = node.type === 'group' ? 'rgba(110,114,176,0.28)' : '#918DA6';
        ctx.fillRect(
          (node.x - minX) * scale + 8,
          (node.y - minY) * scale + 8,
          Math.max(4, node.width * scale),
          Math.max(4, node.height * scale),
        );
      }
    }

    function inline(text) {
      return window.SophyDoc.parseInlines(text)
        .map((part) =>
          part.type === 'text'
            ? escape(part.text)
            : `<a href="#" class="wikilink" contenteditable="false" data-raw="${escape(part.raw)}" data-target="${escape(part.target)}">${escape(part.label)}</a>`,
        )
        .join('');
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

    paint();
    return {
      select(id) {
        state.selected = new Set([id]);
        paint();
      },
      destroy() {
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

  function readEditable(element) {
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.dataset && node.dataset.raw) text += node.dataset.raw;
      else text += node.textContent;
    }
    return text;
  }

  return { GRID, snap, alignNodes, sidePoint, curve, mount };
});
