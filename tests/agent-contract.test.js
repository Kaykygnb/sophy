const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('preload e main expõem o contrato da Sofi', () => {
  const preload = fs.readFileSync(path.join('src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join('src', 'main.js'), 'utf8');
  for (const name of [
    'agentStatus',
    'agentKeySet',
    'agentKeyClear',
    'agentAsk: (message, context)',
    'agentCancel',
    'agentUndo',
    'agentConfirmReply',
    'onAgentProgress',
    'onAgentConfirm',
    'onLibraryChanged',
  ]) {
    assert.equal(preload.includes(name), true, name);
  }
  for (const channel of [
    'sophy:agent-status',
    'sophy:agent-key-set',
    'sophy:agent-key-clear',
    'sophy:agent-ask',
    'sophy:agent-progress',
    'sophy:agent-confirm',
    'sophy:agent-confirm-reply',
    'sophy:agent-cancel',
    'sophy:agent-undo',
    'sophy:library-changed',
  ]) {
    assert.equal(`${preload}\n${main}`.includes(channel), true, channel);
  }
  assert.equal(main.includes("fail('Guarde a chave no cofre antes de pedir.', 'sem_chave')"), true);
  assert.equal(main.includes('agent.config.'), true);
  assert.equal(main.includes("modo `arquivo`"), true);
  assert.equal(preload.includes('src/ui/'), false);
});
