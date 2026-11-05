# Clipboard Monitor: ממשק בעברית, הגדרות בטאבים, ניהול AI, תרגום מבוסס LLM וגרסה

## Context
האפליקציה היום היא `Sources/main.swift` (מעטפת AppKit, 699 שורות) ו-`Resources/index.html` (renderer + הגדרות, 1145 שורות, הכול באנגלית, פאנל הגדרות אחד ארוך). התרגום עובד רק עם Apple Translation (macOS 26+) ורק עברית↔אנגלית.
המטרה:
1. ממשק בעברית (ובאנגלית), כולל RTL מלא של ה-chrome ותפריטי macOS.
2. הגדרות מחולקות לטאבים: כללי · תוכן · היסטוריה ופרטיות · פיצ'רים · AI · אודות.
3. ניהול פיצ'רים (כיבוי תרגום, AI, smart cards, השוואה, link preview, Copy RTL).
4. ניהול AI: ספקים, מודלים, OpenAI-compatible endpoints, הוספה/עריכה/כיבוי/מחיקה, בדיקת תקינות לספק ולמודל, הסתרת מודלים, עדכון מודלים אוטומטי. מפתחות ב-Keychain.
5. תרגום דרך ספק+מודל LLM, עם Apple כמנוע חלופי, עברית↔אנגלית אוטומטי + "תרגם ל…".
6. אזור גרסה: version + build/release, commit, תאריך build, "מה חדש".

החלטות שהתקבלו: Apple נשאר מנוע לבחירה (+fallback); שפות: אוטו he↔en + רשימת שפות יעד; חתימה עם self-signed identity קבועה; מודלים חדשים נכנסים מוסתרים עם תג "חדש".

## ארכיטקטורה (חוזים משותפים — נקבעים בשלב 0 וכל הסוכנים עובדים מולם)

### פיצול קבצים
- Swift: `Sources/main.swift` (נשאר: app, windows, poll, menu) + `Sources/Settings.swift`, `Sources/Localization.swift`, `Sources/Translation.swift` (Apple + router), `Sources/AI/*.swift` (חדש), `Sources/Version.swift`. `build.sh` מקמפל `Sources/**/*.swift` ומוסיף `-framework Security`.
- Web: `index.html` נשאר markup בלבד. CSS ל-`Resources/app.css`. JS: `Resources/i18n.js` (מנוע), `Resources/renderer.js` (כל הלוגיקה הקיימת), `Resources/settings.js` (shell הטאבים + טאבים פשוטים), ומודול לכל טאב גדול: `settings-features.js`, `settings-ai.js`, `settings-about.js`. כל מודול מביא CSS משלו (`settings-ai.css` וכו') ומחרוזות משלו.
- `dev/mock-bridge.js` (מחוץ ל-Resources, לא נארז): מדמה `window.webkit.messageHandlers.app` ותשובות native כדי לבדוק UI בדפדפן המובנה בלי build.

### i18n
- JS: `I18N.register({en:{...}, he:{...}})` — כל מודול רושם את המחרוזות שלו בקובץ שלו (מונע התנגשויות בין סוכנים). `t('key', {vars})`. ב-HTML: `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`. `I18N.apply(root)` מתרגם DOM. מפתחות בסגנון `settings.general.theme`.
- הגדרה `uiLang`: `system|he|en`. Swift מחשב `uiLangResolved` (system → `Locale.preferredLanguages`) ושולח לדף עם ה-settings. הדף שם `<html lang dir>`; ה-chrome (header, הגדרות, תפריט ימני, cards, action bar) עובר ל-`direction` לפי השפה ותכונות לוגיות (`margin-inline-*` במקום left/right); תוכן הלוח לא מושפע — BiDi per-block ממשיך כרגיל. `Intl`/`toLocale*` לפי השפה.
- Swift: `L("menu.file.newWindow")` מטבלאות he/en ב-`Localization.swift`; `buildMenu()` נבנה מחדש כשהשפה משתנה; גם NSAlert. `Info.plist`: `CFBundleLocalizations = [en, he]`.

### הגדרות חדשות (`Settings.defaults`)
`uiLang: "system"`, `features: {translate:true, ai:true, smartCards:true, smartJwt/Json/Color/Time/Base64/Link:true, compare:true, linkPreview:true, copyRtl:true}` (שטוח: `f.translate` וכו', כדי להתאים ל-guard הקיים ב-`setSetting`), `translateEngine: "apple"|"llm"`, `translateProvider`, `translateModel`, `translateFallbackApple: true`, `translateTargets: "he,en,ar,ru,fr,es,de"`, `modelRefreshHours: 24`.

### AI — מודל נתונים (ללא סודות), `Application Support/Clipboard Monitor/ai-providers.json` (0600)
```
Provider { id, name, kind: openai|anthropic|gemini|openrouter|ollama|lmstudio|custom,
           baseURL, enabled, autoRefresh, lastRefresh, hasKey (מחושב), keyHint ("…a1b2", מחושב),
           lastCheck {ok, ms, error, time},
           models: [{ id, label?, hidden, isNew, missing, lastCheck{ok, ms, error, time} }] }
```
- פרוטוקולים: OpenAI-compatible (`GET /models`, `POST /chat/completions`) לכל הסוגים חוץ מ-Anthropic (`GET /v1/models`, `POST /v1/messages`, `x-api-key` + `anthropic-version`). Gemini דרך `…/v1beta/openai/`. Presets ממלאים baseURL; ollama/lmstudio בלי מפתח.
- Keychain: `kSecClassGenericPassword`, service `dev.danielgabbay.clipboard-monitor.ai`, account = provider id. המפתח לא עובר לדף לעולם (הדף מקבל רק `hasKey`/`keyHint`), לא נכתב ל-UserDefaults/JSON/לוג. מחיקת ספק מוחקת את פריט ה-Keychain.
- עדכון אוטומטי: בהפעלה ואחת ל-`modelRefreshHours` לספקים עם `autoRefresh`; מודל חדש → `hidden:true,isNew:true`; מודל שנעלם → `missing:true` (לא נמחק).

### Bridge contract (page → native, `cmd`) ותשובות (native → `monitor.*`)
| cmd | body | תשובה |
|---|---|---|
| `ai.list` | — | `monitor.aiState({providers, presets})` |
| `ai.save` | `{provider, apiKey?}` (apiKey ריק = לא לשנות, `null` = למחוק) | `aiState` |
| `ai.delete` / `ai.toggle` | `{id}` / `{id, enabled}` | `aiState` |
| `ai.refreshModels` | `{id}` | `aiState` + `monitor.aiEvent({id, kind:'refresh', added, error})` |
| `ai.setModel` | `{id, modelId, hidden?, label?}` / `ai.setModels {id, hidden, all:true}` | `aiState` |
| `ai.checkProvider` / `ai.checkModel` | `{id}` / `{id, modelId}` | `aiState` + `aiEvent({kind:'check', ok, ms, error})` |
| `translate` (קיים, מורחב) | `{text, req, target?}` (target ריק = אוטו he↔en) | `monitor.translated({req, from, to, text|error, engine, model})` |

`aiState` נשלח לכל החלונות (כמו `broadcastSettings`). ב-`MonitorController.handle` שלב 0 מוסיף ניתוב: כל `ai.*` → `AIService.shared.handle(cmd, body, from:)`, ו-`translate` → `TranslationRouter.translate(...)`.

### תרגום
- `TranslationRouter`: לפי `translateEngine`; LLM → prompt מערכת: "translate to {lang}, keep Markdown structure, never translate code blocks/inline code/URLs, output only the translation"; שליחת כל הטקסט בבת אחת, timeout 60s; כשל + `translateFallbackApple` → Apple. Apple מורחב לכל target (זיהוי מקור עם `NLLanguageRecognizer`), שומר את הלוגיקה הקיימת שורה-שורה.
- UI: כפתור התרגום ב-action bar הופך ל-split: "תרגם" (אוטו) + "▾ תרגם ל…" עם `translateTargets`; תווית "he → en · Claude Sonnet / on-device"; גם בתפריט הימני. מטמון לפי item+target+engine/model.

### גרסה
- `VERSION` (קובץ יחיד, למשל `1.1.0`) הוא מקור האמת. `build.sh` כותב ל-Info.plist של ה-bundle: `CFBundleShortVersionString=$(cat VERSION)`, `CFBundleVersion=$(git rev-list --count HEAD)`, ומפתחות `CMGitCommit`, `CMBuildDate`, `CMDirty`.
- `CHANGELOG.md` (Keep a Changelog) נארז ל-Resources; טאב "אודות" מציג: גרסה, build, commit, תאריך build, גרסת macOS, "מה חדש" (הסקשן של הגרסה הנוכחית מרונדר עם marked), כפתור "העתק פרטי גרסה". גם About הסטנדרטי של macOS מקבל את הנתונים.
- `scripts/release.sh <version>`: מעדכן `VERSION`, מוסיף כותרת גרסה ב-CHANGELOG, commit + `git tag v<version>` (בלי push).
- חתימה: `build.sh` משתמש ב-`$CODESIGN_IDENTITY` או ב-identity בשם "Clipboard Monitor Dev" אם קיים ב-login keychain, אחרת ad-hoc + אזהרה. `scripts/make-signing-identity.sh` יוצר self-signed code-signing cert חד-פעמית (המשתמש מריץ ומאשר).

## תוכנית ביצוע בסוכנים

### שלב 0 — תשתית (סדרתי, אני או סוכן אחד, חייב להינחת ראשון) — commit על main
1. פיצול `main.swift` ו-`index.html` לקבצים לפי הפירוט למעלה, ללא שינוי התנהגות; `build.sh` ל-glob + Security.
2. מנוע i18n (`i18n.js`, `Localization.swift`) + המרת כל המחרוזות הקיימות למפתחות עם ערכי en בלבד.
3. shell טאבים ב-`settings.js` עם 6 טאבים; פאנלים ריקים `<div class="tab-panel" data-tab="features|ai|about">` שהמודולים ממלאים (`Settings.registerTab(id, mount)`); העברת הסקשנים הקיימים לטאבים כללי/תוכן/היסטוריה.
4. הגדרות חדשות ב-`Settings.defaults`, ניתוב `ai.*`/`translate` ל-stubs (`AIService`, `TranslationRouter`), `dev/mock-bridge.js`.
5. בדיקה: build עובר, האפליקציה מתנהגת כמו קודם, הטאבים עובדים.

### שלב 1 — 5 סוכנים במקביל (worktree לכל אחד, קבצים זרים לחלוטין)
| # | סוכן | קבצים בבעלותו בלבד | תוצר |
|---|---|---|---|
| A | AI backend (Swift) | `Sources/AI/*` (ProviderStore, Keychain, OpenAIClient, AnthropicClient, AIService, ModelRefresher), `Sources/Translation.swift` | כל ה-bridge של `ai.*`, Keychain, בדיקות תקינות, רענון אוטומטי, LLM translate + fallback + Apple לכל target |
| B | AI settings UI | `Resources/settings-ai.js`, `settings-ai.css` | טאב AI: רשימת ספקים, הוספה מ-preset/custom, עריכה, שדה מפתח (מוסתר, "שמור ב-Keychain"), כיבוי, מחיקה עם אישור, בדיקת ספק/מודל/הכול עם סטטוס וזמן, רשימת מודלים עם חיפוש, הסתרה/הצגה, תג "חדש", "הצג את כל החדשים", רענון ידני; מחרוזות he+en; נבדק מול mock-bridge |
| C | Features + תרגום UI | `Resources/settings-features.js` + css, `Resources/renderer.js` | טאב פיצ'רים (מתגים + הגדרות תרגום: מנוע, ספק/מודל מתוך `aiState` מודלים גלויים בלבד, fallback, שפות יעד); gating בכל ה-renderer לפי `f.*`; split button "תרגם ל…", תווית מנוע; מחרוזות he+en לחלקים שלו |
| D | עברית + RTL | `Resources/i18n-core-he.js` (או הסקשן he של הליבה), `Resources/app.css`, `index.html`, טבלת he ב-`Localization.swift` | תרגום כל מחרוזות הליבה והתפריטים, המרת CSS ל-logical properties ו-direction לפי שפה, בחירת שפה בטאב כללי, בניית תפריט מחדש בשינוי שפה |
| E | גרסה ושחרור | `build.sh`, `VERSION`, `CHANGELOG.md`, `scripts/*`, `Sources/Version.swift`, `Resources/settings-about.js` + css, `Info.plist` | הזרקת גרסה, טאב אודות, release script, חתימה קבועה, עדכון README |

כל סוכן מקבל: קישור לקובץ התוכנית הזה (החוזים), רשימת הקבצים שבבעלותו, איסור לגעת בקבצים אחרים (צורך בשינוי חוזה → מדווח במקום לשנות), ובדיקה מקומית (`./build.sh` ל-Swift; דפדפן מובנה + mock-bridge ל-UI). כל אחד עושה commit בענף שלו.

### שלב 2 — אינטגרציה (אני, סדרתי)
1. merge של 5 הענפים ל-main (צפוי בלי קונפליקטים בזכות בעלות על קבצים).
2. `./build.sh install`, בדיקה end-to-end (סעיף אימות).
3. `/code-review` על השינוי כולו (סוכן review נפרד, לא מעוגן בתוכנית), תיקונים.

## אימות
- `./build.sh` עובר בלי אזהרות חדשות; האפליקציה עולה עם היסטוריה קיימת שמורה.
- ממשק: מעבר System/עברית/English — header, טאבים, תפריט ימני, cards ותפריטי macOS מתהפכים ומתורגמים; תוכן הלוח בעברית/אנגלית עדיין מוצג נכון.
- AI: הוספת Ollama מקומי (אם מותקן) ו/או ספק עם מפתח אמיתי שהמשתמש מזין; רענון מודלים, בדיקת ספק ומודל (ירוק/אדום + ms), הסתרת מודלים, כיבוי/מחיקה. `security find-generic-password -s dev.danielgabbay.clipboard-monitor.ai` מוצא פריט; `grep` על `ai-providers.json` ו-`defaults read dev.danielgabbay.clipboard-monitor` לא מכילים את המפתח; מחיקת ספק מסירה את פריט ה-Keychain; build חוזר לא מקפיץ בקשת גישה (עם ה-identity הקבועה).
- רענון אוטומטי: שינוי `lastRefresh` לעבר → בהפעלה מודלים חדשים מופיעים מוסתרים עם "חדש".
- תרגום: LLM he→en, en→he, "תרגם ל… ערבית", Markdown ובלוקי קוד נשמרים; ניתוק רשת → fallback ל-Apple עם הודעה; מנוע Apple עדיין עובד.
- פיצ'רים: כיבוי כל מתג מעלים את ה-UI המתאים (כפתור תרגום, cards, Compare, preview, Copy RTL); כיבוי AI מבטל בחירת LLM בתרגום.
- אודות: גרסה מ-`VERSION`, build = מספר commits, commit hash ותאריך נכונים; `scripts/release.sh 1.1.0` יוצר tag מקומי.
