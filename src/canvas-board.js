'use strict';
(function (global) {
  const COLORS = {
    1: '#b57d72',
    2: '#a68a58',
    3: '#7c967f',
    4: '#7892b4',
    5: '#9b88aa',
    6: '#8b95a1',
  };

  function uid() {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }

  function cloneData(data) {
    return JSON.parse(JSON.stringify(data || { nodes: [], edges: [] }));
  }

  function sidePoint(node, side) {
    const x = node.x,
      y = node.y,
      w = node.width,
      h = node.height;
    if (side === 'top') return { x: x + w / 2, y };
    if (side === 'bottom') return { x: x + w / 2, y: y + h };
    if (side === 'left') return { x, y: y + h / 2 };
    return { x: x + w, y: y + h / 2 };
  }

  function nearestSide(node, x, y) {
    const points = ['top', 'right', 'bottom', 'left'].map((side) => {
      const p = sidePoint(node, side);
      const dx = p.x - x,
        dy = p.y - y;
      return { side, d: dx * dx + dy * dy };
    });
    points.sort((a, b) => a.d - b.d);
    return points[0].side;
  }

  function createBoard() {
    let root = null,
      viewport = null,
      world = null,
      edgesSvg = null,
      statusEl = null,
      data = { nodes: [], edges: [] },
      selected = new Set(),
      camera = { x: 0, y: 0, zoom: 1 },
      spaceHeld = false,
      panning = null,
      dragging = null,
      resizing = null,
      linking = null,
      onChange = null,
      onOpenFile = null,
      onRequestNotes = null,
      dirty = false;

    function emitChange() {
      dirty = true;
      if (statusEl) statusEl.textContent = 'Alterações não salvas';
      if (typeof onChange === 'function') onChange(cloneData(data));
    }

    function markSaved() {
      dirty = false;
      if (statusEl) statusEl.textContent = 'Canvas salvo';
    }

    function screenToWorld(clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      return {
        x: (clientX - rect.left - camera.x) / camera.zoom,
        y: (clientY - rect.top - camera.y) / camera.zoom,
      };
    }

    function applyCamera() {
      world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
      renderEdges();
    }

    function nodeById(id) {
      return data.nodes.find((n) => n.id === id);
    }

    function renderEdges() {
      if (!edgesSvg) return;
      edgesSvg.replaceChildren();
      const width = viewport.clientWidth,
        height = viewport.clientHeight;
      edgesSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      edgesSvg.setAttribute('width', String(width));
      edgesSvg.setAttribute('height', String(height));
      for (const edge of data.edges) {
        const from = nodeById(edge.fromNode),
          to = nodeById(edge.toNode);
        if (!from || !to) continue;
        const a = sidePoint(from, edge.fromSide || 'right'),
          b = sidePoint(to, edge.toSide || 'left');
        const ax = a.x * camera.zoom + camera.x,
          ay = a.y * camera.zoom + camera.y,
          bx = b.x * camera.zoom + camera.x,
          by = b.y * camera.zoom + camera.y;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const dx = Math.max(40, Math.abs(bx - ax) * 0.4);
        const d =
          edge.fromSide === 'top' || edge.fromSide === 'bottom'
            ? `M ${ax} ${ay} C ${ax} ${ay + (by - ay) / 2}, ${bx} ${ay + (by - ay) / 2}, ${bx} ${by}`
            : `M ${ax} ${ay} C ${ax + (bx > ax ? dx : -dx)} ${ay}, ${bx + (bx > ax ? -dx : dx)} ${by}, ${bx} ${by}`;
        path.setAttribute('d', d);
        path.setAttribute('class', 'canvas-edge' + (selected.has(edge.id) ? ' is-selected' : ''));
        path.dataset.edgeId = edge.id;
        path.onclick = (event) => {
          event.stopPropagation();
          selected.clear();
          selected.add(edge.id);
          renderNodes();
          renderEdges();
        };
        edgesSvg.append(path);
        if (edge.label) {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          label.setAttribute('x', String((ax + bx) / 2));
          label.setAttribute('y', String((ay + by) / 2 - 6));
          label.setAttribute('text-anchor', 'middle');
          label.setAttribute('class', 'canvas-edge-label');
          label.textContent = edge.label;
          edgesSvg.append(label);
        }
      }
      if (linking) {
        const from = nodeById(linking.fromId);
        if (from) {
          const a = sidePoint(from, linking.fromSide);
          const ax = a.x * camera.zoom + camera.x,
            ay = a.y * camera.zoom + camera.y;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', `M ${ax} ${ay} L ${linking.x} ${linking.y}`);
          path.setAttribute('class', 'canvas-edge is-draft');
          edgesSvg.append(path);
        }
      }
    }

    function renderNodes() {
      world.querySelectorAll('.canvas-node').forEach((el) => el.remove());
      for (const node of data.nodes) {
        const el = document.createElement('article');
        el.className =
          'canvas-node' +
          (selected.has(node.id) ? ' is-selected' : '') +
          (node.type === 'group' ? ' is-group' : '') +
          (node.type === 'file' ? ' is-file' : '');
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        el.style.width = node.width + 'px';
        el.style.height = node.height + 'px';
        if (node.color && COLORS[node.color])
          el.style.setProperty('--canvas-node-accent', COLORS[node.color]);
        el.dataset.nodeId = node.id;

        const header = document.createElement('header');
        header.className = 'canvas-node-header';
        const kind = document.createElement('span');
        kind.textContent =
          node.type === 'file' ? 'Nota' : node.type === 'group' ? 'Grupo' : 'Texto';
        header.append(kind);
        if (node.type === 'file') {
          const open = document.createElement('button');
          open.type = 'button';
          open.className = 'canvas-node-open';
          open.textContent = 'Abrir';
          open.onclick = (event) => {
            event.stopPropagation();
            if (node.file && typeof onOpenFile === 'function') onOpenFile(node.file);
          };
          header.append(open);
        }
        el.append(header);

        if (node.type === 'text' || node.type === 'group') {
          const area = document.createElement('textarea');
          area.className = 'canvas-node-text';
          area.value = node.type === 'group' ? node.label || '' : node.text || '';
          area.placeholder = node.type === 'group' ? 'Nome do grupo' : 'Escreva aqui…';
          area.onpointerdown = (event) => event.stopPropagation();
          area.oninput = () => {
            if (node.type === 'group') node.label = area.value;
            else node.text = area.value;
            emitChange();
          };
          el.append(area);
        } else {
          const body = document.createElement('div');
          body.className = 'canvas-node-file';
          body.textContent = node.file || 'Nota não definida';
          body.ondblclick = () => {
            if (node.file && typeof onOpenFile === 'function') onOpenFile(node.file);
          };
          el.append(body);
        }

        for (const side of ['top', 'right', 'bottom', 'left']) {
          const port = document.createElement('button');
          port.type = 'button';
          port.className = 'canvas-port canvas-port-' + side;
          port.title = 'Arraste para conectar';
          port.onpointerdown = (event) => {
            event.preventDefault();
            event.stopPropagation();
            selected.clear();
            selected.add(node.id);
            linking = {
              fromId: node.id,
              fromSide: side,
              x: event.clientX - viewport.getBoundingClientRect().left,
              y: event.clientY - viewport.getBoundingClientRect().top,
            };
            port.setPointerCapture(event.pointerId);
            renderNodes();
            renderEdges();
          };
          el.append(port);
        }

        const handle = document.createElement('div');
        handle.className = 'canvas-resize';
        handle.onpointerdown = (event) => {
          event.preventDefault();
          event.stopPropagation();
          resizing = {
            id: node.id,
            startX: event.clientX,
            startY: event.clientY,
            width: node.width,
            height: node.height,
          };
          handle.setPointerCapture(event.pointerId);
        };
        el.append(handle);

        el.onpointerdown = (event) => {
          if (event.button !== 0 || spaceHeld) return;
          if (event.target.closest('.canvas-port, .canvas-resize, textarea, button')) return;
          event.preventDefault();
          if (!event.shiftKey) selected.clear();
          selected.add(node.id);
          dragging = {
            ids: [...selected].filter((id) => nodeById(id)),
            origin: Object.fromEntries(
              [...selected]
                .map((id) => nodeById(id))
                .filter(Boolean)
                .map((n) => [n.id, { x: n.x, y: n.y }]),
            ),
            startX: event.clientX,
            startY: event.clientY,
          };
          el.setPointerCapture(event.pointerId);
          renderNodes();
          renderEdges();
        };

        world.append(el);
      }
    }

    function fitView() {
      if (!data.nodes.length) {
        camera = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2, zoom: 1 };
        applyCamera();
        return;
      }
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const node of data.nodes) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }
      const pad = 80;
      const w = maxX - minX || 400,
        h = maxY - minY || 300;
      const zoom = Math.min(
        1.4,
        Math.max(
          0.35,
          Math.min((viewport.clientWidth - pad) / w, (viewport.clientHeight - pad) / h),
        ),
      );
      camera.zoom = zoom;
      camera.x = (viewport.clientWidth - (minX + maxX) * zoom) / 2;
      camera.y = (viewport.clientHeight - (minY + maxY) * zoom) / 2;
      applyCamera();
    }

    function addTextNode(at) {
      const point = at || screenToWorld(viewport.clientWidth / 2, viewport.clientHeight / 2);
      data.nodes.push({
        id: uid(),
        type: 'text',
        x: point.x - 130,
        y: point.y - 70,
        width: 260,
        height: 140,
        text: '',
      });
      emitChange();
      renderNodes();
      renderEdges();
    }

    function addGroupNode(at) {
      const point = at || screenToWorld(viewport.clientWidth / 2, viewport.clientHeight / 2);
      data.nodes.push({
        id: uid(),
        type: 'group',
        x: point.x - 180,
        y: point.y - 120,
        width: 360,
        height: 240,
        label: 'Grupo',
      });
      emitChange();
      renderNodes();
      renderEdges();
    }

    async function addFileNode(at) {
      if (typeof onRequestNotes !== 'function') return;
      const file = await onRequestNotes();
      if (!file) return;
      const point = at || screenToWorld(viewport.clientWidth / 2, viewport.clientHeight / 2);
      data.nodes.push({
        id: uid(),
        type: 'file',
        x: point.x - 130,
        y: point.y - 60,
        width: 260,
        height: 120,
        file,
      });
      emitChange();
      renderNodes();
      renderEdges();
    }

    function deleteSelected() {
      if (!selected.size) return;
      const ids = new Set(selected);
      data.nodes = data.nodes.filter((node) => !ids.has(node.id));
      data.edges = data.edges.filter(
        (edge) => !ids.has(edge.id) && !ids.has(edge.fromNode) && !ids.has(edge.toNode),
      );
      selected.clear();
      emitChange();
      renderNodes();
      renderEdges();
    }

    function setColor(color) {
      for (const id of selected) {
        const node = nodeById(id);
        if (node) node.color = color || undefined;
      }
      emitChange();
      renderNodes();
    }

    function onPointerMove(event) {
      if (panning) {
        camera.x = panning.originX + (event.clientX - panning.startX);
        camera.y = panning.originY + (event.clientY - panning.startY);
        applyCamera();
        return;
      }
      if (dragging) {
        const dx = (event.clientX - dragging.startX) / camera.zoom;
        const dy = (event.clientY - dragging.startY) / camera.zoom;
        for (const id of dragging.ids) {
          const node = nodeById(id);
          const origin = dragging.origin[id];
          if (!node || !origin) continue;
          node.x = origin.x + dx;
          node.y = origin.y + dy;
        }
        renderNodes();
        renderEdges();
        return;
      }
      if (resizing) {
        const node = nodeById(resizing.id);
        if (!node) return;
        node.width = Math.max(
          140,
          resizing.width + (event.clientX - resizing.startX) / camera.zoom,
        );
        node.height = Math.max(
          90,
          resizing.height + (event.clientY - resizing.startY) / camera.zoom,
        );
        renderNodes();
        renderEdges();
        return;
      }
      if (linking) {
        const rect = viewport.getBoundingClientRect();
        linking.x = event.clientX - rect.left;
        linking.y = event.clientY - rect.top;
        renderEdges();
      }
    }

    function onPointerUp(event) {
      if (panning) {
        panning = null;
        viewport.classList.remove('is-panning');
      }
      if (dragging) {
        dragging = null;
        emitChange();
      }
      if (resizing) {
        resizing = null;
        emitChange();
      }
      if (linking) {
        const worldPoint = screenToWorld(event.clientX, event.clientY);
        const target = data.nodes.find(
          (node) =>
            node.id !== linking.fromId &&
            worldPoint.x >= node.x &&
            worldPoint.x <= node.x + node.width &&
            worldPoint.y >= node.y &&
            worldPoint.y <= node.y + node.height,
        );
        if (target) {
          data.edges.push({
            id: uid(),
            fromNode: linking.fromId,
            fromSide: linking.fromSide,
            toNode: target.id,
            toSide: nearestSide(target, worldPoint.x, worldPoint.y),
          });
          emitChange();
        }
        linking = null;
        renderEdges();
      }
    }

    function mount(container, options = {}) {
      unmount();
      data = cloneData(options.data || { nodes: [], edges: [] });
      onChange = options.onChange || null;
      onOpenFile = options.onOpenFile || null;
      onRequestNotes = options.onRequestNotes || null;
      dirty = false;
      selected.clear();
      const previousView = options.view;
      camera =
        previousView && [previousView.x, previousView.y, previousView.zoom].every(Number.isFinite)
          ? {
              x: previousView.x,
              y: previousView.y,
              zoom: Math.min(2.5, Math.max(0.25, previousView.zoom)),
            }
          : { x: 40, y: 40, zoom: 1 };

      root = document.createElement('div');
      root.className = 'canvas-board';
      const toolbar = document.createElement('div');
      toolbar.className = 'canvas-toolbar';
      const mkBtn = (label, title, action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.onclick = action;
        return button;
      };
      toolbar.append(
        mkBtn('Texto', 'Adicionar cartão de texto', () => addTextNode()),
        mkBtn('Nota', 'Adicionar cartão de nota', () => addFileNode()),
        mkBtn('Grupo', 'Adicionar grupo', () => addGroupNode()),
        mkBtn('Enquadrar', 'Ajustar a vista aos cartões', () => fitView()),
        mkBtn('Apagar', 'Apagar seleção', () => deleteSelected()),
      );
      const colors = document.createElement('div');
      colors.className = 'canvas-color-row';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'canvas-color-swatch is-clear';
      clear.title = 'Sem cor';
      clear.setAttribute('aria-label', 'Sem cor');
      clear.onclick = () => setColor('');
      colors.append(clear);
      for (const [key, value] of Object.entries(COLORS)) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'canvas-color-swatch';
        swatch.style.background = value;
        swatch.title = ['Terracota', 'Âmbar', 'Sálvia', 'Azul', 'Ameixa', 'Cinza'][Number(key) - 1];
        swatch.setAttribute('aria-label', 'Cor ' + swatch.title);
        swatch.onclick = () => setColor(key);
        colors.append(swatch);
      }
      toolbar.append(colors);
      statusEl = document.createElement('span');
      statusEl.className = 'canvas-status';
      statusEl.textContent = 'Canvas pronto';
      toolbar.append(statusEl);

      viewport = document.createElement('div');
      viewport.className = 'canvas-viewport';
      viewport.tabIndex = 0;
      edgesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      edgesSvg.classList.add('canvas-edges');
      world = document.createElement('div');
      world.className = 'canvas-world';
      viewport.append(edgesSvg, world);

      const help = document.createElement('p');
      help.className = 'canvas-help';
      help.textContent =
        'Arraste o fundo para navegar · scroll para zoom · Espaço+arraste · portas laterais conectam cartões · Delete apaga';

      root.append(toolbar, viewport, help);
      container.replaceChildren(root);

      viewport.onpointerdown = (event) => {
        if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceHeld)) {
          event.preventDefault();
          panning = {
            startX: event.clientX,
            startY: event.clientY,
            originX: camera.x,
            originY: camera.y,
          };
          viewport.classList.add('is-panning');
          viewport.setPointerCapture(event.pointerId);
          return;
        }
        if (event.button === 0 && event.target === viewport) {
          selected.clear();
          renderNodes();
          renderEdges();
        }
      };
      viewport.onpointermove = onPointerMove;
      viewport.onpointerup = onPointerUp;
      viewport.onpointercancel = onPointerUp;
      viewport.onwheel = (event) => {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mx = event.clientX - rect.left,
          my = event.clientY - rect.top;
        const before = {
          x: (mx - camera.x) / camera.zoom,
          y: (my - camera.y) / camera.zoom,
        };
        const factor = event.deltaY > 0 ? 0.9 : 1.1;
        camera.zoom = Math.min(2.5, Math.max(0.25, camera.zoom * factor));
        camera.x = mx - before.x * camera.zoom;
        camera.y = my - before.y * camera.zoom;
        applyCamera();
      };
      viewport.oncontextmenu = (event) => event.preventDefault();

      const keydown = (event) => {
        if (!root.isConnected) return;
        if (event.code === 'Space' && event.target === viewport) {
          spaceHeld = true;
          viewport.classList.add('can-pan');
          event.preventDefault();
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && event.target === viewport) {
          event.preventDefault();
          deleteSelected();
        }
      };
      const keyup = (event) => {
        if (event.code === 'Space') {
          spaceHeld = false;
          viewport.classList.remove('can-pan');
        }
      };
      window.addEventListener('keydown', keydown);
      window.addEventListener('keyup', keyup);
      root._cleanup = () => {
        window.removeEventListener('keydown', keydown);
        window.removeEventListener('keyup', keyup);
      };

      renderNodes();
      applyCamera();
      if (data.nodes.length && !previousView) fitView();
      else applyCamera();
    }

    function unmount() {
      if (root?._cleanup) root._cleanup();
      if (root) root.remove();
      root = viewport = world = edgesSvg = statusEl = null;
      dragging = resizing = linking = panning = null;
      onChange = onOpenFile = onRequestNotes = null;
      dirty = false;
    }

    function setData(next, { saved = false } = {}) {
      data = cloneData(next);
      if (saved) markSaved();
      renderNodes();
      renderEdges();
    }

    return {
      mount,
      unmount,
      setData,
      getData: () => cloneData(data),
      getView: () => ({ ...camera }),
      isDirty: () => dirty,
      markSaved,
      fitView,
    };
  }

  let activeBoard = null;
  global.SophyCanvas = {
    mount(container, options) {
      if (!activeBoard) activeBoard = createBoard();
      activeBoard.mount(container, options);
      return activeBoard;
    },
    unmount() {
      activeBoard?.unmount();
    },
    get active() {
      return activeBoard;
    },
  };
})(window);
