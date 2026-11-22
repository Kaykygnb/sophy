/** Nota do dia: o arquivo é `Diário/AAAA-MM-DD.md`. A data é o nome. */
const DAILY = /^Diário\/(\d{4}-\d{2}-\d{2})\.md$/;

export function dailyDate(relative: string): string | null {
  const match = relative.split('\\').join('/').match(DAILY);
  return match ? match[1] : null;
}
