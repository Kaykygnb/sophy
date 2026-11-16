'use strict';
window.explorer = (() => {
  let mountedCanvasTab = null;
  let fileResizeObserver = null,
    chromeDock = null,
    libraryDock = null;
  let area = null,
    tree = [],
    expanded = new Set(),
    selected = '',
    active = null,
    tabs = [],
    host = null,
    iframe = null,
    ready = false,
    timer = null,
    running = false,
    queue = Promise.resolve(),
    pollBusy = false,
    filter = '',
    treeSignature = '',
    tabsSignature = '',
    conflictSignature = '',
    catalog = [],
    attachmentPaths = [],
    catalogIcons = new Map(),
    catalogSignature = '',
    pendingJump = null;
  const $e = (s) => host?.querySelector(s);
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) {
      const symbol = { '▤': 'file', '▧': 'image', '↗': 'external', '▾': 'down', '▸': 'right' }[
        text
      ];
      if (symbol) e.append(SophyIcons.icon(symbol));
      else e.textContent = text;
    }
    return e;
  };
  const btn = (text, title, action, cls = '') => {
    const b = node('button', cls);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.onclick = action;
    const iconOnly = {
      '←': 'back',
      '↻': 'refresh',
      '×': 'close',
      Renomear: 'edit',
      Mover: 'move',
      Lixeira: 'trash',
    };
    const symbol = iconOnly[text];
    if (symbol) b.append(SophyIcons.icon(symbol));
    else if (text.startsWith('＋ ')) {
      b.append(SophyIcons.icon('plus'), document.createTextNode(text.slice(2)));
    } else if (text.startsWith('⌂ ')) {
      b.append(SophyIcons.icon('folder'), document.createTextNode(text.slice(2)));
    } else b.textContent = text;
    return b;
  };
  const base = (p) => p.split('/').pop();
  const parent = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const isMd = (p) => /\.md$/i.test(p);
  const isCanvas = (p) => /\.canvas$/i.test(p);
  const isImage = (p) => /\.(png|jpe?g|webp|gif)$/i.test(p);
  const isAttachmentPath = (p) => p === 'Anexos' || p.startsWith('Anexos/');
  const displayName = (p) =>
    isMd(p) && !isAttachmentPath(p)
      ? base(p).replace(/\.md$/i, '')
      : isCanvas(p)
        ? base(p).replace(/\.canvas$/i, '')
        : base(p);
  function collectAttachments(items, out = []) {
    for (const item of items)
      if (item.kind === 'directory') collectAttachments(item.children || [], out);
      else if (item.path.startsWith('Anexos/')) out.push(item.path);
    return out;
  }
  function call(method, ...args) {
    const run = async () => {
      const res = await window.notas[method](...args);
      if (!res.ok) {
        const error = Error(res.error);
        error.code = res.code;
        throw error;
      }
      return res.value;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }
  function fail(e) {
    notify(e.message || String(e), true);
  }
  function badge(tab) {
    return tab.conflict
      ? 'Conflito'
      : tab.error
        ? 'Erro ao salvar'
        : tab.dirty
          ? 'Salvando…'
          : tab.kind === 'canvas'
            ? 'Canvas salvo'
            : 'Salvo localmente';
  }
  function status(tab) {
    if (active === tab) {
      $e('.note-save-status').textContent = badge(tab);
      $e('.note-save-status').dataset.state = tab.conflict
        ? 'conflict'
        : tab.error
          ? 'error'
          : tab.dirty
            ? 'saving'
            : 'saved';
      if (iframe?.contentWindow)
        iframe.contentWindow.postMessage(
          { type: 'note:status', session: tab.session, text: badge(tab), dirty: tab.dirty },
          '*',
        );
      renderConflict();
    }
    renderTabs();
  }
  function dirty() {
    return tabs.some((t) => t.dirty);
  }
  async function saveTab(tab) {
    clearTimeout(tab.saveTimer);
    if (!tab.dirty) return true;
    if (tab.conflict) return false;
    if (tab.saving) {
      await tab.saving;
      return saveTab(tab);
    }
    if (tab.kind === 'canvas') {
      if (active === tab && window.SophyCanvas?.active)
        tab.data = window.SophyCanvas.active.getData();
      const payload = tab.data;
      tab.saving = (async () => {
        try {
          const result = await call('writeCanvas', area.id, tab.path, payload, tab.revision);
          if (result.conflict) {
            tab.conflict = result.current;
            tab.error = null;
            status(tab);
            return false;
          }
          tab.revision = result.revision;
          tab.diskContent = result.content;
          tab.dirty = tab.data !== payload;
          if (!tab.dirty) {
            tab.data = result.data;
            tab.content = result.content;
          }
          tab.error = null;
          if (active === tab && !tab.dirty) window.SophyCanvas?.active?.markSaved?.();
          status(tab);
          return true;
        } catch (e) {
          tab.error = e.message;
          status(tab);
          fail(e);
          return false;
        }
      })();
      const canvasResult = await tab.saving;
      tab.saving = null;
      if (canvasResult && tab.dirty) return saveTab(tab);
      return canvasResult;
    }
    const content = tab.content;
    tab.saving = (async () => {
      try {
        const result = await call('writeNote', area.id, tab.path, content, tab.revision);
        if (result.conflict) {
          tab.conflict = result.current;
          tab.error = null;
          status(tab);
          return false;
        }
        tab.revision = result.revision;
        tab.diskContent = content;
        tab.dirty = tab.content !== content;
        tab.error = null;
        status(tab);
        return true;
      } catch (e) {
        tab.error = e.message;
        status(tab);
        fail(e);
        return false;
      }
    })();
    const result = await tab.saving;
    tab.saving = null;
    if (result && tab.dirty) return saveTab(tab);
    return result;
  }
  async function leave() {
    for (const tab of tabs)
      if (!(await saveTab(tab))) {
        notify(
          'Há alterações não salvas. Resolva o conflito ou o erro antes de sair da estante.',
          true,
        );
        return false;
      }
    await queue;
    dispose();
    return true;
  }
  function restoreChrome() {
    if (chromeDock) document.querySelector('.app-header')?.append(chromeDock);
    if (libraryDock) {
      libraryDock.className = 'header-action';
      libraryDock.textContent = 'Bibliotecas';
      document.querySelector('.app-brand')?.after(libraryDock);
    }
    chromeDock = libraryDock = null;
  }
  function dispose() {
    restoreChrome();
    fileResizeObserver?.disconnect();
    fileResizeObserver = null;
    running = false;
    clearInterval(timer);
    timer = null;
    window.SophyCanvas?.unmount?.();
    mountedCanvasTab = null;
    for (const t of tabs) clearTimeout(t.saveTimer);
    tabs = [];
    active = null;
    iframe = null;
    ready = false;
    host = null;
    document.body.classList.remove('in-area', 'focus-mode', 'area-nav-expanded');
  }
  function directories(list = tree, out = ['']) {
    for (const item of list)
      if (item.kind === 'directory') {
        out.push(item.path);
        directories(item.children, out);
      }
    return out;
  }
  function findItem(p, list = tree) {
    for (const item of list) {
      if (item.path === p) return item;
      const found = item.children && findItem(p, item.children);
      if (found) return found;
    }
    return null;
  }
  function destination() {
    const item = findItem(selected);
    if (item?.path === 'Anexos') return '';
    return item?.kind === 'directory' ? item.path : parent(selected);
  }
  function expandParents(p) {
    let dir = parent(p);
    while (dir) {
      expanded.add(dir);
      dir = parent(dir);
    }
  }
  async function reloadTree() {
    if (!area || !running) return;
    const result = await call('tree', area.id);
    if (!running) return;
    const signature = JSON.stringify(result);
    if (signature !== treeSignature) {
      tree = result;
      attachmentPaths = collectAttachments(tree);
      treeSignature = signature;
      renderTree();
      await refreshCatalog();
    }
  }
  function renderTree() {
    let root = $e('.file-tree');
    const workRoot = root;
    const annexRoot = $e('.attachment-tree');
    annexRoot?.replaceChildren();
    if (!root) return;
    root.replaceChildren();
    let shown = 0;
    const matches = (item) =>
      item.name.toLocaleLowerCase().includes(filter) || item.children?.some(matches);
    function draw(list, depth = 0) {
      for (const item of list) {
        if (filter && !matches(item)) continue;
        shown++;
        const row = node(
          'div',
          'file-row' +
            (selected === item.path ? ' selected' : '') +
            (active?.path === item.path ? ' current-file' : ''),
        );
        row.style.paddingLeft = 8 + depth * 18 + 'px';
        row.style.setProperty('--depth', depth);
        row.setAttribute('aria-selected', String(selected === item.path));
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-level', depth + 1);
        row.tabIndex = 0;
        row.dataset.path = item.path;
        row.title = item.path;
        const directory = item.kind === 'directory',
          open = expanded.has(item.path) || !!filter,
          attachment = !directory && isAttachmentPath(item.path);
        if (directory) row.setAttribute('aria-expanded', open);
        row.classList.toggle('is-directory', directory);
        const disclosure = node('span', 'file-disclosure');
        if (directory)
          disclosure.append(SophyIcons.icon(open ? 'folderOpenControl' : 'folderClosedControl'));
        const icon = node('span', 'file-icon');
        const pageIcon =
          !directory && isMd(item.path) && !attachment ? catalogIcons.get(item.path) || '' : '';
        if (pageIcon.startsWith('custom:')) {
          const asset = (window.sophyCustomIcons || []).find(
            (entry) => entry.id === pageIcon.slice(7),
          )?.src;
          if (asset) {
            const image = node('img');
            image.src = asset;
            image.alt = '';
            icon.append(image);
          } else icon.append(SophyIcons.icon('file'));
        } else if (pageIcon) {
          icon.textContent = pageIcon;
          icon.classList.add('file-page-emoji');
        } else
          icon.append(
            SophyIcons.icon(
              directory
                ? 'folder'
                : isCanvas(item.path)
                  ? 'grid'
                  : isMd(item.path) && !attachment
                    ? 'file'
                    : isImage(item.path)
                      ? 'image'
                      : 'external',
            ),
          );
        row.append(
          disclosure,
          icon,
          node('span', 'file-name', directory ? item.name : displayName(item.path)),
        );
        if (directory) row.append(node('span', 'folder-count', String(item.children.length)));
        const more = btn(
          '⋯',
          `Ações de ${item.name}`,
          (event) => {
            event.stopPropagation();
            selected = item.path;
            const bounds = more.getBoundingClientRect();
            renderTree();
            contextMenu(item, bounds.right, bounds.bottom);
          },
          'file-more',
        );
        row.append(more);
        row.onclick = () => {
          selected = item.path;
          if (directory) {
            open ? expanded.delete(item.path) : expanded.add(item.path);
            renderTree();
          } else openItem(item.path);
        };
        row.onkeydown = (e) => {
          if (e.target !== row) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            row.click();
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const all = [...root.querySelectorAll('[role=treeitem]')],
              i = all.indexOf(row);
            all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
          }
          if (e.key === 'F2') {
            e.preventDefault();
            selected = item.path;
            renameItem();
          }
          if (e.key === 'Delete') {
            e.preventDefault();
            selected = item.path;
            trashItem();
          }
        };
        row.oncontextmenu = (e) => {
          e.preventDefault();
          selected = item.path;
          renderTree();
          contextMenu(item, e.clientX, e.clientY);
        };
        row.draggable = true;
        row.ondragstart = (e) => e.dataTransfer.setData('application/x-notas1-path', item.path);
        if (directory) {
          row.ondragover = (e) => {
            if (e.dataTransfer.types.includes('application/x-notas1-path')) {
              e.preventDefault();
              row.classList.add('drop-target');
            }
          };
          row.ondragleave = () => row.classList.remove('drop-target');
          row.ondrop = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            row.classList.remove('drop-target');
            const from = e.dataTransfer.getData('application/x-notas1-path');
            if (from) await performMove(from, item.path + '/' + base(from));
          };
        }
        root.append(row);
        if (directory && open) draw(item.children, depth + 1);
      }
    }
    draw(tree.filter((item) => item.path !== 'Anexos'));
    const attachments = tree.find((item) => item.path === 'Anexos');
    $e('.attachments-section')?.classList.toggle(
      'has-attachments',
      !!attachments?.children?.length,
    );
    const workShown = shown;
    if (annexRoot) {
      root = annexRoot;
      draw(tree.filter((item) => item.path === 'Anexos'));
      if (!annexRoot.childElementCount)
        annexRoot.append(
          node(
            'p',
            'tree-empty',
            filter ? 'Nenhum anexo encontrado.' : 'Imagens, PDFs e outros materiais.',
          ),
        );
      root = workRoot;
    }
    if (!workShown)
      root.append(
        node(
          'p',
          'tree-empty',
          filter ? 'Nenhum arquivo encontrado.' : 'Sua estante está vazia. Crie a primeira nota.',
        ),
      );
    const selection = $e('.file-selection');
    selection.textContent = selected || 'Nenhum item selecionado';
    selection.title = selected || '';
    $e('.file-bottom-actions')
      .querySelectorAll('button:not(.library-switcher)')
      .forEach((button) => {
        button.disabled = !selected;
      });
    const count = (items) =>
      items.reduce(
        (total, item) => total + (item.kind === 'directory' ? count(item.children) : 1),
        0,
      );
    const total = count(tree.filter((item) => item.path !== 'Anexos'));
    $e('.files-total').textContent = `${total} ${total === 1 ? 'arquivo' : 'arquivos'}`;
  }
  function contextMenu(item, x, y) {
    document.querySelector('.file-context')?.remove();
    const menu = node('div', 'file-context');
    menu.style.left = Math.min(x, innerWidth - 190) + 'px';
    menu.style.top = Math.min(y, innerHeight - 230) + 'px';
    const actions =
      item.path === 'Anexos'
        ? [['Adicionar arquivos…', addAttachments]]
        : [
            ['Nova nota aqui', () => newItem('file')],
            ['Nova pasta aqui', () => newItem('directory')],
            ['Renomear', renameItem],
            ['Mover para…', moveModal],
            ['Mover para a lixeira', trashItem],
          ];
    for (const [text, fn] of actions)
      menu.append(
        btn(text, text, () => {
          menu.remove();
          fn();
        }),
      );
    document.body.append(menu);
    setTimeout(
      () =>
        document.addEventListener(
          'pointerdown',
          (e) => {
            if (!menu.contains(e.target)) menu.remove();
          },
          { once: true },
        ),
      0,
    );
  }
  async function addAttachments() {
    const source = active?.view === 'source' ? $e('.markdown-source') : null,
      selectionStart = source?.selectionStart ?? 0,
      selectionEnd = source?.selectionEnd ?? 0;
    try {
      const added = await call('importAttachments', area.id);
      if (!added?.length) return;
      expanded.add('Anexos');
      await reloadTree();
      const insertItems = added.map((item) => ({
        path: item.path,
        name: item.name,
        embed: isImage(item.path),
      }));
      let inserted = false;
      if (active && source?.isConnected) {
        const text = insertItems
          .map((item) => (item.embed ? `![[${item.path}]]` : `[[${item.path}]]`))
          .join('\n');
        source.setRangeText(text, selectionStart, selectionEnd, 'end');
        changed(active, source.value);
        inserted = true;
      } else if (active && ready && iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          { type: 'note:insert-attachments', session: active.session, items: insertItems },
          '*',
        );
        inserted = true;
      }
      notify(
        `${added.length} ${added.length === 1 ? 'arquivo adicionado' : 'arquivos adicionados'} em Anexos${inserted && source?.isConnected ? ' e vinculado' + (added.length === 1 ? '' : 's') + ' à nota' : ''}.`,
      );
    } catch (error) {
      fail(error);
    }
  }
  function newItem(kind) {
    let input;
    let templateId = 'blank';
    const dir = destination();
    modal(
      kind === 'file' ? 'Nova nota' : 'Nova pasta',
      `Criar em: ${dir || 'raiz da estante'}.`,
      'Criar',
      async () => {
        try {
          const content = kind === 'file' ? window.SophyTemplates?.render(templateId) || '' : '';
          const result = await call('createFile', area.id, dir, input.value.trim(), kind, content);
          selected = result.path;
          expandParents(result.path);
          await reloadTree();
          if (kind === 'file') await openItem(result.path);
          return true;
        } catch (e) {
          fail(e);
          throw e;
        }
      },
    );
    input = field(
      kind === 'file' ? 'Nome da nota' : 'Nome da pasta',
      '',
      kind === 'file' ? 'Sem título' : 'Nova pasta',
    );
    if (kind === 'file' && window.SophyTemplates?.list) {
      const host = $('#modalFields');
      const label = node('label', '', 'Modelo');
      const select = document.createElement('select');
      select.id = 'noteTemplate';
      for (const template of window.SophyTemplates.list) {
        const option = document.createElement('option');
        option.value = template.id;
        option.textContent = `${template.name} — ${template.description}`;
        select.append(option);
      }
      select.onchange = () => {
        templateId = select.value;
      };
      label.htmlFor = select.id;
      host.append(label, select);
    }
  }
  async function openOrCreate(relative, content = '') {
    let exists = false;
    try {
      await call('readNote', area.id, relative);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      await call('createLinkedNote', area.id, relative);
      if (content) {
        const created = await call('readNote', area.id, relative);
        await call('writeNote', area.id, relative, content, created.revision);
      }
    }
    selected = relative;
    expandParents(relative);
    await reloadTree();
    await openItem(relative);
  }
  async function openDailyNote() {
    const stamp = window.SophyTemplates?.todayStamp() || new Date().toISOString().slice(0, 10);
    const relative = `Diário/${stamp}.md`;
    await openOrCreate(relative, window.SophyTemplates?.render('daily') || '');
    notify('Diário do dia aberto.');
  }
  async function openInboxNote() {
    await openOrCreate(
      'Caixa de entrada.md',
      window.SophyTemplates?.render('inbox') || '# Caixa de entrada\n\n- \n',
    );
    notify('Caixa de entrada aberta.');
  }
  async function showGraph() {
    const dialog = document.getElementById('graphDialog');
    const canvas = document.getElementById('graphCanvas');
    const meta = document.getElementById('graphMeta');
    if (!dialog || !canvas) return;
    canvas.replaceChildren(node('p', 'graph-empty', 'Carregando as conexões…'));
    meta.textContent = '';
    document.getElementById('graphTitle').textContent = 'Conexões · ' + area.name;
    if (!dialog.open) dialog.showModal();
    try {
      const graph = await call('noteGraph', area.id);
      if (!dialog.open) return;
      canvas.replaceChildren();
      if (!graph.notes.length) {
        canvas.append(
          node(
            'p',
            'graph-empty',
            'Ainda não há notas nesta estante. Crie uma nota no editor e use [[nome da nota]] para conectar suas ideias.',
          ),
        );
        meta.textContent = '0 notas · 0 conexões';
        return;
      }
      const width = 720,
        height = 420;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('class', 'graph-svg');
      const cx = width / 2,
        cy = height / 2,
        radius = Math.min(width, height) * 0.36;
      const positions = new Map();
      graph.notes.forEach((note, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(graph.notes.length, 1) - Math.PI / 2;
        positions.set(note.path, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          ...note,
        });
      });
      for (const edge of graph.edges) {
        const from = positions.get(edge.from),
          to = positions.get(edge.to);
        if (!from || !to) continue;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', from.x);
        line.setAttribute('y1', from.y);
        line.setAttribute('x2', to.x);
        line.setAttribute('y2', to.y);
        line.setAttribute('class', 'graph-edge');
        line.dataset.from = edge.from;
        line.dataset.to = edge.to;
        svg.append(line);
      }
      for (const note of positions.values()) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'graph-node');
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        group.setAttribute('aria-label', 'Abrir nota ' + note.title);
        group.dataset.path = note.path;
        group.dataset.title = note.title.toLocaleLowerCase('pt-BR');
        group.style.cursor = 'pointer';
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', note.x);
        circle.setAttribute('cy', note.y);
        circle.setAttribute('r', active?.path === note.path ? 10 : 7);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', note.x);
        label.setAttribute('y', note.y + 22);
        label.setAttribute('text-anchor', 'middle');
        label.textContent = note.title.slice(0, 28);
        group.append(circle, label);
        group.onclick = async () => {
          dialog.close();
          await openItem(note.path);
        };
        group.onkeydown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            group.onclick();
          }
        };
        svg.append(group);
      }
      canvas.append(svg);
      const search = document.getElementById('graphSearch');
      const labels = document.getElementById('graphLabels');
      const isolated = document.getElementById('graphIsolated');
      const connected = new Set(graph.edges.flatMap((edge) => [edge.from, edge.to]));
      const filterGraph = () => {
        const query = search.value.trim().toLocaleLowerCase('pt-BR');
        for (const group of svg.querySelectorAll('.graph-node')) {
          const visible = isolated.checked || connected.has(group.dataset.path);
          group.style.display = visible ? '' : 'none';
          const match = !query || group.dataset.title.includes(query);
          group.classList.toggle('is-dimmed', !match);
          group.querySelector('text').style.display = labels.checked ? '' : 'none';
        }
        for (const line of svg.querySelectorAll('.graph-edge')) {
          const from = positions.get(line.dataset.from),
            to = positions.get(line.dataset.to);
          line.classList.toggle(
            'is-dimmed',
            !!query &&
              ![from, to].some((note) => note.title.toLocaleLowerCase('pt-BR').includes(query)),
          );
        }
      };
      search.oninput = labels.onchange = filterGraph;
      let zoom = 1;
      let framing = { x: width / 2, y: height / 2, width, height };
      const setZoom = (value) => {
        zoom = Math.max(0.5, Math.min(3, value));
        const w = framing.width / zoom,
          h = framing.height / zoom;
        svg.setAttribute('viewBox', `${framing.x - w / 2} ${framing.y - h / 2} ${w} ${h}`);
      };
      const fitGraph = () => {
        const visible = [...positions.values()].filter(
          (note) => isolated.checked || connected.has(note.path),
        );
        if (visible.length) {
          const xs = visible.map((note) => note.x),
            ys = visible.map((note) => note.y);
          const left = Math.min(...xs),
            right = Math.max(...xs),
            top = Math.min(...ys),
            bottom = Math.max(...ys);
          const scale = Math.max((right - left + 200) / width, (bottom - top + 140) / height, 0.6);
          framing = {
            x: (left + right) / 2,
            y: (top + bottom) / 2 + 10,
            width: width * scale,
            height: height * scale,
          };
        }
        setZoom(1);
      };
      isolated.onchange = () => {
        filterGraph();
        fitGraph();
      };
      document.getElementById('graphZoomIn').onclick = () => setZoom(zoom * 1.2);
      document.getElementById('graphZoomOut').onclick = () => setZoom(zoom / 1.2);
      document.getElementById('graphFit').onclick = fitGraph;
      filterGraph();
      fitGraph();
      meta.textContent = `${graph.notes.length} notas · ${graph.edges.length} conexões${
        graph.truncated ? ' · mapa truncado' : ''
      }`;
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      canvas.replaceChildren(
        node(
          'p',
          'graph-empty',
          'Não foi possível ler as conexões. Verifique se a biblioteca está acessível. Suas notas não foram alteradas.',
        ),
        btn('Tentar novamente', 'Tentar ler as conexões novamente', showGraph, 'button secondary'),
      );
      meta.textContent = 'Índice indisponível';
    }
  }
  function renameItem() {
    const item = findItem(selected);
    if (!item) {
      notify('Selecione um arquivo ou pasta.');
      return;
    }
    let input;
    modal('Renomear item', 'O nome será alterado no disco.', 'Renomear', async () => {
      let name = input.value.trim();
      if (!name || /[\\/]/.test(name) || name.startsWith('.') || /[. ]$/.test(name))
        throw Error('Informe um nome válido.');
      if (isMd(item.path) && !isAttachmentPath(item.path))
        name = name.replace(/\.md$/i, '') + '.md';
      if (isCanvas(item.path)) name = name.replace(/\.canvas$/i, '') + '.canvas';
      const target = parent(item.path) ? parent(item.path) + '/' + name : name;
      await performMove(item.path, target, true);
      return true;
    });
    input = field('Nome', isMd(item.path) ? displayName(item.path) : item.name);
  }
  function moveModal() {
    const item = findItem(selected);
    if (!item) {
      notify('Selecione um item para mover.');
      return;
    }
    let select;
    modal('Mover item', `Escolha uma pasta de destino para ${item.name}.`, 'Mover', async () => {
      await performMove(item.path, (select.value ? select.value + '/' : '') + item.name, true);
      return true;
    });
    const label = node('label', '', 'Pasta de destino');
    label.htmlFor = 'moveDestination';
    select = node('select');
    select.id = 'moveDestination';
    for (const dir of directories().filter(
      (dir) => dir !== item.path && !dir.startsWith(item.path + '/'),
    )) {
      const o = node('option', '', dir || 'Raiz da estante');
      o.value = dir;
      select.append(o);
    }
    select.value = parent(item.path);
    $('#modalFields').append(label, select);
  }
  async function performMove(from, to, rethrow = false) {
    try {
      for (const tab of tabs)
        if (!(await saveTab(tab)))
          throw Error('Salve ou resolva o conflito da nota antes de mover.');
      const result = await call('moveFile', area.id, from, to);
      for (const tab of tabs)
        if (tab.path === from || tab.path.startsWith(from + '/'))
          tab.path = to + tab.path.slice(from.length);
      for (const doc of result.updated || []) {
        const tab = tabs.find((t) => t.path === doc.path);
        if (tab)
          Object.assign(tab, doc, {
            diskContent: doc.content,
            dirty: false,
            session: crypto.randomUUID(),
          });
      }
      if (result.warnings?.length)
        notify(
          `Item movido. Não foi possível atualizar links em ${result.warnings.length} notas; os arquivos externos foram preservados.`,
          true,
        );
      selected = to;
      expandParents(to);
      await reloadTree();
      renderTabs();
      if (active) showActive();
    } catch (e) {
      fail(e);
      if (rethrow) throw e;
    }
  }
  async function trashItem() {
    if (!selected) {
      notify('Selecione um arquivo ou pasta.');
      return;
    }
    const target = selected;
    try {
      const affected = tabs.filter((t) => t.path === target || t.path.startsWith(target + '/'));
      for (const t of affected)
        if (!(await saveTab(t))) throw Error('Resolva as alterações não salvas antes de excluir.');
      if (!(await call('trashFile', area.id, target))) return;
      tabs = tabs.filter((t) => !affected.includes(t));
      if (affected.includes(active)) {
        active = tabs.at(-1) || null;
        showActive();
      }
      selected = '';
      await reloadTree();
      renderTabs();
      notify('Item enviado à lixeira.');
    } catch (e) {
      fail(e);
    }
  }
  async function openItem(p) {
    selected = p;
    renderTree();
    if (isCanvas(p)) {
      try {
        let tab = tabs.find((t) => t.path === p);
        if (!tab) {
          const doc = await call('readCanvas', area.id, p);
          tab = {
            kind: 'canvas',
            path: doc.path,
            data: doc.data,
            content: doc.content,
            revision: doc.revision,
            diskContent: doc.content,
            dirty: false,
            conflict: null,
            error: null,
          };
          tabs.push(tab);
        }
        active = tab;
        showActive();
        renderTree();
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (!isMd(p) || isAttachmentPath(p)) {
      await previewFile(p);
      return;
    }
    try {
      let tab = tabs.find((t) => t.path === p);
      if (!tab) {
        const doc = await call('readNote', area.id, p);
        tab = {
          ...doc,
          kind: 'note',
          diskContent: doc.content,
          dirty: false,
          session: crypto.randomUUID(),
          conflict: null,
          error: null,
        };
        tabs.push(tab);
      }
      active = tab;
      showActive();
      renderTree();
    } catch (e) {
      fail(e);
    }
  }
  function renderTabs() {
    const list = $e('.note-tabs');
    if (!list) return;
    const signature = JSON.stringify(tabs.map((t) => [t.path, t.dirty, t === active]));
    if (signature === tabsSignature) return;
    tabsSignature = signature;
    list.replaceChildren();
    for (const tab of tabs) {
      const wrapper = node('div', 'note-tab' + (tab === active ? ' active' : ''));
      const open = btn((tab.dirty ? '• ' : '') + displayName(tab.path), tab.path, () => {
        active = tab;
        selected = tab.path;
        showActive();
        renderTree();
      });
      const close = btn('×', 'Fechar ' + base(tab.path), async () => {
        if (!(await saveTab(tab))) {
          notify('Resolva as alterações não salvas antes de fechar.', true);
          return;
        }
        tabs = tabs.filter((t) => t !== tab);
        if (active === tab) {
          active = tabs.at(-1) || null;
          showActive();
        }
        renderTabs();
        renderTree();
      });
      wrapper.append(open, close);
      list.append(wrapper);
    }
  }
  function editorCatalog() {
    return {
      notes: catalog.map(({ path, title, headings, links }) => ({ path, title, headings, links })),
      assets: attachmentPaths.map((path) => ({ path, title: base(path), image: isImage(path) })),
    };
  }
  function syncFrameAppearance(frame) {
    frame.contentWindow.postMessage(
      {
        type: 'note:theme',
        theme: window.sophyTheme || 'light',
        accent: window.sophyAccentColor || '#4B6284',
      },
      '*',
    );
    frame.contentWindow.postMessage(
      { type: 'note:icons', icons: window.sophyCustomIcons || [] },
      '*',
    );
    frame.contentWindow.postMessage(
      { type: 'note:reading', preferences: readingPreferences() },
      '*',
    );
  }
  function loadFrame(tab = active) {
    if (tab?.frameReady && tab.kind !== 'canvas') {
      tab.frameContent = tab.content;
      tab.frameSession = tab.session;
      tab.frame.contentWindow.postMessage(
        {
          type: 'note:load',
          session: tab.session,
          content: tab.content,
          title: base(tab.path).replace(/\.md$/i, ''),
          path: tab.path,
          location: area.name + (parent(tab.path) ? ' / ' + parent(tab.path) : ''),
          viewState: tab.viewState,
          ...editorCatalog(),
        },
        '*',
      );
    }
  }
  function pickNoteForCanvas() {
    return new Promise((resolve) => {
      const notes = catalog.filter((note) => isMd(note.path));
      if (!notes.length) {
        notify('Crie uma nota Markdown antes de anexá-la ao canvas.', true);
        resolve(null);
        return;
      }
      let select;
      modal(
        'Adicionar nota ao canvas',
        'Escolha uma nota desta estante para criar um cartão.',
        'Adicionar',
        async () => {
          resolve(select.value || null);
          return true;
        },
      );
      const label = node('label', '', 'Nota');
      select = node('select');
      select.id = 'canvasNotePick';
      for (const note of notes) {
        const option = node('option', '', note.path);
        option.value = note.path;
        select.append(option);
      }
      label.htmlFor = select.id;
      $('#modalFields').append(label, select);
      const cancel = () => resolve(null);
      $('#cancelModal').addEventListener('click', cancel, { once: true });
      $('#closeModal').addEventListener('click', cancel, { once: true });
    });
  }
  function newCanvas() {
    let input;
    const dir = destination();
    modal(
      'Novo canvas',
      `Organize notas e ideias em um quadro. Ele ficará em ${dir || 'sua estante atual'}.`,
      'Criar canvas',
      async () => {
        try {
          const stem = input.value.trim().replace(/\.canvas$/i, '');
          if (!stem) throw Error('Informe um nome para o canvas.');
          const result = await call(
            'createFile',
            area.id,
            dir,
            stem + '.canvas',
            'file',
            JSON.stringify({ nodes: [], edges: [] }, null, 2),
          );
          selected = result.path;
          expandParents(result.path);
          await reloadTree();
          await openItem(result.path);
          return true;
        } catch (e) {
          fail(e);
          throw e;
        }
      },
    );
    input = field('Nome do canvas', '', 'Mapa, Ideias, Projeto…');
  }
  function prepareStage() {
    const stage = $e('.note-stage');
    if (!stage) return null;
    if (mountedCanvasTab && window.SophyCanvas?.active)
      mountedCanvasTab.canvasView = window.SophyCanvas.active.getView();
    mountedCanvasTab = null;
    window.SophyCanvas?.unmount?.();
    for (const child of [...stage.children]) {
      if (child.classList.contains('block-editor') && tabs.some((tab) => tab.frame === child))
        child.hidden = true;
      else child.remove();
    }
    iframe = null;
    ready = false;
    return stage;
  }
  function showActive() {
    renderTabs();
    renderBacklinks();
    const stage = prepareStage();
    if (!stage) return;
    $e('.file-location').textContent = active?.path || area.name;
    $e('.note-save-status').textContent = active ? badge(active) : 'Arquivos locais';
    $e('.source-toggle').hidden = !active || active.kind === 'canvas';
    $e('.note-word-count').hidden = !active || active.kind === 'canvas';
    $e('.workspace-topbar').classList.toggle('has-document', !!active);
    const backlinks = $e('.note-backlinks');
    if (backlinks) backlinks.hidden = active?.kind === 'canvas';
    if (!active) {
      const empty = node('div', 'note-empty');
      empty.append(
        node('div', 'empty-symbol', '▤'),
        node('h2', '', 'Um espaço para suas ideias'),
        node('p', '', 'Escolha uma nota à esquerda ou comece uma nova.'),
        btn('＋ Nova nota', 'Criar nova nota', () => newItem('file'), 'button primary'),
        btn('＋ Novo canvas', 'Criar canvas', () => newCanvas(), 'button secondary'),
      );
      stage.append(empty);
      renderConflict();
      return;
    }
    if (active.kind === 'canvas') {
      const canvasTab = active;
      mountedCanvasTab = canvasTab;
      const surface = node('div', 'note-surface');
      stage.append(surface);
      window.SophyCanvas.mount(surface, {
        data: active.data,
        view: active.canvasView,
        onChange: (data) => {
          canvasTab.data = data;
          canvasTab.content = JSON.stringify(data);
          canvasTab.dirty = canvasTab.content !== canvasTab.diskContent;
          canvasTab.error = null;
          status(canvasTab);
          clearTimeout(canvasTab.saveTimer);
          if (!canvasTab.conflict) canvasTab.saveTimer = setTimeout(() => saveTab(canvasTab), 650);
        },
        onOpenFile: (file) => openItem(file),
        onRequestNotes: () => pickNoteForCanvas(),
      });
      renderConflict();
      return;
    }
    if (active.view === 'source') {
      const source = node('textarea', 'markdown-source');
      source.setAttribute('aria-label', 'Código Markdown');
      source.spellcheck = true;
      source.value = active.content;
      source.oninput = () => changed(active, source.value);
      source.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          const ref = NoteLinks.scan(source.value).find(
            (r) => r.start <= source.selectionStart && r.end >= source.selectionStart,
          );
          if (ref) {
            e.preventDefault();
            openLink(ref.target, ref.format);
            return;
          }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          saveTab(active);
        }
      };
      stage.append(source);
      SophyIcons.decorateButton($e('.source-toggle'), 'edit', 'Editor visual');
    } else {
      const cached =
        active.frame?.isConnected &&
        active.frameContent === active.content &&
        active.frameSession === active.session;
      if (cached) {
        iframe = active.frame;
        iframe.hidden = false;
        ready = active.frameReady;
        syncFrameAppearance(iframe);
        iframe.contentWindow.postMessage(
          {
            type: 'note:resume',
            session: active.session,
            viewState: active.viewState,
            ...editorCatalog(),
          },
          '*',
        );
        iframe.contentWindow.postMessage(
          {
            type: 'note:focus',
            session: active.session,
            enabled: document.body.classList.contains('focus-mode'),
          },
          '*',
        );
        status(active);
      } else {
        active.frame?.remove();
        iframe = node('iframe', 'block-editor');
        active.frame = iframe;
        active.frameContent = active.content;
        active.frameSession = active.session;
        active.frameReady = false;
        iframe.src = 'editor/index.html';
        iframe.title = 'Editor visual da nota';
        iframe.setAttribute(
          'sandbox',
          'allow-scripts allow-same-origin allow-downloads allow-forms',
        );
        stage.append(iframe);
      }
      SophyIcons.decorateButton($e('.source-toggle'), 'code', 'Markdown');
    }
    renderConflict();
  }
  function changed(tab, content) {
    if (!tab || tab.content === content) return;
    tab.content = content;
    tab.dirty = tab.content !== tab.diskContent;
    tab.error = null;
    clearTimeout(tab.saveTimer);
    status(tab);
    renderBacklinks();
    if (!tab.conflict) tab.saveTimer = setTimeout(() => saveTab(tab), 650);
  }
  function renderConflict() {
    const panel = $e('.note-conflict');
    if (!panel) return;
    const signature = JSON.stringify([
      active?.path,
      active?.conflict?.revision,
      active?.conflict?.missing,
      active?.error,
      !!active?.conflict,
    ]);
    if (signature === conflictSignature) return;
    conflictSignature = signature;
    panel.replaceChildren();
    panel.hidden = !active?.conflict && !active?.error;
    if (active?.conflict) {
      panel.append(
        node(
          'span',
          '',
          'Este arquivo mudou fora do Sophy. Suas alterações locais foram preservadas. Escolha qual versão manter.',
        ),
        btn('Usar versão do disco', 'Descartar a edição local e usar a versão do disco', () =>
          discardConflict(),
        ),
        btn('Manter minha versão', 'Sobrescrever o arquivo do disco com a edição local', () =>
          keepMine(),
        ),
        btn('Salvar minha versão como cópia', 'Salvar cópia da edição local', () => saveCopy()),
      );
    } else if (active?.error)
      panel.append(
        node('span', '', active.error),
        btn('Tentar salvar', 'Tentar salvar novamente', () => saveTab(active)),
        btn('Salvar cópia', 'Salvar cópia da edição local', () => saveCopy()),
      );
  }
  function discardConflict() {
    const tab = active;
    modal(
      'Usar a versão do disco?',
      'Sua edição local será descartada. Você pode cancelar e salvar uma cópia antes.',
      'Usar versão do disco',
      async () => {
        if (tab.kind === 'canvas') {
          const latest = await call('readCanvas', area.id, tab.path);
          Object.assign(tab, {
            data: latest.data,
            content: latest.content,
            revision: latest.revision,
            diskContent: latest.content,
            dirty: false,
            conflict: null,
            error: null,
          });
        } else {
          const latest = await call('readNote', area.id, tab.path);
          Object.assign(tab, latest, {
            diskContent: latest.content,
            dirty: false,
            conflict: null,
            error: null,
            session: crypto.randomUUID(),
          });
        }
        showActive();
        return true;
      },
    );
  }
  function keepMine() {
    const tab = active;
    modal(
      'Sobrescrever a versão do disco?',
      'A edição local substituirá o arquivo atual no disco. A versão externa será perdida.',
      'Manter minha versão',
      async () => {
        if (tab.kind === 'canvas') {
          if (window.SophyCanvas?.active) tab.data = window.SophyCanvas.active.getData();
          const latest = await call('readCanvas', area.id, tab.path);
          const saved = await call('writeCanvas', area.id, tab.path, tab.data, latest.revision);
          if (saved.conflict) {
            tab.conflict = saved.current;
            renderConflict();
            throw Error('O arquivo mudou de novo. Revise o conflito antes de sobrescrever.');
          }
          Object.assign(tab, {
            data: saved.data,
            content: saved.content,
            revision: saved.revision,
            diskContent: saved.content,
            dirty: false,
            conflict: null,
            error: null,
          });
        } else {
          const latest = await call('readNote', area.id, tab.path);
          const saved = await call('writeNote', area.id, tab.path, tab.content, latest.revision);
          if (saved.conflict) {
            tab.conflict = saved.current;
            renderConflict();
            throw Error('O arquivo mudou de novo. Revise o conflito antes de sobrescrever.');
          }
          Object.assign(tab, saved, {
            diskContent: saved.content,
            dirty: false,
            conflict: null,
            error: null,
          });
        }
        status(tab);
        renderConflict();
        if (tab.kind === 'canvas') showActive();
        notify('Sua versão local foi salva no disco.');
        return true;
      },
      true,
    );
  }
  async function saveCopy() {
    const tab = active;
    try {
      if (tab.kind === 'canvas') {
        if (window.SophyCanvas?.active) tab.data = window.SophyCanvas.active.getData();
        const name =
          base(tab.path).replace(/\.canvas$/i, '') + ' (cópia ' + Date.now() + ').canvas';
        const result = await call(
          'createFile',
          area.id,
          parent(tab.path),
          name,
          'file',
          JSON.stringify(tab.data, null, 2),
        );
        tab.dirty = false;
        tabs = tabs.filter((t) => t !== tab);
        await reloadTree();
        await openItem(result.path);
        notify('Sua edição foi salva em um novo canvas. O arquivo original foi preservado.');
        return;
      }
      const name = base(tab.path).replace(/\.md$/i, '') + ' (cópia ' + Date.now() + ').md';
      const result = await call('createFile', area.id, parent(tab.path), name, 'file', tab.content);
      tab.dirty = false;
      tabs = tabs.filter((t) => t !== tab);
      await reloadTree();
      await openItem(result.path);
      notify('Sua edição foi salva em uma nova nota. O arquivo original foi preservado.');
    } catch (e) {
      fail(e);
    }
  }
  async function previewFile(p) {
    try {
      const stage = prepareStage();
      active = null;
      renderTabs();
      $e('.source-toggle').hidden = true;
      $e('.file-location').textContent = p;
      $e('.note-save-status').textContent = 'Arquivo local';
      renderConflict();
      const preview = node('div', 'attachment-preview');
      if (isImage(p)) {
        const image = node('img');
        image.src = await call('image', area.id, p);
        image.alt = base(p);
        preview.append(image);
      }
      preview.append(
        node('h2', '', base(p)),
        node('p', '', 'Este anexo permanece na pasta da estante.'),
        btn(
          'Abrir no aplicativo padrão',
          'Abrir anexo no aplicativo padrão',
          async () => {
            try {
              await call('openExternalFile', area.id, p);
            } catch (e) {
              fail(e);
            }
          },
          'button secondary',
        ),
      );
      stage.append(preview);
    } catch (e) {
      fail(e);
    }
  }
  async function poll() {
    if (pollBusy || !running || pending || $('#modal').open) return;
    pollBusy = true;
    try {
      await reloadTree();
      for (const tab of [...tabs]) {
        if (tab.saving) continue;
        try {
          const disk =
            tab.kind === 'canvas'
              ? await call('readCanvas', area.id, tab.path)
              : await call('readNote', area.id, tab.path);
          if (!running) return;
          if (disk.revision === tab.revision) continue;
          if (tab.dirty) {
            tab.conflict = disk;
            status(tab);
          } else if (tab.kind === 'canvas') {
            Object.assign(tab, {
              data: disk.data,
              content: disk.content,
              revision: disk.revision,
              diskContent: disk.content,
              dirty: false,
              conflict: null,
              error: null,
            });
            if (active === tab) showActive();
          } else {
            Object.assign(tab, disk, { diskContent: disk.content, session: crypto.randomUUID() });
            if (active === tab) showActive();
          }
        } catch (e) {
          tab.error = 'O arquivo não está disponível. Sua edição local foi preservada.';
          if (tab.dirty) status(tab);
          else {
            tab.conflict = { missing: true };
            tab.dirty = true;
            status(tab);
          }
        }
      }
      if (active) status(active);
    } catch (e) {
      $e('.note-save-status') && ($e('.note-save-status').textContent = 'Estante indisponível');
    } finally {
      pollBusy = false;
    }
  }
  async function refreshCatalog() {
    const data = await call('linkIndex', area.id);
    if (!running) return;
    catalog = data.notes;
    const signature = JSON.stringify([
      catalog.map((note) => [note.path, note.modifiedAt, note.size]),
      attachmentPaths,
    ]);
    if (signature === catalogSignature) return;
    catalogSignature = signature;
    catalogIcons = new Map(catalog.map((note) => [note.path, note.icon || '']));
    renderTree();
    renderBacklinks();
    if (ready && iframe)
      iframe.contentWindow.postMessage({ type: 'note:catalog', ...editorCatalog() }, '*');
    if (data.skipped.length)
      notify(
        `Índice de links parcial: ${data.skipped.length} notas não puderam ser indexadas.`,
        true,
      );
  }
  function renderBacklinks() {
    const panel = $e('.note-backlinks');
    if (!panel) return;
    panel.hidden = !active;
    if (!active) return;
    const paths = catalog.map((n) => n.path),
      references = [];
    for (const note of catalog) {
      if (note.path === active.path) continue;
      const tab = tabs.find((t) => t.path === note.path);
      const links = tab ? NoteLinks.scan(tab.content) : note.links;
      const count = links.filter(
        (ref) => NoteLinks.resolve(ref.target, note.path, paths, ref.format).path === active.path,
      ).length;
      if (count) references.push({ path: note.path, count });
    }
    const list = panel.querySelector('.backlink-list'),
      signature = JSON.stringify([active.path, references]);
    if (list.dataset.signature === signature) return;
    list.dataset.signature = signature;
    list.replaceChildren();
    const referenceSummary = panel.querySelector('summary');
    referenceSummary.textContent = `Referências (${references.length})`;
    referenceSummary.setAttribute('aria-label', `Referências a esta nota (${references.length})`);
    referenceSummary.title = 'Notas que mencionam esta nota';
    if (!references.length)
      list.append(
        node(
          'p',
          '',
          'Nenhuma nota aponta para esta ainda. Use [[Nome da nota]] para criar uma conexão.',
        ),
      );
    for (const ref of references) {
      const b = btn(
        NoteLinks.basename(ref.path),
        `Abrir referência em ${ref.path}`,
        () => openItem(ref.path),
        'backlink-item',
      );
      b.append(node('small', '', ref.path), node('span', 'backlink-count', String(ref.count)));
      list.append(b);
    }
  }
  async function openLink(target, format = 'wiki') {
    if (typeof target !== 'string' || !active) return;
    const source = active.path;
    try {
      if (!catalog.length) await refreshCatalog();
      const resolution = NoteLinks.resolve(
        target,
        source,
        catalog.map((n) => n.path),
        format,
        attachmentPaths,
      );
      if (resolution.invalid) {
        notify('Esse link aponta para fora da estante ou tem um caminho inválido.', true);
        return;
      }
      if (resolution.path) {
        if (resolution.kind === 'attachment') {
          await openItem(resolution.path);
          return;
        }
        await navigateLink(resolution.path, resolution.anchor);
        return;
      }
      if (resolution.candidates.length > 1) {
        modal(
          resolution.kind === 'attachment'
            ? 'Qual anexo você quer abrir?'
            : 'Qual nota você quer abrir?',
          resolution.kind === 'attachment'
            ? 'Há anexos com o mesmo nome. Escolha o caminho desejado.'
            : 'Há notas com o mesmo nome. Escolha o caminho desejado.',
          'Cancelar',
          async () => {
            $('#modal').close();
            return false;
          },
        );
        $('#submitModal').hidden = true;
        for (const p of resolution.candidates) {
          const b = btn(
            p,
            'Abrir ' + p,
            async () => {
              $('#submitModal').hidden = false;
              $('#modal').close();
              if (resolution.kind === 'attachment') await openItem(p);
              else await navigateLink(p, resolution.anchor);
            },
            'link-choice',
          );
          $('#modalFields').append(b);
        }
        $('#modal').addEventListener('close', () => ($('#submitModal').hidden = false), {
          once: true,
        });
        return;
      }
      if (resolution.kind === 'attachment') {
        notify(`Anexo não encontrado: ${NoteLinks.label(target)}.`, true);
        return;
      }
      const destination = NoteLinks.createPath(target, source, format);
      if (!destination) {
        notify('Informe um nome de nota válido para criar este destino.', true);
        return;
      }
      modal(
        'Criar a nota vinculada?',
        `A nota ainda não existe. Criar ${destination} dentro desta estante? As subpastas necessárias também serão criadas.`,
        'Criar e abrir',
        async () => {
          await call('createLinkedNote', area.id, destination);
          await reloadTree();
          expandParents(destination);
          await navigateLink(destination, resolution.anchor);
          return true;
        },
      );
    } catch (e) {
      fail(e);
    }
  }
  async function previewLink(message) {
    const owner = active,
      frame = iframe;
    if (!owner || !frame || typeof message.target !== 'string') return;
    const respond = (data) => {
      if (active === owner && iframe === frame)
        frame.contentWindow.postMessage(
          {
            type: 'note:preview-result',
            session: owner.session,
            requestId: message.requestId,
            ...data,
          },
          '*',
        );
    };
    try {
      if (!catalog.length) await refreshCatalog();
      const result = NoteLinks.resolve(
        message.target,
        owner.path,
        catalog.map((n) => n.path),
        message.format,
        attachmentPaths,
      );
      if (result.invalid) {
        respond({ message: 'O destino está fora da estante ou tem um caminho inválido.' });
        return;
      }
      if (result.kind === 'attachment') {
        if (!result.path) {
          respond({
            title: NoteLinks.label(message.target),
            missing: !result.candidates.length,
            attachment: true,
            message: result.candidates.length
              ? 'Há anexos com o mesmo nome. Abra o link para escolher o arquivo.'
              : 'Este anexo não está na pasta Anexos desta estante.',
          });
          return;
        }
        if (isImage(result.path)) {
          const image = await call('image', area.id, result.path);
          respond({ title: base(result.path), path: result.path, attachment: true, image });
        } else {
          respond({
            title: base(result.path),
            path: result.path,
            attachment: true,
            message: 'Anexo pronto para abrir no aplicativo associado do sistema.',
          });
        }
        return;
      }
      if (!result.path) {
        respond({
          title: NoteLinks.label(message.target),
          missing: !result.candidates.length,
          message: result.candidates.length
            ? 'Há mais de uma nota com este nome. Abra o link para escolher o caminho.'
            : 'Esta nota ainda não existe. Você pode criá-la ao abrir o link.',
        });
        return;
      }
      const tab = tabs.find((t) => t.path === result.path),
        document = tab || (await call('readNote', area.id, result.path));
      respond({
        title: NoteLinks.basename(result.path),
        path: result.path,
        anchor: result.anchor,
        content: document.content,
      });
    } catch (e) {
      respond({ message: 'Não foi possível ler esta nota: ' + e.message });
    }
  }
  async function requestAsset(message) {
    if (
      !active ||
      !iframe ||
      message.session !== active.session ||
      typeof message.target !== 'string'
    )
      return;
    const owner = active,
      frame = iframe;
    try {
      const result = NoteLinks.resolve(
        message.target,
        owner.path,
        catalog.map((n) => n.path),
        'embed',
        attachmentPaths,
      );
      if (!result.path || result.kind !== 'attachment' || !isImage(result.path)) return;
      const data = await call('image', area.id, result.path);
      if (active === owner && iframe === frame)
        frame.contentWindow.postMessage(
          { type: 'note:asset', session: owner.session, target: message.target, data },
          '*',
        );
    } catch (error) {
      console.warn('Não foi possível carregar a imagem incorporada:', error.message);
    }
  }
  async function navigateLink(path, anchor) {
    expandParents(path);
    if (active?.path === path && ready && iframe) {
      if (anchor)
        iframe.contentWindow.postMessage(
          { type: 'note:jump', session: active.session, anchor },
          '*',
        );
      return;
    }
    pendingJump = anchor ? { path, anchor } : null;
    await openItem(path);
  }
  function setupFileResize(sidebar) {
    const handle = node('div', 'file-resize-handle');
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Largura da árvore de arquivos');
    handle.setAttribute('aria-valuemin', '180');
    handle.setAttribute('aria-valuemax', '360');
    let width;
    try {
      width = Number(localStorage.getItem('sophy.ui.filesWidth')) || 260;
    } catch {
      width = 260;
    }
    const set = (value) => {
      const rail =
        host.querySelector('.area-shell:not(.nav-compact)') && innerWidth > 1050 ? 210 : 56;
      const maxWidth = Math.min(360, Math.max(180, host.clientWidth - rail - 340));
      width = Math.max(180, Math.min(maxWidth, value));
      handle.setAttribute('aria-valuemax', String(Math.round(maxWidth)));
      host.style.setProperty('--files-width', width + 'px');
      handle.setAttribute('aria-valuenow', String(Math.round(width)));
    };
    const persist = () => {
      try {
        localStorage.setItem('sophy.ui.filesWidth', String(Math.round(width)));
      } catch {}
    };
    set(width);
    fileResizeObserver = new ResizeObserver(() => set(width));
    fileResizeObserver.observe(host);
    handle.onkeydown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {
        e.preventDefault();
        set(e.key === 'Home' ? 260 : width + (e.key === 'ArrowRight' ? 16 : -16));
        persist();
      }
    };
    handle.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = e.clientX,
        initial = width;
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing-tree');
      handle.onpointermove = (ev) => set(initial + ev.clientX - start);
      const end = () => {
        handle.onpointermove = null;
        document.body.classList.remove('resizing-tree');
        persist();
      };
      handle.onpointerup = end;
      handle.onpointercancel = end;
    };
    sidebar.append(handle);
  }
  function mount(target, workspace) {
    dispose();
    host = target;
    area = workspace;
    running = true;
    tree = [];
    treeSignature = '';
    tabsSignature = '';
    conflictSignature = '';
    catalog = [];
    attachmentPaths = [];
    catalogIcons = new Map();
    catalogSignature = '';
    pendingJump = null;
    expanded = new Set();
    selected = '';
    filter = '';
    document.body.classList.add('in-area');
    host.classList.add('explorer-host');
    const shell = node('div', 'area-shell'),
      sidebar = node('section', 'area-files');
    const heading = node('div', 'files-heading');
    const returnToShelves = btn(
      '←',
      'Voltar às estantes',
      async () => {
        if (await leave()) {
          current = null;
          refresh();
        }
      },
      'icon-button',
    );
    heading.append(node('div', 'files-identity'), returnToShelves);
    const identity = heading.querySelector('.files-identity');
    identity.append(node('span', 'files-eyebrow', 'Arquivos'), node('strong', '', area.name));
    sidebar.append(heading);
    const tools = node('div', 'file-tools');
    tools.append(
      btn('＋ Nota', 'Nova nota', () => newItem('file')),
      btn('＋ Canvas', 'Novo canvas (quadro infinito)', () => newCanvas()),
      btn('＋ Pasta', 'Nova pasta', () => newItem('directory')),
      btn('Diário', 'Abrir ou criar o diário de hoje', () => openDailyNote().catch(fail)),
      btn('Inbox', 'Abrir caixa de entrada', () => openInboxNote().catch(fail)),
      btn('Mapa', 'Ver mapa de links da estante', () => showGraph().catch(fail)),
      btn('↻', 'Atualizar arquivos', () => reloadTree().catch(fail)),
    );
    sidebar.append(tools);
    const search = node('input', 'file-search');
    search.placeholder = 'Buscar arquivos…';
    search.type = 'search';
    search.setAttribute('aria-label', 'Buscar arquivos pelo nome');
    search.oninput = () => {
      filter = search.value.trim().toLocaleLowerCase();
      renderTree();
    };
    const searchBox = node('div', 'file-search-box');
    searchBox.append(SophyIcons.icon('search'), search);
    const refreshButton = tools.lastElementChild;
    refreshButton.className = 'icon-button';
    searchBox.append(refreshButton);
    ['filePlus', 'grid', 'folderPlus', 'calendar', 'inbox', 'graph'].forEach((icon, index) => {
      const control = tools.children[index];
      control.className = 'icon-button';
      SophyIcons.set(control, icon);
    });
    sidebar.insertBefore(searchBox, tools);
    const rootLabel = btn(
      'Arquivos',
      'Selecionar a raiz da estante',
      () => {
        selected = '';
        renderTree();
      },
      'tree-root',
    );
    rootLabel.ondragover = (e) => {
      if (e.dataTransfer.types.includes('application/x-notas1-path')) e.preventDefault();
    };
    rootLabel.ondrop = (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData('application/x-notas1-path');
      if (from) performMove(from, base(from));
    };
    const treeHeading = node('div', 'tree-heading');
    const collapse = btn(
      'Recolher',
      'Recolher todas as pastas',
      () => {
        expanded.clear();
        filter = '';
        search.value = '';
        renderTree();
      },
      'collapse-folders',
    );
    SophyIcons.set(collapse, 'chevrons');
    const expand = btn(
      '',
      'Expandir todas as pastas',
      () => {
        expanded = new Set(directories().filter(Boolean));
        filter = '';
        search.value = '';
        renderTree();
      },
      'icon-button expand-folders',
    );
    expand.append(SophyIcons.icon('down'));
    treeHeading.append(rootLabel, node('span', 'files-total'), expand, collapse);
    sidebar.append(treeHeading);
    const fileTree = node('div', 'file-tree');
    fileTree.setAttribute('role', 'tree');
    fileTree.setAttribute('aria-label', 'Arquivos da estante');
    sidebar.append(fileTree);
    const annex = node('section', 'attachments-section');
    const annexHeading = node('div', 'attachments-heading');
    const addAnnex = btn('', 'Adicionar anexos', addAttachments, 'icon-button');
    addAnnex.append(SophyIcons.icon('plus'));
    annexHeading.append(node('span', '', 'ANEXOS'), addAnnex);
    const annexTree = node('div', 'attachment-tree');
    annexTree.setAttribute('role', 'tree');
    annexTree.setAttribute('aria-label', 'Materiais anexos');
    annex.append(annexHeading, annexTree);
    sidebar.append(annex);
    const footer = node('div', 'file-bottom-actions');
    footer.append(node('span', 'file-selection', 'Raiz da estante'));
    libraryDock = document.getElementById('worldNav');
    libraryDock.className = 'library-switcher';
    const libraryCopy = node('span', 'library-switcher-copy');
    libraryCopy.append(
      node('small', '', 'Biblioteca atual'),
      node('strong', '', world?.name || 'Bibliotecas'),
    );
    libraryDock.replaceChildren(SophyIcons.icon('library'), libraryCopy, SophyIcons.icon('down'));
    footer.append(libraryDock);
    sidebar.append(footer);
    setupFileResize(sidebar);
    const editor = node('section', 'area-editor');
    const topbar = node('div', 'workspace-topbar');
    const filesToggle = btn(
      '',
      'Ocultar arquivos',
      () => {
        const hidden = shell.classList.toggle('files-hidden');
        filesToggle.setAttribute('aria-label', hidden ? 'Mostrar arquivos' : 'Ocultar arquivos');
        filesToggle.setAttribute('aria-expanded', String(!hidden));
        filesToggle.title = hidden ? 'Mostrar arquivos' : 'Ocultar arquivos';
      },
      'icon-button files-toggle',
    );
    filesToggle.setAttribute('aria-expanded', 'true');
    filesToggle.append(SophyIcons.icon('panel'));
    topbar.append(filesToggle, node('div', 'note-tabs'));
    editor.append(topbar);
    const toolbar = node('div', 'note-toolbar');
    toolbar.append(
      node('span', 'file-location', area.name),
      node('span', 'note-save-status', 'Arquivos locais'),
      node('span', 'note-word-count', ''),
      btn(
        'Ver Markdown',
        'Alternar entre o editor visual e o Markdown',
        () => {
          if (active) {
            active.view = active.view === 'source' ? 'visual' : 'source';
            showActive();
          }
        },
        'source-toggle',
      ),
    );
    const backlinks = node('details', 'note-backlinks');
    backlinks.open = false;
    backlinks.append(node('summary', '', 'Referências a esta nota'), node('div', 'backlink-list'));
    const focus = btn(
      '',
      'Modo de foco',
      () => {
        toggleFocus();
      },
      'editor-focus',
    );
    focus.append(SophyIcons.icon('focus'));
    focus.setAttribute('aria-pressed', 'false');
    focus.title = 'Modo de foco (Ctrl+Shift+Enter)';
    const readingMenu = node('details', 'editor-reading-menu');
    const readingTrigger = node('summary', 'icon-button');
    readingTrigger.setAttribute('aria-label', 'Conforto de leitura');
    readingTrigger.title = 'Conforto de leitura';
    readingTrigger.append(SophyIcons.icon('textSize'));
    const readingPanel = node('div', 'reading-popover');
    readingPanel.append(node('strong', '', 'Do seu jeito'), readingControls());
    readingMenu.append(readingTrigger, readingPanel);
    chromeDock = document.querySelector('.header-end');
    topbar.append(readingMenu, focus, chromeDock);
    toolbar.append(backlinks);
    editor.append(node('div', 'note-conflict'), node('div', 'note-stage'), toolbar);
    const navigation = node('aside', 'study-nav');
    const brand = node('div', 'study-brand');
    const logo = node('img');
    logo.src = '../assets/sophy.svg';
    logo.alt = '';
    brand.append(logo, node('strong', 'nav-copy', 'Sophy'));
    const toggle = btn(
      '',
      'Recolher navegação',
      () => {
        const compact = shell.classList.toggle('nav-compact');
        localStorage.setItem('sophy.ui.navigationCollapsed', String(compact));
        toggle.setAttribute('aria-expanded', String(!compact));
        toggle.setAttribute('aria-label', compact ? 'Expandir navegação' : 'Recolher navegação');
      },
      'icon-button',
    );
    toggle.append(SophyIcons.icon('panel'));
    const compactNavigation = localStorage.getItem('sophy.ui.navigationCollapsed') !== 'false';
    shell.classList.toggle('nav-compact', compactNavigation);
    toggle.setAttribute('aria-expanded', String(!compactNavigation));
    toggle.setAttribute(
      'aria-label',
      compactNavigation ? 'Expandir navegação' : 'Recolher navegação',
    );
    brand.append(toggle);
    navigation.append(brand);
    const navButton = (label, icon, action, cls = '') => {
      const b = btn('', label, action, 'study-nav-button ' + cls);
      b.append(SophyIcons.icon(icon), node('span', 'nav-copy', label));
      return b;
    };
    navigation.append(
      navButton('Página inicial', 'home', () => {
        $('#worldNav').click();
      }),
    );
    navigation.append(
      navButton('Conexões da estante', 'graph', () => showGraph().catch(fail), 'nav-graph'),
    );
    navigation.append(node('span', 'nav-section-label nav-copy', 'BIBLIOTECA ATUAL'));
    navigation.append(
      navButton(world?.name || 'Biblioteca', 'library', () => navigate('workspaces')),
    );
    const shelvesHeading = node('div', 'shelves-heading');
    shelvesHeading.append(node('span', 'nav-copy', 'ESTANTES'));
    const addShelf = btn(
      '',
      'Criar estante',
      async () => {
        await navigate('workspaces');
        if (!current) createModal();
      },
      'icon-button',
    );
    addShelf.append(SophyIcons.icon('plus'));
    shelvesHeading.append(addShelf);
    navigation.append(shelvesHeading);
    const shelves = node('nav', 'shelf-list');
    shelves.setAttribute('aria-label', 'Estantes desta biblioteca');
    for (const shelf of workspaces) {
      const b = navButton(
        shelf.name,
        'shelf',
        () => openWorkspace(shelf),
        shelf.id === workspace.id ? 'is-active' : '',
      );
      if (shelf.id === workspace.id) b.setAttribute('aria-current', 'page');
      shelves.append(b);
    }
    navigation.append(
      shelves,
      navButton('Configurações', 'settings', () => navigate('settings'), 'nav-settings'),
    );
    shell.append(navigation, sidebar, editor);
    host.append(shell);
    showActive();
    reloadTree().catch(fail);
    timer = setInterval(poll, 3000);
  }
  function toggleFocus(value) {
    const on = value ?? !document.body.classList.contains('focus-mode');
    document.body.classList.toggle('focus-mode', on);
    const button = $e('.editor-focus');
    button?.setAttribute('aria-pressed', String(on));
    if (button)
      button.title = on ? 'Sair do modo de foco (Esc)' : 'Modo de foco (Ctrl+Shift+Enter)';
    iframe?.contentWindow?.postMessage(
      { type: 'note:focus', session: active?.session, enabled: on },
      '*',
    );
  }
  window.addEventListener('message', (event) => {
    const owner = tabs.find((tab) => tab.frame?.contentWindow === event.source);
    if (!owner) return;
    const m = event.data;
    if (m?.type === 'note:ready') {
      owner.frameReady = true;
      if (owner === active) ready = true;
      syncFrameAppearance(owner.frame);
      loadFrame(owner);
      return;
    }
    if (m?.session !== owner.session) return;
    if (m.type === 'note:changed' && typeof m.content === 'string') {
      owner.frameContent = m.content;
      changed(owner, m.content);
      return;
    }
    if (m.type === 'note:save') {
      saveTab(owner);
      return;
    }
    if (owner !== active) return;
    if (m?.type === 'note:view-state' && m.viewState && active && m.session === active.session) {
      const view = m.viewState;
      if ([view.scrollY, view.blockIndex, view.offset].every(Number.isFinite))
        active.viewState = view;
    } else if (
      m?.type === 'note:changed' &&
      active &&
      m.session === active.session &&
      typeof m.content === 'string'
    )
      changed(active, m.content);
    else if (m?.type === 'note:error' && active && m.session === active.session) {
      active.view = 'source';
      showActive();
      notify(m.message, true);
    } else if (m?.type === 'note:save' && active && m.session === active.session) saveTab(active);
    else if (
      m?.type === 'note:palette' &&
      active &&
      m.session === active.session &&
      ['commands', 'notes', 'search'].includes(m.mode)
    ) {
      window.SophyPalette.open(m.mode);
    } else if (
      m?.type === 'note:stats' &&
      active &&
      m.session === active.session &&
      Number.isFinite(m.words)
    ) {
      const count = Math.max(0, Math.floor(m.words));
      $e('.note-word-count').textContent = `${count} ${count === 1 ? 'palavra' : 'palavras'}`;
      $e('.note-word-count').title = `${Math.max(1, Math.ceil(count / 220))} min de leitura`;
    } else if (m?.type === 'note:focus-request' && active && m.session === active.session) {
      toggleFocus(m.exit ? false : undefined);
    } else if (m?.type === 'note:loaded' && active && m.session === active.session) {
      status(active);
      iframe.contentWindow.postMessage(
        {
          type: 'note:focus',
          session: active.session,
          enabled: document.body.classList.contains('focus-mode'),
        },
        '*',
      );
      if (pendingJump?.path === active.path) {
        iframe.contentWindow.postMessage(
          { type: 'note:jump', session: active.session, anchor: pendingJump.anchor },
          '*',
        );
        pendingJump = null;
      }
    } else if (m?.type === 'note:preview' && active && m.session === active.session) previewLink(m);
    else if (m?.type === 'note:asset-request' && active && m.session === active.session)
      requestAsset(m);
    else if (m?.type === 'note:attachment-insert-failed' && active && m.session === active.session)
      notify('Não foi possível inserir os anexos nesta nota. Tente novamente.', true);
    else if (m?.type === 'note:attachments-inserted' && active && m.session === active.session)
      notify('Anexos inseridos na nota.');
    else if (m?.type === 'note:link' && active && m.session === active.session)
      openLink(m.target, m.format);
    else if (m?.type === 'note:jump-result' && active && m.session === active.session && !m.found)
      notify('A seção ou o bloco de destino não foi encontrado nesta nota.', true);
  });
  window.addEventListener('keydown', (event) => {
    if (iframe && active && ['Control', 'Meta', 'Escape'].includes(event.key))
      iframe.contentWindow.postMessage(
        {
          type: 'note:modifier',
          session: active.session,
          held: event.key === 'Escape' ? false : event.ctrlKey || event.metaKey,
        },
        '*',
      );
  });
  window.addEventListener('keyup', (event) => {
    if (iframe && active && ['Control', 'Meta'].includes(event.key))
      iframe.contentWindow.postMessage(
        { type: 'note:modifier', session: active.session, held: event.ctrlKey || event.metaKey },
        '*',
      );
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const reading = $e('.editor-reading-menu');
      if (reading) reading.open = false;
    }
    if (running && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      toggleFocus();
    } else if (
      running &&
      e.key === 'Escape' &&
      document.body.classList.contains('focus-mode') &&
      !document.querySelector('dialog[open]')
    ) {
      toggleFocus(false);
    }
    if (running && (e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (active) saveTab(active);
    }
    if (running && (e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      newItem('file');
    }
  });
  return {
    mount,
    restoreChrome,
    leave,
    hasUnsaved: dirty,
    isOpen: () => running,
    areaId: () => area?.id || null,
    openPath: (relative) => openItem(relative),
    newNote: () => newItem('file'),
    openDaily: () => openDailyNote(),
    openInbox: () => openInboxNote(),
    showGraph: () => showGraph(),
    newCanvas: () => newCanvas(),
  };
})();
