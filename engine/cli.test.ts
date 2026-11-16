import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const bin = path.resolve('engine/bin/sophy');

function run(
  args: string[],
  options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const env = { ...process.env, ...options.env };
  if (!options.env || !('SOPHY_LIBRARY' in options.env)) delete env.SOPHY_LIBRARY;
  return spawnSync(bin, args, {
    encoding: 'utf8',
    cwd: options.cwd ?? os.tmpdir(),
    input: options.input,
    env,
  });
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-cli-'));
  const created = run(['init', root]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(fs.existsSync(path.join(root, '.sophy')), true);
  return root;
}

test('tools, ajuda e comando desconhecido', () => {
  const listed = run(['tools']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /note\.read — /);
  assert.match(listed.stdout, /entry\.move — /);
  const help = run(['help', 'note.create']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /libraryPath/);
  assert.match(help.stdout, /"origin"/);
  const missing = run(['nao-existe']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /desconhecido/);
  const bare = run([]);
  assert.equal(bare.status, 0);
  assert.match(bare.stdout, /sophy nova/);
});

test('atalhos criam, leem, buscam, movem, listam o grafo e desfazem com origem cli', () => {
  const root = library();
  const created = run([
    'nova',
    'Estudos/Ideia',
    '--texto',
    'Um gato [[Outra|o outro]]',
    '--biblioteca',
    root,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(
    fs.readFileSync(path.join(root, 'Estudos', 'Ideia.md'), 'utf8'),
    'Um gato [[Outra|o outro]]',
  );
  const read = run(['ler', 'Estudos/Ideia', '--biblioteca', root]);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /Um gato/);
  const found = run(['buscar', 'gato', '--biblioteca', root]);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /Estudos\/Ideia\.md/);
  assert.equal(found.stdout.includes('[['), false);
  run(['nova', 'Estudos/Outra', '--texto', 'destino', '--biblioteca', root]);
  const links = run(['links', 'Estudos/Ideia', '--biblioteca', root]);
  assert.equal(links.status, 0, links.stderr);
  assert.match(links.stdout, /resolved/);
  const back = run(['backlinks', 'Estudos/Outra', '--biblioteca', root]);
  assert.match(back.stdout, /Estudos\/Ideia\.md/);
  const moved = run(['mover', 'Estudos/Ideia.md', 'Livro/Ideia.md', '--biblioteca', root]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(
    fs.readFileSync(path.join(root, 'Livro', 'Ideia.md'), 'utf8'),
    /\[\[Outra\|o outro\]\]/,
  );
  const graph = run(['grafo', '--json', '--biblioteca', root]);
  assert.equal(graph.status, 0, graph.stderr);
  const parsed = JSON.parse(graph.stdout) as { nodes: unknown[]; edges: Array<{ from: string }> };
  assert.ok(parsed.nodes.length >= 2);
  assert.equal(parsed.edges[0].from, 'Livro/Ideia.md');
  const history = run(['historico', '--json', '--biblioteca', root]);
  const actions = JSON.parse(history.stdout) as Array<{ origin: string; tool: string }>;
  assert.equal(actions[0].origin, 'cli');
  assert.equal(actions[0].tool, 'entry.move');
  assert.equal(
    actions.every((action) => action.origin === 'cli'),
    true,
  );
  const shelves = run(['estantes', '--biblioteca', root]);
  assert.match(shelves.stdout, /Estudos/);
  assert.match(shelves.stdout, /Livro/);
  const undone = run(['desfazer', '--biblioteca', root]);
  assert.equal(undone.status, 0, undone.stderr);
  assert.match(undone.stdout, /Desfeito/);
  const removed = run(['lixeira', 'Estudos/Ideia.md', '--biblioteca', root]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(root, 'Estudos', 'Ideia.md')), false);
});

test('texto pela entrada padrão, biblioteca por ambiente ou .sophy, json e erros', () => {
  const root = library();
  const piped = run(['nova', 'Nota', '--texto', '-', '--biblioteca', root], {
    input: 'veio da entrada',
  });
  assert.equal(piped.status, 0, piped.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'veio da entrada');
  const nested = path.join(root, 'dentro');
  fs.mkdirSync(nested);
  const fromInside = run(['estantes'], { cwd: nested });
  assert.equal(fromInside.status, 0, fromInside.stderr);
  const fromEnv = run(['ler', 'Nota', '--json'], {
    cwd: os.tmpdir(),
    env: { SOPHY_LIBRARY: root },
  });
  assert.equal(fromEnv.status, 0, fromEnv.stderr);
  const body = JSON.parse(fromEnv.stdout) as { body: string; revision: string };
  assert.equal(body.body, 'veio da entrada');
  const conflict = run(
    [
      'note.write',
      '--path',
      'Nota.md',
      '--body',
      'outro',
      '--expectedRevision',
      '0'.repeat(64),
      '--biblioteca',
      root,
    ],
    { cwd: os.tmpdir() },
  );
  assert.equal(conflict.status, 2, conflict.stdout);
  assert.match(conflict.stderr, /Nada foi gravado/);
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'veio da entrada');
  run(['nova', 'Estudos/Nota', '--texto', 'a', '--biblioteca', root]);
  run(['nova', 'Livro/Nota', '--texto', 'b', '--biblioteca', root]);
  run(['nova', 'Meio/Ponte', '--texto', 'Veja [[Nota]]', '--biblioteca', root]);
  const ambiguous = run(['links', 'Meio/Ponte', '--biblioteca', root]);
  assert.equal(ambiguous.status, 2, ambiguous.stdout);
  assert.match(ambiguous.stdout, /ambiguous/);
  const forced = run(
    [
      'note.create',
      '--json',
      JSON.stringify({ path: 'Forcada.md', body: 'z', origin: 'ui' }),
      '--biblioteca',
      root,
    ],
    { cwd: os.tmpdir() },
  );
  assert.equal(forced.status, 0, forced.stderr);
  const after = JSON.parse(run(['historico', '--json', '--biblioteca', root]).stdout) as Array<{
    origin: string;
    tool: string;
  }>;
  assert.equal(after[0].tool, 'note.create');
  assert.equal(after[0].origin, 'cli');
});
