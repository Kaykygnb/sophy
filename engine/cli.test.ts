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

test('init cria a biblioteca e o marcador .sophy', () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-cli-')), 'notas');
  const created = run(['init', root]);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /Biblioteca pronta/);
  assert.equal(fs.statSync(path.join(root, '.sophy')).isDirectory(), true);
});

test('estantes lista a subpasta de primeiro nível', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'a', '--biblioteca', root]);
  const listed = run(['estantes', '--biblioteca', root]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^Estudos$/m);
  assert.doesNotMatch(listed.stdout, /\.sophy/);
});

test('nova grava markdown sem acrescentar escape', () => {
  const root = library();
  const created = run(['nova', 'Diario', '--texto', '[[', '--biblioteca', root]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'Diario.md'), 'utf8'), '[[');
});

test('ler imprime o corpo da nota', () => {
  const root = library();
  run(['nova', 'Diario', '--texto', 'linha unica', '--biblioteca', root]);
  const read = run(['ler', 'Diario', '--biblioteca', root]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout, 'linha unica\n');
});

test('buscar devolve o trecho limpo', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'Um gato [[Outra|o outro]]', '--biblioteca', root]);
  const found = run(['buscar', 'gato', '--biblioteca', root]);
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /Estudos\/Nota\.md \[body\]/);
  assert.equal(found.stdout.includes('[['), false);
});

test('links e backlinks mostram o destino resolvido', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'Veja [[Outra]]', '--biblioteca', root]);
  run(['nova', 'Estudos/Outra', '--texto', 'destino', '--biblioteca', root]);
  const links = run(['links', 'Estudos/Nota', '--biblioteca', root]);
  assert.equal(links.status, 0, links.stderr);
  assert.match(links.stdout, /resolved \[\[Outra\]\] -> Estudos\/Outra\.md/);
  const back = run(['backlinks', 'Estudos/Outra', '--biblioteca', root]);
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /Estudos\/Nota\.md/);
});

test('mover e lixeira atuam no arquivo', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'vai', '--biblioteca', root]);
  const moved = run(['mover', 'Estudos/Nota.md', 'Livro/Nota.md', '--biblioteca', root]);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'Livro', 'Nota.md'), 'utf8'), 'vai');
  const removed = run(['lixeira', 'Livro/Nota.md', '--biblioteca', root]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(path.join(root, 'Livro', 'Nota.md')), false);
});

test('grafo humano e --json', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'Veja [[Outra]]', '--biblioteca', root]);
  run(['nova', 'Estudos/Outra', '--texto', 'destino', '--biblioteca', root]);
  const human = run(['grafo', '--biblioteca', root]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Estudos\/Nota\.md -> Estudos\/Outra\.md/);
  const json = run(['grafo', '--json', '--biblioteca', root]);
  assert.equal(json.status, 0, json.stderr);
  const graph = JSON.parse(json.stdout) as { edges: Array<{ from: string; to: string }> };
  assert.deepEqual(graph.edges, [
    { from: 'Estudos/Nota.md', to: 'Estudos/Outra.md', format: 'wiki', weight: 1 },
  ]);
});

test('grafo aceita center e depth e preserva a linha from -> to', () => {
  const root = library();
  run(['nova', 'A', '--texto', '[[B]]', '--biblioteca', root]);
  run(['nova', 'B', '--texto', '[[C]]', '--biblioteca', root]);
  run(['nova', 'C', '--texto', 'fim', '--biblioteca', root]);
  const human = run(['grafo', '--center', 'A.md', '--depth', '1', '--biblioteca', root]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^2 notas\nA\.md -> B\.md\n$/);
  const focused = run(['grafo', '--center', 'A.md', '--depth', '2', '--json', '--biblioteca', root]);
  assert.equal(focused.status, 0, focused.stderr);
  const parsed = JSON.parse(focused.stdout) as { nodes: Array<{ path: string }> };
  assert.deepEqual(
    parsed.nodes.map((node) => node.path),
    ['A.md', 'B.md', 'C.md'],
  );
  const bad = run(['grafo', '--depth', '4', '--biblioteca', root]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /depth precisa ser um inteiro de 1 a 3/);
  const missing = run(['grafo', '--center', 'Nao.md', '--biblioteca', root]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /não existe/);
});

test('historico e desfazer registram e revertem a última ação', () => {
  const root = library();
  run(['nova', 'Nota', '--texto', 'um', '--biblioteca', root]);
  const history = run(['historico', '--biblioteca', root]);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /^cli note\.create /m);
  const undone = run(['desfazer', '--biblioteca', root]);
  assert.equal(undone.status, 0, undone.stderr);
  assert.match(undone.stdout, /Desfeito/);
  assert.equal(fs.existsSync(path.join(root, 'Nota.md')), false);
});

test('tool genérica aceita --campo e --json de entrada', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'campo', '--biblioteca', root]);
  const byFlag = run(['note.read', '--path', 'Estudos/Nota.md', '--biblioteca', root]);
  assert.equal(byFlag.status, 0, byFlag.stderr);
  assert.match(byFlag.stdout, /campo/);
  const byJson = run(['workspace.list', '--json', JSON.stringify({ libraryPath: root })]);
  assert.equal(byJson.status, 0, byJson.stderr);
  assert.deepEqual(JSON.parse(byJson.stdout), [{ name: 'Estudos', path: 'Estudos' }]);
});

test('códigos 0, 1 e 2', () => {
  const root = library();
  assert.equal(run(['estantes', '--biblioteca', root]).status, 0);
  const usage = run(['nova', '--biblioteca', root]);
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Uso: sophy nova/);
  const brokenJson = run(['note.list', '--json', '{', '--biblioteca', root]);
  assert.equal(brokenJson.status, 1);
  assert.match(brokenJson.stderr, /JSON/);
  run(['nova', 'Nota', '--texto', 'original', '--biblioteca', root]);
  const conflict = run([
    'note.write',
    '--path',
    'Nota.md',
    '--body',
    'outro',
    '--expectedRevision',
    '0'.repeat(64),
    '--biblioteca',
    root,
  ]);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /Nada foi gravado/);
  assert.equal(fs.readFileSync(path.join(root, 'Nota.md'), 'utf8'), 'original');
});

test('link ambíguo termina com código 2', () => {
  const root = library();
  run(['nova', 'Estudos/Nota', '--texto', 'a', '--biblioteca', root]);
  run(['nova', 'Livro/Nota', '--texto', 'b', '--biblioteca', root]);
  run(['nova', 'Meio/Ponte', '--texto', 'Veja [[Nota]]', '--biblioteca', root]);
  const ambiguous = run(['links', 'Meio/Ponte', '--biblioteca', root]);
  assert.equal(ambiguous.status, 2);
  assert.match(ambiguous.stdout, /ambiguous/);
  assert.match(ambiguous.stderr, /caminho da estante/);
});

test('JSON com outra origem ainda grava origin cli', () => {
  const root = library();
  const created = run([
    'note.create',
    '--json',
    JSON.stringify({ path: 'Forcada.md', body: 'z', origin: 'agent' }),
    '--biblioteca',
    root,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const history = JSON.parse(run(['historico', '--json', '--biblioteca', root]).stdout) as Array<{
    origin: string;
    tool: string;
  }>;
  assert.equal(history[0].tool, 'note.create');
  assert.equal(history[0].origin, 'cli');
});

test('biblioteca por --biblioteca, SOPHY_LIBRARY e pasta .sophy acima', () => {
  const root = library();
  run(['nova', 'Nota', '--texto', 'achei', '--biblioteca', root]);
  const explicit = run(['ler', 'Nota'], { cwd: os.tmpdir(), env: { SOPHY_LIBRARY: '' } });
  assert.equal(explicit.status, 1);
  const byFlag = run(['ler', 'Nota', '--biblioteca', root], { cwd: os.tmpdir() });
  assert.equal(byFlag.status, 0, byFlag.stderr);
  assert.match(byFlag.stdout, /achei/);
  const byEnv = run(['ler', 'Nota', '--json'], { cwd: os.tmpdir(), env: { SOPHY_LIBRARY: root } });
  assert.equal(byEnv.status, 0, byEnv.stderr);
  assert.equal((JSON.parse(byEnv.stdout) as { body: string }).body, 'achei');
  const nested = path.join(root, 'sub', 'mais');
  fs.mkdirSync(nested, { recursive: true });
  const byWalk = run(['estantes'], { cwd: nested });
  assert.equal(byWalk.status, 0, byWalk.stderr);
});

test('rodar de dentro da biblioteca não é recusado', () => {
  const root = library();
  const inside = run(['estantes'], { cwd: root });
  assert.equal(inside.status, 0, inside.stderr);
});

test('home, .ssh e .config continuam recusados', () => {
  const home = os.homedir();
  const ssh = path.join(home, '.ssh');
  const createdSsh = !fs.existsSync(ssh);
  if (createdSsh) fs.mkdirSync(ssh);
  try {
    for (const folder of [home, ssh, path.join(home, '.config')]) {
      const result = run(['estantes', '--biblioteca', folder], { cwd: os.tmpdir() });
      assert.equal(result.status, 2, `${folder}\n${result.stderr}`);
      assert.match(result.stderr, /protegida/);
    }
  } finally {
    if (createdSsh) fs.rmdirSync(ssh);
  }
});
