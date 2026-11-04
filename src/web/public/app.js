(() => {
  'use strict';

  const root = document.getElementById('app');
  const state = {
    me: null,
    guilds: [],
    guildId: null,
    tab: 'overview',
    detail: null, // current guild detail from /api/guilds/:id
    pollTimer: null,
    sidebarOpen: false,
    bot: null, // { name, avatarUrl } shown in the sidebar header
  };

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const ico = (name, weight = '') => h('i', { class: `ph${weight ? '-' + weight : ''} ph-${name}`, 'aria-hidden': 'true' });
  const initials = (name) => Array.from(String(name || '?').trim())[0]?.toUpperCase() ?? '?';

  const frozenCache = new Map(); // gif url -> first-frame data URL
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const isAnimatedCdnUrl = (url) => /^https?:/i.test(url) && /\.gif(\?|$)/i.test(url);
  const staticVariant = (url) => url.replace(/\.gif(\?|$)/i, (m, q) => `.png${q === '?' ? '?' : ''}`) + (url.includes('?') ? '&' : '?') + 'animated=false';

  function makeFreezable(img, url, cls, name) {
    const hoverHost = () => img.closest('button, .page-head, .member, .profile, .chatprev, .sb-head') ?? img;
    let frozen = null; // data URL of first frame, or the static fallback URL
    let bound = false;

    const play = () => { if (frozen && !reduceMotion()) img.src = url; };
    const rest = () => { if (frozen) img.src = frozen; };
    const bind = () => {
      if (bound) return; bound = true;
      const host = hoverHost();
      host.addEventListener('mouseenter', play);
      host.addEventListener('mouseleave', rest);
      host.addEventListener('focusin', play);
      host.addEventListener('focusout', rest);
    };

    const fallbackStatic = () => {
      img.removeAttribute('crossorigin');
      frozen = staticVariant(url);
      frozenCache.set(url, frozen);
      img.onload = null;
      img.onerror = () => img.replaceWith(h('div', { class: cls }, initials(name)));
      img.src = frozen;
      bind();
    };

    const cached = frozenCache.get(url);
    if (cached) { frozen = cached; img.src = cached; bind(); return; }

    img.crossOrigin = 'anonymous';
    img.onerror = fallbackStatic;
    img.onload = () => {
      img.onload = null;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || 128; c.height = img.naturalHeight || 128;
        c.getContext('2d').drawImage(img, 0, 0);
        frozen = c.toDataURL('image/png');   // throws if the canvas is tainted
        frozenCache.set(url, frozen);
        img.onerror = () => { frozen = staticVariant(url); img.src = frozen; };
        img.src = frozen;
        bind();
      } catch { fallbackStatic(); }
    };
    img.src = url;
  }

  function iconEl(name, url, cls = 'icon') {
    if (url) {
      const img = h('img', { class: cls, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      if (isAnimatedCdnUrl(url)) makeFreezable(img, url, cls, name);
      else {
        img.src = url;
        img.addEventListener('error', () => img.replaceWith(h('div', { class: cls }, initials(name))), { once: true });
      }
      return img;
    }
    return h('div', { class: cls }, initials(name));
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      state.me = null;
      render();
      throw Object.assign(new Error(data.error || 'Not logged in.'), { handled: true });
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function toast(message, kind = 'ok') {
    const box = document.getElementById('toasts');
    const el = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, ico(kind === 'error' ? 'warning-circle' : 'check-circle', 'fill'), message);
    box.append(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 380); }, kind === 'error' ? 6000 : 3200);
  }
  const fail = (err) => { if (!err.handled) toast(err.message, 'error'); };

  function confirmDialog({ title, body, confirmLabel, danger, checkbox }) {
    return new Promise((resolve) => {
      const check = checkbox ? h('input', { type: 'checkbox' }) : null;
      const dlg = h('dialog', {},
        h('h3', {}, title),
        h('p', {}, body),
        checkbox ? h('label', { class: 'check' }, check, h('span', {}, checkbox)) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => dlg.close('cancel') }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => dlg.close('ok') }, confirmLabel),
        ),
      );
      dlg.addEventListener('close', () => { const ok = dlg.returnValue === 'ok'; const checked = Boolean(check?.checked); dlg.remove(); resolve({ ok, checked }); });
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  function relTime(unixSeconds) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d`;
  }

  // ---------------------------------------------------------------- routing

  function parseHash() {
    const m = location.hash.match(/^#\/g\/(\d+)(?:\/(overview|setup|settings|profile|commands))?/);
    state.guildId = m ? m[1] : null;
    state.tab = m?.[2] ?? 'overview';
  }
  function go(guildId, tab = 'overview') { location.hash = guildId ? `#/g/${guildId}/${tab}` : '#/'; }
  window.addEventListener('hashchange', () => { parseHash(); setSidebar(false); loadGuild(); });

  function stopPolling() { clearInterval(state.pollTimer); state.pollTimer = null; }

  // ---------------------------------------------------------------- login

  function renderLogin() {
    stopPolling();
    shellRefs.shell = null;
    const q = new URLSearchParams(location.search).get('login');
    const msg = q === 'denied' ? 'Login was cancelled.' : q === 'failed' ? 'Login failed. Please try again.' : null;
    root.replaceChildren(
      h('main', { class: 'login-wrap' },
        h('div', { class: 'login-card' },
          h('div', { class: 'logo-mark' }, ico('speaker-simple-high', 'fill')),
          h('h1', {}, 'Voicey Dashboard'),
          h('p', {}, 'Manage temporary voice channels, prefix and language for your Fluxer communities.'),
          msg ? h('div', { class: 'alert', role: 'alert' }, msg) : null,
          h('a', { class: 'btn btn-primary btn-lg', href: '/auth/login' }, ico('sign-in', 'bold'), 'Login with Fluxer'),
          h('p', { class: 'note' }, 'We only read your profile and server list. Only servers where you have the Manage Community permission are shown.'),
        ),
      ),
    );
    if (msg) history.replaceState(null, '', location.pathname + location.hash);
  }

  // ---------------------------------------------------------------- shell

  const shellRefs = { shell: null, sidebar: null, list: null, main: null, scrim: null, sig: '', logo: null, logoUrl: null, botName: null, topName: null };
  const DEFAULT_BOT_LOGO = '/voicey-logo.png';

  /** Sidebar logo + bot name (also the mobile top bar). Follows the bot's real profile. */
  function setBot(bot) {
    const b = bot ?? state.me?.bot ?? { name: state.me?.botName ?? 'Voicey', avatarUrl: null };
    const name = b.name || 'Voicey';
    const url = b.avatarUrl || '';
    state.bot = { name, avatarUrl: b.avatarUrl ?? null };
    if (shellRefs.botName && shellRefs.botName.textContent !== name) {
      shellRefs.botName.textContent = name;
      if (shellRefs.topName) shellRefs.topName.textContent = name;
    }
    if (shellRefs.logo && shellRefs.logoUrl !== url) {
      const first = shellRefs.logoUrl === null;
      shellRefs.logoUrl = url;
      shellRefs.logo.replaceChildren(iconEl(name, url || DEFAULT_BOT_LOGO, 'bot-img'));
      if (!first && !reduceMotion()) replay(shellRefs.logo, 'pop-in');
    }
  }

  let menuAbort = null;
  function settingsMenu() {
    menuAbort?.abort();
    menuAbort = new AbortController();
    const { signal } = menuAbort;
    const T = window.VoiceyTheme;

    const gear = h('button', { class: 'btn btn-icon gear', type: 'button', title: 'Settings', 'aria-label': 'Settings', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ico('gear-six', 'bold'));
    const themeBtn = (id, label) => h('button', { class: 'menu-item', type: 'button', role: 'menuitemradio', 'aria-checked': 'false', dataset: { theme: id },
      onclick: () => { T.set(id); sync(); } },
      h('span', { class: `sw ${id}` }), label, h('span', { class: 'grow' }), ico('check', 'bold'));
    const logoutBtn = h('button', { class: 'menu-item danger', type: 'button', role: 'menuitem', onclick: () => { close(); logout(); } }, ico('sign-out', 'bold'), 'Log out');
    const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Settings', hidden: true },
      h('div', { class: 'menu-label' }, 'Theme'),
      themeBtn('dark', 'Dark'),
      themeBtn('blue', 'Fluxer Blue'),
      h('div', { class: 'menu-sep', role: 'separator' }),
      logoutBtn,
    );
    const items = () => [...menu.querySelectorAll('.menu-item')];
    function sync() {
      const cur = T.get();
      menu.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === cur)));
    }
    function open() { sync(); menu.hidden = false; gear.setAttribute('aria-expanded', 'true'); items().find((b) => b.getAttribute('aria-checked') === 'true')?.focus(); }
    function close(refocus = false) { menu.hidden = true; gear.setAttribute('aria-expanded', 'false'); if (refocus) gear.focus(); }

    gear.addEventListener('click', () => (menu.hidden ? open() : close()));
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !gear.contains(e.target)) close(); }, { signal });
    document.addEventListener('keydown', (e) => {
      if (menu.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items(); const i = list.indexOf(document.activeElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
      }
    }, { signal });
    sync();
    return { gear, menu };
  }

  function setSidebar(open) {
    state.sidebarOpen = open;
    shellRefs.sidebar?.classList.toggle('open', open);
    shellRefs.scrim?.classList.toggle('show', open);
  }

  function serverItem(g, idx) {
    return h('button', {
      class: `server ${g.botIn ? '' : 'no-bot'} ${shellRefs.fresh ? 'enter' : ''}`,
      style: shellRefs.fresh ? `--i:${idx}` : null,
      dataset: { id: g.id },
      'aria-current': String(g.id === state.guildId),
      title: g.botIn ? g.name : `${g.name} — Voicey isn't here yet`,
      onclick: () => { setSidebar(false); go(g.id, g.botIn ? state.tab : 'overview'); },
    }, iconEl(g.name, g.iconUrl), h('span', { class: 'name' }, g.name), g.botIn ? null : h('span', { class: 'tag' }, 'Invite'));
  }

  function fillServerList() {
    const withBot = state.guilds.filter((g) => g.botIn);
    const without = state.guilds.filter((g) => !g.botIn);
    let n = 0;
    shellRefs.list.replaceChildren(
      ...(withBot.length ? [h('div', { class: 'sb-label' }, 'Voicey is here')] : []),
      ...withBot.map((g) => serverItem(g, n++)),
      ...(without.length ? [h('div', { class: 'sb-label' }, 'Add Voicey')] : []),
      ...without.map((g) => serverItem(g, n++)),
      ...(!state.guilds.length ? [h('div', { class: 'sb-empty' }, 'No servers found. You need the Manage Community permission in a server to see it here.')] : []),
    );
    shellRefs.list.querySelectorAll('.enter').forEach((el) => el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }));
  }

  function mountShell() {
    const u = state.me;
    shellRefs.fresh = true;
    shellRefs.list = h('div', { class: 'sb-list' });
    shellRefs.logo = h('div', { class: 'logo-mark bot-logo' });
    shellRefs.logoUrl = null;
    shellRefs.botName = h('strong', { class: 'grow' }, state.bot?.name || u.botName || 'Voicey');
    shellRefs.topName = h('b', {}, state.bot?.name || u.botName || 'Voicey');
    const { gear, menu } = settingsMenu();
    shellRefs.sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Servers' },
      h('div', { class: 'sb-head' },
        shellRefs.logo,
        shellRefs.botName,
        h('button', { class: 'btn btn-icon spin-on-click', title: 'Refresh servers', 'aria-label': 'Refresh servers', onclick: refreshGuilds }, ico('arrows-clockwise', 'bold')),
      ),
      shellRefs.list,
      h('div', { class: 'profile' },
        iconEl(u.username, u.avatarUrl, 'avatar'),
        h('div', { class: 'who' }, h('b', {}, u.username), h('span', {}, 'Logged in with Fluxer')),
        gear,
        menu,
      ),
    );
    shellRefs.scrim = h('div', { class: 'scrim', onclick: () => setSidebar(false) });
    shellRefs.main = h('main', { class: 'main' });
    shellRefs.shell = h('div', { class: 'shell' },
      shellRefs.sidebar,
      shellRefs.scrim,
      h('div', {},
        h('div', { class: 'topbar' },
          h('button', { class: 'btn btn-icon', 'aria-label': 'Open server list', onclick: () => setSidebar(true) }, ico('list', 'bold')),
          shellRefs.topName,
        ),
        shellRefs.main,
      ),
    );
    root.replaceChildren(shellRefs.shell);
    setBot(state.bot);
    fillServerList();
    shellRefs.sig = guildSignature();
    shellRefs.fresh = false;
  }

  const guildSignature = () => state.guilds.map((g) => `${g.id}:${g.botIn ? 1 : 0}:${g.iconUrl ?? ''}`).join('|');

  function renderShell(mainContent, { animate = true } = {}) {
    if (!shellRefs.shell || !root.contains(shellRefs.shell)) mountShell();
    else if (shellRefs.sig !== guildSignature()) { fillServerList(); shellRefs.sig = guildSignature(); }

    shellRefs.list.querySelectorAll('.server').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === state.guildId)));

    const view = h('div', { class: `view ${animate ? 'view-in' : ''}` }, mainContent);
    shellRefs.main.replaceChildren(view);
    if (animate) { staggerIn(view); setTimeout(() => view.classList.remove('view-in'), 1000); }
  }

  async function logout() {
    stopPolling();
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    state.me = null; state.guilds = []; state.detail = null; state.bot = null; shellRefs.shell = null;
    history.replaceState(null, '', '/');
    render();
  }

  async function refreshGuilds() {
    try {
      state.guilds = await api('/guilds?refresh=1');
      render();
      toast('Server list refreshed');
    } catch (e) { fail(e); }
  }

  // ---------------------------------------------------------------- main views

  function selectedGuild() { return state.guilds.find((g) => g.id === state.guildId) ?? null; }

  function renderHome() {
    stopPolling();
    setBot(state.me.bot);
    const first = state.guilds.find((g) => g.botIn);
    renderShell(
      h('div', { class: 'empty' },
        ico('hand-waving', 'bold'),
        h('h3', {}, `Welcome, ${state.me.username}`),
        h('p', {}, state.guilds.length ? 'Pick a server from the sidebar to manage Voicey. Servers where Voicey is missing are greyed out.' : 'You do not manage any server yet.'),
        first ? h('button', { class: 'btn btn-primary', onclick: () => go(first.id) }, 'Open ' + first.name) : null,
      ),
    );
  }

  function renderInvite(g) {
    stopPolling();
    setBot(state.me.bot);
    const url = `${state.me.inviteUrl}&guild_id=${encodeURIComponent(g.id)}`;
    renderShell([
      pageHead(g, 'Voicey is not in this server yet'),
      h('div', { class: 'empty' },
        ico('plugs', 'bold'),
        h('h3', {}, 'Invite Voicey to continue'),
        h('p', {}, 'Add the bot to this server, then come back and press refresh. Once it joins, the server moves to the top of your list.'),
        h('div', { class: 'actions', style: 'justify-content:center' },
          h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener' }, ico('plus-circle', 'bold'), 'Invite Voicey'),
          h('button', { class: 'btn', onclick: refreshGuilds }, ico('arrows-clockwise', 'bold'), 'I added it — refresh'),
        ),
      ),
    ]);
  }

  function pageHead(g, subtitle) {
    return h('div', { class: 'page-head' }, iconEl(g.name, g.iconUrl), h('div', {}, h('h1', {}, g.name), h('p', {}, subtitle)));
  }

  function tabsBar() {
    const t = (id, label, icon) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => go(state.guildId, id) }, ico(icon, 'bold'), label);
    const bar = h('div', { class: 'tabs', role: 'tablist' }, h('span', { class: 'tab-pill', 'aria-hidden': 'true' }), t('overview', 'Overview', 'waveform'), t('setup', 'Setup', 'magic-wand'), t('settings', 'Settings', 'gear-six'), t('profile', 'Profile', 'identification-card'), t('commands', 'Commands', 'terminal-window'));
    requestAnimationFrame(() => {
      const pill = bar.querySelector('.tab-pill'); const sel = bar.querySelector('.tab[aria-selected="true"]');
      if (!pill || !sel) return;
      const to = { x: sel.offsetLeft, w: sel.offsetWidth };
      const from = tabPill.last ?? to;
      pill.style.transition = 'none'; pill.style.transform = `translateX(${from.x}px)`; pill.style.width = `${from.w}px`;
      void pill.offsetWidth;
      pill.style.transition = ''; pill.style.transform = `translateX(${to.x}px)`; pill.style.width = `${to.w}px`;
      tabPill.last = to;
    });
    return bar;
  }
  const tabPill = { last: null };

  async function loadGuild() {
    stopPolling();
    state.detail = null;
    if (!state.me) return;
    if (!state.guildId) return renderHome();

    const g = selectedGuild();
    if (!g) { go(null); return; }
    if (!g.botIn) return renderInvite(g);

    renderShell([pageHead(g, 'Loading…'), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })], { animate: false });
    try {
      state.detail = await api(`/guilds/${g.id}`);
    } catch (e) { fail(e); return; }
    if (state.guildId !== g.id) return;
    setBot(state.detail.bot);
    renderGuild();
  }

  function renderGuild() {
    const g = selectedGuild();
    const d = state.detail;
    if (!g || !d) return;
    stopPolling();

    const body = h('div', {});
    renderShell([pageHead(g, d.setup ? 'Temporary voice channels are active' : 'Not set up yet'), tabsBar(), body]);

    if (state.tab === 'settings') body.append(settingsView(g, d));
    else if (state.tab === 'profile') profileView(body, g);
    else if (state.tab === 'commands') commandsView(body, g, d);
    else if (state.tab === 'setup') body.append(setupView(g, d));
    else overviewView(body, g, d);
    if (state.tab === 'settings' || state.tab === 'setup' || state.tab === 'overview') staggerIn(body);
  }

  // ---------------------------------------------------------------- overview (live)

  function overviewView(body, g, d) {
    if (!d.setup) {
      body.append(h('div', { class: 'empty' },
        ico('magic-wand', 'bold'),
        h('h3', {}, 'Create your first temporary channel'),
        h('p', {}, 'Voicey needs a “Join to Create” channel. It takes one click.'),
        h('button', { class: 'btn btn-primary', onclick: () => go(g.id, 'setup') }, ico('rocket-launch', 'bold'), 'Start setup'),
      ));
      return;
    }

    const statChannels = statCard('speaker-high', 'Active temp channels');
    const statMembers = statCard('users-three', 'Members in temp channels');
    const stats = h('div', { class: 'stats' }, statChannels.el, statMembers.el);
    const list = h('div', {});
    const grid = h('div', { class: 'vc-grid' });
    const empty = h('div', { class: 'empty' }, ico('moon-stars', 'bold'), h('h3', {}, 'Nobody is in a temporary channel'),
      h('p', {}, `When a member joins “${d.setup.joinChannelName ?? 'Join to Create'}”, their channel shows up here live.`));
    const stamp = h('span', { class: 'live' }, 'Live');
    body.append(
      h('div', { class: 'actions', style: 'margin-bottom:14px' }, h('h2', { style: 'margin:0;font-size:18px' }, 'Active channels'), stamp),
      stats, list,
    );

    const cards = new Map(); // channel id -> element currently in the grid
    const draw = (v) => {
      statChannels.set(v.totals.channels);
      statMembers.set(v.totals.members);
      if (!v.channels.length) {
        cards.clear();
        if (list.firstChild !== empty) { list.replaceChildren(empty); replay(empty, 'enter'); }
        return;
      }
      if (list.firstChild !== grid) list.replaceChildren(grid);
      const ordered = v.channels.map((c, idx) => {
        const isNew = !cards.has(c.id);
        const el = channelCard(c);
        if (isNew) { el.style.setProperty('--i', String(idx)); replay(el, 'enter'); }
        cards.set(c.id, el);
        return el;
      });
      for (const id of [...cards.keys()]) if (!v.channels.some((c) => c.id === id)) cards.delete(id);
      grid.replaceChildren(...ordered);
    };

    const tick = async () => {
      if (document.hidden || state.tab !== 'overview' || state.guildId !== g.id) return;
      try {
        const v = await api(`/guilds/${g.id}/voice`);
        if (state.guildId !== g.id) return;
        if (v.bot) setBot(v.bot);
        draw(v);
      } catch (e) { if (e.handled) stopPolling(); }
    };
    tick();
    state.pollTimer = setInterval(tick, 5000);
  }

  function replay(el, cls) {
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }

  function staggerIn(el, sel = '.card, .stat, .cmd, .pcard, .chatprev, .empty, .alert') {
    if (reduceMotion()) return;
    el.querySelectorAll(sel).forEach((n, i) => { n.style.setProperty('--i', String(Math.min(i, 10))); replay(n, 'enter'); });
  }

  function statCard(icon, label) {
    const num = h('b', {}, '0');
    let shown = 0; let raf = 0;
    const set = (to) => {
      cancelAnimationFrame(raf);
      if (reduceMotion() || to === shown) { num.textContent = to; shown = to; return; }
      const from = shown; const t0 = performance.now(); const dur = 500;
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 3);
        num.textContent = Math.round(from + (to - from) * e);
        if (p < 1) raf = requestAnimationFrame(step); else shown = to;
      };
      raf = requestAnimationFrame(step); shown = to;
    };
    return { el: h('div', { class: 'stat' }, ico(icon, 'bold'), h('div', {}, num, h('span', {}, label))), set };
  }


  function channelCard(c) {
    return h('article', { class: 'vc' },
      h('div', { class: 'vc-head' },
        h('h3', {}, c.name),
        c.locked ? h('span', { class: 'badge warn' }, ico('lock-simple', 'bold'), 'Locked') : h('span', { class: 'badge ok' }, ico('lock-simple-open', 'bold'), 'Open'),
      ),
      h('p', { class: 'meta' },
        h('span', { class: 'mi' }, ico('crown-simple', 'fill'), `Owner: ${c.owner.name}`),
        h('span', { class: 'mi', title: 'Members' }, ico('users', 'bold'), c.userLimit ? `${c.memberCount}/${c.userLimit}` : `${c.memberCount}`),
        h('span', { class: 'mi', title: 'Channel age' }, ico('clock', 'bold'), relTime(c.createdAt)),
      ),
      c.members.length
        ? h('ul', { class: 'members' }, c.members.map((m) =>
            h('li', { class: 'member' }, iconEl(m.name, m.avatarUrl, 'avatar'), h('span', {}, m.name), m.isOwner ? h('i', { class: 'ph-fill ph-crown-simple crown', title: 'Channel owner' }) : null)))
        : h('p', { class: 'meta' }, ico('hourglass', 'bold'), c.emptySince ? `Empty for ${relTime(c.emptySince)} — will be deleted soon` : 'Waiting for members…'),
    );
  }

  // ---------------------------------------------------------------- settings

  const TEMPLATE_PRESETS = ["🔊 {user}'s Channel", "{user}'s Room", '🎧 {user}', '🎮 Room #{count}'];

  function nameTemplateField(value) {
    const input = h('input', { class: 'input', id: 'tpl', maxlength: '32', value, autocomplete: 'off' });
    const preview = h('div', { class: 'preview' });
    const upd = () => { preview.replaceChildren('Preview: ', h('code', {}, Array.from(input.value.replaceAll('{user}', 'Ahmed').replaceAll('{username}', 'Ahmed').replaceAll('{count}', '1')).slice(0, 32).join('') || '…')); };
    input.addEventListener('input', upd); upd();
    return {
      input,
      el: h('div', { class: 'field' },
        h('label', { for: 'tpl' }, 'Temporary channel name'),
        input,
        h('div', { class: 'chips' }, TEMPLATE_PRESETS.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = p; upd(); } }, p))),
        h('span', { class: 'hint' }, 'Use {user} for the member’s name and {count} for the member count. Max 32 characters.'),
        preview,
      ),
    };
  }

  function settingsView(g, d) {
    const s = d.settings;
    const prefix = h('input', { class: 'input', id: 'prefix', maxlength: '5', value: s.prefix, autocomplete: 'off', spellcheck: 'false' });
    const lang = h('select', { class: 'input', id: 'lang' }, d.languages.map((l) => h('option', { value: l.code, selected: l.code === s.language }, `${l.flag} ${l.name}`)));
    const delay = h('input', { class: 'input', id: 'delay', type: 'number', min: '0', max: '3600', step: '1', value: s.deletionDelay });
    const tpl = nameTemplateField(s.nameTemplate);
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, ico('floppy-disk', 'bold'), 'Save changes');

    const form = h('form', { class: 'card', onsubmit: async (ev) => {
      ev.preventDefault();
      save.disabled = true;
      try {
        d.settings = await api(`/guilds/${g.id}/settings`, { method: 'PATCH', body: {
          prefix: prefix.value.trim(), language: lang.value, deletionDelay: Number(delay.value), nameTemplate: tpl.input.value,
        } });
        toast('Settings saved');
      } catch (e) { fail(e); } finally { save.disabled = false; }
    } },
      h('h2', {}, ico('gear-six', 'bold'), 'Server settings'),
      h('p', { class: 'sub' }, `Changes apply to ${g.name} immediately.`),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'prefix' }, 'Command prefix'), prefix, h('span', { class: 'hint' }, 'Up to 5 characters, no spaces. Example: ! or v.')),
        h('div', { class: 'field' }, h('label', { for: 'lang' }, 'Bot language'), lang, h('span', { class: 'hint' }, 'Language Voicey uses for replies in this server.')),
      ),
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'delay' }, 'Delete empty channels after (seconds)'), delay, h('span', { class: 'hint' }, '0 deletes right away. Maximum 3600.')),
        h('div', {}),
      ),
      tpl.el,
      h('div', { class: 'actions' }, save),
    );
    return form;
  }

  // ---------------------------------------------------------------- setup

  function setupView(g, d) {
    if (d.setup) {
      return h('div', { class: 'card' },
        h('h2', {}, ico('check-circle', 'fill'), 'Setup is complete'),
        h('p', { class: 'sub' }, 'Members who join the channel below get their own temporary voice channel.'),
        h('div', { class: 'tree', style: 'margin-bottom:18px' },
          d.setup.categoryName ? h('div', {}, ico('folder-simple', 'bold'), d.setup.categoryName) : null,
          h('div', { class: d.setup.categoryName ? 'indent' : '' }, ico('speaker-high', 'bold'), d.setup.joinChannelName ?? 'Join to Create (channel not found)'),
        ),
        h('div', { class: 'actions' },
          h('button', { class: 'btn btn-danger', onclick: async () => {
            const { ok, checked } = await confirmDialog({
              title: 'Remove setup?', body: 'Voicey will stop creating temporary channels in this server.', confirmLabel: 'Remove setup', danger: true,
              checkbox: 'Also delete the Join to Create channel and all active temporary channels',
            });
            if (!ok) return;
            try { await api(`/guilds/${g.id}/setup${checked ? '?channels=1' : ''}`, { method: 'DELETE' }); toast('Setup removed'); await loadGuild(); } catch (e) { fail(e); }
          } }, ico('trash', 'bold'), 'Remove setup'),
        ),
      );
    }

    const s = d.settings;
    const tpl = nameTemplateField(s.nameTemplate);
    const delay = h('input', { class: 'input', id: 'sdelay', type: 'number', min: '0', max: '3600', value: s.deletionDelay });
    const announce = h('select', { class: 'input', id: 'ann' }, h('option', { value: '' }, 'Don’t post a message'), d.channels.text.map((c) => h('option', { value: c.id }, `# ${c.name}`)));
    const joinSel = h('select', { class: 'input', id: 'joinsel' }, d.channels.voice.map((c) => h('option', { value: c.id }, `🔊 ${c.name}`)));
    const catSel = h('select', { class: 'input', id: 'catsel' }, h('option', { value: '' }, 'Same category as the channel'), d.channels.categories.map((c) => h('option', { value: c.id }, c.name)));
    const existingBox = h('div', { hidden: true },
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'joinsel' }, 'Join to Create channel'), joinSel),
        h('div', { class: 'field' }, h('label', { for: 'catsel' }, 'Category for temporary channels'), catSel),
      ),
    );
    const autoBox = h('div', { class: 'field' },
      h('span', { class: 'lbl' }, 'Voicey will create'),
      h('div', { class: 'tree' }, h('div', {}, ico('folder-simple', 'bold'), 'Voice Channels'), h('div', { class: 'indent' }, ico('speaker-high', 'bold'), '➕ Join to Create')),
    );

    const mode = { value: 'auto' };
    const radio = (value, title, desc, checked) => h('label', {}, h('input', { type: 'radio', name: 'mode', value, checked, onchange: () => {
      mode.value = value; existingBox.hidden = value !== 'existing'; autoBox.hidden = value !== 'auto';
    } }), h('b', {}, title), h('small', {}, desc));

    const go1 = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, ico('magic-wand', 'bold'), 'Create setup');

    return h('form', { class: 'card', onsubmit: async (ev) => {
      ev.preventDefault();
      if (mode.value === 'existing' && !joinSel.value) return toast('This server has no voice channel to use.', 'error');
      go1.disabled = true;
      try {
        await api(`/guilds/${g.id}/settings`, { method: 'PATCH', body: { nameTemplate: tpl.input.value, deletionDelay: Number(delay.value) } });
        await api(`/guilds/${g.id}/setup`, { method: 'POST', body: mode.value === 'existing'
          ? { mode: 'existing', joinChannelId: joinSel.value, categoryId: catSel.value || undefined, announceChannelId: announce.value || undefined }
          : { mode: 'auto', announceChannelId: announce.value || undefined } });
        toast('Setup complete — try joining the channel!');
        await loadGuild();
      } catch (e) { fail(e); go1.disabled = false; }
    } },
      h('h2', {}, ico('magic-wand', 'bold'), 'Set up temporary channels'),
      h('p', { class: 'sub' }, 'Members join one special voice channel and Voicey instantly gives them their own room. Empty rooms are deleted automatically.'),
      h('div', { class: 'choice' },
        radio('auto', 'Quick setup', 'Recommended. Voicey creates the category and channel for you.', true),
        radio('existing', 'Use existing channels', 'Pick a voice channel and category you already have.', false),
      ),
      autoBox, existingBox,
      tpl.el,
      h('div', { class: 'row' },
        h('div', { class: 'field' }, h('label', { for: 'sdelay' }, 'Delete empty channels after (seconds)'), delay),
        h('div', { class: 'field' }, h('label', { for: 'ann' }, 'Post “setup complete” message in'), announce),
      ),
      h('div', { class: 'actions' }, go1, h('span', { class: 'hint' }, 'Voicey needs Manage Channels and Manage Permissions in this server.')),
    );
  }


  // ---------------------------------------------------------------- profile (per-server bot identity)

  const ALLOWED_IMG = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const MAX_IMG = 8 * 1024 * 1024;

  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!ALLOWED_IMG.includes(file.type)) return reject(new Error('Use a PNG, JPEG, GIF or WebP image.'));
      if (file.size > MAX_IMG) return reject(new Error('Image is larger than 8 MB.'));
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.readAsDataURL(file);
    });
  }

  async function profileView(body, g) {
    body.replaceChildren(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    let p;
    try { p = await api(`/guilds/${g.id}/profile`); } catch (e) { body.replaceChildren(h('div', { class: 'alert' }, e.message)); return; }
    if (state.tab !== 'profile' || state.guildId !== g.id) return;
    if (p.bot) setBot(p.bot);

    // Everything below is local until "Save changes" — nothing is stored in the browser.
    const draft = { avatar: { mode: 'keep', uri: null }, banner: { mode: 'keep', uri: null } };
    let initial = { nick: p.nick ?? '', bio: p.bio ?? '' };

    const nick = h('input', { class: 'input', id: 'pnick', maxlength: '32', value: initial.nick, placeholder: p.username, autocomplete: 'off' });
    const bio = h('textarea', { class: 'input', id: 'pbio', maxlength: '190', rows: '4', placeholder: 'Tell people what Voicey does in this server…' }, initial.bio);
    const nickCount = h('span', { class: 'hint' });
    const bioCount = h('span', { class: 'hint' });

    const previewHost = h('div', { class: 'preview-col' });
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, ico('floppy-disk', 'bold'), 'Save changes');
    const discardBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: () => { nick.value = initial.nick; bio.value = initial.bio; draft.avatar = { mode: 'keep', uri: null }; draft.banner = { mode: 'keep', uri: null }; paint(); } }, ico('arrow-counter-clockwise', 'bold'), 'Discard');

    const dirty = () => ({
      nick: nick.value.trim() !== initial.nick.trim(),
      bio: bio.value.trim() !== initial.bio.trim(),
      avatar: draft.avatar.mode !== 'keep',
      banner: draft.banner.mode !== 'keep',
    });

    const imageField = (key, label, hint, hasCurrent) => {
      const input = h('input', { type: 'file', accept: ALLOWED_IMG.join(','), class: 'sr-only', id: `up-${key}`, onchange: async (ev) => {
        const f = ev.target.files?.[0]; ev.target.value = '';
        if (!f) return;
        try { draft[key] = { mode: 'new', uri: await readImage(f) }; paint(); } catch (e) { toast(e.message, 'error'); }
      } });
      const status = h('span', { class: 'hint' });
      const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => { draft[key] = { mode: 'remove', uri: null }; paint(); } }, ico('trash', 'bold'), 'Remove');
      const undoBtn = h('button', { class: 'btn', type: 'button', onclick: () => { draft[key] = { mode: 'keep', uri: null }; paint(); } }, ico('arrow-u-up-left', 'bold'), 'Undo');
      const el = h('div', { class: 'field' },
        h('span', { class: 'lbl' }, label),
        h('div', { class: 'actions' }, h('label', { class: 'btn', for: `up-${key}` }, ico('upload-simple', 'bold'), 'Upload'), input, removeBtn, undoBtn, status),
        h('span', { class: 'hint' }, hint),
      );
      return { el, update() {
        const m = draft[key].mode;
        status.textContent = m === 'new' ? 'New image — not saved yet' : m === 'remove' ? 'Will be removed when you save' : '';
        removeBtn.hidden = m !== 'keep' || !hasCurrent();
        undoBtn.hidden = m === 'keep';
      } };
    };

    const avatarField = imageField('avatar', 'Server avatar', 'PNG, JPEG, GIF or WebP, up to 8 MB. Square images look best.', () => Boolean(p.avatarUrl));
    const bannerField = imageField('banner', 'Server banner', 'Wide image (about 3:1), up to 8 MB.', () => Boolean(p.bannerUrl));

    function paint() {
      const dr = dirty();
      const name = nick.value.trim() || p.username;
      const avatarSrc = draft.avatar.mode === 'new' ? draft.avatar.uri : draft.avatar.mode === 'remove' ? p.globalAvatarUrl : (p.avatarUrl ?? p.globalAvatarUrl);
      const bannerSrc = draft.banner.mode === 'new' ? draft.banner.uri : draft.banner.mode === 'remove' ? null : p.bannerUrl;
      const bioText = bio.value.trim();

      nickCount.textContent = `${Array.from(nick.value).length}/32`;
      bioCount.textContent = `${Array.from(bio.value).length}/190`;
      avatarField.update(); bannerField.update();
      saveBtn.disabled = discardBtn.disabled = !Object.values(dr).some(Boolean);

      const bannerEl = h('div', { class: 'pbanner' });
      if (bannerSrc) bannerEl.style.backgroundImage = `url("${bannerSrc.replace(/"/g, '%22')}")`;

      previewHost.replaceChildren(
        h('div', { class: 'preview-label' }, ico('eye', 'bold'), 'Preview', h('span', {}, 'Local only until you save')),
        h('article', { class: 'pcard', 'aria-label': 'Profile preview' },
          bannerEl,
          h('div', { class: 'pavatar-wrap' }, iconEl(name, avatarSrc, 'pavatar')),
          h('div', { class: 'pbody' },
            h('div', { class: 'pname' }, h('b', {}, name), h('span', { class: 'botbadge' }, 'BOT')),
            h('div', { class: 'puser' }, p.username),
            bioText ? h('div', { class: 'pabout' }, h('small', {}, 'ABOUT ME'), h('p', {}, bioText)) : null,
          ),
        ),
        h('article', { class: 'chatprev', 'aria-label': 'Message preview' },
          iconEl(name, avatarSrc, 'avatar'),
          h('div', {}, h('div', { class: 'cmeta' }, h('b', {}, name), h('span', { class: 'botbadge' }, 'BOT'), h('small', {}, 'Today at 12:00')),
            h('div', {}, 'Join ➕ Join to Create to get your own voice room.')),
        ),
      );
    }
    for (const el of [nick, bio]) el.addEventListener('input', paint);

    const form = h('form', { class: 'profile-grid', onsubmit: async (ev) => {
      ev.preventDefault();
      const dr = dirty();
      const payload = {};
      if (dr.nick) payload.nick = nick.value.trim() || null;
      if (dr.bio) payload.bio = bio.value.trim() || null;
      if (dr.avatar) payload.avatar = draft.avatar.mode === 'new' ? draft.avatar.uri : null;
      if (dr.banner) payload.banner = draft.banner.mode === 'new' ? draft.banner.uri : null;
      saveBtn.disabled = true;
      try {
        p = await api(`/guilds/${g.id}/profile`, { method: 'PATCH', body: payload });
        if (p.bot) setBot(p.bot);
        initial = { nick: p.nick ?? '', bio: dr.bio ? bio.value.trim() : initial.bio };
        nick.value = initial.nick;
        draft.avatar = { mode: 'keep', uri: null }; draft.banner = { mode: 'keep', uri: null };
        toast('Voicey’s profile was updated in this server');
        paint();
      } catch (e) { fail(e); paint(); }
    } },
      h('div', { class: 'card' },
        h('h2', {}, ico('identification-card', 'bold'), 'Bot profile in this server'),
        h('p', { class: 'sub' }, `These changes only apply in ${g.name}. Other servers keep their own look.`),
        h('div', { class: 'field' }, h('label', { for: 'pnick' }, 'Display name'), nick, nickCount),
        h('div', { class: 'field' }, h('label', { for: 'pbio' }, 'Bio'), bio, bioCount,
          h('span', { class: 'hint' }, 'Fluxer may not return the saved bio, so this box can look empty. Leave it alone to keep the current bio.')),
        avatarField.el, bannerField.el,
        h('div', { class: 'actions' }, saveBtn, discardBtn),
      ),
      previewHost,
    );
    paint();
    body.replaceChildren(form);
    staggerIn(form);
  }

  // ---------------------------------------------------------------- commands (enable/disable + access)

  async function commandsView(body, g, d) {
    body.replaceChildren(h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    let data;
    try { data = await api(`/guilds/${g.id}/commands`); } catch (e) { body.replaceChildren(h('div', { class: 'alert' }, e.message)); return; }
    if (state.tab !== 'commands' || state.guildId !== g.id) return;

    const prefix = d.settings.prefix;
    const roleById = new Map(data.roles.map((r) => [r.id, r]));
    const people = new Map(Object.entries(data.members)); // id -> {name, avatarUrl}
    const openRows = new Set();

    const save = async (cmd) => {
      const saved = await api(`/guilds/${g.id}/commands/${cmd.name}`, { method: 'PUT', body: { enabled: cmd.enabled, roles: cmd.roles, members: cmd.members } });
      Object.assign(cmd, saved);
    };

    function accessSummary(cmd) {
      const n = cmd.roles.length + cmd.members.length;
      if (n) return h('span', { class: 'badge ok' }, ico('users-three', 'bold'), `Custom: ${[cmd.roles.length && `${cmd.roles.length} role${cmd.roles.length > 1 ? 's' : ''}`, cmd.members.length && `${cmd.members.length} member${cmd.members.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`);
      return cmd.base === 'manage'
        ? h('span', { class: 'badge warn' }, ico('shield-check', 'bold'), 'Default: Manage Community only')
        : h('span', { class: 'badge' }, ico('globe-hemisphere-west', 'bold'), 'Default: everyone');
    }

    function row(cat, cmd) {
      const host = h('div', { class: `cmd ${cmd.enabled ? '' : 'off'}` });

      let justOpened = false;
      const draw = () => {
        const isOpen = openRows.has(cmd.name);
        const toggle = h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: cmd.enabled, 'aria-label': `${cmd.enabled ? 'Disable' : 'Enable'} ${prefix}${cmd.name}`, onchange: async (ev) => {
          const next = ev.target.checked;
          try { await save({ ...cmd, enabled: next }); cmd.enabled = next; toast(`${prefix}${cmd.name} ${next ? 'enabled' : 'disabled'}`); } catch (e) { ev.target.checked = cmd.enabled; fail(e); }
          draw();
        } });
        host.className = `cmd ${cmd.enabled ? '' : 'off'}`;
        host.replaceChildren(
          h('div', { class: 'cmd-head' },
            toggle,
            h('div', { class: 'cmd-name' }, h('code', {}, `${prefix}${cmd.name}`), h('span', {}, cmd.description)),
            accessSummary(cmd),
            h('button', { class: 'btn btn-icon', type: 'button', 'aria-expanded': String(isOpen), title: 'Who can use it', onclick: () => { if (isOpen) openRows.delete(cmd.name); else { openRows.add(cmd.name); justOpened = true; } draw(); } }, ico(isOpen ? 'caret-up' : 'users-three', 'bold')),
          ),
          ...(isOpen ? [(() => { const ed = accessEditor(); if (justOpened) { replay(ed, 'unfold'); justOpened = false; } return ed; })()] : []),
        );
      };

      function accessEditor() {
        const work = { roles: [...cmd.roles], members: [...cmd.members] };
        const lists = h('div', { class: 'chips-wrap' });
        const roleSel = h('select', { class: 'input', 'aria-label': 'Add a role' }, h('option', { value: '' }, 'Add a role…'),
          data.roles.map((r) => h('option', { value: r.id }, r.name)));
        const search = h('input', { class: 'input', type: 'search', placeholder: 'Search a member or paste their ID…', 'aria-label': 'Add a member', autocomplete: 'off' });
        const results = h('div', { class: 'results', hidden: true });
        const saveBtn = h('button', { class: 'btn btn-primary', type: 'button' }, ico('floppy-disk', 'bold'), 'Save access');
        const resetBtn = h('button', { class: 'btn', type: 'button' }, ico('arrow-counter-clockwise', 'bold'), 'Back to default');

        const seen = new Set();
        const chipClass = (key) => { const cls = seen.has(key) ? 'chip-x' : 'chip-x pop'; seen.add(key); return cls; };
        const paintLists = () => {
          lists.replaceChildren(
            ...work.roles.map((id) => {
              const r = roleById.get(id);
              return h('span', { class: chipClass(`r${id}`) }, h('i', { class: 'dot', style: r?.color ? `background:${r.color}` : '' }), r?.name ?? 'Deleted role',
                h('button', { type: 'button', 'aria-label': `Remove role ${r?.name ?? id}`, onclick: () => { work.roles = work.roles.filter((x) => x !== id); paintLists(); } }, ico('x', 'bold')));
            }),
            ...work.members.map((id) => {
              const m = people.get(id);
              return h('span', { class: chipClass(`m${id}`) }, iconEl(m?.name ?? '?', m?.avatarUrl, 'mini'), m?.name ?? id,
                h('button', { type: 'button', 'aria-label': `Remove ${m?.name ?? id}`, onclick: () => { work.members = work.members.filter((x) => x !== id); paintLists(); } }, ico('x', 'bold')));
            }),
            ...(!work.roles.length && !work.members.length
              ? [h('span', { class: 'hint' }, cmd.base === 'manage' ? 'Empty — only the server owner, Administrators and Manage Community can use it.' : 'Empty — everyone can use it.')]
              : []),
          );
        };

        roleSel.addEventListener('change', () => { if (roleSel.value && !work.roles.includes(roleSel.value)) work.roles.push(roleSel.value); roleSel.value = ''; paintLists(); });

        let timer;
        search.addEventListener('input', () => {
          clearTimeout(timer);
          const q = search.value.trim();
          if (!q) { results.hidden = true; return; }
          timer = setTimeout(async () => {
            try {
              const found = await api(`/guilds/${g.id}/members/search?q=${encodeURIComponent(q)}`);
              results.replaceChildren(...(found.length
                ? found.map((m) => h('button', { type: 'button', class: 'result', onclick: () => {
                    people.set(m.id, { name: m.name, avatarUrl: m.avatarUrl });
                    if (!work.members.includes(m.id)) work.members.push(m.id);
                    search.value = ''; results.hidden = true; paintLists();
                  } }, iconEl(m.name, m.avatarUrl, 'mini'), m.name))
                : [h('div', { class: 'hint', style: 'padding:8px 10px' }, 'No members found.')]));
              results.hidden = false;
            } catch (e) { fail(e); }
          }, 300);
        });

        saveBtn.addEventListener('click', async () => {
          saveBtn.disabled = true;
          try { await save({ ...cmd, roles: work.roles, members: work.members }); cmd.roles = work.roles; cmd.members = work.members; toast(`Access for ${prefix}${cmd.name} saved`); openRows.delete(cmd.name); draw(); }
          catch (e) { fail(e); saveBtn.disabled = false; }
        });
        resetBtn.addEventListener('click', async () => {
          try { await save({ ...cmd, roles: [], members: [] }); cmd.roles = []; cmd.members = []; toast(`${prefix}${cmd.name} is back to its default access`); draw(); } catch (e) { fail(e); }
        });

        paintLists();
        return h('div', { class: 'access' },
          h('p', { class: 'hint' }, cmd.base === 'manage'
            ? 'Add roles or members who may use this command. They can use it without having Manage Community, and everyone else (except the owner and Administrators) is blocked.'
            : 'Add roles or members to restrict this command to them. Leave it empty so everyone can use it. Voice controls still need the member to be inside a temporary channel.'),
          lists,
          h('div', { class: 'row' }, h('div', { class: 'field' }, roleSel), h('div', { class: 'field results-host' }, search, results)),
          h('div', { class: 'actions' }, saveBtn, resetBtn),
        );
      }

      draw();
      return host;
    }

    const resetAll = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const { ok } = await confirmDialog({ title: 'Reset all commands?', body: 'Every command will be enabled again and every role/member list cleared.', confirmLabel: 'Reset everything', danger: true });
      if (!ok) return;
      try { await api(`/guilds/${g.id}/commands`, { method: 'DELETE' }); toast('Commands reset to defaults'); renderGuild(); } catch (e) { fail(e); }
    } }, ico('arrow-counter-clockwise', 'bold'), 'Reset all');

    body.replaceChildren(
      h('div', { class: 'actions', style: 'margin-bottom:14px;justify-content:space-between' },
        h('p', { class: 'hint', style: 'margin:0;max-width:640px' }, 'Switch commands on or off, or choose exactly who can use them. Commands that need Manage Community stay locked to managers unless you add specific roles or members.'),
        resetAll),
      ...data.categories.map((cat) =>
        h('section', { class: 'card' },
          h('h2', {}, ico(cat.icon, 'bold'), cat.label, h('span', { class: 'count' }, `${cat.commands.filter((c) => c.enabled).length}/${cat.commands.length} on`)),
          h('div', { class: 'cmd-list' }, cat.commands.map((cmd) => row(cat, cmd))),
        )),
    );
    staggerIn(body, '.card');
  }

  // ---------------------------------------------------------------- boot

  function render() {
    if (!state.me) return renderLogin();
    if (!state.guildId) return renderHome();
    if (state.detail && selectedGuild()?.botIn) return renderGuild();
    const g = selectedGuild();
    if (g && !g.botIn) return renderInvite(g);
    return renderHome();
  }

  async function boot() {
    parseHash();
    try {
      state.me = await api('/me');
      state.bot = state.me.bot ?? null;
      state.guilds = await api('/guilds');
    } catch (e) {
      if (!e.handled) renderLogin();
      return;
    }
    if (state.guildId) await loadGuild(); else renderHome();
  }

  document.addEventListener('visibilitychange', () => { /* polling pauses itself while hidden */ });
  boot();
})();