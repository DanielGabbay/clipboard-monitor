// Settings › Translation tab: engine (Apple on-device / AI model), the AI model picker, the on-device fallback and
// the "Translate to…" languages. The on/off switch itself (f.translate) lives in the Features tab; when it is off
// this tab shows a short notice with a button that turns it on. update(S) runs on 'settings' and 'aiState'.
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.tab.translate': 'Translation',
      'settings.translate.off': 'Translation is turned off.',
      'settings.translate.turnOn': 'Turn on translation',
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
    },
    he: {
      'settings.tab.translate': 'תרגום',
      'settings.translate.off': 'התרגום כבוי.',
      'settings.translate.turnOn': 'הפעל תרגום',
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

  function mount(panel) {
    root = panel;
    panel.classList.add('translate-tab');

    // Shown instead of the controls while the Translation feature is off.
    panel.appendChild(notice('t-off', t('settings.translate.off'),
      button(t('settings.translate.turnOn'), 'primary sm', () => CM.setSetting('f.translate', true))));

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
    root.querySelector('.t-off').hidden = trOn;
    root.querySelector('.t-body').hidden = !trOn;
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
