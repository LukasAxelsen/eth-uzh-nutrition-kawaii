/* ============================================================
   Mensa Kawaii — frontend logic (vanilla JS)

   Extracted patterns:
   - kami: glass-header opacity formula (threshold 50, 0.01 steps),
     hide-on-mobile-past-first-screen, dark-mode detector (storage +
     media query + storage event), bottom-to-up entry (spring), number
     transition, TextUp char animation
   - koharu: View-Transitions theme sweep, sun/moon toggle sync,
     scroll progress, wave-off / motion-off preference classes

   Reliability contract (this rewrite fixes the previous version):
   1. PROGRESSIVE ENHANCEMENT — html.js is added on boot; every
      JS-gated hidden state in style.css lives under html.js. If this
      script fails or is disabled, all content stays visible.
   2. safeStorage — every localStorage access is wrapped; private
      mode / disabled storage can never break the init chain.
   3. Module isolation — each init() step is independently
      try/catch'd; one failure never blocks data rendering.
   4. Raw copy stays byte-identical with index.txt (backend contract).

   DOM contract: class names in CONTRACT.md are mandatory.
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   1. Boot guard: announce JS to the stylesheet FIRST.
   ------------------------------------------------------------ */
document.documentElement.classList.add('js');

/* ------------------------------------------------------------
   2. Constants & configuration
   ------------------------------------------------------------ */

// Replaced at deploy time (e.g. "2026-08-07"). Keep the token verbatim.
const DATE_STR = '2026-08-29';
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

/* ------------------------------------------------------------
   3. Safe storage (kami use-dark-mode-detector hardening)
   ------------------------------------------------------------ */

const safeStorage = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
};

/* ------------------------------------------------------------
   4. App state
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
   5. Persistence (localStorage)
   ------------------------------------------------------------ */

function loadPrefs() {
  const p = { meal: 'Lunch', selected: new Set(), customGroups: {}, collapsedMensas: new Set() };
  const raw = safeStorage.get(STORAGE_KEY);
  if (!raw) return p;
  try {
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
  safeStorage.set(STORAGE_KEY, JSON.stringify({
    meal: prefs.meal,
    selected: Array.from(prefs.selected),
    customGroups: prefs.customGroups,
    collapsedMensas: Array.from(prefs.collapsedMensas),
  }));
}

/* ------------------------------------------------------------
   6. Data loading & normalization
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
   7. Formatting helpers
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
   8. Theme — koharu sun/moon + View-Transitions sweep,
      kami dark-detector (storage + media query + storage event)
   ------------------------------------------------------------ */

function applyTheme(dark) {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  safeStorage.set('theme', dark ? 'dark' : 'light');
  const input = document.querySelector('#theme-toggle .toggle-input');
  if (input) input.checked = dark;
}

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  applyTheme(document.documentElement.classList.contains('dark')); // sync checkbox

  // koharu ThemeToggle: keep the checkbox in sync with outside changes
  // (e.g. another tab, storage events) via a MutationObserver.
  const observer = new MutationObserver(() => {
    const input = document.querySelector('#theme-toggle .toggle-input');
    if (input) input.checked = document.documentElement.classList.contains('dark');
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

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

  // kami: cross-tab theme sync via the storage event.
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme') applyTheme(e.newValue === 'dark');
  });
}

/* ------------------------------------------------------------
   9. Scroll behaviors — kami HeaderBase formulas
      opacity: position >= 50 ? 1 : floor((position/50)*100)/100
      hide: mobile && position > first-screen-height
   ------------------------------------------------------------ */

function initProgress() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  const update = () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(window.scrollY / max, 1) : 0) + ')';
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

function initHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;

  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  const onScroll = () => {
    const position = window.scrollY;

    // Kami useHeaderOpacity: threshold 50px, 0.01 steps, clamp at 1.
    const threshold = 50;
    const opacity = position >= threshold ? 1 : Math.floor((position / threshold) * 100) / 100;
    document.documentElement.style.setProperty('--header-opacity', String(opacity));

    // Kami HeaderBase: hide only on mobile past the first screen height.
    const overFirstScreen = position > window.innerHeight || position > window.screen.height;
    header.classList.toggle('hide', isMobile() && overFirstScreen);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ------------------------------------------------------------
   10. Entry animations — kami pattern, vanilla + progressive
   ------------------------------------------------------------ */

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.classList.contains('motion-off');

let dishObserver = null;
let scrollFallbackActive = false;

/** Mark a card as entered (visible state). */
function enterCard(card) {
  if (card.classList.contains('entered')) return;
  card.classList.add('entered');
  if (dishObserver) dishObserver.unobserve(card);
}

/**
 * Scroll fallback (belt & braces): on scroll we re-check any card still
 * waiting and enter it if it is inside the viewport. This guarantees
 * content can never stay hidden even if IntersectionObserver misses
 * callbacks in some environment. Removes itself once nothing is waiting.
 */
function scrollFallback(root) {
  if (scrollFallbackActive) return;
  scrollFallbackActive = true;
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const waiting = root.querySelectorAll('.dish:not(.entered)');
      if (!waiting.length) {
        window.removeEventListener('scroll', onScroll, { passive: true });
        scrollFallbackActive = false;
        return;
      }
      const vh = window.innerHeight;
      for (const card of waiting) {
        const r = card.getBoundingClientRect();
        if (r.top < vh - 40 && r.bottom > 0) enterCard(card);
      }
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** Kami BottomToUp entry: add .entered once a card enters the viewport. */
function observeDishEntries(root) {
  const cards = root.querySelectorAll('.dish:not(.entered)');
  if (!cards.length) return;

  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    cards.forEach(enterCard);
    return;
  }

  if (!dishObserver) {
    dishObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) enterCard(en.target);
      }
    }, { rootMargin: '0px 0px -48px 0px', threshold: 0.05 });
  }
  cards.forEach((c) => dishObserver.observe(c));
  scrollFallback(root);
}

/**
 * Kami NumberTransition (vanilla rAF): roll the Energy figure of each
 * dish from 0 to its target. Other cells render their final value
 * directly (focused motion, no flicker across the table).
 */
function animateEnergy(root) {
  if (prefersReducedMotion()) return;
  const cells = root.querySelectorAll('.nutrition-table tbody tr:first-child .n-val');
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

/** Kami TextUp: wrap each intro-title char in span.char with --i delay. */
function initIntroTitle() {
  const title = document.querySelector('.intro-title');
  if (!title || prefersReducedMotion()) return; // plain text stays visible
  const text = title.textContent;
  title.textContent = '';
  Array.from(text).forEach((ch, i) => {
    const span = document.createElement('span');
    span.className = 'char';
    span.style.setProperty('--i', String(i));
    span.textContent = ch;
    title.appendChild(span);
  });
  const kick = () => title.classList.add('entered');
  // Double rAF for settled layout; plus a setTimeout fallback so the
  // title can never stay hidden when rAF is paused (background tab).
  requestAnimationFrame(() => requestAnimationFrame(kick));
  setTimeout(kick, 1200);
}

/* ------------------------------------------------------------
   11. Effects preferences — koharu wave-off / motion-off
   ------------------------------------------------------------ */

function initPrefs() {
  const motion = safeStorage.get('site-motion') !== 'false';
  const root = document.documentElement;
  root.classList.toggle('motion-off', !motion);

  const m = document.getElementById('motion-toggle');
  if (m) {
    m.checked = motion;
    m.addEventListener('change', () => {
      root.classList.toggle('motion-off', !m.checked);
      safeStorage.set('site-motion', String(m.checked));
    });
  }
}

/* ------------------------------------------------------------
   12. Rendering
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
  if (container) container.innerHTML = data.mensas.map(mensaRowHTML).join('');
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
  // kami: highlight the group that exactly matches the current selection
  const active = g.members.length > 0 &&
    prefs.selected.size === g.members.length &&
    g.members.every((id) => prefs.selected.has(id));
  return '<button class="group-chip' + (g.custom ? ' custom' : '') + (active ? ' active' : '') + '" type="button"' +
    (count ? '' : ' disabled') +
    ' data-group="' + esc(g.name) + '" aria-label="Apply group ' + esc(g.name) + '"' +
    (active ? ' aria-pressed="true"' : '') +
    '>' +
    '<span class="chip-name">' + esc(g.name) + '</span>' +
    '<span class="chip-count">' + count + '</span>' +
    (g.custom
      ? '<span class="chip-x" role="button" tabindex="-1" aria-label="Delete group ' + esc(g.name) + '">&times;</span>'
      : '') +
    '</button>';
}

function renderGroupList() {
  const container = document.querySelector('.group-rows');
  if (!container) return;

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
  // kcal badge: per-100g energy when present (kami data-display style)
  const kcal = nutrition.p100 && nutrition.p100.kcal != null && nutrition.p100.kcal !== ''
    ? fmtNum(nutrition.p100.kcal) + ' kcal'
    : '';
  return '<div class="dish" style="--i:' + (i || 0) + '">' +
    '<div class="dish-head">' +
    '<div class="dish-main">' +
    (label ? '<div class="dish-label">' + esc(label) + '</div>' : '') +
    '<h3 class="dish-name">' + esc(dish) + '</h3>' +
    '</div>' +
    (kcal ? '<div class="dish-kcal" aria-label="Energy ' + esc(kcal) + '">' + esc(kcal) + '</div>' : '') +
    '</div>' +
    (d.desc ? '<p class="dish-desc">' + esc(d.desc) + '</p>' : '') +
    '<div class="nutrition-col">' + nutritionTableHTML(nutrition) + '</div>' +
    '</div>';
}

function nutritionTableHTML(nutrition) {
  const p100 = nutrition.p100 || {};
  const total = nutrition.total || {};

  // Aesthetic: when NO row has a total value, hide the Total column
  // entirely instead of showing an empty right half of the table.
  const hasTotal = NUTRI_KEYS.some((key) => total[key] != null && total[key] !== '');

  const rows = NUTRITION_ROWS.map((row) =>
    '<tr>' +
    '<td class="n-label">' + row.label + '</td>' +
    '<td class="n-val">' + fmtCell(p100[row.key], row.key) + '</td>' +
    (hasTotal ? '<td class="n-val">' + fmtCell(total[row.key], row.key) + '</td>' : '') +
    '</tr>'
  ).join('');

  return '<table class="nutrition-table">' +
    '<thead><tr><th>Nutrition</th><th>per 100g</th>' +
    (hasTotal ? '<th>Total</th>' : '') +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>';
}

function mensaSectionHTML(m, sectionIndex) {
  const dishes = m.meals[prefs.meal];
  const collapsed = prefs.collapsedMensas.has(m.id);
  const emoji = GROUP_EMOJI[m.group] || '✨';
  const base = Math.min((sectionIndex || 0) * 3, 9);
  const count = dishes.length;

  const bodyStyle = 'overflow:hidden;transition:max-height .35s ease' + (collapsed ? ';max-height:0' : '');
  const body = '<div class="mensa-dishes" style="' + bodyStyle + '">' +
    (dishes.length
      ? dishes.map((d, i) => dishHTML(d, base + i)).join('')
      : '<div class="no-meals">' + EMPTY_MEALS_TEXT + '</div>') +
    '</div>';

  return '<section class="mensa-section' + (collapsed ? ' collapsed' : '') + '" data-mensa="' + esc(m.id) + '">' +
    '<h2 class="mensa-title" role="button" tabindex="0" aria-expanded="' + !collapsed + '"' +
    ' data-emoji="' + esc(emoji) + '" data-group-color="' + esc(m.group || 'Other') + '">' +
    '<span class="mensa-caret" aria-hidden="true"></span>' +
    esc(m.name) +
    (count ? '<span class="mensa-count" aria-hidden="true">' + count + '</span>' : '') +
    '</h2>' + body +
    '</section>';
}

function renderContent() {
  const content = document.getElementById('content');
  const selected = data.mensas.filter((m) => prefs.selected.has(m.id));

  if (!selected.length) {
    // Friendly empty state with an escape hatch: weekend quiet days
    // should invite the user to browse all mensas, not look broken.
    content.innerHTML =
      '<div class="no-meals">' +
      '<span style="font-size:2.4rem" aria-hidden="true">🍃</span>' +
      '<p>' + EMPTY_MEALS_TEXT + '</p>' +
      '<button class="no-meals-btn" type="button" data-open-selector>Browse all mensas</button>' +
      '</div>';
    return;
  }
  content.innerHTML = selected.map(mensaSectionHTML).join('');
  observeDishEntries(content);
  animateEnergy(content);
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

/* ---------- raw panel ---------- */

function updateRawText() {
  rawFiltered = buildRawText();
  const el = document.getElementById('raw-text');
  if (el) el.textContent = rawFiltered || 'No dishes available for the current selection.';
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
   13. Event handlers
   ------------------------------------------------------------ */

function bindEvents() {
  document.getElementById('menu-btn')?.addEventListener('click', toggleSelector);
  document.querySelector('.segmented')?.addEventListener('click', onSegmentedClick);

  const mensaList = document.querySelector('.selector-mensas');
  mensaList?.addEventListener('click', onMensaListClick);
  mensaList?.addEventListener('keydown', onMensaListKeydown);

  document.querySelector('.selector-groups')?.addEventListener('click', onGroupsClick);
  document.getElementById('group-add-btn')?.addEventListener('click', addCustomGroup);
  document.getElementById('group-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomGroup();
  });

  const content = document.getElementById('content');
  content?.addEventListener('click', onContentClick);
  content?.addEventListener('keydown', onContentKeydown);

  document.getElementById('raw-toggle')?.addEventListener('click', toggleRaw);
  document.getElementById('copy-btn')?.addEventListener('click', copyRaw);

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

function openSelector() {
  document.body.classList.add('menu-open');
  setSelectorOpen(true);
}

function closeSelector() {
  document.body.classList.remove('menu-open');
  setSelectorOpen(false);
}

let unlockScrollTimer = null;

function setSelectorOpen(open) {
  const panel = document.getElementById('selector');
  if (!panel) return;
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', String(open));
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
  if (!input) return;
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
  if (!msg) return;
  msg.textContent = text;
  clearTimeout(groupMsgTimer);
  if (text) groupMsgTimer = setTimeout(() => { msg.textContent = ''; }, 2000);
}

function onContentClick(e) {
  if (e.target.closest('[data-open-selector]')) {
    openSelector();
    return;
  }
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
  if (!section) return;
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
  if (!panel || !btn) return;
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
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = 'Copied';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, 1500);
}

/* ------------------------------------------------------------
   14. Boot — each step isolated; one failure never blocks data
   ------------------------------------------------------------ */

function safeInit(fn) {
  try { fn(); } catch (err) { console.warn('init step failed:', err); }
}

async function init() {
  // Static chrome first (independent of data).
  safeInit(() => {
    document.getElementById('date-heading').textContent = formatDate(DATE_STR);
    document.getElementById('intro-date').textContent = formatDate(DATE_STR);
  });
  safeInit(bindEvents);
  safeInit(() => { prefs = loadPrefs(); });
  safeInit(initTheme);
  safeInit(initProgress);
  safeInit(initHeader);
  safeInit(initPrefs);
  safeInit(initIntroTitle);

  try {
    const json = await fetchData();
    data = { date: json.date, mensas: normalizeMensas(json.mensas) };
    validatePrefsAgainstData();
    renderAll();
  } catch (err) {
    console.error(err);
    const content = document.getElementById('content');
    if (content) {
      content.innerHTML = '<div class="error">Failed to load menu data. Please try again later.</div>';
    }
  }
}

init();
