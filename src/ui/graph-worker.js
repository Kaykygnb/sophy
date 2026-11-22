/* Force simulation stays off the UI thread. The quadtree bounds repulsion work. */
let nodes = [];
let links = [];
let options = {};
let generation = 0;
let frame = 0;
let running = false;

function buildTree(points, x, y, size, depth = 0) {
  const cell = { x, y, size, mass: 0, cx: 0, cy: 0, points: [], children: null };
  for (const point of points) {
    cell.mass += 1;
    cell.cx += point.x;
    cell.cy += point.y;
  }
  if (cell.mass) {
    cell.cx /= cell.mass;
    cell.cy /= cell.mass;
  }
  if (points.length <= 1 || depth >= 18 || size < 0.5) {
    cell.points = points;
    return cell;
  }
  const half = size / 2;
  const groups = [[], [], [], []];
  for (const point of points) {
    const quadrant = (point.x >= x + half ? 1 : 0) + (point.y >= y + half ? 2 : 0);
    groups[quadrant].push(point);
  }
  if (groups.some((group) => group.length === points.length)) {
    cell.points = points;
    return cell;
  }
  cell.children = groups.map((group, index) => {
    const ox = index & 1 ? half : 0;
    const oy = index & 2 ? half : 0;
    return group.length ? buildTree(group, x + ox, y + oy, half, depth + 1) : null;
  });
  return cell;
}

function repel(point, cell, theta, strength) {
  if (!cell || !cell.mass || (cell.points?.length === 1 && cell.points[0] === point)) return;
  let dx = point.x - cell.cx;
  let dy = point.y - cell.cy;
  const distance2 = dx * dx + dy * dy + 0.1;
  const distance = Math.sqrt(distance2);
  if (!cell.children || cell.size / distance < theta) {
    const force = (strength * cell.mass) / distance2;
    point.vx += (dx / distance) * force;
    point.vy += (dy / distance) * force;
    return;
  }
  for (const child of cell.children) repel(point, child, theta, strength);
}

function tick() {
  const width = Math.max(320, Number(options.width) || 1000);
  const height = Math.max(280, Number(options.height) || 700);
  const bounds = Math.max(width, height, Math.sqrt(nodes.length) * 220);
  const points = nodes;
  const movable = points.filter((node) => !node.pinned && !node.returning);
  const tree = buildTree(points, -bounds, -bounds, bounds * 2);
  const repulsion = Number(options.repulsion ?? 500);
  for (const node of movable) repel(node, tree, 0.82, repulsion);
  const distance = Number(options.distance ?? 90);
  const linkForce = Number(options.linkForce ?? 0.018);
  for (const [a, b] of links) {
    const from = nodes[a];
    const to = nodes[b];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 0.01;
    const force = (length - distance) * linkForce;
    if (!from.pinned && !from.returning) {
      from.vx += (dx / length) * force;
      from.vy += (dy / length) * force;
    }
    if (!to.pinned && !to.returning) {
      to.vx -= (dx / length) * force;
      to.vy -= (dy / length) * force;
    }
  }
  const center = Number(options.center ?? 0.006);
  const shelfAttraction = Number(options.shelfAttraction ?? 0);
  const shelfCount = Math.max(1, Number(options.shelfCount) || 1);
  for (const node of movable) {
    node.vx += (width / 2 - node.x) * center;
    node.vy += (height / 2 - node.y) * center;
    if (shelfAttraction && node.group >= 0) {
      const angle = (node.group / shelfCount) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.2;
      const ax = width / 2 + Math.cos(angle) * radius;
      const ay = height / 2 + Math.sin(angle) * radius;
      node.vx += (ax - node.x) * shelfAttraction;
      node.vy += (ay - node.y) * shelfAttraction;
    }
    node.vx *= 0.72;
    node.vy *= 0.72;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > 18) {
      node.vx *= 18 / speed;
      node.vy *= 18 / speed;
    }
    node.x += node.vx;
    node.y += node.vy;
  }
  for (const node of points) {
    if (!node.returning) continue;
    const hx = Number.isFinite(node.homeX) ? node.homeX : node.x;
    const hy = Number.isFinite(node.homeY) ? node.homeY : node.y;
    node.vx += (hx - node.x) * 0.22;
    node.vy += (hy - node.y) * 0.22;
    node.vx *= 0.7;
    node.vy *= 0.7;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function settleReturns() {
  let pending = false;
  for (const node of nodes) {
    if (!node.returning) continue;
    const left = Math.hypot(node.x - node.homeX, node.y - node.homeY);
    const speed = Math.hypot(node.vx, node.vy);
    if (left < 1.1 && speed < 0.4) {
      node.x = node.homeX;
      node.y = node.homeY;
      node.vx = 0;
      node.vy = 0;
      node.returning = false;
      node.pinned = false;
    } else pending = true;
  }
  if (!pending)
    for (const node of nodes) {
      if (!node.wasPinned) node.pinned = false;
    }
  return pending;
}

function publish(done = false) {
  postMessage({
    type: 'positions',
    generation,
    frame,
    done,
    positions: nodes.map(({ x, y }) => [x, y]),
  });
}

function loop() {
  const token = generation;
  if (!running) return;
  for (let i = 0; i < 4; i += 1) tick();
  frame += 4;
  const returning = nodes.some((node) => node.returning);
  if (returning) {
    const pending = settleReturns();
    publish(!pending);
    if (!pending) {
      running = false;
      return;
    }
  } else if (frame % 12 === 0 || frame >= 180) publish(frame >= 180);
  if (frame >= 180 && !nodes.some((node) => node.returning)) {
    running = false;
    return;
  }
  setTimeout(() => {
    if (token === generation) loop();
  }, 0);
}

onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'init') {
    generation += 1;
    frame = 0;
    nodes = (message.nodes || []).map((node) => ({
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      vx: 0,
      vy: 0,
      pinned: !!node.pinned,
      returning: false,
      homeX: Number.isFinite(node.x) ? node.x : 0,
      homeY: Number.isFinite(node.y) ? node.y : 0,
      group: Number.isInteger(node.group) ? node.group : -1,
    }));
    links = message.links || [];
    options = message.options || {};
    running = !!message.running;
    postMessage({ type: 'ready', generation, count: nodes.length });
    if (running) loop();
    else publish(true);
  } else if (message.type === 'pin' && nodes[message.index]) {
    Object.assign(nodes[message.index], { x: message.x, y: message.y, vx: 0, vy: 0, pinned: true });
  } else if (message.type === 'release' && nodes[message.index]) {
    const index = message.index;
    nodes.forEach((node, i) => {
      node.wasPinned = !!node.pinned && i !== index;
      node.pinned = i !== index;
      node.returning = i === index;
      if (i === index) {
        node.homeX = Number.isFinite(message.homeX) ? message.homeX : node.homeX;
        node.homeY = Number.isFinite(message.homeY) ? message.homeY : node.homeY;
        node.vx = 0;
        node.vy = 0;
      }
    });
    frame = 0;
    generation += 1;
    running = true;
    loop();
  } else if (message.type === 'unpin' && nodes[message.index]) {
    nodes[message.index].pinned = false;
    nodes[message.index].vx = 0;
    nodes[message.index].vy = 0;
  } else if (message.type === 'options') {
    options = { ...options, ...message.options };
    if (message.restart) {
      frame = 0;
      generation += 1;
      running = true;
      loop();
    }
  } else if (message.type === 'pause') {
    running = false;
    publish(true);
  } else if (message.type === 'resume' && !running) {
    if (frame >= 180) {
      frame = 0;
      generation += 1;
    }
    running = true;
    loop();
  }
};
