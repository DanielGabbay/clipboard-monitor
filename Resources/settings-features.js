// Settings › Features tab: feature switches (f.*) and translation settings (engine, provider/model, fallback,
// target languages). Switches are plain [data-key] controls bound by CM.bindControls; the model picker and the
// language list are wired here. update(S) runs on 'settings' and 'aiState' (see settings.js).
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.features.title': 'Features',
      'settings.features.translate': 'Translation',
      'settings.features.translate.hint': 'Translate button, translated view and menu entries.',
      'settings.features.ai': 'AI',
      'settings.features.ai.hint': 'Use the AI providers from the AI tab (for example, for translation).',
      'settings.features.smartCards': 'Smart cards',
      'settings.features.smartCards.hint': 'Recognize special content and show a card with details under it.',
      'settings.features.smartJwt': 'JWT',
      'settings.features.smartJwt.hint': 'Decode the header and payload, show expiry.',
      'settings.features.smartJson': 'JSON explorer',
      'settings.features.smartJson.hint': 'Collapsible tree with a path filter.',
      'settings.features.smartColor': 'Colors',
      'settings.features.smartColor.hint': 'Swatch and HEX / RGB / HSL / Swift values.',
      'settings.features.smartTime': 'Dates and timestamps',
      'settings.features.smartTime.hint': 'Unix seconds / milliseconds and ISO 8601 as a readable date.',
      'settings.features.smartBase64': 'Base64',
      'settings.features.smartBase64.hint': 'Decode Base64 that turns into readable text.',
      'settings.features.smartLink': 'Links',
      'settings.features.smartLink.hint': 'Host, path and query parameters of a copied URL.',
      'settings.features.compare': 'Compare',
      'settings.features.compare.hint': 'Show the differences between two history items.',
      'settings.features.linkPreview': 'Link preview',
      'settings.features.linkPreview.hint': 'A "Load preview" button on link cards. The page is fetched only when you click it.',
      'settings.features.copyRtl': 'Copy with RTL marks',
      'settings.features.copyRtl.hint': 'The Copy RTL button and menu entries (adds direction marks to Hebrew lines).',
      'settings.translate.title': 'Translation',
      'settings.translate.engine': 'Engine',
      'settings.translate.engine.apple': 'Apple on-device',
      'settings.translate.engine.llm': 'AI model',
      'settings.translate.model': 'Model',
      'settings.translate.model.hint': 'Only enabled providers and visible models are listed.',
      'settings.translate.model.none': 'No AI models are available yet.',
      'settings.translate.model.openAi': 'Add a provider in the AI tab',
      'settings.translate.model.choose': 'Choose a model…',
      'settings.translate.model.missing': '{model} (not available)',
      'settings.translate.aiOff': 'AI is turned off, so the AI engine is not available. On-device translation is used.',
      'settings.translate.fallback': 'Fall back to on-device translation',
      'settings.translate.fallback.hint': 'When the AI model fails, translate with Apple on-device instead.',
      'settings.translate.targets': 'Languages for "Translate to…"',
      'settings.translate.targets.hint': 'The automatic button always translates between Hebrew and English.',
    },
    he: {
      'settings.features.title': 'פיצ\'רים',
      'settings.features.translate': 'תרגום',
      'settings.features.translate.hint': 'כפתור התרגום, תצוגת התרגום ופריטי התפריט.',
      'settings.features.ai': 'בינה מלאכותית',
      'settings.features.ai.hint': 'שימוש בספקי ה-AI מהטאב AI (למשל לתרגום).',
      'settings.features.smartCards': 'כרטיסים חכמים',
      'settings.features.smartCards.hint': 'זיהוי תוכן מיוחד והצגת כרטיס עם פרטים מתחתיו.',
      'settings.features.smartJwt': 'JWT',
      'settings.features.smartJwt.hint': 'פענוח ה-header וה-payload והצגת תוקף.',
      'settings.features.smartJson': 'סייר JSON',
      'settings.features.smartJson.hint': 'עץ מתקפל עם סינון לפי נתיב.',
      'settings.features.smartColor': 'צבעים',
      'settings.features.smartColor.hint': 'דוגמית צבע וערכי HEX / RGB / HSL / Swift.',
      'settings.features.smartTime': 'תאריכים וחותמות זמן',
      'settings.features.smartTime.hint': 'שניות / מילישניות Unix ו-ISO 8601 כתאריך קריא.',
      'settings.features.smartBase64': 'Base64',
      'settings.features.smartBase64.hint': 'פענוח Base64 שמתפענח לטקסט קריא.',
      'settings.features.smartLink': 'קישורים',
      'settings.features.smartLink.hint': 'דומיין, נתיב ופרמטרים של כתובת שהועתקה.',
      'settings.features.compare': 'השוואה',
      'settings.features.compare.hint': 'הצגת ההבדלים בין שני פריטים בהיסטוריה.',
      'settings.features.linkPreview': 'תצוגה מקדימה לקישור',
      'settings.features.linkPreview.hint': 'כפתור "טען תצוגה מקדימה" בכרטיס קישור. הדף נטען רק כשלוחצים עליו.',
      'settings.features.copyRtl': 'העתקה עם סימני RTL',
      'settings.features.copyRtl.hint': 'כפתור Copy RTL ופריטי התפריט (מוסיף סימני כיווניות לשורות בעברית).',
      'settings.translate.title': 'תרגום',
      'settings.translate.engine': 'מנוע',
      'settings.translate.engine.apple': 'Apple במכשיר',
      'settings.translate.engine.llm': 'מודל AI',
      'settings.translate.model': 'מודל',
      'settings.translate.model.hint': 'מוצגים רק ספקים פעילים ומודלים גלויים.',
      'settings.translate.model.none': 'עדיין אין מודלי AI זמינים.',
      'settings.translate.model.openAi': 'הוספת ספק בטאב AI',
      'settings.translate.model.choose': 'בחירת מודל…',
      'settings.translate.model.missing': '{model} (לא זמין)',
      'settings.translate.aiOff': 'ה-AI כבוי, ולכן מנוע ה-AI לא זמין. התרגום ייעשה במכשיר.',
      'settings.translate.fallback': 'מעבר לתרגום במכשיר',
      'settings.translate.fallback.hint': 'כשמודל ה-AI נכשל, לתרגם עם Apple במכשיר.',
      'settings.translate.targets': 'שפות עבור "תרגם ל…"',
      'settings.translate.targets.hint': 'הכפתור האוטומטי תמיד מתרגם בין עברית לאנגלית.',
    },
  });

  const LANGS = ['he', 'en', 'ar', 'ru', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'uk', 'tr', 'zh', 'ja', 'ko', 'hi', 'id', 'th', 'vi'];
  const SMART = ['smartJwt', 'smartJson', 'smartColor', 'smartTime', 'smartBase64', 'smartLink'];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function langName(code) {
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }

  /** A settings row: label + hint on the start side, a switch bound to `key` on the end side. */
  function switchRow(name, cls) {
    const row = el('div', 'row' + (cls ? ' ' + cls : ''));
    row.dataset.feature = name;
    const txt = el('span');
    txt.append(el('span', '', t('settings.features.' + name)), el('small', '', t('settings.features.' + name + '.hint')));
    const sw = el('input', 'switch'); sw.type = 'checkbox'; sw.dataset.key = 'f.' + name;
    row.append(txt, sw);
    return row;
  }

  let root = null;

  function mount(panel) {
    root = panel;
    panel.classList.add('features-tab');
    panel.appendChild(el('h3', '', t('settings.features.title')));
    panel.appendChild(switchRow('translate'));
    panel.appendChild(switchRow('ai'));
    panel.appendChild(switchRow('smartCards'));
    const sub = el('div', 'f-sub');
    SMART.forEach((n) => sub.appendChild(switchRow(n)));
    panel.appendChild(sub);
    panel.appendChild(switchRow('compare'));
    panel.appendChild(switchRow('linkPreview'));
    panel.appendChild(switchRow('copyRtl'));

    // ---- translation ----
    const tr = el('div', 'f-translate');
    tr.appendChild(el('h3', '', t('settings.translate.title')));

    const engRow = el('div', 'row');
    engRow.appendChild(el('span', '', t('settings.translate.engine')));
    const seg = el('div', 'seg'); seg.dataset.key = 'translateEngine';
    for (const v of ['apple', 'llm']) { const b = el('button', '', t('settings.translate.engine.' + v)); b.dataset.v = v; seg.appendChild(b); }
    engRow.appendChild(seg);
    tr.appendChild(engRow);

    tr.appendChild(el('div', 'f-notice', t('settings.translate.aiOff')));

    const modelRow = el('div', 'row f-model');
    const mtxt = el('span');
    mtxt.append(el('span', '', t('settings.translate.model')), el('small', 'f-model-hint', t('settings.translate.model.hint')));
    const pick = el('select', 'f-model-pick');
    pick.onchange = () => {
      const [prov, ...rest] = pick.value.split('\n');
      CM.setSetting('translateProvider', prov || '');
      CM.setSetting('translateModel', rest.join('\n'));
    };
    const none = el('span', 'f-model-none');
    none.appendChild(el('span', 'note', t('settings.translate.model.none') + ' '));
    const link = el('a', '', t('settings.translate.model.openAi')); link.href = '#';
    link.onclick = (e) => { e.preventDefault(); e.stopPropagation(); const b = document.querySelector('#settings .tabs [data-tab="ai"]'); if (b) b.click(); };
    none.appendChild(link);
    mtxt.appendChild(none);
    modelRow.append(mtxt, pick);
    tr.appendChild(modelRow);

    const fb = el('div', 'row f-fallback');
    const fbt = el('span');
    fbt.append(el('span', '', t('settings.translate.fallback')), el('small', '', t('settings.translate.fallback.hint')));
    const fbs = el('input', 'switch'); fbs.type = 'checkbox'; fbs.dataset.key = 'translateFallbackApple';
    fb.append(fbt, fbs);
    tr.appendChild(fb);

    const tg = el('div', 'row f-targets-row');
    const tgt = el('span');
    tgt.append(el('span', '', t('settings.translate.targets')), el('small', '', t('settings.translate.targets.hint')));
    const list = el('div', 'f-targets');
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
    tr.appendChild(tg);

    panel.appendChild(tr);
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
    const cur = (S.translateProvider || '') + '\n' + (S.translateModel || '');
    pick.innerHTML = '';
    let found = false;
    if (!S.translateModel) { const o = el('option', '', t('settings.translate.model.choose')); o.value = '\n'; o.disabled = true; pick.appendChild(o); }
    for (const g of groups) {
      const og = el('optgroup'); og.label = g.provider.name || g.provider.id;
      for (const m of g.models) {
        const o = el('option', '', m.label || m.id); o.value = g.provider.id + '\n' + m.id;
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
    // Smart sub-switches follow the main switch.
    const smartOn = on('smartCards');
    root.querySelectorAll('.f-sub .row').forEach((r) => {
      r.classList.toggle('off', !smartOn);
      r.querySelector('input').disabled = !smartOn;
    });
    const tr = root.querySelector('.f-translate');
    tr.hidden = !on('translate');
    const aiOn = on('ai');
    const llm = S.translateEngine === 'llm';
    root.querySelector('.f-notice').hidden = !(llm && !aiOn);
    root.querySelector('.f-model').hidden = !llm || !aiOn;
    root.querySelector('.f-fallback').hidden = !llm || !aiOn;
    const n = fillPicker(root.querySelector('.f-model-pick'), S);
    root.querySelector('.f-model-pick').hidden = !n && !S.translateModel;
    root.querySelector('.f-model-none').hidden = !!n;
    root.querySelector('.f-model-hint').hidden = !n;
    const targets = new Set(String(S.translateTargets || '').split(',').map((s) => s.trim()));
    root.querySelectorAll('.f-targets input').forEach((cb) => { cb.checked = targets.has(cb.value); });
  }

  CM.registerTab('features', { mount, update });
})();
