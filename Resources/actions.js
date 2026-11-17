// Text Actions popover. The app (ActionsController.swift) calls
//   actions.setup({lang, margin})
//   actions.show({status, ...})
//     status: reading | list {source, actions, models, model, canReplace} | running {id, query}
//             | result {id, text, canReplace} | error {id, detail, code} | noText | secure | permission | ignored
//   actions.pick(n)        ⌘1…⌘9, sent by the panel (the main menu would take the key otherwise)
// The page posts {cmd: 'size' | 'close' | 'run' | 'back' | 'copy' | 'replace' | 'setModel' | 'openAXSettings'
// | 'openAISettings'} back.
(function () {
  'use strict';

  I18N.register({
    en: {
      'actions.name': 'Text Actions',
      'actions.search': 'Search actions or ask AI',
      'actions.key.run': 'Run',
      'actions.key.choose': 'Choose',
      'actions.key.close': 'Close',
      'actions.model.title': 'Model',
      'actions.model.setup': 'Set up AI',
      'actions.back.title': 'Back to the actions',
      'actions.close.title': 'Close (Esc)',
      'actions.replace': 'Replace',
      'actions.copy': 'Copy',
      'actions.none': 'No matching action.',
      'actions.a.improve': 'Improve writing',
      'actions.a.fix': 'Fix spelling and grammar',
      'actions.a.simplify': 'Simplify language',
      'actions.a.paraphrase': 'Paraphrase',
      'actions.a.summarize': 'Summarize',
      'actions.a.explain': 'Explain',
      'actions.a.translate': 'Translate to {lang}',
      'actions.a.ask': 'Ask AI: {q}',
      'actions.status.reading': 'Reading the selection…',
      'actions.status.running': 'Working…',
      'actions.status.error': 'That didn\'t work: {detail}',
      'actions.status.noModel': 'No AI model is set up yet. Translation still works without one.',
      'actions.status.noModel.open': 'Open AI settings',
      'actions.status.sameLanguage': 'The text is already in this language.',
      'actions.status.noText': 'No selected text. Select text in any app and try again.',
      'actions.status.secure': 'Text in a password field is never read.',
      'actions.status.permission': 'Allow Accessibility access so the selected text can be read.',
      'actions.status.permission.open': 'Open Settings',
      'actions.status.ignored': 'This app is in your ignored list.',
      'actions.error.unsupported': 'this language pair is not available on this Mac',
      'actions.error.notInstalled': 'the language is not downloaded (System Settings › General › Language & Region › Translation Languages)',
    },
    he: {
      'actions.name': 'פעולות על טקסט',
      'actions.search': 'חפש פעולה או שאל את ה־AI',
      'actions.key.run': 'הרץ',
      'actions.key.choose': 'בחר',
      'actions.key.close': 'סגור',
      'actions.model.title': 'מודל',
      'actions.model.setup': 'הגדר AI',
      'actions.back.title': 'חזור לפעולות',
      'actions.close.title': 'סגור (Esc)',
      'actions.replace': 'החלף',
      'actions.copy': 'העתק',
      'actions.none': 'אין פעולה מתאימה.',
      'actions.a.improve': 'שפר ניסוח',
      'actions.a.fix': 'תקן כתיב ודקדוק',
      'actions.a.simplify': 'פשט את השפה',
      'actions.a.paraphrase': 'נסח מחדש',
      'actions.a.summarize': 'סכם',
      'actions.a.explain': 'הסבר',
      'actions.a.translate': 'תרגם ל{lang}',
      'actions.a.ask': 'שאל את ה־AI: {q}',
      'actions.status.reading': 'קורא את הטקסט המסומן…',
      'actions.status.running': 'עובד…',
      'actions.status.error': 'הפעולה נכשלה: {detail}',
      'actions.status.noModel': 'עדיין לא הוגדר מודל AI. תרגום עובד גם בלי מודל.',
      'actions.status.noModel.open': 'פתח את הגדרות ה־AI',
      'actions.status.sameLanguage': 'הטקסט כבר בשפה הזו.',
      'actions.status.noText': 'אין טקסט מסומן. סמן טקסט ביישום כלשהו ונסה שוב.',
      'actions.status.secure': 'טקסט בשדה סיסמה לא נקרא אף פעם.',
      'actions.status.permission': 'אשר גישת נגישות כדי שאפשר יהיה לקרוא את הטקסט המסומן.',
      'actions.status.permission.open': 'פתח את ההגדרות',
      'actions.status.ignored': 'היישום הזה ברשימת היישומים שמתעלמים מהם.',
      'actions.error.unsupported': 'צמד השפות הזה לא זמין במק הזה',
      'actions.error.notInstalled': 'השפה לא הורדה (הגדרות המערכת › כללי › שפה ואזור › שפות תרגום)',
    },
  });

  const ICON = {
    improve: 'M3 13l1-3 7-7 2 2-7 7-3 1z',
    fix: 'M3 8.5l3 3 7-7',
    simplify: 'M3 13l8-8M10 2v2M14 6h-2M13 3l-1 1',
    paraphrase: 'M3 6a5 5 0 0 1 9-1.5M13 3v2.5h-2.5M13 10a5 5 0 0 1-9 1.5M3 13v-2.5h2.5',
    summarize: 'M3 4h10M3 8h10M3 12h6',
    explain: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM6.5 6.3a1.6 1.6 0 1 1 2.3 1.5c-.5.3-.8.6-.8 1.2M8 11.2v.1',
    translate: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12',
    custom: 'M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z',
  };

  const $ = (s) => document.querySelector(s);
  const native = (msg) => { try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { (window.__sent = window.__sent || []).push(msg); } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let all = [];           // actions from the app
  let shown = [];         // after the search filter (+ the "ask" row)
  let index = 0;
  let view = '';          // list | work
  let result = { text: '', replaces: false, canReplace: false };

  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  function title(a) {
    if (a.kind === 'custom') return a.title || '';
    if (a.kind === 'translate') return t('actions.a.translate', { lang: langName(a.lang) });
    if (a.kind === 'ask') return t('actions.a.ask', { q: a.query });
    return t('actions.a.' + a.id);
  }

  function icon(a) {
    const d = ICON[a.kind === 'builtin' ? a.id : (a.kind === 'translate' ? 'translate' : 'custom')] || ICON.custom;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '15'); svg.setAttribute('height', '15'); svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.appendChild(p);
    return svg;
  }

  function filter() {
    const q = $('#q').value.trim();
    const f = q.toLowerCase();
    shown = all.filter((a) => !f || title(a).toLowerCase().includes(f));
    if (q) shown.push({ id: 'ask', kind: 'ask', query: q, replaces: false });
    if (index >= shown.length) index = 0;
  }

  function renderList() {
    filter();
    const list = $('#list');
    list.textContent = '';
    if (!shown.length) list.appendChild(el('div', 'none', t('actions.none')));
    shown.forEach((a, i) => {
      const row = el('div', 'item' + (i === index ? ' on' : ''));
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === index ? 'true' : 'false');
      const label = el('span', 'label', title(a)); label.dir = 'auto';
      row.append(icon(a), label, el('span', 'key', i === index ? '↵' : (i < 9 ? '⌘' + (i + 1) : '')));
      row.onclick = () => run(a);
      list.appendChild(row);
    });
    const on = list.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
    reportSize();
  }

  function run(a) {
    if (!a) return;
    native({ cmd: 'run', id: a.id, query: a.kind === 'ask' ? a.query : '' });
  }

  function fillModels(models, current) {
    const sel = $('#model');
    sel.textContent = '';
    const groups = {};
    (models || []).forEach((m) => {
      let g = groups[m.group];
      if (!g) { g = groups[m.group] = document.createElement('optgroup'); g.label = m.group; sel.appendChild(g); }
      const o = el('option', '', m.label); o.value = m.value; g.appendChild(o);
    });
    sel.value = current || '';
    const any = (models || []).length > 0;
    sel.hidden = !any;
    $('#nomodel').hidden = any;
  }

  /** Paragraphs that keep their own line breaks and direction. */
  function paragraphs(node, text) {
    node.textContent = '';
    String(text || '').split(/\n{2,}/).map((s) => s.replace(/^\n+|\s+$/g, '')).filter(Boolean).forEach((para) => {
      const p = el('p', '', para); p.dir = 'auto'; node.appendChild(p);
    });
  }

  function reportSize() {
    native({ cmd: 'size', h: Math.ceil($('#card').scrollHeight + 2) });
  }

  function setView(v) {
    view = v;
    $('#v-list').hidden = v !== 'list';
    $('#v-work').hidden = v !== 'work';
  }

  /** Progress, the result or a message. opts: {title, text, status, error, link: {label, cmd}, back, foot}. */
  function work(opts) {
    setView('work');
    $('#title').textContent = opts.title || t('actions.name');
    $('#back').hidden = !opts.back;
    paragraphs($('#text'), opts.text || '');
    const st = $('#status');
    st.textContent = opts.status || '';
    st.classList.toggle('error', !!opts.error);
    const link = $('#link');
    link.hidden = !opts.link;
    if (opts.link) { link.textContent = opts.link.label; link.onclick = () => native({ cmd: opts.link.cmd }); }
    $('#result-foot').hidden = !opts.foot;
    reportSize();
  }

  function actionTitle(m) {
    if (m.id === 'ask') return t('actions.a.ask', { q: m.query || '' }).replace(/[:：]\s*$/, '');
    const a = all.find((x) => x.id === m.id);
    return a ? title(a) : t('actions.name');
  }

  let lastTitle = '';

  window.actions = {
    setup(s) {
      I18N.setLang(s && s.lang === 'he' ? 'he' : 'en');
    },
    show(m) {
      switch (m.status) {
        case 'list': {
          all = m.actions || [];
          result.canReplace = !!m.canReplace;
          $('#chip').textContent = '"' + String(m.source || '').replace(/\s+/g, ' ').slice(0, 200) + '"';
          fillModels(m.models, m.model);
          $('#q').value = ''; $('#q').removeAttribute('dir'); index = 0;
          setView('list');
          renderList();
          $('#q').focus();
          break;
        }
        case 'running':
          lastTitle = actionTitle(m);
          work({ title: lastTitle, status: t('actions.status.running'), back: true });
          break;
        case 'result': {
          const a = all.find((x) => x.id === m.id);
          result = { text: m.text || '', replaces: !!(a && a.replaces), canReplace: !!m.canReplace };
          work({ title: lastTitle || actionTitle(m), text: result.text, back: true, foot: true });
          const primary = result.replaces && result.canReplace ? 'replace' : 'copy';
          $('#replace').hidden = !result.canReplace;
          $('#replace').classList.toggle('primary', primary === 'replace');
          $('#copy').classList.toggle('primary', primary === 'copy');
          $('#primary-label').textContent = t('actions.' + primary);
          $('#' + primary).focus();
          reportSize();
          break;
        }
        case 'error': {
          let d = m.detail || '';
          if (m.code === 'noModel') {
            work({ title: lastTitle, status: t('actions.status.noModel'), back: true,
              link: { label: t('actions.status.noModel.open'), cmd: 'openAISettings' } });
          } else if (m.code === 'sameLanguage') {
            work({ title: lastTitle, status: t('actions.status.sameLanguage'), back: true });
          } else {
            if (d === 'unsupported' || d === 'notInstalled') d = t('actions.error.' + d);
            work({ title: lastTitle, status: t('actions.status.error', { detail: d }), error: true, back: true });
          }
          break;
        }
        case 'permission':
          work({ status: t('actions.status.permission'), link: { label: t('actions.status.permission.open'), cmd: 'openAXSettings' } });
          break;
        default:
          work({ status: t('actions.status.' + m.status) });
      }
    },
    pick(n) {
      if (view === 'list' && shown[n - 1]) run(shown[n - 1]);
    },
  };

  // An empty field follows the interface direction, so the placeholder reads correctly; typed text sets its own.
  const syncDir = () => { const q = $('#q'); if (q.value) q.dir = 'auto'; else q.removeAttribute('dir'); };
  $('#q').addEventListener('input', () => { syncDir(); index = 0; renderList(); });
  $('#model').onchange = (e) => native({ cmd: 'setModel', value: e.target.value });
  $('#nomodel').onclick = () => native({ cmd: 'openAISettings' });
  $('#back').onclick = () => native({ cmd: 'back' });
  $('#close').onclick = () => native({ cmd: 'close' });
  $('#replace').onclick = () => native({ cmd: 'replace', text: result.text });
  $('#copy').onclick = () => native({ cmd: 'copy', text: result.text });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { native({ cmd: 'close' }); return; }
    if (view === 'list') {
      const n = shown.length;
      if (e.key === 'ArrowDown' && n) { index = (index + 1) % n; renderList(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && n) { index = (index + n - 1) % n; renderList(); e.preventDefault(); }
      else if (e.key === 'Enter' && !e.isComposing) { run(shown[index]); e.preventDefault(); }
      else if (e.metaKey && /^Digit[1-9]$/.test(e.code)) { window.actions.pick(Number(e.code.slice(5))); e.preventDefault(); }
      return;
    }
    if (!$('#result-foot').hidden && e.key === 'Enter') {
      // ↵ runs the highlighted button; ⌘↵ always replaces when that is possible.
      if (e.metaKey && result.canReplace) { $('#replace').click(); e.preventDefault(); }
      else if (!(document.activeElement && document.activeElement.tagName === 'BUTTON')) {
        (result.replaces && result.canReplace ? $('#replace') : $('#copy')).click(); e.preventDefault();
      }
    }
  });
  new ResizeObserver(reportSize).observe($('#card'));
  I18N.setLang('en');
})();
