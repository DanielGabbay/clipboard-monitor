// Settings › Translation tab: master toggle (f.translate), engine (Apple on-device / AI model), AI model picker,
// on-device fallback, "Translate to…" languages, and Translate anywhere (f.bubble + bubbleHotkey, f.lens + lensHotkey).
// update(S) runs on 'settings' and 'aiState'.
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.tab.translate': 'Translation',
      'settings.translate.enable': 'Translation',
      'settings.translate.enable.hint': 'Translate button, translated view and menu entries.',
      'settings.translate.engine': 'Engine',
      'settings.translate.engine.apple': 'Apple on-device',
      'settings.translate.engine.llm': 'AI model',
      'settings.translate.aiOff': 'AI is turned off, so on-device translation is used.',
      'settings.translate.aiTurnOn': 'Turn on AI',
      'settings.translate.model': 'Model',
      'settings.translate.model.hint': 'Only enabled providers and visible models are listed.',
      'settings.translate.model.none': 'No AI models are available yet.',
      'settings.translate.model.openAi': 'Add a provider in the AI tab',
      'settings.translate.model.choose': 'Choose a model…',
      'settings.translate.model.missing': '{model} (not available)',
      'settings.translate.fallback': 'If the AI model fails, translate on-device',
      'settings.translate.targets': 'Languages for "Translate to…"',
      'settings.translate.targets.hint': 'The automatic button always translates between Hebrew and English.',
      'settings.translate.anywhere': 'Translate anywhere',
      'settings.translate.bubble': 'Translate at Pointer',
      'settings.translate.bubble.hint': 'Point at a paragraph or select text in any app and press the shortcut: the translation opens next to it. Needs Accessibility access.',
      'settings.translate.bubbleHotkey': 'Shortcut',
      'settings.translate.bubbleHotkey.hint': 'Translates what is under the pointer, from any app.',
      'settings.translate.lens': 'Translation Lens',
      'settings.translate.lens.hint': 'A floating panel that shows the text of the window under it as a translated document (View › Translation Lens). Needs Accessibility access.',
      'settings.translate.lensHotkey': 'Lens shortcut',
      'settings.translate.lensHotkey.hint': 'Opens and closes the lens from any app.',
    },
    he: {
      'settings.tab.translate': 'תרגום',
      'settings.translate.enable': 'תרגום',
      'settings.translate.enable.hint': 'כפתור התרגום, תצוגת התרגום ופריטי התפריט.',
      'settings.translate.engine': 'מנוע',
      'settings.translate.engine.apple': 'Apple במכשיר',
      'settings.translate.engine.llm': 'מודל AI',
      'settings.translate.aiOff': 'ה־AI כבוי, ולכן התרגום ייעשה במכשיר.',
      'settings.translate.aiTurnOn': 'הפעל AI',
      'settings.translate.model': 'מודל',
      'settings.translate.model.hint': 'מוצגים רק ספקים פעילים ומודלים גלויים.',
      'settings.translate.model.none': 'עדיין אין מודלי AI זמינים.',
      'settings.translate.model.openAi': 'הוסף ספק בלשונית AI',
      'settings.translate.model.choose': 'בחר מודל…',
      'settings.translate.model.missing': '{model} (לא זמין)',
      'settings.translate.fallback': 'אם ה־AI נכשל, תרגם במכשיר',
      'settings.translate.targets': 'שפות עבור „תרגם ל…”',
      'settings.translate.targets.hint': 'הכפתור האוטומטי תמיד מתרגם בין עברית לאנגלית.',
      'settings.translate.anywhere': 'תרגום מכל מקום',
      'settings.translate.bubble': 'תרגום מתחת לסמן',
      'settings.translate.bubble.hint': 'הצבע על פסקה או סמן טקסט בכל יישום ולחץ על הקיצור: התרגום נפתח לידו. דורש גישת נגישות.',
      'settings.translate.bubbleHotkey': 'קיצור',
      'settings.translate.bubbleHotkey.hint': 'מתרגם את מה שמתחת לסמן, מכל יישום.',
      'settings.translate.lens': 'עדשת תרגום',
      'settings.translate.lens.hint': 'חלונית צפה שמציגה את הטקסט של החלון שמתחתיה כמסמך מתורגם (תצוגה › עדשת תרגום). דורשת גישת נגישות.',
      'settings.translate.lensHotkey': 'קיצור לעדשה',
      'settings.translate.lensHotkey.hint': 'פותח וסוגר את העדשה מכל יישום.',
    },
  });

  const LANGS = ['he', 'en', 'ar', 'ru', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'uk', 'tr', 'zh', 'ja', 'ko', 'hi', 'id', 'th', 'vi'];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }
  function button(text, cls, onclick) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.onclick = onclick; return b;
  }
  /** Notice line: message + optional action button. */
  function notice(cls, msg, action) {
    const n = el('div', 't-notice ' + cls);
    n.appendChild(el('span', '', msg));
    if (action) n.appendChild(action);
    return n;
  }

  let root = null;
  let bubbleHk = null;
  let lensHk = null;

  function labelled(key) {
    const s = el('span');
    s.append(el('span', '', t(key)), el('small', '', t(key + '.hint')));
    return s;
  }

  function switchRow(name) {
    const row = el('div', 'row');
    row.dataset.feature = name;
    const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.dataset.key = 'f.' + name;
    row.append(labelled('settings.translate.' + name), sw);
    return row;
  }

  function hotkeySub(name, rec) {
    const sub = el('div', 'f-sub f-hk');
    sub.dataset.for = name;
    const row = el('div', 'row');
    row.append(labelled('settings.translate.' + name + 'Hotkey'), rec);
    sub.appendChild(row);
    return sub;
  }

  function mount(panel) {
    root = panel;
    panel.classList.add('translate-tab');

    const master = el('div', 'row');
    const mSw = el('input', 'switch'); mSw.type = 'checkbox'; mSw.dataset.key = 'f.translate';
    master.append(labelled('settings.translate.enable'), mSw);
    panel.appendChild(master);

    const body = el('div', 't-body');

    const engRow = el('div', 'row');
    engRow.appendChild(el('span', '', t('settings.translate.engine')));
    const seg = el('div', 'seg'); seg.dataset.key = 'translateEngine';
    for (const v of ['apple', 'llm']) { const b = el('button', '', t('settings.translate.engine.' + v)); b.type = 'button'; b.dataset.v = v; seg.appendChild(b); }
    engRow.appendChild(seg);
    body.appendChild(engRow);

    body.appendChild(notice('t-ai-off', t('settings.translate.aiOff'),
      button(t('settings.translate.aiTurnOn'), 'sm', () => CM.setSetting('f.ai', true))));

    const modelRow = el('div', 'row t-model');
    const mtxt = el('span');
    mtxt.append(el('span', '', t('settings.translate.model')), el('small', 't-model-hint', t('settings.translate.model.hint')));
    const pick = el('select', 't-model-pick');
    pick.onchange = () => {
      const [prov, ...rest] = pick.value.split('\n');
      CM.setSetting('translateProvider', prov || '');
      CM.setSetting('translateModel', rest.join('\n'));
    };
    const none = el('span', 't-model-none');
    none.appendChild(el('span', 'note', t('settings.translate.model.none') + ' '));
    const link = el('a', '', t('settings.translate.model.openAi')); link.href = '#';
    link.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const b = document.querySelector('#settings .tabs [data-tab="ai"]'); if (b) b.click(); };
    none.appendChild(link);
    mtxt.appendChild(none);
    modelRow.append(mtxt, pick);
    body.appendChild(modelRow);

    const fb = el('div', 'row t-fallback');
    fb.appendChild(el('span', '', t('settings.translate.fallback')));
    const fbs = el('input', 'switch'); fbs.type = 'checkbox'; fbs.dataset.key = 'translateFallbackApple';
    fb.appendChild(fbs);
    body.appendChild(fb);

    const tg = el('div', 'row t-targets-row');
    const tgt = el('span');
    tgt.append(el('span', '', t('settings.translate.targets')), el('small', '', t('settings.translate.targets.hint')));
    const list = el('div', 't-targets');
    for (const code of LANGS) {
      const lab = el('label');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = code;
      cb.onchange = () => {
        const cur = new Set(String(CM.S.translateTargets || '').split(',').map((s) => s.trim()).filter(Boolean));
        if (cb.checked) cur.add(code); else cur.delete(code);
        // Keep the list in the order shown here; codes not in LANGS (set elsewhere) stay at the end.
        const ordered = LANGS.filter((c) => cur.has(c)).concat([...cur].filter((c) => !LANGS.includes(c)));
        CM.setSetting('translateTargets', ordered.join(','));
      };
      const nm = el('span', '', langName(code)); nm.lang = code;
      lab.append(cb, nm);
      list.appendChild(lab);
    }
    tgt.appendChild(list);
    tg.appendChild(tgt);
    body.appendChild(tg);

    body.appendChild(el('h3', '', t('settings.translate.anywhere')));
    body.appendChild(switchRow('bubble'));
    bubbleHk = CM.hotkeyRecorder('bubbleHotkey');
    body.appendChild(hotkeySub('bubble', bubbleHk));
    body.appendChild(switchRow('lens'));
    lensHk = CM.hotkeyRecorder('lensHotkey');
    body.appendChild(hotkeySub('lens', lensHk));

    panel.appendChild(body);
    CM.bindControls(panel);
    CM.fillForm();
    update(CM.S);
  }

  /** Enabled providers with their usable models: [{provider, models: [model]}]. */
  function usableModels() {
    const out = [];
    for (const p of (CM.ai && CM.ai.providers) || []) {
      if (!p.enabled) continue;
      const models = (p.models || []).filter((m) => !m.hidden && !m.missing);
      if (models.length) out.push({ provider: p, models });
    }
    return out;
  }

  function fillPicker(pick, S) {
    const groups = usableModels();
    const cur = S.translateModel ? (S.translateProvider || '') + '\n' + S.translateModel : '\n';
    pick.innerHTML = '';
    let found = false;
    if (!S.translateModel) { const o = el('option', '', t('settings.translate.model.choose')); o.value = '\n'; o.disabled = true; pick.appendChild(o); }
    for (const g of groups) {
      const og = el('optgroup'); og.label = g.provider.name || g.provider.id;
      for (const m of g.models) {
        const o = el('option', '', m.label || m.id); o.value = g.provider.id + '\n' + m.id; o.dir = 'auto';
        if (o.value === cur) found = true;
        og.appendChild(o);
      }
      pick.appendChild(og);
    }
    if (S.translateModel && !found) {
      const o = el('option', '', t('settings.translate.model.missing', { model: S.translateModel })); o.value = cur;
      pick.insertBefore(o, pick.firstChild);
    }
    pick.value = cur;
    return groups.length;
  }

  function update(S) {
    if (!root) return;
    const on = (k) => S['f.' + k] !== false;
    const trOn = on('translate');
    const body = root.querySelector('.t-body');
    body.classList.toggle('off', !trOn);
    if ('inert' in body) body.inert = !trOn;
    body.querySelectorAll(':scope > .row input, :scope > .row select, :scope > .row button, :scope > .t-notice button').forEach((c) => {
      c.disabled = !trOn;
    });
    ['bubble', 'lens'].forEach((name) => {
      const featOn = on(name);
      const rowOn = trOn && featOn;
      root.querySelectorAll('.f-hk[data-for="' + name + '"] .row').forEach((r) => {
        r.classList.toggle('off', !featOn);
        r.querySelectorAll('button, input, select').forEach((c) => { c.disabled = !rowOn; });
      });
    });
    if (bubbleHk) bubbleHk.refresh();
    if (lensHk) lensHk.refresh();
    const aiOn = on('ai');
    const llm = S.translateEngine === 'llm';
    root.querySelector('.t-ai-off').hidden = !(llm && !aiOn);
    root.querySelector('.t-model').hidden = !llm || !aiOn;
    root.querySelector('.t-fallback').hidden = !llm || !aiOn;
    const pick = root.querySelector('.t-model-pick');
    const n = fillPicker(pick, S);
    pick.hidden = !n && !S.translateModel;
    root.querySelector('.t-model-none').hidden = !!n;
    root.querySelector('.t-model-hint').hidden = !n;
    const targets = new Set(String(S.translateTargets || '').split(',').map((s) => s.trim()));
    root.querySelectorAll('.t-targets input').forEach((cb) => { cb.checked = targets.has(cb.value); });
  }

  CM.registerTab('translate', { mount, update });
})();
