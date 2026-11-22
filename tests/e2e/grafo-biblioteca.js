/* Biblioteca de exemplo para os testes e prints do grafo e das tags:
   4 estantes, notas criadas em datas diferentes (criada:), wikilinks, link para bloco nomeado e tags. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NOTAS = [
  [
    'Estudos',
    'Memoria',
    'Memória',
    '2026-01-04',
    ['estudo', 'estudo/memoria'],
    ['Estudos/Foco', 'Estudos/Sono'],
  ],
  [
    'Estudos',
    'Foco',
    'Atenção e foco',
    '2026-01-09',
    ['estudo'],
    ['Estudos/Memoria', 'Trabalho/Rotina'],
  ],
  ['Estudos', 'Sono', 'Sono e aprendizado', '2026-01-21', ['estudo', 'saude'], ['Estudos/Memoria']],
  [
    'Estudos',
    'Repeticao',
    'Repetição espaçada',
    '2026-02-02',
    ['estudo', 'estudo/memoria', 'metodo'],
    ['Estudos/Memoria', 'Projetos/Sophy#api'],
  ],
  [
    'Estudos',
    'Leitura-ativa',
    'Leitura ativa',
    '2026-02-14',
    ['estudo', 'livro'],
    ['Leituras/Rapido-devagar', 'Estudos/Foco'],
  ],
  [
    'Estudos',
    'Mapas',
    'Mapas mentais',
    '2026-03-03',
    ['estudo', 'metodo'],
    ['Estudos/Leitura-ativa'],
  ],
  [
    'Estudos',
    'Feynman',
    'Técnica Feynman',
    '2026-03-19',
    ['estudo', 'metodo'],
    ['Estudos/Repeticao', 'Estudos/Mapas'],
  ],
  ['Trabalho', 'Rotina', 'Rotina da semana', '2026-01-12', ['trabalho'], ['Trabalho/Reuniao']],
  [
    'Trabalho',
    'Reuniao',
    'Reunião semanal',
    '2026-01-26',
    ['trabalho', 'reuniao'],
    ['Trabalho/Pauta', 'Projetos/Sophy'],
  ],
  [
    'Trabalho',
    'Pauta',
    'Pauta de março',
    '2026-03-01',
    ['trabalho', 'reuniao'],
    ['Trabalho/Rotina'],
  ],
  [
    'Trabalho',
    'Metas',
    'Metas do trimestre',
    '2026-02-20',
    ['trabalho', 'projeto'],
    ['Projetos/Sophy', 'Trabalho/Rotina'],
  ],
  ['Trabalho', 'Contatos', 'Contatos', '2026-04-02', ['trabalho'], []],
  [
    'Projetos',
    'Sophy',
    'Sophy',
    '2026-01-15',
    ['projeto', 'ideia'],
    ['Projetos/Grafo', 'Projetos/Sofi'],
  ],
  [
    'Projetos',
    'Grafo',
    'Grafo animado',
    '2026-02-08',
    ['projeto', 'ideia'],
    ['Projetos/Sophy#api', 'Estudos/Mapas'],
  ],
  ['Projetos', 'Sofi', 'Sofi, a assistente', '2026-02-25', ['projeto'], ['Projetos/Sophy']],
  ['Projetos', 'Tags', 'Tags com cor', '2026-03-10', ['projeto', 'ideia'], ['Projetos/Grafo']],
  [
    'Projetos',
    'Lancamento',
    'Lançamento',
    '2026-04-10',
    ['projeto'],
    ['Projetos/Sophy', 'Trabalho/Metas'],
  ],
  ['Leituras', 'Rapido-devagar', 'Rápido e devagar', '2026-01-30', ['livro'], ['Estudos/Foco']],
  [
    'Leituras',
    'Habitos',
    'Hábitos atômicos',
    '2026-02-17',
    ['livro', 'saude'],
    ['Trabalho/Rotina', 'Estudos/Sono'],
  ],
  [
    'Leituras',
    'Deep-work',
    'Trabalho focado',
    '2026-03-07',
    ['livro', 'trabalho'],
    ['Estudos/Foco', 'Leituras/Habitos'],
  ],
  [
    'Leituras',
    'Fichamento',
    'Fichamento',
    '2026-03-28',
    ['livro', 'metodo'],
    ['Estudos/Leitura-ativa'],
  ],
  [
    'Leituras',
    'Lista',
    'Lista de leitura',
    '2026-04-15',
    ['livro'],
    ['Leituras/Rapido-devagar', 'Leituras/Habitos', 'Leituras/Deep-work'],
  ],
  ['Estudos', 'Rascunho', 'Rascunho solto', '2026-04-18', [], []],
];

function makeGraphLibrary(prefix = 'sophy-grafo-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.sophy'), { recursive: true });
  for (const [shelf, file, title, date, tags, links] of NOTAS) {
    fs.mkdirSync(path.join(root, shelf), { recursive: true });
    const front = `---\ncriada: ${date}T09:00:00\n${tags.length ? `tags: [${tags.join(', ')}]\n` : ''}---\n`;
    const body = `# ${title}\n\n${links.map((link) => `Ver [[${link}]].`).join(' ')}\n${file === 'Sophy' ? '\n```js title="api"\nexport const versao = 4;\n```\n' : ''}${tags[0] ? `\nNo texto: #${tags[0]}\n` : ''}`;
    fs.writeFileSync(path.join(root, shelf, `${file}.md`), front + body);
  }
  return root;
}

function launchArgs(root, theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-grafo-data-'));
  fs.writeFileSync(
    path.join(userData, 'ui.json'),
    JSON.stringify({ onboarded: true, libraryPath: root, libraries: [root], theme }),
  );
  const env = { ...process.env, NODE_OPTIONS: '--experimental-strip-types' };
  delete env.ELECTRON_RUN_AS_NODE;
  return { args: ['.', `--test-user-data=${userData}`], env };
}

module.exports = { makeGraphLibrary, launchArgs, NOTAS };
