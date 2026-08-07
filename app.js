/* ============================================================
   Mensa Kawaii — frontend logic (vanilla JS)
   koharu design system port. Keeps the proven data layer from
   the original eth-uzh-nutrition site (selection, groups, raw
   text byte-identical with index.txt) and adds koharu
   interactions: theme toggle with View-Transitions gradient
   sweep, scroll progress, header gradient reveal, wave/motion
   preferences.

   DOM contract: class names in CONTRACT.md are mandatory.
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   1. Constants & configuration
   ------------------------------------------------------------ */

// Replaced at deploy time (e.g. "2026-08-07"). Keep the token verbatim.
const DATE_STR = '2026-08-08';
const STORAGE_KEY = 'eth-uzh-nutrition-prefs';

// Default groups, in display order (custom groups are appended after).
const DEFAULT_GROUPS = ['Central', 'Hoengg', 'Irchel'];

// Fixed nutrition keys, in display order. kcal is unitless, everything
// else is grams; weight only ever appears in "total".
const NUTRI_KEYS = ['kcal', 'protein', 'fat', 'saturated', 'carbs', 'sugar', 'salt', 'fiber', 'weight'];

// Nutrition table rows (9 fixed rows per contract).
const NUTRITION_ROWS = [
  { label: 'Energy', key: 'kcal' },
  { label: 'Protein', key: 'protein' },
  { label: 'Fat', key: 'fat' },
  { label: 'Saturated', key: 'saturated' },
  { label: 'Carbs', key: 'carbs' },
  { label: 'Sugar', key: 'sugar' },
  { label: 'Salt', key: 'salt' },
  { label: 'Fiber', key: 'fiber' },
  { label: 'Weight', key: 'weight' },
];

const EMPTY_MEALS_TEXT = 'No meals today ✨';
const GROUP_EMOJI = { Central: '🏛️', Hoengg: '🌊', Irchel: '🌿', Oerlikon: '🚂', Other: '✨' };
// Kami news-head pattern: each group gets a semantic color capsule.
const GROUP_COLOR = { Central: 'Central', Hoengg: 'Hoengg', Irchel: 'Irchel', Oerlikon: 'Oerlikon', Other: 'Other' };

/* ------------------------------------------------------------
   2. App state
   ------------------------------------------------------------ */

let data = null;

let prefs = {
  meal: 'Lunch',
  selected: new Set(),
  customGroups: {},
  collapsedMensas: new Set(),
};

let rawFiltered = '';

/* ------------------------------------------------------------
   3. Persistence (localStorage)
   ------------------------------------------------------------ */

function loadPrefs() {
  const p = { meal: 'Lunch', selected: new Set(), customGroups: {}, collapsedMensas: new Set() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return p;
    const parsed = JSON.parse(raw);
    if (parsed.meal === 'Lunch' || parsed.meal === 'Dinner') p.meal = parsed.meal;
    if (Array.isArray(parsed.selected)) p.selected = new Set(parsed.selected.map(String));
    if (parsed.customGroups && typeof parsed.customGroups === 'object' && !Array.isArray(parsed.customGroups)) {
      for (const [name, ids] of Object.entries(parsed.customGroups)) {
        if (Array.isArray(ids)) p.customGroups[String(name)] = ids.map(String);
      }
    }
    if (Array.isArray(parsed.collapsedMensas)) p.collapsedMensas = new Set(parsed.collapsedMensas.map(String));
  } catch (err) {
    console.warn('Could not read prefs; using defaults.', err);
  }
  return p;
}

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      meal: prefs.meal,
      selected: Array.from(prefs.selected),
      customGroups: prefs.customGroups,
      collapsedMensas: Array.from(prefs.collapsedMensas),
    }));
  } catch (err) {
    console.warn('Could not save prefs.', err);
  }
}

/* ------------------------------------------------------------
   4. Data loading & normalization
   ------------------------------------------------------------ */

async function fetchData() {
  const resp = await fetch('data.json', { cache: 'no-cache' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const json = await resp.json();
  if (!json || !Array.isArray(json.mensas)) throw new Error('Unexpected data.json shape');
  return json;
}

function normalizeMensas(raw) {
  return raw.map((m) => ({
    id: String(m.id),
    name: m.name || String(m.id),
    group: m.group || 'Other',
    meals: {
      Lunch: Array.isArray(m.meals && m.meals.Lunch) ? m.meals.Lunch : [],
      Dinner: Array.isArray(m.meals && m.meals.Dinner) ? m.meals.Dinner : [],
    },
  }));
}

function validatePrefsAgainstData() {
  const ids = new Set(data.mensas.map((m) => m.id));

  prefs.selected = new Set(Array.from(prefs.selected).filter((id) => ids.has(id)));

  for (const name of Object.keys(prefs.customGroups)) {
    prefs.customGroups[name] = prefs.customGroups[name].filter((id) => ids.has(id));
    if (!prefs.customGroups[name].length) delete prefs.customGroups[name];
  }

  prefs.collapsedMensas = new Set(Array.from(prefs.collapsedMensas).filter((id) => ids.has(id)));

  if (!prefs.selected.size) {
    prefs.selected = new Set(mensasInGroup('Central').map((m) => m.id));
  }

  savePrefs();
}

function mensaById(id) {
  return data.mensas.find((m) => m.id === id) || null;
}

function mensasInGroup(group) {
  return data.mensas.filter((m) => m.group === group);
}

function groupMembers(name) {
  if (prefs.customGroups[name]) return prefs.customGroups[name];
  return mensasInGroup(name).map((m) => m.id);
}

/* ------------------------------------------------------------
   5. Formatting helpers
   ------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Number formatting matching the backend dump: Number.toString() is
 * the JS equivalent of Python's str(float) for JSON numbers. The
 * backend strips trailing ".0" (18.0 -> "18") so the raw text from
 * the copy button is byte-identical with index.txt.
 */
function fmtNum(v) {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return String(n);
}

function fmtCell(v, key) {
  if (v == null || v === '') return '';
  return fmtNum(v) + (key === 'kcal' ? ' kcal' : ' g');
}

function nutriSegment(nutr, includeWeight) {
  const parts = [];
  for (const key of NUTRI_KEYS) {
    if (key === 'weight' && !includeWeight) continue;
    const v = nutr[key];
    if (!v) continue;
    parts.push(key + '=' + fmtNum(v) + (key === 'kcal' ? '' : 'g'));
  }
  return parts.join(', ');
}

/**
 * One raw-text line, index.txt format:
 *   NAME/SLOT: line — dish | desc | per100g: … | total: …
 * Empty segments and line==dish duplicates are dropped (mirrors the
 * backend dish_body()). Emits "nutrition=N/A" when the dish carries
 * no nutrition at all.
 */
function dishRawLine(m, d) {
  const nutrition = d.nutrition || { p100: {}, total: {} };
  const line = String(d.line || '').trim();
  const dish = String(d.dish || '').trim();
  const desc = String(d.desc || '').trim();

  let head;
  if (line && line.toLowerCase() !== dish.toLowerCase()) head = line + ' — ' + dish;
  else head = dish;
  if (desc) head += ' | ' + desc;

  const segs = [];
  const p100 = nutriSegment(nutrition.p100 || {}, false);
  const total = nutriSegment(nutrition.total || {}, true);
  if (p100) segs.push('per100g: ' + p100);
  if (total) segs.push('total: ' + total);

  return m.name + '/' + prefs.meal + ': ' + head +
    (segs.length ? ' | ' + segs.join(' | ') : ' | nutrition=N/A');
}

function buildRawText() {
  const lines = [];
  for (const m of data.mensas) {
    if (!prefs.selected.has(m.id)) continue;
    for (const d of m.meals[prefs.meal]) lines.push(dishRawLine(m, d));
  }
  return lines.join('\n');
}

function formatDate(iso) {
  let d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) d = new Date();
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ------------------------------------------------------------
   6. Theme (koharu: class-based dark + View Transitions sweep)
   ------------------------------------------------------------ */

function applyTheme(dark) {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  const input = document.querySelector('#theme-toggle .toggle-input');
  if (input) input.checked = dark;
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  applyTheme(document.documentElement.classList.contains('dark')); // sync the checkbox

  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const dark = !root.classList.contains('dark');
    root.classList.add('theme-transition');

    if (document.startViewTransition) {
      document.startViewTransition(() => applyTheme(dark))
        .finished.finally(() => root.classList.remove('theme-transition'));
    } else {
      applyTheme(dark);
      setTimeout(() => root.classList.remove('theme-transition'), 100);
    }
  });
}

/* ------------------------------------------------------------
   7. Scroll behaviors (kami: direction hide + glass depth)
   ------------------------------------------------------------ */

function initProgress() {
  const bar = document.getElementById('progress');
  const update = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(window.scrollY / max, 1) : 0) + ')';
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

/**
 * Kami header behavior:
 * - scroll down -> .hide (slide away), scroll up -> reveal
 * - glass opacity maps scroll depth (--header-glass-opacity on html)
 */
function initHeader() {
  const header = document.getElementById('site-header');
  const hero = document.getElementById('hero');
  let lastY = 0;

  const onScroll = () => {
    const y = window.scrollY;
    // Glass depth: fully opaque once the hero top is scrolled past.
    const heroH = hero ? hero.offsetHeight : 0;
    const t = heroH > 0 ? Math.min(y / heroH, 1) : (y > 40 ? 1 : 0);
    document.documentElement.style.setProperty('--header-glass-opacity', String(t));

    // Direction hide: skip while the drawer is open (no jump).
    if (document.body.classList.contains('menu-open')) { lastY = y; return; }
    if (y > lastY + 4 && y > 120) header.classList.add('hide');
    else if (y < lastY - 4 || y <= 40) header.classList.remove('hide');
    lastY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------
   7b. Kami entry animations (vanilla: IO + rAF, no framer-motion)
   ------------------------------------------------------------ */

let dishObserver = null;

/** BottomToUp entry: add .entered once a card enters the viewport. */
function observeDishEntries(root) {
  const cards = root.querySelectorAll('.dish:not(.entered)');
  if (!cards.length) return;

  if (document.documentElement.classList.contains('motion-off') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof IntersectionObserver === 'undefined') {
    cards.forEach((c) => c.classList.add('entered'));
    return;
  }

  if (!dishObserver) {
    dishObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('entered');
          dishObserver.unobserve(en.target);
        }
      }
    }, { rootMargin: '0px 0px -48px 0px', threshold: 0.05 });
  }
  cards.forEach((c) => dishObserver.observe(c));
}

/**
 * Kami NumberTransition (vanilla rAF): roll numeric cells (e.g. Energy)
 * from 0 to their target with an ease-out cubic. Skips non-numeric cells.
 */
function animateNumbers(root) {
  if (document.documentElement.classList.contains('motion-off') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  const cells = root.querySelectorAll('.n-val');
  for (const el of cells) {
    const text = el.textContent.trim();
    const m = text.match(/^([\d.]+)(.*)$/);
    if (!m) continue;
    const target = parseFloat(m[1]);
    const unit = m[2];
    const hasDecimal = text.includes('.');
    const dur = 600;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = target * eased;
      el.textContent = (hasDecimal ? val.toFixed(1) : String(Math.round(val))) + unit;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/** Kami TextUp: wrap each hero-title char in span.char with --i delay. */
function initHeroTitle() {
  const title = document.querySelector('.hero-title');
  if (!title) return;
  const text = title.textContent;
  if (document.documentElement.classList.contains('motion-off') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return; // leave the plain text visible
  }
  title.textContent = '';
  Array.from(text).forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'char';
    span.style.setProperty('--i', String(i));
    span.textContent = ch;
    title.appendChild(span);
  });
  // Kick the stagger on next frame (fonts/layout settled).
  requestAnimationFrame(() => requestAnimationFrame(() => title.classList.add('entered')));
}

/* ------------------------------------------------------------
   8. Effects preferences (koharu wave-off / motion-off)
   ------------------------------------------------------------ */

function initPrefs() {
  const wave = localStorage.getItem('site-wave') !== 'false';
  const motion = localStorage.getItem('site-motion') !== 'false';
  const root = document.documentElement;
  root.classList.toggle('wave-off', !wave);
  root.classList.toggle('motion-off', !motion);

  const w = document.getElementById('wave-toggle');
  const m = document.getElementById('motion-toggle');
  w.checked = wave;
  m.checked = motion;
  w.addEventListener('change', () => {
    root.classList.toggle('wave-off', !w.checked);
    localStorage.setItem('site-wave', String(w.checked));
  });
  m.addEventListener('change', () => {
    root.classList.toggle('motion-off', !m.checked);
    localStorage.setItem('site-motion', String(m.checked));
  });
}

/* ------------------------------------------------------------
   9. Rendering
   ------------------------------------------------------------ */

function renderAll() {
  updateSegmented();
  renderSelector();
  renderContent();
  updateRawText();
}

function renderSelector() {
  renderMensaList();
  renderGroupList();
}

function mensaRowHTML(m) {
  const sel = prefs.selected.has(m.id);
  return '<div class="mensa-row' + (sel ? ' selected' : '') + '" data-mensa="' + esc(m.id) + '"' +
    ' role="button" tabindex="0" aria-pressed="' + sel + '">' +
    '<span class="mensa-check" aria-hidden="true"></span>' +
    '<span class="mensa-label">' + esc(m.name) + '</span>' +
    '</div>';
}

function renderMensaList() {
  const container = document.querySelector('.selector-mensas');
  container.innerHTML = data.mensas.map(mensaRowHTML).join('');
}

function refreshMensaRows() {
  document.querySelectorAll('.mensa-row').forEach((row) => {
    const sel = prefs.selected.has(row.dataset.mensa);
    row.classList.toggle('selected', sel);
    row.setAttribute('aria-pressed', String(sel));
  });
}

function groupRowHTML(g) {
  const count = g.members.length;
  return '<button class="group-chip' + (g.custom ? ' custom' : '') + '" type="button"' +
    (count ? '' : ' disabled') +
    ' data-group="' + esc(g.name) + '" aria-label="Apply group ' + esc(g.name) + '">' +
    '<span class="chip-name">' + esc(g.name) + '</span>' +
    '<span class="chip-count">' + count + '</span>' +
    (g.custom
      ? '<span class="chip-x" role="button" tabindex="-1" aria-label="Delete group ' + esc(g.name) + '">&times;</span>'
      : '') +
    '</button>';
}

function renderGroupList() {
  const container = document.querySelector('.group-rows');

  const known = new Set(DEFAULT_GROUPS);
  const groups = DEFAULT_GROUPS.map((name) => ({ name, members: mensasInGroup(name).map((m) => m.id), custom: false }));
  for (const m of data.mensas) {
    if (!known.has(m.group)) {
      known.add(m.group);
      groups.push({ name: m.group, members: [m.id], custom: false });
    }
  }
  for (const name of Object.keys(prefs.customGroups)) {
    groups.push({ name, members: prefs.customGroups[name], custom: true });
  }

  container.innerHTML = groups.map(groupRowHTML).join('');
}

function dishHTML(d, i) {
  const nutrition = d.nutrition || { p100: {}, total: {} };
  const line = String(d.line || '').trim();
  const dish = String(d.dish || '').trim();
  const label = line && line.toLowerCase() !== dish.toLowerCase() ? line : '';
  return '<div class="dish" style="--i:' + (i || 0) + '">' +
    '<div class="dish-main">' +
    (label ? '<div class="dish-label">' + esc(label) + '</div>' : '') +
    '<h3 class="dish-name">' + esc(dish) + '</h3>' +
    (d.desc ? '<p class="dish-desc">' + esc(d.desc) + '</p>' : '') +
    '</div>' +
    '<div class="nutrition-col">' + nutritionTableHTML(nutrition) + '</div>' +
    '</div>';
}

function nutritionTableHTML(nutrition) {
  const p100 = nutrition.p100 || {};
  const total = nutrition.total || {};
  const rows = NUTRITION_ROWS.map((row) =>
    '<tr>' +
    '<td class="n-label">' + row.label + '</td>' +
    '<td class="n-val">' + fmtCell(p100[row.key], row.key) + '</td>' +
    '<td class="n-val">' + fmtCell(total[row.key], row.key) + '</td>' +
    '</tr>'
  ).join('');

  return '<table class="nutrition-table">' +
    '<thead><tr><th>Nutrition</th><th>per 100g</th><th>Total</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>';
}

function mensaSectionHTML(m, sectionIndex) {
  const dishes = m.meals[prefs.meal];
  const collapsed = prefs.collapsedMensas.has(m.id);
  const emoji = GROUP_EMOJI[m.group] || '✨';
  const color = GROUP_COLOR[m.group] || 'Other';
  // Stagger: dishes after the first fold (sections below the fold
  // animate on scroll anyway) — cap so long lists don't feel endless.
  const base = Math.min((sectionIndex || 0) * 3, 9);

  const bodyStyle = 'overflow:hidden;transition:max-height .35s ease' + (collapsed ? ';max-height:0' : '');
  const body = '<div class="mensa-dishes" style="' + bodyStyle + '">' +
    (dishes.length
      ? dishes.map((d, i) => dishHTML(d, base + i)).join('')
      : '<div class="no-meals">' + EMPTY_MEALS_TEXT + '</div>') +
    '</div>';

  return '<section class="mensa-section' + (collapsed ? ' collapsed' : '') + '" data-mensa="' + esc(m.id) + '">' +
    '<h2 class="mensa-title" role="button" tabindex="0" aria-expanded="' + !collapsed + '"' +
    ' data-emoji="' + esc(emoji) + '" data-group-color="' + esc(color) + '">' +
    '<span class="mensa-caret" aria-hidden="true"></span>' +
    esc(m.name) +
    '</h2>' + body +
    '</section>';
}

function renderContent() {
  const content = document.getElementById('content');
  const selected = data.mensas.filter((m) => prefs.selected.has(m.id));

  if (!selected.length) {
    content.innerHTML = '<div class="no-meals">' + EMPTY_MEALS_TEXT + '</div>';
    return;
  }
  content.innerHTML = selected.map(mensaSectionHTML).join('');
  // Kami BottomToUp entry: observe cards, animate once on first sight.
  observeDishEntries(content);
  // Kami NumberTransition: roll Energy figures up on render.
  animateNumbers(content);
}

/* ---------- segmented switch + sliding thumb ---------- */

function updateSegmented() {
  const seg = document.querySelector('.segmented');
  if (seg) seg.dataset.meal = prefs.meal;
  document.querySelectorAll('.seg-option').forEach((btn) => {
    const active = btn.dataset.meal === prefs.meal;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function positionThumb() {
  const seg = document.querySelector('.segmented');
  if (seg) seg.dataset.meal = prefs.meal;
}

/* ---------- raw panel ---------- */

function updateRawText() {
  rawFiltered = buildRawText();
  document.getElementById('raw-text').textContent =
    rawFiltered || 'No dishes available for the current selection.';
}

/* ---------- collapse animation (max-height) ---------- */

function expandBody(body) {
  body.style.maxHeight = body.scrollHeight + 'px';
  const onEnd = (e) => {
    if (e.propertyName === 'max-height') {
      body.style.maxHeight = 'none';
      body.removeEventListener('transitionend', onEnd);
    }
  };
  body._onExpandEnd = onEnd;
  body.addEventListener('transitionend', onEnd);
}

function collapseBody(body) {
  if (body._onExpandEnd) {
    body.removeEventListener('transitionend', body._onExpandEnd);
    body._onExpandEnd = null;
  }
  body.style.maxHeight = body.scrollHeight + 'px';
  void body.offsetHeight;
  body.style.maxHeight = '0px';
}

/* ------------------------------------------------------------
   10. Event handlers
   ------------------------------------------------------------ */

function bindEvents() {
  document.getElementById('menu-btn').addEventListener('click', toggleSelector);
  document.querySelector('.segmented').addEventListener('click', onSegmentedClick);

  const mensaList = document.querySelector('.selector-mensas');
  mensaList.addEventListener('click', onMensaListClick);
  mensaList.addEventListener('keydown', onMensaListKeydown);

  document.querySelector('.selector-groups').addEventListener('click', onGroupsClick);
  document.getElementById('group-add-btn').addEventListener('click', addCustomGroup);
  document.getElementById('group-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomGroup();
  });

  const content = document.getElementById('content');
  content.addEventListener('click', onContentClick);
  content.addEventListener('keydown', onContentKeydown);

  document.getElementById('raw-toggle').addEventListener('click', toggleRaw);
  document.getElementById('copy-btn').addEventListener('click', copyRaw);

  window.addEventListener('resize', positionThumb);
  window.addEventListener('load', positionThumb);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) {
      closeSelector();
    }
  });
}

function toggleSelector() {
  const open = document.body.classList.toggle('menu-open');
  setSelectorOpen(open);
}

function closeSelector() {
  document.body.classList.remove('menu-open');
  setSelectorOpen(false);
}

let unlockScrollTimer = null;

function setSelectorOpen(open) {
  const panel = document.getElementById('selector');
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
  const root = document.documentElement;
  if (open) {
    clearTimeout(unlockScrollTimer);
    root.classList.add('scroll-locked');
  } else {
    clearTimeout(unlockScrollTimer);
    unlockScrollTimer = setTimeout(() => root.classList.remove('scroll-locked'), 320);
  }
}

function onSegmentedClick(e) {
  const btn = e.target.closest('.seg-option');
  if (!btn || btn.dataset.meal === prefs.meal) return;
  prefs.meal = btn.dataset.meal;
  savePrefs();
  updateSegmented();
  renderContent();
  updateRawText();
}

function onMensaListClick(e) {
  const row = e.target.closest('.mensa-row');
  if (row) toggleMensa(row.dataset.mensa);
}

function onMensaListKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.mensa-row');
  if (!row) return;
  e.preventDefault();
  toggleMensa(row.dataset.mensa);
}

function toggleMensa(id) {
  if (prefs.selected.has(id)) prefs.selected.delete(id);
  else prefs.selected.add(id);
  savePrefs();
  refreshMensaRows();
  renderGroupList();
  renderContent();
  updateRawText();
}

function onGroupsClick(e) {
  const x = e.target.closest('.chip-x');
  if (x) {
    const chip = x.closest('.group-chip');
    if (chip) deleteCustomGroup(chip.dataset.group);
    return;
  }
  const chip = e.target.closest('.group-chip');
  if (chip) applyGroup(chip.dataset.group);
}

function applyGroup(name) {
  const members = groupMembers(name);
  if (!members.length) return;
  prefs.selected = new Set(members);
  savePrefs();
  refreshMensaRows();
  renderGroupList();
  renderContent();
  updateRawText();
}

function deleteCustomGroup(name) {
  delete prefs.customGroups[name];
  savePrefs();
  renderGroupList();
}

function addCustomGroup() {
  const input = document.getElementById('group-input');
  const name = input.value.trim();
  if (!name) {
    showGroupMsg('Enter a group name');
    return;
  }
  if (DEFAULT_GROUPS.includes(name)) {
    showGroupMsg('That name is reserved');
    return;
  }
  prefs.customGroups[name] = Array.from(prefs.selected);
  savePrefs();
  renderGroupList();
  input.value = '';
  showGroupMsg('');
}

let groupMsgTimer = null;
function showGroupMsg(text) {
  const msg = document.getElementById('group-add-msg');
  msg.textContent = text;
  clearTimeout(groupMsgTimer);
  if (text) groupMsgTimer = setTimeout(() => { msg.textContent = ''; }, 2000);
}

function onContentClick(e) {
  const title = e.target.closest('.mensa-title');
  if (title) toggleSection(title.closest('.mensa-section'));
}

function onContentKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const title = e.target.closest('.mensa-title');
  if (!title) return;
  e.preventDefault();
  toggleSection(title.closest('.mensa-section'));
}

function toggleSection(section) {
  const id = section.dataset.mensa;
  const collapsed = prefs.collapsedMensas.has(id);
  const body = section.querySelector('.mensa-dishes');
  const title = section.querySelector('.mensa-title');

  if (collapsed) {
    prefs.collapsedMensas.delete(id);
    section.classList.remove('collapsed');
    if (body) expandBody(body);
  } else {
    prefs.collapsedMensas.add(id);
    section.classList.add('collapsed');
    if (body) collapseBody(body);
  }
  if (title) title.setAttribute('aria-expanded', String(!collapsed));
  savePrefs();
}

function toggleRaw() {
  const panel = document.getElementById('raw-panel');
  const btn = document.getElementById('raw-toggle');
  const open = panel.classList.toggle('open');
  btn.textContent = open ? 'Hide Raw Data' : 'Show Raw Data';
  btn.setAttribute('aria-expanded', String(open));
}

function copyRaw() {
  const btn = document.getElementById('copy-btn');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(rawFiltered)
      .then(() => flashCopied(btn))
      .catch(() => fallbackCopy(btn));
  } else {
    fallbackCopy(btn);
  }
}

function fallbackCopy(btn) {
  const ta = document.createElement('textarea');
  ta.value = rawFiltered;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    flashCopied(btn);
  } catch (err) {
    /* ignore */
  }
  document.body.removeChild(ta);
}

function flashCopied(btn) {
  const orig = btn.textContent;
  btn.textContent = 'Copied';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, 1500);
}

/* ------------------------------------------------------------
   11. Boot
   ------------------------------------------------------------ */

async function init() {
  document.getElementById('date-heading').textContent = formatDate(DATE_STR);
  document.getElementById('hero-date').textContent = formatDate(DATE_STR);
  bindEvents();
  prefs = loadPrefs();
  initTheme();
  initProgress();
  initHeader();
  initPrefs();
  initHeroTitle();

  try {
    const json = await fetchData();
    data = { date: json.date, mensas: normalizeMensas(json.mensas) };
    validatePrefsAgainstData();
    renderAll();
    positionThumb();
  } catch (err) {
    console.error(err);
    document.getElementById('content').innerHTML =
      '<div class="error">Failed to load menu data. Please try again later.</div>';
  }
}

init();
