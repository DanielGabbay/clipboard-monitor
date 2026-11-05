// Translate at Pointer card. The app (BubbleController.swift) calls
//   bubble.setup({lang, target, targets, margin})
//   bubble.show({status, source?, text?, detail?})
//     status: reading | translating | ok | same | error | noText | permission | ignored
// The page posts {cmd: 'size' | 'close' | 'copy' | 'open' | 'set' | 'openAXSettings'} back.
(function () {
  'use strict';

  I18N.register({
    en: {
      'bubble.name': 'Translation',
      'bubble.target.title': 'Translate into',
      'bubble.target.auto': 'Hebrew ↔ English',
      'bubble.copy.title': 'Copy the translation',
      'bubble.open.title': 'Open in Clipboard Monitor',
      'bubble.close.title': 'Close (Esc)',
      'bubble.source': 'Original',
      'bubble.permission.open': 'Open Settings',
      'bubble.status.reading': 'Reading…',
      'bubble.status.translating': 'Translating…',
      'bubble.status.same': 'Already in this language.',
      'bubble.status.error': 'Translation failed: {detail}',
      'bubble.status.noText': 'No text under the pointer. Point at a paragraph, or select text, and press the shortcut again.',
      'bubble.status.permission': 'Allow Accessibility access so the text under the pointer can be read.',
      'bubble.status.ignored': 'This app is in your ignored list.',
      'bubble.error.unsupported': 'this language pair is not available on this Mac',
      'bubble.error.notInstalled': 'the language is not downloaded (System Settings › General › Language & Region › Translation Languages)',
    },
    he: {
      'bubble.name': 'תרגום',
      'bubble.target.title': 'תרגם ל־',
      'bubble.target.auto': 'עברית ↔ אנגלית',
      'bubble.copy.title': 'העתק את התרגום',
      'bubble.open.title': 'פתח ב־Clipboard Monitor',
      'bubble.close.title': 'סגור (Esc)',
      'bubble.source': 'המקור',
      'bubble.permission.open': 'פתח את ההגדרות',
      'bubble.status.reading': 'קורא…',
      'bubble.status.translating': 'מתרגם…',
      'bubble.status.same': 'הטקסט כבר בשפה הזו.',
      'bubble.status.error': 'התרגום נכשל: {detail}',
      'bubble.status.noText': 'אין טקסט מתחת לסמן. הצבע על פסקה או סמן טקסט, ולחץ שוב על הקיצור.',
      'bubble.status.permission': 'אשר גישת נגישות כדי שאפשר יהיה לקרוא את הטקסט שמתחת לסמן.',
      'bubble.status.ignored': 'היישום הזה ברשימת היישומים שמתעלמים מהם.',
      'bubble.error.unsupported': 'צמד השפות הזה לא זמין במק הזה',
      'bubble.error.notInstalled': 'השפה לא הורדה (הגדרות המערכת › כללי › שפה ואזור › שפות תרגום)',
    },
  });

  const $ = (s) => document.querySelector(s);
  const native = (msg) => { try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { console.log('native', msg); } };
  let S = { target: '', targets: 'he,en' };
  let current = { text: '' };

  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  function fillTargets() {
    const sel = $('#target');
    sel.textContent = '';
    const codes = String(S.targets || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (S.target && !codes.includes(S.target)) codes.push(S.target);
    const add = (v, label) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); };
    add('', t('bubble.target.auto'));
    codes.forEach((c) => add(c, langName(c)));
    sel.value = S.target || '';
  }

  /** Paragraphs with `inline code` kept left to right; everything else is plain text. */
  function paragraphs(el, text) {
    el.textContent = '';
    String(text || '').split(/\n{2,}|\n(?=\s*[-*•\d])/).map((s) => s.trim()).filter(Boolean).forEach((para) => {
      const p = document.createElement('p');
      p.dir = 'auto';
      para.split(/(`[^`\n]+`)/).forEach((part) => {
        if (/^`[^`]+`$/.test(part)) { const c = document.createElement('code'); c.textContent = part.slice(1, -1); p.appendChild(c); }
        else if (part) p.appendChild(document.createTextNode(part));
      });
      el.appendChild(p);
    });
  }

  function reportSize() {
    const card = $('#card');
    native({ cmd: 'size', h: Math.ceil(card.scrollHeight + 2) });
  }

  window.bubble = {
    setup(s) {
      S = Object.assign(S, s || {});
      I18N.setLang(S.lang === 'he' ? 'he' : 'en');
      fillTargets();
    },
    show(m) {
      const status = m.status || 'ok';
      const hasText = (status === 'ok' || status === 'same') && m.text;
      current.text = hasText ? m.text : '';
      paragraphs($('#text'), current.text);
      $('#text').classList.toggle('same', status === 'same');
      const el = $('#status');
      let d = m.detail || '';
      if (d === 'unsupported' || d === 'notInstalled') d = t('bubble.error.' + d);
      el.textContent = status === 'ok' ? '' : t('bubble.status.' + status, { detail: d });
      el.classList.toggle('error', status === 'error');
      $('#ax').hidden = status !== 'permission';
      const src = $('#src');
      src.hidden = !m.source || status === 'same';
      if (m.source) $('#srctext').textContent = m.source;
      if (status === 'reading') src.open = false;
      $('#copy').disabled = !hasText;
      $('#open').disabled = !m.source;
      reportSize();
    },
  };

  $('#target').onchange = (e) => { S.target = e.target.value; native({ cmd: 'set', key: 'lensTarget', value: S.target }); };
  $('#copy').onclick = () => { if (current.text) native({ cmd: 'copy', text: current.text }); };
  $('#open').onclick = () => native({ cmd: 'open' });
  $('#close').onclick = () => native({ cmd: 'close' });
  $('#ax').onclick = () => native({ cmd: 'openAXSettings' });
  $('#src').addEventListener('toggle', reportSize);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') native({ cmd: 'close' }); });
  new ResizeObserver(reportSize).observe($('#card'));
  I18N.setLang('en');
  fillTargets();
})();
