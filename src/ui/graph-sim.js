/* Simulação de forças do grafo (sem dependências).
   Repulsão com quadtree (Barnes-Hut), molas nas ligações, ímã de estante (cada nó vai para o
   centro do seu grupo e os grupos se afastam entre si), colisão pelo raio e um passo final que
   garante que nenhum par de nós fica sobreposto. Roda no fio da interface: os nós entram e saem
   a qualquer momento (linha do tempo) e o custo por passo fica em O(n log n). */
(() => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function buildTree(nodes) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const node of nodes) {
      if (node.x < minX) minX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.x > maxX) maxX = node.x;
      if (node.y > maxY) maxY = node.y;
    }
    const size = Math.max(maxX - minX, maxY - minY, 1) + 1;
    const root = { x: minX, y: minY, size, mass: 0, cx: 0, cy: 0, node: null, kids: null };
    const insert = (cell, node, depth) => {
      if (!cell.kids && !cell.node && !cell.mass) {
        cell.node = node;
        cell.mass = node.charge;
        cell.cx = node.x;
        cell.cy = node.y;
        return;
      }
      const total = cell.mass + node.charge;
      cell.cx = (cell.cx * cell.mass + node.x * node.charge) / total;
      cell.cy = (cell.cy * cell.mass + node.y * node.charge) / total;
      cell.mass = total;
      if (depth > 24) {
        (cell.extra ||= []).push(node);
        return;
      }
      if (!cell.kids) {
        cell.kids = [null, null, null, null];
        const old = cell.node;
        cell.node = null;
        if (old) place(cell, old, depth);
      }
      place(cell, node, depth);
    };
    const place = (cell, node, depth) => {
      const half = cell.size / 2;
      const q = (node.x >= cell.x + half ? 1 : 0) + (node.y >= cell.y + half ? 2 : 0);
      if (!cell.kids[q])
        cell.kids[q] = {
          x: cell.x + (q & 1 ? half : 0),
          y: cell.y + (q & 2 ? half : 0),
          size: half,
          mass: 0,
          cx: 0,
          cy: 0,
          node: null,
          kids: null,
        };
      insert(cell.kids[q], node, depth + 1);
    };
    for (const node of nodes) insert(root, node, 0);
    return root;
  }

  function create(settings = {}) {
    const sim = {
      nodes: [],
      links: [],
      alpha: 1,
      alphaMin: 0.004,
      alphaDecay: 0.03,
      alphaTarget: 0,
      velocityDecay: 0.42,
      options: {
        distance: 90,
        repulsion: 500,
        linkForce: 0.018,
        center: 0.006,
        shelfAttraction: 0.012,
        ...(settings.options || {}),
      },
    };
    const byId = new Map();

    sim.setNodes = (nodes) => {
      sim.nodes = nodes;
      byId.clear();
      for (const node of nodes) {
        byId.set(node.id, node);
        node.vx ||= 0;
        node.vy ||= 0;
      }
    };
    sim.setLinks = (links) => {
      const count = new Map();
      sim.links = links.filter(
        (link) => byId.has(link.source) && byId.has(link.target) && link.source !== link.target,
      );
      for (const link of sim.links) {
        count.set(link.source, (count.get(link.source) || 0) + 1);
        count.set(link.target, (count.get(link.target) || 0) + 1);
      }
      for (const link of sim.links) {
        link.a = byId.get(link.source);
        link.b = byId.get(link.target);
        link.bias = count.get(link.source) / (count.get(link.source) + count.get(link.target));
        link.base = 1 / Math.min(count.get(link.source), count.get(link.target));
      }
    };
    sim.reheat = (value = 0.5) => {
      sim.alpha = Math.max(sim.alpha, value);
    };
    sim.settled = () => sim.alpha < sim.alphaMin;

    const charge = () => {
      const strength = -(sim.options.repulsion / 500) * 140;
      const nodes = sim.nodes;
      for (const node of nodes) node.charge = strength * (1 + (node.r || 6) / 14);
      if (nodes.length < 2) return;
      const alpha = sim.alpha;
      if (nodes.length <= 120) {
        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = nodes[j];
            let dx = b.x - a.x,
              dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              dx = (i - j) * 0.37 || 0.5;
              dy = 0.29;
              d2 = dx * dx + dy * dy;
            }
            if (d2 > 640000) continue;
            const fa = (b.charge * alpha) / d2;
            const fb = (a.charge * alpha) / d2;
            a.vx += dx * fa;
            a.vy += dy * fa;
            b.vx -= dx * fb;
            b.vy -= dy * fb;
          }
        }
        return;
      }
      const tree = buildTree(nodes);
      const theta2 = 0.81;
      const visit = (node, cell) => {
        if (!cell || !cell.mass) return;
        let dx = cell.cx - node.x,
          dy = cell.cy - node.y;
        let d2 = dx * dx + dy * dy;
        if (!cell.kids || (cell.size * cell.size) / theta2 < d2) {
          if (cell.node === node && !cell.extra) return;
          if (d2 < 1) {
            dx = 0.5;
            dy = 0.3;
            d2 = 0.34;
          }
          if (d2 > 640000) return;
          const f = (cell.mass * alpha) / d2;
          node.vx += dx * f;
          node.vy += dy * f;
          return;
        }
        for (const kid of cell.kids) if (kid) visit(node, kid);
      };
      for (const node of nodes) visit(node, tree);
    };

    const springs = () => {
      const k = sim.options.linkForce / 0.018;
      const base = sim.options.distance;
      for (const link of sim.links) {
        const { a, b } = link;
        let dx = b.x + b.vx - a.x - a.vx,
          dy = b.y + b.vy - a.y - a.vy;
        const len = Math.hypot(dx, dy) || 0.01;
        const want = (link.distance ?? base) + (a.r || 0) + (b.r || 0);
        const strength = clamp(link.base * k * (link.strength ?? 1), 0, 1.4);
        const l = ((len - want) / len) * sim.alpha * strength;
        dx *= l;
        dy *= l;
        b.vx -= dx * link.bias;
        b.vy -= dy * link.bias;
        a.vx += dx * (1 - link.bias);
        a.vy += dy * (1 - link.bias);
      }
    };

    const clusters = () => {
      const pull = sim.options.shelfAttraction;
      const groups = new Map();
      for (const node of sim.nodes) {
        if (!node.cluster) continue;
        let group = groups.get(node.cluster);
        if (!group) groups.set(node.cluster, (group = { x: 0, y: 0, n: 0, area: 0, list: [] }));
        group.x += node.x;
        group.y += node.y;
        group.n += 1;
        group.area += ((node.r || 6) + 14) ** 2;
        group.list.push(node);
      }
      if (!groups.size) return groups;
      for (const group of groups.values()) {
        group.x /= group.n;
        group.y /= group.n;
        /* raio real do grupo (até a borda do nó mais distante), com uma folga para a área colorida */
        let far = 0;
        for (const node of group.list)
          far = Math.max(far, Math.hypot(node.x - group.x, node.y - group.y) + (node.r || 6));
        group.radius = clamp(far, Math.sqrt(group.area) * 0.9, Math.sqrt(group.area) * 1.7) + 52;
      }
      if (pull > 0)
        for (const group of groups.values())
          for (const node of group.list) {
            node.vx += (group.x - node.x) * pull * 3 * sim.alpha;
            node.vy += (group.y - node.y) * pull * 3 * sim.alpha;
          }
      /* grupos não se invadem: se dois centros estão perto demais, cada um recua */
      const list = [...groups.values()];
      if (pull > 0)
        for (let i = 0; i < list.length; i += 1)
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i],
              b = list[j];
            let dx = b.x - a.x,
              dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 0.01;
            const min = a.radius + b.radius;
            if (len >= min) continue;
            const push = ((min - len) / len) * 0.3 * Math.min(1, pull / 0.008) * sim.alpha;
            dx *= push;
            dy *= push;
            for (const node of a.list) {
              node.vx -= dx * 0.5;
              node.vy -= dy * 0.5;
            }
            for (const node of b.list) {
              node.vx += dx * 0.5;
              node.vy += dy * 0.5;
            }
            /* empurrão leve e limitado mesmo com a simulação fria: as áreas das estantes não se cobrem */
            const shift = Math.min((min - len) * 0.04, 1.5) / len;
            for (const node of a.list)
              if (node.fx == null) {
                node.x -= (b.x - a.x) * shift;
                node.y -= (b.y - a.y) * shift;
              }
            for (const node of b.list)
              if (node.fx == null) {
                node.x += (b.x - a.x) * shift;
                node.y += (b.y - a.y) * shift;
              }
          }
      return groups;
    };

    const gravity = () => {
      const k = sim.options.center * sim.alpha;
      for (const node of sim.nodes) {
        node.vx -= node.x * k;
        node.vy -= node.y * k;
      }
    };

    /* colisão por grade: cada nó só testa as células vizinhas */
    const collide = (strength = 0.8) => {
      const nodes = sim.nodes;
      if (nodes.length < 2) return 0;
      let maxR = 1;
      for (const node of nodes) maxR = Math.max(maxR, node.cr || node.r || 6);
      const cell = maxR * 2;
      const grid = new Map();
      for (const node of nodes) {
        const key = `${Math.floor(node.x / cell)}|${Math.floor(node.y / cell)}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(node);
      }
      let worst = 0;
      for (const a of nodes) {
        const gx = Math.floor(a.x / cell),
          gy = Math.floor(a.y / cell);
        const ra = a.cr || a.r || 6;
        for (let ox = -1; ox <= 1; ox += 1)
          for (let oy = -1; oy <= 1; oy += 1) {
            const bucket = grid.get(`${gx + ox}|${gy + oy}`);
            if (!bucket) continue;
            for (const b of bucket) {
              if (b === a || b.index < a.index) continue;
              const rb = b.cr || b.r || 6;
              let dx = b.x - a.x,
                dy = b.y - a.y;
              let d = Math.hypot(dx, dy);
              const min = ra + rb;
              if (d >= min) continue;
              if (d < 0.01) {
                dx = (a.index % 7) - 3 || 1;
                dy = (b.index % 5) - 2 || 1;
                d = Math.hypot(dx, dy);
              }
              const overlap = ((min - d) / d) * strength;
              worst = Math.max(worst, min - d);
              const fixedA = a.fx != null,
                fixedB = b.fx != null;
              const share = fixedA ? 0 : fixedB ? 1 : (rb * rb) / (ra * ra + rb * rb);
              if (!fixedA) {
                a.x -= dx * overlap * share;
                a.y -= dy * overlap * share;
              }
              if (!fixedB) {
                b.x += dx * overlap * (1 - share);
                b.y += dy * overlap * (1 - share);
              }
            }
          }
      }
      return worst;
    };

    sim.tick = () => {
      sim.alpha += (sim.alphaTarget - sim.alpha) * sim.alphaDecay;
      sim.nodes.forEach((node, index) => {
        node.index = index;
      });
      charge();
      springs();
      clusters();
      gravity();
      for (const node of sim.nodes) {
        if (node.fx != null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 1 - sim.velocityDecay;
        node.vy *= 1 - sim.velocityDecay;
        const speed = Math.hypot(node.vx, node.vy);
        if (speed > 40) {
          node.vx *= 40 / speed;
          node.vy *= 40 / speed;
        }
        node.x += node.vx;
        node.y += node.vy;
      }
      collide(0.7);
      collide(0.7);
      if (sim.settled()) sim.untangle();
    };

    /* fim da simulação: repete a colisão até nenhum par ficar sobreposto */
    sim.untangle = (rounds = 60) => {
      sim.nodes.forEach((node, index) => {
        node.index = index;
      });
      for (let i = 0; i < rounds; i += 1) if (collide(1) <= 0.01) return true;
      return false;
    };

    sim.run = (maxTicks = 400) => {
      let ticks = 0;
      while (!sim.settled() && ticks < maxTicks) {
        sim.tick();
        ticks += 1;
      }
      sim.untangle(120);
      return ticks;
    };

    return sim;
  }

  const api = { create };
  if (typeof window !== 'undefined') window.SophyGraphSim = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
