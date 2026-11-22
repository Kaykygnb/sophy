/* Configurações > Sofi e IA: provedores, perfis, modelo, raciocínio, teste de conexão e prompt.
 * Tudo fala com o motor por `window.sophy.tool(nome, input)` (agent.providers, agent.config.*,
 * agent.models, agent.testConnection, agent.systemPrompt). A chave só trafega daqui para o main,
 * nunca volta. Este arquivo só declara funções: os globais do app.js (state, tool, icon,
 * toast, escapeHtml, confirmDialog…) são lidos na hora da chamada. */

/* Aparência de cada provedor. O motor manda id, nome e endpoint; aqui entram o monograma, a cor e
 * uma linha curta que ajuda a pessoa a reconhecer o serviço. */
const SOFI_PROVEDORES = {
  openai: { nome: 'OpenAI', mono: 'OA', hue: 165, dica: 'GPT e série o' },
  anthropic: { nome: 'Anthropic', mono: 'AN', hue: 22, dica: 'Claude' },
  gemini: { nome: 'Gemini', mono: 'GE', hue: 218, dica: 'Google' },
  openrouter: { nome: 'OpenRouter', mono: 'OR', hue: 268, dica: 'Vários modelos numa chave' },
  nvidia: { nome: 'NVIDIA NIM', mono: 'NV', hue: 96, dica: 'NIM' },
  groq: { nome: 'Groq', mono: 'GQ', hue: 32, dica: 'Respostas rápidas' },
  xai: { nome: 'xAI', mono: 'XA', hue: 250, dica: 'Grok' },
  ollama: { nome: 'Ollama', mono: 'OL', hue: 48, dica: 'Roda no seu computador' },
  personalizado: { nome: 'Personalizado', mono: '', hue: 0, dica: 'Endpoint compatível com OpenAI' },
};

const SOFI_ESFORCOS = [
  ['baixo', 'Baixo'],
  ['medio', 'Médio'],
  ['alto', 'Alto'],
];

const SOFI_TESTE_ERROS = {
  sem_chave: ['Falta a chave de acesso', 'Cole a chave do provedor no campo acima e teste de novo.'],
  chave_invalida: ['O provedor não aceitou a chave', 'Confira se ela foi copiada inteira e se ainda está ativa no painel do provedor.'],
  endpoint_inalcancavel: ['Não consegui chegar ao provedor', 'Confira o endereço (endpoint) e a sua conexão. No Ollama, veja se o aplicativo está aberto.'],
  modelo_inexistente: ['Esse modelo não existe aí', 'Escolha outro modelo na lista ou confira o nome digitado.'],
  erro_desconhecido: ['Algo deu errado no teste', 'Tente de novo em instantes. Se repetir, confira o endpoint e o modelo.'],
};

const sofiCfg = { providers: null, config: null, form: null, models: null, fonte: null, loadingModels: false, result: null, testing: false, saving: false, modo: null };

function sofiProvMeta(id) {
  const found = SOFI_PROVEDORES[id];
  if (found) return found;
  return { nome: id || 'Provedor', mono: String(id || '?').slice(0, 2).toUpperCase(), hue: 230, dica: '' };
}

function sofiMarca(id, extra = '') {
  const meta = sofiProvMeta(id);
  if (id === 'personalizado') return `<span class="sofi-marca sofi-marca--neutra ${extra}" aria-hidden="true">${icon('configuracoes')}</span>`;
  return `<span class="sofi-marca ${extra}" style="--h:${meta.hue}" aria-hidden="true">${escapeHtml(meta.mono)}</span>`;
}

function sofiProvedoresHtml(onde = 'config') {
  const providers = sofiCfg.providers || Object.keys(SOFI_PROVEDORES).map((id) => ({ id, nome: SOFI_PROVEDORES[id].nome }));
  return providers
    .map((item) => {
      const meta = sofiProvMeta(item.id);
      const nome = meta.nome || item.nome;
      const marked = onde === 'config' && sofiCfg.form?.provider === item.id ? ' is-escolhido' : '';
      return `<button type="button" class="sofi-prov${marked}" data-provedor="${escapeHtml(item.id)}" aria-pressed="${marked ? 'true' : 'false'}" title="${escapeHtml(`${nome}${meta.dica ? ` · ${meta.dica}` : ''}`)}">${sofiMarca(item.id)}<span class="sofi-prov__texto"><b>${escapeHtml(nome)}</b><small>${escapeHtml(meta.dica)}</small></span></button>`;
    })
    .join('');
}

function sofiConfigSection() {
  return `<section class="config__secao" id="cfg-sofi" data-secao="sofi"><h3>Sofi e IA</h3>
    <div class="config__sofi">${ilustracao('agente-desconectado', 120)}<div><b id="cfg-agente-estado">Verificando a Sofi…</b><p>A Sofi lê só esta biblioteca, usa as mesmas ferramentas que você e grava um ponto antes de agir.</p></div></div>
    <div class="sofi-cfg" id="sofi-cfg" aria-live="polite"><p class="config__ajuda">Carregando os provedores…</p></div>
    ${cfgSoon('Ferramentas externas (MCP)', 'Conectar a Sofi a agenda, e-mail e outros apps.', '<button type="button" class="btn btn--secundario" disabled>Conectar</button>')}
    ${cfgSoon('Permissões da Sofi', 'Definir o que ela pode criar, editar ou apagar.', '<button type="button" class="btn btn--secundario" disabled>Ajustar</button>')}
  </section>`;
}

function sofiPerfilAtivo() {
  const config = sofiCfg.config;
  return config?.perfis?.find((item) => item.id === config.ativo) || null;
}

function sofiModoCofre(config) {
  const raw = config?.modo ?? config?.modoChave ?? config?.armazenamento ?? null;
  const perfis = config?.perfis || [];
  if (raw === 'arquivo') return 'arquivo';
  if (perfis.some((item) => item.temChave && (item.modo === 'arquivo' || item.modoChave === 'arquivo'))) return 'arquivo';
  return raw || null;
}

async function sofiCarregarConfig() {
  const [providers, config] = await Promise.all([tool('agent.providers', {}), tool('agent.config.get', {})]);
  sofiCfg.providers = providers;
  sofiCfg.config = config;
  sofiCfg.modo = sofiModoCofre(config);
  return config;
}

function sofiPerfisHtml() {
  const config = sofiCfg.config;
  const perfis = config?.perfis || [];
  if (!perfis.length) {
    return `<div class="sofi-cfg__vazio">${icon('chave')}<div><b>Nenhum provedor conectado ainda</b><p>Escolha um serviço abaixo e cole a chave dele. Você pode ter vários perfis e trocar quando quiser.</p></div></div>`;
  }
  return `<ul class="sofi-perfis" aria-label="Perfis da Sofi">${perfis
    .map((item) => {
      const ativo = item.id === config.ativo;
      const meta = sofiProvMeta(item.provider);
      const precisa = (sofiCfg.providers || []).find((p) => p.id === item.provider)?.precisaChave !== false;
      const chave = !precisa ? 'sem chave, local' : item.temChave ? 'chave salva ✓' : 'sem chave';
      const rac = item.raciocinio?.ativo ? ` · raciocínio${item.raciocinio.esforco ? ` ${SOFI_ESFORCOS.find((e) => e[0] === item.raciocinio.esforco)?.[1].toLowerCase() || ''}` : ''}` : '';
      return `<li class="sofi-perfil${ativo ? ' is-ativo' : ''}" data-perfil="${escapeHtml(item.id)}">${sofiMarca(item.provider)}<div class="sofi-perfil__texto"><b>${escapeHtml(item.nome)}${ativo ? ' <span class="chip chip--acento">Ativo</span>' : ''}</b><span>${escapeHtml(meta.nome)} · ${escapeHtml(item.model)}${escapeHtml(rac)}</span><span class="sofi-perfil__chave${item.temChave || !precisa ? ' is-ok' : ''}">${escapeHtml(chave)}</span></div><div class="sofi-perfil__acoes">${ativo ? '' : `<button type="button" class="btn btn--secundario btn--pequeno" data-perfil-ativar="${escapeHtml(item.id)}">Ativar</button>`}<button type="button" class="btn btn--icone" data-perfil-editar="${escapeHtml(item.id)}" aria-label="Editar o perfil ${escapeHtml(item.nome)}" title="Editar">${icon('editar')}</button><button type="button" class="btn btn--icone" data-perfil-remover="${escapeHtml(item.id)}" aria-label="Remover o perfil ${escapeHtml(item.nome)}" title="Remover">${icon('lixeira')}</button></div></li>`;
    })
    .join('')}</ul>`;
}

function sofiAvisoModoHtml() {
  if (sofiCfg.modo !== 'arquivo') return '';
  return `<p class="sofi-cfg__aviso" role="note">${icon('alerta')}<span>Este computador não tem cofre do sistema. As chaves ficam num arquivo da sua pasta de usuário, e quem abrir essa pasta consegue lê-las.</span></p>`;
}

function paintSofiConfig() {
  const host = $('#sofi-cfg');
  if (!host) return;
  host.innerHTML = `${sofiAvisoModoHtml()}
    <h4>Seus perfis</h4>
    ${sofiPerfisHtml()}
    <h4>${sofiCfg.config?.perfis?.length ? 'Adicionar outro provedor' : 'Escolha o provedor'}</h4>
    <div class="sofi-provedores" role="group" aria-label="Provedores de IA">${sofiProvedoresHtml()}</div>
    <div class="sofi-form-slot" id="sofi-form-slot"></div>
    <div class="config__acoes sofi-cfg__rodape"><button type="button" class="btn btn--secundario" id="sofi-ver-prompt">${icon('terminal')} Ver prompt da Sofi</button><span class="sofi-cfg__nota">O texto que a Sofi recebe antes de cada conversa.</span></div>`;
  if (sofiCfg.form) paintSofiForm();
  host.querySelectorAll('[data-provedor]').forEach((button) => {
    button.onclick = () => sofiAbrirForm({ provider: button.dataset.provedor });
  });
  host.querySelectorAll('[data-perfil-ativar]').forEach((button) => {
    button.onclick = () => sofiAtivarPerfil(button.dataset.perfilAtivar);
  });
  host.querySelectorAll('[data-perfil-editar]').forEach((button) => {
    button.onclick = () => sofiAbrirForm({ id: button.dataset.perfilEditar });
  });
  host.querySelectorAll('[data-perfil-remover]').forEach((button) => {
    button.onclick = () => sofiRemoverPerfil(button.dataset.perfilRemover);
  });
  $('#sofi-ver-prompt').onclick = () => sofiAbrirPrompt();
}

/* ---------- formulário do perfil ---------- */

function sofiAbrirForm({ id = null, provider = null, recemSalvo = false }) {
  const config = sofiCfg.config;
  const perfil = id ? config.perfis.find((item) => item.id === id) : null;
  const prov = (sofiCfg.providers || []).find((item) => item.id === (perfil?.provider || provider));
  if (!prov) return;
  const meta = sofiProvMeta(prov.id);
  const raciocinio = perfil?.raciocinio || null;
  sofiCfg.form = {
    id: perfil?.id || null,
    provider: prov.id,
    nome: perfil?.nome || meta.nome || prov.nome,
    endpoint: perfil ? perfil.endpoint : prov.endpointPadrao,
    model: perfil?.model || prov.modelosSugeridos?.[0] || '',
    modelManual: false,
    recemSalvo,
    temChave: Boolean(perfil?.temChave),
    ativar: perfil ? perfil.id === config.ativo : true,
    racAtivo: Boolean(raciocinio?.ativo),
    esforco: raciocinio?.esforco || 'medio',
    orcamento: raciocinio?.orcamentoTokens ? String(raciocinio.orcamentoTokens) : '',
  };
  sofiCfg.result = null;
  sofiCfg.models = null;
  sofiCfg.fonte = null;
  paintSofiConfig();
  $('#sofi-form-slot')?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'nearest' });
  if (perfil) sofiCarregarModelos(perfil.id);
  else {
    sofiCfg.models = (prov.modelosSugeridos || []).map((modelo) => ({ id: modelo, nome: modelo, raciocinio: false, esforcos: null, pensamentoOrcamento: false }));
    sofiCfg.fonte = 'novo';
    paintSofiModelo();
  }
  $('#sofi-f-nome')?.focus({ preventScroll: true });
}

function sofiFecharForm() {
  sofiCfg.form = null;
  sofiCfg.result = null;
  paintSofiConfig();
}

function sofiLerForm() {
  const form = sofiCfg.form;
  if (!form) return null;
  const val = (id) => ($(`#${id}`)?.value ?? '').trim();
  return {
    ...form,
    nome: val('sofi-f-nome') || form.nome,
    endpoint: val('sofi-f-endpoint'),
    chave: $('#cfg-agente-chave')?.value.trim() || '',
    model: form.model,
    ativar: Boolean($('#sofi-f-ativar')?.checked),
  };
}

function sofiCapacidade() {
  const form = sofiCfg.form;
  if (!form) return null;
  return (sofiCfg.models || []).find((item) => item.id === form.model) || null;
}

function sofiRaciocinioDoForm() {
  const cap = sofiCapacidade();
  if (!cap?.raciocinio) return undefined;
  const form = sofiCfg.form;
  const out = { ativo: Boolean(form.racAtivo) };
  if (out.ativo && cap.esforcos?.length) out.esforco = cap.esforcos.includes(form.esforco) ? form.esforco : cap.esforcos[0];
  const budget = Number(form.orcamento);
  if (out.ativo && cap.pensamentoOrcamento && Number.isFinite(budget) && budget > 0) out.orcamentoTokens = Math.round(budget);
  return out;
}

function paintSofiForm() {
  const slot = $('#sofi-form-slot');
  const form = sofiCfg.form;
  if (!slot || !form) return;
  const prov = (sofiCfg.providers || []).find((item) => item.id === form.provider) || {};
  const meta = sofiProvMeta(form.provider);
  const titulo = form.id ? `Editar ${form.nome}` : `Conectar ${meta.nome}`;
  const precisaChave = prov.precisaChave !== false;
  const placeholderEndpoint = form.provider === 'personalizado' ? 'https://servidor.exemplo/v1' : prov.endpointPadrao || '';
  slot.innerHTML = `<form class="sofi-form" id="sofi-form" autocomplete="off" aria-label="${escapeHtml(titulo)}">
    <header class="sofi-form__topo">${sofiMarca(form.provider, 'sofi-marca--grande')}<div><h4>${escapeHtml(titulo)}</h4><p>${escapeHtml(meta.dica || 'Serviço de IA')}${form.provider === 'ollama' ? '. Precisa do Ollama aberto neste computador.' : ''}</p></div><button type="button" class="btn btn--icone" id="sofi-f-fechar" aria-label="Fechar o formulário" title="Fechar">${icon('fechar')}</button></header>
    <label class="sofi-campo-cfg"><span>Nome do perfil</span><input id="sofi-f-nome" type="text" maxlength="80" value="${escapeHtml(form.nome)}" placeholder="${escapeHtml(meta.nome)}" /></label>
    <label class="sofi-campo-cfg"><span>Endpoint <em>${form.provider === 'personalizado' ? '(obrigatório, http ou https)' : '(já vem preenchido)'}</em></span><span class="sofi-campo-cfg__linha"><input id="sofi-f-endpoint" type="text" inputmode="url" spellcheck="false" value="${escapeHtml(form.endpoint)}" placeholder="${escapeHtml(placeholderEndpoint)}" />${prov.endpointPadrao ? `<button type="button" class="btn btn--fantasma btn--pequeno" id="sofi-f-endpoint-padrao" ${form.endpoint === prov.endpointPadrao ? 'hidden' : ''}>Restaurar padrão</button>` : ''}</span></label>
    <div class="sofi-campo-cfg" id="sofi-f-chave-bloco">${precisaChave ? sofiChaveHtml(form) : `<span>Chave de acesso</span><p class="sofi-campo-cfg__nota">${escapeHtml(meta.nome)} roda no seu computador e não pede chave.</p><input id="cfg-agente-chave" type="hidden" value="" />`}</div>
    <div class="sofi-campo-cfg" id="sofi-f-modelo-bloco"></div>
    <div class="sofi-racio" id="sofi-f-racio" hidden></div>
    <label class="alternar sofi-form__ativar"><input type="checkbox" id="sofi-f-ativar" ${form.ativar ? 'checked' : ''} /><span>Usar este perfil na Sofi agora</span></label>
    <div class="sofi-teste" id="sofi-f-teste" role="status" aria-live="polite"></div>
    <div class="sofi-form__acoes"><button type="button" class="btn btn--fantasma" id="sofi-f-cancelar">Cancelar</button><button type="button" class="btn btn--secundario" id="sofi-f-testar">${icon('ligar')} Testar conexão</button><button type="submit" class="btn btn--primario" id="sofi-f-salvar">${form.id ? 'Salvar alterações' : 'Salvar perfil'}</button></div>
  </form>`;
  $('#sofi-f-fechar').onclick = sofiFecharForm;
  $('#sofi-f-cancelar').onclick = sofiFecharForm;
  $('#sofi-form').onsubmit = (event) => {
    event.preventDefault();
    sofiSalvarForm();
  };
  $('#sofi-f-testar').onclick = () => sofiTestarForm();
  const endpoint = $('#sofi-f-endpoint');
  endpoint.oninput = () => {
    const reset = $('#sofi-f-endpoint-padrao');
    if (reset) reset.hidden = endpoint.value.trim() === prov.endpointPadrao;
  };
  const reset = $('#sofi-f-endpoint-padrao');
  if (reset)
    reset.onclick = () => {
      endpoint.value = prov.endpointPadrao;
      reset.hidden = true;
      endpoint.focus();
    };
  bindSofiChave();
  paintSofiModelo();
  paintSofiTeste();
}

function sofiChaveHtml(form) {
  const salva = form.temChave;
  return `<span>Chave de acesso ${salva ? '<span class="chip chip--acento sofi-chave-ok" id="sofi-f-chave-ok">chave salva ✓</span>' : ''}</span>
    <span class="sofi-campo-cfg__linha"><span class="sofi-senha"><input id="cfg-agente-chave" type="password" autocomplete="new-password" spellcheck="false" aria-label="Chave de acesso" placeholder="${salva ? 'Cole uma nova chave para trocar' : 'Cole a chave aqui'}" /><button type="button" class="btn btn--icone sofi-senha__ver" id="sofi-f-ver" aria-label="Mostrar a chave" aria-pressed="false" title="Mostrar ou ocultar">${icon('visivel')}</button></span>${salva ? '<button type="button" class="btn btn--fantasma btn--pequeno" id="sofi-f-chave-apagar">Apagar chave</button>' : ''}</span>
    <p class="sofi-campo-cfg__nota">${salva ? 'A chave guardada não aparece mais aqui. Deixe em branco para manter.' : 'Fica no cofre do sistema e nunca entra na biblioteca.'}</p>`;
}

function bindSofiChave() {
  const ver = $('#sofi-f-ver');
  const input = $('#cfg-agente-chave');
  if (ver && input)
    ver.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      ver.setAttribute('aria-pressed', show ? 'true' : 'false');
      ver.setAttribute('aria-label', show ? 'Ocultar a chave' : 'Mostrar a chave');
      ver.innerHTML = icon(show ? 'oculto' : 'visivel');
    };
  const apagar = $('#sofi-f-chave-apagar');
  if (apagar)
    apagar.onclick = async () => {
      const form = sofiCfg.form;
      if (!form?.id) return;
      if (!(await confirmDialog('Apagar a chave deste perfil do cofre? Você pode colar outra depois.', { confirm: 'Apagar chave', danger: true }))) return;
      try {
        const feito = await tool('agent.config.set', { id: form.id, provider: form.provider, model: form.model, apiKey: '' });
        sofiCfg.config = { ...sofiCfg.config, ...feito };
        form.temChave = false;
        toast('Chave apagada do cofre.');
        paintSofiConfig();
        sofiDepoisDeMudar();
      } catch (error) {
        toast(`Não deu para apagar: ${error.message}`, 'erro');
      }
    };
}

async function sofiCarregarModelos(id) {
  sofiCfg.loadingModels = true;
  paintSofiModelo();
  try {
    const feito = await tool('agent.models', { id });
    if (sofiCfg.form?.id !== id) return;
    sofiCfg.models = feito.models || [];
    sofiCfg.fonte = feito.fonte || 'sugeridos';
  } catch {
    sofiCfg.models = sofiCfg.models || [];
    sofiCfg.fonte = 'sugeridos';
  }
  sofiCfg.loadingModels = false;
  paintSofiModelo();
}

function sofiModeloRotulo(item) {
  const base = item.nome && item.nome !== item.id ? `${item.nome} · ${item.id}` : item.id;
  return item.raciocinio ? `${base} (raciocínio)` : base;
}

function paintSofiModelo() {
  const bloco = $('#sofi-f-modelo-bloco');
  const form = sofiCfg.form;
  if (!bloco || !form) return;
  const models = sofiCfg.models || [];
  const naLista = models.some((item) => item.id === form.model);
  const manual = form.modelManual || (!naLista && Boolean(form.model)) || !models.length;
  const selo = sofiCfg.fonte === 'sugeridos' ? '<span class="sofi-selo" title="Não consegui consultar o provedor agora. Estes são os modelos que o Sophy sugere.">lista sugerida</span>' : '';
  const dica =
    sofiCfg.fonte === 'novo'
      ? 'Salve o perfil e eu busco a lista completa do provedor, com as opções de raciocínio de cada modelo.'
      : form.recemSalvo && !sofiCfg.loadingModels
        ? 'Perfil salvo. Esta é a lista do provedor: se o seu modelo raciocina, as opções aparecem logo abaixo.'
        : '';
  const opcoes = models.map((item) => `<option value="${escapeHtml(item.id)}" ${!manual && item.id === form.model ? 'selected' : ''}>${escapeHtml(sofiModeloRotulo(item))}</option>`).join('');
  bloco.innerHTML = `<span>Modelo ${selo}${sofiCfg.loadingModels ? '<span class="sofi-selo sofi-selo--carregando">buscando a lista…</span>' : ''}</span>
    <span class="sofi-campo-cfg__linha">${models.length ? `<select id="sofi-f-modelo" aria-label="Modelo">${opcoes}<option value="__outro__" ${manual ? 'selected' : ''}>Outro modelo… (digitar)</option></select>` : ''}${form.id ? `<button type="button" class="btn btn--fantasma btn--pequeno" id="sofi-f-modelos-atualizar" ${sofiCfg.loadingModels ? 'disabled' : ''}>${icon('sincronizar')} Atualizar lista</button>` : ''}</span>
    <input id="sofi-f-modelo-manual" type="text" spellcheck="false" aria-label="Nome do modelo" placeholder="Nome do modelo, como o provedor escreve" value="${escapeHtml(manual ? form.model : '')}" ${manual ? '' : 'hidden'} />
    ${dica ? `<p class="sofi-campo-cfg__nota">${escapeHtml(dica)}</p>` : ''}`;
  const select = $('#sofi-f-modelo');
  const input = $('#sofi-f-modelo-manual');
  if (select)
    select.onchange = () => {
      if (select.value === '__outro__') {
        form.modelManual = true;
        input.hidden = false;
        input.focus();
        form.model = input.value.trim();
      } else {
        form.modelManual = false;
        input.hidden = true;
        form.model = select.value;
      }
      paintSofiRacio();
    };
  input.oninput = () => {
    form.model = input.value.trim();
    paintSofiRacio();
  };
  const refresh = $('#sofi-f-modelos-atualizar');
  if (refresh) refresh.onclick = () => sofiCarregarModelos(form.id);
  paintSofiRacio();
}

function paintSofiRacio() {
  const box = $('#sofi-f-racio');
  const form = sofiCfg.form;
  if (!box || !form) return;
  const cap = sofiCapacidade();
  if (!cap?.raciocinio) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  const esforcos = SOFI_ESFORCOS.filter(([id]) => cap.esforcos?.includes(id));
  if (esforcos.length && !esforcos.some(([id]) => id === form.esforco)) form.esforco = esforcos[0][0];
  box.innerHTML = `<label class="alternar"><input type="checkbox" id="sofi-f-rac-ativo" ${form.racAtivo ? 'checked' : ''} /><span>Deixar o modelo pensar antes de responder</span></label>
    <p class="sofi-campo-cfg__nota">Este modelo sabe raciocinar. Você vê as etapas na abinha “Pensamento”, no chat.</p>
    <div class="sofi-racio__opcoes" ${form.racAtivo ? '' : 'hidden'}>
      ${esforcos.length ? `<div class="sofi-campo-cfg"><span id="sofi-f-esforco-rotulo">Nível de esforço</span><div class="sofi-seg" role="radiogroup" aria-labelledby="sofi-f-esforco-rotulo">${esforcos.map(([id, nome]) => `<button type="button" role="radio" aria-checked="${form.esforco === id}" data-esforco="${id}">${nome}</button>`).join('')}</div><p class="sofi-campo-cfg__nota">Mais esforço pensa mais fundo, mas demora mais e custa mais.</p></div>` : ''}
      ${cap.pensamentoOrcamento ? `<label class="sofi-campo-cfg"><span>Orçamento de pensamento <em>(tokens, opcional)</em></span><input id="sofi-f-orcamento" type="number" min="256" step="256" inputmode="numeric" placeholder="Automático" value="${escapeHtml(form.orcamento)}" /></label>` : ''}
    </div>`;
  const toggle = $('#sofi-f-rac-ativo');
  toggle.onchange = () => {
    form.racAtivo = toggle.checked;
    box.querySelector('.sofi-racio__opcoes').hidden = !toggle.checked;
  };
  box.querySelectorAll('[data-esforco]').forEach((button) => {
    button.onclick = () => {
      form.esforco = button.dataset.esforco;
      box.querySelectorAll('[data-esforco]').forEach((other) => other.setAttribute('aria-checked', other === button ? 'true' : 'false'));
    };
  });
  const budget = $('#sofi-f-orcamento');
  if (budget) budget.oninput = () => (form.orcamento = budget.value.trim());
}

function sofiMensagemTeste(result) {
  if (result.ok) return null;
  const [titulo, texto] = SOFI_TESTE_ERROS[result.error] || SOFI_TESTE_ERROS.erro_desconhecido;
  return { titulo, texto };
}

function paintSofiTeste() {
  const box = $('#sofi-f-teste');
  if (!box) return;
  const state_ = sofiCfg.result;
  const botao = $('#sofi-f-testar');
  if (botao) botao.disabled = sofiCfg.testing;
  if (sofiCfg.testing) {
    box.className = 'sofi-teste is-testando';
    box.innerHTML = `<span class="sofi-teste__icone">${icon('carregando')}</span><div><b>Testando a conexão…</b><p>Mando uma mensagem curta para o modelo.</p></div>`;
    return;
  }
  if (!state_) {
    box.className = 'sofi-teste';
    box.innerHTML = '';
    return;
  }
  if (state_.ok) {
    box.className = 'sofi-teste is-ok';
    box.innerHTML = `<span class="sofi-teste__icone">${icon('check')}</span><div><b>Conectou</b><p>${escapeHtml(state_.model || 'O modelo')} respondeu em ${Number(state_.latencyMs) >= 1000 ? `${(state_.latencyMs / 1000).toFixed(1).replace('.', ',')} s` : `${Math.round(state_.latencyMs || 0)} ms`}.${state_.salvou ? ' As alterações foram salvas antes do teste.' : ''}</p></div>`;
    return;
  }
  const mensagem = sofiMensagemTeste(state_);
  box.className = 'sofi-teste is-erro';
  box.innerHTML = `<span class="sofi-teste__icone">${icon('erro')}</span><div><b>${escapeHtml(mensagem.titulo)}</b><p>${escapeHtml(mensagem.texto)}</p>${state_.mensagem && state_.error === 'erro_desconhecido' ? `<small>${escapeHtml(String(state_.mensagem).slice(0, 200))}</small>` : ''}</div>`;
}

function sofiValidarForm(form) {
  if (!form.model) return 'Escolha ou digite o modelo antes de continuar.';
  if (form.provider === 'personalizado' && !/^https?:\/\/\S+$/i.test(form.endpoint)) return 'O provedor personalizado precisa de um endpoint que comece com http:// ou https://.';
  if (form.endpoint && !/^https?:\/\/\S+$/i.test(form.endpoint)) return 'O endpoint precisa começar com http:// ou https://.';
  return '';
}

async function sofiGravarPerfil(form, { ativar }) {
  const payload = { provider: form.provider, nome: form.nome, endpoint: form.endpoint, model: form.model };
  if (form.id) payload.id = form.id;
  if (ativar !== undefined) payload.ativar = ativar;
  const racio = sofiRaciocinioDoForm();
  if (racio) payload.raciocinio = racio;
  if (form.chave) payload.apiKey = form.chave;
  const feito = await tool('agent.config.set', payload);
  sofiCfg.config = { ...sofiCfg.config, ativo: feito.ativo, perfis: feito.perfis };
  return feito;
}

async function sofiSalvarForm() {
  const form = sofiLerForm();
  if (!form || sofiCfg.saving) return;
  const erro = sofiValidarForm(form);
  if (erro) {
    sofiCfg.result = { ok: false, error: 'erro_desconhecido', mensagem: erro };
    sofiAvisoCampo(erro);
    return;
  }
  sofiCfg.saving = true;
  const botao = $('#sofi-f-salvar');
  if (botao) botao.disabled = true;
  try {
    const feito = await sofiGravarPerfil(form, { ativar: form.ativar ? true : undefined });
    const novo = !form.id;
    toast(`Perfil “${form.nome}” salvo.`);
    sofiCfg.form = null;
    sofiCfg.result = null;
    paintSofiConfig();
    if (novo) sofiAbrirForm({ id: feito.id, recemSalvo: true });
    sofiDepoisDeMudar();
  } catch (error) {
    sofiAvisoCampo(`Não deu para salvar: ${error.message}`);
  } finally {
    sofiCfg.saving = false;
    const again = $('#sofi-f-salvar');
    if (again) again.disabled = false;
  }
}

function sofiAvisoCampo(texto) {
  const box = $('#sofi-f-teste');
  if (!box) return;
  box.className = 'sofi-teste is-erro';
  box.innerHTML = `<span class="sofi-teste__icone">${icon('erro')}</span><div><b>${escapeHtml(texto)}</b></div>`;
}

async function sofiTestarForm() {
  const form = sofiLerForm();
  if (!form || sofiCfg.testing) return;
  const erro = sofiValidarForm(form);
  if (erro) {
    sofiAvisoCampo(erro);
    return;
  }
  sofiCfg.testing = true;
  sofiCfg.result = null;
  paintSofiTeste();
  const racio = sofiRaciocinioDoForm();
  let salvou = false;
  try {
    let result;
    const salvo = form.id ? sofiCfg.config.perfis.find((item) => item.id === form.id) : null;
    if (!salvo || form.chave) {
      const payload = { provider: form.provider, model: form.model };
      if (form.endpoint) payload.endpoint = form.endpoint;
      if (form.chave) payload.apiKey = form.chave;
      if (racio) payload.raciocinio = racio;
      result = await tool('agent.testConnection', payload);
    } else {
      if (form.endpoint !== salvo.endpoint || form.model !== salvo.model) {
        await sofiGravarPerfil(form, {});
        salvou = true;
        sofiDepoisDeMudar();
      }
      const payload = { id: form.id };
      if (racio) payload.raciocinio = racio;
      result = await tool('agent.testConnection', payload);
    }
    sofiCfg.result = { ...result, salvou };
  } catch (error) {
    sofiCfg.result = { ok: false, error: 'erro_desconhecido', mensagem: error.message };
  }
  sofiCfg.testing = false;
  paintSofiTeste();
}

/* ---------- perfis ---------- */

async function sofiAtivarPerfil(id) {
  try {
    const feito = await tool('agent.config.activate', { id });
    sofiCfg.config = { ...sofiCfg.config, ativo: feito.ativo, perfis: feito.perfis };
    const perfil = sofiPerfilAtivo();
    toast(`${perfil ? `“${perfil.nome}”` : 'O perfil'} agora é o da Sofi.`);
    paintSofiConfig();
    sofiDepoisDeMudar();
  } catch (error) {
    toast(`Não deu para ativar: ${error.message}`, 'erro');
  }
}

async function sofiRemoverPerfil(id) {
  const perfil = sofiCfg.config.perfis.find((item) => item.id === id);
  if (!perfil) return;
  if (!(await confirmDialog(`Remover o perfil “${perfil.nome}”? A chave guardada para ele também é apagada.`, { confirm: 'Remover perfil', danger: true }))) return;
  try {
    const feito = await tool('agent.config.remove', { id });
    sofiCfg.config = { ...sofiCfg.config, ativo: feito.ativo, perfis: feito.perfis };
    if (sofiCfg.form?.id === id) sofiCfg.form = null;
    toast(`Perfil “${perfil.nome}” removido.`);
    paintSofiConfig();
    sofiDepoisDeMudar();
  } catch (error) {
    toast(`Não deu para remover: ${error.message}`, 'erro');
  }
}

/* O chat precisa saber do modelo ativo e do estado da chave assim que algo muda aqui. */
function sofiDepoisDeMudar() {
  syncAgentStatus?.();
  if (typeof refreshSofiModel === 'function') refreshSofiModel();
  if (typeof refreshSofiKey === 'function') refreshSofiKey();
}

/* ---------- prompt ---------- */

async function sofiAbrirPrompt(modo = 'agente') {
  const overlay = $('#overlay');
  overlay.hidden = false;
  overlay.innerHTML = `<div class="menu menu-flutuante dialogo sofi-prompt" role="dialog" aria-modal="true" aria-labelledby="sofi-prompt-titulo">
    <header class="sofi-prompt__topo"><div><h3 id="sofi-prompt-titulo" class="dialogo__titulo">Prompt da Sofi</h3><p>O que ela lê antes de cada conversa: quem é, como o Sophy funciona e o que pode fazer.</p></div><button type="button" class="btn btn--icone" id="sofi-prompt-fechar" aria-label="Fechar" title="Fechar">${icon('fechar')}</button></header>
    <div class="sofi-seg sofi-prompt__modos" role="radiogroup" aria-label="Modo">${['pergunta', 'agente'].map((id) => `<button type="button" role="radio" aria-checked="${modo === id}" data-prompt-modo="${id}">${id === 'agente' ? 'Modo Agente' : 'Modo Pergunta'}</button>`).join('')}</div>
    <pre class="sofi-prompt__texto" id="sofi-prompt-texto" tabindex="0" aria-label="Texto do prompt">Carregando…</pre>
    <div class="dialogo__acoes"><span class="sofi-prompt__conta" id="sofi-prompt-conta"></span><button type="button" class="btn btn--secundario" id="sofi-prompt-copiar">Copiar</button><button type="button" class="btn btn--primario" id="sofi-prompt-ok">Fechar</button></div>
  </div>`;
  const close = () => closeDialog();
  $('#sofi-prompt-fechar').onclick = close;
  $('#sofi-prompt-ok').onclick = close;
  overlay.onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  };
  overlay.querySelectorAll('[data-prompt-modo]').forEach((button) => {
    button.onclick = () => sofiAbrirPrompt(button.dataset.promptModo);
  });
  $('#sofi-prompt-copiar').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('#sofi-prompt-texto').textContent);
      toast('Prompt copiado.');
    } catch {
      toast('Não deu para copiar. Selecione o texto e use Ctrl+C.', 'erro');
    }
  };
  $('#sofi-prompt-ok').focus();
  try {
    const feito = await tool('agent.systemPrompt', { modo });
    const texto = String(feito.texto || '');
    $('#sofi-prompt-texto').textContent = texto || 'O motor não devolveu texto.';
    $('#sofi-prompt-conta').textContent = `${texto.length.toLocaleString('pt-BR')} caracteres`;
  } catch (error) {
    $('#sofi-prompt-texto').textContent = `Não deu para carregar o prompt: ${error.message}`;
  }
}

/* ---------- entrada ---------- */

async function bindSofiConfig() {
  const host = $('#sofi-cfg');
  if (!host) return;
  const preset = state.sofiPreset;
  state.sofiPreset = null;
  try {
    await sofiCarregarConfig();
  } catch (error) {
    host.innerHTML = `<p class="config__retorno" role="alert">Não deu para carregar os provedores agora: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!$('#sofi-cfg')) return;
  sofiCfg.form = null;
  sofiCfg.result = null;
  sofiCfg.models = null;
  paintSofiConfig();
  if (preset && sofiCfg.providers.some((item) => item.id === preset)) sofiAbrirForm({ provider: preset });
}
