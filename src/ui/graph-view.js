(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function localGraph(graph, centerPath, depth = 1) {
    if (!centerPath) return graph;
    const adjacent = new Map(graph.nodes.map((node) => [node.path, new Set()]));
    for (const edge of graph.edges) {
      adjacent.get(edge.from)?.add(edge.to);
      adjacent.get(edge.to)?.add(edge.from);
    }
    const found = new Set([centerPath]);
    let frontier = new Set(found);
    for (let level = 0; level < clamp(Number(depth) || 1, 1, 3); level += 1) {
      const next = new Set();
      for (const path of frontier)
        for (const neighbor of adjacent.get(path) || [])
          if (!found.has(neighbor)) next.add(neighbor);
      for (const path of next) found.add(path);
      frontier = next;
      if (!frontier.size) break;
    }
    return {
      nodes: graph.nodes.filter((node) => found.has(node.path)),
      edges: graph.edges.filter((edge) => found.has(edge.from) && found.has(edge.to)),
    };
  }

  function create(config) {
    const canvas = config.canvas;
    const minimap = config.minimap;
    const ctx = canvas.getContext('2d');
    const miniCtx = minimap?.getContext('2d');
    const graph = config.graph || { nodes: [], edges: [] };
    const libraryKey = config.libraryKey || 'default';
    const saved = config.saved || {};
    const savedCamera = saved.camera || {};
    const camera = {
      x: Number.isFinite(savedCamera.x) ? clamp(savedCamera.x, -1e7, 1e7) : 0,
      y: Number.isFinite(savedCamera.y) ? clamp(savedCamera.y, -1e7, 1e7) : 0,
      zoom: Number.isFinite(savedCamera.zoom) ? clamp(savedCamera.zoom, 0.2, 5) : 1,
    };
    const options = {
      distance: 90,
      repulsion: 500,
      linkForce: 0.018,
      center: 0.006,
      shelfAttraction: 0,
    };
    const optionRanges = {
      distance: [35, 220],
      repulsion: [80, 1400],
      linkForce: [0.002, 0.08],
      center: [0, 0.03],
      shelfAttraction: [0, 0.03],
    };
    for (const [key, [min, max]] of Object.entries(optionRanges)) {
      const value = Number(saved.options?.[key]);
      if (Number.isFinite(value)) options[key] = clamp(value, min, max);
    }
    const pinned = new Map(
      Object.entries(saved.pinned || {}).filter(
        ([, point]) =>
          Number.isFinite(point?.x) &&
          Number.isFinite(point?.y) &&
          Math.abs(point.x) <= 1e7 &&
          Math.abs(point.y) <= 1e7,
      ),
    );
    const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
    const indexByPath = new Map(graph.nodes.map((node, index) => [node.path, index]));
    const degree = new Map();
    const incoming = new Map();
    const outgoing = new Map();
    const links = [];
    for (const edge of graph.edges) {
      const a = indexByPath.get(edge.from),
        b = indexByPath.get(edge.to);
      if (a == null || b == null) continue;
      links.push([a, b]);
      degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
      outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + 1);
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    }
    const bounds = canvas.parentElement.getBoundingClientRect();
    const positions = graph.nodes.map((node, index) => {
      const savedPoint = pinned.get(node.path);
      const angle = (index / Math.max(graph.nodes.length, 1)) * Math.PI * 2;
      const radius = Math.max(110, Math.sqrt(graph.nodes.length) * 34);
      return {
        x: Number.isFinite(savedPoint?.x)
          ? savedPoint.x
          : bounds.width / 2 + Math.cos(angle) * radius,
        y: Number.isFinite(savedPoint?.y)
          ? savedPoint.y
          : bounds.height / 2 + Math.sin(angle) * radius,
        pinned: !!savedPoint,
        homeX: Number.isFinite(savedPoint?.x)
          ? savedPoint.x
          : bounds.width / 2 + Math.cos(angle) * radius,
        homeY: Number.isFinite(savedPoint?.y)
          ? savedPoint.y
          : bounds.height / 2 + Math.sin(angle) * radius,
      };
    });
    let visible = graph;
    let baseGraph = graph;
    let selected = config.activePath || null;
    let hovered = null;
    let mode = config.mode || 'global';
    let depth = config.depth || 1;
    let showOrphans = saved.showOrphans !== false;
    let until = 0;
    let showLabels = saved.showLabels !== false;
    let paused = !!config.reducedMotion;
    let disposed = false;
    let pointer = null;
    let raf = 0;
    let saveTimer = 0;
    let dismissTimer = 0;
    let cameraAnim = 0;
    let pulseUntil = 0;
    let pinnedCard = false;
    let ctrlHeld = false;
    let lastHit = null;
    let lastEvent = null;
    let introStart = performance.now();
    let minimapDrag = false;
    let resizeObserver;
    let worker;
    let themeCache = null;
    let themeStamp = '';
    let dotKey = '';
    let dotPattern = null;
    const glyph = (name) => (typeof config.icon === 'function' ? config.icon(name) : '');

    try {
      worker = new Worker(new URL('ui/graph-worker.js', location.href));
    } catch {
      try {
        worker = new Worker('ui/graph-worker.js');
      } catch {
        worker = null;
      }
    }

    const getColor = (node) => config.colorOf?.(node) || '#8988c8';
    const ease = (value) => {
      const t = clamp(value, 0, 1);
      return t * t * (3 - 2 * t);
    };
    const introDelay = (index) => Math.min(index, 22) * (graph.nodes.length > 36 ? 16 : 46);
    const nodeReveal = (node) => {
      if (config.reducedMotion) return 1;
      const index = indexByPath.get(node.path) ?? 0;
      return ease((performance.now() - introStart - introDelay(index)) / 260);
    };
    const edgeReveal = (from, to) => {
      if (config.reducedMotion) return 1;
      const index = Math.max(indexByPath.get(from.path) ?? 0, indexByPath.get(to.path) ?? 0);
      return ease((performance.now() - introStart - introDelay(index) - 220) / 320);
    };
    const introLive = () => {
      if (config.reducedMotion || !graph.nodes.length) return false;
      const last = introDelay(Math.min(graph.nodes.length - 1, 22)) + 620;
      return performance.now() - introStart < last;
    };
    const worldAt = (point) => ({
      x: (point.x - canvas.clientWidth / 2) / camera.zoom + canvas.clientWidth / 2 - camera.x,
      y: (point.y - canvas.clientHeight / 2) / camera.zoom + canvas.clientHeight / 2 - camera.y,
    });
    const screenAt = (node) => ({
      x: canvas.clientWidth / 2 + (node.x - canvas.clientWidth / 2 + camera.x) * camera.zoom,
      y: canvas.clientHeight / 2 + (node.y - canvas.clientHeight / 2 + camera.y) * camera.zoom,
    });
    const eventPoint = (event, target = canvas) => {
      const rect = target.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    let miniMapTransform = null;
    /* Linha do tempo pelo createdAt (mesma regra do `to` de graph.query); sem ele, cai no modifiedAt. */
    const createdMs = (node) => {
      const created = Date.parse(node.createdAt);
      return Number.isNaN(created) ? node.modifiedAt || 0 : created;
    };
    const rebuildVisible = (subset = baseGraph) => {
      const allowed = new Set(subset.nodes.map((node) => node.path));
      const subsetDegree = new Map();
      for (const edge of subset.edges) {
        subsetDegree.set(edge.from, (subsetDegree.get(edge.from) || 0) + 1);
        subsetDegree.set(edge.to, (subsetDegree.get(edge.to) || 0) + 1);
      }
      let nodes = subset.nodes.filter(
        (node) =>
          (showOrphans || (subsetDegree.get(node.path) || 0) > 0) &&
          (!until || !createdMs(node) || createdMs(node) <= until),
      );
      if (mode === 'local' && selected)
        nodes = localGraph(
          {
            nodes,
            edges: subset.edges.filter((edge) => allowed.has(edge.from) && allowed.has(edge.to)),
          },
          selected,
          depth,
        ).nodes;
      const set = new Set(nodes.map((node) => node.path));
      visible = {
        nodes,
        edges: subset.edges.filter((edge) => set.has(edge.from) && set.has(edge.to)),
      };
      return visible;
    };
    rebuildVisible();
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (minimap) {
        const mini = minimap.getBoundingClientRect();
        minimap.width = Math.max(1, Math.floor(mini.width * dpr));
        minimap.height = Math.max(1, Math.floor(mini.height * dpr));
        miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      scheduleDraw();
    };
    const scheduleDraw = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          draw();
        });
    };
    const persist = () => {
      const layout = {
        version: 1,
        camera,
        options,
        pinned: Object.fromEntries(pinned),
        showOrphans,
        showLabels,
      };
      try {
        localStorage.setItem(`sophy-graph:${libraryKey}`, JSON.stringify(layout));
      } catch {}
      config.onSave?.(layout);
    };
    const save = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = 0;
        persist();
      }, 250);
    };
    let stalePositions = false;
    for (const path of pinned.keys()) {
      if (!indexByPath.has(path)) {
        pinned.delete(path);
        stalePositions = true;
      }
    }
    if (stalePositions) save();
    const getTheme = () => {
      const root = document.documentElement;
      const stamp = `${root.dataset.theme || ''}|${root.dataset.accent || ''}|${root.dataset.font || ''}`;
      if (themeCache && themeStamp === stamp) return themeCache;
      themeStamp = stamp;
      dotKey = '';
      const style = getComputedStyle(root);
      themeCache = {
        bg: style.getPropertyValue('--bg').trim() || '#15141a',
        ink: style.getPropertyValue('--ink').trim() || '#eceaf1',
        muted: style.getPropertyValue('--ink-3').trim() || '#85818f',
        dot: style.getPropertyValue('--canvas-dot').trim() || '#302e36',
        accent: style.getPropertyValue('--accent').trim() || '#aaa4ef',
        line: style.getPropertyValue('--line').trim() || '#45414e',
      };
      return themeCache;
    };
    const nodeRadius = (node) =>
      clamp(5 + Math.sqrt(degree.get(node.path) || 0) * 1.25, 5.5, 13) *
      clamp(camera.zoom, 0.85, 1.35);
    const setText = (selector, text) => {
      const el = document.querySelector(selector);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const paintDots = (theme, width, height) => {
      const spacing = Math.max(18, Math.round(26 * clamp(camera.zoom, 0.8, 1.5)));
      const key = `${theme.dot}|${spacing}`;
      if (dotKey !== key || !dotPattern) {
        const tile = document.createElement('canvas');
        tile.width = spacing;
        tile.height = spacing;
        const g = tile.getContext('2d');
        g.fillStyle = theme.dot;
        g.beginPath();
        g.arc(1.1, 1.1, 1.05, 0, Math.PI * 2);
        g.fill();
        dotPattern = ctx.createPattern(tile, 'repeat');
        dotKey = key;
      }
      if (!dotPattern) return;
      const offsetX = (((camera.x * camera.zoom) % spacing) + spacing) % spacing;
      const offsetY = (((camera.y * camera.zoom) % spacing) + spacing) % spacing;
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.fillStyle = dotPattern;
      ctx.fillRect(-spacing, -spacing, width + spacing * 2, height + spacing * 2);
      ctx.restore();
    };
    const trimEdge = (a, b, startGap, endGap) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const start = Math.max(0, Math.min(startGap, len * 0.45));
      const end = Math.max(0, Math.min(endGap, len * 0.45));
      return {
        x1: a.x + ux * start,
        y1: a.y + uy * start,
        x2: b.x - ux * end,
        y2: b.y - uy * end,
      };
    };
    const drawArrow = (x1, y1, x2, y2, color, alpha) => {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const size = clamp(6.5 * Math.min(camera.zoom, 1.3), 5.5, 9);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(angle - 0.42), y2 - size * Math.sin(angle - 0.42));
      ctx.lineTo(x2 - size * Math.cos(angle + 0.42), y2 - size * Math.sin(angle + 0.42));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    const draw = () => {
      if (disposed) return;
      const width = canvas.clientWidth,
        height = canvas.clientHeight,
        theme = getTheme();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, width, height);
      paintDots(theme, width, height);
      const hot = hovered || selected;
      const neighbors = new Set(hot ? [hot] : []);
      if (hot)
        for (const edge of visible.edges)
          if (edge.from === hot) neighbors.add(edge.to);
          else if (edge.to === hot) neighbors.add(edge.from);
      const buckets = new Map();
      const hotEdges = [];
      const showArrows = visible.edges.length <= 700 && camera.zoom > 0.42;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const edge of visible.edges) {
        const fromNode = nodeByPath.get(edge.from);
        const toNode = nodeByPath.get(edge.to);
        const from = positions[indexByPath.get(edge.from)];
        const to = positions[indexByPath.get(edge.to)];
        if (!from || !to || !fromNode || !toNode) continue;
        const a = screenAt(from);
        const b = screenAt(to);
        if (
          (a.x < -30 && b.x < -30) ||
          (a.x > width + 30 && b.x > width + 30) ||
          (a.y < -30 && b.y < -30) ||
          (a.y > height + 30 && b.y > height + 30)
        )
          continue;
        const link = edgeReveal(fromNode, toNode);
        if (link <= 0.02) continue;
        const emphasized = !!(hot && (edge.from === hot || edge.to === hot));
        const segment = trimEdge(
          a,
          b,
          nodeRadius(fromNode) + 1,
          nodeRadius(toNode) + (showArrows ? 8 : 2),
        );
        segment.x2 = segment.x1 + (segment.x2 - segment.x1) * link;
        segment.y2 = segment.y1 + (segment.y2 - segment.y1) * link;
        segment.arrow = link > 0.92;
        if (emphasized) {
          hotEdges.push(segment);
          continue;
        }
        const color = hot ? theme.line : getColor(fromNode);
        let bucket = buckets.get(color);
        if (!bucket) buckets.set(color, (bucket = []));
        bucket.push(segment);
      }
      const baseWidth = Math.max(1.85, Math.min(2.6, 2 * camera.zoom));
      for (const [color, segments] of buckets) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = baseWidth;
        ctx.globalAlpha = hot ? 0.46 : 0.92;
        for (const segment of segments) {
          ctx.moveTo(segment.x1, segment.y1);
          ctx.lineTo(segment.x2, segment.y2);
        }
        ctx.stroke();
        if (showArrows && !hot)
          for (const segment of segments)
            if (segment.arrow) drawArrow(segment.x1, segment.y1, segment.x2, segment.y2, color, 0.95);
      }
      if (hotEdges.length) {
        ctx.beginPath();
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = Math.max(2.4, baseWidth + 0.7);
        ctx.globalAlpha = 1;
        for (const segment of hotEdges) {
          ctx.moveTo(segment.x1, segment.y1);
          ctx.lineTo(segment.x2, segment.y2);
        }
        ctx.stroke();
        if (showArrows || hotEdges.length <= 40)
          for (const segment of hotEdges)
            if (segment.arrow) drawArrow(segment.x1, segment.y1, segment.x2, segment.y2, theme.accent, 1);
      }
      ctx.globalAlpha = 1;
      const labelLimit = visible.nodes.length > 1800 ? 0 : visible.nodes.length > 650 ? 0.9 : 0.45;
      const compactNodes = visible.nodes.length > 8000;
      for (const node of visible.nodes) {
        const point = positions[indexByPath.get(node.path)];
        const reveal = nodeReveal(node);
        if (!point || reveal < 0.02) continue;
        const at = screenAt(point);
        if (at.x < -80 || at.x > width + 80 || at.y < -30 || at.y > height + 30) continue;
        const active = node.path === selected || node.path === hovered;
        const color = getColor(node);
        if (compactNodes && !active) {
          ctx.fillStyle = color;
          ctx.globalAlpha = (hot && !neighbors.has(node.path) ? 0.45 : 0.95) * reveal;
          ctx.beginPath();
          ctx.arc(at.x, at.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        const radius = nodeRadius(node) * (0.2 + 0.8 * reveal);
        const dimmed = hot && !neighbors.has(node.path);
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius + 2.4, 0, Math.PI * 2);
        ctx.fillStyle = theme.bg;
        ctx.globalAlpha = (dimmed ? 0.55 : 1) * reveal;
        ctx.fill();
        if (active || performance.now() < pulseUntil) {
          const pulse = pulseUntil
            ? clamp((pulseUntil - performance.now()) / 420, 0, 1)
            : 0;
          ctx.beginPath();
          ctx.arc(at.x, at.y, radius + 6 + pulse * 8, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.globalAlpha = active ? 0.34 + pulse * 0.4 : pulse * 0.45;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = (dimmed ? 0.5 : 1) * reveal;
        ctx.beginPath();
        ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (showLabels && (active || camera.zoom >= labelLimit)) {
          ctx.font = `${active ? 600 : 400} ${clamp(12 * camera.zoom, 9, 16)}px Inter, sans-serif`;
          ctx.fillStyle = theme.ink;
          ctx.globalAlpha = (hot && !neighbors.has(node.path) ? 0.2 : 0.92) * reveal;
          ctx.fillText(
            node.title || node.path.split('/').pop().replace(/\.md$/i, ''),
            at.x + radius + 7,
            at.y + 4,
          );
          ctx.globalAlpha = 1;
        }
      }
      drawMinimap(theme, width, height);
      const notes = visible.nodes.length;
      const links = visible.edges.length;
      setText(
        '#grafo-contagem',
        `${notes} ${notes === 1 ? 'nota' : 'notas'} · ${links} ${links === 1 ? 'link' : 'links'}`,
      );
      setText('#grafo-zoom-valor', `${Math.round(camera.zoom * 100)}%`);
      if (performance.now() < pulseUntil || introLive()) scheduleDraw();
    };
    const drawMinimap = (theme, width, height) => {
      if (!miniCtx || !minimap) return;
      const mw = minimap.clientWidth,
        mh = minimap.clientHeight;
      miniCtx.clearRect(0, 0, mw, mh);
      miniCtx.fillStyle = theme.bg;
      miniCtx.fillRect(0, 0, mw, mh);
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const node of visible.nodes) {
        const point = positions[indexByPath.get(node.path)];
        if (!point) continue;
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = width;
        minY = 0;
        maxY = height;
      }
      const padding = 80;
      const scale = Math.min(
        (mw - 20) / Math.max(maxX - minX + padding * 2, 1),
        (mh - 20) / Math.max(maxY - minY + padding * 2, 1),
      );
      const cx = mw / 2,
        cy = mh / 2,
        worldCenterX = (minX + maxX) / 2,
        worldCenterY = (minY + maxY) / 2;
      miniMapTransform = {
        rect: minimap.getBoundingClientRect(),
        scale,
        cx,
        cy,
        worldCenterX,
        worldCenterY,
      };
      if (visible.edges.length && visible.edges.length <= 4000) {
        miniCtx.beginPath();
        miniCtx.strokeStyle = theme.line;
        miniCtx.globalAlpha = 0.7;
        miniCtx.lineWidth = 1;
        for (const edge of visible.edges) {
          const from = positions[indexByPath.get(edge.from)];
          const to = positions[indexByPath.get(edge.to)];
          if (!from || !to) continue;
          miniCtx.moveTo(cx + (from.x - worldCenterX) * scale, cy + (from.y - worldCenterY) * scale);
          miniCtx.lineTo(cx + (to.x - worldCenterX) * scale, cy + (to.y - worldCenterY) * scale);
        }
        miniCtx.stroke();
      }
      miniCtx.globalAlpha = 1;
      for (
        let i = 0;
        i < visible.nodes.length;
        i += Math.max(1, Math.ceil(visible.nodes.length / 2500))
      ) {
        const node = visible.nodes[i],
          p = positions[indexByPath.get(node.path)];
        if (!p) continue;
        miniCtx.fillStyle = getColor(node);
        miniCtx.beginPath();
        miniCtx.arc(
          cx + (p.x - worldCenterX) * scale,
          cy + (p.y - worldCenterY) * scale,
          node.path === selected ? 3.2 : 2.1,
          0,
          Math.PI * 2,
        );
        miniCtx.fill();
      }
      const topLeft = worldAt({ x: 0, y: 0 }),
        bottomRight = worldAt({ x: width, y: height });
      miniCtx.globalAlpha = 1;
      miniCtx.strokeStyle = theme.accent;
      miniCtx.lineWidth = 1.5;
      miniCtx.strokeRect(
        cx + (topLeft.x - worldCenterX) * scale,
        cy + (topLeft.y - worldCenterY) * scale,
        (bottomRight.x - topLeft.x) * scale,
        (bottomRight.y - topLeft.y) * scale,
      );
    };
    const hitTest = (point) => {
      let best = null,
        bestDistance = Infinity;
      for (const node of visible.nodes) {
        const p = positions[indexByPath.get(node.path)];
        if (!p) continue;
        const at = screenAt(p),
          dist = Math.hypot(at.x - point.x, at.y - point.y);
        const radius = Math.max(16, 13 * camera.zoom);
        if (dist <= radius && dist < bestDistance) {
          best = node;
          bestDistance = dist;
        }
      }
      return best;
    };
    const showCard = (node, event, mode = 'hover') => {
      const card = document.querySelector('#grafo-cartao');
      if (!card) return;
      if (mode === 'dismiss') pinnedCard = false;
      if (!node && (pinnedCard || ctrlHeld) && mode !== 'dismiss') return;
      if (mode === 'pin') pinnedCard = !!node;
      if (node && hovered === node.path && !card.hidden && mode !== 'pin') {
        clearTimeout(dismissTimer);
        scheduleDraw();
        return;
      }
      hovered = node?.path || null;
      if (!node) {
        card.hidden = true;
        card.classList.remove('is-fixo');
        scheduleDraw();
        return;
      }
      const edited = Number(node.modifiedAt)
        ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(
            new Date(node.modifiedAt),
          )
        : 'Data indisponível';
      const ins = incoming.get(node.path) || 0;
      const outs = outgoing.get(node.path) || 0;
      const tagHtml = (node.tags || [])
        .slice(0, 4)
        .map(
          (tag) =>
            `<span class="grafo__tag"><i style="--grafo-cor:${config.tagColor?.(tag) || '#888'}"></i>${config.escape(tag)}</span>`,
        )
        .join('');
      card.innerHTML = `<small>${glyph('estante')}<span>${config.escape(node.workspace || 'Sem estante')}</span></small><strong>${config.escape(node.title || node.path)}</strong>${tagHtml ? `<div class="grafo__tags">${tagHtml}</div>` : ''}<div class="grafo__stats"><span>${glyph('link')}<b>${ins}</b> ${ins === 1 ? 'entrada' : 'entradas'}</span><span>${glyph('externo')}<b>${outs}</b> ${outs === 1 ? 'saída' : 'saídas'}</span></div><span class="grafo__quando">${glyph('nota')}<em>Editada em ${edited}</em></span><button type="button" class="btn btn--secundario" data-open-graph-note>${glyph('nota')} Abrir nota</button>`;
      card.classList.toggle('is-fixo', pinnedCard || mode === 'ctrl');
      clearTimeout(dismissTimer);
      card.hidden = false;
      if (mode === 'pin' || mode === 'ctrl') {
        card.classList.remove('is-entrando');
        void card.offsetWidth;
        card.classList.add('is-entrando');
      }
      const stage = canvas.parentElement.getBoundingClientRect();
      const x = Number.isFinite(event?.clientX) ? event.clientX - stage.left + 14 : stage.width / 2;
      const y = Number.isFinite(event?.clientY) ? event.clientY - stage.top + 14 : stage.height / 2;
      card.style.left = `${clamp(x, 8, Math.max(8, stage.width - 290))}px`;
      card.style.top = `${clamp(y, 8, Math.max(8, stage.height - 240))}px`;
      card.querySelector('[data-open-graph-note]').onclick = () => config.onActivate(node.path);
      card.onpointerenter = () => clearTimeout(dismissTimer);
      card.onpointerleave = () => {
        if (pinnedCard || ctrlHeld) return;
        dismissTimer = setTimeout(() => showCard(null), 160);
      };
      scheduleDraw();
    };
    const setCamera = (
      zoom,
      anchorX = canvas.clientWidth / 2,
      anchorY = canvas.clientHeight / 2,
    ) => {
      const old = camera.zoom;
      const next = clamp(zoom, 0.2, 5);
      const wx = (anchorX - canvas.clientWidth / 2) / old - camera.x;
      const wy = (anchorY - canvas.clientHeight / 2) / old - camera.y;
      camera.zoom = next;
      camera.x = (anchorX - canvas.clientWidth / 2) / next - wx;
      camera.y = (anchorY - canvas.clientHeight / 2) / next - wy;
      scheduleDraw();
      save();
    };
    const tweenCamera = (next) => {
      cancelAnimationFrame(cameraAnim);
      const from = { x: camera.x, y: camera.y, zoom: camera.zoom };
      const target = {
        x: next.x,
        y: next.y,
        zoom: clamp(next.zoom, 0.2, 5),
      };
      if (config.reducedMotion) {
        Object.assign(camera, target);
        scheduleDraw();
        save();
        return;
      }
      const start = performance.now();
      const step = (now) => {
        if (disposed) return;
        const t = clamp((now - start) / 280, 0, 1);
        const eased = 1 - (1 - t) ** 3;
        camera.x = from.x + (target.x - from.x) * eased;
        camera.y = from.y + (target.y - from.y) * eased;
        camera.zoom = from.zoom + (target.zoom - from.zoom) * eased;
        scheduleDraw();
        if (t < 1) cameraAnim = requestAnimationFrame(step);
        else {
          cameraAnim = 0;
          save();
        }
      };
      cameraAnim = requestAnimationFrame(step);
    };
    const startWorker = (run = !paused) => {
      if (!worker || !graph.nodes.length) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      const shelves = [...new Set(graph.nodes.map((node) => node.workspace || ''))];
      worker.postMessage({
        type: 'init',
        nodes: positions.map((point, index) => ({
          ...point,
          group: shelves.indexOf(graph.nodes[index]?.workspace || ''),
        })),
        links,
        options: { ...options, width: rect.width, height: rect.height, shelfCount: shelves.length },
        running: run,
      });
    };
    if (worker)
      worker.onmessage = (event) => {
        if (disposed || event.data.type !== 'positions') return;
        event.data.positions.forEach(([x, y], index) => {
          if (!positions[index] || !Number.isFinite(x) || !Number.isFinite(y)) return;
          if (pointer?.node && indexByPath.get(pointer.node.path) === index) return;
          positions[index].x = x;
          positions[index].y = y;
          if (event.data.done && !positions[index].pinned)
            Object.assign(positions[index], { homeX: x, homeY: y });
        });
        const status = document.querySelector('#grafo-status');
        if (status)
          status.textContent = event.data.done
            ? paused
              ? 'Pausado'
              : 'Layout estável'
            : 'Organizando…';
        const footerStatus = document.querySelector('#grafo-status-rodape');
        if (footerStatus)
          footerStatus.textContent = event.data.done
            ? paused
              ? 'pausado'
              : 'estável'
            : 'estabilizando';
        scheduleDraw();
      };
    if (worker)
      worker.onerror = () => {
        worker.terminate();
        worker = null;
        const status = document.querySelector('#grafo-status');
        if (status) status.textContent = 'Layout estático';
        const footerStatus = document.querySelector('#grafo-status-rodape');
        if (footerStatus) footerStatus.textContent = 'estático';
        document
          .querySelectorAll('[data-force], #grafo-simulacao, #grafo-forcas-restaurar')
          .forEach((input) => {
            input.disabled = true;
          });
        const toggle = document.querySelector('#grafo-simulacao');
        if (toggle) toggle.checked = false;
      };
    startWorker();

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      cancelAnimationFrame(cameraAnim);
      cameraAnim = 0;
      const p = eventPoint(event);
      const hit = hitTest(p);
      clearTimeout(dismissTimer);
      canvas.classList.remove('is-sobre-no');
      pointer = {
        id: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        node: hit,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add(hit ? 'is-arrastando-no' : 'is-arrastando-fundo');
      if (hit) {
        selected = hit.path;
        pulseUntil = performance.now() + 420;
        if (mode === 'local') rebuildVisible();
        config.onSelect?.(hit.path);
        scheduleDraw();
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!pointer || pointer.id !== event.pointerId) {
        const hit = hitTest(eventPoint(event));
        lastHit = hit;
        lastEvent = event;
        canvas.classList.toggle('is-sobre-no', !!hit);
        if (ctrlHeld && hit) showCard(hit, event, 'ctrl');
        return;
      }
      canvas.classList.remove('is-sobre-no');
      const dx = event.clientX - pointer.lastX,
        dy = event.clientY - pointer.lastY;
      pointer.moved ||=
        Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 3;
      if (pointer.node) {
        const i = indexByPath.get(pointer.node.path),
          p = worldAt(eventPoint(event));
        positions[i].x = p.x;
        positions[i].y = p.y;
        worker?.postMessage({ type: 'pin', index: i, x: p.x, y: p.y });
      } else {
        camera.x += dx / camera.zoom;
        camera.y += dy / camera.zoom;
      }
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      scheduleDraw();
    });
    const finishPointer = (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const current = pointer;
      pointer = null;
      canvas.classList.remove('is-arrastando-no', 'is-arrastando-fundo');
      if (current.node && current.moved) releaseNode(current.node);
      else if (!current.moved && !current.node && !ctrlHeld) showCard(null, event, 'dismiss');
      else if (!current.moved && !current.node) save();
      else if (!current.node) save();
    };
    const releaseNode = (node) => {
      const index = indexByPath.get(node.path);
      const point = positions[index];
      if (!point) return;
      point.pinned = false;
      pinned.delete(node.path);
      const homeX = Number.isFinite(point.homeX) ? point.homeX : point.x;
      const homeY = Number.isFinite(point.homeY) ? point.homeY : point.y;
      if (worker) worker.postMessage({ type: 'release', index, homeX, homeY });
      else {
        const fromX = point.x;
        const fromY = point.y;
        const start = performance.now();
        const step = (now) => {
          if (disposed) return;
          const t = clamp((now - start) / 460, 0, 1);
          const eased = 1 - (1 - t) ** 3;
          point.x = fromX + (homeX - fromX) * eased;
          point.y = fromY + (homeY - fromY) * eased;
          scheduleDraw();
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      save();
    };
    canvas.addEventListener('dblclick', (event) => {
      const hit = hitTest(eventPoint(event));
      if (hit) {
        selected = hit.path;
        config.onActivate(hit.path);
      }
    });
    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', finishPointer);
    canvas.addEventListener('pointerleave', (event) => {
      canvas.classList.remove('is-sobre-no');
      if (!pointer && !pinnedCard && !ctrlHeld) {
        clearTimeout(dismissTimer);
        dismissTimer = setTimeout(() => showCard(null, event), 220);
      }
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        setCamera(
          camera.zoom * Math.exp(-event.deltaY * 0.0012),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      },
      { passive: false },
    );
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        showCard(null, null, 'dismiss');
        return;
      }
      const active = visible.nodes.findIndex((node) => node.path === selected);
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const target =
          active < 0
            ? step > 0
              ? 0
              : visible.nodes.length - 1
            : (active + step + visible.nodes.length) % visible.nodes.length;
        const next = visible.nodes[target];
        if (next) {
          selected = next.path;
          canvas.setAttribute(
            'aria-label',
            `Grafo de notas. Selecionada: ${next.title || next.path}. Use as setas para navegar e Enter para abrir.`,
          );
          const point = positions[indexByPath.get(next.path)],
            at = screenAt(point);
          pulseUntil = performance.now() + 420;
          showCard(
            next,
            {
              clientX: canvas.getBoundingClientRect().left + at.x,
              clientY: canvas.getBoundingClientRect().top + at.y,
            },
            'pin',
          );
        }
      } else if (event.key === 'Enter' && selected) config.onActivate(selected);
    });
    const moveMinimapCamera = (event) => {
      if (!miniMapTransform) return;
      const { rect, scale, cx, cy, worldCenterX, worldCenterY } = miniMapTransform;
      const worldX = worldCenterX + (event.clientX - rect.left - cx) / scale;
      const worldY = worldCenterY + (event.clientY - rect.top - cy) / scale;
      camera.x = canvas.clientWidth / 2 - worldX;
      camera.y = canvas.clientHeight / 2 - worldY;
      scheduleDraw();
    };
    minimap?.addEventListener('pointerdown', (event) => {
      minimapDrag = true;
      minimap.setPointerCapture(event.pointerId);
      moveMinimapCamera(event);
    });
    minimap?.addEventListener('pointermove', (event) => {
      if (minimapDrag) moveMinimapCamera(event);
    });
    minimap?.addEventListener('pointerup', () => {
      if (minimapDrag) {
        minimapDrag = false;
        save();
      }
    });
    minimap?.addEventListener('pointercancel', () => {
      minimapDrag = false;
      save();
    });
    const onCtrl = (event) => {
      if (event.key !== 'Control') return;
      if (event.type === 'keydown' && event.repeat) return;
      ctrlHeld = event.type === 'keydown';
      if (ctrlHeld) {
        const node = lastHit || nodeByPath.get(selected);
        if (node) showCard(node, lastEvent, 'ctrl');
      } else showCard(null, null, 'dismiss');
    };
    const onBlur = () => {
      if (!ctrlHeld) return;
      ctrlHeld = false;
      showCard(null, null, 'dismiss');
    };
    window.addEventListener('keydown', onCtrl);
    window.addEventListener('keyup', onCtrl);
    window.addEventListener('blur', onBlur);
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement);
    resize();

    return {
      get graph() {
        return visible;
      },
      get supportsWorker() {
        return !!worker;
      },
      setGraph(next) {
        baseGraph = next;
        introStart = performance.now();
        rebuildVisible();
        scheduleDraw();
      },
      setMode(next) {
        mode = next;
        rebuildVisible();
        scheduleDraw();
      },
      setDepth(next) {
        depth = clamp(Number(next) || 1, 1, 3);
        rebuildVisible();
        scheduleDraw();
      },
      setSelected(path) {
        selected = path;
        if (mode === 'local') rebuildVisible();
        scheduleDraw();
      },
      setUntil(value) {
        until = Number(value) || 0;
        rebuildVisible();
        scheduleDraw();
      },
      setShowOrphans(value) {
        showOrphans = !!value;
        rebuildVisible();
        scheduleDraw();
        save();
      },
      setShowLabels(value) {
        showLabels = !!value;
        scheduleDraw();
        save();
      },
      setOption(key, value) {
        options[key] = Number(value);
        worker?.postMessage({ type: 'options', options, restart: true });
        paused = false;
        const toggle = document.querySelector('#grafo-simulacao');
        if (toggle) toggle.checked = true;
        save();
        scheduleDraw();
      },
      resetOptions(values) {
        options = { ...values };
        worker?.postMessage({ type: 'options', options, restart: true });
        paused = false;
        const toggle = document.querySelector('#grafo-simulacao');
        if (toggle) toggle.checked = true;
        save();
      },
      setForcesRunning(value) {
        paused = !value;
        worker?.postMessage({ type: value ? 'resume' : 'pause' });
        const status = document.querySelector('#grafo-status');
        if (status)
          status.textContent = worker ? (value ? 'Organizando…' : 'Pausado') : 'Layout estático';
        const footerStatus = document.querySelector('#grafo-status-rodape');
        if (footerStatus)
          footerStatus.textContent = worker ? (value ? 'estabilizando' : 'pausado') : 'estático';
        save();
      },
      setCamera(zoom) {
        setCamera(zoom);
      },
      zoomBy(factor) {
        tweenCamera({ x: camera.x, y: camera.y, zoom: camera.zoom * factor });
      },
      fit() {
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const node of visible.nodes) {
          const point = positions[indexByPath.get(node.path)];
          if (!point) continue;
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
        const next = !Number.isFinite(minX)
          ? { x: 0, y: 0, zoom: 1 }
          : {
              zoom: clamp(
                Math.min(
                  canvas.clientWidth / Math.max(maxX - minX + 120, 1),
                  canvas.clientHeight / Math.max(maxY - minY + 120, 1),
                ) * 0.88,
                0.2,
                1.6,
              ),
              x: 0,
              y: 0,
            };
        if (Number.isFinite(minX)) {
          next.x = canvas.clientWidth / 2 - (minX + maxX) / 2;
          next.y = canvas.clientHeight / 2 - (minY + maxY) / 2;
        }
        tweenCamera(next);
      },
      focus(path) {
        const index = indexByPath.get(path);
        if (index == null) return false;
        selected = path;
        pulseUntil = performance.now() + 420;
        const p = positions[index];
        tweenCamera({
          x: canvas.clientWidth / 2 - p.x,
          y: canvas.clientHeight / 2 - p.y,
          zoom: Math.max(camera.zoom, 1),
        });
        return true;
      },
      dispose() {
        disposed = true;
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = 0;
          persist();
        }
        clearTimeout(dismissTimer);
        cancelAnimationFrame(raf);
        cancelAnimationFrame(cameraAnim);
        window.removeEventListener('keydown', onCtrl);
        window.removeEventListener('keyup', onCtrl);
        window.removeEventListener('blur', onBlur);
        resizeObserver?.disconnect();
        worker?.terminate();
      },
    };
  }

  window.SophyGraphView = { create, localGraph };
})();
