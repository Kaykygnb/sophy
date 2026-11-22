import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sofiSystemPrompt } from './agent.ts';
import { toolMutates } from './tools.ts';

test('o prompt muda com o modo e lista as ferramentas daquele modo', () => {
  const pergunta = sofiSystemPrompt({
    modo: 'pergunta',
    libraryPath: '/bibliotecas/Caderno',
    context: { notePath: 'Estudos/Reunião.md', selection: { text: 'trecho azul', from: 4, to: 15 } },
  });
  assert.match(pergunta, /Você é a Sofi, assistente do Sophy/);
  assert.match(pergunta, /você só lê e responde/);
  assert.match(pergunta, /modo Agente/);
  assert.match(pergunta, /\[\[Nota#seção\]\]/);
  assert.match(pergunta, /\[\[Nota#\^bloco\]\]/);
  assert.match(pergunta, /> \[!alerta\]/);
  assert.match(pergunta, /data-fundo="amarelo"/);
  assert.match(pergunta, /data-cor="azul"/);
  assert.match(pergunta, /```js title="nome"/);
  assert.match(pergunta, /```mermaid/);
  assert.match(pergunta, /- \[ \] fazer/);
  assert.match(pergunta, /Biblioteca atual: Caderno/);
  assert.match(pergunta, /Nota aberta: Estudos\/Reunião\.md/);
  assert.match(pergunta, /trecho azul/);
  assert.match(pergunta, /note\.read:/);
  assert.match(pergunta, /note\.suggest:/);
  assert.equal(pergunta.includes('note.create:'), false);
  assert.equal(pergunta.includes('library.switch:'), false);
  const agente = sofiSystemPrompt({ modo: 'agente', libraryPath: '/bibliotecas/Caderno' });
  assert.match(agente, /note\.create se a pessoa pediu explicitamente/);
  assert.match(agente, /uma ação por vez/);
  assert.match(agente, /note\.create:/);
  assert.match(agente, /library\.switch:/);
  assert.equal(agente.includes('Nota aberta:'), false);
  assert.equal(agente.includes('você só lê e responde'), false);
  const nomes = [...agente.matchAll(/^- ([a-z0-9.]+):/gm)].map((item) => item[1]);
  assert.equal(nomes.includes('note.suggest'), true);
  assert.equal(
    nomes.some((nome) => toolMutates(nome) && nome !== 'library.switch' && nome !== 'note.create'),
    true,
  );
});
