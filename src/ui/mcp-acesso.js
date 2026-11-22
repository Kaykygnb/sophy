/* Acesso por MCP e Atividade.
   Módulo próprio e isolado: não lê o `state` do app. Fala só com `window.sophy`
   (`mcpAdmin` para chaves e legado, `tool` para a atividade) e recebe do app,
   em `init`, os poucos ganchos de que precisa (aviso, abrir nota, etc.). */
(function (root) {
  'use strict';

  const host = {
    toast: null, // (mensagem, tipo) => void
    openNote: null, // (caminho) => Promise|void
    openActivity: null, // () => void
    openMcpSettings: null, // () => void
    afterUndo: null, // () => Promise|void: o app recarrega a biblioteca
    illustration: null, // (nome, largura) => html
  };

  function init(hooks) {
    Object.assign(host, hooks || {});
  }

  /* ---------- utilidades ---------- */
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const ic = (name, extra = '') =>
    `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const NOME = /^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{0,39}$/u;

  function say(message, kind) {
    if (typeof host.toast === 'function') host.toast(message, kind);
  }

  async function call(kind, name, input) {
    const api = root.sophy || {};
    const fn = kind === 'admin' ? api.mcpAdmin : api.tool;
    if (typeof fn !== 'function') {
      const missing = new Error('Esta versão do Sophy ainda não tem o acesso por MCP.');
      missing.code = 'indisponivel';
      throw missing;
    }
    const response = await fn(name, input || {});
    if (!response || response.ok === false) {
      const error = new Error((response && response.error) || 'Falha na operação.');
      error.code = response && response.code;
      throw error;
    }
    return response.value;
  }
  const admin = (name, input) => call('admin', name, input);
  const tool = (name, input) => call('tool', name, input);

  function errorText(error) {
    const code = error && error.code;
    const map = {
      nome_em_uso: 'Já existe um agente com esse nome. Escolha outro.',
      nome_invalido: 'Esse nome não serve. Use letras, números e espaços, até 40 caracteres.',
      permissao_invalida: 'Escolha entre Leitura e Escrita.',
      cliente_inexistente: 'Esse agente já não existe. A lista foi atualizada.',
      atividade_inexistente: 'Essa atividade já não está no registro.',
      indisponivel: 'Esta versão do Sophy ainda não tem o acesso por MCP.',
    };
    return map[code] || (error && error.message) || 'Algo deu errado. Tente de novo.';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.append(area);
      area.select();
      let done = false;
      try {
        done = document.execCommand('copy');
      } catch {
        done = false;
      }
      area.remove();
      return done;
    }
  }

  function relative(iso) {
    const time = Date.parse(iso);
    if (!iso || Number.isNaN(time)) return '';
    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 45) return 'agora';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24 && new Date(time).toDateString() === new Date().toDateString())
      return `há ${hours} h`;
    const when = new Date(time);
    const clock = when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (when.toDateString() === yesterday.toDateString()) return `ontem, ${clock}`;
    return `${when.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')}, ${clock}`;
  }

  function exact(iso) {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    return new Date(time).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  }

  function dayLabel(iso) {
    const when = new Date(Date.parse(iso));
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (when.toDateString() === today.toDateString()) return 'Hoje';
    if (when.toDateString() === yesterday.toDateString()) return 'Ontem';
    return when.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  /* Quem é quem: cor e rótulo. Cada agente MCP tem uma cor estável pelo nome. */
  const AGENT_COLORS = ['azul', 'verde', 'laranja', 'rosa', 'amarelo', 'vermelho', 'marrom'];
  function author(raw) {
    const value = String(raw || '');
    if (value === 'usuario')
      return { id: value, nome: 'Você', cor: 'acento', tipo: 'usuario', glyph: 'perfil' };
    if (value === 'sofi')
      return { id: value, nome: 'Sofi', cor: 'roxo', tipo: 'sofi', glyph: 'faisca' };
    const nome = value.startsWith('mcp:') ? value.slice(4) : value || 'Agente';
    let hash = 0;
    for (const char of nome.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return {
      id: value,
      nome,
      cor: AGENT_COLORS[hash % AGENT_COLORS.length],
      tipo: 'mcp',
      glyph: 'mcp',
    };
  }
  const avatar = (who, extra = '') =>
    `<span class="mcp-avatar mcp-avatar--${who.cor} ${extra}" aria-hidden="true">${ic(who.glyph)}</span>`;

  /* ---------- janelas (diálogo próprio, não mexe no #overlay do app) ---------- */
  let openModals = 0;
  function modal({ titulo, rotulo, classe = '', dismissable = true, onClose }) {
    const scrim = document.createElement('div');
    scrim.className = 'mcp-scrim';
    scrim.innerHTML = `<div class="mcp-modal ${classe}" role="dialog" aria-modal="true" aria-label="${esc(rotulo || titulo)}" tabindex="-1"></div>`;
    document.body.append(scrim);
    const box = scrim.firstElementChild;
    const previous = document.activeElement;
    openModals += 1;
    let closed = false;
    const api = {
      box,
      close(value) {
        if (closed) return;
        closed = true;
        openModals -= 1;
        scrim.remove();
        document.removeEventListener('keydown', onKey, true);
        if (previous && previous.isConnected && typeof previous.focus === 'function')
          previous.focus();
        if (typeof onClose === 'function') onClose(value);
      },
    };
    function onKey(event) {
      if (!scrim.isConnected) return;
      if (event.key === 'Escape' && dismissable) {
        event.stopPropagation();
        event.preventDefault();
        if (typeof api.requestClose === 'function') api.requestClose();
        else api.close();
        return;
      }
      if (event.key === 'Tab') {
        const items = [
          ...box.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), [href], textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || !box.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
    scrim.addEventListener('mousedown', (event) => {
      if (event.target === scrim && dismissable) {
        if (typeof api.requestClose === 'function') api.requestClose();
        else api.close();
      }
    });
    return api;
  }

  function confirmBox({
    titulo,
    texto,
    extra = '',
    confirmar,
    perigo = false,
    cancelar = 'Cancelar',
    classe = '',
  }) {
    return new Promise((resolve) => {
      const win = modal({
        titulo,
        classe: `mcp-modal--pequena ${classe}`,
        onClose: (value) => resolve(value === true),
      });
      win.box.innerHTML = `<h3 class="mcp-modal__titulo">${esc(titulo)}</h3>
        <p class="mcp-modal__texto">${esc(texto)}</p>${extra}
        <div class="mcp-modal__acoes"><button type="button" class="btn btn--fantasma" data-mcp-nao>${esc(cancelar)}</button><button type="button" class="btn ${perigo ? 'btn--perigo' : 'btn--primario'}" data-mcp-sim>${esc(confirmar)}</button></div>`;
      win.box.querySelector('[data-mcp-nao]').onclick = () => win.close(false);
      win.box.querySelector('[data-mcp-sim]').onclick = () => win.close(true);
      win.box.querySelector('[data-mcp-nao]').focus();
    });
  }

  /* ---------- Configurações > Acesso por MCP ---------- */
  function mountSettings(section) {
    if (!section) return;
    const view = { clients: [], legacy: null, error: '', loading: true };
    section.classList.add('mcp-acesso');

    async function load() {
      view.loading = true;
      view.error = '';
      paint();
      try {
        const [clients, legacy] = await Promise.all([
          admin('mcp.clients.list'),
          admin('mcp.legacy.get'),
        ]);
        view.clients = Array.isArray(clients) ? clients : [];
        view.legacy = legacy || { ativo: false, aviso: '' };
      } catch (error) {
        view.error = errorText(error);
      }
      view.loading = false;
      paint();
    }

    function clientRow(client) {
      const who = author(`mcp:${client.nome}`);
      const lastUse = client.ultimoUso
        ? `Último uso ${relative(client.ultimoUso)}`
        : 'Ainda não foi usado';
      return `<li class="mcp-cliente${client.ativo ? '' : ' is-inativo'}" data-id="${esc(client.id)}" data-nome="${esc(client.nome)}">
        ${avatar(who, 'mcp-avatar--grande')}
        <div class="mcp-cliente__info">
          <div class="mcp-cliente__nome"><b>${esc(client.nome)}</b>
            <span class="mcp-selo mcp-selo--${client.permissao === 'escrita' ? 'escrita' : 'leitura'}">${client.permissao === 'escrita' ? 'Escrita' : 'Leitura'}</span>
            ${client.ativo ? '' : '<span class="mcp-selo mcp-selo--off">Desativado</span>'}</div>
          <small><code class="mcp-final" title="Final da chave">${esc(client.final || '')}</code><span aria-hidden="true"> · </span><span title="${esc(exact(client.ultimoUso))}">${esc(lastUse)}</span></small>
        </div>
        <label class="alternar mcp-cliente__chave"><input type="checkbox" role="switch" data-mcp-ativo aria-label="${client.ativo ? 'Desativar' : 'Ativar'} ${esc(client.nome)}" ${client.ativo ? 'checked' : ''}><span>${client.ativo ? 'Ativo' : 'Desligado'}</span></label>
        <button type="button" class="btn btn--fantasma btn--pequeno mcp-revogar" data-mcp-revogar aria-label="Revogar ${esc(client.nome)}">Revogar</button>
      </li>`;
    }

    function paint() {
      const art = host.illustration ? host.illustration('agente-desconectado', 128) : '';
      let list;
      if (view.loading && !view.clients.length)
        list = '<p class="config__ajuda" role="status">Carregando os agentes…</p>';
      else if (view.error)
        list = `<div class="mcp-erro" role="alert">${ic('alerta')}<span>${esc(view.error)}</span><button type="button" class="btn btn--secundario btn--pequeno" data-mcp-recarregar>Tentar de novo</button></div>`;
      else if (!view.clients.length)
        list = `<div class="mcp-vazio" data-mcp-vazio>${art}<div><b>Nenhum agente conectado ainda</b>
          <p>Conecte o Codex, o Claude ou outro agente para ele ler (ou também editar) suas notas. Cada um ganha uma chave própria: você vê o que cada um fez e pode desligar um sem mexer nos outros.</p>
          <button type="button" class="btn btn--primario" data-mcp-conectar>${ic('mais')} Conectar um agente</button></div></div>`;
      else
        list = `<ul class="mcp-lista" aria-label="Agentes conectados">${view.clients.map(clientRow).join('')}</ul>`;

      const legacy = view.legacy;
      const legacyOn = legacy && legacy.ativo === true;
      const warning =
        legacy && legacy.aviso
          ? legacy.aviso
          : 'Com o modo sem chave desligado, as configurações atuais que não têm chave deixam de funcionar.';
      section.innerHTML = `<h3>Acesso por MCP</h3>
        <p class="config__ajuda">O MCP é a porta pela qual um agente de fora (Codex, Claude e outros) lê e edita suas notas. Aqui ela não fica aberta: <b>cada agente recebe a própria chave</b>. Tudo o que ele fizer fica registrado com o nome dele, e você e a Sofi podem ver o antes e depois e desfazer.</p>
        <div class="mcp-cabeca">
          <h4>Agentes conectados${view.clients.length ? ` <span class="mcp-contagem">${view.clients.length}</span>` : ''}</h4>
          <div class="mcp-cabeca__acoes">
            <button type="button" class="btn btn--secundario" data-mcp-atividade>${ic('linha-do-tempo')} Ver atividade</button>
            <button type="button" class="btn btn--primario" data-mcp-conectar>${ic('mais')} Conectar um agente</button>
          </div>
        </div>
        ${list}
        <h4>Conexões sem chave</h4>
        <div class="config__linha mcp-legado">
          <div class="config__rotulo"><b>Aceitar conexões sem chave (legado)</b><p>É como o MCP funcionava antes das chaves. Qualquer programa do seu computador consegue ler e editar suas notas sem se identificar. ${legacyOn ? '' : 'Desligado, só entra quem tem chave.'}</p></div>
          <div class="config__controle"><label class="alternar"><input type="checkbox" role="switch" id="mcp-legado" ${legacyOn ? 'checked' : ''} ${legacy ? '' : 'disabled'}><span>${legacyOn ? 'Ligado' : 'Desligado'}</span></label></div>
        </div>
        <div class="mcp-aviso${legacyOn ? ' mcp-aviso--ligado' : ''}" role="note" id="mcp-legado-aviso">${ic(legacyOn ? 'alerta' : 'info')}<p><b>${legacyOn ? 'Atenção: qualquer programa entra sem chave.' : 'Antes de desligar ou ligar, saiba:'}</b> ${esc(warning)}</p></div>`;
      bind();
    }

    function bind() {
      section.querySelectorAll('[data-mcp-conectar]').forEach((button) => {
        button.onclick = () => openWizard(() => load());
      });
      section
        .querySelector('[data-mcp-atividade]')
        ?.addEventListener('click', () => host.openActivity && host.openActivity());
      section.querySelector('[data-mcp-recarregar]')?.addEventListener('click', load);
      section.querySelectorAll('[data-mcp-revogar]').forEach((button) => {
        button.onclick = async () => {
          const row = button.closest('.mcp-cliente');
          const nome = row.dataset.nome;
          const ok = await confirmBox({
            titulo: `Revogar o acesso de ${nome}?`,
            texto: `${nome} perde o acesso agora e a chave não volta. Para reconectar, será preciso criar uma chave nova. O que ele já fez continua na Atividade.`,
            confirmar: 'Revogar acesso',
            perigo: true,
          });
          if (!ok) return;
          try {
            await admin('mcp.clients.revoke', { id: row.dataset.id });
            say(`Acesso de ${nome} revogado.`);
          } catch (error) {
            say(errorText(error), 'erro');
          }
          load();
        };
      });
      section.querySelectorAll('[data-mcp-ativo]').forEach((input) => {
        input.onchange = async () => {
          const row = input.closest('.mcp-cliente');
          const want = input.checked;
          input.disabled = true;
          try {
            await admin('mcp.clients.toggle', { id: row.dataset.id, ativo: want });
            say(
              want
                ? `${row.dataset.nome} voltou a ter acesso.`
                : `${row.dataset.nome} está desativado. A chave continua guardada.`,
            );
          } catch (error) {
            say(errorText(error), 'erro');
          }
          load();
        };
      });
      const legacy = section.querySelector('#mcp-legado');
      if (legacy)
        legacy.onchange = async () => {
          const want = legacy.checked;
          legacy.checked = !want; // só vale depois da confirmação
          const warning = view.legacy && view.legacy.aviso ? view.legacy.aviso : '';
          const ok = await confirmBox({
            titulo: want ? 'Aceitar conexões sem chave?' : 'Desligar as conexões sem chave?',
            texto: want
              ? 'Qualquer programa do seu computador poderá ler e editar suas notas pelo MCP sem se identificar, e não dá para saber quem fez o quê.'
              : 'Só quem tiver uma chave vai conseguir entrar pelo MCP.',
            extra: warning
              ? `<div class="mcp-aviso mcp-aviso--dialogo">${ic('alerta')}<p>${esc(warning)}</p></div>`
              : '',
            confirmar: want ? 'Aceitar sem chave' : 'Desligar o legado',
            perigo: want,
          });
          if (!ok) return;
          try {
            view.legacy = await admin('mcp.legacy.set', { ativo: want });
            say(want ? 'Conexões sem chave ligadas.' : 'Conexões sem chave desligadas.');
          } catch (error) {
            say(errorText(error), 'erro');
          }
          paint();
        };
    }

    load();
    return { reload: load };
  }

  /* ---------- Passo a passo: Conectar um agente ---------- */
  function openWizard(onDone) {
    const data = {
      step: 1,
      nome: '',
      permissao: 'leitura',
      erro: '',
      criando: false,
      chave: '',
      cliente: null,
      snippets: null,
      snippetErro: '',
      agente: 'codex',
      transporte: 'stdio',
      copiou: false,
      confirmandoFechar: false,
    };
    let created = false;
    const win = modal({
      titulo: 'Conectar um agente',
      classe: 'mcp-modal--passos',
      onClose: () => {
        data.chave = '';
        data.snippets = null;
        if (created && typeof onDone === 'function') onDone();
      },
    });
    win.requestClose = () => {
      if (data.step >= 3 && data.chave && !data.copiou) {
        data.confirmandoFechar = true;
        paint();
        return;
      }
      win.close();
    };

    const STEPS = ['Nome', 'Permissão', 'Chave', 'Configuração'];
    const header = () => `<header class="mcp-passos__topo">
        <ol class="mcp-passos" aria-label="Etapas">${STEPS.map((label, index) => `<li class="${index + 1 === data.step ? 'is-atual' : index + 1 < data.step ? 'is-feito' : ''}" ${index + 1 === data.step ? 'aria-current="step"' : ''}><span>${index + 1 < data.step ? ic('check') : index + 1}</span>${label}</li>`).join('')}</ol>
        <button type="button" class="btn btn--icone" data-mcp-fechar aria-label="Fechar">${ic('fechar')}</button>
      </header>`;

    function stepName() {
      return `<h3 class="mcp-modal__titulo">Como se chama esse agente?</h3>
        <p class="mcp-modal__texto">O nome aparece na lista e na Atividade, ao lado de tudo que ele fizer. Use um nome por agente (o Codex e o Claude não dividem a mesma chave).</p>
        <form id="mcp-form-nome" novalidate>
          <label class="dialogo__campo mcp-campo"><span>Nome do agente</span>
            <input id="mcp-nome" type="text" autocomplete="off" maxlength="40" placeholder="Ex.: Codex" value="${esc(data.nome)}" aria-describedby="mcp-nome-erro" ${data.erro ? 'aria-invalid="true"' : ''}></label>
          <p class="mcp-campo__erro" id="mcp-nome-erro" role="alert">${esc(data.erro)}</p>
          <div class="mcp-sugestoes" aria-label="Sugestões de nome"><span>Sugestões:</span>${['Codex', 'Claude', 'Cursor'].map((name) => `<button type="button" class="chip" data-mcp-sugestao="${name}">${name}</button>`).join('')}</div>
          <div class="mcp-modal__acoes"><button type="button" class="btn btn--fantasma" data-mcp-fechar>Cancelar</button><button type="submit" class="btn btn--primario">Continuar</button></div>
        </form>`;
    }

    function stepPermission() {
      const option = (
        value,
        titulo,
        texto,
      ) => `<label class="mcp-opcao${data.permissao === value ? ' is-escolhida' : ''}"><input type="radio" name="mcp-permissao" value="${value}" ${data.permissao === value ? 'checked' : ''}>
          <span class="mcp-opcao__corpo"><b>${titulo} <span class="mcp-selo mcp-selo--${value}">${value === 'escrita' ? 'Escrita' : 'Leitura'}</span></b><span>${texto}</span></span></label>`;
      return `<h3 class="mcp-modal__titulo">O que ${esc(data.nome)} pode fazer?</h3>
        <p class="mcp-modal__texto">Você pode mudar isso depois criando uma chave nova.</p>
        <div class="mcp-opcoes" role="radiogroup" aria-label="Permissão">
          ${option('leitura', 'Só leitura', 'Lê, busca e consulta suas notas, e vê a Atividade. Não muda nada.')}
          ${option('escrita', 'Leitura e escrita', 'Faz tudo o que a leitura faz e também cria, edita, move e organiza notas. Cada ação é registrada e dá para desfazer.')}
        </div>
        <div class="mcp-apenas-app" role="note">${ic('cadeado')}<div><b>Fica só no app, para qualquer agente</b><p>Esvaziar a lixeira, apagar uma nota para sempre, importar ou exportar a biblioteca, exportar o site e trocar de biblioteca. Para essas ações, só você, aqui no Sophy.</p></div></div>
        <p class="mcp-campo__erro" role="alert">${esc(data.erro)}</p>
        <div class="mcp-modal__acoes"><button type="button" class="btn btn--fantasma" data-mcp-voltar>Voltar</button><button type="button" class="btn btn--primario" data-mcp-criar ${data.criando ? 'disabled' : ''}>${data.criando ? 'Criando…' : 'Criar chave'}</button></div>`;
    }

    function stepKey() {
      return `<h3 class="mcp-modal__titulo">A chave de ${esc(data.nome)}</h3>
        <p class="mcp-modal__texto">Cole esta chave na configuração do agente. É ela que prova que é ${esc(data.nome)} quem está pedindo.</p>
        <div class="mcp-chave"><code id="mcp-chave-texto" data-mcp-chave>${esc(data.chave)}</code><button type="button" class="btn btn--secundario" data-mcp-copiar-chave>${ic('duplicar')} <span>${data.copiou ? 'Copiado' : 'Copiar'}</span></button></div>
        <div class="mcp-aviso mcp-aviso--ligado" role="alert">${ic('alerta')}<p><b>Guarde agora, não aparece de novo.</b> O Sophy guarda só uma impressão digital da chave. Se perder, é preciso revogar e criar outra.</p></div>
        <div class="mcp-modal__acoes"><span class="mcp-modal__nota" role="status" aria-live="polite">${data.copiou ? 'Chave copiada.' : ''}</span><button type="button" class="btn btn--primario" data-mcp-seguir>${data.copiou ? 'Continuar' : 'Já guardei, continuar'}</button></div>`;
    }

    function stepSnippets() {
      const group = data.snippets && data.snippets[data.transporte];
      const text = group ? group[data.agente] : '';
      const where =
        data.agente === 'codex'
          ? 'Cole no arquivo <code>config.toml</code> do Codex (pasta <code>.codex</code>, na sua pasta de usuário).'
          : 'Cole dentro de <code>mcpServers</code> no arquivo de configuração do Claude. Se já houver outros servidores, junte este ao conjunto.';
      const how =
        data.transporte === 'http'
          ? 'Antes, deixe o servidor rodando com <code>sophy mcp --http</code>. Ele escuta só neste computador, em 127.0.0.1:8734.'
          : 'O agente abre o servidor sozinho, por stdio. Não precisa deixar nada rodando.';
      // O motor avisa no stdio quando o trecho não roda (ex.: cli.ts dentro do app.asar).
      const stdioAviso = (data.snippets && data.snippets.stdio && data.snippets.stdio.aviso) || '';
      const showAviso = data.transporte === 'stdio' && stdioAviso;
      const tab = (kind, value, label) =>
        `<button type="button" role="tab" class="mcp-aba${data[kind] === value ? ' is-atual' : ''}" aria-selected="${data[kind] === value}" data-mcp-aba="${kind}:${value}">${label}${kind === 'transporte' && value === 'stdio' && stdioAviso ? ic('alerta', 'mcp-aba__alerta') : ''}</button>`;
      return `<h3 class="mcp-modal__titulo">Configure ${esc(data.nome)}</h3>
        <p class="mcp-modal__texto">Escolha o agente e como ele fala com o Sophy. O trecho já leva a chave.</p>
        <div class="mcp-abas" role="tablist" aria-label="Agente">${tab('agente', 'codex', 'Codex')}${tab('agente', 'claude', 'Claude')}</div>
        <div class="mcp-abas mcp-abas--leve" role="tablist" aria-label="Transporte">${tab('transporte', 'stdio', 'stdio (padrão)')}${tab('transporte', 'http', 'HTTP')}</div>
        ${
          data.snippetErro
            ? `<div class="mcp-erro" role="alert">${ic('alerta')}<span>${esc(data.snippetErro)}</span><button type="button" class="btn btn--secundario btn--pequeno" data-mcp-snippet-de-novo>Tentar de novo</button></div>`
            : `${showAviso ? `<div class="mcp-aviso mcp-aviso--ligado mcp-aviso--stdio" role="alert" data-mcp-aviso-stdio>${ic('alerta')}<p><b>Este trecho não vai rodar como está.</b> ${esc(stdioAviso)}</p></div>` : ''}<div class="mcp-codigo"><pre tabindex="0" aria-label="Trecho de configuração"><code data-mcp-snippet>${esc(text || 'Montando o trecho…')}</code></pre><button type="button" class="btn btn--secundario btn--pequeno mcp-codigo__copiar" data-mcp-copiar-snippet>${ic('duplicar')} <span>Copiar</span></button></div>
        <p class="mcp-modal__ajuda">${where}</p><p class="mcp-modal__ajuda">${how}</p>`
        }
        <div class="mcp-modal__acoes"><button type="button" class="btn btn--fantasma" data-mcp-voltar>Ver a chave de novo</button><button type="button" class="btn btn--primario" data-mcp-concluir>Concluir</button></div>
        <p class="mcp-modal__ajuda mcp-modal__ajuda--fim">Ao concluir, a chave some desta tela. Ela fica só no arquivo de configuração do agente.</p>`;
    }

    function paint() {
      const bodies = { 1: stepName, 2: stepPermission, 3: stepKey, 4: stepSnippets };
      const confirmBar = data.confirmandoFechar
        ? `<div class="mcp-fechar-aviso" role="alertdialog" aria-label="Fechar sem copiar a chave"><b>Fechar sem copiar a chave?</b><p>Ela não aparece de novo. Você teria que revogar ${esc(data.nome)} e criar outra.</p><div class="mcp-modal__acoes"><button type="button" class="btn btn--fantasma" data-mcp-ficar>Voltar à chave</button><button type="button" class="btn btn--perigo" data-mcp-fechar-mesmo>Fechar mesmo assim</button></div></div>`
        : '';
      win.box.innerHTML = `${header()}<div class="mcp-passos__corpo">${bodies[data.step]()}</div>${confirmBar}`;
      bind();
    }

    const refreshSnippets = async () => {
      data.snippetErro = '';
      try {
        data.snippets = await admin('mcp.clients.snippet', {
          nome: data.cliente.nome,
          chave: data.chave,
        });
      } catch (error) {
        data.snippets = null;
        data.snippetErro = errorText(error);
      }
    };

    function bind() {
      const box = win.box;
      box
        .querySelectorAll('[data-mcp-fechar]')
        .forEach((el) => (el.onclick = () => win.requestClose()));
      box.querySelector('[data-mcp-ficar]')?.addEventListener('click', () => {
        data.confirmandoFechar = false;
        paint();
      });
      box.querySelector('[data-mcp-fechar-mesmo]')?.addEventListener('click', () => win.close());
      box.querySelector('[data-mcp-voltar]')?.addEventListener('click', () => {
        data.step -= 1;
        data.erro = '';
        paint();
      });
      if (data.step === 1) {
        const input = box.querySelector('#mcp-nome');
        input.focus();
        box.querySelectorAll('[data-mcp-sugestao]').forEach((chip) => {
          chip.onclick = () => {
            input.value = chip.dataset.mcpSugestao;
            input.focus();
          };
        });
        box.querySelector('#mcp-form-nome').onsubmit = (event) => {
          event.preventDefault();
          const nome = input.value.trim();
          data.nome = nome;
          if (!NOME.test(nome)) {
            data.erro = nome
              ? 'Esse nome não serve. Use letras, números e espaços, até 40 caracteres.'
              : 'Dê um nome ao agente.';
            paint();
            return;
          }
          data.erro = '';
          data.step = 2;
          paint();
        };
      }
      if (data.step === 2) {
        box.querySelectorAll('input[name="mcp-permissao"]').forEach((radio) => {
          radio.onchange = () => {
            data.permissao = radio.value;
            box
              .querySelectorAll('.mcp-opcao')
              .forEach((label) =>
                label.classList.toggle('is-escolhida', label.contains(radio) && radio.checked),
              );
          };
        });
        box.querySelector('[data-mcp-criar]').onclick = async () => {
          if (data.criando) return;
          data.criando = true;
          data.erro = '';
          paint();
          try {
            const result = await admin('mcp.clients.create', {
              nome: data.nome,
              permissao: data.permissao,
            });
            created = true;
            data.cliente = result;
            data.chave = result.chave;
            await refreshSnippets(); // logo depois do create, com a chave ainda na tela
            data.criando = false;
            data.step = 3;
          } catch (error) {
            data.criando = false;
            data.erro = errorText(error);
            if (error && (error.code === 'nome_em_uso' || error.code === 'nome_invalido')) {
              data.step = 1;
            }
          }
          paint();
        };
      }
      if (data.step === 3) {
        box.querySelector('[data-mcp-copiar-chave]').onclick = async () => {
          if (await copyText(data.chave)) {
            data.copiou = true;
            paint();
            box.querySelector('[data-mcp-copiar-chave]')?.focus();
          } else say('Não consegui copiar. Selecione a chave e copie com Ctrl+C.', 'erro');
        };
        box.querySelector('[data-mcp-seguir]').onclick = () => {
          data.step = 4;
          paint();
        };
        box.querySelector('[data-mcp-seguir]').focus();
      }
      if (data.step === 4) {
        box.querySelectorAll('[data-mcp-aba]').forEach((tab) => {
          tab.onclick = () => {
            const [kind, value] = tab.dataset.mcpAba.split(':');
            data[kind] = value;
            paint();
            box.querySelector(`[data-mcp-aba="${kind}:${value}"]`)?.focus();
          };
        });
        box.querySelector('[data-mcp-snippet-de-novo]')?.addEventListener('click', async () => {
          await refreshSnippets();
          paint();
        });
        const copy = box.querySelector('[data-mcp-copiar-snippet]');
        if (copy)
          copy.onclick = async () => {
            const text =
              (data.snippets &&
                data.snippets[data.transporte] &&
                data.snippets[data.transporte][data.agente]) ||
              '';
            if (text && (await copyText(text))) {
              data.copiou = true;
              copy.querySelector('span').textContent = 'Copiado';
              copy.classList.add('is-copiado');
              setTimeout(() => {
                if (copy.isConnected) {
                  copy.querySelector('span').textContent = 'Copiar';
                  copy.classList.remove('is-copiado');
                }
              }, 2000);
            } else say('Não consegui copiar. Selecione o trecho e copie com Ctrl+C.', 'erro');
          };
        box.querySelector('[data-mcp-concluir]').onclick = () => win.close();
      }
    }
    paint();
  }

  /* ---------- Dif simples por linha ---------- */
  function splitLines(text) {
    if (text == null) return [];
    const lines = String(text).split(/\r?\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /* Devolve linhas lado a lado: { tipo: 'igual'|'mudou'|'tirou'|'pos', esq, dir }. */
  function lineDiff(beforeText, afterText) {
    const a = splitLines(beforeText);
    const b = splitLines(afterText);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const ops = [];
    for (let i = 0; i < start; i += 1) ops.push(['=', i, i]);
    if (midA.length * midB.length > 4_000_000) {
      midA.forEach((_, i) => ops.push(['-', start + i, -1]));
      midB.forEach((_, j) => ops.push(['+', -1, start + j]));
    } else {
      const n = midA.length;
      const m = midB.length;
      const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1)
        for (let j = m - 1; j >= 0; j -= 1)
          table[i][j] =
            midA[i] === midB[j]
              ? table[i + 1][j + 1] + 1
              : Math.max(table[i + 1][j], table[i][j + 1]);
      let i = 0;
      let j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && midA[i] === midB[j]) {
          ops.push(['=', start + i, start + j]);
          i += 1;
          j += 1;
        } else if (j < m && (i === n || table[i][j + 1] >= table[i + 1][j])) {
          ops.push(['+', -1, start + j]);
          j += 1;
        } else {
          ops.push(['-', start + i, -1]);
          i += 1;
        }
      }
    }
    for (let k = 0; k < a.length - endA; k += 1) ops.push(['=', endA + k, endB + k]);

    const rows = [];
    let k = 0;
    while (k < ops.length) {
      if (ops[k][0] === '=') {
        rows.push({
          tipo: 'igual',
          esq: { n: ops[k][1] + 1, t: a[ops[k][1]] },
          dir: { n: ops[k][2] + 1, t: b[ops[k][2]] },
        });
        k += 1;
        continue;
      }
      const removed = [];
      const added = [];
      while (k < ops.length && ops[k][0] !== '=') {
        if (ops[k][0] === '-') removed.push(ops[k][1]);
        else added.push(ops[k][2]);
        k += 1;
      }
      const total = Math.max(removed.length, added.length);
      for (let p = 0; p < total; p += 1) {
        const left = p < removed.length ? { n: removed[p] + 1, t: a[removed[p]] } : null;
        const right = p < added.length ? { n: added[p] + 1, t: b[added[p]] } : null;
        rows.push({
          tipo: left && right ? 'mudou' : left ? 'tirou' : 'pos',
          esq: left,
          dir: right,
        });
      }
    }
    return rows;
  }

  function diffStats(rows) {
    let plus = 0;
    let minus = 0;
    for (const row of rows) {
      if (row.esq && row.tipo !== 'igual') minus += 1;
      if (row.dir && row.tipo !== 'igual') plus += 1;
    }
    return { plus, minus };
  }

  /* Junta trechos longos sem mudança, com um botão para abrir. */
  function foldRows(rows, expanded) {
    const out = [];
    let index = 0;
    while (index < rows.length) {
      if (rows[index].tipo !== 'igual') {
        out.push({ row: rows[index] });
        index += 1;
        continue;
      }
      let end = index;
      while (end < rows.length && rows[end].tipo === 'igual') end += 1;
      const run = rows.slice(index, end);
      const keepHead = index === 0 ? 0 : 3;
      const keepTail = end === rows.length ? 0 : 3;
      const hidden = run.length - keepHead - keepTail;
      if (hidden > 4 && !expanded.has(index)) {
        run.slice(0, keepHead).forEach((row) => out.push({ row }));
        out.push({ dobra: hidden, de: index });
        run.slice(run.length - keepTail).forEach((row) => out.push({ row }));
      } else run.forEach((row) => out.push({ row }));
      index = end;
    }
    return out;
  }

  function diffHtml(before, after, expanded) {
    const rows = lineDiff(before, after);
    const stats = diffStats(rows);
    const half = (cell, side, tipo) => {
      const mark = tipo === 'igual' || !cell ? '' : side === 'esq' ? '−' : '+';
      return `<div class="mcp-diff__meia mcp-diff__meia--${cell ? (tipo === 'igual' ? 'igual' : side === 'esq' ? 'tirou' : 'pos') : 'vazia'}" ${cell ? '' : 'aria-hidden="true"'}><span class="mcp-diff__n">${cell ? cell.n : ''}</span><span class="mcp-diff__marca" aria-hidden="true">${mark}</span><span class="mcp-diff__t">${cell ? esc(cell.t) || '&nbsp;' : ''}</span></div>`;
    };
    const lines = foldRows(rows, expanded)
      .map((item) =>
        item.dobra
          ? `<button type="button" class="mcp-diff__dobra" data-mcp-dobra="${item.de}">${ic('chevron-baixo')} Mostrar ${item.dobra} ${item.dobra === 1 ? 'linha igual' : 'linhas iguais'}</button>`
          : `<div class="mcp-diff__linha" data-tipo="${item.row.tipo}">${half(item.row.esq, 'esq', item.row.tipo)}${half(item.row.dir, 'dir', item.row.tipo)}</div>`,
      )
      .join('');
    return {
      stats,
      html: `<div class="mcp-diff" role="table" aria-label="Antes e depois"><div class="mcp-diff__cab" role="row"><span role="columnheader">Antes</span><span role="columnheader">Depois</span></div>${lines}</div>`,
    };
  }

  /* ---------- Tela de Atividade ---------- */
  const PERIODS = [
    ['hoje', 'Hoje'],
    ['7d', '7 dias'],
    ['30d', '30 dias'],
    ['tudo', 'Tudo'],
  ];

  function periodFrom(key) {
    const now = new Date();
    if (key === 'hoje')
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    if (key === '7d') return new Date(now.getTime() - 7 * 86400000).toISOString();
    if (key === '30d') return new Date(now.getTime() - 30 * 86400000).toISOString();
    return undefined;
  }

  function mountActivity(center) {
    if (!center) return;
    const view = {
      rows: [],
      authors: new Map(), // id -> author(), sempre com os conhecidos
      autor: '',
      periodo: 'tudo',
      pick: null,
      diff: null, // { id, antes, depois } | { id, erro }
      expanded: new Set(),
      loading: true,
      error: '',
      undoing: false,
      signature: '',
    };
    let timer = null;

    const remember = (id) => {
      if (id && !view.authors.has(id)) view.authors.set(id, author(id));
    };

    async function fetchRows() {
      const input = { limite: 200 };
      if (view.autor) input.autor = view.autor;
      const from = periodFrom(view.periodo);
      if (from) input.de = from;
      return tool('activity.list', input);
    }

    async function load({ quiet = false } = {}) {
      if (!quiet) {
        view.loading = true;
        view.error = '';
      }
      try {
        const rows = await fetchRows();
        const signature = rows.map((row) => row.id).join('|');
        const changed = signature !== view.signature;
        view.signature = signature;
        view.rows = rows;
        rows.forEach((row) => remember(row.autor));
        if (view.pick && !rows.some((row) => row.id === view.pick)) {
          view.pick = null;
          view.diff = null;
        }
        view.loading = false;
        if (quiet && !changed) return;
      } catch (error) {
        if (quiet) return;
        view.error = errorText(error);
        view.loading = false;
      }
      paint();
    }

    async function loadAuthors() {
      try {
        const all = await tool('activity.list', { limite: 200 });
        all.forEach((row) => remember(row.autor));
      } catch {
        /* o filtro cai nos autores já vistos */
      }
      try {
        const clients = await admin('mcp.clients.list');
        (clients || []).forEach((client) => remember(`mcp:${client.nome}`));
      } catch {
        /* sem acesso ao admin, só os autores da atividade */
      }
    }

    async function select(id) {
      view.pick = id;
      view.diff = null;
      view.expanded = new Set();
      paintDetail();
      paintList();
      const row = view.rows.find((item) => item.id === id);
      try {
        const result = await tool('activity.diff', { id });
        if (view.pick === id)
          view.diff = {
            id,
            antes: result.antes ?? null,
            depois: result.depois ?? null,
            notePath: row && row.notePath,
          };
      } catch (error) {
        if (view.pick === id) view.diff = { id, erro: errorText(error) };
      }
      paintDetail();
    }

    function filtersHtml() {
      const authors = [...view.authors.values()].sort((x, y) => {
        const order = { usuario: 0, sofi: 1, mcp: 2 };
        return order[x.tipo] - order[y.tipo] || x.nome.localeCompare(y.nome, 'pt-BR');
      });
      const chip = (id, label, who) =>
        `<button type="button" class="chip mcp-filtro${view.autor === id ? ' is-ativa' : ''}" data-mcp-autor="${esc(id)}" aria-pressed="${view.autor === id}">${who ? `<i class="mcp-ponto mcp-avatar--${who.cor}" aria-hidden="true"></i>` : ''}${esc(label)}</button>`;
      return `<div class="atividade__filtros" role="group" aria-label="Filtros">
        <div class="atividade__grupo" role="group" aria-label="Quem fez">${chip('', 'Todos', null)}${authors.map((who) => chip(who.id, who.nome, who)).join('')}</div>
        <div class="segmentado atividade__periodo" role="radiogroup" aria-label="Período">${PERIODS.map(([key, label]) => `<label class="segmentado__opcao"><input type="radio" name="atividade-periodo" value="${key}" ${view.periodo === key ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>
      </div>`;
    }

    function rowHtml(row) {
      const who = author(row.autor);
      const isUndo = row.tool === 'activity.undo' || /^Desfazer\b/i.test(row.label || '');
      const note = row.notePath ? String(row.notePath).replace(/\.md$/i, '').split('/').pop() : '';
      return `<li><button type="button" class="atividade__item${view.pick === row.id ? ' is-escolhida' : ''}" data-mcp-atividade-id="${esc(row.id)}" aria-pressed="${view.pick === row.id}">
        ${avatar(who)}
        <span class="atividade__texto"><b>${isUndo ? ic('desfazer', 'atividade__desfeito') : ''}${esc(row.label || row.tool)}</b>
          <span class="atividade__meta">${note ? `<span class="atividade__nota">${ic('nota')}${esc(note)}</span>` : ''}<span class="atividade__quem">${esc(who.nome)}${who.tipo === 'mcp' ? ' <em>MCP</em>' : ''}</span></span></span>
        <time datetime="${esc(row.quando)}" title="${esc(exact(row.quando))}">${esc(relative(row.quando))}</time>
      </button></li>`;
    }

    function listHtml() {
      if (view.loading && !view.rows.length)
        return '<p class="config__ajuda" role="status">Carregando a atividade…</p>';
      if (view.error)
        return `<div class="mcp-erro" role="alert">${ic('alerta')}<span>${esc(view.error)}</span><button type="button" class="btn btn--secundario btn--pequeno" data-mcp-recarregar>Tentar de novo</button></div>`;
      if (!view.rows.length) {
        const filtered = view.autor || view.periodo !== 'tudo';
        const art = host.illustration
          ? host.illustration(filtered ? 'busca-sem-resultado' : 'biblioteca-vazia', 140)
          : '';
        return filtered
          ? `<div class="vazio-ensina atividade__vazio" data-mcp-vazio>${art}<h2>Nada com esses filtros</h2><p>Tente outro período ou outra pessoa.</p><button type="button" class="btn btn--secundario" data-mcp-limpar>Limpar filtros</button></div>`
          : `<div class="vazio-ensina atividade__vazio" data-mcp-vazio>${art}<h2>Nenhuma atividade ainda</h2><p>Quando você, a Sofi ou um agente conectado por MCP criar ou editar uma nota, aparece aqui, com o antes e depois e o botão Desfazer.</p><button type="button" class="btn btn--secundario" data-mcp-config>${ic('mcp')} Conectar um agente</button></div>`;
      }
      let day = '';
      let html = '';
      for (const row of view.rows) {
        const label = dayLabel(row.quando);
        if (label !== day) {
          if (day) html += '</ul>';
          html += `<h3 class="atividade__dia">${esc(label)}</h3><ul class="atividade__lista">`;
          day = label;
        }
        html += rowHtml(row);
      }
      return `${html}</ul>`;
    }

    function detailHtml() {
      const row = view.rows.find((item) => item.id === view.pick);
      if (!row)
        return `<div class="atividade__escolha">${ic('linha-do-tempo')}<b>Escolha uma ação</b><p>Clique em um item da linha do tempo para ver como a nota ficou antes e depois.</p></div>`;
      const who = author(row.autor);
      const head = `<header class="atividade__cabeca">
        <div class="atividade__titulo">${avatar(who, 'mcp-avatar--grande')}<div><h2>${esc(row.label || row.tool)}</h2>
          <p><span>${esc(who.nome)}${who.tipo === 'mcp' ? ' · MCP' : ''}</span> · <time title="${esc(exact(row.quando))}">${esc(exact(row.quando))}</time>${row.notePath ? ` · <button type="button" class="atividade__link" data-mcp-abrir="${esc(row.notePath)}">${esc(row.notePath)}</button>` : ''}</p></div></div>
        <div class="atividade__acoes"><button type="button" class="btn btn--secundario" data-mcp-desfazer ${view.undoing ? 'disabled' : ''}>${ic('desfazer')} Desfazer</button></div>
      </header>`;
      const d = view.diff;
      let body;
      if (!d) body = '<p class="config__ajuda" role="status">Carregando o antes e depois…</p>';
      else if (d.erro)
        body = `<div class="mcp-erro" role="alert">${ic('alerta')}<span>${esc(d.erro)}</span></div>`;
      else if (d.antes == null && d.depois == null)
        body = `<div class="atividade__sem-diff">${ic('info')}<p>Esta ação não mudou o texto de uma nota, então não há antes e depois para mostrar. Você ainda pode desfazê-la.</p></div>`;
      else {
        const built = diffHtml(d.antes, d.depois, view.expanded);
        const note =
          d.antes == null
            ? 'A nota não existia antes: foi criada.'
            : d.depois == null
              ? 'A nota deixou de existir depois desta ação.'
              : '';
        body = `<div class="atividade__resumo"><span class="atividade__mais">+${built.stats.plus}</span><span class="atividade__menos">−${built.stats.minus}</span><span>${built.stats.plus + built.stats.minus === 0 ? 'Sem mudanças no texto' : 'linhas mudadas'}</span>${note ? `<span class="atividade__aviso-nota">${esc(note)}</span>` : ''}</div>${built.html}`;
      }
      return `${head}<div class="atividade__corpo-diff">${body}</div>`;
    }

    function paintList() {
      const list = center.querySelector('#atividade-lista');
      if (!list) return;
      list.innerHTML = listHtml();
      bindList();
      const filters = center.querySelector('#atividade-filtros');
      if (filters) {
        filters.innerHTML = filtersHtml();
        bindFilters();
      }
    }

    function paintDetail() {
      const detail = center.querySelector('#atividade-detalhe');
      if (!detail) return;
      detail.innerHTML = detailHtml();
      bindDetail();
    }

    function paint() {
      center.innerHTML = `<div class="atividade${view.pick ? ' tem-detalhe' : ''}">
        <div class="atividade__coluna">
          <header class="atividade__topo">
            <div><h2>Atividade</h2><p>Tudo o que você, a Sofi e os agentes conectados fizeram nas suas notas. Clique em um item para ver o antes e depois, e desfazer.</p></div>
            <div class="atividade__topo-acoes"><button type="button" class="btn btn--secundario btn--pequeno" data-mcp-atualizar>${ic('sincronizar')} Atualizar</button><button type="button" class="btn btn--secundario btn--pequeno" data-mcp-config>${ic('mcp')} Acesso por MCP</button></div>
          </header>
          <div id="atividade-filtros">${filtersHtml()}</div>
          <div class="atividade__rolagem" id="atividade-lista">${listHtml()}</div>
        </div>
        <section class="atividade__detalhe" id="atividade-detalhe" aria-label="Antes e depois">${detailHtml()}</section>
      </div>`;
      center.querySelector('.atividade').classList.toggle('tem-detalhe', Boolean(view.pick));
      bindFilters();
      bindList();
      bindDetail();
      center.querySelector('[data-mcp-atualizar]').onclick = () => load();
      center.querySelector('.atividade__topo [data-mcp-config]').onclick = () =>
        host.openMcpSettings && host.openMcpSettings();
    }

    function bindFilters() {
      center.querySelectorAll('[data-mcp-autor]').forEach((button) => {
        button.onclick = () => {
          view.autor = button.dataset.mcpAutor;
          view.pick = null;
          view.diff = null;
          load();
        };
      });
      center.querySelectorAll('input[name="atividade-periodo"]').forEach((input) => {
        input.onchange = () => {
          view.periodo = input.value;
          view.pick = null;
          view.diff = null;
          load();
        };
      });
    }

    function bindList() {
      center.querySelectorAll('[data-mcp-atividade-id]').forEach((button) => {
        button.onclick = () => {
          center.querySelector('.atividade')?.classList.add('tem-detalhe');
          select(button.dataset.mcpAtividadeId);
        };
      });
      center.querySelector('[data-mcp-recarregar]')?.addEventListener('click', () => load());
      center.querySelector('[data-mcp-limpar]')?.addEventListener('click', () => {
        view.autor = '';
        view.periodo = 'tudo';
        load();
      });
      center
        .querySelector('#atividade-lista [data-mcp-config]')
        ?.addEventListener('click', () => host.openMcpSettings && host.openMcpSettings());
    }

    function bindDetail() {
      center.querySelector('[data-mcp-abrir]')?.addEventListener('click', async (event) => {
        try {
          if (host.openNote) await host.openNote(event.currentTarget.dataset.mcpAbrir);
        } catch (error) {
          say(errorText(error), 'erro');
        }
      });
      center.querySelectorAll('[data-mcp-dobra]').forEach((button) => {
        button.onclick = () => {
          view.expanded.add(Number(button.dataset.mcpDobra));
          paintDetail();
        };
      });
      const undo = center.querySelector('[data-mcp-desfazer]');
      if (undo) undo.onclick = () => undoPicked();
    }

    async function undoPicked(force = false) {
      const row = view.rows.find((item) => item.id === view.pick);
      if (!row || view.undoing) return;
      view.undoing = true;
      paintDetail();
      let result;
      try {
        result = await tool('activity.undo', force ? { id: row.id, forcar: true } : { id: row.id });
      } catch (error) {
        view.undoing = false;
        paintDetail();
        say(`Não deu para desfazer: ${errorText(error)}`, 'erro');
        return;
      }
      view.undoing = false;
      if (result && result.erro === 'conflito') {
        paintDetail();
        const note = row.notePath ? String(row.notePath).replace(/\.md$/i, '') : 'A nota';
        const again = await confirmBox({
          titulo: 'A nota mudou depois desta ação',
          texto: `${note} foi alterada depois de “${row.label || row.tool}”. Se você desfizer assim mesmo, as mudanças mais novas se perdem e a nota volta ao que era antes desta ação.`,
          extra: `<div class="mcp-aviso mcp-aviso--dialogo">${ic('info')}<p>Dá para conferir o antes e depois ao lado antes de decidir. O desfazer aparece na Atividade e também pode ser desfeito.</p></div>`,
          confirmar: 'Desfazer assim mesmo',
          cancelar: 'Cancelar',
          perigo: true,
          classe: 'mcp-modal--conflito',
        });
        if (again) await undoPicked(true);
        return;
      }
      say(`Desfeito: ${row.label || row.tool}.`);
      view.pick = null;
      view.diff = null;
      try {
        if (typeof host.afterUndo === 'function') await host.afterUndo(row);
      } catch {
        /* o app se recompõe sozinho no próximo passo */
      }
      await load();
    }

    paint();
    load();
    loadAuthors().then(() => {
      if (center.isConnected) paintList();
    });
    /* Um agente pode agir enquanto a tela está aberta: confere de tempos em tempos. */
    clearInterval(root.__mcpAtividadeTimer);
    timer = setInterval(() => {
      if (!center.isConnected || !center.querySelector('.atividade')) {
        clearInterval(timer);
        return;
      }
      if (openModals === 0 && !view.undoing) load({ quiet: true });
    }, 8000);
    root.__mcpAtividadeTimer = timer;
  }

  root.SophyMcp = { init, mountSettings, mountActivity, lineDiff, relative, author };
})(window);
