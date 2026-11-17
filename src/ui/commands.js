/**
 * Decisões da janela que não precisam de DOM: menu /, autocompletar [[,
 * chamada IPC com origem ui, e o que fazer quando uma tool ui.* chega.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyCommands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ORIGIN_TOOLS = new Set([
    'workspace.create',
    'directory.create',
    'note.create',
    'note.write',
    'entry.move',
    'entry.trash',
    'history.undo',
    'canvas.create',
    'canvas.update',
    'canvas.node.put',
    'canvas.node.remove',
    'canvas.edge.put',
    'canvas.edge.remove',
    'task.update',
  ]);

  function slashQuery(text, cursor) {
    const before = text.slice(0, cursor);
    const slash = before.lastIndexOf('/');
    if (slash < 0) return null;
    if (slash > 0 && !/\s/.test(before[slash - 1])) return null;
    const query = before.slice(slash + 1);
    if (/\s/.test(query)) return null;
    return { start: slash, query };
  }

  function wikiQuery(text, cursor) {
    const before = text.slice(0, cursor);
    const marker = before.lastIndexOf('[[');
    if (marker < 0) return null;
    const query = before.slice(marker + 2);
    if (query.includes(']]') || query.includes('\n') || query.includes('|') || query.includes('#'))
      return null;
    return { start: marker, query };
  }

  function createSlashSession() {
    let dismissed = null;
    return {
      offer(text, cursor) {
        const found = slashQuery(text, cursor);
        if (!found) {
          dismissed = null;
          return null;
        }
        if (dismissed && dismissed.start === found.start && dismissed.query === found.query)
          return null;
        return found;
      },
      dismiss(text, cursor) {
        const found = slashQuery(text, cursor);
        dismissed = found ? { start: found.start, query: found.query } : null;
      },
      reset() {
        dismissed = null;
      },
    };
  }

  function prepareCall(name, input, libraryPath) {
    const body = { ...(input && typeof input === 'object' ? input : {}) };
    delete body.origin;
    delete body.libraryPath;
    if (name === 'library.open') body.path = libraryPath;
    else if (name !== 'ui.setTheme') body.libraryPath = libraryPath;
    if (ORIGIN_TOOLS.has(name)) body.origin = 'ui';
    return body;
  }

  function createClient(call, libraryPath) {
    const pathOf = typeof libraryPath === 'function' ? libraryPath : () => libraryPath;
    return {
      tool(name, input) {
        return call(name, prepareCall(name, input, pathOf()));
      },
    };
  }

  /**
   * A porta do processo principal. O renderer não escolhe origem nem biblioteca:
   * a sessão aberta é a única pasta, e a origem gravada é sempre ui.
   */
  function createToolGate({ call, libraryPath, setLibraryPath }) {
    return (name, input) => {
      const body = { ...(input && typeof input === 'object' ? input : {}) };
      delete body.origin;
      delete body.libraryPath;
      if (ORIGIN_TOOLS.has(name)) body.origin = 'ui';
      if (name === 'library.open') {
        if (typeof body.path !== 'string' || !body.path) {
          const current = libraryPath();
          if (!current) throw new Error('Escolha a pasta da biblioteca.');
          body.path = current;
        }
      } else if (name !== 'ui.setTheme') {
        const current = libraryPath();
        if (!current) throw new Error('Nenhuma biblioteca aberta.');
        body.libraryPath = current;
      }
      const result = call(name, body);
      if (name === 'library.open' && result && result.root) setLibraryPath(result.root);
      return result;
    };
  }

  const CONFLICT = 'A nota mudou desde a leitura. Nada foi gravado.';

  async function saveNote(client, note) {
    const result = await client.tool('note.write', {
      path: note.path,
      body: note.body,
      expectedRevision: note.revision,
    });
    if (result && result.conflict)
      return { saved: false, message: CONFLICT, current: result.current };
    return { saved: true, note: result.note, message: 'Salvo' };
  }

  function applyUiCommand(state, command) {
    const next = { ...state, lastCommand: command };
    if (command.type === 'openNote') {
      return { ...next, view: 'note', path: command.path, libraryPath: command.libraryPath };
    }
    if (command.type === 'openCanvas') {
      return {
        ...next,
        view: 'canvas',
        path: command.path,
        libraryPath: command.libraryPath,
        placeholder: true,
      };
    }
    if (command.type === 'showGraph') {
      return {
        ...next,
        view: 'graph',
        workspace: command.workspace ?? null,
        libraryPath: command.libraryPath,
      };
    }
    if (command.type === 'setTheme') return { ...next, theme: command.theme };
    return next;
  }

  const SHELF_ICONS = {
    estudos: 'capelo',
    diário: 'nota-diaria',
    diario: 'nota-diaria',
    leituras: 'livro',
    trabalho: 'maleta',
    pesquisa: 'lampada',
    projeto: 'livro',
    'projeto livro': 'livro',
  };

  function kitTaskStatus(status) {
    if (status === '/') return 'andamento';
    if (status === 'x' || status === 'X') return 'feita';
    if (status === '-') return 'cancelada';
    return 'aberta';
  }

  function taskBlockClass(status) {
    const kit = kitTaskStatus(status);
    if (kit === 'feita') return 'tarefa tarefa--feita';
    if (kit === 'cancelada') return 'tarefa tarefa--cancelada';
    return 'tarefa';
  }

  function uniqueTitle(existing, base = 'Sem título') {
    const names = new Set(existing);
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function previewTask(line) {
    const match = String(line).match(/^(\s*)([-*+]|\d+\.) \[([ xX/\-])\]\s?(.*)$/);
    if (!match) return null;
    const rest = match[4];
    const emoji = rest.search(/📅|🛫|⏳|✅|⏫|🔼|🔽/);
    const title = (emoji < 0 ? rest : rest.slice(0, emoji)).replace(/\s+$/, '');
    const suffix = emoji < 0 ? '' : rest.slice(emoji);
    const due = suffix.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    let priority = null;
    if (suffix.includes('⏫')) priority = 'alta';
    else if (suffix.includes('🔼')) priority = 'media';
    else if (suffix.includes('🔽')) priority = 'baixa';
    return { title, due: due ? due[1] : null, priority, status: match[3] };
  }

  function previewInline(text) {
    const pattern = /!?\[\[([^\]\n]*)\]\]/g;
    let html = '';
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      html += escapeHtml(text.slice(last, at));
      const inner = match[1];
      const label = inner.includes('|') ? inner.split('|').pop() : inner.split('/').pop();
      html += `<a class="wikilink" href="#">${escapeHtml((label || inner).replace(/#.*$/, ''))}</a>`;
      last = at + match[0].length;
    }
    return html + escapeHtml(text.slice(last));
  }

  function notePreviewHtml(body) {
    const source = String(body || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const chunks = [];
    for (const line of source.split(/\r?\n/)) {
      if (chunks.length >= 8) break;
      const task = previewTask(line);
      if (task) {
        const kit = kitTaskStatus(task.status);
        const chips = [
          task.due ? `<span class="chip">${escapeHtml(task.due)}</span>` : '',
          task.priority === 'alta' ? '<span class="chip chip--alta">Alta</span>' : '',
          task.priority === 'media' ? '<span class="chip chip--media">Média</span>' : '',
          task.priority === 'baixa' ? '<span class="chip chip--baixa">Baixa</span>' : '',
        ].join('');
        chunks.push(
          `<div class="${taskBlockClass(task.status)}"><span class="check" data-status="${kit}"></span><span class="tarefa__texto">${previewInline(task.title)}</span><span class="tarefa__meta">${chips}</span></div>`,
        );
        continue;
      }
      const text = line.trim();
      if (!text || /^#{1,6}\s/.test(text)) continue;
      chunks.push(`<p>${previewInline(text)}</p>`);
    }
    return chunks.join('');
  }

  const COMMANDS = [
    { id: 'nota', rotulo: 'Nova nota', grupo: 'Criar', icone: 'nota-nova', atalho: 'Ctrl+N', quando: 'biblioteca' },
    { id: 'estante', rotulo: 'Nova estante', grupo: 'Criar', icone: 'pasta-nova', atalho: 'Ctrl+Shift+N', quando: 'biblioteca' },
    { id: 'canvas', rotulo: 'Novo canvas', grupo: 'Criar', icone: 'canvas', atalho: '', quando: 'biblioteca' },
    { id: 'modelo', rotulo: 'A partir de modelo', grupo: 'Criar', icone: 'modelo', atalho: '', quando: 'biblioteca' },
    { id: 'buscar', rotulo: 'Buscar', grupo: 'Navegar', icone: 'busca', atalho: 'Ctrl+K', quando: 'sempre' },
    { id: 'comandos', rotulo: 'Comandos', grupo: 'Navegar', icone: 'comando', atalho: 'Ctrl+Shift+P', quando: 'sempre' },
    { id: 'biblioteca', rotulo: 'Trocar biblioteca', grupo: 'Navegar', icone: 'alternar', atalho: 'Ctrl+Shift+O', quando: 'sempre' },
    { id: 'grafo', rotulo: 'Mostrar grafo', grupo: 'Navegar', icone: 'grafo', atalho: '', quando: 'biblioteca' },
    { id: 'hoje', rotulo: 'Nota do dia', grupo: 'Navegar', icone: 'nota-diaria', atalho: 'Alt+D', quando: 'biblioteca' },
    { id: 'negrito', rotulo: 'Negrito', grupo: 'Editar', icone: 'negrito', atalho: 'Ctrl+B', quando: 'editor' },
    { id: 'italico', rotulo: 'Itálico', grupo: 'Editar', icone: 'italico', atalho: 'Ctrl+I', quando: 'editor' },
    { id: 'riscado', rotulo: 'Riscado', grupo: 'Editar', icone: 'tachado', atalho: 'Ctrl+Shift+X', quando: 'editor' },
    { id: 'destacar', rotulo: 'Destacar', grupo: 'Editar', icone: 'marca-texto', atalho: 'Ctrl+Shift+H', quando: 'editor' },
    { id: 'link', rotulo: 'Link', grupo: 'Editar', icone: 'link', atalho: 'Ctrl+L', quando: 'editor' },
    { id: 'tarefa', rotulo: 'Virar tarefa', grupo: 'Editar', icone: 'lista-tarefas', atalho: 'Ctrl+Enter', quando: 'editor' },
    { id: 'sofi', rotulo: 'Pedir à Sofi', grupo: 'Editar', icone: 'faisca', atalho: 'Ctrl+J', quando: 'editor' },
  ];

  function treeMarked(kind, id, focus = {}) {
    const mode =
      focus.treeFocus || (focus.active ? 'note' : focus.canvasPath ? 'canvas' : 'shelf');
    if (mode === 'shelf') return kind === 'shelf' && id === focus.selectedShelf;
    if (mode === 'canvas') return kind === 'canvas' && id === focus.canvasPath;
    return kind === 'note' && id === focus.active;
  }

  function noteIndent(path) {
    const depth = String(path || '')
      .split('/')
      .filter(Boolean).length;
    return Math.max(2, depth);
  }

  function shelfMark(name) {
    if (name === 'Entrada') return { icon: 'caixa-entrada', color: null };
    const icons = [
      'capelo',
      'livro',
      'lampada',
      'maleta',
      'leitura',
      'coracao',
      'estante',
      'pasta',
      'grafo',
      'faisca',
      'tag',
      'calendario',
      'conversa',
      'favorito',
      'globo',
      'musica',
      'planta',
      'pincel',
    ];
    let hash = 0;
    for (const char of name) hash = (hash * 33 + char.codePointAt(0)) >>> 0;
    const mapped = SHELF_ICONS[name.trim().toLocaleLowerCase('pt-BR')];
    return { icon: mapped || icons[hash % icons.length], color: (hash % 8) + 1 };
  }

  function filterSlash(items, query) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.label.toLocaleLowerCase().includes(needle) ||
        item.id.includes(needle) ||
        (item.hint && item.hint.toLocaleLowerCase().includes(needle)),
    );
  }

  const SLASH_ITEMS = [
    { group: 'Básicos', id: 'h1', label: 'Título 1', icon: 'titulo', hint: '#', insert: '# ' },
    { group: 'Básicos', id: 'h2', label: 'Título 2', icon: 'titulo', hint: '##', insert: '## ' },
    { group: 'Básicos', id: 'lista', label: 'Lista', icon: 'lista', hint: '-', insert: '- ' },
    {
      group: 'Básicos',
      id: 'numerada',
      label: 'Lista numerada',
      icon: 'lista-numerada',
      hint: '1.',
      insert: '1. ',
    },
    {
      group: 'Básicos',
      id: 'tarefa',
      label: 'Tarefa',
      icon: 'tarefa',
      hint: '[ ]',
      insert: '- [ ] ',
    },
    { group: 'Básicos', id: 'citacao', label: 'Citação', icon: 'citacao', hint: '>', insert: '> ' },
    {
      group: 'Básicos',
      id: 'codigo',
      label: 'Bloco de código',
      icon: 'bloco-codigo',
      hint: '```',
      insert: '```\n\n```',
    },
    {
      group: 'Básicos',
      id: 'divisor',
      label: 'Divisor',
      icon: 'divisor',
      hint: '---',
      insert: '---',
    },
    {
      group: 'Inserir',
      id: 'tabela',
      label: 'Tabela',
      icon: 'tabela',
      insert: '|  |  |\n| --- | --- |\n|  |  |',
    },
    {
      group: 'Inserir',
      id: 'imagem',
      label: 'Imagem ou arquivo',
      icon: 'imagem',
      insert: '![[arquivo]]',
    },
    {
      group: 'Inserir',
      id: 'destaque',
      label: 'Destaque',
      icon: 'destaque',
      insert: '> [!note]\n> ',
    },
    { group: 'Comandos', id: 'link', label: 'Link para nota', icon: 'link', insert: '[[' },
    {
      group: 'Comandos',
      id: 'hoje',
      label: 'Data de hoje',
      icon: 'calendario',
      insert: '{{hoje}}',
    },
  ];

  return {
    ORIGIN_TOOLS,
    SLASH_ITEMS,
    slashQuery,
    wikiQuery,
    createSlashSession,
    prepareCall,
    createClient,
    createToolGate,
    saveNote,
    applyUiCommand,
    shelfMark,
    kitTaskStatus,
    taskBlockClass,
    COMMANDS,
    treeMarked,
    notePreviewHtml,
    noteIndent,
    uniqueTitle,
    filterSlash,
    CONFLICT,
  };
});
