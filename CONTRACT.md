# Contract — eth-uzh-nutrition site

## data.json (backend produces, frontend consumes)
```json
{
  "date": "2026-08-07",
  "mensas": [
    {
      "id": "eth-9",
      "name": "ETH Mensa Polyterrasse",
      "group": "Central",
      "meals": {
        "Lunch":  [{"line": "STREET", "dish": "Lomo Saltado", "desc": "ingredients...", "nutrition": {"p100": {"kcal": 152.0, "protein": 5.3, "fat": 9.9, "saturated": 1.1, "carbs": 12.0, "sugar": 1.3, "salt": 0.53}, "total": {}}}],
        "Dinner": []
      }
    }
  ]
}
```
- nutrition keys (fixed set): kcal, protein, fat, saturated, carbs, sugar, salt, fiber, weight
- Values are NUMBERS (no units). kcal unit=kcal, all others = g. weight only in total.
- p100 = per-100g values; total = per-serving values. Empty object {} means no data.
- group values: Central, Medizin, Hoengg, Irchel, Oerlikon, City, Other
- meal slots: "Lunch" | "Dinner"

## index.txt (backend produces, AI raw text)
One line per dish: `NAME/SLOT: line — dish | desc | per100g: kcal=152.0, protein=5.3g, ... | total: ...`
- `line` is dropped when empty or identical to `dish`; `desc` is a pipe-separated ingredient list (always " | ").
- Names are title-cased when the source is ALL CAPS (UZH blobs, some ETH entries); UZH blobs are split at the first comma into `dish` (main dish) + `desc` (ingredients).

## DOM class contract (frontend generates, design styles)
```
.progress (fixed top scroll bar, primary-colored)
header.site-header#site-header (fixed 56px kami glass bar; ::before = backdrop-filter
  blur(20px) saturate(180%) + var(--bg-opacity); opacity = --header-opacity set on <html>
  by JS per kami formula: position>=50 ? 1 : floor(position/50*100)/100; .hide only on
  mobile (<=768px) past the first screen height)
  .header-inner
    span.header-date#date-heading
    .segmented (Lunch/Dinner switch, sliding .seg-thumb keyed off [data-meal])
      .seg-thumb + button.seg-option[data-meal=Lunch|Dinner]
    button.theme-toggle#theme-toggle
      .toggle > input.toggle-input + .toggle-indicator (koharu sun/moon morph)
section.intro (kami homepage pattern — OUTSIDE #content, sibling of main)
  .intro-badge (rounded teal tile + ::after glow copy: blur(10px) brightness(0.9) opacity(0.45))
  h1.intro-title#intro-title (JS wraps chars in span.char with --i; .entered kicks stagger)
  p.intro-sub#intro-date
main.main#content (aria-live; renderContent() replaces its innerHTML)
  section.mensa-section (collapsible: click .mensa-title toggles; .collapsed)
    h2.mensa-title (kami news-head capsule: data-emoji -> ::before icon slot,
      data-group-color -> semantic bg Central=purple Hoengg=blue Irchel=green
      Oerlikon=red Other=gray-1; .mensa-caret)
    .mensa-dishes
      .dish (kami flat card: light-bg + glass-border + 0.5rem radius; --i stagger index;
        .entered via IntersectionObserver + scroll fallback; animation settles VISIBLE;
        hover = shadow deepen + border primary)
        .dish-main (.dish-label, .dish-name, .dish-desc)
        .nutrition-col > table.nutrition-table (thead Nutrition|per 100g[|Total]; tbody 9 fixed rows;
          Total column rendered ONLY when at least one total value exists (aesthetic: no empty
          right half); first data row Energy rendered large in primary; Energy cell rolls via rAF)
.raw-section (#raw-toggle button, #raw-panel with #copy-btn, #raw-text)
footer.footer (kami glass: blur + --bg-opacity + radius; .footer-social circle = primary)
#selector (kami glass drawer; body.menu-open .app slides; .selector-columns > .selector-pane x2)
  .selector-mensas > .mensa-row (.mensa-check + .mensa-label, .selected)
  .selector-groups > .group-rows > button.group-chip (.chip-name/.chip-count/.chip-x,
    .active when selection matches the group) + .group-add
  .selector-prefs > label.pref (#motion-toggle)
button.menu-btn#menu-btn (body-level fixed, slides top-right when body.menu-open)
```
- PROGRESSIVE ENHANCEMENT: app.js adds html.js on boot; ALL content-hidden
  states (`.js .dish`, `.js .intro-title .char`) are gated behind html.js —
  no-JS visitors see fully static content
- Theme: html.dark class + data-theme attr; html.theme-transition during View-Transitions sweep
- Effects prefs: html.motion-off (stop entry/number/char motion — those also
  fall back under prefers-reduced-motion)
- Glass: --bg-opacity (0.72 alpha, @supports fallback to solid) + backdrop-filter;
  used by header + drawer + footer only (floating layers)
- Storage: every localStorage access goes through safeStorage (try/catch) —
  private mode can never break the init chain; init steps are independently try/catch'd
- Mensa row selected style: primary-filled check dot
- Responsive at 768px/992px/480px

## localStorage key: "eth-uzh-nutrition-prefs"
```json
{"meal":"Lunch","selected":["eth-9","uzh-obere-mensa",...],"customGroups":{"My Group":["eth-3",...]},"collapsedMensas":[]}
```
