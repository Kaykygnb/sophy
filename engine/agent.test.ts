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
