const Doc = SophyDoc;
const Cmd = SophyCommands;
const Code = SophyCode;
const Rich = SophyRich;

const CALLOUTS = {
  alerta: { label: 'Alerta', icon: 'alerta' },
  pergunta: { label: 'Pergunta', icon: 'ajuda' },
  tarefa: { label: 'Tarefa', icon: 'tarefa' },
  dica: { label: 'Dica', icon: 'lampada' },
};

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
  graphWorkspace: '',
  graphPaintSeq: 0,
  graphView: null,
  graphKeyHandler: null,
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
  collapsedShelves: new Set(),
  treeOrder: {},
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

function engineMessage(code, message) {
  if (code === 'daily-locked') return 'Notas do dia têm o nome fixo pela data';
  if (code === 'daily-exists') return 'Esse dia já tem nota';
  return message || 'Falha na operação.';
}

async function tool(name, input) {
  const response = await sophy.tool(name, input || {});
  if (!response.ok) {
    const error = new Error(engineMessage(response.code, response.error));
    error.code = response.code;
    throw error;
  }
  return response.value;
}

function dailyPathDate(notePath) {
  const match = String(notePath || '').match(/^Diário\/(\d{4}-\d{2}-\d{2})\.md$/);
  return match ? match[1] : null;
}

function dailyHeading(iso) {
  const weekdays = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [year, month, day] = String(iso).split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  const label = `${weekdays[date.getDay()]}, ${day} de ${months[(month || 1) - 1]} de ${year}`;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dailyConflictDialog() {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Esse dia já tem nota"><p>Esse dia já tem nota</p><button type="button" id="conflito-juntar">Juntar conteúdo</button><button type="button" id="conflito-nota">Restaurar como nota comum</button><button type="button" id="conflito-cancelar">Cancelar</button></div>`;
  return new Promise((resolve) => {
    $('#conflito-juntar').onclick = () => {
      overlay.hidden = true;
      resolve('merge');
    };
    $('#conflito-nota').onclick = () => {
      overlay.hidden = true;
      resolve('asNote');
    };
    $('#conflito-cancelar').onclick = () => {
      overlay.hidden = true;
      resolve(null);
    };
  });
}

/* Devolve um item da lixeira ao lugar de origem. Se o caminho já estiver
   ocupado, o back grava com o sufixo “ (restaurado)” e devolve o novo caminho. */
async function restoreTrashed(id) {
  return tool('trash.restore', { id });
}

function toast(message, kind = 'ok', action = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'erro' ? 'toast--erro' : 'toast--ok'}`;
  el.setAttribute('role', kind === 'erro' ? 'alert' : 'status');
  el.innerHTML = `${kind === 'erro' ? icon('erro', 'toast__icone') : ANIM.salvo ? `<span class="toast__icone anim">${ANIM.salvo}</span>` : icon('salvo', 'toast__icone')}<span class="toast__texto">${escapeHtml(message)}</span>`;
  if (action?.label && typeof action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast__acao';
    button.innerHTML = `${/desfazer/i.test(action.label) ? anim('desfazer') : ''}${escapeHtml(action.label)}`;
    button.onclick = async () => {
      el.remove();
      await action.onClick();
    };
    el.append(button);
  }
  $('#toasts').append(el);
  if (kind !== 'erro') setTimeout(() => leaveToast(el), 5000);
  else {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast__fechar';
    close.setAttribute('aria-label', 'Fechar aviso');
    close.innerHTML = icon('fechar');
    close.onclick = (event) => {
      event.stopPropagation();
      leaveToast(el);
    };
    el.append(close);
    el.addEventListener('click', () => leaveToast(el));
  }
}

function leaveToast(el) {
  if (!el.isConnected) return;
  if (motionReduced()) {
    el.remove();
    return;
  }
  el.classList.add('is-saindo');
  setTimeout(() => el.remove(), 180);
}

async function undoLastAction(message = 'Ação desfeita.') {
  await tool('history.undo', {});
  await refreshLibrary();
  if (state.active) await openNote(state.active, { force: true });
  else paintTree();
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

const NAV_GROUPS = [
  ['', [['inicio', 'inicio', 'Início'], ['hoje', 'nota-diaria', 'Hoje']]],
  ['Organizar', [['tarefas', 'lista-tarefas', 'Tarefas'], ['calendario', 'calendario', 'Calendário']]],
  ['Estudar', [['cartas', 'flashcard', 'Flashcards']]],
  ['Explorar', [['grafo', 'grafo', 'Grafo'], ['canvas', 'canvas', 'Canvas']]],
];

/* Ícones animados (assets/anim). O <style> de cada um vai uma vez para o <head>,
   assim o texto dos botões e toasts continua limpo. */
const ANIM = {};
const ANIM_NAMES = ['abrir-estante', 'agente-trabalhando', 'carregando', 'desfazer', 'favoritar', 'fixar', 'nova-nota', 'salvo', 'sincronizar', 'tarefa-marcar'];

async function loadAnims() {
  const styles = [];
  await Promise.all(
    ANIM_NAMES.map(async (name) => {
      try {
        const text = await fetch(`ui/assets/anim/${name}.svg`).then((response) => response.text());
        const style = text.match(/<style>([\s\S]*?)<\/style>/);
        if (style) styles.push(style[1]);
        ANIM[name] = text
          .replace(/<\?xml[^>]*>\s*/, '')
          .replace(/<style>[\s\S]*?<\/style>/, '')
          .replace(/<title>[\s\S]*?<\/title>/, '')
          .replace(/\srole="img"/, '')
          .replace(/\saria-label(?:ledby)?="[^"]*"/g, '')
          .replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
      } catch {
        /* sem animação: fica o ícone estático */
      }
    }),
  );
  const tag = document.createElement('style');
  tag.id = 'anim-css';
  tag.textContent = styles.join('\n');
  document.head.append(tag);
}

function anim(name, fallback = '') {
  if (ANIM[name]) return `<span class="anim anim--${name}" aria-hidden="true">${ANIM[name]}</span>`;
  return fallback ? icon(fallback) : '';
}

function replayAnim(host) {
  const holder = host?.querySelector?.('.anim') || (host?.classList?.contains('anim') ? host : null);
  if (!holder || motionReduced()) return;
  holder.innerHTML = holder.innerHTML;
}

function ilustracao(name, width = 200) {
  const theme = themeName() === 'dark' ? 'escuro' : 'claro';
  return `<img class="vazio__arte" alt="" width="${width}" src="ui/assets/ilustracoes/${name}-${theme}.svg" />`;
}

function paintShell() {
  $('#onboarding').hidden = true;
  const shell = $('#shell');
  shell.hidden = false;
  const logo = themeName() === 'dark' ? 'escuro' : 'claro';
  shell.innerHTML = `<header class="titulo">
      <div class="titulo__marca"><img class="titulo__logo" alt="Sophy" src="ui/assets/logo/logo-horizontal-${logo}.svg" /></div>
      <div class="titulo__abas" role="tablist" id="abas"></div>
      <div class="titulo__acoes">
        <button type="button" class="btn btn--icone" id="abrir-lateral" title="Lateral" aria-label="Mostrar a lateral">${icon('painel-lateral')}</button>
        <button type="button" class="btn btn--fantasma btn--pequeno titulo__sofi" id="abrir-sofi" title="Pedir à Sofi (Ctrl+J)" aria-label="Pedir à Sofi (Ctrl+J)" aria-pressed="false">${icon('faisca')}<span>Sofi</span></button>
        <button type="button" class="btn btn--icone titulo__sino" id="notificacoes" title="Notificações" aria-label="Notificações" aria-haspopup="dialog" aria-expanded="false">${icon('notificacao')}<span class="sino__contador" id="notificacoes-contador" hidden></span></button>
        <button type="button" class="btn btn--icone" id="busca" title="Buscar (Ctrl+K)" aria-label="Buscar (Ctrl+K)">${icon('busca')}</button>
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
          <button type="button" class="btn btn--secundario" id="novo" aria-haspopup="menu">${anim('nova-nota', 'novo')} Novo</button>
          <button type="button" class="btn btn--icone" id="filtrar" aria-label="Filtrar">${icon('busca')}</button>
        </div>
        <nav class="lateral__nav" aria-label="Seções">
          ${NAV_GROUPS.map(
            ([group, items]) =>
              `${group ? `<p class="nav__grupo" aria-hidden="true">${group}</p>` : ''}${items
                .map(([id, glyph, label]) => `<button type="button" class="nav__item" data-nav="${id}">${icon(glyph)} ${label}</button>`)
                .join('')}`,
          ).join('')}
        </nav>
        <div class="lateral__busca" hidden><input id="filtro-arvore" type="search" placeholder="Filtrar a árvore" aria-label="Filtrar a árvore" /></div>
        <div id="arvore"></div>
        <section class="tags-painel" id="tags-painel" aria-label="Tags" hidden></section>
        <div class="lateral__rodape"><button type="button" class="nav__item" data-nav="lixeira" title="Lixeira">${icon('lixeira')} Lixeira</button><button type="button" class="nav__item" data-nav="config" title="Configurações (Ctrl+,)">${icon('configuracoes')} Configurações</button></div>
      </aside>
      <main class="centro" id="centro"></main>
      <aside class="conexoes painel is-oculta" id="conexoes"></aside>
    </div>
    <footer class="status">
      <span id="st-caminho"></span>
      <span id="st-palavras"></span>
      <span class="status__estado"><span id="st-anim" class="anim" aria-hidden="true"></span><span id="st-estado">Pronta</span></span>
      <span class="status__fim" id="st-tema"></span>
    </footer>`;
  $('#busca').onclick = () => openPalette();
  $('#notificacoes').onclick = () => toggleNotifications();
  $('#abrir-sofi').onclick = () => {
    if (state.sofiOpen) closeSofi();
    else openAgent();
  };
  $('#ver-grafo').onclick = () => showGraph();
  $('#abrir-conexoes').onclick = () => toggleConnections();
  $('#tema').onclick = () => toggleTheme();
  bindWindow(shell);
  $('#novo').onclick = (event) => openNewMenu(event.currentTarget);
  $('#novo').onmouseenter = (event) => replayAnim(event.currentTarget);
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
  syncNav();
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
  const previousPath = state.libraryPath;
  state.libraryPath = opened.root;
  state.libraryName = opened.root.split(/[/\\]/).pop();
  if (previousPath !== state.libraryPath) loadTreeUi();
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
  refreshTags();
}

function treeUiStorageKey() {
  return `sophy.treeUi:${state.libraryPath || 'none'}`;
}

function loadTreeUi() {
  try {
    const raw = localStorage.getItem(treeUiStorageKey());
    if (!raw) {
      state.collapsedShelves = new Set();
      state.treeOrder = {};
      return;
    }
    const data = JSON.parse(raw);
    state.collapsedShelves = new Set(Array.isArray(data.collapsed) ? data.collapsed : []);
    state.treeOrder = data.order && typeof data.order === 'object' ? data.order : {};
  } catch {
    state.collapsedShelves = new Set();
    state.treeOrder = {};
  }
}

function saveTreeUi() {
  try {
    localStorage.setItem(
      treeUiStorageKey(),
      JSON.stringify({ collapsed: [...state.collapsedShelves], order: state.treeOrder }),
    );
  } catch {
    /* ignore quota */
  }
}

function workspaceOfPath(filePath) {
  if (!filePath || !filePath.includes('/')) return null;
  return filePath.split('/')[0];
}

function treeOrderKey(workspace) {
  return workspace || '';
}

function remapTreeOrderPath(from, to) {
  for (const key of Object.keys(state.treeOrder)) {
    state.treeOrder[key] = (state.treeOrder[key] || []).map((path) => (path === from ? to : path));
  }
}

function removeFromTreeOrder(path) {
  for (const key of Object.keys(state.treeOrder)) {
    state.treeOrder[key] = (state.treeOrder[key] || []).filter((item) => item !== path);
  }
}

function toggleShelfCollapsed(name) {
  if (state.collapsedShelves.has(name)) state.collapsedShelves.delete(name);
  else state.collapsedShelves.add(name);
  saveTreeUi();
  paintTree();
}

function markFor(name) {
  const base = Cmd.shelfMark(name);
  const saved = state.shelfStyles?.[name];
  if (!saved || name === 'Entrada') return base;
  return { icon: saved.icon || base.icon, color: saved.color || base.color };
}

function treeNotes(workspace) {
  const notes = state.notes.filter((note) => note.workspace === workspace);
  const order = state.treeOrder[treeOrderKey(workspace)] || [];
  const rank = new Map(order.map((path, index) => [path, index]));
  return notes.slice().sort((a, b) => {
    const ai = rank.has(a.path) ? rank.get(a.path) : Number.MAX_SAFE_INTEGER;
    const bi = rank.has(b.path) ? rank.get(b.path) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });
  });
}

function clearTreeDropUi(host) {
  host.querySelectorAll('.is-destino, .is-arrastando').forEach((el) => {
    el.classList.remove('is-destino', 'is-arrastando');
  });
  host.querySelectorAll('.arvore__insercao').forEach((el) => el.remove());
}

function parseTreeDrag(event) {
  const raw = event.dataTransfer.getData('application/x-sophy-tree');
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data?.path) return data;
    } catch {
      /* ignore */
    }
  }
  const path = event.dataTransfer.getData('text/plain');
  if (!path) return null;
  return { kind: path.toLowerCase().endsWith('.canvas') ? 'canvas' : 'note', path };
}

function uniqueNotePath(folder, base, exclude = null) {
  const prefix = folder ? `${folder}/` : '';
  const taken = state.notes
    .filter((note) => note.path !== exclude)
    .filter((note) => (folder ? note.workspace === folder : !note.workspace))
    .map((note) => baseName(note.path));
  const name = taken.includes(base) ? Cmd.uniqueTitle(taken, base) : base;
  return `${prefix}${name}.md`;
}

async function moveNoteToWorkspace(from, destShelf) {
  if (dailyPathDate(from)) {
    toast('Notas do dia têm o nome fixo pela data', 'erro');
    return null;
  }
  if (!(await flushNote())) return null;
  const to = uniqueNotePath(destShelf, baseName(from), from);
  if (to === from) return from;
  const oldKey = treeOrderKey(workspaceOfPath(from));
  const newKey = treeOrderKey(destShelf);
  await tool('entry.move', { from, to });
  if (state.active === from) state.active = to;
  state.tabs = state.tabs.map((tab) => (tab === from ? to : tab));
  remapTreeOrderPath(from, to);
  if (state.treeOrder[oldKey]) {
    state.treeOrder[oldKey] = state.treeOrder[oldKey].filter((path) => path !== from && path !== to);
  }
  const list = (state.treeOrder[newKey] || []).filter((path) => path !== to);
  list.push(to);
  state.treeOrder[newKey] = list;
  saveTreeUi();
  return to;
}

function reorderNoteInShelf(from, targetPath, place) {
  const shelf = workspaceOfPath(targetPath);
  const fromShelf = workspaceOfPath(from);
  if ((shelf || null) !== (fromShelf || null)) return false;
  const key = treeOrderKey(shelf);
  const list = treeNotes(shelf)
    .map((note) => note.path)
    .filter((path) => path !== from);
  const index = list.indexOf(targetPath);
  if (index < 0) list.push(from);
  else list.splice(place === 'after' ? index + 1 : index, 0, from);
  state.treeOrder[key] = list;
  saveTreeUi();
  return true;
}

async function handleTreeNoteDrop(from, target) {
  if (!from || (target.type === 'note' && from === target.path)) return;
  const fromShelf = workspaceOfPath(from);

  if (target.type === 'shelf') {
    const destShelf = target.shelf;
    if ((fromShelf || null) === (destShelf || null)) {
      const key = treeOrderKey(destShelf);
      const list = treeNotes(destShelf)
        .map((note) => note.path)
        .filter((path) => path !== from);
      list.push(from);
      state.treeOrder[key] = list;
      saveTreeUi();
      paintTree();
      return;
    }
    try {
      const moved = await moveNoteToWorkspace(from, destShelf);
      if (!moved) return;
      await refreshLibrary();
      paintTabs();
      paintTree();
      if (state.active === moved) await openNote(moved, { force: true });
      toast('Nota movida.');
    } catch (error) {
      toast(error.message, 'erro');
    }
    return;
  }

  if (target.type === 'note') {
    const destShelf = workspaceOfPath(target.path);
    if ((fromShelf || null) === (destShelf || null)) {
      if (reorderNoteInShelf(from, target.path, target.place || 'before')) paintTree();
      return;
    }
    try {
      const moved = await moveNoteToWorkspace(from, destShelf);
      if (!moved) return;
      await refreshLibrary();
      reorderNoteInShelf(moved, target.path, target.place || 'before');
      paintTabs();
      paintTree();
      if (state.active === moved) await openNote(moved, { force: true });
      toast('Nota movida.');
    } catch (error) {
      toast(error.message, 'erro');
    }
  }
}

function bindTreeDnD(host) {
  const showInsert = (button, before) => {
    clearTreeDropUi(host);
    button.classList.add('is-destino');
    const line = document.createElement('div');
    line.className = 'arvore__insercao';
    const li = button.closest('li');
    if (!li) return;
    if (before) li.before(line);
    else li.after(line);
    button.dataset.dropPlace = before ? 'before' : 'after';
  };

  host.querySelectorAll('[data-open]').forEach((button) => {
    button.draggable = true;
    button.ondragstart = (event) => {
      const path = button.dataset.open;
      event.dataTransfer.setData('text/plain', path);
      event.dataTransfer.setData('application/x-sophy-tree', JSON.stringify({ kind: 'note', path }));
      event.dataTransfer.effectAllowed = 'move';
      button.classList.add('is-arrastando');
    };
    button.ondragend = () => clearTreeDropUi(host);
    button.ondragover = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = button.getBoundingClientRect();
      showInsert(button, event.clientY < rect.top + rect.height / 2);
    };
    button.ondrop = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const drag = parseTreeDrag(event);
      clearTreeDropUi(host);
      if (!drag || drag.kind !== 'note') return;
      await handleTreeNoteDrop(drag.path, {
        type: 'note',
        path: button.dataset.open,
        place: button.dataset.dropPlace || 'before',
      });
    };
  });

  host.querySelectorAll('[data-shelf]').forEach((button) => {
    button.ondragover = (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTreeDropUi(host);
      button.classList.add('is-destino');
    };
    button.ondragleave = () => button.classList.remove('is-destino');
    button.ondrop = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const drag = parseTreeDrag(event);
      clearTreeDropUi(host);
      if (!drag || drag.kind !== 'note') return;
      await handleTreeNoteDrop(drag.path, { type: 'shelf', shelf: button.dataset.shelf });
    };
  });

  const tree = host.querySelector('ul.arvore');
  if (tree) {
    tree.ondragover = (event) => {
      if (event.target !== tree) return;
      event.preventDefault();
      tree.classList.add('is-destino');
    };
    tree.ondragleave = (event) => {
      if (event.target === tree) tree.classList.remove('is-destino');
    };
    tree.ondrop = async (event) => {
      if (event.target !== tree) return;
      event.preventDefault();
      tree.classList.remove('is-destino');
      const drag = parseTreeDrag(event);
      clearTreeDropUi(host);
      if (!drag || drag.kind !== 'note') return;
      await handleTreeNoteDrop(drag.path, { type: 'shelf', shelf: null });
    };
  }
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
      const expanded = !!filter || !state.collapsedShelves.has(workspace.name);
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
      const group = expanded ? `<ul role="group">${children}${boards}</ul>` : '';
      return `<li role="treeitem"><button type="button" class="arvore__linha${workspace.unsafe ? ' is-invalido' : ''}" data-shelf="${escapeHtml(workspace.name)}" aria-selected="${Cmd.treeMarked('shelf', workspace.name, state)}" aria-expanded="${expanded}"${color}${shelfUnsafe}>
          ${icon('chevron-direita', 'arvore__seta')}${icon(mark.icon, 'icon--estante')}${shelfLabel}
          <span class="arvore__conta">${notes.length + state.canvases.filter((file) => file.workspace === workspace.name).length}</span></button>${group}</li>`;
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
      if (event.target.closest('.arvore__seta')) {
        event.preventDefault();
        event.stopPropagation();
        toggleShelfCollapsed(button.dataset.shelf);
        return;
      }
      state.treeFocus = 'shelf';
      state.selectedShelf = button.dataset.shelf;
      state.view = 'shelf';
      state.active = null;
      if (state.collapsedShelves.has(button.dataset.shelf)) {
        state.collapsedShelves.delete(button.dataset.shelf);
        saveTreeUi();
      }
      paintTree();
      paintCenter();
    };
    button.oncontextmenu = (event) => openTreeMenu(event, 'shelf', button.dataset.shelf);
  });
  bindTreeDnD(host);
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
          if (to !== from) {
            moved = await tool('entry.move', { from, to });
            remapTreeOrderPath(from, to);
            saveTreeUi();
          }
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
          if (state.collapsedShelves.has(from)) {
            state.collapsedShelves.delete(from);
            state.collapsedShelves.add(name);
          }
          if (state.treeOrder[from]) {
            state.treeOrder[name] = (state.treeOrder[from] || []).map((path) =>
              path === from || path.startsWith(`${from}/`) ? `${name}${path.slice(from.length)}` : path,
            );
            delete state.treeOrder[from];
          }
          saveTreeUi();
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

const PROPERTY_ICONS = { text: 'texto', number: 'hash', select: 'lista', multi: 'tag', date: 'calendario', checkbox: 'check', url: 'link' };

function propertyTypeIcon(type) {
  return `<span class="propriedade__tipo" title="Tipo: ${escapeHtml(PROPERTY_TYPES[type] || 'Texto')}" aria-hidden="true">${icon(PROPERTY_ICONS[type] || 'texto')}</span>`;
}

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
  if (dailyPathDate(state.active)) return;
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
  // Com a Sofi aberta no mesmo painel, o botão Conexões troca para os links em vez de fechar.
  if (state.sofiOpen) {
    $('#abrir-sofi')?.setAttribute('aria-pressed', 'false');
    openConnections();
    return;
  }
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
  if (!cover)
    return `<div class="capa-adicionar"><button type="button" class="btn btn--fantasma btn--pequeno" id="trocar-capa">${icon('imagem')} Adicionar capa</button></div>`;
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
  const daily = dailyPathDate(state.active);
  const locked = daily
    ? `<div class="propriedade propriedade--travada"><span class="propriedade__nome">${propertyTypeIcon('date')}<span>data</span></span><input class="propriedade__valor" value="${escapeHtml(daily)}" readonly aria-readonly="true" tabindex="-1" aria-label="data">${icon('cadeado', 'icon--14')}</div>`
    : '';
  const rows = locked + noteTagsRowHtml() + properties.map((property) => `<div class="propriedade" data-property="${escapeHtml(property.id)}"><button type="button" class="propriedade__nome" data-property-edit="${escapeHtml(property.id)}" title="${escapeHtml(PROPERTY_TYPES[property.type] || 'Texto')}: renomear">${propertyTypeIcon(property.type)}<span>${escapeHtml(property.name || 'Propriedade')}</span></button><div class="propriedade__valor">${propertyValueHtml(property)}</div><button type="button" class="btn btn--icone propriedade__remover" data-property-remove="${escapeHtml(property.id)}" aria-label="Remover ${escapeHtml(property.name || 'propriedade')}">×</button></div>`).join('');
  const noteId = typeof state.frontmatter?.id === 'string' ? state.frontmatter.id : '';
  const advanced = noteId
    ? `<details class="nota-avancado"><summary>Avançado</summary><div class="propriedade propriedade--id"><span class="propriedade__nome"><span class="propriedade__tipo" aria-hidden="true">${icon('chave')}</span><span>id</span></span><input class="propriedade__valor" value="${escapeHtml(noteId)}" readonly aria-readonly="true" tabindex="-1" aria-label="id da nota">${icon('cadeado', 'icon--14')}<small class="propriedade__dica">Somente leitura. É o que mantém os links da nota ao renomear.</small></div></details>`
    : '';
  return `<details class="nota-propriedades" ${properties.length || noteTagList().length ? 'open' : ''}><summary>Propriedades${properties.length ? ` <span>${properties.length}</span>` : ''}</summary><div class="nota-propriedades__lista">${rows || '<p class="nota-privacidade">Adicione status, prazo, tags ou outros detalhes desta nota.</p>'}<button type="button" class="propriedade-adicionar" id="adicionar-propriedade">${icon('mais')}<span>Adicionar propriedade</span></button>${advanced}</div></details>`;
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
  menu.innerHTML = `<h4>Fonte</h4><div class="nota-menu__fontes">${[['default', 'Padrão'], ['serif', 'Serifada'], ['sans', 'Sem serifa'], ['mono', 'Mono']].map(([value, label]) => `<button type="button" class="opcao-cartao ${layout.font === value ? 'is-escolhida' : ''}" data-note-font="${value}"><b>Ag</b><span>${label}</span></button>`).join('')}</div><h4>Aparência</h4><button type="button" class="menu__item" data-note-toggle="small" aria-pressed="${layout.small}"><span>Texto pequeno</span><span>${layout.small ? 'Ativo' : ''}</span></button><button type="button" class="menu__item" data-note-toggle="wide" aria-pressed="${layout.wide}"><span>Largura total</span><span>${layout.wide ? 'Ativa' : ''}</span></button><hr><button type="button" class="menu__item" id="menu-properties">Propriedades</button><button type="button" class="menu__item" id="menu-cover">${Cmd.resolveCover(state.frontmatter) ? 'Alterar capa' : 'Adicionar capa'}</button><button type="button" class="menu__item" data-focus-toggle>${state.focusMode ? 'Sair do foco' : 'Modo foco'}</button><button type="button" class="menu__item" id="menu-filha">Nova página filha</button><hr><h4>Exportar</h4><button type="button" class="menu__item" id="menu-exportar-pdf"><span>${icon('exportar')} Exportar como PDF</span></button><button type="button" class="menu__item" id="menu-exportar-md"><span>${icon('exportar')} Exportar como Markdown</span></button>`;
  document.body.append(menu);
  anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 8)}px`;
  const exportMd = menu.querySelector('#menu-exportar-md');
  if (exportMd)
    exportMd.onclick = () => {
      closeMenus();
      exportNoteMarkdown().catch((error) => toast(error.message, 'erro'));
    };
  const exportPdf = menu.querySelector('#menu-exportar-pdf');
  if (exportPdf)
    exportPdf.onclick = () => {
      closeMenus();
      exportNotePdf().catch((error) => toast(error.message, 'erro'));
    };
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
  menu.querySelector('#menu-filha').onclick = () => {
    menu.remove();
    anchor.removeAttribute('aria-expanded');
    createChildPage();
  };
}

function paintHome(center) {
  const cards = (state.workspaces || [])
    .map((workspace) => {
      const mark = markFor(workspace.name);
      const notes = state.notes.filter((note) => note.workspace === workspace.name).length;
      const boards = state.canvases.filter((file) => file.workspace === workspace.name).length;
      const color = mark.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
      return `<button type="button" class="cartao-estante" data-home="${escapeHtml(workspace.name)}"${color}>${icon(mark.icon, 'icon--estante')}<span class="cartao-estante__abrir">${anim('abrir-estante')}</span><strong>${escapeHtml(workspace.name)}</strong><span>${notes} notas · ${boards} canvas</span></button>`;
    })
    .join('');
  center.innerHTML = `<div class="inicio"><h2>Início</h2><p>As estantes desta biblioteca. Escolha uma ou crie uma nota.</p><div class="inicio__cartoes">${cards || '<p>Nenhuma estante ainda. Crie a primeira pelo botão Novo, na lateral.</p>'}</div><div class="vazio-ensina__atalhos"><span><kbd class="kbd">Ctrl N</kbd> nota</span><span><kbd class="kbd">Ctrl ,</kbd> configurações</span><span><kbd class="kbd">Ctrl K</kbd> buscar</span></div></div>`;
  center.querySelectorAll('[data-home]').forEach((button) => {
    button.onmouseenter = () => replayAnim(button);
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

const CONFIG_SECTIONS = [
  ['geral', 'configuracoes', 'Geral'],
  ['aparencia', 'aparencia', 'Aparência'],
  ['editor', 'editar', 'Editor'],
  ['anexos', 'anexo', 'Anexos'],
  ['notificacoes', 'notificacao', 'Notificações'],
  ['bibliotecas', 'biblioteca', 'Bibliotecas'],
  ['sofi', 'faisca', 'Sofi e IA'],
  ['atalhos', 'teclado', 'Atalhos'],
  ['sobre', 'info', 'Sobre'],
];

function cfgRow(title, help, control, extra = '') {
  return `<div class="config__linha${extra}"><div class="config__rotulo"><b>${title}</b>${help ? `<p>${help}</p>` : ''}</div><div class="config__controle">${control}</div></div>`;
}

function cfgSoon(title, help, control) {
  return cfgRow(`${title} <span class="em-breve">em breve</span>`, help, control, ' is-em-breve');
}

function cfgSwitch(id, checked, label, disabled = false) {
  return `<label class="alternar"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${label}</span></label>`;
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
  const radios = (name, label, options, current) =>
    `<div class="segmentado" role="radiogroup" aria-label="${label}">${options.map(([value, text]) => `<label class="segmentado__opcao"><input type="radio" name="${name}" value="${value}" ${String(current) === String(value) ? 'checked' : ''}><span>${text}</span></label>`).join('')}</div>`;
  const libraries = [...new Set([state.libraryPath, ...(state.settings.libraries || [])])].filter(Boolean);
  const libraryRows = libraries
    .map((folder) => {
      const current = folder === state.libraryPath;
      return `<li class="config__biblioteca${current ? ' is-atual' : ''}">${icon('biblioteca')}<div><b>${escapeHtml(folder.split(/[/\\]/).pop())}</b><span>${escapeHtml(folder)}</span></div>${current ? '<span class="chip chip--acento">Aberta agora</span>' : '<button type="button" class="btn btn--fantasma btn--pequeno" disabled title="Em breve">Abrir <span class="em-breve">em breve</span></button>'}</li>`;
    })
    .join('');
  const shortcuts = Cmd.COMMANDS.filter((item) => item.atalho)
    .map((item) => `<tr><td>${escapeHtml(item.rotulo)}</td><td>${item.atalho.split('+').map((key) => `<kbd class="kbd">${escapeHtml(key)}</kbd>`).join('<span class="kbd-mais">+</span>')}</td></tr>`)
    .join('');
  const codeLines = localStorage.getItem('sophy-code-lines') === '1';
  const folded = Object.keys(state.settings.collapsedSections || {}).length;
  const active = state.configSection || 'geral';
  center.innerHTML = `<div class="config config--tela">
    <nav class="config__nav" aria-label="Seções das configurações">
      ${CONFIG_SECTIONS.map(([id, glyph, label]) => `<button type="button" class="nav__item config__nav-item" data-cfg-secao="${id}" ${active === id ? 'aria-current="true"' : ''}>${icon(glyph)} ${label}</button>`).join('')}
    </nav>
    <div class="config__corpo">
      <header class="config__topo"><h2>Configurações</h2><p>Tudo fica salvo na hora. Nada aqui altera suas notas.</p></header>
      <section class="config__secao" id="cfg-geral" data-secao="geral"><h3>Geral</h3>
        ${cfgRow('Início da semana', `O calendário e a revisão usam esta data. A semana começa ${weekStartsOn() === 0 ? 'no domingo' : 'na segunda'}.`, radios('cfg-semana', 'Início da semana', [[1, 'Segunda'], [0, 'Domingo']], state.settings.weekStartsOn ?? 1))}
        ${cfgRow('Revisão da semana', 'Aos domingos, um aviso no topo convida a revisar a semana. A Sofi não altera as notas sozinha.', '<button type="button" class="btn btn--secundario" id="abrir-revisao">Abrir revisão</button>')}
        ${cfgSoon('Idioma', 'Por enquanto o Sophy fala português do Brasil.', '<select disabled aria-label="Idioma"><option>Português (Brasil)</option></select>')}
        ${cfgSoon('Ao abrir o Sophy', 'Escolher se abre no Início ou na última nota.', '<select disabled aria-label="Ao abrir"><option>Início</option></select>')}
      </section>
      <section class="config__secao" id="cfg-aparencia" data-secao="aparencia"><h3>Aparência</h3>
        ${cfgRow('Tema', 'Sistema acompanha o claro ou escuro do computador.', radios('cfg-tema', 'Tema', [['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Sistema']], state.settings.theme || 'system'))}
        ${cfgRow('Cor de destaque', 'Aparece em botões, links e seleção.', `<div class="acentos">${accents.map((id) => `<button type="button" class="acento ${accent === id ? 'is-escolhida' : ''}" data-accent="${id}" aria-label="${labels[id]}" title="${labels[id]}" style="--amostra: var(--accent-${id})"></button>`).join('')}</div>`)}
        ${cfgRow('Seguir a cor do sistema', 'Desligada por padrão. Ligada, o acento escolhido sai e a janela fica no índigo até o sistema informar uma cor.', cfgSwitch('cfg-sistema', state.settings.accentSystem, state.settings.accentSystem ? 'Ligado' : 'Desligado'))}
        ${cfgRow('Reduzir animações', 'Desliga transições e ícones animados. O Sophy também respeita a preferência do sistema.', cfgSwitch('cfg-motion', state.settings.reduceMotion, state.settings.reduceMotion ? 'Ligado' : 'Desligado'))}
      </section>
      <section class="config__secao" id="cfg-editor" data-secao="editor"><h3>Editor</h3>
        ${cfgRow('Fonte do texto', 'Vale para todas as notas. Cada nota ainda pode trocar a sua no menu ••• dela.', radios('cfg-fonte', 'Fonte', [['inter', 'Inter'], ['literata', 'Literata']], state.settings.readingFont || 'inter'))}
        ${cfgRow('Números de linha no código', 'Mostra a numeração nos blocos de código.', cfgSwitch('cfg-linhas', codeLines, codeLines ? 'Ligado' : 'Desligado'))}
        ${cfgRow('Seções recolhidas', folded ? `${folded} ${folded === 1 ? 'seção está recolhida' : 'seções estão recolhidas'} nas suas notas.` : 'Nenhuma seção recolhida agora.', `<button type="button" class="btn btn--secundario" id="cfg-abrir-secoes" ${folded ? '' : 'disabled'}>Abrir todas</button>`)}
        ${cfgSoon('Verificar ortografia', 'Sublinhar palavras com erro enquanto você escreve.', cfgSwitch('cfg-ortografia', false, 'Desligado', true))}
      </section>
      <section class="config__secao" id="cfg-anexos" data-secao="anexos"><h3>Anexos</h3>
        <p class="config__ajuda">Arquivos da pasta Anexos/ da biblioteca: imagens e documentos que você arrastou ou anexou nas notas. Arrastar para a nota funciona em qualquer arquivo, até 25 MB.</p>
        <div id="cfg-anexos-conteudo" class="anexos" aria-live="polite"><p class="config__ajuda">Carregando…</p></div>
      </section>
      <section class="config__secao" id="cfg-notificacoes" data-secao="notificacoes"><h3>Notificações</h3>
        <p class="config__ajuda">O sino na barra de título junta os avisos. Escolha quais tipos entram nele e no contador.</p>
        ${NOTIF_TYPES.map(([type, label, , help]) => cfgRow(label, help, cfgSwitch(`cfg-notif-${type}`, notifEnabled(type), notifEnabled(type) ? 'Ligado' : 'Desligado'))).join('')}
      </section>
      <section class="config__secao" id="cfg-bibliotecas" data-secao="bibliotecas"><h3>Bibliotecas</h3>
        <p class="config__ajuda">Uma biblioteca é uma pasta com suas notas em Markdown. Você pode ter várias.</p>
        <ul class="config__bibliotecas">${libraryRows}</ul>
        <div class="config__acoes"><button type="button" class="btn btn--secundario" id="cfg-revelar">${icon('mostrar-pasta')} ${/linux/i.test(navigator.userAgent) ? 'Mostrar na pasta' : 'Mostrar no Explorer'}</button><button type="button" class="btn btn--secundario" id="cfg-importar">${icon('importar')} Importar do Obsidian</button></div>
        <h4>Busca por significado</h4>
        ${cfgRow('Busca local', 'Nenhum modelo é baixado e nenhum texto sai da biblioteca. O índice local só nasce quando você liga.', cfgSwitch('cfg-busca', state.settings.semantic, state.settings.semantic ? 'Pronta, só nesta máquina' : 'Desligada'))}
        <h4>Versões e exportação</h4>
        ${cfgRow('Pontos de restauração', 'Um ponto é gravado antes de cada ação do agente e do MCP. Ficam 90 dias ou 1 GB, apagando os mais antigos.', '<button type="button" class="btn btn--secundario" id="cfg-versao">Gravar ponto agora</button>')}
        ${cfgRow('Exportar a biblioteca', 'Gera um site estático ou um PDF com as notas escolhidas.', '<button type="button" class="btn btn--secundario" id="cfg-site">Exportar site</button><button type="button" class="btn btn--secundario" id="cfg-pdf">Exportar PDF</button>')}
      </section>
      <section class="config__secao" id="cfg-sofi" data-secao="sofi"><h3>Sofi e IA</h3>
        <div class="config__sofi">${ilustracao('agente-desconectado', 120)}<div><b id="cfg-agente-estado">Verificando a Sofi…</b><p>A Sofi lê só esta biblioteca, usa as mesmas ferramentas que você e grava um ponto antes de agir.</p></div></div>
        ${cfgRow('Chave de acesso', 'Fica no cofre do sistema, nunca dentro da biblioteca.', '<input id="cfg-agente-chave" type="password" autocomplete="off" placeholder="Cole a chave aqui" aria-label="Chave de acesso"><button type="button" class="btn btn--secundario" id="cfg-agente-guardar">Guardar no cofre</button><button type="button" class="btn btn--fantasma" id="cfg-agente-apagar">Apagar chave</button>', ' config__linha--larga')}
        <p class="config__retorno" id="cfg-agente-retorno" role="status"></p>
        ${cfgSoon('Provedor e modelo', 'Escolher qual serviço de IA a Sofi usa.', '<select disabled aria-label="Provedor"><option>Padrão</option></select>')}
        ${cfgSoon('Ferramentas externas (MCP)', 'Conectar a Sofi a agenda, e-mail e outros apps.', '<button type="button" class="btn btn--secundario" disabled>Conectar</button>')}
        ${cfgSoon('Permissões da Sofi', 'Definir o que ela pode criar, editar ou apagar.', '<button type="button" class="btn btn--secundario" disabled>Ajustar</button>')}
      </section>
      <section class="config__secao" id="cfg-atalhos" data-secao="atalhos"><h3>Atalhos</h3>
        <p class="config__ajuda">Todos também ficam em botões na tela. O atalho é só um caminho mais curto.</p>
        <table class="config__atalhos"><tbody>${shortcuts}<tr><td>Comandos de bloco</td><td><kbd class="kbd">/</kbd> numa linha vazia</td></tr></tbody></table>
      </section>
      <section class="config__secao" id="cfg-sobre" data-secao="sobre"><h3>Sobre</h3>
        <div class="config__sobre"><img alt="Sophy" src="ui/assets/logo/logo-horizontal-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" height="28"><p>Versão 0.1.0. Suas notas são arquivos Markdown na sua pasta, e continuam seus se o Sophy sair do caminho.</p></div>
      </section>
    </div>
  </div>`;
  const body = center.querySelector('.config__corpo');
  const navButtons = [...center.querySelectorAll('[data-cfg-secao]')];
  const mark = (id) => {
    state.configSection = id;
    navButtons.forEach((button) => {
      if (button.dataset.cfgSecao === id) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  };
  navButtons.forEach((button) => {
    button.onclick = () => {
      mark(button.dataset.cfgSecao);
      center.querySelector(`#cfg-${button.dataset.cfgSecao}`)?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
    };
  });
  if (body)
    body.onscroll = () => {
      const top = body.getBoundingClientRect().top + 72;
      const sections = [...body.querySelectorAll('.config__secao')];
      const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
      const current = atEnd ? sections.at(-1) : sections.filter((section) => section.getBoundingClientRect().top <= top).at(-1) || sections[0];
      if (current && current.dataset.secao !== state.configSection) mark(current.dataset.secao);
    };
  if (state.configSection && state.configSection !== 'geral') center.querySelector(`#cfg-${state.configSection}`)?.scrollIntoView({ block: 'start' });
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
      motion.nextElementSibling.textContent = motion.checked ? 'Ligado' : 'Desligado';
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
      system.nextElementSibling.textContent = system.checked ? 'Ligado' : 'Desligado';
      applyTheme(themeName());
      await sophy.saveSettings({ accentSystem: system.checked });
    };
  const lines = $('#cfg-linhas');
  if (lines)
    lines.onchange = () => {
      localStorage.setItem('sophy-code-lines', lines.checked ? '1' : '0');
      lines.nextElementSibling.textContent = lines.checked ? 'Ligado' : 'Desligado';
    };
  paintAttachmentsSettings();
  NOTIF_TYPES.forEach(([type]) => {
    const input = $(`#cfg-notif-${type}`);
    if (!input) return;
    input.onchange = () => {
      setNotifEnabled(type, input.checked);
      input.nextElementSibling.textContent = input.checked ? 'Ligado' : 'Desligado';
    };
  });
  const unfold = $('#cfg-abrir-secoes');
  if (unfold)
    unfold.onclick = async () => {
      state.settings.collapsedSections = {};
      await sophy.saveSettings({ collapsedSections: {} });
      toast('Todas as seções estão abertas de novo.');
      paintCenter();
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
  const reveal = $('#cfg-revelar');
  if (reveal) reveal.onclick = () => sophy.libraryReveal?.(state.libraryPath);
  const importer = $('#cfg-importar');
  if (importer) importer.onclick = () => importObsidian();
  const feedback = (text) => {
    const out = $('#cfg-agente-retorno');
    if (out) out.textContent = text;
  };
  const save = $('#cfg-agente-guardar');
  if (save)
    save.onclick = async () => {
      const input = $('#cfg-agente-chave');
      if (!input.value.trim()) {
        feedback('Cole a chave no campo antes de guardar.');
        input.focus();
        return;
      }
      const response = await sophy.agentKeySet(input.value);
      input.value = '';
      feedback(response.ok ? 'Pronto, a chave está no cofre.' : `Não deu para guardar: ${response.error}`);
      syncAgentStatus();
    };
  const clear = $('#cfg-agente-apagar');
  if (clear)
    clear.onclick = async () => {
      if (!(await confirmDialog('Apagar a chave da Sofi do cofre? Você pode colar outra depois.', { confirm: 'Apagar chave', danger: true }))) return;
      const response = await sophy.agentKeyClear();
      feedback(response.ok ? 'Chave apagada do cofre.' : `Não deu para apagar: ${response.error}`);
      syncAgentStatus();
    };
  syncAgentStatus();
}

async function syncAgentStatus() {
  const label = $('#cfg-agente-estado');
  if (!label) return;
  try {
    const status = await sophy.agentStatus?.();
    const value = status?.value ?? status;
    const ready = Boolean(value?.saved ?? value?.hasKey ?? value?.configured ?? value?.ready ?? value?.ok);
    state.sofiKey = ready;
    label.textContent = ready ? 'A Sofi está pronta para ajudar' : 'A Sofi ainda não tem uma chave';
    label.closest('.config__sofi')?.classList.toggle('is-pronta', ready);
  } catch {
    label.textContent = 'Não deu para saber o estado da Sofi agora';
  }
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
    const total = (state.cardRows || []).length;
    center.innerHTML = `<div class="vazio-ensina">${ilustracao('flashcards-vazio')}<h2>${total ? 'Tudo revisado por hoje' : 'Flashcards'}</h2><p>${total ? `Você tem ${total} ${total === 1 ? 'cartão' : 'cartões'}. O próximo volta na data marcada, sem pressa.` : 'Ainda não há cartões. Escreva uma linha assim em qualquer nota:'}</p><p><span class="kbd">pergunta :: resposta</span> vira um cartão. <span class="kbd">frente ::: verso</span> vira dois, um em cada sentido.</p><p>Cada estante vira um baralho.</p>${state.cardUndo ? `<p>${undoCardButton()}</p>` : ''}</div>`;
    center.onkeydown = null;
    bindCardUndo(center);
    return;
  }
  const side = state.cardFace === 'back' ? 'verso' : 'frente';
  const labels = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
  const grades = [1, 2, 3, 4]
    .map((grade) => `<button type="button" class="btn ${grade === 3 ? 'btn--primario' : 'btn--secundario'} fc-nota fc-nota--${grade}" data-nota="${grade}" aria-keyshortcuts="${grade}"><span class="fc-nota__nome">${labels[grade]}</span><span class="fc-nota__intervalo">${escapeHtml(card.intervals?.[grade] || '')}</span><kbd class="kbd">${grade}</kbd></button>`)
    .join('');
  center.innerHTML = `<div class="inicio fc-tela"><h2>Flashcards</h2><p class="fc-contagem">${escapeHtml(card.workspace || 'Biblioteca')} · ${due.length} para hoje${card.reversible ? ' · dois lados' : ''}</p><div class="fc-revisao" data-lado="${side}"><div class="fc-cartao"><div class="fc-face"><span class="fc-face__origem">${escapeHtml(card.workspace || '')}</span><p class="fc-face__p">${escapeHtml(card.front)}</p></div><div class="fc-face fc-face--verso"><span class="fc-face__origem">${escapeHtml(card.workspace || '')}</span><p class="fc-face__r">${escapeHtml(card.back)}</p></div></div></div><p class="fc-acoes"><button type="button" class="btn btn--secundario" id="carta-virar" aria-keyshortcuts="Space">${side === 'verso' ? 'Ver pergunta' : 'Mostrar resposta'} <kbd class="kbd">Espaço</kbd></button>${undoCardButton()}</p><div class="fc-notas" role="group" aria-label="Como foi lembrar?">${grades}</div><p class="fc-dica">Depois da resposta, o intervalo mostra quando o cartão volta.</p></div>`;
  $('#carta-virar').onclick = () => {
    state.cardFace = state.cardFace === 'back' ? 'front' : 'back';
    const back = state.cardFace === 'back';
    const stage = center.querySelector('.fc-revisao');
    if (stage) stage.dataset.lado = back ? 'verso' : 'frente';
    $('#carta-virar').innerHTML = `${back ? 'Ver pergunta' : 'Mostrar resposta'} <kbd class="kbd">Espaço</kbd>`;
  };
  center.querySelectorAll('[data-nota]').forEach((button) => {
    button.onclick = () => answerCard(card, Number(button.dataset.nota));
  });
  bindCardUndo(center);
  center.onkeydown = (event) => {
    if (state.view !== 'cards' || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (event.key === ' ') {
      event.preventDefault();
      $('#carta-virar')?.click();
    } else if (['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      center.querySelector(`[data-nota="${event.key}"]`)?.click();
    } else if (event.key.toLowerCase() === 'z' || event.key === 'Backspace') {
      event.preventDefault();
      undoCardReview();
    }
  };
  $('#carta-virar').focus();
}

function undoCardButton() {
  if (!state.cardUndo) return '';
  return `<button type="button" class="btn btn--fantasma" id="carta-desfazer" aria-keyshortcuts="Z" title="Voltar o último cartão respondido">${icon('desfazer')} Desfazer <kbd class="kbd">Z</kbd></button>`;
}

function bindCardUndo(center) {
  const button = center.querySelector('#carta-desfazer');
  if (button) button.onclick = () => undoCardReview();
  if (!button) return;
  if (!center.onkeydown) center.onkeydown = (event) => {
    if (state.view === 'cards' && (event.key.toLowerCase() === 'z' || event.key === 'Backspace') && !event.ctrlKey && !event.metaKey) undoCardReview();
  };
}

async function answerCard(card, grade) {
  try {
    await tool('card.review', { id: card.id, grade, today: isoToday() });
  } catch (error) {
    toast(error.message, 'erro');
    return;
  }
  state.cardUndo = { id: card.id, grade };
  state.cardFace = 'front';
  state.cardRows = await tool('card.list', { today: isoToday() });
  paintCenter();
}

async function undoCardReview() {
  const last = state.cardUndo;
  if (!last) return;
  try {
    await tool('card.undo', { id: last.id });
  } catch (error) {
    state.cardUndo = null;
    toast(error.message, 'erro');
    state.cardRows = await tool('card.list', { today: isoToday() });
    paintCenter();
    return;
  }
  state.cardUndo = null;
  state.cardFace = 'front';
  state.cardRows = await tool('card.list', { today: isoToday() });
  const index = state.cardRows.findIndex((row) => row.id === last.id);
  if (index > 0) state.cardRows.unshift(...state.cardRows.splice(index, 1));
  paintCenter();
  toast('Resposta desfeita. O cartão voltou.');
}

/* ------------------------------------------------------------------ Lixeira */
const TRASH_ICON = { note: 'nota', canvas: 'canvas', attachment: 'anexo', folder: 'pasta' };
const TRASH_KIND = { note: 'Nota', canvas: 'Canvas', attachment: 'Anexo', folder: 'Pasta' };

function trashWhen(iso) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return new Date(time).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function trashFolder(originalPath) {
  const parts = String(originalPath || '').split('/');
  parts.pop();
  return parts.length ? parts.join(' / ') : 'Raiz da biblioteca';
}

async function showTrash() {
  state.view = 'trash';
  state.nav = 'lixeira';
  state.trashRows = null;
  paintCenter();
  await loadTrash();
}

async function loadTrash() {
  try {
    state.trashRows = await tool('trash.list', {});
  } catch (error) {
    state.trashRows = [];
    toast(error.message, 'erro');
  }
  if (state.view === 'trash') paintCenter();
}

async function afterTrashChange() {
  state.notifTrashAt = 0;
  await refreshLibrary();
  paintTree();
  paintTabs();
  state.canvasGalleryLoaded = false;
  await loadTrash();
}

async function restoreFromTrashView(item) {
  try {
    const result = await restoreTrashed(item.id);
    await afterTrashChange();
    const renamed = result?.path && result.path !== item.originalPath;
    toast(
      renamed
        ? `“${item.title}” voltou como “${baseName(result.path)}”, porque o nome original já estava em uso.`
        : `“${item.title}” voltou para ${trashFolder(item.originalPath) === 'Raiz da biblioteca' ? 'a raiz da biblioteca' : trashFolder(item.originalPath)}.`,
      'ok',
      item.kind === 'note' && result?.path ? { label: 'Abrir', onClick: () => openNote(result.path) } : null,
    );
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function purgeFromTrashView(item) {
  const ok = await confirmDialog(`Excluir “${item.title}” de vez? Não dá para desfazer.`, { confirm: 'Excluir de vez', danger: true });
  if (!ok) return;
  try {
    await tool('trash.purge', { id: item.id });
    await afterTrashChange();
    toast(`“${item.title}” foi excluído de vez.`);
  } catch (error) {
    toast(error.message, 'erro');
  }
}

async function emptyTrashFromView() {
  const count = (state.trashRows || []).length;
  if (!count) return;
  const ok = await confirmDialog(
    `Esvaziar a lixeira? ${count === 1 ? 'O 1 item' : `Os ${count} itens`} serão excluídos de vez. Não dá para desfazer.`,
    { confirm: 'Esvaziar lixeira', danger: true },
  );
  if (!ok) return;
  try {
    await tool('trash.empty', {});
    await afterTrashChange();
    toast('Lixeira esvaziada.');
  } catch (error) {
    toast(error.message, 'erro');
  }
}

/* Aviso depois de mandar algo para a lixeira, com Desfazer que devolve só esse item. */
function toastTrashed(message, id) {
  state.notifTrashAt = 0;
  toast(message, 'ok', id
    ? {
        label: 'Desfazer',
        onClick: async () => {
          try {
            await restoreTrashed(id);
            await refreshLibrary();
            state.canvasGalleryLoaded = false;
            paintTree();
            paintTabs();
            paintCenter();
            toast('Restaurado.');
          } catch (error) {
            toast(error.message, 'erro');
          }
        },
      }
    : null);
}

function paintTrash(center) {
  const rows = state.trashRows;
  if (!rows) {
    center.innerHTML = `<div class="lixeira"><header class="lixeira__topo"><h2>Lixeira</h2></header><p class="lixeira__nota" role="status">Carregando…</p></div>`;
    return;
  }
  const total = rows.reduce((sum, item) => sum + (item.size || 0), 0);
  if (!rows.length) {
    center.innerHTML = `<div class="vazio-ensina lixeira-vazia">${ilustracao('lixeira-vazia')}<h2>A lixeira está vazia</h2><p>O que você apagar aparece aqui, e dá para devolver ao lugar de origem. Nada some sem você confirmar.</p></div>`;
    return;
  }
  center.innerHTML = `<div class="lixeira"><header class="lixeira__topo"><div><h2>Lixeira</h2><p class="lixeira__nota">${rows.length} ${rows.length === 1 ? 'item' : 'itens'} · ${sizeLabel(total)}. Ficam aqui até você restaurar ou excluir de vez.</p></div><button type="button" class="btn btn--secundario btn--perigo" id="lixeira-esvaziar">${icon('lixeira')} Esvaziar lixeira</button></header><ul class="lixeira__lista" aria-label="Itens na lixeira">${rows
    .map(
      (item, index) => `<li class="lixeira__item" data-lixeira-id="${escapeHtml(item.id)}"><span class="lixeira__icone">${icon(TRASH_ICON[item.kind] || 'nota')}</span><span class="lixeira__texto"><strong class="lixeira__titulo">${escapeHtml(item.title)}</strong><small class="lixeira__meta">${TRASH_KIND[item.kind] || 'Item'} · ${escapeHtml(trashFolder(item.originalPath))} · apagado ${escapeHtml(trashWhen(item.deletedAt))} · ${sizeLabel(item.size || 0)}</small></span><span class="lixeira__acoes"><button type="button" class="btn btn--secundario" data-restaurar="${index}">${icon('desfazer')} Restaurar</button><button type="button" class="btn btn--fantasma btn--perigo" data-excluir="${index}">Excluir de vez</button></span></li>`,
    )
    .join('')}</ul></div>`;
  $('#lixeira-esvaziar').onclick = () => emptyTrashFromView();
  center.querySelectorAll('[data-restaurar]').forEach((button) => {
    button.onclick = () => restoreFromTrashView(rows[Number(button.dataset.restaurar)]);
  });
  center.querySelectorAll('[data-excluir]').forEach((button) => {
    button.onclick = () => purgeFromTrashView(rows[Number(button.dataset.excluir)]);
  });
}

/* A faixa fixa da revisão saiu do topo das telas: o aviso mora no sino de notificações. */
/* ------------------------------------------------------------ Notificações */
const NOTIF_TYPES = [
  ['revisao', 'Revisão da semana', 'calendario', 'Aviso no domingo, quando a revisão da semana está pronta.'],
  ['lixeira', 'Lixeira', 'lixeira', 'Lembra que há itens na lixeira para restaurar ou esvaziar.'],
  ['conflito', 'Conflitos de edição', 'alerta', 'Quando uma nota mudou fora do Sophy e precisa da sua escolha.'],
  ['exportacao', 'Exportações concluídas', 'exportar', 'PDF, Markdown ou site salvos, com atalho para a pasta.'],
  ['sofi', 'Avisos da Sofi', 'faisca', 'Quando a Sofi termina um pedido com o painel fechado.'],
];
const NOTIF_KEY = 'sophy.notificacoes';

function notifStore() {
  try {
    const data = JSON.parse(localStorage.getItem(NOTIF_KEY) || '{}');
    return { prefs: data.prefs || {}, items: data.items || [], dismissed: data.dismissed || {}, read: data.read || {} };
  } catch {
    return { prefs: {}, items: [], dismissed: {}, read: {} };
  }
}

function notifSave(store) {
  store.items = store.items.slice(0, 30);
  localStorage.setItem(NOTIF_KEY, JSON.stringify(store));
}

function notifEnabled(type) {
  return notifStore().prefs[type] !== false;
}

function setNotifEnabled(type, on) {
  const store = notifStore();
  store.prefs[type] = on;
  notifSave(store);
  refreshNotifications();
}

/* Avisos que acontecem uma vez (exportação, Sofi) ficam guardados; os de estado (revisão, lixeira, conflito) são calculados. */
function pushNotification({ type, title, body, action }) {
  const store = notifStore();
  store.items.unshift({ id: `${type}:${Date.now()}`, type, title, body, action: action || null, at: Date.now() });
  notifSave(store);
  refreshNotifications();
}

async function computeNotifications() {
  const store = notifStore();
  const list = [];
  const today = isoToday();
  if (new Date().getDay() === 0 && state.libraryPath)
    list.push({ id: `revisao:${today}`, type: 'revisao', title: 'Revisão da semana pronta', body: 'A Sofi juntou o que você escreveu. Ela não altera as notas sozinha.', action: { label: 'Abrir revisão', kind: 'revisao' }, at: new Date().setHours(0, 0, 0, 0) });
  if (state.libraryPath && Date.now() - (state.notifTrashAt || 0) > 4000) {
    state.notifTrashAt = Date.now();
    try {
      state.notifTrash = await tool('trash.list', {});
    } catch {
      state.notifTrash = [];
    }
  }
  const trash = state.notifTrash || [];
  if (trash.length) {
    const size = trash.reduce((sum, item) => sum + (item.size || 0), 0);
    list.push({ id: `lixeira:${trash.length}:${trash[0].id}`, type: 'lixeira', title: `Lixeira com ${trash.length} ${trash.length === 1 ? 'item' : 'itens'}`, body: `${sizeLabel(size)} guardados. Restaure o que precisar ou esvazie.`, action: { label: 'Abrir lixeira', kind: 'lixeira' }, at: Date.parse(trash[0].deletedAt) || Date.now() });
  }
  if (state.conflict && state.active)
    list.push({ id: `conflito:${state.active}`, type: 'conflito', title: 'Nota mudou fora do app', body: `“${baseName(state.active)}” foi alterada em outro programa. Escolha qual versão manter.`, action: { label: 'Abrir nota', kind: 'note', arg: state.active }, at: Date.now() });
  for (const item of store.items) list.push(item);
  return list
    .filter((item) => store.prefs[item.type] !== false && !store.dismissed[item.id])
    .map((item) => ({ ...item, read: Boolean(store.read[item.id]) }))
    .sort((a, b) => b.at - a.at);
}

/* exportPdf devolve { ok, value }, com value vazio quando a pessoa cancela o diálogo. */
function exportDone(saved) {
  return Boolean(saved && typeof saved === 'object' && 'value' in saved ? saved.value : saved);
}

function scheduleNotifRefresh() {
  clearTimeout(state.notifTimer);
  state.notifTimer = setTimeout(refreshNotifications, 250);
}

async function refreshNotifications() {
  if (!$('#notificacoes')) return;
  state.notifList = await computeNotifications();
  const unread = state.notifList.filter((item) => !item.read).length;
  const badge = $('#notificacoes-contador');
  if (badge) {
    badge.hidden = !unread;
    badge.textContent = unread > 9 ? '9+' : String(unread);
  }
  const button = $('#notificacoes');
  if (button) button.setAttribute('aria-label', unread ? `Notificações, ${unread} ${unread === 1 ? 'não lida' : 'não lidas'}` : 'Notificações');
  if ($('#notificacoes-painel')) paintNotifications();
}

function toggleNotifications() {
  if ($('#notificacoes-painel')) {
    closeNotifications();
    return;
  }
  closeMenus();
  const anchor = $('#notificacoes');
  const panel = document.createElement('div');
  panel.id = 'notificacoes-painel';
  panel.className = 'menu menu-flutuante notif';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notificações');
  document.body.append(panel);
  anchor.setAttribute('aria-expanded', 'true');
  const rect = anchor.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = `${rect.bottom + 6}px`;
  panel.style.right = `${Math.max(8, window.innerWidth - rect.right - 40)}px`;
  panel.addEventListener('mousedown', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNotifications();
  });
  paintNotifications();
  refreshNotifications();
  panel.querySelector('button')?.focus();
}

function closeNotifications() {
  $('#notificacoes-painel')?.remove();
  $('#notificacoes')?.setAttribute('aria-expanded', 'false');
}

function paintNotifications() {
  const panel = $('#notificacoes-painel');
  if (!panel) return;
  const list = state.notifList || [];
  const icons = Object.fromEntries(NOTIF_TYPES.map(([type, , glyph]) => [type, glyph]));
  const unread = list.filter((item) => !item.read).length;
  panel.innerHTML = `<header class="notif__topo"><h3>Notificações</h3><button type="button" class="btn btn--fantasma btn--pequeno" id="notif-todas" ${unread ? '' : 'disabled'}>Marcar todas como lidas</button></header>${
    list.length
      ? `<ul class="notif__lista">${list
          .map(
            (item, index) => `<li class="notif__item${item.read ? '' : ' is-nova'}" data-notif="${index}"><span class="notif__icone">${icon(icons[item.type] || 'notificacao')}</span><span class="notif__texto"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.body || '')}</small>${item.action ? `<button type="button" class="btn btn--secundario btn--pequeno" data-notif-acao="${index}">${escapeHtml(item.action.label)}</button>` : ''}</span><span class="notif__lado"><time>${escapeHtml(trashWhen(new Date(item.at).toISOString()) || '')}</time><button type="button" class="btn btn--icone notif__fechar" data-notif-dispensar="${index}" aria-label="Dispensar: ${escapeHtml(item.title)}">${icon('fechar')}</button></span></li>`,
          )
          .join('')}</ul>`
      : `<div class="notif__vazio">${icon('notificacao')}<b>Tudo em dia</b><p>Nada novo por aqui. Os avisos aparecem neste sino.</p></div>`
  }<footer class="notif__rodape"><button type="button" class="btn btn--fantasma btn--pequeno" id="notif-config">Configurar avisos</button></footer>`;
  $('#notif-todas').onclick = () => markNotifications(list, 'read');
  $('#notif-config').onclick = () => {
    closeNotifications();
    state.configSection = 'notificacoes';
    runCommand('config');
  };
  panel.querySelectorAll('[data-notif-acao]').forEach((button) => {
    button.onclick = () => runNotificationAction(list[Number(button.dataset.notifAcao)]);
  });
  panel.querySelectorAll('[data-notif-dispensar]').forEach((button) => {
    button.onclick = () => markNotifications([list[Number(button.dataset.notifDispensar)]], 'dismiss');
  });
}

function markNotifications(items, mode) {
  const store = notifStore();
  for (const item of items) {
    if (mode === 'read') store.read[item.id] = 1;
    else {
      store.dismissed[item.id] = 1;
      store.items = store.items.filter((stored) => stored.id !== item.id);
    }
  }
  notifSave(store);
  refreshNotifications();
}

function runNotificationAction(item) {
  if (!item?.action) return;
  markNotifications([item], 'read');
  closeNotifications();
  const { kind, arg } = item.action;
  if (kind === 'revisao') showReview();
  else if (kind === 'lixeira') runCommand('lixeira');
  else if (kind === 'note') openNote(arg);
  else if (kind === 'reveal') sophy.libraryReveal(arg);
  else if (kind === 'sofi') openAgent();
}

/* ------------------------------------------------------------------- Tags */
async function refreshTags() {
  try {
    const result = await tool('tags.list', {});
    state.tagTree = result?.tags || [];
  } catch {
    state.tagTree = [];
  }
  paintTags();
  if (state.view === 'tag' && state.tagFilter) loadTagNotes(false);
}

function scheduleTagsRefresh() {
  clearTimeout(state.tagsTimer);
  state.tagsTimer = setTimeout(refreshTags, 900);
}

function tagsOpen() {
  return localStorage.getItem('sophy-tags-aberto') !== '0';
}

function paintTags() {
  const host = $('#tags-painel');
  if (!host) return;
  const tree = state.tagTree || [];
  host.hidden = !tree.length;
  if (!tree.length) {
    host.innerHTML = '';
    return;
  }
  const open = tagsOpen();
  const row = (node, depth) => `<li><div class="tag-linha${state.view === 'tag' && state.tagFilter === node.path ? ' is-atual' : ''}" style="--nivel:${depth}"><button type="button" class="tag-linha__abrir" data-tag="${escapeHtml(node.path)}" title="Ver as notas com #${escapeHtml(node.path)}">${icon('hash')}<span class="tag-linha__nome">${escapeHtml(node.name)}</span><span class="tag-linha__conta">${node.total}</span></button><button type="button" class="tag-linha__mais" data-tag-menu="${escapeHtml(node.path)}" aria-label="Opções da tag ${escapeHtml(node.name)}">${icon('mais-opcoes')}</button></div>${node.children?.length ? `<ul>${node.children.map((child) => row(child, depth + 1)).join('')}</ul>` : ''}</li>`;
  host.innerHTML = `<button type="button" class="tags-painel__topo" id="tags-alternar" aria-expanded="${open}">${icon(open ? 'chevron-baixo' : 'chevron-direita')}<span>Tags</span></button>${open ? `<ul class="tags-painel__lista">${tree.map((node) => row(node, 0)).join('')}</ul>` : ''}`;
  $('#tags-alternar').onclick = () => {
    localStorage.setItem('sophy-tags-aberto', open ? '0' : '1');
    paintTags();
  };
  host.querySelectorAll('[data-tag]').forEach((button) => {
    button.onclick = () => showTag(button.dataset.tag);
  });
  host.querySelectorAll('[data-tag-menu]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      openTagMenu(button, button.dataset.tagMenu);
    };
  });
  host.querySelectorAll('.tag-linha').forEach((line) => {
    line.oncontextmenu = (event) => {
      event.preventDefault();
      openTagMenu(line, line.querySelector('[data-tag]').dataset.tag);
    };
  });
}

function openTagMenu(anchor, tag) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<button type="button" class="menu__item" role="menuitem" data-acao="ver">${icon('hash')} Ver as notas</button><button type="button" class="menu__item" role="menuitem" data-acao="renomear">${icon('renomear')} Renomear tag…</button>`;
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.min(rect.right - 8, window.innerWidth - 220)}px`;
  menu.style.top = `${rect.bottom + 2}px`;
  menu.addEventListener('mousedown', (event) => event.stopPropagation());
  menu.querySelector('[data-acao="ver"]').onclick = () => {
    closeMenus();
    showTag(tag);
  };
  menu.querySelector('[data-acao="renomear"]').onclick = () => {
    closeMenus();
    renameTag(tag);
  };
}

async function renameTag(from) {
  const to = await textDialog({ title: 'Renomear tag', label: `Novo nome para #${from}`, value: from, confirm: 'Renomear' });
  if (!to || to.replace(/^#/, '').trim() === from) return;
  const target = to.replace(/^#/, '').trim();
  const existing = flatTags(state.tagTree || []).some((node) => node.path.toLocaleLowerCase() === target.toLocaleLowerCase());
  if (existing && !(await confirmDialog(`Já existe #${target}. As notas das duas tags vão ficar juntas em #${target}.`, { confirm: 'Unir tags' }))) return;
  try {
    if (!(await flushNote())) return;
    await tool('tag.rename', { from, to: target });
    if (state.tagFilter === from) state.tagFilter = target;
    await refreshLibrary();
    if (state.active) await openNote(state.active, { force: true });
    paintTree();
    toast(existing ? `#${from} foi unida a #${target}.` : `#${from} agora é #${target}.`, 'ok', { label: 'Desfazer', onClick: () => undoLastAction('Renomeação desfeita.').then(refreshTags) });
    if (state.view === 'tag') showTag(state.tagFilter);
  } catch (error) {
    toast(error.message, 'erro');
  }
}

function flatTags(nodes) {
  return nodes.flatMap((node) => [node, ...flatTags(node.children || [])]);
}

async function showTag(tag) {
  state.view = 'tag';
  state.nav = '';
  state.tagFilter = tag;
  state.tagNotes = null;
  paintCenter();
  paintTags();
  await loadTagNotes(true);
}

async function loadTagNotes(repaint) {
  const tag = state.tagFilter;
  try {
    const result = await tool('tags.notes', { tag, nested: true });
    state.tagNotes = result?.notes || [];
  } catch (error) {
    state.tagNotes = [];
    toast(error.message, 'erro');
  }
  if (repaint !== false || state.view === 'tag') paintCenter();
}

function paintTagView(center) {
  const tag = state.tagFilter;
  const notes = state.tagNotes;
  if (!notes) {
    center.innerHTML = `<div class="etiqueta-tela"><header class="etiqueta-tela__topo"><h2>#${escapeHtml(tag)}</h2></header><p class="lixeira__nota" role="status">Carregando…</p></div>`;
    return;
  }
  center.innerHTML = `<div class="etiqueta-tela"><header class="etiqueta-tela__topo"><div><h2><span class="tag-selo">#${escapeHtml(tag)}</span></h2><p class="lixeira__nota">${notes.length} ${notes.length === 1 ? 'nota' : 'notas'}, com as tags filhas.</p></div><button type="button" class="btn btn--secundario" id="tag-renomear">${icon('renomear')} Renomear tag</button></header>${
    notes.length
      ? `<ul class="etiqueta-tela__lista">${notes.map((note) => `<li><button type="button" class="etiqueta-nota" data-abrir-nota="${escapeHtml(note.path)}">${icon('nota')}<span><b>${escapeHtml(note.title || baseName(note.path))}</b><small>${escapeHtml(trashFolder(note.path))}${note.source === 'text' ? ' · no texto' : note.source === 'frontmatter' ? ' · nas propriedades' : ''}</small></span></button></li>`).join('')}</ul>`
      : '<p class="lixeira__nota">Nenhuma nota usa esta tag agora.</p>'
  }</div>`;
  $('#tag-renomear').onclick = () => renameTag(tag);
  center.querySelectorAll('[data-abrir-nota]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.abrirNota);
  });
}

/* Chips de tag nas Propriedades: o frontmatter é a fonte; o + abre um campo com sugestões. */
function noteTagList() {
  const raw = state.frontmatter?.tags;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((tag) => String(tag).replace(/^#/, '')).filter(Boolean);
}

function noteTagsRowHtml() {
  const chips = noteTagList()
    .map((tag) => `<span class="tag-chip" data-tag-chip="${escapeHtml(tag)}"><button type="button" class="tag-chip__nome" data-tag-ver="${escapeHtml(tag)}" title="Ver as notas com #${escapeHtml(tag)}">#${escapeHtml(tag)}</button><button type="button" class="tag-chip__tirar" data-tag-tirar="${escapeHtml(tag)}" aria-label="Tirar a tag ${escapeHtml(tag)}">${icon('fechar')}</button></span>`)
    .join('');
  return `<div class="propriedade propriedade--tags"><span class="propriedade__nome"><span class="propriedade__tipo" aria-hidden="true">${icon('tag')}</span><span>tags</span></span><div class="propriedade__valor tag-chips">${chips}<span class="tag-chip-novo"><button type="button" class="tag-chip-mais" id="tag-adicionar" aria-label="Adicionar tag" title="Adicionar tag">${icon('mais')}</button></span></div><span></span></div>`;
}

function bindNoteTags() {
  const column = $('#coluna');
  if (!column) return;
  column.querySelectorAll('[data-tag-ver]').forEach((button) => {
    button.onclick = () => showTag(button.dataset.tagVer);
  });
  column.querySelectorAll('[data-tag-tirar]').forEach((button) => {
    button.onclick = () => changeNoteTags({ remove: [button.dataset.tagTirar] });
  });
  const add = $('#tag-adicionar');
  if (add)
    add.onclick = () => {
      const slot = add.parentElement;
      slot.innerHTML = '<input id="tag-novo-campo" class="tag-chip-campo" list="tag-sugestoes" placeholder="nova-tag" aria-label="Nova tag" maxlength="60" autocomplete="off"><datalist id="tag-sugestoes"></datalist>';
      const input = $('#tag-novo-campo');
      input.focus();
      const suggest = async () => {
        try {
          const result = await tool('tag.suggest', { prefix: input.value.replace(/^#/, ''), limit: 8 });
          $('#tag-sugestoes').innerHTML = (result?.tags || []).map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join('');
        } catch {
          /* sem sugestões, o campo continua valendo */
        }
      };
      suggest();
      input.oninput = suggest;
      input.onkeydown = (event) => {
        if (event.key === 'Escape') paintCenter();
        if (event.key === 'Enter') {
          event.preventDefault();
          const value = input.value.replace(/^#/, '').trim();
          if (value) changeNoteTags({ add: [value] });
          else paintCenter();
        }
      };
      input.onblur = () => setTimeout(() => $('#tag-novo-campo') === input && !input.value.trim() && paintCenter(), 150);
    };
}

async function changeNoteTags(change) {
  if (!state.active) return;
  try {
    if (!(await flushNote())) return;
    await tool('note.tags', { path: state.active, ...change });
    await openNote(state.active, { force: true });
    refreshTags();
  } catch (error) {
    toast(error.message, 'erro');
  }
}

/* ------------------------------------------------- #tag no texto e autocomplete */
function tagHue(tag) {
  const root = String(tag).split('/')[0].toLocaleLowerCase();
  let hash = 0;
  for (const char of root) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

const INLINE_TAG = /(^|[\s(>])#([\p{L}\p{N}_][\p{L}\p{N}_\-\/]*)/gu;

// Marca #tag no HTML já renderizado, sem tocar em links, código nem atributos.
function tagifyHtml(html) {
  let skip = 0;
  return String(html)
    .split(/(<[^>]+>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (/^<(a|code|kbd|pre)[\s>]/i.test(part)) skip += 1;
        else if (/^<\/(a|code|kbd|pre)>/i.test(part)) skip = Math.max(0, skip - 1);
        return part;
      }
      if (skip || !part.includes('#')) return part;
      return part.replace(INLINE_TAG, (all, lead, name) => {
        if (!/\D/.test(name)) return all;
        const clean = name.replace(/[\/\-]+$/, '');
        const rest = name.slice(clean.length);
        return `${lead}<span class="tag-inline" data-tag-texto="${clean}" style="--tag-h:${tagHue(clean)}" title="Ver as notas com #${clean}">#${clean}</span>${rest}`;
      });
    })
    .join('');
}

let tagClickGuard = null;
function hookInlineTags() {
  document.addEventListener(
    'mousedown',
    (event) => {
      const chip = event.target.closest?.('#coluna .tag-inline');
      tagClickGuard = chip ? { chip, editing: chip.closest('[data-block]') === document.activeElement } : null;
    },
    true,
  );
  document.addEventListener('click', (event) => {
    const chip = event.target.closest?.('#coluna .tag-inline[data-tag-texto]');
    if (!chip) return;
    if (getSelection()?.toString()) return;
    if (tagClickGuard?.chip === chip && tagClickGuard.editing && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    showTag(chip.dataset.tagTexto);
  });
}

async function showTagMenu(el, found) {
  const seq = (state.tagMenuSeq = (state.tagMenuSeq || 0) + 1);
  let tags = [];
  try {
    tags = (await tool('tag.suggest', { prefix: found.query, limit: 8 }))?.tags || [];
  } catch {
    tags = [];
  }
  if (seq !== state.tagMenuSeq || !el.isConnected) return;
  if (!tags.length) {
    closeMenus();
    return;
  }
  const rows = tags
    .map((tag) => `<button type="button" class="menu__item" role="option" data-insert="#${escapeHtml(tag.name)}">${icon('hash')}<span><span class="menu__titulo">${highlight(tag.name, found.query)}</span></span><span class="menu__quando">${tag.total} ${tag.total === 1 ? 'nota' : 'notas'}</span></button>`)
    .join('');
  openMenu(el, 'menu menu--wiki menu-flutuante menu--tags', rows, (button) => {
    insertAt(el, found.start, found.start + 1 + found.query.length, button.dataset.insert);
  });
}

function syncWeekly() {
  $('#revisao-semana')?.remove();
  scheduleNotifRefresh();
}

function paintCenter() {
  const center = $('#centro');
  if (!center || state.painting) return;
  if (state.view !== 'graph' && state.graphView) {
    state.graphView.dispose();
    state.graphView = null;
    if (state.graphKeyHandler) document.removeEventListener('keydown', state.graphKeyHandler);
    state.graphKeyHandler = null;
  }
  state.painting = true;
  const viewKey = `${state.view}:${state.view === 'note' ? state.active : state.view === 'canvas' ? state.canvasPath : state.nav || ''}`;
  if (viewKey !== state.lastViewKey) {
    state.lastViewKey = viewKey;
    center.classList.remove('is-entrando');
    void center.offsetWidth;
    center.classList.add('is-entrando');
    clearTimeout(state.enterTimer);
    state.enterTimer = setTimeout(() => center.classList.remove('is-entrando'), 400);
  }
  try {
    paintCenterBody(center);
  } finally {
    state.painting = false;
  }
  bindCodeChrome();
  ensureCodeGrammars();
  fillMermaid();
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
    : `<div class="canvas-grade__vazio">${ilustracao('canvas-vazio', 180)}<strong>Nenhum canvas ainda</strong><p>Crie um quadro para ligar notas, formas e ideias. Use Novo, na lateral, e escolha Canvas.</p></div>`;
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
      if (!(await confirmDialog(`Mover o canvas “${baseName(file)}” para a lixeira?`, { confirm: 'Mover para a lixeira', danger: true }))) return;
      try {
        const trashed = await tool('entry.trash', { path: file });
        state.tabs = state.tabs.filter((tab) => tab !== file);
        state.canvasGalleryLoaded = false;
        await refreshLibrary();
        paintTree();
        paintTabs();
        paintCenter();
        toastTrashed('Canvas movido para a lixeira.', trashed?.id);
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
  if (state.view === 'trash') {
    paintTrash(center);
    return;
  }
  if (state.view === 'tag') {
    paintTagView(center);
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
  if (state.view === 'graph') {
    paintGraph(center);
    return;
  }
  if (state.view === 'canvas-error') {
    center.innerHTML = `<div class="vazio-ensina"><h2>Não deu para abrir este canvas</h2><p>${escapeHtml(state.canvasError || 'O arquivo do quadro não pôde ser lido.')} O arquivo continua intacto na pasta.</p></div>`;
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
      : `<div class="vazio-ensina"><h2>Escolha uma nota na lateral</h2><p>Ou crie uma pelo botão Novo. Cada nota é um arquivo Markdown na sua pasta.</p></div>`;
    return;
  }
  const conflict = state.conflict
    ? `<div class="aviso" role="alert">${icon('erro')} <span>A nota mudou desde a leitura, fora do Sophy. Nada foi gravado ainda: escolha recarregar ou manter a sua versão.</span> <button type="button" class="btn btn--secundario" id="recarregar">${anim('sincronizar', 'sincronizar')}Recarregar</button></div>`
    : '';
  const chips = tagChips(state.frontmatter);
  const crumb = noteCrumb(state.active);
  const dailyIso = dailyPathDate(state.active);
  const firstIsTitle = state.doc.blocks[0]?.type === 'heading';
  const hiddenBlocks = collapsedBlockIndexes(state.doc.blocks);
  const title = dailyIso
    ? `<h1 class="nota-dia__titulo" aria-readonly="true">${icon('cadeado', 'icon--14')}<span>${escapeHtml(dailyHeading(dailyIso))}</span></h1>`
    : firstIsTitle
      ? renderBlock(state.doc.blocks[0], 0)
      : '';
  const blocks = state.doc.blocks
    .slice(firstIsTitle ? 1 : 0)
    .map((block, index) => {
      const at = index + (firstIsTitle ? 1 : 0);
      if (hiddenBlocks.has(at)) return '';
      return renderBlock(block, at);
    })
    .join('');
  const cover = coverBand();
  const strip = dailyStrip(state.active);
  const layout = noteLayout();
  const layoutClasses = [`nota--font-${layout.font}`, layout.small ? 'nota--small' : '', layout.wide ? 'nota--wide' : ''].filter(Boolean).join(' ');
  const noteTools = `<div class="nota-ferramentas"><button type="button" class="btn btn--fantasma btn--pequeno" id="nota-filha" title="Criar uma página dentro desta">${icon('nota-nova')}<span>Página filha</span></button><button type="button" class="btn btn--fantasma btn--pequeno" id="nota-anexar" title="Anexar imagem ou arquivo (ou arraste para a nota)">${icon('anexo')}<span>Anexar</span></button><button type="button" class="btn ${state.focusMode ? 'btn--primario nota-foco-sair' : 'btn--icone'}" id="modo-foco" data-focus-toggle aria-label="${state.focusMode ? 'Sair do modo foco' : 'Ativar modo foco'}" aria-pressed="${state.focusMode}">${state.focusMode ? 'Sair do foco' : icon('foco-no')}</button><button type="button" class="btn btn--icone" id="nota-mais" aria-label="Opções da nota" title="Opções da nota" aria-haspopup="true">${icon('mais-opcoes')}</button></div>`;
  center.innerHTML = `${conflict}<article class="coluna ${layoutClasses}" id="coluna">${noteTools}${strip}${cover}<p class="nota__caminho">${crumb}</p>${title}<div class="nota__meta">${chips}</div>${notePropertiesHtml()}${blocks}<button type="button" class="nota-adicionar" id="nota-adicionar">${icon('mais')}<span>Adicionar bloco</span><span class="nota-adicionar__dica">ou digite <kbd class="kbd">/</kbd> numa linha vazia</span></button></article>`;
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
  const child = $('#nota-filha');
  if (child) child.onclick = () => createChildPage();
  const attach = $('#nota-anexar');
  if (attach) attach.onclick = () => pickAndInsertImages().catch((error) => toast(error.message, 'erro'));
  const addBlock = $('#nota-adicionar');
  if (addBlock) addBlock.onclick = () => insertBlockBelow(Math.max(0, state.doc.blocks.length - 1));
  $('#adicionar-propriedade')?.addEventListener('click', () => openPropertyEditor());
  bindNoteTags();
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
    .querySelectorAll('[data-secao-toggle]')
    .forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleSection(button.dataset.secaoToggle);
      };
    });
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
          ingestFileBlobs(event.dataTransfer.files).catch((error) => toast(error.message, 'erro'));
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
    followLink(link.dataset.raw || link.dataset.target, {
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

function codeLinesOn() {
  try {
    return localStorage.getItem('sophy-code-lines') === '1';
  } catch {
    return false;
  }
}

const MERMAID_SRC = '../node_modules/mermaid/dist/mermaid.min.js';
let mermaidPromise = null;
let mermaidCounter = 0;

function isMermaidInfo(info) {
  return Code.resolveLanguage(info).token.toLowerCase() === 'mermaid';
}

/* A biblioteca só é baixada do disco quando a nota tem um bloco ```mermaid. */
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidPromise) {
    mermaidPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MERMAID_SRC;
      script.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('A biblioteca de diagramas não carregou.')));
      script.onerror = () => {
        mermaidPromise = null;
        reject(new Error('A biblioteca de diagramas não está disponível.'));
      };
      document.head.append(script);
    });
  }
  return mermaidPromise;
}

function mermaidTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const dark = themeName() === 'dark';
  return {
    darkMode: dark,
    background: token('--surface', dark ? '#1c1b22' : '#ffffff'),
    primaryColor: token('--accent-soft', dark ? '#2b2a4a' : '#e8e8fb'),
    primaryTextColor: token('--ink', dark ? '#f2f1f6' : '#1c1b22'),
    primaryBorderColor: token('--accent', '#4f46b8'),
    secondaryColor: token('--hover', dark ? '#2a2931' : '#efeef3'),
    tertiaryColor: token('--surface', dark ? '#1c1b22' : '#ffffff'),
    lineColor: token('--ink-3', '#6e6c7a'),
    textColor: token('--ink', dark ? '#f2f1f6' : '#1c1b22'),
    noteBkgColor: token('--hover-subtle', dark ? '#25242b' : '#f6f5f9'),
    noteTextColor: token('--ink', dark ? '#f2f1f6' : '#1c1b22'),
    fontFamily: token('--font-ui', 'Inter, system-ui, sans-serif'),
  };
}

async function fillMermaid() {
  const hosts = [...document.querySelectorAll('.codigo--mermaid')];
  if (!hosts.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    for (const wrap of hosts) paintMermaidError(wrap, error.message);
    return;
  }
  const theme = themeName();
  if (state.mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: mermaidTheme(), suppressErrorRendering: true });
    state.mermaidTheme = theme;
    state.mermaidCache = {};
  }
  state.mermaidCache ||= {};
  for (const wrap of hosts) {
    const target = wrap.querySelector('.codigo__diagrama');
    const pre = wrap.querySelector('pre.bloco--codigo');
    if (!target || !pre || wrap.dataset.vista === 'codigo') continue;
    const source = pre.textContent.trim();
    if (!source) {
      target.innerHTML = '<p class="diagrama__vazio">Diagrama vazio. Mostre o código e escreva a descrição para ver o desenho.</p>';
      continue;
    }
    if (state.mermaidCache[source]) {
      target.innerHTML = state.mermaidCache[source];
      target.dataset.estado = 'pronto';
      continue;
    }
    const id = `sophy-mmd-${++mermaidCounter}`;
    try {
      await mermaid.parse(source);
      const { svg } = await mermaid.render(id, source);
      state.mermaidCache[source] = svg;
      target.innerHTML = svg;
      target.dataset.estado = 'pronto';
    } catch (error) {
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      paintMermaidError(wrap, String(error?.message || error));
    }
  }
}

function paintMermaidError(wrap, detail) {
  const target = wrap.querySelector('.codigo__diagrama');
  if (!target) return;
  target.dataset.estado = 'erro';
  const first = String(detail || '').split('\n').find((line) => line.trim()) || '';
  target.innerHTML = `<div class="diagrama__erro" role="alert"><b>Não deu para desenhar este diagrama.</b><p>Confira a sintaxe do bloco. O código continua intacto na nota.</p>${first ? `<small>${escapeHtml(first.slice(0, 160))}</small>` : ''}<button type="button" class="btn btn--secundario btn--pequeno" data-mermaid-view="codigo">Ver o código</button></div>`;
}

function setMermaidView(wrap, view) {
  const index = Number(wrap.querySelector('pre.bloco--codigo')?.dataset.block);
  state.mermaidView ||= {};
  state.mermaidView[index] = view;
  wrap.dataset.vista = view;
  wrap.querySelectorAll('[data-mermaid-view]').forEach((button) => {
    if (button.closest('.codigo__alternar')) button.setAttribute('aria-pressed', button.dataset.mermaidView === view ? 'true' : 'false');
  });
  if (view === 'diagrama') fillMermaid();
  else wrap.querySelector('pre.bloco--codigo')?.focus();
}

function renderCodeBlock(block, index) {
  const parts = Doc.codeParts(block.raw);
  const source = parts.body;
  const info = parts.info || '';
  const blockName = Code.parseInfo(info).title;
  const linesOn = codeLinesOn();
  const highlighted = Code.highlight(source, info, window.Prism);
  const nums = source.split('\n').map((_, line) => String(line + 1)).join('\n');
  const mermaid = isMermaidInfo(info);
  const view = mermaid ? (state.mermaidView?.[index] || 'diagrama') : '';
  const toggle = mermaid
    ? `<span class="codigo__alternar" role="group" aria-label="Mostrar"><button type="button" data-mermaid-view="diagrama" aria-pressed="${view === 'diagrama'}">Diagrama</button><button type="button" data-mermaid-view="codigo" aria-pressed="${view === 'codigo'}">Código</button></span>`
    : '';
  return `<div class="codigo${linesOn ? ' codigo--linhas' : ''}${mermaid ? ' codigo--mermaid' : ''}"${mermaid ? ` data-vista="${view}"` : ''}>
    <div class="codigo__barra">
      <label class="codigo__nome">${icon('codigo')}<input type="text" class="codigo__nome-campo" data-code-name="${index}" value="${escapeHtml(blockName)}" maxlength="80" placeholder="Nome do bloco" aria-label="Nome do bloco de código" spellcheck="false"></label>
      ${toggle}
      <button type="button" class="codigo__acao" data-code-lines aria-pressed="${linesOn ? 'true' : 'false'}">Linhas</button>
      <button type="button" class="codigo__acao" data-code-copy="${index}">Copiar</button>
      <button type="button" class="codigo__lingua" data-code-lang="${index}" aria-haspopup="listbox" aria-label="Linguagem do bloco" title="Trocar a linguagem">${icon('codigo')}<span class="codigo__lingua-nome">${escapeHtml(Code.labelFor(info))}</span>${icon('chevron-baixo')}</button>
    </div>
    ${mermaid ? '<div class="codigo__diagrama" aria-label="Diagrama" role="img"><p class="diagrama__vazio">Desenhando…</p></div>' : ''}
    <div class="codigo__rolagem">
      <pre class="codigo__nums" aria-hidden="true">${escapeHtml(nums)}</pre>
      <div class="codigo__camada">
        <pre class="codigo__realce" aria-hidden="true">${highlighted}</pre>
        <pre class="bloco bloco--codigo" data-block="${index}" data-info="${escapeHtml(info)}" contenteditable="true" spellcheck="false">${escapeHtml(source)}</pre>
      </div>
    </div>
  </div>`;
}

function refreshCodeView(pre) {
  const wrap = pre.closest('.codigo');
  if (!wrap) return;
  const source = pre.textContent;
  const realce = wrap.querySelector('.codigo__realce');
  if (realce) realce.innerHTML = Code.highlight(source, pre.dataset.info || '', window.Prism);
  const nums = wrap.querySelector('.codigo__nums');
  if (nums) nums.textContent = source.split('\n').map((_, line) => String(line + 1)).join('\n');
}

function bindCodeChrome() {
  const center = $('#centro');
  if (!center || center.dataset.codeChrome) return;
  center.dataset.codeChrome = '1';
  center.addEventListener('click', onCodeChromeClick);
  center.addEventListener('change', (event) => {
    const field = event.target.closest?.('[data-code-name]');
    if (field) setCodeName(Number(field.dataset.codeName), field.value);
  });
  center.addEventListener('keydown', (event) => {
    const field = event.target.closest?.('[data-code-name]');
    if (!field) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      field.blur();
    } else if (event.key === 'Escape') {
      field.value = Code.parseInfo(state.doc?.blocks[Number(field.dataset.codeName)] ? Doc.codeParts(state.doc.blocks[Number(field.dataset.codeName)].raw).info : '').title;
      field.blur();
    }
  });
}

function onCodeChromeClick(event) {
  const view = event.target.closest('[data-mermaid-view]');
  if (view) {
    event.preventDefault();
    setMermaidView(view.closest('.codigo--mermaid'), view.dataset.mermaidView);
    return;
  }
  const lang = event.target.closest('[data-code-lang]');
  if (lang) {
    event.preventDefault();
    openCodeLanguageMenu(lang);
    return;
  }
  const copy = event.target.closest('[data-code-copy]');
  if (copy) {
    event.preventDefault();
    copyCode(Number(copy.dataset.codeCopy));
    return;
  }
  const lines = event.target.closest('[data-code-lines]');
  if (lines) {
    event.preventDefault();
    toggleCodeLines();
  }
}

function toggleCodeLines() {
  const next = !codeLinesOn();
  try {
    localStorage.setItem('sophy-code-lines', next ? '1' : '0');
  } catch {
    /* a preferência fica só nesta sessão */
  }
  document.querySelectorAll('.codigo').forEach((el) => {
    el.classList.toggle('codigo--linhas', next);
    el.querySelector('[data-code-lines]')?.setAttribute('aria-pressed', next ? 'true' : 'false');
  });
}

async function copyCode(index) {
  const pre = document.querySelector(`pre.bloco--codigo[data-block="${index}"]`);
  if (!pre) return;
  const text = pre.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  toast('Copiado');
}

/* Só o nome muda: linguagem e corpo ficam como estão na cerca. */
function setCodeName(index, name) {
  const pre = document.querySelector(`pre.bloco--codigo[data-block="${index}"]`);
  const block = state.doc?.blocks[index];
  if (!pre || !block || block.type !== 'code') return;
  const parts = Doc.codeParts(rawFromEditor(pre, block));
  const info = Code.composeInfo(Code.parseInfo(parts.info).rest, name);
  if (info === parts.info) return;
  state.doc = Doc.withBlockRaw(state.doc, index, Doc.codeRaw(parts.fence, info, parts.body));
  pre.dataset.info = info;
  const field = pre.closest('.codigo')?.querySelector('[data-code-name]');
  if (field) field.value = Code.parseInfo(info).title;
  scheduleSave();
}

function setCodeLanguage(index, language) {
  const pre = document.querySelector(`pre.bloco--codigo[data-block="${index}"]`);
  const block = state.doc?.blocks[index];
  if (!pre || !block || block.type !== 'code') return;
  const parts = Doc.codeParts(rawFromEditor(pre, block));
  const info = Code.composeInfo(language, Code.parseInfo(parts.info).title);
  state.doc = Doc.withBlockRaw(state.doc, index, Doc.codeRaw(parts.fence, info, parts.body));
  pre.dataset.info = info;
  const button = pre.closest('.codigo')?.querySelector('.codigo__lingua');
  const name = button?.querySelector('.codigo__lingua-nome');
  if (name) name.textContent = Code.labelFor(info);
  else if (button) button.textContent = Code.labelFor(info);
  refreshCodeView(pre);
  ensureCodeGrammars();
  scheduleSave();
}

let codeLangCloser = null;

function openCodeLanguageMenu(button) {
  closeMenus();
  const index = Number(button.dataset.codeLang);
  const block = state.doc?.blocks[index];
  if (!block || block.type !== 'code') return;
  const infos = state.doc.blocks.filter((item) => item.type === 'code').map((item) => Doc.codeParts(item.raw).info);
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante codigo-linguas';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Linguagem do bloco');
  const search = document.createElement('input');
  search.className = 'codigo-linguas__busca';
  search.type = 'search';
  search.placeholder = 'Buscar linguagem';
  search.setAttribute('aria-label', 'Buscar linguagem');
  search.autocomplete = 'off';
  const list = document.createElement('div');
  list.className = 'codigo-linguas__lista';
  menu.append(search, list);
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 340)}px`;
  menu.style.left = `${Math.max(8, rect.right - 260)}px`;
  const paint = () => fillCodeLanguages(list, search.value, infos, index);
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeMenus();
    button.focus();
  });
  paint();
  search.focus();
  if (codeLangCloser) document.removeEventListener('pointerdown', codeLangCloser, true);
  codeLangCloser = (event) => {
    if (!menu.isConnected) {
      document.removeEventListener('pointerdown', codeLangCloser, true);
      return;
    }
    if (menu.contains(event.target) || button.contains(event.target)) return;
    document.removeEventListener('pointerdown', codeLangCloser, true);
    closeMenus();
  };
  setTimeout(() => document.addEventListener('pointerdown', codeLangCloser, true), 0);
}

function fillCodeLanguages(list, query, infos, index) {
  list.replaceChildren();
  const q = query.trim();
  if (q) {
    const found = Code.search(q);
    const exact = found.some((item) => item.aliases.some((alias) => alias.toLowerCase() === q.toLowerCase()) || item.fence.toLowerCase() === q.toLowerCase());
    if (!exact) addCodeLanguageOption(list, index, q.replace(/[`\r\n]/g, ''), q.replace(/[`\r\n]/g, ''));
    found.forEach((item) => addCodeLanguageOption(list, index, item.fence, item.label));
    return;
  }
  addCodeLanguageOption(list, index, '', 'Texto');
  const ranked = Code.rank(infos);
  if (ranked.used.length) {
    addCodeLanguageHeading(list, 'Nesta nota');
    ranked.used.forEach((row) => {
      if (row.known) addCodeLanguageOption(list, index, row.known.fence, row.known.label);
      else addCodeLanguageOption(list, index, row.key, row.key);
    });
  }
  addCodeLanguageHeading(list, 'Mais usadas');
  ranked.popular.forEach((id) => {
    const item = Code.CATALOG.find((entry) => entry.id === id);
    if (item) addCodeLanguageOption(list, index, item.fence, item.label);
  });
  addCodeLanguageHeading(list, 'Outras');
  ranked.rest.forEach((id) => {
    const item = Code.CATALOG.find((entry) => entry.id === id);
    if (item) addCodeLanguageOption(list, index, item.fence, item.label);
  });
}

function addCodeLanguageHeading(list, text) {
  const heading = document.createElement('p');
  heading.className = 'menu__grupo';
  heading.textContent = text;
  list.append(heading);
}

function addCodeLanguageOption(list, index, fence, label) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'menu__item';
  option.setAttribute('role', 'option');
  option.textContent = label;
  option.addEventListener('mousedown', (event) => event.preventDefault());
  option.addEventListener('click', () => {
    setCodeLanguage(index, fence);
    closeMenus();
  });
  list.append(option);
}

const codeGrammarQueue = new Map();
let codeGrammarChain = Promise.resolve();

function loadCodeGrammar(name) {
  if (!window.Prism) return Promise.resolve();
  if (window.Prism.languages?.[name]) return Promise.resolve();
  if (codeGrammarQueue.has(name)) return codeGrammarQueue.get(name);
  const job = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = new URL(`../node_modules/prismjs/components/prism-${name}.min.js`, document.baseURI).href;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  codeGrammarQueue.set(name, job);
  return job;
}

function ensureCodeGrammars() {
  if (!state.doc) return;
  const names = [];
  for (const block of state.doc.blocks) {
    if (block.type !== 'code') continue;
    for (const name of Code.grammarPlan(Doc.codeParts(block.raw).info)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  codeGrammarChain = names
    .reduce((chain, name) => chain.then(() => loadCodeGrammar(name)), codeGrammarChain)
    .then(() => {
      document.querySelectorAll('pre.bloco--codigo').forEach((pre) => refreshCodeView(pre));
    });
}

function noteCollapsedSections() {
  const map = state.settings.collapsedSections || {};
  const list = state.active ? map[state.active] : null;
  return new Set(Array.isArray(list) ? list.map((item) => foldText(item)) : []);
}

function isSectionCollapsed(title) {
  return noteCollapsedSections().has(foldText(title));
}

function collapsedBlockIndexes(blocks) {
  const hidden = new Set();
  const collapsed = noteCollapsedSections();
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.type !== 'heading' || (block.level || 1) > 3) continue;
    const title = Doc.visibleOf(block).replace(/\n/g, ' ').trim();
    if (!collapsed.has(foldText(title))) continue;
    const level = block.level || 1;
    for (let next = index + 1; next < blocks.length; next += 1) {
      const other = blocks[next];
      if (other.type === 'heading' && (other.level || 1) <= level) break;
      hidden.add(next);
    }
  }
  return hidden;
}

async function toggleSection(title) {
  if (!state.active || !title) return;
  const map = { ...(state.settings.collapsedSections || {}) };
  const key = state.active;
  const current = new Set((map[key] || []).map((item) => String(item)));
  const folded = foldText(title);
  let next = [...current];
  if (current.has(folded) || [...current].some((item) => foldText(item) === folded)) {
    next = next.filter((item) => foldText(item) !== folded);
  } else next.push(title);
  if (next.length) map[key] = next;
  else delete map[key];
  state.settings.collapsedSections = map;
  await sophy.saveSettings({ collapsedSections: map });
  paintCenter();
}

function scrollToSection(anchor) {
  if (!anchor) return false;
  if (anchor.startsWith('^')) {
    const id = anchor.slice(1);
    const hit = [...document.querySelectorAll('#coluna [data-block]')].find((el) =>
      foldText(el.textContent || '').includes(foldText(`^${id}`)),
    );
    if (!hit) return false;
    hit.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
    hit.classList.add('is-secao-alvo');
    return true;
  }
  const wanted = foldText(anchor);
  const heading = [...document.querySelectorAll('#coluna .bloco--titulo')].find(
    (el) => foldText(el.textContent || '') === wanted,
  );
  if (!heading) return false;
  heading.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
  heading.classList.add('is-secao-alvo');
  return true;
}

function noteSectionsFromDoc() {
  const sections = [];
  for (let index = 0; index < (state.doc?.blocks || []).length; index += 1) {
    const block = state.doc.blocks[index];
    if (block.type !== 'heading' || (block.level || 1) > 3) continue;
    sections.push({
      title: Doc.visibleOf(block).replace(/\n/g, ' ').trim(),
      level: block.level || 1,
      index,
    });
  }
  return sections;
}

function renderBlock(block, index) {
  if (block.type === 'blank')
    return `<div class="bloco" data-vazio data-block="${index}" contenteditable="true"><br /></div>`;
  if (block.type === 'hr') return `<hr data-block="${index}" />`;
  if (block.type === 'heading') {
    const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
    const level = Math.min(block.level || 1, 6);
    const title = Doc.visibleOf(block).replace(/\n/g, ' ').trim();
    const collapsible = level <= 3;
    const folded = collapsible && isSectionCollapsed(title);
    const toggle = collapsible
      ? `<button type="button" class="secao__seta${folded ? ' is-fechada' : ''}" data-secao-toggle="${escapeHtml(title)}" aria-label="${folded ? 'Abrir seção' : 'Recolher seção'}" aria-expanded="${folded ? 'false' : 'true'}">${icon('chevron-direita')}</button>`
      : '';
    return `<div class="secao-titulo secao-titulo--${level}${folded ? ' is-recolhida' : ''}" data-secao="${escapeHtml(title)}">${toggle}<h${level} class="bloco bloco--titulo bloco--titulo${level}" data-block="${index}" contenteditable="true">${inlineHtml(text) || '<br>'}</h${level}></div>`;
  }
  if (block.type === 'code') return renderCodeBlock(block, index);
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
    const calloutMatch = text.match(/^\[!([a-z]+)\]\s*/i);
    const kind = calloutMatch?.[1]?.toLowerCase();
    if (kind && CALLOUTS[kind]) {
      const body = text.slice(calloutMatch[0].length);
      return `<div class="bloco bloco--callout bloco--callout-${kind}" data-callout-wrap="${kind}"><span class="callout__rotulo">${icon(CALLOUTS[kind].icon, 'icon--16')}<span>${CALLOUTS[kind].label}</span></span><blockquote class="bloco bloco--citacao bloco--destaque" data-block="${index}" data-callout="${kind}" contenteditable="true">${inlineHtml(body) || '<br>'}</blockquote></div>`;
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
  return tagifyHtml(html).replace(/<a href="#" class="wikilink([^"]*)"([^>]*)>/g, (all, cls, attrs) => {
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
    let body = lines;
    if (el.dataset.toggle === '1') body = ['[!toggle]', ...lines];
    else if (el.dataset.callout && CALLOUTS[el.dataset.callout]) {
      const first = lines[0] || '';
      const stripped = first.replace(new RegExp(`^\\[!${el.dataset.callout}\\]\\s*`, 'i'), '');
      body = [`[!${el.dataset.callout}] ${stripped}`.trimEnd(), ...lines.slice(1)];
    }
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
  const tagFound = block?.type === 'code' ? null : Cmd.tagQuery(text, cursor);
  if (found) showSlash(el, found);
  else if (wiki) showWiki(el, wiki);
  else if (tagFound) showTagMenu(el, tagFound);
  else closeMenus();
  if (block?.type === 'code') refreshCodeView(el);
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
      if (current.nodeType === Node.TEXT_NODE) {
        const raw = current.textContent || '';
        const capped = Math.min(offset, raw.length);
        count += raw.slice(0, capped).replace(/\u200b/g, '').length;
      } else [...current.childNodes].slice(0, offset).forEach((child) => addWhole(child));
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

function domOffsetForPlain(raw, plainOffset) {
  let plain = 0;
  const text = String(raw || '');
  for (let i = 0; i < text.length; i++) {
    if (plain === plainOffset) return i;
    if (text[i] !== '\u200b') plain++;
  }
  return text.length;
}

function placeCaret(el, offset) {
  el.focus();
  const selection = getSelection();
  const range = document.createRange();
  let left = Math.max(0, offset);
  const walk = (current) => {
    if (left < 0) return true;
    if (current.nodeType === Node.TEXT_NODE) {
      const raw = current.textContent || '';
      const text = raw.replace(/\u200b/g, '');
      if (left <= text.length) {
        range.setStart(current, domOffsetForPlain(raw, left));
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
    if (item.id === 'pagina') {
      insertAt(el, found.start, found.start + 1 + found.query.length, '');
      createChildPage().catch((error) => toast(error.message, 'erro'));
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

async function createChildPage() {
  if (!state.active) {
    toast('Abra a nota mãe primeiro.', 'erro');
    return;
  }
  const title = await textDialog({ title: 'Nova página filha', label: 'Nome da página', placeholder: 'Ex.: Resumo', confirm: 'Criar página' });
  if (!title?.trim()) return;
  const child = await tool('note.child.create', { parent: state.active, title: title.trim() });
  const link = `[[${child.path.replace(/\.md$/i, '')}]]`;
  const index = state.caret?.index ?? state.doc.blocks.length - 1;
  const block = state.doc.blocks[index];
  if (block) {
    const text = Doc.visibleOf(block);
    state.doc = Doc.withBlockRaw(state.doc, index, rawFromPlain(block, `${text}${text ? '\n' : ''}${link}`));
  } else {
    state.doc = Doc.replaceBlock(state.doc, state.doc.blocks.length - 1, `${link}\n`);
  }
  paintCenter();
  scheduleSave();
  await refreshLibrary();
  toast(`Página “${title.trim()}” criada.`);
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
    const response = await sophy.openExternal(target);
    if (!response.ok) toast(response.error, 'erro');
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
    await openNote(path, { anchor: draft.anchor || '' });
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
let wikiPreviewHideTimer = 0;
let wikiPreviewEl = null;
let wikiPreviewLink = null;
let wikiPreviewPath = '';

function closeWikiPreview() {
  clearTimeout(wikiPreviewTimer);
  clearTimeout(wikiPreviewHideTimer);
  wikiPreviewTimer = 0;
  wikiPreviewHideTimer = 0;
  wikiPreviewLink = null;
  wikiPreviewPath = '';
  wikiPreviewEl?.remove();
  wikiPreviewEl = null;
}

function scheduleCloseWikiPreview() {
  clearTimeout(wikiPreviewHideTimer);
  wikiPreviewHideTimer = setTimeout(() => {
    if (wikiPreviewEl?.matches(':hover') || wikiPreviewLink?.matches(':hover')) return;
    closeWikiPreview();
  }, 220);
}

function bindWikiPreview(host) {
  if (!host || host.dataset.wikiPreviewBound) return;
  host.dataset.wikiPreviewBound = '1';
  host.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a.wikilink[data-target]');
    if (!link || link.classList.contains('wikilink--quebrado')) return;
    clearTimeout(wikiPreviewHideTimer);
    if (!(event.ctrlKey || event.metaKey)) {
      if (wikiPreviewLink !== link) closeWikiPreview();
      return;
    }
    if (wikiPreviewLink === link && wikiPreviewEl) return;
    closeWikiPreview();
    wikiPreviewLink = link;
    wikiPreviewTimer = setTimeout(() => showWikiPreview(link), 180);
  });
  host.addEventListener('pointerout', (event) => {
    const link = event.target.closest('a.wikilink[data-target]');
    if (!link || link !== wikiPreviewLink) return;
    if (wikiPreviewEl?.contains(event.relatedTarget)) return;
    scheduleCloseWikiPreview();
  });
  host.addEventListener('pointermove', (event) => {
    const link = event.target.closest('a.wikilink[data-target]');
    if (!link || link.classList.contains('wikilink--quebrado')) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    if (wikiPreviewLink === link && wikiPreviewEl) return;
    clearTimeout(wikiPreviewHideTimer);
    if (wikiPreviewLink !== link) {
      closeWikiPreview();
      wikiPreviewLink = link;
      wikiPreviewTimer = setTimeout(() => showWikiPreview(link), 180);
    }
  });
}

function renderPreviewBody(body) {
  const doc = Doc.parseBody(String(body || ''));
  const blocks = (doc.blocks || []).slice(0, 28);
  if (!blocks.length) return '<p class="bloco bloco--texto">Nota vazia.</p>';
  return blocks
    .map((block, index) => {
      if (block.type === 'blank') return '<div class="bloco" data-vazio><br></div>';
      if (block.type === 'hr') return '<hr class="bloco">';
      if (block.type === 'heading') {
        const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
        const level = Math.min(block.level || 1, 6);
        return `<h${level} class="bloco bloco--titulo bloco--titulo${level}">${inlineHtml(text) || '<br>'}</h${level}>`;
      }
      if (block.type === 'code') {
        const inner = Doc.codeParts(block.raw).body;
        return `<pre class="bloco bloco--codigo">${escapeHtml(inner)}</pre>`;
      }
      if (block.type === 'quote') {
        const text = block.raw.replace(/^>\s?/gm, '').replace(/\n$/, '');
        return `<blockquote class="bloco bloco--citacao">${inlineHtml(text) || '<br>'}</blockquote>`;
      }
      if (block.type === 'task' && block.task) {
        const mark = block.task.status === 'x' || block.task.status === 'X' ? '☑' : '☐';
        return `<div class="bloco bloco--tarefa"><span class="wiki-previa__check">${mark}</span><span>${inlineHtml(block.task.title) || '<br>'}</span></div>`;
      }
      if (block.type === 'item') {
        const text = block.raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
        return `<div class="bloco bloco--item">${inlineHtml(text) || '<br>'}</div>`;
      }
      if (block.type === 'table') {
        const model = Doc.tableModel(block.raw);
        const rows = (model.rows || [])
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${inlineHtml(cell) || '<br>'}</td>`).join('')}</tr>`,
          )
          .join('');
        return `<table class="bloco bloco--tabela"><tbody>${rows}</tbody></table>`;
      }
      const embed = String(block.raw || '')
        .trim()
        .match(/^!\[\[([^\]\n]+)\]\]$/);
      if (embed) {
        return `<figure class="embed"><div class="embed__caminho">${escapeHtml(embed[1])}</div></figure>`;
      }
      const text = String(block.raw || '').replace(/\n$/, '');
      if (!text.trim()) return '';
      return `<p class="bloco bloco--texto">${inlineHtml(text) || '<br>'}</p>`;
    })
    .join('');
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
  wikiPreviewPath = notePath;
  const cover = Cmd.resolveCover(note.frontmatter);
  let coverFileSrc = cover?.kind === 'arquivo' ? cover.src : null;
  if (coverFileSrc && !/^(https?:|data:|file:|blob:)/i.test(coverFileSrc)) {
    const folder = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
    const near = coverFileSrc.includes('/') || coverFileSrc.startsWith('Anexos/')
      ? coverFileSrc
      : folder
        ? `${folder}/${coverFileSrc}`
        : coverFileSrc;
    try {
      const asset = await tool('attachment.read', { path: near });
      coverFileSrc = asset.dataUrl || coverFileSrc;
    } catch {
      coverFileSrc = '';
    }
  }
  const coverHtml = cover
    ? cover.kind === 'cor'
      ? `<div class="wiki-previa__capa wiki-previa__capa--cor" style="--capa-tinta:${cover.color === 'estante' ? noteShelfColor() : `var(--shelf-${cover.color})`}"></div>`
      : cover.kind === 'arte'
        ? `<div class="wiki-previa__capa"><svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#capa-${escapeHtml(cover.id)}"/></svg></div>`
        : cover.kind === 'arquivo' && coverFileSrc
          ? `<div class="wiki-previa__capa"><img class="wiki-previa__capa-img" alt="" src="${escapeHtml(coverFileSrc)}"></div>`
          : ''
    : '';
  const card = document.createElement('section');
  card.className = 'wiki-previa menu-flutuante';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Prévia da nota');
  card.innerHTML = `${coverHtml}
    <header class="wiki-previa__topo">
      <strong class="wiki-previa__titulo">${escapeHtml(baseName(notePath))}</strong>
      <span class="wiki-previa__caminho">${escapeHtml(notePath.replace(/\.md$/i, ''))}</span>
    </header>
    <div class="wiki-previa__corpo coluna">${renderPreviewBody(note.body)}</div>
    <footer class="wiki-previa__rodape">
      <button type="button" class="btn btn--secundario btn--pequeno" data-abrir>Abrir nota</button>
      <span class="wiki-previa__dica">Segure o mouse · Esc fecha</span>
    </footer>`;
  document.body.append(card);
  wikiPreviewEl = card;
  const rect = link.getBoundingClientRect();
  const width = Math.min(520, window.innerWidth - 24);
  card.style.width = `${width}px`;
  card.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  const preferBelow = rect.bottom + 12;
  const maxHeight = Math.min(window.innerHeight * 0.72, 560);
  card.style.maxHeight = `${maxHeight}px`;
  requestAnimationFrame(() => {
    if (!wikiPreviewEl) return;
    const height = Math.min(wikiPreviewEl.offsetHeight, maxHeight);
    const fitsBelow = preferBelow + height <= window.innerHeight - 12;
    const top = fitsBelow
      ? preferBelow
      : Math.max(12, rect.top - height - 12);
    wikiPreviewEl.style.top = `${top}px`;
  });
  card.addEventListener('pointerenter', () => clearTimeout(wikiPreviewHideTimer));
  card.addEventListener('pointerleave', (event) => {
    if (wikiPreviewLink?.contains(event.relatedTarget)) return;
    scheduleCloseWikiPreview();
  });
  card.querySelector('[data-abrir]')?.addEventListener('click', async () => {
    const path = wikiPreviewPath;
    closeWikiPreview();
    if (path) await openNote(path);
  });
  card.querySelectorAll('a.wikilink[data-target]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });
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
document.addEventListener(
  'keyup',
  (event) => {
    if ((event.key === 'Control' || event.key === 'Meta') && wikiPreviewEl) {
      if (!wikiPreviewEl.matches(':hover') && !wikiPreviewLink?.matches(':hover'))
        scheduleCloseWikiPreview();
    }
  },
  true,
);

function markSaved() {
  scheduleTagsRefresh();
  const status = $('#st-estado');
  if (status) status.textContent = 'Salvo';
  const mark = $('#st-anim');
  if (mark && mark.dataset.estado !== 'salvo') {
    mark.dataset.estado = 'salvo';
    mark.innerHTML = ANIM.salvo || '';
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  state.dirty = true;
  state.editSeq = (state.editSeq || 0) + 1;
  const status = $('#st-estado');
  if (status) status.textContent = 'Alterações locais';
  const mark = $('#st-anim');
  if (mark) {
    mark.innerHTML = '';
    delete mark.dataset.estado;
  }
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
    markSaved();
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
    let guard = 0;
    while (guard++ < 40) {
      const pending = canvasJob;
      await pending;
      if (canvasJob !== pending) continue;
      if (!state.canvasDirty && !state.conflict) return true;
      break;
    }
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
      markSaved();
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
  state.nav = note.path === `Diário/${isoToday()}.md` ? 'hoje' : '';
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
  if (options.anchor) {
    const found = scrollToSection(options.anchor);
    if (!found && options.anchor) {
      const outgoing = state.outgoing.find((link) => link.anchor && foldText(link.anchor) === foldText(options.anchor));
      if (!outgoing || outgoing.status === 'broken') toast('Essa seção não existe mais.', 'erro');
    }
  }
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

const ATTACHMENT_FOLDER = 'Anexos';

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
    if (/^Anexos\//.test(resolveEmbedPath(target)) && !/\.md$/i.test(target.split('|')[0])) {
      paintAttachmentCard(figure, body, resolveEmbedPath(target));
      continue;
    }
    const path = target.endsWith('.md') ? target : `${target}.md`;
    try {
      const note = await tool('note.read', { path });
      body.textContent = note.body.slice(0, 400);
    } catch {
      body.textContent = 'Anexo ou nota ainda não encontrada.';
    }
  }
}

async function paintAttachmentsSettings() {
  const host = $('#cfg-anexos-conteudo');
  if (!host) return;
  let list;
  try {
    list = await tool('attachment.list', {});
  } catch (error) {
    if ($('#cfg-anexos-conteudo') === host)
      host.innerHTML = `<p class="config__ajuda">${/desconhecida/i.test(error.message) ? 'A lista de anexos chega com a atualização do motor (PR 32).' : escapeHtml(error.message)}</p>`;
    return;
  }
  if ($('#cfg-anexos-conteudo') !== host) return;
  const total = list.reduce((sum, item) => sum + (item.size || 0), 0);
  const orphans = list.filter((item) => !item.usedBy?.length).length;
  const bar = `<div class="anexos__barra"><span>${list.length ? `${list.length} ${list.length === 1 ? 'arquivo' : 'arquivos'} · ${sizeLabel(total)}${orphans ? ` · ${orphans} sem uso` : ''}` : 'Nenhum anexo ainda'}</span><button type="button" class="btn btn--secundario btn--pequeno" id="anexos-anexar">${icon('mais')} Anexar arquivo</button></div>`;
  if (!list.length) {
    host.innerHTML = `${bar}<p class="anexos__vazio">Arraste um arquivo para dentro de uma nota, ou use Anexar. Ele aparece aqui, com as notas que o usam.</p>`;
  } else {
    host.innerHTML = `${bar}<ul class="anexos__lista">${list
      .map(
        (item, index) => `<li class="anexos__item${item.usedBy?.length ? '' : ' is-orfao'}"><span class="anexos__icone">${icon(item.mime?.startsWith('image/') ? 'imagem' : 'anexo')}</span><span class="anexos__texto"><b title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</b><small>${item.usedBy?.length ? `Usado em: ${item.usedBy.map((note) => `<button type="button" class="anexos__nota" data-abrir-nota="${escapeHtml(note)}">${escapeHtml(baseName(note))}</button>`).join(', ')}` : 'Nenhuma nota usa este arquivo'}</small></span>${item.usedBy?.length ? '' : '<span class="chip anexos__selo">Sem uso</span>'}<span class="anexos__tamanho">${sizeLabel(item.size || 0)}</span><button type="button" class="btn btn--secundario" data-abrir-anexo="${index}">Abrir</button></li>`,
      )
      .join('')}</ul>`;
    host.querySelectorAll('[data-abrir-anexo]').forEach((button) => {
      button.onclick = () => openAttachmentFile(list[Number(button.dataset.abrirAnexo)].path).catch((error) => toast(error.message, 'erro'));
    });
    host.querySelectorAll('[data-abrir-nota]').forEach((button) => {
      button.onclick = () => openNote(button.dataset.abrirNota);
    });
  }
  const attach = $('#anexos-anexar');
  if (attach)
    attach.onclick = async () => {
      try {
        const picked = await sophy.chooseFiles();
        if (!picked?.ok) throw new Error(picked?.error || 'Não foi possível abrir o seletor.');
        const paths = picked.value || [];
        if (!paths.length) return;
        await importAttachmentFiles(paths.map((path) => ({ path })));
        toast(paths.length === 1 ? 'Arquivo anexado à biblioteca.' : `${paths.length} arquivos anexados à biblioteca.`);
        paintAttachmentsSettings();
      } catch (error) {
        toast(error.message, 'erro');
      }
    };
}

/* Markdown sem o id, com os anexos citados gravados ao lado (Anexos/…). Quem grava é o main. */
async function exportNoteMarkdown() {
  if (!state.active || !state.doc) {
    toast('Abra uma nota para exportar o Markdown.', 'erro');
    return;
  }
  if (typeof sophy.exportMarkdown !== 'function') {
    toast('Exportar Markdown chega com a atualização do back (PR 32).', 'erro');
    return;
  }
  if (!(await flushNote())) return;
  const result = await tool('note.export', { path: state.active, format: 'md' });
  const response = await sophy.exportMarkdown(result);
  // O main devolve { ok, value } quando passa por handle(); o contrato do PR 32 descreve o próprio value.
  const saved = response && typeof response.value === 'object' && response.value ? response.value : response;
  if (response?.ok === false && !saved?.path) {
    toast(response.error || 'Não deu para exportar o Markdown.', 'erro');
    return;
  }
  if (saved?.canceled) return;
  if (saved?.error || saved?.ok === false) {
    toast(saved.error || 'Não deu para exportar o Markdown.', 'erro');
    return;
  }
  const where = String(saved?.path || '');
  const folder = where.replace(/[/\\][^/\\]*$/, '');
  const extra = saved?.written > 1 ? ` e ${saved.written - 1} ${saved.written - 1 === 1 ? 'anexo' : 'anexos'}` : '';
  toast(`Markdown exportado${extra}.`, 'ok', folder
    ? { label: 'Mostrar na pasta', onClick: () => sophy.libraryReveal(folder) }
    : null);
  pushNotification({
    type: 'exportacao',
    title: 'Markdown exportado',
    body: `“${baseName(state.active)}”${extra ? ` e anexos` : ''} foram gravados em ${folder || 'a pasta escolhida'}.`,
    action: folder ? { label: 'Mostrar na pasta', kind: 'reveal', arg: folder } : null,
  });
}

async function exportNotePdf() {
  if (!state.active || !state.doc) {
    toast('Abra uma nota para exportar o PDF.', 'erro');
    return;
  }
  if (!(await flushNote())) return;
  let result;
  try {
    result = await tool('note.export', { path: state.active, format: 'pdf' });
  } catch (error) {
    if (/desconhecida/i.test(error.message)) return openExport('pdf');
    toast(error.message, 'erro');
    return;
  }
  const saved = await sophy.exportPdf(result.content);
  if (exportDone(saved)) {
    toast('PDF em papel claro.');
    pushNotification({ type: 'exportacao', title: 'PDF exportado', body: `“${baseName(state.active)}” foi salvo em papel claro.` });
  }
}

async function openAttachmentFile(path) {
  if (typeof sophy.openAttachment !== 'function') {
    toast('Abrir anexos precisa da versão com o PR 32 do back.', 'erro');
    return;
  }
  const result = await sophy.openAttachment(path);
  if (result && result.ok === false) toast(result.error || 'Não deu para abrir o arquivo.', 'erro');
}

async function paintAttachmentCard(figure, body, path) {
  figure.classList.add('embed--arquivo');
  const name = baseNameOf(path);
  let meta = 'Arquivo';
  try {
    const list = await tool('attachment.list', {});
    const info = list.find((item) => item.path === path);
    if (info) meta = `${attachmentKind(info)} · ${sizeLabel(info.size)}`;
    else meta = 'Arquivo não encontrado';
  } catch {
    /* sem lista, o cartão mostra só o nome */
  }
  body.innerHTML = `<span class="arquivo__icone">${icon('anexo')}</span><span class="arquivo__texto"><b>${escapeHtml(name)}</b><small>${escapeHtml(meta)}</small></span><button type="button" class="btn btn--secundario" data-abrir-anexo="${escapeHtml(path)}">Abrir</button>`;
  body.querySelector('[data-abrir-anexo]').onclick = () => openAttachmentFile(path).catch((error) => toast(error.message, 'erro'));
}

function attachmentKind(info) {
  const ext = (info.name.split('.').pop() || '').toLowerCase();
  if (info.mime?.startsWith('image/')) return 'Imagem';
  if (ext === 'pdf') return 'PDF';
  return ext ? ext.toUpperCase() : 'Arquivo';
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
  const added = await tool('attachment.import', { folder: ATTACHMENT_FOLDER, files });
  await refreshLibrary();
  return added.map((item) => item.path);
}

async function pickAndInsertImages() {
  if (!state.active || !state.doc) {
    toast('Abra uma nota para inserir imagens.', 'erro');
    return;
  }
  const picked = await sophy.chooseFiles();
  if (!picked?.ok) throw new Error(picked?.error || 'Não foi possível abrir o seletor.');
  const paths = picked.value || [];
  if (!paths.length) return;
  const imported = await importAttachmentFiles(paths.map((path) => ({ path })));
  insertEmbedBlocks(imported);
}

async function fileToImport(file, fallback) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name: file.name || fallback, dataBase64: btoa(binary) };
}

async function ingestFiles(list, { onlyImages }) {
  const all = [...list];
  const files = onlyImages ? all.filter((file) => /^image\//.test(file.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name || '')) : all;
  if (!files.length) return false;
  if (!state.active || !state.doc) {
    toast('Abra uma nota para anexar arquivos.', 'erro');
    return true;
  }
  const tooBig = files.find((file) => file.size > 25 * 1024 * 1024);
  if (tooBig) {
    toast(`“${tooBig.name}” passa de 25 MB, o limite de um anexo.`, 'erro');
    return true;
  }
  const payload = [];
  for (const file of files) payload.push(await fileToImport(file, `arquivo-${Date.now()}`));
  const imported = await importAttachmentFiles(payload);
  insertEmbedBlocks(imported);
  toast(imported.length === 1 ? `“${baseNameOf(imported[0])}” anexado.` : `${imported.length} arquivos anexados.`);
  return true;
}

function baseNameOf(file) {
  return String(file).split('/').pop();
}

/* Colar só aceita imagem, para não sequestrar o texto copiado. Soltar aceita qualquer arquivo. */
function ingestImageBlobs(fileList) {
  return ingestFiles(fileList, { onlyImages: true });
}

function ingestFileBlobs(fileList) {
  return ingestFiles(fileList, { onlyImages: false });
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
  const outline = noteSectionsFromDoc()
    .map(
      (section) =>
        `<button type="button" class="sumario__item sumario__item--${section.level}${isSectionCollapsed(section.title) ? ' is-recolhida' : ''}" data-sumario="${escapeHtml(section.title)}">${escapeHtml(section.title)}</button>`,
    )
    .join('');
  const outlineBlock = `<h3 class="conexoes__titulo">Sumário</h3><div class="sumario">${outline || '<p class="nota-privacidade">Nenhuma seção H1–H3.</p>'}</div>`;
  host.innerHTML = `${head}<p class="nota__caminho">${noteCrumb(state.active)}</p><h3>${escapeHtml(baseName(state.active))}</h3>${outlineBlock}<h3>Links de saída</h3>${out}<h3>Backlinks</h3>${back}${mentionBlock}
    <h3 class="conexoes__titulo">Histórico</h3><button type="button" class="btn btn--fantasma" id="desfazer">${icon('desfazer')} Desfazer</button>`;
  $('#fechar-conexoes').onclick = () => closeConnections();
  host.querySelectorAll('[data-sumario]').forEach((button) => {
    button.onclick = () => scrollToSection(button.dataset.sumario);
  });
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

function mondayStart(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoTodayFrom(date);
}

function calendarWindow(cursor, mode) {
  if (mode === 'semana') {
    const start = mondayStart(cursor);
    return { start, end: addIso(start, 6) };
  }
  const [year, month] = cursor.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  const start = isoTodayFrom(first);
  return { start, end: addIso(start, 41) };
}

async function showCalendar() {
  state.view = 'calendar';
  if (state.calendarMode !== 'semana') state.calendarMode = 'mes';
  state.calendarCursor = state.calendarCursor || isoToday();
  state.dayFocus = state.dayFocus || isoToday();
  const range = calendarWindow(state.calendarCursor, state.calendarMode);
  const result = await tool('calendar.query', { from: range.start, to: range.end });
  state.calendarItems = result?.items || [];
  state.calendarDays = result?.days || [];
  if (state.dayPanelOpen) await loadDayPanel(state.dayFocus);
  else paintCenter();
}

async function loadDayPanel(date) {
  state.dayFocus = date;
  state.dayPanelOpen = true;
  state.dayPanelItems = null;
  paintCenter();
  const result = await tool('calendar.query', { from: date, to: date });
  if (state.dayFocus !== date || !state.dayPanelOpen) return;
  state.dayPanelItems = result?.items || [];
  paintCenter();
}

function shiftCalendarDay(delta) {
  const next = addIso(state.dayFocus || state.calendarCursor || isoToday(), delta);
  state.dayFocus = next;
  const mode = state.calendarMode === 'semana' ? 'semana' : 'mes';
  const visible = calendarWindow(state.calendarCursor || next, mode);
  const outside = next < visible.start || next > visible.end;
  if (outside) {
    state.calendarCursor = next;
    showCalendar();
    return;
  }
  if (state.dayPanelOpen) loadDayPanel(next);
  else paintCenter();
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

function taskDateLabel(task) {
  const today = isoToday();
  const date = task.due || task.scheduled;
  if (!date) return '';
  if (date === today) return 'hoje';
  if (date === addIso(today, -1)) return 'ontem';
  if (date === addIso(today, 1)) return 'amanhã';
  if (date < today && task.status !== 'feita' && task.status !== 'cancelada') {
    const days = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
    return `${days} dia${days === 1 ? '' : 's'} atrasada`;
  }
  return shortDate(date);
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
  const mark = task.workspace ? markFor(task.workspace) : null;
  const tint = mark?.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
  const late = task.due && task.due < isoToday() && task.status !== 'feita' && task.status !== 'cancelada';
  const dateLabel = taskDateLabel(task);
  const priority = task.priority
    ? `<i class="tarefa-prio tarefa-prio--${task.priority}" title="${task.priority}"></i>`
    : '';
  const kids =
    task.childTotal > 0
      ? `<span class="chip">${task.childDone}/${task.childTotal}</span>`
      : '';
  const indent = task.parentLine ? ' is-sub' : '';
  return `<article class="kcard${indent}" draggable="true" data-task="${escapeHtml(task.path)}" data-line="${task.line}" data-rev="${task.revision}" data-title="${escapeHtml(task.title)}" title="${escapeHtml(task.title)} · ${escapeHtml(task.path)}"><span class="check" data-status="${kit}"></span><span class="chip__ponto" aria-hidden="true"${tint}></span><button type="button" class="kcard__titulo" data-open-task="${escapeHtml(task.path)}">${escapeHtml(task.title)}</button><span class="kcard__meta">${priority}${kids}${dateLabel ? `<span class="chip${late ? ' chip--atrasada' : ''}">${escapeHtml(dateLabel)}</span>` : ''}</span></article>`;
}

function focusTasks(rows) {
  const today = isoToday();
  const yesterday = addIso(today, -1);
  const focus = rows
    .filter(
      (task) =>
        task.status !== 'feita' &&
        task.status !== 'cancelada' &&
        (task.scheduled === today || (!task.scheduled && task.due === today)),
    )
    .slice(0, 5);
  const leftover = rows.filter(
    (task) =>
      task.status !== 'feita' &&
      task.status !== 'cancelada' &&
      (task.scheduled === yesterday || (!task.scheduled && task.due === yesterday)),
  );
  return { focus, leftover };
}

function parseQuickTask(text) {
  let source = String(text || '').trim();
  let workspace = null;
  const shelf = source.match(/(?:^|\s)@([^\s]+)/);
  if (shelf) {
    workspace = shelf[1];
    source = source.replace(shelf[0], ' ').trim();
  }
  let priority = null;
  if (/\b!alta\b/i.test(source) || /\b!!\b/.test(source)) priority = 'alta';
  if (/\b!media\b/i.test(source)) priority = 'media';
  if (/\b!baixa\b/i.test(source)) priority = 'baixa';
  source = source.replace(/\s*!alta\b|\s*!media\b|\s*!baixa\b|\s*!!\b/gi, '').trim();
  let due = null;
  const today = isoToday();
  if (/\bhoje\b/i.test(source)) {
    due = today;
    source = source.replace(/\bhoje\b/gi, '').trim();
  } else if (/\bamanh[aã]\b/i.test(source)) {
    due = addIso(today, 1);
    source = source.replace(/\bamanh[aã]\b/gi, '').trim();
  } else {
    const iso = source.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) {
      due = iso[1];
      source = source.replace(iso[0], '').trim();
    }
  }
  return { title: source.replace(/\s+/g, ' ').trim(), due, priority, workspace };
}

function paintTasks(center) {
  const rows = state.taskRows || [];
  const filter = state.taskFilter || {};
  state.taskMode = state.taskMode || 'lista';
  state.taskView = state.taskView || 'todas';
  const { focus, leftover } = focusTasks(rows);
  const views = {
    hoje: rows.filter((task) => taskBucket(task) === 'Hoje' || task.scheduled === isoToday()),
    proximas: rows.filter((task) => taskBucket(task) === 'Próximas' || taskBucket(task) === 'Esta semana'),
    atrasadas: rows.filter((task) => taskBucket(task) === 'Atrasadas'),
    todas: rows,
  };
  const openRows = rows.filter((task) => !task.parentLine);
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
  const shelves = (state.workspaces || []).map((shelf) => [shelf.name, shelf.name]);
  const columns = ['aberta', 'andamento', 'feita']
    .map((status) => {
      const label = status === 'aberta' ? 'A fazer' : status === 'andamento' ? 'Fazendo' : 'Feito';
      const cards = openRows.filter((task) => task.status === status).map(taskCard).join('');
      return `<section class="quadro__coluna" data-status="${status}"><h3>${label} <span>${taskCounts[status]}</span></h3>${cards || '<p>Solte aqui</p>'}</section>`;
    })
    .join('');
  const viewButtons = [
    ['hoje', 'Hoje'],
    ['proximas', 'Próximas'],
    ['atrasadas', 'Atrasadas'],
    ['todas', 'Todas'],
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="seg-botao${state.taskView === id ? ' is-ativa' : ''}" data-view="${id}" aria-pressed="${state.taskView === id}">${label}</button>`,
    )
    .join('');
  const lista =
    state.taskView === 'todas'
      ? `<details class="tarefas__grupo" open><summary>Todas (${views.todas.length})</summary>${views.todas.filter((task) => !task.parentLine).map(taskCard).join('') || `<div class="vazio-pequeno">${ilustracao('nenhuma-tarefa', 160)}<p>Nenhuma tarefa por aqui. Escreva <span class="kbd">- [ ] algo</span> numa nota ou use o campo acima.</p></div>`}</details>`
      : (views[state.taskView] || []).filter((task) => !task.parentLine).map(taskCard).join('') ||
        `<div class="vazio-pequeno">${ilustracao('nenhuma-tarefa', 160)}<p>Nada nesta visão. Aproveite, ou troque de visão acima.</p></div>`;
  const focusHtml = `<section class="tarefas__foco"><h3>Foco de hoje</h3><div class="tarefas__lista">${focus.map(taskCard).join('') || '<p class="nota-privacidade">Arraste até 5 tarefas para o foco.</p>'}</div>${leftover.length ? `<h3>Ficou de ontem</h3><div class="tarefas__lista">${leftover.map(taskCard).join('')}</div>` : ''}</section>`;
  const quick = `<form class="tarefas__rapida" id="tarefa-rapida"><input id="tarefa-rapida-texto" placeholder="pagar DAS amanhã !alta" aria-label="Nova tarefa"><select id="tarefa-rapida-estante" aria-label="Estante">${(state.workspaces || []).map((shelf) => `<option value="${escapeHtml(shelf.name)}">${escapeHtml(shelf.name)}</option>`).join('')}</select><button type="submit" class="btn btn--primario">Adicionar</button><div class="tarefas__previa" id="tarefa-rapida-previa"></div></form>`;
  const hasFilter = Object.values(filter).some(Boolean);
  center.innerHTML = `<div class="tarefas"><header class="tarefas__topo"><div><h2>Tarefas</h2><p>${taskCounts.aberta} a fazer · ${taskCounts.andamento} fazendo · ${taskCounts.feita} feitas</p></div><div class="tarefas__filtros">${viewButtons}${chips(shelves, 'workspace')}${[['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']].map(([value, label]) => `<button type="button" class="chip ${filter.priority === value ? 'is-ativa' : ''}" data-filtro="priority" data-valor="${value}">${label}</button>`).join('')}${hasFilter ? '<button type="button" class="btn btn--fantasma" id="limpar-filtros">Limpar filtros</button>' : ''}</div><div>${['lista', 'quadro'].map((mode) => `<button type="button" class="btn ${state.taskMode === mode ? 'btn--primario' : 'btn--fantasma'}" data-modo="${mode}">${mode === 'lista' ? 'Lista' : 'Quadro'}</button>`).join('')}</div></header>${quick}${focusHtml}${state.taskMode === 'quadro' ? `<div class="quadro">${columns}</div>` : `<div class="tarefas__lista">${lista}</div>`}</div>`;
  center.querySelectorAll('[data-filtro]').forEach((button) => {
    button.onclick = () => {
      state.taskFilter[button.dataset.filtro] =
        state.taskFilter[button.dataset.filtro] === button.dataset.valor ? '' : button.dataset.valor;
      saveTaskFilters();
      showTasks();
    };
  });
  center.querySelectorAll('[data-view]').forEach((button) => {
    button.onclick = () => {
      state.taskView = button.dataset.view;
      paintCenter();
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
    saveTaskFilters();
    showTasks();
  });
  const quickInput = $('#tarefa-rapida-texto');
  const preview = $('#tarefa-rapida-previa');
  const paintPreview = () => {
    const parsed = parseQuickTask(quickInput.value);
    preview.innerHTML = parsed.title
      ? `<span class="chip">${escapeHtml(parsed.title)}</span>${parsed.due ? `<span class="chip">${escapeHtml(taskDateLabel({ due: parsed.due, status: 'aberta' }))}</span>` : ''}${parsed.priority ? `<span class="chip">${parsed.priority}</span>` : ''}`
      : '';
  };
  quickInput?.addEventListener('input', paintPreview);
  $('#tarefa-rapida')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const parsed = parseQuickTask(quickInput.value);
    if (!parsed.title) return;
    const shelf = $('#tarefa-rapida-estante')?.value || parsed.workspace || 'Entrada';
    await createQuickTask(parsed, shelf);
    quickInput.value = '';
    paintPreview();
    await showTasks();
  });
  center.querySelectorAll('.kcard .check').forEach((check) => {
    check.onclick = async () => {
      const card = check.closest('.kcard');
      if (ANIM['tarefa-marcar'] && !motionReduced()) {
        check.classList.add('is-marcando');
        check.insertAdjacentHTML('beforeend', `<span class="check__anim anim" aria-hidden="true">${ANIM['tarefa-marcar']}</span>`);
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
      const current = check.dataset.status;
      const status = current === 'aberta' ? 'andamento' : current === 'andamento' ? 'feita' : 'aberta';
      const result = await tool('task.update', {
        path: card.dataset.task,
        line: Number(card.dataset.line),
        expectedRevision: card.dataset.rev,
        status,
        titleHint: card.dataset.title,
      });
      if (result?.conflict) {
        toast('A tarefa mudou na nota. Abrir nota?', 'erro', {
          label: 'Abrir',
          onClick: () => openNote(card.dataset.task),
        });
        return;
      }
      await showTasks();
    };
  });
  bindTaskDrag(center);
}

function saveTaskFilters() {
  try {
    localStorage.setItem('sophy.taskFilter', JSON.stringify(state.taskFilter || {}));
  } catch {
    /* preferência local */
  }
}

async function createQuickTask(parsed, shelf) {
  const day = isoToday();
  const daily = `Diário/${day}.md`;
  let note;
  try {
    note = await tool('note.read', { path: daily });
  } catch {
    note = await tool('note.create', {
      path: daily,
      body: `# ${dailyHeading(day)}\n\n`,
      frontmatter: { data: day },
    });
  }
  const marks = [
    parsed.due ? `📅 ${parsed.due}` : '',
    parsed.priority === 'alta' ? '⏫' : parsed.priority === 'media' ? '🔼' : parsed.priority === 'baixa' ? '🔽' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const line = `- [ ] ${parsed.title}${marks ? ` ${marks}` : ''}`;
  const body = `${String(note.body || '').replace(/\s*$/, '')}\n\n${line}\n`;
  await tool('note.write', { path: daily, body, expectedRevision: note.revision });
  if (shelf && shelf !== 'Diário') {
    /* a tarefa nasce na nota do dia; a estante do seletor só orienta o filtro */
    state.taskFilter = { ...(state.taskFilter || {}), workspace: '' };
  }
}

function shelfDotColor(name) {
  const mark = markFor(name);
  return mark.color || 1;
}

function dayMarks(date) {
  const summary = (state.calendarDays || []).find((day) => day.date === date);
  if (!summary || !summary.total) return '';
  const dots = [];
  for (const [shelf, count] of Object.entries(summary.byShelf || {})) {
    for (let index = 0; index < count; index += 1) dots.push(shelf);
  }
  const shown = dots.slice(0, 3);
  const extra = Math.max(0, summary.total - shown.length);
  const marks = shown
    .map((shelf) => `<i class="cal-ponto" style="background: var(--shelf-${shelfDotColor(shelf)})"></i>`)
    .join('');
  return `<span class="cal-pontos">${marks}${extra ? `<span class="cal-mais">+${extra}</span>` : ''}</span>`;
}

function paintCalendar(center) {
  const cursor = state.calendarCursor || isoToday();
  const mode = state.calendarMode === 'semana' ? 'semana' : 'mes';
  if (!state.dayFocus) state.dayFocus = isoToday();
  const range = calendarWindow(cursor, mode);
  const count = mode === 'semana' ? 7 : 42;
  const days = Array.from({ length: count }, (_, index) => addIso(range.start, index));
  const cells = days
    .map((date) => {
      const outside = date.slice(0, 7) !== cursor.slice(0, 7) ? ' is-fora' : '';
      const focus = date === state.dayFocus ? ' is-foco' : '';
      const daily = (state.calendarItems || []).some((item) => item.path === `Diário/${date}.md`) ? ' is-nota' : '';
      return `<button type="button" class="cal-dia${date === isoToday() ? ' is-hoje' : ''}${outside}${focus}${daily}" data-date="${date}" aria-selected="${date === state.dayFocus}"><strong class="cal-dia__num">${Number(date.slice(8))}</strong>${dayMarks(date)}</button>`;
    })
    .join('');
  const [year, month] = cursor.split('-').map(Number);
  const monthLabel = `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][month - 1]} de ${year}`;
  const monthName = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
  const weekdays = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((name) => `<span>${name}</span>`).join('');
  const previous = mode === 'mes' ? 'Mês anterior' : 'Semana anterior';
  const next = mode === 'mes' ? 'Próximo mês' : 'Próxima semana';
  const focus = state.dayFocus;
  const panelItems = state.dayPanelItems;
  const dailyPath = `Diário/${focus}.md`;
  const hasDaily = Array.isArray(panelItems) && panelItems.some((item) => item.path === dailyPath);
  const tasks = Array.isArray(panelItems) ? panelItems.filter((item) => item.kind === 'tarefa') : [];
  const notes = Array.isArray(panelItems)
    ? panelItems.filter((item) => item.kind !== 'tarefa' && item.path !== dailyPath)
    : [];
  const dailyBlock = !state.dayPanelOpen
    ? ''
    : panelItems === null
      ? `<p class="nota-privacidade carregando">${anim('carregando')}Carregando…</p>`
      : hasDaily
        ? `<button type="button" class="btn btn--secundario" data-open-note="${escapeHtml(dailyPath)}">${escapeHtml(dailyHeading(focus))}</button>`
        : `<button type="button" class="btn btn--primario" id="criar-nota-dia">Criar nota do dia</button>`;
  const taskList = tasks
    .map(
      (item) =>
        `<li><article class="kcard kcard--cal" draggable="true" data-task="${escapeHtml(item.path)}" data-line="${item.line || 1}" data-rev="${escapeHtml(item.revision || '')}" data-title="${escapeHtml(item.title)}"><button type="button" data-open-note="${escapeHtml(item.path)}">${escapeHtml(item.title)}</button></article></li>`,
    )
    .join('');
  const noteList = notes
    .map((item) => `<li><button type="button" data-open-note="${escapeHtml(item.path)}">${escapeHtml(calendarLabel(item.title))}</button></li>`)
    .join('');
  const dayPanel = state.dayPanelOpen
    ? `<aside class="painel-dia is-aberto" aria-label="${escapeHtml(dailyHeading(focus))}"><header><h3>${escapeHtml(dailyHeading(focus))}</h3><button type="button" class="btn btn--icone" id="fechar-dia" aria-label="Fechar">×</button></header><div class="painel-dia__nota">${dailyBlock}</div><h4>Tarefas</h4>${taskList ? `<ul>${taskList}</ul>` : '<p class="nota-privacidade">Nenhuma tarefa.</p>'}<h4>Notas</h4>${noteList ? `<ul>${noteList}</ul>` : '<p class="nota-privacidade">Nenhuma nota.</p>'}</aside>`
    : '';
  center.innerHTML = `<div class="calendario${state.dayPanelOpen ? ' is-dia' : ''}"><header class="calendario__barra"><div class="calendario__navegacao"><button type="button" class="btn btn--icone" data-passo="-1" aria-label="${previous}">‹</button><h2>${escapeHtml(monthName)}</h2><button type="button" class="btn btn--icone" data-passo="1" aria-label="${next}">›</button><button type="button" class="btn btn--fantasma" id="cal-hoje">Hoje</button></div><div class="calendario__modos"><button type="button" class="btn ${mode === 'mes' ? 'btn--primario' : 'btn--fantasma'}" data-cal="mes">Mês</button><button type="button" class="btn ${mode === 'semana' ? 'btn--primario' : 'btn--fantasma'}" data-cal="semana">Semana</button></div></header><div class="calendario__miolo${state.dayPanelOpen ? ' is-aberto' : ''}"><div class="calendario__grade"><div class="cal-semana">${weekdays}</div><div class="cal-grade${mode === 'semana' ? ' cal-grade--semana' : ''}">${cells}</div></div>${dayPanel}</div></div>`;
  $('#cal-hoje').onclick = () => {
    state.calendarCursor = isoToday();
    state.dayFocus = isoToday();
    showCalendar();
  };
  center.querySelectorAll('[data-cal]').forEach((button) => {
    button.onclick = () => {
      state.calendarMode = button.dataset.cal === 'semana' ? 'semana' : 'mes';
      if (state.calendarMode === 'semana') state.calendarCursor = isoToday();
      showCalendar();
    };
  });
  center.querySelectorAll('[data-passo]').forEach((button) => {
    button.onclick = () => {
      const step = Number(button.dataset.passo);
      if (state.calendarMode === 'semana') {
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
    day.onclick = () => {
      state.dayFocus = day.dataset.date;
      state.dayPanelOpen = true;
      loadDayPanel(day.dataset.date);
    };
  });
  center.querySelectorAll('[data-open-note]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.openNote);
  });
  const createDaily = $('#criar-nota-dia');
  if (createDaily) createDaily.onclick = () => openDailyOn(state.dayFocus);
  const closeDay = $('#fechar-dia');
  if (closeDay)
    closeDay.onclick = () => {
      state.dayPanelOpen = false;
      paintCenter();
    };
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
          title: card.dataset.title || '',
        }),
      );
    });
  });
  center.querySelectorAll('[data-status], [data-date], .tarefas__foco').forEach((target) => {
    target.addEventListener('dragover', (event) => event.preventDefault());
    target.addEventListener('drop', async (event) => {
      event.preventDefault();
      const payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}');
      if (!payload.path) return;
      const patch = {
        path: payload.path,
        line: payload.line,
        expectedRevision: payload.revision,
        titleHint: payload.title || undefined,
      };
      if (target.dataset.status) patch.status = target.dataset.status;
      if (target.dataset.date) patch.due = target.dataset.date;
      if (target.classList.contains('tarefas__foco')) patch.scheduled = isoToday();
      const result = await tool('task.update', patch);
      if (result?.conflict) {
        toast('A tarefa mudou na nota. Abrir nota?', 'erro', {
          label: 'Abrir',
          onClick: () => openNote(payload.path),
        });
        return;
      }
      if (state.view === 'calendar') await showCalendar();
      else await showTasks();
    });
  });
}

function runCommand(id) {
  const leaving = ['inicio', 'hoje', 'tarefas', 'calendario', 'grafo', 'canvas', 'versoes', 'cartas', 'lixeira', 'config', 'visoes', 'mencoes'].includes(id);
  if (leaving && ((state.view === 'note' && state.doc) || state.view === 'canvas')) {
    flushNote().then((saved) => { if (saved) runCommandNow(id); });
    return;
  }
  runCommandNow(id);
}

function runCommandNow(id) {
  if (['inicio', 'hoje', 'tarefas', 'calendario', 'grafo', 'canvas', 'cartas', 'lixeira'].includes(id)) state.nav = id;
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
    lixeira: () => showTrash(),
    config: () => {
      state.view = 'settings';
      state.nav = 'config';
      paintCenter();
    },
    versoes: () => showVersions(),
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

const SOFI_SUGGESTIONS = [
  ['Resumir esta nota', true],
  ['Criar flashcards desta nota', true],
  ['Achar notas relacionadas', true],
  ['Organizar minhas tarefas de hoje', false],
  ['O que eu escrevi esta semana?', false],
];

function sofiNoteTitle() {
  if (!state.active) return '';
  const found = (state.notes || []).find((note) => note.path === state.active);
  return found?.title || baseName(state.active).replace(/\.md$/i, '');
}

function sofiStatusText() {
  if (state.sofiKey === false) return ['Sem chave', 'sem-chave'];
  if (state.sofiBusy && state.sofiConfirms?.length) return ['Aguardando você…', 'pensando'];
  if (state.sofiBusy) return [state.sofiPhase || 'Pensando…', 'pensando'];
  if (state.sofiMood === 'erro') return ['Algo deu errado', 'erro'];
  return ['Pronta', 'pronta'];
}

function syncSofiSend() {
  const send = $('#agente-enviar');
  const stop = $('#agente-parar');
  if (stop) stop.hidden = !state.sofiBusy;
  if (send) send.hidden = Boolean(state.sofiBusy);
  if (send) send.disabled = Boolean(state.sofiBusy) || state.sofiKey === false || !($('#agente-pedido')?.value || '').trim();
}

function syncSofiHeader() {
  const label = $('#agente-estado');
  if (!label) return;
  const [text, kind] = sofiStatusText();
  label.textContent = text;
  label.dataset.estado = kind;
  const mascot = $('#sofi-mascote');
  const mood = state.sofiBusy ? 'pensando' : state.sofiMood === 'erro' ? 'erro' : 'ocioso';
  if (mascot && mascot.dataset.estado !== mood) {
    mascot.dataset.estado = mood;
    mountSofi(mascot, mood);
  }
  const fresh = $('#agente-nova');
  if (fresh) fresh.disabled = !state.sofiChat.length || state.sofiBusy;
  syncSofiSend();
  const trigger = $('#abrir-sofi');
  if (trigger) {
    const working = state.sofiBusy && ANIM['agente-trabalhando'];
    trigger.classList.toggle('is-trabalhando', Boolean(state.sofiBusy));
    const first = trigger.firstElementChild;
    if (first && working && !first.classList.contains('anim')) first.outerHTML = anim('agente-trabalhando');
    else if (first && !working && first.classList.contains('anim')) first.outerHTML = icon('faisca');
  }
}

function syncSofiContext() {
  const slot = $('#agente-contexto-slot');
  if (!slot) return;
  const title = sofiNoteTitle();
  if (!title || state.sofiContext === false) {
    slot.innerHTML = '';
    return;
  }
  slot.innerHTML = `<span class="sofi-contexto" id="agente-contexto">${icon('nota')}<span class="sofi-contexto__nome">Nota atual: ${escapeHtml(title)}</span><button type="button" class="sofi-contexto__tirar" id="agente-contexto-tirar" aria-label="Não usar a nota atual como contexto" title="Tirar o contexto">${icon('fechar')}</button></span>`;
  $('#agente-contexto-tirar').onclick = () => {
    state.sofiContext = false;
    syncSofiContext();
  };
}

function sofiMessageHtml(message) {
  if (message.role === 'user') return `<div class="sofi-msg sofi-msg--voce"><p>${escapeHtml(message.text)}</p></div>`;
  const actions = (message.actions || [])
    .map(
      (action, index) =>
        `<div class="sofi-acao${action.ok === false ? ' is-falhou' : ''}"><span class="sofi-acao__selo">${icon(action.ok === false ? 'erro' : 'check')}</span><span class="sofi-acao__texto"><b>${escapeHtml(action.label || 'Ação feita')}</b>${action.error ? `<small>${escapeHtml(action.error)}</small>` : action.detail ? `<small>${escapeHtml(action.detail)}</small>` : ''}</span>${action.versionId && action.ok !== false ? `<button type="button" class="btn btn--fantasma btn--pequeno" data-desfazer="${escapeHtml(action.versionId)}" data-msg="${message.id}" data-acao="${index}">${icon('desfazer')} Desfazer</button>` : ''}</div>`,
    )
    .join('');
  return `<div class="sofi-msg sofi-msg--sofi${message.error ? ' is-erro' : ''}"><p>${escapeHtml(message.text)}</p>${actions}</div>`;
}

function renderSofiMessages() {
  const list = $('#agente-mensagens');
  if (!list) return;
  const chat = state.sofiChat;
  const empty = $('#agente-vazio');
  if (empty) empty.hidden = chat.length > 0 || state.sofiBusy || state.sofiKey === false;
  list.innerHTML =
    chat.map(sofiMessageHtml).join('') +
    (state.sofiBusy
      ? `<div class="sofi-msg sofi-msg--sofi sofi-msg--digitando" role="status" aria-label="A Sofi está escrevendo"><span class="digitando"><i></i><i></i><i></i></span>${state.sofiPhase && state.sofiPhase !== 'Pensando…' ? `<span class="sofi-fase">${escapeHtml(state.sofiPhase)}</span>` : ''}</div>`
      : '') +
    (state.sofiConfirms || [])
      .map(
        (ask) =>
          `<div class="sofi-confirma" role="group" aria-label="Confirmação da Sofi" data-confirma="${escapeHtml(ask.confirmId)}"><span class="sofi-confirma__icone">${icon('cadeado')}</span><div class="sofi-confirma__texto"><b>${escapeHtml(ask.label || 'A Sofi quer fazer uma ação.')}</b><small>Ela só continua se você permitir.</small></div><div class="sofi-confirma__acoes"><button type="button" class="btn btn--secundario btn--pequeno" data-confirma-recusar="${escapeHtml(ask.confirmId)}">Recusar</button><button type="button" class="btn btn--primario btn--pequeno" data-confirma-permitir="${escapeHtml(ask.confirmId)}">Permitir</button></div></div>`,
      )
      .join('');
  list.querySelectorAll('[data-confirma-permitir], [data-confirma-recusar]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.confirmaPermitir || button.dataset.confirmaRecusar;
      answerSofiConfirm(id, Boolean(button.dataset.confirmaPermitir));
    };
  });
  list.querySelectorAll('[data-desfazer]').forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        await tool('agent.undo', { versionId: button.dataset.desfazer });
        await refreshLibrary();
        paintTree();
        if (state.active) await openNote(state.active, { force: true });
        toast('Pronto, desfiz o que a Sofi fez.');
        button.closest('.sofi-acao')?.classList.add('is-desfeita');
        button.remove();
      } catch (error) {
        button.disabled = false;
        toast(`Não deu para desfazer: ${error.message}`, 'erro');
        if (/já foi desfeita/i.test(error.message)) {
          button.closest('.sofi-acao')?.classList.add('is-desfeita');
          button.remove();
        }
      }
    };
  });
  const scroller = $('#agente-rolagem');
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function answerSofiConfirm(confirmId, allow) {
  state.sofiConfirms = (state.sofiConfirms || []).filter((ask) => ask.confirmId !== confirmId);
  syncSofiHeader();
  renderSofiMessages();
  try {
    sophy.agentConfirmReply?.(confirmId, allow);
  } catch {
    /* o turno resolve a recusa sozinho depois do prazo */
  }
}

async function stopSofi() {
  try {
    await sophy.agentCancel?.();
  } catch {
    /* sem turno ativo */
  }
}

let inlineTagsHooked = false;
function hookInlineTagsOnce() {
  if (inlineTagsHooked) return;
  inlineTagsHooked = true;
  hookInlineTags();
}

let sofiHooked = false;
function hookSofiEvents() {
  hookInlineTagsOnce();
  if (sofiHooked) return;
  sofiHooked = true;
  sophy.onAgentProgress?.((event) => {
    if (!state.sofiBusy) return;
    state.sofiPhase = event.phase === 'tool' && event.label ? `${event.label}…`.replace(/…+$/, '…') : event.phase === 'thinking' ? state.sofiPhase || 'Pensando…' : state.sofiPhase;
    syncSofiHeader();
    renderSofiMessages();
  });
  sophy.onAgentConfirm?.((ask) => {
    state.sofiConfirms = [...(state.sofiConfirms || []).filter((item) => item.confirmId !== ask.confirmId), ask];
    if (!state.sofiOpen) openAgent();
    syncSofiHeader();
    renderSofiMessages();
  });
  // a seleção some quando o foco vai para o campo da Sofi, então guardo a última
  document.addEventListener('selectionchange', () => {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const block = selection.anchorNode?.parentElement?.closest?.('.bloco[data-block]');
    if (!block || !state.active) return;
    const text = selection.toString().trim();
    if (!text) return;
    const blocks = [...document.querySelectorAll('.bloco[data-block]')];
    const range = selection.getRangeAt(0);
    const before = blocks.slice(0, blocks.indexOf(block)).reduce((sum, item) => sum + item.textContent.length + 1, 0);
    const lead = document.createRange();
    lead.selectNodeContents(block);
    lead.setEnd(range.startContainer, range.startOffset);
    const from = before + lead.toString().length;
    state.editorSelection = { path: state.active, text, from, to: from + selection.toString().length };
  });
}

async function sendSofi(raw) {
  const text = String(raw || '').trim();
  if (!text || state.sofiBusy || state.sofiKey === false) return;
  const input = $('#agente-pedido');
  if (input) {
    input.value = '';
    input.style.height = '';
  }
  state.sofiDraft = '';
  state.sofiChat.push({ role: 'user', text });
  state.sofiBusy = true;
  state.sofiMood = 'ocioso';
  syncSofiHeader();
  renderSofiMessages();
  const context = {};
  if (state.active && state.sofiContext !== false) {
    context.notePath = state.active;
    if (state.editorSelection?.path === state.active && state.editorSelection.text) {
      const { text: picked, from, to } = state.editorSelection;
      context.selection = { text: picked, from, to };
    }
  }
  state.sofiConfirms = [];
  state.sofiPhase = '';
  let response;
  try {
    response = await sophy.agentAsk(text, context);
  } catch (error) {
    response = { ok: false, error: error.message };
  }
  state.sofiBusy = false;
  state.sofiConfirms = [];
  state.sofiPhase = '';
  const canceled = Boolean(response.ok && response.value?.canceled);
  if (!response.ok && response.code === 'sem_chave') {
    state.sofiKey = false;
    state.sofiMood = 'ocioso';
    const host = $('.sofi-chat')?.parentElement;
    if (host) paintSofi(host, true);
    return;
  }
  state.sofiMood = response.ok ? 'pronta' : 'erro';
  state.sofiChat.push(
    response.ok
      ? { role: 'sofi', id: Date.now(), text: canceled ? 'Pedido cancelado.' : response.value.text || 'Pronto.', actions: response.value.actions || [] }
      : { role: 'sofi', id: Date.now(), error: true, text: `Não consegui responder: ${response.error || 'tente de novo em instantes.'}` },
  );
  if (response.ok) {
    await refreshLibrary();
    paintTree();
  }
  syncSofiHeader();
  renderSofiMessages();
  $('#agente-pedido')?.focus();
  if (!state.sofiOpen && !canceled)
    pushNotification({
      type: 'sofi',
      title: response.ok ? 'A Sofi terminou' : 'A Sofi não conseguiu responder',
      body: response.ok ? String(response.value.text || 'Pedido concluído.').slice(0, 120) : String(response.error || 'Tente de novo em instantes.'),
      action: { label: 'Abrir a Sofi', kind: 'sofi' },
    });
}

function newSofiChat() {
  if (state.sofiBusy) return;
  state.sofiChat = [];
  state.sofiMood = 'ocioso';
  state.sofiContext = true;
  syncSofiHeader();
  syncSofiContext();
  renderSofiMessages();
  $('#agente-pedido')?.focus();
}

function openSofiSettings() {
  if (drawerNarrow()) closeSofi();
  state.configSection = 'sofi';
  runCommand('config');
}

function paintSofi(host, force = false) {
  hookSofiEvents();
  host.classList.remove('is-oculta');
  const theme = themeName() === 'dark' ? 'escuro' : 'claro';
  state.sofiChat ||= [];
  if (!force && host.querySelector('.sofi-chat') && host.dataset.tema === theme) {
    syncSofiContext();
    syncSofiHeader();
    return;
  }
  host.dataset.tema = theme;
  const noKey = state.sofiKey === false;
  const suggestions = SOFI_SUGGESTIONS.filter(([, needsNote]) => !needsNote || state.active)
    .map(([label]) => `<button type="button" class="sofi-sugestao" data-sugestao="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
    .join('');
  host.innerHTML = `<div class="agente agente--lateral sofi-chat" role="dialog" aria-label="Sofi">
    <header class="sofi-chat__topo">
      <div class="sofi-mascote" id="sofi-mascote" data-estado="ocioso" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div>
      <div class="sofi-chat__titulo"><h3>Sofi</h3><span class="sofi-chat__estado" id="agente-estado" role="status" data-estado="pronta">Pronta</span></div>
      <button type="button" class="btn btn--icone" id="agente-nova" aria-label="Nova conversa" title="Nova conversa">${icon('novo')}</button>
      <button type="button" class="btn btn--icone" id="agente-fechar" aria-label="Fechar a Sofi" title="Fechar">${icon('fechar')}</button>
    </header>
    <div class="sofi-chat__rolagem" id="agente-rolagem">
      ${noKey ? `<div class="sofi-conectar"><div class="sofi-mascote sofi-mascote--grande" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div><h4>Conectar a Sofi</h4><p>Para conversar, falta uma chave de acesso. Ela fica guardada no cofre do sistema, nunca dentro da biblioteca.</p><button type="button" class="btn btn--primario" id="agente-conectar">Abrir configurações</button></div>` : ''}
      <div class="sofi-vazio" id="agente-vazio" ${noKey || state.sofiChat.length ? 'hidden' : ''}>
        <div class="sofi-mascote sofi-mascote--grande" id="sofi-mascote-vazio" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div>
        <h4>Oi! Como posso ajudar hoje?</h4>
        <p>Escolha uma sugestão ou escreva abaixo.</p>
        <div class="sofi-sugestoes">${suggestions}</div>
        <p class="sofi-ajuda">Leio só esta biblioteca, uso as mesmas ferramentas que você e gravo um ponto antes de mudar qualquer coisa.</p>
      </div>
      <div class="sofi-mensagens" id="agente-mensagens" aria-live="polite"></div>
    </div>
    <form class="sofi-chat__rodape" id="agente-form">
      <div id="agente-contexto-slot"></div>
      <div class="sofi-campo">
        <textarea id="agente-pedido" rows="1" aria-label="Mensagem para a Sofi" placeholder="${noKey ? 'Conecte a Sofi para escrever…' : 'Pergunte ou peça algo à Sofi…'}" ${noKey ? 'disabled' : ''}></textarea>
        <button type="submit" class="btn btn--primario btn--icone sofi-campo__enviar" id="agente-enviar" aria-label="Enviar" title="Enviar (Enter)">${icon('enviar')}</button>
        <button type="button" class="btn btn--secundario sofi-campo__parar" id="agente-parar" aria-label="Parar" title="Parar o pedido" hidden>${icon('fechar')} Parar</button>
      </div>
      <p class="sofi-chat__dica">Enter envia · Shift+Enter quebra a linha</p>
    </form>
  </div>`;
  const input = $('#agente-pedido');
  input.value = state.sofiDraft || '';
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  grow();
  input.oninput = () => {
    state.sofiDraft = input.value;
    grow();
    syncSofiSend();
  };
  input.onkeydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendSofi(input.value);
    }
  };
  $('#agente-form').onsubmit = (event) => {
    event.preventDefault();
    sendSofi(input.value);
  };
  host.querySelectorAll('[data-sugestao]').forEach((button) => {
    button.onclick = () => sendSofi(button.dataset.sugestao);
  });
  $('#agente-parar').onclick = () => stopSofi();
  $('#agente-nova').onclick = () => newSofiChat();
  $('#agente-fechar').onclick = () => closeSofi();
  const connect = $('#agente-conectar');
  if (connect) connect.onclick = () => openSofiSettings();
  const mascot = $('#sofi-mascote');
  mountSofi(mascot, 'ocioso');
  const big = $('#sofi-mascote-vazio');
  if (big) mountSofi(big, 'ocioso');
  syncSofiContext();
  syncSofiHeader();
  renderSofiMessages();
  if (state.sofiKey === undefined) {
    sophy
      .agentStatus?.()
      .then((status) => {
        const value = status?.value ?? status;
        state.sofiKey = Boolean(value?.saved);
        if (state.sofiKey === false && $('#conexoes .sofi-chat, #sofi-gaveta .sofi-chat')) {
          const current = $('.sofi-chat')?.parentElement;
          if (current) paintSofi(current, true);
        }
      })
      .catch(() => {
        state.sofiKey = true;
      });
  }
}

/* A chave pode mudar em Configurações: o painel precisa saber na hora. */
async function refreshSofiKey() {
  try {
    const status = await sophy.agentStatus?.();
    const value = status?.value ?? status;
    const next = Boolean(value?.saved);
    if (next !== state.sofiKey) {
      state.sofiKey = next;
      const current = $('.sofi-chat')?.parentElement;
      if (current) paintSofi(current, true);
    }
  } catch {
    /* mantém o último estado conhecido */
  }
}

function closeSofi() {
  state.sofiOpen = false;
  $('#sofi-gaveta')?.classList.remove('is-aberta');
  if (!$('#lateral')?.classList.contains('is-aberta')) $('#gaveta-veu')?.remove();
  $('#abrir-sofi')?.setAttribute('aria-pressed', 'false');
  paintLinks();
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
    $('#abrir-sofi')?.setAttribute('aria-pressed', 'true');
    paintSofi(panel);
    refreshSofiKey();
    panel.classList.add('is-aberta');
    ensureVeil();
    state.drawerOpener = $('#abrir-lateral');
    return;
  }
  $('#sofi-gaveta')?.classList.remove('is-aberta');
  state.sofiOpen = true;
  $('#abrir-sofi')?.setAttribute('aria-pressed', 'true');
  state.connectionsOpen = true;
  paintSofi($('#conexoes'));
  refreshSofiKey();
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

function closeDialog() {
  const overlay = $('#overlay');
  overlay.hidden = true;
  overlay.innerHTML = '';
  overlay.onkeydown = null;
}

function confirmDialog(message, { confirm = 'Confirmar', danger = false } = {}) {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante dialogo" role="alertdialog" aria-modal="true" aria-labelledby="confirma-texto"><p id="confirma-texto" class="dialogo__texto">${escapeHtml(message)}</p><div class="dialogo__acoes"><button type="button" class="btn btn--fantasma" id="confirma-nao">Cancelar</button><button type="button" class="btn ${danger ? 'btn--perigo' : 'btn--primario'}" id="confirma-sim">${escapeHtml(confirm)}</button></div></div>`;
  return new Promise((resolve) => {
    const done = (value) => {
      closeDialog();
      resolve(value);
    };
    $('#confirma-sim').onclick = () => done(true);
    $('#confirma-nao').onclick = () => done(false);
    overlay.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        done(false);
      }
    };
    $('#confirma-sim').focus();
  });
}

function textDialog({ title, label, placeholder = '', value = '', confirm = 'Criar' }) {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<form class="menu menu-flutuante dialogo" role="dialog" aria-modal="true" aria-labelledby="dialogo-titulo" id="dialogo-texto"><h3 id="dialogo-titulo" class="dialogo__titulo">${escapeHtml(title)}</h3><label class="dialogo__campo"><span>${escapeHtml(label)}</span><input id="dialogo-valor" type="text" autocomplete="off" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" /></label><div class="dialogo__acoes"><button type="button" class="btn btn--fantasma" id="dialogo-cancelar">Cancelar</button><button type="submit" class="btn btn--primario" id="dialogo-ok">${escapeHtml(confirm)}</button></div></form>`;
  return new Promise((resolve) => {
    const done = (result) => {
      closeDialog();
      resolve(result);
    };
    const input = $('#dialogo-valor');
    $('#dialogo-texto').onsubmit = (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
      done(text);
    };
    $('#dialogo-cancelar').onclick = () => done(null);
    overlay.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        done(null);
      }
    };
    input.focus();
    input.select();
  });
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
      if (exportDone(saved)) {
        toast('PDF em papel claro.');
        pushNotification({ type: 'exportacao', title: 'PDF exportado', body: `“${title}” foi salvo em papel claro.` });
      }
      return;
    }
    const folder = await pickedFolder();
    if (!folder) return;
    const theme = themeName() === 'dark' ? 'dark' : 'light';
    try {
      const result = await tool('site.export', { destination: folder, theme });
      toast(`Site com ${result.pages} página(s), no tema ${theme}.`);
      pushNotification({ type: 'exportacao', title: 'Site exportado', body: `${result.pages} página(s), no tema ${theme}.`, action: { label: 'Mostrar na pasta', kind: 'reveal', arg: folder } });
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
    <button type="button" class="menu__item" role="menuitem" data-acao="lixeira">${icon('lixeira')} Lixeira</button>
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
  menu.querySelector('[data-acao="lixeira"]').onclick = () => {
    closeMenus();
    runCommand('lixeira');
  };
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
          ['nota', 'Nova nota aqui'],
          ['cor', 'Cor e ícone…'],
          ['renomear', 'Renomear'],
          ['lixo', 'Excluir…'],
        ]
      : kind === 'canvas'
        ? [['lixo', 'Excluir…']]
        : [
            ['renomear', 'Renomear'],
            ['lixo', 'Excluir…'],
          ].filter(([id]) => !(id === 'renomear' && dailyPathDate(target)));
  menu.innerHTML = items
    .map(([id, label]) => `<button type="button" class="menu__item" role="menuitem" data-arvore="${id}">${label}</button>`)
    .join('');
  document.body.append(menu);
  menu.style.position = 'fixed';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  const rename = menu.querySelector('[data-arvore="renomear"]');
  if (rename)
    rename.onclick = () => {
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
  menu.querySelector('[data-arvore="lixo"]').onclick = async () => {
    closeMenus();
    try {
      const overlay = $('#overlay');
      const label =
        kind === 'shelf'
          ? target
          : baseName(target);
      const detail =
        kind === 'shelf'
          ? `Excluir a estante ${escapeHtml(label)}, com ${state.notes.filter((item) => item.workspace === target || item.path.startsWith(`${target}/`)).length} nota(s)? Os arquivos vão para a lixeira.`
          : `Excluir ${escapeHtml(label)}? O arquivo vai para a lixeira.`;
      overlay.hidden = false;
      overlay.innerHTML = `<div class="menu menu-flutuante" role="dialog" aria-label="Excluir"><p>${detail}</p><button type="button" id="confirma-sim">Excluir</button><button type="button" id="confirma-nao">Cancelar</button></div>`;
      const ok = await new Promise((resolve) => {
        $('#confirma-nao').onclick = () => {
          overlay.hidden = true;
          resolve(false);
        };
        $('#confirma-sim').onclick = () => {
          overlay.hidden = true;
          resolve(true);
        };
      });
      if (!ok) return;
      if (
        state.active === target ||
        (kind === 'shelf' && state.active?.startsWith(`${target}/`)) ||
        (kind === 'canvas' && state.canvasPath === target)
      )
        if (!(await flushNote())) return;
      const trashed = await tool('entry.trash', { path: target });
      if (kind === 'shelf') {
        state.collapsedShelves.delete(target);
        delete state.treeOrder[target];
      } else removeFromTreeOrder(target);
      saveTreeUi();
      const prefix = kind === 'shelf' ? `${target}/` : target;
      state.tabs = state.tabs.filter((tab) => tab !== target && !tab.startsWith(prefix));
      if (state.active === target || (kind === 'shelf' && state.active?.startsWith(prefix))) {
        state.active = null;
        state.doc = null;
        state.view = 'home';
        state.nav = 'inicio';
      }
      if (kind === 'canvas' && state.canvasPath === target) {
        state.canvasPath = null;
        state.canvasDoc = null;
        state.view = 'home';
        state.nav = 'inicio';
      }
      await refreshLibrary();
      paintTree();
      paintTabs();
      paintCenter();
      toastTrashed('Movido para a lixeira.', trashed?.id);
    } catch (error) {
      toast(error.message, 'erro');
    }
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
  if (['# ', '- ', '- [ ] ', '> '].includes(prefix) || prefix === '```\n') {
    checkpoint(true);
    const text = Doc.visibleOf(state.doc.blocks[index]);
    const raw = prefix === '```\n' ? Doc.codeRaw('```', '', text) : `${prefix}${text}\n`;
    state.doc = Doc.replaceBlock(state.doc, index, raw);
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
    ['Riscado', 'tachado', '~~', '~~'],
    ['Código', 'codigo', '`', '`'],
    ['Link', 'link', '[', '](https://)'],
  ]
    .map(
      ([label, glyph, prefix, suffix]) =>
        `<button type="button" class="btn btn--icone" data-prefix="${escapeHtml(prefix)}" data-suffix="${escapeHtml(suffix)}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`,
    )
    .join('') +
    `<span class="barra-formato__sep" aria-hidden="true"></span><button type="button" class="btn barra-formato__a" data-cor aria-label="Cor e fundo" title="Cor do texto e fundo"><span class="barra-formato__letra" aria-hidden="true">A</span><span class="barra-formato__cores-mini" aria-hidden="true"><i class="marca-cor--vermelho"></i><i class="marca-cor--azul"></i><i class="marca-cor--verde"></i></span>${icon('chevron-baixo')}</button>` +
    `<button type="button" class="btn btn--icone" data-transformar aria-label="Transformar em" title="Transformar em">${icon('mais')}</button>`;
  document.body.append(bar);
  const rect = range.getBoundingClientRect();
  bar.style.left = `${Math.max(8, rect.left)}px`;
  bar.style.top = `${Math.max(8, rect.top - 44)}px`;
  bar.querySelectorAll('[data-prefix]').forEach((button) => {
    button.onmousedown = (event) => {
      event.preventDefault();
      applyWrap(index, selected, button.dataset.prefix, button.dataset.suffix);
      bar.remove();
    };
  });
  bar.querySelector('[data-cor]').onmousedown = (event) => {
    event.preventDefault();
    openColorPalette(bar, index, selected);
  };
  bar.querySelector('[data-transformar]').onmousedown = (event) => {
    event.preventDefault();
    openTransformMenu(bar, index, selected);
  };
}

function openColorPalette(anchor, index, selected) {
  document.querySelector('.barra-formato__paleta')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante barra-formato__paleta';
  menu.innerHTML = `<p class="menu__grupo">Texto</p><div class="barra-formato__cores" data-kind="cor">${Rich.COLORS.map((color) => `<button type="button" class="barra-formato__swatch marca-cor--${color}" data-value="${color}" aria-label="${color}" title="${color}"></button>`).join('')}<button type="button" class="menu__item" data-value="">Sem cor</button></div><p class="menu__grupo">Fundo</p><div class="barra-formato__cores" data-kind="fundo">${Rich.COLORS.map((color) => `<button type="button" class="barra-formato__swatch marca-fundo--${color}" data-value="${color}" aria-label="${color}" title="${color}"></button>`).join('')}<button type="button" class="menu__item" data-value="">Sem fundo</button></div>`;
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.querySelectorAll('[data-kind]').forEach((group) => {
    group.querySelectorAll('[data-value]').forEach((button) => {
      button.onmousedown = (event) => {
        event.preventDefault();
        applyColor(index, selected, group.dataset.kind, button.dataset.value || null);
        menu.remove();
        document.querySelector('.barra-formato')?.remove();
      };
    });
  });
}

function syncSpanClasses(span) {
  const cor = span.getAttribute('data-cor');
  const fundo = span.getAttribute('data-fundo');
  span.className = ['marca-cor', cor ? `marca-cor--${cor}` : '', fundo ? `marca-fundo--${fundo}` : '']
    .filter(Boolean)
    .join(' ');
}

function applyColor(index, selected, kind, value) {
  const el = document.querySelector(`[data-block="${index}"][contenteditable="true"]`);
  const selection = getSelection();
  if (!el || !selection?.rangeCount || !selected) return;
  checkpoint(true);
  const range = selection.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return;
  const ancestor =
    (range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement
    )?.closest?.('span[data-cor], span[data-fundo]');
  state.richApplying = true;
  try {
    if (ancestor && el.contains(ancestor)) {
      if (kind === 'cor') {
        if (value) ancestor.setAttribute('data-cor', value);
        else ancestor.removeAttribute('data-cor');
      } else if (value) ancestor.setAttribute('data-fundo', value);
      else ancestor.removeAttribute('data-fundo');
      if (!ancestor.getAttribute('data-cor') && !ancestor.getAttribute('data-fundo')) {
        const parent = ancestor.parentNode;
        while (ancestor.firstChild) parent.insertBefore(ancestor.firstChild, ancestor);
        ancestor.remove();
      } else syncSpanClasses(ancestor);
    } else if (value) {
      const wrapper = document.createElement('span');
      if (kind === 'cor') wrapper.setAttribute('data-cor', value);
      else wrapper.setAttribute('data-fundo', value);
      syncSpanClasses(wrapper);
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
    }
  } finally {
    state.richApplying = false;
  }
  state.doc = Doc.withBlockRaw(state.doc, index, Rich.sanitize(rawFromEditor(el, state.doc.blocks[index])));
  paintCenter();
  scheduleSave();
}

function openTransformMenu(anchor, index, selected) {
  document.querySelector('.barra-formato__transformar')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu menu-flutuante barra-formato__transformar';
  const options = [
    ['Título', '# '],
    ['Lista', '- '],
    ['Citação', '> '],
    ['Código', '```\n'],
  ];
  menu.innerHTML = options
    .map(([label, prefix]) => `<button type="button" class="menu__item" data-prefix="${escapeHtml(prefix)}">${escapeHtml(label)}</button>`)
    .join('');
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.querySelectorAll('[data-prefix]').forEach((button) => {
    button.onmousedown = (event) => {
      event.preventDefault();
      applyWrap(index, selected, button.dataset.prefix, button.dataset.prefix === '```\n' ? '\n```' : '');
      menu.remove();
      document.querySelector('.barra-formato')?.remove();
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
  state.graphView?.dispose();
  state.graphView = null;
  const request = ++state.graphPaintSeq;
  let graph;
  try {
    graph = await tool('graph.query', {});
  } catch (error) {
    if (request === state.graphPaintSeq)
      center.innerHTML = `<div class="vazio-ensina">${ilustracao('grafo-vazio')}<h2>Não deu para montar o grafo</h2><p>${escapeHtml(error.message || 'Tente abrir esta tela de novo.')} Suas notas não foram alteradas.</p></div>`;
    return;
  }
  if (request !== state.graphPaintSeq || state.view !== 'graph') return;
  const shelves = state.workspaces.map((item) => item.name);
  const tags = [...new Set((graph?.nodes || []).flatMap((node) => node.tags || []))].sort((a, b) =>
    a.localeCompare(b),
  );
  const legend = state.workspaces
    .map((item) => {
      const mark = markFor(item.name);
      const color = mark.color ? `var(--shelf-${mark.color})` : 'var(--ink-3)';
      return `<span class="grafo__legenda-item"><i style="--grafo-cor:${color}"></i>${escapeHtml(item.name)}</span>`;
    })
    .join('');
  center.innerHTML = `<div class="grafo">
    <div class="grafo__barra">
      <div class="segmentado grafo__modo" role="group" aria-label="Escopo do grafo"><button type="button" class="is-escolhida" data-graph-mode="global">${icon('globo')} Global</button><button type="button" data-graph-mode="local">${icon('foco-no')} Local</button></div>
      <label class="grafo__busca">${icon('busca')}<input id="grafo-busca" type="search" placeholder="Nota, tag ou #tag" aria-label="Buscar nota ou tag" /><kbd>/</kbd></label>
      <label class="grafo__filtro"><span>Estante</span><select id="grafo-estante"><option value="">Todas</option>${shelves.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></label>
      <label class="grafo__filtro"><span>Tag</span><select id="grafo-tag"><option value="">Todas</option>${tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('')}</select></label>
      <label class="grafo__filtro"><span>Cor</span><select id="grafo-cor" aria-label="Cor das notas"><option value="estante">Estante</option><option value="tag">Tag</option></select></label>
      <button type="button" class="btn btn--secundario" id="grafo-forcas-toggle" aria-expanded="false">${icon('configuracoes')} Forças</button>
    </div>
    <div class="grafo__chips" id="grafo-chips" hidden></div>
    <div class="grafo__palco">
      <canvas id="grafo-canvas" tabindex="0" role="application" aria-label="Grafo de notas. Use as setas para navegar e Enter para abrir uma nota."></canvas>
      <div class="grafo__legenda">${legend}<span id="grafo-contagem">${anim('carregando')}Carregando…</span></div>
      <div class="grafo__cartao" id="grafo-cartao" hidden></div>
      <aside class="grafo__forcas" id="grafo-forcas" hidden aria-label="Controles de forças">
        <header><strong>${icon('foco-no')} Forças</strong><button type="button" class="btn btn--icone" id="grafo-forcas-fechar" aria-label="Fechar">${icon('fechar')}</button></header>
        <label><span>Distância</span><output>90</output><input type="range" min="35" max="220" value="90" data-force="distance" /></label>
        <label><span>Repulsão</span><output>500</output><input type="range" min="80" max="1400" value="500" data-force="repulsion" /></label>
        <label><span>Força dos links</span><output>18</output><input type="range" min="2" max="80" value="18" data-force="linkForce" /></label>
        <label><span>Centro</span><output>6</output><input type="range" min="0" max="30" value="6" data-force="center" /></label>
        <label><span>Ímã da estante</span><output>0</output><input type="range" min="0" max="30" value="0" data-force="shelfAttraction" /></label>
        <label class="grafo__alternar"><input type="checkbox" id="grafo-rotulos" checked /> Mostrar rótulos</label>
        <label class="grafo__alternar"><input type="checkbox" id="grafo-orfas" checked /> Mostrar órfãs</label>
        <label class="grafo__alternar"><input type="checkbox" id="grafo-simulacao" ${matchMedia('(prefers-reduced-motion: reduce)').matches ? '' : 'checked'} /> Simulação ativa</label>
        <button type="button" class="btn btn--secundario" id="grafo-forcas-restaurar">${icon('voltar')} Restaurar forças</button>
        <p id="grafo-status" aria-live="polite">${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Pausado' : 'Organizando…'}</p>
      </aside>
      <div class="grafo__minimapa"><canvas id="grafo-minimapa" aria-label="Minimapa do grafo"></canvas></div>
      <div class="grafo__zoom">
        <button type="button" class="btn btn--icone" id="grafo-mais" aria-label="Aproximar">${icon('zoom-mais')}</button>
        <span id="grafo-zoom-valor">100%</span>
        <button type="button" class="btn btn--icone" id="grafo-menos" aria-label="Afastar">${icon('zoom-menos')}</button>
        <button type="button" class="btn btn--icone" id="grafo-ajustar" aria-label="Ajustar à rede">${icon('ajustar')}</button>
      </div>
      <div class="grafo__local" id="grafo-local" hidden>${icon('foco-no')}<span id="grafo-foco"></span><label>Profundidade <select id="grafo-profundidade"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label></div>
    </div>
    <div class="grafo__rodape"><label class="grafo__tempo">${icon('calendario')}<span>Linha do tempo</span><input id="grafo-tempo" type="range" min="0" max="100" value="${Math.round((state.graphUntil ?? 1) * 100)}" aria-label="Mostrar notas criadas até a data" /><output id="grafo-tempo-data">hoje</output></label><div class="grafo__quadros" id="grafo-quadros" aria-hidden="true"></div><span>Layout de força · <span id="grafo-status-rodape">${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'pausado' : 'estabilizando'}</span> · Ctrl mostra a nota</span></div>
  </div>`;

  const readLayout = () => {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(`sophy-graph:${state.libraryPath || 'default'}`) || '{}',
      );
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  const savedLayout = readLayout();
  if (state.view !== 'graph' || !$('#grafo-canvas')) return;
  const styles = getComputedStyle(document.documentElement);
  const tagPalette = ['#6d64d8', '#c45b45', '#2f8f72', '#c4922a', '#3a78b4', '#b15486', '#6a8a32', '#8a623c'];
  const tagColor = (tag) => {
    let hash = 0;
    const text = String(tag || '');
    for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
    return tagPalette[hash % tagPalette.length];
  };
  let colorMode = savedLayout.colorMode === 'tag' ? 'tag' : 'estante';
  const shelfColor = (workspace) => {
    const mark = markFor(workspace || '');
    return mark.color
      ? styles.getPropertyValue(`--shelf-${mark.color}`).trim()
      : styles.getPropertyValue('--ink-3').trim();
  };
  const colorOf = (node) => {
    if (colorMode === 'tag') {
      const tag = node?.tags?.[0];
      if (tag) return tagColor(tag);
    }
    return shelfColor(node?.workspace || '');
  };
  state.graphView = SophyGraphView.create({
    canvas: $('#grafo-canvas'),
    minimap: $('#grafo-minimapa'),
    graph,
    activePath: state.active,
    saved: savedLayout,
    libraryKey: state.libraryPath || state.libraryName,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    colorOf,
    escape: escapeHtml,
    icon,
    tagColor,
    onSelect: (path) => {
      const node = graph.nodes.find((item) => item.path === path);
      if (node) {
        const focus = $('#grafo-foco');
        if (focus) focus.textContent = node.title || baseName(path);
      }
    },
    onActivate: (path) => focusGraphNote(path),
  });
  if (!state.graphView.supportsWorker) {
    $('#grafo-status').textContent = 'Layout estático';
    $('#grafo-status-rodape').textContent = 'estático';
    document.querySelectorAll('[data-force], #grafo-simulacao, #grafo-forcas-restaurar').forEach((input) => { input.disabled = true; });
    $('#grafo-simulacao').checked = false;
  }
  // Linha do tempo: mostra só as notas criadas até a data escolhida (createdAt, como o `to` de graph.query).
  // O filtro roda aqui, sobre a mesma consulta, para o desenho não se refazer a cada passo do controle.
  const createdTime = (node) => {
    const created = Date.parse(node.createdAt);
    return Number.isNaN(created) ? node.modifiedAt || 0 : created;
  };
  const times = (graph?.nodes || []).map(createdTime).filter(Boolean).sort((a, b) => a - b);
  const timeLabel = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  const frames = $('#grafo-quadros');
  if (frames && times.length) frames.innerHTML = `<span>${escapeHtml(timeLabel(times[0]))}</span><span>${escapeHtml(timeLabel(times[times.length - 1]))}</span>`;
  const timeline = $('#grafo-tempo');
  const applyTime = () => {
    const ratio = Number(timeline.value) / 100;
    state.graphUntil = ratio;
    const cutoff = ratio >= 1 || !times.length ? 0 : times[0] + (times[times.length - 1] - times[0]) * ratio;
    $('#grafo-tempo-data').textContent = cutoff ? timeLabel(cutoff) : 'hoje';
    state.graphView?.setUntil(cutoff);
  };
  if (timeline) {
    timeline.disabled = times.length < 2;
    timeline.oninput = applyTime;
    applyTime();
  }

  const applyFilters = () => {
    const rawQuery = ($('#grafo-busca')?.value || '').trim();
    const fold = (value) =>
      String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase();
    const query = fold(rawQuery);
    const tagSearch = query.startsWith('#')
      ? query.slice(1).trim()
      : query.startsWith('tag:')
        ? query.slice(4).trim()
        : '';
    const workspace = $('#grafo-estante')?.value || '';
    const tag = $('#grafo-tag')?.value || '';
    const filtered = {
      nodes: graph.nodes.filter((node) => {
        const tags = (node.tags || []).map(fold);
        const queryOk =
          !query ||
          (tagSearch
            ? tags.some((item) => item.includes(tagSearch))
            : fold(`${node.title} ${node.path} ${tags.join(' ')}`).includes(query));
        return (
          (!workspace || node.workspace === workspace) &&
          (!tag || (node.tags || []).includes(tag)) &&
          queryOk
        );
      }),
      edges: [],
    };
    const paths = new Set(filtered.nodes.map((node) => node.path));
    filtered.edges = graph.edges.filter((edge) => paths.has(edge.from) && paths.has(edge.to));
    state.graphView?.setGraph(filtered);
    let empty = $('#grafo-vazio');
    if (!filtered.nodes.length) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'grafo-vazio';
        empty.className = 'grafo__vazio';
        empty.innerHTML =
          `<div>${ilustracao('grafo-vazio', 150)}<strong>Nenhuma nota com esses filtros</strong><p>Remova um filtro para ver mais conexões.</p></div>`;
        $('.grafo__palco')?.append(empty);
      }
    } else empty?.remove();
    const chips = [];
    if (workspace)
      chips.push([
        'Estante',
        workspace,
        () => {
          $('#grafo-estante').value = '';
          applyFilters();
        },
      ]);
    if (tag)
      chips.push([
        'Tag',
        tag,
        () => {
          $('#grafo-tag').value = '';
          applyFilters();
        },
      ]);
    if (query)
      chips.push([
        tagSearch ? 'Tag' : 'Busca',
        tagSearch || rawQuery,
        () => {
          $('#grafo-busca').value = '';
          applyFilters();
        },
      ]);
    if ($('#grafo-orfas')?.checked === false)
      chips.push([
        'Órfãs',
        'Ocultas',
        () => {
          $('#grafo-orfas').checked = true;
          state.graphView?.setShowOrphans(true);
          applyFilters();
        },
      ]);
    const host = $('#grafo-chips');
    if (host) {
      host.hidden = !chips.length;
      host.innerHTML =
        chips
          .map(
            ([label, value], index) =>
              `<button type="button" data-chip="${index}">${escapeHtml(label)}: ${escapeHtml(value)} ${icon('fechar')}</button>`,
          )
          .join('') +
        (chips.length ? '<button type="button" data-clear-graph>Limpar filtros</button>' : '');
      host.querySelectorAll('[data-chip]').forEach((button) => {
        button.onclick = chips[Number(button.dataset.chip)][2];
      });
      host.querySelector('[data-clear-graph]')?.addEventListener('click', () => {
        $('#grafo-estante').value = '';
        $('#grafo-tag').value = '';
        $('#grafo-busca').value = '';
        $('#grafo-orfas').checked = true;
        state.graphView?.setShowOrphans(true);
        applyFilters();
      });
    }
    const legendHost = document.querySelector('.grafo__legenda');
    const legendCount = legendHost?.querySelector('#grafo-contagem');
    if (legendHost && legendCount) {
      const items =
        colorMode === 'tag'
          ? [...new Set(filtered.nodes.flatMap((node) => node.tags || []))]
              .slice(0, 8)
              .map(
                (name) =>
                  `<span class="grafo__legenda-item"><i style="--grafo-cor:${tagColor(name)}"></i>${escapeHtml(name)}</span>`,
              )
              .join('')
          : legend;
      legendHost.innerHTML = `${items}<span id="grafo-contagem">${legendCount.textContent}</span>`;
    }
    const count = $('#grafo-contagem');
    if (count)
      count.textContent = `${filtered.nodes.length} ${filtered.nodes.length === 1 ? 'nota' : 'notas'} · ${filtered.edges.length} ${filtered.edges.length === 1 ? 'link' : 'links'}`;
  };
  $('#grafo-estante').value = state.graphWorkspace || '';
  $('#grafo-estante').onchange = (event) => {
    state.graphWorkspace = event.target.value;
    applyFilters();
  };
  $('#grafo-tag').onchange = applyFilters;
  const colorSelect = $('#grafo-cor');
  if (colorSelect) {
    colorSelect.value = colorMode;
    colorSelect.onchange = (event) => {
      colorMode = event.target.value === 'tag' ? 'tag' : 'estante';
      try {
        const key = `sophy-graph:${state.libraryPath || state.libraryName || 'default'}`;
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        stored.colorMode = colorMode;
        localStorage.setItem(key, JSON.stringify(stored));
      } catch {}
      applyFilters();
    };
  }
  $('#grafo-busca').oninput = applyFilters;
  $('#grafo-busca').onkeydown = (event) => {
    if (event.key === 'Enter') {
      const result = state.graphView?.graph.nodes[0];
      if (result) {
        state.graphView?.focus(result.path);
        $('#grafo-canvas').focus();
      }
    }
  };
  document.querySelectorAll('[data-graph-mode]').forEach((button) => {
    button.onclick = () => {
      document
        .querySelectorAll('[data-graph-mode]')
        .forEach((item) => item.classList.toggle('is-escolhida', item === button));
      const local = button.dataset.graphMode === 'local';
      const localPanel = $('#grafo-local');
      if (localPanel) localPanel.hidden = !local;
      state.graphView?.setMode(local ? 'local' : 'global');
      if (local) {
        const centerPath = state.active || graph.nodes[0]?.path;
        if (centerPath) {
          state.graphView?.setSelected(centerPath);
          $('#grafo-foco').textContent = baseName(centerPath);
        }
      }
    };
  });
  $('#grafo-profundidade').onchange = (event) =>
    state.graphView?.setDepth(Number(event.target.value));
  $('#grafo-forcas-toggle').onclick = () => {
    const panel = $('#grafo-forcas');
    panel.hidden = !panel.hidden;
    $('#grafo-forcas-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  };
  $('#grafo-forcas-fechar').onclick = () => {
    $('#grafo-forcas').hidden = true;
    $('#grafo-forcas-toggle').setAttribute('aria-expanded', 'false');
  };
  $('#grafo-forcas-restaurar').onclick = () => {
    const defaults = { distance: 90, repulsion: 500, linkForce: 0.018, center: 0.006, shelfAttraction: 0 };
    document.querySelectorAll('[data-force]').forEach((input) => {
      const value = defaults[input.dataset.force];
      input.value = String(['linkForce', 'center', 'shelfAttraction'].includes(input.dataset.force) ? value * 1000 : value);
      input.parentElement.querySelector('output').value = input.value;
    });
    state.graphView?.resetOptions(defaults);
  };
  document.querySelectorAll('[data-force]').forEach((input) => {
    const key = input.dataset.force;
    const savedValue = Number(savedLayout.options?.[key]);
    if (Number.isFinite(savedValue))
      input.value = String(
        key === 'linkForce' || key === 'center' || key === 'shelfAttraction'
          ? savedValue * 1000
          : savedValue,
      );
    input.parentElement.querySelector('output').value = input.value;
    input.oninput = () => {
      const val = Number(input.value);
      const output = input.parentElement.querySelector('output');
      output.value = String(val);
      state.graphView?.setOption(
        key,
        ['linkForce', 'center', 'shelfAttraction'].includes(key) ? val / 1000 : val,
      );
    };
  });
  $('#grafo-rotulos').checked = savedLayout.showLabels !== false;
  $('#grafo-orfas').checked = savedLayout.showOrphans !== false;
  $('#grafo-rotulos').onchange = (event) => state.graphView?.setShowLabels(event.target.checked);
  $('#grafo-orfas').onchange = (event) => {
    state.graphView?.setShowOrphans(event.target.checked);
    applyFilters();
  };
  $('#grafo-simulacao').onchange = (event) =>
    state.graphView?.setForcesRunning(event.target.checked);
  $('#grafo-mais').onclick = () => state.graphView?.zoomBy(1.2);
  $('#grafo-menos').onclick = () => state.graphView?.zoomBy(1 / 1.2);
  $('#grafo-ajustar').onclick = () => state.graphView?.fit();
  if (state.graphKeyHandler) document.removeEventListener('keydown', state.graphKeyHandler);
  state.graphKeyHandler = (event) => {
    if (
      event.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) &&
      state.view === 'graph'
    ) {
      event.preventDefault();
      $('#grafo-busca')?.focus();
    }
  };
  document.addEventListener('keydown', state.graphKeyHandler);
  applyFilters();
}
async function focusGraphNote(path) {
  state.active = path;
  if (!state.tabs.includes(path)) state.tabs.push(path);
  const note = await tool('note.read', { path });
  state.frontmatter = note.frontmatter;
  state.revision = note.revision;
  state.doc = Doc.parseBody(note.body);
  await loadLinks();
  const focus = $('#grafo-foco');
  if (focus) focus.textContent = `Foco: ${baseName(path)}`;
  paintTabs();
  paintLinks();
  paintStatus();
  state.graphView?.setSelected(path);
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
    const tagTokens = commandMode ? [] : [...raw.matchAll(/(?:^|\s)#([^\s#]+)/g)].map((match) => match[1]);
    const query = (commandMode ? raw.trimStart().slice(1) : tagTokens.length ? raw.replace(/(?:^|\s)#[^\s#]+/g, ' ') : raw).trim();
    let hits = [];
    if (!commandMode && (query.length >= 2 || tagTokens.length)) {
      try {
        if (!tagTokens.length) hits = await tool('search.query', { query });
        else if (query.length >= 2) hits = await tool('search.query', { query, tags: tagTokens, tagsMode: 'all' });
        else {
          const lists = await Promise.all(tagTokens.map((tag) => tool('tags.notes', { tag, nested: true })));
          const common = lists.map((result) => result?.notes || []).reduce((left, right) => left.filter((note) => right.some((other) => other.path === note.path)));
          hits = common.map((note) => ({ path: note.path, title: note.title, segments: [] }));
        }
      } catch {
        hits = [];
      }
      const seen = new Set(
        hits.filter((hit) => String(hit.path).toLowerCase().endsWith('.canvas')).map((hit) => hit.path),
      );
      const canvases = (tagTokens.length ? [] : state.canvases).filter(
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
    const commands = tagTokens.length ? [] : (commandMode ? Cmd.COMMANDS : Cmd.COMMANDS.filter((item) => item.quando !== 'editor'))
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
      (tagTokens.length ? `<div class="paleta__filtros" id="paleta-filtro-tag">Filtrando por ${tagTokens.map((tag) => `<span class="tag-inline" style="--tag-h:${tagHue(tag)}">#${escapeHtml(tag)}</span>`).join(' ')}</div>` : '') +
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
      (hits.length === 0 && (query.length >= 2 || tagTokens.length)
        ? `<div class="vazio-pequeno vazio-pequeno--paleta">${ilustracao('busca-sem-resultado', 120)}<p>Nada encontrado para “${escapeHtml(query)}”. Tente outra palavra ou crie uma nota com esse nome.</p></div>`
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
  fillMermaid();
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
    if (state.view === 'calendar' && state.dayPanelOpen) {
      state.dayPanelOpen = false;
      paintCenter();
      return;
    }
    if (state.focusMode) {
      setFocusMode(false);
      return;
    }
  }
  if (
    state.view === 'calendar' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.target.closest('input, textarea, [contenteditable="true"]')
  ) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      shiftCalendarDay(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      shiftCalendarDay(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      shiftCalendarDay(-7);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      shiftCalendarDay(7);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      state.dayPanelOpen = true;
      loadDayPanel(state.dayFocus || state.calendarCursor || isoToday());
      return;
    }
    if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      state.calendarCursor = isoToday();
      state.dayFocus = isoToday();
      showCalendar();
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
    if (state.active && dailyPathDate(state.active)) {
      toast('Notas do dia têm o nome fixo pela data', 'erro');
      return;
    }
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
  await loadAnims();
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
  hookInlineTagsOnce();
  if (!state.settings.onboarded || !state.libraryPath) paintOnboarding();
  else await showShell();
  sophy.ready?.();
}

boot().catch((error) => {
  document.body.textContent = error.message;
});
