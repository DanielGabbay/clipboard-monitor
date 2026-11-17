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
      'settings.actions.custom': 'Your actions',
      'settings.actions.custom.hint': 'Each one sends the selected text to the model with your instruction.',
      'settings.actions.custom.name': 'Name, e.g. Make it formal',
      'settings.actions.custom.prompt': 'Instruction, e.g. Rewrite the text in a formal tone',
      'settings.actions.custom.add': 'Add action',
      'settings.actions.custom.delete': 'Delete this action',
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
      'settings.actions.custom': 'הפעולות שלך',
      'settings.actions.custom.hint': 'כל פעולה שולחת למודל את הטקסט המסומן יחד עם ההוראה שכתבת.',
      'settings.actions.custom.name': 'שם, למשל: נסח באופן רשמי',
      'settings.actions.custom.prompt': 'הוראה, למשל: נסח את הטקסט מחדש בטון רשמי',
      'settings.actions.custom.add': 'הוסף פעולה',
      'settings.actions.custom.delete': 'מחק את הפעולה',
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
    const btn = el('button', 'hk-rec'); btn.type = 'button'; btn.dir = 'ltr';
    const clear = el('button', 'ghost hk-clear', '×'); clear.type = 'button'; clear.title = t('settings.actions.hotkey.clear');
    clear.setAttribute('aria-label', t('settings.actions.hotkey.clear'));
    let recording = false;
    const stop = () => { recording = false; btn.classList.remove('on'); btn.textContent = hotkeyLabel(CM.S.actionsHotkey); };
    btn.onclick = () => { recording = true; btn.classList.add('on'); btn.textContent = t('settings.actions.hotkey.recording'); };
    btn.onblur = () => { if (recording) stop(); };
    btn.addEventListener('keydown', (e) => {
      if (!recording) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      if (!KEY_RE.test(e.code)) return;
      if (!(e.ctrlKey || e.altKey || e.metaKey)) { btn.textContent = t('settings.actions.hotkey.needMod'); return; }
      const mods = [e.ctrlKey && 'ctrl', e.altKey && 'opt', e.shiftKey && 'shift', e.metaKey && 'cmd'].filter(Boolean);
      recording = false; btn.classList.remove('on');
      CM.setSetting('actionsHotkey', mods.concat(e.code).join('+'));
    });
    clear.onclick = () => CM.setSetting('actionsHotkey', 'off');
    wrap.append(btn, clear);
    wrap.refresh = () => { if (!recording) btn.textContent = hotkeyLabel(CM.S.actionsHotkey); clear.hidden = hotkeyLabel(CM.S.actionsHotkey) === t('settings.actions.hotkey.off'); };
    return wrap;
  }

  // The app refuses a shortcut that is already taken and keeps the previous one (main.swift, setSetting).
  if (window.monitor) window.monitor.hotkeyRejected = () => CM.toast(t('settings.actions.hotkey.taken'));

  // ---- custom actions ------------------------------------------------------------------------------------
  let custom = [];          // [{id, name, prompt}]
  let savedJson = null;     // what this tab last wrote or showed

  function readCustom(S) {
    try { const a = JSON.parse(S.customActions || '[]'); return Array.isArray(a) ? a.filter((x) => x && x.id) : []; } catch (e) { return []; }
  }
  function saveCustom() {
    savedJson = JSON.stringify(custom);
    CM.setSetting('customActions', savedJson);
  }
  function renderCustom(list) {
    list.textContent = '';
    custom.forEach((a, i) => {
      const card = el('div', 'ca');
      const name = el('input'); name.type = 'text'; name.value = a.name || ''; name.placeholder = t('settings.actions.custom.name'); autoDir(name);
      name.onchange = () => { a.name = name.value; saveCustom(); };
      const del = el('button', 'ghost ca-del', '×'); del.type = 'button'; del.title = t('settings.actions.custom.delete');
      del.setAttribute('aria-label', t('settings.actions.custom.delete'));
      del.onclick = () => { custom.splice(i, 1); saveCustom(); renderCustom(list); };
      const head = el('div', 'ca-head'); head.append(name, del);
      const prompt = el('textarea'); prompt.value = a.prompt || ''; prompt.placeholder = t('settings.actions.custom.prompt'); autoDir(prompt);
      prompt.onchange = () => { a.prompt = prompt.value; saveCustom(); };
      card.append(head, prompt);
      list.appendChild(card);
    });
  }

  // ---- tab -----------------------------------------------------------------------------------------------
  let root = null, hk = null, list = null;

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
    body.appendChild(el('h3', '', t('settings.actions.open')));

    const hkRow = el('div', 'row');
    hk = recorder();
    hkRow.append(labelled('settings.actions.hotkey'), hk);
    body.appendChild(hkRow);

    for (const [key, name] of [['actionsButton', 'button'], ['menuBarIcon', 'menuBar']]) {
      const row = el('div', 'row');
      const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.dataset.key = key;
      row.append(labelled('settings.actions.' + name), sw);
      body.appendChild(row);
    }

    const sv = el('div', 'row');
    const svBtn = el('button', '', t('settings.actions.services.open')); svBtn.type = 'button';
    svBtn.onclick = () => CM.native({ cmd: 'open', url: 'x-apple.systempreferences:com.apple.preference.keyboard?Shortcuts' });
    sv.append(labelled('settings.actions.services'), svBtn);
    body.appendChild(sv);

    body.appendChild(el('h3', '', t('settings.actions.model')));
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
    body.appendChild(modelRow);

    body.appendChild(el('h3', '', t('settings.actions.custom')));
    body.appendChild(el('p', 'note a-custom-hint', t('settings.actions.custom.hint')));
    list = el('div', 'ca-list');
    body.appendChild(list);
    const add = el('button', '', t('settings.actions.custom.add')); add.type = 'button';
    add.onclick = () => {
      custom.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: '', prompt: '' });
      saveCustom(); renderCustom(list);
      const inputs = list.querySelectorAll('.ca input'); if (inputs.length) inputs[inputs.length - 1].focus();
    };
    body.appendChild(add);

    panel.appendChild(body);
    savedJson = null;
    CM.bindControls(panel);
    CM.fillForm();
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
    // Re-render the custom list only when it changed somewhere else (another window), not while typing here.
    if ((S.customActions || '[]') !== savedJson) { custom = readCustom(S); savedJson = S.customActions || '[]'; renderCustom(list); }
  }

  CM.registerTab('actions', { mount, update });
})();
