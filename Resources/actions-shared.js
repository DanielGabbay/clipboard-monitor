// Shared by the Text Actions popover (actions.js) and Settings › Text Actions (settings-actions.js): the names of
// the built-in actions and the icon set. Loaded after i18n.js.
//   ACTIONS.icons                 icon ids, in the order the icon picker shows them
//   ACTIONS.icon(id, size?)       an <svg> element
//   ACTIONS.title(a)              display name of {id, kind?, title? | name?, lang?, query?}
(function () {
  'use strict';

  I18N.register({
    en: {
      'actions.a.improve': 'Improve writing',
      'actions.a.fix': 'Fix spelling and grammar',
      'actions.a.simplify': 'Simplify language',
      'actions.a.paraphrase': 'Paraphrase',
      'actions.a.summarize': 'Summarize',
      'actions.a.explain': 'Explain',
      'actions.a.translate': 'Translate to {lang}',
      'actions.a.ask': 'Ask AI: {q}',
      'actions.a.untitled': 'Untitled action',
    },
    he: {
      'actions.a.improve': 'שפר ניסוח',
      'actions.a.fix': 'תקן כתיב ודקדוק',
      'actions.a.simplify': 'פשט את השפה',
      'actions.a.paraphrase': 'נסח מחדש',
      'actions.a.summarize': 'סכם',
      'actions.a.explain': 'הסבר',
      'actions.a.translate': 'תרגם ל{lang}',
      'actions.a.ask': 'שאל את ה־AI: {q}',
      'actions.a.untitled': 'פעולה ללא שם',
    },
  });

  const PATHS = {
    improve: 'M3 13l1-3 7-7 2 2-7 7-3 1z',
    fix: 'M3 8.5l3 3 7-7',
    simplify: 'M3 13l8-8M10 2v2M14 6h-2M13 3l-1 1',
    paraphrase: 'M3 6a5 5 0 0 1 9-1.5M13 3v2.5h-2.5M13 10a5 5 0 0 1-9 1.5M3 13v-2.5h2.5',
    summarize: 'M3 4h10M3 8h10M3 12h6',
    explain: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.5 6.3a1.6 1.6 0 1 1 2.3 1.5c-.5.3-.8.6-.8 1.2M8 11.2v.1',
    translate: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
    custom: 'M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z',
    chat: 'M3 3.5h10v7H7.5L4.5 13v-2.5H3z',
    mail: 'M2.5 4h11v8h-11zM2.5 4.5l5.5 4 5.5-4',
    doc: 'M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h4',
    idea: 'M6 11.5h4M6.5 13.5h3M5.5 9.5a4 4 0 1 1 5 0c-.4.4-.5.9-.5 2H6c0-1.1-.1-1.6-.5-2z',
    list: 'M6 4h7M6 8h7M6 12h7M3 4h.1M3 8h.1M3 12h.1',
    code: 'M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5',
    quote: 'M3 9V6.5A2.5 2.5 0 0 1 5.5 4M3 9h3v3H3zM9 9V6.5A2.5 2.5 0 0 1 11.5 4M9 9h3v3H9z',
    tag: 'M2.5 8.5v-6h6l5 5-6 6zM5.5 5.5h.1',
  };

  function icon(id, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const s = String(size || 15);
    svg.setAttribute('width', s); svg.setAttribute('height', s); svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', PATHS[id] || PATHS.custom); svg.appendChild(p);
    return svg;
  }

  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  function title(a) {
    const id = String(a.id || '');
    if (a.kind === 'ask' || id === 'ask') return t('actions.a.ask', { q: a.query || '' });
    if (a.kind === 'translate' || id.startsWith('translate:')) return t('actions.a.translate', { lang: langName(a.lang || id.slice(10)) });
    const own = a.title || a.name;
    if (own) return own;
    const key = 'actions.a.' + id;
    return t(key) === key ? t('actions.a.untitled') : t(key);
  }

  window.ACTIONS = { icons: Object.keys(PATHS), icon, title, langName };
})();
