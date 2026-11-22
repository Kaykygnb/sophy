import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentConfirmation, runAgentTurn, sofiTools, type AgentModelClient } from './agent.ts';
import { currentAuthor, withAuthor } from './call-context.ts';
import { EngineError } from './errors.ts';
import { diffActivity, listActivity } from './activity.ts';
import { openLibrary } from './library.ts';
import { callTool } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-atividade-'));
  fs.mkdirSync(path.join(root, '.sophy'));
  return openLibrary(root);
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('o autor vem do contexto da chamada e chamadas paralelas não se misturam', async () => {
  const opened = library();
  assert.equal(currentAuthor(), 'usuario');
  await Promise.all([
    withAuthor('sofi', async () => {
      await pause(30);
      assert.equal(currentAuthor(), 'sofi');
      callTool('note.create', {
        libraryPath: opened.root,
        path: 'Sofi.md',
        body: 'da sofi\n',
        origin: 'agent',
      });
    }),
    withAuthor('mcp:Codex', async () => {
      await pause(10);
      assert.equal(currentAuthor(), 'mcp:Codex');
      callTool('note.create', {
        libraryPath: opened.root,
        path: 'Codex.md',
        body: 'do codex\n',
        origin: 'mcp',
      });
    }),
  ]);
  const rows = listActivity(opened);
  const byPath = new Map(rows.map((row) => [row.notePath, row.autor]));
  assert.equal(byPath.get('Sofi.md'), 'sofi');
  assert.equal(byPath.get('Codex.md'), 'mcp:Codex');
  assert.equal(rows[0]?.quando >= rows[1]?.quando, true);
});

test('lista, diff, conflito e desfazer com força', async () => {
  const opened = library();
  callTool('note.create', {
    libraryPath: opened.root,
    path: 'Nota.md',
    body: 'primeira\n',
    origin: 'ui',
  });
  await pause(5);
  const created = listActivity(opened)[0];
  assert.ok(created);
  assert.equal(created.autor, 'usuario');
  assert.equal(created.tool, 'note.create');
  assert.equal(created.notePath, 'Nota.md');
  const diff = diffActivity(opened, created.id);
  assert.equal(diff.antes, null);
  assert.match(diff.depois ?? '', /primeira/);
  callTool('note.write', {
    libraryPath: opened.root,
    path: 'Nota.md',
    body: 'segunda\n',
    expectedRevision: (callTool('note.read', { libraryPath: opened.root, path: 'Nota.md' }) as { revision: string })
      .revision,
    origin: 'ui',
  });
  const blocked = callTool('activity.undo', { libraryPath: opened.root, id: created.id }) as {
    erro?: string;
    versionIdAtual?: string | null;
  };
  assert.equal(blocked.erro, 'conflito');
  assert.equal(typeof blocked.versionIdAtual, 'string');
  assert.match(fs.readFileSync(path.join(opened.root, 'Nota.md'), 'utf8'), /segunda/);
  const forced = callTool('activity.undo', {
    libraryPath: opened.root,
    id: created.id,
    forcar: true,
  }) as { autor?: string; desfeito?: string };
  assert.equal(forced.autor, 'usuario');
  assert.equal(forced.desfeito, created.id);
  assert.equal(fs.existsSync(path.join(opened.root, 'Nota.md')), false);
  const undo = listActivity(opened, { autor: 'usuario', limite: 1 })[0];
  assert.equal(undo?.tool, 'activity.undo');
  assert.equal(listActivity(opened, { autor: 'mcp:ninguem' }).length, 0);
  const from = undo?.quando ?? created.quando;
  assert.equal(listActivity(opened, { de: from, ate: from }).some((row) => row.id === undo?.id), true);
  assert.throws(
    () => callTool('activity.diff', { libraryPath: opened.root, id: 'nao-existe' }),
    (error: unknown) => error instanceof EngineError && error.code === 'atividade_inexistente',
  );
  assert.throws(
    () => listActivity(opened, { de: 'ontem' }),
    (error: unknown) => error instanceof EngineError && error.code === 'data_invalida',
  );
});

test('o desfazer sem conflito restaura o texto e a rotação guarda o log antigo', async () => {
  const opened = library();
  const previous = process.env.SOPHY_ACTIVITY_MAX_BYTES;
  process.env.SOPHY_ACTIVITY_MAX_BYTES = '180';
  try {
    for (let index = 0; index < 6; index += 1) {
      callTool('note.create', {
        libraryPath: opened.root,
        path: `Nota-${index}.md`,
        body: `texto ${index} `.repeat(8),
        origin: 'ui',
      });
    }
  } finally {
    if (previous === undefined) delete process.env.SOPHY_ACTIVITY_MAX_BYTES;
    else process.env.SOPHY_ACTIVITY_MAX_BYTES = previous;
  }
  assert.equal(fs.existsSync(path.join(opened.root, '.sophy', 'atividade.1.jsonl')), true);
  const rows = listActivity(opened, { limite: 20 });
  assert.equal(rows.length >= 2, true);
  const target = rows.find((row) => row.notePath === 'Nota-5.md');
  assert.ok(target);
  const undone = callTool('activity.undo', { libraryPath: opened.root, id: target.id }) as {
    autor: string;
  };
  assert.equal(undone.autor, 'usuario');
  assert.equal(fs.existsSync(path.join(opened.root, 'Nota-5.md')), false);
  assert.equal(fs.existsSync(path.join(opened.root, 'Nota-4.md')), true);
});

test('a Sofi lê atividade no modo pergunta e só desfaz no modo agente, com confirmação', async () => {
  const opened = library();
  const pergunta = sofiTools('pergunta').map((tool) => tool.function.name);
  const agente = sofiTools('agente').map((tool) => tool.function.name);
  assert.equal(pergunta.includes('activity.list'), true);
  assert.equal(pergunta.includes('activity.diff'), true);
  assert.equal(pergunta.includes('activity.undo'), false);
  assert.equal(pergunta.includes('note.write'), false);
  assert.equal(agente.includes('activity.undo'), true);
  assert.match(agentConfirmation('activity.undo', {}), /Desfazer essa atividade/);
  callTool('note.create', {
    libraryPath: opened.root,
    path: 'Alvo.md',
    body: 'fica\n',
    origin: 'ui',
  });
  const id = listActivity(opened)[0]?.id;
  assert.equal(typeof id, 'string');
  const script = (allow: boolean): AgentModelClient => {
    const steps = [
      { toolCalls: [{ name: 'activity.undo', arguments: { id } }] },
      { content: 'pronto' },
    ];
    return async () => {
      const next = steps.shift();
      return next ?? { content: '' };
    };
  };
  const denied = await runAgentTurn({
    libraryPath: opened.root,
    message: 'desfaz',
    key: 'chave-ficticia',
    confirm: () => false,
    client: script(false),
  });
  assert.equal(denied.actions[0]?.ok, false);
  assert.match(denied.actions[0]?.error ?? '', /recusou/i);
  assert.match(fs.readFileSync(path.join(opened.root, 'Alvo.md'), 'utf8'), /fica/);
  const allowed = await runAgentTurn({
    libraryPath: opened.root,
    message: 'desfaz',
    key: 'chave-ficticia',
    confirm: (request) => request.tool === 'activity.undo',
    client: script(true),
  });
  assert.equal(allowed.actions[0]?.ok, true);
  assert.equal(fs.existsSync(path.join(opened.root, 'Alvo.md')), false);
  assert.equal(listActivity(opened)[0]?.autor, 'usuario');
  assert.equal(listActivity(opened)[0]?.tool, 'activity.undo');
});
