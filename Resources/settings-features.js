// Settings › Features tab: the feature switches (f.*). Switches are plain [data-key] controls bound by
// CM.bindControls. Translation settings live in their own tab (settings-translate.js). update(S) runs on
// 'settings' and 'aiState' (see settings.js).
(function () {
  'use strict';

  I18N.register({
    en: {
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
    },
    he: {
      'settings.features.translate': 'תרגום',
      'settings.features.translate.hint': 'כפתור התרגום, תצוגת התרגום ופריטי התפריט.',
      'settings.features.ai': 'בינה מלאכותית',
      'settings.features.ai.hint': 'שימוש בספקי ה־AI מלשונית AI (למשל לתרגום).',
      'settings.features.smartCards': 'כרטיסים חכמים',
      'settings.features.smartCards.hint': 'זיהוי תוכן מיוחד והצגת כרטיס עם פרטים מתחתיו.',
      'settings.features.smartJwt': 'JWT',
      'settings.features.smartJwt.hint': 'פענוח ה־header וה־payload והצגת תוקף.',
      'settings.features.smartJson': 'סייר JSON',
      'settings.features.smartJson.hint': 'עץ מתקפל עם סינון לפי נתיב.',
      'settings.features.smartColor': 'צבעים',
      'settings.features.smartColor.hint': 'דוגמית צבע וערכי HEX / RGB / HSL / Swift.',
      'settings.features.smartTime': 'תאריכים וחותמות זמן',
      'settings.features.smartTime.hint': 'שניות / מילישניות Unix ו־ISO 8601 כתאריך קריא.',
      'settings.features.smartBase64': 'Base64',
      'settings.features.smartBase64.hint': 'פענוח Base64 שמתפענח לטקסט קריא.',
      'settings.features.smartLink': 'קישורים',
      'settings.features.smartLink.hint': 'דומיין, נתיב ופרמטרים של כתובת שהועתקה.',
      'settings.features.compare': 'השוואה',
      'settings.features.compare.hint': 'הצגת ההבדלים בין שני פריטים בהיסטוריה.',
      'settings.features.linkPreview': 'תצוגה מקדימה לקישור',
      'settings.features.linkPreview.hint': 'כפתור „טען תצוגה מקדימה” בכרטיס קישור. הדף נטען רק אחרי לחיצה עליו.',
      'settings.features.copyRtl': 'העתקה עם סימני RTL',
      'settings.features.copyRtl.hint': 'כפתור Copy RTL ופריטי התפריט (מוסיף סימני כיווניות לשורות בעברית).',
    },
  });

  const SMART = ['smartJwt', 'smartJson', 'smartColor', 'smartTime', 'smartBase64', 'smartLink'];

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

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
    panel.appendChild(switchRow('translate'));
    panel.appendChild(switchRow('ai'));
    panel.appendChild(switchRow('smartCards'));
    const sub = el('div', 'f-sub');
    SMART.forEach((n) => sub.appendChild(switchRow(n)));
    panel.appendChild(sub);
    panel.appendChild(switchRow('compare'));
    panel.appendChild(switchRow('linkPreview'));
    panel.appendChild(switchRow('copyRtl'));
    CM.bindControls(panel);
    CM.fillForm();
    update(CM.S);
  }

  function update(S) {
    if (!root) return;
    // Smart sub-switches follow the main switch.
    const smartOn = S['f.smartCards'] !== false;
    root.querySelectorAll('.f-sub .row').forEach((r) => {
      r.classList.toggle('off', !smartOn);
      r.querySelector('input').disabled = !smartOn;
    });
  }

  CM.registerTab('features', { mount, update });
})();
