// Fake native side for previewing the Text Actions popover in a browser (dev/actions-preview.html).
// Console helpers: MOCKA.lang('he'|'en'), MOCKA.show(status), MOCKA.fail = true (make the next action fail),
// MOCKA.noModels = true (no AI model set up), MOCKA.source = '...'.
(function () {
  'use strict';
  const sent = (window.__sent = []);
  const M = (window.MOCKA = {
    fail: false, noModels: false, lang: null,
    source: 'We moved the meeting to thursday because the team need more time to finish the design and test everything.',
  });
  const ACTIONS = [
    { id: 'improve', kind: 'builtin', replaces: true }, { id: 'fix', kind: 'builtin', replaces: true },
    { id: 'simplify', kind: 'builtin', replaces: true }, { id: 'paraphrase', kind: 'builtin', replaces: true },
    { id: 'summarize', kind: 'builtin', replaces: false }, { id: 'explain', kind: 'builtin', replaces: false },
    { id: 'translate:he', kind: 'translate', lang: 'he', replaces: true }, { id: 'translate:en', kind: 'translate', lang: 'en', replaces: true },
    { id: 'translate:fr', kind: 'translate', lang: 'fr', replaces: true },
    { id: 'custom:1', kind: 'custom', title: 'Make it formal', replaces: true },
  ];
  const MODELS = [
    { value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' },
    { value: 'p1\nclaude-haiku-5-5', label: 'claude-haiku-5-5', group: 'Anthropic' },
  ];
  const OUT = {
    'translate:he': 'העברנו את הפגישה ליום חמישי כי הצוות צריך עוד זמן כדי לסיים את העיצוב ולבדוק הכול.',
    summarize: 'Meeting moved to Thursday; the team needs more time.',
  };
  const list = () => window.actions.show({ status: 'list', source: M.source, actions: ACTIONS,
    models: M.noModels ? [] : MODELS, model: M.noModels ? '' : MODELS[0].value, canReplace: true });
  M.lang = (l) => { window.actions.setup({ lang: l, margin: 10 }); list(); };
  M.show = (status) => (status === 'list' ? list() : window.actions.show({ status }));

  window.webkit = { messageHandlers: { app: { postMessage(m) {
    sent.push(m);
    if (m.cmd === 'run') {
      window.actions.show({ status: 'running', id: m.id, query: m.query });
      setTimeout(() => {
        if (M.noModels && !m.id.startsWith('translate:')) window.actions.show({ status: 'error', id: m.id, code: 'noModel', detail: 'No AI model is set up' });
        else if (M.fail) window.actions.show({ status: 'error', id: m.id, code: '', detail: 'The request timed out.' });
        else window.actions.show({ status: 'result', id: m.id, canReplace: true,
          text: OUT[m.id] || 'We moved the meeting to Thursday because the team needs more time to finish the design and test everything.' });
      }, 700);
    } else if (m.cmd === 'back') list();
  } } } };
  window.addEventListener('load', () => { window.actions.setup({ lang: 'en', margin: 10 }); list(); });
})();
