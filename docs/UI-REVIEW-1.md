# UI review 1: fix list (P1 + P2)

From an independent Impeccable critique of the Settings / renderer UI (score 21/40). The P0 items (AI tab
switches, LTR JSON trees in cards, shortcut glyph order) are already fixed in 55f3390.

Decisions:
- **Hebrew voice:** masculine-singular imperative for buttons and menu commands ("העתק", "הוסף ספק", "בדוק",
  "ערוך", "מחק", "שמור", "בטל"). Hints and instructions use impersonal phrasing ("אפשר להוסיף…", "יש ל…").
  No plural imperative ("הוסיפו", "לחצו") and no verbal nouns as button labels ("הוספת ספק", "עריכה").
  Section titles and tab names stay nouns. Use a maqaf (U+05BE "־") after Hebrew prefix letters before Latin words:
  "ב־Keychain", "ה־API", "מה־Mac". "Tab" in Hebrew is "לשונית" (window tabs stay "כרטיסייה").
- **Translation settings move to their own Settings tab**, "Translation" / "תרגום", between Features and AI.

## Shared conventions (contract between the agents of this round)
- `app.css` provides one button system for the whole Settings panel and cards:
  `.btn` (bordered: `border-color: var(--line); background: var(--panel)`), `.btn.primary` (accent background,
  text `var(--on-accent)`), `.btn.danger` (text `var(--danger)`), `.btn.sm` (smaller). Plain `#settings button`
  that is not a tab or segmented button gets the `.btn` look by default too.
- Tokens: `--on-accent` (light `#fff`, dark `#0b1a33`), `--danger` (light `#d33`, dark `#ff6b6b`).
- `.ltr` class forces `direction: ltr; text-align: left` (for URLs, ids, app names, keys).
- Focus: global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`.
- Inline two-step confirm pattern: `.confirm` container with message + `.btn.danger` + `.btn` (no window.confirm).
- Monospace stack that renders Hebrew properly: `ui-monospace, "SF Mono", Menlo, "Arial Hebrew", monospace`.

## Fixes (numbers from the review)
4. **Clear history confirm** (settings.js): two-step inline confirm: "Clear history? Pinned items stay."
   Strings: en "Clear history in all windows (pinned items stay)", he "נקה את ההיסטוריה בכל החלונות (פריטים מוצמדים נשארים)".
5. **One switch, one button**: shared `.btn` system above; drop `.ai-btn` duplicates and `.row-btns button` rules;
   `#s-close` (Done) gets a visible bordered or primary style.
6. **Dark-mode contrast**: `--on-accent` for white-on-accent (`#settings .seg button.on`, `#ctx .mi:hover`,
   `.tr-menu .mi:hover`, primary buttons); `--danger` instead of hard-coded `#d33` everywhere.
7. **Narrow window**: `#history { width: min(210px, 40%) }`; at max-width 520px the header text buttons
   (Raw, Copy RTL, Hold) must not squeeze `#src` to nothing (icons or an overflow "…" menu); hide `#b-rtl`
   (`hidden`) when the item has no Hebrew; `updateHeader()` drops the time from `#src` under 520px.
8. **Hebrew in monospace**: use the shared mono stack in `.kv td`, `.jtree`, `.decoded`, `.raw`, `.ai-mid`, code;
   date values in the JWT/timestamp kv rows use the body font (`.kv td.date { font-family: inherit }`).
9. **Maqaf + LTR field placeholders**: maqaf rule above in all Hebrew strings; for `input[dir=ltr]` in an RTL UI
   show the placeholder RTL: `html[dir=rtl] input[dir=ltr]:placeholder-shown { direction: rtl; text-align: right; }`.
10. **AI tab density** (settings-ai.js `providerHTML`/`modelsHTML`): one status line (drop the duplicate header dot),
    hide the kind chip when the name equals the kind label, card actions = enabled switch + "Models ▾" + a "…"
    menu (Test, Edit, Delete); in the models panel put Show all / Hide all / Test all visible into one "Actions ▾"
    menu next to Refresh; when every model fails with the same error show it once per provider;
    rename showAll/hideAll → "Show all in pickers" / "Hide all from pickers" ("הצג הכול בבוחרי המודלים" /
    "הסתר הכול מבוחרי המודלים"). A disabled provider shows no red failure line.
11. **AI error recovery**: when `lastCheck.error` matches /401|403|key/i show an inline "Edit key" button and a
    human line before the raw error ("The API key was rejected." / "מפתח ה־API נדחה."); "Could not connect" on
    ollama/lmstudio adds "Is the local server running?" / "האם השרת המקומי פועל?". Delete prompt: "Delete {name}?"
    without the Keychain clause when `!hasKey`.
12. **Information architecture**: Translation block moves from Features to a new "Translation" tab
    (settings-translate.js/.css); remove the cross-tab notices `settings.translate.aiOff` / `settings.ai.disabled`
    links where they only point at another tab (keep one short notice in Translation when engine=AI and the AI
    feature is off); remove the redundant h3 "Features" at the top of the Features tab.
13. **Keyboard**: context menu and translate menu items `role="menuitem" tabindex="-1"`, focus first item,
    ArrowUp/Down/Enter/Escape; history rows `tabindex="0" role="option"`, `.acts` visible on `:focus-within`;
    Settings tablist ArrowLeft/Right (mirrored in RTL) with `aria-controls`; opening Settings focuses the active tab;
    remove `outline: none` from `#search` and `.jq`.
14. **Context menu**: the "Translate to …" entries become one "Translate ▸" submenu entry.
15. **JWT / Base64 card first**: when detectSmart returns JWT or Base64, render the card first and the raw text
    collapsed or as muted 13px mono below it.
16. `.kv td`: `word-break: break-all` → `overflow-wrap: anywhere`.
17. **About**: remove the Version and Build rows (the header line already has them).
18. **Dark switch track**: `#settings .switch { background: color-mix(in srgb, var(--fg) 22%, transparent) }`.
19. **Translation note**: `from → to` with language names (Intl.DisplayNames in I18N.locale), arrow "←" in RTL.
20. **Ignored apps textarea**: `class="ltr"`.

Minor (do if cheap): `.tr-menu` overflow at 9 items (max-height + scroll on the inline-end side); AI form
validation error next to the field with the field marked; history previews strip Markdown syntax (`#`, `**`);
smart cards and provider cards on the same surface (`--panel`); "0 of 2 models OK" toast lasts longer (or stays as
inline status).

## Copy changes
Hebrew (key: current → proposed):
- settings.ai.add: "הוספת ספק" → "הוסף ספק"; settings.ai.test: "בדיקה" → "בדוק"; settings.ai.edit: "עריכה" → "ערוך";
  settings.ai.form.cancel: "ביטול" → "בטל"; settings.ai.models.refresh: "רענון מודלים" → "רענן מודלים"
- settings.translate.model.choose: "בחירת מודל…" → "בחר מודל…"; settings.translate.model.openAi → "הוסף ספק בלשונית AI"
- settings.ai.empty: "…הוסיפו ספק כדי…" → "…אפשר להוסיף ספק כדי…"
- settings.ai.form.keyPlaceholder → "הדבק את מפתח ה־API"; settings.ai.form.keyKeep → "השאר ריק כדי לשמור את המפתח הקיים"
- settings.ai.models.none → "…לחץ „רענן מודלים” כדי לטעון אותם."; settings.ai.models.more → "עוד {n}. צמצם את החיפוש."
- settings.about.commit.copy: "לחיצה מעתיקה" → "לחץ להעתקה"
- settings.features.title: ASCII apostrophe → geresh "פיצ׳רים" (if the h3 survives at all)
- "טאב" → "לשונית" everywhere
- smart.jwt.header / smart.jwt.payload: "כותרת" / "מטען" → "Header" / "Payload"
- smart.link.host: "שרת" → "דומיין"
- settings.general.font.system: "מערכת" → "לפי המערכת"
- settings.general.newMonitor: "חלון ניטור חדש" → "חלון נוסף"
- settings.content.markdown: "עצב Markdown" → "הצג Markdown מעוצב"
- settings.content.rich: "עצב טקסט מעוצב מדפי אינטרנט" → "הצג עיצוב של טקסט מדפי אינטרנט"
- settings.content.ratio: "שיעור עברית לימין-לשמאל" → "סף עברית לכיוון ימין־לשמאל"
- settings.general.onTop: "תמיד למעלה" → "תמיד מעל חלונות אחרים"
- settings.translate.fallback: → "אם ה־AI נכשל, תרגם במכשיר"
English:
- settings.general.newMonitor: "New monitor" → "Another window"
- header.hold.title: → "Keep showing this item; stop following the clipboard (⌘L)"
- settings.ai.models.showAll / hideAll → "Show all in pickers" / "Hide all from pickers"
- settings.translate.fallback → "If the AI model fails, translate on-device"
- settings.history.clear → "Clear history in all windows (pinned items stay)"
- AI auth failures get the human line before the raw error (item 11).
