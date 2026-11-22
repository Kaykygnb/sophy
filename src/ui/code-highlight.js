/**
 * Realce do bloco de código. Só a tela muda: o Markdown guarda a cerca
 * (```ts) e o texto, inclusive // !, // ? , // TODO e // *.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SophyCode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CATALOG = [
    { id: 'javascript', label: 'JavaScript', fence: 'js', aliases: ['js', 'javascript'], prism: 'javascript', deps: ['clike'] },
    { id: 'typescript', label: 'TypeScript', fence: 'ts', aliases: ['ts', 'typescript'], prism: 'typescript', deps: ['clike', 'javascript'] },
    { id: 'jsx', label: 'JSX', fence: 'jsx', aliases: ['jsx'], prism: 'jsx', deps: ['markup', 'clike', 'javascript'] },
    { id: 'tsx', label: 'TSX', fence: 'tsx', aliases: ['tsx'], prism: 'tsx', deps: ['markup', 'clike', 'javascript', 'jsx', 'typescript'] },
    { id: 'python', label: 'Python', fence: 'py', aliases: ['py', 'python'], prism: 'python', deps: [] },
    { id: 'html', label: 'HTML', fence: 'html', aliases: ['html', 'htm'], prism: 'markup', deps: [] },
    { id: 'xml', label: 'XML', fence: 'xml', aliases: ['xml', 'svg'], prism: 'markup', deps: [] },
    { id: 'css', label: 'CSS', fence: 'css', aliases: ['css'], prism: 'css', deps: [] },
    { id: 'scss', label: 'SCSS', fence: 'scss', aliases: ['scss', 'sass'], prism: 'scss', deps: ['css'] },
    { id: 'json', label: 'JSON', fence: 'json', aliases: ['json'], prism: 'json', deps: [] },
    { id: 'bash', label: 'Bash', fence: 'bash', aliases: ['bash', 'sh', 'shell', 'zsh'], prism: 'bash', deps: [] },
    { id: 'markdown', label: 'Markdown', fence: 'md', aliases: ['md', 'markdown'], prism: 'markdown', deps: [] },
    { id: 'sql', label: 'SQL', fence: 'sql', aliases: ['sql'], prism: 'sql', deps: [] },
    { id: 'rust', label: 'Rust', fence: 'rs', aliases: ['rs', 'rust'], prism: 'rust', deps: [] },
    { id: 'go', label: 'Go', fence: 'go', aliases: ['go', 'golang'], prism: 'go', deps: ['clike'] },
    { id: 'java', label: 'Java', fence: 'java', aliases: ['java'], prism: 'java', deps: ['clike'] },
    { id: 'c', label: 'C', fence: 'c', aliases: ['c'], prism: 'c', deps: ['clike'] },
    { id: 'cpp', label: 'C++', fence: 'cpp', aliases: ['cpp', 'c++', 'cc', 'hpp'], prism: 'cpp', deps: ['clike', 'c'] },
    { id: 'csharp', label: 'C#', fence: 'cs', aliases: ['cs', 'csharp', 'c#'], prism: 'csharp', deps: ['clike'] },
    { id: 'kotlin', label: 'Kotlin', fence: 'kt', aliases: ['kt', 'kotlin'], prism: 'kotlin', deps: ['clike'] },
    { id: 'swift', label: 'Swift', fence: 'swift', aliases: ['swift'], prism: 'swift', deps: [] },
    { id: 'ruby', label: 'Ruby', fence: 'rb', aliases: ['rb', 'ruby'], prism: 'ruby', deps: ['clike'] },
    { id: 'php', label: 'PHP', fence: 'php', aliases: ['php'], prism: 'php', deps: ['markup', 'markup-templating'] },
    { id: 'yaml', label: 'YAML', fence: 'yaml', aliases: ['yaml', 'yml'], prism: 'yaml', deps: [] },
    { id: 'toml', label: 'TOML', fence: 'toml', aliases: ['toml'], prism: 'toml', deps: [] },
    { id: 'diff', label: 'Diff', fence: 'diff', aliases: ['diff'], prism: 'diff', deps: [] },
    { id: 'powershell', label: 'PowerShell', fence: 'ps1', aliases: ['ps1', 'powershell', 'pwsh'], prism: 'powershell', deps: [] },
    { id: 'lua', label: 'Lua', fence: 'lua', aliases: ['lua'], prism: 'lua', deps: [] },
  ];

  const POPULAR = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'markdown', 'sql'];

  function fold(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase();
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function byId(id) {
    return CATALOG.find((item) => item.id === id) || null;
  }

  function resolveLanguage(info) {
    const token = String(info || '').trim().split(/\s+/)[0] || '';
    if (!token) return { token: '', known: null };
    const folded = fold(token);
    const known = CATALOG.find((item) => item.aliases.some((alias) => fold(alias) === folded) || fold(item.fence) === folded) || null;
    return { token, known };
  }

  function labelFor(info) {
    const resolved = resolveLanguage(info);
    if (!resolved.token) return 'Texto';
    return resolved.known ? resolved.known.label : resolved.token;
  }

  function commentKind(line) {
    const text = String(line).replace(/^\s+/, '');
    const match = text.match(/^(?:\/\/|#|--|\/\*|\*(?!\*))\s*([\s\S]*)$/);
    if (!match) return '';
    const rest = match[1];
    if (/^TODO\b/i.test(rest)) return 'todo';
    if (rest.startsWith('!')) return 'alerta';
    if (rest.startsWith('?')) return 'duvida';
    if (rest.startsWith('*')) return 'nota';
    return '';
  }

  function decorate(source, highlighted) {
    const sourceLines = String(source).split('\n');
    const htmlLines = String(highlighted).split('\n');
    if (sourceLines.length !== htmlLines.length) return String(highlighted);
    return sourceLines
      .map((line, index) => {
        const kind = commentKind(line);
        const piece = htmlLines[index];
        return kind ? `<span class="codigo-marca codigo-marca--${kind}">${piece}</span>` : piece;
      })
      .join('\n');
  }

  function highlight(source, info, prism) {
    const text = String(source ?? '');
    const { known } = resolveLanguage(info);
    let html = escapeHtml(text);
    const grammar = known && prism && prism.languages ? prism.languages[known.prism] : null;
    if (grammar && typeof prism.highlight === 'function') {
      try {
        html = prism.highlight(text, grammar, known.prism);
      } catch {
        html = escapeHtml(text);
      }
    }
    return decorate(text, html);
  }

  function grammarPlan(info) {
    const { known } = resolveLanguage(info);
    if (!known) return [];
    const names = [];
    for (const name of [...known.deps, known.prism]) {
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  }

  function rank(infos) {
    const counts = new Map();
    for (const info of infos || []) {
      const resolved = resolveLanguage(info);
      const key = resolved.known ? resolved.known.id : resolved.token;
      if (!key) continue;
      const row = counts.get(key) || { key, count: 0, known: resolved.known };
      row.count += 1;
      counts.set(key, row);
    }
    const used = [...counts.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const usedIds = new Set(used.filter((row) => row.known).map((row) => row.known.id));
    const popular = POPULAR.filter((id) => !usedIds.has(id));
    const rest = CATALOG.map((item) => item.id)
      .filter((id) => !usedIds.has(id) && !popular.includes(id))
      .sort((a, b) => byId(a).label.localeCompare(byId(b).label, 'pt'));
    return { used, popular, rest };
  }

  function search(query) {
    const q = fold(String(query || '').trim());
    if (!q) return CATALOG.slice();
    return CATALOG.filter(
      (item) => fold(item.label).includes(q) || fold(item.fence).includes(q) || item.aliases.some((alias) => fold(alias).includes(q)),
    );
  }

  return {
    CATALOG,
    POPULAR,
    resolveLanguage,
    labelFor,
    commentKind,
    highlight,
    grammarPlan,
    rank,
    search,
    escapeHtml,
  };
});
