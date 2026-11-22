const { test } = require('node:test');
const assert = require('node:assert/strict');
const Rich = require('../src/ui/rich-text');
const Writing = require('../src/ui/writing');
const { plainText } = require('../engine/wikilinks.ts');

test('aplicar e remover cor e fundo no Markdown', () => {
  const start = 'texto colorido aqui';
  const withCor = Rich.wrapSelection(start, 6, 14, { cor: 'azul' });
  assert.equal(withCor.text, 'texto <span data-cor="azul">colorido</span> aqui');
  const withFundo = Rich.wrapSelection(withCor.text, withCor.start, withCor.end, { fundo: 'amarelo' });
  assert.equal(withFundo.text, 'texto <span data-cor="azul" data-fundo="amarelo">colorido</span> aqui');
  const withoutCor = Rich.wrapSelection(withFundo.text, withFundo.start, withFundo.end, { cor: null });
  assert.equal(withoutCor.text, 'texto <span data-fundo="amarelo">colorido</span> aqui');
  const clear = Rich.wrapSelection(withoutCor.text, withoutCor.start, withoutCor.end, { fundo: null });
  assert.equal(clear.text, 'texto colorido aqui');
});

test('HTML malicioso dentro da span é limpo', () => {
  const dirty =
    '<span data-cor="azul" style="color:red" onclick="alert(1)"><script>x()</script>oi<img src=x onerror=1></span><span data-cor="neon">fora</span>';
  const clean = Rich.sanitize(dirty);
  assert.equal(clean.includes('script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('style='), false);
  assert.equal(clean.includes('onerror'), false);
  assert.equal(clean.includes('data-cor="neon"'), false);
  assert.match(clean, /<span data-cor="azul">/);
  assert.match(clean, /oi/);
  const html = Writing.inlineHtml(dirty);
  assert.equal(html.includes('onclick'), false);
  assert.equal(html.includes('<script'), false);
  assert.match(html, /marca-cor--azul/);
});

test('a busca ignora a marcação de cor', () => {
  const body = 'Antes <span data-cor="vermelho" data-fundo="amarelo">palavra</span> depois';
  assert.match(plainText(body), /Antes palavra depois/);
  assert.equal(plainText(body).includes('span'), false);
  assert.equal(plainText(body).includes('data-cor'), false);
});

test('destaques alertam pergunta tarefa e dica renderizam', () => {
  for (const kind of ['alerta', 'pergunta', 'tarefa', 'dica']) {
    const source = `> [!${kind}]\n> corpo ${kind}\n`;
    const html = Writing.inlineHtml(`[!${kind}] corpo`);
    assert.equal(typeof html, 'string');
    assert.match(source, new RegExp(`\\[!${kind}\\]`));
  }
  assert.equal(Rich.isColor('azul'), true);
  assert.equal(Rich.isColor('neon'), false);
  assert.deepEqual(Rich.COLORS.length, 9);
});

test('o texto visível tira o destaque e reconstitui a data cortada pela marca', () => {
  const cortada = 'Comprar a ração do tobi 2<span data-fundo="marrom">026-11-22</span>';
  assert.equal(Rich.stripMarkup(cortada), 'Comprar a ração do tobi 2026-11-22');
  assert.equal(Rich.stripMarkup(cortada).includes('span'), false);
  assert.equal(Rich.stripMarkup(cortada).includes('data-fundo'), false);
  const inteira = 'Comprar a ração do tobi <span data-fundo="marrom">2026-11-22</span>';
  assert.equal(Rich.stripMarkup(inteira), 'Comprar a ração do tobi 2026-11-22');
  assert.equal(Rich.stripMarkup('<span data-fundo="marrom"></span>').trim(), '');
  assert.equal(Rich.stripMarkup('   ').trim(), '');
});
