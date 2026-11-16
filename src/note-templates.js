'use strict';
(function (global) {
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function todayStamp(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function todayLabel(date = new Date()) {
    return date.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  const NOTE_TEMPLATES = [
    {
      id: 'blank',
      name: 'Em branco',
      description: 'Nota vazia para começar do zero.',
      content: () => '',
    },
    {
      id: 'daily',
      name: 'Diário',
      description: 'Registro do dia com seções leves.',
      content: (date = new Date()) =>
        `# ${todayLabel(date)}\n\n## O que aconteceu\n\n\n## Ideias\n\n\n## Amanhã\n\n`,
    },
    {
      id: 'meeting',
      name: 'Reunião',
      description: 'Pauta, notas e próximos passos.',
      content: () =>
        `# Reunião\n\n**Data:** ${todayStamp()}\n**Participantes:**\n\n## Pauta\n\n- \n\n## Notas\n\n\n## Próximos passos\n\n- [ ] \n`,
    },
    {
      id: 'project',
      name: 'Projeto',
      description: 'Contexto, objetivo e status.',
      content: () =>
        `# Projeto\n\n## Objetivo\n\n\n## Contexto\n\n\n## Próximas ações\n\n- [ ] \n\n## Decisões\n\n`,
    },
    {
      id: 'character',
      name: 'Personagem',
      description: 'Ficha rápida para mundos ficcionais.',
      content: () =>
        `# Personagem\n\n**Papel:**\n**Relacionamentos:**\n\n## Aparência\n\n\n## Motivação\n\n\n## Arco\n\n`,
    },
  ];
  global.SophyTemplates = {
    list: NOTE_TEMPLATES,
    render(id, date) {
      const template = NOTE_TEMPLATES.find((item) => item.id === id) || NOTE_TEMPLATES[0];
      return template.content(date);
    },
    todayStamp,
    todayLabel,
  };
})(window);
