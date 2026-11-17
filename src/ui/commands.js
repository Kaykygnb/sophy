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
    return { icon: icons[hash % icons.length], color: (hash % 8) + 1 };
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
    filterSlash,
    CONFLICT,
  };
});
