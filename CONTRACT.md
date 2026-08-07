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
.progress (fixed top scroll bar, gradient)
header.site-header#site-header (fixed; ::before gradient reveal; .with-background when scrolled)
  .header-inner
    span.header-date#date-heading
    .segmented (Lunch/Dinner switch, sliding .seg-thumb keyed off [data-meal])
      .seg-thumb + button.seg-option[data-meal=Lunch|Dinner]
    button.theme-toggle#theme-toggle
      .toggle > input.toggle-input + .toggle-indicator (sun/moon morph)
section.hero (cover; #hero-date; .hero-float-1/2/3 decorative emoji)
  .wave-wrap > svg.wave > g.parallax > use x3 (koharu wave)
main#content
  section.mensa-section (collapsible: click .mensa-title toggles; .collapsed)
    h2.mensa-title (with .mensa-caret + group emoji span)
    .mensa-dishes
      .dish (card; ::before gradient bar)
        .dish-main (.dish-label, .dish-name, .dish-desc)
        .nutrition-col > table.nutrition-table (thead Nutrition|per 100g|Total; tbody 9 fixed rows)
.raw-section (#raw-toggle button, #raw-panel with #copy-btn, #raw-text)
footer.footer
#selector (drawer; body.menu-open .app slides; .selector-columns > .selector-pane x2)
  .selector-mensas > .mensa-row (.mensa-check + .mensa-label, .selected)
  .selector-groups > .group-rows > button.group-chip (.chip-name/.chip-count/.chip-x) + .group-add
  .selector-prefs > label.pref (#wave-toggle, #motion-toggle)
button.menu-btn#menu-btn (body-level fixed, slides top-right when body.menu-open)
```
- Theme: html.dark class + data-theme attr; html.theme-transition during View-Transitions sweep
- Effects prefs: html.wave-off (hide wave), html.motion-off (stop decorative animations)
- Mensa row selected style: gradient-filled check dot
- Dark mode via `.dark` class (tokens in style.css); responsive at 768px/992px/480px

## localStorage key: "eth-uzh-nutrition-prefs"
```json
{"meal":"Lunch","selected":["eth-9","uzh-obere-mensa",...],"customGroups":{"My Group":["eth-3",...]},"collapsedMensas":[]}
```
