/**
 * Apresentação da lixeira, sem DOM: data relativa, tamanho, ordem e filtro.
 * O motor já devolve a lista por deletedAt decrescente; a ordenação aqui
 * cobre um retorno fora de ordem e os testes da interface.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyLixeira = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KIND_ICON = {
    note: 'note',
    canvas: 'squares-four',
    attachment: 'paperclip',
    folder: 'folder',
  };

  const KIND_LABEL = {
    note: 'Nota',
    canvas: 'Canvas',
    attachment: 'Anexo',
    folder: 'Pasta',
  };

  const MONTHS = [
    'jan.',
    'fev.',
    'mar.',
    'abr.',
    'mai.',
    'jun.',
    'jul.',
    'ago.',
    'set.',
    'out.',
    'nov.',
    'dez.',
  ];

  const MONTHS_FULL = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  const WEEKDAYS = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ];

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase();
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function asDate(value) {
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function dayDistance(date, now) {
    return Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  }

  function shortDate(date, withYear) {
    const text = `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
    return withYear ? `${text} de ${date.getFullYear()}` : text;
  }

  function fullDate(date) {
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} de ${MONTHS_FULL[date.getMonth()]} de ${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Data relativa em pt-BR, estável entre sistemas (não depende do Intl).
   * `full` vai no tooltip, com dia da semana e hora.
   */
  function formatDeletedAt(iso, now = new Date()) {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
      const raw = String(iso || '');
      return { relative: raw, full: raw };
    }
    const date = new Date(time);
    const current = asDate(now);
    const full = fullDate(date);
    const delta = current.getTime() - time;
    if (Math.abs(delta) < 60000) return { relative: 'agora', full };
    if (delta >= 60000 && delta < 3600000) {
      const minutes = Math.floor(delta / 60000);
      return { relative: minutes === 1 ? 'há 1 min' : `há ${minutes} min`, full };
    }
    const days = dayDistance(date, current);
    if (days <= 0 && delta > 0) {
      const hours = Math.floor(delta / 3600000);
      if (hours >= 1) return { relative: hours === 1 ? 'há 1 h' : `há ${hours} h`, full };
      const minutes = Math.max(1, Math.floor(delta / 60000));
      return { relative: minutes === 1 ? 'há 1 min' : `há ${minutes} min`, full };
    }
    if (days === 1) return { relative: 'ontem', full };
    if (days > 1 && days < 7) return { relative: `há ${days} dias`, full };
    return {
      relative: shortDate(date, date.getFullYear() !== current.getFullYear()),
      full,
    };
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '0 B';
    const rounded = Math.max(0, Math.round(value));
    if (rounded < 1024) return `${rounded} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = rounded / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    const digits = size >= 10 ? 0 : 1;
    const text = size.toFixed(digits).replace(/\.0$/, '').replace('.', ',');
    return `${text} ${units[unit]}`;
  }

  function sortTrash(items) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
      const left = String(a?.deletedAt || '');
      const right = String(b?.deletedAt || '');
      if (left !== right) return left < right ? 1 : -1;
      const leftId = String(a?.id || '');
      const rightId = String(b?.id || '');
      if (leftId === rightId) return 0;
      return leftId < rightId ? 1 : -1;
    });
  }

  function filterTrash(items, options = {}) {
    const query = fold(options.query).trim();
    const kind = options.kind || '';
    return sortTrash(items).filter((item) => {
      if (kind && item?.kind !== kind) return false;
      if (!query) return true;
      return fold(`${item?.title || ''} ${item?.originalPath || ''}`).includes(query);
    });
  }

  function kindIcon(kind) {
    return KIND_ICON[kind] || 'file';
  }

  function kindLabel(kind) {
    return KIND_LABEL[kind] || 'Item';
  }

  function countLabel(count) {
    const total = Number.isFinite(Number(count)) ? Math.max(0, Math.round(Number(count))) : 0;
    return total === 1 ? '1 item' : `${total} itens`;
  }

  return {
    KIND_ICON,
    KIND_LABEL,
    formatDeletedAt,
    formatSize,
    sortTrash,
    filterTrash,
    kindIcon,
    kindLabel,
    countLabel,
  };
});
