'use strict';
const $ = (s) => document.querySelector(s);
let world = null,
  knownWorlds = [],
  worldError = '',
  choosingWorld = true;
let workspaces = [],
  section = 'workspaces',
  managing = false,
  current = null,
  pending = false,
  modalAction;
const labels = {
  workspaces: 'Estantes',
  settings: 'Configurações',
};
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    const symbol = {
      '▱': 'folder',
      '▦': 'grid',
      '◎': 'globe',
      '✧': 'spark',
      '⌘': 'connect',
      '◉': 'user',
      '▤': 'file',
    }[text];
    if (symbol) node.append(SophyIcons.icon(symbol));
    else node.textContent = text;
  }
  if (className === 'folder-path' && text) node.title = text;
  return node;
}
function button(text, className, action) {
  const b = el('button', className);
  let icon = null,
    label = text;
  if (text.startsWith('＋ ')) {
    icon = 'plus';
    label = text.slice(2);
  } else if (text.startsWith('← ')) {
    icon = 'back';
    label = text.slice(2);
  } else if (text.endsWith(' →')) {
    icon = 'arrow';
    label = text.slice(0, -2);
  }
  if (icon) b.append(SophyIcons.icon(icon));
  b.append(document.createTextNode(label));
  b.type = 'button';
  b.onclick = action;
  return b;
}
function notify(message, error = false) {
  const n = $('#notice');
  n.textContent = message;
  n.className = error ? 'error' : '';
  n.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (n.hidden = true), 7000);
}
async function request(fn) {
  if (pending) return null;
  pending = true;
  document.body.classList.add('busy');
  try {
    const result = await fn();
    if (!result.ok) throw Error(result.error);
    return result.value;
  } catch (e) {
    notify(e.message, true);
    throw e;
  } finally {
    pending = false;
    document.body.classList.remove('busy');
  }
}
async function refresh() {
  try {
    const rows = await request(() => window.notas.list());
    if (rows) applyState(rows);
    render();
  } catch {
    render();
  }
}
async function update(fn, success) {
  const rows = await request(fn);
  if (!rows) return false;
  applyState(rows);
  render();
  if (success) notify(success);
  return true;
}
function applyState(data) {
  world = data.world;
  knownWorlds = data.worlds;
  workspaces = data.workspaces;
  worldError = data.error || '';
}
async function navigate(next) {
  if (pending) return;
  if (current && !(await window.explorer.leave())) return;
  section = next;
  choosingWorld = false;
  current = null;
  managing = false;
  render();
  if (next === 'workspaces') refresh();
}
function actions() {
  const host = el('div', 'page-actions');
  host.append(
    button('＋ Criar estante', 'button primary', createModal),
    button('Cadastrar subpasta', 'button secondary', addExisting),
  );
  return host;
}
async function addExisting() {
  try {
    await update(() => window.notas.add(), 'Pasta adicionada.');
  } catch {}
}
function heading(kicker, title, description) {
  const h = el('div', 'page-heading');
  h.append(el('div', 'eyebrow', kicker), el('h1', '', title), el('p', 'subtitle', description));
  return h;
}
function folderPath(value) {
  const parts = value.replace(/\\/g, '/').split('/').filter(Boolean);
  const path = el('p', 'folder-path', parts.slice(-2).join(' / '));
  path.title = value;
  return path;
}
const accentPresets = [
  { name: 'Azul Sophy', value: '#4B6284' },
  { name: 'Terracota', value: '#A75D47' },
  { name: 'Ameixa', value: '#76527E' },
  { name: 'Verde sálvia', value: '#527364' },
  { name: 'Âmbar', value: '#9A6A24' },
];
const defaultAccent = '#4B6284';
const customIconKey = 'sophy.ui.customIcons';
const spellLanguageLabels = {
  'pt-BR': 'Português (Brasil)',
  pt: 'Português',
  'en-US': 'English (US)',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
};
function savedSpellcheck() {
  try {
    return localStorage.getItem('sophy.ui.spellcheck') !== 'false';
  } catch {
    return true;
  }
}
function savedSpellLanguages() {
  try {
    const saved = JSON.parse(localStorage.getItem('sophy.ui.spellLanguages') || '["pt-BR"]');
    return Array.isArray(saved) ? saved.filter((code) => spellLanguageLabels[code]) : ['pt-BR'];
  } catch {
    return ['pt-BR'];
  }
}
async function setSpellcheck(enabled, languages) {
  const result = await window.notas.configureSpellcheck(enabled, languages);
  if (!result.ok) throw Error(result.error || 'Não foi possível atualizar o corretor.');
  try {
    localStorage.setItem('sophy.ui.spellcheck', String(enabled));
    localStorage.setItem('sophy.ui.spellLanguages', JSON.stringify(languages));
  } catch {}
  return result.value;
}
async function initializeSpellcheck() {
  try {
    const response = await window.notas.spellcheckInfo();
    if (!response.ok) throw Error(response.error);
    const info = response.value;
    let languages = savedSpellLanguages().filter(
      (language) => info.platform === 'darwin' || info.available.includes(language),
    );
    if (!languages.length && info.platform !== 'darwin') {
      const initial = ['pt-BR', 'pt', 'en-US'].find((language) =>
        info.available.includes(language),
      );
      if (initial) languages = [initial];
    }
    await setSpellcheck(savedSpellcheck(), languages);
  } catch (error) {
    console.warn('Não foi possível inicializar a revisão ortográfica:', error.message);
  }
}
function customIcons() {
  try {
    const list = JSON.parse(localStorage.getItem(customIconKey) || '[]');
    return Array.isArray(list)
      ? list
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              typeof item.name === 'string' &&
              typeof item.src === 'string' &&
              /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(item.src),
          )
          .slice(0, 18)
      : [];
  } catch {
    return [];
  }
}
function saveCustomIcons(list) {
  const value = JSON.stringify(list);
  if (value.length > 3_500_000)
    throw Error('A coleção de ícones atingiu o limite de armazenamento.');
  localStorage.setItem(customIconKey, value);
  window.sophyCustomIcons = list;
  document
    .querySelector('.block-editor:not([hidden])')
    ?.contentWindow?.postMessage({ type: 'note:icons', icons: list }, '*');
}
function savedAccent() {
  try {
    const value = localStorage.getItem('sophy.ui.accentColor') || defaultAccent;
    if (value.toUpperCase() === '#5367D8') return defaultAccent;
    return /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : defaultAccent;
  } catch {
    return defaultAccent;
  }
}
function savedTheme() {
  try {
    return localStorage.getItem('sophy.ui.theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const button = $('#themeToggle');
  SophyIcons.set(button, dark ? 'sun' : 'moon');
  button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(dark));
  document.querySelectorAll('.theme-option').forEach((option) => {
    const active = option.dataset.theme === (dark ? 'dark' : 'light');
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
}
function applyTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.sophyTheme = theme;
  try {
    localStorage.setItem('sophy.ui.theme', theme);
  } catch {}
  applyAccent(savedAccent());
  updateThemeButton();
}
function applyAccent(value) {
  const selectedColor = /^#[\da-f]{6}$/i.test(value) ? value.toUpperCase() : defaultAccent;
  const dark = savedTheme() === 'dark';
  const color = dark && selectedColor === defaultAccent ? '#9CAED8' : selectedColor;
  const panel = dark ? '#252A33' : '#FFFFFF';
  const line = dark ? '#3B4452' : '#D1D9E2';
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--on-accent', SophyAppearance.contrastInk(color));
  document.documentElement.style.setProperty(
    '--accent-hover',
    `color-mix(in srgb, ${color} 86%, #151b2a)`,
  );
  document.documentElement.style.setProperty(
    '--soft',
    selectedColor === defaultAccent
      ? dark
        ? '#343F55'
        : '#E0E7F1'
      : `color-mix(in srgb, ${color} 15%, ${panel})`,
  );
  document.documentElement.style.setProperty(
    '--accent-line',
    `color-mix(in srgb, ${color} 24%, ${line})`,
  );
  try {
    localStorage.setItem('sophy.ui.accentColor', selectedColor);
  } catch {}
  window.sophyAccentColor = color;
  document
    .querySelector('.block-editor:not([hidden])')
    ?.contentWindow?.postMessage({ type: 'note:theme', theme: savedTheme(), accent: color }, '*');
}
function readingPreferences() {
  try {
    return SophyAppearance.readingPreferences(
      JSON.parse(localStorage.getItem('sophy.ui.reading') || '{}'),
    );
  } catch {
    return SophyAppearance.readingPreferences();
  }
}
function applyReading(value) {
  const prefs = SophyAppearance.readingPreferences(value);
  SophyAppearance.applyReading(prefs);
  try {
    localStorage.setItem('sophy.ui.reading', JSON.stringify(prefs));
  } catch {}
  document
    .querySelector('.block-editor:not([hidden])')
    ?.contentWindow?.postMessage({ type: 'note:reading', preferences: prefs }, '*');
  document.querySelectorAll('[data-reading-preference]').forEach((control) => {
    control.value = prefs[control.dataset.readingPreference];
  });
}
function readingControls() {
  const controls = el('div', 'reading-controls');
  const prefs = readingPreferences();
  for (const [key, label, choices] of [
    [
      'fontSize',
      'Tamanho do texto',
      [
        [16, '16 · Compacto'],
        [17, '17 · Confortável'],
        [19, '19 · Grande'],
      ],
    ],
    [
      'width',
      'Largura de leitura',
      [
        [640, 'Estreita'],
        [720, 'Equilibrada'],
        [880, 'Ampla'],
      ],
    ],
    [
      'lineHeight',
      'Espaço entre linhas',
      [
        [1.6, 'Compacto'],
        [1.75, 'Confortável'],
        [1.9, 'Amplo'],
      ],
    ],
  ]) {
    const row = el('label', 'reading-control');
    const select = el('select');
    select.dataset.readingPreference = key;
    select.setAttribute('aria-label', label);
    for (const [value, text] of choices) {
      const option = el('option', '', text);
      option.value = value;
      select.append(option);
    }
    select.value = prefs[key];
    select.onchange = () => applyReading({ ...readingPreferences(), [key]: Number(select.value) });
    row.append(el('span', '', label), select);
    controls.append(row);
  }
  controls.append(
    el('p', 'reading-hint', 'Os ajustes valem para todas as notas neste computador.'),
  );
  return controls;
}
async function importIcon(file) {
  if (!file || file.size > 500 * 1024) throw Error('O ícone precisa ter até 500 KB.');
  let src;
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    const xml = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
    if (xml.querySelector('parsererror') || xml.documentElement.tagName.toLowerCase() !== 'svg')
      throw Error('Este arquivo SVG não é válido.');
    xml
      .querySelectorAll('script,style,foreignObject,iframe,object,embed')
      .forEach((item) => item.remove());
    for (const element of [xml.documentElement, ...xml.querySelectorAll('*')]) {
      for (const attr of [...element.attributes]) {
        const name = attr.name.toLowerCase();
        if (
          /^on/i.test(name) ||
          name === 'style' ||
          (['href', 'xlink:href'].includes(name) &&
            !attr.value.startsWith('#') &&
            !attr.value.startsWith('data:image/')) ||
          /url\(\s*['"]?(?!#)/i.test(attr.value)
        )
          element.removeAttribute(attr.name);
      }
    }
    const safe = new XMLSerializer().serializeToString(xml.documentElement);
    src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(safe)));
  } else {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw Error('Use um arquivo PNG, JPG, WebP ou SVG.');
    src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(Error('Não foi possível ler este ícone.'));
      reader.readAsDataURL(file);
    });
  }
  const list = customIcons();
  if (list.length >= 18) throw Error('Você já adicionou 18 ícones, o limite da biblioteca.');
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 48) || 'Ícone';
  list.push({ id: crypto.randomUUID(), name, src });
  saveCustomIcons(list);
}
function renderSettings(host) {
  host.append(
    heading(
      'PREFERÊNCIAS',
      'Configurações',
      'Ajuste a aparência e a navegação da Sophy. As preferências ficam neste computador.',
    ),
  );
  const section = el('section', 'settings-panel');
  const accentCard = el('article', 'setting-card');
  const accentIntro = el('div', 'setting-copy');
  accentIntro.append(
    el('span', 'setting-kicker', 'APARÊNCIA'),
    el('h2', '', 'Cor de destaque'),
    el('p', '', 'Personalize botões, seleções e detalhes da interface.'),
  );
  const current = savedAccent();
  const palette = el('div', 'accent-palette');
  for (const preset of accentPresets) {
    const swatch = el('button', 'accent-swatch' + (current === preset.value ? ' selected' : ''));
    swatch.type = 'button';
    swatch.style.setProperty('--swatch', preset.value);
    swatch.title = preset.name;
    swatch.setAttribute('aria-label', `Usar cor ${preset.name}`);
    swatch.setAttribute('aria-pressed', String(current === preset.value));
    swatch.onclick = () => {
      applyAccent(preset.value);
      render();
    };
    palette.append(swatch);
  }
  const custom = el('label', 'custom-color');
  custom.append(el('span', '', 'Personalizada'));
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = current;
  picker.setAttribute('aria-label', 'Escolher cor de destaque personalizada');
  custom.append(picker, el('code', 'color-value', current));
  picker.oninput = () => {
    applyAccent(picker.value);
    custom.querySelector('code').textContent = picker.value.toUpperCase();
    palette.querySelectorAll('.accent-swatch').forEach((b) => {
      b.classList.remove('selected');
      b.setAttribute('aria-pressed', 'false');
    });
  };
  const swatches = el('div', 'setting-controls');
  swatches.append(palette, custom);
  accentCard.append(accentIntro, swatches);

  const themeCard = el('article', 'setting-card');
  const themeIntro = el('div', 'setting-copy');
  themeIntro.append(
    el('span', 'setting-kicker', 'INTERFACE'),
    el('h2', '', 'Tema do aplicativo'),
    el('p', '', 'Uma única escolha para o painel, o gerenciador de arquivos e o editor.'),
  );
  const themeOptions = el('div', 'theme-options');
  for (const [value, label, glyph] of [
    ['light', 'Claro', '☼'],
    ['dark', 'Escuro', '◐'],
  ]) {
    const option = button(`${glyph} ${label}`, 'theme-option', () => applyTheme(value));
    option.dataset.theme = value;
    option.classList.toggle('active', savedTheme() === value);
    option.setAttribute('aria-pressed', String(savedTheme() === value));
    themeOptions.append(option);
  }
  themeCard.append(themeIntro, themeOptions);

  const spellCard = el('article', 'setting-card spellcheck-card');
  const spellIntro = el('div', 'setting-copy');
  spellIntro.append(
    el('span', 'setting-kicker', 'ESCRITA'),
    el('h2', '', 'Revisão ortográfica'),
    el(
      'p',
      '',
      'Sublinhe possíveis erros e veja sugestões ao clicar com o botão direito. O Sophy não corrige seu texto sem você pedir.',
    ),
  );
  const spellControls = el('div', 'spellcheck-controls');
  const spellEnabled = document.createElement('input');
  spellEnabled.type = 'checkbox';
  spellEnabled.checked = savedSpellcheck();
  spellEnabled.id = 'spellcheckEnabled';
  const spellToggle = el('label', 'spellcheck-toggle');
  spellToggle.append(spellEnabled, el('span', '', 'Ativar corretor'));
  const spellLanguageList = el('div', 'spellcheck-languages');
  const spellStatus = el('p', 'spellcheck-status', 'Carregando dicionários disponíveis…');
  spellEnabled.onchange = async () => {
    try {
      await setSpellcheck(spellEnabled.checked, savedSpellLanguages());
      spellLanguageList.classList.toggle('disabled', !spellEnabled.checked);
      notify(
        spellEnabled.checked ? 'Revisão ortográfica ativada.' : 'Revisão ortográfica pausada.',
      );
    } catch (error) {
      spellEnabled.checked = !spellEnabled.checked;
      notify(error.message, true);
    }
  };
  spellControls.append(spellToggle, spellStatus, spellLanguageList);
  spellCard.append(spellIntro, spellControls);
  window.notas.spellcheckInfo().then((response) => {
    if (!response.ok) {
      spellStatus.textContent = response.error || 'Não foi possível consultar os dicionários.';
      return;
    }
    const info = response.value;
    spellLanguageList.classList.toggle('disabled', !spellEnabled.checked);
    if (info.platform === 'darwin') {
      spellStatus.textContent = 'O macOS identifica o idioma pelo corretor do sistema.';
      return;
    }
    const available = info.available.filter((code) => spellLanguageLabels[code]);
    if (!available.length) {
      spellStatus.textContent = 'Nenhum dicionário compatível foi encontrado neste Electron.';
      return;
    }
    spellStatus.textContent = 'Escolha os idiomas usados nas suas notas.';
    const selected = new Set(savedSpellLanguages().filter((code) => available.includes(code)));
    for (const code of available) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(code);
      checkbox.value = code;
      const label = el('label', 'spellcheck-language');
      label.append(checkbox, el('span', '', spellLanguageLabels[code] || code));
      checkbox.onchange = async () => {
        if (checkbox.checked) selected.add(code);
        else selected.delete(code);
        if (!selected.size) {
          checkbox.checked = true;
          selected.add(code);
          notify('Mantenha pelo menos um idioma selecionado.', true);
          return;
        }
        try {
          await setSpellcheck(spellEnabled.checked, [...selected]);
          notify('Idiomas de revisão atualizados.');
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          if (checkbox.checked) selected.add(code);
          else selected.delete(code);
          notify(error.message, true);
        }
      };
      spellLanguageList.append(label);
    }
    if (!selected.size && available.includes('pt-BR')) {
      const first = spellLanguageList.querySelector('input');
      if (first) first.checked = true;
    }
  });

  const iconsCard = el('article', 'setting-card icon-library-card');
  const iconsIntro = el('div', 'setting-copy');
  iconsIntro.append(
    el('span', 'setting-kicker', 'BIBLIOTECA'),
    el('h2', '', 'Ícones próprios'),
    el(
      'p',
      '',
      'Importe PNG, JPG, WebP ou SVG para usar nas páginas. Até 18 arquivos, com 500 KB cada.',
    ),
  );
  const iconTools = el('div', 'icon-library-tools');
  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = '.png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml';
  upload.hidden = true;
  const importButton = button('＋ Importar ícone', 'button secondary', () => upload.click());
  upload.onchange = async () => {
    try {
      await importIcon(upload.files?.[0]);
      notify('Ícone adicionado à biblioteca.');
      render();
    } catch (error) {
      notify(error.message, true);
    } finally {
      upload.value = '';
    }
  };
  const library = el('div', 'icon-library');
  for (const item of customIcons()) {
    const chip = el('div', 'icon-library-item');
    const preview = document.createElement('img');
    preview.src = item.src;
    preview.alt = '';
    preview.title = item.name;
    chip.append(preview, el('span', '', item.name));
    library.append(chip);
  }
  iconTools.append(importButton, upload, library);
  iconsCard.append(iconsIntro, iconTools);

  const backupCard = el('article', 'setting-card');
  const backupIntro = el('div', 'setting-copy');
  backupIntro.append(
    el('span', 'setting-kicker', 'SEGURANÇA'),
    el('h2', '', 'Cópia da biblioteca'),
    el(
      'p',
      '',
      world
        ? `Salva uma cópia completa de “${world.name}” em outra pasta. Ideal antes de reorganizar ou sincronizar.`
        : 'Carregue uma biblioteca para criar uma cópia de segurança.',
    ),
  );
  const backupActions = el('div', 'setting-controls');
  backupActions.append(
    button('Fazer backup agora', 'button secondary', async () => {
      if (!world) {
        notify('Carregue uma biblioteca primeiro.', true);
        return;
      }
      try {
        const result = await request(() => window.notas.backupWorld());
        if (result?.path) notify(`Backup salvo em ${result.path}`);
      } catch {}
    }),
  );
  backupCard.append(backupIntro, backupActions);

  const shortcutsCard = el('article', 'setting-card');
  const shortcutsIntro = el('div', 'setting-copy');
  shortcutsIntro.append(
    el('span', 'setting-kicker', 'ATALHOS'),
    el('h2', '', 'Paleta e busca'),
    el(
      'p',
      '',
      'Ctrl+K abre comandos, Ctrl+P vai para uma nota e Ctrl+Shift+F busca no conteúdo. Ctrl+Shift+Enter ativa o modo de foco; Esc sai dele.',
    ),
  );
  shortcutsCard.append(shortcutsIntro);

  const writingCard = el('article', 'setting-card');
  const writingCopy = el('div', 'setting-copy');
  writingCopy.append(
    el('span', 'setting-kicker', 'ESCRITA'),
    el('h2', '', 'Conforto para escrever'),
    el('p', '', 'Encontre o tamanho e o ritmo de leitura que funcionam para você.'),
  );
  writingCard.append(writingCopy, readingControls());
  section.append(
    writingCard,
    themeCard,
    accentCard,
    spellCard,
    iconsCard,
    backupCard,
    shortcutsCard,
  );
  const footer = el('div', 'settings-footer');
  footer.append(el('span', '', 'Suas notas e arquivos não são afetados pelas preferências.'));
  footer.append(
    button('Restaurar padrão', 'button secondary', () => {
      applyAccent(defaultAccent);
      applyTheme('light');
      applyReading(SophyAppearance.readingPreferences());
      setSpellcheck(true, ['pt-BR']).catch((error) => notify(error.message, true));
      render();
      notify('Preferências restauradas.');
    }),
  );
  host.append(section, footer);
}
function render() {
  $('#breadcrumb').textContent = current
    ? current.name
    : managing
      ? 'Gerenciar estantes'
      : choosingWorld
        ? 'Bibliotecas'
        : labels[section];
  $('#breadcrumb').title = $('#breadcrumb').textContent;
  $('#breadcrumb').hidden = choosingWorld;
  document.title = `${current?.name || labels[section]} — Sophy`;
  const host = $('#content');
  window.explorer?.restoreChrome();
  host.replaceChildren();
  host.classList.remove('explorer-host');
  document.body.classList.remove('in-area');
  if (choosingWorld || (section === 'workspaces' && (!world || world.available === false))) {
    renderWorlds(host);
    return;
  }
  if (section !== 'workspaces') {
    if (section === 'settings') {
      renderSettings(host);
      return;
    }
    section = 'workspaces';
  }
  if (current) {
    window.explorer.mount(host, current);
    return;
  }
  if (!workspaces.length && !managing) {
    const welcome = el('section', 'welcome');
    welcome.append(
      el('div', 'welcome-symbol', '▦'),
      el('div', 'eyebrow', 'BIBLIOTECA CARREGADA · ' + world.name),
      el('h1', '', 'Um espaço para cada ideia.'),
      el(
        'p',
        'welcome-description',
        `Esta é a biblioteca ${world.name}. Crie estantes para separar seus projetos: cada uma será uma subpasta dentro desta biblioteca.`,
      ),
      actions(),
    );
    const tip = el('aside', 'onboarding-tip');
    tip.append(
      el('strong', '', 'Comece em 30 segundos'),
      el(
        'p',
        '',
        '1) Crie uma estante · 2) Abra-a e pressione Ctrl+N para uma nota · 3) Use [[nome]] para ligar ideias. Ctrl+K abre a paleta de comandos.',
      ),
    );
    welcome.append(tip);
    const steps = el('div', 'welcome-notes');
    for (const [number, title, text] of [
      ['01', 'Crie uma estante', 'Uma nova subpasta será criada dentro desta biblioteca.'],
      ['02', 'Separe seus contextos', 'Crie estantes para estudos, projetos ou trabalho.'],
      ['03', 'Sua biblioteca, com você', 'O cadastro acompanha a pasta da biblioteca. Sem conta.'],
    ]) {
      const row = el('div');
      row.append(el('span', 'step-number', number), el('h3', '', title), el('p', '', text));
      steps.append(row);
    }
    welcome.append(steps);
    host.append(welcome);
    return;
  }
  const top = el('div', 'heading-row');
  top.append(
    heading(
      'SEU ESPAÇO',
      managing ? 'Gerenciar estantes' : world.name,
      managing
        ? 'Organize os nomes e as pastas das suas estantes.'
        : 'Uma estante para cada assunto. Suas notas, sempre por perto.',
    ),
  );
  if (managing)
    top.append(
      button('← Voltar ao dashboard', 'button secondary', () => {
        managing = false;
        render();
      }),
    );
  else
    top.append(
      button('Gerenciar estantes', 'button ghost', () => {
        managing = true;
        render();
      }),
    );
  host.append(top);
  const bar = actions();
  bar.append(
    el(
      'span',
      'workspace-count',
      `${workspaces.length} ${workspaces.length === 1 ? 'estante cadastrada' : 'estantes cadastradas'}`,
    ),
  );
  host.append(bar);
  const grid = el('div', managing ? 'workspace-grid management' : 'workspace-grid');
  for (const w of workspaces) {
    const card = el('article', 'workspace-card' + (w.available ? '' : ' unavailable'));
    const icon = el('div', 'folder-icon', '▱');
    const title = el('h2', '', w.name);
    const status = el('span', 'availability', w.available ? 'Disponível' : 'Indisponível');
    const cardTop = el('div', 'card-top');
    cardTop.append(icon, status);
    card.append(cardTop, title, folderPath(w.path));
    const date = w.lastAccessAt
      ? `Último acesso ${new Date(w.lastAccessAt).toLocaleDateString('pt-BR')}`
      : 'Ainda não aberta';
    card.append(el('p', 'access-date', w.available ? date : w.reason));
    const footer = el('div', 'card-actions');
    if (w.available)
      footer.append(button('Abrir estante →', 'open-button', () => openWorkspace(w)));
    else footer.append(button('Localizar pasta', 'open-button', () => locate(w)));
    if (managing) {
      footer.append(button('Renomear', 'subtle-button', () => renameModal(w)));
      footer.append(
        button(
          w.available ? 'Excluir estante' : 'Remover cadastro',
          'subtle-button danger-text',
          () => (w.available ? deleteModal(w) : forget(w)),
        ),
      );
    } else if (!w.available)
      footer.append(button('Remover cadastro', 'subtle-button', () => forget(w)));
    card.append(footer);
    grid.append(card);
  }
  const search = el('input', 'dashboard-search');
  search.type = 'search';
  search.placeholder = choosingWorld ? 'Buscar biblioteca…' : 'Buscar estante…';
  search.setAttribute('aria-label', search.placeholder.replace('…', ''));
  search.oninput = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const card of grid.children)
      card.hidden = !card.querySelector('h2').textContent.toLocaleLowerCase().includes(query);
  };
  host.append(search, grid);
  if (managing)
    host.append(
      el(
        'p',
        'management-note',
        'Excluir uma estante disponível apaga permanentemente sua pasta e todo o conteúdo. Para pastas indisponíveis, remover o cadastro não apaga arquivos.',
      ),
    );
}
async function openWorkspace(w) {
  if (current && !(await window.explorer.leave())) return;
  try {
    const opened = await request(() => window.notas.open(w.id));
    if (opened) {
      current = opened;
      render();
    }
  } catch {
    await refresh();
  }
}
async function locate(w) {
  try {
    await update(() => window.notas.locate(w.id), 'Localização atualizada.');
  } catch {}
}
async function forget(w) {
  try {
    await update(() => window.notas.forget(w.id), 'Cadastro removido. Nenhum arquivo foi apagado.');
  } catch {}
}
function modal(title, description, actionLabel, action, danger = false) {
  $('#modalTitle').textContent = title;
  $('#modalDescription').textContent = description;
  $('#modalFields').replaceChildren();
  $('#modalError').textContent = '';
  $('#submitModal').textContent = actionLabel;
  $('#submitModal').className = 'button ' + (danger ? 'danger' : 'primary');
  SophyIcons.set($('#modalSymbol'), danger ? 'alert' : 'folder');
  $('#modal').classList.toggle('destructive', danger);
  modalAction = action;
  $('#modal').showModal();
}
function field(label, value = '', placeholder = '') {
  const host = $('#modalFields'),
    l = el('label', '', label),
    input = document.createElement('input');
  input.id = 'workspaceName';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = 100;
  input.required = true;
  l.htmlFor = input.id;
  host.append(l, input);
  queueMicrotask(() => input.focus());
  return input;
}
function createModal() {
  let input;
  modal(
    'Criar estante',
    `A estante será criada como uma subpasta de ${world.name}. Você não precisa escolher outro local.`,
    'Criar estante',
    async () => {
      if (!input.value.trim()) throw Error('Informe o nome da estante.');
      return update(() => window.notas.create(input.value.trim()), 'Estante criada.');
    },
  );
  input = field('Nome da estante', '', 'Ex.: Estudos, Projeto pessoal…');
  $('#modalFields').append(el('p', 'root-hint', world.path));
}
function renameModal(w) {
  let input;
  modal(
    'Renomear estante',
    'Esse nome aparece apenas no Sophy. O nome da pasta no computador continuará igual.',
    'Salvar nome',
    () => update(() => window.notas.rename(w.id, input.value.trim()), 'Nome atualizado.'),
  );
  input = field('Nome de exibição', w.name);
}
function deleteModal(w) {
  let input;
  modal(
    'Excluir esta estante?',
    'A pasta e todos os seus arquivos serão apagados permanentemente. Esta ação não pode ser desfeita.',
    'Continuar para confirmação',
    async () => {
      if (input.value !== w.name) throw Error('Digite o nome exato da estante para continuar.');
      return update(
        () => window.notas.delete(w.id, input.value),
        'Estante e pasta excluídas permanentemente.',
      );
    },
    true,
  );
  $('#modalFields').append(el('p', 'delete-path', w.path));
  input = field(`Digite “${w.name}” para confirmar`);
}
$('#modalForm').onsubmit = async (e) => {
  e.preventDefault();
  if (pending) return;
  $('#modalError').textContent = '';
  $('#submitModal').disabled = true;
  $('#cancelModal').disabled = true;
  $('#closeModal').disabled = true;
  try {
    if (await modalAction()) $('#modal').close();
  } catch (error) {
    $('#modalError').textContent = error.message;
  } finally {
    $('#submitModal').disabled = false;
    $('#cancelModal').disabled = false;
    $('#closeModal').disabled = false;
  }
};
$('#cancelModal').onclick = $('#closeModal').onclick = () => {
  if (!pending) $('#modal').close();
};
$('#modal').addEventListener('cancel', (e) => {
  if (pending) e.preventDefault();
});
window.addEventListener('focus', () => {
  if (!pending && !$('#modal').open && section === 'workspaces' && !current) refresh();
});

function worldActions() {
  const bar = el('div', 'page-actions');
  bar.append(
    button('＋ Criar biblioteca', 'button primary', createWorldModal),
    button('Carregar biblioteca', 'button secondary', loadWorld),
  );
  return bar;
}
async function loadWorld() {
  try {
    const data = await request(() => window.notas.loadWorld());
    if (data) {
      applyState(data);
      choosingWorld = false;
      section = 'workspaces';
      current = null;
      managing = false;
      render();
      notify('Biblioteca carregada.');
    }
  } catch {}
}
function createWorldModal() {
  let input;
  modal(
    'Criar uma biblioteca',
    'Uma biblioteca é a pasta principal do seu projeto. Escolha um nome e, em seguida, onde criar essa pasta. Suas estantes ficarão dentro dela.',
    'Escolher local →',
    async () => {
      const data = await request(() => window.notas.createWorld(input.value.trim()));
      if (!data) return false;
      applyState(data);
      choosingWorld = false;
      section = 'workspaces';
      current = null;
      managing = false;
      render();
      return true;
    },
  );
  input = field('Nome da biblioteca', '', 'Ex.: Meu universo, Estúdio…');
}
async function openKnownWorld(w) {
  try {
    const data = await request(() => window.notas.openWorld(w.id));
    if (data) {
      applyState(data);
      choosingWorld = false;
      section = 'workspaces';
      current = null;
      managing = false;
      render();
    }
  } catch {}
}
function renderWorlds(host) {
  $('#breadcrumb').textContent = 'Bibliotecas';
  if (!knownWorlds.length) {
    const welcome = el('section', 'welcome-layout');
    const copy = el('div', 'welcome-copy');
    copy.append(
      el('div', 'eyebrow', 'SUAS IDEIAS, NO SEU RITMO'),
      el('h1', '', 'Um lugar para pensar com calma.'),
      el(
        'p',
        'welcome-description',
        'Reúna suas notas em bibliotecas. Organize por estantes e conecte o que aprende.',
      ),
    );
    const local = el('aside', 'welcome-local');
    local.append(
      el('strong', '', 'Seus arquivos ficam com você'),
      el('p', '', 'Notas locais em Markdown. Comece sem criar uma conta.'),
    );
    copy.append(local);
    const choices = el('div', 'welcome-choices');
    for (const [title, description, label, primary, action] of [
      [
        'Criar sua primeira biblioteca',
        'Dê um nome e escolha onde guardar suas notas.',
        'Criar biblioteca',
        true,
        createWorldModal,
      ],
      [
        'Abrir uma biblioteca',
        'Escolha a pasta de uma biblioteca existente.',
        'Escolher pasta',
        false,
        loadWorld,
      ],
    ]) {
      const card = el('article', 'welcome-choice');
      card.append(
        el('h2', '', title),
        el('p', '', description),
        button(label, 'button ' + (primary ? 'primary' : 'secondary'), action),
      );
      choices.append(card);
    }
    welcome.append(copy, choices);
    host.append(welcome);
    if (worldError) host.append(el('p', 'world-warning', worldError));
    host.append(el('p', 'library-footer', 'Sophy · Leitura, escrita e conexões em um só lugar.'));
    return;
  }
  host.append(
    heading('SEU ESPAÇO', 'Suas bibliotecas', 'Escolha um espaço para continuar de onde parou.'),
  );
  host.append(worldActions());
  if (worldError) {
    const warning = el(
      'p',
      'world-warning',
      worldError + ' Use Carregar biblioteca para localizar a pasta.',
    );
    host.append(warning);
  }
  if (!knownWorlds.length) {
    const empty = el('section', 'world-explanation');
    empty.append(
      el('div', 'empty-symbol', '◎'),
      el('h2', '', 'Uma raiz. Várias estantes.'),
      el(
        'p',
        '',
        'Crie uma biblioteca nova ou carregue uma pasta existente. Somente as subpastas criadas ou cadastradas pelo Sophy aparecem como estantes. As demais continuam intactas.',
      ),
    );
    host.append(empty);
    return;
  }
  const grid = el('div', 'workspace-grid');
  for (const w of knownWorlds) {
    const card = el('article', 'workspace-card');
    const defaultId = localStorage.getItem('sophy.defaultLibrary') || world?.id;
    if (w.id === defaultId) {
      card.classList.add('default-library');
      card.append(el('span', 'default-library-label', 'Biblioteca padrão'));
    }
    const menu = el('details', 'card-menu');
    const trigger = el('summary', '', '⋯');
    trigger.setAttribute('aria-label', 'Opções de ' + w.name);
    const menuBody = el('div', 'card-menu-body');
    menuBody.append(
      button('Usar como padrão', 'subtle-button', () => {
        localStorage.setItem('sophy.defaultLibrary', w.id);
        render();
      }),
      button('Configurações', 'subtle-button', () => navigate('settings')),
    );
    menu.append(trigger, menuBody);
    card.append(menu);
    card.append(
      el('div', 'folder-icon', '▦'),
      el('h2', 'world-card-title', w.name),
      folderPath(w.path),
    );
    const footer = el('div', 'card-actions');
    footer.append(
      button(
        w.available
          ? w.id === world?.id
            ? 'Voltar a esta biblioteca →'
            : 'Carregar biblioteca →'
          : 'Localizar biblioteca',
        'open-button',
        () => (w.available ? openKnownWorld(w) : loadWorld()),
      ),
    );
    card.append(footer);
    grid.append(card);
  }
  const search = el('input', 'dashboard-search');
  search.type = 'search';
  search.placeholder = 'Buscar biblioteca…';
  search.setAttribute('aria-label', 'Buscar biblioteca');
  search.oninput = () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const card of grid.children)
      card.hidden = !card.querySelector('h2').textContent.toLocaleLowerCase().includes(query);
  };
  host.append(search, grid);
}
$('#worldNav').onclick = async () => {
  if (pending) return;
  if (current && !(await window.explorer.leave())) return;
  choosingWorld = true;
  current = null;
  section = 'workspaces';
  managing = false;
  render();
  refresh();
};

function setupPalette() {
  if (!window.SophyPalette) return;
  window.SophyPalette.configure({
    commands: () => {
      const items = [
        {
          title: 'Abrir bibliotecas',
          subtitle: 'Trocar ou carregar uma biblioteca',
          keywords: 'mundo world',
          run: () => $('#worldNav').click(),
        },
        {
          title: 'Ir para estantes',
          subtitle: 'Dashboard da biblioteca atual',
          keywords: 'áreas areas',
          run: () => navigate('workspaces'),
        },
        {
          title: 'Configurações',
          subtitle: 'Tema, corretor e backup',
          keywords: 'settings preferências',
          run: () => navigate('settings'),
        },
        {
          title: 'Criar biblioteca',
          subtitle: 'Nova pasta raiz no computador',
          run: () => createWorldModal(),
        },
        {
          title: 'Carregar biblioteca',
          subtitle: 'Escolher pasta existente',
          run: () => loadWorld(),
        },
        {
          title: 'Alternar tema',
          subtitle: savedTheme() === 'dark' ? 'Mudar para claro' : 'Mudar para escuro',
          keywords: 'dark light',
          run: () => applyTheme(savedTheme() === 'dark' ? 'light' : 'dark'),
        },
      ];
      if (world) {
        items.push({
          title: 'Fazer backup da biblioteca',
          subtitle: world.name,
          keywords: 'cópia segurança',
          run: async () => {
            const result = await request(() => window.notas.backupWorld());
            if (result?.path) notify(`Backup salvo em ${result.path}`);
          },
        });
        items.push({
          title: 'Criar estante',
          subtitle: 'Nova subpasta nesta biblioteca',
          run: () => {
            choosingWorld = false;
            section = 'workspaces';
            current = null;
            render();
            createModal();
          },
        });
      }
      for (const shelf of workspaces.filter((item) => item.available)) {
        items.push({
          title: `Abrir estante: ${shelf.name}`,
          subtitle: shelf.path,
          keywords: 'área area',
          run: () => openWorkspace(shelf),
        });
      }
      if (window.explorer?.isOpen?.()) {
        items.push(
          {
            title: 'Nova nota',
            subtitle: 'Na estante aberta',
            keywords: 'criar',
            run: () => window.explorer.newNote(),
          },
          {
            title: 'Abrir diário de hoje',
            subtitle: 'Diário/AAAA-MM-DD.md',
            keywords: 'daily',
            run: () => window.explorer.openDaily(),
          },
          {
            title: 'Abrir caixa de entrada',
            subtitle: 'Captura rápida',
            keywords: 'inbox',
            run: () => window.explorer.openInbox(),
          },
          {
            title: 'Mapa de links',
            subtitle: 'Ver conexões da estante',
            keywords: 'grafo graph',
            run: () => window.explorer.showGraph(),
          },
          {
            title: 'Novo canvas',
            subtitle: 'Quadro infinito com cartões e conexões',
            keywords: 'obsidian board',
            run: () => window.explorer.newCanvas?.(),
          },
        );
      }
      return items;
    },
    notes: async (query) => {
      const id = window.explorer?.areaId?.();
      if (!id) {
        return [
          {
            title: 'Abra uma estante primeiro',
            subtitle: 'Ctrl+P lista notas da estante atual',
            disabled: true,
          },
        ];
      }
      const response = await window.notas.linkIndex(id);
      if (!response.ok) throw Error(response.error);
      const needle = query.trim().toLocaleLowerCase();
      return response.value.notes
        .filter(
          (note) => !needle || `${note.title} ${note.path}`.toLocaleLowerCase().includes(needle),
        )
        .slice(0, 40)
        .map((note) => ({
          title: note.title,
          subtitle: note.path,
          run: () => window.explorer.openPath(note.path),
        }));
    },
    search: async (query) => {
      const id = window.explorer?.areaId?.();
      if (!id) {
        return [
          {
            title: 'Abra uma estante primeiro',
            subtitle: 'A busca percorre o conteúdo das notas da estante',
            disabled: true,
          },
        ];
      }
      if (query.trim().length < 2) return [];
      const response = await window.notas.searchNotes(id, query);
      if (!response.ok) throw Error(response.error);
      return response.value.matches.map((match) => ({
        title: match.title || match.path,
        subtitle: match.excerpt || match.path,
        run: () => window.explorer.openPath(match.path),
      }));
    },
  });
  window.SophyPalette.bind();
  SophyIcons.set($('#commandButton'), 'search');
  $('#commandButton').onclick = () => window.SophyPalette.open('commands');
  const closeGraph = $('#closeGraph');
  if (closeGraph) {
    SophyIcons.set(closeGraph, 'close');
    closeGraph.onclick = () => $('#graphDialog')?.close();
  }
  $('#graphDialog')?.addEventListener('click', (event) => {
    if (event.target === $('#graphDialog')) $('#graphDialog').close();
  });
}
function maybeShowOnboarding() {
  try {
    if (localStorage.getItem('sophy.ui.onboardingSeen') === 'true') return;
  } catch {
    return;
  }
  if (!knownWorlds.length) {
    notify('Bem-vindo ao Sophy. Crie ou carregue uma biblioteca para começar.');
    try {
      localStorage.setItem('sophy.ui.onboardingSeen', 'true');
    } catch {}
  }
}
function setupChrome() {
  const local = $('.device-label');
  local.prepend(SophyIcons.icon('desktop'));
  SophyIcons.set($('#closeModal'), 'close');
  SophyIcons.set($('#settingsButton'), 'settings');
  applyAccent(savedAccent());
  applyTheme(savedTheme());
  applyReading(readingPreferences());
  initializeSpellcheck();
  window.sophyCustomIcons = customIcons();
  $('#themeToggle').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#settingsButton').onclick = () => navigate(section === 'settings' ? 'workspaces' : 'settings');
  setupPalette();
}
setupChrome();
refresh().then(() => maybeShowOnboarding());
