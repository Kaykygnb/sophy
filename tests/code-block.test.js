const { test } = require('node:test');
const assert = require('node:assert/strict');
const doc = require('../src/ui/doc');
const code = require('../src/ui/code-highlight');

function textOf(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const marked = ['// ! cuidado', '// ? porque', '// TODO depois', '// * nota', '# ! shell', '-- ? sql', '/* * bloco */', ' * ! linha'].join('\n');

test('a linguagem da cerca volta igual e uma linguagem fora da lista não quebra', () => {
  const typed = doc.codeRaw('```', 'ts', 'const pronto = true;');
  assert.equal(doc.codeParts(typed).info, 'ts');
  const reopened = doc.parseBody(typed).blocks.find((block) => block.type === 'code');
  assert.equal(doc.codeParts(reopened.raw).info, 'ts');
  assert.equal(code.labelFor('ts'), 'TypeScript');

  const unknown = '```linguagem-que-nao-existe\necho ok\n# ! shell\n```\n';
  const block = doc.parseBody(unknown).blocks.find((item) => item.type === 'code');
  assert.equal(block.raw, unknown);
  assert.equal(doc.codeParts(block.raw).info, 'linguagem-que-nao-existe');
  assert.equal(code.resolveLanguage('linguagem-que-nao-existe').known, null);
  assert.deepEqual(code.grammarPlan('linguagem-que-nao-existe'), []);
  const html = code.highlight(doc.codeParts(block.raw).body, 'linguagem-que-nao-existe', null);
  assert.equal(textOf(html), doc.codeParts(block.raw).body);
  assert.match(html, /codigo-marca--alerta/);
  assert.equal(code.highlight('x', 'py', { languages: { python: {} }, highlight() { throw new Error('boom'); } }).includes('codigo-marca'), false);
});

test('os comentários coloridos ficam na tela e o Markdown continua literal', () => {
  const html = code.highlight(marked, 'ts', null);
  assert.match(html, /codigo-marca--alerta/);
  assert.match(html, /codigo-marca--duvida/);
  assert.match(html, /codigo-marca--todo/);
  assert.match(html, /codigo-marca--nota/);
  assert.equal(textOf(html), marked);
  assert.equal(code.commentKind('const a = "// !"'), '');
  const raw = doc.codeRaw('```', 'ts', marked);
  assert.equal(raw.includes('codigo-marca'), false);
  assert.match(raw, /\/\/ ! cuidado/);
  assert.match(raw, /# ! shell/);
  assert.match(raw, /-- \? sql/);
  assert.match(raw, /\/\* \* bloco \*\//);
  assert.equal(doc.serializeBlocks(doc.parseBody(raw).blocks).includes('<span'), false);
});

test('a busca lista as linguagens da nota antes das mais usadas', () => {
  const ranked = code.rank(['py', 'py', 'ts', 'linguagem-que-nao-existe']);
  assert.deepEqual(
    ranked.used.map((row) => row.key),
    ['python', 'linguagem-que-nao-existe', 'typescript'],
  );
  assert.equal(ranked.popular.includes('python'), false);
  assert.equal(ranked.popular.includes('typescript'), false);
  assert.equal(ranked.popular[0], 'javascript');
  assert.equal(code.search('type').some((item) => item.id === 'typescript'), true);
  assert.equal(code.search('inexistente').length, 0);
});

test('o nome do bloco vai na cerca como title="nome" e a linguagem continua valendo', () => {
  assert.deepEqual(code.parseInfo('js title="parser.js"'), { rest: 'js', title: 'parser.js' });
  assert.deepEqual(code.parseInfo("ts title='a b'"), { rest: 'ts', title: 'a b' });
  assert.deepEqual(code.parseInfo('title="só nome"'), { rest: '', title: 'só nome' });
  assert.equal(code.composeInfo('js', 'parser.js'), 'js title="parser.js"');
  assert.equal(code.composeInfo('', 'só nome'), 'title="só nome"');
  assert.equal(code.composeInfo('js', '  '), 'js');
  assert.equal(code.composeInfo('js', 'com "aspas"'), 'js title="com aspas"');
  assert.equal(code.labelFor('js title="parser.js"'), 'JavaScript');
  assert.equal(code.labelFor('title="só nome"'), 'Texto');
  const raw = doc.codeRaw('```', code.composeInfo('js', 'parser.js'), 'const a = 1;');
  assert.equal(raw, '```js title="parser.js"\nconst a = 1;\n```\n');
  assert.equal(doc.codeParts(raw).info, 'js title="parser.js"');
  const block = doc.parseBody(raw).blocks.find((item) => item.type === 'code');
  assert.equal(block.raw, raw);
});
