/* Chat da Sofi (painel lateral): modos Pergunta e Agente, modelo ativo, abinha “Pensamento”,
 * respostas no mesmo Markdown das notas e “Salvar como nota”. Só declara funções e constantes:
 * os globais do app.js (state, tool, icon, toast, escapeHtml, refreshLibrary…) são lidos na hora
 * da chamada, então este arquivo carrega antes do app.js. */

const SOFI_SUGGESTIONS = [
  ['Resumir esta nota', true],
  ['Criar flashcards desta nota', true],
  ['Achar notas relacionadas', true],
  ['Organizar minhas tarefas de hoje', false],
  ['O que eu escrevi esta semana?', false],
];

const SOFI_MODOS = {
  pergunta: { label: 'Pergunta', icon: 'conversa', dica: 'Só lê e responde. Nada muda nas suas notas.' },
  agente: { label: 'Agente', icon: 'faisca', dica: 'Cria, edita e organiza por você. Pede confirmação no que for arriscado.' },
};

function sofiMode() {
  if (state.sofiMode) return state.sofiMode;
  let saved = null;
  try {
    saved = localStorage.getItem('sophy-sofi-modo');
  } catch {
    saved = null;
  }
  state.sofiMode = saved === 'pergunta' ? 'pergunta' : 'agente';
  return state.sofiMode;
}

function setSofiMode(mode) {
  if (!SOFI_MODOS[mode] || state.sofiBusy) return;
  state.sofiMode = mode;
  try {
    localStorage.setItem('sophy-sofi-modo', mode);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  syncSofiModo();
}

function syncSofiModo() {
  const mode = sofiMode();
  document.querySelectorAll('[data-sofi-modo]').forEach((button) => {
    const on = button.dataset.sofiModo === mode;
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
    button.disabled = Boolean(state.sofiBusy);
  });
  const hint = $('#agente-modo-dica');
  if (hint) hint.textContent = SOFI_MODOS[mode].dica;
  const field = $('#agente-pedido');
  if (field && state.sofiKey !== false) field.placeholder = 'Pergunte ou peça algo à Sofi…';
}

async function refreshSofiModel() {
  try {
    const config = await tool('agent.config.get', {});
    const ativo = (config.perfis || []).find((item) => item.id === config.ativo) || null;
    state.sofiModel = ativo ? { nome: ativo.nome, model: ativo.model, provider: ativo.provider, raciocinio: ativo.raciocinio || null } : null;
  } catch {
    state.sofiModel = state.sofiModel ?? null;
  }
  syncSofiModel();
}

function syncSofiModel() {
  const chip = $('#agente-modelo');
  if (!chip) return;
  const current = state.sofiModel;
  const label = chip.querySelector('.sofi-modelo__nome');
  if (current) {
    label.textContent = current.model;
    chip.title = `${current.nome}: ${current.model}. Abrir as configurações da Sofi.`;
    chip.setAttribute('aria-label', `Modelo ativo: ${current.model}. Abrir as configurações da Sofi.`);
    chip.classList.remove('is-vazio');
  } else {
    label.textContent = 'Escolher modelo';
    chip.title = 'Nenhum modelo ativo. Abrir as configurações da Sofi.';
    chip.setAttribute('aria-label', 'Nenhum modelo ativo. Abrir as configurações da Sofi.');
    chip.classList.add('is-vazio');
  }
}

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
  syncSofiModo();
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

/* ---------- resposta em Markdown (o mesmo vocabulário do editor) ---------- */

function sofiInline(text, missing) {
  const html = tagifyHtml(SophyWriting.inlineHtml(String(text || ''), (raw) => missing.has(raw)));
  return html.replace(/<a href="#" class="wikilink([^"]*)"([^>]*)>/g, (all, cls, attrs) => {
    const targetMatch = attrs.match(/data-target="([^"]*)"/);
    const target = targetMatch ? targetMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
    if (!target) return all;
    const note = Cmd.parseWikiDraft(target).note;
    const resolved = state.notes.find((item) => foldText(item.path.replace(/\.md$/i, '')) === foldText(note) || foldText(baseName(item.path)) === foldText(note))?.path;
    const known = /^(https?:|mailto:)/i.test(target);
    const broken = /wikilink--quebrado/.test(cls) || (!resolved && !known);
    const shelf = resolved?.includes('/') ? resolved.split('/')[0] : null;
    const mark = shelf ? markFor(shelf) : null;
    const tint = mark?.color ? ` style="--estante-cor: var(--shelf-${mark.color})"` : '';
    const classes = `${cls.replace(/\s*wikilink--quebrado/, '')}${broken ? ' wikilink--quebrado' : ''}`;
    const title = broken ? ' title="Essa nota ainda não existe. Clique para criar."' : '';
    return `<a href="#" class="wikilink${classes}"${attrs}${title}><span class="chip__ponto wikilink__ponto" aria-hidden="true"${tint}></span>`;
  });
}

function sofiCodeHtml(block) {
  const parts = Doc.codeParts(block.raw);
  const source = parts.body;
  const info = parts.info || '';
  const name = Code.parseInfo(info).title;
  const lang = Code.labelFor(info);
  if (isMermaidInfo(info)) {
    return `<div class="sofi-codigo sofi-codigo--mermaid" data-vista="diagrama">
      <div class="sofi-codigo__barra"><span class="sofi-codigo__nome">${icon('diagrama')}<span>${escapeHtml(name || 'Diagrama')}</span></span><span class="sofi-codigo__alternar" role="group" aria-label="Mostrar"><button type="button" data-sofi-vista="diagrama" aria-pressed="true">Diagrama</button><button type="button" data-sofi-vista="codigo" aria-pressed="false">Código</button></span><button type="button" class="sofi-codigo__acao" data-sofi-copiar>Copiar</button></div>
      <div class="sofi-codigo__diagrama" role="img" aria-label="Diagrama"><p class="diagrama__vazio">Desenhando…</p></div>
      <pre class="sofi-codigo__fonte"><code>${escapeHtml(source)}</code></pre>
    </div>`;
  }
  const highlighted = Code.highlight(source, info, window.Prism);
  return `<div class="sofi-codigo">
    <div class="sofi-codigo__barra"><span class="sofi-codigo__nome">${icon('codigo')}<span>${escapeHtml(name || lang)}</span></span>${name ? `<span class="sofi-codigo__lingua">${escapeHtml(lang)}</span>` : ''}<button type="button" class="sofi-codigo__acao" data-sofi-copiar>Copiar</button></div>
    <pre class="sofi-codigo__fonte"><code>${highlighted}</code></pre>
  </div>`;
}

const SOFI_CALLOUTS_ROTULO = { alerta: 'Alerta', pergunta: 'Pergunta', tarefa: 'Tarefa', dica: 'Dica' };

function sofiMarkdownHtml(markdown, missingList = []) {
  const missing = new Set(missingList || []);
  const inline = (text) => sofiInline(text, missing);
  const doc = Doc.parseBody(String(markdown || ''));
  return (doc.blocks || [])
    .map((block) => {
      if (block.type === 'blank') return '';
      if (block.type === 'hr') return '<hr class="sofi-hr">';
      if (block.type === 'heading') {
        const text = block.raw.replace(/^#{1,6}\s?/, '').replace(/\n$/, '');
        const level = Math.min(block.level || 1, 4);
        return `<h${level + 1} class="sofi-h sofi-h--${level}">${inline(text) || '<br>'}</h${level + 1}>`;
      }
      if (block.type === 'code') return sofiCodeHtml(block);
      if (block.type === 'task' && block.task) {
        const done = /x/i.test(block.task.status || '');
        return `<div class="sofi-tarefa${done ? ' is-feita' : ''}"><span class="sofi-tarefa__caixa" aria-hidden="true">${done ? icon('check') : ''}</span><span class="sofi-tarefa__texto">${inline(block.task.title) || '<br>'}</span></div>`;
      }
      if (block.type === 'item') {
        const ordered = block.raw.match(/^\s*(\d+)\./);
        const text = block.raw.replace(/^\s*(?:[-*+]|\d+\.)\s?/, '').replace(/\n$/, '');
        const spaces = (block.raw.match(/^ */) || [''])[0].length;
        return `<div class="sofi-item${ordered ? ' sofi-item--num' : ''}" style="margin-left:${20 + Math.min(spaces, 8) * 8}px"${ordered ? ` value="${ordered[1]}"` : ''}>${inline(text)}</div>`;
      }
      if (block.type === 'quote') {
        const text = block.raw.split('\n').map((line) => line.replace(/^>\s?/, '')).join('\n').replace(/\n$/, '');
        const match = text.match(/^\[!([a-z]+)\]\s*/i);
        const kind = match?.[1]?.toLowerCase();
        if (kind && CALLOUTS[kind]) {
          const body = text.slice(match[0].length).replace(/\n/g, '<br>');
          return `<div class="sofi-callout sofi-callout--${kind}"><span class="sofi-callout__rotulo">${icon(CALLOUTS[kind].icon, 'icon--16')}<span>${SOFI_CALLOUTS_ROTULO[kind]}</span></span><div class="sofi-callout__corpo">${inline(body.replace(/<br>/g, '\n')).replace(/\n/g, '<br>') || '<br>'}</div></div>`;
        }
        return `<blockquote class="sofi-citacao">${inline(text).replace(/\n/g, '<br>')}</blockquote>`;
      }
      if (block.type === 'table') {
        const model = Doc.tableModel(block.raw);
        const rows = model.rows || [];
        if (!rows.length) return '';
        const align = (index) => {
          const spec = (model.align || [])[index] || '';
          return spec.startsWith(':') && spec.endsWith(':') ? ' class="is-centro"' : spec.endsWith(':') ? ' class="is-direita"' : '';
        };
        const head = rows[0].map((cell, index) => `<th${align(index)}>${inline(cell)}</th>`).join('');
        const body = rows.slice(1).map((row) => `<tr>${row.map((cell, index) => `<td${align(index)}>${inline(cell)}</td>`).join('')}</tr>`).join('');
        return `<div class="sofi-tabela"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
      }
      const text = String(block.raw || '').replace(/\n$/, '');
      if (!text.trim()) return '';
      return `<div class="sofi-p">${inline(text).replace(/\n/g, '<br>')}</div>`;
    })
    .join('');
}

/* Os diagramas nascem depois do HTML. O que já foi desenhado vem do cache, sem piscar. */
async function fillSofiMermaid(root) {
  const hosts = [...(root || document).querySelectorAll('.sofi-codigo--mermaid')].filter((wrap) => wrap.dataset.vista !== 'codigo');
  if (!hosts.length) return;
  const theme = themeName();
  state.mermaidCache ||= {};
  const pending = [];
  for (const wrap of hosts) {
    const target = wrap.querySelector('.sofi-codigo__diagrama');
    const source = wrap.querySelector('.sofi-codigo__fonte')?.textContent.trim() || '';
    if (!source) {
      target.innerHTML = '<p class="diagrama__vazio">Diagrama vazio.</p>';
      continue;
    }
    if (state.mermaidTheme === theme && state.mermaidCache[source]) {
      target.innerHTML = state.mermaidCache[source];
      target.dataset.estado = 'pronto';
      continue;
    }
    pending.push({ wrap, target, source });
  }
  if (!pending.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    for (const item of pending) sofiMermaidErro(item.target, error.message);
    return;
  }
  if (state.mermaidTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: mermaidTheme(), suppressErrorRendering: true });
    state.mermaidTheme = theme;
    state.mermaidCache = {};
  }
  for (const { target, source } of pending) {
    if (!target.isConnected) continue;
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
      if (target.isConnected) {
        target.innerHTML = svg;
        target.dataset.estado = 'pronto';
      }
    } catch (error) {
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      if (target.isConnected) sofiMermaidErro(target, String(error?.message || error));
    }
  }
}

function sofiMermaidErro(target, detail) {
  target.dataset.estado = 'erro';
  const first = String(detail || '').split('\n').find((line) => line.trim()) || '';
  target.innerHTML = `<div class="diagrama__erro" role="alert"><b>Não deu para desenhar este diagrama.</b><p>Veja o código na aba ao lado.</p>${first ? `<small>${escapeHtml(first.slice(0, 160))}</small>` : ''}</div>`;
}

/* ---------- abinha “Pensamento” ---------- */

function sofiDuracao(seconds) {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const rest = total % 60;
  return `${min} min${rest ? ` ${rest} s` : ''}`;
}

function sofiPensaHtml({ key, steps, raciocinio, live, seconds }) {
  const open = (state.sofiThinkOpen ||= new Set()).has(String(key));
  const done = !live;
  const list = steps.length
    ? steps
    : live
      ? [{ tipo: 'thinking', label: 'Começando a pensar…' }]
      : [];
  const items = list
    .map((step, index) => {
      const active = live && index === list.length - 1;
      return `<li class="${active ? 'is-ativo' : 'is-feito'}"><span class="sofi-pensa__ponto" aria-hidden="true">${active ? '' : icon('check')}</span><div><b>${escapeHtml(step.label)}</b>${step.resumo ? `<small>${escapeHtml(step.resumo)}</small>` : ''}</div></li>`;
    })
    .join('');
  const trecho = raciocinio ? `<div class="sofi-pensa__raciocinio"><span>O que o modelo pensou</span><div class="sofi-pensa__texto">${escapeHtml(raciocinio)}</div></div>` : '';
  const titulo = live ? 'Pensando…' : `Pensou por ${sofiDuracao(seconds)}`;
  const id = `sofi-pensa-${String(key).replace(/[^a-z0-9_-]/gi, '')}`;
  return `<div class="sofi-pensa${live ? ' is-ao-vivo' : ''}${open ? ' is-aberta' : ''}" data-pensa="${escapeHtml(String(key))}">
    <button type="button" class="sofi-pensa__cab" data-pensa-toggle="${escapeHtml(String(key))}" aria-expanded="${open}" aria-controls="${id}"><span class="sofi-pensa__icone" aria-hidden="true">${done ? icon('faisca') : '<i class="sofi-pensa__giro"></i>'}</span><span class="sofi-pensa__titulo">${titulo}</span>${live ? `<span class="sofi-pensa__tempo" data-pensa-tempo>${sofiDuracao((Date.now() - (state.sofiThink?.start || Date.now())) / 1000)}</span>` : ''}<span class="sofi-pensa__seta" aria-hidden="true">${icon('chevron-direita')}</span></button>
    <div class="sofi-pensa__corpo" id="${id}"><div class="sofi-pensa__miolo"><ol class="sofi-pensa__passos" aria-label="Etapas">${items}</ol>${trecho}</div></div>
  </div>`;
}

function toggleSofiPensa(key) {
  const set = (state.sofiThinkOpen ||= new Set());
  const open = !set.has(key);
  if (open) set.add(key);
  else set.delete(key);
  document.querySelectorAll('[data-pensa]').forEach((el) => {
    if (el.dataset.pensa !== key) return;
    el.classList.toggle('is-aberta', open);
    el.querySelector('[data-pensa-toggle]')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

function startSofiTick() {
  stopSofiTick();
  state.sofiTick = setInterval(() => {
    const start = state.sofiThink?.start;
    const el = $('[data-pensa-tempo]');
    if (el && start) el.textContent = sofiDuracao((Date.now() - start) / 1000);
  }, 1000);
}

function stopSofiTick() {
  clearInterval(state.sofiTick);
  state.sofiTick = 0;
}

function pushSofiStep(event) {
  const think = (state.sofiThink ||= { start: Date.now(), steps: [] });
  const steps = think.steps;
  const last = steps[steps.length - 1];
  if (event.phase === 'thinking') {
    if (!steps.length) steps.push({ tipo: 'thinking', label: event.label || 'Pensando…' });
    return;
  }
  if (event.phase === 'reasoning') {
    const resumo = String(event.resumo || '').trim().slice(0, 400);
    if (last && last.tipo === 'reasoning' && !resumo) return;
    if (last && last.tipo === 'reasoning' && !last.resumo && resumo) {
      last.resumo = resumo;
      return;
    }
    steps.push({ tipo: 'reasoning', label: event.label || 'Raciocinando…', resumo });
    return;
  }
  if (event.phase === 'tool' && event.label) steps.push({ tipo: 'tool', label: String(event.label).replace(/…+$/, ''), tool: event.tool });
}

/* ---------- lista de mensagens ---------- */

function sofiAcaoHtml(action, index, message) {
  if (action.error === 'modo_pergunta') {
    return `<div class="sofi-acao is-bloqueada"><span class="sofi-acao__selo">${icon('cadeado')}</span><span class="sofi-acao__texto"><b>${escapeHtml(action.label || 'Ação não feita')}</b><small>Modo Pergunta: nada foi alterado.</small></span><button type="button" class="btn btn--fantasma btn--pequeno" data-trocar-agente>Usar modo Agente</button></div>`;
  }
  return `<div class="sofi-acao${action.ok === false ? ' is-falhou' : ''}"><span class="sofi-acao__selo">${icon(action.ok === false ? 'erro' : 'check')}</span><span class="sofi-acao__texto"><b>${escapeHtml(action.label || 'Ação feita')}</b>${action.error ? `<small>${escapeHtml(action.error)}</small>` : action.detail ? `<small>${escapeHtml(action.detail)}</small>` : ''}</span>${action.versionId && action.ok !== false ? `<button type="button" class="btn btn--fantasma btn--pequeno" data-desfazer="${escapeHtml(action.versionId)}" data-msg="${message.id}" data-acao="${index}">${icon('desfazer')} Desfazer</button>` : ''}</div>`;
}

function sofiSugestaoHtml(item, index, message) {
  const saved = message.salvas?.[index];
  const linhas = String(item.conteudo || '').split('\n').filter((line) => line.trim()).length;
  const action = saved
    ? `<span class="sofi-sugestao-nota__ok">${icon('check')} Nota criada</span><button type="button" class="btn btn--fantasma btn--pequeno" data-abrir-nota="${escapeHtml(saved)}">Abrir</button>`
    : `<button type="button" class="btn btn--secundario btn--pequeno" data-salvar-nota="${index}" data-msg="${message.id}">${icon('nota-nova')} Salvar como nota</button>`;
  return `<div class="sofi-sugestao-nota"><div class="sofi-sugestao-nota__cab"><span class="sofi-sugestao-nota__icone">${icon('nota')}</span><div class="sofi-sugestao-nota__texto"><b>${escapeHtml(item.titulo)}</b><small>Sugestão de nota${linhas ? ` · ${linhas} ${linhas === 1 ? 'linha' : 'linhas'}` : ''}</small></div>${action}</div>${item.conteudo ? `<details class="sofi-sugestao-nota__previa"><summary>Ver prévia</summary><div class="sofi-md">${sofiMarkdownHtml(item.conteudo, message.linksInexistentes)}</div></details>` : ''}</div>`;
}

function sofiMessageHtml(message) {
  if (message.role === 'aviso') return `<div class="sofi-aviso" role="status">${icon('biblioteca')}<span>${escapeHtml(message.text)}</span></div>`;
  if (message.role === 'user') return `<div class="sofi-msg sofi-msg--voce"><p>${escapeHtml(message.text)}</p></div>`;
  const actions = (message.actions || []).map((action, index) => sofiAcaoHtml(action, index, message)).join('');
  const think = message.pensamento ? sofiPensaHtml({ key: message.id, steps: message.pensamento.steps, raciocinio: message.raciocinio, live: false, seconds: message.pensamento.seconds }) : '';
  const body = message.error ? `<p>${escapeHtml(message.text)}</p>` : `<div class="sofi-md">${sofiMarkdownHtml(message.text, message.linksInexistentes)}</div>`;
  const suggestions = (message.sugestoes || []).map((item, index) => sofiSugestaoHtml(item, index, message)).join('');
  return `<div class="sofi-msg sofi-msg--sofi${message.error ? ' is-erro' : ''}" data-msg="${message.id}">${think}${body}${suggestions}${actions}</div>`;
}

function sofiNearBottom() {
  const scroller = $('#agente-rolagem');
  return !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
}

function scrollSofi(force = false) {
  const scroller = $('#agente-rolagem');
  if (scroller && (force || sofiNearBottom())) scroller.scrollTop = scroller.scrollHeight;
}

function renderSofiLive() {
  const live = $('#agente-vivo');
  if (!live) return;
  const near = sofiNearBottom();
  const parts = [];
  if (state.sofiBusy) {
    const think = state.sofiThink || { steps: [] };
    parts.push(`<div class="sofi-msg sofi-msg--sofi sofi-msg--vivo" role="status" aria-label="A Sofi está trabalhando">${sofiPensaHtml({ key: 'vivo', steps: think.steps, live: true })}</div>`);
  }
  for (const ask of state.sofiConfirms || []) {
    parts.push(
      `<div class="sofi-confirma" role="group" aria-label="Confirmação da Sofi" data-confirma="${escapeHtml(ask.confirmId)}"><span class="sofi-confirma__icone">${icon('cadeado')}</span><div class="sofi-confirma__texto"><b>${escapeHtml(ask.label || 'A Sofi quer fazer uma ação.')}</b><small>Ela só continua se você permitir.</small></div><div class="sofi-confirma__acoes"><button type="button" class="btn btn--secundario btn--pequeno" data-confirma-recusar="${escapeHtml(ask.confirmId)}">Recusar</button><button type="button" class="btn btn--primario btn--pequeno" data-confirma-permitir="${escapeHtml(ask.confirmId)}">Permitir</button></div></div>`,
    );
  }
  live.innerHTML = parts.join('');
  live.querySelectorAll('[data-confirma-permitir], [data-confirma-recusar]').forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.confirmaPermitir || button.dataset.confirmaRecusar;
      answerSofiConfirm(id, Boolean(button.dataset.confirmaPermitir));
    };
  });
  if (near) scrollSofi(true);
}

function renderSofiMessages() {
  const list = $('#agente-mensagens');
  if (!list) return;
  const chat = state.sofiChat;
  const empty = $('#agente-vazio');
  if (empty) empty.hidden = chat.length > 0 || state.sofiBusy || state.sofiKey === false;
  const near = sofiNearBottom();
  list.innerHTML = chat.map(sofiMessageHtml).join('');
  fillSofiMermaid(list);
  renderSofiLive();
  if (near) scrollSofi(true);
}

async function saveSofiSuggestion(messageId, index, button) {
  const message = state.sofiChat.find((item) => item.id === messageId);
  const item = message?.sugestoes?.[index];
  if (!item) return;
  button.disabled = true;
  const titulo = String(item.titulo || 'Nota da Sofi').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Nota da Sofi';
  const name = Cmd.uniqueTitle((state.notes || []).map((note) => baseName(note.path)), titulo);
  const path = `Entrada/${name}.md`;
  const content = String(item.conteudo || '');
  const body = /^\s*#\s/.test(content) ? content : `# ${item.titulo}\n\n${content}`;
  try {
    await tool('note.create', { path, body: body.endsWith('\n') ? body : `${body}\n` });
    await refreshLibrary();
    paintTree();
    (message.salvas ||= {})[index] = path;
    renderSofiMessages();
    toast(`Nota “${name}” criada em Entrada.`, 'ok', { label: 'Abrir', onClick: () => openNote(path) });
  } catch (error) {
    button.disabled = false;
    toast(`Não deu para criar a nota: ${error.message}`, 'erro');
  }
}

function bindSofiList(list) {
  list.addEventListener('click', async (event) => {
    const target = event.target;
    const toggle = target.closest('[data-pensa-toggle]');
    if (toggle) {
      toggleSofiPensa(toggle.dataset.pensaToggle);
      return;
    }
    const undo = target.closest('[data-desfazer]');
    if (undo) {
      undo.disabled = true;
      try {
        await tool('agent.undo', { versionId: undo.dataset.desfazer });
        await refreshLibrary();
        paintTree();
        if (state.active) await openNote(state.active, { force: true });
        toast('Pronto, desfiz o que a Sofi fez.');
        undo.closest('.sofi-acao')?.classList.add('is-desfeita');
        undo.remove();
      } catch (error) {
        undo.disabled = false;
        toast(`Não deu para desfazer: ${error.message}`, 'erro');
        if (/já foi desfeita/i.test(error.message)) {
          undo.closest('.sofi-acao')?.classList.add('is-desfeita');
          undo.remove();
        }
      }
      return;
    }
    const save = target.closest('[data-salvar-nota]');
    if (save) {
      saveSofiSuggestion(Number(save.dataset.msg), Number(save.dataset.salvarNota), save);
      return;
    }
    const open = target.closest('[data-abrir-nota]');
    if (open) {
      openNote(open.dataset.abrirNota);
      return;
    }
    if (target.closest('[data-trocar-agente]')) {
      setSofiMode('agente');
      toast('Modo Agente ligado. Peça de novo e a Sofi pode agir.');
      return;
    }
    const view = target.closest('[data-sofi-vista]');
    if (view) {
      const wrap = view.closest('.sofi-codigo');
      wrap.dataset.vista = view.dataset.sofiVista;
      wrap.querySelectorAll('[data-sofi-vista]').forEach((button) => button.setAttribute('aria-pressed', button === view ? 'true' : 'false'));
      if (view.dataset.sofiVista === 'diagrama') fillSofiMermaid(wrap);
      return;
    }
    const copy = target.closest('[data-sofi-copiar]');
    if (copy) {
      const text = copy.closest('.sofi-codigo')?.querySelector('.sofi-codigo__fonte')?.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copiado';
        setTimeout(() => (copy.textContent = 'Copiar'), 1500);
      } catch {
        toast('Não deu para copiar. Selecione o texto e use Ctrl+C.', 'erro');
      }
      return;
    }
    const link = target.closest('a.wikilink[data-target]');
    if (link) {
      event.preventDefault();
      const name = Cmd.parseWikiDraft(link.dataset.target).note || link.dataset.target;
      if (link.classList.contains('wikilink--quebrado')) {
        if (!(await confirmDialog(`A nota “${name}” ainda não existe. Criar agora?`, { confirm: 'Criar nota' }))) return;
        followLink(link.dataset.raw || link.dataset.target, { create: true });
        return;
      }
      followLink(link.dataset.raw || link.dataset.target, { create: false, newTab: event.ctrlKey || event.metaKey });
      return;
    }
    const tag = target.closest('.tag-inline[data-tag-texto]');
    if (tag && typeof showTag === 'function') {
      event.preventDefault();
      showTag(tag.dataset.tagTexto);
    }
  });
}

function answerSofiConfirm(confirmId, allow) {
  state.sofiConfirms = (state.sofiConfirms || []).filter((ask) => ask.confirmId !== confirmId);
  syncSofiHeader();
  renderSofiLive();
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

let sofiHooked = false;
function hookSofiEvents() {
  hookInlineTagsOnce();
  if (sofiHooked) return;
  sofiHooked = true;
  sophy.onAgentProgress?.((event) => {
    if (!state.sofiBusy) return;
    if (event.phase === 'tool' && event.label) state.sofiPhase = `${event.label}…`.replace(/…+$/, '…');
    else if (event.phase === 'reasoning') state.sofiPhase = 'Raciocinando…';
    else if (event.phase === 'thinking') state.sofiPhase ||= 'Pensando…';
    pushSofiStep(event);
    syncSofiHeader();
    renderSofiLive();
  });
  sophy.onAgentConfirm?.((ask) => {
    state.sofiConfirms = [...(state.sofiConfirms || []).filter((item) => item.confirmId !== ask.confirmId), ask];
    if (!state.sofiOpen) openAgent();
    syncSofiHeader();
    renderSofiLive();
  });
  /* A Sofi trocou de biblioteca (sempre com a sua confirmação): a árvore e o chat acompanham. */
  sophy.onLibraryChanged?.(async (info) => {
    if (!info?.path || info.path === state.libraryPath) return;
    try {
      await applyLibrary(info.path);
    } catch (error) {
      toast(`Não deu para abrir a nova biblioteca: ${error.message}`, 'erro');
      return;
    }
    state.editorSelection = null;
    state.sofiContext = true;
    state.sofiChat ||= [];
    state.sofiChat.push({ role: 'aviso', id: Date.now(), text: `Agora estamos na biblioteca “${info.name || baseName(info.path)}”.` });
    syncSofiContext();
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
  state.sofiThink = { start: Date.now(), steps: [] };
  startSofiTick();
  syncSofiHeader();
  renderSofiMessages();
  scrollSofi(true);
  const context = { modo: sofiMode() };
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
  const think = state.sofiThink || { start: Date.now(), steps: [] };
  const seconds = (Date.now() - think.start) / 1000;
  stopSofiTick();
  state.sofiThink = null;
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
  if (response.ok) {
    try {
      await refreshLibrary();
      paintTree();
    } catch {
      /* a lista se atualiza na próxima ação */
    }
  }
  const value = response.value || {};
  const id = Date.now();
  const racio = response.ok && typeof value.raciocinio === 'string' ? value.raciocinio.trim() : '';
  const steps = think.steps.length || racio ? think.steps : [];
  state.sofiChat.push(
    response.ok
      ? {
          role: 'sofi',
          id,
          text: canceled ? 'Pedido cancelado.' : value.text || 'Pronto.',
          actions: value.actions || [],
          sugestoes: Array.isArray(value.sugestoes) ? value.sugestoes : [],
          linksInexistentes: Array.isArray(value.linksInexistentes) ? value.linksInexistentes : [],
          raciocinio: racio,
          pensamento: steps.length || racio ? { steps, seconds } : null,
        }
      : { role: 'sofi', id, error: true, text: `Não consegui responder: ${response.error || 'tente de novo em instantes.'}`, pensamento: steps.length ? { steps, seconds } : null },
  );
  syncSofiHeader();
  renderSofiMessages();
  $('#agente-pedido')?.focus();
  if (!state.sofiOpen && !canceled)
    pushNotification({
      type: 'sofi',
      title: response.ok ? 'A Sofi terminou' : 'A Sofi não conseguiu responder',
      body: response.ok ? String(value.text || 'Pedido concluído.').slice(0, 120) : String(response.error || 'Tente de novo em instantes.'),
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

function openSofiSettings(provider = null) {
  if (drawerNarrow()) closeSofi();
  state.configSection = 'sofi';
  state.sofiPreset = provider;
  if (state.view === 'settings') paintCenter();
  else runCommand('config');
}

function sofiLarga() {
  if (state.sofiWide !== undefined) return state.sofiWide;
  try {
    state.sofiWide = localStorage.getItem('sophy-sofi-larga') === '1';
  } catch {
    state.sofiWide = false;
  }
  return state.sofiWide;
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
  const mode = sofiMode();
  const wide = sofiLarga();
  const suggestions = SOFI_SUGGESTIONS.filter(([, needsNote]) => !needsNote || state.active)
    .map(([label]) => `<button type="button" class="sofi-sugestao" data-sugestao="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
    .join('');
  host.innerHTML = `<div class="agente agente--lateral sofi-chat${wide ? ' is-larga' : ''}" role="dialog" aria-label="Sofi">
    <header class="sofi-chat__topo">
      <div class="sofi-mascote" id="sofi-mascote" data-estado="ocioso" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div>
      <div class="sofi-chat__titulo"><h3>Sofi</h3><span class="sofi-chat__estado" id="agente-estado" role="status" data-estado="pronta">Pronta</span></div>
      <button type="button" class="btn btn--icone" id="agente-nova" aria-label="Nova conversa" title="Nova conversa">${icon('novo')}</button>
      <button type="button" class="btn btn--icone sofi-chat__largura" id="agente-largura" aria-label="Alargar o painel" aria-pressed="${wide}" title="Alargar ou estreitar o painel">${icon('dividir')}</button>
      <button type="button" class="btn btn--icone" id="agente-fechar" aria-label="Fechar a Sofi" title="Fechar">${icon('fechar')}</button>
    </header>
    <div class="sofi-chat__rolagem" id="agente-rolagem">
      ${noKey ? `<div class="sofi-conectar"><div class="sofi-mascote sofi-mascote--grande" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div><h4>Conectar a Sofi</h4><p>Escolha o serviço de IA que você usa e cole a chave dele. Ela fica guardada no cofre do sistema, nunca dentro da biblioteca.</p><div class="sofi-provedores sofi-provedores--compacto" role="group" aria-label="Provedores de IA">${sofiProvedoresHtml('chat')}</div><button type="button" class="btn btn--fantasma btn--pequeno" id="agente-conectar">Abrir configurações</button></div>` : ''}
      <div class="sofi-vazio" id="agente-vazio" ${noKey || state.sofiChat.length ? 'hidden' : ''}>
        <div class="sofi-mascote sofi-mascote--grande" id="sofi-mascote-vazio" aria-hidden="true"><img src="ui/assets/sofi/sofi-ocioso-${theme}.svg" alt=""></div>
        <h4>Oi! Como posso ajudar hoje?</h4>
        <p>Escolha uma sugestão ou escreva abaixo.</p>
        <div class="sofi-sugestoes">${suggestions}</div>
        <p class="sofi-ajuda">Leio só esta biblioteca, uso as mesmas ferramentas que você e gravo um ponto antes de mudar qualquer coisa.</p>
      </div>
      <div class="sofi-mensagens" id="agente-mensagens" aria-live="polite"></div>
      <div class="sofi-mensagens sofi-mensagens--vivo" id="agente-vivo" aria-live="polite"></div>
    </div>
    <form class="sofi-chat__rodape" id="agente-form">
      <div id="agente-contexto-slot"></div>
      <div class="sofi-campo">
        <textarea id="agente-pedido" rows="1" aria-label="Mensagem para a Sofi" placeholder="${noKey ? 'Conecte a Sofi para escrever…' : 'Pergunte ou peça algo à Sofi…'}" ${noKey ? 'disabled' : ''}></textarea>
        <button type="submit" class="btn btn--primario btn--icone sofi-campo__enviar" id="agente-enviar" aria-label="Enviar" title="Enviar (Enter)">${icon('enviar')}</button>
        <button type="button" class="btn btn--secundario sofi-campo__parar" id="agente-parar" aria-label="Parar" title="Parar o pedido" hidden>${icon('fechar')} Parar</button>
      </div>
      <div class="sofi-barra">
        <div class="sofi-modo" role="radiogroup" aria-label="Modo da Sofi">${Object.entries(SOFI_MODOS)
          .map(([id, item]) => `<button type="button" role="radio" aria-checked="${mode === id}" data-sofi-modo="${id}" title="${escapeHtml(`${item.label}: ${item.dica}`)}">${icon(item.icon)}<span>${item.label}</span></button>`)
          .join('')}</div>
        <button type="button" class="sofi-modelo is-vazio" id="agente-modelo" title="Abrir as configurações da Sofi"><span class="sofi-modelo__ponto" aria-hidden="true"></span><span class="sofi-modelo__nome">Escolher modelo</span>${icon('chevron-direita')}</button>
      </div>
      <p class="sofi-chat__dica" id="agente-modo-dica">${SOFI_MODOS[mode].dica}</p>
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
  host.querySelectorAll('.sofi-conectar [data-provedor]').forEach((button) => {
    button.onclick = () => openSofiSettings(button.dataset.provedor);
  });
  host.querySelectorAll('[data-sofi-modo]').forEach((button) => {
    button.onclick = () => setSofiMode(button.dataset.sofiModo);
    button.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      setSofiMode(sofiMode() === 'agente' ? 'pergunta' : 'agente');
      $(`[data-sofi-modo="${sofiMode()}"]`)?.focus();
    };
  });
  $('#agente-modelo').onclick = () => openSofiSettings();
  $('#agente-parar').onclick = () => stopSofi();
  $('#agente-nova').onclick = () => newSofiChat();
  $('#agente-fechar').onclick = () => closeSofi();
  $('#agente-largura').onclick = () => {
    state.sofiWide = !sofiLarga();
    try {
      localStorage.setItem('sophy-sofi-larga', state.sofiWide ? '1' : '0');
    } catch {
      /* só nesta sessão */
    }
    const chat = $('.sofi-chat');
    chat.classList.toggle('is-larga', state.sofiWide);
    $('#agente-largura').setAttribute('aria-pressed', String(state.sofiWide));
  };
  const connect = $('#agente-conectar');
  if (connect) connect.onclick = () => openSofiSettings();
  bindSofiList($('#agente-rolagem'));
  const mascot = $('#sofi-mascote');
  mountSofi(mascot, 'ocioso');
  const big = $('#sofi-mascote-vazio');
  if (big) mountSofi(big, 'ocioso');
  syncSofiContext();
  syncSofiHeader();
  syncSofiModel();
  renderSofiMessages();
  refreshSofiModel();
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
