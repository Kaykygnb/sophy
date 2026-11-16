/* One shared, code-native stroke icon set for the Sophy interface. */
window.SophyIcons = (() => {
  const paths = {
    filePlus: '<path d="M14 3H5v18h9M14 3v6h5V8Z M17 14v7m-3-3.5h7M8 12h4m-4 4h3"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z M12 11v6m-3-3h6"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h3"/>',
    inbox: '<path d="M5 4h14l3 11v5H2v-5Zm-3 11h6l2 3h4l2-3h6M8 8h8"/>',
    graph:
      '<circle cx="5" cy="7" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="13" cy="19" r="3"/><path d="m8 7 8-2M7 10l4 6m7-8-4 8"/>',
    sliders: '<path d="M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6"/>',
    textSize: '<path d="M3 5h12M9 5v15m-4 0h8m3-8h6m-3 0v8"/>',
    comment:
      '<path d="M21 11a8 8 0 0 1-8 8H5l-3 3V9a7 7 0 0 1 7-7h5a7 7 0 0 1 7 7ZM7 8h9m-9 5h6"/>',
    chevrons: '<path d="m5 8 7-5 7 5M5 16l7 5 7-5"/>',
    home: '<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3Z"/>',
    library: '<path d="M3 4h5v17H3Zm7 0h5v17h-5Zm7 1 4-1 3 16-4 1Z"/>',
    shelf: '<path d="M3 3h18v18H3ZM3 13h18M7 6v4m4-4v4m4-4 2 4M8 16v2m5-2v2"/>',
    moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    attachment: '<path d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-6 12 8-8"/>',
    folderClosedControl:
      '<rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" opacity=".13" stroke="none"/><path d="m9 6 8 6-8 6Z" fill="currentColor" stroke="none"/>',
    folderOpenControl:
      '<rect x="1" y="1" width="22" height="22" rx="6" fill="currentColor" opacity=".13" stroke="none"/><path d="m6 9 12 0-6 8Z" fill="currentColor" stroke="none"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
    connect:
      '<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    settings:
      '<path d="m9 3-.6 3-2.7 1.5-2.8-.5-1.5 3 2.2 2-.1 3-2 2 1.5 3 3-.6L9 21h6l1.7-2.6 3 .6 1.5-3-2-2-.1-3 2.2-2-1.5-3-2.8.5L15.6 6 15 3Z" transform="translate(0 -1) scale(1 .95)"/><circle cx="12" cy="11" r="3"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
    folderOpen: '<path d="M3 10V5h7l2 2h8v3M2 10h20l-3 10H5Z"/>',
    file: '<path d="M14 3H5v18h14V8Z"/><path d="M14 3v6h5M8 13h8m-8 4h5"/>',
    image:
      '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-5 5 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="m4 16 12-12 4 4L8 20H4Zm10-10 4 4"/>',
    move: '<path d="M12 3v18M3 12h18m-5-5 5 5-5 5M8 7l-5 5 5 5M7 8l5-5 5 5m-10 8 5 5 5-5"/>',
    trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-5-3 2-6"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    desktop: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    alert: '<path d="M12 3 2 21h20ZM12 9v5m0 3v1"/>',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = paths[name] || paths.file;
    return svg;
  }
  function set(element, name) {
    element.replaceChildren(icon(name));
  }
  function decorateButton(element, name, label) {
    element.replaceChildren(icon(name));
    if (label) element.append(document.createTextNode(label));
  }
  return { icon, set, decorateButton };
})();
