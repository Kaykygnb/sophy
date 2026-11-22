import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EngineError } from './errors.ts';
import { exportNote } from './export.ts';
import {
  importAttachmentBytes,
  importAttachmentFromPath,
  listAttachments,
  openLibrary,
  readAttachmentDataUrl,
  resolveAttachmentPath,
} from './library.ts';
import { splitMarkdown } from './markdown.ts';
import { lightPaperHtml } from './study.ts';
import { callTool, toolMutates } from './tools.ts';

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-anexo-'));
  return { root, opened: openLibrary(root) };
}

function write(root: string, relative: string, content: string | Buffer) {
  const full = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

test('attachment.list mostra Anexos/ e quem cita, sem inventar id', () => {
  const { root, opened } = library();
  const outside = path.join(os.tmpdir(), `sophy-foto-${Date.now()}.png`);
  fs.writeFileSync(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const imported = importAttachmentFromPath(opened, outside, 'Anexos');
  const pasted = importAttachmentBytes(opened, 'colado.png', Buffer.from('PNG'), 'Anexos');
  write(root, 'Anexos/sub/guia.pdf', 'PDF');
  write(root, 'Anexos/solto.bin', 'bin');
  write(root, 'Anexos/.oculto.png', 'nao');
  write(root, 'Estudos/foto.png', 'fora');
  const nota = [
    '---',
    'id: abc',
    'tags:',
    '  - estudo',
    'notas1_editor: \'{"version":1,"structure":[{"id":"x"}]}\'',
    'capa: Anexos/foto.png',
    '---',
    'Veja ![[Anexos/foto.png]] e [[Anexos/sub/guia.pdf|guia]].',
    'id: no corpo',
    '',
  ].join('\n');
  // O import nomeia pelo arquivo de origem; o teste fixa o caminho citado.
  if (imported.path !== 'Anexos/foto.png') {
    fs.renameSync(path.join(root, ...imported.path.split('/')), path.join(root, 'Anexos', 'foto.png'));
  }
  write(root, 'Estudos/Ideia.md', nota);
  write(root, 'Z.md', '[pdf](Anexos/sub/guia.pdf)\n');
  write(root, 'Cerca.md', '```\n[[Anexos/foto.png]]\n```\n`[[Anexos/foto.png]]`\n');
  const semId = 'sem id, só texto\n';
  write(root, 'Solta.md', semId);

  const read = readAttachmentDataUrl(opened, pasted.path);
  assert.equal(read.mime, 'image/png');
  assert.match(read.dataUrl, /^data:image\/png;base64,/);
  assert.equal(toolMutates('attachment.list'), false);

  const listed = callTool('attachment.list', { libraryPath: root }) as Array<{
    name: string;
    path: string;
    size: number;
    mime: string;
    usedBy: string[];
  }>;
  assert.deepEqual(
    listed.map((item) => item.path),
    ['Anexos/colado.png', 'Anexos/foto.png', 'Anexos/solto.bin', 'Anexos/sub/guia.pdf'].sort((a, b) =>
      a.localeCompare(b, 'pt-BR', { numeric: true }),
    ),
  );
  const byPath = new Map(listed.map((item) => [item.path, item]));
  assert.equal(byPath.get('Anexos/foto.png')?.mime, 'image/png');
  assert.equal(byPath.get('Anexos/foto.png')?.name, 'foto.png');
  assert.equal(byPath.get('Anexos/foto.png')?.size, 4);
  assert.deepEqual(byPath.get('Anexos/foto.png')?.usedBy, ['Estudos/Ideia.md']);
  assert.equal(byPath.get('Anexos/sub/guia.pdf')?.mime, 'application/pdf');
  assert.deepEqual(byPath.get('Anexos/sub/guia.pdf')?.usedBy, ['Estudos/Ideia.md', 'Z.md']);
  assert.equal(byPath.get('Anexos/solto.bin')?.mime, 'application/octet-stream');
  assert.deepEqual(byPath.get('Anexos/solto.bin')?.usedBy, []);
  assert.deepEqual(byPath.get('Anexos/colado.png')?.usedBy, []);
  assert.equal(listed.some((item) => item.path.startsWith('Estudos/')), false);
  assert.equal(listed.some((item) => item.name.startsWith('.')), false);
  assert.equal(fs.readFileSync(path.join(root, 'Solta.md'), 'utf8'), semId);
  assert.equal(fs.existsSync(path.join(root, '.sophy', 'note-ids.json')), false);
});

test('note.export tira o id, copia os anexos citados e o PDF reusa o papel claro', () => {
  const { root, opened } = library();
  write(root, 'Anexos/foto.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write(root, 'Anexos/sub/guia.pdf', 'PDF');
  write(root, 'Anexos/solto.txt', 'nao entra');
  const nota = [
    '---',
    'id: abc',
    'tags:',
    '  - estudo',
    'notas1_editor: \'{"version":1,"structure":[{"id":"x"}]}\'',
    'capa: Anexos/foto.png',
    '---',
    'Veja ![[Anexos/foto.png]] e [[Anexos/ausente.pdf]] e [guia](Anexos/sub/guia.pdf).',
    'id: no corpo',
    '',
  ].join('\n');
  const file = write(root, 'Estudos/Ideia.md', nota);
  const before = fs.readFileSync(file);

  const markdown = exportNote(opened, 'Estudos/Ideia.md', 'md');
  assert.equal(markdown.format, 'md');
  assert.equal(markdown.path, 'Estudos/Ideia.md');
  assert.equal(markdown.filename, 'Ideia.md');
  assert.equal(markdown.suggestedName, 'Ideia.md');
  assert.equal(fs.readFileSync(file).equals(before), true);
  assert.match(fs.readFileSync(file, 'utf8'), /^---\nid: abc\n/);
  const parsed = splitMarkdown(markdown.content);
  assert.equal(parsed.frontmatter && 'id' in parsed.frontmatter, false);
  assert.deepEqual(parsed.frontmatter?.tags, ['estudo']);
  assert.equal(parsed.frontmatter?.notas1_editor, '{"version":1,"structure":[{"id":"x"}]}');
  assert.equal(parsed.frontmatter?.capa, 'Anexos/foto.png');
  assert.equal(parsed.body, nota.slice(nota.indexOf('Veja ')));
  assert.match(markdown.content, /id: no corpo/);
  const frontmatterBlock = markdown.content.slice(0, markdown.content.indexOf(parsed.body));
  assert.doesNotMatch(frontmatterBlock, /^id\s*:/m);
  assert.deepEqual(
    markdown.files.map((item) => item.path),
    ['Anexos/foto.png', 'Anexos/sub/guia.pdf'],
  );
  assert.equal(markdown.files[0].mime, 'image/png');
  assert.equal(Buffer.from(markdown.files[0].bytesBase64, 'base64').toString('hex'), '89504e47');
  assert.equal(Buffer.from(markdown.files[1].bytesBase64, 'base64').toString(), 'PDF');

  const pdf = callTool('note.export', {
    libraryPath: root,
    path: 'Estudos/Ideia.md',
    format: 'pdf',
  }) as { format: string; filename: string; content: string; files: unknown[] };
  assert.equal(pdf.format, 'pdf');
  assert.equal(pdf.filename, 'Ideia.pdf');
  assert.equal(pdf.suggestedName, 'Ideia.pdf');
  assert.equal(pdf.files.length, 0);
  assert.equal(pdf.content, lightPaperHtml('Ideia', parsed.body));
  assert.match(pdf.content, /data-theme="light"/);
  assert.match(pdf.content, /background: #fff/);
  assert.equal(fs.readFileSync(file).equals(before), true);
  assert.equal(toolMutates('note.export'), false);
});

test('exportar sem frontmatter preserva o arquivo e o id inválido sai da cópia', () => {
  const { root, opened } = library();
  const cru = 'só texto\n';
  write(root, 'Solta.md', cru);
  const plain = exportNote(opened, 'Solta.md', 'md');
  assert.equal(plain.content, cru);
  assert.deepEqual(plain.files, []);
  assert.equal(fs.readFileSync(path.join(root, 'Solta.md'), 'utf8'), cru);

  const bom = '\uFEFF---\nid: abc\n---\ncorpo\n';
  write(root, 'Bom.md', bom);
  const exportedBom = exportNote(opened, 'Bom.md', 'md');
  assert.equal(exportedBom.content.startsWith('\uFEFF'), true);
  assert.match(exportedBom.content, /corpo/);
  assert.doesNotMatch(exportedBom.content, /^id:/m);
  assert.equal(fs.readFileSync(path.join(root, 'Bom.md'), 'utf8'), bom);

  write(root, 'Quebrada.md', '---\nid: abc\ntags: [\n---\ncorpo\n');
  const broken = exportNote(opened, 'Quebrada.md', 'md');
  assert.match(broken.content, /tags: \[/);
  assert.match(broken.content, /corpo/);
  assert.doesNotMatch(broken.content, /^id\s*:/m);
});

test('abrir anexo recusa caminho fora da biblioteca', () => {
  const { root, opened } = library();
  write(root, 'Anexos/foto.png', 'PNG');
  write(root, 'Anexos/pasta/vazio.txt', '');
  fs.mkdirSync(path.join(root, 'Anexos', 'dir'));
  const full = resolveAttachmentPath(opened, 'Anexos/foto.png');
  assert.equal(full, fs.realpathSync(path.join(root, 'Anexos', 'foto.png')));
  assert.equal(full.startsWith(fs.realpathSync(root) + path.sep), true);

  const outside = path.join(os.tmpdir(), `sophy-fora-${Date.now()}.png`);
  fs.writeFileSync(outside, 'segredo');
  fs.symlinkSync(outside, path.join(root, 'Anexos', 'atalho.png'));
  assert.throws(
    () => resolveAttachmentPath(opened, 'Anexos/atalho.png'),
    (error: unknown) => error instanceof EngineError && error.code === 'symlink',
  );
  assert.equal(
    listAttachments(opened).some((item) => item.path === 'Anexos/atalho.png'),
    false,
  );
  assert.equal(fs.readFileSync(outside, 'utf8'), 'segredo');

  for (const bad of [
    '../segredo.png',
    'Anexos/../../etc/passwd',
    'Anexos/../Solta.md',
    '/etc/passwd',
    'Estudos/foto.png',
    'Anexos',
    '',
    'Anexos/dir',
  ]) {
    assert.throws(
      () => resolveAttachmentPath(opened, bad),
      (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
    );
  }
  assert.throws(
    () => resolveAttachmentPath(opened, 'Anexos/nao.png'),
    (error: unknown) => error instanceof EngineError && error.code === 'not-found',
  );
  assert.throws(
    () => exportNote(opened, 'Anexos/foto.png', 'md'),
    (error: unknown) => error instanceof EngineError && error.code === 'invalid-note',
  );
  assert.throws(
    () => exportNote(opened, 'Nao.md', 'pdf'),
    (error: unknown) => error instanceof EngineError && error.code === 'not-found',
  );
  assert.throws(
    () => exportNote(opened, 'Solta.md', 'html' as 'md'),
    (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
  );
  assert.throws(() => callTool('note.export', { libraryPath: root, path: 'Solta.md', format: 'docx' }));
});

test('Anexos ausente é lista vazia; arquivo ou link no lugar da pasta falha', () => {
  const empty = library();
  assert.deepEqual(callTool('attachment.list', { libraryPath: empty.root }), []);

  const asFile = library();
  fs.writeFileSync(path.join(asFile.root, 'Anexos'), 'x');
  assert.throws(
    () => listAttachments(asFile.opened),
    (error: unknown) => error instanceof EngineError && error.code === 'invalid-path',
  );

  const linked = library();
  const alvo = fs.mkdtempSync(path.join(os.tmpdir(), 'sophy-alvo-'));
  fs.symlinkSync(alvo, path.join(linked.root, 'Anexos'));
  assert.throws(
    () => listAttachments(linked.opened),
    (error: unknown) => error instanceof EngineError && error.code === 'symlink',
  );
});
