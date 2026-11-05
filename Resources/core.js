// Shared page core: the bridge to the app, the live settings object, an event bus and the settings-tab registry.
// Loaded after i18n.js and before renderer.js / settings*.js.
//
//   CM.native({cmd, ...})        post a message to the app (see the bridge contract in the plan)
//   CM.S                         live settings (filled by monitor.setSettings)
//   CM.setSetting(key, value)    change a setting locally and in the app
//   CM.on(evt, fn) / CM.emit     events: 'settings' (S), 'lang' (lang), 'aiState' (state), 'aiEvent' (ev),
//                                'versionInfo' (info), 'translated' (result)
//   CM.ai                        last AI state from the app: {providers, presets}
//   CM.toast(msg)
//   CM.registerTab(id, {mount(panelEl), update?(S)})   fill one Settings tab (features, ai, about, ...)
(function () {
  'use strict';
  const listeners = {};
  const CM = {
    native(msg) {
      try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { (window.__sent = window.__sent || []).push(msg); }
    },
    S: {
      detect: 'majority', ratio: 0.3, rich: true, markdown: true, highlight: true, images: true, maxHistory: 50,
      font: 'system', theme: 'system', zoom: 1, onTop: false, allSpaces: false, keepHistory: true, hotkey: 'ctrl-opt-v',
      ignoredApps: '', loginItem: false, loginSupported: true, uiLang: 'system', uiLangResolved: 'en',
      'f.translate': true, 'f.ai': true, 'f.smartCards': true, 'f.smartJwt': true, 'f.smartJson': true, 'f.smartColor': true,
      'f.smartTime': true, 'f.smartBase64': true, 'f.smartLink': true, 'f.compare': true, 'f.linkPreview': true, 'f.copyRtl': true,
      translateEngine: 'apple', translateProvider: '', translateModel: '', translateFallbackApple: true,
      translateTargets: 'he,en,ar,ru,fr,es,de', modelRefreshHours: 24,
    },
    ai: { providers: [], presets: [] },
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, arg) { (listeners[evt] || []).forEach((fn) => { try { fn(arg); } catch (e) { console.error(evt, e); } }); },
    setSetting(key, value) { CM.S[key] = value; CM.native({ cmd: 'set', key, value }); CM.emit('settings', CM.S); },
    /** Feature switch: CM.feature('translate') reads S['f.translate']. */
    feature(name) { return CM.S['f.' + name] !== false; },
    toast(msg) {
      const el = document.getElementById('toast'); if (!el) return;
      el.textContent = msg; el.classList.add('show');
      clearTimeout(CM.toast.timer); CM.toast.timer = setTimeout(() => el.classList.remove('show'), 1400);
    },
    tabs: {},
    registerTab(id, def) { CM.tabs[id] = def; CM.emit('tabRegistered', id); },
  };
  window.CM = CM;
})();
