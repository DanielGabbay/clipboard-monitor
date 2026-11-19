// Text Actions & Quick Translate popover. The app (ActionsController.swift) calls
//   actions.setup({lang, margin, target?, targets?})
//   actions.show({status, ...})
//     status: reading | loading | list {source, actions, models, model, canReplace} | running {id, query}
//             | streaming {id, text} | result {id, text, canReplace}
//             | quickTranslate {state, source, text?, detail?, same?, target, targets, canReplace}
//             | error {id, detail, code} | noText | secure | permission | ignored
//   actions.generated({req, action?, error?, code?})
//   actions.pick(n)        ⌘1…⌘9, sent by the panel (the main menu would take the key otherwise)
// The page posts {cmd: 'size' | 'close' | 'run' | 'back' | 'copy' | 'replace' | 'setModel' | 'set'
// | 'open' | 'actions.generate' | 'saveCustomAction' | 'openInMonitor' | 'openAXSettings' | 'openAISettings'} back.
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
      'actions.sendTo': 'Send to…',
      'actions.diff': 'Diff',
      'actions.diff.title': 'Show changes compared to original',
      'actions.diff.empty': 'No changes compared to the original.',
      'actions.diff.tooLarge': 'Text is too long for word-level diff.',
      'actions.edit': 'Edit',
      'actions.edit.done': 'Preview',
      'actions.edit.title': 'Edit the result before copying or replacing',
      'actions.followup.ph': 'Follow up on this result…',
      'actions.followup.send': 'Send',
      'actions.saveAction': '＋ Save as permanent action',
      'actions.saveAction.saving': 'Saving…',
      'actions.saveAction.saved': '✓ Saved',
      'actions.a.create': '✨ Create action: {q}',
      'actions.status.creating': 'Creating action…',
      'actions.created': 'Saved action “{name}”.',
      'actions.created.run': 'Run on this text',
      'actions.none': 'No matching action.',
      'actions.status.reading': 'Reading the selection…',
      'actions.status.running': 'Working…',
      'actions.status.error': 'That didn\'t work: {detail}',
      'actions.status.noModel': 'No AI model is set up yet. Translation and local actions still work without one.',
      'actions.status.noModel.open': 'Open AI settings',
      'actions.status.sameLanguage': 'The text is already in this language.',
      'actions.status.noText': 'No selected text. Select text in any app and try again.',
      'actions.status.secure': 'Text in a password field is never read.',
      'actions.status.permission': 'Allow Accessibility access so the selected text can be read.',
      'actions.status.permission.open': 'Open Settings',
      'actions.status.ignored': 'This app is in your ignored list.',
      'actions.error.unsupported': 'this language pair is not available on this Mac',
      'actions.error.notInstalled': 'the language is not downloaded (System Settings › General › Language & Region › Translation Languages)',
      'actions.status.loading': 'Reading…',
      'actions.qt.title': 'Translation',
      'actions.qt.target.title': 'Translate into',
      'actions.qt.target.auto': 'Hebrew ↔ English',
      'actions.qt.open.title': 'Open in TextMonitor',
      'actions.qt.source': 'Original',
      'actions.qt.translating': 'Translating…',
      'actions.qt.same': 'Already in this language.',
      'actions.qt.error': 'Translation failed: {detail}',
      'actions.qt.noText': 'No text under the pointer. Point at a paragraph, or select text, and press the shortcut again.',
      'actions.qt.permission': 'Allow Accessibility access so the text under the pointer can be read.',
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
      'actions.sendTo': 'שלח אל…',
      'actions.diff': 'שינויים',
      'actions.diff.title': 'הצג שינויים לעומת המקור',
      'actions.diff.empty': 'אין שינויים לעומת המקור.',
      'actions.diff.tooLarge': 'הטקסט ארוך מדי להשוואת מילים.',
      'actions.edit': 'ערוך',
      'actions.edit.done': 'תצוגה',
      'actions.edit.title': 'ערוך את התוצאה לפני העתקה או החלפה',
      'actions.followup.ph': 'המשך לשאול על התוצאה הזו…',
      'actions.followup.send': 'שלח',
      'actions.saveAction': '＋ שמור כפעולה קבועה',
      'actions.saveAction.saving': 'שומר…',
      'actions.saveAction.saved': '✓ נשמר',
      'actions.a.create': '✨ צור פעולה: {q}',
      'actions.status.creating': 'יוצר פעולה…',
      'actions.created': 'הפעולה „{name}” נשמרה.',
      'actions.created.run': 'הרץ על הטקסט',
      'actions.none': 'אין פעולה מתאימה.',
      'actions.status.reading': 'קורא את הטקסט המסומן…',
      'actions.status.running': 'עובד…',
      'actions.status.error': 'הפעולה נכשלה: {detail}',
      'actions.status.noModel': 'עדיין לא הוגדר מודל AI. תרגום ופעולות מקומיות עובדים גם בלי מודל.',
      'actions.status.noModel.open': 'פתח את הגדרות ה־AI',
      'actions.status.sameLanguage': 'הטקסט כבר בשפה הזו.',
      'actions.status.noText': 'אין טקסט מסומן. סמן טקסט ביישום כלשהו ונסה שוב.',
      'actions.status.secure': 'טקסט בשדה סיסמה לא נקרא אף פעם.',
      'actions.status.permission': 'אשר גישת נגישות כדי שאפשר יהיה לקרוא את הטקסט המסומן.',
      'actions.status.permission.open': 'פתח את ההגדרות',
      'actions.status.ignored': 'היישום הזה ברשימת היישומים שמתעלמים מהם.',
      'actions.error.unsupported': 'צמד השפות הזה לא זמין במק הזה',
      'actions.error.notInstalled': 'השפה לא הורדה (הגדרות המערכת › כללי › שפה ואזור › שפות תרגום)',
      'actions.status.loading': 'קורא…',
      'actions.qt.title': 'תרגום',
      'actions.qt.target.title': 'תרגם ל־',
      'actions.qt.target.auto': 'עברית ↔ אנגלית',
      'actions.qt.open.title': 'פתח ב־TextMonitor',
      'actions.qt.source': 'המקור',
      'actions.qt.translating': 'מתרגם…',
      'actions.qt.same': 'הטקסט כבר בשפה הזו.',
      'actions.qt.error': 'התרגום נכשל: {detail}',
      'actions.qt.noText': 'אין טקסט מתחת לסמן. הצבע על פסקה או סמן טקסט, ולחץ שוב על הקיצור.',
      'actions.qt.permission': 'אשר גישת נגישות כדי שאפשר יהיה לקרוא את הטקסט שמתחת לסמן.',
    },
  });

  const $ = (s) => document.querySelector(s);
  const native = (msg) => { try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { (window.__sent = window.__sent || []).push(msg); } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const LOCAL_IDS = new Set(['flipKeyboard', 'wrapRtl', 'cleanSpaces']);
  const isLocalId = (id) => LOCAL_IDS.has(id);
  const isLocal = (a) => !!(a && (a.kind === 'local' || isLocalId(a.id)));
  const CREATE_RE = /^(?:(?:create|add|make|build|new)\s+(?:an?\s+)?(?:custom\s+)?action\b|(?:(?:צור|הוסף|בנה|שמור|הכן)\s+פעולה(?:\s+חדשה)?|פעולה\s+חדשה)(?=$|\s|[:：,.\-־]))/i;

  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  if (window.marked) {
    marked.use({ gfm: true, breaks: true, renderer: { html(token) { return escHtml(token.text || token.raw || ''); } } });
  }

  const BIDI = {
    blocks: ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'dd', 'dt', 'figcaption', '.line']
      .map((s) => '#text ' + s).join(', '),
    editors: '',
    detect: 'majority', ratio: 0.3, align: true,
    forceLtr: 'pre, kbd, samp', isolateInline: 'a, code, kbd, strong, em, b, i',
  };
  const detectDir = (s) => (window.__bidiFix ? window.__bidiFix.detectDir(s, BIDI) : null);

  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, link, meta, title, base, iframe, frame, object, embed, form, button, select, textarea, noscript, template, svg, math')
      .forEach((n) => n.remove());
    doc.querySelectorAll('input').forEach((n) => { if (n.type !== 'checkbox') n.remove(); });
    doc.body.querySelectorAll('*').forEach((node) => {
      for (const a of [...node.attributes]) {
        const n = a.name.toLowerCase();
        const keep = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled'].includes(n);
        const v = (n === 'href' || n === 'src') ? a.value.replace(/[\u0000-\u0020\u007f]+/g, '') : '';
        if (!keep || ((n === 'href' || n === 'src') && /^(javascript|vbscript|data:(?!image\/(?!svg\+xml)))/i.test(v))) {
          node.removeAttribute(a.name);
        }
      }
    });
    return doc.body.innerHTML;
  }

  function renderMarkdown(node, text) {
    node.className = 'text md';
    if (!text) { node.textContent = ''; return; }
    if (!window.marked) { paragraphs(node, text, true); return; }
    node.innerHTML = sanitizeHtml(marked.parse(String(text)));
    node.querySelectorAll('ul, ol').forEach((l) => l.setAttribute('dir', detectDir(l.innerText) || 'ltr'));
    node.querySelectorAll('table').forEach((tb) => tb.setAttribute('dir', detectDir(tb.innerText) || 'ltr'));
    node.querySelectorAll('input[type=checkbox]').forEach((c) => c.setAttribute('disabled', ''));
    if (window.__bidiFix) window.__bidiFix.install(BIDI);
  }

  function lcsDiff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: '=', v: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', v: a[i++] });
      else out.push({ t: '+', v: b[j++] });
    }
    while (i < n) out.push({ t: '-', v: a[i++] });
    while (j < m) out.push({ t: '+', v: b[j++] });
    return out;
  }
  const words = (s) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];

  function renderDiff(node, source, target) {
    const aText = String(source || '').replace(/\r\n?/g, '\n');
    const bText = String(target || '').replace(/\r\n?/g, '\n');
    if (aText === bText) {
      paragraphs(node, bText, false);
      return t('actions.diff.empty');
    }
    const A = aText.split('\n'), B = bText.split('\n');
    const ops = lcsDiff(A, B);
    if (!ops) {
      renderMarkdown(node, bText);
      return t('actions.diff.tooLarge');
    }
    node.className = 'text diff-view';
    node.textContent = '';
    const appendLine = () => { const p = el('p', 'line'); p.dir = 'auto'; node.appendChild(p); return p; };
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (o.t === '-' && ops[k + 1] && ops[k + 1].t === '+') {
        const dels = [], adds = [];
        while (ops[k] && ops[k].t === '-') dels.push(ops[k++].v);
        while (ops[k] && ops[k].t === '+') adds.push(ops[k++].v);
        k--;
        const n = Math.max(dels.length, adds.length);
        for (let x = 0; x < n; x++) {
          const p = appendLine();
          const d = dels[x], a = adds[x];
          if (d != null && a != null) {
            const wd = lcsDiff(words(d), words(a));
            if (wd) {
              for (const w of wd) {
                if (w.t === '=') p.appendChild(document.createTextNode(w.v));
                else p.appendChild(el('span', w.t === '+' ? 'wadd' : 'wdel', w.v));
              }
            } else {
              p.append(el('span', 'wdel', d), document.createTextNode(' '), el('span', 'wadd', a));
            }
          } else if (d != null) {
            p.appendChild(el('span', 'wdel', d));
          } else if (a != null) {
            p.appendChild(el('span', 'wadd', a));
          }
        }
      } else if (o.t === '=') {
        const p = appendLine();
        p.textContent = o.v;
      } else {
        const p = appendLine();
        p.appendChild(el('span', o.t === '+' ? 'wadd' : 'wdel', o.v));
      }
    }
    if (window.__bidiFix) window.__bidiFix.install(BIDI);
    return '';
  }

  let all = [];           // actions from the app
  let shown = [];         // after the search filter (+ the "ask" / "createAction" row)
  let index = 0;
  let view = '';          // list | work
  let result = { text: '', replaces: false, canReplace: false };
  let qt = { target: '', targets: 'he,en', source: '' };
  let currentSource = '';
  let hasModels = true;
  let currentActionId = '';
  let currentQuery = '';
  let currentUseMarkdown = false;
  let followupTurns = [];
  let pendingTurn = null;
  let diffMode = false;
  let editMode = false;
  let pendingGen = null;
  let genSeq = 0;
  let sendToApps = [];

  const title = (a) => (a && a.kind === 'createAction' ? t('actions.a.create', { q: a.query || '' }) : ACTIONS.title(a));
  const icon = (a) => ACTIONS.icon(a.icon || (a.kind === 'ask' || a.kind === 'createAction' ? 'custom' : a.id));

  function filter() {
    const q = $('#q').value.trim();
    const f = q.toLowerCase();
    shown = all.filter((a) => !f || title(a).toLowerCase().includes(f));
    if (q) {
      if (CREATE_RE.test(q)) {
        shown.unshift({ id: 'createAction', kind: 'createAction', icon: 'custom', query: q, replaces: false });
      }
      shown.push({ id: 'ask', kind: 'ask', query: q, replaces: false });
    }
    if (index >= shown.length) index = 0;
  }

  function renderList() {
    filter();
    const list = $('#list');
    list.textContent = '';
    if (!shown.length) list.appendChild(el('div', 'none', t('actions.none')));
    shown.forEach((a, i) => {
      const needAi = !hasModels && !isLocal(a) && a.kind !== 'translate';
      const row = el('div', 'item' + (i === index ? ' on' : '') + (needAi ? ' need-ai' : ''));
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
    if (a.kind === 'createAction') {
      const req = 'act-' + (++genSeq) + '-' + Date.now();
      pendingGen = { req, mode: 'create', request: a.query };
      lastTitle = t('actions.a.create', { q: a.query });
      work({ title: lastTitle, status: t('actions.status.creating'), back: true });
      native({ cmd: 'actions.generate', req, request: a.query });
      return;
    }
    currentActionId = a.id;
    currentQuery = a.kind === 'ask' ? a.query : '';
    followupTurns = [];
    pendingTurn = null;
    diffMode = false;
    editMode = false;
    native({ cmd: 'run', id: a.id, query: currentQuery });
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

  function fillTargets() {
    const sel = $('#target');
    if (!sel) return;
    sel.textContent = '';
    const codes = String(qt.targets || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (qt.target && !codes.includes(qt.target)) codes.push(qt.target);
    const add = (value, label) => { const o = el('option', '', label); o.value = value; sel.appendChild(o); };
    add('', t('actions.qt.target.auto'));
    codes.forEach((c) => add(c, ACTIONS.langName(c)));
    sel.value = qt.target || '';
  }

  /** Paragraphs that keep their own line breaks and direction, optionally isolating `inline code`. */
  function paragraphs(node, text, inlineCode) {
    node.className = 'text';
    node.textContent = '';
    const re = inlineCode ? /\n{2,}|\n(?=\s*[-*•\d])/ : /\n{2,}/;
    String(text || '').split(re).map((s) => s.replace(/^\n+|\s+$/g, '')).filter(Boolean).forEach((para) => {
      const p = el('p'); p.dir = 'auto';
      if (inlineCode) {
        for (const part of para.split(/(`[^`\n]+`)/)) {
          if (!part) continue;
          if (part.length >= 2 && part[0] === '`' && part[part.length - 1] === '`') {
            p.appendChild(el('code', '', part.slice(1, -1)));
          } else {
            p.appendChild(document.createTextNode(part));
          }
        }
      } else {
        p.textContent = para;
      }
      node.appendChild(p);
    });
    if (window.__bidiFix) window.__bidiFix.install(BIDI);
  }

  function renderResultBody() {
    const textEl = $('#text');
    const st = $('#status');
    textEl.hidden = editMode;
    $('#edit-wrap').hidden = !editMode;
    if (editMode) {
      st.textContent = '';
      st.classList.remove('error');
      const area = $('#edit-area');
      area.value = result.text;
      if (area.value) area.dir = 'auto'; else area.removeAttribute('dir');
    } else if (diffMode) {
      const msg = renderDiff(textEl, currentSource, result.text);
      st.textContent = msg;
      st.classList.remove('error');
    } else if (currentUseMarkdown) {
      st.textContent = '';
      st.classList.remove('error');
      renderMarkdown(textEl, result.text);
    } else {
      paragraphs(textEl, result.text, false);
    }
    syncModeButtons();
    reportSize();
  }

  function syncModeButtons() {
    const diffBtn = $('#diff');
    const editBtn = $('#edit');
    if (diffBtn) {
      diffBtn.classList.toggle('on', diffMode);
      diffBtn.setAttribute('aria-pressed', diffMode ? 'true' : 'false');
    }
    if (editBtn) {
      editBtn.classList.toggle('on', editMode);
      editBtn.setAttribute('aria-pressed', editMode ? 'true' : 'false');
      editBtn.textContent = t(editMode ? 'actions.edit.done' : 'actions.edit');
    }
  }

  function reportSize() {
    native({ cmd: 'size', h: Math.ceil($('#card').scrollHeight + 2) });
  }

  function setView(v) {
    view = v;
    $('#v-list').hidden = v !== 'list';
    $('#v-work').hidden = v !== 'work';
  }

  /** Progress, the result or a message. opts: {title, text, status, error, link: {label, cmd}, back, foot, inlineCode, markdown, diffBtn, editBtn, saveBar, followup, same, qt, source}. */
  function work(opts) {
    const isQt = !!opts.qt;
    setView('work');
    $('#title').textContent = opts.title || t('actions.name');
    $('#back').hidden = !opts.back;
    $('#target').hidden = !isQt;
    $('#open-monitor').hidden = !isQt;
    $('#open-monitor').disabled = !opts.source;
    const textEl = $('#text');
    textEl.hidden = false;
    $('#edit-wrap').hidden = true;
    if (opts.markdown) renderMarkdown(textEl, opts.text || '');
    else paragraphs(textEl, opts.text || '', !!opts.inlineCode);
    textEl.classList.toggle('same', !!opts.same);
    const st = $('#status');
    st.textContent = opts.status || '';
    st.classList.toggle('error', !!opts.error);
    const link = $('#link');
    link.hidden = !opts.link;
    if (opts.link) { link.textContent = opts.link.label; link.onclick = () => native({ cmd: opts.link.cmd }); }
    const srcEl = $('#src');
    const nextSource = opts.source || '';
    srcEl.hidden = !isQt || !nextSource || !!opts.same;
    if (nextSource !== qt.source) {
      srcEl.open = false;
      $('#srctext').textContent = nextSource;
      qt.source = nextSource;
    }
    $('#save-bar').hidden = !opts.saveBar;
    $('#followup-row').hidden = !opts.followup;
    $('#diff').hidden = !opts.diffBtn;
    $('#edit').hidden = !opts.editBtn;
    $('#result-foot').hidden = !opts.foot;
    const hasSendTo = !!opts.foot && sendToApps.length > 0;
    $('#sendto').hidden = !hasSendTo;
    $('#sendto').textContent = t('actions.sendTo');
    const sendMenu = $('#sendto-menu');
    if (sendMenu) sendMenu.hidden = true;
    syncModeButtons();
    reportSize();
  }

  function actionTitle(m) {
    if (m.id === 'ask') return t('actions.a.ask', { q: (m.query !== undefined ? m.query : currentQuery) || '' }).replace(/[:：]\s*$/, '');
    const a = all.find((x) => x.id === m.id);
    return a ? title(a) : t('actions.name');
  }

  let lastTitle = '';

  function applyPrimaryButton() {
    const primary = result.replaces && result.canReplace ? 'replace' : 'copy';
    $('#replace').hidden = !result.canReplace;
    $('#replace').classList.toggle('primary', primary === 'replace');
    $('#copy').classList.toggle('primary', primary === 'copy');
    $('#primary-label').textContent = t('actions.' + primary);
    return primary;
  }

  function sendFollowup() {
    const input = $('#followup-input');
    const q = input.value.trim();
    if (!q || !currentActionId) return;
    if (editMode) {
      result.text = $('#edit-area').value;
      editMode = false;
    }
    diffMode = false;
    pendingTurn = { assistant: result.text, user: q };
    const initialUserPrompt = currentQuery || currentSource || lastTitle || 'Action';
    const baseTurns = followupTurns.length > 0 ? followupTurns : [{ role: 'user', content: initialUserPrompt }];
    const msgs = baseTurns.concat([
      { role: 'assistant', content: pendingTurn.assistant },
      { role: 'user', content: pendingTurn.user },
    ]);
    input.value = '';
    input.removeAttribute('dir');
    native({ cmd: 'run', id: currentActionId, query: currentQuery, messages: msgs });
  }

  window.actions = {
    setup(s) {
      if (s) {
        if (s.target !== undefined) qt.target = s.target || '';
        if (s.targets !== undefined) qt.targets = s.targets || 'he,en';
        if (s.sendToApps !== undefined) sendToApps = Array.isArray(s.sendToApps) ? s.sendToApps : [];
      }
      I18N.setLang(s && s.lang === 'he' ? 'he' : 'en');
      fillTargets();
    },
    show(m) {
      const isQt = m.mode === 'quickTranslate';
      switch (m.status) {
        case 'list': {
          lastTitle = '';
          qt.source = '';
          currentActionId = '';
          currentQuery = '';
          currentUseMarkdown = false;
          followupTurns = [];
          pendingTurn = null;
          diffMode = false;
          editMode = false;
          pendingGen = null;
          $('#src').open = false;
          $('#src').hidden = true;
          $('#target').hidden = true;
          $('#open-monitor').hidden = true;
          $('#text').classList.remove('same');
          all = m.actions || [];
          currentSource = m.source || '';
          hasModels = (m.models || []).length > 0;
          result.canReplace = !!m.canReplace;
          $('#chip').textContent = currentSource.replace(/\s+/g, ' ').trim().slice(0, 300);
          fillModels(m.models, m.model);
          $('#q').value = ''; $('#q').removeAttribute('dir'); index = 0;
          setView('list');
          renderList();
          $('#q').focus();
          break;
        }
        case 'running':
          if (m.id) currentActionId = m.id;
          if (m.query !== undefined) currentQuery = m.query;
          lastTitle = actionTitle(m);
          diffMode = false;
          editMode = false;
          work({ title: lastTitle, status: t('actions.status.running'), back: true });
          break;
        case 'streaming': {
          if (view === 'list') return;
          if (m.id && currentActionId && m.id !== currentActionId) return;
          if (m.id) currentActionId = m.id;
          lastTitle = lastTitle || actionTitle(m);
          result.text = m.text || '';
          diffMode = false;
          editMode = false;
          const bodyEl = $('.body');
          const nearBottom = bodyEl ? (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 40) : true;
          work({
            title: lastTitle,
            text: result.text,
            markdown: true,
            status: t('actions.status.running'),
            back: true,
          });
          if (bodyEl && nearBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
          break;
        }
        case 'result': {
          if (m.query !== undefined) currentQuery = m.query;
          if (pendingTurn) {
            const initialUserPrompt = currentQuery || currentSource || lastTitle || 'Action';
            if (followupTurns.length === 0) {
              followupTurns.push({ role: 'user', content: initialUserPrompt });
            }
            followupTurns.push(
              { role: 'assistant', content: pendingTurn.assistant },
              { role: 'user', content: pendingTurn.user }
            );
            pendingTurn = null;
          }
          if (m.id) currentActionId = m.id;
          const a = all.find((x) => x.id === currentActionId);
          lastTitle = lastTitle || actionTitle(m);
          result = { text: m.text || '', replaces: !!(a && a.replaces), canReplace: !!m.canReplace };
          diffMode = false;
          editMode = false;
          currentUseMarkdown = !isQt && !!currentActionId && !currentActionId.startsWith('translate:') && !isLocalId(currentActionId);
          const canFollowup = !isQt && !!currentActionId && !currentActionId.startsWith('translate:') && !isLocalId(currentActionId);
          const showSave = currentActionId === 'ask' && !!currentQuery;
          const saveBtn = $('#save-action');
          if (saveBtn) {
            saveBtn.textContent = t('actions.saveAction');
            saveBtn.disabled = false;
          }
          work({
            title: lastTitle,
            text: result.text,
            markdown: currentUseMarkdown,
            diffBtn: !isQt && !!result.text,
            editBtn: !isQt && !!result.text,
            saveBar: showSave,
            followup: canFollowup,
            back: true,
            foot: true,
          });
          const primary = applyPrimaryButton();
          $('#' + primary).focus();
          reportSize();
          break;
        }
        case 'quickTranslate': {
          if (m.target !== undefined) qt.target = m.target || '';
          if (m.targets !== undefined) qt.targets = m.targets || 'he,en';
          if (m.target !== undefined || m.targets !== undefined) fillTargets();
          const st = m.state || (m.detail !== undefined ? 'error' : (m.same ? 'same' : (m.text ? 'ok' : 'translating')));
          const source = m.source || '';
          currentUseMarkdown = false;
          if (st === 'translating') {
            work({ qt: true, title: t('actions.qt.title'), source, status: t('actions.qt.translating'), back: !!source });
          } else if (st === 'error') {
            let d = m.detail || '';
            if (d === 'unsupported' || d === 'notInstalled') d = t('actions.error.' + d);
            work({ qt: true, title: t('actions.qt.title'), source, status: t('actions.qt.error', { detail: d }), error: true, back: !!source });
          } else {
            const isSame = st === 'same';
            const text = m.text || (isSame ? source : '') || '';
            result = { text, replaces: !isSame, canReplace: !isSame && !!m.canReplace };
            work({
              qt: true,
              title: t('actions.qt.title'),
              source,
              text,
              inlineCode: true,
              same: isSame,
              status: isSame ? t('actions.qt.same') : '',
              back: !!source,
              foot: !!text,
            });
            if (text) {
              const primary = applyPrimaryButton();
              if (document.activeElement !== $('#target')) $('#' + primary).focus();
              reportSize();
            }
          }
          break;
        }
        case 'error': {
          pendingTurn = null;
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
          work({
            qt: isQt,
            title: isQt ? t('actions.qt.title') : '',
            source: m.source || '',
            status: t(isQt ? 'actions.qt.permission' : 'actions.status.permission'),
            link: { label: t('actions.status.permission.open'), cmd: 'openAXSettings' },
          });
          break;
        case 'loading':
          work({
            qt: isQt,
            title: isQt ? t('actions.qt.title') : '',
            source: m.source || '',
            status: t('actions.status.loading'),
          });
          break;
        default: {
          let key = 'actions.status.' + m.status;
          if (isQt && m.status === 'noText') key = 'actions.qt.noText';
          else if (isQt && m.status === 'reading') key = 'actions.status.loading';
          work({
            qt: isQt,
            title: isQt ? t('actions.qt.title') : '',
            source: m.source || '',
            status: t(key),
          });
        }
      }
    },
    generated(res) {
      if (!res || !pendingGen || res.req !== pendingGen.req) return;
      const mode = pendingGen.mode;
      pendingGen = null;
      if (res.error || !res.action) {
        if (mode === 'save') {
          const btn = $('#save-action');
          btn.disabled = false;
          btn.textContent = t('actions.saveAction');
          const st = $('#status');
          st.textContent = res.code === 'noModel'
            ? t('actions.status.noModel')
            : t('actions.status.error', { detail: res.error || '' });
          st.classList.add('error');
          reportSize();
        } else {
          window.actions.show({ status: 'error', id: 'createAction', detail: res.error || '', code: res.code || '' });
        }
        return;
      }
      const created = Object.assign(
        { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind: 'custom' },
        res.action
      );
      created.title = created.name;
      native({ cmd: 'saveCustomAction', action: created });
      if (!all.some((x) => x.id === created.id)) all.push(created);
      if (mode === 'save') {
        const btn = $('#save-action');
        btn.textContent = t('actions.saveAction.saved');
        btn.disabled = true;
      } else {
        work({
          title: created.name,
          status: t('actions.created', { name: created.name }),
          back: true,
          link: { label: t('actions.created.run'), cmd: '' },
        });
        $('#link').onclick = () => run(created);
      }
    },
    pick(n) {
      if (view === 'list' && shown[n - 1]) run(shown[n - 1]);
    },
  };

  // An empty field follows the interface direction, so the placeholder reads correctly; typed text sets its own.
  const syncFieldDir = (f) => { if (f.value) f.dir = 'auto'; else f.removeAttribute('dir'); };
  $('#q').addEventListener('input', () => { syncFieldDir($('#q')); index = 0; renderList(); });
  $('#model').onchange = (e) => native({ cmd: 'setModel', value: e.target.value });
  $('#target').onchange = (e) => { qt.target = e.target.value; native({ cmd: 'set', key: 'lensTarget', value: qt.target }); };
  $('#open-monitor').onclick = () => native({ cmd: 'openInMonitor' });
  $('#src').addEventListener('toggle', reportSize);
  $('#nomodel').onclick = () => native({ cmd: 'openAISettings' });
  $('#back').onclick = () => {
    currentActionId = null;
    setView('list');
    native({ cmd: 'back' });
  };
  $('#close').onclick = () => native({ cmd: 'close' });
  $('#replace').onclick = () => native({ cmd: 'replace', text: result.text });
  $('#copy').onclick = () => native({ cmd: 'copy', text: result.text });

  $('#diff').onclick = () => {
    if (editMode) {
      result.text = $('#edit-area').value;
      editMode = false;
    }
    diffMode = !diffMode;
    renderResultBody();
  };
  $('#edit').onclick = () => {
    if (editMode) {
      result.text = $('#edit-area').value;
      editMode = false;
    } else {
      diffMode = false;
      editMode = true;
    }
    renderResultBody();
    if (editMode) $('#edit-area').focus();
  };
  $('#edit-area').addEventListener('input', () => {
    const area = $('#edit-area');
    syncFieldDir(area);
    result.text = area.value;
    reportSize();
  });
  $('#save-action').onclick = () => {
    if (!currentQuery || pendingGen) return;
    const req = 'act-' + (++genSeq) + '-' + Date.now();
    pendingGen = { req, mode: 'save', request: currentQuery };
    const btn = $('#save-action');
    btn.disabled = true;
    btn.textContent = t('actions.saveAction.saving');
    native({ cmd: 'actions.generate', req, request: currentQuery });
  };
  $('#followup-input').addEventListener('input', () => syncFieldDir($('#followup-input')));
  $('#followup-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendFollowup(); }
  });
  $('#followup-send').onclick = sendFollowup;
  function bindMenuKeys(menuEl, onClose) {
    const items = () => [...menuEl.querySelectorAll('[role="menuitem"]')].filter((el) => !el.disabled && !el.hidden && el.getAttribute('aria-disabled') !== 'true');
    const focusAt = (i) => {
      const list = items();
      if (!list.length) return;
      const el = list[((i % list.length) + list.length) % list.length];
      el.focus();
    };
    menuEl.onkeydown = (e) => {
      const list = items();
      const cur = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusAt(cur + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusAt(cur - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusAt(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusAt(list.length - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (document.activeElement && typeof document.activeElement.click === 'function') {
          document.activeElement.click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
      }
    };
  }

  $('#sendto').onclick = (e) => {
    e.stopPropagation();
    const m = $('#sendto-menu');
    if (!m) return;
    if (!m.hidden) { m.hidden = true; reportSize(); return; }
    m.innerHTML = '';
    m.setAttribute('role', 'menu');
    for (const app of sendToApps) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn sm send-item';
      btn.setAttribute('role', 'menuitem');
      btn.dataset.id = app.id;
      btn.dataset.app = app.id;
      btn.textContent = app.name;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        m.hidden = true;
        const text = editMode ? $('#edit-area').value : result.text;
        native({ cmd: 'sendTo', app: app.id, text });
      };
      m.appendChild(btn);
    }
    m.hidden = false;
    bindMenuKeys(m, () => {
      m.hidden = true;
      $('#sendto').focus();
      reportSize();
    });
    const first = m.querySelector('[role="menuitem"]');
    if (first) first.focus();
    reportSize();
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sendto') && !e.target.closest('#sendto-menu')) {
      const m = $('#sendto-menu');
      if (m && !m.hidden) { m.hidden = true; reportSize(); }
    }
  });
  $('#text').addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(a.href)) native({ cmd: 'open', url: a.href });
  });

  document.addEventListener('keydown', (e) => {
    const sendMenu = $('#sendto-menu');
    if (e.key === 'Escape' && sendMenu && !sendMenu.hidden) {
      sendMenu.hidden = true;
      $('#sendto').focus();
      reportSize();
      return;
    }
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
      else {
        const elActive = document.activeElement;
        if (elActive && (elActive.tagName === 'BUTTON' || elActive.tagName === 'SELECT' || elActive.tagName === 'SUMMARY' || elActive.tagName === 'TEXTAREA' || elActive.tagName === 'INPUT')) return;
        (result.replaces && result.canReplace ? $('#replace') : $('#copy')).click(); e.preventDefault();
      }
    }
  });
  new ResizeObserver(reportSize).observe($('#card'));
  I18N.setLang('en');
  fillTargets();
})();
