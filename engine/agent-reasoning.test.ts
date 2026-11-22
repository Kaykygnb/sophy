import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capacidadeDoModelo, sanitizarRaciocinio } from './agent-reasoning.ts';

test('tabela de raciocínio por provedor e id do modelo', () => {
  const casos: Array<[string, string, boolean, boolean, boolean]> = [
    ['openai', 'gpt-4o-mini', false, false, false],
    ['openai', 'gpt-4o', false, false, false],
    ['openai', 'o3-mini', true, true, false],
    ['openai', 'o4-mini', true, true, false],
    ['openai', 'gpt-5', true, true, false],
    ['anthropic', 'claude-3-5-haiku-latest', false, false, false],
    ['anthropic', 'claude-sonnet-4-5', true, true, true],
    ['anthropic', 'claude-3-7-sonnet', true, true, true],
    ['gemini', 'gemini-2.0-flash', false, false, false],
    ['gemini', 'gemini-2.5-pro', true, true, true],
    ['xai', 'grok-3', false, false, false],
    ['xai', 'grok-3-mini', true, true, false],
    ['xai', 'grok-4', true, true, false],
    ['groq', 'llama-3.3-70b-versatile', false, false, false],
    ['groq', 'openai/gpt-oss-20b', true, true, false],
    ['groq', 'qwen/qwen3-32b', true, true, false],
    ['groq', 'deepseek-r1-distill-llama-70b', true, false, false],
    ['openrouter', 'anthropic/claude-sonnet-4-5', true, true, true],
    ['openrouter', 'deepseek/deepseek-r1', true, false, true],
    ['openrouter', 'openai/gpt-5', true, true, false],
    ['ollama', 'llama3.2', false, false, false],
    ['ollama', 'qwen3', true, true, false],
    ['ollama', 'deepseek-r1', true, true, false],
    ['nvidia', 'meta/llama-3.1-8b-instruct', false, false, false],
    ['personalizado', 'gpt-4o-mini', false, false, false],
    ['personalizado', 'gpt-5', true, true, false],
    ['desconhecido', 'gpt-5', false, false, false],
  ];
  for (const [provider, model, raciocinio, esforco, orcamento] of casos) {
    const capacidade = capacidadeDoModelo(provider, model);
    assert.equal(capacidade.raciocinio, raciocinio, `${provider}/${model}`);
    assert.equal(Boolean(capacidade.esforcos), esforco, `${provider}/${model} esforço`);
    assert.equal(capacidade.pensamentoOrcamento, orcamento, `${provider}/${model} orçamento`);
    if (capacidade.esforcos) {
      assert.deepEqual(capacidade.esforcos, ['baixo', 'medio', 'alto']);
    } else assert.equal(capacidade.esforcos, null);
  }
});

test('raciocínio do perfil ignora o que o modelo não suporta', () => {
  assert.equal(
    sanitizarRaciocinio('openai', 'gpt-4o-mini', { ativo: true, esforco: 'alto', orcamentoTokens: 99 }),
    undefined,
  );
  assert.deepEqual(sanitizarRaciocinio('openai', 'gpt-5', { ativo: true, esforco: 'alto', orcamentoTokens: 99 }), {
    ativo: true,
    esforco: 'alto',
  });
  assert.deepEqual(
    sanitizarRaciocinio('anthropic', 'claude-sonnet-4-5', {
      ativo: true,
      esforco: 'baixo',
      orcamentoTokens: 2048,
    }),
    { ativo: true, esforco: 'baixo', orcamentoTokens: 2048 },
  );
  assert.deepEqual(sanitizarRaciocinio('groq', 'deepseek-r1', { ativo: true, esforco: 'alto' }), {
    ativo: true,
  });
  assert.deepEqual(sanitizarRaciocinio('openai', 'o3', { ativo: false, esforco: 'alto' }), {
    ativo: false,
  });
  assert.equal(sanitizarRaciocinio('openai', 'gpt-5', { ativo: 'sim' }), undefined);
  assert.equal(sanitizarRaciocinio('openai', 'gpt-5', null), undefined);
});
