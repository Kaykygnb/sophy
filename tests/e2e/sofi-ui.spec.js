const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launch, mockSofi, openSofi } = require('./sofi-mock');

async function openSofiSettings(page) {
  await page.locator('[data-nav="config"]').click();
  await page.locator('[data-cfg-secao="sofi"]').click();
  await expect(page.locator('#sofi-cfg .sofi-prov').first()).toBeVisible();
}

test('Configurações: nove provedores em cartões, o “em breve” do provedor saiu', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofiSettings(page);
    const names = await page.locator('#sofi-cfg .sofi-prov b').allTextContents();
    expect(names).toEqual(['OpenAI', 'Anthropic', 'Gemini', 'OpenRouter', 'NVIDIA NIM', 'Groq', 'xAI', 'Ollama', 'Personalizado']);
    await expect(page.locator('#cfg-sofi')).not.toContainText('Provedor e modelo');
    await expect(page.locator('#sofi-cfg')).toContainText('Nenhum provedor conectado ainda');
    await expect(page.locator('#sofi-ver-prompt')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('escolher o provedor, salvar o perfil, ver “chave salva ✓” e ligar o raciocínio só no modelo que declara', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofiSettings(page);
    await page.locator('.sofi-prov[data-provedor="openai"]').click();
    const form = page.locator('#sofi-form');
    await expect(form).toBeVisible();
    await expect(page.locator('#sofi-f-endpoint')).toHaveValue('https://api.openai.com/v1');
    await expect(page.locator('#cfg-agente-chave')).toHaveAttribute('type', 'password');
    await expect(page.locator('#sofi-f-racio')).toBeHidden();
    // perfil novo, sem chave: o motor responde só com as sugestões (nada de chave de outro perfil)
    await expect(page.locator('.sofi-selo', { hasText: 'lista sugerida' })).toBeVisible();
    await expect(page.locator('#sofi-f-modelo-bloco')).toContainText('Cole a chave e eu busco a lista do provedor');
    const sem = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.models').at(-1).input);
    expect(sem).toEqual({ provider: 'openai', endpoint: 'https://api.openai.com/v1' });
    // cola a chave: a lista do provedor chega ANTES de salvar, com o raciocínio de cada modelo
    await page.locator('#cfg-agente-chave').fill('sk-teste-123');
    await expect(page.locator('#sofi-f-modelo option')).toHaveCount(4);
    await expect(page.locator('.sofi-selo', { hasText: 'lista sugerida' })).toHaveCount(0);
    const com = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.models').at(-1).input);
    expect(com).toMatchObject({ provider: 'openai', apiKey: 'sk-teste-123' });
    expect(await app.evaluate(() => globalThis.__sofi.perfis.length)).toBe(0);
    await expect(page.locator('#sofi-f-racio')).toBeHidden();
    // o4-mini declara raciocínio e esforço (sem orçamento)
    await page.locator('#sofi-f-modelo').selectOption('o4-mini');
    await expect(page.locator('#sofi-f-racio')).toBeVisible();
    await expect(page.locator('#sofi-f-orcamento')).toHaveCount(0);
    await page.locator('#sofi-f-rac-ativo').check();
    await page.locator('[data-esforco="alto"]').click();
    await expect(page.locator('[data-esforco="alto"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('#sofi-f-salvar').click();

    // salvou, ativou, e voltou no modo de edição
    const row = page.locator('.sofi-perfil.is-ativo');
    await expect(row).toContainText('OpenAI');
    await expect(row).toContainText('chave salva ✓');
    await expect(page.locator('#sofi-f-chave-ok')).toHaveText('chave salva ✓');
    await expect(page.locator('#cfg-agente-chave')).toHaveValue('');
    const saved = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.config.set').at(-1).input);
    expect(saved).toMatchObject({ provider: 'openai', model: 'o4-mini', apiKey: 'sk-teste-123', ativar: true, raciocinio: { ativo: true, esforco: 'alto' } });
    await expect(row).toContainText('raciocínio alto');
    // a chave nunca volta do motor
    const dump = await app.evaluate(() => JSON.stringify(globalThis.__sofi.calls.filter((c) => c.name === 'agent.config.get')));
    expect(dump).not.toContain('sk-teste-123');

    // editar sem trocar a chave: salvar não reenvia a chave, e a lista vem pelo {id}
    await page.locator('#sofi-f-salvar').click();
    const again = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.config.set').at(-1).input);
    expect(again.apiKey).toBeUndefined();
    const byId = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.models').at(-1).input);
    expect(byId).toEqual({ id: 'perfil-1' });

    // volta para um modelo sem raciocínio: os controles somem
    await page.locator('[data-perfil-editar]').click();
    await expect(page.locator('#sofi-f-racio')).toBeVisible();
    await page.locator('#sofi-f-modelo').selectOption('gpt-4o');
    await expect(page.locator('#sofi-f-racio')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('Anthropic mostra o orçamento de pensamento; modelo digitado à mão não mostra controles', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofiSettings(page);
    await page.locator('.sofi-prov[data-provedor="anthropic"]').click();
    // sem salvar: com a chave colada, o modelo raciocina e as opções aparecem
    await page.locator('#cfg-agente-chave').fill('sk-ant-1');
    await expect(page.locator('#sofi-f-modelo option')).toHaveCount(3);
    await expect(page.locator('#sofi-f-modelo')).toBeVisible();
    await expect(page.locator('#sofi-f-racio')).toBeVisible();
    // as opções só aparecem com o raciocínio ligado
    await expect(page.locator('#sofi-f-orcamento')).toBeHidden();
    await page.locator('#sofi-f-rac-ativo').check();
    await expect(page.locator('#sofi-f-orcamento')).toBeVisible();
    await expect(page.locator('[data-esforco]')).toHaveCount(3);
    await page.locator('#sofi-f-modelo').selectOption('__outro__');
    await page.locator('#sofi-f-modelo-manual').fill('meu-modelo-novo');
    await expect(page.locator('#sofi-f-racio')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('Testar conexão: sucesso com latência e erros traduzidos para o português', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofiSettings(page);
    await page.locator('.sofi-prov[data-provedor="groq"]').click();
    // sem chave
    await page.locator('#sofi-f-testar').click();
    await expect(page.locator('#sofi-f-teste')).toContainText('Falta a chave de acesso');
    // chave recusada
    await page.locator('#cfg-agente-chave').fill('chave-ruim');
    await page.locator('#sofi-f-testar').click();
    await expect(page.locator('#sofi-f-teste.is-erro')).toContainText('O provedor não aceitou a chave');
    await expect(page.locator('#sofi-f-teste')).not.toContainText('Incorrect API key');
    // chave boa
    await page.locator('#cfg-agente-chave').fill('gsk-boa');
    await page.locator('#sofi-f-testar').click();
    const ok = page.locator('#sofi-f-teste.is-ok');
    await expect(ok).toContainText('Conectou');
    await expect(ok).toContainText('342 ms');
    // modelo que não existe
    await page.locator('#sofi-f-modelo').selectOption('__outro__');
    await page.locator('#sofi-f-modelo-manual').fill('modelo-fantasma');
    await page.locator('#sofi-f-testar').click();
    await expect(page.locator('#sofi-f-teste.is-erro')).toContainText('Esse modelo não existe aí');
    // testar não grava nada: a chave digitada só vai no teste
    const sets = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.config.set').length);
    expect(sets).toBe(0);
  } finally {
    await app.close();
  }
});

test('perfis: ativar, editar e remover; personalizado exige endpoint; Ollama não pede chave', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, {
      ativo: 'p1',
      perfis: [
        { id: 'p1', provider: 'openai', nome: 'OpenAI do trabalho', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
        { id: 'p2', provider: 'anthropic', nome: 'Claude', endpoint: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
      ],
      chaves: { p1: 'x', p2: 'y' },
    });
    await openSofiSettings(page);
    await expect(page.locator('.sofi-perfil')).toHaveCount(2);
    await expect(page.locator('.sofi-perfil.is-ativo')).toContainText('OpenAI do trabalho');
    await page.locator('[data-perfil-ativar="p2"]').click();
    await expect(page.locator('.sofi-perfil.is-ativo')).toContainText('Claude');
    // editar abre o formulário com os dados do perfil
    await page.locator('[data-perfil-editar="p1"]').click();
    await expect(page.locator('#sofi-f-nome')).toHaveValue('OpenAI do trabalho');
    await expect(page.locator('#sofi-f-chave-ok')).toBeVisible();
    await page.locator('#sofi-f-cancelar').click();
    await expect(page.locator('#sofi-form')).toHaveCount(0);
    // Ollama: sem chave
    await page.locator('.sofi-prov[data-provedor="ollama"]').click();
    await expect(page.locator('#sofi-form')).toContainText('não pede chave');
    await expect(page.locator('#sofi-f-endpoint')).toHaveValue('http://localhost:11434/v1');
    // personalizado: endpoint obrigatório
    await page.locator('.sofi-prov[data-provedor="personalizado"]').click();
    await page.locator('#sofi-f-modelo-manual').fill('meu-modelo');
    await page.locator('#sofi-f-salvar').click();
    await expect(page.locator('#sofi-f-teste')).toContainText('http:// ou https://');
    await page.locator('#sofi-f-endpoint').fill('https://servidor.exemplo/v1');
    await page.locator('#sofi-f-salvar').click();
    await expect(page.locator('.sofi-perfil')).toHaveCount(3);
    // remover pede confirmação
    await page.locator('[data-perfil-remover="p1"]').click();
    await page.locator('#confirma-sim').click();
    await expect(page.locator('.sofi-perfil')).toHaveCount(2);
    await expect(page.locator('#sofi-cfg')).not.toContainText('OpenAI do trabalho');
  } finally {
    await app.close();
  }
});

test('aviso discreto quando a chave está em arquivo e não no cofre; prompt da Sofi num painel', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { armazenamento: 'arquivo', modos: { p1: 'arquivo' }, ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofiSettings(page);
    await expect(page.locator('.sofi-cfg__aviso')).toContainText('não tem cofre do sistema');
    await expect(page.locator('.sofi-perfil')).toContainText('em arquivo');
    await page.locator('#sofi-ver-prompt').click();
    const dialog = page.getByRole('dialog', { name: 'Prompt da Sofi' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#sofi-prompt-texto')).toContainText('Você é a Sofi');
    await expect(dialog.locator('#sofi-prompt-texto')).toContainText('Modo: agente');
    await dialog.getByRole('radio', { name: 'Modo Pergunta' }).click();
    await expect(page.locator('#sofi-prompt-texto')).toContainText('Modo: pergunta');
    await page.keyboard.press('Escape');
    await expect(page.locator('#overlay')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('sem chave: o cartão “Conectar a Sofi” tem os provedores e leva ao formulário certo', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofi(page, { key: false });
    const card = page.locator('.sofi-conectar');
    await expect(card).toContainText('Conectar a Sofi');
    await expect(card.locator('.sofi-prov')).toHaveCount(9);
    await expect(page.locator('#agente-pedido')).toBeDisabled();
    await card.locator('[data-provedor="groq"]').click();
    await expect(page.locator('#cfg-sofi')).toBeVisible();
    await expect(page.locator('#sofi-form')).toContainText('Conectar Groq');
    await expect(page.locator('#sofi-f-endpoint')).toHaveValue('https://api.groq.com/openai/v1');
  } finally {
    await app.close();
  }
});

test('chat: modo Pergunta/Agente com dica, modelo ativo com atalho, e o modo vai no pedido', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await expect(panel.locator('#agente-modelo')).toContainText('gpt-4o-mini');
    await expect(panel.getByRole('radio', { name: /Agente/ })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.locator('#agente-modo-dica')).toContainText('Cria, edita e organiza');
    await panel.getByRole('radio', { name: /Pergunta/ }).click();
    await expect(panel.getByRole('radio', { name: /Pergunta/ })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.locator('#agente-modo-dica')).toContainText('Só lê e responde');
    await panel.locator('#agente-pedido').fill('simples');
    await panel.locator('#agente-enviar').click();
    await expect(panel.locator('.sofi-msg--sofi .sofi-md')).toContainText('Pronto, feito.');
    const ask = await app.evaluate(() => globalThis.__sofi.asks.at(-1));
    expect(ask.context.modo).toBe('pergunta');
    expect(ask.context.notePath).toBe('Leitura.md');
    // o modo fica lembrado quando o painel é repintado
    await page.evaluate(() => paintSofi(document.querySelector('.sofi-chat').parentElement, true));
    await expect(page.locator('.sofi-chat').getByRole('radio', { name: /Pergunta/ })).toHaveAttribute('aria-checked', 'true');
    // atalho do modelo abre Configurações > Sofi e IA
    await page.locator('#agente-modelo').click();
    await expect(page.locator('#cfg-sofi')).toBeVisible();
    await expect(page.locator('.sofi-perfil.is-ativo')).toContainText('OpenAI');
  } finally {
    await app.close();
  }
});

test('abinha “Pensamento”: recolhida ao vivo, abre com as etapas, recolhe sozinha e diz quanto pensou', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'o4-mini' }], chaves: { p1: 'x' } });
    await app.evaluate(() => { globalThis.__sofi.ritmo = 450; });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await panel.locator('#agente-pedido').fill('resuma a semana');
    await panel.locator('#agente-enviar').click();
    const live = panel.locator('.sofi-pensa.is-ao-vivo');
    await expect(live).toBeVisible();
    await expect(live.locator('.sofi-pensa__titulo')).toHaveText('Pensando…');
    // começa recolhida
    await expect(live.locator('.sofi-pensa__cab')).toHaveAttribute('aria-expanded', 'false');
    await expect(live.locator('.sofi-pensa__passos')).toBeHidden();
    await expect(panel.locator('#agente-estado')).toHaveText(/Pensando|Raciocinando|Lendo|Listando/);
    // abre e vê as etapas (tool e reasoning, com e sem resumo)
    await live.locator('.sofi-pensa__cab').click();
    await expect(live.locator('.sofi-pensa__passos')).toBeVisible();
    await expect(live.locator('.sofi-pensa__passos')).toContainText('Lendo a nota Leitura');
    await expect(live.locator('.sofi-pensa__passos')).toContainText('A nota fala de revisão espaçada; vou montar uma tabela.');
    await expect(live.locator('.sofi-pensa__passos li').first()).toContainText('Pensando');
    // ao terminar, vira “Pensou por …” e volta a ficar recolhida
    const done = panel.locator('.sofi-msg--sofi .sofi-pensa');
    await expect(done).toBeVisible({ timeout: 15000 });
    await expect(panel.locator('.sofi-pensa.is-ao-vivo')).toHaveCount(0);
    await expect(done.locator('.sofi-pensa__titulo')).toHaveText(/^Pensou por \d+ s|min/);
    await expect(done.locator('.sofi-pensa__cab')).toHaveAttribute('aria-expanded', 'false');
    await expect(done.locator('.sofi-pensa__passos')).toBeHidden();
    await done.locator('.sofi-pensa__cab').click();
    await expect(done.locator('.sofi-pensa__passos li')).toHaveCount(5);
    await expect(done.locator('.sofi-pensa__raciocinio')).toContainText('revisão espaçada');
    await done.locator('.sofi-pensa__cab').click();
    await expect(done.locator('.sofi-pensa__passos')).toBeHidden();
  } finally {
    await app.close();
  }
});

test('resposta com o mesmo Markdown do editor: callout, tabela, mermaid, código com título, wikilinks, #tag e destaque', async () => {
  const { app, page } = await launch();
  const errors = [];
  try {
    page.on('pageerror', (error) => errors.push(error.message));
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await panel.locator('#agente-pedido').fill('resuma a semana');
    await panel.locator('#agente-enviar').click();
    const md = panel.locator('.sofi-msg--sofi .sofi-md');
    await expect(md).toBeVisible({ timeout: 15000 });
    await expect(md.locator('h3.sofi-h')).toHaveText('Resumo da semana');
    await expect(md.locator('.sofi-callout--dica')).toContainText('Comece pelo mais simples.');
    // tabela com cabeçalho e wikilinks dentro das células
    await expect(md.locator('.sofi-tabela th')).toHaveText(['Nota', 'Estante', 'Estado']);
    await expect(md.locator('.sofi-tabela tbody tr')).toHaveCount(2);
    await expect(md.locator('.sofi-tabela a.wikilink').first()).toHaveText('Leitura');
    // mermaid desenhado
    await expect(md.locator('.sofi-codigo--mermaid .sofi-codigo__diagrama svg')).toBeVisible({ timeout: 15000 });
    await md.locator('[data-sofi-vista="codigo"]').click();
    await expect(md.locator('.sofi-codigo--mermaid .sofi-codigo__fonte')).toContainText('graph TD');
    await md.locator('[data-sofi-vista="diagrama"]').click();
    await expect(md.locator('.sofi-codigo--mermaid .sofi-codigo__diagrama svg')).toBeVisible();
    // código com título
    await expect(md.locator('.sofi-codigo:not(.sofi-codigo--mermaid) .sofi-codigo__nome')).toHaveText('exemplo.js');
    await expect(md.locator('.sofi-codigo:not(.sofi-codigo--mermaid) .token').first()).toBeVisible();
    // tarefas, #tag e destaque
    await expect(md.locator('.sofi-tarefa')).toHaveCount(2);
    await expect(md.locator('.sofi-tarefa.is-feita')).toContainText('Criar o resumo');
    await expect(md.locator('.tag-inline')).toHaveText('#estudo');
    await expect(md.locator('.marca-fundo--amarelo')).toHaveText('este destaque');
    // wikilink existente é clicável e abre a nota; o que não existe aparece quebrado
    await expect(md.locator('p a.wikilink--quebrado, .sofi-p a.wikilink--quebrado')).toHaveText('Nota que não existe');
    await expect(md.locator('.sofi-tabela a.wikilink--quebrado')).toHaveCount(0);
    await md.locator('.sofi-tabela a.wikilink', { hasText: 'Projeto' }).click();
    await expect(page.locator('#coluna .bloco--titulo').first()).toContainText('Projeto');
    // ações com Desfazer (versão inexistente: erro explícito, sem quebrar)
    await expect(panel.locator('.sofi-acao')).toHaveCount(2);
    await expect(panel.locator('[data-desfazer]')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('clicar no wikilink quebrado pergunta antes de criar a nota', async () => {
  const { app, page, root } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await panel.locator('#agente-pedido').fill('resuma a semana');
    await panel.locator('#agente-enviar').click();
    const broken = panel.locator('a.wikilink--quebrado');
    await expect(broken).toBeVisible({ timeout: 15000 });
    await broken.click();
    await expect(page.locator('#overlay')).toContainText('ainda não existe');
    await page.locator('#confirma-nao').click();
    expect(fs.existsSync(path.join(root, 'Nota que não existe.md'))).toBe(false);
  } finally {
    await app.close();
  }
});

test('modo Pergunta bloqueou uma mudança: o cartão explica e oferece o modo Agente', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await panel.getByRole('radio', { name: /Pergunta/ }).click();
    await panel.locator('#agente-pedido').fill('crie a nota bloqueada');
    await panel.locator('#agente-enviar').click();
    const card = panel.locator('.sofi-acao.is-bloqueada');
    await expect(card).toContainText('Modo Pergunta: nada foi alterado.');
    await card.getByRole('button', { name: 'Usar modo Agente' }).click();
    await expect(panel.getByRole('radio', { name: /Agente/ })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await app.close();
  }
});

test('“Salvar como nota” cria a nota em Entrada e vira “Nota criada” com atalho para abrir', async () => {
  const { app, page, root } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    const panel = page.locator('.sofi-chat');
    await panel.locator('#agente-pedido').fill('faça uma sugestão de plano');
    await panel.locator('#agente-enviar').click();
    const card = panel.locator('.sofi-sugestao-nota');
    await expect(card).toContainText('Plano da semana', { timeout: 15000 });
    await card.getByText('Ver prévia').click();
    await expect(card.locator('.sofi-md a.wikilink')).toHaveText('Leitura');
    await card.getByRole('button', { name: 'Salvar como nota' }).click();
    await expect(card).toContainText('Nota criada');
    const file = path.join(root, 'Entrada', 'Plano da semana.md');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('- [ ] Revisar [[Leitura]]');
    await expect(page.locator('#arvore')).toContainText('Plano da semana');
    await card.getByRole('button', { name: 'Abrir' }).click();
    await expect(page.locator('#coluna .bloco--titulo').first()).toContainText('Plano da semana');
  } finally {
    await app.close();
  }
});

test('trocar de biblioteca pela Sofi: a árvore e o chat acompanham', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'x', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofi(page);
    await page.evaluate(() => {
      window.__applied = [];
      window.applyLibrary = async (root) => { window.__applied.push(root); };
    });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('sophy:library-changed', { id: 'b2', name: 'Estudos-2', path: '/tmp/sophy-outra-biblioteca' }));
    await expect(page.locator('.sofi-aviso')).toContainText('Agora estamos na biblioteca “Estudos-2”.');
    expect(await page.evaluate(() => window.__applied)).toEqual(['/tmp/sophy-outra-biblioteca']);
  } finally {
    await app.close();
  }
});

test('escuro: formulário, chat e abinha mantêm contraste legível', async () => {
  const { app, page } = await launch({ theme: 'dark' });
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'anthropic', nome: 'Claude', endpoint: 'x', model: 'claude-sonnet-4-5' }], chaves: { p1: 'x' } });
    await openSofiSettings(page);
    await page.locator('[data-perfil-editar="p1"]').click();
    await expect(page.locator('#sofi-f-racio')).toBeVisible();
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = async (locator) => {
      const [fg, bg] = await locator.evaluate((el) => {
        let node = el, bgc = 'rgba(0, 0, 0, 0)';
        while (node && /rgba\(0, 0, 0, 0\)|transparent/.test(bgc)) { bgc = getComputedStyle(node).backgroundColor; node = node.parentElement; }
        return [getComputedStyle(el).color, bgc];
      });
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    };
    expect(await contrast(page.locator('.sofi-perfil__texto b').first())).toBeGreaterThan(4.5);
    expect(await contrast(page.locator('.sofi-campo-cfg__nota').first())).toBeGreaterThan(4.5);
    await page.locator('#abrir-sofi').click();
    await page.waitForSelector('.sofi-chat');
    await page.evaluate(() => { state.sofiKey = true; paintSofi(document.querySelector('.sofi-chat').parentElement, true); });
    const panel = page.locator('.sofi-chat');
    await panel.locator('#agente-pedido').fill('resuma a semana');
    await panel.locator('#agente-enviar').click();
    await expect(panel.locator('.sofi-msg--sofi .sofi-md')).toBeVisible({ timeout: 15000 });
    expect(await contrast(panel.locator('.sofi-md .sofi-p').first())).toBeGreaterThan(4.5);
    expect(await contrast(panel.locator('.sofi-pensa__titulo'))).toBeGreaterThan(4.5);
    expect(await contrast(panel.locator('#agente-modo-dica'))).toBeGreaterThan(4.5);
  } finally {
    await app.close();
  }
});

test('aviso do arquivo: cofre no topo mas perfil em arquivo avisa; tudo no cofre não avisa', async () => {
  const perfis = [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }];
  let run = await launch();
  try {
    await mockSofi(run.app, { armazenamento: 'cofre', modos: { p1: 'arquivo' }, ativo: 'p1', perfis, chaves: { p1: 'x' } });
    await openSofiSettings(run.page);
    await expect(run.page.locator('.sofi-cfg__aviso')).toContainText('não tem cofre do sistema');
  } finally {
    await run.app.close();
  }
  run = await launch();
  try {
    await mockSofi(run.app, { armazenamento: 'cofre', ativo: 'p1', perfis, chaves: { p1: 'x' } });
    await openSofiSettings(run.page);
    await expect(run.page.locator('.sofi-perfil')).toContainText('chave salva ✓');
    await expect(run.page.locator('.sofi-perfil')).not.toContainText('em arquivo');
    await expect(run.page.locator('.sofi-cfg__aviso')).toHaveCount(0);
  } finally {
    await run.app.close();
  }
});

test('testar um perfil salvo aplica os campos só naquela chamada e não grava nada', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app, { ativo: 'p1', perfis: [{ id: 'p1', provider: 'openai', nome: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }], chaves: { p1: 'x' } });
    await openSofiSettings(page);
    await page.locator('[data-perfil-editar="p1"]').click();
    await expect(page.locator('#sofi-f-modelo option')).toHaveCount(4);
    await page.locator('#sofi-f-modelo').selectOption('o4-mini');
    await page.locator('#sofi-f-rac-ativo').check();
    await page.locator('#sofi-f-endpoint').fill('https://proxy.exemplo/v1');
    await page.locator('#sofi-f-testar').click();
    await expect(page.locator('#sofi-f-teste.is-ok')).toContainText('o4-mini respondeu');
    await expect(page.locator('#sofi-f-teste')).not.toContainText('salvas antes do teste');
    const call = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.testConnection').at(-1));
    expect(call.input).toMatchObject({ id: 'p1', model: 'o4-mini', endpoint: 'https://proxy.exemplo/v1', raciocinio: { ativo: true } });
    expect(call.input.apiKey).toBeUndefined();
    expect(await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.config.set').length)).toBe(0);
    expect(JSON.parse(await app.evaluate(() => JSON.stringify(globalThis.__sofi.perfis)))[0]).toMatchObject({ model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1' });
  } finally {
    await app.close();
  }
});

test('Ollama lista os modelos sem chave, antes de salvar', async () => {
  const { app, page } = await launch();
  try {
    await mockSofi(app);
    await openSofiSettings(page);
    await page.locator('.sofi-prov[data-provedor="ollama"]').click();
    await expect(page.locator('.sofi-selo', { hasText: 'lista sugerida' })).toHaveCount(0);
    await expect(page.locator('#sofi-f-modelo')).toBeVisible();
    const call = await app.evaluate(() => globalThis.__sofi.calls.filter((c) => c.name === 'agent.models').at(-1).input);
    expect(call).toMatchObject({ provider: 'ollama' });
    expect(call.apiKey).toBeUndefined();
  } finally {
    await app.close();
  }
});
