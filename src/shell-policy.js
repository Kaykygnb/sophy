'use strict';

/** Propriedades do seletor de arquivos. O main só abre arquivo, com múltipla escolha. */
const OPEN_FILE_PROPERTIES = Object.freeze(['openFile', 'multiSelections']);

/**
 * http, https e mailto. `file:`, `javascript:` e texto que não é URL ficam de fora.
 * O protocolo comparado é o que `new URL` devolve, já em minúsculas.
 */
function isSafeExternalUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
}

/** Cancelar devolve lista vazia. O renderer trata `value` como caminhos. */
function chosenFilePaths(result) {
  if (!result || result.canceled) return [];
  if (!Array.isArray(result.filePaths)) return [];
  return result.filePaths.filter((item) => typeof item === 'string' && item);
}

module.exports = {
  OPEN_FILE_PROPERTIES,
  isSafeExternalUrl,
  chosenFilePaths,
};
