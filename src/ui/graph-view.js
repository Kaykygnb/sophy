/**
 * Vista do grafo. Os nomes em GRAPH_ICON são os símbolos do sprite atual;
 * quando o Phosphor entrar, troca-se só este mapa (sliders, globe, funnel…).
 *
 * As forças não cabem no IPC de configurações: `sophy:settings` ignora chaves
 * fora da lista fixa. O perfil fica em localStorage, no mesmo userData da janela.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const model = typeof SophyGraphModel !== 'undefined' ? SophyGraphModel : require('./graph-model');

  const GRAPH_ICON = {
    zoomIn: 'zoom-mais',
    zoomOut: 'zoom-menos',
    fit: 'ajustar',
    global: 'globo',
    local: 'grafo',
    filters: 'filtro',
    forces: 'ajuste',
    canvas: 'canvas',
    attachment: 'anexo',
  };
  const PREF_KEY = 'sophy.ui.graph';
  const DRAG_PX = 5;
  const CLICK_MS = 280;

  function glyph(icon, key) {
    const name = GRAPH_ICON[key];
    if (!name || typeof document === 'undefined' || !document.getElementById(`i-${name}`))
      return '';
    return icon(name);
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (!raw) return null;
      return model.prefsShape(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function writeStore(prefs) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(model.prefsShape(prefs)));
    } catch {
      /* perfil cheio ou bloqueado: a sessão segue sem gravar */
    }
  }

  function mount(host, api) {
    const icon = api.icon;
    const escapeHtml = api.escapeHtml;
    const saved = readStore();
    let alive = true;
    let token = 0;
    let mode = saved ? saved.mode : 'global';
    let depth = saved ? saved.depth : 1;
    let centerPath = saved ? saved.center : '';
    let arrows = saved ? saved.arrows : false;
    let until = saved ? saved.until : 1;
    let filters = saved
      ? { ...saved.filters }
      : { shelves: null, tag: '', hideOrphans: false, showCanvas: false, showAttachments: false };
    if (api.forcedShelf) filters = { ...filters, shelves: [api.forcedShelf] };
    let forces = saved ? { ...saved.forces } : { ...model.DEFAULT_FORCES };
    let raw = { nodes: [], edges: [] };
    let view = { nodes: [], edges: [], counts: { notes: 0, links: 0 }, frames: [] };
    let sim = null;
    let camera = { x: 0, y: 0, zoom: 1 };
    let hover = null;
    let width = 0;
    let height = 0;
    let raf = 0;
    let clickTimer = 0;
    let lastClickUp = 0;
    let pointer = null;
    let userFramed = false;
    let fitWhenSettled = true;
    let reduced = false;
    const fades = new Map();
    let colors = {
      bg: '#FAF9F7',
      ink: '#1E1C29',
      accent: '#4B52B0',
      warning: '#8A5A12',
      line: '#E6E3DD',
      surface: '#FFFFFF',
      font: 'Inter, sans-serif',
    };

    host.classList.add('grafo');
    host.innerHTML = `<div class="grafo__barra">
        <div class="segmentado" role="radiogroup" aria-label="Alcance do grafo">
          <label class="segmentado__opcao"><input type="radio" name="grafo-alcance" value="global" ${mode === 'global' ? 'checked' : ''} /><span>${glyph(icon, 'global')}Global</span></label>
          <label class="segmentado__opcao"><input type="radio" name="grafo-alcance" value="local" ${mode === 'local' ? 'checked' : ''} /><span>${glyph(icon, 'local')}Local</span></label>
        </div>
        <div class="segmentado grafo__profundidade" id="grafo-profundidade" role="radiogroup" aria-label="Profundidade local" ${mode === 'local' ? '' : 'hidden'}>
          ${[1, 2, 3]
            .map(
              (value) =>
                `<label class="segmentado__opcao"><input type="radio" name="grafo-profundidade" value="${value}" aria-label="Profundidade ${value}" ${depth === value ? 'checked' : ''} /><span>${value}</span></label>`,
            )
            .join('')}
        </div>
        <label class="grafo__centro" id="grafo-centro-rotulo" ${mode === 'local' ? '' : 'hidden'}>Centro
          <select id="grafo-centro" aria-label="Nota central"></select>
        </label>
        <p class="grafo__contagem" id="grafo-contagem" aria-live="polite">Carregando o grafo…</p>
        <label class="grafo__tempo">Linha do tempo
          <input id="grafo-tempo" type="range" min="0" max="100" step="1" value="${Math.round(until * 100)}" aria-label="Linha do tempo" />
        </label>
        <span class="grafo__quadros" id="grafo-quadros">Antes 0 · Agora 0 · Depois 0</span>
        <button type="button" class="btn btn--secundario" id="grafo-filtros" aria-expanded="false">${glyph(icon, 'filters')}Filtros</button>
        <button type="button" class="btn btn--secundario" id="grafo-forcas-botao" aria-expanded="true" aria-pressed="true">Forças</button>
      </div>
      <div class="grafo__corpo">
        <div class="grafo__palco" id="grafo-palco">
          <canvas id="grafo-canvas" aria-label="Grafo das notas" tabindex="0"></canvas>
          <div class="grafo__legenda"></div>
          <div class="grafo__estado" id="grafo-estado" role="status">Carregando o grafo…</div>
          <div class="grafo__painel grafo__painel--filtros" id="grafo-painel-filtros" hidden>
            <header class="grafo__painel-topo"><h2>Filtros</h2><button type="button" class="btn btn--icone" id="grafo-fechar-filtros" aria-label="Fechar filtros">${icon('fechar')}</button></header>
            <p class="grafo__painel-nota">Escondem estantes, a tag e as notas órfãs. Canvas e anexos ficam de fora até você pedir.</p>
            <fieldset class="grafo__estantes"><legend>Estantes</legend><div id="grafo-estantes"></div></fieldset>
            <label class="grafo__campo">Tag <input id="grafo-tag" type="search" value="${escapeHtml(filters.tag)}" placeholder="estudo" aria-label="Tag" /></label>
            <label class="grafo-check"><input type="checkbox" id="grafo-orfas" ${filters.hideOrphans ? 'checked' : ''} /><span>Esconder notas órfãs</span></label>
            <label class="grafo-check"><input type="checkbox" id="grafo-mostrar-canvas" ${filters.showCanvas ? 'checked' : ''} /><span>Mostrar canvas</span></label>
            <label class="grafo-check"><input type="checkbox" id="grafo-anexos" ${filters.showAttachments ? 'checked' : ''} /><span>Mostrar anexos</span></label>
          </div>
          <div class="grafo__hover" id="grafo-hover" hidden></div>
          <canvas class="grafo__mini" id="grafo-mini" aria-label="Minimapa" width="168" height="112"></canvas>
          <div class="grafo__zoom">
            <button type="button" class="btn btn--icone" id="grafo-mais" aria-label="Aproximar">${glyph(icon, 'zoomIn')}</button>
            <button type="button" class="btn btn--icone" id="grafo-menos" aria-label="Afastar">${glyph(icon, 'zoomOut')}</button>
            <button type="button" class="btn btn--icone" id="grafo-ajustar" aria-label="Ajustar à tela">${glyph(icon, 'fit')}</button>
          </div>
        </div>
        <aside class="grafo__forcas" id="grafo-painel-forcas" aria-label="Forças">
          <header class="grafo__forcas-topo"><h2>Forças</h2><button type="button" class="btn btn--fantasma" id="grafo-restaurar">Restaurar padrão</button></header>
          <p class="grafo__forcas-nota">Valores padrão são o ponto de partida do layout. A simulação acomoda e para; mexer reaquece.</p>
          ${slider('mola', 'Força da mola', 'Quão forte a aresta puxa.', 0, 2, 0.05, forces.spring)}
          ${slider('comprimento', 'Comprimento da aresta', 'Distância de descanso da mola.', 20, 220, 1, forces.length)}
          ${slider('repulsao', 'Repulsão', 'Quão forte os nós se empurram.', 0, 2, 0.05, forces.repulsion)}
          ${slider('centro', 'Força do centro', 'Puxão suave para o meio.', 0, 1, 0.05, forces.center)}
          ${slider('estante', 'Força da estante', 'Ímã da estante. 0 desliga.', 0, 1, 0.05, forces.shelf)}
          <button type="button" class="alternar" id="grafo-setas" role="switch" aria-checked="${arrows ? 'true' : 'false'}">
            <span class="alternar__trilho" aria-hidden="true"></span>
            <span>Setas sempre visíveis</span>
          </button>
          <ul class="grafo__setas-legenda">
            <li><i class="grafo__amostra grafo__amostra--repouso"></i> em repouso, sem seta</li>
            <li><i class="grafo__amostra grafo__amostra--saida"></i> cita (saída)</li>
            <li><i class="grafo__amostra grafo__amostra--entrada"></i> é citada por (entrada)</li>
          </ul>
        </aside>
      </div>`;

    function slider(id, label, hint, min, max, step, value) {
      return `<label class="grafo-slider">
        <span class="grafo-slider__nome">${label}<small>${hint}</small></span>
        <span class="grafo-slider__valor" id="grafo-forca-${id}-valor">${formatForce(id, value)}</span>
        <input id="grafo-forca-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}" />
      </label>`;
    }

    const canvas = host.querySelector('#grafo-canvas');
    const mini = host.querySelector('#grafo-mini');
    const stage = host.querySelector('#grafo-palco');
    const ctx = canvas.getContext('2d');
    const miniCtx = mini.getContext('2d');
    const observer = new ResizeObserver(() => {
      measure();
      draw();
    });
    observer.observe(stage);

    function formatForce(id, value) {
      if (id === 'comprimento') return String(Math.round(value));
      return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    }

    function currentPrefs() {
      return {
        forces,
        arrows,
        mode,
        depth,
        center: centerPath,
        until,
        filters,
      };
    }

    function savePrefs() {
      writeStore(currentPrefs());
    }

    function motion() {
      reduced = Boolean(api.reduceMotion && api.reduceMotion());
      return reduced;
    }

    function readColors() {
      const styles = getComputedStyle(document.documentElement);
      const pick = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
      colors = {
        bg: pick('--bg', '#FAF9F7'),
        ink: pick('--ink', '#1E1C29'),
        ink3: pick('--ink-3', '#625F75'),
        accent: pick('--accent', '#4B52B0'),
        warning: pick('--warning', '#8A5A12'),
        line: pick('--line', '#E6E3DD'),
        surface: pick('--surface', '#FFFFFF'),
        font: pick('--font-ui', 'Inter, sans-serif'),
      };
    }

    function setEstado(kind, message) {
      host.dataset.estado = kind;
      host.dataset.modo = mode;
      host.dataset.foco = api.focusPath ? api.focusPath() || '' : centerPath || '';
      const box = host.querySelector('#grafo-estado');
      const show = kind !== 'pronto';
      box.hidden = !show;
      if (show) box.textContent = message || '';
    }

    function paintLegend() {
      const shelves = (api.shelves ? api.shelves() : []).filter((item) => item && item.name);
      host.querySelector('.grafo__legenda').innerHTML =
        shelves
          .map((shelf) => {
            const color = shelf.color ? `var(--shelf-${shelf.color})` : 'var(--ink-3)';
            return `<span class="chip"><span class="arvore__ponto" style="background:${color}"></span>${escapeHtml(shelf.name)}</span>`;
          })
          .join('') || '<span class="chip">Biblioteca</span>';
    }

    function paintShelves() {
      const known = new Map();
      for (const shelf of api.shelves ? api.shelves() : []) {
        if (shelf && shelf.name) known.set(shelf.name, shelf.color || '');
      }
      for (const node of raw.nodes || []) {
        if (node.workspace && !known.has(node.workspace)) known.set(node.workspace, '');
      }
      const rows = [{ name: '', label: 'Sem estante', color: '' }].concat(
        [...known.keys()]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'))
          .map((name) => ({
            name,
            label: name,
            color: known.get(name) || '',
          })),
      );
      const selected = filters.shelves;
      host.querySelector('#grafo-estantes').innerHTML = rows
        .map((row) => {
          const checked = !selected || selected.includes(row.name);
          const dot = row.color ? `var(--shelf-${row.color})` : 'var(--ink-3)';
          return `<label class="grafo-check"><input type="checkbox" value="${escapeHtml(row.name)}" ${checked ? 'checked' : ''} /><span class="grafo-check__ponto" style="background:${dot}"></span><span>${escapeHtml(row.label)}</span></label>`;
        })
        .join('');
      host.querySelectorAll('#grafo-estantes input').forEach((input) => {
        input.addEventListener('change', () => {
          const boxes = [...host.querySelectorAll('#grafo-estantes input')];
          filters = {
            ...filters,
            shelves: boxes.every((box) => box.checked)
              ? null
              : boxes.filter((box) => box.checked).map((box) => box.value),
          };
          savePrefs();
          rebuild(false);
        });
      });
    }

    function paintCenters() {
      const select = host.querySelector('#grafo-centro');
      const fromNotes = api.notes ? api.notes() : [];
      const items = new Map();
      for (const note of fromNotes) {
        if (note && note.path) items.set(note.path, note.title || api.baseName(note.path));
      }
      for (const node of raw.nodes || []) {
        if (node.kind === 'attachment') continue;
        if (!items.has(node.path)) items.set(node.path, node.title || api.baseName(node.path));
      }
      const rows = [...items.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
      select.innerHTML = rows
        .map(
          ([path, title]) =>
            `<option value="${escapeHtml(path)}" ${path === centerPath ? 'selected' : ''}>${escapeHtml(title)}</option>`,
        )
        .join('');
      if (!centerPath && rows.length) centerPath = rows[0][0];
      if (centerPath && items.has(centerPath)) select.value = centerPath;
    }

    function syncChrome() {
      host.querySelectorAll('input[name="grafo-alcance"]').forEach((input) => {
        input.checked = input.value === mode;
      });
      const depthBox = host.querySelector('#grafo-profundidade');
      const centerLabel = host.querySelector('#grafo-centro-rotulo');
      depthBox.hidden = mode !== 'local';
      centerLabel.hidden = mode !== 'local';
      host.querySelectorAll('input[name="grafo-profundidade"]').forEach((input) => {
        input.checked = Number(input.value) === depth;
      });
      const forcesOpen = !host.querySelector('#grafo-painel-forcas').hidden;
      const button = host.querySelector('#grafo-forcas-botao');
      button.setAttribute('aria-expanded', forcesOpen ? 'true' : 'false');
      button.setAttribute('aria-pressed', forcesOpen ? 'true' : 'false');
      host.dataset.modo = mode;
    }

    function updateCount() {
      const counts = view.counts || { notes: 0, links: 0 };
      const notes = counts.notes === 1 ? '1 nota' : `${counts.notes} notas`;
      const links = counts.links === 1 ? '1 link' : `${counts.links} links`;
      host.querySelector('#grafo-contagem').textContent = `${notes} · ${links}`;
      const frames = view.frames || [];
      host.querySelector('#grafo-quadros').textContent = (
        frames.length ? frames : model.timelineFrames([])
      )
        .map((frame) => `${frame.label} ${frame.count}`)
        .join(' · ');
    }

    function writeForceInputs() {
      const map = [
        ['mola', forces.spring],
        ['comprimento', forces.length],
        ['repulsao', forces.repulsion],
        ['centro', forces.center],
        ['estante', forces.shelf],
      ];
      for (const [id, value] of map) {
        const input = host.querySelector(`#grafo-forca-${id}`);
        const label = host.querySelector(`#grafo-forca-${id}-valor`);
        if (input) input.value = String(value);
        if (label) label.textContent = formatForce(id, value);
      }
      const toggle = host.querySelector('#grafo-setas');
      toggle.setAttribute('aria-checked', arrows ? 'true' : 'false');
    }

    function fadeValue(key, target, now) {
      let item = fades.get(key);
      if (!item) {
        item = { value: target, from: target, to: target, at: now };
        fades.set(key, item);
      }
      if (item.to !== target) {
        item.from = item.value;
        item.to = target;
        item.at = now;
      }
      item.value = model.mixOpacity(
        item.from,
        item.to,
        now - item.at,
        motion() ? 0 : model.FADE_MS,
      );
      return item.value;
    }

    function fadesSettled() {
      for (const item of fades.values()) {
        if (Math.abs(item.value - item.to) > 0.015) return false;
      }
      return true;
    }

    function focusPath() {
      return (api.focusPath && api.focusPath()) || '';
    }

    function colorOf(workspace) {
      if (api.colorFor) return api.colorFor(workspace) || colors.ink3;
      return workspace ? colors.accent : colors.ink3;
    }

    function measure() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function exportPositions() {
      const positions = {};
      if (!sim) return positions;
      for (const body of sim.bodies) {
        positions[body.path] = { x: body.x, y: body.y, pinned: body.pinned };
      }
      return positions;
    }

    function rememberPositions() {
      if (api.savePositions) api.savePositions(exportPositions());
    }

    function makeSim(previous) {
      const positions = {};
      if (previous) {
        for (const body of previous.bodies) {
          positions[body.path] = { x: body.x, y: body.y, pinned: body.pinned };
        }
      } else if (api.positions) {
        Object.assign(positions, api.positions() || {});
      }
      sim = model.createSimulation(view.nodes, view.edges, { forces, positions });
      model.reheatSimulation(sim, 1);
    }

    function rebuild(refit) {
      view = model.applyFilters(raw, { ...filters, until });
      const previous = sim;
      makeSim(previous);
      if (refit) {
        fitWhenSettled = true;
        userFramed = false;
      }
      updateCount();
      const total = (raw.nodes || []).length;
      if (!total) setEstado('vazio', 'Esta biblioteca ainda não tem notas.');
      else if (!view.nodes.length) setEstado('filtro', 'Nenhuma nota com este filtro.');
      else setEstado('pronto');
      if (motion()) {
        model.settleSimulation(sim, 280);
        if (width > 40) {
          camera = model.fitCamera(sim.bodies, width, height);
          fitWhenSettled = false;
        }
        draw();
      } else {
        wake();
      }
    }

    function localCenter() {
      if (centerPath) return centerPath;
      const focus = focusPath();
      if (focus) return focus;
      let best = null;
      let score = -1;
      for (const node of raw.nodes || []) {
        if (node.kind === 'attachment') continue;
        const degree = model.degreeOf(node);
        if (degree > score) {
          score = degree;
          best = node.path;
        }
      }
      return best || (raw.nodes[0] && raw.nodes[0].path) || '';
    }

    async function load() {
      const mine = ++token;
      setEstado('carregando', 'Carregando o grafo…');
      host.querySelector('#grafo-contagem').textContent = 'Carregando o grafo…';
      const input = {};
      if (mode === 'local') {
        centerPath = localCenter();
        if (!centerPath) {
          raw = { nodes: [], edges: [] };
          if (mine !== token || !alive) return;
          rebuild(true);
          setEstado('vazio', 'Abra uma nota para ver o grafo local.');
          return;
        }
        input.center = centerPath;
        input.depth = depth;
      }
      try {
        const graph = await api.query(input);
        if (!alive || mine !== token) return;
        raw = graph || { nodes: [], edges: [] };
        paintShelves();
        paintCenters();
        paintLegend();
        rebuild(true);
      } catch (error) {
        if (!alive || mine !== token) return;
        if (mode === 'local') {
          mode = 'global';
          syncChrome();
          savePrefs();
          if (api.toast) api.toast(error.message || 'Não foi possível ler o grafo local.');
          load();
          return;
        }
        setEstado('erro', error.message || 'Não foi possível ler o grafo.');
        if (api.toast) api.toast(error.message || 'Não foi possível ler o grafo.');
      }
    }

    function wake() {
      if (raf || !alive) return;
      raf = requestAnimationFrame(frame);
    }

    function frame(now) {
      raf = 0;
      if (!alive) return;
      if (sim && !sim.settled) {
        if (motion()) model.settleSimulation(sim, 40);
        else model.tickSimulation(sim);
      }
      if (sim && sim.settled && fitWhenSettled && !userFramed && width > 40 && sim.bodies.length) {
        camera = model.fitCamera(sim.bodies, width, height);
        fitWhenSettled = false;
      }
      draw(now);
      const moving = sim && !sim.settled && !motion();
      if (moving || pointer || !fadesSettled()) wake();
    }

    function roundRect(context, x, y, w, h, r) {
      if (context.roundRect) {
        context.roundRect(x, y, w, h, r);
        return;
      }
      context.rect(x, y, w, h);
    }

    function draw(now) {
      if (!width) measure();
      readColors();
      const time = now || performance.now();
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      if (!sim) {
        drawMini();
        return;
      }
      const bodies = sim.bodies;
      const byPath = new Map(bodies.map((body) => [body.path, body]));
      const highlight = model.highlightSet(hover, sim.edges);
      const focus = focusPath();
      host.dataset.foco = focus;
      for (const edge of sim.edges) {
        const from = byPath.get(edge.from);
        const to = byPath.get(edge.to);
        if (!from || !to) continue;
        const hot = !hover || edge.from === hover || edge.to === hover;
        const alpha = fadeValue(`${edge.from}\0${edge.to}`, hot ? 1 : model.FADE_EDGE, time);
        const a = model.project(from, camera, width, height);
        const b = model.project(to, camera, width, height);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const span = Math.hypot(dx, dy) || 1;
        const reverse = sim.edges.some((other) => other.from === edge.to && other.to === edge.from);
        const shift = reverse ? 3.5 : 0;
        const start = { x: a.x + (-dy / span) * shift, y: a.y + (dx / span) * shift };
        const end = { x: b.x + (-dy / span) * shift, y: b.y + (dx / span) * shift };
        const same =
          model.shelfKey(from.workspace) &&
          model.shelfKey(from.workspace) === model.shelfKey(to.workspace);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = same ? colorOf(from.workspace) : colors.accent;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1 + Math.min(edge.weight || 1, 6) * 0.35;
        const role = model.edgeRole(edge, hover);
        const showArrow = Boolean(arrows || role);
        if (showArrow) {
          drawArrow(start, end, model.nodeRadius(to) * camera.zoom, role === 'in');
        } else {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const body of bodies) {
        const hot = !hover || highlight.has(body.path);
        const alpha = fadeValue(body.path, hot ? 1 : model.FADE_NODE, time);
        const at = model.project(body, camera, width, height);
        const radius = Math.max(2, model.nodeRadius(body) * camera.zoom);
        if (at.x < -40 || at.y < -40 || at.x > width + 40 || at.y > height + 40) continue;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colorOf(body.workspace);
        ctx.beginPath();
        if (body.kind === 'canvas') {
          const side = radius * 1.7;
          roundRect(ctx, at.x - side, at.y - side, side * 2, side * 2, 3);
        } else if (body.kind === 'attachment') {
          ctx.moveTo(at.x, at.y - radius * 1.45);
          ctx.lineTo(at.x + radius * 1.25, at.y);
          ctx.lineTo(at.x, at.y + radius * 1.45);
          ctx.lineTo(at.x - radius * 1.25, at.y);
          ctx.closePath();
        } else {
          ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
        }
        ctx.fill();
        if (body.pinned) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = colors.ink;
          ctx.stroke();
        }
        if (body.path === focus) {
          ctx.globalAlpha = Math.max(alpha, 0.9);
          ctx.beginPath();
          ctx.lineWidth = 2;
          ctx.strokeStyle = colors.accent;
          ctx.arc(at.x, at.y, radius + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (body.broken > 0) {
          ctx.globalAlpha = Math.max(alpha, 0.85);
          ctx.fillStyle = colors.warning;
          ctx.beginPath();
          ctx.arc(
            at.x + radius * 0.72,
            at.y - radius * 0.72,
            Math.max(2.4, 3.1 * Math.min(camera.zoom, 1.4)),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
        const showLabel =
          bodies.length <= 48 ||
          body.path === focus ||
          (hover && highlight.has(body.path)) ||
          camera.zoom >= 1.05;
        if (showLabel) {
          ctx.save();
          ctx.globalAlpha = Math.max(alpha, hover && highlight.has(body.path) ? 1 : alpha);
          ctx.fillStyle = colors.ink;
          ctx.font = `500 12px ${colors.font}`;
          const title = body.title || body.path;
          ctx.fillText(
            title.length > 32 ? `${title.slice(0, 31)}…` : title,
            at.x + radius + 6,
            at.y + 4,
          );
          ctx.restore();
        }
      }
      placeHover(time);
      drawMini();
    }

    function drawArrow(from, to, radius, dashed) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const endX = to.x - ux * (radius + 3);
      const endY = to.y - uy * (radius + 3);
      ctx.beginPath();
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      const angle = Math.atan2(uy, ux);
      const size = 9;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - size * Math.cos(angle - 0.42), endY - size * Math.sin(angle - 0.42));
      ctx.lineTo(endX - size * Math.cos(angle + 0.42), endY - size * Math.sin(angle + 0.42));
      ctx.closePath();
      ctx.fill();
    }

    function bodyByPath(path) {
      return sim && sim.bodies.find((body) => body.path === path);
    }

    function placeHover() {
      const card = host.querySelector('#grafo-hover');
      const body = hover ? bodyByPath(hover) : null;
      if (!body) {
        card.hidden = true;
        return;
      }
      const at = model.project(body, camera, width, height);
      const radius = model.nodeRadius(body) * camera.zoom;
      const broken =
        body.broken > 0
          ? body.broken === 1
            ? '1 link quebrado'
            : `${body.broken} links quebrados`
          : '';
      const shelf = body.workspace || 'Sem estante';
      card.hidden = false;
      card.innerHTML = `<strong>${escapeHtml(body.title || body.path)}</strong><span>${escapeHtml(shelf)}</span><span>sai ${body.degreeOut} · entra ${body.degreeIn}</span>${broken ? `<span>${escapeHtml(broken)}</span>` : ''}<span>${body.pinned ? 'Fixo · duplo clique solta' : 'Duplo clique ou Alt fixa'}</span>`;
      const left = Math.min(width - 196, at.x + radius + 12);
      const top = Math.max(8, Math.min(height - 96, at.y - 16));
      card.style.left = `${Math.max(8, left)}px`;
      card.style.top = `${top}px`;
    }

    function drawMini() {
      const mw = mini.width;
      const mh = mini.height;
      miniCtx.setTransform(1, 0, 0, 1, 0, 0);
      miniCtx.clearRect(0, 0, mw, mh);
      miniCtx.fillStyle = colors.surface;
      miniCtx.fillRect(0, 0, mw, mh);
      const bodies = sim ? sim.bodies : [];
      if (!bodies.length) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const body of bodies) {
        if (body.x < minX) minX = body.x;
        if (body.y < minY) minY = body.y;
        if (body.x > maxX) maxX = body.x;
        if (body.y > maxY) maxY = body.y;
      }
      const pad = 16;
      minX -= pad;
      minY -= pad;
      maxX += pad;
      maxY += pad;
      const scale = Math.min(
        (mw - 8) / Math.max(1, maxX - minX),
        (mh - 8) / Math.max(1, maxY - minY),
      );
      const ox = (mw - (maxX - minX) * scale) / 2;
      const oy = (mh - (maxY - minY) * scale) / 2;
      const map = (x, y) => ({ x: ox + (x - minX) * scale, y: oy + (y - minY) * scale });
      for (const body of bodies) {
        const at = map(body.x, body.y);
        miniCtx.fillStyle = colorOf(body.workspace);
        miniCtx.fillRect(at.x - 1.4, at.y - 1.4, 2.8, 2.8);
      }
      const topLeft = model.unproject(0, 0, camera, width, height);
      const bottomRight = model.unproject(width, height, camera, width, height);
      const a = map(topLeft.x, topLeft.y);
      const b = map(bottomRight.x, bottomRight.y);
      miniCtx.strokeStyle = colors.accent;
      miniCtx.lineWidth = 1.5;
      miniCtx.strokeRect(
        Math.min(a.x, b.x),
        Math.min(a.y, b.y),
        Math.abs(b.x - a.x),
        Math.abs(b.y - a.y),
      );
      mini._map = { minX, minY, scale, ox, oy };
    }

    function zoomAt(sx, sy, factor) {
      const before = model.unproject(sx, sy, camera, width, height);
      camera.zoom = clampZoom(camera.zoom * factor);
      camera.x = (sx - width / 2) / camera.zoom - before.x;
      camera.y = (sy - height / 2) / camera.zoom - before.y;
      userFramed = true;
      draw();
    }

    function clampZoom(value) {
      return Math.min(2.8, Math.max(0.18, value));
    }

    function zoomBy(factor) {
      zoomAt(width / 2, height / 2, factor);
    }

    function fit() {
      if (!sim) return;
      camera = model.fitCamera(sim.bodies, width, height);
      userFramed = true;
      fitWhenSettled = false;
      draw();
    }

    function localPoint(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function hit(event) {
      if (!sim) return null;
      const point = localPoint(event);
      return model.hitTest(sim.bodies, point.x, point.y, camera, width, height);
    }

    function togglePin(path) {
      const body = bodyByPath(path);
      if (!body) return;
      body.pinned = !body.pinned;
      body.fx = body.pinned ? body.x : null;
      body.fy = body.pinned ? body.y : null;
      rememberPositions();
      model.reheatSimulation(sim, 0.35);
      wake();
      draw();
    }

    function openNode(path) {
      centerPath = path;
      savePrefs();
      if (api.openPath) api.openPath(path);
    }

    function onPointerDown(event) {
      if (event.button !== 0 || !sim) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = 0;
      }
      const point = localPoint(event);
      const found = model.hitTest(sim.bodies, point.x, point.y, camera, width, height);
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        ox: event.clientX,
        oy: event.clientY,
        moved: false,
        path: found ? found.path : null,
        alt: event.altKey,
      };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        /* o ponteiro já soltou */
      }
    }

    function onPointerMove(event) {
      if (!pointer || event.pointerId !== pointer.id) {
        if (pointer) return;
        const found = hit(event);
        const next = found ? found.path : null;
        if (next !== hover) {
          hover = next;
          canvas.style.cursor = next ? 'pointer' : 'grab';
          wake();
        }
        return;
      }
      const dx = event.clientX - pointer.ox;
      const dy = event.clientY - pointer.oy;
      if (!pointer.moved && Math.hypot(dx, dy) >= DRAG_PX) pointer.moved = true;
      if (!pointer.moved) return;
      const stepX = event.clientX - pointer.x;
      const stepY = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (pointer.path) {
        const body = bodyByPath(pointer.path);
        const point = localPoint(event);
        const world = model.unproject(point.x, point.y, camera, width, height);
        if (body) {
          body.fx = world.x;
          body.fy = world.y;
          body.x = world.x;
          body.y = world.y;
          body.vx = 0;
          body.vy = 0;
        }
        canvas.style.cursor = 'grabbing';
        model.reheatSimulation(sim, 0.55);
        if (motion()) model.tickSimulation(sim);
        wake();
      } else {
        camera.x += stepX / camera.zoom;
        camera.y += stepY / camera.zoom;
        userFramed = true;
        canvas.style.cursor = 'grabbing';
        draw();
      }
    }

    function onPointerUp(event) {
      if (!pointer || (pointer.id != null && event.pointerId !== pointer.id)) return;
      const info = pointer;
      pointer = null;
      canvas.style.cursor = hover ? 'pointer' : 'grab';
      if (info.moved) {
        const body = info.path ? bodyByPath(info.path) : null;
        if (body && !body.pinned) {
          body.fx = null;
          body.fy = null;
        }
        rememberPositions();
        model.reheatSimulation(sim, 0.4);
        wake();
        return;
      }
      if (!info.path) return;
      if (info.alt) {
        togglePin(info.path);
        lastClickUp = 0;
        return;
      }
      const now = performance.now();
      if (now - lastClickUp < 400) {
        lastClickUp = 0;
        togglePin(info.path);
        return;
      }
      lastClickUp = now;
      const path = info.path;
      clickTimer = setTimeout(() => {
        clickTimer = 0;
        lastClickUp = 0;
        if (!alive) return;
        openNode(path);
      }, CLICK_MS);
    }

    function onMiniPointer(event) {
      if (!mini._map || !sim) return;
      const rect = mini.getBoundingClientRect();
      const sx = ((event.clientX - rect.left) / rect.width) * mini.width;
      const sy = ((event.clientY - rect.top) / rect.height) * mini.height;
      const map = mini._map;
      const worldX = (sx - map.ox) / map.scale + map.minX;
      const worldY = (sy - map.oy) / map.scale + map.minY;
      camera.x = -worldX;
      camera.y = -worldY;
      userFramed = true;
      draw();
    }

    host.querySelectorAll('input[name="grafo-alcance"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        mode = input.value === 'local' ? 'local' : 'global';
        if (mode === 'local' && !centerPath) centerPath = focusPath() || localCenter();
        syncChrome();
        savePrefs();
        load();
      });
    });
    host.querySelectorAll('input[name="grafo-profundidade"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        depth = Number(input.value);
        savePrefs();
        if (mode === 'local') load();
      });
    });
    host.querySelector('#grafo-centro').addEventListener('change', (event) => {
      centerPath = event.target.value;
      savePrefs();
      if (mode === 'local') load();
    });
    host.querySelector('#grafo-tempo').addEventListener('input', (event) => {
      until = Number(event.target.value) / 100;
      savePrefs();
      rebuild(false);
    });
    host.querySelector('#grafo-tag').addEventListener('input', (event) => {
      filters = { ...filters, tag: event.target.value.trim() };
      savePrefs();
      rebuild(false);
    });
    host.querySelector('#grafo-orfas').addEventListener('change', (event) => {
      filters = { ...filters, hideOrphans: event.target.checked };
      savePrefs();
      rebuild(false);
    });
    host.querySelector('#grafo-mostrar-canvas').addEventListener('change', (event) => {
      filters = { ...filters, showCanvas: event.target.checked };
      savePrefs();
      rebuild(false);
    });
    host.querySelector('#grafo-anexos').addEventListener('change', (event) => {
      filters = { ...filters, showAttachments: event.target.checked };
      savePrefs();
      rebuild(false);
    });
    host.querySelector('#grafo-filtros').addEventListener('click', () => {
      const panel = host.querySelector('#grafo-painel-filtros');
      panel.hidden = !panel.hidden;
      host
        .querySelector('#grafo-filtros')
        .setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    });
    host.querySelector('#grafo-fechar-filtros').addEventListener('click', () => {
      host.querySelector('#grafo-painel-filtros').hidden = true;
      host.querySelector('#grafo-filtros').setAttribute('aria-expanded', 'false');
    });
    host.querySelector('#grafo-forcas-botao').addEventListener('click', () => {
      const panel = host.querySelector('#grafo-painel-forcas');
      panel.hidden = !panel.hidden;
      syncChrome();
      measure();
      draw();
    });
    host.querySelector('#grafo-restaurar').addEventListener('click', () => {
      forces = { ...model.DEFAULT_FORCES };
      if (sim) sim.forces = { ...forces };
      writeForceInputs();
      savePrefs();
      model.reheatSimulation(sim, 0.7);
      if (motion()) {
        model.settleSimulation(sim, 200);
        draw();
      } else wake();
    });
    ['mola', 'comprimento', 'repulsao', 'centro', 'estante'].forEach((id) => {
      const input = host.querySelector(`#grafo-forca-${id}`);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        const key = {
          mola: 'spring',
          comprimento: 'length',
          repulsao: 'repulsion',
          centro: 'center',
          estante: 'shelf',
        }[id];
        forces = { ...forces, [key]: value };
        if (sim) sim.forces = model.normalizeForces(forces);
        host.querySelector(`#grafo-forca-${id}-valor`).textContent = formatForce(id, value);
        savePrefs();
        model.reheatSimulation(sim, 0.55);
        if (motion()) {
          model.tickSimulation(sim);
          draw();
        } else wake();
      });
    });
    host.querySelector('#grafo-setas').addEventListener('click', () => {
      arrows = !arrows;
      host.querySelector('#grafo-setas').setAttribute('aria-checked', arrows ? 'true' : 'false');
      savePrefs();
      draw();
    });
    host.querySelector('#grafo-mais').addEventListener('click', () => zoomBy(1.18));
    host.querySelector('#grafo-menos').addEventListener('click', () => zoomBy(1 / 1.18));
    host.querySelector('#grafo-ajustar').addEventListener('click', () => fit());
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (pointer) return;
      if (hover) {
        hover = null;
        canvas.style.cursor = 'grab';
        wake();
      }
    });
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const point = localPoint(event);
        zoomAt(point.x, point.y, event.deltaY > 0 ? 1 / 1.08 : 1.08);
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', (event) => {
      event.preventDefault();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = 0;
      }
    });
    canvas.addEventListener('keydown', (event) => {
      if (event.key === '+' || event.key === '=') zoomBy(1.12);
      else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.12);
      else if (event.key === '0') fit();
    });
    let miniDrag = false;
    mini.addEventListener('pointerdown', (event) => {
      miniDrag = true;
      mini.setPointerCapture(event.pointerId);
      onMiniPointer(event);
    });
    mini.addEventListener('pointermove', (event) => {
      if (miniDrag) onMiniPointer(event);
    });
    mini.addEventListener('pointerup', () => {
      miniDrag = false;
    });
    host.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        host.querySelector('#grafo-painel-filtros').hidden = true;
        host.querySelector('#grafo-filtros').setAttribute('aria-expanded', 'false');
      }
    });

    const pub = {
      screenPosition(path) {
        const body = bodyByPath(path);
        if (!body) return null;
        const rect = canvas.getBoundingClientRect();
        const at = model.project(body, camera, width, height);
        return { x: rect.left + at.x, y: rect.top + at.y };
      },
      worldPosition(path) {
        const body = bodyByPath(path);
        return body ? { x: body.x, y: body.y } : null;
      },
      opacity(path) {
        const item = fades.get(path);
        return item ? item.value : 1;
      },
      edgeOpacity(from, to) {
        const item = fades.get(`${from}\0${to}`);
        return item ? item.value : 1;
      },
      counts() {
        return { ...(view.counts || { notes: 0, links: 0 }) };
      },
      forces() {
        return { ...forces };
      },
      settled() {
        return Boolean(sim && sim.settled);
      },
      kind(path) {
        const body = bodyByPath(path);
        return body ? body.kind : null;
      },
      broken(path) {
        const body = bodyByPath(path);
        return body ? body.broken : 0;
      },
      focus() {
        return focusPath();
      },
    };
    Object.defineProperty(host, '_grafo', { value: pub, configurable: true });

    paintLegend();
    syncChrome();
    writeForceInputs();
    measure();
    load();

    return {
      destroy() {
        alive = false;
        token += 1;
        if (raf) cancelAnimationFrame(raf);
        if (clickTimer) clearTimeout(clickTimer);
        observer.disconnect();
        rememberPositions();
      },
      reload() {
        load();
      },
    };
  }

  return { mount, GRAPH_ICON, PREF_KEY };
});
