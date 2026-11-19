// Fake native side for previewing the Text Actions popover in a browser (dev/actions-preview.html).
// Console helpers: MOCKA.lang('he'|'en'), MOCKA.show(status), MOCKA.fail = true (make the next action fail),
// MOCKA.noModels = true (no AI model set up), MOCKA.source = '...'.
(function () {
  'use strict';
  const sent = (window.__sent = []);
  const M = (window.MOCKA = {
    fail: false, noModels: false, lang: null, canReplace: true,
    source: 'We moved the meeting to thursday because the team need more time to finish the design and test everything.',
  });
  const ACTIONS = [
    { id: 'improve', kind: 'builtin', replaces: true }, { id: 'fix', kind: 'builtin', replaces: true },
    { id: 'simplify', kind: 'builtin', replaces: true }, { id: 'paraphrase', kind: 'builtin', replaces: true },
    { id: 'summarize', kind: 'builtin', replaces: false }, { id: 'explain', kind: 'builtin', replaces: false },
    { id: 'flipKeyboard', kind: 'local', replaces: true },
    { id: 'wrapRtl', kind: 'local', replaces: true },
    { id: 'cleanSpaces', kind: 'local', replaces: true },
    { id: 'translate:he', kind: 'translate', lang: 'he', replaces: true }, { id: 'translate:en', kind: 'translate', lang: 'en', replaces: true },
    { id: 'translate:fr', kind: 'translate', lang: 'fr', replaces: true },
    { id: 'custom:1', kind: 'custom', title: 'Make it formal', icon: 'mail', replaces: true },
  ];
  const MODELS = [
    { value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' },
    { value: 'p1\nclaude-haiku-5-5', label: 'claude-haiku-5-5', group: 'Anthropic' },
  ];
  const OUT = {
    'translate:he': 'העברנו את הפגישה ליום חמישי כי הצוות צריך עוד זמן כדי לסיים את העיצוב ולבדוק הכול.',
    summarize: 'Meeting moved to Thursday; the team needs more time.',
  };

  let currentCanReplace = true;
  function patchShow() {
    if (!window.actions || window.actions.__patched) return;
    const orig = window.actions.show;
    window.actions.show = function (m) {
      if (m && m.canReplace !== undefined) currentCanReplace = !!m.canReplace;
      return orig.apply(this, arguments);
    };
    window.actions.__patched = true;
  }

  function mockWrapRtl(text) {
    let inFence = false;
    return text.split('\n').map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !/[\u0590-\u05FF\u0600-\u06FF]/.test(line)) return line;
      const m = line.match(/^(\s*(?:[-*+]\s+|\d+[.)]\s+|>+\s*|#{1,6}\s+|\|\s*)*)(.*)$/);
      if (!m || !m[2].trim()) return line;
      return m[1] + '\u2067' + m[2] + '\u2069';
    }).join('\n');
  }

  function mockCleanSpaces(text) {
    return text
      .split('\n')
      .map((line) => line.trimEnd().replace(/[ \t]+/g, ' '))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function mockFlipKeyboard(text) {
    const en2he = {
      a: 'ש', b: 'נ', c: 'ב', d: 'ג', e: 'ק', f: 'כ', g: 'ע', h: 'י', i: 'ן', j: 'ח', k: 'ל', l: 'ך',
      m: 'צ', n: 'מ', o: 'ם', p: 'פ', q: '/', r: 'ר', s: 'ד', t: 'א', u: 'ו', v: 'ה', w: "'", x: 'ס',
      y: 'ט', z: 'ז',
      ',': ',', '.': 'ץ', '/': '.', ';': 'ף', "'": ','
    };
    const he2en = {};
    for (const [k, v] of Object.entries(en2he)) { if (!he2en[v]) he2en[v] = k; }
    he2en['ץ'] = 'm'; he2en['ף'] = ';'; he2en['ן'] = 'i'; he2en['ם'] = 'o'; he2en['ך'] = 'l';
    const isHe = /[\u0590-\u05FF]/.test(text);
    return [...text].map((c) => (isHe ? (he2en[c] || c) : (en2he[c.toLowerCase()] || c))).join('');
  }

  const list = () => {
    patchShow();
    window.actions.show({
      status: 'list', source: M.source, actions: ACTIONS,
      models: M.noModels ? [] : MODELS, model: M.noModels ? '' : MODELS[0].value, canReplace: M.canReplace
    });
  };
  M.lang = (l) => { patchShow(); window.actions.setup({ lang: l, margin: 10 }); list(); };
  M.show = (status) => {
    patchShow();
    return status === 'list' ? list() : window.actions.show({ status });
  };

  window.webkit = { messageHandlers: { app: { postMessage(m) {
    sent.push(m);
    patchShow();
    if (m.cmd === 'run') {
      window.actions.show({ status: 'running', id: m.id, query: m.query });
      setTimeout(() => {
        const src = m.source || M.source || '';
        if (m.id === 'flipKeyboard') {
          const flipped = mockFlipKeyboard(src);
          window.actions.show({ status: 'result', id: m.id, canReplace: currentCanReplace, text: flipped });
          return;
        } else if (m.id === 'wrapRtl') {
          const wrapped = mockWrapRtl(src);
          window.actions.show({ status: 'result', id: m.id, canReplace: currentCanReplace, text: wrapped });
          return;
        } else if (m.id === 'cleanSpaces') {
          const cleaned = mockCleanSpaces(src);
          window.actions.show({ status: 'result', id: m.id, canReplace: currentCanReplace, text: cleaned });
          return;
        }
        if (M.noModels && !m.id.startsWith('translate:')) window.actions.show({ status: 'error', id: m.id, code: 'noModel', detail: 'No AI model is set up' });
        else if (M.fail) window.actions.show({ status: 'error', id: m.id, code: '', detail: 'The request timed out.' });
        else window.actions.show({ status: 'result', id: m.id, canReplace: currentCanReplace,
          text: OUT[m.id] || 'We moved the meeting to Thursday because the team needs more time to finish the design and test everything.' });
      }, 700);
    } else if (m.cmd === 'back') list();
  } } } };
  window.addEventListener('load', () => { patchShow(); window.actions.setup({ lang: 'en', margin: 10 }); list(); });
})();
