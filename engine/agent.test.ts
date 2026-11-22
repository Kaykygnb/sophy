import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  agentConfirmation,
  agentTools,
  normalizeContext,
  runAgentTurn,
  type AgentModelMessage,
  type AgentProgress,
} from './agent.ts';
import { EngineError } from './errors.ts';
import { openLibrary } from './library.ts';
import { callTool, trackedVersionId } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sofi-'));
  openLibrary(root);
  return root;
}

function dump(directory: string): string {
  let text = '';
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) text += dump(full);
    else text += fs.readFileSync(full);
  }
  return text;
}

function scripted(
  steps: Array<{
    content?: string;
    toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
  }>,
) {
  const seen: AgentModelMessage[][] = [];
  let calls = 0;
  const client = async ({ messages }: { messages: AgentModelMessage[] }) => {
    seen.push(messages);
    const step = steps[Math.min(calls, steps.length - 1)];
    calls += 1;
    return step;
  };
  return { client, seen, count: () => calls };
}

test('a Sofi usa a tool com origem agent, grava ponto e não deixa a chave na biblioteca', async () => {
  const root = library();
  const secret = 'sk-teste-sofi-nao-gravar';
  assert.equal(
    agentTools().some((tool) => /key|chave|secret|token/i.test(tool.function.name)),
    false,
  );
  assert.equal(
    agentTools().some((tool) => tool.function.name === 'site.export'),
    false,
  );
  let seen = '';
  let rounds = 0;
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'Crie uma nota',
    key: secret,
    fetchImpl: async (_url, init) => {
      seen = init.headers.Authorization;
      rounds += 1;
      if (rounds > 1) {
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: `feito ${secret}` } }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'criar',
                    function: {
                      name: 'note.create',
                      arguments: JSON.stringify({ path: 'Entrada/Sofi.md', body: '# Sofi\n' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    },
  });
  assert.match(seen, /Bearer sk-teste/);
  assert.equal(result.text.includes(secret), false);
  assert.equal(result.actions[0]?.label, 'Criou a nota Sofi');
  assert.equal(typeof result.actions[0]?.versionId, 'string');
  assert.match(fs.readFileSync(path.join(root, 'Entrada/Sofi.md'), 'utf8'), /# Sofi/);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'versoes')), true);
  assert.equal(dump(root).includes(secret), false);
});

test('Sofi só move notas e altera canvas depois da confirmação', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-agent-confirm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), 'original\n');
  fs.writeFileSync(path.join(root, 'Mapa.canvas'), JSON.stringify({ nodes: [], edges: [] }));
  for (const [name, args, changed] of [
    [
      'entry.move',
      { from: 'Estudos/A.md', to: 'Estudos/B.md' },
      () => fs.existsSync(path.join(root, 'Estudos', 'B.md')),
    ],
    [
      'canvas.node.put',
      {
        path: 'Mapa.canvas',
        node: { id: 'novo', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'confirmado' },
      },
      () => fs.readFileSync(path.join(root, 'Mapa.canvas'), 'utf8').includes('confirmado'),
    ],
  ] as const) {
    for (const allowed of [false, true]) {
      let confirmations = 0;
      let round = 0;
      const input = { ...args };
      if (name === 'canvas.node.put') {
        const { readCanvas } = await import('./canvas.ts');
        Object.assign(input, {
          expectedRevision: readCanvas(openLibrary(root), 'Mapa.canvas').revision,
        });
      }
      await runAgentTurn({
        libraryPath: root,
        message: 'executar',
        key: 'chave-ficticia',
        confirm: () => {
          confirmations += 1;
          return allowed;
        },
        fetchImpl: async () => {
          round += 1;
          if (round > 1)
            return {
              ok: true,
              json: async () => ({ choices: [{ message: { content: 'pronto' } }] }),
            };
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    tool_calls: [
                      { id: 'c1', function: { name, arguments: JSON.stringify(input) } },
                    ],
                  },
                },
              ],
            }),
          };
        },
      });
      assert.equal(confirmations, 1);
      assert.equal(changed(), allowed);
    }
  }
});

test('o loop devolve o resultado da primeira ferramenta e executa a segunda', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const progress: AgentProgress[] = [];
  const script = scripted([
    {
      toolCalls: [
        { name: 'note.create', arguments: { path: 'Entrada/Reunião.md', body: 'texto-da-sofi\n' } },
      ],
    },
    { toolCalls: [{ name: 'note.read', arguments: { path: 'Entrada/Reunião.md' } }] },
    { content: 'Criei a nota e li o texto.' },
  ]);
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'Crie a nota Reunião e leia',
    key: 'chave-ficticia',
    client: script.client,
    onProgress: (event) => progress.push(event),
  });
  assert.equal(script.count(), 3);
  assert.equal(result.text, 'Criei a nota e li o texto.');
  assert.equal(result.actions.length, 2);
  assert.equal(result.actions[0]?.tool, 'note.create');
  assert.equal(result.actions[0]?.ok, true);
  assert.equal(result.actions[0]?.label, 'Criou a nota Reunião');
  assert.equal(result.actions[1]?.tool, 'note.read');
  assert.equal(result.actions[1]?.ok, true);
  assert.equal(result.actions[1]?.versionId, undefined);
  const second = JSON.stringify(script.seen[1]);
  assert.match(second, /texto-da-sofi/);
  assert.equal(second.includes('note.create'), true);
  const toolPhases = progress.filter((event) => event.phase === 'tool');
  assert.deepEqual(
    toolPhases.map((event) => event.label),
    ['Criando a nota Reunião', 'Lendo a nota Reunião'],
  );
  assert.equal(
    toolPhases.every((event) => event.label !== event.tool),
    true,
  );
  assert.equal(progress.at(-1)?.phase, 'done');
  assert.match(fs.readFileSync(path.join(root, 'Entrada', 'Reunião.md'), 'utf8'), /texto-da-sofi/);
});

test('confirmação negada volta ao modelo e o turno segue', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), 'original\n');
  const script = scripted([
    {
      toolCalls: [{ name: 'entry.move', arguments: { from: 'Estudos/A.md', to: 'Estudos/B.md' } }],
    },
    {
      toolCalls: [
        { name: 'note.create', arguments: { path: 'Entrada/Seguiu.md', body: 'seguiu\n' } },
      ],
    },
    { content: 'Não movi. Criei outra nota.' },
  ]);
  const confirms: string[] = [];
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'mova e, se eu recusar, crie outra',
    key: 'chave-ficticia',
    client: script.client,
    confirm: (request) => {
      confirms.push(request.tool);
      assert.equal(typeof request.confirmId, 'string');
      assert.match(request.label, /Mover a nota/);
      assert.equal(request.input.from, 'Estudos/A.md');
      return false;
    },
  });
  assert.deepEqual(confirms, ['entry.move']);
  assert.match(JSON.stringify(script.seen[1]), /recusou esta ação/);
  assert.equal(result.actions[0]?.ok, false);
  assert.equal(result.actions[0]?.error, 'A pessoa recusou esta ação.');
  assert.equal(result.actions[0]?.versionId, undefined);
  assert.equal(result.actions[1]?.ok, true);
  assert.equal(result.actions[1]?.label, 'Criou a nota Seguiu');
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'B.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'Entrada', 'Seguiu.md')), true);
});

test('ferramenta fora do registro não roda e o conjunto inseguro pede confirmação', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-sofi-site-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  for (const name of ['site.export', 'vault.import', 'entry.trash', 'version.restore']) {
    assert.equal(
      agentTools().some((tool) => tool.function.name === name),
      false,
    );
    assert.equal(agentConfirmation(name, { path: 'Nota.md', shelf: 'Estudos' }).length > 0, true);
  }
  const script = scripted([
    {
      toolCalls: [
        { name: 'ui.openNote', arguments: { path: 'Nota.md' } },
        { name: 'inventada.tool', arguments: {} },
        { name: 'site.export', arguments: { destination: outside, theme: 'light' } },
      ],
    },
    { content: 'Não fiz nada disso.' },
  ]);
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'tente',
    key: 'chave-ficticia',
    client: script.client,
    confirm: () => false,
  });
  assert.equal(result.actions.length, 3);
  assert.equal(
    result.actions.every((action) => action.ok === false),
    true,
  );
  assert.match(result.actions[0]?.error || '', /não está disponível/);
  assert.match(result.actions[1]?.error || '', /desconhecida/);
  assert.equal(result.actions[2]?.error, 'A pessoa recusou esta ação.');
  assert.equal(fs.existsSync(outside) && fs.readdirSync(outside).length === 0, true);
});

test('cancelamento aborta o cliente e emite done com canceled', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const progress: AgentProgress[] = [];
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = runAgentTurn({
    libraryPath: root,
    message: 'espere',
    key: 'chave-ficticia',
    signal: controller.signal,
    onProgress: (event) => progress.push(event),
    client: ({ signal }) =>
      new Promise((_resolve, reject) => {
        entered();
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (signal?.aborted) fail();
        else signal?.addEventListener('abort', fail, { once: true });
      }),
  });
  await ready;
  controller.abort();
  const result = await pending;
  assert.equal(result.canceled, true);
  assert.equal(result.text, 'Cancelado.');
  assert.equal(
    progress.some((event) => event.phase === 'thinking'),
    true,
  );
  assert.equal(progress.at(-1)?.phase, 'done');
  assert.equal(progress.at(-1)?.canceled, true);
});

test('o fetch recebe o mesmo AbortSignal do loop', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const controller = new AbortController();
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = runAgentTurn({
    libraryPath: root,
    message: 'espere',
    key: 'chave-ficticia',
    signal: controller.signal,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        entered();
        assert.equal(init.signal, controller.signal);
        const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener('abort', fail, { once: true });
      }),
  });
  await ready;
  controller.abort();
  const result = await pending;
  assert.equal(result.canceled, true);
});

test('mutação traz versionId e agent.undo desfaz só essa ação', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created = await runAgentTurn({
    libraryPath: root,
    message: 'crie',
    key: 'chave-ficticia',
    client: scripted([
      {
        toolCalls: [
          { name: 'note.create', arguments: { path: 'Entrada/Reunião.md', body: 'oi\n' } },
        ],
      },
      { content: 'pronto' },
    ]).client,
  });
  const versionId = created.actions[0]?.versionId;
  assert.equal(typeof versionId, 'string');
  assert.equal(fs.existsSync(path.join(root, 'Entrada', 'Reunião.md')), true);
  const undone = await runAgentTurn({
    libraryPath: root,
    message: 'desfaz',
    key: 'chave-ficticia',
    confirm: (request) => request.tool === 'agent.undo',
    client: scripted([
      { toolCalls: [{ name: 'agent.undo', arguments: { versionId } }] },
      { content: 'desfiz' },
    ]).client,
  });
  assert.equal(undone.actions[0]?.ok, true);
  assert.equal(undone.actions[0]?.label, 'Desfez uma ação');
  assert.equal(fs.existsSync(path.join(root, 'Entrada', 'Reunião.md')), false);
  assert.throws(
    () => callTool('agent.undo', { libraryPath: root, versionId }),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'already-undone');
      assert.match(error instanceof Error ? error.message : '', /já foi desfeita/);
      return true;
    },
  );
  assert.throws(
    () => callTool('agent.undo', { libraryPath: root, versionId: 'versao-que-nao-existe' }),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'not-found');
      assert.match(error instanceof Error ? error.message : '', /Não encontrei essa versão/);
      return true;
    },
  );
});

test('o contexto estruturado entra no prompt e agentAsk sem contexto continua válido', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(normalizeContext(undefined), undefined);
  assert.equal(normalizeContext('só a mensagem'), undefined);
  const withContext = scripted([{ content: 'vi a nota' }]);
  await runAgentTurn({
    libraryPath: root,
    message: 'resume',
    key: 'chave-ficticia',
    context: {
      notePath: 'Estudos/Reunião.md',
      selection: { text: 'trecho azul', from: 4, to: 15 },
    },
    client: withContext.client,
  });
  const system = withContext.seen[0]?.[0];
  assert.equal(system?.role, 'system');
  assert.match(
    String(system && 'content' in system ? system.content : ''),
    /Nota aberta: Estudos\/Reunião\.md/,
  );
  assert.match(String(system && 'content' in system ? system.content : ''), /trecho azul/);
  assert.match(String(system && 'content' in system ? system.content : ''), /4/);
  assert.match(String(system && 'content' in system ? system.content : ''), /15/);
  const plain = scripted([{ content: 'sem nota' }]);
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'oi',
    key: 'chave-ficticia',
    client: plain.client,
  });
  const plainSystem = String(
    plain.seen[0]?.[0] && 'content' in plain.seen[0][0] ? plain.seen[0][0].content : '',
  );
  assert.equal(plainSystem.includes('Nota aberta:'), false);
  assert.equal(result.text, 'sem nota');
  assert.deepEqual(result.actions, []);
});

test('agent.undo desfaz uma ação antiga e deixa a mais nova no lugar', (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = callTool('note.create', {
    libraryPath: root,
    path: 'A.md',
    body: 'antiga\n',
    origin: 'ui',
  });
  callTool('note.create', { libraryPath: root, path: 'B.md', body: 'nova\n', origin: 'ui' });
  const versionId = trackedVersionId(first);
  assert.equal(typeof versionId, 'string');
  const undone = callTool('agent.undo', { libraryPath: root, versionId }) as { undone: string };
  assert.equal(undone.undone, versionId);
  assert.equal(fs.existsSync(path.join(root, 'A.md')), false);
  assert.match(fs.readFileSync(path.join(root, 'B.md'), 'utf8'), /nova/);
});

test('sem chave o erro é sem_chave e erro repetido interrompe o loop', async (t) => {
  const root = library();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const progress: AgentProgress[] = [];
  await assert.rejects(
    () =>
      runAgentTurn({
        libraryPath: root,
        message: 'oi',
        key: '   ',
        onProgress: (event) => progress.push(event),
        client: async () => ({ content: 'não devia' }),
      }),
    (error: unknown) => {
      assert.equal(error instanceof EngineError && error.code, 'sem_chave');
      assert.match(error instanceof Error ? error.message : '', /chave/);
      return true;
    },
  );
  assert.equal(progress[0]?.phase, 'error');
  const script = scripted([
    { toolCalls: [{ name: 'note.create', arguments: { path: 'nota-sem-extensao', body: 'x' } }] },
  ]);
  const stopped = await runAgentTurn({
    libraryPath: root,
    message: 'repita o erro',
    key: 'chave-ficticia',
    client: script.client,
  });
  assert.equal(script.count(), 2);
  assert.match(stopped.text, /mesma ação falhou/);
  assert.equal(stopped.actions.length, 2);
  assert.equal(
    stopped.actions.every((action) => action.ok === false),
    true,
  );
});
