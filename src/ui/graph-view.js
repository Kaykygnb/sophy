/* Grafo do Sophy: notas, estantes e tags num canvas 2D.
   - A cena (nós e ligações) sai de buildScene(); a simulação de forças fica em graph-sim.js.
   - Estantes viram aglomerados com área colorida; no modo Estantes cada uma vira um nó grande.
   - Linha do tempo: as notas surgem em ordem de createdAt, as ligações quando as duas pontas existem.
   - Rótulos sem colisão; prefers-reduced-motion desliga as animações. */
(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const TAU = Math.PI * 2;

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

  const createdMs = (node) => {
    const created = Date.parse(node?.createdAt);
    return Number.isNaN(created) ? Number(node?.modifiedAt) || 0 : created;
  };
  const edgeKind = (edge) =>
    edge.format === 'child' ? 'child' : edge.target?.kind === 'block' ? 'block' : 'wiki';
  const shelfOf = (node) =>
    node.workspace || String(node.path || '').split('/')[0] || 'Sem estante';
  const titleOf = (node) =>
    node.title ||
    String(node.path || '')
      .split('/')
      .pop()
      .replace(/\.md$/i, '') ||
    'Sem título';
  const tagAncestors = (tag) => {
    const parts = String(tag).split('/');
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  };
  const tagNorm = (tag) =>
    String(tag || '')
      .replace(/^#/, '')
      .normalize('NFC')
      .toLocaleLowerCase('pt-BR');

  /* Cena pura (testável): converte o grafo de notas na lista de nós e ligações da visão escolhida. */
  function buildScene(graph, opts = {}) {
    const view = opts.view || 'notas';
    const kinds = { wiki: true, block: true, child: true, tag: false, ...(opts.edgeKinds || {}) };
    const until = Number(opts.until) || 0;
    let notes = graph.nodes.filter(
      (node) => !until || !createdMs(node) || createdMs(node) <= until,
    );
    let set = new Set(notes.map((node) => node.path));
    let edges = graph.edges.filter(
      (edge) => set.has(edge.from) && set.has(edge.to) && edge.from !== edge.to,
    );
    if (opts.local && opts.center && set.has(opts.center) && view !== 'estantes') {
      const local = localGraph({ nodes: notes, edges }, opts.center, opts.depth || 1);
      notes = local.nodes;
      edges = local.edges;
      set = new Set(notes.map((node) => node.path));
    }
    const nodes = [];
    const links = [];
    const pairKey = new Map();
    const addLink = (source, target, kind, weight = 1, extra = {}) => {
      if (source === target) return;
      const key =
        kind === 'shelf' || kind === 'tag' || kind === 'together'
          ? [source, target].sort().join('\u0000') + kind
          : `${source}\u0000${target}\u0000${kind}`;
      const found = pairKey.get(key);
      if (found) {
        found.weight += weight;
        return;
      }
      const link = { source, target, kind, weight, ...extra };
      pairKey.set(key, link);
      links.push(link);
    };
    const noteNode = (note) => ({
      id: `n:${note.path}`,
      kind: 'note',
      path: note.path,
      label: titleOf(note),
      shelf: shelfOf(note),
      tags: note.tags || [],
      created: createdMs(note),
      data: note,
    });
    if (view === 'estantes') {
      const expanded = opts.expanded || new Set();
      const counts = new Map();
      for (const note of notes) counts.set(shelfOf(note), (counts.get(shelfOf(note)) || 0) + 1);
      const rep = new Map();
      for (const note of notes) {
        const shelf = shelfOf(note);
        if (expanded.has(shelf)) {
          const node = noteNode(note);
          node.cluster = shelf;
          nodes.push(node);
          rep.set(note.path, node.id);
        } else rep.set(note.path, `s:${shelf}`);
      }
      for (const [shelf, count] of counts)
        if (!expanded.has(shelf))
          nodes.push({ id: `s:${shelf}`, kind: 'shelf', shelf, label: shelf, count, created: 0 });
      for (const edge of edges) {
        const kind = edgeKind(edge);
        if (!kinds[kind]) continue;
        const a = rep.get(edge.from),
          b = rep.get(edge.to);
        if (!a || !b || a === b) continue;
        if (a.startsWith('n:') && b.startsWith('n:')) addLink(a, b, kind);
        else addLink(a, b, 'shelf');
      }
    } else {
      for (const note of notes) {
        const node = noteNode(note);
        node.cluster = view === 'tags' ? null : node.shelf;
        nodes.push(node);
      }
      for (const edge of edges) {
        const kind = edgeKind(edge);
        if (kinds[kind]) addLink(`n:${edge.from}`, `n:${edge.to}`, kind);
      }
      if (kinds.tag && view !== 'tags') {
        const members = new Map();
        for (const note of notes)
          for (const tag of note.tags || []) {
            if (!members.has(tag)) members.set(tag, []);
            members.get(tag).push(note.path);
          }
        for (const [tag, paths] of members) {
          if (paths.length < 2 || paths.length > 16) continue;
          for (let i = 0; i < paths.length; i += 1)
            for (let j = i + 1; j < paths.length; j += 1)
              addLink(`n:${paths[i]}`, `n:${paths[j]}`, 'tag', 1, { tag });
        }
      }
      if (view === 'tags') {
        const tagCount = new Map();
        for (const note of notes)
          for (const tag of new Set((note.tags || []).flatMap(tagAncestors)))
            tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        for (const [tag, count] of tagCount)
          nodes.push({ id: `t:${tag}`, kind: 'tag', tag, label: `#${tag}`, count, created: 0 });
        for (const tag of tagCount.keys()) {
          const parent = tag.includes('/') ? tag.slice(0, tag.lastIndexOf('/')) : '';
          if (parent && tagCount.has(parent))
            addLink(`t:${parent}`, `t:${tag}`, 'tagtree', 1, { tag });
        }
        for (const note of notes)
          for (const tag of new Set(note.tags || []))
            addLink(`n:${note.path}`, `t:${tag}`, 'member', 1, { tag });
        const tagIds = new Map();
        for (const node of nodes) {
          if (node.kind === 'tag') tagIds.set(tagNorm(node.tag), node.id);
        }
        const related = opts.relatedTags || {};
        for (const [from, others] of Object.entries(related)) {
          const source = tagIds.get(tagNorm(from));
          if (!source) continue;
          for (const item of others || []) {
            const target = tagIds.get(tagNorm(item.tag || item));
            if (!target || target === source) continue;
            const juntas = Math.max(1, Number(item.juntas) || 1);
            addLink(source, target, 'together', Math.min(juntas, 6), { tag: item.tag || from });
          }
        }
      }
    }
    const degree = new Map();
    for (const link of links) {
      degree.set(link.source, (degree.get(link.source) || 0) + link.weight);
      degree.set(link.target, (degree.get(link.target) || 0) + link.weight);
    }
    let finalNodes = nodes;
    if (opts.showOrphans === false)
      finalNodes = nodes.filter(
        (node) => node.kind !== 'note' || degree.get(node.id) || node.path === opts.center,
      );
    const keep = new Set(finalNodes.map((node) => node.id));
    for (const node of finalNodes) {
      node.degree = degree.get(node.id) || 0;
      if (node.kind === 'shelf') node.r = clamp(20 + Math.sqrt(node.count) * 6, 22, 78);
      else if (node.kind === 'tag') node.r = clamp(9 + Math.sqrt(node.count) * 3, 10, 30);
      else node.r = clamp(5.5 + Math.sqrt(node.degree) * 2.5, 5.5, 22);
    }
    return {
      nodes: finalNodes,
      links: links.filter((link) => keep.has(link.source) && keep.has(link.target)),
    };
  }

  const hashOf = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  };

  function convexHull(points) {
    if (points.length < 3) return points.slice();
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
        lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
        upper.pop();
      upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
  }

  function create(config) {
    const canvas = config.canvas;
    const minimap = config.minimap;
    const ctx = canvas.getContext('2d');
    const miniCtx = minimap?.getContext('2d');
    const saved = config.saved && config.saved.version === 2 ? config.saved : {};
    const libraryKey = config.libraryKey || 'default';
    const reduced = !!config.reducedMotion;
    const esc = config.escape || ((text) => String(text));
    const glyph = (name) => (typeof config.icon === 'function' ? config.icon(name) : '');
    const sim = window.SophyGraphSim.create({ options: saved.options });
    if (reduced) sim.alphaDecay = 0.06;

    let base = config.graph || { nodes: [], edges: [] };
    let filtered = base;
    let view = ['notas', 'estantes', 'tags'].includes(saved.view) ? saved.view : 'notas';
    if (config.view) view = config.view;
    let relatedTags = config.relatedTags || {};
    let scope = 'global';
    let depth = 1;
    let selected = config.activePath ? `n:${config.activePath}` : null;
    let hovered = null;
    let showLabels = saved.showLabels !== false;
    let showOrphans = saved.showOrphans !== false;
    let edgeKinds = {
      wiki: true,
      block: true,
      child: true,
      tag: false,
      ...(saved.edgeKinds || {}),
    };
    let expanded = new Set(saved.expanded || []);
    let paused = false;
    let disposed = false;
    let raf = 0;
    let saveTimer = 0;
    let dismissTimer = 0;
    let camTween = null;
    let scene = { nodes: [], links: [] };
    let sceneById = new Map();
    let neighborsOf = new Map();
    let leaving = [];
    let themeCache = null;
    let colorCache = new Map();
    let pointer = null;
    let pinnedCard = false;
    let lastFrame = 0;
    const positions = new Map(
      Object.entries(saved.positions || {})
        .filter(([, p]) => Array.isArray(p) && p.every(Number.isFinite))
        .map(([id, p]) => [id, { x: p[0], y: p[1] }]),
    );
    const camera = { x: 0, y: 0, k: 1 };
    if (saved.camera && [saved.camera.x, saved.camera.y, saved.camera.k].every(Number.isFinite))
      Object.assign(camera, saved.camera);
    let cameraFitted = !!saved.camera;

    /* linha do tempo */
    const timeline = { min: 0, max: 0, cursor: 0, playing: false, speed: 1, stepAt: 0 };
    const computeTimes = () => {
      const times = base.nodes
        .map(createdMs)
        .filter(Boolean)
        .sort((a, b) => a - b);
      timeline.min = times[0] || 0;
      timeline.max = times[times.length - 1] || 0;
    };
    computeTimes();

    const now = () => performance.now();
    const ease = (t) => {
      const v = clamp(t, 0, 1);
      return 1 - (1 - v) ** 3;
    };
    const easeBack = (t) => {
      const v = clamp(t, 0, 1);
      const c = 1.6;
      return 1 + (c + 1) * (v - 1) ** 3 + c * (v - 1) ** 2;
    };

    const getTheme = () => {
      if (themeCache) return themeCache;
      const style = getComputedStyle(document.documentElement);
      const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
      const dark = document.documentElement.dataset.theme === 'dark';
      themeCache = {
        dark,
        bg: read('--bg', dark ? '#15141a' : '#faf9f7'),
        surface: read('--surface', dark ? '#1d1c22' : '#ffffff'),
        ink: read('--ink', dark ? '#eceaf1' : '#1f1d24'),
        ink2: read('--ink-2', dark ? '#c9c6d1' : '#45424d'),
        muted: read('--ink-3', dark ? '#85818f' : '#85818f'),
        dot: read('--canvas-dot', dark ? '#2a2830' : '#e7e4ee'),
        accent: read('--accent', dark ? '#aaa4ef' : '#5b54c9'),
        line: read('--line-strong', read('--line', dark ? '#45414e' : '#d8d4e0')),
        edge: dark ? 'rgba(200,196,214,0.42)' : 'rgba(70,64,90,0.34)',
        font: read('--font-ui', 'Inter, system-ui, sans-serif'),
      };
      return themeCache;
    };
    const themeObserver = new MutationObserver(() => {
      themeCache = null;
      colorCache = new Map();
      schedule();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent', 'style', 'class'],
    });

    /* as cores das estantes nos tokens são discretas; no grafo ganham um pouco mais de saturação */
    const vivid = (color) => {
      const m = /^#([0-9a-f]{6})$/i.exec(String(color || '').trim());
      if (!m) return color;
      const n = parseInt(m[1], 16);
      let r = (n >> 16) / 255,
        g = ((n >> 8) & 255) / 255,
        b = (n & 255) / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      let h = 0,
        sat = 0;
      const l = (max + min) / 2;
      if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        h =
          max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h /= 6;
      }
      const s2 = clamp(sat * 1.55 + 0.08, 0, 0.82);
      const l2 = getTheme().dark ? clamp(l + 0.02, 0.55, 0.78) : clamp(l - 0.03, 0.38, 0.56);
      return `hsl(${Math.round(h * 360)} ${Math.round(s2 * 100)}% ${Math.round(l2 * 100)}%)`;
    };
    const shelfTint = (shelf) => vivid(config.shelfColor?.(shelf));
    const colorFor = (node) => {
      const key = node.id;
      if (colorCache.has(key)) return colorCache.get(key);
      let color;
      if (node.kind === 'shelf') color = shelfTint(node.shelf);
      else if (node.kind === 'tag') color = config.tagColor?.(node.tag);
      else color = vivid(config.colorOf?.(node.data));
      color ||= getTheme().accent;
      colorCache.set(key, color);
      return color;
    };
    const withAlpha = (color, alpha) => {
      if (/^#([0-9a-f]{6})$/i.test(color)) {
        const n = parseInt(color.slice(1), 16);
        return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
      }
      if (/^#([0-9a-f]{3})$/i.test(color)) {
        const [r, g, b] = color
          .slice(1)
          .split('')
          .map((c) => parseInt(c + c, 16));
        return `rgba(${r},${g},${b},${alpha})`;
      }
      if (color.startsWith('hsl(') && !color.includes('/'))
        return color.replace(')', ` / ${alpha})`);
      if (color.startsWith('rgb('))
        return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
      return color;
    };

    /* --------------------------------------------------------------- cena */
    const width = () => canvas.clientWidth || 800;
    const height = () => canvas.clientHeight || 600;
    const toScreen = (p) => ({
      x: (p.x - camera.x) * camera.k + width() / 2,
      y: (p.y - camera.y) * camera.k + height() / 2,
    });
    const toWorld = (p) => ({
      x: (p.x - width() / 2) / camera.k + camera.x,
      y: (p.y - height() / 2) / camera.k + camera.y,
    });

    const clusterAnchor = (key) => {
      const keys = [...new Set(base.nodes.map(shelfOf))].sort();
      const index = Math.max(0, keys.indexOf(key));
      const angle = (index / Math.max(keys.length, 1)) * TAU - Math.PI / 2;
      const radius = keys.length > 1 ? 160 + Math.sqrt(base.nodes.length) * 22 : 0;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    };
    const seedPosition = (node, simIndex) => {
      const jitter = (salt) => (hashOf(node.id + salt) - 0.5) * 2;
      if (node.kind === 'note' && positions.has(`s:${node.shelf}`) && view === 'estantes') {
        const s = positions.get(`s:${node.shelf}`);
        return { x: s.x + jitter('x') * 40, y: s.y + jitter('y') * 40 };
      }
      if (node.kind === 'shelf') {
        const members = base.nodes
          .filter((note) => shelfOf(note) === node.shelf)
          .map((note) => positions.get(`n:${note.path}`))
          .filter(Boolean);
        if (members.length)
          return {
            x: members.reduce((s, p) => s + p.x, 0) / members.length,
            y: members.reduce((s, p) => s + p.y, 0) / members.length,
          };
        const a = clusterAnchor(node.shelf);
        return { x: a.x + jitter('x') * 20, y: a.y + jitter('y') * 20 };
      }
      if (node.kind === 'tag') {
        const members = scene.nodes
          .filter((n) => n.kind === 'note' && n.tags.includes(node.tag))
          .map((n) => positions.get(n.id))
          .filter(Boolean);
        if (members.length)
          return {
            x: members.reduce((s, p) => s + p.x, 0) / members.length + jitter('x') * 10,
            y: members.reduce((s, p) => s + p.y, 0) / members.length + jitter('y') * 10,
          };
      }
      /* perto de um vizinho que já está na tela (a nota nasce ao lado de quem ela liga) */
      for (const other of neighborsOf.get(node.id) || []) {
        const p = positions.get(other);
        if (p) return { x: p.x + jitter('x') * 34, y: p.y + jitter('y') * 34 };
      }
      const a = node.kind === 'note' ? clusterAnchor(node.shelf) : { x: 0, y: 0 };
      const angle = hashOf(node.id) * TAU;
      const radius = 30 + hashOf(`${node.id}r`) * 90 + Math.sqrt(simIndex) * 6;
      return { x: a.x + Math.cos(angle) * radius, y: a.y + Math.sin(angle) * radius };
    };

    const labelWidth = (node) => {
      ctx.font = `500 12px ${getTheme().font}`;
      return Math.min(ctx.measureText(node.label.slice(0, 28)).width, 180);
    };

    const rebuild = ({ reheat = 0.6, animate = true } = {}) => {
      const opts = {
        view,
        edgeKinds,
        showOrphans,
        until: timeline.cursor && timeline.cursor < timeline.max ? timeline.cursor : 0,
        local: scope === 'local',
        center: selected?.startsWith('n:') ? selected.slice(2) : config.activePath,
        depth,
        expanded,
        relatedTags,
      };
      const next = buildScene(filtered, opts);
      const previous = sceneById;
      const t = now();
      neighborsOf = new Map();
      for (const link of next.links) {
        if (!neighborsOf.has(link.source)) neighborsOf.set(link.source, new Set());
        if (!neighborsOf.has(link.target)) neighborsOf.set(link.target, new Set());
        neighborsOf.get(link.source).add(link.target);
        neighborsOf.get(link.target).add(link.source);
      }
      const nextIds = new Set(next.nodes.map((node) => node.id));
      leaving =
        reduced || !animate
          ? []
          : [...previous.values()]
              .filter((node) => !nextIds.has(node.id))
              .map((node) => ({ ...node, leftAt: t }));
      let added = 0;
      next.nodes.forEach((node, index) => {
        const old = previous.get(node.id);
        let p = positions.get(node.id);
        if (!p) {
          p = seedPosition(node, index);
          positions.set(node.id, p);
        }
        node.x = old?.x ?? p.x;
        node.y = old?.y ?? p.y;
        node.vx = old?.vx || 0;
        node.vy = old?.vy || 0;
        node.fx = old?.fx ?? null;
        node.fy = old?.fy ?? null;
        node.appearAt = old
          ? old.appearAt
          : animate && !reduced
            ? t + Math.min(added, 40) * (timeline.playing ? 0 : 14)
            : 0;
        node.ripple = !old && timeline.playing && !reduced;
        if (!old) added += 1;
        node.lw = labelWidth(node);
        node.cr = node.r + 5 + (node.kind === 'note' ? Math.min(node.lw * 0.18, 16) : 4);
      });
      const oldLinks = new Map(
        scene.links.map((link) => [`${link.source}|${link.target}|${link.kind}`, link]),
      );
      for (const link of next.links) {
        const old = oldLinks.get(`${link.source}|${link.target}|${link.kind}`);
        link.appearAt = old
          ? old.appearAt
          : animate && !reduced
            ? t + (timeline.playing ? 140 : 180 + Math.min(added, 40) * 10)
            : 0;
        link.distance =
          link.kind === 'member'
            ? 34
            : link.kind === 'together'
              ? 72
              : link.kind === 'shelf'
                ? 120
                : link.kind === 'tag'
                  ? 70
                  : undefined;
        link.strength =
          link.kind === 'tag'
            ? 0.35
            : link.kind === 'together'
              ? 0.18 + Math.min((link.weight || 1) * 0.03, 0.12)
              : link.kind === 'member'
                ? 0.7
                : link.kind === 'shelf'
                  ? 0.25
                  : 1;
      }
      scene = next;
      sceneById = new Map(next.nodes.map((node) => [node.id, node]));
      sim.setNodes(scene.nodes);
      sim.setLinks(scene.links);
      if (view === 'tags')
        sim.options.shelfAttraction = Math.min(sim.options.shelfAttraction, 0.004);
      else sim.options.shelfAttraction = savedOptions().shelfAttraction;
      if (added || reheat)
        sim.reheat(added ? Math.max(reheat, positions.size > added ? 0.35 : 1) : reheat);
      if (reduced && !paused) {
        sim.run(500);
        if (!cameraFitted) fitNow(false);
      }
      if (selected && !sceneById.has(selected) && !selected.startsWith('n:')) selected = null;
      config.onStats?.(stats());
      schedule();
    };
    let userOptions = { ...sim.options };
    const savedOptions = () => userOptions;

    const stats = () => {
      const notes = scene.nodes.filter((node) => node.kind === 'note').length;
      const shelves = scene.nodes.filter((node) => node.kind === 'shelf').length;
      const tags = scene.nodes.filter((node) => node.kind === 'tag').length;
      const noteLinks = scene.links
        .filter((link) => ['wiki', 'block', 'child'].includes(link.kind))
        .reduce((sum, link) => sum + link.weight, 0);
      const shelfLinks = scene.links
        .filter((link) => link.kind === 'shelf')
        .reduce((sum, link) => sum + link.weight, 0);
      return {
        view,
        notes,
        shelves,
        tags,
        links: noteLinks + shelfLinks,
        hiddenNotes: base.nodes.length,
        total: filtered.nodes.length,
        totalLinks: filtered.edges.length,
        kinds: new Set(scene.links.map((link) => link.kind)),
      };
    };

    /* --------------------------------------------------------------- desenho */
    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (minimap && miniCtx) {
        const mini = minimap.getBoundingClientRect();
        minimap.width = Math.max(1, Math.floor(mini.width * dpr));
        minimap.height = Math.max(1, Math.floor(mini.height * dpr));
        miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      schedule();
    };
    const scratch = document.createElement('canvas');
    const scratchCtx = scratch.getContext('2d');

    const schedule = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(frame);
    };

    const frame = (t) => {
      raf = 0;
      if (disposed) return;
      const dt = lastFrame ? Math.min(64, t - lastFrame) : 16;
      lastFrame = t;
      let busy = false;
      if (timeline.playing) {
        busy = true;
        advanceTimeline(dt, t);
        /* a câmera acompanha a rede crescendo, sem aproximar demais */
        if (!reduced && t - (timeline.followAt || 0) > 900 && scene.nodes.length) {
          timeline.followAt = t;
          maxFit = 1.25;
          const target = fitTarget();
          maxFit = 1.6;
          camTween = { from: { ...camera }, to: target, start: t, duration: 1100 };
        }
      }
      if (!paused && !sim.settled()) {
        const steps = scene.nodes.length > 1200 ? 1 : 2;
        for (let i = 0; i < steps; i += 1) sim.tick();
        busy = true;
        if (sim.settled()) {
          if (!cameraFitted) fitNow(true);
          saveSoon();
        }
      } else if (!cameraFitted && scene.nodes.length) fitNow(true);
      if (camTween) {
        const p = ease((t - camTween.start) / camTween.duration);
        camera.x = camTween.from.x + (camTween.to.x - camTween.from.x) * p;
        camera.y = camTween.from.y + (camTween.to.y - camTween.from.y) * p;
        camera.k = camTween.from.k + (camTween.to.k - camTween.from.k) * p;
        if (p >= 1) {
          camTween = null;
          saveSoon();
        }
        busy = true;
      }
      for (const node of scene.nodes) positions.set(node.id, { x: node.x, y: node.y });
      const animating = draw(t);
      if (busy || animating) schedule();
    };

    const drawHalos = (theme, t) => {
      haloLabels = [];
      if (view === 'tags') return;
      const groups = new Map();
      for (const node of scene.nodes) {
        if (node.kind !== 'note' || !node.cluster) continue;
        if (!groups.has(node.cluster)) groups.set(node.cluster, []);
        groups.get(node.cluster).push(node);
      }
      if (groups.size < 1) return;
      const w = width(),
        h = height();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (scratch.width !== Math.floor(w * dpr) || scratch.height !== Math.floor(h * dpr)) {
        scratch.width = Math.floor(w * dpr);
        scratch.height = Math.floor(h * dpr);
      }
      const hot = hovered || selected;
      for (const [shelf, members] of groups) {
        if (view === 'notas' && groups.size === 1 && members.length < 2) continue;
        const color = shelfTint(shelf) || theme.accent;
        const pad = 26 * camera.k;
        const points = members.map((node) => {
          const s = toScreen(node);
          const reveal = node.appearAt ? ease((t - node.appearAt) / 420) : 1;
          return [s.x, s.y, node.r * camera.k * reveal + pad];
        });
        scratchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        scratchCtx.clearRect(0, 0, w, h);
        scratchCtx.fillStyle = color;
        scratchCtx.strokeStyle = color;
        scratchCtx.lineJoin = 'round';
        scratchCtx.lineCap = 'round';
        for (const [x, y, r] of points) {
          scratchCtx.beginPath();
          scratchCtx.arc(x, y, r, 0, TAU);
          scratchCtx.fill();
        }
        const hull = convexHull(points.map(([x, y]) => [x, y]));
        if (hull.length >= 2) {
          scratchCtx.lineWidth = pad * 2;
          scratchCtx.beginPath();
          hull.forEach(([x, y], i) => (i ? scratchCtx.lineTo(x, y) : scratchCtx.moveTo(x, y)));
          scratchCtx.closePath();
          scratchCtx.fill();
          scratchCtx.stroke();
        }
        const focusShelf = hot && sceneById.get(hot)?.shelf === shelf;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha =
          (theme.dark ? 0.1 : 0.085) * (hot && !focusShelf ? 0.6 : focusShelf ? 1.5 : 1);
        ctx.drawImage(scratch, 0, 0);
        ctx.restore();
        /* nome da estante no topo da área */
        let top = Infinity,
          sumX = 0;
        for (const [x, y, r] of points) {
          top = Math.min(top, y - r);
          sumX += x;
        }
        haloLabels.push({
          text: shelf.toLocaleUpperCase('pt-BR'),
          x: sumX / points.length,
          y: top + 6,
          color,
          faded: hot && !focusShelf,
        });
      }
    };
    let haloLabels = [];
    /* nome da estante numa pílula no topo da área; entra antes dos rótulos das notas na disputa por espaço */
    const drawHaloLabels = (theme, put) => {
      for (const label of haloLabels) {
        ctx.font = `700 ${clamp(10.5 * Math.sqrt(camera.k), 10, 14)}px ${theme.font}`;
        ctx.letterSpacing = '0.08em';
        const tw = ctx.measureText(label.text).width;
        const rect = { x: label.x - tw / 2 - 8, y: label.y - 10, w: tw + 16, h: 20 };
        put(rect);
        ctx.globalAlpha = label.faded ? 0.4 : 1;
        ctx.fillStyle = withAlpha(theme.surface, 0.9);
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
        ctx.fill();
        ctx.strokeStyle = withAlpha(label.color, 0.45);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = label.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.text, label.x, label.y + 0.5);
        ctx.letterSpacing = '0px';
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
        ctx.globalAlpha = 1;
      }
    };

    const edgeStyle = (link, theme) => {
      switch (link.kind) {
        case 'block':
          return { dash: [6, 4], color: theme.accent, width: 1.6 };
        case 'child':
          return { dash: [1.5, 4], color: theme.muted, width: 1.6 };
        case 'tag':
          return { dash: [2, 5], color: config.tagColor?.(link.tag) || theme.muted, width: 1.3 };
        case 'member':
          return { dash: null, color: config.tagColor?.(link.tag) || theme.muted, width: 1.2 };
        case 'tagtree':
          return { dash: [4, 3], color: config.tagColor?.(link.tag) || theme.muted, width: 1.6 };
        case 'together':
          return { dash: [3, 6], color: config.tagColor?.(link.tag) || theme.muted, width: 1.15 };
        case 'shelf':
          return {
            dash: null,
            color: theme.edge,
            width: clamp(1.5 + Math.log2(1 + link.weight) * 2.2, 2, 14),
          };
        default:
          return { dash: null, color: theme.edge, width: 1.5 };
      }
    };

    const draw = (t) => {
      const theme = getTheme();
      const w = width(),
        h = height();
      let animating = false;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);
      /* pontinhos de fundo, bem leves */
      const spacing = 28 * clamp(camera.k, 0.6, 1.6);
      ctx.fillStyle = theme.dot;
      const ox = (((-camera.x * camera.k + w / 2) % spacing) + spacing) % spacing;
      const oy = (((-camera.y * camera.k + h / 2) % spacing) + spacing) % spacing;
      if (spacing > 10)
        for (let x = ox; x < w; x += spacing)
          for (let y = oy; y < h; y += spacing) ctx.fillRect(x, y, 1.2, 1.2);

      drawHalos(theme, t);

      const hot = hovered || selected;
      const lit = new Set();
      if (hovered) {
        lit.add(hovered);
        for (const id of neighborsOf.get(hovered) || []) lit.add(id);
      }
      const dimming = !!hovered;
      ctx.lineCap = 'round';
      /* ligações */
      for (const link of scene.links) {
        const a = sceneById.get(link.source),
          b = sceneById.get(link.target);
        if (!a || !b) continue;
        const pa = toScreen(a),
          pb = toScreen(b);
        if (
          (pa.x < -60 && pb.x < -60) ||
          (pa.x > w + 60 && pb.x > w + 60) ||
          (pa.y < -60 && pb.y < -60) ||
          (pa.y > h + 60 && pb.y > h + 60)
        )
          continue;
        let grow = 1;
        if (link.appearAt) {
          grow = ease((t - link.appearAt) / 420);
          if (grow < 1) animating = true;
          if (grow <= 0) continue;
        }
        const style = edgeStyle(link, theme);
        const touching = hot && (link.source === hot || link.target === hot);
        const faded = dimming && !(link.source === hovered || link.target === hovered);
        /* a ligação nasce da nota mais antiga em direção à mais nova */
        const [from, to] = (a.created || 0) <= (b.created || 0) ? [pa, pb] : [pb, pa];
        const dx = to.x - from.x,
          dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const bend =
          link.kind === 'shelf' || link.kind === 'member'
            ? 0
            : Math.min(28, len * 0.12) * (hashOf(link.source + link.target) > 0.5 ? 1 : -1);
        const mx = (from.x + to.x) / 2 - (dy / len) * bend,
          my = (from.y + to.y) / 2 + (dx / len) * bend;
        ctx.beginPath();
        ctx.setLineDash(style.dash ? style.dash.map((v) => v * clamp(camera.k, 0.7, 1.4)) : []);
        ctx.strokeStyle = touching ? theme.accent : style.color;
        ctx.globalAlpha = faded
          ? 0.08
          : touching
            ? 0.95
            : link.kind === 'shelf'
              ? 0.55
              : link.kind === 'member'
                ? 0.45
                : link.kind === 'together'
                  ? 0.32
                  : 0.7;
        ctx.lineWidth =
          (touching ? style.width + 1 : style.width) *
          (link.kind === 'shelf' ? clamp(camera.k, 0.5, 1.4) : clamp(camera.k, 0.8, 1.3));
        ctx.moveTo(from.x, from.y);
        if (grow >= 1) ctx.quadraticCurveTo(mx, my, to.x, to.y);
        else {
          /* curva parcial: De Casteljau até grow */
          const ax = from.x + (mx - from.x) * grow,
            ay = from.y + (my - from.y) * grow;
          const bx = mx + (to.x - mx) * grow,
            by = my + (to.y - my) * grow;
          ctx.quadraticCurveTo(ax, ay, ax + (bx - ax) * grow, ay + (by - ay) * grow);
        }
        ctx.stroke();
        if (link.kind === 'block' && grow >= 1 && !faded) {
          ctx.setLineDash([]);
          ctx.fillStyle = theme.accent;
          ctx.globalAlpha = 0.9;
          const qx = 0.25 * from.x + 0.5 * mx + 0.25 * to.x,
            qy = 0.25 * from.y + 0.5 * my + 0.25 * to.y;
          ctx.fillRect(qx - 3, qy - 3, 6, 6);
        }
        if (link.kind === 'shelf' && link.weight > 1 && camera.k > 0.45 && !faded) {
          const qx = 0.25 * from.x + 0.5 * mx + 0.25 * to.x,
            qy = 0.25 * from.y + 0.5 * my + 0.25 * to.y;
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          ctx.font = `600 11px ${theme.font}`;
          const text = String(link.weight);
          const tw = ctx.measureText(text).width + 10;
          ctx.fillStyle = theme.surface;
          ctx.beginPath();
          ctx.roundRect(qx - tw / 2, qy - 9, tw, 18, 9);
          ctx.fill();
          ctx.strokeStyle = theme.line;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = theme.ink2;
          ctx.textAlign = 'center';
          ctx.fillText(text, qx, qy + 4);
          ctx.textAlign = 'start';
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      /* nós saindo (filtro): somem encolhendo */
      leaving = leaving.filter((node) => t - node.leftAt < 220);
      for (const node of leaving) {
        const p = toScreen(node);
        const k = 1 - (t - node.leftAt) / 220;
        ctx.globalAlpha = 0.6 * k;
        ctx.fillStyle = colorFor(node);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, node.r * camera.k * k), 0, TAU);
        ctx.fill();
        animating = true;
      }
      ctx.globalAlpha = 1;

      /* nós */
      const drawn = [];
      for (const node of scene.nodes) {
        const p = toScreen(node);
        const r = node.r * camera.k;
        if (p.x < -r - 80 || p.x > w + r + 80 || p.y < -r - 40 || p.y > h + r + 40) continue;
        let reveal = 1;
        if (node.appearAt) {
          const age = t - node.appearAt;
          reveal = age <= 0 ? 0 : easeBack(age / 460);
          if (age < 900) animating = true;
          if (node.ripple && age > 0 && age < 900) {
            const q = age / 900;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 4 + q * 26 * clamp(camera.k, 0.7, 1.4), 0, TAU);
            ctx.strokeStyle = colorFor(node);
            ctx.globalAlpha = (1 - q) * 0.55;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          if (reveal <= 0.01) continue;
        }
        const color = colorFor(node);
        const isHot = node.id === hot;
        const faded = dimming && !lit.has(node.id);
        const rr = Math.max(1.5, r * reveal);
        ctx.globalAlpha = faded ? 0.18 : 1;
        if (isHot || (hovered && lit.has(node.id) && node.id !== hovered && false)) {
          ctx.save();
          ctx.shadowColor = withAlpha(color, 0.85);
          ctx.shadowBlur = reduced ? 14 : 18 + Math.sin(t / 380) * 5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr + 3, 0, TAU);
          ctx.fillStyle = withAlpha(color, 0.35);
          ctx.fill();
          ctx.restore();
          if (!reduced) animating = true;
        }
        if (node.kind === 'shelf') {
          const grad = ctx.createRadialGradient(
            p.x - rr * 0.35,
            p.y - rr * 0.4,
            rr * 0.1,
            p.x,
            p.y,
            rr,
          );
          grad.addColorStop(0, withAlpha(color, 0.55));
          grad.addColorStop(1, withAlpha(color, 0.22));
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, TAU);
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.fillStyle = theme.ink;
          ctx.textAlign = 'center';
          ctx.font = `700 ${clamp(rr * 0.42, 11, 26)}px ${theme.font}`;
          ctx.fillText(String(node.count), p.x, p.y + clamp(rr * 0.15, 4, 9));
          ctx.textAlign = 'start';
        } else if (node.kind === 'tag') {
          const s = rr * 1.05;
          ctx.beginPath();
          ctx.roundRect(p.x - s, p.y - s, s * 2, s * 2, s * 0.55);
          ctx.fillStyle = withAlpha(color, theme.dark ? 0.3 : 0.2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.font = `700 ${clamp(rr * 0.95, 10, 22)}px ${theme.font}`;
          ctx.fillText('#', p.x, p.y + clamp(rr * 0.34, 3, 8));
          ctx.textAlign = 'start';
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr + 1.8, 0, TAU);
          ctx.fillStyle = theme.bg;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, rr, 0, TAU);
          const grad = ctx.createRadialGradient(
            p.x - rr * 0.35,
            p.y - rr * 0.35,
            rr * 0.1,
            p.x,
            p.y,
            rr,
          );
          grad.addColorStop(0, withAlpha(color, 0.78));
          grad.addColorStop(1, color);
          ctx.fillStyle = grad;
          ctx.fill();
          if (isHot) {
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = theme.surface;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        drawn.push({ node, p, r: rr, faded, reveal });
      }

      /* rótulos sem colisão: primeiro os mais importantes */
      if (showLabels) {
        const priority = (item) =>
          (item.node.id === hot ? 1e6 : 0) +
          (hovered && lit.has(item.node.id) ? 1e5 : 0) +
          (item.node.kind === 'shelf' ? 5e4 : item.node.kind === 'tag' ? 2e4 : 0) +
          item.r * 100 +
          item.node.degree;
        const order = drawn.slice().sort((a, b) => priority(b) - priority(a));
        const placed = [];
        const cell = 64;
        const grid = new Map();
        const hits = (rect) => {
          for (
            let gx = Math.floor(rect.x / cell);
            gx <= Math.floor((rect.x + rect.w) / cell);
            gx += 1
          )
            for (
              let gy = Math.floor(rect.y / cell);
              gy <= Math.floor((rect.y + rect.h) / cell);
              gy += 1
            )
              for (const other of grid.get(`${gx}|${gy}`) || [])
                if (
                  rect.x < other.x + other.w &&
                  rect.x + rect.w > other.x &&
                  rect.y < other.y + other.h &&
                  rect.y + rect.h > other.y
                )
                  return true;
          return false;
        };
        const put = (rect) => {
          placed.push(rect);
          for (
            let gx = Math.floor(rect.x / cell);
            gx <= Math.floor((rect.x + rect.w) / cell);
            gx += 1
          )
            for (
              let gy = Math.floor(rect.y / cell);
              gy <= Math.floor((rect.y + rect.h) / cell);
              gy += 1
            ) {
              const key = `${gx}|${gy}`;
              if (!grid.has(key)) grid.set(key, []);
              grid.get(key).push(rect);
            }
        };
        /* os próprios nós ocupam espaço: rótulo não cobre bolinha */
        for (const item of drawn)
          put({
            x: item.p.x - item.r,
            y: item.p.y - item.r,
            w: item.r * 2,
            h: item.r * 2,
            node: item.node,
          });
        drawHaloLabels(theme, put);
        const fontSize = clamp(12 * Math.sqrt(camera.k), 10, 15);
        let count = 0;
        for (const item of order) {
          const { node, p, r } = item;
          const important =
            node.id === hot || (hovered && lit.has(node.id)) || node.kind !== 'note';
          if (!important) {
            if (camera.k < 0.45) continue;
            if (camera.k < 0.75 && node.r < 8) continue;
            if (count > 400) continue;
          }
          const text = node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
          const weight = node.id === hot ? 700 : node.kind === 'note' ? 500 : 700;
          ctx.font = `${weight} ${node.kind === 'shelf' ? fontSize + 1 : fontSize}px ${theme.font}`;
          const tw = ctx.measureText(text).width;
          const rect = { x: p.x - tw / 2 - 4, y: p.y + r + 3, w: tw + 8, h: fontSize + 6 };
          const self = placed.findIndex((other) => other.node === node);
          const saved = self >= 0 ? placed[self] : null;
          if (saved) saved.w = 0;
          const blocked = hits(rect);
          if (saved) saved.w = r * 2;
          if (blocked && !important) continue;
          if (blocked && node.id !== hot) continue;
          put(rect);
          count += 1;
          ctx.globalAlpha =
            (item.faded ? 0.2 : node.kind === 'note' ? 0.92 : 1) * clamp(item.reveal, 0, 1);
          if (node.id === hot || (hovered && lit.has(node.id))) {
            ctx.fillStyle = withAlpha(theme.surface, 0.88);
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
            ctx.fill();
          }
          ctx.fillStyle =
            node.kind === 'tag' ? colorFor(node) : node.id === hot ? theme.ink : theme.ink2;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(text, p.x, rect.y + 3);
          ctx.textAlign = 'start';
          ctx.textBaseline = 'alphabetic';
        }
        ctx.globalAlpha = 1;
      }
      if (!showLabels) drawHaloLabels(theme, () => {});
      drawMinimap(theme);
      config.onCamera?.(camera.k);
      return animating;
    };

    let miniTransform = null;
    const bounds = (nodes = scene.nodes) => {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const node of nodes) {
        minX = Math.min(minX, node.x - node.r);
        minY = Math.min(minY, node.y - node.r);
        maxX = Math.max(maxX, node.x + node.r);
        maxY = Math.max(maxY, node.y + node.r + 18);
      }
      return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    };
    const drawMinimap = (theme) => {
      if (!miniCtx || !minimap) return;
      const mw = minimap.clientWidth,
        mh = minimap.clientHeight;
      miniCtx.clearRect(0, 0, mw, mh);
      miniCtx.fillStyle = theme.surface;
      miniCtx.fillRect(0, 0, mw, mh);
      const b = bounds();
      if (!b) return;
      const pad = 40;
      const scale = Math.min(
        (mw - 16) / (b.maxX - b.minX + pad * 2),
        (mh - 16) / (b.maxY - b.minY + pad * 2),
      );
      const cx = (b.minX + b.maxX) / 2,
        cy = (b.minY + b.maxY) / 2;
      miniTransform = { scale, cx, cy, mw, mh };
      const mx = (x) => mw / 2 + (x - cx) * scale;
      const my = (y) => mh / 2 + (y - cy) * scale;
      miniCtx.globalAlpha = 0.5;
      miniCtx.strokeStyle = theme.line;
      miniCtx.lineWidth = 1;
      miniCtx.beginPath();
      if (scene.links.length < 4000)
        for (const link of scene.links) {
          const a = sceneById.get(link.source),
            c = sceneById.get(link.target);
          if (!a || !c) continue;
          miniCtx.moveTo(mx(a.x), my(a.y));
          miniCtx.lineTo(mx(c.x), my(c.y));
        }
      miniCtx.stroke();
      miniCtx.globalAlpha = 1;
      for (const node of scene.nodes) {
        miniCtx.fillStyle = colorFor(node);
        miniCtx.beginPath();
        miniCtx.arc(mx(node.x), my(node.y), clamp(node.r * scale, 1.6, 6), 0, TAU);
        miniCtx.fill();
      }
      const tl = toWorld({ x: 0, y: 0 }),
        br = toWorld({ x: width(), y: height() });
      miniCtx.strokeStyle = theme.accent;
      miniCtx.lineWidth = 1.5;
      miniCtx.strokeRect(mx(tl.x), my(tl.y), (br.x - tl.x) * scale, (br.y - tl.y) * scale);
    };

    /* --------------------------------------------------------------- câmera */
    const tweenCamera = (to, duration = 420) => {
      if (reduced) {
        Object.assign(camera, to);
        saveSoon();
        schedule();
        return;
      }
      camTween = { from: { ...camera }, to, start: now(), duration };
      schedule();
    };
    let maxFit = 1.6;
    const fitTarget = (nodes = scene.nodes) => {
      const b = bounds(nodes);
      if (!b) return { x: 0, y: 0, k: 1 };
      /* área útil: tira a barra da linha do tempo (embaixo) e um respiro em cima */
      const top = 64,
        bottom = 104;
      const k = clamp(
        Math.min(
          (width() - 140) / Math.max(b.maxX - b.minX, 1),
          (height() - top - bottom) / Math.max(b.maxY - b.minY, 1),
        ),
        0.15,
        maxFit,
      );
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 + (bottom - top) / 2 / k, k };
    };
    const fitNow = (animate) => {
      cameraFitted = true;
      const target = fitTarget();
      if (animate) tweenCamera(target, 600);
      else Object.assign(camera, target);
    };
    const zoomAt = (factor, point) => {
      const before = toWorld(point);
      camera.k = clamp(camera.k * factor, 0.12, 4);
      const after = toWorld(point);
      camera.x += before.x - after.x;
      camera.y += before.y - after.y;
      cameraFitted = true;
      saveSoon();
      schedule();
    };

    /* --------------------------------------------------------------- persistência */
    const persist = () => {
      const pos = {};
      for (const [id, p] of positions)
        if (id.startsWith('n:') || id.startsWith('s:') || id.startsWith('t:'))
          pos[id] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      const layout = {
        version: 2,
        camera: { ...camera },
        options: userOptions,
        positions: pos,
        view,
        showLabels,
        showOrphans,
        edgeKinds,
        expanded: [...expanded],
        colorMode: config.saved?.colorMode,
      };
      try {
        const key = `sophy-graph:${libraryKey}`;
        const previous = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(
          key,
          JSON.stringify({
            ...previous,
            ...layout,
            colorMode: previous.colorMode || layout.colorMode,
          }),
        );
      } catch {}
    };
    const saveSoon = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        saveTimer = 0;
        persist();
      }, 300);
    };

    /* --------------------------------------------------------------- linha do tempo */
    const span = () => Math.max(1, timeline.max - timeline.min);
    const emitTimeline = () =>
      config.onTimeline?.({
        ...timeline,
        visible: scene.nodes.filter((node) => node.kind === 'note').length,
        total: filtered.nodes.length,
      });
    let lastVisibleCount = -1;
    const visibleCountAt = (cursor) => {
      let count = 0;
      for (const node of filtered.nodes)
        if (!createdMs(node) || createdMs(node) <= cursor) count += 1;
      return count;
    };
    const advanceTimeline = (dt, t) => {
      const duration = 14000 / timeline.speed;
      if (reduced) {
        if (t - timeline.stepAt < 700) return;
        timeline.stepAt = t;
        timeline.cursor = Math.min(timeline.max, timeline.cursor + span() / 10);
      } else timeline.cursor = Math.min(timeline.max, timeline.cursor + (span() * dt) / duration);
      const count = visibleCountAt(timeline.cursor);
      if (count !== lastVisibleCount) {
        lastVisibleCount = count;
        rebuild({ reheat: 0.25 });
      }
      if (timeline.cursor >= timeline.max) {
        timeline.playing = false;
        rebuild({ reheat: 0.2 });
      }
      emitTimeline();
    };

    /* --------------------------------------------------------------- cartão */
    const hitTest = (point) => {
      let best = null,
        bestD = Infinity;
      for (let i = scene.nodes.length - 1; i >= 0; i -= 1) {
        const node = scene.nodes[i];
        const p = toScreen(node);
        const d = Math.hypot(p.x - point.x, p.y - point.y);
        const r = Math.max(node.r * camera.k, 7) + 4;
        if (d <= r && d < bestD) {
          best = node;
          bestD = d;
        }
      }
      return best;
    };
    const eventPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const dateLabel = (ms) =>
      ms
        ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(ms))
        : 'Data indisponível';
    const showCard = (node, event, mode = 'hover') => {
      const card = document.querySelector('#grafo-cartao');
      if (!card) return;
      if (!node) {
        if (pinnedCard && mode !== 'dismiss') return;
        pinnedCard = false;
        card.hidden = true;
        return;
      }
      if (mode === 'pin') pinnedCard = true;
      else if (pinnedCard) return;
      const links = neighborsOf.get(node.id) || new Set();
      let body = '';
      if (node.kind === 'note') {
        const ins = scene.links.filter(
          (link) => link.target === node.id && link.kind !== 'tag',
        ).length;
        const outs = scene.links.filter(
          (link) => link.source === node.id && link.kind !== 'tag',
        ).length;
        const tags = (node.tags || [])
          .slice(0, 5)
          .map(
            (tag) =>
              `<button type="button" class="grafo__tag" data-grafo-tag="${esc(tag)}" style="${config.tagStyle?.(tag) || `--tag-h:${config.tagHue?.(tag) ?? 250}`}">#${esc(tag)}</button>`,
          )
          .join('');
        body = `<small><i class="grafo__ponto" style="--grafo-cor:${esc(config.shelfColor?.(node.shelf) || '')}"></i><span>${esc(node.shelf)}</span></small><strong>${esc(node.label)}</strong>${tags ? `<div class="grafo__tags">${tags}</div>` : ''}<div class="grafo__stats"><span>${glyph('link')}<b>${ins}</b> ${ins === 1 ? 'entrada' : 'entradas'}</span><span>${glyph('externo')}<b>${outs}</b> ${outs === 1 ? 'saída' : 'saídas'}</span></div><span class="grafo__quando">${glyph('calendario')}<em>Criada em ${esc(dateLabel(node.created))}</em></span><button type="button" class="btn btn--secundario" data-grafo-acao="abrir">${glyph('nota')} Abrir nota</button>`;
      } else if (node.kind === 'shelf') {
        const outside = scene.links
          .filter(
            (link) => link.kind === 'shelf' && (link.source === node.id || link.target === node.id),
          )
          .reduce((sum, link) => sum + link.weight, 0);
        body = `<small>${glyph('estante')}<span>Estante</span></small><strong>${esc(node.shelf)}</strong><div class="grafo__stats"><span>${glyph('nota')}<b>${node.count}</b> ${node.count === 1 ? 'nota' : 'notas'}</span><span>${glyph('link')}<b>${outside}</b> ${outside === 1 ? 'link com outras' : 'links com outras'}</span></div><button type="button" class="btn btn--secundario" data-grafo-acao="expandir">${glyph('abrir')} Expandir estante</button>`;
      } else {
        body = `<small>${glyph('hash')}<span>Tag</span></small><strong style="color:${esc(colorFor(node))}">${esc(node.label)}</strong><div class="grafo__stats"><span>${glyph('nota')}<b>${node.count}</b> ${node.count === 1 ? 'nota' : 'notas'}</span><span>${glyph('link')}<b>${links.size}</b> ${links.size === 1 ? 'ligação' : 'ligações'}</span></div><button type="button" class="btn btn--secundario" data-grafo-acao="tag">${glyph('hash')} Ver a tag</button>`;
      }
      card.innerHTML = body;
      card.hidden = false;
      card.classList.toggle('is-fixo', pinnedCard);
      const stage = canvas.parentElement.getBoundingClientRect();
      const p = toScreen(node);
      const x = Number.isFinite(event?.clientX) ? event.clientX - stage.left + 16 : p.x + 18;
      const y = Number.isFinite(event?.clientY) ? event.clientY - stage.top + 16 : p.y + 18;
      card.style.left = `${clamp(x, 8, Math.max(8, stage.width - 290))}px`;
      card.style.top = `${clamp(y, 8, Math.max(8, stage.height - 230))}px`;
      card
        .querySelector('[data-grafo-acao="abrir"]')
        ?.addEventListener('click', () => config.onActivate?.(node.path));
      card
        .querySelector('[data-grafo-acao="expandir"]')
        ?.addEventListener('click', () => api.expandShelf(node.shelf));
      card
        .querySelector('[data-grafo-acao="tag"]')
        ?.addEventListener('click', () => config.onOpenTag?.(node.tag));
      card
        .querySelectorAll('[data-grafo-tag]')
        .forEach((button) =>
          button.addEventListener('click', () => config.onOpenTag?.(button.dataset.grafoTag)),
        );
      card.onpointerenter = () => clearTimeout(dismissTimer);
      card.onpointerleave = () => {
        if (!pinnedCard) dismissTimer = setTimeout(() => showCard(null), 160);
      };
    };

    const activate = (node) => {
      if (!node) return;
      if (node.kind === 'note') config.onActivate?.(node.path);
      else if (node.kind === 'shelf') api.expandShelf(node.shelf);
      else config.onOpenTag?.(node.tag);
    };

    /* --------------------------------------------------------------- eventos */
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      const point = eventPoint(event);
      const node = hitTest(point);
      pointer = { id: event.pointerId, start: point, last: point, node, moved: false };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.classList.add(node ? 'is-arrastando-no' : 'is-arrastando-fundo');
      camTween = null;
    };
    const onPointerMove = (event) => {
      const point = eventPoint(event);
      if (!pointer) {
        const node = hitTest(point);
        const id = node?.id || null;
        canvas.classList.toggle('is-sobre-no', !!node);
        if (id !== hovered) {
          hovered = id;
          clearTimeout(dismissTimer);
          if (node) showCard(node, event);
          else dismissTimer = setTimeout(() => showCard(null), 200);
          schedule();
        }
        return;
      }
      const dx = point.x - pointer.last.x,
        dy = point.y - pointer.last.y;
      pointer.moved ||= Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 3;
      pointer.last = point;
      if (!pointer.moved) return;
      if (pointer.node) {
        const world = toWorld(point);
        pointer.node.fx = world.x;
        pointer.node.fy = world.y;
        pointer.node.x = world.x;
        pointer.node.y = world.y;
        sim.alphaTarget = 0.25;
        sim.reheat(0.3);
        hovered = pointer.node.id;
        showCard(null, null, 'dismiss');
      } else {
        camera.x -= dx / camera.k;
        camera.y -= dy / camera.k;
        cameraFitted = true;
      }
      schedule();
    };
    const onPointerUp = (event) => {
      if (!pointer) return;
      const current = pointer;
      pointer = null;
      canvas.classList.remove('is-arrastando-no', 'is-arrastando-fundo');
      if (current.node && current.moved) {
        /* solto: a nota fica onde foi deixada e os vizinhos se acomodam com suavidade */
        current.node.fx = null;
        current.node.fy = null;
        sim.alphaTarget = 0;
        sim.reheat(0.18);
        positions.set(current.node.id, { x: current.node.x, y: current.node.y });
        saveSoon();
        schedule();
        return;
      }
      if (!current.moved) {
        if (current.node) {
          selected = current.node.id;
          config.onSelect?.(current.node.path || null, current.node);
          showCard(current.node, event, 'pin');
        } else {
          selected = null;
          showCard(null, null, 'dismiss');
        }
        schedule();
      } else saveSoon();
    };
    const onDblClick = (event) => activate(hitTest(eventPoint(event)));
    const onWheel = (event) => {
      event.preventDefault();
      camTween = null;
      zoomAt(Math.exp(-event.deltaY * 0.0015), eventPoint(event));
    };
    const onLeave = () => {
      if (pointer) return;
      hovered = null;
      if (!pinnedCard) dismissTimer = setTimeout(() => showCard(null), 200);
      schedule();
    };
    const onKey = (event) => {
      if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const current = sceneById.get(selected) || scene.nodes[0];
        if (!current) return;
        if (!sceneById.get(selected)) selected = current.id;
        else {
          const dir = {
            ArrowRight: [1, 0],
            ArrowLeft: [-1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          let best = null,
            bestScore = Infinity;
          for (const node of scene.nodes) {
            if (node === current) continue;
            const dx = node.x - current.x,
              dy = node.y - current.y;
            const along = dx * dir[0] + dy * dir[1];
            if (along <= 0) continue;
            const across = Math.abs(dx * dir[1] - dy * dir[0]);
            const score = along + across * 2.2;
            if (score < bestScore) {
              best = node;
              bestScore = score;
            }
          }
          if (best) selected = best.id;
        }
        const node = sceneById.get(selected);
        config.onSelect?.(node.path || null, node);
        canvas.setAttribute(
          'aria-label',
          `Grafo. Selecionado: ${node.label}. Setas navegam, Enter abre.`,
        );
        const p = toScreen(node);
        if (p.x < 60 || p.x > width() - 60 || p.y < 60 || p.y > height() - 60)
          tweenCamera({ x: node.x, y: node.y, k: camera.k }, 300);
        showCard(null, null, 'dismiss');
        schedule();
      } else if (event.key === 'Enter') activate(sceneById.get(selected));
      else if (event.key === '+' || event.key === '=') api.zoomBy(1.2);
      else if (event.key === '-') api.zoomBy(1 / 1.2);
      else if (event.key === 'Escape') {
        selected = null;
        showCard(null, null, 'dismiss');
        schedule();
      }
    };
    let miniDrag = false;
    const miniJump = (event) => {
      if (!miniTransform) return;
      const rect = minimap.getBoundingClientRect();
      const x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      camera.x = miniTransform.cx + (x - miniTransform.mw / 2) / miniTransform.scale;
      camera.y = miniTransform.cy + (y - miniTransform.mh / 2) / miniTransform.scale;
      cameraFitted = true;
      saveSoon();
      schedule();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('keydown', onKey);
    const miniDown = (event) => {
      miniDrag = true;
      minimap.setPointerCapture?.(event.pointerId);
      miniJump(event);
    };
    const miniMove = (event) => miniDrag && miniJump(event);
    const miniUp = () => {
      miniDrag = false;
    };
    minimap?.addEventListener('pointerdown', miniDown);
    minimap?.addEventListener('pointermove', miniMove);
    minimap?.addEventListener('pointerup', miniUp);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(canvas.parentElement);
    resize();

    timeline.cursor = timeline.max;
    rebuild({ reheat: positions.size ? 0.4 : 1 });

    const api = {
      supportsWorker: true,
      sim,
      get graph() {
        return filtered;
      },
      get view() {
        return view;
      },
      setGraph(next) {
        filtered = next || { nodes: [], edges: [] };
        rebuild({ reheat: 0.4 });
      },
      setBaseGraph(next) {
        base = next || { nodes: [], edges: [] };
        computeTimes();
      },
      setRelatedTags(next) {
        relatedTags = next && typeof next === 'object' ? next : {};
        if (view === 'tags') rebuild({ reheat: 0.25, animate: false });
      },
      setView(next) {
        if (!['notas', 'estantes', 'tags'].includes(next) || next === view) return;
        view = next;
        colorCache = new Map();
        rebuild({ reheat: 0.8 });
        cameraFitted = false;
        saveSoon();
      },
      setEdgeKinds(next) {
        edgeKinds = { ...edgeKinds, ...next };
        rebuild({ reheat: 0.5 });
        saveSoon();
      },
      get edgeKinds() {
        return { ...edgeKinds };
      },
      expandShelf(name) {
        if (view !== 'estantes') return;
        expanded.add(name);
        showCard(null, null, 'dismiss');
        rebuild({ reheat: 0.7 });
        config.onExpand?.([...expanded]);
        saveSoon();
      },
      collapseShelf(name) {
        if (name) expanded.delete(name);
        else expanded.clear();
        rebuild({ reheat: 0.6 });
        config.onExpand?.([...expanded]);
        saveSoon();
      },
      get expanded() {
        return [...expanded];
      },
      setSelected(path) {
        selected = path ? `n:${path}` : null;
        if (scope === 'local') rebuild({ reheat: 0.5 });
        schedule();
      },
      setMode(next) {
        scope = next === 'local' ? 'local' : 'global';
        rebuild({ reheat: 0.6 });
        cameraFitted = false;
      },
      setDepth(value) {
        depth = clamp(Number(value) || 1, 1, 3);
        rebuild({ reheat: 0.5 });
        cameraFitted = false;
      },
      setOption(key, value) {
        if (!(key in sim.options)) return;
        userOptions = { ...userOptions, [key]: value };
        sim.options[key] = value;
        if (key === 'shelfAttraction' && view === 'tags')
          sim.options.shelfAttraction = Math.min(value, 0.004);
        sim.reheat(0.6);
        saveSoon();
        schedule();
      },
      resetOptions(values) {
        userOptions = { ...values };
        Object.assign(sim.options, values);
        paused = false;
        sim.reheat(0.8);
        saveSoon();
        schedule();
      },
      setForcesRunning(value) {
        paused = !value;
        if (value) sim.reheat(0.3);
        schedule();
      },
      setShowLabels(value) {
        showLabels = !!value;
        saveSoon();
        schedule();
      },
      setShowOrphans(value) {
        showOrphans = !!value;
        rebuild({ reheat: 0.3 });
        saveSoon();
      },
      zoomBy(factor) {
        tweenCamera({ x: camera.x, y: camera.y, k: clamp(camera.k * factor, 0.12, 4) }, 220);
      },
      fit() {
        cameraFitted = true;
        tweenCamera(fitTarget(), 520);
      },
      focus(path) {
        const node = sceneById.get(`n:${path}`) || sceneById.get(path);
        if (!node) return false;
        selected = node.id;
        tweenCamera({ x: node.x, y: node.y, k: Math.max(camera.k, 1) }, 480);
        return true;
      },
      /* linha do tempo */
      get timeline() {
        return { ...timeline };
      },
      setUntil(ms) {
        timeline.cursor = ms ? clamp(ms, timeline.min, timeline.max) : timeline.max;
        lastVisibleCount = visibleCountAt(timeline.cursor);
        rebuild({ reheat: 0.3 });
        emitTimeline();
      },
      play() {
        if (!timeline.max || timeline.max === timeline.min) return;
        if (timeline.cursor >= timeline.max) {
          timeline.cursor = timeline.min;
          lastVisibleCount = visibleCountAt(timeline.cursor);
          rebuild({ reheat: 0.4 });
          cameraFitted = true;
          tweenCamera(
            fitTarget(
              filtered.nodes.map(
                (note) =>
                  sceneById.get(`n:${note.path}`) || {
                    x: positions.get(`n:${note.path}`)?.x ?? 0,
                    y: positions.get(`n:${note.path}`)?.y ?? 0,
                    r: 8,
                  },
              ),
            ),
            500,
          );
        }
        timeline.playing = true;
        timeline.stepAt = 0;
        lastFrame = 0;
        emitTimeline();
        schedule();
      },
      pause() {
        timeline.playing = false;
        emitTimeline();
      },
      setSpeed(value) {
        timeline.speed = [1, 2, 4].includes(Number(value)) ? Number(value) : 1;
        emitTimeline();
      },
      /* para os testes e a acessibilidade */
      snapshot() {
        return scene.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          label: node.label,
          x: node.x,
          y: node.y,
          r: node.r,
          shelf: node.shelf,
        }));
      },
      /* posição de um nó na tela (px dentro do canvas) */
      toScreen(id) {
        const node = sceneById.get(id);
        return node ? toScreen(node) : null;
      },
      links() {
        return scene.links.map((link) => ({
          source: link.source,
          target: link.target,
          kind: link.kind,
          weight: link.weight,
        }));
      },
      settled() {
        return sim.settled() && !timeline.playing;
      },
      stats,
      dispose() {
        disposed = true;
        if (saveTimer) {
          clearTimeout(saveTimer);
          persist();
        }
        clearTimeout(dismissTimer);
        cancelAnimationFrame(raf);
        themeObserver.disconnect();
        resizeObserver?.disconnect();
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('dblclick', onDblClick);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('keydown', onKey);
        minimap?.removeEventListener('pointerdown', miniDown);
        minimap?.removeEventListener('pointermove', miniMove);
        minimap?.removeEventListener('pointerup', miniUp);
      },
    };
    canvas.__sophyGraph = api;
    return api;
  }

  window.SophyGraphView = { create, localGraph, buildScene };
})();
