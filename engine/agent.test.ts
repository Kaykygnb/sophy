import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { agentTools, runAgentTurn } from './agent.ts';
import { openLibrary } from './library.ts';

test('a Sofi usa a tool com origem agent, grava ponto e não deixa a chave na biblioteca', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-agente-'));
  openLibrary(root);
  const secret = 'sk-teste-sofi-nao-gravar';
  assert.equal(agentTools().some((tool) => /key|chave|secret|token/i.test(tool.function.name)), false);
  let seen = '';
  const result = await runAgentTurn({
    libraryPath: root,
    message: 'Crie uma nota',
    key: secret,
    fetchImpl: async (_url, init) => {
      seen = init.headers.Authorization;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: `feito ${secret}`,
                tool_calls: [
                  {
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
  assert.match(fs.readFileSync(path.join(root, 'Entrada/Sofi.md'), 'utf8'), /# Sofi/);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'versoes')), true);
  const dumped = dump(root);
  assert.equal(dumped.includes(secret), false);
});

function dump(directory: string): string {
  let text = '';
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) text += dump(full);
    else text += fs.readFileSync(full);
  }
  return text;
}

test('Sofi só move notas e altera canvas depois da confirmação', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-agent-confirm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Estudos'));
  fs.writeFileSync(path.join(root, 'Estudos', 'A.md'), 'original\n');
  fs.writeFileSync(path.join(root, 'Mapa.canvas'), JSON.stringify({ nodes: [], edges: [] }));
  for (const [name, args, changed] of [
    ['entry.move', { from: 'Estudos/A.md', to: 'Estudos/B.md' }, () => fs.existsSync(path.join(root, 'Estudos', 'B.md'))],
    ['canvas.node.put', { path: 'Mapa.canvas', node: { id: 'novo', type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'confirmado' } }, () => fs.readFileSync(path.join(root, 'Mapa.canvas'), 'utf8').includes('confirmado')],
  ] as const) {
    for (const allowed of [false, true]) {
      let confirmations = 0;
      const input = { ...args };
      if (name === 'canvas.node.put') {
        const { readCanvas } = await import('./canvas.ts');
        Object.assign(input, { expectedRevision: readCanvas(openLibrary(root), 'Mapa.canvas').revision });
      }
      await runAgentTurn({ libraryPath: root, message: 'executar', key: 'chave-ficticia',
        confirm: () => { confirmations += 1; return allowed; },
        fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(input) } }] } }] }) }),
      });
      assert.equal(confirmations, 1);
      assert.equal(changed(), allowed);
    }
  }
});
