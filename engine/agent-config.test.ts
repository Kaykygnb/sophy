import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { abrirAgentConfig, resolverModelos, resolverTeste, type Cofre } from './agent-config.ts';
import { listarModelos, testarConexao } from './agent-client.ts';

function cofre(disponivel: boolean): Cofre {
  return {
    disponivel,
    cifrar: (texto) => Buffer.from(`cofre:${texto}`, 'utf8').toString('base64'),
    decifrar: (dados) => {
      const texto = Buffer.from(dados, 'base64').toString('utf8');
      if (!texto.startsWith('cofre:')) throw new Error('cofre recusou');
      return texto.slice('cofre:'.length);
    },
  };
}

function pasta() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-perfis-'));
}

test('perfil guarda a chave no cofre e o get não a devolve', (t) => {
  const dir = pasta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = abrirAgentConfig(dir, cofre(true));
  const criado = config.set({
    provider: 'openai',
    model: 'gpt-5',
    apiKey: 'sk-super-secreta',
    raciocinio: { ativo: true, esforco: 'medio', orcamentoTokens: 50 },
  });
  assert.equal(criado.ativo, criado.id);
  assert.equal(criado.perfis[0]?.temChave, true);
  assert.equal(criado.perfis[0]?.raciocinio?.esforco, 'medio');
  assert.equal(criado.perfis[0]?.raciocinio?.orcamentoTokens, undefined);
  assert.equal(criado.armazenamento, 'cofre');
  assert.equal(criado.perfis[0]?.armazenamento, 'cofre');
  assert.equal(JSON.stringify(criado).includes('sk-super-secreta'), false);
  const disco = fs.readFileSync(path.join(dir, 'agent-profiles.json'), 'utf8');
  assert.equal(disco.includes('sk-super-secreta'), false);
  const segredos = JSON.parse(fs.readFileSync(path.join(dir, 'agent-secrets.json'), 'utf8'));
  assert.equal(segredos.chaves[criado.id].modo, 'cofre');
  assert.equal(config.segredo(criado.id), 'sk-super-secreta');
  const deNovo = abrirAgentConfig(dir, cofre(true));
  deNovo.set({ id: criado.id, provider: 'openai', model: 'gpt-5', nome: 'Trabalho' });
  assert.equal(deNovo.segredo(criado.id), 'sk-super-secreta');
  deNovo.set({ id: criado.id, provider: 'openai', model: 'gpt-5', apiKey: '' });
  assert.equal(deNovo.get().perfis[0]?.temChave, false);
  assert.equal(deNovo.segredo(criado.id), null);
});

test('sem cofre a chave fica no modo arquivo', (t) => {
  const dir = pasta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = abrirAgentConfig(dir, cofre(false));
  const criado = config.set({
    provider: 'ollama',
    model: 'qwen3',
    endpoint: 'http://127.0.0.1:11434/v1',
    apiKey: 'opcional',
    raciocinio: { ativo: true, esforco: 'alto' },
  });
  const segredos = JSON.parse(fs.readFileSync(path.join(dir, 'agent-secrets.json'), 'utf8'));
  assert.equal(segredos.chaves[criado.id].modo, 'arquivo');
  assert.equal(segredos.chaves[criado.id].dados.includes('opcional'), false);
  assert.equal(config.segredo(criado.id), 'opcional');
  assert.equal(criado.armazenamento, 'arquivo');
  assert.equal(criado.perfis[0]?.armazenamento, 'arquivo');
  assert.equal(criado.perfis[0]?.endpoint, 'http://127.0.0.1:11434/v1');
  assert.equal(criado.perfis[0]?.raciocinio?.esforco, 'alto');
});

test('chave antiga vira um perfil OpenAI ativo e os atalhos removem e ativam', (t) => {
  const dir = pasta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = abrirAgentConfig(dir, cofre(true));
  assert.equal(config.importarLegado('sk-antiga-1234'), true);
  assert.equal(config.importarLegado('sk-nao-sobrescreve'), false);
  const estado = config.get();
  assert.equal(estado.perfis.length, 1);
  assert.equal(estado.ativo, estado.perfis[0]?.id);
  assert.equal(estado.perfis[0]?.provider, 'openai');
  assert.equal(estado.perfis[0]?.model, 'gpt-4o-mini');
  assert.equal(estado.perfis[0]?.temChave, true);
  assert.equal(config.segredo(estado.ativo || ''), 'sk-antiga-1234');
  const outro = config.set({ provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'gsk-12345678' });
  assert.equal(config.get().ativo, estado.ativo);
  const ativado = config.activate(outro.id);
  assert.equal(ativado.ativo, outro.id);
  const restou = config.remove(outro.id);
  assert.equal(restou.perfis.some((item) => item.id === outro.id), false);
  assert.equal(restou.ativo, null);
  assert.equal(restou.perfis[0]?.id, estado.ativo);
  assert.throws(() => config.remove('nao-existe'), /Perfil não encontrado/);
  assert.throws(
    () => config.set({ provider: 'personalizado', model: 'local' }),
    /Informe o endpoint/,
  );
});

test('models lista antes de salvar e testConnection substitui o perfil sem gravar', async (t) => {
  const dir = pasta();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = abrirAgentConfig(dir, cofre(true));
  const salvo = config.set({
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'sk-salva',
    raciocinio: { ativo: true, esforco: 'baixo' },
  });
  const semChave = config.set({ provider: 'groq', model: 'llama-3.3-70b-versatile' });
  assert.equal(semChave.perfis.find((item) => item.id === semChave.id)?.armazenamento, undefined);
  const antes = fs.readFileSync(path.join(dir, 'agent-profiles.json'), 'utf8');
  const segredos = fs.readFileSync(path.join(dir, 'agent-secrets.json'), 'utf8');

  let chamou = false;
  const sugeridos = await listarModelos({
    ...resolverModelos(config, { provider: 'openai', endpoint: 'https://outro.test/v1' }),
    fetchImpl: async () => {
      chamou = true;
      throw new Error('não devia chamar');
    },
  });
  assert.equal(chamou, false);
  assert.equal(sugeridos.fonte, 'sugeridos');
  assert.equal(sugeridos.models.some((item) => item.id === 'gpt-4o-mini'), true);

  const porId = resolverModelos(config, { id: salvo.id, apiKey: 'sk-nao-usar', provider: 'groq' });
  assert.equal(porId.apiKey, 'sk-salva');
  assert.equal(porId.provider, 'openai');
  const daApi = await listarModelos({
    ...porId,
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer sk-salva');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'gpt-5' }] }) };
    },
  });
  assert.equal(daApi.fonte, 'api');
  assert.equal(daApi.models[0]?.id, 'gpt-5');

  let visto: { url: string; model: unknown; auth: string; effort: unknown } | undefined;
  const prova = await testarConexao({
    ...resolverTeste(config, {
      id: salvo.id,
      endpoint: 'https://outro.test/v1',
      model: 'gpt-5',
      apiKey: 'sk-override',
      raciocinio: { ativo: true, esforco: 'alto' },
    }),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body || '{}') as { model?: unknown; reasoning_effort?: unknown };
      visto = {
        url,
        model: body.model,
        auth: init.headers.Authorization,
        effort: body.reasoning_effort,
      };
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(prova.ok, true);
  assert.equal(prova.model, 'gpt-5');
  assert.equal(visto?.url, 'https://outro.test/v1/chat/completions');
  assert.equal(visto?.model, 'gpt-5');
  assert.equal(visto?.auth, 'Bearer sk-override');
  assert.equal(visto?.effort, 'high');
  assert.equal(fs.readFileSync(path.join(dir, 'agent-profiles.json'), 'utf8'), antes);
  assert.equal(fs.readFileSync(path.join(dir, 'agent-secrets.json'), 'utf8'), segredos);
  assert.equal(config.segredo(salvo.id), 'sk-salva');
  assert.equal(config.get().perfis.find((item) => item.id === salvo.id)?.model, 'gpt-4o-mini');
});
