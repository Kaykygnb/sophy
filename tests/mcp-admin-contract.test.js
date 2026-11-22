const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('o IPC expõe os clientes MCP e o registro não', () => {
  const preload = fs.readFileSync(path.join('src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join('src', 'main.js'), 'utf8');
  const tools = fs.readFileSync(path.join('engine', 'tools.ts'), 'utf8');
  assert.equal(preload.includes('mcpAdmin: (tool, input)'), true);
  assert.equal(main.includes("'sophy:mcp-admin'"), true);
  assert.equal(main.includes("withAuthor('usuario'"), true);
  assert.equal(main.includes('engine.mcpAdmin'), true);
  assert.equal(tools.includes("'mcp.clients.list'"), false);
  assert.equal(tools.includes("'mcp.legacy.get'"), false);
  assert.equal(preload.includes('src/ui/'), false);
});

test('o motor e o IPC não deixam resíduo de log de depuração', () => {
  const files = [
    ...fs.readdirSync('engine').filter((name) => name.endsWith('.ts')).map((name) => path.join('engine', name)),
    path.join('src', 'main.js'),
    path.join('src', 'preload.js'),
    'README.md',
    path.join('docs', 'motor.md'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(text.includes('// #region agent log'), false, file);
    assert.equal(text.includes('127.0.0.1:7516'), false, file);
  }
});
