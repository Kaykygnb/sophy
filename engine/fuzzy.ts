/** Busca aproximada para o menu [[ — tokens do query batem no início de palavras. */

export function fold(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();
}

export function fuzzyScore(query: string, ...haystacks: string[]) {
  const q = fold(query).trim();
  if (!q) return 1;
  const hay = fold(haystacks.filter(Boolean).join(' \n '));
  if (!hay) return 0;
  if (hay.includes(q)) return 100 + Math.max(0, 40 - hay.indexOf(q));
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    const at = words.findIndex((word) => word.startsWith(token) || word.includes(token));
    if (at < 0) return 0;
    score += words[at].startsWith(token) ? 24 : 10;
    score += Math.max(0, 8 - at);
  }
  return score;
}

export function rankByFuzzy<T>(
  items: T[],
  query: string,
  fields: (item: T) => string[],
  options: { limit?: number; recent?: (item: T) => number } = {},
) {
  const limit = options.limit ?? 12;
  return items
    .map((item) => ({
      item,
      score: fuzzyScore(query, ...fields(item)),
      recent: options.recent?.(item) ?? 0,
    }))
    .filter((row) => row.score > 0 || !fold(query))
    .sort((a, b) => b.score - a.score || b.recent - a.recent)
    .slice(0, limit)
    .map((row) => row.item);
}
