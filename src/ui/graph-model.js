/**
 * Lógica pura do grafo: tamanho, esmaecimento, filtros e forças.
 * Não toca no DOM. A vista em graph-view.js só desenha e encaminha o ponteiro.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyGraphModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const RADIUS_MIN = 4.5;
  const RADIUS_MAX = 16;
  const DEGREE_AT_MAX = 12;
  const FADE_NODE = 0.4;
  const FADE_EDGE = 0.22;
  const FADE_MS = 180;

  const DEFAULT_FORCES = Object.freeze({
    spring: 1,
    length: 80,
    repulsion: 0.8,
    center: 0.25,
    shelf: 0,
  });

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeForces(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      spring: clamp(finite(source.spring, DEFAULT_FORCES.spring), 0, 2),
      length: clamp(finite(source.length, DEFAULT_FORCES.length), 16, 280),
      repulsion: clamp(finite(source.repulsion, DEFAULT_FORCES.repulsion), 0, 2),
      center: clamp(finite(source.center, DEFAULT_FORCES.center), 0, 1),
      shelf: clamp(finite(source.shelf, DEFAULT_FORCES.shelf), 0, 1),
    };
  }

  function degreeOf(node) {
    if (typeof node === 'number') return Math.max(0, node);
    if (!node || typeof node !== 'object') return 0;
    const incoming = Number(node.degreeIn);
    const outgoing = Number(node.degreeOut);
    if (Number.isFinite(incoming) || Number.isFinite(outgoing)) {
      return Math.max(
        0,
        (Number.isFinite(incoming) ? incoming : 0) + (Number.isFinite(outgoing) ? outgoing : 0),
      );
    }
    const fallback = Number(node.degree);
    return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
  }

  function nodeRadius(node) {
    const span = degreeOf(node) / DEGREE_AT_MAX;
    const t = span < 0 ? 0 : span > 1 ? 1 : span;
    return RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * Math.sqrt(t);
  }

  function fadeOpacity(role) {
    if (role === 'node' || role === 'node-rest') return FADE_NODE;
    if (role === 'edge' || role === 'edge-rest') return FADE_EDGE;
    return 1;
  }

  function mixOpacity(from, to, elapsedMs, duration) {
    const start = Number.isFinite(from) ? from : to;
    const ms = duration == null ? FADE_MS : duration;
    if (!(ms > 0)) return to;
    const t = clamp(elapsedMs / ms, 0, 1);
    return start + (to - start) * t;
  }

  function linkWeight(weight) {
    const number = Number(weight);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function restLength(baseLength, weight) {
    return finite(baseLength, DEFAULT_FORCES.length) / Math.sqrt(linkWeight(weight));
  }

  function springGain(baseSpring, weight) {
    return finite(baseSpring, DEFAULT_FORCES.spring) * linkWeight(weight);
  }

  function nodeKind(node) {
    const hint = node && node.kind;
    if (hint === 'canvas' || hint === 'attachment' || hint === 'note') return hint;
    const path = String((node && node.path) || '').toLowerCase();
    if (path.endsWith('.canvas')) return 'canvas';
    if (path.endsWith('.md') || path.indexOf('.') === -1) return 'note';
    return 'attachment';
  }

  function shelfKey(workspace) {
    if (workspace == null || workspace === '') return '';
    return String(workspace);
  }

  function withDegrees(graph) {
    const sourceNodes = (graph && graph.nodes) || [];
    const edges = ((graph && graph.edges) || []).map((edge) => ({
      from: edge.from,
      to: edge.to,
      format: edge.format,
      weight: linkWeight(edge.weight),
    }));
    const incoming = new Map();
    const outgoing = new Map();
    for (const edge of edges) {
      outgoing.set(edge.from, (outgoing.get(edge.from) || 0) + edge.weight);
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + edge.weight);
    }
    const nodes = sourceNodes.map((node) => {
      const copy = { ...node };
      if (!Number.isFinite(Number(copy.degreeIn))) copy.degreeIn = incoming.get(copy.path) || 0;
      if (!Number.isFinite(Number(copy.degreeOut))) copy.degreeOut = outgoing.get(copy.path) || 0;
      if (typeof copy.orphan !== 'boolean') copy.orphan = degreeOf(copy) === 0;
      if (!Number.isFinite(Number(copy.broken))) copy.broken = 0;
      copy.kind = nodeKind(copy);
      return copy;
    });
    return { nodes, edges };
  }

  function normalizeFilters(input) {
    const source = input && typeof input === 'object' ? input : {};
    let shelves = null;
    if (Array.isArray(source.shelves)) {
      shelves = source.shelves.map((item) => (item == null ? '' : String(item)));
    }
    const depth = Number(source.depth);
    return {
      shelves,
      tag: String(source.tag || '')
        .trim()
        .replace(/^#/, '')
        .toLocaleLowerCase(),
      hideOrphans: source.hideOrphans === true,
      showCanvas: source.showCanvas === true,
      showAttachments: source.showAttachments === true,
      until: clamp(finite(source.until, 1), 0, 1),
      depth: depth === 2 || depth === 3 ? depth : 1,
    };
  }

  function modifiedTimes(nodes) {
    return nodes
      .map((node) => Number(node.modifiedAt) || 0)
      .filter((time) => time > 0)
      .sort((a, b) => a - b);
  }

  function timelineCutoff(nodes, until) {
    const ratio = clamp(finite(until, 1), 0, 1);
    if (ratio >= 1) return Infinity;
    const times = modifiedTimes(nodes);
    if (!times.length) return Infinity;
    const index = Math.min(times.length - 1, Math.floor(ratio * (times.length - 1)));
    return times[index];
  }

  function timelineFrames(nodes) {
    const labels = ['Antes', 'Agora', 'Depois'];
    const times = modifiedTimes(nodes);
    if (!times.length) {
      return labels.map((label) => ({ label, count: 0 }));
    }
    const at = (ratio) => times[Math.min(times.length - 1, Math.floor(ratio * (times.length - 1)))];
    const bounds = [0, at(0.33), at(0.66), at(1)];
    return labels.map((label, index) => {
      const start = index === 0 ? -Infinity : bounds[index];
      const end = bounds[index + 1];
      const count = nodes.filter((node) => {
        const time = Number(node.modifiedAt) || 0;
        return time <= end && (index === 0 || time > start);
      }).length;
      return { label, count };
    });
  }

  function tagHit(node, tag) {
    if (!tag) return true;
    const raw = node && node.tags;
    const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return tags.some((item) => String(item).replace(/^#/, '').toLocaleLowerCase() === tag);
  }

  function applyFilters(graph, filtersInput) {
    const full = withDegrees(graph);
    const filters = normalizeFilters(filtersInput);
    const cutoff = timelineCutoff(full.nodes, filters.until);
    const nodes = full.nodes.filter((node) => {
      if (node.kind === 'canvas' && !filters.showCanvas) return false;
      if (node.kind === 'attachment' && !filters.showAttachments) return false;
      if (filters.hideOrphans && node.orphan) return false;
      if (filters.shelves && !filters.shelves.includes(shelfKey(node.workspace))) return false;
      if (!tagHit(node, filters.tag)) return false;
      if (filters.until < 1 && (Number(node.modifiedAt) || 0) > cutoff) return false;
      return true;
    });
    const visible = new Set(nodes.map((node) => node.path));
    const edges = full.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
    return {
      nodes,
      edges,
      counts: { notes: nodes.length, links: edges.length },
      frames: timelineFrames(
        full.nodes.filter((node) => filters.showCanvas || node.kind !== 'canvas'),
      ),
    };
  }

  function highlightSet(path, edges) {
    const set = new Set();
    if (!path) return set;
    set.add(path);
    for (const edge of edges || []) {
      if (edge.from === path) set.add(edge.to);
      else if (edge.to === path) set.add(edge.from);
    }
    return set;
  }

  function edgeRole(edge, hoverPath) {
    if (!hoverPath || !edge) return null;
    if (edge.from === hoverPath) return 'out';
    if (edge.to === hoverPath) return 'in';
    return null;
  }

  function project(point, camera, width, height) {
    const zoom = camera.zoom || 1;
    return {
      x: width / 2 + (point.x + camera.x) * zoom,
      y: height / 2 + (point.y + camera.y) * zoom,
    };
  }

  function unproject(x, y, camera, width, height) {
    const zoom = camera.zoom || 1;
    return {
      x: (x - width / 2) / zoom - camera.x,
      y: (y - height / 2) / zoom - camera.y,
    };
  }

  function fitCamera(bodies, width, height, padding) {
    const pad = padding == null ? 56 : padding;
    if (!bodies.length || width < 40 || height < 40) return { x: 0, y: 0, zoom: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const body of bodies) {
      const radius = nodeRadius(body) + 28;
      if (body.x - radius < minX) minX = body.x - radius;
      if (body.y - radius < minY) minY = body.y - radius;
      if (body.x + radius > maxX) maxX = body.x + radius;
      if (body.y + radius > maxY) maxY = body.y + radius;
    }
    const boundsWidth = Math.max(1, maxX - minX);
    const boundsHeight = Math.max(1, maxY - minY);
    const zoom = clamp(
      Math.min((width - pad * 2) / boundsWidth, (height - pad * 2) / boundsHeight),
      0.18,
      2.4,
    );
    return { x: -((minX + maxX) / 2), y: -((minY + maxY) / 2), zoom };
  }

  function hitTest(bodies, x, y, camera, width, height) {
    let found = null;
    let best = Infinity;
    for (const body of bodies) {
      const at = project(body, camera, width, height);
      const radius = Math.max(10, nodeRadius(body) * (camera.zoom || 1) + 4);
      const distance = Math.hypot(at.x - x, at.y - y);
      if (distance <= radius && distance < best) {
        best = distance;
        found = body;
      }
    }
    return found;
  }

  function pushPair(a, b, strength, alpha, scale) {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dist2 = dx * dx + dy * dy;
    if (dist2 < 16) {
      dx = dx || 1;
      dy = dy || 0.25;
      dist2 = dx * dx + dy * dy;
    }
    const dist = Math.sqrt(dist2);
    let force = (strength * alpha * scale) / dist;
    if (force > 42) force = 42;
    const ux = (dx / dist) * force;
    const uy = (dy / dist) * force;
    a.vx += ux;
    a.vy += uy;
    b.vx -= ux;
    b.vy -= uy;
  }

  function applyRepulsion(bodies, strength, alpha) {
    const count = bodies.length;
    if (count < 2 || strength <= 0 || alpha <= 0) return;
    if (count <= 160) {
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) pushPair(bodies[i], bodies[j], strength, alpha, 1);
      }
      return;
    }
    const cell = 130;
    const buckets = new Map();
    for (const body of bodies) {
      const key = `${Math.floor(body.x / cell)}:${Math.floor(body.y / cell)}`;
      const list = buckets.get(key);
      if (list) list.push(body);
      else buckets.set(key, [body]);
    }
    for (const [key, list] of buckets) {
      const parts = key.split(':');
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) pushPair(list[i], list[j], strength, alpha, 1);
      }
      const neighbors = [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ];
      for (const offset of neighbors) {
        const other = buckets.get(`${cx + offset[0]}:${cy + offset[1]}`);
        if (!other) continue;
        for (const a of list) {
          for (const b of other) pushPair(a, b, strength, alpha, 1);
        }
      }
    }
  }

  function applySprings(bodies, edges, forces, alpha) {
    if (forces.spring <= 0 || alpha <= 0) return;
    const index = new Map(bodies.map((body) => [body.path, body]));
    for (const edge of edges) {
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const rest = restLength(forces.length, edge.weight);
      const gain = 0.045 * springGain(forces.spring, edge.weight);
      let mag = (dist - rest) * gain * alpha;
      if (mag > 28) mag = 28;
      else if (mag < -28) mag = -28;
      const ux = (dx / dist) * mag;
      const uy = (dy / dist) * mag;
      from.vx += ux;
      from.vy += uy;
      to.vx -= ux;
      to.vy -= uy;
    }
  }

  function applyCenter(bodies, strength, alpha) {
    if (strength <= 0 || alpha <= 0) return;
    const gain = 0.05 * strength * alpha;
    for (const body of bodies) {
      body.vx -= body.x * gain;
      body.vy -= body.y * gain;
    }
  }

  function applyShelf(bodies, strength, alpha) {
    if (strength <= 0 || alpha <= 0 || bodies.length < 2) return;
    const groups = new Map();
    for (const body of bodies) {
      const key = shelfKey(body.workspace);
      let group = groups.get(key);
      if (!group) {
        group = { sx: 0, sy: 0, n: 0 };
        groups.set(key, group);
      }
      group.sx += body.x;
      group.sy += body.y;
      group.n += 1;
    }
    const keys = [...groups.keys()].sort();
    keys.forEach((key, index) => {
      const angle = (index / Math.max(keys.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const group = groups.get(key);
      group.ax = Math.cos(angle) * 240;
      group.ay = Math.sin(angle) * 240;
      group.cx = group.sx / group.n;
      group.cy = group.sy / group.n;
    });
    const gain = 0.16 * strength * alpha;
    for (const body of bodies) {
      const group = groups.get(shelfKey(body.workspace));
      let tx;
      let ty;
      if (body.orphan) {
        const ox = body.x - group.cx;
        const oy = body.y - group.cy;
        const od = Math.hypot(ox, oy) || 1;
        tx = group.ax + (ox / od) * 78;
        ty = group.ay + (oy / od) * 78;
      } else {
        tx = group.cx * 0.3 + group.ax * 0.7;
        ty = group.cy * 0.3 + group.ay * 0.7;
      }
      body.vx += (tx - body.x) * gain;
      body.vy += (ty - body.y) * gain;
    }
  }

  function stepForces(bodies, edges, forcesInput, alpha) {
    const forces = normalizeForces(forcesInput);
    const step = alpha == null ? 1 : alpha;
    applyRepulsion(bodies, 520 * forces.repulsion, step);
    applySprings(bodies, edges || [], forces, step);
    applyCenter(bodies, forces.center, step);
    applyShelf(bodies, forces.shelf, step);
    for (const body of bodies) {
      if (body.fx != null && body.fy != null) {
        body.x = body.fx;
        body.y = body.fy;
        body.vx = 0;
        body.vy = 0;
        continue;
      }
      body.vx *= 0.64;
      body.vy *= 0.64;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > 34) {
        body.vx = (body.vx / speed) * 34;
        body.vy = (body.vy / speed) * 34;
      }
      body.x += body.vx;
      body.y += body.vy;
      if (!Number.isFinite(body.x) || !Number.isFinite(body.y)) {
        body.x = 0;
        body.y = 0;
        body.vx = 0;
        body.vy = 0;
      }
    }
    return forces;
  }

  function createSimulation(nodes, edges, options) {
    const opt = options || {};
    const list = nodes || [];
    const positions = opt.positions || {};
    const count = list.length;
    const spread = opt.spread || Math.min(360, 80 + count * 7);
    const bodies = list.map((node, index) => {
      const saved = positions[node.path];
      const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      const x =
        saved && Number.isFinite(Number(saved.x))
          ? Number(saved.x)
          : Number.isFinite(Number(node.x))
            ? Number(node.x)
            : Math.cos(angle) * spread;
      const y =
        saved && Number.isFinite(Number(saved.y))
          ? Number(saved.y)
          : Number.isFinite(Number(node.y))
            ? Number(node.y)
            : Math.sin(angle) * spread;
      const pinned = Boolean((saved && saved.pinned) || node.pinned);
      return {
        path: node.path,
        title: node.title || node.path,
        workspace: node.workspace == null || node.workspace === '' ? null : node.workspace,
        degreeIn: Number(node.degreeIn) || 0,
        degreeOut: Number(node.degreeOut) || 0,
        orphan: node.orphan === true,
        broken: Number(node.broken) || 0,
        kind: nodeKind(node),
        x,
        y,
        vx: 0,
        vy: 0,
        pinned,
        fx: pinned ? x : null,
        fy: pinned ? y : null,
      };
    });
    return {
      bodies,
      edges: (edges || []).slice(),
      forces: normalizeForces(opt.forces),
      alpha: 1,
      alphaDecay: 0.0228,
      alphaMin: 0.018,
      settled: bodies.length < 2,
    };
  }

  function tickSimulation(sim) {
    if (!sim || sim.settled) return sim;
    stepForces(sim.bodies, sim.edges, sim.forces, sim.alpha);
    sim.alpha *= 1 - sim.alphaDecay;
    if (sim.alpha < sim.alphaMin) {
      sim.alpha = 0;
      sim.settled = true;
      for (const body of sim.bodies) {
        body.vx = 0;
        body.vy = 0;
      }
    }
    return sim;
  }

  function reheatSimulation(sim, alpha) {
    if (!sim) return sim;
    sim.alpha = Math.max(sim.alpha, alpha == null ? 0.45 : alpha);
    sim.settled = sim.bodies.length < 2;
    return sim;
  }

  function settleSimulation(sim, maxTicks) {
    const cap = maxTicks || 360;
    let count = 0;
    while (sim && !sim.settled && count < cap) {
      tickSimulation(sim);
      count += 1;
    }
    return count;
  }

  function prefsShape(input) {
    const source = input && typeof input === 'object' ? input : {};
    const filters = normalizeFilters(source.filters);
    const depth = Number(source.depth);
    return {
      forces: normalizeForces(source.forces),
      arrows: source.arrows === true,
      mode: source.mode === 'local' ? 'local' : 'global',
      depth: depth === 2 || depth === 3 ? depth : 1,
      center: typeof source.center === 'string' ? source.center : '',
      until: filters.until,
      filters: {
        shelves: filters.shelves,
        tag: filters.tag,
        hideOrphans: filters.hideOrphans,
        showCanvas: filters.showCanvas,
        showAttachments: filters.showAttachments,
      },
    };
  }

  return {
    RADIUS_MIN,
    RADIUS_MAX,
    FADE_NODE,
    FADE_EDGE,
    FADE_MS,
    DEFAULT_FORCES,
    normalizeForces,
    degreeOf,
    nodeRadius,
    fadeOpacity,
    mixOpacity,
    linkWeight,
    restLength,
    springGain,
    nodeKind,
    shelfKey,
    withDegrees,
    normalizeFilters,
    timelineCutoff,
    timelineFrames,
    applyFilters,
    highlightSet,
    edgeRole,
    project,
    unproject,
    fitCamera,
    hitTest,
    stepForces,
    createSimulation,
    tickSimulation,
    reheatSimulation,
    settleSimulation,
    prefsShape,
  };
});
