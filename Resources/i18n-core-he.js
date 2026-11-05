// Hebrew strings for the core page. Same keys as i18n-core-en.js; missing keys fall back to English.
// Technical terms (JSON, JWT, Base64, Markdown, Unix, RTL) and shortcut glyphs stay as they are.
I18N.register({ he: {
  // header
  'header.paused': 'מושהה',
  'header.raw': 'גולמי', 'header.raw.title': 'גולמי / מעוצב (⌘R)',
  'header.copy': 'העתק', 'header.copy.title': 'העתק את הפריט המוצג חזרה ללוח',
  'header.copyRtl': 'העתק RTL', 'header.copyRtl.title': 'העתק כששורות בעברית עטופות ב-RLI…PDI, להדבקה ביישומים שאינם תומכים ב-RTL (⇧⌘C)',
  'header.hold': 'החזק', 'header.hold.title': 'החזק פריט זה: החלון יפסיק לעקוב אחרי הלוח (⌘L)',
  'header.history.title': 'היסטוריה (⌘Y)',
  'header.theme.title': 'מראה: לפי המערכת / בהיר / כהה',
  'header.settings.title': 'הגדרות (⌘,)',
  'header.chars': '{n} תווים',
  'header.historyPos': 'היסטוריה {i}/{n}',
  'title.live': 'לוח',
  'title.held': 'מוחזק',

  // content
  'empty.copy': 'העתק משהו…',
  'content.image': 'תמונה {size}',
  'content.imageHidden': 'תמונה {size} (מוסתרת בהגדרות)',
  'content.secret': 'מוסתר: היישום המעתיק סימן את התוכן כסיסמה/סוד.',
  'content.other': 'תוכן שאינו טקסט ({types})',
  'content.unknown': 'לא ידוע',
  'fmt.markdown': 'Markdown', 'fmt.rich': 'טקסט מעוצב', 'fmt.text': 'טקסט', 'fmt.json': 'JSON',
  'fmt.image': 'תמונה', 'fmt.secret': 'סוד', 'fmt.other': 'אחר',

  // history
  'history.search': 'חיפוש בהיסטוריה…',
  'history.pinned': 'מוצמדים', 'history.recent': 'אחרונים',
  'history.noMatches': 'אין תוצאות', 'history.empty': 'ריק',
  'history.hidden': 'מוסתר',

  // smart cards
  'smart.clickToCopy': 'לחץ להעתקה',
  'smart.jwt': 'JWT', 'smart.jwt.expired': 'פג תוקף {when}', 'smart.jwt.valid': 'בתוקף, יפוג {when}',
  'smart.jwt.header': 'כותרת', 'smart.jwt.payload': 'מטען', 'smart.jwt.unverified': 'החתימה לא אומתה.',
  'smart.link': 'קישור', 'smart.link.host': 'שרת', 'smart.link.path': 'נתיב', 'smart.link.hash': 'עוגן',
  'smart.link.query': 'פרמטרים', 'smart.link.open': 'פתח', 'smart.link.preview': 'טען תצוגה מקדימה',
  'smart.link.loading': 'טוען…', 'smart.link.previewFailed': 'התצוגה המקדימה נכשלה: {error}',
  'smart.color': 'צבע',
  'smart.time': 'תאריך ושעה', 'smart.time.unixS': 'Unix (שניות)', 'smart.time.unixMs': 'Unix (מילישניות)',
  'smart.json': 'JSON', 'smart.json.syntax': 'השתמש ב-.key, [0] או [] (למשל .items[].name)',
  'smart.json.filter': 'סינון: .key, [0], .items[].name', 'smart.json.copyMin': 'העתק מכווץ',
  'smart.json.copyResult': 'העתק תוצאה', 'smart.json.noMatch': 'אין התאמה',
  'smart.base64': 'Base64', 'smart.base64.decoded': 'מפוענח', 'smart.base64.copy': 'העתק מפוענח',

  // compare
  'compare.chip': 'השוואה', 'compare.close': 'סגור', 'compare.tooLarge': 'גדול מדי להשוואה.',
  'compare.identical': 'שני הפריטים זהים.', 'compare.button': 'השווה…',
  'compare.picking': 'בחר פריט בהיסטוריה…', 'compare.title': 'השווה לפריט אחר בהיסטוריה',

  // translation
  'tr.showOriginal': 'הצג מקור', 'tr.showTranslation': 'הצג תרגום', 'tr.onDevice': 'במכשיר',
  'tr.translating': 'מתרגם…', 'tr.toEnglish': 'תרגם לאנגלית', 'tr.toHebrew': 'תרגם לעברית',
  'tr.err.notInstalled': 'חבילת השפה לתרגום מ-{from} ל-{to} עדיין לא הורדה. הורד אותה פעם אחת בהגדרות המערכת › כללי › שפה ואזור › שפות תרגום; לאחר מכן התרגום יעבוד גם ללא חיבור לרשת.',
  'tr.openLanguages': 'פתח את שפות התרגום', 'tr.tryAgain': 'נסה שוב',
  'tr.err.unsupported': 'תרגום במכשיר דורש macOS 26 ואילך.',
  'tr.err.failed': 'התרגום נכשל: {error}',

  // context menu
  'menu.copySelection': 'העתק בחירה', 'menu.copySelectionRtl': 'העתק בחירה עם סימוני RTL',
  'menu.copy': 'העתק', 'menu.copyRtl': 'העתק עם סימוני RTL', 'menu.pin': 'הצמד', 'menu.unpin': 'בטל הצמדה',
  'menu.openInWindow': 'פתח בחלון חדש', 'menu.follow': 'עקוב אחרי הלוח', 'menu.hold': 'החזק פריט זה',
  'menu.show': 'הצג', 'menu.showRendered': 'הצג מעוצב', 'menu.showRaw': 'הצג טקסט גולמי',
  'menu.compareWithShown': 'השווה לפריט המוצג', 'menu.closeCompare': 'סגור השוואה', 'menu.delete': 'מחק',

  // toasts
  'toast.copied': 'הועתק', 'toast.copiedRtl': 'הועתק עם סימוני RTL',
  'toast.holding': 'הפריט מוחזק', 'toast.following': 'עוקב אחרי הלוח',
  'toast.appearance': 'מראה: {theme}',

  // settings shell
  'settings.title': 'הגדרות', 'settings.done': 'סיום', 'settings.done.title': 'סגור (Esc)',
  'settings.tab.general': 'כללי', 'settings.tab.content': 'תוכן', 'settings.tab.history': 'היסטוריה',
  'settings.tab.features': 'פיצ׳רים', 'settings.tab.ai': 'AI', 'settings.tab.about': 'אודות',

  // General tab
  'settings.general.language': 'שפה',
  'settings.general.uiLang': 'שפת הממשק', 'settings.general.uiLang.hint': '"לפי המערכת" עוקב אחרי שפת macOS.',
  'settings.general.uiLang.system': 'לפי המערכת',
  'settings.general.appearance': 'מראה',
  'settings.general.theme': 'ערכת נושא', 'settings.general.theme.system': 'לפי המערכת', 'settings.general.theme.light': 'בהיר', 'settings.general.theme.dark': 'כהה',
  'settings.general.font': 'גופן', 'settings.general.font.system': 'מערכת', 'settings.general.font.rounded': 'מעוגל',
  'settings.general.font.serif': 'סריף', 'settings.general.font.mono': 'רוחב קבוע',
  'settings.general.zoom': 'גודל טקסט',
  'settings.general.window': 'חלון',
  'settings.general.onTop': 'תמיד למעלה', 'settings.general.allSpaces': 'הצג בכל שולחנות העבודה',
  'settings.general.newMonitor': 'חלון ניטור חדש',
  'settings.general.newMonitor.hint': 'כל חלון או כרטיסייה עוקבים אחרי הלוח בנפרד; השתמש ב"החזק" כדי להשאיר אחד על פריט מסוים.',
  'settings.general.newWindow': 'חלון חדש ⌘N', 'settings.general.newTab': 'כרטיסייה חדשה ⌘T',
  'settings.general.startup': 'הפעלה וקיצור מקלדת',
  'settings.general.loginItem': 'פתח בעת התחברות',
  'settings.general.hotkey': 'קיצור להצגה / הסתרה', 'settings.general.hotkey.hint': 'פועל מכל יישום.', 'settings.general.hotkey.off': 'כבוי',

  // Content tab
  'settings.content.rendering': 'תצוגה',
  'settings.content.markdown': 'עצב Markdown', 'settings.content.rich': 'עצב טקסט מעוצב מדפי אינטרנט',
  'settings.content.highlight': 'הדגשת תחביר בקוד', 'settings.content.images': 'הצג תמונות שהועתקו',
  'settings.content.bidi': 'כיווניות (BiDi)',
  'settings.content.detect': 'זיהוי',
  'settings.content.detect.hint': 'רוב: שורה היא מימין לשמאל כשמספיק מהאותיות שלה בעברית. אות ראשונה: הכלל של הדפדפן עצמו (dir=auto).',
  'settings.content.detect.majority': 'רוב', 'settings.content.detect.first': 'אות ראשונה',
  'settings.content.ratio': 'שיעור עברית לימין-לשמאל', 'settings.content.ratio.value': '{pct}% מהאותיות',

  // History tab
  'settings.history.title': 'היסטוריה ופרטיות',
  'settings.history.keep': 'שמור היסטוריה לאחר יציאה',
  'settings.history.keep.hint': 'נשמר רק במק הזה. פריטים ממנהלי סיסמאות לעולם אינם מוצגים או נשמרים.',
  'settings.history.size': 'גודל ההיסטוריה',
  'settings.history.ignored': 'התעלם מהעתקות מיישומים אלה',
  'settings.history.ignored.hint': 'שמות יישומים או מזהי חבילה, מופרדים בפסיקים (למשל 1Password, Keychain Access).',
  'settings.history.clear': 'נקה היסטוריה בכל החלונות', 'settings.history.clear.button': 'נקה',
} });

// Check: every core key has a Hebrew string. Runs before the modules register theirs, so only core keys count.
(function () {
  const missing = I18N.missing('he');
  if (missing.length) console.error('[i18n] core keys missing in Hebrew:', missing);
})();
