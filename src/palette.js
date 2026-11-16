'use strict';
(function (global) {
  const state = {
    open: false,
    mode: 'commands',
    query: '',
    items: [],
    index: 0,
    providers: {
      commands: () => [],
      notes: async () => [],
      search: async () => [],
    },
  };

  function host() {
    return document.getElementById('palette');
  }
  function input() {
    return document.getElementById('paletteInput');
  }
  function list() {
    return document.getElementById('paletteList');
  }
  function hint() {
    return document.getElementById('paletteHint');
  }

  function modeMeta(mode) {
    if (mode === 'notes')
      return {
        placeholder: 'Ir para nota…',
        hint: 'Ctrl+P · setas para navegar · Enter abre',
      };
    if (mode === 'search')
      return {
        placeholder: 'Buscar no conteúdo das notas…',
        hint: 'Ctrl+Shift+F · busca na estante aberta',
      };
    return {
      placeholder: 'Digite um comando ou busque…',
      hint: 'Ctrl+K · comandos · Ctrl+P notas · Ctrl+Shift+F busca',
    };
  }

  function close() {
    const el = host();
    if (!el) return;
    el.close();
    state.open = false;
    state.query = '';
    state.items = [];
    state.index = 0;
  }

  function setIndex(next) {
    if (!state.items.length) {
      state.index = 0;
      return;
    }
    state.index = (next + state.items.length) % state.items.length;
    renderList();
    const active = list()?.children[state.index];
    active?.scrollIntoView({ block: 'nearest' });
  }

  function renderList() {
    const root = list();
    if (!root) return;
    root.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.className = 'palette-empty';
      empty.textContent =
        state.mode === 'search' && state.query.trim().length < 2
          ? 'Digite pelo menos 2 caracteres.'
          : 'Nenhum resultado.';
      root.append(empty);
      return;
    }
    state.items.forEach((item, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'palette-item' + (i === state.index ? ' is-active' : '');
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(i === state.index));
      const title = document.createElement('strong');
      title.textContent = item.title;
      button.append(title);
      if (item.subtitle) {
        const sub = document.createElement('span');
        sub.textContent = item.subtitle;
        button.append(sub);
      }
      button.onmouseenter = () => {
        state.index = i;
        [...root.children].forEach((option, index) => {
          option.classList.toggle('is-active', index === i);
          option.setAttribute('aria-selected', String(index === i));
        });
      };
      button.onclick = () => runItem(item);
      root.append(button);
    });
  }

  async function refresh() {
    const q = state.query.trim();
    const meta = modeMeta(state.mode);
    const field = input();
    const tip = hint();
    if (field && document.activeElement !== field) field.placeholder = meta.placeholder;
    if (tip) tip.textContent = meta.hint;
    try {
      if (state.mode === 'notes') state.items = await state.providers.notes(q);
      else if (state.mode === 'search') state.items = await state.providers.search(q);
      else {
        const commands = state.providers.commands(q) || [];
        state.items = commands.filter((item) => {
          if (!q) return true;
          const hay =
            `${item.title} ${item.subtitle || ''} ${item.keywords || ''}`.toLocaleLowerCase();
          return hay.includes(q.toLocaleLowerCase());
        });
      }
    } catch (error) {
      state.items = [
        {
          title: 'Não foi possível carregar resultados',
          subtitle: error.message,
          disabled: true,
        },
      ];
    }
    state.index = 0;
    renderList();
  }

  async function runItem(item) {
    if (!item || item.disabled || typeof item.run !== 'function') return;
    close();
    await item.run();
  }

  async function open(mode = 'commands') {
    const el = host();
    const field = input();
    if (!el || !field) return;
    state.mode = mode;
    state.query = '';
    state.open = true;
    field.value = '';
    const meta = modeMeta(mode);
    field.placeholder = meta.placeholder;
    if (!el.open) el.showModal();
    await refresh();
    queueMicrotask(() => field.focus());
  }

  function configure(providers) {
    state.providers = { ...state.providers, ...providers };
  }

  function bind() {
    const el = host();
    const field = input();
    if (!el || !field || el.dataset.bound) return;
    el.dataset.bound = '1';
    field.addEventListener('input', () => {
      state.query = field.value;
      refresh();
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setIndex(state.index + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setIndex(state.index - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runItem(state.items[state.index]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const order = ['commands', 'notes', 'search'];
        const next = order[(order.indexOf(state.mode) + 1) % order.length];
        state.mode = next;
        refresh();
      }
    });
    el.addEventListener('click', (event) => {
      if (event.target === el) close();
    });
    el.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    window.addEventListener('keydown', (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open('commands');
      } else if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        open('notes');
      } else if (event.key.toLowerCase() === 'f' && event.shiftKey) {
        event.preventDefault();
        open('search');
      }
    });
  }

  global.SophyPalette = { open, close, configure, bind };
})(window);
