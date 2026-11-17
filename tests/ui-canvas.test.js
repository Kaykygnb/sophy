const { test } = require('node:test');
const assert = require('node:assert/strict');
const canvas = require('../src/ui/canvas-board');

test('o encaixe na grade arredonda para 20 px', () => {
  assert.equal(canvas.snap(33), 40);
  assert.equal(canvas.snap(28), 20);
  assert.equal(canvas.snap(-12), -20);
});

test('alinhar encosta os cartões selecionados na mesma linha', () => {
  const aligned = canvas.alignNodes(
    [
      { id: 'a', x: 30, y: 48, width: 10, height: 10 },
      { id: 'b', x: 90, y: 110, width: 10, height: 10 },
    ],
    'y',
  );
  assert.equal(aligned[0].y, 40);
  assert.equal(aligned[1].y, 40);
  assert.equal(aligned[1].x, 90);
});

test('a seta sai do lado pedido do cartão', () => {
  const from = canvas.sidePoint({ x: 0, y: 0, width: 100, height: 40 }, 'right');
  const to = canvas.sidePoint({ x: 200, y: 80, width: 80, height: 40 }, 'left');
  assert.deepEqual(from, { x: 100, y: 20 });
  assert.deepEqual(to, { x: 200, y: 100 });
  assert.match(canvas.curve(from, to), /^M 100 20 Q/);
});
