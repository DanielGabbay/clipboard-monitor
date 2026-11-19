// Settings › Text Actions tab: how the popover opens (recorded shortcut, floating button, menu bar icon, Services
// menu), the model the actions use, and the action library ("actionsList": JSON [{id, name?, icon?, prompt?, replaces?}]).
// update(S) runs on 'settings' and 'aiState' (see settings.js).
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.tab.actions': 'Text Actions',
      'settings.actions.enable': 'Text Actions',
      'settings.actions.enable.hint': 'Select text in any app and open a popover of actions on it.',
      'settings.actions.open': 'Opening the popover',
      'settings.actions.hotkey': 'Shortcut',
      'settings.actions.hotkey.hint': 'Select text in any app, then press it. Click to record a new one.',
      'settings.actions.flipHotkey': 'Quick keyboard flip',
      'settings.actions.flipHotkey.hint': 'Flips and replaces selected text between Hebrew and English in any app, without opening a window.',
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
      'settings.actions.lib.localHint': 'Instant local action — runs without AI.',
      'settings.actions.lib.missingName': 'Enter a name — hidden from the popover until set.',
      'settings.actions.lib.missingPrompt': 'Enter a prompt — hidden from the popover until set.',
      'settings.actions.lib.missingBadge': 'Incomplete',
      'settings.actions.ai.title': '✨ Create or refine an action with AI',
      'settings.actions.ai.phNew': 'Describe an action, e.g. Turn into polite bullet points',
      'settings.actions.ai.phEdit': 'How to change “{name}”, e.g. Make it shorter',
      'settings.actions.ai.targetEdit': 'Refining: {name}',
      'settings.actions.ai.newInstead': 'Create new instead',
      'settings.actions.ai.btnCreate': 'Create',
      'settings.actions.ai.btnUpdate': 'Update',
      'settings.actions.ai.generating': 'Generating…',
      'settings.actions.ai.created': 'Action created',
      'settings.actions.ai.updated': 'Action updated',
      'settings.actions.ai.noModel': 'Set up an AI model first to generate actions.',
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
      'settings.actions.enable': 'פעולות על טקסט',
      'settings.actions.enable.hint': 'סמן טקסט בכל יישום ופתח חלונית פעולות עליו.',
      'settings.actions.open': 'פתיחת החלונית',
      'settings.actions.hotkey': 'קיצור',
      'settings.actions.hotkey.hint': 'סמן טקסט בכל יישום ולחץ עליו. לחץ כאן כדי להקליט קיצור חדש.',
      'settings.actions.flipHotkey': 'היפוך מקלדת מהיר',
      'settings.actions.flipHotkey.hint': 'הופך ומחליף טקסט מסומן בין עברית לאנגלית בכל יישום, בלי לפתוח חלון.',
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
      'settings.actions.lib.localHint': 'פעולה מקומית מיידית — פועלת ללא AI.',
      'settings.actions.lib.missingName': 'יש להזין שם — הפעולה מוסתרת מהחלונית עד אז.',
      'settings.actions.lib.missingPrompt': 'יש להזין פרומפט — הפעולה מוסתרת מהחלונית עד אז.',
      'settings.actions.lib.missingBadge': 'חסר מידע',
      'settings.actions.ai.title': '✨ צור או התאם פעולה עם AI',
      'settings.actions.ai.phNew': 'תאר פעולה, למשל: הפוך לרשימת נקודות מנומסת',
      'settings.actions.ai.phEdit': 'איך לשנות את „{name}”, למשל: קצר את התוצאה',
      'settings.actions.ai.targetEdit': 'מתאים את: {name}',
      'settings.actions.ai.newInstead': 'צור חדשה במקום',
      'settings.actions.ai.btnCreate': 'צור',
      'settings.actions.ai.btnUpdate': 'עדכן',
      'settings.actions.ai.generating': 'יוצר…',
      'settings.actions.ai.created': 'הפעולה נוצרה',
      'settings.actions.ai.updated': 'הפעולה עודכנה',
      'settings.actions.ai.noModel': 'יש להגדיר מודל AI תחילה כדי ליצור פעולות.',
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

  // ---- library ------------------------------------------------------------------------------------------
  const PLACEHOLDERS = ['SELECTED TEXT', 'CLIPBOARD', 'LANGUAGE', 'APP', 'DATE', 'TIME'];
  const LOCAL_IDS = new Set(['flipKeyboard', 'wrapRtl', 'cleanSpaces']);
  const isLocal = (a) => !!(a && (a.kind === 'local' || a.local || LOCAL_IDS.has(a.id)));
  const missingFields = (a) => {
    const needName = !a.builtin && !(a.name || '').trim();
    const needPrompt = !a.builtin && !isLocal(a) && !(a.prompt || '').trim();
    return { needName, needPrompt, hasAny: needName || needPrompt };
  };

  let lib = [];             // [{id, name, icon, prompt, replaces, builtin, kind?, local?}]
  let savedJson = null;     // the "actionsList" value this tab last wrote or showed
  let openId = null;        // the action whose editor is open
  let saveTimer = null;
  let forceNewAi = false;
  let lastSettings = null;
  let aiReq = null;
  let aiTimeout = null;
  let aiBusy = false;
  let aiErrMsg = '';
  let aiPendingTargetId = null;
  let aiDraft = '';
  let aiBoxSync = null;
  let aiInputEl = null;

  const libJson = () => JSON.stringify(lib.map((a) => ({ id: a.id, name: a.name || '', icon: a.icon, prompt: isLocal(a) ? '' : (a.prompt || ''), replaces: !!a.replaces })));
  // CM.S.actionsLibrary is kept in step, so the echo of this change from the app does not re-render the editor.
  function saveLib() {
    clearTimeout(saveTimer);
    saveTimer = null;
    savedJson = libJson();
    CM.S.actionsLibrary = lib.map((a) => Object.assign({}, a));
    CM.setSetting('actionsList', savedJson);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLib, 350);
  }
  function flushSave() {
    if (saveTimer) saveLib();
  }

  function editor(a, list, onName, onValidity) {
    const box = el('div', 'lib-edit');
    const field = (key) => { const f = el('label', 'lib-field'); f.appendChild(el('span', 'lib-label', t(key))); return f; };
    const local = isLocal(a);

    const nameF = field('settings.actions.lib.name');
    const name = el('input'); name.type = 'text'; name.value = a.name || '';
    name.placeholder = a.builtin ? ACTIONS.title({ id: a.id }) : t('settings.actions.lib.name.ph'); autoDir(name);
    const nameErr = el('div', 'lib-ferr', t('settings.actions.lib.missingName'));
    nameF.append(name, nameErr);

    const iconF = el('div', 'lib-field'); iconF.appendChild(el('span', 'lib-label', t('settings.actions.lib.icon')));
    const grid = el('div', 'lib-icons'); grid.setAttribute('role', 'radiogroup');
    for (const id of ACTIONS.icons) {
      const b = el('button', 'ghost lib-icon' + (a.icon === id ? ' on' : '')); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', a.icon === id ? 'true' : 'false'); b.setAttribute('aria-label', id);
      b.appendChild(ACTIONS.icon(id, 16));
      b.onclick = () => { flushSave(); a.icon = id; saveLib(); renderLib(list); };
      grid.appendChild(b);
    }
    iconF.appendChild(grid);

    let prompt = null, promptErr = null;
    const syncValidity = () => {
      const m = missingFields(a);
      name.setAttribute('aria-invalid', m.needName ? 'true' : 'false');
      nameErr.hidden = !m.needName;
      if (prompt && promptErr) {
        prompt.setAttribute('aria-invalid', m.needPrompt ? 'true' : 'false');
        promptErr.hidden = !m.needPrompt;
      }
      if (onValidity) onValidity(m.hasAny);
    };

    name.addEventListener('input', () => {
      a.name = name.value.trim();
      syncValidity();
      onName();
      if (aiBoxSync) aiBoxSync();
      scheduleSave();
    });
    name.addEventListener('blur', () => { flushSave(); });

    box.append(nameF, iconF);

    if (local) {
      box.appendChild(el('p', 'note lib-local-hint', t('settings.actions.lib.localHint')));
    } else {
      const promptF = field('settings.actions.lib.prompt');
      prompt = el('textarea'); prompt.value = a.prompt || ''; prompt.placeholder = t('settings.actions.lib.prompt.ph'); autoDir(prompt);
      promptErr = el('div', 'lib-ferr', t('settings.actions.lib.missingPrompt'));
      prompt.addEventListener('input', () => {
        a.prompt = prompt.value;
        syncValidity();
        scheduleSave();
      });
      prompt.addEventListener('blur', () => { flushSave(); });
      promptF.append(prompt, promptErr);
      const hint = el('div', 'lib-hint'); hint.appendChild(el('small', '', t('settings.actions.lib.prompt.hint')));
      const chips = el('span', 'lib-chips'); chips.dir = 'ltr';
      for (const p of PLACEHOLDERS) {
        const c = el('button', 'ghost lib-chip', '{{ ' + p + ' }}'); c.type = 'button';
        c.onclick = () => {
          const at = prompt.selectionStart ?? prompt.value.length, to = prompt.selectionEnd ?? at, ins = '{{ ' + p + ' }}';
          prompt.value = prompt.value.slice(0, at) + ins + prompt.value.slice(to);
          prompt.dispatchEvent(new Event('input')); prompt.focus(); prompt.setSelectionRange(at + ins.length, at + ins.length);
          a.prompt = prompt.value; syncValidity(); saveLib();
        };
        chips.appendChild(c);
      }
      hint.appendChild(chips);
      box.append(promptF, hint);
    }

    syncValidity();

    const rep = el('div', 'row lib-rep');
    const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.checked = !!a.replaces;
    sw.onchange = () => { flushSave(); a.replaces = sw.checked; saveLib(); };
    rep.append(labelled('settings.actions.lib.replaces'), sw);

    const del = el('button', 'btn danger sm', t('settings.actions.lib.delete')); del.type = 'button';
    del.onclick = () => {
      flushSave();
      lib = lib.filter((x) => x !== a);
      openId = null;
      forceNewAi = false;
      saveLib();
      renderLib(list);
      if (aiBoxSync) aiBoxSync();
    };
    box.append(rep, del);
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
      const missBadge = el('span', 'lib-miss', t('settings.actions.lib.missingBadge'));
      missBadge.hidden = !missingFields(a).hasAny;
      toggle.append(ACTIONS.icon(a.icon, 15), nm, missBadge);
      toggle.onclick = () => {
        flushSave();
        openId = openId === a.id ? null : a.id;
        forceNewAi = false;
        renderLib(list);
        if (aiBoxSync) aiBoxSync();
      };
      const move = (d, key, glyph) => {
        const b = el('button', 'ghost lib-move', glyph); b.type = 'button'; b.title = t(key); b.setAttribute('aria-label', t(key));
        b.disabled = i + d < 0 || i + d >= lib.length;
        b.onclick = () => { flushSave(); lib.splice(i + d, 0, lib.splice(i, 1)[0]); saveLib(); renderLib(list); };
        return b;
      };
      head.append(toggle, move(-1, 'settings.actions.lib.up', '↑'), move(1, 'settings.actions.lib.down', '↓'));
      item.appendChild(head);
      if (a.id === openId) {
        item.appendChild(editor(
          a,
          list,
          () => { nm.textContent = ACTIONS.title({ id: a.id, name: a.name }); },
          (hasAny) => { missBadge.hidden = !hasAny; }
        ));
      }
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
  let root = null, hk = null, flipHk = null, libList = null;
  let section = 'options';
  function showSection(id) {
    section = ['options', 'library', 'log'].includes(id) ? id : 'options';
    root.querySelectorAll('.a-seg button').forEach((b) => { const on = b.dataset.sec === section; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    root.querySelectorAll('.a-sec').forEach((s) => { s.hidden = s.dataset.sec !== section; });
    if (section === 'log') CM.native({ cmd: 'actionsLog.list' });
  }

  function mount(panel) {
    section = 'options';
    root = panel;
    panel.classList.add('actions-tab');
    const master = el('div', 'row');
    const mSw = el('input', 'switch'); mSw.type = 'checkbox'; mSw.dataset.key = 'f.actions';
    master.append(labelled('settings.actions.enable'), mSw);
    panel.appendChild(master);

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
    hk = CM.hotkeyRecorder('actionsHotkey');
    hkRow.append(labelled('settings.actions.hotkey'), hk);
    opt.appendChild(hkRow);
    const flipRow = el('div', 'row');
    flipHk = CM.hotkeyRecorder('flipHotkey');
    flipRow.append(labelled('settings.actions.flipHotkey'), flipHk);
    opt.appendChild(flipRow);
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

    const aiBox = el('div', 'lib-ai');
    const aiHead = el('div', 'lib-ai-head');
    aiHead.appendChild(el('span', 'lib-ai-title', t('settings.actions.ai.title')));
    const aiCtx = el('span', 'lib-ai-ctx');
    const aiTargetLbl = el('span', 'lib-ai-target');
    const aiNewBtn = el('button', 'ghost lib-ai-reset', t('settings.actions.ai.newInstead')); aiNewBtn.type = 'button';
    aiCtx.append(aiTargetLbl, aiNewBtn);
    aiHead.appendChild(aiCtx);
    const aiRow = el('div', 'lib-ai-row');
    const aiInput = el('input'); aiInput.type = 'text'; aiInput.value = aiDraft; autoDir(aiInput);
    aiInput.addEventListener('input', () => { aiDraft = aiInput.value; });
    aiInputEl = aiInput;
    const aiGo = el('button', 'btn primary sm', t('settings.actions.ai.btnCreate')); aiGo.type = 'button';
    aiRow.append(aiInput, aiGo);
    const aiErr = el('div', 'lib-ai-err'); aiErr.hidden = true;
    aiBox.append(aiHead, aiRow, aiErr);

    const targetAction = () => {
      if (forceNewAi || !openId) return null;
      const a = lib.find((x) => x.id === openId);
      return a && !isLocal(a) ? a : null;
    };
    const syncAiBox = () => {
      const target = targetAction();
      const targetName = target ? ACTIONS.title({ id: target.id, name: target.name }) : '';
      aiCtx.hidden = !target;
      if (target) {
        aiTargetLbl.textContent = t('settings.actions.ai.targetEdit', { name: targetName });
        aiInput.placeholder = t('settings.actions.ai.phEdit', { name: targetName });
      } else {
        aiInput.placeholder = t('settings.actions.ai.phNew');
      }
      const aiOn = (lastSettings ? lastSettings['f.ai'] !== false : (window.CM && CM.S && CM.S['f.ai'] !== false));
      aiGo.textContent = aiBusy
        ? t('settings.actions.ai.generating')
        : t(target ? 'settings.actions.ai.btnUpdate' : 'settings.actions.ai.btnCreate');
      aiGo.disabled = aiBusy || !aiOn;
      aiInput.disabled = aiBusy || !aiOn;
      aiErr.textContent = aiErrMsg;
      aiErr.hidden = !aiErrMsg;
    };
    aiBoxSync = syncAiBox;
    aiNewBtn.onclick = () => { forceNewAi = true; syncAiBox(); aiInput.focus(); };

    const submitAi = () => {
      const reqText = aiInput.value.trim();
      if (!reqText || aiBusy) return;
      flushSave();
      aiErrMsg = '';
      const target = targetAction();
      aiPendingTargetId = target ? target.id : null;
      aiReq = 'sact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      aiBusy = true;
      syncAiBox();
      clearTimeout(aiTimeout);
      aiTimeout = setTimeout(() => {
        if (!aiBusy) return;
        aiBusy = false;
        aiReq = null;
        aiPendingTargetId = null;
        aiErrMsg = 'Timed out.';
        if (aiBoxSync) aiBoxSync();
      }, 60000);
      const payload = { cmd: 'actions.generate', req: aiReq, request: reqText };
      if (target) {
        payload.existing = {
          name: target.name || ACTIONS.title({ id: target.id }),
          icon: target.icon || 'custom',
          prompt: target.prompt || '',
          replaces: !!target.replaces,
        };
      }
      CM.native(payload);
    };
    aiGo.onclick = () => { submitAi(); };
    aiInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submitAi(); }
    });

    ls.appendChild(aiBox);
    libList = el('div', 'lib-list');
    ls.appendChild(libList);
    const libBtns = el('div', 'row-btns lib-btns');
    const add = el('button', 'btn', t('settings.actions.lib.add')); add.type = 'button';
    add.onclick = () => {
      flushSave();
      const a = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '', icon: 'custom', prompt: '', replaces: true, builtin: false };
      lib.push(a); openId = a.id; forceNewAi = false; saveLib(); renderLib(libList); syncAiBox();
      const input = libList.querySelector('.lib-item.open input[type=text]'); if (input) input.focus();
    };
    libBtns.append(add, confirmButton('settings.actions.lib.reset', 'settings.actions.lib.reset.confirm', 'settings.actions.lib.reset.yes', () => {
      flushSave();
      openId = null; forceNewAi = false; savedJson = null;
      CM.S.actionsLibrary = (CM.S.actionsDefaults || []).map((a) => Object.assign({}, a));
      CM.setSetting('actionsList', '[]');
      syncAiBox();
    }));
    ls.appendChild(libBtns);
    syncAiBox();
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
    lastSettings = S;
    const on = S['f.actions'] !== false;
    const body = root.querySelector('.a-body');
    body.classList.toggle('off', !on);
    if ('inert' in body) body.inert = !on;
    hk.refresh();
    if (flipHk) flipHk.refresh();
    const n = fillPicker(root.querySelector('.a-model-pick'), S);
    root.querySelector('.a-model-none').hidden = n > 0;
    // Re-render the library only when it changed somewhere else (another window, a reset), not while editing here.
    if ((S.actionsList || '[]') !== savedJson) {
      savedJson = S.actionsList || '[]';
      lib = (S.actionsLibrary || []).map((a) => Object.assign({}, a));
      renderLib(libList);
    }
    if (aiBoxSync) aiBoxSync();
  }

  CM.on('actionGenerated', (ev) => {
    if (!ev || !aiReq || ev.req !== aiReq) return;
    clearTimeout(aiTimeout);
    aiTimeout = null;
    aiReq = null;
    aiBusy = false;
    const targetId = aiPendingTargetId;
    aiPendingTargetId = null;
    if (ev.error || !ev.action) {
      aiErrMsg = ev.code === 'noModel' ? t('settings.actions.ai.noModel') : (ev.error || 'Error');
      if (aiBoxSync) aiBoxSync();
      return;
    }
    aiErrMsg = '';
    const gen = ev.action;
    const existing = targetId ? lib.find((x) => x.id === targetId) : null;
    if (existing) {
      existing.name = gen.name || existing.name;
      existing.icon = gen.icon || existing.icon;
      existing.prompt = gen.prompt || existing.prompt;
      if (typeof gen.replaces === 'boolean') existing.replaces = gen.replaces;
      openId = existing.id;
    } else {
      const created = {
        id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: gen.name || '',
        icon: gen.icon || 'custom',
        prompt: gen.prompt || '',
        replaces: typeof gen.replaces === 'boolean' ? gen.replaces : true,
        builtin: false,
      };
      lib.push(created);
      openId = created.id;
    }
    forceNewAi = false;
    aiDraft = '';
    if (aiInputEl) {
      aiInputEl.value = '';
      aiInputEl.removeAttribute('dir');
    }
    saveLib();
    if (libList) renderLib(libList);
    if (aiBoxSync) aiBoxSync();
    CM.toast(t(existing ? 'settings.actions.ai.updated' : 'settings.actions.ai.created'));
  });

  CM.registerTab('actions', { mount, update });
})();
