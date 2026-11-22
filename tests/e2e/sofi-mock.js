/* Mock do motor da Sofi para os testes de interface: nenhuma chave real, nenhuma chamada de rede.
 * Os canais IPC `sophy:tool` (só os `agent.*` de configuração) e `sophy:agent-*` são trocados no
 * processo principal; o resto das ferramentas (note.create, library.open…) continua real. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sofi-ui-'));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Estudos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Trabalho'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Leitura.md'), '# Leitura\n\nUma frase para selecionar. #estudo\n');
  fs.writeFileSync(path.join(root, 'Estudos', 'Memória.md'), '# Memória\n\nTécnicas de revisão espaçada.\n');
  fs.writeFileSync(path.join(root, 'Trabalho', 'Projeto.md'), '# Projeto\n\n- [ ] Revisar o plano\n');
  return root;
}

async function launch({ theme = 'light', size = [1440, 900], root = makeLibrary() } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sofi-ui-data-'));
  fs.writeFileSync(path.join(userData, 'ui.json'), JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }));
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.', `--test-user-data=${userData}`], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(w, h);
    win.center();
  }, size);
  await page.waitForSelector('#arvore');
  return { app, page, root };
}

const RESPOSTA_RICA = [
  '## Resumo da semana',
  '',
  'Veja como isto se liga a [[Leitura]] e a [[Nota que não existe]]. Marquei #estudo e <span data-fundo="amarelo">este destaque</span>.',
  '',
  '> [!dica] Comece pelo mais simples.',
  '',
  '| Nota | Estante | Estado |',
  '| --- | --- | --- |',
  '| [[Leitura]] | Raiz | em dia |',
  '| [[Projeto]] | Trabalho | atrasado |',
  '',
  '```mermaid',
  'graph TD',
  '  A[Ideia] --> B[Nota]',
  '  B --> C[Conexão]',
  '```',
  '',
  '```js title="exemplo.js"',
  "console.log('olá');",
  '```',
  '',
  '- [ ] Revisar a nota',
  '- [x] Criar o resumo',
].join('\n');

/* Instala o mock. `config` define o estado inicial do motor falso. */
async function mockSofi(app, config = {}) {
  await app.evaluate(({ ipcMain, BrowserWindow }, { config, resposta }) => {
    const win = () => BrowserWindow.getAllWindows()[0];
    const original = ipcMain._invokeHandlers.get('sophy:tool');
    const providers = [
      ['openai', 'OpenAI', 'https://api.openai.com/v1', true, ['gpt-4o-mini', 'o4-mini'], 'openai'],
      ['anthropic', 'Anthropic', 'https://api.anthropic.com/v1', true, ['claude-sonnet-4-5'], 'anthropic'],
      ['gemini', 'Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', true, ['gemini-2.5-flash'], 'openai'],
      ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', true, ['openai/gpt-4o-mini'], 'openai'],
      ['nvidia', 'NVIDIA', 'https://integrate.api.nvidia.com/v1', true, ['meta/llama-3.1-8b-instruct'], 'openai'],
      ['groq', 'Groq', 'https://api.groq.com/openai/v1', true, ['llama-3.3-70b-versatile'], 'openai'],
      ['xai', 'xAI', 'https://api.x.ai/v1', true, ['grok-3'], 'openai'],
      ['ollama', 'Ollama', 'http://localhost:11434/v1', false, ['llama3.2'], 'openai'],
      ['personalizado', 'Personalizado', '', true, [], 'openai'],
    ].map(([id, nome, endpointPadrao, precisaChave, modelosSugeridos, protocolo]) => ({ id, nome, endpointPadrao, precisaChave, modelosSugeridos, protocolo }));
    const catalogo = {
      openai: [
        { id: 'gpt-4o-mini', nome: 'gpt-4o-mini', raciocinio: false, esforcos: null, pensamentoOrcamento: false },
        { id: 'gpt-4o', nome: 'gpt-4o', raciocinio: false, esforcos: null, pensamentoOrcamento: false },
        { id: 'o4-mini', nome: 'o4-mini', raciocinio: true, esforcos: ['baixo', 'medio', 'alto'], pensamentoOrcamento: false },
      ],
      anthropic: [
        { id: 'claude-sonnet-4-5', nome: 'Claude Sonnet 4.5', raciocinio: true, esforcos: ['baixo', 'medio', 'alto'], pensamentoOrcamento: true },
        { id: 'claude-3-5-haiku-latest', nome: 'Claude 3.5 Haiku', raciocinio: false, esforcos: null, pensamentoOrcamento: false },
      ],
    };
    const estado = (globalThis.__sofi = {
      providers,
      ativo: config.ativo ?? null,
      perfis: config.perfis ?? [],
      chaves: config.chaves ?? {},
      armazenamento: config.armazenamento ?? 'cofre',
      modos: config.modos ?? {},
      fonte: config.fonte ?? 'api',
      ritmo: 120,
      calls: [],
      asks: [],
      seq: 1,
      resposta,
    });
    // contrato do #43: `armazenamento` no topo; no perfil, só quando há chave
    const publico = () => ({
      ativo: estado.ativo,
      armazenamento: estado.armazenamento,
      perfis: estado.perfis.map((item) => {
        const temChave = Boolean(estado.chaves[item.id]);
        return { ...item, temChave, ...(temChave ? { armazenamento: estado.modos[item.id] || estado.armazenamento } : {}) };
      }),
    });
    const sugeridos = (id) => (estado.providers.find((item) => item.id === id)?.modelosSugeridos || []).map((mid) => (catalogo[id] || []).find((m) => m.id === mid) || { id: mid, nome: mid, raciocinio: false, esforcos: null, pensamentoOrcamento: false });
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    ipcMain.removeHandler('sophy:tool');
    ipcMain.handle('sophy:tool', async (event, name, input) => {
      if (typeof name === 'string' && /^agent\.(providers|config\.|models|testConnection|systemPrompt)/.test(name)) {
        estado.calls.push({ name, input, perfisAntes: JSON.stringify(estado.perfis) });
        const wrap = (value) => ({ ok: true, value });
        if (name === 'agent.providers') return wrap(estado.providers);
        if (name === 'agent.config.get') return wrap(publico());
        if (name === 'agent.config.set') {
          let perfil = input.id ? estado.perfis.find((item) => item.id === input.id) : null;
          if (!perfil) {
            perfil = { id: `perfil-${estado.seq++}` };
            estado.perfis.push(perfil);
          }
          const meta = estado.providers.find((item) => item.id === input.provider);
          Object.assign(perfil, { provider: input.provider, nome: input.nome || meta.nome, endpoint: input.endpoint ?? meta.endpointPadrao, model: input.model });
          if (input.raciocinio) perfil.raciocinio = input.raciocinio;
          if ('apiKey' in input) {
            if (input.apiKey) estado.chaves[perfil.id] = input.apiKey;
            else delete estado.chaves[perfil.id];
          }
          if (input.ativar === true || !estado.ativo) estado.ativo = perfil.id;
          return wrap({ ...publico(), id: perfil.id });
        }
        if (name === 'agent.config.remove') {
          estado.perfis = estado.perfis.filter((item) => item.id !== input.id);
          delete estado.chaves[input.id];
          if (estado.ativo === input.id) estado.ativo = null;
          return wrap(publico());
        }
        if (name === 'agent.config.activate') {
          estado.ativo = input.id;
          return wrap(publico());
        }
        if (name === 'agent.models') {
          // {id} usa a chave daquele perfil; {provider, endpoint?, apiKey?} nunca usa a de outro perfil
          const perfil = input.id ? estado.perfis.find((item) => item.id === input.id) : null;
          if (input.id && !perfil) return { ok: false, error: 'Perfil não encontrado.' };
          const provider = perfil ? perfil.provider : input.provider;
          const meta = estado.providers.find((item) => item.id === provider);
          const chave = perfil ? estado.chaves[perfil.id] : input.apiKey;
          if (meta.precisaChave && !chave) return wrap({ models: sugeridos(provider), fonte: 'sugeridos' });
          if (estado.fonte === 'sugeridos') return wrap({ models: sugeridos(provider), fonte: 'sugeridos' });
          return wrap({ models: catalogo[provider] || sugeridos(provider), fonte: 'api' });
        }
        if (name === 'agent.testConnection') {
          await pause(estado.atrasoTeste || 80);
          // com {id}, os campos informados valem só nesta chamada e nada é gravado
          const salvo = input.id ? estado.perfis.find((item) => item.id === input.id) : null;
          const chave = 'apiKey' in input ? input.apiKey : salvo ? estado.chaves[salvo.id] : '';
          const prov = salvo ? salvo.provider : input.provider;
          const model = input.model || salvo?.model;
          const precisa = estado.providers.find((item) => item.id === prov)?.precisaChave;
          if (precisa && !chave) return wrap({ ok: false, error: 'sem_chave', latencyMs: 2, model });
          if (chave === 'chave-ruim') return wrap({ ok: false, error: 'chave_invalida', mensagem: 'Incorrect API key', latencyMs: 90, model });
          if (model === 'modelo-fantasma') return wrap({ ok: false, error: 'modelo_inexistente', latencyMs: 110, model });
          return wrap({ ok: true, latencyMs: 342, model });
        }
        if (name === 'agent.systemPrompt') return wrap({ texto: `Você é a Sofi, a assistente do Sophy.\nModo: ${input.modo || 'agente'}.\n\nRegras:\n- Leia só a biblioteca aberta.\n- Peça confirmação antes de apagar.` });
      }
      return original(event, name, input);
    });
    ipcMain.removeHandler('sophy:agent-status');
    ipcMain.handle('sophy:agent-status', () => ({ ok: true, value: { saved: estado.perfis.some((item) => item.id === estado.ativo && (estado.chaves[item.id] || estado.providers.find((p) => p.id === item.provider)?.precisaChave === false)) } }));
    ipcMain.removeHandler('sophy:agent-ask');
    ipcMain.removeHandler('sophy:agent-cancel');
    ipcMain.handle('sophy:agent-cancel', () => ({ ok: true, value: { canceled: true } }));
    ipcMain.handle('sophy:agent-ask', async (_event, message, context) => {
      estado.asks.push({ message, context });
      const send = (payload) => win().webContents.send('sophy:agent-progress', payload);
      const gap = () => pause(estado.ritmo);
      send({ phase: 'thinking', label: 'Pensando…' });
      await gap();
      send({ phase: 'reasoning', label: 'Raciocinando…' });
      await gap();
      send({ phase: 'tool', label: 'Lendo a nota Leitura', tool: 'note.read', actionId: 'a1' });
      await gap();
      send({ phase: 'reasoning', label: 'Raciocinando…', resumo: 'A nota fala de revisão espaçada; vou montar uma tabela.' });
      await gap();
      send({ phase: 'tool', label: 'Listando as notas da estante Estudos', tool: 'note.list', actionId: 'a2' });
      await gap();
      send({ phase: 'done', label: 'Pronto.' });
      if (/bloqueada/.test(message)) {
        return { ok: true, value: { text: 'Eu criaria a nota, mas estou só em modo Pergunta.', actions: [{ id: 'a3', tool: 'note.create', label: 'Criar a nota Plano', input: {}, ok: false, error: 'modo_pergunta' }] } };
      }
      if (/sugest/.test(message)) {
        return { ok: true, value: { text: 'Montei um rascunho. Se gostar, salve como nota.', actions: [{ id: 'a4', tool: 'note.suggest', label: 'Sugeriu a nota Plano da semana', input: {}, ok: true }], sugestoes: [{ titulo: 'Plano da semana', conteudo: '# Plano da semana\n\n- [ ] Revisar [[Leitura]]\n- [ ] Escrever o resumo\n' }] } };
      }
      if (/simples/.test(message)) return { ok: true, value: { text: 'Pronto, feito.', actions: [] } };
      return {
        ok: true,
        value: {
          text: estado.resposta,
          actions: [{ id: 'a1', tool: 'note.read', label: 'Leu a nota Leitura', input: {}, ok: true }, { id: 'a5', tool: 'note.write', label: 'Gravou a nota Resumo', input: {}, ok: true, versionId: 'v-inexistente' }],
          linksInexistentes: ['[[Nota que não existe]]'],
          raciocinio: 'A nota fala de revisão espaçada, então organizei os dados numa tabela e desenhei o fluxo.',
        },
      };
    });
  }, { config, resposta: RESPOSTA_RICA });
}

async function openSofi(page, { key = true } = {}) {
  await page.locator('#arvore').getByText('Leitura', { exact: true }).first().click();
  await page.locator('#abrir-sofi').click();
  await page.waitForSelector('.sofi-chat');
  if (key) await page.evaluate(() => { state.sofiKey = true; paintSofi(document.querySelector('.sofi-chat').parentElement, true); });
}

module.exports = { launch, mockSofi, openSofi, makeLibrary, RESPOSTA_RICA };
