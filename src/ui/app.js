const Doc = SophyDoc;
const Cmd = SophyCommands;

const state = {
  settings: {},
  libraryPath: null,
  libraryName: 'Biblioteca',
  workspaces: [],
  notes: [],
  canvases: [],
  canvasDoc: null,
  canvasRevision: null,
  canvasPreviews: {},
  canvasRedo: [],
  tabs: [],
  active: null,
  view: 'empty',
  doc: null,
  revision: null,
  frontmatter: null,
  outgoing: [],
  backlinks: [],
  conflict: false,
  graphWorkspace: '',
  graphTag: '',
  graphCamera: { x: 0, y: 0, zoom: 1 },
  step: 1,
  folderMode: 'criar',
  folder: '',
  libraryNameInput: 'Biblioteca',
  selectedShelf: null,
  namingShelf: false,
  renaming: null,
  selectTitle: false,
};

const slash = Cmd.createSlashSession();
let saveTimer = 0;
let lottiePromise = null;

const $ = (sel, root = document) => root.querySelector(sel);
function icon(name, extra = '') {
  return `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
function windowButtons() {
  return `<div class="janela-botoes">
    <button type="button" class="btn btn--icone" data-window="minimize" aria-label="Minimizar">${icon('janela-minimizar')}</button>
    <button type="button" class="btn btn--icone" data-window="maximize" aria-label="Maximizar">${icon('janela-maximizar')}</button>
    <button type="button" class="btn btn--icone janela-fechar" data-window="close" aria-label="Fechar">${icon('fechar')}</button>
  </div>`;
}
function bindWindow(root) {
  root.querySelectorAll('[data-window]').forEach((button) => {
    button.onclick = () => sophy.window(button.dataset.window);
  });
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
function baseName(file) {
  return file
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
    .replace(/\.canvas$/i, '');
}
function tagChips(matter) {
  if (!matter || typeof matter !== 'object') return '';
  const raw = matter.tags;
  const tags = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return tags
    .map((tag) => `<span class="chip">#${escapeHtml(String(tag).replace(/^#/, ''))}</span>`)
    .join('');
}
function noteCrumb(file) {
  const parts = String(file || '').split('/');
  if (parts.length < 2) return 'Biblioteca';
  return escapeHtml(parts.slice(0, -1).join(' / '));
}
function themeName() {
  const choice = state.settings.theme || 'system';
  if (choice === 'system')
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return choice === 'dark' ? 'dark' : 'light';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const logo = $('.titulo__marca img');
  if (logo)
    logo.src = `ui/assets/logo/logo-horizontal-${theme === 'dark' ? 'escuro' : 'claro'}.svg`;
}
function motionReduced() {
  return (
    state.settings.reduceMotion === true || matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
function syncMotion() {
  document.documentElement.classList.toggle('motion-reduce', motionReduced());
}

async function tool(name, input) {
  const response = await sophy.tool(name, input || {});
  if (!response.ok) throw new Error(response.error || 'Falha na operação.');
  return response.value;
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'erro' ? 'toast--erro' : 'toast--ok'}`;
  el.setAttribute('role', kind === 'erro' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'erro' ? 'erro' : 'salvo', 'toast__icone')}<span class="toast__texto">${escapeHtml(message)}</span>`;
  $('#toasts').append(el);
  if (kind !== 'erro') setTimeout(() => el.remove(), 5000);
  else el.addEventListener('click', () => el.remove());
}

function loadLottie() {
  if (window.lottie) return Promise.resolve(window.lottie);
  if (!lottiePromise) {
    lottiePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'ui/assets/lottie.min.js';
      script.onload = () => resolve(window.lottie);
      script.onerror = () => reject(new Error('Não foi possível carregar a animação.'));
      document.head.append(script);
    });
  }
  return lottiePromise;
}

async function mountSofi(host, name) {
  const theme = themeName() === 'dark' ? 'escuro' : 'claro';
  host.replaceChildren();
  if (motionReduced()) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `ui/assets/sofi/sofi-${name}-${theme}.svg`;
    host.append(img);
    return;
  }
  try {
    const lottie = await loadLottie();
    lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: name === 'ocioso' || name === 'pensando',
      autoplay: true,
      path: `ui/assets/sofi/sofi-${name}-${theme}.json`,
    });
  } catch {
    const img = document.createElement('img');
    img.alt = '';
    img.src = `ui/assets/sofi/sofi-${name}-${theme}.svg`;
    host.append(img);
  }
}

function paintOnboarding() {
  const root = $('#onboarding');
  root.hidden = false;
  $('#shell').hidden = true;
  const names = ['Boas-vindas', 'Biblioteca', 'Tema', 'Agente'];
  const steps = [1, 2, 3, 4]
    .map(
      (n) =>
        `<i class="${n < state.step ? 'is-feito' : ''} ${n === state.step ? 'is-atual' : ''}"></i>`,
    )
    .join('');
  const stepNames = names
    .map(
      (name, index) => `<span class="${index + 1 === state.step ? 'is-atual' : ''}">${name}</span>`,
    )
    .join('');
  const bodies = {
    1: `<div class="sofi" data-sofi="pronta"></div>
      <h1>Olá, eu sou a Sofi.</h1>
      <p class="onboarding__lead">O Sophy guarda suas notas como arquivos Markdown numa pasta sua.<br />Eu ajudo a organizar, encontrar e ligar ideias.</p>
      <div class="onboarding__cartoes onboarding__cartoes--tres">
        <div class="opcao">${icon('pasta')}<div><strong>Arquivos seus, no seu disco</strong><p>Pastas e .md comuns, abra em qualquer editor.</p></div></div>
        <div class="opcao">${icon('link')}<div><strong>Notas ligadas com [[ ]]</strong><p>Links, backlinks, grafo e canvas.</p></div></div>
        <div class="opcao">${icon('agente')}<div><strong>Agente opcional</strong><p>Só funciona se você conectar uma chave.</p></div></div>
      </div>`,
    2: `<img alt="" src="ui/assets/ilustracoes/biblioteca-vazia-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" width="200" />
      <h1>Onde ficam as suas notas?</h1>
      <div class="onboarding__cartoes">
        <button type="button" class="opcao ${state.folderMode === 'criar' ? 'is-escolhida' : ''}" data-mode="criar">${icon('pasta-nova')}<div><strong>Criar nova biblioteca</strong><p>Uma pasta nova, com o marcador .sophy.</p></div></button>
        <button type="button" class="opcao ${state.folderMode === 'abrir' ? 'is-escolhida' : ''}" data-mode="abrir">${icon('pasta-aberta')}<div><strong>Abrir pasta existente</strong><p>Uma biblioteca que você já tem, inclusive vinda do Obsidian.</p></div></button>
      </div>
      ${
        state.folderMode === 'criar'
          ? `<label class="campo">Nome<input id="lib-name" value="${escapeHtml(state.libraryNameInput)}" /></label>`
          : ''
      }
      <label class="campo">Local<input id="lib-folder" readonly value="${escapeHtml(state.folder)}" placeholder="Nenhuma pasta escolhida" /></label>
      <button type="button" class="btn btn--secundario" id="escolher-pasta" style="margin-top:12px">${icon('pasta')} Escolher pasta</button>
      <p class="nota-privacidade">${icon('cadeado')} A pasta fica no seu computador. O Sophy não envia as notas.</p>`,
    3: `<h1>Escolha a aparência</h1>
      <p class="onboarding__lead">O tema vale na hora. Dá para mudar depois.</p>
      <p id="rot-tema">Tema</p>
      <div class="segmentado" role="radiogroup" aria-labelledby="rot-tema">
        ${[
          ['light', 'Claro'],
          ['dark', 'Escuro'],
          ['system', 'Sistema'],
        ]
          .map(
            ([value, label]) =>
              `<label class="segmentado__opcao"><input type="radio" name="tema" value="${value}" ${(state.settings.theme || 'system') === value ? 'checked' : ''} /><span>${label}</span></label>`,
          )
          .join('')}
      </div>
      <p id="rot-fonte">Fonte do texto</p>
      <div class="segmentado" role="radiogroup" aria-labelledby="rot-fonte">
        <label class="segmentado__opcao"><input type="radio" name="fonte" value="inter" ${state.settings.readingFont === 'literata' ? '' : 'checked'} /><span>Inter</span></label>
        <label class="segmentado__opcao"><input type="radio" name="fonte" value="literata" ${state.settings.readingFont === 'literata' ? 'checked' : ''} /><span>Literata</span></label>
      </div>
      <p id="rot-movimento">Animações</p>
      <div class="segmentado" role="radiogroup" aria-labelledby="rot-movimento">
        <label class="segmentado__opcao"><input type="radio" name="movimento" value="sistema" ${state.settings.reduceMotion ? '' : 'checked'} /><span>Sistema</span></label>
        <label class="segmentado__opcao"><input type="radio" name="movimento" value="reduzir" ${state.settings.reduceMotion ? 'checked' : ''} /><span>Reduzir</span></label>
      </div>`,
    4: `<img alt="" src="ui/assets/ilustracoes/agente-desconectado-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" width="200" />
      <h1>Quer ligar um agente agora?</h1>
      <p class="nota-privacidade">${icon('cadeado')} A chave fica no cofre do sistema. Nada é gravado na biblioteca.</p>
      <label class="campo">Provedor
        <select id="provedor"><option>OpenAI</option><option>Anthropic</option><option>Outro</option></select>
      </label>
      <label class="campo">Chave de API<input id="chave" type="password" autocomplete="off" placeholder="não será armazenada" /></label>
      <p id="teste-chave" class="nota-privacidade"></p>`,
  };
  const primary =
    state.step === 1
      ? 'Começar'
      : state.step === 2
        ? 'Abrir biblioteca'
        : state.step === 3
          ? 'Continuar'
          : 'Concluir';
  const importar =
    state.step === 1
      ? '<span class="onboarding__importar">Já usa outra ferramenta? <button type="button" class="link" id="importar">Importar do Obsidian</button></span>'
      : '';
  const logo = themeName() === 'dark' ? 'escuro' : 'claro';
  root.innerHTML = `<section class="onboarding">
    <header class="onboarding__barra">
      <img alt="Sophy" src="ui/assets/logo/logo-horizontal-${logo}.svg" />
      ${windowButtons()}
    </header>
    <div class="onboarding__topo">
      <div class="onboarding__passo-num">Passo ${state.step} de 4</div>
      <div class="onboarding__passos">${steps}</div>
      <div class="onboarding__nomes">${stepNames}</div>
    </div>
    <div class="onboarding__miolo">${bodies[state.step]}</div>
    <div class="onboarding__rodape">
      ${state.step === 1 ? importar : '<button type="button" class="btn btn--fantasma" id="voltar">Voltar</button>'}
      <div>
        ${state.step === 4 ? '<button type="button" class="btn btn--secundario" id="pular">Pular por agora</button>' : ''}
        <button type="button" class="btn btn--primario" id="avancar">${primary}</button>
      </div>
    </div>
  </section>`;
  const sofi = $('[data-sofi]', root);
  if (sofi) mountSofi(sofi, 'pronta');
  bindWindow(root);
  const back = $('#voltar', root);
  if (back)
    back.onclick = () => {
      state.step = Math.max(1, state.step - 1);
      paintOnboarding();
    };
  const importer = $('#importar', root);
  if (importer)
    importer.onclick = () => {
      state.folderMode = 'abrir';
      state.step = 2;
      paintOnboarding();
    };
  const advance = $('#avancar', root);
  advance.onclick = () => nextStep(false);
  const skip = $('#pular', root);
  if (skip) skip.onclick = () => finishOnboarding();
  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.onclick = () => {
      state.folderMode = button.dataset.mode;
      paintOnboarding();
    };
  });
  const name = $('#lib-name', root);
  if (name)
    name.oninput = () => {
      state.libraryNameInput = name.value;
    };
  const choose = $('#escolher-pasta', root);
  if (choose)
    choose.onclick = async () => {
      const folder = await sophy.chooseFolder();
      if (!folder || !folder.ok) return;
      state.folder = folder.value || '';
      paintOnboarding();
    };
  root.querySelectorAll('input[name="tema"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.theme = input.value;
      applyTheme(themeName());
      await sophy.saveSettings({ theme: state.settings.theme });
      paintOnboarding();
    };
  });
  root.querySelectorAll('input[name="fonte"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.readingFont = input.value;
      document.documentElement.style.setProperty(
        '--font-reading',
        input.value === 'literata' ? 'var(--font-reading-serif)' : 'var(--font-ui)',
      );
      await sophy.saveSettings({ readingFont: input.value });
    };
  });
  root.querySelectorAll('input[name="movimento"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.reduceMotion = input.value === 'reduzir';
      syncMotion();
      await sophy.saveSettings({ reduceMotion: state.settings.reduceMotion });
    };
  });
  const testKey = $('#chave', root);
  if (testKey) {
    const probe = document.createElement('button');
    probe.type = 'button';
    probe.className = 'btn btn--secundario';
    probe.textContent = 'Testar';
    probe.style.marginTop = '12px';
    testKey.parentElement.after(probe);
    probe.onclick = () => {
      const target = $('#teste-chave');
      target.textContent = testKey.value.trim()
        ? 'A chave ficou só neste campo. Nada foi gravado. O agente entra na etapa 7.'
        : 'Informe uma chave só para ver a tela, ou pule este passo.';
      testKey.value = '';
    };
  }
}

async function nextStep() {
  if (state.step === 2) {
    if (!state.folder) {
      toast('Escolha a pasta da biblioteca.', 'erro');
      return;
    }
    try {
      const target =
        state.folderMode === 'criar'
          ? `${state.folder.replace(/\/$/, '')}/${(state.libraryNameInput || 'Biblioteca').trim()}`
          : state.folder;
      const opened =
        state.folderMode === 'criar'
          ? await sophy.createLibrary(target)
          : await (async () => {
              const response = await sophy.tool('library.open', { path: state.folder });
              if (!response.ok) throw new Error(response.error);
              await sophy.saveSettings({ libraryPath: response.value.root, onboarded: false });
              return { ok: true, value: response.value };
            })();
      if (!opened.ok) throw new Error(opened.error);
      state.libraryPath = opened.value.root;
      state.libraryName = opened.value.root.split(/[/\\]/).pop();
    } catch (error) {
      toast(error.message, 'erro');
      return;
    }
  }
  if (state.step === 4) {
    await finishOnboarding();
    return;
  }
  state.step += 1;
  paintOnboarding();
}

async function finishOnboarding() {
  const saved = await sophy.saveSettings({ onboarded: true, libraryPath: state.libraryPath });
  if (saved.ok) state.settings = { ...state.settings, ...saved.value };
  await showShell();
}

function paintShell() {
  $('#onboarding').hidden = true;
  const shell = $('#shell');
  shell.hidden = false;
  const logo = themeName() === 'dark' ? 'escuro' : 'claro';
  shell.innerHTML = `<header class="titulo">
      <div class="titulo__marca"><img alt="Sophy" src="ui/assets/logo/logo-horizontal-${logo}.svg" /></div>
      <div class="titulo__abas" role="tablist" id="abas"></div>
      <div class="titulo__acoes">
        <button type="button" class="btn btn--icone" id="busca" title="Buscar" aria-label="Buscar (Ctrl+K)">${icon('busca')}</button>
        <button type="button" class="btn btn--icone" id="ver-grafo" title="Grafo" aria-label="Mostrar grafo">${icon('grafo')}</button>
        <button type="button" class="btn btn--icone" id="tema" title="Tema" aria-label="Alternar tema">${icon(themeName() === 'dark' ? 'tema-claro' : 'tema-escuro')}</button>
        ${windowButtons()}
      </div>
    </header>
    <div class="miolo">
      <aside class="lateral" id="lateral">
        <div class="lateral__topo">
          <button type="button" class="biblioteca-seletor" id="seletor-biblioteca" aria-haspopup="menu" aria-label="Bibliotecas">
            ${icon('biblioteca')}<span class="biblioteca-seletor__nome">${escapeHtml(state.libraryName || 'Biblioteca')}</span>${icon('alternar')}
          </button>
        </div>
        <div class="lateral__acoes">
          <button type="button" class="btn btn--secundario" id="novo" aria-haspopup="menu">${icon('novo')} Novo</button>
        </div>
        <nav class="lateral__nav" aria-label="Seções">
          <button type="button" data-nav="inicio">${icon('inicio')} Início</button>
          <button type="button" data-nav="hoje">${icon('nota-diaria')} Hoje</button>
          <button type="button" data-nav="tarefas">${icon('lista-tarefas')} Tarefas</button>
          <button type="button" data-nav="calendario">${icon('calendario')} Calendário</button>
          <button type="button" data-nav="grafo">${icon('grafo')} Grafo</button>
          <button type="button" data-nav="canvas">${icon('canvas')} Canvas</button>
        </nav>
        <div class="lateral__busca"><input id="filtro-arvore" type="search" placeholder="Filtrar a árvore" aria-label="Filtrar a árvore" /></div>
        <div id="arvore"></div>
      </aside>
      <main class="centro" id="centro"></main>
      <aside class="conexoes painel" id="conexoes"></aside>
    </div>
    <footer class="status">
      <span id="st-caminho"></span>
      <span id="st-palavras"></span>
      <span id="st-estado">Pronta</span>
      <span class="status__fim" id="st-tema"></span>
    </footer>`;
  $('#busca').onclick = () => openPalette();
  $('#ver-grafo').onclick = () => showGraph();
  $('#tema').onclick = () => toggleTheme();
  bindWindow(shell);
  $('#novo').onclick = (event) => openNewMenu(event.currentTarget);
  $('#seletor-biblioteca').onclick = (event) => openLibraryMenu(event.currentTarget);
  shell.querySelectorAll('[data-nav]').forEach((button) => {
    button.onclick = () => runCommand(button.dataset.nav === 'inicio' ? 'inicio' : button.dataset.nav);
  });
  $('#filtro-arvore').oninput = () => paintTree();
  paintTree();
  paintCenter();
  paintLinks();
  paintStatus();
}

async function showShell() {
  await refreshLibrary();
  paintShell();
}

async function refreshLibrary() {
  const opened = await tool('library.open', {});
  state.libraryPath = opened.root;
  state.libraryName = opened.root.split(/[/\\]/).pop();
  state.workspaces = opened.workspaces || [];
  state.notes = await tool('note.list', {});
  const files = await tool('file.list', {});
  state.canvases = files.filter((file) => file.kind === 'canvas');
}

function treeNotes(workspace) {
  return state.notes.filter((note) => note.workspace === workspace);
}

function paintTree() {
  const filter = ($('#filtro-arvore')?.value || '').trim().toLocaleLowerCase();
  const host = $('#arvore');
  if (!host) return;
  const shelves = state.workspaces
    .map((workspace) => {
      const mark = Cmd.shelfMark(workspace.name);
      const notes = treeNotes(workspace.name).filter(
        (note) => !filter || note.path.toLocaleLowerCase().includes(filter),
      );
      if (filter && notes.length === 0 && !workspace.name.toLocaleLowerCase().includes(filter))
        return '';
      const color = mark.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
      const children = notes
        .map((note) => {
          const label =
            state.renaming?.kind === 'note' && state.renaming.path === note.path
              ? `<input class="arvore__renomear" data-rename="note" value="${escapeHtml(baseName(note.path))}" aria-label="Nome da nota" />`
              : `<span class="arvore__nome">${escapeHtml(baseName(note.path))}</span>`;
          return `<li role="treeitem"><button type="button" class="arvore__linha" style="--nivel:${Cmd.noteIndent(note.path)}" data-open="${escapeHtml(note.path)}" aria-selected="${Cmd.treeMarked('note', note.path, state)}">
            ${icon('nota')}${label}</button></li>`;
        })
        .join('');
      const boards = state.canvases
        .filter((file) => file.workspace === workspace.name)
        .filter((file) => !filter || file.path.toLocaleLowerCase().includes(filter))
        .map(
          (file) =>
            `<li role="treeitem"><button type="button" class="arvore__linha" style="--nivel:${Cmd.noteIndent(file.path)}" data-canvas="${escapeHtml(file.path)}" aria-selected="${Cmd.treeMarked('canvas', file.path, state)}">${icon('canvas')}<span class="arvore__nome">${escapeHtml(baseName(file.path))}</span></button></li>`,
        )
        .join('');
      const shelfLabel =
        state.renaming?.kind === 'shelf' && state.renaming.name === workspace.name
          ? `<input class="arvore__renomear" data-rename="shelf" value="${escapeHtml(workspace.name)}" aria-label="Nome da estante" />`
          : `<span class="arvore__nome">${escapeHtml(workspace.name)}</span>`;
      return `<li role="treeitem"><button type="button" class="arvore__linha" data-shelf="${escapeHtml(workspace.name)}" aria-selected="${Cmd.treeMarked('shelf', workspace.name, state)}" aria-expanded="true"${color}>
          ${icon('chevron-direita', 'arvore__seta')}${icon(mark.icon, 'icon--estante')}${shelfLabel}
          <span class="arvore__conta">${notes.length}</span></button><ul role="group">${children}${boards}</ul></li>`;
    })
    .join('');
  const loose = treeNotes(null)
    .filter((note) => !filter || note.path.toLocaleLowerCase().includes(filter))
    .map(
      (
        note,
      ) => `<li><button type="button" class="arvore__linha" data-open="${escapeHtml(note.path)}" aria-selected="${Cmd.treeMarked('note', note.path, state)}">
        ${icon('nota')}<span class="arvore__nome">${escapeHtml(baseName(note.path))}</span></button></li>`,
    )
    .join('');
  const draft = state.namingShelf
    ? `<li role="treeitem"><div class="arvore__linha">${icon('estante')}<input class="arvore__renomear" id="nome-estante" aria-label="Nome da estante" /></div></li>`
    : '';
  const name = host.parentElement?.querySelector('.biblioteca-seletor__nome');
  if (name) name.textContent = state.libraryName || 'Biblioteca';
  host.innerHTML = `<ul class="arvore" role="tree">${shelves}${loose}${draft}</ul>`;
  host.querySelectorAll('[data-open]').forEach((button) => {
    button.draggable = true;
    button.ondragstart = (event) => event.dataTransfer.setData('text/plain', button.dataset.open);
    button.onclick = () => {
      state.selectedShelf = button.dataset.open.includes('/')
        ? button.dataset.open.split('/')[0]
        : null;
      openNote(button.dataset.open);
    };
  });
  host.querySelectorAll('[data-canvas]').forEach((button) => {
    button.onclick = () => openCanvas(button.dataset.canvas);
  });
  host.querySelectorAll('[data-shelf]').forEach((button) => {
    button.onclick = (event) => {
      if (event.target.closest('input')) return;
      state.treeFocus = 'shelf';
      state.selectedShelf = button.dataset.shelf;
      paintTree();
    };
  });
  bindNameField(
    host.querySelector('#nome-estante'),
    async (name) => {
      await tool('workspace.create', { name });
      state.namingShelf = false;
      state.selectedShelf = name;
      await refreshLibrary();
      paintTree();
    },
    () => {
      state.namingShelf = false;
      paintTree();
    },
  );
  const noteRename = host.querySelector('[data-rename="note"]');
  if (noteRename) {
    bindNameField(
      noteRename,
      async (name) => {
        const from = state.renaming.path;
        const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
        state.renaming = null;
        const to = `${folder}${name}.md`;
        if (to !== from) await tool('entry.move', { from, to });
        await refreshLibrary();
        await openNote(to);
      },
      () => {
        state.renaming = null;
        paintTree();
      },
    );
  }
  const rename = host.querySelector('[data-rename="shelf"]');
  if (rename) {
    bindNameField(
      rename,
      async (name) => {
        const from = state.renaming.name;
        state.renaming = null;
        if (name !== from) await tool('entry.move', { from, to: name });
        state.selectedShelf = name;
        await refreshLibrary();
        paintTree();
      },
      () => {
        state.renaming = null;
        paintTree();
      },
    );
  }
}

function bindNameField(input, confirm, cancel) {
  if (!input) return;
  input.focus();
  input.select();
  input.onclick = (event) => event.stopPropagation();
  input.onkeydown = async (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      try {
        await confirm(name);
      } catch (error) {
        toast(error.message, 'erro');
      }
    }
  };
}

function paintTabs() {
  const host = $('#abas');
  if (!host) return;
  host.innerHTML = state.tabs
    .map(
      (
        file,
      ) => `<button type="button" class="aba" role="tab" aria-selected="${file === state.active}" data-tab="${escapeHtml(file)}">
        ${icon('nota')}<span>${escapeHtml(baseName(file))}</span></button>`,
    )
    .join('');
  host.querySelectorAll('[data-tab]').forEach((button) => {
    button.onclick = () =>
      button.dataset.tab.toLowerCase().endsWith('.canvas')
        ? openCanvas(button.dataset.tab)
        : openNote(button.dataset.tab);
  });
}

function paintCenter() {
  const center = $('#centro');
  if (!center) return;
  if (state.view === 'soon') {
    center.innerHTML = `<div class="vazio-ensina"><h2>${escapeHtml(state.soonTitle || 'Em seguida')}</h2><p>Esta tela entra na próxima etapa. As notas continuam Markdown.</p></div>`;
    return;
  }
  if (state.view === 'graph') {
    paintGraph(center);
    return;
  }
  if (state.view === 'canvas') {
    center.innerHTML = '';
    const board = document.createElement('div');
    board.tabIndex = 0;
    center.append(board);
    SophyCanvas.mount(board, {
      document: state.canvasDoc || { nodes: [], edges: [] },
      notes: state.notes.map((note) => ({ path: note.path, title: baseName(note.path) })),
      preview: (file) =>
        state.canvasPreviews[file] || state.canvasPreviews[file?.replace(/\.md$/i, '')],
      shelf: (file) => {
        const parts = String(file || '').split('/');
        return parts.length > 1 ? Cmd.shelfMark(parts[0]) : null;
      },
      icon,
      nextId: () => Math.random().toString(16).slice(2, 10),
      openNote: (file) => openNote(file).catch((error) => toast(error.message, 'erro')),
      onChange: (document) => saveCanvas(document),
      undo: () => undoCanvas(),
      redo: () => redoCanvas(),
    });
    if (state.canvasSelect) {
      board.focus();
    }
    return;
  }
  if (!state.active || !state.doc) {
    const emptyLibrary = !state.notes.length;
    center.innerHTML = emptyLibrary
      ? `<div class="vazio-ensina"><img alt="" src="ui/assets/ilustracoes/biblioteca-vazia-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" width="200" /><h2>Esta biblioteca ainda não tem notas</h2><p>Crie a primeira pelo botão Novo, ou abra uma pasta que já tenha Markdown.</p><div class="vazio-ensina__atalhos"><span><kbd class="kbd">Ctrl N</kbd> nova nota</span><span><kbd class="kbd">Ctrl K</kbd> buscar</span><span><kbd class="kbd">/</kbd> blocos</span></div></div>`
      : `<div class="vazio-ensina"><h2>Escolha uma nota</h2><p>Ou crie uma com Novo. O arquivo continua Markdown puro.</p></div>`;
    return;
  }
  const conflict = state.conflict
    ? `<div class="aviso" role="alert">${icon('erro')} <span>A nota mudou desde a leitura. Nada foi gravado.</span> <button type="button" class="btn btn--secundario" id="recarregar">Recarregar</button></div>`
    : '';
  const chips = tagChips(state.frontmatter);
  const crumb = noteCrumb(state.active);
  const firstIsTitle = state.doc.blocks[0]?.type === 'heading';
  const title = firstIsTitle ? renderBlock(state.doc.blocks[0], 0) : '';
  const blocks = state.doc.blocks
    .slice(firstIsTitle ? 1 : 0)
    .map((block, index) => renderBlock(block, index + (firstIsTitle ? 1 : 0)))
    .join('');
  center.innerHTML = `${conflict}<article class="coluna" id="coluna"><p class="nota__caminho">${crumb}</p>${title}<div class="nota__meta">${chips}</div>${blocks}</article>`;
  const reload = $('#recarregar');
  if (reload) reload.onclick = () => openNote(state.active, { force: true });
  $('#coluna')
    .querySelectorAll('[data-block]')
    .forEach((el) => bindBlock(el));
  $('#coluna')
    .querySelectorAll('[data-mais]')
    .forEach((button) => {
      button.onclick = () => insertBlockBelow(Number(button.dataset.mais));
  });
  $('#coluna')
    ?.querySelectorAll('[data-menu]')
    .forEach((button) => {
      button.onclick = () => openSlashAt(Number(button.dataset.menu));
    });
  $('#coluna')
    .querySelectorAll('[data-target]')
    .forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        followLink(link.dataset.target);
      });
    });
  $('#coluna')
    .querySelectorAll('[data-task]')
    .forEach((button) => {
      button.onclick = () => cycleTask(Number(button.dataset.task));
    });
  if (state.caret) {
    const caret = state.caret;
    state.caret = null;
    const target = document.querySelector(`[data-block="${caret.index}"]`);
    if (target) placeCaret(target, caret.offset);
  }
  if (state.selectTitle) {
    state.selectTitle = false;
    const title = $('#coluna .bloco--titulo');
    if (title) {
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

function renderBlock(block, index) {
  if (block.type === 'blank')
    return `<div class="bloco" data-vazio data-block="${index}" contenteditable="true"><br /></div>`;
  if (block.type === 'hr') return `<hr data-block="${index}" />`;
  if (block.type === 'heading') {
    const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
    return `<h${Math.min(block.level, 6)} class="bloco bloco--titulo bloco--titulo${block.level}" data-block="${index}" contenteditable="true">${escapeHtml(text)}</h${Math.min(block.level, 6)}>`;
  }
  if (block.type === 'code') {
    const inner = block.raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```\n?$/, '');
    return `<pre class="bloco bloco--codigo" data-block="${index}" contenteditable="true">${escapeHtml(inner)}</pre>`;
  }
  if (block.type === 'task' && block.task) {
    const task = block.task;
    const kit = Cmd.kitTaskStatus(task.status);
    const chips = [
      task.due
        ? `<span class="chip">${icon('calendario', 'icon--16')}${escapeHtml(task.due)}</span>`
        : '',
      task.priority === 'alta'
        ? `<span class="chip chip--alta">${icon('prioridade-alta', 'icon--16')}Alta</span>`
        : '',
      task.priority === 'media'
        ? `<span class="chip chip--media">${icon('prioridade-media', 'icon--16')}Média</span>`
        : '',
      task.priority === 'baixa'
        ? `<span class="chip chip--baixa">${icon('prioridade-baixa', 'icon--16')}Baixa</span>`
        : '',
    ].join('');
    return `<div class="${Cmd.taskBlockClass(task.status)}">
      <button type="button" class="check" data-task="${index}" data-status="${kit}" aria-label="Alternar tarefa"></button>
      <div class="tarefa__texto" data-block="${index}" contenteditable="true">${escapeHtml(task.title)}</div>
      <div class="tarefa__meta">${chips}</div></div>`;
  }
  if (block.type === 'item') {
    const marker = block.raw.match(/^\s*(\d+)\./);
    const text = block.raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
    const ordem = marker ? ` data-ordem="${marker[1]}"` : '';
    return `<div class="bloco bloco--item" data-block="${index}"${ordem} contenteditable="true">${inlineHtml(text)}</div>`;
  }
  if (block.type === 'quote') {
    const text = block.raw
      .split('\n')
      .map((line) => line.replace(/^>\s?/, ''))
      .join('\n')
      .replace(/\n$/, '');
    return `<blockquote class="bloco bloco--citacao" data-block="${index}" contenteditable="true">${inlineHtml(text)}</blockquote>`;
  }
  const embed = block.raw.trim().match(/^!\[\[([^\]\n]+)\]\]$/);
  if (embed) {
    return `<figure class="embed" data-embed="${escapeHtml(embed[1])}"><div class="embed__caminho">${escapeHtml(embed[1])}</div><div class="embed__corpo">…</div></figure>`;
  }
  const text = block.raw.replace(/\n$/, '');
    const empty = text.trim() === '';
    const hint = empty ? ' data-dica="1" data-placeholder="Digite / para comandos ou [[ para ligar uma nota"' : '';
    return `<div class="bloco-linha"><div class="bloco-alca"><button type="button" class="bloco-alca__btn bloco__mais" data-mais="${index}" aria-label="Inserir bloco abaixo">${icon('mais')}</button><button type="button" class="bloco-alca__btn bloco-alca__btn--arrastar" data-menu="${index}" aria-label="Mover ou abrir o menu do bloco">${icon('arrastar')}</button></div><p class="bloco bloco--texto" data-block="${index}"${hint} contenteditable="true">${inlineHtml(text) || '<br>'}</p></div>`;
}

function inlineHtml(text) {
  return Doc.parseInlines(text)
    .map((part) => {
      if (part.type === 'text') return escapeHtml(part.text);
      const broken = state.outgoing.some(
        (link) =>
          link.raw === part.raw && (link.status === 'broken' || link.status === 'ambiguous'),
      );
      const cls =
        part.type === 'wikilink' ? `wikilink${broken ? ' wikilink--quebrado' : ''}` : 'wikilink';
      return `<a href="#" class="${cls}" contenteditable="false" data-raw="${escapeHtml(part.raw)}" data-target="${escapeHtml(part.target)}">${escapeHtml(part.label)}</a>`;
    })
    .join('');
}

function bindBlock(el) {
  el.addEventListener('input', () => onBlockInput(el));
  el.addEventListener('keydown', (event) => onBlockKey(event, el));
  el.addEventListener('paste', (event) => onBlockPaste(event, el));
  el.addEventListener('blur', () => {
    if (state.wrapping) return;
    closeMenus();
    const index = Number(el.dataset.block);
    state.doc = Doc.withBlockRaw(state.doc, index, rawFromEditor(el, state.doc.blocks[index]));
    paintCenter();
  });
}

function rawFromEditor(el, block) {
  const ending = block.raw.endsWith('\n') ? '\n' : '';
  if (block.type === 'heading') {
    const marks = '#'.repeat(block.level || 1);
    return `${marks} ${el.textContent.replace(/\n/g, ' ').trim()}${ending || '\n'}`;
  }
  if (block.type === 'code') {
    const lang = (block.raw.match(/^```([^\n]*)/) || [, ''])[1];
    return '```' + lang + '\n' + el.textContent.replace(/\n$/, '') + '\n```\n';
  }
  if (block.type === 'task' && block.task) {
    const task = { ...block.task, title: el.textContent.replace(/\n/g, ' ').trim() };
    return Doc.serializeTask(task) + (block.raw.endsWith('\n') ? '\n' : '\n');
  }
  if (block.type === 'item') {
    const marker = (block.raw.match(/^\s*(?:[-*+]|\d+\.)/) || ['-'])[0];
    return `${marker} ${readEditable(el).trim()}\n`;
  }
  if (block.type === 'quote') {
    const lines = readEditable(el).split('\n');
    return lines.map((line) => `> ${line}`).join('\n') + '\n';
  }
  return readEditable(el).replace(/\n$/, '') + '\n';
}

function readEditable(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    else if (node.dataset && node.dataset.raw) text += node.dataset.raw;
    else if (node.tagName === 'BR') text += '\n';
    else if (node.tagName === 'DIV' || node.tagName === 'P') text += `\n${node.textContent}`;
    else text += node.textContent;
  }
  return text;
}

function onBlockInput(el) {
  if (state.conflict) return;
  const index = Number(el.dataset.block);
  const raw = rawFromEditor(el, state.doc.blocks[index]);
  state.doc = Doc.withBlockRaw(state.doc, index, raw);
  const cursor = modelOffset(el);
  const text = readEditable(el);
  const found = slash.offer(text, cursor);
  const wiki = Cmd.wikiQuery(text, cursor);
  if (found) showSlash(el, found);
  else if (wiki) showWiki(el, wiki);
  else closeMenus();
  scheduleSave();
  paintStatus();
}

function onBlockKey(event, el) {
  const menu = $('.menu-flutuante');
  if (event.key === 'Escape') {
    const text = readEditable(el);
    slash.dismiss(text, modelOffset(el));
    closeMenus();
    event.preventDefault();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveNow();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    formatBlock(el, '**', '**');
    return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'i') {
    event.preventDefault();
    formatBlock(el, '*', '*');
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'x') {
    event.preventDefault();
    formatBlock(el, '~~', '~~');
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    formatBlock(el, '==', '==');
    return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    formatBlock(el, '[', '](https://)');
    return;
  }
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    runCommand('sofi');
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    const index = Number(el.dataset.block);
    const text = readEditable(el).replace(/\n$/, '');
    state.doc = Doc.withBlockRaw(state.doc, index, `- [ ] ${text}\n`);
    paintCenter();
    scheduleSave();
    return;
  }
  if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter')) {
    const items = [...menu.querySelectorAll('[role="option"], .menu__item')];
    const current = items.findIndex((item) => item.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
      items.forEach((item, position) =>
        item.setAttribute(
          'aria-selected',
          position === (next + items.length) % items.length ? 'true' : 'false',
        ),
      );
    }
    if (event.key === 'Enter' && current >= 0) {
      event.preventDefault();
      items[current].click();
    }
    return;
  }
  const index = Number(el.dataset.block);
  if (event.key === 'Enter') {
    event.preventDefault();
    const offset = modelOffset(el);
    const result = event.shiftKey
      ? Doc.insertInBlock(state.doc, index, offset, '\n')
      : Doc.splitBlock(state.doc, index, offset);
    state.doc = result.doc;
    state.caret = result.caret;
    paintCenter();
    scheduleSave();
    return;
  }
  if (event.key === 'Backspace' && modelOffset(el) === 0 && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    const result = Doc.joinBlocks(state.doc, index);
    state.doc = result.doc;
    state.caret = result.caret;
    paintCenter();
    scheduleSave();
  }
}

function onBlockPaste(event, el) {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  const index = Number(el.dataset.block);
  const offset = modelOffset(el);
  const result = text.includes('\n')
    ? Doc.pasteLines(state.doc, index, offset, text)
    : Doc.insertInBlock(state.doc, index, offset, text);
  state.doc = result.doc;
  state.caret = result.caret;
  paintCenter();
  scheduleSave();
}

function formatBlock(el, prefix, suffix) {
  const index = Number(el.dataset.block);
  const range = selectionOffsets(el);
  const result = Doc.wrapBlock(state.doc, index, range.start, range.end, prefix, suffix);
  state.wrapping = true;
  state.doc = result.doc;
  state.caret = result.caret;
  setTimeout(() => {
    paintCenter();
    saveNow();
    state.wrapping = false;
  }, 0);
}

function selectionOffsets(el) {
  const selection = getSelection();
  if (!selection?.rangeCount) {
    const end = readEditable(el).length;
    return { start: end, end };
  }
  const range = selection.getRangeAt(0);
  const start = offsetAt(el, range.startContainer, range.startOffset);
  const end = offsetAt(el, range.endContainer, range.endOffset);
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function offsetAt(el, node, offset) {
  let count = 0;
  let found = false;
  const walk = (current) => {
    if (found) return;
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) count += Math.min(offset, current.textContent.length);
      found = true;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      count += current.textContent.length;
      return;
    }
    if (current.dataset && current.dataset.raw) {
      count += current.dataset.raw.length;
      if (current.contains(node)) found = true;
      return;
    }
    if (current.tagName === 'BR') count += 1;
    for (const child of current.childNodes) walk(child);
  };
  walk(el);
  return count;
}

function placeCaret(el, offset) {
  el.focus();
  const selection = getSelection();
  const range = document.createRange();
  let left = offset;
  const walk = (current) => {
    if (left < 0) return true;
    if (current.nodeType === Node.TEXT_NODE) {
      if (left <= current.textContent.length) {
        range.setStart(current, left);
        range.collapse(true);
        left = -1;
        return true;
      }
      left -= current.textContent.length;
      return false;
    }
    if (current.dataset && current.dataset.raw) {
      left -= current.dataset.raw.length;
      return false;
    }
    if (current.tagName === 'BR') {
      left -= 1;
      return false;
    }
    for (const child of current.childNodes) {
      if (walk(child)) return true;
    }
    return false;
  };
  if (!walk(el)) {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function showSlash(el, found) {
  const items = Cmd.filterSlash(Cmd.SLASH_ITEMS, found.query);
  openMenu(el, 'menu menu--blocos menu-flutuante', renderSlash(items), (item) => {
    insertAt(
      el,
      found.start,
      found.start + 1 + found.query.length,
      item.id === 'hoje' ? today() : item.insert,
    );
  });
}

function renderSlash(items) {
  let last = '';
  return items
    .map((item) => {
      const group = item.group !== last ? `<div class="menu__grupo">${item.group}</div>` : '';
      last = item.group;
      return `${group}<button type="button" class="menu__item" data-id="${item.id}" role="option"><span class="menu__caixa">${icon(item.icon)}</span>${escapeHtml(item.label)}${item.hint ? `<span class="menu__atalho">${escapeHtml(item.hint)}</span>` : ''}</button>`;
    })
    .join('');
}

function showWiki(el, found) {
  const needle = found.query.toLocaleLowerCase();
  const matches = state.notes
    .filter(
      (note) =>
        !needle ||
        note.path.toLocaleLowerCase().includes(needle) ||
        baseName(note.path).toLocaleLowerCase().includes(needle),
    )
    .slice(0, 8);
  const rows = matches
    .map((note) => {
      const title = highlight(baseName(note.path), found.query);
      return `<button type="button" class="menu__item" role="option" data-insert="[[${escapeHtml(note.path.replace(/\.md$/i, ''))}]]">
        ${icon('nota')}<span><span class="menu__titulo">${title}</span><span class="menu__caminho">${escapeHtml(note.workspace || 'Biblioteca')}</span></span></button>`;
    })
    .join('');
  const create = `<button type="button" class="menu__item" role="option" data-create="${escapeHtml(found.query)}">${icon('nota-nova')} Criar nota “${escapeHtml(found.query || 'sem título')}”</button>`;
  openMenu(el, 'menu menu--wiki menu-flutuante', rows + create, (button) => {
    if (button.dataset.create != null) {
      createFromWiki(el, found, button.dataset.create);
      return;
    }
    insertAt(el, found.start, found.start + 2 + found.query.length, button.dataset.insert);
  });
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
}

function openMenu(anchor, className, html, onPick) {
  closeMenus();
  if (!html) return;
  const menu = document.createElement('div');
  menu.className = className;
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = html;
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  const first = menu.querySelector('.menu__item');
  if (first) first.setAttribute('aria-selected', 'true');
  menu.querySelectorAll('.menu__item').forEach((button) => {
    button.onclick = () =>
      onPick(
        button.dataset.id ? Cmd.SLASH_ITEMS.find((item) => item.id === button.dataset.id) : button,
      );
  });
}

function closeMenus() {
  document.querySelectorAll('.menu-flutuante').forEach((menu) => menu.remove());
}

function insertAt(el, start, end, text) {
  const index = Number(el.dataset.block);
  const current = readEditable(el);
  const next = current.slice(0, start) + text + current.slice(end);
  const block = state.doc.blocks[index];
  const raw = rawFromPlain(block, next);
  state.doc = Doc.withBlockRaw(state.doc, index, raw);
  slash.reset();
  closeMenus();
  paintCenter();
  scheduleSave();
}

function rawFromPlain(block, text) {
  if (block.type === 'heading')
    return `${'#'.repeat(block.level || 1)} ${text.replace(/\n/g, ' ')}\n`;
  if (block.type === 'quote')
    return (
      text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n') + '\n'
    );
  if (block.type === 'item') {
    const marker = (block.raw.match(/^\s*(?:[-*+]|\d+\.)/) || ['-'])[0];
    return `${marker} ${text}\n`;
  }
  if (block.type === 'code') return block.raw;
  return `${text.replace(/\n$/, '')}\n`;
}

function modelOffset(el) {
  const selection = getSelection();
  if (!selection.rangeCount) return readEditable(el).length;
  const node = selection.anchorNode;
  const offset = selection.anchorOffset;
  let count = 0;
  let found = false;
  const walk = (current) => {
    if (found) return;
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE)
        count += Math.min(offset, current.textContent.length);
      found = true;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      count += current.textContent.length;
      return;
    }
    if (current.dataset && current.dataset.raw) {
      if (current.contains(node)) {
        count += current.dataset.raw.length;
        found = true;
        return;
      }
      count += current.dataset.raw.length;
      return;
    }
    for (const child of current.childNodes) walk(child);
  };
  walk(el);
  return count;
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function cycleTask(index) {
  const block = state.doc.blocks[index];
  if (!block || !block.task) return;
  const order = [' ', '/', 'x'];
  const next = order[(order.indexOf(block.task.status) + 1) % order.length];
  state.doc = Doc.withBlockRaw(state.doc, index, Doc.setTaskStatus(block.raw, next));
  paintCenter();
  scheduleSave();
}

async function followLink(target) {
  if (!target) return;
  const resolved = state.outgoing.find(
    (link) => link.status === 'resolved' && (link.raw || '').includes(target),
  );
  const path = resolved?.path || (target.endsWith('.md') ? target : `${target}.md`);
  try {
    await openNote(path);
  } catch {
    toast('Não encontrei essa nota.', 'erro');
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  const status = $('#st-estado');
  if (status) status.textContent = 'Alterações locais';
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  if (!state.active || !state.doc || state.conflict) return;
  const body = state.doc.blocks.map((block) => block.raw).join('');
  try {
    const result = await tool('note.write', {
      path: state.active,
      body,
      expectedRevision: state.revision,
      origin: 'mcp',
      libraryPath: '/outra',
    });
    if (result.conflict) {
      state.conflict = true;
      paintCenter();
      paintStatus();
      return;
    }
    state.revision = result.note.revision;
    state.conflict = false;
    const status = $('#st-estado');
    if (status) status.textContent = 'Salvo';
    state.notes = await tool('note.list', {});
    await loadLinks();
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function openCanvas(file) {
  const canvas = await tool('canvas.read', { path: file });
  state.view = 'canvas';
  state.treeFocus = 'canvas';
  state.canvasPath = canvas.path;
  state.canvasDoc = canvas.document;
  state.canvasRevision = canvas.revision;
  state.canvasPreviews = {};
  state.active = null;
  for (const node of canvas.document.nodes || []) {
    if (node.type !== 'file' || typeof node.file !== 'string') continue;
    const notePath = node.file.toLowerCase().endsWith('.md') ? node.file : `${node.file}.md`;
    try {
      const note = await tool('note.read', { path: notePath });
      const preview = {
        title: baseName(note.path),
        html: Cmd.notePreviewHtml(note.body),
        path: note.path,
      };
      state.canvasPreviews[node.file] = preview;
      state.canvasPreviews[note.path] = preview;
    } catch {
      /* o cartão mostra o caminho mesmo sem a nota */
    }
  }
  if (!state.tabs.includes(canvas.path)) state.tabs.push(canvas.path);
  paintTabs();
  paintTree();
  paintCenter();
  paintStatus();
}

let keepCanvasRedo = false;

async function saveCanvas(document) {
  if (!state.canvasPath) return;
  const result = await tool('canvas.update', {
    path: state.canvasPath,
    document,
    expectedRevision: state.canvasRevision,
  });
  if (result.conflict) {
    state.conflict = true;
    toast('O canvas mudou desde a leitura. Nada foi gravado.', 'erro');
    return;
  }
  if (!keepCanvasRedo) state.canvasRedo = [];
  state.conflict = false;
  state.canvasRevision = result.canvas.revision;
  state.canvasDoc = result.canvas.document;
  const status = $('#st-estado');
  if (status) status.textContent = 'Salvo';
}

async function undoCanvas() {
  if (!state.canvasPath) return;
  try {
    state.canvasRedo.push(structuredClone(state.canvasDoc));
    await tool('history.undo', {});
    await openCanvas(state.canvasPath);
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function redoCanvas() {
  const document = state.canvasRedo.pop();
  if (!document || !state.canvasPath) return;
  keepCanvasRedo = true;
  try {
    await saveCanvas(document);
  } finally {
    keepCanvasRedo = false;
  }
  await openCanvas(state.canvasPath);
}

async function openNote(file, options = {}) {
  if (state.active && state.doc && !state.conflict && state.active !== file) await saveNow();
  const note = await tool('note.read', { path: file });
  state.active = note.path;
  state.treeFocus = 'note';
  state.view = 'note';
  state.doc = Doc.parseDocument(note.body);
  state.revision = note.revision;
  state.frontmatter = note.frontmatter;
  state.conflict = false;
  if (!state.tabs.includes(note.path) || options.force) {
    if (!state.tabs.includes(note.path)) state.tabs.push(note.path);
  }
  await loadLinks();
  paintTabs();
  paintTree();
  paintCenter();
  paintLinks();
  paintStatus();
  fillEmbeds();
}

async function loadLinks() {
  if (!state.active) return;
  try {
    state.outgoing = await tool('links.outgoing', { path: state.active });
  } catch {
    state.outgoing = [];
  }
  try {
    state.backlinks = await tool('links.backlinks', { path: state.active });
  } catch {
    state.backlinks = [];
  }
}

async function fillEmbeds() {
  const column = $('#coluna');
  if (!column) return;
  for (const figure of column.querySelectorAll('[data-embed]')) {
    const target = figure.dataset.embed;
    const path = target.endsWith('.md') ? target : `${target}.md`;
    try {
      const note = await tool('note.read', { path });
      figure.querySelector('.embed__corpo').textContent = note.body.slice(0, 400);
    } catch {
      figure.querySelector('.embed__corpo').textContent = 'Anexo ou nota ainda não encontrada.';
    }
  }
}

function paintLinks() {
  const host = $('#conexoes');
  if (!host) return;
  if (!state.active) {
    host.innerHTML =
      '<h3>Conexões</h3><p class="nota-privacidade">Abra uma nota para ver os links.</p>';
    return;
  }
  const out =
    state.outgoing
      .map(
        (link) =>
          `<button type="button" class="link ${link.status === 'resolved' ? '' : 'wikilink--quebrado'}" data-go="${escapeHtml(link.path || '')}">${escapeHtml(link.display || link.path || link.raw || 'link')}</button>`,
      )
      .join('') || '<p class="nota-privacidade">Nenhum link de saída.</p>';
  const back =
    state.backlinks
      .map(
        (link) =>
          `<button type="button" class="link" data-go="${escapeHtml(link.from)}">${escapeHtml(baseName(link.from))}</button>`,
      )
      .join('') || '<p class="nota-privacidade">Nenhuma nota aponta para cá.</p>';
  host.innerHTML = `<p class="nota__caminho">${noteCrumb(state.active)}</p><h3>${escapeHtml(baseName(state.active))}</h3><h3>Links de saída</h3>${out}<h3>Backlinks</h3>${back}
    <h3>Histórico</h3><button type="button" class="btn btn--fantasma" id="desfazer">${icon('desfazer')} Desfazer</button>`;
  host.querySelectorAll('[data-go]').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.go) openNote(button.dataset.go);
    };
  });
  $('#desfazer').onclick = async () => {
    try {
      await tool('history.undo', {});
      await refreshLibrary();
      if (state.active) await openNote(state.active, { force: true });
      else paintTree();
      toast('A última ação foi desfeita.');
    } catch (error) {
      toast(error.message, 'erro');
    }
  };
}

function paintStatus() {
  const path = $('#st-caminho');
  const words = $('#st-palavras');
  const theme = $('#st-tema');
  if (path) path.textContent = state.active || state.libraryName;
  if (words && state.doc) {
    const text = state.doc.blocks.map((block) => block.raw).join(' ');
    const count = text.trim() ? text.trim().split(/\s+/).length : 0;
    words.textContent = `${count} palavras`;
  }
  if (theme) theme.textContent = themeName() === 'dark' ? 'Escuro' : 'Claro';
  const estado = $('#st-estado');
  if (estado && state.conflict) estado.textContent = 'Conflito';
}

function openNewMenu(anchor) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = [
    ['nota', 'nota-nova', 'Nova nota'],
    ['estante', 'pasta-nova', 'Nova estante'],
    ['canvas', 'canvas', 'Novo canvas'],
    ['modelo', 'modelo', 'A partir de modelo'],
  ]
    .map(
      ([id, glyph, label]) =>
        `<button type="button" class="menu__item" role="menuitem" data-novo="${id}">${icon(glyph)} ${label}</button>`,
    )
    .join('');
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.querySelector('[data-novo="nota"]').onclick = () => {
    closeMenus();
    createNote();
  };
  menu.querySelector('[data-novo="estante"]').onclick = () => {
    closeMenus();
    createWorkspace();
  };
  menu.querySelector('[data-novo="canvas"]').onclick = () => {
    closeMenus();
    createCanvasFile();
  };
  menu.querySelector('[data-novo="modelo"]').onclick = () => {
    closeMenus();
    createFromTemplate();
  };
}

function runCommand(id) {
  const runs = {
    nota: () => createNote(),
    estante: () => createWorkspace(),
    canvas: () => createCanvasFile(),
    modelo: () => createFromTemplate(),
    buscar: () => openPalette(),
    comandos: () => openCommands(),
    biblioteca: () => {
      const anchor = document.querySelector('#seletor-biblioteca');
      if (anchor) openLibraryMenu(anchor);
    },
    grafo: () => showGraph(),
    hoje: () => openDaily(),
    inicio: () => {
      state.view = 'empty';
      state.active = null;
      state.treeFocus = 'shelf';
      paintTree();
      paintCenter();
      paintTabs();
    },
    tarefas: () => {
      state.view = 'soon';
      state.soonTitle = 'Tarefas';
      paintCenter();
    },
    calendario: () => {
      state.view = 'soon';
      state.soonTitle = 'Calendário';
      paintCenter();
    },
    sofi: () => toast('A Sofi entra com o agente. A chave fica no cofre do sistema, não na biblioteca.'),
  };
  runs[id]?.();
}

async function openDaily() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const path = `Diário/${iso}.md`;
  try {
    await tool('workspace.create', { name: 'Diário' });
  } catch {
    /* a estante já existe */
  }
  try {
    await tool('note.create', { path, body: `# ${iso}\n\n`, frontmatter: { data: iso } });
  } catch {
    /* a nota do dia já existe */
  }
  await refreshLibrary();
  await openNote(path);
}

async function createFromTemplate() {
  const models = state.notes.filter((note) => note.workspace === 'Modelos');
  if (!models.length) {
    toast('Guarde um Markdown em Modelos/. A galeria de modelos entra na etapa seguinte.');
    return;
  }
  const source = await tool('note.read', { path: models[0].path });
  const name = Cmd.uniqueTitle(state.notes.map((note) => baseName(note.path)), baseName(models[0].path));
  const path = `Entrada/${name}.md`;
  await tool('note.create', { path, body: source.body });
  await refreshLibrary();
  await openNote(path);
}

function insertBlockBelow(index) {
  const blocks = state.doc.blocks.slice();
  blocks.splice(index + 1, 0, { type: 'blank', raw: '\n' }, { type: 'paragraph', raw: '\n' });
  state.doc = { ...state.doc, blocks, body: blocks.map((block) => block.raw).join('') };
  state.caret = { index: index + 2, offset: 0 };
  paintCenter();
  const el = document.querySelector(`[data-block="${index + 2}"]`);
  if (el) showSlash(el, { start: 0, query: '' });
  scheduleSave();
}

function openLibraryMenu(anchor) {
  closeMenus();
  const recents = [...new Set([state.libraryPath, ...(state.settings.libraries || [])])].filter(Boolean);
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante';
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    recents
      .map((folder) => {
        const name = folder.split(/[/\\]/).pop();
        return `<button type="button" class="menu__item" role="menuitem" data-lib="${escapeHtml(folder)}" ${folder === state.libraryPath ? 'aria-selected="true"' : ''}>${icon('biblioteca')}<span>${escapeHtml(name)}</span></button>`;
      })
      .join('') +
    `<div class="menu__sep"></div>
    <button type="button" class="menu__item" role="menuitem" data-acao="nova">${icon('pasta-nova')} Nova biblioteca…</button>
    <button type="button" class="menu__item" role="menuitem" data-acao="abrir">${icon('pasta-aberta')} Abrir pasta…</button>
    <button type="button" class="menu__item menu__item--perigo" role="menuitem" data-acao="remover">${icon('lixeira')} Remover da lista</button>`;
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.querySelectorAll('[data-lib]').forEach((button) => {
    button.onclick = () => {
      closeMenus();
      switchLibrary(button.dataset.lib);
    };
  });
  menu.querySelector('[data-acao="nova"]').onclick = () => {
    closeMenus();
    chooseLibrary(true);
  };
  menu.querySelector('[data-acao="abrir"]').onclick = () => {
    closeMenus();
    chooseLibrary(false);
  };
  menu.querySelector('[data-acao="remover"]').onclick = () => {
    closeMenus();
    forgetLibrary();
  };
}

async function chooseLibrary(create) {
  const chosen = await sophy.chooseFolder();
  if (!chosen?.ok || !chosen.value) return;
  if (create) {
    const created = await sophy.createLibrary(chosen.value);
    if (!created.ok) {
      toast(created.error, 'erro');
      return;
    }
    await switchLibrary(created.value.root);
    return;
  }
  await switchLibrary(chosen.value);
}

async function switchLibrary(folder) {
  const response = await sophy.switchLibrary(folder);
  if (!response.ok) {
    toast(response.error, 'erro');
    return;
  }
  await applyLibrary(response.value.root, response.value.libraries);
}

async function forgetLibrary() {
  const response = await sophy.forgetLibrary(state.libraryPath);
  if (!response.ok) {
    toast(response.error, 'erro');
    return;
  }
  if (!response.value.libraryPath) {
    state.libraryPath = null;
    state.settings.libraries = response.value.libraries;
    state.settings.onboarded = false;
    paintOnboarding();
    return;
  }
  await switchLibrary(response.value.libraryPath);
}

async function applyLibrary(root, libraries) {
  state.libraryPath = root;
  state.libraryName = root.split(/[/\\]/).pop();
  state.settings.libraryPath = root;
  if (libraries) state.settings.libraries = libraries;
  state.tabs = [];
  state.active = null;
  state.doc = null;
  state.view = 'empty';
  state.selectedShelf = null;
  await refreshLibrary();
  paintTabs();
  paintTree();
  paintCenter();
  paintLinks();
  paintStatus();
}

function openSlashAt(index) {
  const el = document.querySelector(`[data-block="${index}"]`);
  if (!el) return;
  openMenu(el, 'menu menu--blocos menu-flutuante', renderSlash(Cmd.SLASH_ITEMS), (item) => {
    const insert = item.id === 'hoje' ? today() : item.insert;
    const text = readEditable(el).replace(/\n$/, '');
    const next = text.trim() ? `${insert}${text}` : insert;
    state.doc = Doc.withBlockRaw(state.doc, index, rawFromPlain(state.doc.blocks[index], next));
    closeMenus();
    paintCenter();
    scheduleSave();
  });
}

function applyWrap(index, selected, prefix, suffix = '') {
  const block = document.querySelector(`[data-block="${index}"]`);
  const text = block ? readEditable(block) : '';
  const at = text.indexOf(selected);
  if (!block || !selected || at < 0) return;
  const next = text.slice(0, at) + prefix + selected + suffix + text.slice(at + selected.length);
  state.wrapping = true;
  state.doc = Doc.withBlockRaw(state.doc, index, rawFromPlain(state.doc.blocks[index], next));
  setTimeout(() => {
    paintCenter();
    saveNow();
    state.wrapping = false;
  }, 0);
}

function showFormatBar(range) {
  document.querySelector('.barra-formato')?.remove();
  const host = range.startContainer.parentElement?.closest?.('[data-block]');
  const selected = range.toString();
  if (!host || !selected) return;
  const index = Number(host.dataset.block);
  const bar = document.createElement('div');
  bar.className = 'barra-formatacao barra-formato';
  bar.setAttribute('role', 'toolbar');
  bar.innerHTML = [
    ['Negrito', 'negrito', '**', '**'],
    ['Itálico', 'italico', '*', '*'],
    ['Link', 'link', '[', '](https://)'],
    ['Wikilink', 'nota', '[[', ']]'],
    ['Título', 'titulo', '# ', ''],
    ['Lista', 'lista', '- ', ''],
    ['Tarefa', 'tarefa', '- [ ] ', ''],
    ['Citação', 'citacao', '> ', ''],
    ['Código', 'codigo', '`', '`'],
    ['Riscado', 'tachado', '~~', '~~'],
    ['Destacar', 'marca-texto', '==', '=='],
  ]
    .map(
      ([label, glyph, prefix, suffix]) =>
        `<button type="button" class="btn btn--icone" data-prefix="${escapeHtml(prefix)}" data-suffix="${escapeHtml(suffix)}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`,
    )
    .join('');
  document.body.append(bar);
  const rect = range.getBoundingClientRect();
  bar.style.left = `${Math.max(8, rect.left)}px`;
  bar.style.top = `${Math.max(8, rect.top - 44)}px`;
  bar.querySelectorAll('button').forEach((button) => {
    button.onmousedown = (event) => {
      event.preventDefault();
      applyWrap(index, selected, button.dataset.prefix, button.dataset.suffix);
      bar.remove();
    };
  });
}

function openCommands() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  const commands = Cmd.COMMANDS.map((item) => [item.rotulo, item.atalho, () => runCommand(item.id)]).concat([
    ['Alternar tema', '', () => toggleTheme()],
    ['Nova biblioteca', '', () => chooseLibrary(true)],
    ['Abrir biblioteca', '', () => chooseLibrary(false)],
    ['Remover biblioteca da lista', '', () => forgetLibrary()],
  ]);
  overlay.innerHTML = `<div class="paleta" role="dialog" aria-label="Comandos">
    <div class="paleta__busca">${icon('busca')}<input id="comando-q" placeholder="Comandos" aria-label="Comandos" /></div>
    <div class="paleta__lista" id="comando-lista"></div>
    <div class="menu__rodape"><span><span class="kbd">Ctrl</span><span class="kbd">Shift</span><span class="kbd">P</span></span><span><span class="kbd">esc</span> fechar</span></div>
  </div>`;
  const input = $('#comando-q');
  const draw = () => {
    const needle = input.value.trim().toLocaleLowerCase();
    $('#comando-lista').innerHTML = commands
      .filter(([label]) => !needle || label.toLocaleLowerCase().includes(needle))
      .map(
        ([label, shortcut]) =>
          `<button type="button" class="menu__item" data-cmd="${escapeHtml(label)}"><span>${escapeHtml(label)}</span>${shortcut ? `<span class="menu__atalho">${escapeHtml(shortcut)}</span>` : ''}</button>`,
      )
      .join('');
    $('#comando-lista')
      .querySelectorAll('[data-cmd]')
      .forEach((button) => {
        button.onclick = () => {
          closePalette();
          commands.find(([label]) => label === button.dataset.cmd)?.[2]();
        };
      });
  };
  input.oninput = draw;
  input.onkeydown = (event) => {
    if (event.key === 'Escape') closePalette();
    if (event.key === 'Enter') $('#comando-lista .menu__item')?.click();
  };
  overlay.onclick = (event) => {
    if (event.target === overlay) closePalette();
  };
  draw();
  input.focus();
}

async function createCanvasFile() {
  const shelf =
    state.selectedShelf ||
    (state.canvasPath && state.canvasPath.includes('/') ? state.canvasPath.split('/')[0] : null) ||
    (state.active && state.active.includes('/') ? state.active.split('/')[0] : null) ||
    'Entrada';
  const taken = state.canvases
    .filter((file) => file.workspace === shelf)
    .map((file) => baseName(file.path));
  const name = Cmd.uniqueTitle(taken);
  const path = `${shelf}/${name}.canvas`;
  try {
    await tool('canvas.create', { path });
    state.selectedShelf = shelf;
    await refreshLibrary();
    await openCanvas(path);
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function createNote() {
  const shelf =
    state.selectedShelf ||
    (state.active && state.active.includes('/') ? state.active.split('/')[0] : null) ||
    'Entrada';
  const taken = state.notes
    .filter((note) => note.workspace === shelf)
    .map((note) => baseName(note.path));
  const name = Cmd.uniqueTitle(taken);
  const path = `${shelf}/${name}.md`;
  try {
    await tool('note.create', { path, body: `# ${name}\n` });
    state.selectedShelf = shelf;
    state.selectTitle = true;
    await refreshLibrary();
    await openNote(path);
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function createFromWiki(el, found, title) {
  const name = (title || 'Nova nota').trim() || 'Nova nota';
  const shelf =
    state.active && state.active.includes('/')
      ? state.active.split('/')[0]
      : state.workspaces[0]?.name;
  const path = `${shelf ? shelf + '/' : ''}${name}.md`;
  try {
    await tool('note.create', { path, body: `# ${name}\n` });
    await refreshLibrary();
    insertAt(
      el,
      found.start,
      found.start + 2 + found.query.length,
      `[[${path.replace(/\.md$/i, '')}]]`,
    );
  } catch (error) {
    toast(error.message, 'erro');
  }
}

function createWorkspace() {
  state.namingShelf = true;
  state.renaming = null;
  paintTree();
}

function renameSelection() {
  if (state.selectedShelf) {
    state.renaming = { kind: 'shelf', name: state.selectedShelf };
    state.namingShelf = false;
    paintTree();
  }
}

async function showGraph(workspace) {
  state.view = 'graph';
  if (typeof workspace === 'string') state.graphWorkspace = workspace;
  paintTabs();
  paintCenter();
  paintLinks();
}

async function paintGraph(center) {
  const legend = state.workspaces
    .map((item) => {
      const mark = Cmd.shelfMark(item.name);
      const color = mark.color ? `var(--shelf-${mark.color})` : 'var(--ink-3)';
      return `<span class="chip"><span class="arvore__ponto" style="background:${color}"></span>${escapeHtml(item.name)}</span>`;
    })
    .join('');
  center.innerHTML = `<div class="grafo">
    <div class="grafo__barra">
      <label>Estante <select id="grafo-estante"><option value="">Todas</option>${state.workspaces
        .map(
          (item) =>
            `<option value="${escapeHtml(item.name)}" ${item.name === state.graphWorkspace ? 'selected' : ''}>${escapeHtml(item.name)}</option>`,
        )
        .join('')}</select></label>
      <label>Tag <input id="grafo-tag" value="${escapeHtml(state.graphTag)}" placeholder="filtrar" /></label>
      <span class="nota-privacidade" id="grafo-foco">${state.active ? `Foco: ${escapeHtml(baseName(state.active))}` : ''}</span>
    </div>
    <div class="grafo__palco">
      <canvas id="grafo-canvas"></canvas>
      <div class="grafo__legenda">${legend}</div>
      <div class="grafo__zoom">
        <button type="button" class="btn btn--icone" id="grafo-mais" aria-label="Aproximar">${icon('zoom-mais')}</button>
        <button type="button" class="btn btn--icone" id="grafo-menos" aria-label="Afastar">${icon('zoom-menos')}</button>
        <button type="button" class="btn btn--icone" id="grafo-ajustar" aria-label="Ajustar">1</button>
      </div>
    </div>
  </div>`;
  $('#grafo-estante').onchange = (event) => {
    state.graphWorkspace = event.target.value;
    paintGraph(center);
  };
  $('#grafo-tag').onchange = (event) => {
    state.graphTag = event.target.value.trim();
    paintGraph(center);
  };
  const graph = await tool('graph.query', {
    workspace: state.graphWorkspace || undefined,
    tag: state.graphTag || undefined,
  });
  drawGraph(graph);
}

function drawGraph(graph) {
  const canvas = $('#grafo-canvas');
  if (!canvas) return;
  const stage = canvas.parentElement;
  const fit = () => {
    const rect = stage.getBoundingClientRect();
    canvas.width = Math.max(320, Math.floor(rect.width));
    canvas.height = Math.max(280, Math.floor(rect.height));
  };
  fit();
  const degree = new Map();
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }
  const nodes = layout(graph.nodes, graph.edges, canvas.width, canvas.height).map((node) => ({
    ...node,
    degree: degree.get(node.path) || 0,
  }));
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const styles = getComputedStyle(document.documentElement);
  const colorOf = (workspace) => {
    const mark = Cmd.shelfMark(workspace || '');
    return mark.color
      ? styles.getPropertyValue(`--shelf-${mark.color}`).trim()
      : styles.getPropertyValue('--ink-3').trim();
  };
  const project = (node) => {
    const camera = state.graphCamera;
    return {
      x: canvas.width / 2 + (node.x - canvas.width / 2 + camera.x) * camera.zoom,
      y: canvas.height / 2 + (node.y - canvas.height / 2 + camera.y) * camera.zoom,
    };
  };
  const redraw = () => {
    const ctx = canvas.getContext('2d');
    const ink = styles.getPropertyValue('--ink').trim();
    const dot = styles.getPropertyValue('--canvas-dot').trim() || '#D9D5CE';
    const bg = styles.getPropertyValue('--bg').trim();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 12; x < canvas.width; x += 22) {
      for (let y = 12; y < canvas.height; y += 22) {
        ctx.fillStyle = dot;
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    }
    for (const edge of graph.edges) {
      const from = byPath.get(edge.from);
      const to = byPath.get(edge.to);
      if (!from || !to) continue;
      const a = project(from);
      const b = project(to);
      ctx.beginPath();
      ctx.strokeStyle = colorOf(from.workspace);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.4;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const node of nodes) {
      const at = project(node);
      const focused = node.path === state.active;
      const radius = (4 + Math.min(node.degree, 8) * 1.7) * state.graphCamera.zoom;
      const color = colorOf(node.workspace);
      if (focused) {
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.18;
        ctx.arc(at.x, at.y, radius + 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.fillStyle = color || '#6E72B0';
      ctx.arc(at.x, at.y, focused ? radius + 3 : radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `${focused ? 600 : 400} 13px Inter, sans-serif`;
      ctx.fillText(node.title || baseName(node.path), at.x + radius + 8, at.y + 4);
    }
  };
  state.graphRedraw = redraw;
  redraw();
  const zoomBy = (factor) => {
    state.graphCamera.zoom = Math.min(2.4, Math.max(0.4, state.graphCamera.zoom * factor));
    redraw();
  };
  $('#grafo-mais').onclick = () => zoomBy(1.2);
  $('#grafo-menos').onclick = () => zoomBy(1 / 1.2);
  $('#grafo-ajustar').onclick = () => {
    state.graphCamera = { x: 0, y: 0, zoom: 1 };
    redraw();
  };
  canvas.onwheel = (event) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? 1 / 1.08 : 1.08);
  };
  let drag = null;
  canvas.onpointerdown = (event) => {
    drag = { x: event.clientX, y: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    state.graphCamera.x += dx / state.graphCamera.zoom;
    state.graphCamera.y += dy / state.graphCamera.zoom;
    drag.x = event.clientX;
    drag.y = event.clientY;
    redraw();
  };
  canvas.onpointerup = (event) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
    const hit = nodes.find((node) => {
      const at = project(node);
      return Math.hypot(at.x - x, at.y - y) < 18;
    });
    if (hit) focusGraphNote(hit.path);
  };
}

async function focusGraphNote(path) {
  state.active = path;
  if (!state.tabs.includes(path)) state.tabs.push(path);
  const note = await tool('note.read', { path });
  state.frontmatter = note.frontmatter;
  state.revision = note.revision;
  state.doc = Doc.parseDocument(note.body);
  await loadLinks();
  const focus = $('#grafo-foco');
  if (focus) focus.textContent = `Foco: ${baseName(path)}`;
  paintTabs();
  paintLinks();
  paintStatus();
  if (state.graphRedraw) state.graphRedraw();
}

function layout(nodes, edges, width, height) {
  const placed = nodes.map((node, index) => {
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.28;
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const index = new Map(placed.map((node) => [node.path, node]));
  for (let step = 0; step < 80; step += 1) {
    for (let a = 0; a < placed.length; a += 1) {
      for (let b = a + 1; b < placed.length; b += 1) {
        let dx = placed[a].x - placed[b].x;
        let dy = placed[a].y - placed[b].y;
        const dist = Math.hypot(dx, dy) || 0.1;
        const force = dist < 120 ? (120 - dist) * 0.9 : 2400 / (dist * dist);
        placed[a].vx += (dx / dist) * force;
        placed[a].vy += (dy / dist) * force;
        placed[b].vx -= (dx / dist) * force;
        placed[b].vy -= (dy / dist) * force;
      }
    }
    for (const edge of edges) {
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (!from || !to) continue;
      from.vx += (to.x - from.x) * 0.02;
      from.vy += (to.y - from.y) * 0.02;
      to.vx -= (to.x - from.x) * 0.02;
      to.vy -= (to.y - from.y) * 0.02;
    }
    for (const node of placed) {
      node.vx += (width / 2 - node.x) * 0.02;
      node.vy += (height / 2 - node.y) * 0.02;
      node.vx *= 0.75;
      node.vy *= 0.75;
      node.x = Math.max(28, Math.min(width - 28, node.x + node.vx));
      node.y = Math.max(28, Math.min(height - 28, node.y + node.vy));
    }
  }
  return placed;
}

function openPalette() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="paleta" role="dialog" aria-label="Busca">
    <div class="paleta__busca">${icon('busca')}<input id="paleta-q" placeholder="Buscar ou comando…" aria-label="Buscar" /><span class="kbd">esc</span></div>
    <div class="paleta__lista" id="paleta-lista"></div>
    <div class="menu__rodape"><span><span class="kbd">↵</span> abrir</span><span><span class="kbd">esc</span> fechar</span></div>
  </div>`;
  const input = $('#paleta-q');
  input.focus();
  const render = async () => {
    const query = input.value.trim();
    let hits = [];
    if (query.length >= 2) {
      try {
        hits = await tool('search.query', { query });
      } catch {
        hits = [];
      }
    }
    const list = $('#paleta-lista');
    const commands = [
      { label: 'Nova nota', run: () => createNote() },
      { label: 'Mostrar grafo', run: () => showGraph() },
      { label: 'Alternar tema', run: () => toggleTheme() },
    ].filter(
      (item) => !query || item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    list.innerHTML =
      (hits.length ? '<div class="menu__grupo">Notas</div>' : '') +
      hits
        .slice(0, 12)
        .map((hit, index) => {
          const excerpt = (hit.segments || [])
            .map((part) =>
              part.match ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text),
            )
            .join('');
          const shelf = hit.workspace ? Cmd.shelfMark(hit.workspace) : null;
          const dot = shelf?.color
            ? `<span class="arvore__ponto" style="background: var(--shelf-${shelf.color})"></span>`
            : '';
          return `<button type="button" class="menu__item" data-hit="${index}" ${index === 0 ? 'aria-selected="true"' : ''}>${icon('nota')}<span><span class="menu__titulo">${escapeHtml(hit.title || hit.path)}</span><span class="menu__caminho">${dot}${escapeHtml(hit.path)} ${excerpt}</span></span></button>`;
        })
        .join('') +
      (commands.length ? '<div class="menu__grupo">Comandos</div>' : '') +
      commands
        .map(
          (item) =>
            `<button type="button" class="menu__item" data-cmd="${escapeHtml(item.label)}">${escapeHtml(item.label)}</button>`,
        )
        .join('') +
      (hits.length === 0 && query.length >= 2
        ? '<p class="nota-privacidade">Nada encontrado.</p>'
        : '');
    list.querySelectorAll('[data-hit]').forEach((button) => {
      button.onclick = () => {
        closePalette();
        openNote(hits[Number(button.dataset.hit)].path);
      };
    });
    list.querySelectorAll('[data-cmd]').forEach((button) => {
      button.onclick = () => {
        closePalette();
        commands.find((item) => item.label === button.dataset.cmd)?.run();
      };
    });
  };
  input.oninput = render;
  input.onkeydown = (event) => {
    if (event.key === 'Escape') closePalette();
    if (event.key === 'Enter') {
      const selected = $('#paleta-lista .menu__item');
      if (selected) selected.click();
    }
  };
  overlay.onclick = (event) => {
    if (event.target === overlay) closePalette();
  };
  render();
}

function closePalette() {
  const overlay = $('#overlay');
  overlay.hidden = true;
  overlay.innerHTML = '';
}

async function toggleTheme() {
  const next = themeName() === 'dark' ? 'light' : 'dark';
  state.settings.theme = next;
  applyTheme(next);
  await sophy.saveSettings({ theme: next });
  const button = $('#tema');
  if (button) button.innerHTML = icon(next === 'dark' ? 'tema-claro' : 'tema-escuro');
  paintStatus();
}

function applyCommand(command) {
  const next = Cmd.applyUiCommand(
    { view: state.view, theme: state.settings.theme, path: state.active },
    command,
  );
  if (command.type === 'setTheme') {
    state.settings.theme = command.theme;
    applyTheme(command.theme);
    sophy.saveSettings({ theme: command.theme });
    paintStatus();
    return;
  }
  if (command.type === 'openNote') {
    openNote(command.path).catch((error) => toast(error.message, 'erro'));
    return;
  }
  if (command.type === 'showGraph') {
    showGraph(command.workspace || '');
    return;
  }
  if (command.type === 'openCanvas') {
    openCanvas(command.path).catch((error) => toast(error.message, 'erro'));
  }
}

document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.menu-flutuante, #seletor-biblioteca, .barra-formato')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    runCommand('hoje');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    runCommand('estante');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    runCommand('biblioteca');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    openCommands();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
    event.preventDefault();
    $('#lateral')?.classList.toggle('is-fechada');
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    createNote();
  }
  if (event.key === 'F2' && !event.target.closest('[contenteditable="true"], input, textarea')) {
    event.preventDefault();
    if (state.active) state.renaming = { kind: 'note', path: state.active };
    else if (state.selectedShelf) state.renaming = { kind: 'shelf', name: state.selectedShelf };
    else return;
    state.namingShelf = false;
    paintTree();
  }
});

document.addEventListener('selectionchange', () => {
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    document.querySelector('.barra-formato')?.remove();
    return;
  }
  const block = selection.anchorNode?.parentElement?.closest?.('[data-block]');
  if (!block || !$('#coluna')?.contains(block)) {
    document.querySelector('.barra-formato')?.remove();
    return;
  }
  showFormatBar(selection.getRangeAt(0));
});

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((state.settings.theme || 'system') === 'system') applyTheme(themeName());
});

async function boot() {
  const sprite = await fetch('ui/assets/sprite.svg').then((response) => response.text());
  $('#sprite').innerHTML = sprite;
  const started = await sophy.boot();
  if (!started.ok) {
    document.body.textContent = started.error || 'Não foi possível abrir.';
    return;
  }
  state.settings = started.value.settings || {};
  state.libraryPath = started.value.libraryPath;
  applyTheme(themeName());
  syncMotion();
  if (state.settings.readingFont === 'literata')
    document.documentElement.style.setProperty('--font-reading', 'var(--font-reading-serif)');
  sophy.onCommand(applyCommand);
  if (!state.settings.onboarded || !state.libraryPath) paintOnboarding();
  else await showShell();
}

boot().catch((error) => {
  document.body.textContent = error.message;
});
