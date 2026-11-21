const Doc = SophyDoc;
const Cmd = SophyCommands;
const Trash = SophyLixeira;

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
  linkCatalog: [],
  unlinkedMentions: [],
  recentNotes: [],
  conflict: false,
  graphShelf: '',
  graphCenter: null,
  graphPositions: null,
  graphView: null,
  step: 1,
  folderMode: 'criar',
  folder: '',
  libraryNameInput: 'Biblioteca',
  selectedShelf: null,
  namingShelf: false,
  renaming: null,
  selectTitle: false,
  openSeq: 0,
  dirty: false,
  warnedUnsafe: false,
  propertyTemplates: null,
  connectionsOpen: false,
  trashItems: [],
  trashStatus: 'idle',
  trashError: '',
  trashQuery: '',
  trashKind: '',
  trashSelected: null,
  trashBusy: false,
};

const slash = Cmd.createSlashSession();
let saveTimer = 0;
let saveJob = Promise.resolve();
let lottiePromise = null;

const $ = (sel, root = document) => root.querySelector(sel);
const Writing = SophyWriting.create({
  getDoc: () => state.doc,
  isWriting: () => state.view === 'note',
  setDoc: (doc) => { state.doc = doc; },
  checkpoint,
  paint: () => { state.caret = null; paintCenter(); },
  save: scheduleSave,
  applying: (on) => { state.richApplying = on; },
  blockSelection: () => state.blockRange && state.blockRange.anchor !== state.blockRange.end,
  sync: (el) => {
    if (el.dataset.cell != null) syncTable(el.closest('table'));
    else {
      const index = Number(el.dataset.block);
      state.doc = Doc.withBlockRaw(state.doc, index, rawFromEditor(el, state.doc.blocks[index]));
    }
  },
});

function icon(name, extra = '') {
  const data = window.SophyIconsData || { fill: [] };
  const id = String(name || '').replace(/[^a-z0-9-]/g, '');
  const hasFill = Array.isArray(data.fill) && data.fill.includes(id);
  const classes = ['icon', extra].filter(Boolean).join(' ');
  const fill = hasFill ? `<use class="icon__fill" href="#i-${id}-fill"></use>` : '';
  return `<svg class="${classes}" aria-hidden="true"><use class="icon__regular" href="#i-${id}"></use>${fill}</svg>`;
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
  if (state.settings.accentSystem) delete document.documentElement.dataset.accent;
  else if (state.settings.accent) document.documentElement.dataset.accent = state.settings.accent;
  else delete document.documentElement.dataset.accent;
  const logo = $('.titulo__marca img');
  if (logo)
    logo.src = `ui/assets/logo/logo-horizontal-${theme === 'dark' ? 'escuro' : 'claro'}.svg`;
}
function motionReduced() {
  return (
    state.settings.reduceMotion === true || matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
function applyReadingFont(font) {
  const choice = font === 'literata' ? 'literata' : 'inter';
  document.documentElement.dataset.font = choice;
  document.documentElement.style.setProperty(
    '--font-reading',
    choice === 'literata' ? 'var(--font-reading-serif)' : 'var(--font-ui)',
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

function toast(message, kind = 'ok', action = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'erro' ? 'toast--erro' : 'toast--ok'}`;
  el.setAttribute('role', kind === 'erro' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'erro' ? 'erro' : 'salvo', 'toast__icone')}<span class="toast__texto">${escapeHtml(message)}</span>`;
  if (action?.label && typeof action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__acao';
    button.textContent = action.label;
    button.onclick = async () => {
      el.remove();
      await action.onClick();
    };
    el.append(button);
  }
  $('#toasts').append(el);
  if (kind !== 'erro') setTimeout(() => el.remove(), 5000);
  else el.addEventListener('click', () => el.remove());
}

async function undoLastAction(message = 'Ação desfeita.') {
  await tool('history.undo', {});
  await refreshLibrary();
  if (state.active) await openNote(state.active, { force: true });
  else paintTree();
  if (state.view === 'trash') paintCenter();
  toast(message);
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
      const libraryName = (state.libraryNameInput || 'Biblioteca').trim();
      if (state.folderMode === 'criar' && (!libraryName || libraryName === '.' || libraryName === '..' || /[\\/]/.test(libraryName) || reservedName(libraryName))) {
        toast(reservedName(libraryName) ? 'Esse nome é reservado pelo Windows.' : 'Escolha um nome de pasta simples, sem pontos nem barras.', 'erro');
        return;
      }
      const target =
        state.folderMode === 'criar'
          ? `${state.folder.replace(/\/$/, '')}/${libraryName}`
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
      if (state.folderMode === 'criar') {
        const selected = await sophy.switchLibrary(opened.value.root);
        if (!selected.ok) throw new Error(selected.error);
      }
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

function drawerNarrow() {
  return window.innerWidth <= 1024;
}

function ensureVeil() {
  let veil = $('#gaveta-veu');
  if (veil) return veil;
  veil = document.createElement('button');
  veil.type = 'button';
  veil.id = 'gaveta-veu';
  veil.className = 'gaveta-veu';
  veil.setAttribute('aria-label', 'Fechar a gaveta');
  veil.onclick = () => closeDrawer();
  $('.miolo')?.prepend(veil);
  return veil;
}

function openDrawer(opener) {
  const lateral = $('#lateral');
  if (!lateral) return;
  state.drawerOpener = opener || $('#abrir-lateral');
  lateral.classList.remove('is-fechada');
  lateral.classList.add('is-aberta');
  ensureVeil();
}

function closeDrawer() {
  $('#lateral')?.classList.remove('is-aberta');
  $('#sofi-gaveta')?.classList.remove('is-aberta');
  if ($('#conexoes')?.classList.contains('is-gaveta')) state.connectionsOpen = false;
  $('#conexoes')?.classList.remove('is-gaveta', 'is-aberta');
  if (drawerNarrow()) state.sofiOpen = false;
  $('#gaveta-veu')?.remove();
  syncConnectionsPanel();
  const opener = state.drawerOpener || $('#abrir-lateral');
  opener?.focus();
}

function toggleSidebar(opener) {
  const lateral = $('#lateral');
  if (!lateral) return;
  if (drawerNarrow()) {
    if (lateral.classList.contains('is-aberta')) closeDrawer();
    else openDrawer(opener || $('#abrir-lateral'));
    return;
  }
  lateral.classList.remove('is-aberta');
  $('#gaveta-veu')?.remove();
  lateral.classList.toggle('is-fechada');
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
        <button type="button" class="btn btn--icone" id="abrir-lateral" title="Lateral" aria-label="Mostrar a lateral">${icon('painel-lateral')}</button>
        <button type="button" class="btn btn--icone" id="busca" title="Buscar" aria-label="Buscar (Ctrl+K)">${icon('busca')}</button>
        <button type="button" class="btn btn--icone" id="ver-grafo" title="Grafo" aria-label="Mostrar grafo">${icon('grafo')}</button>
        <button type="button" class="btn btn--icone" id="abrir-conexoes" title="Conexões" aria-label="Conexões" aria-pressed="false">${icon('painel-direito')}</button>
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
          <button type="button" class="btn btn--icone" id="recolher" aria-label="Recolher">${icon('painel-lateral')}</button>
        </div>
        <div class="lateral__acoes">
          <button type="button" class="btn btn--secundario" id="novo" aria-haspopup="menu">${icon('novo')} Novo</button>
          <button type="button" class="btn btn--icone" id="filtrar" aria-label="Filtrar">${icon('busca')}</button>
        </div>
        <nav class="lateral__nav" aria-label="Seções">
          ${[
            ['inicio', 'inicio', 'Início'],
            ['hoje', 'nota-diaria', 'Hoje'],
            ['tarefas', 'lista-tarefas', 'Tarefas'],
            ['calendario', 'calendario', 'Calendário'],
            ['grafo', 'grafo', 'Grafo'],
            ['canvas', 'canvas', 'Canvas'],
          ]
            .map(
              ([id, glyph, label]) =>
                `<button type="button" class="nav__item" data-nav="${id}">${icon(glyph)} ${label}</button>`,
            )
            .join('')}
          <div class="nav__sep" role="separator"></div>
          <button type="button" class="nav__item" data-nav="lixeira" aria-label="${escapeHtml(trashNavLabel(state.trashItems.length))}">${icon('lixeira')}<span>Lixeira</span><span class="nav__conta" id="lixeira-conta">${state.trashItems.length}</span></button>
        </nav>
        <div class="lateral__busca" hidden><input id="filtro-arvore" type="search" placeholder="Filtrar a árvore" aria-label="Filtrar a árvore" /></div>
        <div id="arvore"></div>
      </aside>
      <main class="centro" id="centro"></main>
      <aside class="conexoes painel is-oculta" id="conexoes"></aside>
    </div>
    <footer class="status">
      <span id="st-caminho"></span>
      <span id="st-palavras"></span>
      <span id="st-estado">Pronta</span>
      <span class="status__fim" id="st-tema"></span>
    </footer>`;
  $('#busca').onclick = () => openPalette();
  $('#ver-grafo').onclick = () => showGraph();
  $('#abrir-conexoes').onclick = () => toggleConnections();
  $('#tema').onclick = () => toggleTheme();
  bindWindow(shell);
  $('#novo').onclick = (event) => openNewMenu(event.currentTarget);
  $('#seletor-biblioteca').onclick = (event) => openLibraryMenu(event.currentTarget);
  $('#recolher').onclick = (event) => toggleSidebar(event.currentTarget);
  $('#abrir-lateral').onclick = (event) => toggleSidebar(event.currentTarget);
  $('#filtrar').onclick = () => {
    const box = shell.querySelector('.lateral__busca');
    box.hidden = !box.hidden;
    if (!box.hidden) $('#filtro-arvore').focus();
  };
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
  state.view = 'home';
  state.nav = 'inicio';
  await refreshLibrary();
  paintShell();
}

async function refreshLibrary() {
  const opened = await tool('library.open', {});
  state.libraryPath = opened.root;
  state.libraryName = opened.root.split(/[/\\]/).pop();
  state.workspaces = opened.workspaces || [];
  state.notes = await tool('note.list', {});
  state.propertyTemplates = null;
  const files = await tool('file.list', {});
  state.canvases = files.filter((file) => file.kind === 'canvas');
  try {
    state.shelfStyles = await tool('shelf.style.list', {});
  } catch {
    state.shelfStyles = {};
  }
  try {
    state.linkCatalog = await tool('links.catalog', {});
  } catch {
    state.linkCatalog = [];
  }
  await refreshTrashIndex();
}

function markFor(name) {
  const base = Cmd.shelfMark(name);
  const saved = state.shelfStyles?.[name];
  if (!saved || name === 'Entrada') return base;
  return { icon: saved.icon || base.icon, color: saved.color || base.color };
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
      const mark = markFor(workspace.name);
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
          const unsafe = note.unsafe ? ' is-invalido' : '';
          const unsafeTitle = note.unsafe ? ' title="Nome inválido no Windows"' : '';
          return `<li role="treeitem"><button type="button" class="arvore__linha${unsafe}" style="--nivel:${Cmd.noteIndent(note.path)}" data-open="${escapeHtml(note.path)}" aria-selected="${Cmd.treeMarked('note', note.path, state)}"${unsafeTitle}>
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
      const shelfUnsafe = workspace.unsafe ? ' title="Nome inválido no Windows"' : '';
      return `<li role="treeitem"><button type="button" class="arvore__linha${workspace.unsafe ? ' is-invalido' : ''}" data-shelf="${escapeHtml(workspace.name)}" aria-selected="${Cmd.treeMarked('shelf', workspace.name, state)}" aria-expanded="true"${color}${shelfUnsafe}>
          ${icon('chevron-direita', 'arvore__seta')}${icon(mark.icon, 'icon--estante')}${shelfLabel}
          <span class="arvore__conta">${notes.length + state.canvases.filter((file) => file.workspace === workspace.name).length}</span></button><ul role="group">${children}${boards}</ul></li>`;
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
  const looseBoards = state.canvases
    .filter((file) => file.workspace === null)
    .filter((file) => !filter || file.path.toLocaleLowerCase().includes(filter))
    .map((file) => `<li role="treeitem"><button type="button" class="arvore__linha" data-canvas="${escapeHtml(file.path)}" aria-selected="${Cmd.treeMarked('canvas', file.path, state)}">${icon('canvas')}<span class="arvore__nome">${escapeHtml(baseName(file.path))}</span></button></li>`)
    .join('');
  const draft = state.namingShelf
    ? `<li role="treeitem"><div class="arvore__linha">${icon('estante')}<input class="arvore__renomear" id="nome-estante" aria-label="Nome da estante" /></div></li>`
    : '';
  const name = host.parentElement?.querySelector('.biblioteca-seletor__nome');
  if (name) name.textContent = state.libraryName || 'Biblioteca';
  host.innerHTML = `<ul class="arvore" role="tree">${shelves}${loose}${looseBoards}${draft}</ul>`;
  const unsafeCount = state.notes.filter((note) => note.unsafe).length + state.workspaces.filter((workspace) => workspace.unsafe).length;
  if (unsafeCount && !state.warnedUnsafe) {
    state.warnedUnsafe = true;
    toast(`${unsafeCount} item(ns) com nome inválido no Windows continuam na árvore, marcados para renomear.`, 'erro');
  }
  host.querySelectorAll('[data-open]').forEach((button) => {
    button.draggable = true;
    button.ondragstart = (event) => event.dataTransfer.setData('text/plain', button.dataset.open);
    button.onclick = () => {
      state.selectedShelf = button.dataset.open.includes('/')
        ? button.dataset.open.split('/')[0]
        : null;
      openNote(button.dataset.open).catch((error) => toast(error.message, 'erro'));
    };
    button.oncontextmenu = (event) => openTreeMenu(event, 'note', button.dataset.open);
  });
  host.querySelectorAll('[data-canvas]').forEach((button) => {
    button.onclick = () => openCanvas(button.dataset.canvas);
    button.oncontextmenu = (event) => openTreeMenu(event, 'canvas', button.dataset.canvas);
  });
  host.querySelectorAll('[data-shelf]').forEach((button) => {
    button.onclick = (event) => {
      if (event.target.closest('input')) return;
      state.treeFocus = 'shelf';
      state.selectedShelf = button.dataset.shelf;
      state.view = 'shelf';
      state.active = null;
      paintTree();
      paintCenter();
    };
    button.oncontextmenu = (event) => openTreeMenu(event, 'shelf', button.dataset.shelf);
  });
  bindNameField(
    host.querySelector('#nome-estante'),
    async (name) => {
      await tool('workspace.create', { name });
      state.namingShelf = false;
      state.selectedShelf = name;
      await refreshLibrary();
      paintTree();
      paintCenter();
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
        if (name.includes('/') || name.includes('\\')) {
          toast('O nome não pode conter /.', 'erro');
          return;
        }
        if (!(await flushNote())) return;
        const from = state.renaming.path;
        const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
        state.renaming = null;
        const to = `${folder}${name}.md`;
        try {
          let moved = null;
          if (to !== from) moved = await tool('entry.move', { from, to });
          if (state.active === from) state.active = to;
          state.tabs = state.tabs.map((tab) => (tab === from ? to : tab));
          await refreshLibrary();
          await openNote(to);
          const count = moved?.linksUpdated ?? moved?.updated?.length ?? 0;
          if (count > 0) {
            toast(`${count} link${count === 1 ? '' : 's'} atualizado${count === 1 ? '' : 's'}`, 'ok', {
              label: 'Desfazer',
              onClick: () => undoLastAction('Nome e links restaurados.'),
            });
          }
        } catch (error) {
          toast(error.message, 'erro');
        }
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
        let moved = null;
        if (name !== from) {
          if (!(await flushNote())) return;
          moved = await tool('entry.move', { from, to: name });
          const remap = (tab) => (tab === from || tab.startsWith(`${from}/`) ? `${name}${tab.slice(from.length)}` : tab);
          state.tabs = state.tabs.map(remap);
          if (state.active?.startsWith(`${from}/`) || state.active === from)
            state.active = `${name}${state.active.slice(from.length)}`;
          if (state.canvasPath?.startsWith(`${from}/`) || state.canvasPath === from)
            state.canvasPath = `${name}${state.canvasPath.slice(from.length)}`;
        }
        state.selectedShelf = name;
        await refreshLibrary();
        paintTabs();
        paintTree();
        if (state.active) await openNote(state.active, { force: true });
        else paintLinks();
        const count = moved?.linksUpdated ?? moved?.updated?.length ?? 0;
        if (count > 0) {
          toast(`${count} link${count === 1 ? '' : 's'} atualizado${count === 1 ? '' : 's'}`, 'ok', {
            label: 'Desfazer',
            onClick: () => undoLastAction('Nome e links restaurados.'),
          });
        }
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
    .map((file) => {
      const canvas = file.toLowerCase().endsWith('.canvas');
      return `<span class="aba-wrap"><button type="button" class="aba" role="tab" aria-selected="${file === state.active || file === state.canvasPath}" data-tab="${escapeHtml(file)}">${icon(canvas ? 'canvas' : 'nota')}<span>${escapeHtml(baseName(file))}</span></button><button type="button" class="aba-fechar" data-fechar-aba="${escapeHtml(file)}" aria-label="Fechar ${escapeHtml(baseName(file))}">×</button></span>`;
    })
    .join('');
  host.querySelectorAll('[data-tab]').forEach((button) => {
    button.onclick = () => {
      button.dataset.tab.toLowerCase().endsWith('.canvas')
        ? openCanvas(button.dataset.tab)
        : openNote(button.dataset.tab).catch((error) => toast(error.message, 'erro'));
    };
  });
  host.querySelectorAll('[data-fechar-aba]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      closeTab(button.dataset.fecharAba);
    };
  });
}

async function closeTab(file) {
  if ((state.active === file || state.canvasPath === file) && !(await flushNote())) return;
  state.tabs = state.tabs.filter((tab) => tab !== file);
  if (state.active !== file && state.canvasPath !== file) {
    paintTabs();
    return;
  }
  state.active = null;
  state.doc = null;
  state.dirty = false;
  state.canvasPath = null;
  state.view = 'home';
  state.nav = 'inicio';
  paintTabs();
  paintTree();
  paintCenter();
  paintLinks();
  paintStatus();
}

function setFocusMode(on) {
  state.focusMode = !!on;
  document.querySelector('#shell')?.classList.toggle('is-foco', state.focusMode);
  document.querySelectorAll('[data-focus-toggle]').forEach((button) => {
    button.textContent = state.focusMode ? 'Sair do foco' : 'Modo foco';
    button.setAttribute('aria-pressed', String(state.focusMode));
  });
}

const PROPERTY_TYPES = {
  text: 'Texto',
  number: 'Número',
  select: 'Seleção',
  multi: 'Múltipla seleção',
  date: 'Data',
  checkbox: 'Checkbox',
  url: 'URL',
};

function noteLayout() {
  const layout = state.frontmatter?.layout;
  return {
    font: ['default', 'serif', 'sans', 'mono'].includes(layout?.font) ? layout.font : 'default',
    small: layout?.small === true,
    wide: layout?.wide === true,
  };
}

function noteProperties() {
  return Array.isArray(state.frontmatter?.properties)
    ? state.frontmatter.properties.filter((item) => item && PROPERTY_TYPES[item.type])
    : [];
}

async function loadPropertyTemplates() {
  if (state.propertyTemplates) return state.propertyTemplates;
  const found = new Map();
  const notes = await Promise.all(
    (state.notes || []).slice(0, 500).map((note) =>
      note.path === state.active
        ? Promise.resolve({ frontmatter: state.frontmatter })
        : tool('note.read', { path: note.path }).catch(() => null),
    ),
  );
  for (const note of notes) {
    const properties = Array.isArray(note?.frontmatter?.properties) ? note.frontmatter.properties : [];
    for (const property of properties) {
      if (!property?.name || !PROPERTY_TYPES[property.type]) continue;
      const key = property.name.trim().toLocaleLowerCase();
      if (!found.has(key)) found.set(key, { name: property.name.trim(), type: property.type, options: new Set(), uses: 0 });
      const template = found.get(key);
      template.uses += 1;
      for (const option of property.options || []) if (String(option).trim()) template.options.add(String(option).trim());
      const values = Array.isArray(property.value) ? property.value : [property.value];
      if (property.type === 'select' || property.type === 'multi') {
        for (const value of values) if (String(value || '').trim()) template.options.add(String(value).trim());
      }
    }
  }
  state.propertyTemplates = [...found.values()]
    .map((template) => ({ ...template, options: [...template.options] }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'pt-BR'));
  return state.propertyTemplates;
}

async function writeNoteFrontmatter(frontmatter) {
  if (!state.active || !state.doc) return false;
  const result = await tool('note.write', {
    path: state.active,
    body: Doc.serializeBlocks(state.doc.blocks),
    frontmatter,
    expectedRevision: state.revision,
  });
  if (result.conflict) {
    state.conflict = true;
    paintCenter();
    return false;
  }
  state.revision = result.note.revision;
  state.frontmatter = result.note.frontmatter;
  state.dirty = false;
  paintStatus();
  return true;
}

function applyNoteLayoutClasses() {
  const column = $('#coluna');
  if (!column) return;
  const layout = noteLayout();
  column.classList.remove(
    'nota--font-default',
    'nota--font-serif',
    'nota--font-sans',
    'nota--font-mono',
    'nota--small',
    'nota--wide',
  );
  column.classList.add(`nota--font-${layout.font}`);
  if (layout.small) column.classList.add('nota--small');
  if (layout.wide) column.classList.add('nota--wide');
}

async function setNoteLayout(patch) {
  const frontmatter = { ...(state.frontmatter || {}) };
  frontmatter.layout = { ...noteLayout(), ...patch };
  if (!(await writeNoteFrontmatter(frontmatter))) return;
  applyNoteLayoutClasses();
  const menu = document.querySelector('.nota-menu');
  if (menu) {
    const layout = noteLayout();
    menu.querySelectorAll('[data-note-font]').forEach((button) => {
      button.classList.toggle('is-escolhida', button.dataset.noteFont === layout.font);
    });
    menu.querySelectorAll('[data-note-toggle]').forEach((button) => {
      const on = !!layout[button.dataset.noteToggle];
      button.setAttribute('aria-pressed', String(on));
      const mark = button.querySelector('span:last-child');
      if (mark && button.dataset.noteToggle === 'small') mark.textContent = on ? 'Ativo' : '';
      if (mark && button.dataset.noteToggle === 'wide') mark.textContent = on ? 'Ativa' : '';
    });
  }
}

async function syncNoteNameFromTitle() {
  if (!state.active || !state.doc || state.conflict || state.renaming) return;
  const first = state.doc.blocks[0];
  if (!first || first.type !== 'heading' || (first.level || 1) !== 1) return;
  const title = Doc.visibleOf(first).replace(/\n/g, ' ').trim();
  if (!title) return;
  const safe = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  if (!safe || safe.includes('/') || safe.includes('\\')) return;
  const from = state.active;
  const current = baseName(from);
  if (safe === current) return;
  if (!(await flushNote())) return;
  const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const taken = state.notes.filter((note) => note.path !== from).map((note) => baseName(note.path));
  const name = Cmd.uniqueTitle(taken, safe);
  const to = `${folder}${name}.md`;
  if (to === from) return;
  try {
    await tool('entry.move', { from, to });
    state.active = to;
    state.tabs = state.tabs.map((tab) => (tab === from ? to : tab));
    await refreshLibrary();
    paintTabs();
    paintTree();
    paintStatus();
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function setNoteProperties(properties, repaint = true) {
  const frontmatter = { ...(state.frontmatter || {}), properties };
  if (!properties.length) delete frontmatter.properties;
  if (await writeNoteFrontmatter(frontmatter)) {
    state.propertyTemplates = null;
    if (repaint) paintCenter();
  }
}

function syncConnectionsPanel() {
  const panel = $('#conexoes');
  const button = $('#abrir-conexoes');
  if (!panel) return;
  const forceHide = state.view === 'tasks' || state.view === 'cards';
  const show =
    !forceHide && (state.connectionsOpen || (state.sofiOpen && !drawerNarrow()));
  panel.classList.toggle('is-oculta', !show);
  if (button) {
    button.setAttribute('aria-pressed', show ? 'true' : 'false');
    button.title = show ? 'Ocultar conexões' : 'Conexões';
  }
}

function openConnections() {
  const panel = $('#conexoes');
  if (!panel) return;
  state.sofiOpen = false;
  state.connectionsOpen = true;
  paintLinks();
  syncConnectionsPanel();
  if (drawerNarrow()) {
    panel.classList.add('is-gaveta');
    requestAnimationFrame(() => panel.classList.add('is-aberta'));
    ensureVeil();
  } else {
    panel.classList.remove('is-gaveta', 'is-aberta');
  }
  state.drawerOpener = $('#abrir-conexoes');
}

function closeConnections() {
  state.connectionsOpen = false;
  const panel = $('#conexoes');
  panel?.classList.remove('is-gaveta', 'is-aberta');
  syncConnectionsPanel();
  if (
    !$('#lateral')?.classList.contains('is-aberta') &&
    !$('#sofi-gaveta')?.classList.contains('is-aberta')
  ) {
    $('#gaveta-veu')?.remove();
  }
}

function toggleConnections() {
  if (state.connectionsOpen && !$('#conexoes')?.classList.contains('is-oculta')) closeConnections();
  else openConnections();
}

const SHELF_COLOR_NAMES = ['Índigo', 'Azul', 'Verde-água', 'Oliva', 'Ocre', 'Terracota', 'Lavanda', 'Grafite'];

function shelfColorName(color) {
  return SHELF_COLOR_NAMES[Number(color) - 1] || `Cor ${color}`;
}

function noteShelfColor() {
  const shelf = state.active && state.active.includes('/') ? state.active.split('/')[0] : state.selectedShelf || '';
  const mark = markFor(shelf);
  return mark.color ? `var(--shelf-${mark.color})` : 'var(--accent-soft)';
}

function coverArt(id, y) {
  return `<div class="capa" style="--capa-y:${y}" role="img" aria-label="Capa ${escapeHtml(Cmd.COVER_NAMES?.[id] || id)}"><div class="capa__recorte"><svg class="capa__arte" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#capa-${escapeHtml(id)}"/></svg></div>${coverActions()}</div>`;
}

function coverBand() {
  const cover = Cmd.resolveCover(state.frontmatter);
  if (!cover) return '';
  if (cover.kind === 'cor') {
    const paint = cover.color === 'estante' ? noteShelfColor() : `var(--shelf-${cover.color}, var(--accent-soft))`;
    return `<div class="capa capa--cor" style="--capa-y:${cover.y};--capa-tinta:${paint}" role="img" aria-label="Capa cor ${escapeHtml(cover.color)}">${coverActions()}</div>`;
  }
  if (cover.kind === 'arquivo')
    return `<div class="capa" style="--capa-y:${cover.y}" data-arquivo="${escapeHtml(cover.src)}"><div class="capa__recorte"><img class="capa__img" alt="" src="${escapeHtml(cover.src)}"></div>${coverActions()}</div>`;
  return coverArt(cover.id, cover.y);
}

function coverActions() {
  const daily = /^Diário\/\d{4}-\d{2}-\d{2}\.md$/.test(state.active || '');
  if (daily && !Cmd.resolveCover(state.frontmatter)) return '';
  return `<div class="capa__acoes"><button type="button" class="btn btn--secundario btn--pequeno" id="trocar-capa">Trocar capa</button></div>`;
}

const COVER_GROUPS = {
  Todas: null,
  Natureza: ['ondas', 'montanhas', 'folhas', 'campo', 'nuvens', 'jardim', 'horizonte'],
  Céu: ['ceu-noturno', 'constelacao'],
  Cerrado: ['cerrado', 'vereda', 'ipe'],
  Geometria: ['grade', 'papel-dobrado', 'arcos', 'topografia'],
  Estudo: ['estante', 'pautado', 'rede'],
  Cidade: ['cidade'],
  Sofi: ['sofi-galho', 'sofi-livros', 'sofi-noite', 'sofi-folhas'],
};

function openCoverPicker() {
  closeMenus();
  const current = Cmd.resolveCover(state.frontmatter);
  const y = Math.round((current?.y ?? 0.5) * 100);
  const pop = document.createElement('div');
  pop.className = 'seletor-capa';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Capa da nota');
  const filters = Object.keys(COVER_GROUPS)
    .map((name, index) => `<button type="button" class="chip" data-filtro-capa="${escapeHtml(name)}" aria-pressed="${index === 0}">${escapeHtml(name)}</button>`)
    .join('');
  const arts = Cmd.COVER_IDS.map((id) => `<button type="button" class="capa-opcao" data-capa="sophy:${id}" data-grupo="${escapeHtml(Object.entries(COVER_GROUPS).find(([, ids]) => ids && ids.includes(id))?.[0] || '')}"><span class="capa-opcao__arte"><svg class="capa__arte" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#capa-${id}"/></svg></span><span class="capa-opcao__nome">${escapeHtml(Cmd.COVER_NAMES[id] || id)}</span></button>`).join('');
  const colors = ['estante', '1', '2', '3', '4', '5', '6']
    .map((color) => {
      const paint = color === 'estante' ? noteShelfColor() : `var(--shelf-${color})`;
      return `<button type="button" class="acento" data-cor="${color}" aria-label="${color === 'estante' ? 'Cor da estante' : shelfColorName(color)}" style="--amostra:${paint}"></button>`;
    })
    .join('');
  pop.innerHTML = `<div class="seletor-capa__topo"><h3>Capa da nota</h3><button type="button" class="btn btn--fantasma" id="fechar-capa" aria-label="Fechar">×</button></div><div class="seletor-capa__filtros">${filters}</div><div class="capa-galeria">${arts}</div><p class="seletor-capa__nota">Ou só uma cor</p><div class="acentos">${colors}</div><div class="seletor-capa__acoes"><button type="button" class="btn btn--secundario" id="capa-arquivo">Usar arquivo do computador…</button><button type="button" class="btn btn--fantasma" id="capa-remover">Remover capa</button></div><label class="capa-posicao">Altura <input id="capa-y" type="range" min="0" max="100" value="${y}"><output>${y}%</output></label><p class="seletor-capa__fm">capa: ${escapeHtml(state.frontmatter?.capa || '—')}</p>`;
  document.body.append(pop);
  const anchor = $('#trocar-capa')?.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(456, window.innerWidth - margin * 2);
  pop.style.position = 'fixed';
  pop.style.width = `${width}px`;
  pop.style.maxHeight = `${window.innerHeight - margin * 2}px`;
  pop.style.overflow = 'auto';
  pop.style.zIndex = '40';
  const box = pop.getBoundingClientRect();
  let left = anchor ? anchor.left : margin;
  let top = anchor ? anchor.bottom + margin : margin;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - box.height - margin));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.querySelector('#fechar-capa').onclick = () => pop.remove();
  pop.querySelectorAll('[data-filtro-capa]').forEach((button) => {
    button.onclick = () => {
      const group = button.dataset.filtroCapa;
      pop.querySelectorAll('[data-capa]').forEach((card) => {
        card.hidden = group !== 'Todas' && card.dataset.grupo !== group;
      });
    };
  });
  pop.querySelectorAll('[data-capa]').forEach((button) => {
    button.onclick = () => setCover(button.dataset.capa, pop.querySelector('#capa-y').value);
  });
  pop.querySelectorAll('[data-cor]').forEach((button) => {
    button.onclick = () => setCover(`cor:${button.dataset.cor}`, pop.querySelector('#capa-y').value);
  });
  pop.querySelector('#capa-arquivo').onclick = () => {
    const input = document.createElement('input');
    input.placeholder = 'assets/foto.png';
    input.setAttribute('aria-label', 'Caminho do arquivo');
    pop.querySelector('#capa-arquivo').after(input);
    input.onkeydown = (event) => {
      if (event.key !== 'Enter') return;
      setCover(input.value.trim(), pop.querySelector('#capa-y').value);
    };
    input.focus();
  };
  pop.querySelector('#capa-remover').onclick = () => setCover('', y);
  const height = pop.querySelector('#capa-y');
  height.oninput = (event) => {
    event.target.parentElement.querySelector('output').textContent = `${event.target.value}%`;
    const cover = document.querySelector('#coluna .capa');
    if (cover) cover.style.setProperty('--capa-y', String(Number(event.target.value) / 100));
  };
  height.onchange = (event) => setCover(state.frontmatter?.capa || '', event.target.value);
}

function coverPicker() {
  return '';
}

async function setCover(capa, y) {
  if (!state.active || !state.doc) return;
  const frontmatter = { ...(state.frontmatter || {}) };
  if (capa) frontmatter.capa = capa;
  else delete frontmatter.capa;
  if (y != null) frontmatter.capa_y = `${y}%`;
  const result = await tool('note.write', {
    path: state.active,
    body: Doc.serializeBlocks(state.doc.blocks),
    frontmatter,
    expectedRevision: state.revision,
  });
  if (result.conflict) {
    state.conflict = true;
    paintCenter();
    return;
  }
  state.revision = result.note.revision;
  state.frontmatter = result.note.frontmatter;
  paintCenter();
}

function propertyValueHtml(property) {
  const value = property.value;
  if (property.type === 'checkbox')
    return `<label class="propriedade__check"><input type="checkbox" data-property-value="${escapeHtml(property.id)}" ${value ? 'checked' : ''}><span>${value ? 'Sim' : 'Não'}</span></label>`;
  if (property.type === 'select') {
    return `<button type="button" class="propriedade__seletor ${value ? '' : 'is-empty'}" data-property-picker="${escapeHtml(property.id)}">${escapeHtml(value || 'Escolher ou criar…')}</button>`;
  }
  if (property.type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    return `<button type="button" class="propriedade__seletor propriedade__seletor--multi ${selected.length ? '' : 'is-empty'}" data-property-picker="${escapeHtml(property.id)}">${selected.length ? selected.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('') : 'Escolher ou criar…'}</button>`;
  }
  const type = property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'url' ? 'url' : 'text';
  return `<input type="${type}" data-property-value="${escapeHtml(property.id)}" value="${escapeHtml(value ?? '')}" placeholder="Vazio">`;
}

function notePropertiesHtml() {
  const properties = noteProperties();
  const rows = properties.map((property) => `<div class="propriedade" data-property="${escapeHtml(property.id)}"><button type="button" class="propriedade__nome" data-property-edit="${escapeHtml(property.id)}"><span>${escapeHtml(property.name || 'Propriedade')}</span></button><div class="propriedade__valor">${propertyValueHtml(property)}</div><button type="button" class="btn btn--icone propriedade__remover" data-property-remove="${escapeHtml(property.id)}" aria-label="Remover ${escapeHtml(property.name || 'propriedade')}">×</button></div>`).join('');
  return `<details class="nota-propriedades" ${properties.length ? 'open' : ''}><summary>Propriedades${properties.length ? ` <span>${properties.length}</span>` : ''}</summary><div class="nota-propriedades__lista">${rows || '<p class="nota-privacidade">Adicione status, prazo, tags ou outros detalhes desta nota.</p>'}<button type="button" class="btn btn--fantasma" id="adicionar-propriedade">＋ Adicionar propriedade</button></div></details>`;
}

function openPropertyValuePicker(propertyId, anchor) {
  closeMenus();
  const properties = noteProperties().map((item) => ({
    ...item,
    options: [...(item.options || [])],
    value: Array.isArray(item.value) ? [...item.value] : item.value,
  }));
  const property = properties.find((item) => item.id === propertyId);
  if (!property) return;
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante propriedade-picker';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', `Preencher ${property.name}`);
  const paint = () => {
    const selected = Array.isArray(property.value) ? property.value : [property.value].filter(Boolean);
    menu.innerHTML = `<div class="propriedade-picker__topo"><strong>${escapeHtml(property.name)}</strong><span>${property.type === 'multi' ? 'Escolha um ou mais valores' : 'Escolha um valor'}</span></div><div class="propriedade-picker__opcoes">${property.options.map((option) => `<button type="button" class="menu__item ${selected.includes(option) ? 'is-ativa' : ''}" data-property-option="${escapeHtml(option)}"><span>${escapeHtml(option)}</span>${selected.includes(option) ? '<span>✓</span>' : ''}</button>`).join('') || '<p class="nota-privacidade">Nenhum valor usado ainda.</p>'}</div><div class="propriedade-picker__novo"><input id="property-new-value" maxlength="80" placeholder="Criar um novo valor…"><button type="button" class="btn btn--primario" id="property-create-value">Criar</button></div>${property.type === 'multi' ? '<button type="button" class="btn btn--fantasma propriedade-picker__done" id="property-picker-done">Concluído</button>' : ''}`;
    menu.querySelectorAll('[data-property-option]').forEach((button) => {
      button.onclick = async () => {
        const value = button.dataset.propertyOption;
        if (property.type === 'multi') {
          property.value = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
          await setNoteProperties(properties, false);
          paint();
        } else {
          property.value = value;
          menu.remove();
          await setNoteProperties(properties);
        }
      };
    });
    const input = menu.querySelector('#property-new-value');
    const create = async () => {
      const value = input.value.trim();
      if (!value) return;
      const known = property.options.find((option) => option.toLocaleLowerCase() === value.toLocaleLowerCase());
      const finalValue = known || value;
      if (!known) property.options.push(finalValue);
      if (property.type === 'multi') {
        property.value = [...new Set([...(Array.isArray(property.value) ? property.value : []), finalValue])];
      } else property.value = finalValue;
      state.propertyTemplates = null;
      menu.remove();
      await setNoteProperties(properties);
    };
    menu.querySelector('#property-create-value').onclick = create;
    menu.querySelector('#property-picker-done')?.addEventListener('click', () => { menu.remove(); paintCenter(); });
    input.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); create(); } };
  };
  paint();
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 300)}px`;
  menu.querySelector('#property-new-value')?.focus();
}

async function openPropertyEditor(existingId) {
  closeMenus();
  const properties = noteProperties().map((item) => ({ ...item, options: [...(item.options || [])], value: Array.isArray(item.value) ? [...item.value] : item.value }));
  const existing = properties.find((item) => item.id === existingId);
  const templates = existing ? [] : await loadPropertyTemplates();
  let selectedTemplate = null;
  const overlay = $('#overlay');
  overlay.hidden = false;
  const templateSection = templates.length
    ? `<section class="propriedade-modelos"><div><strong>Usar uma propriedade existente</strong><span>Tipo e valores conhecidos vêm juntos.</span></div><div class="propriedade-modelos__lista" id="property-templates">${templates.map((template, index) => `<button type="button" class="opcao-cartao" data-property-template="${index}"><b>${escapeHtml(template.name)}</b><small>${escapeHtml(PROPERTY_TYPES[template.type])}${template.uses > 1 ? ` · usada em ${template.uses} notas` : ''}</small></button>`).join('')}</div></section>`
    : '';
  overlay.innerHTML = `<div class="propriedade-editor" role="dialog" aria-modal="true" aria-labelledby="property-title"><header class="propriedade-editor__topo"><div><h3 id="property-title">${existing ? 'Editar' : 'Nova'} propriedade</h3><p>${existing ? 'Altere o nome desta propriedade.' : 'Reutilize uma propriedade da biblioteca ou crie uma nova.'}</p></div><button type="button" class="btn btn--icone" id="property-close" aria-label="Fechar">×</button></header><div class="propriedade-editor__corpo">${templateSection}<label class="propriedade-editor__campo"><span>Nome</span><input id="property-name" maxlength="80" value="${escapeHtml(existing?.name || '')}" placeholder="Ex.: Época, Status ou Prazo"><small>Ao usar esse nome novamente, o Sophy oferecerá este modelo.</small></label><label class="propriedade-editor__campo"><span>Tipo</span><select id="property-type" ${existing ? 'disabled' : ''}>${Object.entries(PROPERTY_TYPES).map(([value, label]) => `<option value="${value}" ${value === (existing?.type || 'text') ? 'selected' : ''}>${label}</option>`).join('')}</select><small>${existing ? 'O tipo não pode ser alterado depois da criação.' : 'Os valores de seleção serão criados quando você preencher a propriedade.'}</small></label><p class="propriedade-editor__erro" id="property-error" role="alert"></p></div><footer class="propriedade-editor__acoes"><button type="button" class="btn btn--fantasma" id="property-cancel">Cancelar</button><button type="button" class="btn btn--primario" id="property-save">${existing ? 'Salvar alterações' : 'Adicionar propriedade'}</button></footer></div>`;
  const type = $('#property-type');
  overlay.querySelectorAll('[data-property-template]').forEach((button) => {
    button.onclick = () => {
      selectedTemplate = templates[Number(button.dataset.propertyTemplate)];
      $('#property-name').value = selectedTemplate.name;
      type.value = selectedTemplate.type;
      overlay.querySelectorAll('[data-property-template]').forEach((item) => item.classList.toggle('is-escolhida', item === button));
    };
  });
  $('#property-cancel').onclick = () => closePalette();
  $('#property-close').onclick = () => closePalette();
  overlay.onclick = (event) => { if (event.target === overlay) closePalette(); };
  $('#property-save').onclick = async () => {
    const name = $('#property-name').value.trim();
    const options = [...(existing?.options || selectedTemplate?.options || [])];
    if (!name) return ($('#property-error').textContent = 'Informe um nome.');
    if (properties.some((item) => item.id !== existingId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return ($('#property-error').textContent = 'Já existe uma propriedade com esse nome.');
    if (existing) {
      existing.name = name;
      existing.options = options;
    } else {
      properties.push({
        id: `prop-${Date.now().toString(36)}`,
        name,
        type: type.value,
        options,
        value: type.value === 'checkbox' ? false : type.value === 'multi' ? [] : '',
      });
    }
    closePalette();
    await setNoteProperties(properties);
  };
  $('#property-name').focus();
}

function openNoteMenu(anchor) {
  closeMenus();
  const layout = noteLayout();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante nota-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Opções da nota');
  menu.innerHTML = `<h4>Fonte</h4><div class="nota-menu__fontes">${[['default', 'Padrão'], ['serif', 'Serifada'], ['sans', 'Sem serifa'], ['mono', 'Mono']].map(([value, label]) => `<button type="button" class="opcao-cartao ${layout.font === value ? 'is-escolhida' : ''}" data-note-font="${value}"><b>Ag</b><span>${label}</span></button>`).join('')}</div><h4>Aparência</h4><button type="button" class="menu__item" data-note-toggle="small" aria-pressed="${layout.small}"><span>Texto pequeno</span><span>${layout.small ? 'Ativo' : ''}</span></button><button type="button" class="menu__item" data-note-toggle="wide" aria-pressed="${layout.wide}"><span>Largura total</span><span>${layout.wide ? 'Ativa' : ''}</span></button><hr><button type="button" class="menu__item" id="menu-properties">Propriedades</button><button type="button" class="menu__item" id="menu-cover">${Cmd.resolveCover(state.frontmatter) ? 'Alterar capa' : 'Adicionar capa'}</button><button type="button" class="menu__item" data-focus-toggle>${state.focusMode ? 'Sair do foco' : 'Modo foco'}</button>`;
  document.body.append(menu);
  anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 8)}px`;
  menu.addEventListener('mousedown', (event) => event.stopPropagation());
  menu.querySelectorAll('[data-note-font]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setNoteLayout({ font: button.dataset.noteFont });
    };
  });
  menu.querySelectorAll('[data-note-toggle]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const current = noteLayout();
      setNoteLayout({ [button.dataset.noteToggle]: !current[button.dataset.noteToggle] });
    };
  });
  menu.querySelector('#menu-properties').onclick = () => {
    menu.remove();
    anchor.removeAttribute('aria-expanded');
    document.querySelector('.nota-propriedades')?.setAttribute('open', '');
    document.querySelector('.nota-propriedades')?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'center' });
  };
  menu.querySelector('#menu-cover').onclick = () => {
    menu.remove();
    anchor.removeAttribute('aria-expanded');
    openCoverPicker();
  };
  menu.querySelector('[data-focus-toggle]').onclick = () => {
    menu.remove();
    anchor.removeAttribute('aria-expanded');
    setFocusMode(!state.focusMode);
    paintCenter();
  };
}

function paintHome(center) {
  const cards = (state.workspaces || [])
    .map((workspace) => {
      const mark = markFor(workspace.name);
      const notes = state.notes.filter((note) => note.workspace === workspace.name).length;
      const boards = state.canvases.filter((file) => file.workspace === workspace.name).length;
      const color = mark.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
      return `<button type="button" class="cartao-estante" data-home="${escapeHtml(workspace.name)}"${color}>${icon(mark.icon, 'icon--estante')}<strong>${escapeHtml(workspace.name)}</strong><span>${notes} notas · ${boards} canvas</span></button>`;
    })
    .join('');
  center.innerHTML = `<div class="inicio"><h2>Início</h2><p>As estantes desta biblioteca. Escolha uma ou crie uma nota.</p><div class="inicio__cartoes">${cards || '<p>Nenhuma estante ainda. Use Novo.</p>'}</div><div class="vazio-ensina__atalhos"><span><kbd class="kbd">Ctrl N</kbd> nota</span><span><kbd class="kbd">Ctrl ,</kbd> configurações</span><span><kbd class="kbd">Ctrl K</kbd> buscar</span></div></div>`;
  center.querySelectorAll('[data-home]').forEach((button) => {
    button.onclick = () => {
      state.selectedShelf = button.dataset.home;
      state.treeFocus = 'shelf';
      state.view = 'shelf';
      state.nav = '';
      paintTree();
      paintCenter();
    };
  });
}

function paintSettings(center) {
  const accent = state.settings.accent || 'indigo';
  const accents = ['indigo', 'azul', 'verde-agua', 'musgo', 'ambar', 'vinho', 'grafite'];
  const labels = {
    indigo: 'Índigo',
    azul: 'Azul',
    'verde-agua': 'Verde-água',
    musgo: 'Musgo',
    ambar: 'Âmbar',
    vinho: 'Vinho',
    grafite: 'Grafite',
  };
  center.innerHTML = `<div class="config"><h2>Configurações</h2>
    <section><h3>Aparência</h3>
      <div class="segmentado" role="radiogroup" aria-label="Tema">
        ${['light', 'dark', 'system'].map((value) => `<label class="segmentado__opcao"><input type="radio" name="cfg-tema" value="${value}" ${(state.settings.theme || 'system') === value ? 'checked' : ''}><span>${value === 'light' ? 'Claro' : value === 'dark' ? 'Escuro' : 'Sistema'}</span></label>`).join('')}
      </div>
      <div class="segmentado" role="radiogroup" aria-label="Fonte">
        ${['inter', 'literata'].map((value) => `<label class="segmentado__opcao"><input type="radio" name="cfg-fonte" value="${value}" ${(state.settings.readingFont || 'inter') === value ? 'checked' : ''}><span>${value === 'inter' ? 'Inter' : 'Literata'}</span></label>`).join('')}
      </div>
      <label class="alternar"><input type="checkbox" id="cfg-motion" ${state.settings.reduceMotion ? 'checked' : ''}><span>Reduzir animações</span></label>
    </section>
    <section><h3>Cor de destaque</h3><div class="acentos">${accents.map((id) => `<button type="button" class="acento ${accent === id ? 'is-escolhida' : ''}" data-accent="${id}" aria-label="${labels[id]}" style="--amostra: var(--accent-${id})"></button>`).join('')}</div><label class="alternar"><input type="checkbox" id="cfg-sistema" ${state.settings.accentSystem ? 'checked' : ''}><span>Seguir a cor do sistema</span></label><p class="nota-privacidade">Desligada por padrão. Ligada, o acento escolhido sai e a janela fica no índigo até o sistema informar uma cor.</p></section>
    <section><h3>Busca por significado</h3><label class="alternar"><input type="checkbox" id="cfg-busca" ${state.settings.semantic ? 'checked' : ''}><span>${state.settings.semantic ? 'Pronta, só nesta máquina' : 'Desligada'}</span></label><p class="nota-privacidade">Nenhum modelo é baixado e nenhum texto sai da biblioteca. O índice local só nasce quando você liga.</p></section>
    <section><h3>Revisão da semana</h3><p>O aviso aparece só no domingo. A semana começa ${weekStartsOn() === 0 ? 'no domingo' : 'na segunda'}.</p><div class="segmentado" role="radiogroup" aria-label="Início da semana">${[1, 0].map((value) => `<label class="segmentado__opcao"><input type="radio" name="cfg-semana" value="${value}" ${(state.settings.weekStartsOn ?? 1) === value ? 'checked' : ''}><span>${value === 1 ? 'Segunda' : 'Domingo'}</span></label>`).join('')}</div><button type="button" class="btn btn--secundario" id="abrir-revisao">Abrir revisão</button></section>
    <section><h3>Versões</h3><p>Um ponto é gravado antes de cada ação do agente e do MCP. Ficam 90 dias ou 1 GB, apagando as mais antigas.</p><button type="button" class="btn btn--secundario" id="cfg-versao">Gravar ponto agora</button><button type="button" class="btn btn--secundario" id="cfg-site">Exportar site</button><button type="button" class="btn btn--secundario" id="cfg-pdf">Exportar PDF</button></section>
  </div>`;
  center.querySelectorAll('[name="cfg-tema"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.theme = input.value;
      applyTheme(themeName());
      syncMotion();
      await sophy.saveSettings({ theme: input.value });
      paintStatus();
    };
  });
  center.querySelectorAll('[name="cfg-fonte"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.readingFont = input.value;
      applyReadingFont(input.value);
      await sophy.saveSettings({ readingFont: input.value });
    };
  });
  const motion = $('#cfg-motion');
  if (motion)
    motion.onchange = async () => {
      state.settings.reduceMotion = motion.checked;
      syncMotion();
      await sophy.saveSettings({ reduceMotion: motion.checked });
    };
  center.querySelectorAll('[data-accent]').forEach((button) => {
    button.onclick = async () => {
      state.settings.accentSystem = false;
      state.settings.accent = button.dataset.accent;
      applyTheme(themeName());
      await sophy.saveSettings({ accent: button.dataset.accent, accentSystem: false });
      paintCenter();
    };
  });
  const system = $('#cfg-sistema');
  if (system)
    system.onchange = async () => {
      state.settings.accentSystem = system.checked;
      applyTheme(themeName());
      await sophy.saveSettings({ accentSystem: system.checked });
    };
  const search = $('#cfg-busca');
  if (search)
    search.onchange = async () => {
      state.settings.semantic = search.checked;
      if (search.checked) await tool('search.semantic.enable', {});
      await sophy.saveSettings({ semantic: search.checked });
      paintCenter();
    };
  center.querySelectorAll('[name="cfg-semana"]').forEach((input) => {
    input.onchange = async () => {
      state.settings.weekStartsOn = Number(input.value);
      await sophy.saveSettings({ weekStartsOn: Number(input.value) });
      if (state.view === 'settings') paintCenter();
    };
  });
  const review = $('#abrir-revisao');
  if (review) review.onclick = () => showReview();
  const point = $('#cfg-versao');
  if (point) point.onclick = () => showVersions();
  const site = $('#cfg-site');
  if (site) site.onclick = () => openExport('site');
  const pdf = $('#cfg-pdf');
  if (pdf) pdf.onclick = () => openExport('pdf');
}

async function showCards() {
  state.view = 'cards';
  state.cardFace = 'front';
  state.cardRows = await tool('card.list', { today: isoToday() });
  paintCenter();
}

function paintCards(center) {
  const today = isoToday();
  const due = (state.cardRows || []).filter((card) => card.due <= today);
  const card = due[0];
  if (!card) {
    center.innerHTML = `<div class="vazio-ensina"><h2>Flashcards</h2><p>Escreva <span class="kbd">pergunta :: resposta</span> ou <span class="kbd">frente ::: verso</span> numa nota. Cada estante vira um baralho.</p></div>`;
    return;
  }
  const side = state.cardFace === 'back' ? 'verso' : 'frente';
  center.innerHTML = `<div class="inicio"><h2>Flashcards</h2><p>${escapeHtml(card.workspace || 'Biblioteca')} · ${due.length} para hoje${card.reversible ? ' · dois lados' : ''}</p><div class="fc-revisao" data-lado="${side}"><div class="fc-cartao"><div class="fc-face"><span class="fc-face__origem">${escapeHtml(card.workspace || '')}</span><p class="fc-face__p">${escapeHtml(card.front)}</p></div><div class="fc-face fc-face--verso"><span class="fc-face__origem">${escapeHtml(card.workspace || '')}</span><p class="fc-face__r">${escapeHtml(card.back)}</p></div></div></div><p><button type="button" class="btn btn--secundario" id="carta-virar">Mostrar resposta</button></p><div class="inicio__cartoes"><button type="button" class="btn btn--secundario" id="carta-nao">Não sabia</button><button type="button" class="btn btn--primario" id="carta-sim">Sabia</button></div></div>`;
  $('#carta-virar').onclick = () => {
    state.cardFace = state.cardFace === 'back' ? 'front' : 'back';
    paintCenter();
  };
  $('#carta-sim').onclick = () => answerCard(card, true);
  $('#carta-nao').onclick = () => answerCard(card, false);
}

async function answerCard(card, knew) {
  await tool('card.review', { id: card.id, knew, today: isoToday() });
  state.cardFace = 'front';
  state.cardRows = await tool('card.list', { today: isoToday() });
  paintCenter();
}

function syncWeekly() {
  const existing = $('#revisao-semana');
  if (new Date().getDay() !== 0) {
    existing?.remove();
    return;
  }
  if (existing || !$('#centro')) return;
  const bar = document.createElement('div');
  bar.id = 'revisao-semana';
  bar.className = 'aviso';
  bar.setAttribute('role', 'status');
  bar.textContent = 'Domingo: a revisão da semana está pronta. A Sofi não altera as notas sozinha.';
  $('#centro').prepend(bar);
}

function paintCenter() {
  const center = $('#centro');
  if (!center || state.painting) return;
  state.painting = true;
  try {
    paintCenterBody(center);
  } finally {
    state.painting = false;
  }
  syncNav();
  bindBlockDrag();
  syncWeekly();
  syncConnectionsPanel();
}

function bindBlockDrag() {
  document.querySelectorAll('[data-menu]').forEach((handle) => {
    handle.draggable = true;
    handle.ondragstart = (event) => {
      event.dataTransfer.setData('application/x-sophy-block', handle.dataset.menu);
      event.dataTransfer.effectAllowed = 'move';
      event.stopPropagation();
    };
  });
  document.querySelectorAll('.bloco-linha').forEach((row) => {
    row.ondragover = (event) => {
      if ([...event.dataTransfer.types].includes('application/x-sophy-block')) event.preventDefault();
    };
    row.ondrop = (event) => {
      if (event.defaultPrevented) return;
      const from = Number(event.dataTransfer.getData('application/x-sophy-block'));
      const block = row.querySelector('[data-block]');
      if (!block || Number.isNaN(from)) return;
      event.preventDefault();
      event.stopPropagation();
      checkpoint(true);
      state.doc = Doc.moveBlock(state.doc, from, Number(block.dataset.block));
      paintCenter();
      scheduleSave();
    };
  });
}

function canvasCardPreview(document) {
  const nodes = document?.nodes || [];
  const plain = (value) =>
    String(value || '')
      .replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
        const label = (alias || target.split(/[/#]/).pop() || target).trim();
        return label;
      })
      .replace(/\[\[[^\]]*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const texts = nodes
    .map((node) => plain(node.text))
    .filter(Boolean);
  if (texts.length) return `<p>${escapeHtml(texts.join(' · ').slice(0, 140))}</p>`;
  const files = nodes.filter((node) => node.type === 'file' && node.file).slice(0, 3);
  if (files.length) {
    return `<p>${files.map((node) => escapeHtml(baseName(node.file))).join(' · ')}</p>`;
  }
  const count = nodes.filter((node) => node.type !== 'group').length;
  if (count) return `<p class="nota-privacidade">${count} elemento${count === 1 ? '' : 's'}</p>`;
  return '<p class="nota-privacidade">Quadro vazio</p>';
}

function canvasCoverId(raw) {
  const resolved = Cmd.resolveCover({ capa: raw });
  return resolved?.kind === 'arte' ? resolved.id : '';
}

function canvasGalleryMeta(file, document) {
  const mark = markFor(file.workspace);
  const tinted = (document?.nodes || []).find((node) => node.color || node.borderColor);
  const color = tinted?.color || tinted?.borderColor || mark?.color || '';
  return { html: canvasCardPreview(document), color, capa: canvasCoverId(document?.capa) };
}

async function setCanvasCover(file, name) {
  const current = await tool('canvas.read', { path: file });
  const capa = name ? `sophy:${name}` : '';
  await tool('canvas.update', {
    path: file,
    document: { ...current.document, capa },
    expectedRevision: current.revision,
  });
  state.canvasGalleryLoaded = false;
  paintCenter();
}

function openCanvasCoverPicker(file, anchor) {
  closeMenus();
  const entry = state.canvasGallery?.[file.path];
  const current = typeof entry === 'object' ? entry.capa || '' : '';
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante canvas-capa-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Capa do canvas');
  const arts = Cmd.COVER_IDS.map(
    (id) =>
      `<button type="button" class="capa-opcao${current === id ? ' is-escolhida' : ''}" data-cover-name="${escapeHtml(id)}"><span class="capa-opcao__arte"><svg class="capa__arte" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#capa-${id}"/></svg></span><span class="capa-opcao__nome">${escapeHtml(Cmd.COVER_NAMES[id] || id)}</span></button>`,
  ).join('');
  menu.innerHTML = `<div class="canvas-capa-menu__topo"><strong>Escolher capa</strong><button type="button" class="btn btn--fantasma" data-fechar aria-label="Fechar">×</button></div><div class="canvas-capa-menu__grade">${arts}</div><button type="button" class="menu__item" data-cover-name="">Remover capa</button>`;
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 368))}px`;
  const top = rect.bottom + 6;
  menu.style.top = `${top + 420 > window.innerHeight ? Math.max(8, rect.top - 420) : top}px`;
  menu.addEventListener('mousedown', (event) => event.stopPropagation());
  menu.querySelector('[data-fechar]').onclick = () => closeMenus();
  menu.querySelectorAll('[data-cover-name]').forEach((button) => {
    button.onclick = async () => {
      closeMenus();
      try {
        await setCanvasCover(file, button.dataset.coverName || '');
      } catch (error) {
        toast(error.message, 'erro');
      }
    };
  });
}

function paintCanvasGallery(center) {
  const boards = state.canvases || [];
  const count = boards.length;
  const cards = boards
    .map((file) => {
      const entry = state.canvasGallery?.[file.path];
      const preview =
        typeof entry === 'string'
          ? { html: entry || '<p class="nota-privacidade">Quadro vazio</p>', color: markFor(file.workspace)?.color || '', capa: '' }
          : entry || { html: '<p class="nota-privacidade">…</p>', color: markFor(file.workspace)?.color || '', capa: '' };
      const tint = preview.color ? `--cartao-cor: var(--shelf-${preview.color})` : '';
      const capa = preview.capa
        ? `<span class="canvas-cartao__capa" aria-hidden="true"><svg class="canvas-cartao__capa-arte" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice"><use href="#capa-${escapeHtml(preview.capa)}"/></svg></span>`
        : '';
      return `<article class="canvas-galeria-item"><button type="button" class="canvas-cartao${preview.capa ? ' canvas-cartao--com-capa' : ''}${preview.color ? ' canvas-cartao--com-cor' : ''}" data-abrir-canvas="${escapeHtml(file.path)}"${tint ? ` style="${tint}"` : ''}><span class="canvas-cartao__previa">${capa}${preview.html || '<p class="nota-privacidade">…</p>'}</span><span class="canvas-cartao__meta"><strong>${escapeHtml(baseName(file.path))}</strong><span>${escapeHtml(file.workspace || 'Biblioteca')}</span></span></button><div class="canvas-galeria-acoes"><button type="button" class="btn btn--secundario btn--pequeno" data-cover data-file="${escapeHtml(file.path)}">Capa</button><button type="button" class="btn btn--secundario btn--pequeno" data-trash data-file="${escapeHtml(file.path)}">Excluir</button></div></article>`;
    })
    .join('');
  const empty = count
    ? ''
    : `<div class="canvas-grade__vazio"><strong>Nenhum canvas ainda</strong><p>Crie um quadro para ligar notas, formas e ideias.</p></div>`;
  center.innerHTML = `<div class="canvas-grade"><header class="canvas-grade__topo"><div><h2>Canvas</h2><p>${count ? `${count} quadro${count === 1 ? '' : 's'} · capas, formas e wikilinks` : 'Quadros livres para ligar ideias, notas e formas.'}</p></div><button type="button" class="btn btn--primario" id="atalho-novo-canvas">${icon('canvas')} Novo canvas</button></header>${empty}${cards}<button type="button" class="canvas-cartao canvas-cartao--novo" id="atalho-novo-canvas-card">${icon('canvas')}<strong>Novo canvas</strong><span>Começar um quadro em branco</span></button></div>`;
  center.querySelectorAll('[data-abrir-canvas]').forEach((button) => {
    button.onclick = () => openCanvas(button.dataset.abrirCanvas);
  });
  center.querySelectorAll('[data-cover]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openCanvasCoverPicker(button.dataset.file, button);
    };
  });
  center.querySelectorAll('[data-trash]').forEach((button) => {
    button.onclick = async (event) => {
      event.stopPropagation();
      const file = button.dataset.file;
      if (!(await confirmDialog(`Mover o canvas “${baseName(file)}” para a lixeira?`))) return;
      try {
        await trashPath(file, 'canvas');
      } catch (error) {
        toast(error.message, 'erro');
      }
    };
  });
  const create = () => runCommand('novo-canvas');
  $('#atalho-novo-canvas')?.addEventListener('click', create);
  $('#atalho-novo-canvas-card')?.addEventListener('click', create);
  if (!state.canvasGalleryLoaded) loadCanvasGallery();
}

async function loadCanvasGallery() {
  state.canvasGalleryLoaded = true;
  const gallery = {};
  for (const file of state.canvases || []) {
    try {
      const canvas = await tool('canvas.read', { path: file.path });
      gallery[file.path] = canvasGalleryMeta(file, canvas.document);
    } catch {
      gallery[file.path] = {
        html: '',
        color: markFor(file.workspace)?.color || '',
        capa: '',
      };
    }
  }
  state.canvasGallery = gallery;
  if (state.view === 'canvases') paintCenter();
}

function syncNav() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    if (button.dataset.nav === state.nav) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function paintCenterBody(center) {
  if (state.graphView) {
    state.graphView.destroy();
    state.graphView = null;
  }
  if (state.view === 'trash') {
    paintTrash(center);
    return;
  }
  if (state.view === 'canvases') {
    paintCanvasGallery(center);
    return;
  }
  if (state.view === 'tasks') {
    paintTasks(center);
    return;
  }
  if (state.view === 'calendar') {
    paintCalendar(center);
    return;
  }
  if (state.view === 'home') {
    paintHome(center);
    return;
  }
  if (state.view === 'views') {
    paintViews(center);
    return;
  }
  if (state.view === 'cards') {
    paintCards(center);
    return;
  }
  if (state.view === 'versions') {
    paintVersions(center);
    return;
  }
  if (state.view === 'review') {
    paintReview(center);
    return;
  }
  if (state.view === 'settings') {
    paintSettings(center);
    return;
  }
  if (state.view === 'shelf') {
    const notes = state.notes.filter((note) => note.workspace === state.selectedShelf);
    const boards = state.canvases.filter((file) => file.workspace === state.selectedShelf);
    center.innerHTML = notes.length || boards.length
      ? `<div class="vazio-ensina"><h2>${escapeHtml(state.selectedShelf)}</h2><p>${notes.length} notas · ${boards.length} canvas</p></div>`
      : `<div class="vazio-estante vazio-ensina"><h2>${escapeHtml(state.selectedShelf)} está vazia</h2><p>Crie a primeira nota desta estante, ou um canvas, pelo botão Novo.</p><button type="button" class="btn btn--primario" id="estante-nova-nota">${icon('nota-nova')} Nova nota aqui</button></div>`;
    const create = $('#estante-nova-nota');
    if (create) create.onclick = () => createNote();
    return;
  }
  if (state.view === 'soon') {
    center.innerHTML = `<div class="vazio-ensina"><h2>${escapeHtml(state.soonTitle || 'Em seguida')}</h2><p>Esta tela entra na próxima etapa. As notas continuam Markdown.</p></div>`;
    return;
  }
  if (state.view === 'graph') {
    paintGraph(center);
    return;
  }
  if (state.view === 'canvas-error') {
    center.innerHTML = `<div class="vazio-ensina"><h2>Não foi possível abrir o canvas</h2><p>${escapeHtml(state.canvasError || 'O quadro não pôde ser lido.')}</p></div>`;
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
      peekNote: async (file) => {
        const path = file.endsWith('.md') ? file : `${file}.md`;
        const cached =
          state.canvasPreviews[path] || state.canvasPreviews[path.replace(/\.md$/i, '')];
        if (cached) return cached;
        try {
          const note = await tool('note.read', { path });
          const preview = {
            title: baseName(note.path || path),
            body: note.body || '',
            html: Cmd.notePreviewHtml(note.body || ''),
            path: note.path || path,
          };
          state.canvasPreviews[path] = preview;
          return preview;
        } catch {
          return null;
        }
      },
      shelf: (file) => {
        const parts = String(file || '').split('/');
        return parts.length > 1 ? markFor(parts[0]) : null;
      },
      icon,
      nextId: () => Math.random().toString(16).slice(2, 10),
      openNote: (file) => openNote(file).catch((error) => toast(error.message, 'erro')),
      notify: (message) => toast(message),
      brokenLink: (raw) => {
        const inner = String(raw || '')
          .replace(/^!?\[\[/, '')
          .replace(/\]\]$/, '');
        const target = Doc.linkTarget(inner);
        const path = target.toLowerCase().endsWith('.md') ? target : `${target}.md`;
        return !state.notes.some(
          (note) =>
            note.path === path ||
            note.path.replace(/\.md$/i, '') === target ||
            baseName(note.path).toLocaleLowerCase() === target.toLocaleLowerCase(),
        );
      },
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
  const cover = coverBand();
  const strip = dailyStrip(state.active);
  const layout = noteLayout();
  const layoutClasses = [`nota--font-${layout.font}`, layout.small ? 'nota--small' : '', layout.wide ? 'nota--wide' : ''].filter(Boolean).join(' ');
  const noteTools = `<div class="nota-ferramentas"><button type="button" class="btn ${state.focusMode ? 'btn--primario nota-foco-sair' : 'btn--icone'}" id="modo-foco" data-focus-toggle aria-label="${state.focusMode ? 'Sair do modo foco' : 'Ativar modo foco'}" aria-pressed="${state.focusMode}">${state.focusMode ? 'Sair do foco' : icon('foco-no')}</button><button type="button" class="btn btn--icone" id="nota-mais" aria-label="Opções da nota" aria-haspopup="true">•••</button></div>`;
  center.innerHTML = `${conflict}<article class="coluna ${layoutClasses}" id="coluna">${noteTools}${strip}${cover}<p class="nota__caminho">${crumb}</p>${title}<div class="nota__meta">${chips}</div>${notePropertiesHtml()}${blocks}</article>`;
  const reload = $('#recarregar');
  if (reload) reload.onclick = () => openNote(state.active, { force: true });
  const changeCover = $('#trocar-capa');
  if (changeCover) changeCover.onclick = () => openCoverPicker();
  $('#coluna').querySelectorAll('[data-dia]').forEach((button) => {
    button.onclick = () => openDailyOn(button.dataset.dia);
  });
  const focusMode = $('#modo-foco');
  if (focusMode) focusMode.onclick = () => { setFocusMode(!state.focusMode); paintCenter(); };
  const noteMore = $('#nota-mais');
  if (noteMore) noteMore.onclick = () => openNoteMenu(noteMore);
  $('#adicionar-propriedade')?.addEventListener('click', () => openPropertyEditor());
  $('#coluna').querySelectorAll('[data-property-edit]').forEach((button) => {
    button.onclick = () => openPropertyEditor(button.dataset.propertyEdit);
  });
  $('#coluna').querySelectorAll('[data-property-value]').forEach((input) => {
    input.onchange = async () => {
      const properties = noteProperties().map((item) => ({ ...item }));
      const property = properties.find((item) => item.id === input.dataset.propertyValue);
      if (!property) return;
      property.value = property.type === 'checkbox' ? input.checked : input.value;
      await setNoteProperties(properties);
    };
  });
  $('#coluna').querySelectorAll('[data-property-picker]').forEach((button) => {
    button.onclick = () => openPropertyValuePicker(button.dataset.propertyPicker, button);
  });
  $('#coluna').querySelectorAll('[data-property-multi]').forEach((input) => {
    input.onchange = async () => {
      const properties = noteProperties().map((item) => ({ ...item, value: Array.isArray(item.value) ? [...item.value] : item.value }));
      const property = properties.find((item) => item.id === input.dataset.propertyMulti);
      if (!property) return;
      property.value = [...document.querySelectorAll(`[data-property-multi="${CSS.escape(property.id)}"]:checked`)].map((item) => item.value);
      await setNoteProperties(properties);
    };
  });
  $('#coluna').querySelectorAll('[data-property-remove]').forEach((button) => {
    button.onclick = async () => {
      const property = noteProperties().find((item) => item.id === button.dataset.propertyRemove);
      if (!property || !window.confirm(`Remover a propriedade “${property.name}”?`)) return;
      await setNoteProperties(noteProperties().filter((item) => item.id !== property.id));
    };
  });
  $('#coluna')
    .querySelectorAll('[data-block]:not(table)')
    .forEach((el) => bindBlock(el));
  $('#coluna')
    .querySelectorAll('[data-mais]')
    .forEach((button) => {
      button.onclick = () => insertBlockBelow(Number(button.dataset.mais));
  });
  $('#coluna')
    ?.querySelectorAll('[data-menu]')
    .forEach((button) => {
      button.onclick = (event) => openBlockMenu(event.currentTarget, Number(button.dataset.menu));
      button.draggable = true;
      button.ondragstart = (event) => {
        event.dataTransfer.setData('application/x-sophy-block', button.dataset.menu);
        event.dataTransfer.effectAllowed = 'move';
      };
    });
  $('#coluna')
    ?.querySelectorAll('[data-block]')
    .forEach((block) => {
      block.addEventListener('dragover', (event) => {
        if (
          event.dataTransfer.types.includes('application/x-sophy-block') ||
          [...event.dataTransfer.types].includes('Files')
        )
          event.preventDefault();
      });
      block.addEventListener('drop', (event) => {
        if (event.dataTransfer.files?.length) {
          event.preventDefault();
          event.stopPropagation();
          ingestImageBlobs(event.dataTransfer.files).catch((error) => toast(error.message, 'erro'));
          return;
        }
        const from = Number(event.dataTransfer.getData('application/x-sophy-block'));
        const to = Number(block.dataset.block);
        if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
        event.preventDefault();
        event.stopPropagation();
        checkpoint(true);
        state.doc = Doc.moveBlock(state.doc, from, to);
        paintCenter();
        scheduleSave();
      });
    });
  $('#coluna').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-target]');
    if (!link) return;
    event.preventDefault();
    const create = link.classList.contains('wikilink--quebrado');
    followLink(link.dataset.target, {
      create,
      newTab: event.ctrlKey || event.metaKey,
    });
  });
  bindWikiPreview($('#coluna'));
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
    if (title) placeCaret(title, 0);
  }
}

function renderBlock(block, index) {
  if (block.type === 'blank')
    return `<div class="bloco" data-vazio data-block="${index}" contenteditable="true"><br /></div>`;
  if (block.type === 'hr') return `<hr data-block="${index}" />`;
  if (block.type === 'heading') {
    const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
    return `<h${Math.min(block.level, 6)} class="bloco bloco--titulo bloco--titulo${block.level}" data-block="${index}" contenteditable="true">${inlineHtml(text) || '<br>'}</h${Math.min(block.level, 6)}>`;
  }
  if (block.type === 'code') {
    const inner = Doc.codeParts(block.raw).body;
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
      <div class="tarefa__texto" data-block="${index}" contenteditable="true">${inlineHtml(task.title) || '<br>'}</div>
      <div class="tarefa__meta">${chips}</div></div>`;
  }
  if (block.type === 'item') {
    const marker = block.raw.match(/^\s*(\d+)\./);
    const text = block.raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
    const spaces = (block.raw.match(/^ */ ) || [''])[0].length;
    const ordem = marker ? ` data-ordem="${marker[1]}"` : '';
    return `<div class="bloco bloco--item" data-block="${index}"${ordem} style="margin-left:${22 + spaces * 12}px" contenteditable="true">${inlineHtml(text)}</div>`;
  }
  if (block.type === 'quote') {
    const text = block.raw
      .split('\n')
      .map((line) => line.replace(/^>\s?/, ''))
      .join('\n')
      .replace(/\n$/, '');
    if (text.startsWith('[!toggle]')) {
      const body = text.replace(/^\[!toggle\]\n?/, '');
      return `<details class="bloco bloco--recolhivel" open><summary>Recolhível</summary><div class="bloco bloco--citacao" data-block="${index}" data-toggle="1" contenteditable="true">${inlineHtml(body) || '<br>'}</div></details>`;
    }
    const callout = text.startsWith('[!') ? ' bloco--destaque' : '';
    return `<blockquote class="bloco bloco--citacao${callout}" data-block="${index}" contenteditable="true">${inlineHtml(text) || '<br>'}</blockquote>`;
  }
  if (block.type === 'table') {
    const rows = tableRows(block.raw);
    const body = rows
      .map(
        (row, rowIndex) =>
          `<tr>${row.map((cell, cellIndex) => `<td data-block="${index}" data-cell="${rowIndex}:${cellIndex}" contenteditable="true">${inlineHtml(cell) || '<br>'}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table class="bloco bloco--tabela" data-block="${index}"><tbody>${body}</tbody></table>`;
  }
  const embed = block.raw.trim().match(/^!\[\[([^\]\n]+)\]\]$/);
  if (embed) {
    return `<div class="bloco-linha"><div class="bloco-alca"><button type="button" class="bloco-alca__btn bloco__mais" data-mais="${index}" aria-label="Inserir bloco abaixo">${icon('mais')}</button><button type="button" class="bloco-alca__btn bloco-alca__btn--arrastar" data-menu="${index}" aria-label="Mover ou abrir o menu do bloco">${icon('arrastar')}</button></div><figure class="embed" data-block="${index}" data-embed="${escapeHtml(embed[1])}"><div class="embed__caminho">${escapeHtml(embed[1])}</div><div class="embed__corpo">…</div></figure></div>`;
  }
  const text = block.raw.replace(/\n$/, '');
    const empty = text.trim() === '';
    const hint = empty ? ' data-dica="1" data-placeholder="Digite / para comandos"' : '';
    return `<div class="bloco-linha"><div class="bloco-alca"><button type="button" class="bloco-alca__btn bloco__mais" data-mais="${index}" aria-label="Inserir bloco abaixo">${icon('mais')}</button><button type="button" class="bloco-alca__btn bloco-alca__btn--arrastar" data-menu="${index}" aria-label="Mover ou abrir o menu do bloco">${icon('arrastar')}</button></div><p class="bloco bloco--texto" data-block="${index}"${hint} contenteditable="true">${inlineHtml(text) || '<br>'}</p></div>`;
}

function inlineHtml(text) {
  const html = SophyWriting.inlineHtml(text, (raw) =>
    state.outgoing.some(
      (link) => link.raw === raw && (link.status === 'broken' || link.status === 'ambiguous'),
    ),
  );
  return html.replace(/<a href="#" class="wikilink([^"]*)"([^>]*)>/g, (all, cls, attrs) => {
    const targetMatch = attrs.match(/data-target="([^"]*)"/);
    const target = targetMatch
      ? targetMatch[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
      : '';
    const note = Cmd.parseWikiDraft(target).note;
    const resolved =
      state.outgoing.find((link) => link.path && (link.raw.includes(target) || foldText(link.path) === foldText(`${note}.md`)))
        ?.path ||
      state.notes.find(
        (item) =>
          foldText(item.path.replace(/\.md$/i, '')) === foldText(note) ||
          foldText(baseName(item.path)) === foldText(note),
      )?.path;
    const shelf = resolved?.includes('/') ? resolved.split('/')[0] : null;
    const mark = shelf ? markFor(shelf) : null;
    const tint = mark?.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
    return `<a href="#" class="wikilink${cls}"${attrs}><span class="chip__ponto wikilink__ponto" aria-hidden="true"${tint}></span>`;
  });
}

function bindBlock(el) {
  el.addEventListener('compositionstart', () => { state.composing = true; });
  el.addEventListener('compositionend', () => { state.composing = false; onBlockInput(el); });
  el.addEventListener('input', (event) => { if (!event.isComposing && !state.composing) onBlockInput(el); });
  el.addEventListener('beforeinput', (event) => {
    if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') event.preventDefault();
    if (event.inputType?.startsWith('insert')) {
      el.dataset.hasContent = '1';
      delete el.dataset.dica;
      el.removeAttribute('data-placeholder');
    }
  });
  el.addEventListener('keydown', (event) => onBlockKey(event, el));
  el.addEventListener('paste', (event) => onBlockPaste(event, el));
  el.addEventListener('focus', () => {
    if (!markdownFromDom(el).trim()) {
      requestAnimationFrame(() => {
        if (document.activeElement === el && !markdownFromDom(el).trim()) placeCaret(el, 0);
      });
    }
  });
  el.addEventListener('blur', () => {
    if (el.matches('.bloco--titulo') && Number(el.dataset.block) === 0) {
      syncNoteNameFromTitle();
    }
  });
  el.addEventListener('mousedown', (event) => {
    if (!event.shiftKey) state.blockRange = null;
    else {
      const index = Number(el.dataset.block);
      if (!state.blockRange) state.blockRange = { anchor: index, end: index };
      else state.blockRange.end = index;
      paintBlockSelection();
    }
  });
}

function markdownFromDom(el) {
  return el ? SophyWriting.markdown(el) : '';
}

function rawFromEditor(el, block) {
  if (!block) return '\n';
  if (block.type === 'heading') {
    const marks = '#'.repeat(block.level || 1);
    return `${marks} ${markdownFromDom(el).replace(/\n/g, ' ').trim()}\n`;
  }
  if (block.type === 'code') {
    const parts = Doc.codeParts(block.raw);
    return Doc.codeRaw(parts.fence, parts.info, el.textContent);
  }
  if (block.type === 'task' && block.task) {
    const task = { ...block.task, title: markdownFromDom(el).replace(/\n/g, ' ').trim() };
    return `${Doc.serializeTask(task)}\n`;
  }
  if (block.type === 'item') {
    const marker = (block.raw.match(/^\s*(?:[-*+]|\d+\.)/) || ['-'])[0];
    return `${marker} ${markdownFromDom(el).replace(/\n$/, '')}\n`;
  }
  if (block.type === 'quote') {
    const lines = markdownFromDom(el).replace(/\n$/, '').split('\n');
    const body = el.dataset.toggle === '1' ? ['[!toggle]', ...lines] : lines;
    return `${body.map((line) => `> ${line}`).join('\n')}\n`;
  }
  const text = markdownFromDom(el).replace(/\n$/, '');
  return `${text}\n`;
}

function readEditable(el) {
  return markdownFromDom(el);
}

function tableRows(raw) {
  return Doc.tableModel(raw).rows;
}

function wrapWidth(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return [0, 0];
  if (node.dataset?.raw) return [0, 0];
  const tag = node.tagName;
  if (tag === 'STRONG' || tag === 'B' || tag === 'S' || tag === 'DEL' || tag === 'MARK') return [2, 2];
  if (tag === 'EM' || tag === 'I' || tag === 'CODE') return [1, 1];
  if (tag === 'A' && !node.dataset?.raw) return [1, `](${node.getAttribute('href') || ''})`.length];
  return [0, 0];
}

function onBlockInput(el) {
  if (state.conflict || !state.doc || state.restoring || state.painting || state.richApplying || state.composing) return;
  checkpoint();
  if (el.dataset.cell != null) {
    syncTable(el.closest('table'));
    return;
  }
  const block = state.doc.blocks[Number(el.dataset.block)];
  SophyWriting.normalizeInline(el);
  if (block && block.type !== 'code') renderClosedMarks(el);
  if (promoteBlock(el)) return;
  const index = Number(el.dataset.block);
  state.doc = Doc.withBlockRaw(state.doc, index, rawFromEditor(el, state.doc.blocks[index]));
  const cursor = modelOffset(el);
  const text = readEditable(el);
  if (text.trim()) {
    el.dataset.hasContent = '1';
    delete el.dataset.dica;
    el.removeAttribute('data-placeholder');
  } else if (el.matches('.bloco--texto')) {
    delete el.dataset.hasContent;
    el.dataset.dica = '1';
    el.dataset.placeholder = 'Digite / para comandos';
  }
  const found = slash.offer(text, cursor);
  const wiki = Cmd.wikiQuery(text, cursor);
  if (found) showSlash(el, found);
  else if (wiki) showWiki(el, wiki);
  else closeMenus();
  scheduleSave();
  paintStatus();
}

const LIVE_MARK = /(\[\[[^\[\]\n]+\]\]|\*\*[^*\n]+?\*\*|~~[^~\n]+?~~|==[^=\n]+?==|`[^`\n]+?`|(?<!\*)\*(?!\s)[^*\n]+?\*(?!\*))/;

function renderClosedMarks(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) {
    if (current.parentElement?.closest('strong, em, s, code, mark, a')) continue;
    nodes.push(current);
  }
  for (const node of nodes) {
    const match = node.textContent.match(LIVE_MARK);
    if (!match) continue;
    const start = match.index || 0;
    const html = inlineHtml(match[0]);
    const placed = replaceTextSlice(node, start, match[0].length, html);
    const selection = getSelection();
    const range = document.createRange();
    if (placed) range.setStartAfter(placed);
    else {
      const next = node.parentNode?.childNodes[0];
      if (next) range.setStart(next, Math.min(start + match[0].length, next.textContent?.length || 0));
      else range.setStart(el, 0);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
}

function replaceTextSlice(node, start, length, html) {
  const text = node.textContent;
  const holder = document.createElement('span');
  holder.innerHTML = html;
  const frag = document.createDocumentFragment();
  if (start > 0) frag.append(document.createTextNode(text.slice(0, start)));
  let placed = null;
  [...holder.childNodes].forEach((child) => {
    if (!placed && child.nodeType === Node.ELEMENT_NODE) placed = child;
    frag.append(child);
  });
  if (start + length < text.length) frag.append(document.createTextNode(text.slice(start + length)));
  node.parentNode.replaceChild(frag, node);
  return placed;
}

function promoteBlock(el) {
  const index = Number(el.dataset.block);
  const block = state.doc?.blocks[index];
  if (!block) return false;
  const text = markdownFromDom(el).replace(/\n$/, '');
  if (block.type === 'item') {
    const task = text.match(/^\[([ xX]?)\] (.*)$/);
    if (!task) return false;
    const status = task[1].toLowerCase() === 'x' ? 'x' : ' ';
    const indent = (block.raw.match(/^\s*/) || [''])[0];
    checkpoint(true);
    state.doc = Doc.replaceBlock(state.doc, index, `${indent}- [${status}] ${task[2]}\n`);
    state.caret = { index, offset: task[2].length };
    closeMenus();
    paintCenter();
    scheduleSave();
    return true;
  }
  if (block.type !== 'paragraph' && block.type !== 'blank') return false;
  let raw = '';
  let caret = 0;
  const heading = text.match(/^(#{1,6}) (.*)$/);
  const taskLine = text.match(/^- \[([ xX]?)\] (.*)$/);
  if (taskLine) {
    const status = taskLine[1].toLowerCase() === 'x' ? 'x' : ' ';
    raw = `- [${status}] ${taskLine[2]}\n`;
    caret = taskLine[2].length;
  } else if (heading) {
    raw = `${heading[1]} ${heading[2]}\n`;
    caret = heading[2].length;
  } else if (/^[-*+] /.test(text)) {
    raw = `${text}\n`;
    caret = text.replace(/^[-*+] /, '').length;
  } else if (/^\d+\. /.test(text)) {
    raw = `${text}\n`;
    caret = text.replace(/^\d+\. /, '').length;
  } else if (/^(?:\[\]|\[ \]) /.test(text)) {
    const title = text.replace(/^(?:\[\]|\[ \]) /, '');
    raw = `- [ ] ${title}\n`;
    caret = title.length;
  } else if (/^> /.test(text)) {
    raw = `${text
      .split('\n')
      .map((line) => (line.startsWith('>') ? line : `> ${line}`))
      .join('\n')}\n`;
    caret = text.replace(/^> /, '').length;
  } else if (/^```\w*$/.test(text)) {
    raw = `${text}\n\n\`\`\`\n`;
    caret = 0;
  } else if (text === '---' || text === '***' || text === '___') {
    checkpoint(true);
    state.doc = Doc.replaceBlock(state.doc, index, '---\n');
    const blocks = state.doc.blocks.slice();
    blocks.splice(index + 1, 0, { type: 'paragraph', raw: '\n' });
    state.doc = { ...state.doc, blocks, body: Doc.serializeBlocks(blocks) };
    state.caret = { index: index + 1, offset: 0 };
    closeMenus();
    paintCenter();
    scheduleSave();
    return true;
  } else return false;
  checkpoint(true);
  state.doc = Doc.replaceBlock(state.doc, index, raw);
  state.caret = { index, offset: caret };
  closeMenus();
  paintCenter();
  scheduleSave();
  return true;
}

function syncTable(table) {
  if (!table) return;
  const index = Number(table.dataset.block);
  const model = Doc.tableModel(state.doc.blocks[index]?.raw || '');
  const rows = [...table.querySelectorAll('tr')].map((row) =>
    [...row.querySelectorAll('[data-cell]')].map((cell) => markdownFromDom(cell).replace(/\n/g, ' ').trim()),
  );
  if (!rows.length) return;
  state.doc = Doc.withBlockRaw(state.doc, index, Doc.tableRaw(rows, model.align));
  scheduleSave();
  paintStatus();
}

function rememberCaret() {
  const el = document.activeElement?.closest?.('[data-block]');
  if (!el || el.dataset.block == null) return;
  state.editorCaret = { index: Number(el.dataset.block), offset: modelOffset(el) };
}

function editorSnap() {
  return JSON.stringify(state.doc.blocks.map((block) => ({ type: block.type, raw: block.raw, level: block.level })));
}

function checkpoint(force) {
  if (!state.doc || state.restoring) return;
  rememberCaret();
  if (state.undoOpen && !force) return;
  const snap = editorSnap();
  state.editorPast = state.editorPast || [];
  state.editorFuture = state.editorFuture || [];
  if (state.editorPast.at(-1) !== snap) state.editorPast.push(snap);
  if (state.editorPast.length > 80) state.editorPast.shift();
  state.editorFuture.length = 0;
  state.undoOpen = !force;
  clearTimeout(state.undoTimer);
  if (!force) {
    state.undoTimer = setTimeout(() => {
      state.undoOpen = false;
      if (!state.doc || state.restoring) return;
      const latest = editorSnap();
      if (state.editorPast.at(-1) !== latest) state.editorPast.push(latest);
    }, 700);
  }
}

function applyEditorSnap(snap) {
  state.restoring = true;
  const blocks = JSON.parse(snap).map((block) => ({ ...block, task: Doc.parseTask(block.raw) }));
  state.doc = { ...state.doc, blocks, body: blocks.map((block) => block.raw).join('') };
  const caret = state.editorCaret;
  paintCenter();
  if (caret) {
    const target = document.querySelector(`[data-block="${Math.min(caret.index, blocks.length - 1)}"]`);
    if (target) placeCaret(target, Math.min(caret.offset, markdownFromDom(target).length));
  }
  state.restoring = false;
  scheduleSave();
}

function undoDoc() {
  if (!state.doc) return;
  clearTimeout(state.undoTimer);
  state.editorPast = state.editorPast || [];
  state.editorFuture = state.editorFuture || [];
  const current = JSON.stringify(state.doc.blocks.map((block) => ({ type: block.type, raw: block.raw, level: block.level })));
  if (state.editorPast.at(-1) === current) state.editorPast.pop();
  const snap = state.editorPast.pop();
  if (!snap) return;
  state.editorFuture.push(current);
  state.undoOpen = false;
  applyEditorSnap(snap);
}

function redoDoc() {
  clearTimeout(state.undoTimer);
  const snap = state.editorFuture?.pop();
  if (!snap || !state.doc) return;
  const current = JSON.stringify(state.doc.blocks.map((block) => ({ type: block.type, raw: block.raw, level: block.level })));
  state.editorPast = state.editorPast || [];
  state.editorPast.push(current);
  state.undoOpen = false;
  applyEditorSnap(snap);
}

function focusSibling(index, direction) {
  let next = index + direction;
  while (state.doc.blocks[next] && (state.doc.blocks[next].type === 'hr' || state.doc.blocks[next].type === 'blank')) next += direction;
  const target = document.querySelector(`[data-block="${next}"]`);
  if (!target) return;
  placeCaret(target, direction < 0 ? markdownFromDom(target).length : 0);
}

function paintBlockSelection() {
  const range = state.blockRange;
  document.querySelectorAll('[data-block]').forEach((block) => {
    const index = Number(block.dataset.block);
    if (!range) {
      block.classList.remove('is-selecionado');
      return;
    }
    const low = Math.min(range.anchor, range.end);
    const high = Math.max(range.anchor, range.end);
    block.classList.toggle('is-selecionado', low !== high && index >= low && index <= high);
  });
}

function onBlockKey(event, el) {
  if (Writing.key(event, el)) return;
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
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
    event.preventDefault();
    setFocusMode(!state.focusMode);
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
    event.preventDefault();
    const index = Number(el.dataset.block);
    const text = readEditable(el).replace(/\n$/, '');
    checkpoint(true);
    state.doc = Doc.replaceBlock(state.doc, index, `- [ ] ${text}\n`);
    state.caret = { index, offset: text.length };
    paintCenter();
    scheduleSave();
    return;
  }
  if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === 'Tab')) {
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
    if ((event.key === 'Enter' || event.key === 'Tab') && current >= 0) {
      event.preventDefault();
      items[current].click();
    }
    return;
  }
  const index = Number(el.dataset.block);
  if (event.key === 'Tab' && !event.altKey) {
    event.preventDefault();
    const block = state.doc.blocks[index];
    if (block && (block.type === 'item' || block.type === 'task')) {
      checkpoint(true);
      const raw = event.shiftKey ? block.raw.replace(/^ {1,2}/, '') : `  ${block.raw}`;
      const caret = modelOffset(el);
      state.doc = Doc.withBlockRaw(state.doc, index, raw);
      state.caret = { index, offset: caret };
      paintCenter();
      scheduleSave();
    }
    return;
  }
  if ((event.metaKey || event.ctrlKey) && ['c', 'x'].includes(event.key.toLowerCase()) && state.blockRange && state.blockRange.anchor !== state.blockRange.end) {
    event.preventDefault();
    const low = Math.min(state.blockRange.anchor, state.blockRange.end);
    const high = Math.max(state.blockRange.anchor, state.blockRange.end);
    const copied = state.doc.blocks.slice(low, high + 1).map((block) => block.raw).join('');
    state.clip = copied;
    navigator.clipboard?.writeText(copied).catch(() => {});
    if (event.key.toLowerCase() === 'x') {
      checkpoint(true);
      const blocks = state.doc.blocks.filter((_, position) => position < low || position > high);
      state.doc = { ...state.doc, blocks, body: blocks.map((block) => block.raw).join('') };
      state.blockRange = null;
      state.caret = { index: Math.max(0, low - 1), offset: 0 };
      paintCenter();
      scheduleSave();
    }
    return;
  }
  if (event.key === 'ArrowUp' && !event.shiftKey && modelOffset(el) === 0) {
    event.preventDefault();
    focusSibling(index, -1);
    return;
  }
  if (event.key === 'ArrowDown' && !event.shiftKey && modelOffset(el) >= markdownFromDom(el).length) {
    event.preventDefault();
    focusSibling(index, 1);
    return;
  }
  if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.shiftKey && (event.key === 'ArrowUp' ? modelOffset(el) === 0 : modelOffset(el) >= markdownFromDom(el).length)) {
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    if (!state.blockRange) state.blockRange = { anchor: index, end: index };
    const next = state.blockRange.end + direction;
    if (state.doc.blocks[next]) state.blockRange.end = next;
    paintBlockSelection();
    return;
  }
  if ((event.key === 'Backspace' || event.key === 'Delete') && state.blockRange && state.blockRange.anchor !== state.blockRange.end) {
    event.preventDefault();
    const low = Math.min(state.blockRange.anchor, state.blockRange.end);
    const high = Math.max(state.blockRange.anchor, state.blockRange.end);
    checkpoint(true);
    const blocks = state.doc.blocks.filter((_, position) => position < low || position > high);
    state.doc = { ...state.doc, blocks, body: blocks.map((block) => block.raw).join('') };
    state.blockRange = null;
    state.caret = { index: Math.max(0, low - 1), offset: 0 };
    paintCenter();
    scheduleSave();
    return;
  }
  if (event.key === 'Enter' && el.dataset.cell != null) {
    event.preventDefault();
    checkpoint(true);
    const rows = tableRows(state.doc.blocks[index]?.raw || '');
    const width = rows[0]?.length || 2;
    rows.push(Array.from({ length: width }, () => ''));
    const lines = [
      `| ${rows[0].join(' | ')} |`,
      `| ${rows[0].map(() => '---').join(' | ')} |`,
      ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
    ];
    state.doc = Doc.withBlockRaw(state.doc, index, `${lines.join('\n')}\n`);
    paintCenter();
    scheduleSave();
    return;
  }
  if (event.key === 'Enter' && el.dataset.toggle === '1') {
    event.preventDefault();
    checkpoint(true);
    const text = markdownFromDom(el);
    const offset = modelOffset(el);
    const raw = `> [!toggle]\n> ${text.slice(0, offset)}\n\n> [!toggle]\n> ${text.slice(offset)}\n`;
    state.doc = Doc.replaceBlock(state.doc, index, raw);
    state.caret = { index: index + 2, offset: 0 };
    paintCenter();
    scheduleSave();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    checkpoint(true);
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
    checkpoint(true);
    const result = Doc.joinBlocks(state.doc, index);
    state.doc = result.doc;
    state.caret = result.caret;
    paintCenter();
    scheduleSave();
    return;
  }
  if (event.key === 'Delete' && !event.metaKey && !event.ctrlKey) {
    const text = markdownFromDom(el);
    const offset = modelOffset(el);
    if (!text.trim() && offset === 0) {
      event.preventDefault();
      if (index <= 0) return;
      checkpoint(true);
      const result = Doc.joinBlocks(state.doc, index);
      state.doc = result.doc;
      state.caret = result.caret;
      paintCenter();
      scheduleSave();
      return;
    }
    if (offset >= text.length) {
      event.preventDefault();
      checkpoint(true);
      const result = Doc.joinForward(state.doc, index);
      state.doc = result.doc;
      state.caret = result.caret;
      paintCenter();
      scheduleSave();
    }
  }
}

function spliceParsed(doc, index, offset, text) {
  const block = doc.blocks[index];
  const visible = Doc.visibleOf(block);
  const before = visible.slice(0, offset);
  const after = visible.slice(offset);
  const chunks = [];
  if (before) chunks.push(rawFromPlain(block, before).replace(/\n$/, ''));
  chunks.push(text.replace(/\n$/, ''));
  if (after) chunks.push(after);
  const parsed = Doc.parseDocument(`${chunks.join('\n')}\n`).blocks;
  const blocks = doc.blocks.slice();
  blocks.splice(index, 1, ...parsed);
  return { ...doc, blocks, body: blocks.map((item) => item.raw).join('') };
}

function onBlockPaste(event, el) {
  const files = event.clipboardData?.files;
  if (files?.length) {
    event.preventDefault();
    ingestImageBlobs(files).catch((error) => toast(error.message, 'erro'));
    return;
  }
  const items = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith('image/'));
  if (items.length) {
    event.preventDefault();
    const blobs = items.map((item) => item.getAsFile()).filter(Boolean);
    ingestImageBlobs(blobs).catch((error) => toast(error.message, 'erro'));
    return;
  }
  if (Writing.paste(event, el)) return;
  const text = event.clipboardData?.getData('text/plain');
  if (text == null) return;
  event.preventDefault();
  if (Writing.replaceAcross(text)) return;
  el = document.activeElement?.matches('[data-block][contenteditable="true"]') ? document.activeElement : el;
  const index = Number(el.dataset.block);
  const range = selectionOffsets(el);
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  checkpoint(true);
  if (el.dataset.cell != null) {
    const current = markdownFromDom(el);
    el.textContent = current.slice(0, start) + text.replace(/\n/g, ' ') + current.slice(end);
    syncTable(el.closest('table'));
    return;
  }
  const block = state.doc.blocks[index];
  if (block?.type === 'code' || !text.includes('\n')) {
    const visible = Doc.visibleOf(block);
    const next = visible.slice(0, start) + text + visible.slice(end);
    state.doc = Doc.withBlockRaw(state.doc, index, rawFromPlain(block, next));
    state.caret = { index, offset: start + text.length };
  } else {
    const result = Doc.pasteLines(state.doc, index, start, text, end);
    state.doc = result.doc;
    state.caret = result.caret;
  }
  paintCenter();
  scheduleSave();
}

function formatBlock(el, prefix, suffix) {
  if (Writing.format(prefix)) return;
  if (prefix === '[') { editWritingLink(el); return; }
  const index = Number(el.dataset.block);
  checkpoint(true);
  const range = selectionOffsets(el);
  const result = Doc.wrapBlock(state.doc, index, range.start, range.end, prefix, suffix);
  state.wrapping = true;
  state.doc = result.doc;
  state.caret = result.caret;
  scheduleSave();
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
      else [...current.childNodes].slice(0, offset).forEach((child) => addWhole(child));
      found = true;
      return;
    }
    addWhole(current, node);
  };
  const addWhole = (current, stop) => {
    if (found || current === stop) return;
    if (current.nodeType === Node.TEXT_NODE) {
      count += current.textContent.replace(/\u200b/g, '').length;
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (current.dataset?.raw) {
      count += current.dataset.raw.length;
      if (stop && current.contains(stop)) found = true;
      return;
    }
    if (current.tagName === 'BR') {
      count += 1;
      return;
    }
    const [open, close] = wrapWidth(current);
    count += open;
    for (const child of current.childNodes) {
      if (child === stop || (stop && child.contains?.(stop))) {
        walk(child);
        return;
      }
      addWhole(child, stop);
      if (found) return;
    }
    count += close;
  };
  walk(el);
  return count;
}

function placeCaret(el, offset) {
  el.focus();
  const selection = getSelection();
  const range = document.createRange();
  let left = Math.max(0, offset);
  const walk = (current) => {
    if (left < 0) return true;
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.textContent.replace(/\u200b/g, '');
      if (left <= text.length) {
        range.setStart(current, Math.min(left, current.textContent.length));
        range.collapse(true);
        left = -1;
        return true;
      }
      left -= text.length;
      return false;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return false;
    if (current.dataset?.raw) {
      if (left <= 0) {
        range.setStartBefore(current);
        range.collapse(true);
        left = -1;
        return true;
      }
      left -= current.dataset.raw.length;
      if (left <= 0) {
        range.setStartAfter(current);
        range.collapse(true);
        left = -1;
        return true;
      }
      return false;
    }
    if (current.tagName === 'BR') {
      if (left <= 0) {
        range.setStartBefore(current);
        range.collapse(true);
        left = -1;
        return true;
      }
      left -= 1;
      if (left <= 0) {
        range.setStartAfter(current);
        range.collapse(true);
        left = -1;
        return true;
      }
      return false;
    }
    const [open, close] = wrapWidth(current);
    left -= open;
    if (left < 0) {
      range.setStart(current, 0);
      range.collapse(true);
      left = -1;
      return true;
    }
    for (const child of current.childNodes) {
      if (walk(child)) return true;
    }
    left -= close;
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
    if (item.id === 'imagem') {
      insertAt(el, found.start, found.start + 1 + found.query.length, '');
      pickAndInsertImages().catch((error) => toast(error.message, 'erro'));
      return;
    }
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
  const draft = Cmd.parseWikiDraft(found.query);
  const catalog = state.linkCatalog.length ? state.linkCatalog : state.notes.map((note) => ({
    path: note.path,
    title: baseName(note.path),
    aliases: [],
    headings: [],
    blockIds: [],
    workspace: note.workspace,
    modifiedAt: note.modifiedAt || 0,
  }));
  const shelf = state.active?.includes('/') ? state.active.slice(0, state.active.indexOf('/')) : null;
  const recent = new Set(state.recentNotes || []);

  if (draft.hasHash && draft.note) {
    const target = catalog.find(
      (note) =>
        foldText(note.path.replace(/\.md$/i, '')) === foldText(draft.note) ||
        foldText(baseName(note.path)) === foldText(draft.note),
    );
    const anchorNeedle = foldText(draft.anchor.replace(/^\^/, ''));
    const sectionRows = (target?.headings || [])
      .filter((heading) => !anchorNeedle || foldText(heading).includes(anchorNeedle))
      .slice(0, 10)
      .map(
        (heading) =>
          `<button type="button" class="menu__item" role="option" data-insert="[[${escapeHtml(draft.note)}#${escapeHtml(heading)}${draft.alias != null ? `|${escapeHtml(draft.alias)}` : ''}]]">${icon('nota')}<span><span class="menu__titulo">${highlight(heading, draft.anchor)}</span><span class="menu__caminho">Seção</span></span></button>`,
      );
    const blockRows = (target?.blockIds || [])
      .filter((id) => !draft.anchor || draft.anchor.startsWith('^') ? foldText(id).includes(anchorNeedle) : foldText(id).includes(anchorNeedle))
      .slice(0, 8)
      .map(
        (id) =>
          `<button type="button" class="menu__item" role="option" data-insert="[[${escapeHtml(draft.note)}#^${escapeHtml(id)}${draft.alias != null ? `|${escapeHtml(draft.alias)}` : ''}]]">${icon('nota')}<span><span class="menu__titulo">^${escapeHtml(id)}</span><span class="menu__caminho">Bloco</span></span></button>`,
      );
    const aliasHint = draft.hasPipe
      ? ''
      : `<button type="button" class="menu__item" role="option" data-insert="[[${escapeHtml(draft.note)}${draft.anchor ? `#${escapeHtml(draft.anchor)}` : ''}|]]">${icon('link')}<span><span class="menu__titulo">Definir texto do link</span><span class="menu__caminho">Adiciona |apelido</span></span></button>`;
    const hashHtml = sectionRows.join('') + blockRows.join('') + aliasHint;
    openMenu(
      el,
      'menu menu--wiki menu-flutuante',
      hashHtml || '<p class="menu__nota">Nenhuma seção nesta nota.</p>',
      (button) => {
        insertAt(el, found.start, found.start + 2 + found.query.length, button.dataset.insert);
      },
    );
    return;
  }

  if (draft.hasPipe && draft.note && !draft.hasHash) {
    const label = draft.alias || '';
    openMenu(
      el,
      'menu menu--wiki menu-flutuante',
      `<button type="button" class="menu__item" role="option" data-insert="[[${escapeHtml(draft.note)}|${escapeHtml(label)}]]">${icon('link')}<span><span class="menu__titulo">${escapeHtml(label || 'Texto do link')}</span><span class="menu__caminho">[[${escapeHtml(draft.note)}|…]]</span></span></button>`,
      (button) => insertAt(el, found.start, found.start + 2 + found.query.length, button.dataset.insert),
    );
    return;
  }

  const needle = draft.note;
  const scored = catalog
    .map((note) => {
      const title = note.title || baseName(note.path);
      const score = Cmd.fuzzyScore(needle, title, baseName(note.path), note.path, ...(note.aliases || []));
      const near = shelf && note.workspace === shelf ? 40 : 0;
      const recentBoost = recent.has(note.path) ? 30 : 0;
      return { note, title, score: score + near + recentBoost, recent: recent.has(note.path) };
    })
    .filter((row) => !needle || row.score > 0)
    .sort((a, b) => b.score - a.score || (b.note.modifiedAt || 0) - (a.note.modifiedAt || 0))
    .slice(0, 10);

  const rows = scored
    .map((row) => {
      const mark = row.note.workspace ? markFor(row.note.workspace) : null;
      const tint = mark?.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
      const alias = (row.note.aliases || []).find((item) => Cmd.fuzzyScore(needle, item) > 0);
      const target = row.note.path.replace(/\.md$/i, '');
      const insert = draft.alias != null ? `[[${target}|${draft.alias}]]` : `[[${target}]]`;
      return `<button type="button" class="menu__item" role="option" data-insert="${escapeHtml(insert)}">
        <span class="chip__ponto" aria-hidden="true"${tint}></span>
        <span><span class="menu__titulo">${highlight(row.title, needle)}</span>
        <span class="menu__caminho">${escapeHtml(row.note.workspace || 'Biblioteca')}${alias ? ` · ${escapeHtml(alias)}` : ''} · ${escapeHtml(target)}</span></span>
        ${row.recent ? '<span class="menu__quando">recente</span>' : ''}</button>`;
    })
    .join('');
  const createLabel = needle || 'sem título';
  const create = needle
    ? `<button type="button" class="menu__item" role="option" data-create="${escapeHtml(needle)}">${icon('nota-nova')} Criar nota “${escapeHtml(createLabel)}”</button>
       <div class="menu__rodape"><span><kbd class="kbd">#</kbd> seção</span><span><kbd class="kbd">|</kbd> texto do link</span></div>`
    : `<div class="menu__rodape"><span><kbd class="kbd">#</kbd> seção</span><span><kbd class="kbd">|</kbd> texto do link</span></div>`;
  openMenu(el, 'menu menu--wiki menu-flutuante', rows + create, (button) => {
    if (button.dataset.create != null) {
      createFromWiki(el, found, button.dataset.create);
      return;
    }
    insertAt(el, found.start, found.start + 2 + found.query.length, button.dataset.insert);
  });
}

function reservedName(name) {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name);
}

function foldText(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
}

function caretClientRect(anchor) {
  const selection = getSelection();
  if (selection?.rangeCount && anchor.contains?.(selection.anchorNode)) {
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    const box = range.getBoundingClientRect();
    if (box.width || box.height || box.top || box.left) return box;
  }
  return anchor.getBoundingClientRect();
}

function placeFloatingMenu(menu, anchorRect) {
  menu.style.position = 'fixed';
  menu.style.zIndex = '46';
  const pad = 10;
  const width = menu.offsetWidth || 320;
  const height = menu.offsetHeight || 200;
  const left = Math.min(Math.max(pad, anchorRect.left), Math.max(pad, window.innerWidth - width - pad));
  const gap = 8;
  const below = anchorRect.bottom + gap;
  const above = anchorRect.top - height - gap;
  const fitsBelow = below + height <= window.innerHeight - pad;
  const fitsAbove = above >= pad;
  let top = fitsBelow ? below : fitsAbove ? above : Math.max(pad, window.innerHeight - height - pad);
  if (top + height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - height - pad);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.dataset.placement = fitsBelow || !fitsAbove ? 'below' : 'above';
}

function openMenu(anchor, className, html, onPick) {
  closeMenus();
  if (!html) return;
  const menu = document.createElement('div');
  menu.className = className;
  menu.setAttribute('role', 'listbox');
  menu.innerHTML = html;
  document.body.append(menu);
  placeFloatingMenu(menu, caretClientRect(anchor));
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
  document.querySelectorAll('#nota-mais[aria-expanded="true"]').forEach((button) => {
    button.removeAttribute('aria-expanded');
  });
  document.querySelectorAll('.menu-flutuante, .seletor-capa').forEach((menu) => {
    if (menu.getAttribute('aria-label') !== 'Conflito') menu.remove();
  });
}

function insertAt(el, start, end, text) {
  const index = Number(el.dataset.block);
  const current = readEditable(el);
  const next = current.slice(0, start) + text + current.slice(end);
  const block = state.doc.blocks[index];
  const structural = /^(?:#{1,6} |[-*+] |\d+\. |> |- \[ \] |```|---)/.test(text);
  checkpoint(true);
  if (structural) {
    const title = `${current.slice(0, start)}${current.slice(end)}`.trim();
    const raw = text.includes('\n') ? text : `${text}${title}\n`;
    state.doc = Doc.replaceBlock(state.doc, index, raw);
  } else {
    state.doc = Doc.replaceBlock(state.doc, index, rawFromPlain(block, next));
  }
  const promoted = state.doc.blocks[index];
  let caretIndex = index;
  let offset = 0;
  if (promoted?.type === 'hr') {
    const blocks = state.doc.blocks.slice();
    blocks.splice(index + 1, 0, { type: 'paragraph', raw: '\n' });
    state.doc = { ...state.doc, blocks, body: blocks.map((item) => item.raw).join('') };
    caretIndex = index + 1;
  } else if (promoted?.type === 'code') offset = 0;
  else if (promoted && promoted.type !== block?.type) offset = Doc.visibleOf(promoted).length;
  else offset = Math.min((start || 0) + String(text || '').length, Doc.visibleOf(promoted || { raw: '' }).length);
  state.caret = { index: caretIndex, offset };
  slash.reset();
  closeMenus();
  paintCenter();
  scheduleSave();
}

function rawFromPlain(block, text) {
  if (block?.type === 'code') {
    const parts = Doc.codeParts(block.raw);
    return Doc.codeRaw(parts.fence, parts.info, text);
  }
  if (block?.type === 'task' && block.task) {
    const task = { ...block.task, title: text.replace(/\n/g, ' ').trim() };
    return `${Doc.serializeTask(task)}\n`;
  }
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
  if (!selection?.rangeCount || !el.contains(selection.anchorNode)) return markdownFromDom(el).length;
  return offsetAt(el, selection.anchorNode, selection.anchorOffset);
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
  checkpoint(true);
  const order = [' ', '/', 'x'];
  const next = order[(order.indexOf(block.task.status) + 1) % order.length];
  state.doc = Doc.withBlockRaw(state.doc, index, Doc.setTaskStatus(block.raw, next));
  paintCenter();
  scheduleSave();
}

async function followLink(target, options = {}) {
  if (!target) return;
  if (/^(https?:\/\/|mailto:)/i.test(target)) {
    try {
      const message = Cmd.externalOpenError(await sophy.openExternal(target));
      if (message) toast(message, 'erro');
    } catch (error) {
      toast(error.message || 'Não foi possível abrir o link.', 'erro');
    }
    return;
  }
  const draft = Cmd.parseWikiDraft(String(target).replace(/^!?\[\[|\]\]$/g, ''));
  const clean = draft.note.replace(/\.md$/i, '').trim();
  const needle = foldText(clean);
  const outgoing = state.outgoing.find(
    (link) =>
      link.status === 'resolved' &&
      (foldText(link.path || '') === `${needle}.md` ||
        foldText(link.path || '') === needle ||
        foldText(link.display || '') === needle ||
        (link.raw || '').includes(target)),
  );
  const shelf = state.active?.includes('/') ? state.active.slice(0, state.active.indexOf('/')) : null;
  const byName = state.notes
    .filter(
      (note) =>
        foldText(note.path.replace(/\.md$/i, '')) === needle ||
        foldText(baseName(note.path)) === foldText(clean.split('/').pop()),
    )
    .sort((a, b) => {
      const aNear = shelf && a.workspace === shelf ? 0 : 1;
      const bNear = shelf && b.workspace === shelf ? 0 : 1;
      return aNear - bNear;
    });
  let path = outgoing?.path || (byName.length === 1 ? byName[0].path : null) || (clean.includes('/') ? `${clean}.md` : null);
  if (!path && options.create !== false && clean) {
    const folder = shelf ? `${shelf}/` : '';
    path = `${folder}${clean.split('/').pop()}.md`;
    try {
      await tool('note.create', { path, body: `# ${baseName(path)}\n\n` });
      await refreshLibrary();
      toast(`Nota “${baseName(path)}” criada.`);
    } catch (error) {
      if (!/já existe/i.test(error.message || '')) {
        toast(error.message, 'erro');
        return;
      }
    }
  }
  if (!path) {
    toast('Não encontrei essa nota.', 'erro');
    return;
  }
  try {
    if (options.newTab && state.active && !state.tabs.includes(path)) {
      state.tabs = [...state.tabs, path];
      paintTabs();
    }
    await openNote(path);
    rememberRecent(path);
  } catch {
    toast('Não encontrei essa nota.', 'erro');
  }
}

function rememberRecent(path) {
  if (!path) return;
  state.recentNotes = [path, ...(state.recentNotes || []).filter((item) => item !== path)].slice(0, 12);
}

let wikiPreviewTimer = 0;
let wikiPreviewEl = null;
let wikiPreviewLink = null;

function closeWikiPreview() {
  clearTimeout(wikiPreviewTimer);
  wikiPreviewTimer = 0;
  wikiPreviewLink = null;
  wikiPreviewEl?.remove();
  wikiPreviewEl = null;
}

function bindWikiPreview(host) {
  if (!host || host.dataset.wikiPreviewBound) return;
  host.dataset.wikiPreviewBound = '1';
  host.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a.wikilink[data-target]');
    if (!link || link.classList.contains('wikilink--quebrado')) return;
    if (wikiPreviewLink === link) return;
    closeWikiPreview();
    wikiPreviewLink = link;
    wikiPreviewTimer = setTimeout(() => showWikiPreview(link), 400);
  });
  host.addEventListener('pointerout', (event) => {
    const link = event.target.closest('a.wikilink[data-target]');
    if (!link || link !== wikiPreviewLink) return;
    if (wikiPreviewEl?.contains(event.relatedTarget)) return;
    closeWikiPreview();
  });
}

async function showWikiPreview(link) {
  if (!link?.isConnected) return;
  const target = link.dataset.target || '';
  const draft = Cmd.parseWikiDraft(target);
  const notePath =
    state.outgoing.find((item) => item.path && item.raw.includes(target))?.path ||
    state.notes.find(
      (note) =>
        foldText(note.path.replace(/\.md$/i, '')) === foldText(draft.note) ||
        foldText(baseName(note.path)) === foldText(draft.note),
    )?.path;
  if (!notePath) return;
  let note;
  try {
    note = await tool('note.read', { path: notePath });
  } catch {
    return;
  }
  if (wikiPreviewLink !== link) return;
  const cover = Cmd.resolveCover(note.frontmatter);
  const lines = String(note.body || '')
    .replace(/^\uFEFF?---[\s\S]*?---\r?\n/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/!?\[\[[^\[\]\n]+\]\]/g, (raw) => raw.replace(/^!?\[\[|\]\]$/g, '').split('|').pop()))
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .slice(0, 4)
    .map((line) => escapeHtml(line))
    .join('<br>');
  const card = document.createElement('section');
  card.className = 'wiki-previa menu-flutuante';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Prévia da nota');
  const coverHtml = cover
    ? cover.kind === 'cor'
      ? `<div class="wiki-previa__capa wiki-previa__capa--cor" style="--capa-tinta:${cover.color === 'estante' ? noteShelfColor() : `var(--shelf-${cover.color})`}"></div>`
      : cover.kind === 'arte'
        ? `<div class="wiki-previa__capa"><svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#capa-${escapeHtml(cover.id)}"/></svg></div>`
        : ''
    : '';
  card.innerHTML = `${coverHtml}<strong class="wiki-previa__titulo">${escapeHtml(baseName(notePath))}</strong><p class="wiki-previa__texto">${lines || 'Nota vazia.'}</p>`;
  document.body.append(card);
  wikiPreviewEl = card;
  const rect = link.getBoundingClientRect();
  const width = 320;
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  const top = rect.bottom + 8;
  card.style.top = `${Math.max(12, Math.min(top, window.innerHeight - card.offsetHeight - 12))}px`;
  card.addEventListener('pointerleave', closeWikiPreview);
}

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape' && wikiPreviewEl) {
      event.preventDefault();
      closeWikiPreview();
    }
  },
  true,
);

function scheduleSave() {
  clearTimeout(saveTimer);
  state.dirty = true;
  state.editSeq = (state.editSeq || 0) + 1;
  const status = $('#st-estado');
  if (status) status.textContent = 'Alterações locais';
  saveTimer = setTimeout(saveNow, 500);
}

async function saveNow() {
  const run = saveJob.then(() => saveNowBody());
  saveJob = run.catch(() => {});
  return run;
}

async function saveNowBody() {
  if (!state.active || !state.doc) return true;
  if (state.conflict) return false;
  if (!state.dirty) return true;
  const editSeq = state.editSeq;
  const path = state.active;
  const revision = state.revision;
  const body = Doc.serializeBlocks(state.doc.blocks);
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    const result = await tool('note.write', {
      path,
      body,
      expectedRevision: revision,
    });
    if (state.active !== path) return false;
    if (result.conflict) {
      state.conflict = true;
      paintCenter();
      paintStatus();
      return false;
    }
    state.revision = result.note.revision;
    state.conflict = false;
    if (state.editSeq === editSeq) state.dirty = false;
    const status = $('#st-estado');
    if (status) status.textContent = 'Salvo';
    state.notes = await tool('note.list', {});
    const signature = (state.doc?.blocks || []).map((block) => block.raw).join('\n');
    const links = signature.match(/\[\[[^\[\]\n]+\]\]/g)?.join('|') || '';
    if (links !== state.linkSig) {
      state.linkSig = links;
      await loadLinks();
    }
    return !state.dirty;
  } catch (error) {
    toast(error.message, 'erro');
    return false;
  }
}

// Every transition checks this result before replacing the editor or session.
async function flushNote() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const canvasActive = !!state.canvasPath && !state.active;
  if (canvasActive) {
    await canvasJob;
    if (!state.canvasDirty && !state.conflict) return true;
    if (!state.conflict) return false;
  } else {
    if (!state.active || !state.doc) return true;
    if (!state.conflict && await saveNow()) return true;
    if (!state.conflict) return false;
  }
  const choice = await askConflict();
  if (choice === 'ficar') return false;
  try {
    if (canvasActive) {
      const disk = await tool('canvas.read', { path: state.canvasPath });
      if (choice === 'manter') {
        const result = await tool('canvas.update', { path: state.canvasPath, document: state.canvasDoc, expectedRevision: disk.revision });
        if (result.conflict) return false;
        state.canvasRevision = result.canvas.revision;
      } else {
        state.canvasDoc = disk.document;
        state.canvasRevision = disk.revision;
      }
      state.canvasDirty = false;
    } else {
      const disk = await tool('note.read', { path: state.active });
      if (choice === 'manter') {
        const editSeq = state.editSeq;
        const result = await tool('note.write', { path: state.active, body: Doc.serializeBlocks(state.doc.blocks), expectedRevision: disk.revision });
        if (result.conflict || editSeq !== state.editSeq) return false;
        state.revision = result.note.revision;
      } else {
        state.doc = Doc.parseBody(disk.body);
        state.revision = disk.revision;
      }
    }
    state.conflict = false;
    state.dirty = false;
    paintCenter();
    paintStatus();
    return true;
  } catch (error) {
    toast(error.message, 'erro');
    return false;
  }
}

async function openCanvas(file) {
  if (!(await flushNote())) return;
  let canvas;
  try {
    canvas = await tool('canvas.read', { path: file });
  } catch (error) {
    state.view = 'canvas-error';
    state.canvasError = error.message;
    state.canvasPath = file;
    paintCenter();
    return;
  }
  state.canvasError = '';
  state.view = 'canvas';
  state.treeFocus = 'canvas';
  state.canvasPath = canvas.path;
  state.nav = '';
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

let canvasJob = Promise.resolve();
async function saveCanvas(document) {
  const canvasPath = state.canvasPath;
  const editSeq = state.canvasEditSeq = (state.canvasEditSeq || 0) + 1;
  state.canvasDoc = structuredClone(document);
  state.canvasDirty = true;
  const run = canvasJob.then(async () => {
    if (!canvasPath || state.canvasPath !== canvasPath) return false;
    try {
      const result = await tool('canvas.update', {
        path: canvasPath,
        document,
        expectedRevision: state.canvasRevision,
      });
      if (result.conflict) {
        state.conflict = true;
        toast('O canvas mudou desde a leitura. Nada foi gravado.', 'erro');
        return false;
      }
      if (!keepCanvasRedo) state.canvasRedo = [];
      state.conflict = false;
      state.canvasRevision = result.canvas.revision;
      if (state.canvasEditSeq === editSeq) {
        state.canvasDoc = result.canvas.document;
        state.canvasDirty = false;
      }
      const status = $('#st-estado');
      if (status) status.textContent = 'Salvo';
      return true;
    } catch (error) {
      toast(error.message, 'erro');
      return false;
    }
  });
  canvasJob = run.catch(() => false);
  return run;
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

let conflictChoice = null;
function askConflict() {
  if (conflictChoice) return conflictChoice;
  sophy.attention?.();
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Conflito"><p>Este arquivo mudou fora do Sophy. Manter grava a versão local por cima do arquivo.</p><button type="button" id="conflito-manter">Manter</button><button type="button" class="btn btn--perigo" id="conflito-descartar">Descartar</button><button type="button" id="conflito-ficar">Cancelar</button></div>`;
  conflictChoice = new Promise((resolve) => {
    const done = (choice) => {
      conflictChoice = null;
      document.removeEventListener('keydown', onKey, true);
      overlay.hidden = true;
      resolve(choice);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      done('ficar');
    };
    document.addEventListener('keydown', onKey, true);
    $('#conflito-manter').onclick = () => done('manter');
    $('#conflito-descartar').onclick = () => done('descartar');
    $('#conflito-ficar').onclick = () => done('ficar');
    $('#conflito-ficar').focus();
  });
  return conflictChoice;
}

async function openNote(file, options = {}) {
  const token = ++state.openSeq;
  const same = state.active === file;
  const unsaved = !!saveTimer || state.dirty;
  if ((state.canvasPath && state.view === 'canvas') || (state.active && state.doc && (!same || unsaved))) {
    if (!(await flushNote())) return;
  }
  if (token !== state.openSeq) return;
  if (same && unsaved && !options.force && !state.conflict) return;
  if (state.dirty && !options.force) return;
  clearTimeout(saveTimer);
  state.conflict = false;
  const note = await tool('note.read', { path: file });
  if (token !== state.openSeq) return;
  if (state.dirty && !options.force) return;
  state.dirty = false;
  state.active = note.path;
  state.canvasPath = null;
  state.treeFocus = 'note';
  state.view = 'note';
  state.doc = Doc.parseBody(note.body);
  clearTimeout(state.undoTimer);
  state.editorPast = [JSON.stringify(state.doc.blocks.map((block) => ({ type: block.type, raw: block.raw, level: block.level })))];
  state.editorFuture = [];
  state.undoOpen = false;
  state.blockRange = null;
  state.revision = note.revision;
  state.frontmatter = note.frontmatter;
  state.conflict = false;
  if (!state.tabs.includes(note.path) || options.force) {
    if (!state.tabs.includes(note.path)) state.tabs.push(note.path);
  }
  await loadLinks();
  if (token !== state.openSeq) return;
  rememberRecent(note.path);
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
  try {
    state.unlinkedMentions = await tool('mention.unlinked', {});
  } catch {
    state.unlinkedMentions = [];
  }
}

function isImageEmbedTarget(target) {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(String(target || '').split('|')[0].trim());
}

function attachmentFolderForActiveNote() {
  if (!state.active || !state.active.includes('/')) return '';
  return state.active.slice(0, state.active.lastIndexOf('/'));
}

function resolveEmbedPath(target) {
  const clean = String(target || '')
    .split('|')[0]
    .trim()
    .replace(/\\/g, '/');
  if (!clean) return '';
  if (clean.includes('/') || clean.startsWith('Anexos/')) return clean;
  const folder = attachmentFolderForActiveNote();
  return folder ? `${folder}/${clean}` : clean;
}

async function fillEmbeds() {
  const column = $('#coluna');
  if (!column) return;
  for (const figure of column.querySelectorAll('[data-embed]')) {
    const target = figure.dataset.embed;
    const body = figure.querySelector('.embed__corpo');
    if (!body) continue;
    if (isImageEmbedTarget(target)) {
      figure.classList.add('embed--imagem');
      try {
        const asset = await tool('attachment.read', { path: resolveEmbedPath(target) });
        body.innerHTML = `<img class="embed__img" src="${asset.dataUrl}" alt="${escapeHtml(target.split('/').pop() || 'imagem')}">`;
      } catch {
        body.textContent = 'Imagem não encontrada.';
      }
      continue;
    }
    figure.classList.remove('embed--imagem');
    const path = target.endsWith('.md') ? target : `${target}.md`;
    try {
      const note = await tool('note.read', { path });
      body.textContent = note.body.slice(0, 400);
    } catch {
      body.textContent = 'Anexo ou nota ainda não encontrada.';
    }
  }
}

function insertEmbedBlocks(paths) {
  if (!state.doc || !paths.length) return;
  const active = document.activeElement?.closest?.('#coluna [data-block][contenteditable="true"]');
  let index = active ? Number(active.dataset.block) : state.doc.blocks.length - 1;
  if (!Number.isFinite(index) || index < 0) index = Math.max(0, state.doc.blocks.length - 1);
  checkpoint(true);
  const embeds = paths.map((file) => ({ type: 'paragraph', raw: `![[${file}]]\n` }));
  const blocks = state.doc.blocks.slice();
  const current = blocks[index];
  const empty = current && (current.type === 'paragraph' || current.type === 'blank') && !Doc.visibleOf(current).trim();
  if (empty) blocks.splice(index, 1, ...embeds, { type: 'paragraph', raw: '\n' });
  else blocks.splice(index + 1, 0, ...embeds, { type: 'paragraph', raw: '\n' });
  state.doc = { ...state.doc, blocks, body: Doc.serializeBlocks(blocks) };
  state.caret = { index: empty ? index + embeds.length : index + 1 + embeds.length, offset: 0 };
  paintCenter();
  scheduleSave();
  fillEmbeds();
}

async function importAttachmentFiles(files) {
  if (!files.length) return [];
  const folder = attachmentFolderForActiveNote();
  const added = await tool('attachment.import', { folder, files });
  await refreshLibrary();
  return added.map((item) => item.path);
}

async function pickAndInsertImages() {
  if (!state.active || !state.doc) {
    toast('Abra uma nota para inserir imagens.', 'erro');
    return;
  }
  const paths = Cmd.chosenFileList(await sophy.chooseFiles());
  if (!paths.length) return;
  const imported = await importAttachmentFiles(paths.map((path) => ({ path })));
  insertEmbedBlocks(imported);
}

async function ingestImageBlobs(fileList) {
  const images = [...fileList].filter((file) => /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || ''));
  if (!images.length) return false;
  if (!state.active || !state.doc) {
    toast('Abra uma nota para inserir imagens.', 'erro');
    return true;
  }
  const files = [];
  for (const file of images) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    files.push({
      name: file.name || `imagem-${Date.now()}.png`,
      dataBase64: btoa(binary),
    });
  }
  const imported = await importAttachmentFiles(files);
  insertEmbedBlocks(imported);
  return true;
}

function paintLinks() {
  const host = $('#conexoes');
  if (!host) return;
  if (state.sofiOpen) {
    paintSofi(host);
    return;
  }
  const head =
    '<div class="conexoes__topo"><h3>Conexões</h3><button type="button" class="btn btn--icone" id="fechar-conexoes" aria-label="Ocultar conexões">×</button></div>';
  if (!state.active) {
    host.innerHTML = `${head}<p class="nota-privacidade">Abra uma nota para ver os links.</p>`;
    $('#fechar-conexoes').onclick = () => closeConnections();
    return;
  }
  const out =
    state.outgoing
      .map((link) => {
        const mark = link.path?.includes('/') ? markFor(link.path.split('/')[0]) : null;
        const tint = mark?.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
        const broken = link.status !== 'resolved';
        return `<button type="button" class="link wikilink ${broken ? 'wikilink--quebrado' : ''}" data-go="${escapeHtml(link.path || '')}" data-create="${escapeHtml(Doc.linkTarget((link.raw || '').replace(/^!?\[\[|\]\]$/g, '')))}"><span class="chip__ponto" aria-hidden="true"${tint}></span>${escapeHtml(link.display || link.path || link.raw || 'link')}</button>`;
      })
      .join('') || '<p class="nota-privacidade">Nenhum link de saída.</p>';
  const back =
    state.backlinks
      .map(
        (link) =>
          `<button type="button" class="link conexao-back" data-go="${escapeHtml(link.from)}"><strong>${escapeHtml(baseName(link.from))}</strong><span class="conexao-back__trecho">${escapeHtml(link.snippet || link.display || link.raw || '')}</span></button>`,
      )
      .join('') || '<p class="nota-privacidade">Nenhuma nota aponta para cá.</p>';
  const title = baseName(state.active);
  const mentions = (state.unlinkedMentions || [])
    .filter((row) => foldText(row.title) === foldText(title) || row.hits?.some((hit) => hit.path === state.active))
    .flatMap((row) =>
      (row.hits || [])
        .filter((hit) => hit.path !== state.active)
        .map(
          (hit) =>
            `<div class="mencao"><div class="mencao__nota">${escapeHtml(baseName(hit.path))}</div><p class="mencao__trecho">Menção a <span class="mencao__termo">${escapeHtml(row.title)}</span></p><button type="button" class="btn btn--secundario btn--pequeno" data-ligar="${escapeHtml(row.title)}">Transformar em link</button></div>`,
        ),
    )
    .join('');
  const mentionBlock = `<h3 class="conexoes__titulo">Menções sem link</h3><div class="mencoes">${mentions || '<p class="nota-privacidade">Nenhuma menção solta.</p>'}</div>`;
  host.innerHTML = `${head}<p class="nota__caminho">${noteCrumb(state.active)}</p><h3>${escapeHtml(baseName(state.active))}</h3><h3>Links de saída</h3>${out}<h3>Backlinks</h3>${back}${mentionBlock}
    <h3 class="conexoes__titulo">Histórico</h3><button type="button" class="btn btn--fantasma" id="desfazer">${icon('desfazer')} Desfazer</button>`;
  $('#fechar-conexoes').onclick = () => closeConnections();
  host.querySelectorAll('[data-go]').forEach((button) => {
    button.onclick = () => {
      if (button.dataset.go) openNote(button.dataset.go);
      else if (button.dataset.create) followLink(button.dataset.create, { create: true });
    };
  });
  host.querySelectorAll('[data-ligar]').forEach((button) => {
    button.onclick = async () => {
      try {
        await tool('mention.link', { title: button.dataset.ligar });
        await refreshLibrary();
        if (state.active) await openNote(state.active, { force: true });
        toast('Menções ligadas.', 'ok', {
          label: 'Desfazer',
          onClick: () => undoLastAction(),
        });
      } catch (error) {
        toast(error.message, 'erro');
      }
    };
  });
  $('#desfazer').onclick = async () => {
    try {
      await undoLastAction('A última ação foi desfeita.');
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
    const text = state.doc.blocks
      .map((block) => Doc.visibleOf(block))
      .join(' ')
      .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
      .replace(/\[\[([^\]]+)\]\]/g, '$1');
    const count = (text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || []).length;
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
    ['novo-canvas', 'canvas', 'Novo canvas'],
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
  menu.querySelector('[data-novo="novo-canvas"]').onclick = () => {
    closeMenus();
    runCommand('novo-canvas');
  };
  menu.querySelector('[data-novo="modelo"]').onclick = () => {
    closeMenus();
    createFromTemplate();
  };
}

function isoToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function showTasks() {
  state.view = 'tasks';
  state.taskMode = state.taskMode || 'lista';
  state.taskFilter = state.taskFilter || {};
  const query = { today: isoToday() };
  for (const key of ['status', 'priority', 'workspace', 'due']) {
    if (state.taskFilter[key]) query[key] = state.taskFilter[key];
  }
  state.taskRows = await tool('task.query', query);
  paintCenter();
}

async function showCalendar() {
  state.view = 'calendar';
  state.calendarMode = state.calendarMode || 'mes';
  state.calendarCursor = state.calendarCursor || isoToday();
  const cursor = state.calendarCursor;
  const mode = state.calendarMode || 'mes';
  const from = mode === 'semana' || mode === 'agenda' ? weekStart(cursor) : `${cursor.slice(0, 7)}-01`;
  const to = mode === 'agenda' ? addIso(from, 20) : mode === 'semana' ? addIso(from, 6) : addIso(from, 41);
  state.calendarItems = await tool('calendar.query', { from, to });
  paintCenter();
}

function addIso(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return isoTodayFrom(date);
}

function isoTodayFrom(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekStartsOn() {
  return Number(state.settings.weekStartsOn ?? 1) === 0 ? 0 : 1;
}

function weekdayLabels() {
  return weekStartsOn() === 0
    ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
    : ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
}

function weekOffset(date) {
  return weekStartsOn() === 0 ? date.getDay() : (date.getDay() + 6) % 7;
}

function weekStart(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - weekOffset(date));
  return isoTodayFrom(date);
}

function readableDate(iso) {
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [, month, day] = String(iso).split('-');
  if (!month || !day) return iso;
  return `${Number(day)} de ${months[Number(month) - 1] || month}`;
}

function calendarLabel(title) {
  const text = String(title || '').replace(/^[●◆]\s*/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return readableDate(text);
  return text;
}

function shortDate(iso) {
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${months[Number(month) - 1]}`;
}

function taskBucket(task) {
  if (!task.due) return 'Sem prazo';
  const today = isoToday();
  if (task.due < today && task.status !== 'feita' && task.status !== 'cancelada') return 'Atrasadas';
  if (task.due === today) return 'Hoje';
  if (task.due <= addIso(today, 6)) return 'Esta semana';
  return 'Próximas';
}

function taskCard(task) {
  const kit =
    task.status === 'andamento'
      ? 'andamento'
      : task.status === 'feita'
        ? 'feita'
        : task.status === 'cancelada'
          ? 'cancelada'
          : 'aberta';
  const priority =
    task.priority === 'alta'
      ? '<span class="chip chip--alta">Alta</span>'
      : task.priority === 'media'
        ? '<span class="chip chip--media">Média</span>'
        : task.priority === 'baixa'
          ? '<span class="chip chip--baixa">Baixa</span>'
          : '';
  return `<article class="kcard" draggable="true" data-task="${escapeHtml(task.path)}" data-line="${task.line}" data-rev="${task.revision}"><span class="check" data-status="${kit}"></span><button type="button" class="kcard__titulo" data-open-task="${escapeHtml(task.path)}">${escapeHtml(task.title)}</button><span class="kcard__meta">${priority}<span class="chip">${escapeHtml(task.due ? shortDate(task.due) : 'sem prazo')}</span><span class="chip">${escapeHtml(task.workspace || 'Biblioteca')}</span></span></article>`;
}

function paintTasks(center) {
  const rows = state.taskRows || [];
  const filter = state.taskFilter || {};
  const taskCounts = {
    aberta: rows.filter((task) => task.status === 'aberta').length,
    andamento: rows.filter((task) => task.status === 'andamento').length,
    feita: rows.filter((task) => task.status === 'feita').length,
  };
  const chips = (items, key) =>
    items
      .map(
        ([value, label]) =>
          `<button type="button" class="chip ${filter[key] === value ? 'is-ativa' : ''}" data-filtro="${key}" data-valor="${value}">${label}</button>`,
      )
      .join('');
  const due = [
    ['', 'Todos os prazos'],
    ['atrasada', 'Atrasadas'],
    ['hoje', 'Hoje'],
    ['semana', 'Esta semana'],
    ['sem', 'Sem prazo'],
  ];
  const statuses = [
    ['aberta', 'Abertas'],
    ['andamento', 'Andamento'],
    ['feita', 'Feitas'],
  ];
  const shelves = (state.workspaces || []).map((shelf) => [shelf.name, shelf.name]);
  const columns = ['aberta', 'andamento', 'feita']
    .map((status) => {
      const label = status === 'aberta' ? 'A fazer' : status === 'andamento' ? 'Em andamento' : 'Concluídas';
      const cards = rows.filter((task) => task.status === status).map(taskCard).join('');
      return `<section class="quadro__coluna" data-status="${status}"><h3>${label} <span>${taskCounts[status]}</span></h3>${cards || '<p>Solte aqui</p>'}</section>`;
    })
    .join('');
  const groups = ['Atrasadas', 'Hoje', 'Esta semana', 'Próximas', 'Sem prazo'];
  const lista = groups
    .map((name) => {
      const items = rows.filter((task) => taskBucket(task) === name);
      if (!items.length) return '';
      return `<section class="tarefas__grupo"><h3>${name}</h3>${items.map(taskCard).join('')}</section>`;
    })
    .join('');
  const hasFilter = Object.values(filter).some(Boolean);
  center.innerHTML = `<div class="tarefas"><header class="tarefas__topo"><div><h2>Tarefas</h2><p>${taskCounts.aberta} a fazer · ${taskCounts.andamento} em andamento · ${taskCounts.feita} concluídas</p></div><div class="tarefas__filtros">${chips(due, 'due')}${chips(statuses, 'status')}${chips(shelves, 'workspace')}${hasFilter ? '<button type="button" class="btn btn--fantasma" id="limpar-filtros">Limpar filtros</button>' : ''}</div><div>${['lista', 'quadro'].map((mode) => `<button type="button" class="btn ${state.taskMode === mode ? 'btn--primario' : 'btn--fantasma'}" data-modo="${mode}">${mode === 'lista' ? 'Lista' : 'Quadro'}</button>`).join('')}</div></header>${state.taskMode === 'quadro' ? `<div class="quadro">${columns}</div>` : `<div class="tarefas__lista">${lista || '<p>Nenhuma tarefa com esse filtro.</p>'}</div>`}</div>`;
  center.querySelectorAll('[data-filtro]').forEach((button) => {
    button.onclick = () => {
      state.taskFilter[button.dataset.filtro] = button.dataset.valor;
      showTasks();
    };
  });
  center.querySelectorAll('[data-modo]').forEach((button) => {
    button.onclick = () => {
      state.taskMode = button.dataset.modo;
      paintCenter();
    };
  });
  center.querySelectorAll('[data-open-task]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.openTask);
  });
  $('#limpar-filtros')?.addEventListener('click', () => {
    state.taskFilter = {};
    showTasks();
  });
  center.querySelectorAll('.kcard .check').forEach((check) => {
    check.onclick = async () => {
      const card = check.closest('.kcard');
      const current = check.dataset.status;
      const status = current === 'aberta' ? 'andamento' : current === 'andamento' ? 'feita' : 'aberta';
      await tool('task.update', {
        path: card.dataset.task,
        line: Number(card.dataset.line),
        expectedRevision: card.dataset.rev,
        status,
      });
      await showTasks();
    };
  });
  bindTaskDrag(center);
}

function paintCalendar(center) {
  const cursor = state.calendarCursor || isoToday();
  const mode = state.calendarMode || 'mes';
  if (!state.dayFocus) state.dayFocus = isoToday();
  const start = mode === 'semana' ? weekStart(cursor) : (() => {
    const [year, month] = cursor.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const offset = weekOffset(first);
    first.setDate(1 - offset);
    return isoTodayFrom(first);
  })();
  const count = mode === 'semana' ? 7 : 42;
  const days = Array.from({ length: count }, (_, index) => addIso(start, index));
  const items = state.calendarItems || [];
  const cells = mode === 'agenda'
    ? ''
    : days
    .map((date) => {
      const mine = items.filter((item) => item.date === date);
      const marks = mine
        .slice(0, mode === 'semana' ? 6 : 3)
        .map((item) => {
          if (item.kind === 'tarefa')
            return `<button type="button" class="cal-item cal-item--texto" draggable="true" data-task="${escapeHtml(item.path)}" data-line="${item.line}" data-rev="${item.revision}" title="${escapeHtml(item.title)}">□ ${escapeHtml(item.title)}</button>`;
          const mark = item.kind === 'nota' ? '●' : '◆';
          return `<button type="button" class="cal-item cal-item--texto" data-open-note="${escapeHtml(item.path)}" title="${escapeHtml(calendarLabel(item.title))}">${mark} ${escapeHtml(calendarLabel(item.title))}</button>`;
        })
        .join('');
      const outside = date.slice(0, 7) !== cursor.slice(0, 7) ? ' is-fora' : '';
      const selected = date === state.dayFocus ? ' is-selecionado' : '';
      return `<div class="cal-dia${date === isoToday() ? ' is-hoje' : ''}${outside}${selected}" data-date="${date}"><strong>${Number(date.slice(8))}</strong>${marks}${mine.length > 3 && mode !== 'semana' ? `<span class="cal-mais">+${mine.length - 3}</span>` : ''}</div>`;
    })
    .join('');
  const [year, month] = cursor.split('-').map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const weekdays = weekdayLabels()
    .map((name) => `<span>${name}</span>`)
    .join('');
  const agenda = (state.calendarItems || [])
    .filter((item) => item.date >= isoToday())
    .map((item) => `<li><button type="button" class="menu__item" data-open-note="${escapeHtml(item.path)}"><b>${escapeHtml(readableDate(item.date))}</b> ${escapeHtml(calendarLabel(item.title))}</button></li>`)
    .join('');
  const previous = mode === 'mes' ? 'Mês anterior' : 'Semana anterior';
  const next = mode === 'mes' ? 'Próximo mês' : 'Próxima semana';
  const dayItems = (state.calendarItems || []).filter((item) => item.date === state.dayFocus);
  const dayPanel = `<aside class="painel-dia"><h3>${escapeHtml(readableDate(state.dayFocus))}</h3><p class="nota-privacidade">● nota · □ tarefa · ◆ data</p>${dayItems.map((item) => `<p>${item.kind === 'tarefa' ? '□' : item.kind === 'nota' ? '●' : '◆'} ${escapeHtml(calendarLabel(item.title))}</p>`).join('') || '<p>Nada neste dia.</p>'}</aside>`;
  const body = mode === 'agenda'
    ? `<div class="calendario__miolo"><ul class="agenda">${agenda || '<li>Nada nesta agenda.</li>'}</ul>${dayPanel}</div>`
    : `<div class="calendario__miolo"><div><div class="cal-semana">${weekdays}</div><div class="cal-grade ${mode === 'semana' ? 'cal-grade--semana' : ''}">${cells}</div></div>${dayPanel}</div>`;
  center.innerHTML = `<div class="calendario"><header class="tarefas__topo calendario__topo"><div class="calendario__navegacao"><button type="button" class="btn btn--icone" data-passo="-1" aria-label="${previous}">‹</button><h2>${escapeHtml(monthName)}</h2><button type="button" class="btn btn--icone" data-passo="1" aria-label="${next}">›</button><button type="button" class="btn btn--fantasma" id="cal-hoje">Hoje</button></div><div><button type="button" class="btn ${mode === 'mes' ? 'btn--primario' : 'btn--fantasma'}" data-cal="mes">Mês</button><button type="button" class="btn ${mode === 'semana' ? 'btn--primario' : 'btn--fantasma'}" data-cal="semana">Semana</button><button type="button" class="btn ${mode === 'agenda' ? 'btn--primario' : 'btn--fantasma'}" data-cal="agenda">Agenda</button></div></header>${body}</div>`;
  $('#cal-hoje').onclick = () => {
    state.calendarCursor = isoToday();
    state.dayFocus = isoToday();
    showCalendar();
  };
  center.querySelectorAll('[data-cal]').forEach((button) => {
    button.onclick = () => {
      state.calendarMode = button.dataset.cal;
      if (button.dataset.cal === 'semana' || button.dataset.cal === 'agenda') state.calendarCursor = isoToday();
      showCalendar();
    };
  });
  center.querySelectorAll('[data-passo]').forEach((button) => {
    button.onclick = () => {
      const step = Number(button.dataset.passo);
      if ((state.calendarMode || 'mes') === 'semana' || state.calendarMode === 'agenda') {
        state.calendarCursor = addIso(state.calendarCursor || isoToday(), step * 7);
      } else {
        const [y, m] = (state.calendarCursor || isoToday()).split('-').map(Number);
        const next = new Date(y, m - 1 + step, 1);
        state.calendarCursor = isoTodayFrom(next);
      }
      showCalendar();
    };
  });
  center.querySelectorAll('.cal-dia').forEach((day) => {
    day.onclick = (event) => {
      if (event.target.closest('[data-task]')) return;
      state.dayFocus = day.dataset.date;
      paintCenter();
    };
  });
  center.querySelectorAll('[data-open-note]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.openNote);
  });
  bindTaskDrag(center);
}

function bindTaskDrag(center) {
  center.querySelectorAll('[data-task]').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData(
        'text/plain',
        JSON.stringify({
          path: card.dataset.task,
          line: Number(card.dataset.line),
          revision: card.dataset.rev,
        }),
      );
    });
  });
  center.querySelectorAll('[data-status], [data-date]').forEach((target) => {
    target.addEventListener('dragover', (event) => event.preventDefault());
    target.addEventListener('drop', async (event) => {
      event.preventDefault();
      const payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}');
      const patch = { path: payload.path, line: payload.line, expectedRevision: payload.revision };
      if (target.dataset.status) patch.status = target.dataset.status;
      if (target.dataset.date) patch.due = target.dataset.date;
      await tool('task.update', patch);
      if (state.view === 'calendar') await showCalendar();
      else await showTasks();
    });
  });
}

function runCommand(id) {
  const leaving = ['inicio', 'hoje', 'tarefas', 'calendario', 'grafo', 'canvas', 'lixeira', 'versoes', 'cartas', 'config', 'visoes', 'mencoes'].includes(id);
  if (leaving && ((state.view === 'note' && state.doc) || state.view === 'canvas')) {
    flushNote().then((saved) => { if (saved) runCommandNow(id); });
    return;
  }
  runCommandNow(id);
}

function runCommandNow(id) {
  if (['inicio', 'hoje', 'tarefas', 'calendario', 'grafo', 'canvas', 'lixeira'].includes(id)) state.nav = id;
  const runs = {
    nota: () => createNote(),
    estante: () => createWorkspace(),
    canvas: () => {
      state.view = 'canvases';
      state.canvasGalleryLoaded = false;
      paintCenter();
    },
    'novo-canvas': () => createCanvasFile(),
    modelo: () => createFromTemplate(),
    captura: () => openCapture(),
    visoes: () => showViews(),
    mencoes: () => showMentions(),
    importar: () => importObsidian(),
    foco: () => setFocusMode(!state.focusMode),
    cartas: () => showCards(),
    config: () => {
      state.view = 'settings';
      state.nav = 'config';
      paintCenter();
    },
    versoes: () => showVersions(),
    lixeira: () => showTrash(),
    buscar: () => openPalette(),
    comandos: () => openCommands(),
    biblioteca: () => {
      const anchor = document.querySelector('#seletor-biblioteca');
      if (anchor) openLibraryMenu(anchor);
    },
    grafo: () => showGraph(),
    hoje: () => openDaily(),
    inicio: () => {
      state.view = 'home';
      state.active = null;
      paintTree();
      paintCenter();
      paintTabs();
    },
    tarefas: () => showTasks(),
    calendario: () => showCalendar(),
    sofi: () => openAgent(),
  };
  return runs[id]?.();
}

async function openDaily() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await openDailyOn(iso);
}

async function openDailyOn(iso) {
  const path = `Diário/${iso}.md`;
  try {
    await tool('workspace.create', { name: 'Diário' });
  } catch {
    /* a estante já existe */
  }
  try {
    await tool('note.create', {
      path,
      body: `# ${readableDate(iso)}\n\n`,
      frontmatter: { data: iso },
    });
  } catch {
    /* a nota do dia já existe */
  }
  await refreshLibrary();
  await openNote(path);
}

function dailyStrip(notePath) {
  const match = String(notePath || '').match(/^Diário\/(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return '';
  const current = match[1];
  const start = weekStart(current);
  const labels = weekdayLabels();
  const days = labels.map((label, index) => {
    const iso = addIso(start, index);
    return `<button type="button" class="semana-diaria__dia${iso === current ? ' is-hoje' : ''}" data-dia="${iso}">${label}<span>${Number(iso.slice(8))}</span></button>`;
  });
  return `<div class="semana-diaria" aria-label="Semana">${days.join('')}</div>`;
}

function paintSofi(host) {
  host.classList.remove('is-oculta');
  const theme = themeName() === 'dark' ? 'escuro' : 'claro';
  host.innerHTML = `<div class="agente agente--lateral" role="dialog" aria-label="Sofi"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""><h3>Sofi</h3><ul class="sofi-lista"><li>Lê só esta biblioteca</li><li>Usa as mesmas tools</li><li>Grava um ponto antes de agir</li></ul><div class="inicio__cartoes"><span class="chip">cofre</span><span class="chip">origem agent</span></div><label>Chave <input id="agente-chave" type="password" autocomplete="off" /></label><div class="inicio__cartoes"><button type="button" class="btn btn--secundario" id="agente-guardar">Guardar no cofre</button><button type="button" class="btn btn--fantasma" id="agente-apagar">Apagar chave</button></div><label>Pedido <textarea id="agente-pedido" rows="3"></textarea></label><button type="button" class="btn btn--primario" id="agente-enviar">Pedir</button><button type="button" class="btn btn--fantasma" id="agente-fechar">Fechar</button><p id="agente-resposta" class="nota-privacidade"></p></div>`;
  $('#agente-guardar').onclick = async () => {
    const response = await sophy.agentKeySet($('#agente-chave').value);
    $('#agente-chave').value = '';
    $('#agente-resposta').textContent = response.ok ? 'Chave guardada no cofre.' : response.error;
  };
  $('#agente-apagar').onclick = async () => {
    const response = await sophy.agentKeyClear();
    $('#agente-resposta').textContent = response.ok ? 'Chave apagada do cofre.' : response.error;
  };
  $('#agente-enviar').onclick = async () => {
    const response = await sophy.agentAsk($('#agente-pedido').value);
    $('#agente-resposta').textContent = response.ok ? response.value.text : response.error;
    if (response.ok) {
      await refreshLibrary();
      paintTree();
    }
  };
  $('#agente-fechar').onclick = () => {
    state.sofiOpen = false;
    $('#sofi-gaveta')?.classList.remove('is-aberta');
    if (!$('#lateral')?.classList.contains('is-aberta')) $('#gaveta-veu')?.remove();
    paintLinks();
  };
}

function openAgent() {
  if (drawerNarrow()) {
    $('#lateral')?.classList.remove('is-aberta');
    let panel = $('#sofi-gaveta');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'sofi-gaveta';
      panel.className = 'sofi-gaveta';
      $('.miolo')?.append(panel);
    }
    state.sofiOpen = true;
    paintSofi(panel);
    panel.classList.add('is-aberta');
    ensureVeil();
    state.drawerOpener = $('#abrir-lateral');
    return;
  }
  $('#sofi-gaveta')?.classList.remove('is-aberta');
  state.sofiOpen = true;
  state.connectionsOpen = true;
  paintSofi($('#conexoes'));
  syncConnectionsPanel();
}

function openCapture() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Captura rápida"><p>Captura rápida</p><input id="captura" placeholder="Título" /><p class="nota-privacidade">Vai para Entrada, com data e hora no nome.</p></div>`;
  const input = $('#captura');
  input.focus();
  input.onkeydown = async (event) => {
    if (event.key !== 'Enter') return;
    const title = input.value.trim() || 'Sem título';
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const slug = title.replace(/[\\/]+/g, ' ').trim();
    const path = `Entrada/${stamp}-${slug}.md`;
    overlay.hidden = true;
    await tool('note.create', { path, body: `# ${title}\n\n` });
    await refreshLibrary();
    await openNote(path);
  };
}

async function createFromTemplate() {
  const models = state.notes.filter((note) => note.workspace === 'Modelos');
  if (!models.length) {
    toast('Guarde um Markdown em Modelos/.');
    return;
  }
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="seletor-capa" role="dialog" aria-label="Modelos"><h2>Modelos</h2><div class="inicio__cartoes">${models
    .map(
      (note) =>
        `<button type="button" class="cartao-estante" data-modelo="${escapeHtml(note.path)}"><strong>${escapeHtml(baseName(note.path))}</strong><span>Modelo</span></button>`,
    )
    .join('')}</div><label>Título <input id="modelo-titulo" value="Sem título" /></label></div>`;
  overlay.querySelectorAll('[data-modelo]').forEach((button) => {
    button.onclick = async () => {
      const titulo = $('#modelo-titulo').value.trim() || 'Sem título';
      const source = await tool('note.read', { path: button.dataset.modelo });
      const now = new Date();
      const data = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const filled = source.body
        .replaceAll('{{data}}', data)
        .replaceAll('{{titulo}}', titulo)
        .replaceAll('{{hora}}', hora)
        .replaceAll('{{cursor}}', '');
      const name = Cmd.uniqueTitle(state.notes.map((note) => baseName(note.path)), titulo);
      const path = `Entrada/${name}.md`;
      overlay.hidden = true;
      await tool('note.create', { path, body: filled });
      await refreshLibrary();
      await openNote(path);
    };
  });
}

async function showViews() {
  state.view = 'views';
  state.nav = '';
  paintCenter();
}

async function paintViews(center) {
  const views = await tool('view.list', {});
  const notes = state.notes.filter((note) => !state.selectedShelf || note.workspace === state.selectedShelf);
  const mode = state.viewMode || 'lista';
  const rows = notes
    .map((note) => `<tr><td>${escapeHtml(baseName(note.path))}</td><td>${escapeHtml(note.workspace || '')}</td></tr>`)
    .join('');
  const cards = notes
    .map((note) => `<article class="cartao-estante"><strong>${escapeHtml(baseName(note.path))}</strong><span>${escapeHtml(note.workspace || '')}</span></article>`)
    .join('');
  const list = notes.map((note) => `<button type="button" data-open="${escapeHtml(note.path)}">${escapeHtml(baseName(note.path))}</button>`).join('');
  const body =
    mode === 'tabela'
      ? `<table class="visao-tabela"><tbody>${rows}</tbody></table>`
      : mode === 'quadro'
        ? `<div class="inicio__cartoes">${cards}</div>`
        : `<div class="visao-lista">${list}</div>`;
  center.innerHTML = `<div class="inicio"><h2>Visões</h2>
    <div class="vabas" role="tablist" aria-label="Visões">
      ${['tabela', 'lista', 'quadro'].map((item) => `<button type="button" class="vaba" role="tab" data-visao-modo="${item}" aria-selected="${mode === item}">${item}</button>`).join('')}
    </div>
    ${body}
    <button type="button" class="btn btn--secundario" id="salvar-visao">Salvar visão</button>
    <ul>${views.map((view) => `<li><button type="button" data-visao="${escapeHtml(view.path)}" data-modo="${escapeHtml(view.modo)}" data-estante="${escapeHtml(view.estante || '')}">${escapeHtml(view.nome)} · ${escapeHtml(view.modo)}</button></li>`).join('')}</ul>
  </div>`;
  center.querySelectorAll('[data-visao-modo]').forEach((button) => {
    button.onclick = () => {
      state.viewMode = button.dataset.visaoModo;
      paintCenter();
    };
  });
  const save = $('#salvar-visao');
  if (save)
    save.onclick = async () => {
      const nome = state.selectedShelf || 'Biblioteca';
      await tool('view.save', {
        path: `${nome}.view`,
        nome,
        modo: state.viewMode || 'lista',
        estante: state.selectedShelf || '',
      });
      toast('Visão salva.');
      paintCenter();
    };
  center.querySelectorAll('[data-visao]').forEach((button) => {
    button.onclick = () => {
      state.viewMode = button.dataset.modo;
      state.selectedShelf = button.dataset.estante || null;
      paintCenter();
    };
  });
  center.querySelectorAll('[data-open]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.open);
  });
}

async function showMentions() {
  const rows = await tool('mention.unlinked', {});
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Menções sem link"><h2>Menções sem link</h2>${
    rows.length
      ? rows
          .map(
            (row) =>
              `<button type="button" class="menu__item" data-ligar="${escapeHtml(row.title)}" data-total="${row.total}">${escapeHtml(row.title)} · ${row.total}</button>`,
          )
          .join('')
      : '<p>Nenhuma menção solta.</p>'
  }</div>`;
  overlay.querySelectorAll('[data-ligar]').forEach((button) => {
    button.onclick = async () => {
      const total = Number(button.dataset.total);
      if (total > 10) {
        const ok = await confirmDialog(`Ligar todas as ${total} menções de ${button.dataset.ligar}? Dá para desfazer.`);
        if (!ok) return;
      }
      await tool('mention.link', { title: button.dataset.ligar });
      overlay.hidden = true;
      await refreshLibrary();
      if (state.active) await openNote(state.active, { force: true });
      toast('Menções ligadas. Desfazer está no painel de conexões.');
    };
  });
}

function confirmDialog(message, options = {}) {
  const overlay = $('#overlay');
  overlay.hidden = false;
  const confirmLabel = options.confirmLabel || 'Confirmar';
  const cancelLabel = options.cancelLabel || 'Cancelar';
  const tone = options.danger ? 'btn--perigo' : 'btn--primario';
  const label = options.label || 'Confirmar';
  overlay.innerHTML = `<div class="menu confirma" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}"><p id="confirma-texto">${escapeHtml(message)}</p><div class="confirma__acoes"><button type="button" class="btn btn--secundario" id="confirma-nao">${escapeHtml(cancelLabel)}</button><button type="button" class="btn ${tone}" id="confirma-sim">${escapeHtml(confirmLabel)}</button></div></div>`;
  const cancel = $('#confirma-nao');
  cancel.focus();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.onclick = null;
      overlay.hidden = true;
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    };
    document.addEventListener('keydown', onKey, true);
    $('#confirma-sim').onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    overlay.onclick = (event) => {
      if (event.target === overlay) finish(false);
    };
  });
}

function trashNavLabel(count) {
  return `Lixeira, ${Trash.countLabel(count)}`;
}

function paintTrashBadge() {
  const count = state.trashItems.length;
  const badge = $('#lixeira-conta');
  const button = document.querySelector('[data-nav="lixeira"]');
  if (badge) badge.textContent = String(count);
  if (button) button.setAttribute('aria-label', trashNavLabel(count));
}

async function refreshTrashIndex() {
  try {
    const items = await tool('trash.list', {});
    state.trashItems = Array.isArray(items) ? items : [];
    state.trashStatus = 'ready';
    state.trashError = '';
  } catch (error) {
    state.trashStatus = 'error';
    state.trashError = error.message || 'Não foi possível ler a lixeira.';
  }
  paintTrashBadge();
}

function visibleTrash() {
  return Trash.filterTrash(state.trashItems, {
    query: state.trashQuery,
    kind: state.trashKind,
  });
}

function syncTrashSelection(items) {
  if (!items.length) {
    state.trashSelected = null;
    return;
  }
  if (!items.some((item) => item.id === state.trashSelected)) state.trashSelected = items[0].id;
}

async function showTrash() {
  state.view = 'trash';
  state.nav = 'lixeira';
  state.active = null;
  state.canvasPath = null;
  state.trashStatus = 'loading';
  paintTree();
  paintTabs();
  paintLinks();
  paintStatus();
  paintCenter();
  const delay = Number(window.__sophyTrashDelay) || 0;
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (state.view !== 'trash') return;
  await refreshTrashIndex();
  if (state.view !== 'trash') return;
  syncTrashSelection(visibleTrash());
  paintCenter();
}

function trashRow(item, selected) {
  const when = Trash.formatDeletedAt(item.deletedAt);
  const size = Trash.formatSize(item.size);
  const kind = Trash.kindLabel(item.kind);
  const title = item.title || item.originalPath || 'Sem título';
  const path = item.originalPath || '';
  const label = `${kind}: ${title}. Caminho ${path}. Excluído ${when.relative}. ${size}.`;
  return `<div class="lixeira__item" role="option" id="lixo-${escapeHtml(item.id)}" data-id="${escapeHtml(item.id)}" aria-selected="${selected ? 'true' : 'false'}" aria-label="${escapeHtml(label)}">
    <span class="lixeira__tipo" title="${escapeHtml(kind)}">${icon(Trash.kindIcon(item.kind))}</span>
    <span class="lixeira__corpo"><strong class="lixeira__titulo">${escapeHtml(title)}</strong><span class="lixeira__caminho" title="${escapeHtml(path)}">${escapeHtml(path)}</span></span>
    <time class="lixeira__quando" datetime="${escapeHtml(item.deletedAt || '')}" title="${escapeHtml(when.full)}">${escapeHtml(when.relative)}</time>
    <span class="lixeira__tamanho">${escapeHtml(size)}</span>
    <span class="lixeira__acoes">
      <button type="button" class="btn btn--secundario btn--pequeno" data-restaurar="${escapeHtml(item.id)}" aria-label="${escapeHtml(`Restaurar ${title}`)}">${icon('restaurar')} Restaurar</button>
      <button type="button" class="btn btn--fantasma btn--pequeno lixeira__apagar" data-apagar="${escapeHtml(item.id)}" aria-label="${escapeHtml(`Excluir ${title} de vez`)}">${icon('apagar')} Excluir de vez</button>
    </span>
  </div>`;
}

function paintTrash(center) {
  const items = state.trashItems;
  const visible = visibleTrash();
  syncTrashSelection(visible);
  const typing = document.activeElement?.id === 'lixeira-busca';
  const caret = typing ? document.activeElement.selectionStart : null;
  const filters = [
    ['', 'Todos'],
    ['note', 'Notas'],
    ['canvas', 'Canvas'],
    ['attachment', 'Anexos'],
    ['folder', 'Pastas'],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="btn btn--fantasma btn--pequeno lixeira__tipo-btn" data-tipo="${id}" aria-pressed="${state.trashKind === id}" aria-label="Filtrar ${label.toLocaleLowerCase('pt-BR')}">${label}</button>`,
    )
    .join('');
  let body = '';
  if (state.trashStatus === 'loading' && !items.length) {
    body = `<div class="lixeira__estado" role="status">${icon('lixeira', 'icon--48')}<p>Carregando a lixeira…</p></div>`;
  } else if (state.trashStatus === 'error') {
    body = `<div class="lixeira__estado" role="alert">${icon('erro', 'icon--48')}<h2>Não foi possível ler a lixeira</h2><p>${escapeHtml(state.trashError || 'Tente de novo.')}</p><button type="button" class="btn btn--secundario" id="lixeira-tentar" aria-label="Tentar de novo">Tentar de novo</button></div>`;
  } else if (!items.length) {
    body = `<div class="lixeira__vazio">${icon('lixeira', 'icon--48')}<h2>A lixeira está vazia</h2><p>Notas, canvas, anexos e pastas excluídos aparecem aqui. Dá para restaurar ou apagar de vez.</p></div>`;
  } else if (!visible.length) {
    body = `<div class="lixeira__vazio"><h2>Nenhum item com esse filtro</h2><p>Tente outro termo ou mostre todos os tipos.</p><button type="button" class="btn btn--fantasma" id="lixeira-limpar">Limpar filtro</button></div>`;
  } else {
    const selected = state.trashSelected;
    body = `<div class="lixeira__lista" id="lixeira-lista" role="listbox" tabindex="0" aria-label="Itens da lixeira" aria-activedescendant="${selected ? `lixo-${escapeHtml(selected)}` : ''}">${visible
      .map((item) => trashRow(item, item.id === selected))
      .join('')}</div>`;
  }
  const summary =
    state.trashStatus === 'loading' && !items.length
      ? 'Carregando…'
      : state.trashStatus === 'error'
        ? 'Não foi possível ler a lixeira.'
        : `${Trash.countLabel(items.length)} na lixeira da biblioteca`;
  const canEmpty = state.trashStatus === 'ready' && items.length > 0;
  center.innerHTML = `<section class="lixeira" aria-labelledby="lixeira-titulo"><header class="lixeira__topo"><div><h2 id="lixeira-titulo">Lixeira</h2><p>${escapeHtml(summary)}</p></div><button type="button" class="btn btn--perigo" id="lixeira-esvaziar" aria-label="Esvaziar lixeira" ${canEmpty ? '' : 'disabled'}>Esvaziar lixeira</button></header><div class="lixeira__ferramentas"><label class="input input--busca">${icon('busca')}<input id="lixeira-busca" type="search" placeholder="Buscar na lixeira" aria-label="Buscar na lixeira" value="${escapeHtml(state.trashQuery)}" /></label><div class="lixeira__filtros" role="group" aria-label="Filtrar por tipo">${filters}</div></div>${body}</section>`;
  const search = $('#lixeira-busca');
  if (search) {
    search.oninput = () => {
      state.trashQuery = search.value;
      paintCenter();
    };
    if (typing) {
      search.focus();
      const pos = caret == null ? search.value.length : caret;
      search.setSelectionRange(pos, pos);
    }
  }
  center.querySelectorAll('[data-tipo]').forEach((button) => {
    button.onclick = () => {
      state.trashKind = button.dataset.tipo || '';
      paintCenter();
    };
  });
  const empty = $('#lixeira-esvaziar');
  if (empty) empty.onclick = () => emptyTrash().catch((error) => toast(error.message, 'erro'));
  const retry = $('#lixeira-tentar');
  if (retry)
    retry.onclick = () => {
      showTrash().catch((error) => toast(error.message, 'erro'));
    };
  const clear = $('#lixeira-limpar');
  if (clear)
    clear.onclick = () => {
      state.trashQuery = '';
      state.trashKind = '';
      paintCenter();
    };
  const list = $('#lixeira-lista');
  if (list) {
    list.onclick = (event) => {
      const restore = event.target.closest('[data-restaurar]');
      const purge = event.target.closest('[data-apagar]');
      const row = event.target.closest('.lixeira__item');
      if (restore) {
        const item = state.trashItems.find((entry) => entry.id === restore.dataset.restaurar);
        if (item) restoreTrashItem(item);
        return;
      }
      if (purge) {
        const item = state.trashItems.find((entry) => entry.id === purge.dataset.apagar);
        if (item) purgeTrashItem(item);
        return;
      }
      if (row && row.dataset.id !== state.trashSelected) {
        state.trashSelected = row.dataset.id;
        paintCenter();
      }
    };
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}

function onTrashKey(event) {
  if (state.view !== 'trash') return false;
  const overlay = $('#overlay');
  if (overlay && !overlay.hidden) return false;
  const list = event.target?.closest?.('#lixeira-lista');
  if (!list) return false;
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const items = visibleTrash();
  if (!items.length) return false;
  let index = items.findIndex((item) => item.id === state.trashSelected);
  if (index < 0) index = 0;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next =
      event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
    state.trashSelected = items[next].id;
    paintCenter();
    $('#lixeira-lista')?.focus();
    return true;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    state.trashSelected = items[event.key === 'Home' ? 0 : items.length - 1].id;
    paintCenter();
    $('#lixeira-lista')?.focus();
    return true;
  }
  if (event.key === 'Enter') {
    if (event.target?.closest?.('button')) return false;
    event.preventDefault();
    restoreTrashItem(items[index]);
    return true;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    purgeTrashItem(items[index]);
    return true;
  }
  return false;
}

async function restoreTrashItem(item) {
  if (!item || state.trashBusy) return;
  state.trashBusy = true;
  try {
    const result = await tool('trash.restore', { id: item.id });
    const finalPath = result?.path || item.originalPath;
    state.trashSelected = null;
    await refreshLibrary();
    if (state.view === 'trash') {
      syncTrashSelection(visibleTrash());
      paintTree();
      paintCenter();
    } else {
      paintTree();
      paintCenter();
    }
    const openable = item.kind === 'note' || item.kind === 'canvas';
    toast(
      `Restaurado em ${finalPath}`,
      'ok',
      openable
        ? {
            label: 'Abrir',
            onClick: async () => {
              state.nav = '';
              if (item.kind === 'canvas') await openCanvas(finalPath);
              else await openNote(finalPath);
            },
          }
        : null,
    );
  } catch (error) {
    toast(error.message, 'erro');
  } finally {
    state.trashBusy = false;
  }
}

async function purgeTrashItem(item) {
  if (!item || state.trashBusy) return;
  const title = item.title || item.originalPath || 'este item';
  const ok = await confirmDialog(
    `Excluir “${title}” de vez? Sai da lixeira e não dá para desfazer.`,
    { danger: true, confirmLabel: 'Excluir de vez', label: 'Excluir de vez' },
  );
  if (!ok) {
    $('#lixeira-lista')?.focus();
    return;
  }
  state.trashBusy = true;
  try {
    await tool('trash.purge', { id: item.id });
    if (state.trashSelected === item.id) state.trashSelected = null;
    await refreshLibrary();
    if (state.view === 'trash') {
      syncTrashSelection(visibleTrash());
      paintCenter();
    }
    toast('Excluído de vez.');
  } catch (error) {
    toast(error.message, 'erro');
  } finally {
    state.trashBusy = false;
  }
}

async function emptyTrash() {
  const count = state.trashItems.length;
  if (!count || state.trashBusy) return;
  const sentence =
    count === 1
      ? 'Esvaziar a lixeira? 1 item será apagado de vez. Não dá para desfazer.'
      : `Esvaziar a lixeira? ${count} itens serão apagados de vez. Não dá para desfazer.`;
  const ok = await confirmDialog(sentence, {
    danger: true,
    confirmLabel: 'Esvaziar lixeira',
    label: 'Esvaziar lixeira',
  });
  if (!ok) {
    $('#lixeira-lista')?.focus();
    return;
  }
  state.trashBusy = true;
  try {
    await tool('trash.empty', {});
    state.trashSelected = null;
    state.trashQuery = '';
    state.trashKind = '';
    await refreshLibrary();
    if (state.view === 'trash') paintCenter();
    else paintTree();
    toast('Lixeira esvaziada.');
  } catch (error) {
    toast(error.message, 'erro');
  } finally {
    state.trashBusy = false;
  }
}

function entryMatches(target, kind, file) {
  if (!file || !target) return false;
  if (kind === 'shelf' || kind === 'folder')
    return file === target || file.startsWith(`${target}/`);
  return file === target;
}

async function forgetOpenEntry(target, kind) {
  const hit = (file) => entryMatches(target, kind, file);
  const closingActive = hit(state.active) || hit(state.canvasPath);
  if (closingActive && !(await flushNote())) return false;
  state.tabs = state.tabs.filter((tab) => !hit(tab));
  if (!closingActive) return true;
  state.active = null;
  state.doc = null;
  state.dirty = false;
  state.revision = null;
  state.frontmatter = null;
  state.outgoing = [];
  state.backlinks = [];
  state.canvasPath = null;
  state.canvasDoc = null;
  state.canvasDirty = false;
  if (state.view === 'note' || state.view === 'canvas' || state.view === 'canvas-error') {
    state.view = 'home';
    state.nav = 'inicio';
  }
  return true;
}

async function trashPath(target, kind) {
  if (kind === 'shelf') {
    const count = state.notes.filter(
      (note) => note.workspace === target || note.path.startsWith(`${target}/`),
    ).length;
    const ok = await confirmDialog(
      `Mover a estante ${target} para a lixeira, com ${count} nota(s)?`,
      { confirmLabel: 'Mover', label: 'Mover estante' },
    );
    if (!ok) return false;
  }
  if (!(await forgetOpenEntry(target, kind))) return false;
  await tool('entry.trash', { path: target });
  state.canvasGalleryLoaded = false;
  await refreshLibrary();
  paintTree();
  paintTabs();
  paintCenter();
  paintLinks();
  paintStatus();
  toast('Movido para a lixeira.', 'ok', {
    label: 'Desfazer',
    onClick: () => undoLastAction('Item restaurado da lixeira.'),
  });
  return true;
}

async function deleteForever(target, kind) {
  const label = kind === 'shelf' ? target : baseName(target);
  const ok = await confirmDialog(
    `Excluir “${label}” permanentemente? O item não vai para a lixeira e não dá para desfazer.`,
    { danger: true, confirmLabel: 'Excluir permanentemente', label: 'Excluir permanentemente' },
  );
  if (!ok) return false;
  if (!(await forgetOpenEntry(target, kind))) return false;
  await tool('note.deletePermanent', { path: target });
  state.canvasGalleryLoaded = false;
  await refreshLibrary();
  paintTree();
  paintTabs();
  paintCenter();
  paintLinks();
  paintStatus();
  toast('Excluído permanentemente.');
  return true;
}

async function showReview() {
  state.view = 'review';
  state.taskRows = await tool('task.query', { today: isoToday() });
  paintCenter();
}

function paintReview(center) {
  const rows = state.taskRows || [];
  const items = rows.map((task) => `<li>${escapeHtml(task.title)}<small>${escapeHtml(task.workspace || '')}</small></li>`).join('') || '<li>Nada para revisar.</li>';
  center.innerHTML = `<div class="inicio"><h2>Revisão da semana</h2><div class="revisao"><article class="revisao-cartao"><div class="revisao-cartao__topo"><strong class="revisao-cartao__titulo">Nesta semana</strong><span class="revisao-cartao__num">${rows.length}</span></div><ul>${items}</ul></article></div></div>`;
}

async function showVersions() {
  state.view = 'versions';
  state.versionRows = await tool('version.list', { path: state.active || '' });
  paintCenter();
}

function relativeWhen(id) {
  const iso = String(id).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/, 'T$1:$2:$3.$4Z');
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return id;
  const day = new Date(time);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const when = day.toDateString() === today.toDateString()
    ? 'Hoje'
    : day.toDateString() === yesterday.toDateString()
      ? 'Ontem'
      : day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  return `${when}, ${day.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

function paintVersions(center) {
  const rows = state.versionRows || [];
  const total = rows.reduce((sum, row) => sum + (row.bytes || 0), 0);
  const cap = 1024 * 1024 * 1024;
  const width = Math.min(100, Math.round((total / cap) * 100));
  const picked = rows.find((row) => row.id === state.versionPick) || rows[0];
  const items = rows
    .map(
      (row) =>
        `<li><button type="button" class="versao${picked && picked.id === row.id ? ' is-escolhida' : ''}" data-versao="${escapeHtml(row.id)}"><b>${escapeHtml(relativeWhen(row.id))}</b><span>${escapeHtml(row.label || 'ponto')}</span><small>${sizeLabel(row.bytes || 0)}</small></button></li>`,
    )
    .join('');
  const current = (state.doc?.blocks || []).map(blockPreview).filter(Boolean).slice(0, 6).join('') || '<p>Abra a nota para ver o agora.</p>';
  center.innerHTML = `<div class="versoes-tela"><div class="versoes-diff"><article><h3>${picked ? escapeHtml(relativeWhen(picked.id)) : 'Versão'}</h3><div class="versoes__previa">${escapeHtml(picked?.preview || 'Sem prévia')}</div></article><article><h3>Agora</h3><div class="versoes__previa">${current}</div></article></div><aside><h2>Linha do tempo</h2><div class="versoes-cota" aria-label="Uso das versões"><span style="width:${width}%"></span></div><p>Guardadas 90 dias ou 1 GB. O clique só mostra a prévia.</p><button type="button" class="btn btn--secundario" id="gravar-ponto">Gravar ponto agora</button><button type="button" class="btn btn--fantasma" id="restaurar-versao" ${picked ? '' : 'disabled'}>Restaurar esta versão</button><ul class="versoes-lista">${items || '<li>Nenhum ponto ainda.</li>'}</ul></aside></div>`;
  const save = $('#gravar-ponto');
  if (save)
    save.onclick = async () => {
      await tool('version.point', { label: 'manual' });
      toast('Ponto gravado.');
      await showVersions();
    };
  center.querySelectorAll('[data-versao]').forEach((button) => {
    button.onclick = () => {
      state.versionPick = button.dataset.versao;
      paintVersions(center);
    };
  });
  const restore = $('#restaurar-versao');
  if (restore && picked)
    restore.onclick = () => {
      const overlay = $('#overlay');
      overlay.hidden = false;
      overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Restaurar versão"><p>Restaurar ${escapeHtml(relativeWhen(picked.id))} substitui as notas e os canvas da biblioteca. Um ponto novo é gravado antes.</p><button type="button" id="confirma-sim">Restaurar</button><button type="button" id="confirma-nao">Cancelar</button></div>`;
      $('#confirma-nao').onclick = () => {
        overlay.hidden = true;
      };
      $('#confirma-sim').onclick = async () => {
        overlay.hidden = true;
        clearTimeout(saveTimer);
        await tool('version.point', { label: 'antes-de-restaurar' });
        await tool('version.restore', { id: picked.id });
        await refreshLibrary();
        if (state.active) await openNote(state.active, { force: true });
        else paintTree();
        state.conflict = false;
        paintStatus();
        toast('Versão restaurada.');
      };
    };
}

async function pickedFolder() {
  const picked = await sophy.chooseFolder();
  if (!picked || picked.ok === false) return '';
  return typeof picked === 'string' ? picked : picked.value || '';
}

function blockPreview(block) {
  if (!block || block.type === 'blank') return '';
  if (block.type === 'heading') {
    const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
    return `<h3>${inlineHtml(text)}</h3>`;
  }
  if (block.type === 'code') {
    const inner = block.raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```\n?$/, '');
    return `<pre><code>${escapeHtml(inner)}</code></pre>`;
  }
  if (block.type === 'quote') {
    const text = block.raw.replace(/^>\s?/gm, '').replace(/\n$/, '');
    return `<blockquote>${inlineHtml(text)}</blockquote>`;
  }
  if (block.type === 'task' && block.task) return `<p>${inlineHtml(block.task.title)}</p>`;
  const text = String(block.raw || '').replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
  return text.trim() ? `<p>${inlineHtml(text)}</p>` : '';
}

function exportPreview(kind) {
  const title = state.active ? baseName(state.active) : 'Biblioteca';
  const body = (state.doc?.blocks || []).map(blockPreview).filter(Boolean).slice(0, 6).join('');
  if (kind === 'pdf')
    return `<div class="pdf-pagina" role="img" aria-label="Prévia do PDF"><h3>${escapeHtml(title)}</h3>${body}<footer>Sophy · 1</footer></div>`;
  return `<div class="site-previa" data-theme="${themeName()}"><h3>${escapeHtml(title)}</h3>${body}</div>`;
}

function openExport(kind) {
  const overlay = $('#overlay');
  overlay.hidden = false;
  const title = state.active ? baseName(state.active) : 'Biblioteca';
  overlay.innerHTML = `<div class="seletor-capa" role="dialog" aria-label="Exportar"><h3>Exportar</h3><label class="opcao-cartao"><input type="radio" name="exp-alvo" value="nota" checked><b>Esta nota</b><small>${escapeHtml(title)}</small></label><label class="opcao-cartao"><input type="radio" name="exp-alvo" value="estante"><b>A estante</b><small>${escapeHtml(state.selectedShelf || 'Biblioteca')}</small></label>${exportPreview(kind)}<button type="button" class="btn btn--primario" id="exportar-seguir">Continuar</button></div>`;
  $('#exportar-seguir').onclick = async () => {
    overlay.hidden = true;
    if (kind === 'pdf') {
      if (!state.active || !state.doc) {
        toast('Abra uma nota para exportar o PDF.', 'erro');
        return;
      }
      const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>html{background:#fff;color:#1c1b22}body{font:18px/1.5 Georgia,serif;margin:48px auto;max-width:680px}h1,h2,h3{font-family:Georgia,serif}</style></head><body><h1>${escapeHtml(title)}</h1>${(state.doc?.blocks || []).map(blockPreview).join('')}</body></html>`;
      const saved = await sophy.exportPdf(html);
      if (saved) toast('PDF em papel claro.');
      return;
    }
    const folder = await pickedFolder();
    if (!folder) return;
    const theme = themeName() === 'dark' ? 'dark' : 'light';
    try {
      const result = await tool('site.export', { destination: folder, theme });
      toast(`Site com ${result.pages} página(s), no tema ${theme}.`);
    } catch (error) {
      toast(error.message, 'erro');
    }
  };
}

function importObsidian() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  let step = 1;
  let folder = '';
  const paint = () => {
    const steps = ['Cofre', 'Prévia', 'Importando', 'Pronto']
      .map((label, index) => {
        const number = index + 1;
        const stateAttr = number < step ? ' data-estado="feito"' : number === step ? ' aria-current="step"' : '';
        return `<li${stateAttr}>${label}</li>`;
      })
      .join('');
    const body = step === 1
      ? `<p>O cofre original não é alterado. O Sophy só copia.</p><button type="button" class="btn btn--primario" id="importar-cofre">Escolher cofre</button>`
      : step === 2
        ? `<p>Pasta escolhida. A prévia conta Markdown e canvas. Nada foi gravado ainda.</p><p class="nota-privacidade">${escapeHtml(folder)}</p><button type="button" class="btn btn--primario" id="importar-seguir">Importar</button>`
        : step === 3
          ? `<p>Importando…</p>`
          : `<p>Pronto. As notas estão na estante Importado.</p>`;
    overlay.innerHTML = `<div class="seletor-capa" role="dialog" aria-label="Importar do Obsidian"><h3>Importar do Obsidian</h3><ol class="passos">${steps}</ol>${body}</div>`;
    const pick = $('#importar-cofre');
    if (pick)
      pick.onclick = async () => {
        try {
          folder = await pickedFolder();
          if (!folder) return;
          step = 2;
          paint();
        } catch (error) {
          toast(error.message, 'erro');
        }
      };
    const go = $('#importar-seguir');
    if (go)
      go.onclick = async () => {
        try {
          step = 3;
          paint();
          const result = await tool('vault.import', { sourcePath: folder, shelf: 'Importado' });
          step = 4;
          paint();
          await refreshLibrary();
          paintTree();
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0;
          toast(
            skipped
              ? `${result.copied} arquivo(s) copiados. ${skipped} ficaram de fora: ${result.skipped.slice(0, 3).join('; ')}`
              : `${result.copied} arquivo(s) copiados. A origem não foi alterada.`,
          );
        } catch (error) {
          step = 1;
          paint();
          toast(error.message, 'erro');
        }
      };
  };
  paint();
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
    <button type="button" class="menu__item menu__item--perigo" role="menuitem" data-acao="remover">${icon('lixeira')} Remover da lista</button>
    <button type="button" class="menu__item" role="menuitem" data-acao="revelar">${icon('mostrar-pasta')} ${/linux/i.test(navigator.userAgent) ? 'Mostrar na pasta' : 'Mostrar no Explorer'}</button>`;
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
    openNewLibrary();
  };
  menu.querySelector('[data-acao="abrir"]').onclick = () => {
    closeMenus();
    chooseLibrary(false);
  };
  menu.querySelector('[data-acao="remover"]').onclick = () => {
    closeMenus();
    forgetLibrary();
  };
  menu.querySelector('[data-acao="revelar"]').onclick = () => {
    closeMenus();
    sophy.libraryReveal(state.libraryPath);
  };
}

function openNewLibrary() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="seletor-capa" role="dialog" aria-label="Nova biblioteca"><h3>Nova biblioteca</h3><label>Nome <input id="biblioteca-nome" value="Biblioteca" /></label><p class="nota-privacidade">O nome identifica a biblioteca na lista. A pasta continua sendo a que você escolher.</p><button type="button" class="btn btn--primario" id="biblioteca-criar">Escolher pasta e criar</button></div>`;
  $('#biblioteca-criar').onclick = async () => {
    const name = $('#biblioteca-nome').value.trim() || 'Biblioteca';
    overlay.hidden = true;
    state.libraryNameInput = name;
    await chooseLibrary(true);
  };
}

async function chooseLibrary(create) {
  const chosen = await sophy.chooseFolder();
  if (!chosen?.ok || !chosen.value) return;
  if (create) {
    const name = (state.libraryNameInput || 'Biblioteca').trim();
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name) || reservedName(name)) {
      toast(reservedName(name) ? 'Esse nome é reservado pelo Windows.' : 'Escolha um nome de pasta simples, sem pontos nem barras.', 'erro');
      return;
    }
    const created = await sophy.createLibrary(`${chosen.value.replace(/[/\\]$/, '')}/${name}`);
    if (!created.ok) {
      toast(created.error, 'erro');
      return;
    }
    await switchLibrary(created.value.root);
    return;
  }
  await switchLibrary(chosen.value);
}

let libraryJob = Promise.resolve();
function switchLibrary(folder) {
  const run = libraryJob.then(() => switchLibraryBody(folder));
  libraryJob = run.catch(() => false);
  return run;
}

async function switchLibraryBody(folder) {
  if (!(await flushNote())) return false;
  ++state.openSeq;
  const response = await sophy.switchLibrary(folder);
  if (!response.ok) {
    toast(response.error, 'erro');
    return;
  }
  await applyLibrary(response.value.root, response.value.libraries);
  return true;
}

async function forgetLibrary() {
  if (!(await flushNote())) return false;
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
  clearTimeout(saveTimer);
  clearTimeout(state.undoTimer);
  saveTimer = 0;
  state.dirty = false;
  state.conflict = false;
  state.canvasDirty = false;
  state.canvasPath = null;
  state.canvasDoc = null;
  state.canvasRedo = [];
  state.outgoing = [];
  state.backlinks = [];
  state.libraryPath = root;
  state.libraryName = root.split(/[/\\]/).pop();
  state.settings.libraryPath = root;
  if (libraries) state.settings.libraries = libraries;
  state.tabs = [];
  state.active = null;
  state.doc = null;
  state.view = 'home';
  state.nav = 'inicio';
  state.selectedShelf = null;
  await refreshLibrary();
  paintTabs();
  paintTree();
  paintCenter();
  paintLinks();
  paintStatus();
}

function openShelfStyle(name) {
  const current = markFor(name);
  const icons = [
    ['capelo', 'Capelo'],
    ['livro', 'Livro'],
    ['lampada', 'Lâmpada'],
    ['maleta', 'Maleta'],
    ['leitura', 'Leitura'],
    ['coracao', 'Coração'],
    ['estante', 'Estante'],
    ['pasta', 'Pasta'],
  ];
  const pop = document.createElement('div');
  pop.className = 'menu menu-flutuante';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Cor e ícone');
  pop.innerHTML = `<p>Cor e ícone de ${escapeHtml(name)}</p>
    <div class="acentos">${[1, 2, 3, 4, 5, 6, 7, 8].map((color) => `<button type="button" class="acento ${current.color === color ? 'is-escolhida' : ''}" data-cor="${color}" aria-label="${shelfColorName(color)}" style="--amostra: var(--shelf-${color})"></button>`).join('')}</div>
    <div class="inicio__cartoes">${icons.map(([iconName, label]) => `<button type="button" class="btn btn--fantasma" data-icone="${iconName}">${icon(iconName)} ${label}</button>`).join('')}</div>`;
  document.body.append(pop);
  pop.style.position = 'fixed';
  pop.style.left = '280px';
  pop.style.top = '120px';
  let color = current.color || 1;
  pop.querySelectorAll('[data-cor]').forEach((button) => {
    button.onclick = async () => {
      color = Number(button.dataset.cor);
      await tool('shelf.style.set', { name, color, icon: current.icon });
      await refreshLibrary();
      paintTree();
      closeMenus();
    };
  });
  pop.querySelectorAll('[data-icone]').forEach((button) => {
    button.onclick = async () => {
      await tool('shelf.style.set', { name, color, icon: button.dataset.icone });
      await refreshLibrary();
      paintTree();
      closeMenus();
    };
  });
}

function openTreeMenu(event, kind, target) {
  event.preventDefault();
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante';
  menu.setAttribute('role', 'menu');
  const items =
    kind === 'shelf'
      ? [
          ['nota', 'Nova nota aqui', ''],
          ['cor', 'Cor e ícone…', ''],
          ['renomear', 'Renomear', ''],
          ['lixo', 'Mover para a lixeira', 'lixeira'],
          ['apagar', 'Excluir permanentemente…', 'apagar'],
        ]
      : [
          ['renomear', 'Renomear', ''],
          ['lixo', 'Mover para a lixeira', 'lixeira'],
          ['apagar', 'Excluir permanentemente…', 'apagar'],
        ];
  menu.innerHTML = items
    .map(([id, label, glyph]) => {
      const danger = id === 'apagar' ? ' menu__item--perigo' : '';
      return `<button type="button" class="menu__item${danger}" role="menuitem" data-arvore="${id}">${glyph ? icon(glyph) : ''}${label}</button>`;
    })
    .join('');
  document.body.append(menu);
  menu.style.position = 'fixed';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.querySelector('[data-arvore="renomear"]').onclick = () => {
    closeMenus();
    if (kind === 'shelf') state.renaming = { kind: 'shelf', name: target };
    else state.renaming = { kind: 'note', path: target };
    paintTree();
  };
  const note = menu.querySelector('[data-arvore="nota"]');
  if (note)
    note.onclick = () => {
      closeMenus();
      state.selectedShelf = target;
      createNote();
    };
  const color = menu.querySelector('[data-arvore="cor"]');
  if (color)
    color.onclick = () => {
      closeMenus();
      openShelfStyle(target);
    };
  menu.querySelector('[data-arvore="lixo"]').onclick = () => {
    closeMenus();
    trashPath(target, kind).catch((error) => toast(error.message, 'erro'));
  };
  menu.querySelector('[data-arvore="apagar"]').onclick = () => {
    closeMenus();
    deleteForever(target, kind).catch((error) => toast(error.message, 'erro'));
  };
}

function openBlockMenu(anchor, index) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu menu--bloco menu-flutuante';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = [
    ['titulo', 'titulo', 'Transformar em título'],
    ['lista', 'lista', 'Transformar em lista'],
    ['tarefa', 'tarefa', 'Transformar em tarefa'],
    ['apagar', 'lixeira', 'Excluir bloco'],
  ]
    .map(
      ([id, glyph, label]) =>
        `<button type="button" class="menu__item" role="menuitem" data-bloco="${id}">${icon(glyph)} ${label}</button>`,
    )
    .join('');
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${rect.right + 4}px`;
  menu.style.top = `${rect.top}px`;
  menu.querySelectorAll('[data-bloco]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.bloco;
      closeMenus();
      checkpoint(true);
      const block = state.doc.blocks[index];
      const text = Doc.visibleOf(block);
      if (action === 'apagar') {
        const blocks = state.doc.blocks.filter((_, position) => position !== index);
        state.doc = { ...state.doc, blocks, body: blocks.map((item) => item.raw).join('') };
      } else if (action === 'titulo') {
        state.doc = Doc.replaceBlock(state.doc, index, `# ${text}\n`);
      } else if (action === 'lista') {
        state.doc = Doc.replaceBlock(state.doc, index, `- ${text}\n`);
      } else if (action === 'tarefa') {
        state.doc = Doc.replaceBlock(state.doc, index, `- [ ] ${text}\n`);
      }
      paintCenter();
      scheduleSave();
    };
  });
}

function openSlashAt(index) {
  const el = document.querySelector(`[data-block="${index}"]`);
  if (!el) return;
  openMenu(el, 'menu menu--blocos menu-flutuante', renderSlash(Cmd.SLASH_ITEMS), (item) => {
    if (item.id === 'imagem') {
      closeMenus();
      pickAndInsertImages().catch((error) => toast(error.message, 'erro'));
      return;
    }
    const insert = item.id === 'hoje' ? today() : item.insert;
    const text = readEditable(el).replace(/\n$/, '');
    const next = text.trim() ? `${insert}${text}` : insert;
    const block = state.doc.blocks[index];
    checkpoint(true);
    state.doc = Doc.replaceBlock(state.doc, index, rawFromPlain(block, next));
    const promoted = state.doc.blocks[index];
    state.caret = {
      index,
      offset: promoted?.type === 'code' ? 0 : Doc.visibleOf(promoted || { raw: '' }).length,
    };
    closeMenus();
    paintCenter();
    scheduleSave();
  });
}

function applyWrap(index, selected, prefix, suffix = '') {
  if (Writing.format(prefix)) return;
  const editable = document.querySelector(`[data-block="${index}"][contenteditable="true"]`);
  if (prefix === '[') { editWritingLink(editable); return; }
  if (['# ', '- ', '- [ ] ', '> '].includes(prefix)) {
    checkpoint(true);
    const text = Doc.visibleOf(state.doc.blocks[index]);
    state.doc = Doc.replaceBlock(state.doc, index, prefix + text + '\n');
    state.caret = { index, offset: text.length };
    paintCenter();
    scheduleSave();
    return;
  }
  const block = document.querySelector(`[data-block="${index}"]`);
  const text = block ? readEditable(block) : '';
  const at = text.indexOf(selected);
  if (!block || !selected || at < 0) return;
  checkpoint(true);
  const next = text.slice(0, at) + prefix + selected + suffix + text.slice(at + selected.length);
  state.wrapping = true;
  state.doc = Doc.withBlockRaw(state.doc, index, rawFromPlain(state.doc.blocks[index], next));
  scheduleSave();
  setTimeout(() => {
    paintCenter();
    saveNow();
    state.wrapping = false;
  }, 0);
}

function editWritingLink(el) {
  const selection = getSelection();
  if (!el || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0).cloneRange();
  const current = (range.startContainer.parentElement || el).closest('a');
  const value = current?.dataset.href || '';
  openMenu(el, 'menu menu-flutuante', `<input class="menu__busca" type="url" id="destino-link" aria-label="Endereço do link" placeholder="https://" value="${escapeHtml(value)}" /><button type="button" class="menu__item" id="salvar-link">Aplicar link</button>`, () => {});
  const input = $('#destino-link');
  const apply = () => {
    const href = input.value.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(href)) { toast('Informe um endereço http, https ou mailto válido.', 'erro'); return; }
    checkpoint(true);
    selection.removeAllRanges(); selection.addRange(range);
    state.richApplying = true;
    if (current && el.contains(current)) {
      current.dataset.href = href; current.dataset.target = href;
    } else {
      const anchor = document.createElement('a');
      anchor.className = 'wikilink'; anchor.href = '#'; anchor.dataset.href = href; anchor.dataset.target = href;
      anchor.append(range.extractContents());
      if (!anchor.textContent) anchor.textContent = href;
      range.insertNode(anchor);
      range.selectNodeContents(anchor); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
    }
    state.richApplying = false;
    const index = Number(el.dataset.block);
    state.doc = Doc.withBlockRaw(state.doc, index, rawFromEditor(el, state.doc.blocks[index]));
    closeMenus(); el.focus(); scheduleSave();
  };
  $('#salvar-link').onclick = apply;
  input.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); apply(); }
    if (event.key === 'Escape') { event.preventDefault(); closeMenus(); el.focus(); }
  };
  input.focus(); input.select();
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

function showGraph(workspace) {
  state.view = 'graph';
  state.nav = 'grafo';
  state.graphShelf = typeof workspace === 'string' && workspace ? workspace : '';
  paintTabs();
  paintCenter();
  paintLinks();
}

function graphColor(workspace) {
  const styles = getComputedStyle(document.documentElement);
  const neutral = styles.getPropertyValue('--ink-3').trim() || '#625F75';
  if (!workspace) return neutral;
  const mark = markFor(workspace);
  if (!mark.color) return neutral;
  return styles.getPropertyValue(`--shelf-${mark.color}`).trim() || neutral;
}

async function openGraphNode(file) {
  state.graphCenter = file;
  if (String(file).toLowerCase().endsWith('.canvas')) {
    await openCanvas(file);
    return;
  }
  await openNote(file);
}

function paintGraph(center) {
  const shelf = state.graphShelf;
  state.graphShelf = '';
  center.innerHTML = '';
  const host = document.createElement('div');
  center.append(host);
  state.graphView = SophyGraph.mount(host, {
    icon,
    escapeHtml,
    baseName,
    query: (input) => tool('graph.query', input),
    openPath: (file) => openGraphNode(file),
    colorFor: (workspace) => graphColor(workspace),
    shelves: () =>
      state.workspaces.map((item) => {
        const mark = markFor(item.name);
        return { name: item.name, color: mark.color || '' };
      }),
    notes: () => state.notes.map((note) => ({ path: note.path, title: baseName(note.path) })),
    focusPath: () => state.graphCenter || state.active || state.canvasPath || '',
    reduceMotion: () => motionReduced(),
    toast: (message) => toast(message, 'erro'),
    positions: () => state.graphPositions || {},
    savePositions: (positions) => {
      state.graphPositions = positions;
    },
    forcedShelf: shelf,
  });
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
    const raw = input.value;
    const commandMode = raw.trimStart().startsWith('>');
    const query = (commandMode ? raw.trimStart().slice(1) : raw).trim();
    let hits = [];
    if (!commandMode && query.length >= 2) {
      try {
        hits = await tool('search.query', { query });
      } catch {
        hits = [];
      }
      const seen = new Set(
        hits.filter((hit) => String(hit.path).toLowerCase().endsWith('.canvas')).map((hit) => hit.path),
      );
      const canvases = state.canvases.filter(
        (file) =>
          !seen.has(file.path) && file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      );
      hits = hits.map((hit) =>
        String(hit.path).toLowerCase().endsWith('.canvas') ? { ...hit, kind: 'canvas' } : hit,
      );
      hits = hits.concat(
        canvases.map((file) => ({
          path: file.path,
          title: baseName(file.path),
          workspace: file.workspace,
          kind: 'canvas',
          segments: [],
        })),
      );
      const unique = [];
      const paths = new Set();
      for (const hit of hits) {
        if (paths.has(hit.path)) continue;
        paths.add(hit.path);
        unique.push(hit);
      }
      hits = unique;
    }
    const list = $('#paleta-lista');
    const commands = (commandMode ? Cmd.COMMANDS : Cmd.COMMANDS.filter((item) => item.quando !== 'editor'))
      .filter((item) => !query || item.rotulo.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      .map((item) => ({ label: item.rotulo, run: () => runCommand(item.id) }));
    const noteHits = hits.filter((hit) => hit.kind !== 'canvas');
    const canvasHits = hits.filter((hit) => hit.kind === 'canvas');
    const row = (hit) => {
      const index = hits.indexOf(hit);
      const excerpt = (hit.segments || [])
        .map((part) => (part.match ? `<mark>${escapeHtml(part.text)}</mark>` : escapeHtml(part.text)))
        .join('');
      const shelf = hit.workspace ? markFor(hit.workspace) : null;
      const dot = shelf?.color
        ? `<span class="arvore__ponto" style="background: var(--shelf-${shelf.color})"></span>`
        : '';
      return `<button type="button" class="menu__item" data-hit="${index}">${icon(hit.kind === 'canvas' ? 'canvas' : 'nota')}<span><span class="menu__titulo">${escapeHtml(hit.title || hit.path)}</span><span class="menu__caminho">${dot}${escapeHtml(hit.path)} ${excerpt}</span></span></button>`;
    };
    list.innerHTML =
      (noteHits.length ? '<div class="menu__grupo">Notas</div>' : '') +
      noteHits.map(row).join('') +
      (canvasHits.length ? '<div class="menu__grupo">Canvas</div>' : '') +
      canvasHits.map(row).join('') +
      (commands.length && !commandMode ? '' : '') +
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
        const hit = hits[Number(button.dataset.hit)];
        if (hit.kind === 'canvas' || String(hit.path).toLowerCase().endsWith('.canvas')) openCanvas(hit.path);
        else openNote(hit.path);
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

async function applyCommand(command) {
  if (command.libraryPath && command.libraryPath !== state.libraryPath) {
    if (!(await switchLibrary(command.libraryPath))) return;
  }
  if (command.type === 'setLayout') {
    if (command.section) {
      if (!(await flushNote())) return;
      await runCommandNow(command.section);
    }
    if (command.sidebar !== undefined) {
      if (drawerNarrow()) { if (command.sidebar) openDrawer(); else closeDrawer(); }
      else $('#lateral')?.classList.toggle('is-fechada', !command.sidebar);
    }
    if (command.connections !== undefined) {
      if (command.connections) openConnections();
      else closeConnections();
    }
    if (command.agent !== undefined) {
      if (command.agent) openAgent();
      else { state.sofiOpen = false; $('#sofi-gaveta')?.classList.remove('is-aberta'); paintLinks(); }
    }
    if (command.focus !== undefined) setFocusMode(command.focus);
    return;
  }
  if (command.type === 'setTheme') {
    state.settings.theme = command.theme;
    applyTheme(command.theme);
    sophy.saveSettings({ theme: command.theme });
    paintStatus();
    return;
  }
  if (command.type === 'openNote') {
    return openNote(command.path);
  }
  if (command.type === 'showGraph') {
    return showGraph(command.workspace || '');
  }
  if (command.type === 'openCanvas') {
    return openCanvas(command.path);
  }
}

document.addEventListener('mousedown', (event) => {
  if (!event.target.closest('.menu-flutuante, .seletor-capa, #seletor-biblioteca, .barra-formato, #trocar-capa')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  if (onTrashKey(event)) return;
  if (event.key === 'Escape') {
    closeMenus();
    const overlay = $('#overlay');
    if (overlay && !overlay.hidden) {
      closePalette();
      return;
    }
    if (drawerNarrow() && ($('#lateral')?.classList.contains('is-aberta') || $('#sofi-gaveta')?.classList.contains('is-aberta') || $('#conexoes')?.classList.contains('is-gaveta'))) {
      closeDrawer();
      return;
    }
    if (state.focusMode) {
      setFocusMode(false);
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    const current = state.active || state.canvasPath;
    if (current) closeTab(current);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    openPalette();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    openPalette();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'Space') {
    event.preventDefault();
    openCapture();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'j') {
    event.preventDefault();
    runCommand('sofi');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === ',') {
    event.preventDefault();
    runCommand('config');
    return;
  }
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
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') && state.view === 'note' && state.doc) {
    const tag = event.target?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
      event.preventDefault();
      if (event.key.toLowerCase() === 'y' || event.shiftKey) redoDoc();
      else undoDoc();
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '\\') {
    event.preventDefault();
    toggleSidebar();
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
  const covers = await fetch('ui/assets/sprite-capas.svg').then((response) => response.text());
  $('#sprite').innerHTML = sprite;
  const host = document.createElement('div');
  host.id = 'sprite-capas';
  host.hidden = true;
  host.innerHTML = covers;
  document.body.prepend(host);
  sophy.onFlush?.(async (requestId) => {
    const saved = await flushNote();
    sophy.flushed?.(saved, requestId);
  });
  const started = await sophy.boot();
  if (!started.ok) {
    document.body.textContent = started.error || 'Não foi possível abrir.';
    return;
  }
  state.settings = started.value.settings || {};
  state.libraryPath = started.value.libraryPath;
  applyTheme(themeName());
  syncMotion();
  if (state.settings.readingFont === 'literata' || state.settings.readingFont === 'inter')
    applyReadingFont(state.settings.readingFont);
  let commandJob = Promise.resolve();
  sophy.onCommand((command) => {
    commandJob = commandJob.then(() => applyCommand(command)).catch((error) => toast(error.message, 'erro'));
  });
  if (!state.settings.onboarded || !state.libraryPath) paintOnboarding();
  else await showShell();
  sophy.ready?.();
}

boot().catch((error) => {
  document.body.textContent = error.message;
});
