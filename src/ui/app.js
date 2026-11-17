const Doc = SophyDoc;
const Cmd = SophyCommands;

const state = {
  settings: {},
  libraryPath: null,
  libraryName: 'Biblioteca',
  workspaces: [],
  notes: [],
  tabs: [],
  active: null,
  view: 'empty',
  doc: null,
  revision: null,
  frontmatterText: '',
  outgoing: [],
  backlinks: [],
  conflict: false,
  graphWorkspace: '',
  graphTag: '',
  step: 1,
  folderMode: 'criar',
  folder: '',
  libraryNameInput: 'Biblioteca',
};

const slash = Cmd.createSlashSession();
let saveTimer = 0;
let lottiePromise = null;

const $ = (sel, root = document) => root.querySelector(sel);
function icon(name, extra = '') {
  return `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
function baseName(file) {
  return file.split('/').pop().replace(/\.md$/i, '');
}
function formatMatter(matter) {
  if (!matter || typeof matter !== 'object') return '';
  return Object.entries(matter)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('\n');
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
  const steps = [1, 2, 3, 4]
    .map(
      (n) =>
        `<i class="${n < state.step ? 'is-feito' : ''} ${n === state.step ? 'is-atual' : ''}"></i>`,
    )
    .join('');
  const bodies = {
    1: `<div class="sofi" data-sofi="pronta"></div>
      <h1>Olá, eu sou a Sofi.</h1>
      <div class="onboarding__cartoes">
        <div class="opcao">${icon('pasta')}<div><strong>Arquivos seus</strong><p>A biblioteca é uma pasta. Cada estante é uma subpasta. A nota é um .md comum.</p></div></div>
        <div class="opcao">${icon('link')}<div><strong>Notas ligadas</strong><p>Wikilinks, backlinks e o grafo nascem do texto, sem um formato fechado.</p></div></div>
        <div class="opcao">${icon('agente')}<div><strong>Agente opcional</strong><p>Dá para usar o Sophy sem chave nenhuma. O agente entra numa etapa seguinte.</p></div></div>
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
    3: `<h1>Como você quer ver o Sophy?</h1>
      <div class="temas">
        ${['light', 'dark', 'system']
          .map(
            (
              item,
            ) => `<button type="button" class="tema-card ${state.settings.theme === item ? 'is-escolhida' : ''}" data-theme-choice="${item}" data-amostra="${item}">
            <i></i>${item === 'light' ? 'Claro' : item === 'dark' ? 'Escuro' : 'Sistema'}</button>`,
          )
          .join('')}
      </div>
      <label class="campo">Fonte do texto
        <select id="fonte">
          <option value="inter" ${state.settings.readingFont !== 'literata' ? 'selected' : ''}>Inter</option>
          <option value="literata" ${state.settings.readingFont === 'literata' ? 'selected' : ''}>Literata</option>
        </select>
      </label>
      <label class="campo"><span><input type="checkbox" id="movimento" ${state.settings.reduceMotion ? 'checked' : ''} /> Reduzir animações da interface e da Sofi</span></label>`,
    4: `<img alt="" src="ui/assets/ilustracoes/agente-desconectado-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" width="200" />
      <h1>Quer ligar um agente agora?</h1>
      <p class="nota-privacidade">Esta etapa só guarda a sua escolha. A chave não é gravada na biblioteca nem no cofre — o agente em si vem depois.</p>
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
  root.innerHTML = `<section class="onboarding">
    <div class="onboarding__topo"><div class="onboarding__passos">${steps}</div><span>Passo ${state.step} de 4</span></div>
    <div class="onboarding__miolo">${bodies[state.step]}</div>
    <div class="onboarding__rodape">
      <button type="button" class="btn btn--fantasma" id="voltar" ${state.step === 1 ? 'disabled' : ''}>Voltar</button>
      <div>
        ${state.step === 4 ? '<button type="button" class="btn btn--secundario" id="pular">Pular por agora</button>' : ''}
        <button type="button" class="btn btn--primario" id="avancar">${primary}</button>
      </div>
    </div>
  </section>`;
  const sofi = $('[data-sofi]', root);
  if (sofi) mountSofi(sofi, 'pronta');
  $('#voltar', root).onclick = () => {
    state.step = Math.max(1, state.step - 1);
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
  root.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.onclick = async () => {
      state.settings.theme = button.dataset.themeChoice;
      applyTheme(themeName());
      await sophy.saveSettings({ theme: state.settings.theme });
      paintOnboarding();
    };
  });
  const font = $('#fonte', root);
  if (font)
    font.onchange = async () => {
      state.settings.readingFont = font.value;
      document.documentElement.style.setProperty(
        '--font-reading',
        font.value === 'literata' ? 'var(--font-reading-serif)' : 'var(--font-ui)',
      );
      await sophy.saveSettings({ readingFont: font.value });
    };
  const motion = $('#movimento', root);
  if (motion)
    motion.onchange = async () => {
      state.settings.reduceMotion = motion.checked;
      syncMotion();
      await sophy.saveSettings({ reduceMotion: motion.checked });
    };
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
        <button type="button" class="btn btn--icone" data-window="minimize" aria-label="Minimizar">${icon('chevron-baixo')}</button>
        <button type="button" class="btn btn--icone" data-window="maximize" aria-label="Maximizar">${icon('mais')}</button>
        <button type="button" class="btn btn--icone" data-window="close" aria-label="Fechar">${icon('fechar')}</button>
      </div>
    </header>
    <div class="miolo">
      <aside class="lateral" id="lateral">
        <div class="lateral__busca"><input id="filtro-arvore" type="search" placeholder="Filtrar a árvore" aria-label="Filtrar a árvore" /></div>
        <div id="arvore"></div>
        <div style="display:flex;gap:8px;padding:12px">
          <button type="button" class="btn btn--secundario" id="nova-nota">${icon('nota-nova')} Nota</button>
          <button type="button" class="btn btn--fantasma" id="nova-estante">${icon('pasta-nova')} Estante</button>
        </div>
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
  shell.querySelectorAll('[data-window]').forEach((button) => {
    button.onclick = () => sophy.window(button.dataset.window);
  });
  $('#nova-nota').onclick = () => createNote();
  $('#nova-estante').onclick = () => createWorkspace();
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
        .map(
          (
            note,
          ) => `<li><button type="button" class="arvore__linha" style="--nivel:1" data-open="${escapeHtml(note.path)}" aria-selected="${note.path === state.active}">
            ${icon('nota')}<span class="arvore__nome">${escapeHtml(baseName(note.path))}</span></button></li>`,
        )
        .join('');
      return `<li><button type="button" class="arvore__linha" aria-expanded="true"${color}>
          ${icon('chevron-direita', 'arvore__seta')}${icon(mark.icon, 'icon--estante')}<span class="arvore__nome">${escapeHtml(workspace.name)}</span>
          <span class="arvore__conta">${notes.length}</span></button><ul>${children}</ul></li>`;
    })
    .join('');
  const loose = treeNotes(null)
    .filter((note) => !filter || note.path.toLocaleLowerCase().includes(filter))
    .map(
      (
        note,
      ) => `<li><button type="button" class="arvore__linha" data-open="${escapeHtml(note.path)}" aria-selected="${note.path === state.active}">
        ${icon('nota')}<span class="arvore__nome">${escapeHtml(baseName(note.path))}</span></button></li>`,
    )
    .join('');
  host.innerHTML = `<ul class="arvore" role="tree">
    <li><div class="arvore__linha" aria-expanded="true">${icon('chevron-direita', 'arvore__seta')}${icon('estante')}<span class="arvore__nome">${escapeHtml(state.libraryName)}</span></div>
      <ul>${shelves}${loose}</ul></li></ul>`;
  host.querySelectorAll('[data-open]').forEach((button) => {
    button.onclick = () => openNote(button.dataset.open);
  });
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
    button.onclick = () => openNote(button.dataset.tab);
  });
}

function paintCenter() {
  const center = $('#centro');
  if (!center) return;
  if (state.view === 'graph') {
    paintGraph(center);
    return;
  }
  if (state.view === 'canvas') {
    center.innerHTML = `<div class="canvas-placeholder"><div class="sofi" data-sofi="pensando"></div><h2>Canvas</h2><p>${escapeHtml(state.canvasPath || '')}</p><p>O canvas entra na etapa 6. Este arquivo .canvas não foi aberto nem alterado.</p></div>`;
    const sofi = $('[data-sofi]', center);
    if (sofi) mountSofi(sofi, 'pensando');
    return;
  }
  if (!state.active || !state.doc) {
    center.innerHTML = `<div class="vazio"><img alt="" src="ui/assets/ilustracoes/biblioteca-vazia-${themeName() === 'dark' ? 'escuro' : 'claro'}.svg" width="200" /><h2>Escolha uma nota</h2><p>Ou crie uma pela barra lateral. O arquivo continua Markdown puro.</p></div>`;
    return;
  }
  const conflict = state.conflict
    ? `<div class="aviso" role="alert">${icon('erro')} <span>A nota mudou desde a leitura. Nada foi gravado.</span> <button type="button" class="btn btn--secundario" id="recarregar">Recarregar</button></div>`
    : '';
  const matter = state.frontmatterText
    ? `<pre class="frontmatter">${escapeHtml(state.frontmatterText)}</pre>`
    : '';
  const blocks = state.doc.blocks.map((block, index) => renderBlock(block, index)).join('');
  center.innerHTML = `${conflict}<article class="coluna" id="coluna">${matter}${blocks}</article>`;
  const reload = $('#recarregar');
  if (reload) reload.onclick = () => openNote(state.active, { force: true });
  $('#coluna')
    .querySelectorAll('[data-block]')
    .forEach((el) => bindBlock(el));
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
}

function renderBlock(block, index) {
  if (block.type === 'blank')
    return `<div class="bloco" data-block="${index}" contenteditable="true"><br /></div>`;
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
    const chips = [
      task.due ? `<span class="chip">${escapeHtml(task.due)}</span>` : '',
      task.priority === 'alta' ? '<span class="chip chip--alta">Alta</span>' : '',
      task.priority === 'media' ? '<span class="chip chip--media">Média</span>' : '',
      task.priority === 'baixa' ? '<span class="chip">Baixa</span>' : '',
    ].join('');
    return `<div class="tarefa" data-status="${escapeHtml(task.status)}">${icon('tarefa')}
      <button type="button" class="check" data-task="${index}" data-status="${escapeHtml(task.status)}" aria-label="Alternar tarefa"></button>
      <div class="tarefa__texto" data-block="${index}" contenteditable="true">${escapeHtml(task.title)}</div>${chips}</div>`;
  }
  if (block.type === 'item') {
    const text = block.raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
    return `<div class="bloco bloco--item" data-block="${index}" contenteditable="true">${inlineHtml(text)}</div>`;
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
  return `<p class="bloco bloco--texto" data-block="${index}" contenteditable="true">${inlineHtml(text)}</p>`;
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
  el.addEventListener('blur', () => {
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
  if (event.key === 'Escape') {
    const text = readEditable(el);
    slash.dismiss(text, modelOffset(el));
    closeMenus();
    event.preventDefault();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveNow();
  }
  const menu = $('.menu-flutuante');
  if (!menu) return;
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

async function openNote(file, options = {}) {
  if (state.active && state.doc && !state.conflict && state.active !== file) await saveNow();
  const note = await tool('note.read', { path: file });
  state.active = note.path;
  state.view = 'note';
  state.doc = Doc.parseDocument(note.body);
  state.revision = note.revision;
  state.frontmatterText = formatMatter(note.frontmatter);
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
  if (state.view !== 'note' || !state.active) {
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
  host.innerHTML = `<h3>Links de saída</h3>${out}<h3>Backlinks</h3>${back}
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

async function createNote() {
  const name = window.prompt('Nome da nota');
  if (!name) return;
  const shelf = state.workspaces[0]?.name;
  const path = `${shelf ? shelf + '/' : ''}${name.replace(/\.md$/i, '')}.md`;
  try {
    await tool('note.create', { path, body: '' });
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

async function createWorkspace() {
  const name = window.prompt('Nome da estante');
  if (!name) return;
  try {
    await tool('workspace.create', { name });
    await refreshLibrary();
    paintTree();
  } catch (error) {
    toast(error.message, 'erro');
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
    <canvas id="grafo-canvas"></canvas>
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
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(320, rect.width);
  canvas.height = Math.max(320, rect.height - 56);
  const styles = getComputedStyle(document.documentElement);
  const nodes = layout(graph.nodes, graph.edges, canvas.width, canvas.height);
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = styles.getPropertyValue('--line-strong').trim() || '#D9D5CE';
  ctx.lineWidth = 1.4;
  for (const edge of graph.edges) {
    const from = byPath.get(edge.from);
    const to = byPath.get(edge.to);
    if (!from || !to) continue;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  for (const node of nodes) {
    const mark = Cmd.shelfMark(node.workspace || '');
    const color = mark.color
      ? styles.getPropertyValue(`--shelf-${mark.color}`).trim()
      : styles.getPropertyValue('--ink-3').trim();
    const focused = node.path === state.active;
    ctx.beginPath();
    ctx.fillStyle = color || '#6E72B0';
    ctx.arc(node.x, node.y, focused ? 9 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (focused) {
      ctx.strokeStyle = styles.getPropertyValue('--accent').trim();
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = styles.getPropertyValue('--ink').trim();
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(node.title || baseName(node.path), node.x + 12, node.y + 4);
  }
  canvas.onclick = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * canvas.width;
    const y = ((event.clientY - bounds.top) / bounds.height) * canvas.height;
    const hit = nodes.find((node) => Math.hypot(node.x - x, node.y - y) < 14);
    if (hit) openNote(hit.path);
  };
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
    <div class="paleta__busca">${icon('busca')}<input id="paleta-q" placeholder="Buscar notas" aria-label="Buscar" /></div>
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
          return `<button type="button" class="menu__item" data-hit="${index}" ${index === 0 ? 'aria-selected="true"' : ''}><span><span class="menu__titulo">${escapeHtml(hit.title || hit.path)}</span><span class="menu__caminho">${excerpt}</span></span></button>`;
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
    state.view = 'canvas';
    state.canvasPath = command.path;
    state.placeholder = next.placeholder;
    paintCenter();
    paintLinks();
  }
}

document.addEventListener('keydown', (event) => {
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
