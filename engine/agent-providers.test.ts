import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentProviders } from './agent-providers.ts';

test('catálogo de provedores da Sofi', () => {
  const lista = agentProviders();
  assert.deepEqual(
    lista.map((item) => [item.id, item.endpointPadrao, item.protocolo, item.precisaChave]),
    [
      ['openai', 'https://api.openai.com/v1', 'openai', true],
      ['anthropic', 'https://api.anthropic.com/v1', 'anthropic', true],
      ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'openai', true],
      ['openrouter', 'https://openrouter.ai/api/v1', 'openai', true],
      ['nvidia', 'https://integrate.api.nvidia.com/v1', 'openai', true],
      ['groq', 'https://api.groq.com/openai/v1', 'openai', true],
      ['xai', 'https://api.x.ai/v1', 'openai', true],
      ['ollama', 'http://localhost:11434/v1', 'openai', false],
      ['personalizado', '', 'openai', true],
    ],
  );
  for (const item of lista) {
    assert.equal(typeof item.nome, 'string');
    assert.equal(Array.isArray(item.modelosSugeridos), true);
    assert.equal(JSON.stringify(item).includes('sk-'), false);
  }
  assert.equal(lista.find((item) => item.id === 'ollama')?.modelosSugeridos.length > 0, true);
  assert.deepEqual(lista.find((item) => item.id === 'personalizado')?.modelosSugeridos, []);
});
