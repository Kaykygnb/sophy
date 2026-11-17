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

test('markdown volta igual, com wikilink, tarefa e frontmatter', () => {
  const parsed = doc.parseDocument(sample);
  assert.equal(doc.serializeDocument(parsed), sample);
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
