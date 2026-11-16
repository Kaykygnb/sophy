'use strict';
const path = require('node:path');
const Links = require('./note-links');
const hash = (text) => {
  text = text.replace(/\r\n/g, '\n');
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
function rewriteDocument(content, source, paths, mapPath, assetPaths = []) {
  const nextSource = mapPath(source),
    nextPaths = paths.map(mapPath),
    nextAssets = assetPaths.map(mapPath);
  function destination(target, format) {
    const spec = Links.parse(target);
    if (!spec.note) return target;
    const old = Links.resolve(target, source, paths, format, assetPaths);
    if (!old.path) return target;
    const next = mapPath(old.path);
    if (
      next === old.path &&
      Links.resolve(target, nextSource, nextPaths, format, nextAssets).path === next
    )
      return target;
    let note =
      format === 'markdown'
        ? path.posix
            .relative(path.posix.dirname(nextSource), next)
            .split('/')
            .map(encodeURIComponent)
            .join('/')
        : old.kind === 'attachment'
          ? next
          : next.replace(/\.md$/i, /\.md$/i.test(spec.note) ? '.md' : '');
    return (
      note + (spec.anchor ? '#' + spec.anchor : '') + (spec.alias !== null ? '|' + spec.alias : '')
    );
  }
  const refs = Links.scan(content);
  let changed = false,
    result = content;
  for (const ref of refs.reverse()) {
    const value = destination(ref.target, ref.format);
    if (value !== ref.target) {
      result = result.slice(0, ref.targetStart) + value + result.slice(ref.targetEnd);
      changed = true;
    }
  }
  if (!changed) return content;
  // Native link changes do not alter block topology: keep visual presentation in sync.
  const opening = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/),
    nextOpening = result.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (opening && nextOpening) {
    const line = opening[1].match(/^notas1_editor: (\{.*\})\s*$/m);
    if (line)
      try {
        const meta = JSON.parse(line[1]);
        if (meta.bodyHash === hash(content.slice(opening[0].length))) {
          const html = (value) =>
            typeof value !== 'string'
              ? value
              : value
                  .replace(/href="(notas1-wiki:)?([^"\n]+)"/g, (all, wiki, href) => {
                    try {
                      const decoded = wiki ? decodeURIComponent(href) : href;
                      const next = destination(decoded, wiki ? 'wiki' : 'markdown');
                      return next === decoded
                        ? all
                        : 'href="' +
                            (wiki ? 'notas1-wiki:' + encodeURIComponent(next) : Links.esc(next)) +
                            '"';
                    } catch {
                      return all;
                    }
                  })
                  .replace(/data-asset-ref="([^"]+)"/g, (all, encoded) => {
                    try {
                      const decoded = decodeURIComponent(encoded),
                        next = destination(decoded, 'embed');
                      return next === decoded
                        ? all
                        : 'data-asset-ref="' + encodeURIComponent(next) + '"';
                    } catch {
                      return all;
                    }
                  })
                  .replace(/src="sophy-asset:([^"]+)"/g, (all, encoded) => {
                    try {
                      const decoded = decodeURIComponent(encoded),
                        next = destination(decoded, 'embed');
                      return next === decoded
                        ? all
                        : 'src="sophy-asset:' + encodeURIComponent(next) + '"';
                    } catch {
                      return all;
                    }
                  });
          const walk = (blocks) => {
            for (const b of blocks || []) {
              if (b.type !== 'code') b.html = html(b.html);
              if (b.rows) b.rows = b.rows.map((row) => row.map(html));
              walk(b.children);
            }
          };
          if (meta.structure) walk(meta.structure);
          meta.bodyHash = hash(result.slice(nextOpening[0].length));
          result = result.replace(line[0], 'notas1_editor: ' + JSON.stringify(meta));
        }
      } catch {}
  }
  return result;
}
module.exports = { rewriteDocument };
