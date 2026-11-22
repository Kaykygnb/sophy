import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentTools, runAgentTurn } from './agent.ts';
import { createNote, openLibrary } from './library.ts';
import { toolMutates, tools } from './tools.ts';

function biblioteca() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-modo-'));
  openLibrary(root);
  return root;
}

test('modo pergunta só oferece leitura e recusa mutação com modo_pergunta', async () => {
  const leitura = agentTools('pergunta').map((tool) => tool.function.name);
  const agente = agentTools('agente').map((tool) => tool.function.name);
  assert.deepEqual(
    leitura,
    agente.filter((nome) => !toolMutates(nome)),
  );
  for (const nome of ['library.switch', 'agent.undo', 'note.create', 'note.write', 'entry.trash']) {
    assert.equal(leitura.includes(nome), false, nome);
    assert.equal(toolMutates(nome), true, nome);
  }
  for (const nome of [
    'search.query',
    'note.read',
    'links.outgoing',
    'graph.query',
    'library.list',
    'library.read',
    'card.list',
    'task.query',
    'note.suggest',
  ]) {
    assert.equal(leitura.includes(nome), true, nome);
    assert.equal(tools.some((tool) => tool.name === nome), true, nome);
  }
  const root = biblioteca();
  createNote(openLibrary(root), 'Estudos/Nota.md', 'texto\n');
  let rodada = 0;
  const turn = await runAgentTurn({
    libraryPath: root,
    message: 'mude e leia',
    key: 'chave-ficticia',
    modo: 'pergunta',
    confirm: () => {
      throw new Error('pergunta não pede confirmação');
    },
    client: async () => {
      rodada += 1;
      if (rodada > 1) return { content: 'li a nota' };
      return {
        toolCalls: [
          { name: 'note.create', arguments: { path: 'Nova.md', body: 'x' } },
          { name: 'library.switch', arguments: { id: 'abc' } },
          { name: 'agent.undo', arguments: { versionId: 'x' } },
          { name: 'note.read', arguments: { path: 'Estudos/Nota.md' } },
        ],
      };
    },
  });
  assert.equal(rodada, 2);
  assert.equal(turn.text, 'li a nota');
  assert.equal(turn.canceled, undefined);
  assert.equal(fs.existsSync(path.join(root, 'Nova.md')), false);
  assert.deepEqual(
    turn.actions.slice(0, 3).map((action) => ({ ok: action.ok, error: action.error })),
    [
      { ok: false, error: 'modo_pergunta' },
      { ok: false, error: 'modo_pergunta' },
      { ok: false, error: 'modo_pergunta' },
    ],
  );
  assert.equal(turn.actions[3]?.ok, true);
  assert.match(JSON.stringify(turn.actions[3]?.input), /Estudos\/Nota\.md/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('note.suggest não grava e volta em sugestoes nos dois modos', async () => {
  for (const modo of ['pergunta', 'agente'] as const) {
    const root = biblioteca();
    const turn = await runAgentTurn({
      libraryPath: root,
      message: 'proponha',
      key: 'chave-ficticia',
      modo,
      client: async ({ messages }) => {
        if (messages.some((item) => item.role === 'tool')) return { content: 'Pronto para salvar.' };
        return {
          toolCalls: [{ name: 'note.suggest', arguments: { titulo: 'Ideia', conteudo: 'rascunho' } }],
        };
      },
    });
    assert.equal(turn.actions[0]?.ok, true);
    assert.equal(turn.actions[0]?.error, undefined);
    assert.deepEqual(turn.sugestoes, [{ titulo: 'Ideia', conteudo: 'rascunho' }]);
    assert.equal(fs.existsSync(path.join(root, 'Ideia.md')), false);
    assert.equal(fs.readdirSync(root).some((nome) => nome.endsWith('.md')), false);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('wikilinks da resposta final são conferidos sem reescrever o texto', async () => {
  const root = biblioteca();
  createNote(openLibrary(root), 'Estudos/Real.md', '# Titulo\n\nUm bloco ^ideia\n');
  const texto = [
    'Veja [[Real]] e [[Real#Titulo]] e [[Real#^ideia]].',
    'Também [[Fantasma]] e [[Real#Ausente]].',
    '```js title="exemplo"',
    'const link = "[[DentroDaCerca]]";',
    '```',
  ].join('\n');
  const turn = await runAgentTurn({
    libraryPath: root,
    message: 'explica',
    key: 'chave-ficticia',
    context: { notePath: 'Estudos/Real.md', modo: 'pergunta' },
    client: async () => ({ content: texto }),
  });
  assert.equal(turn.text, texto);
  assert.deepEqual(turn.linksInexistentes, ['[[Fantasma]]', '[[Real#Ausente]]']);
  fs.rmSync(root, { recursive: true, force: true });
});
