// Fake native side for previewing the UI in a browser (dev/preview.html). Implements the bridge contract from the
// plan with in-memory data: settings, ai.* (providers / models / checks), translate, version.
// Console helpers: MOCK.lang('he'|'en'), MOCK.push(text), MOCK.state(), MOCK.fail = true (make checks fail).
(function () {
  'use strict';
  const sent = (window.__sent = []);
  const later = (fn, ms = 300) => setTimeout(fn, ms);
  const call = (fn, arg) => later(() => { const [a, b] = fn.split('.'); window[a] && window[a][b] && window[a][b](arg); }, 0);

  const DEFAULT_ACTIONS = [
    ['improve', true], ['fix', true], ['simplify', true], ['paraphrase', true], ['summarize', false], ['explain', false],
    ['flipKeyboard', true, 'local'], ['wrapRtl', true, 'local'], ['cleanSpaces', true, 'local']
  ].map(([id, replaces, kind]) => ({
    id, name: '', icon: id, prompt: kind === 'local' ? '' : 'Default prompt for ' + id + '.', replaces, builtin: true,
    kind: kind || 'builtin', local: kind === 'local'
  }));
  const S = { uiLang: 'system', uiLangResolved: 'en', loginSupported: true, actionsDefaults: DEFAULT_ACTIONS, actionsLibrary: DEFAULT_ACTIONS };
  let actionsLog = [
    { id: 'l1', time: Date.now() - 5 * 60e3, action: 'fix', title: '', query: '', app: 'TextEdit', model: 'Anthropic / claude-sonnet-5-5', ms: 1840,
      source: 'We moved the meeting to thursday because the team need more time.', result: 'We moved the meeting to Thursday because the team needs more time.' },
    { id: 'l2', time: Date.now() - 26 * 3600e3, action: 'translate:he', title: '', query: '', app: 'Safari', model: '', ms: 420,
      source: 'The help pages go live next week.', result: 'דפי העזרה עולים לאוויר בשבוע הבא.' },
    { id: 'l3', time: Date.now() - 27 * 3600e3, action: 'ask', title: '', query: 'make it a haiku', app: 'Notes', model: 'Anthropic / claude-haiku-5-5', ms: 9000,
      source: 'The new signup flow is in review.', error: 'The request timed out.' },
  ];
  const presets = [
    { kind: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', needsKey: true },
    { kind: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com', needsKey: true },
    { kind: 'gemini', name: 'Google Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true },
    { kind: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', needsKey: true },
    { kind: 'ollama', name: 'Ollama', baseURL: 'http://localhost:11434/v1', needsKey: false },
    { kind: 'lmstudio', name: 'LM Studio', baseURL: 'http://localhost:1234/v1', needsKey: false },
    { kind: 'custom', name: 'OpenAI-compatible', baseURL: '', needsKey: false },
  ];
  const now = () => Date.now();
  let providers = [
    { id: 'p1', name: 'Anthropic', kind: 'anthropic', baseURL: 'https://api.anthropic.com', enabled: true, autoRefresh: true,
      lastRefresh: now() - 3600e3, hasKey: true, keyHint: '…a1b2', lastCheck: { ok: true, ms: 312, time: now() - 600e3 },
      models: [
        { id: 'claude-sonnet-5-5', hidden: false, isNew: false, missing: false },
        { id: 'claude-haiku-5-5', hidden: false, isNew: false, missing: false },
        { id: 'claude-opus-5-5', hidden: true, isNew: true, missing: false },
      ] },
    { id: 'p2', name: 'Ollama (local)', kind: 'ollama', baseURL: 'http://localhost:11434/v1', enabled: false, autoRefresh: false,
      lastRefresh: 0, hasKey: false, keyHint: '', lastCheck: { ok: false, ms: 4, error: 'Could not connect to the server.', time: now() - 86400e3 },
      models: [{ id: 'llama3.2:3b', hidden: false, isNew: false, missing: false }] },
  ];
  const state = () => JSON.parse(JSON.stringify({ providers, presets }));
  const broadcast = () => call('monitor.aiState', state());
  const find = (id) => providers.find((p) => p.id === id);

  function handle(m) {
    switch (m.cmd) {
      case 'set':
        S[m.key] = m.value;
        if (m.key === 'actionsList') {
          let list = []; try { list = JSON.parse(m.value); } catch (e) { /* keep the defaults */ }
          S.actionsLibrary = list.length ? list.map((a) => Object.assign({ builtin: DEFAULT_ACTIONS.some((d) => d.id === a.id) }, a)) : DEFAULT_ACTIONS;
        }
        if (m.key === 'uiLang') S.uiLangResolved = m.value === 'system' ? (navigator.language.startsWith('he') ? 'he' : 'en') : m.value;
        call('monitor.setSettings', S);
        break;
      case 'actionsLog.list': call('monitor.actionsLog', { items: actionsLog }); break;
      case 'actionsLog.delete': actionsLog = actionsLog.filter((e) => e.id !== m.id); call('monitor.actionsLog', { items: actionsLog }); break;
      case 'actionsLog.clear': actionsLog = []; call('monitor.actionsLog', { items: actionsLog }); break;
      case 'version':
        call('monitor.versionInfo', { version: '1.2.0', build: '42', commit: '993371a', buildDate: new Date().toISOString(),
          dirty: false, os: 'Version 27.2 (Build 26B5091g)', changelog: '## [1.2.0]\n### Added\n- Hebrew interface\n- AI providers\n' });
        break;
      case 'translate':
        later(() => call('monitor.translated', { req: m.req, from: 'en', to: m.target || 'he', engine: S.translateEngine || 'apple',
          model: S.translateModel || '', text: '[' + (m.target || 'he') + '] ' + m.text }), 700);
        break;
      case 'ai.list': broadcast(); break;
      case 'ai.save': {
        const p = Object.assign({}, m.provider);
        if (!p.id) { p.id = 'p' + Math.random().toString(36).slice(2, 7); p.models = p.models || []; p.lastCheck = null; p.lastRefresh = 0; }
        const old = find(p.id);
        p.hasKey = m.apiKey === null ? false : m.apiKey ? true : !!(old && old.hasKey);
        p.keyHint = p.hasKey ? (m.apiKey ? '…' + m.apiKey.slice(-4) : old.keyHint) : '';
        if (old) Object.assign(old, p); else providers.push(Object.assign({ enabled: true, autoRefresh: true, models: [] }, p));
        broadcast(); break;
      }
      case 'ai.delete': providers = providers.filter((p) => p.id !== m.id); broadcast(); break;
      case 'ai.toggle': find(m.id).enabled = !!m.enabled; broadcast(); break;
      case 'ai.refreshModels': later(() => {
        const p = find(m.id); if (!p) return;
        const id = 'new-model-' + Math.floor(Math.random() * 100);
        if (MOCK.fail) { call('monitor.aiEvent', { id: m.id, kind: 'refresh', error: 'HTTP 401: invalid x-api-key' }); return; }
        p.models.push({ id, hidden: true, isNew: true, missing: false }); p.lastRefresh = now();
        broadcast(); call('monitor.aiEvent', { id: m.id, kind: 'refresh', added: [id] });
      }, 600); break;
      case 'ai.setModel': {
        const md = find(m.id).models.find((x) => x.id === m.modelId);
        if ('hidden' in m) { md.hidden = !!m.hidden; md.isNew = false; }
        if ('label' in m) md.label = m.label;
        broadcast(); break;
      }
      case 'ai.setModels': find(m.id).models.forEach((x) => { if (!m.onlyNew || x.isNew) { x.hidden = !!m.hidden; x.isNew = false; } }); broadcast(); break;
      case 'ai.checkProvider': case 'ai.checkModel': later(() => {
        const p = find(m.id); const ok = !MOCK.fail && p.enabled;
        const res = { ok, ms: Math.floor(Math.random() * 800) + 80, error: ok ? undefined : 'HTTP 401: invalid x-api-key', time: now() };
        if (m.cmd === 'ai.checkProvider') p.lastCheck = res; else p.models.find((x) => x.id === m.modelId).lastCheck = res;
        broadcast(); call('monitor.aiEvent', Object.assign({ id: m.id, modelId: m.modelId, kind: 'check' }, res));
      }, 500); break;
      default: break;
    }
  }

  window.webkit = { messageHandlers: { app: { postMessage(m) { sent.push(m); console.debug('→ native', m); handle(m); } } } };
  window.MOCK = {
    fail: false,
    lang(l) { handle({ cmd: 'set', key: 'uiLang', value: l }); },
    push(text) { call('monitor.push', { id: String(now()), time: now(), kind: 'text', text, app: 'Mock' }); },
    state,
  };
  window.addEventListener('load', () => {
    S.uiLangResolved = navigator.language.startsWith('he') ? 'he' : 'en';
    call('monitor.setSettings', S);
    broadcast();
    MOCK.push('# Hello\nשלום **עולם** — mixed text\n\n- item one\n- פריט שני');
  });
})();
