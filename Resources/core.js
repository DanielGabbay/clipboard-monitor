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
//   CM.registerTab(id, {mount(panelEl), update?(S)})   fill one Settings tab (features, translate, ai, about, ...)
//   CM.menuKeys(menuEl, {onClose, onKey?, focusFirst?})  arrow-key / Enter / Escape handling for a popup menu
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
      'f.smartTime': true, 'f.smartBase64': true, 'f.smartLink': true, 'f.compare': true, 'f.linkPreview': true, 'f.copyRtl': true, 'f.lens': true,
      translateEngine: 'apple', translateProvider: '', translateModel: '', translateFallbackApple: true,
      translateTargets: 'he,en,ar,ru,fr,es,de', modelRefreshHours: 24,
      lensTarget: '', lensAutoRefresh: true, lensHotkey: 'ctrl-opt-t',
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
    /**
     * Keyboard for a popup menu: ArrowUp/Down (wrapping), Home/End, Enter/Space (click the item), Escape (onClose).
     * Items are the [role=menuitem] descendants of container that are not hidden or aria-disabled; they get
     * tabindex=-1. Focuses the first item unless opts.focusFirst === false. opts.onKey(e, item) runs first and may
     * return true to say it handled the key (submenus). Returns {focusFirst(), destroy()}. Additive helper:
     * modules can use it when present, e.g. `if (CM.menuKeys) CM.menuKeys(menuEl, { onClose })`.
     */
    menuKeys(container, opts = {}) {
      const items = () => [...container.querySelectorAll('[role="menuitem"]')]
        .filter((el) => !el.hidden && el.getAttribute('aria-disabled') !== 'true');
      const focusAt = (i) => {
        const list = items(); if (!list.length) return;
        const el = list[((i % list.length) + list.length) % list.length];
        if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus();
      };
      function onKey(e) {
        const list = items(), i = list.indexOf(document.activeElement);
        if (opts.onKey && opts.onKey(e, list[i]) === true) { e.preventDefault(); e.stopPropagation(); return; }
        switch (e.key) {
          case 'ArrowDown': focusAt(i + 1); break;
          case 'ArrowUp': focusAt(i < 0 ? -1 : i - 1); break;
          case 'Home': focusAt(0); break;
          case 'End': focusAt(-1); break;
          case 'Enter': case ' ': if (i < 0) return; list[i].click(); break;
          case 'Escape': if (opts.onClose) opts.onClose(); break;
          default: return;
        }
        e.preventDefault(); e.stopPropagation();
      }
      items().forEach((el) => { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; });
      container.addEventListener('keydown', onKey);
      if (opts.focusFirst !== false) focusAt(0);
      return { focusFirst: () => focusAt(0), destroy: () => container.removeEventListener('keydown', onKey) };
    },
  };
  window.CM = CM;
})();
