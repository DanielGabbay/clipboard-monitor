// Settings › Text Actions tab: how the popover opens (recorded shortcut, floating button, menu bar icon, Services
// menu), the model the actions use, and the user's own actions ("customActions": JSON [{id, name, prompt}]).
// update(S) runs on 'settings' and 'aiState' (see settings.js).
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.tab.actions': 'Text Actions',
      'settings.actions.off': 'Text Actions is turned off.',
      'settings.actions.turnOn': 'Turn on',
      'settings.actions.open': 'Opening the popover',
      'settings.actions.hotkey': 'Shortcut',
      'settings.actions.hotkey.hint': 'Select text in any app, then press it. Click to record a new one.',
      'settings.actions.hotkey.off': 'Off',
      'settings.actions.hotkey.recording': 'Press the shortcut…',
      'settings.actions.hotkey.needMod': 'Include ⌃, ⌥ or ⌘',
      'settings.actions.hotkey.clear': 'Turn the shortcut off',
      'settings.actions.hotkey.taken': 'That shortcut is already in use. The previous one was kept.',
      'settings.actions.button': 'Button next to the selection',
      'settings.actions.button.hint': 'A small button appears after you select text with the mouse. Needs Accessibility access; some apps do not report their selection.',
      'settings.actions.menuBar': 'Menu bar icon',
      'settings.actions.menuBar.hint': 'Click it to open the popover on the selected text. Right-click for a menu.',
      'settings.actions.services': 'Right-click menu',
      'settings.actions.services.hint': 'In most apps: right-click the selected text › Services › “TextMonitor: Text Actions”. If it is missing, turn it on under Keyboard Shortcuts › Services › Text.',
      'settings.actions.services.open': 'Keyboard settings',
      'settings.actions.model': 'Model',
      'settings.actions.model.hint': 'Used by every action except translation, which follows the Translation tab.',
      'settings.actions.model.auto': 'Automatic',
      'settings.actions.model.none': 'No AI model yet.',
      'settings.actions.model.openAi': 'Open the AI tab',
      'settings.actions.sec.options': 'Options',
      'settings.actions.sec.library': 'Actions',
      'settings.actions.sec.log': 'Log',
      'settings.actions.lib.hint': 'The actions the popover offers, in this order. Change a name, an icon or a prompt, add your own, or remove the ones you do not use. Translation actions come from the Translation tab.',
      'settings.actions.lib.name': 'Name',
      'settings.actions.lib.name.ph': 'Name, e.g. Make it formal',
      'settings.actions.lib.icon': 'Icon',
      'settings.actions.lib.prompt': 'Prompt',
      'settings.actions.lib.prompt.ph': 'Instruction, e.g. Rewrite the text in a formal tone',
      'settings.actions.lib.prompt.hint': 'Put {{ SELECTED TEXT }} where the selected text should go. Without it, the selected text is sent after the prompt. Click to insert:',
      'settings.actions.lib.replaces': 'Replace is the main button',
      'settings.actions.lib.replaces.hint': 'For actions that rewrite the text. Otherwise Copy is.',
      'settings.actions.lib.up': 'Move up',
      'settings.actions.lib.down': 'Move down',
      'settings.actions.lib.add': 'Add action',
      'settings.actions.lib.delete': 'Delete action',
      'settings.actions.lib.reset': 'Restore defaults',
      'settings.actions.lib.reset.confirm': 'Restore the default actions? Your own actions and changes are removed.',
      'settings.actions.lib.reset.yes': 'Restore',
      'settings.actions.lib.reset.no': 'Cancel',
      'settings.actions.log.keep': 'Keep a log of requests',
      'settings.actions.log.keep.hint': 'The selected text, the action, the model and the answer, saved only on this Mac.',
      'settings.actions.log.search': 'Search the log',
      'settings.actions.log.empty': 'No requests yet.',
      'settings.actions.log.none': 'Nothing matches.',
      'settings.actions.log.count': '{n} requests',
      'settings.actions.log.clear': 'Clear log',
      'settings.actions.log.clear.confirm': 'Delete the whole log?',
      'settings.actions.log.clear.yes': 'Delete',
      'settings.actions.log.source': 'Selected text',
      'settings.actions.log.result': 'Answer',
      'settings.actions.log.error': 'Error',
      'settings.actions.log.copy': 'Copy answer',
      'settings.actions.log.copied': 'Copied',
      'settings.actions.log.delete': 'Delete entry',
      'settings.actions.log.appleEngine': 'Translation',
    },
    he: {
      'settings.tab.actions': 'פעולות על טקסט',
      'settings.actions.off': 'פעולות על טקסט כבויות.',
      'settings.actions.turnOn': 'הפעל',
      'settings.actions.open': 'פתיחת החלונית',
      'settings.actions.hotkey': 'קיצור',
      'settings.actions.hotkey.hint': 'סמן טקסט בכל יישום ולחץ עליו. לחץ כאן כדי להקליט קיצור חדש.',
      'settings.actions.hotkey.off': 'כבוי',
      'settings.actions.hotkey.recording': 'לחץ על הקיצור…',
      'settings.actions.hotkey.needMod': 'הוסף ⌃, ⌥ או ⌘',
      'settings.actions.hotkey.clear': 'כבה את הקיצור',
      'settings.actions.hotkey.taken': 'הקיצור הזה כבר בשימוש. הקיצור הקודם נשאר.',
      'settings.actions.button': 'כפתור ליד הסימון',
      'settings.actions.button.hint': 'כפתור קטן מופיע אחרי סימון טקסט בעכבר. דורש גישת נגישות; יש יישומים שלא מדווחים על הסימון שלהם.',
      'settings.actions.menuBar': 'סמל בשורת התפריטים',
      'settings.actions.menuBar.hint': 'לחיצה פותחת את החלונית על הטקסט המסומן. לחיצה ימנית פותחת תפריט.',
      'settings.actions.services': 'תפריט הלחיצה הימנית',
      'settings.actions.services.hint': 'ברוב היישומים: לחיצה ימנית על הטקסט המסומן › שירותים › „TextMonitor: Text Actions”. אם הפריט חסר, הפעל אותו תחת קיצורי מקלדת › שירותים › מלל.',
      'settings.actions.services.open': 'הגדרות המקלדת',
      'settings.actions.model': 'מודל',
      'settings.actions.model.hint': 'משמש את כל הפעולות חוץ מתרגום, שפועל לפי הלשונית „תרגום”.',
      'settings.actions.model.auto': 'אוטומטי',
      'settings.actions.model.none': 'עדיין אין מודל AI.',
      'settings.actions.model.openAi': 'פתח את לשונית ה־AI',
      'settings.actions.sec.options': 'אפשרויות',
      'settings.actions.sec.library': 'פעולות',
      'settings.actions.sec.log': 'יומן',
      'settings.actions.lib.hint': 'הפעולות שהחלונית מציעה, בסדר הזה. שנה שם, סמל או פרומפט, הוסף פעולות משלך, או הסר פעולות שאינך משתמש בהן. פעולות התרגום מגיעות מהלשונית „תרגום”.',
      'settings.actions.lib.name': 'שם',
      'settings.actions.lib.name.ph': 'שם, למשל: נסח באופן רשמי',
      'settings.actions.lib.icon': 'סמל',
      'settings.actions.lib.prompt': 'פרומפט',
      'settings.actions.lib.prompt.ph': 'הוראה, למשל: נסח את הטקסט מחדש בטון רשמי',
      'settings.actions.lib.prompt.hint': 'כתוב {{ SELECTED TEXT }} במקום שבו הטקסט המסומן צריך להופיע. בלעדיו, הטקסט המסומן נשלח אחרי הפרומפט. לחץ כדי להוסיף:',
      'settings.actions.lib.replaces': '„החלף” הוא הכפתור הראשי',
      'settings.actions.lib.replaces.hint': 'לפעולות שמשכתבות את הטקסט. אחרת הכפתור הראשי הוא „העתק”.',
      'settings.actions.lib.up': 'הזז למעלה',
      'settings.actions.lib.down': 'הזז למטה',
      'settings.actions.lib.add': 'הוסף פעולה',
      'settings.actions.lib.delete': 'מחק את הפעולה',
      'settings.actions.lib.reset': 'שחזר ברירות מחדל',
      'settings.actions.lib.reset.confirm': 'לשחזר את פעולות ברירת המחדל? הפעולות והשינויים שלך יוסרו.',
      'settings.actions.lib.reset.yes': 'שחזר',
      'settings.actions.lib.reset.no': 'בטל',
      'settings.actions.log.keep': 'שמור יומן בקשות',
      'settings.actions.log.keep.hint': 'הטקסט המסומן, הפעולה, המודל והתשובה, נשמרים רק במק הזה.',
      'settings.actions.log.search': 'חפש ביומן',
      'settings.actions.log.empty': 'עדיין אין בקשות.',
      'settings.actions.log.none': 'אין תוצאות.',
      'settings.actions.log.count': '{n} בקשות',
      'settings.actions.log.clear': 'נקה יומן',
      'settings.actions.log.clear.confirm': 'למחוק את כל היומן?',
      'settings.actions.log.clear.yes': 'מחק',
      'settings.actions.log.source': 'הטקסט המסומן',
      'settings.actions.log.result': 'התשובה',
      'settings.actions.log.error': 'שגיאה',
      'settings.actions.log.copy': 'העתק תשובה',
      'settings.actions.log.copied': 'הועתק',
      'settings.actions.log.delete': 'מחק רשומה',
      'settings.actions.log.appleEngine': 'תרגום',
    },
  });

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  /** dir=auto on an empty field is left-to-right, which breaks a Hebrew placeholder: follow the text only once there is some. */
  const autoDir = (f) => { const sync = () => { if (f.value) f.dir = 'auto'; else f.removeAttribute('dir'); }; f.addEventListener('input', sync); sync(); };
  const labelled = (key) => { const s = el('span'); s.append(el('span', '', t(key)), el('small', '', t(key + '.hint'))); return s; };

  // ---- shortcut ------------------------------------------------------------------------------------------
  const KEY_RE = /^(Key[A-Z]|Digit\d|F([1-9]|1[0-2])|Space|Enter|Tab|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote|Arrow(Left|Right|Up|Down))$/;
  const KEY_LABEL = { Space: 'Space', Enter: '↩', Tab: '⇥', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';',
    Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  const MODS = [['ctrl', '⌃'], ['opt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];

  /** "ctrl+opt+KeyA" -> "⌃⌥A". */
  function hotkeyLabel(v) {
    const parts = String(v || '').split('+');
    const code = parts.pop();
    if (!parts.length || !KEY_RE.test(code)) return t('settings.actions.hotkey.off');
    const key = KEY_LABEL[code] || code.replace(/^(Key|Digit)/, '');
    return MODS.filter(([m]) => parts.includes(m)).map(([, s]) => s).join('') + key;
  }

  function recorder() {
    const wrap = el('span', 'hk');
    const btn = el('button', 'hk-rec'); btn.type = 'button';
    const clear = el('button', 'ghost hk-clear', '×'); clear.type = 'button'; clear.title = t('settings.actions.hotkey.clear');
    clear.setAttribute('aria-label', t('settings.actions.hotkey.clear'));
    let recording = false;
    // A key combination reads left to right; the prompts are sentences in the interface language.
    const show = (text, combo) => { btn.textContent = text; if (combo) btn.dir = 'ltr'; else btn.removeAttribute('dir'); };
    const showCurrent = () => {
      const label = hotkeyLabel(CM.S.actionsHotkey), off = label === t('settings.actions.hotkey.off');
      show(label, !off);
      clear.hidden = off;
    };
    // WebKit does not focus a button on click, so the keys are caught on the document while recording.
    function onKey(e) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      if (!KEY_RE.test(e.code)) return;
      if (!(e.ctrlKey || e.altKey || e.metaKey)) { show(t('settings.actions.hotkey.needMod'), false); return; }
      const mods = [e.ctrlKey && 'ctrl', e.altKey && 'opt', e.shiftKey && 'shift', e.metaKey && 'cmd'].filter(Boolean);
      stop();
      CM.setSetting('actionsHotkey', mods.concat(e.code).join('+'));
    }
    function onClickAway(e) { if (!wrap.contains(e.target)) stop(); }
    function stop() {
      if (!recording) return;
      recording = false; btn.classList.remove('on');
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onClickAway, true);
      showCurrent();
    }
    btn.onclick = () => {
      if (recording) { stop(); return; }
      recording = true; btn.classList.add('on');
      show(t('settings.actions.hotkey.recording'), false);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onClickAway, true);
    };
    clear.onclick = () => { stop(); CM.setSetting('actionsHotkey', 'off'); };
    wrap.append(btn, clear);
    wrap.refresh = () => { if (!recording) showCurrent(); };
    return wrap;
  }

  // The app refuses a shortcut that is already taken and keeps the previous one (main.swift, setSetting).
  if (window.monitor) window.monitor.hotkeyRejected = () => CM.toast(t('settings.actions.hotkey.taken'));

  // ---- library ------------------------------------------------------------------------------------------
  const PLACEHOLDERS = ['SELECTED TEXT', 'CLIPBOARD', 'LANGUAGE', 'APP', 'DATE', 'TIME'];
  let lib = [];             // [{id, name, icon, prompt, replaces, builtin}]
  let savedJson = null;     // the "actionsList" value this tab last wrote or showed
  let openId = null;        // the action whose editor is open

  const libJson = () => JSON.stringify(lib.map((a) => ({ id: a.id, name: a.name || '', icon: a.icon, prompt: a.prompt || '', replaces: !!a.replaces })));
  // CM.S.actionsLibrary is kept in step, so the echo of this change from the app does not re-render the editor.
  function saveLib() { savedJson = libJson(); CM.S.actionsLibrary = lib.map((a) => Object.assign({}, a)); CM.setSetting('actionsList', savedJson); }

  function editor(a, list, onName) {
    const box = el('div', 'lib-edit');
    const field = (key) => { const f = el('label', 'lib-field'); f.appendChild(el('span', 'lib-label', t(key))); return f; };

    const nameF = field('settings.actions.lib.name');
    const name = el('input'); name.type = 'text'; name.value = a.name || '';
    name.placeholder = a.builtin ? ACTIONS.title({ id: a.id }) : t('settings.actions.lib.name.ph'); autoDir(name);
    name.onchange = () => { a.name = name.value.trim(); saveLib(); onName(); };
    nameF.appendChild(name);

    const iconF = el('div', 'lib-field'); iconF.appendChild(el('span', 'lib-label', t('settings.actions.lib.icon')));
    const grid = el('div', 'lib-icons'); grid.setAttribute('role', 'radiogroup');
    for (const id of ACTIONS.icons) {
      const b = el('button', 'ghost lib-icon' + (a.icon === id ? ' on' : '')); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', a.icon === id ? 'true' : 'false'); b.setAttribute('aria-label', id);
      b.appendChild(ACTIONS.icon(id, 16));
      b.onclick = () => { a.icon = id; saveLib(); renderLib(list); };
      grid.appendChild(b);
    }
    iconF.appendChild(grid);

    const promptF = field('settings.actions.lib.prompt');
    const prompt = el('textarea'); prompt.value = a.prompt || ''; prompt.placeholder = t('settings.actions.lib.prompt.ph'); autoDir(prompt);
    prompt.onchange = () => { a.prompt = prompt.value; saveLib(); };
    promptF.appendChild(prompt);
    const hint = el('div', 'lib-hint'); hint.appendChild(el('small', '', t('settings.actions.lib.prompt.hint')));
    const chips = el('span', 'lib-chips'); chips.dir = 'ltr';
    for (const p of PLACEHOLDERS) {
      const c = el('button', 'ghost lib-chip', '{{ ' + p + ' }}'); c.type = 'button';
      c.onclick = () => {
        const at = prompt.selectionStart ?? prompt.value.length, to = prompt.selectionEnd ?? at, ins = '{{ ' + p + ' }}';
        prompt.value = prompt.value.slice(0, at) + ins + prompt.value.slice(to);
        prompt.dispatchEvent(new Event('input')); prompt.focus(); prompt.setSelectionRange(at + ins.length, at + ins.length);
        a.prompt = prompt.value; saveLib();
      };
      chips.appendChild(c);
    }
    hint.appendChild(chips);

    const rep = el('div', 'row lib-rep');
    const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.checked = !!a.replaces;
    sw.onchange = () => { a.replaces = sw.checked; saveLib(); };
    rep.append(labelled('settings.actions.lib.replaces'), sw);

    const del = el('button', 'btn danger sm', t('settings.actions.lib.delete')); del.type = 'button';
    del.onclick = () => { lib = lib.filter((x) => x !== a); openId = null; saveLib(); renderLib(list); };
    box.append(nameF, iconF, promptF, hint, rep, del);
    return box;
  }

  function renderLib(list) {
    list.textContent = '';
    lib.forEach((a, i) => {
      const item = el('div', 'lib-item' + (a.id === openId ? ' open' : ''));
      const head = el('div', 'lib-head');
      const toggle = el('button', 'ghost lib-toggle'); toggle.type = 'button';
      toggle.setAttribute('aria-expanded', a.id === openId ? 'true' : 'false');
      const nm = el('span', 'lib-name', ACTIONS.title({ id: a.id, name: a.name })); nm.dir = 'auto';
      toggle.append(ACTIONS.icon(a.icon, 15), nm);
      toggle.onclick = () => { openId = openId === a.id ? null : a.id; renderLib(list); };
      const move = (d, key, glyph) => {
        const b = el('button', 'ghost lib-move', glyph); b.type = 'button'; b.title = t(key); b.setAttribute('aria-label', t(key));
        b.disabled = i + d < 0 || i + d >= lib.length;
        b.onclick = () => { lib.splice(i + d, 0, lib.splice(i, 1)[0]); saveLib(); renderLib(list); };
        return b;
      };
      head.append(toggle, move(-1, 'settings.actions.lib.up', '↑'), move(1, 'settings.actions.lib.down', '↓'));
      item.appendChild(head);
      if (a.id === openId) item.appendChild(editor(a, list, () => { nm.textContent = ACTIONS.title({ id: a.id, name: a.name }); }));
      list.appendChild(item);
    });
  }

  // ---- log ----------------------------------------------------------------------------------------------
  let log = [];             // newest first, from the app
  let logOpen = null;
  let logList = null, logCount = null, logSearch = null;

  const entryTitle = (e) => ACTIONS.title({ id: e.action, name: e.title, query: e.query });
  const dayOf = (ms) => new Date(ms).toLocaleDateString(I18N.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeOf = (ms) => new Date(ms).toLocaleTimeString(I18N.locale, { hour: '2-digit', minute: '2-digit' });

  function renderLog() {
    if (!logList) return;
    const q = logSearch.value.trim().toLowerCase();
    const hit = (e) => !q || [entryTitle(e), e.source, e.result, e.error, e.app, e.model, dayOf(e.time), timeOf(e.time)]
      .some((v) => v && String(v).toLowerCase().includes(q));
    const items = log.filter(hit);
    logCount.textContent = log.length ? t('settings.actions.log.count', { n: items.length }) : '';
    logList.textContent = '';
    if (!items.length) { logList.appendChild(el('p', 'note', t(log.length ? 'settings.actions.log.none' : 'settings.actions.log.empty'))); return; }
    let day = '';
    for (const e of items) {
      const d = dayOf(e.time);
      if (d !== day) { day = d; logList.appendChild(el('div', 'log-day', d)); }
      const item = el('div', 'log-item' + (e.id === logOpen ? ' open' : ''));
      const head = el('button', 'ghost log-head'); head.type = 'button';
      head.setAttribute('aria-expanded', e.id === logOpen ? 'true' : 'false');
      const time = el('span', 'log-time', timeOf(e.time)); time.dir = 'ltr';
      const tt = el('span', 'log-title', entryTitle(e)); tt.dir = 'auto';
      const pv = el('span', 'log-preview', String(e.source || '').replace(/\s+/g, ' ').slice(0, 80)); pv.dir = 'auto';
      head.append(time, tt, pv);
      if (e.error) head.appendChild(el('span', 'log-bad', t('settings.actions.log.error')));
      head.onclick = () => { logOpen = logOpen === e.id ? null : e.id; renderLog(); };
      item.appendChild(head);
      if (e.id === logOpen) {
        const body = el('div', 'log-body');
        const meta = [e.app, e.model || (String(e.action).startsWith('translate:') ? t('settings.actions.log.appleEngine') : ''),
          e.ms != null ? (e.ms / 1000).toFixed(1) + 's' : ''].filter(Boolean).join(' · ');
        if (meta) { const m = el('div', 'log-meta', meta); m.dir = 'auto'; body.appendChild(m); }
        const block = (key, text, cls) => {
          body.appendChild(el('div', 'lib-label', t(key)));
          const p = el('div', 'log-text' + (cls ? ' ' + cls : ''), text); p.dir = 'auto'; body.appendChild(p);
        };
        block('settings.actions.log.source', e.source || '');
        if (e.error) block('settings.actions.log.error', e.error, 'bad'); else block('settings.actions.log.result', e.result || '');
        const btns = el('div', 'row-btns');
        if (!e.error) {
          const cp = el('button', 'btn sm', t('settings.actions.log.copy')); cp.type = 'button';
          cp.onclick = () => { CM.native({ cmd: 'copy', text: e.result || '' }); CM.toast(t('settings.actions.log.copied')); };
          btns.appendChild(cp);
        }
        const rm = el('button', 'btn danger sm', t('settings.actions.log.delete')); rm.type = 'button';
        rm.onclick = () => CM.native({ cmd: 'actionsLog.delete', id: e.id });
        btns.appendChild(rm);
        body.appendChild(btns);
        item.appendChild(body);
      }
      logList.appendChild(item);
    }
  }

  // The app sends the whole log after every change (ActionLog.swift).
  if (window.monitor) window.monitor.actionsLog = (m) => { log = (m && m.items) || []; renderLog(); };

  /** A button that asks once more before doing something that cannot be undone. */
  function confirmButton(labelKey, questionKey, yesKey, run) {
    const wrap = el('span', 'confirm-inline');
    const b = el('button', 'btn danger sm', t(labelKey)); b.type = 'button';
    const q = el('span', 'confirm-q'); q.hidden = true;
    const yes = el('button', 'btn danger primary sm', t(yesKey)); yes.type = 'button';
    const no = el('button', 'btn sm', t('settings.actions.lib.reset.no')); no.type = 'button';
    q.append(el('span', '', t(questionKey)), yes, no);
    b.onclick = () => { b.hidden = true; q.hidden = false; no.focus(); };
    no.onclick = () => { q.hidden = true; b.hidden = false; b.focus(); };
    yes.onclick = () => { q.hidden = true; b.hidden = false; run(); };
    wrap.append(b, q);
    return wrap;
  }

  // ---- tab -----------------------------------------------------------------------------------------------
  let root = null, hk = null, libList = null;
  let section = 'options';
  try { section = localStorage.getItem('cm.actionsSection') || 'options'; } catch (e) { /* no storage */ }

  function showSection(id) {
    section = ['options', 'library', 'log'].includes(id) ? id : 'options';
    try { localStorage.setItem('cm.actionsSection', section); } catch (e) { /* no storage */ }
    root.querySelectorAll('.a-seg button').forEach((b) => { const on = b.dataset.sec === section; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.querySelectorAll('.a-sec').forEach((s) => { s.hidden = s.dataset.sec !== section; });
    if (section === 'log') CM.native({ cmd: 'actionsLog.list' });
  }

  function mount(panel) {
    root = panel;
    panel.classList.add('actions-tab');
    const off = el('div', 'a-notice a-off');
    off.appendChild(el('span', '', t('settings.actions.off')));
    const on = el('button', 'btn primary sm', t('settings.actions.turnOn')); on.type = 'button';
    on.onclick = () => CM.setSetting('f.actions', true);
    off.appendChild(on);
    panel.appendChild(off);

    const body = el('div', 'a-body');
    const seg = el('div', 'seg a-seg');
    for (const id of ['options', 'library', 'log']) {
      const b = el('button', '', t('settings.actions.sec.' + id)); b.type = 'button'; b.dataset.sec = id;
      b.onclick = () => showSection(id);
      seg.appendChild(b);
    }
    body.appendChild(seg);

    // -- options
    const opt = el('div', 'a-sec'); opt.dataset.sec = 'options';
    opt.appendChild(el('h3', '', t('settings.actions.open')));
    const hkRow = el('div', 'row');
    hk = recorder();
    hkRow.append(labelled('settings.actions.hotkey'), hk);
    opt.appendChild(hkRow);
    for (const [key, name] of [['actionsButton', 'button'], ['menuBarIcon', 'menuBar']]) {
      const row = el('div', 'row');
      const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.dataset.key = key;
      row.append(labelled('settings.actions.' + name), sw);
      opt.appendChild(row);
    }
    const sv = el('div', 'row');
    const svBtn = el('button', '', t('settings.actions.services.open')); svBtn.type = 'button';
    svBtn.onclick = () => CM.native({ cmd: 'open', url: 'x-apple.systempreferences:com.apple.preference.keyboard?Shortcuts' });
    sv.append(labelled('settings.actions.services'), svBtn);
    opt.appendChild(sv);

    opt.appendChild(el('h3', '', t('settings.actions.model')));
    const modelRow = el('div', 'row');
    const mtxt = el('span');
    mtxt.appendChild(el('small', '', t('settings.actions.model.hint')));
    const none = el('small', 'a-model-none');
    none.appendChild(document.createTextNode(t('settings.actions.model.none') + ' '));
    const link = el('a', '', t('settings.actions.model.openAi')); link.href = '#';
    link.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const b = document.querySelector('#settings .tabs [data-tab="ai"]'); if (b) b.click(); };
    none.appendChild(link);
    mtxt.appendChild(none);
    const pick = el('select', 'a-model-pick');
    pick.setAttribute('aria-label', t('settings.actions.model'));
    pick.onchange = () => {
      const [prov, ...rest] = pick.value.split('\n');
      CM.setSetting('actionsProvider', prov || '');
      CM.setSetting('actionsModel', rest.join('\n'));
    };
    modelRow.append(mtxt, pick);
    opt.appendChild(modelRow);
    body.appendChild(opt);

    // -- library
    const ls = el('div', 'a-sec'); ls.dataset.sec = 'library';
    ls.appendChild(el('p', 'note a-hint', t('settings.actions.lib.hint')));
    libList = el('div', 'lib-list');
    ls.appendChild(libList);
    const libBtns = el('div', 'row-btns lib-btns');
    const add = el('button', 'btn', t('settings.actions.lib.add')); add.type = 'button';
    add.onclick = () => {
      const a = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '', icon: 'custom', prompt: '', replaces: true, builtin: false };
      lib.push(a); openId = a.id; saveLib(); renderLib(libList);
      const input = libList.querySelector('.lib-item.open input[type=text]'); if (input) input.focus();
    };
    libBtns.append(add, confirmButton('settings.actions.lib.reset', 'settings.actions.lib.reset.confirm', 'settings.actions.lib.reset.yes', () => {
      openId = null; savedJson = null; CM.S.actionsLibrary = (CM.S.actionsDefaults || []).map((a) => Object.assign({}, a)); CM.setSetting('actionsList', '[]');
    }));
    ls.appendChild(libBtns);
    body.appendChild(ls);

    // -- log
    const lg = el('div', 'a-sec'); lg.dataset.sec = 'log';
    const keep = el('div', 'row');
    const ksw = el('input', 'switch'); ksw.type = 'checkbox'; ksw.dataset.key = 'actionsLogKeep';
    keep.append(labelled('settings.actions.log.keep'), ksw);
    lg.appendChild(keep);
    const bar = el('div', 'log-bar');
    logSearch = el('input'); logSearch.type = 'search'; logSearch.placeholder = t('settings.actions.log.search');
    logSearch.setAttribute('aria-label', t('settings.actions.log.search')); autoDir(logSearch);
    logSearch.addEventListener('input', renderLog);
    logCount = el('span', 'note log-count');
    bar.append(logSearch, logCount, confirmButton('settings.actions.log.clear', 'settings.actions.log.clear.confirm', 'settings.actions.log.clear.yes',
      () => CM.native({ cmd: 'actionsLog.clear' })));
    lg.appendChild(bar);
    logList = el('div', 'log-list');
    lg.appendChild(logList);
    body.appendChild(lg);

    panel.appendChild(body);
    savedJson = null;
    CM.bindControls(panel);
    CM.fillForm();
    showSection(section);
    renderLog();
    update(CM.S);
  }

  function fillPicker(pick, S) {
    const cur = S.actionsModel ? (S.actionsProvider || '') + '\n' + S.actionsModel : '';
    pick.textContent = '';
    const auto = el('option', '', t('settings.actions.model.auto')); auto.value = ''; pick.appendChild(auto);
    let n = 0, found = !cur;
    for (const p of (CM.ai && CM.ai.providers) || []) {
      if (!p.enabled) continue;
      const models = (p.models || []).filter((m) => !m.hidden && !m.missing);
      if (!models.length) continue;
      const og = el('optgroup'); og.label = p.name || p.id;
      for (const m of models) {
        const o = el('option', '', m.label || m.id); o.value = p.id + '\n' + m.id; o.dir = 'auto';
        if (o.value === cur) found = true;
        og.appendChild(o); n++;
      }
      pick.appendChild(og);
    }
    pick.value = found ? cur : '';
    return n;
  }

  function update(S) {
    if (!root) return;
    const on = S['f.actions'] !== false;
    root.querySelector('.a-off').hidden = on;
    root.querySelector('.a-body').hidden = !on;
    hk.refresh();
    const n = fillPicker(root.querySelector('.a-model-pick'), S);
    root.querySelector('.a-model-none').hidden = n > 0;
    // Re-render the library only when it changed somewhere else (another window, a reset), not while editing here.
    if ((S.actionsList || '[]') !== savedJson) {
      savedJson = S.actionsList || '[]';
      lib = (S.actionsLibrary || []).map((a) => Object.assign({}, a));
      renderLib(libList);
    }
  }

  CM.registerTab('actions', { mount, update });
})();
