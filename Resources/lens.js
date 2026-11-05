// Translation Lens page. The app (LensController.swift) reads the text under the lens, translates it and calls
//   lens.setup({lang, target, targets, auto})
//   lens.render({spans: [{x, y, w, h, line, text}], status, detail?})   boxes in CSS px, relative to #layer
//   lens.status({status, detail?})
//   lens.clear()
// The page posts {cmd: 'dragZones' | 'set' | 'refresh' | 'close' | 'openAXSettings'} back.
(function () {
  'use strict';

  I18N.register({
    en: {
      'lens.name': 'Lens',
      'lens.target.title': 'Translate into',
      'lens.target.auto': 'Hebrew ↔ English',
      'lens.auto': 'Auto',
      'lens.auto.title': 'Translate again when the content below changes',
      'lens.refresh.title': 'Read and translate again',
      'lens.peek.title': 'Hold to see the original',
      'lens.close.title': 'Close the lens',
      'lens.permission.open': 'Open Settings',
      'lens.status.permission': 'Allow Accessibility access to read the text below.',
      'lens.status.noWindow': 'No window below the lens.',
      'lens.status.ignored': 'This app is in your ignored list.',
      'lens.status.empty': 'No readable text here (images and video are not supported yet).',
      'lens.status.reading': 'Reading…',
      'lens.status.translating': 'Translating…',
      'lens.status.ok': '',
      'lens.status.error': 'Translation failed: {detail}',
      'lens.error.unsupported': 'this language pair is not available on this Mac',
      'lens.error.notInstalled': 'the language is not downloaded (System Settings › General › Language & Region › Translation Languages)',
    },
    he: {
      'lens.name': 'עדשה',
      'lens.target.title': 'תרגם ל־',
      'lens.target.auto': 'עברית ↔ אנגלית',
      'lens.auto': 'אוטומטי',
      'lens.auto.title': 'תרגם שוב כשהתוכן שמתחת משתנה',
      'lens.refresh.title': 'קרא ותרגם שוב',
      'lens.peek.title': 'החזק כדי לראות את המקור',
      'lens.close.title': 'סגור את העדשה',
      'lens.permission.open': 'פתח את ההגדרות',
      'lens.status.permission': 'אשר גישת נגישות כדי לקרוא את הטקסט שמתחת.',
      'lens.status.noWindow': 'אין חלון מתחת לעדשה.',
      'lens.status.ignored': 'היישום הזה ברשימת היישומים שמתעלמים מהם.',
      'lens.status.empty': 'אין כאן טקסט קריא (תמונות ווידאו עדיין לא נתמכים).',
      'lens.status.reading': 'קורא…',
      'lens.status.translating': 'מתרגם…',
      'lens.status.ok': '',
      'lens.status.error': 'התרגום נכשל: {detail}',
      'lens.error.unsupported': 'צמד השפות הזה לא זמין במק הזה',
      'lens.error.notInstalled': 'השפה לא הורדה (הגדרות המערכת › כללי › שפה ואזור › שפות תרגום)',
    },
  });

  const $ = (s) => document.querySelector(s);
  const native = (msg) => { try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { console.log('native', msg); } };
  const layer = $('#layer');
  let S = { target: '', targets: 'he,en', auto: true };

  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  function fillTargets() {
    const sel = $('#target');
    sel.textContent = '';
    const codes = String(S.targets || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (S.target && !codes.includes(S.target)) codes.push(S.target);
    const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
    add('', t('lens.target.auto'));
    codes.forEach((c) => add(c, langName(c)));
    sel.value = S.target || '';
  }

  function setStatus(status, detail) {
    const el = $('#status');
    let d = detail || '';
    if (d === 'unsupported' || d === 'notInstalled') d = t('lens.error.' + d);
    el.textContent = t('lens.status.' + (status || 'ok'), { detail: d });
    el.title = el.textContent;
    el.classList.toggle('error', status === 'error');
    $('#ax').hidden = status !== 'permission';
    if (status === 'permission' || status === 'noWindow' || status === 'ignored') layer.textContent = '';
    reportDragZones();
  }

  /** Largest font size (binary search) at which the text fits its box. */
  function fit(el, line, h) {
    let lo = 7, hi = line ? Math.max(8, Math.min(h * 0.8, 40)) : 18;
    const fits = () => el.scrollHeight <= el.clientHeight + 1 && (!line || el.scrollWidth <= el.clientWidth + 1);
    el.style.fontSize = hi + 'px';
    if (fits()) return;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = mid + 'px';
      if (fits()) lo = mid; else hi = mid;
    }
    el.style.fontSize = lo + 'px';
  }

  function draw(spans) {
    const frag = document.createDocumentFragment();
    const boxes = [];
    for (const s of spans || []) {
      const el = document.createElement('div');
      el.className = 't ' + (s.line ? 'line' : 'block');
      el.dir = 'auto';
      el.textContent = s.text;
      Object.assign(el.style, { left: s.x + 'px', top: s.y + 'px', width: Math.max(s.w, 12) + 'px', height: s.h + 'px' });
      if (s.line) el.style.lineHeight = s.h + 'px';
      frag.appendChild(el);
      boxes.push([el, s]);
    }
    layer.textContent = '';
    layer.appendChild(frag);
    boxes.forEach(([el, s]) => fit(el, s.line, s.h));
  }

  window.lens = {
    setup(s) {
      S = Object.assign(S, s || {});
      I18N.setLang(S.lang === 'he' ? 'he' : 'en');
      fillTargets();
      $('#auto').setAttribute('aria-pressed', String(!!S.auto));
      reportDragZones();
    },
    render(m) { draw(m.spans); setStatus(m.status, m.detail); },
    status(m) { setStatus(m.status, m.detail); },
    clear() { layer.textContent = ''; },
  };

  $('#target').onchange = (e) => { S.target = e.target.value; native({ cmd: 'set', key: 'lensTarget', value: S.target }); };
  $('#auto').onclick = () => { S.auto = !S.auto; $('#auto').setAttribute('aria-pressed', String(S.auto)); native({ cmd: 'set', key: 'lensAutoRefresh', value: S.auto }); };
  $('#refresh').onclick = () => native({ cmd: 'refresh' });
  $('#close').onclick = () => native({ cmd: 'close' });
  $('#ax').onclick = () => native({ cmd: 'openAXSettings' });
  const peek = $('#peek');
  peek.onmousedown = () => document.body.classList.add('peek');
  const unpeek = () => document.body.classList.remove('peek');
  peek.onmouseup = unpeek; peek.onmouseleave = unpeek;

  // The toolbar drags the panel except on its controls (DragWebView in main.swift).
  function reportDragZones() {
    const bar = $('#bar');
    const controls = [...bar.querySelectorAll('button, select')].filter((e) => e.offsetParent)
      .map((e) => { const r = e.getBoundingClientRect(); return [r.left - 2, r.top - 2, r.width + 4, r.height + 4]; });
    native({ cmd: 'dragZones', header: bar.getBoundingClientRect().bottom, controls });
  }
  new ResizeObserver(reportDragZones).observe($('#bar'));
  window.addEventListener('resize', reportDragZones);
  I18N.setLang('en');
  fillTargets();
  reportDragZones();
})();
