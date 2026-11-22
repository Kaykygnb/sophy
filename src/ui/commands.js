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
    'trash.restore',
    'trash.purge',
    'trash.empty',
    'note.deletePermanent',
    'history.undo',
    'canvas.create',
    'canvas.update',
    'canvas.node.put',
    'canvas.node.remove',
    'canvas.edge.put',
    'canvas.edge.remove',
    'attachment.import',
    'task.update',
    'shelf.style.set',
    'mention.link',
    'vault.import',
    'view.save',
    'tag.rename',
    'note.tags',
    'card.review',
    'card.undo',
    'version.point',
    'version.restore',
    'site.export',
    'search.semantic.enable',
    'note.child.create',
  ]);

  function slashQuery(text, cursor) {
    const before = text.slice(0, cursor);
    const lineStart = Math.max(before.lastIndexOf('\n') + 1, 0);
    const line = before.slice(lineStart);
    if (!/^\s*\/[^\s]*$/.test(line)) return null;
    const slash = lineStart + line.indexOf('/');
    return { start: slash, query: before.slice(slash + 1) };
  }

  function wikiQuery(text, cursor) {
    const before = text.slice(0, cursor);
    const marker = before.lastIndexOf('[[');
    if (marker < 0) return null;
    const query = before.slice(marker + 2);
    if (/[\]\n]/.test(query)) return null;
    // Um [[ esquecido no meio do parágrafo não pode sequestrar o Enter: só abre enquanto parece um nome de nota.
    if (query.length > 60 || /[.!?]\s|\*\*|`/.test(query)) return null;
    return { start: marker, query };
  }

  function tagQuery(text, cursor) {
    const before = text.slice(0, cursor);
    const match = before.match(/(^|[\s(])#([\p{L}\p{N}_\-\/]*)$/u);
    if (!match) return null;
    const start = before.length - match[2].length - 1;
    // "#" sozinho no começo da linha é título, não tag
    if (!match[2] && !match[1]) return null;
    if (match[2] && !/\D/.test(match[2])) return null;
    return { start, query: match[2] };
  }

  function foldText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase();
  }

  function fuzzyScore(query, ...haystacks) {
    const q = foldText(query).trim();
    if (!q) return 1;
    const hay = foldText(haystacks.filter(Boolean).join(' \n '));
    if (!hay) return 0;
    if (hay.includes(q)) return 100 + Math.max(0, 40 - hay.indexOf(q));
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return 0;
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    let score = 0;
    for (const token of tokens) {
      const at = words.findIndex((word) => word.startsWith(token) || word.includes(token));
      if (at < 0) return 0;
      score += words[at].startsWith(token) ? 24 : 10;
      score += Math.max(0, 8 - at);
    }
    return score;
  }

  function parseWikiDraft(query) {
    const pipe = query.indexOf('|');
    const destination = (pipe < 0 ? query : query.slice(0, pipe)).trim();
    const hash = destination.indexOf('#');
    return {
      note: (hash < 0 ? destination : destination.slice(0, hash)).trim(),
      anchor: hash < 0 ? '' : destination.slice(hash + 1),
      alias: pipe < 0 ? null : query.slice(pipe + 1),
      hasPipe: pipe >= 0,
      hasHash: hash >= 0,
    };
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

  function formatChunk(text) {
    const pattern = /(\*\*[^*]+?\*\*|~~[^~]+?~~|==[^=]+?==|`[^`]+?`|\*[^*]+?\*)/g;
    let html = '';
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      html += escapeHtml(text.slice(last, at));
      const raw = match[0];
      const inner =
        raw.startsWith('**') || raw.startsWith('~~') || raw.startsWith('==')
          ? raw.slice(2, -2)
          : raw.slice(1, -1);
      const tag = raw.startsWith('**')
        ? 'strong'
        : raw.startsWith('~~')
          ? 's'
          : raw.startsWith('==')
            ? 'mark'
            : raw.startsWith('`')
              ? 'code'
              : 'em';
      html += `<${tag}>${escapeHtml(inner)}</${tag}>`;
      last = at + raw.length;
    }
    return html + escapeHtml(text.slice(last));
  }

  function previewInline(text) {
    text = String(text || '').replace(/<\/?span\b[^>]*>/gi, '');
    const pattern = /!?\[\[([^\]\n]*)\]\]/g;
    let html = '';
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      html += formatChunk(text.slice(last, at));
      const inner = match[1];
      const label = inner.includes('|') ? inner.split('|').pop() : inner.split('/').pop();
      html += `<a class="wikilink" href="#">${escapeHtml((label || inner).replace(/#.*$/, ''))}</a>`;
      last = at + match[0].length;
    }
    return html + formatChunk(text.slice(last));
  }

  function notePreviewHtml(body) {
    const source = String(body || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const lines = source.split(/\r?\n/);
    const chunks = [];
    let fence = false;
    let code = [];
    let quote = [];
    const flushQuote = () => {
      if (!quote.length) return;
      chunks.push(`<blockquote class="bloco bloco--citacao">${quote.map((line) => previewInline(line)).join('<br>')}</blockquote>`);
      quote = [];
    };
    const flushCode = () => {
      if (!code.length) return;
      chunks.push(`<pre class="bloco bloco--codigo"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      code = [];
    };
    for (const line of lines) {
      if (chunks.length >= 8) break;
      if (line.trim().startsWith('```')) {
        flushQuote();
        if (fence) {
          flushCode();
          fence = false;
        } else fence = true;
        continue;
      }
      if (fence) {
        code.push(line);
        continue;
      }
      if (/^>\s?/.test(line)) {
        quote.push(line.replace(/^>\s?/, ''));
        continue;
      }
      flushQuote();
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
    flushQuote();
    if (fence) flushCode();
    return `<div class="cv-previa">${chunks.join('')}</div>`;
  }

  const COMMANDS = [
    { id: 'nota', rotulo: 'Nova nota', grupo: 'Criar', icone: 'nota-nova', atalho: 'Ctrl+N', quando: 'biblioteca' },
    { id: 'estante', rotulo: 'Nova estante', grupo: 'Criar', icone: 'pasta-nova', atalho: 'Ctrl+Shift+N', quando: 'biblioteca' },
    { id: 'novo-canvas', rotulo: 'Novo canvas', grupo: 'Criar', icone: 'canvas', atalho: '', quando: 'biblioteca' },
    { id: 'modelo', rotulo: 'A partir de modelo', grupo: 'Criar', icone: 'modelo', atalho: '', quando: 'biblioteca' },
    { id: 'buscar', rotulo: 'Buscar', grupo: 'Navegar', icone: 'busca', atalho: 'Ctrl+K', quando: 'sempre' },
    { id: 'comandos', rotulo: 'Comandos', grupo: 'Navegar', icone: 'comando', atalho: 'Ctrl+Shift+P', quando: 'sempre' },
    { id: 'biblioteca', rotulo: 'Trocar biblioteca', grupo: 'Navegar', icone: 'alternar', atalho: 'Ctrl+Shift+O', quando: 'sempre' },
    { id: 'grafo', rotulo: 'Mostrar grafo', grupo: 'Navegar', icone: 'grafo', atalho: '', quando: 'biblioteca' },
    { id: 'hoje', rotulo: 'Nota do dia', grupo: 'Navegar', icone: 'nota-diaria', atalho: 'Alt+D', quando: 'biblioteca' },
    { id: 'config', rotulo: 'Configurações', grupo: 'Navegar', icone: 'ajuste', atalho: 'Ctrl+,', quando: 'sempre' },
    { id: 'captura', rotulo: 'Captura rápida', grupo: 'Criar', icone: 'caixa-entrada', atalho: 'Ctrl+Shift+Espaço', quando: 'biblioteca' },
    { id: 'visoes', rotulo: 'Visões salvas', grupo: 'Navegar', icone: 'lista', atalho: '', quando: 'biblioteca' },
    { id: 'mencoes', rotulo: 'Menções sem link', grupo: 'Editar', icone: 'link', atalho: '', quando: 'biblioteca' },
    { id: 'importar', rotulo: 'Importar do Obsidian', grupo: 'Criar', icone: 'pasta-aberta', atalho: '', quando: 'biblioteca' },
    { id: 'foco', rotulo: 'Modo foco', grupo: 'Editar', icone: 'olho', atalho: '', quando: 'sempre' },
    { id: 'cartas', rotulo: 'Flashcards', grupo: 'Navegar', icone: 'leitura', atalho: '', quando: 'biblioteca' },
    { id: 'lixeira', rotulo: 'Lixeira', grupo: 'Navegar', icone: 'lixeira', atalho: '', quando: 'biblioteca' },
    { id: 'versoes', rotulo: 'Histórico de versões', grupo: 'Navegar', icone: 'historico', atalho: '', quando: 'biblioteca' },
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
    const needle = foldText(query).trim();
    if (!needle) return items;
    return items.filter((item) => {
      const hay = [item.label, item.id, item.hint, ...(item.keywords || [])]
        .filter(Boolean)
        .join(' ');
      return foldText(hay).includes(needle);
    });
  }

  const SLASH_ITEMS = [
    { group: 'Básicos', id: 'h1', label: 'Título 1', icon: 'titulo', hint: '#', insert: '# ' },
    { group: 'Básicos', id: 'h2', label: 'Título 2', icon: 'titulo', hint: '##', insert: '## ' },
    { group: 'Básicos', id: 'h3', label: 'Título 3', icon: 'titulo', hint: '###', insert: '### ' },
    { group: 'Básicos', id: 'h4', label: 'Título 4', icon: 'titulo', hint: '####', insert: '#### ' },
    { group: 'Básicos', id: 'h5', label: 'Título 5', icon: 'titulo', hint: '#####', insert: '##### ' },
    { group: 'Básicos', id: 'h6', label: 'Título 6', icon: 'titulo', hint: '######', insert: '###### ' },
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
      group: 'Diagramas',
      id: 'mermaid',
      label: 'Diagrama (Mermaid)',
      icon: 'diagrama',
      hint: '```mermaid',
      keywords: ['mermaid', 'diagrama', 'fluxo', 'fluxograma', 'grafico', 'gráfico'],
      insert: '```mermaid\ngraph TD\n  A[Início] --> B[Próximo passo]\n```',
    },
    {
      group: 'Diagramas',
      id: 'mermaid-sequencia',
      label: 'Sequência',
      icon: 'conector',
      hint: 'sequence',
      keywords: ['mermaid', 'diagrama', 'sequencia', 'sequência', 'sequence'],
      insert: '```mermaid\nsequenceDiagram\n  Ana->>Bruno: Olá\n  Bruno-->>Ana: Oi\n```',
    },
    {
      group: 'Diagramas',
      id: 'mermaid-mapa',
      label: 'Mapa mental',
      icon: 'grafo',
      hint: 'mindmap',
      keywords: ['mermaid', 'diagrama', 'mapa', 'mental', 'mindmap'],
      insert: '```mermaid\nmindmap\n  root((Ideia))\n    Ramo A\n    Ramo B\n```',
    },
    {
      group: 'Diagramas',
      id: 'mermaid-gantt',
      label: 'Gantt',
      icon: 'linha-do-tempo',
      hint: 'gantt',
      keywords: ['mermaid', 'diagrama', 'gantt', 'cronograma', 'prazo'],
      insert: '```mermaid\ngantt\n  title Plano\n  dateFormat YYYY-MM-DD\n  section Etapa\n  Tarefa :a1, 2026-11-22, 7d\n```',
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
      id: 'pagina',
      label: 'Página filha',
      icon: 'nota',
      hint: '/página',
      insert: '{{pagina}}',
    },
    {
      group: 'Inserir',
      id: 'alerta',
      label: 'Alerta',
      icon: 'alerta',
      hint: '[!alerta]',
      insert: '> [!alerta]\n> ',
    },
    {
      group: 'Inserir',
      id: 'pergunta',
      label: 'Pergunta',
      icon: 'ajuda',
      hint: '[!pergunta]',
      insert: '> [!pergunta]\n> ',
    },
    {
      group: 'Inserir',
      id: 'tarefa-destaque',
      label: 'Destaque de tarefa',
      icon: 'tarefa',
      hint: '[!tarefa]',
      insert: '> [!tarefa]\n> ',
    },
    {
      group: 'Inserir',
      id: 'dica',
      label: 'Dica',
      icon: 'lampada',
      hint: '[!dica]',
      insert: '> [!dica]\n> ',
    },
    {
      group: 'Inserir',
      id: 'recolhivel',
      label: 'Lista recolhível',
      icon: 'lista',
      insert: '> [!toggle]\n> ',
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

  const COVER_MIGRATION = ['rede', 'estante', 'jardim', 'horizonte', 'cerrado', 'ondas'];
  const COVER_IDS = [
    'ondas', 'montanhas', 'folhas', 'campo', 'nuvens', 'jardim', 'horizonte', 'ceu-noturno',
    'constelacao', 'cerrado', 'vereda', 'ipe', 'grade', 'papel-dobrado', 'arcos', 'topografia',
    'estante', 'pautado', 'rede', 'cidade', 'sofi-galho', 'sofi-livros', 'sofi-noite', 'sofi-folhas',
  ];
  const COVER_NAMES = {
    ondas: 'Ondas', montanhas: 'Montanhas', folhas: 'Folhas', campo: 'Campo', nuvens: 'Nuvens',
    jardim: 'Jardim', horizonte: 'Horizonte', 'ceu-noturno': 'Céu noturno', constelacao: 'Constelação',
    cerrado: 'Cerrado', vereda: 'Vereda', ipe: 'Ipê', grade: 'Grade', 'papel-dobrado': 'Papel dobrado',
    arcos: 'Arcos', topografia: 'Topografia', estante: 'Estante', pautado: 'Pautado', rede: 'Rede',
    cidade: 'Cidade', 'sofi-galho': 'Sofi no galho', 'sofi-livros': 'Sofi nos livros',
    'sofi-noite': 'Sofi à noite', 'sofi-folhas': 'Sofi entre folhas',
  };

  function capaY(value) {
    if (value == null || value === '') return 0.5;
    const text = String(value).trim();
    if (text.endsWith('%')) {
      const number = Number(text.slice(0, -1));
      return Number.isNaN(number) ? 0.5 : Math.min(1, Math.max(0, number / 100));
    }
    const number = Number(text);
    if (Number.isNaN(number)) return 0.5;
    return number > 1 ? Math.min(1, number / 100) : Math.min(1, Math.max(0, number));
  }

  function resolveCover(front) {
    const source = front && typeof front === 'object' ? front : {};
    let token = '';
    if (source.capa == null && source.ilustracao != null && COVER_MIGRATION[Number(source.ilustracao)])
      token = `sophy:${COVER_MIGRATION[Number(source.ilustracao)]}`;
    if (typeof source.capa === 'string') token = source.capa.trim();
    if (!token) return null;
    const y = capaY(source.capa_y);
    if (token.startsWith('cor:')) return { kind: 'cor', color: token.slice(4), y };
    if (token.startsWith('sophy:')) {
      let id = token.slice(6);
      if (/^[1-6]$/.test(id)) id = COVER_MIGRATION[Number(id) - 1];
      if (!COVER_IDS.includes(id)) return null;
      return { kind: 'arte', id, name: COVER_NAMES[id] || id, y };
    }
    if (/\.(png|jpe?g|webp|svg)$/i.test(token)) return { kind: 'arquivo', src: token, y };
    return null;
  }

  return {
    ORIGIN_TOOLS,
    SLASH_ITEMS,
    slashQuery,
    wikiQuery,
    tagQuery,
    foldText,
    fuzzyScore,
    parseWikiDraft,
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
    resolveCover,
    COVER_IDS,
    COVER_NAMES,
    filterSlash,
    CONFLICT,
  };
});
