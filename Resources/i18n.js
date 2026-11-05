// UI strings engine. Every module registers its own strings:
//   I18N.register({ en: { 'settings.ai.title': 'AI' }, he: { 'settings.ai.title': 'בינה מלאכותית' } });
// t('key', { name: 'x' }) looks the key up in the current language, falls back to English, then to the key, and
// fills {name} placeholders. Static markup uses data-i18n (text), data-i18n-title and data-i18n-placeholder;
// I18N.apply(root) fills them. The page language follows the "uiLangResolved" setting sent by the app.
(function () {
  'use strict';
  const dicts = { en: {}, he: {} };
  let lang = 'en';

  function t(key, vars) {
    let s = (dicts[lang] && dicts[lang][key]) ?? dicts.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m));
    return s;
  }

  const I18N = {
    t,
    register(d) { for (const l of Object.keys(d)) dicts[l] = Object.assign(dicts[l] || {}, d[l]); },
    get lang() { return lang; },
    get dir() { return lang === 'he' ? 'rtl' : 'ltr'; },
    /** BCP 47 locale for Intl / toLocale*. */
    get locale() { return lang === 'he' ? 'he-IL' : 'en-US'; },
    /** Returns true when the language changed. */
    setLang(l) {
      const next = dicts[l] ? l : 'en';
      const changed = next !== lang;
      lang = next;
      document.documentElement.lang = lang;
      document.documentElement.dir = I18N.dir;
      I18N.apply(document);
      return changed;
    },
    apply(root) {
      root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
      root.querySelectorAll('[data-i18n-title]').forEach((e) => { e.title = t(e.dataset.i18nTitle); });
      root.querySelectorAll('[data-i18n-placeholder]').forEach((e) => { e.placeholder = t(e.dataset.i18nPlaceholder); });
    },
    /** For checks: keys present in English but missing in another language. */
    missing(l) { return Object.keys(dicts.en).filter((k) => !(dicts[l] || {})[k]); },
  };
  window.I18N = I18N;
  window.t = t;
})();
