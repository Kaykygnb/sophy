import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import {
  decodeExportBytes,
  planMarkdownExport,
  suggestMarkdownName,
  type MarkdownPlan,
} from './export.ts';

function directory() {
  return path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-grava-')));
}

function planned(plan: MarkdownPlan) {
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.action !== 'write') throw new Error('esperava gravar');
  return plan;
}

test('o nome sugerido é o título da nota e a extensão md entra se faltar', () => {
  assert.equal(suggestMarkdownName('Ideia.md'), 'Ideia.md');
  assert.equal(suggestMarkdownName('Estudos/Ideia'), 'Ideia.md');
  assert.equal(suggestMarkdownName('Estudos\\Ideia'), 'Ideia.md');
  assert.equal(suggestMarkdownName(''), 'nota.md');
  assert.equal(suggestMarkdownName(undefined), 'nota.md');
});

test('anexo não escapa da pasta escolhida e conflito pede uma escolha', () => {
  const root = directory();
  const note = path.join(root, 'Ideia.md');
  const foto = path.join(root, 'Anexos', 'foto.png');
  const existing = new Set<string>();
  const exists = (target: string) => existing.has(target);

  for (const bad of ['Anexos/../../etc/passwd', '/etc/passwd', 'Anexos\\foto.png', 'Anexos/../foto.png', 'Anexos/./foto.png', '']) {
    const refused = planMarkdownExport({ directory: root, noteFile: note, files: [bad], exists });
    assert.equal(refused.ok, false, bad);
  }
  const outside = planMarkdownExport({
    directory: root,
    noteFile: path.join(path.dirname(root), 'Ideia.md'),
    files: [],
    exists,
  });
  assert.equal(outside.ok, false);

  const clean = planned(planMarkdownExport({ directory: root, noteFile: note, files: ['Anexos/foto.png'], exists }));
  assert.equal(clean.path, note);
  assert.deepEqual(
    clean.writes.map((item) => [item.absolute, item.source, item.replace]),
    [
      [note, 'note', false],
      [foto, 'Anexos/foto.png', false],
    ],
  );

  existing.add(note);
  existing.add(foto);
  const choose = planMarkdownExport({ directory: root, noteFile: note, files: ['Anexos/foto.png'], exists });
  assert.equal(choose.ok, true);
  if (!choose.ok) return;
  assert.equal(choose.action, 'choose');
  if (choose.action !== 'choose') return;
  assert.deepEqual(choose.conflicts, ['Ideia.md', 'Anexos/foto.png']);

  const replaced = planned(
    planMarkdownExport({
      directory: root,
      noteFile: note,
      files: ['Anexos/foto.png'],
      exists,
      choice: 'replace',
    }),
  );
  assert.equal(replaced.path, note);
  assert.equal(replaced.writes[0].replace, true);
  assert.equal(replaced.writes[1].absolute, foto);
  assert.equal(replaced.writes[1].replace, true);

  const kept = planned(
    planMarkdownExport({
      directory: root,
      noteFile: note,
      files: ['Anexos/foto.png'],
      exists,
      choice: 'keep-both',
    }),
  );
  assert.equal(kept.path, path.join(root, 'Ideia (2).md'));
  assert.equal(kept.writes[1].absolute, path.join(root, 'Anexos', 'foto (2).png'));
  assert.equal(kept.writes[1].source, 'Anexos/foto.png');
  assert.equal(kept.writes[0].replace, false);

  existing.add(path.join(root, 'Ideia (2).md'));
  const next = planned(
    planMarkdownExport({
      directory: root,
      noteFile: note,
      files: ['Anexos/foto.png'],
      exists,
      choice: 'keep-both',
    }),
  );
  assert.equal(path.basename(next.path), 'Ideia (3).md');
  assert.equal(next.writes[1].relative, 'Anexos/foto (2).png');

  const canceled = planMarkdownExport({
    directory: root,
    noteFile: note,
    files: ['Anexos/foto.png'],
    exists,
    choice: 'cancel',
  });
  assert.deepEqual(canceled, { ok: true, action: 'cancel' });
});

test('manter os dois só renomeia o arquivo que já existe', () => {
  const root = directory();
  const note = path.join(root, 'Ideia.md');
  const existing = new Set([note]);
  const kept = planned(
    planMarkdownExport({
      directory: root,
      noteFile: note,
      files: ['Anexos/foto.png'],
      exists: (target) => existing.has(target),
      choice: 'keep-both',
    }),
  );
  assert.equal(path.basename(kept.path), 'Ideia (2).md');
  assert.equal(kept.writes[1].relative, 'Anexos/foto.png');
});

test('bytes do anexo recusam base64 inválido', () => {
  assert.equal(decodeExportBytes('UE5H').toString(), 'PNG');
  assert.throws(
    () => decodeExportBytes('%%%'),
    (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
  );
});
