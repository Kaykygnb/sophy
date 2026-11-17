const { test } = require('node:test');
const assert = require('node:assert/strict');
const doc = require('../src/ui/doc');

const sample = `---
tags:
  - estudo
aliases:
  - Repetição
---
# Título

Veja [[Estudos/Nota|apelido]] e um [[ incompleto.
![[Estudos/Figura]]

- [ ] aberta
- [/] estudar 📅 2026-11-20 ⏫
- [x] feita ✅ 2026-11-01

\`\`\`js
const colchetes = "[[";
\`\`\`
`;

test('Enter separa o parágrafo, Backspace junta e a colagem vira blocos', () => {
  const start = doc.parseDocument('Primeiro parágrafo.\n');
  const index = start.blocks.findIndex((block) => block.type === 'paragraph');
  const split = doc.splitBlock(start, index, 'Primeiro parágrafo.'.length);
  const typed = doc.insertInBlock(split.doc, split.caret.index, split.caret.offset, 'Segunda linha');
  const saved = doc.serializeDocument(typed.doc);
  assert.equal(saved.includes('Primeiro parágrafo.Segunda'), false);
  assert.match(saved, /Primeiro parágrafo\.\n\nSegunda linha\n/);
  const reopened = doc.parseDocument(saved);
  assert.deepEqual(
    reopened.blocks.filter((block) => block.type === 'paragraph').map((block) => block.raw.trim()),
    ['Primeiro parágrafo.', 'Segunda linha'],
  );
  const joined = doc.joinBlocks(typed.doc, typed.caret.index);
  assert.match(doc.serializeDocument(joined.doc), /Primeiro parágrafo\. Segunda linha/);
  const pasted = doc.pasteLines(start, index, 'Primeiro '.length, 'A\nB');
  assert.match(doc.serializeDocument(pasted.doc), /Primeiro A\n\nBparágrafo\./);
  assert.deepEqual(
    pasted.doc.blocks.filter((block) => block.type === 'paragraph').map((block) => block.raw.trim()),
    ['Primeiro A', 'Bparágrafo.'],
  );
  const markdown = doc.pasteLines(doc.parseDocument('\n'), 0, 0, '# Título colado\n- item colado\n> citação colada\n');
  const kinds = markdown.doc.blocks.map((block) => block.type);
  assert.equal(kinds.includes('heading'), true);
  assert.equal(kinds.includes('item'), true);
  assert.equal(kinds.includes('quote'), true);
  const soft = doc.insertInBlock(start, index, 'Primeiro '.length, '\n');
  assert.match(doc.serializeDocument(soft.doc), /Primeiro \nparágrafo\./);
});

test('lista continua no Enter e o item vazio vira parágrafo', () => {
  const start = doc.parseDocument('- item um\n');
  const split = doc.splitBlock(start, 0, 'item um'.length);
  assert.equal(split.doc.blocks[1].type, 'item');
  assert.match(split.doc.blocks[1].raw, /^- /);
  const numbered = doc.parseDocument('1. um\n');
  const next = doc.splitBlock(numbered, 0, 'um'.length);
  assert.match(next.doc.blocks[1].raw, /^2\. /);
  const empty = doc.splitBlock(doc.parseDocument('- \n'), 0, 0);
  assert.equal(empty.doc.blocks[0].type, 'paragraph');
});

test('Backspace no vazio não come o texto e Delete junta com espaço', () => {
  const note = doc.parseDocument('Alpha uma.\n\nBravo duas.\n');
  const bravo = note.blocks.findIndex((block) => block.raw.includes('Bravo'));
  const cleared = doc.joinBlocks(note, bravo);
  assert.equal(cleared.doc.blocks.some((block) => block.type === 'blank'), false);
  assert.match(doc.serializeDocument(cleared.doc), /Alpha uma\./);
  assert.match(doc.serializeDocument(cleared.doc), /Bravo duas\./);
  const forward = doc.joinForward(doc.parseDocument('Primeiro\n\nSegundo\n'), 0);
  assert.match(doc.serializeDocument(forward.doc), /Primeiro Segundo/);
  assert.doesNotMatch(doc.serializeDocument(forward.doc), /PrimeiroSegundo/);
});

test('negrito, itálico, riscado, destaque e código voltam no Markdown', () => {
  const raw = '**memória** e *mais* ~~não~~ ==aqui== `ok`';
  const parts = doc.parseInlines(raw);
  assert.equal(doc.serializeInlines(parts), raw);
  assert.equal(parts.some((part) => part.type === 'bold' && part.text === 'memória'), true);
  assert.equal(parts.some((part) => part.type === 'italic'), true);
  assert.equal(parts.some((part) => part.type === 'strike'), true);
  assert.equal(parts.some((part) => part.type === 'highlight'), true);
  assert.equal(parts.some((part) => part.type === 'code' && part.text === 'ok'), true);
});

test('negrito e itálico envolvem o trecho no Markdown', () => {
  const start = doc.parseDocument('memória\n');
  const bold = doc.wrapBlock(start, 0, 0, 7, '**', '**');
  assert.equal(doc.serializeDocument(bold.doc), '**memória**\n');
  const italic = doc.wrapPlain('abc', 0, 0, '*');
  assert.equal(italic.text, '**abc');
  assert.equal(italic.cursor, 1);
});

test('Enter no início do item guarda o texto', () => {
  const split = doc.splitBlock(doc.parseDocument('- item dois\n'), 0, 0);
  assert.match(split.doc.blocks[0].raw, /^-\s*\n?$/);
  assert.match(split.doc.blocks[1].raw, /item dois/);
  assert.equal(split.doc.blocks[1].type, 'item');
});

test('listas contíguas não ganham linha em branco', () => {
  const text = doc.serializeDocument(doc.parseDocument('- um\n- dois\n1. tres\n'));
  assert.match(text, /- um\n- dois\n/);
  assert.doesNotMatch(text, /- um\n\n- dois/);
});

test('markdown volta igual, com wikilink, tarefa e frontmatter', () => {
  const parsed = doc.parseDocument(sample);
  const again = doc.parseDocument(doc.serializeDocument(parsed));
  assert.deepEqual(
    again.blocks.map((block) => block.type),
    parsed.blocks.map((block) => block.type),
  );
  assert.match(parsed.prefix, /tags:/);
  const tasks = parsed.blocks.filter((block) => block.type === 'task').map((block) => block.task);
  assert.equal(tasks[1].status, '/');
  assert.equal(tasks[1].due, '2026-11-20');
  assert.equal(tasks[1].priority, 'alta');
  assert.equal(doc.serializeTask(tasks[1]), '- [/] estudar 📅 2026-11-20 ⏫');
  const paragraph = parsed.blocks.find((block) => block.raw.includes('apelido'));
  const inlines = doc.parseInlines(paragraph.raw);
  assert.equal(doc.serializeInlines(inlines), paragraph.raw);
  assert.equal(
    inlines.some((part) => part.type === 'wikilink' && part.label === 'apelido'),
    true,
  );
  assert.equal(paragraph.raw.includes('[[ incompleto'), true);
  assert.equal(
    inlines.some((part) => part.type === 'text' && part.text.includes('[[ incompleto')),
    true,
  );
});

test('editar um bloco preserva frontmatter, wikilinks e a tarefa', () => {
  const parsed = doc.parseDocument(sample);
  const index = parsed.blocks.findIndex((block) => block.raw.startsWith('# '));
  const next = doc.withBlockRaw(parsed, index, '# Outro título\n');
  const text = doc.serializeDocument(next);
  assert.match(text, /^---\ntags:/);
  assert.match(text, /\[\[Estudos\/Nota\|apelido\]\]/);
  assert.match(text, /- \[\/\] estudar 📅 2026-11-20 ⏫/);
  assert.match(text, /\[\[ incompleto/);
  assert.equal(text.includes('\\[\\['), false);
});

test('trocar o estado da tarefa não apaga data nem prioridade', () => {
  const line = '- [/] estudar 📅 2026-11-20 ⏫\n';
  const changed = doc.setTaskStatus(line, 'x');
  assert.equal(changed, '- [x] estudar 📅 2026-11-20 ⏫\n');
  const task = doc.parseTask(changed);
  assert.equal(task.due, '2026-11-20');
  assert.equal(task.priority, 'alta');
});

test('frontmatter legado permanece quando só o corpo muda', () => {
  const source = '---\nnotas1_editor: { antigo: true }\n---\ncorpo [[Nota]]\n';
  const parsed = doc.parseDocument(source);
  const index = parsed.blocks.findIndex((block) => block.type === 'paragraph');
  const next = doc.withBlockRaw(parsed, index, 'corpo novo [[Nota]]\n');
  assert.equal(
    doc.serializeDocument(next),
    '---\nnotas1_editor: { antigo: true }\n---\ncorpo novo [[Nota]]\n',
  );
});
