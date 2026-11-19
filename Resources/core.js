// Shared page core: the bridge to the app, the live settings object, an event bus and the settings-tab registry.
// Loaded after i18n.js and before renderer.js / settings*.js.
//
//   CM.native({cmd, ...})        post a message to the app (see the bridge contract in the plan)
//   CM.S                         live settings (filled by monitor.setSettings)
//   CM.setSetting(key, value)    change a setting locally and in the app
//   CM.on(evt, fn) / CM.emit     events: 'settings' (S), 'lang' (lang), 'aiState' (state), 'aiEvent' (ev),
//                                'versionInfo' (info), 'translated' (result), 'hotkeyRejected' (info)
//   CM.ai                        last AI state from the app: {providers, presets}
//   CM.toast(msg)
//   CM.registerTab(id, {mount(panelEl), update?(S)})   fill one Settings tab (features, translate, ai, about, ...)
//   CM.menuKeys(menuEl, {onClose, onTab?, onForward?, onBack?, onKey?, directOnly?, focusFirst?})
//   CM.hotkeyLabel(v) / CM.hotkeyRecorder(key)         shared shortcut label & recorder control
(function () {
  'use strict';
  const listeners = {};
  const KEY_RE = /^(Key[A-Z]|Digit\d|F([1-9]|1[0-2])|Space|Enter|Tab|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backslash|Backquote|Arrow(Left|Right|Up|Down))$/;
  const KEY_LABEL = {
    Space: 'Space', Enter: '↩', Tab: '⇥', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  };
  const MODS = [['ctrl', '⌃'], ['opt', '⌥'], ['shift', '⇧'], ['cmd', '⌘']];
  const VALID_MODS = new Set(['ctrl', 'opt', 'shift', 'cmd']);

  function normalizeKeyCode(raw) {
    if (!raw) return '';
    if (KEY_RE.test(raw)) return raw;
    if (/^[a-z]$/i.test(raw)) return 'Key' + raw.toUpperCase();
    if (/^\d$/.test(raw)) return 'Digit' + raw;
    const lower = raw.toLowerCase();
    for (const k of Object.keys(KEY_LABEL)) {
      if (k.toLowerCase() === lower) return k;
    }
    return '';
  }

  function hotkeyCombo(v) {
    if (!v || v === 'off') return '';
    const str = String(v);
    let parts;
    if (str.includes('+')) parts = str.split('+');
    else if (str.includes('-')) parts = str.split('-');
    else return '';
    const rawCode = parts.pop();
    const code = str.includes('+') ? rawCode : normalizeKeyCode(rawCode);
    if (!parts.length || !KEY_RE.test(code)) return '';
    if (!parts.every((m) => VALID_MODS.has(m))) return '';
    if (!parts.some((m) => m === 'ctrl' || m === 'opt' || m === 'cmd')) return '';
    const key = KEY_LABEL[code] || code.replace(/^(Key|Digit)/, '');
    return MODS.filter(([m]) => parts.includes(m)).map(([, s]) => s).join('') + key;
  }

  const recorders = new Set();
  const menuKeyCleanups = new WeakMap();
  function refreshRecorders() {
    for (const rec of recorders) {
      if (rec.wrap.isConnected) { rec.seen = true; rec.refresh(); }
      else if (rec.seen) { rec.stop(); recorders.delete(rec); }
    }
  }

  const CM = {
    native(msg) {
      try { window.webkit.messageHandlers.app.postMessage(msg); } catch (e) { (window.__sent = window.__sent || []).push(msg); }
    },
    S: {
      detect: 'majority', ratio: 0.3, rich: true, markdown: true, highlight: true, images: true, maxHistory: 50,
      font: 'system', theme: 'system', zoom: 1, onTop: false, allSpaces: false, keepHistory: true, hotkey: 'ctrl-opt-v',
      ignoredApps: '', loginItem: false, loginSupported: true, uiLang: 'system', uiLangResolved: 'en',
      'f.translate': true, 'f.ai': true, 'f.smartCards': true, 'f.smartJwt': true, 'f.smartJson': true, 'f.smartColor': true,
      'f.smartTime': true, 'f.smartBase64': true, 'f.smartLink': true, 'f.smartCron': true, 'f.smartCurl': true,
      'f.compare': true, 'f.linkPreview': true, 'f.copyRtl': true, 'f.lens': true, 'f.bubble': true, 'f.actions': true,
      translateEngine: 'apple', translateProvider: '', translateModel: '', translateFallbackApple: true,
      translateTargets: 'he,en,ar,ru,fr,es,de', modelRefreshHours: 24,
      lensTarget: '', lensAutoRefresh: true, lensMode: 'reading', lensHotkey: 'ctrl-opt-cmd-t', bubbleHotkey: 'ctrl-opt-t',
      actionsHotkey: 'ctrl+opt+KeyA', flipHotkey: 'ctrl+opt+KeyK', actionsButton: true, menuBarIcon: true, actionsProvider: '', actionsModel: '', actionsList: '[]', actionsLogKeep: true, actionsLibrary: [], actionsDefaults: [],
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
     * Keyboard for a popup menu: ArrowUp/Down (wrapping), Home/End, Enter/Space (click the item), Escape (onClose),
     * Tab (onTab), and RTL-aware ArrowLeft/Right (onForward on [aria-haspopup], onBack).
     * Items are [role=menuitem] descendants (or direct children when opts.directOnly) that are not disabled,
     * hidden, or aria-disabled. Focuses the first item unless opts.focusFirst === false.
     * opts.onKey(e, item) runs first and may return true to consume the key. Returns {focusFirst(), destroy()}.
     */
    menuKeys(container, opts = {}) {
      const prevDestroy = menuKeyCleanups.get(container);
      if (prevDestroy) prevDestroy();
      const sel = opts.directOnly ? ':scope > [role="menuitem"]' : '[role="menuitem"]';
      const items = () => [...container.querySelectorAll(sel)]
        .filter((el) => !el.disabled && !el.hidden && el.getAttribute('aria-disabled') !== 'true');
      const focusAt = (i) => {
        const list = items(); if (!list.length) return;
        const el = list[((i % list.length) + list.length) % list.length];
        if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus();
      };
      function onKey(e) {
        const list = items(), i = list.indexOf(document.activeElement);
        if (opts.onKey && opts.onKey(e, list[i]) === true) { e.preventDefault(); e.stopPropagation(); return; }
        const dir = (window.I18N && I18N.dir) || (typeof getComputedStyle === 'function' ? getComputedStyle(container).direction : '') || 'ltr';
        const fwdKey = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
        const backKey = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
        switch (e.key) {
          case 'ArrowDown': focusAt(i + 1); break;
          case 'ArrowUp': focusAt(i < 0 ? -1 : i - 1); break;
          case 'Home': focusAt(0); break;
          case 'End': focusAt(-1); break;
          case 'Enter': case ' ': if (i < 0) return; list[i].click(); break;
          case 'Escape': if (opts.onClose) opts.onClose(); break;
          case 'Tab': if (opts.onTab) opts.onTab(e); else return; break;
          default:
            if (e.key === fwdKey && opts.onForward && list[i] && list[i].getAttribute('aria-haspopup')) opts.onForward(list[i]);
            else if (e.key === backKey && opts.onBack) opts.onBack();
            else return;
        }
        e.preventDefault(); e.stopPropagation();
      }
      items().forEach((el) => { if (!el.hasAttribute('tabindex')) el.tabIndex = -1; });
      container.addEventListener('keydown', onKey);
      if (opts.focusFirst !== false) focusAt(0);
      const destroy = () => {
        container.removeEventListener('keydown', onKey);
        if (menuKeyCleanups.get(container) === destroy) menuKeyCleanups.delete(container);
      };
      menuKeyCleanups.set(container, destroy);
      return { focusFirst: () => focusAt(0), destroy };
    },
    hotkeyLabel(v) {
      return hotkeyCombo(v) || t('hotkey.off');
    },
    hotkeyRecorder(key) {
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
      const wrap = el('span', 'hk');
      const btn = el('button', 'hk-rec'); btn.type = 'button';
      const clear = el('button', 'ghost hk-clear', '×'); clear.type = 'button';
      let recording = false;
      // A key combination reads left to right; the prompts are sentences in the interface language.
      const show = (text, combo) => { btn.textContent = text; if (combo) btn.dir = 'ltr'; else btn.removeAttribute('dir'); };
      const showCurrent = () => {
        const combo = hotkeyCombo(CM.S[key]);
        show(combo || t('hotkey.off'), !!combo);
        clear.hidden = !combo;
        clear.title = t('hotkey.clear');
        clear.setAttribute('aria-label', t('hotkey.clear'));
      };
      // WebKit does not focus a button on click, so the keys are caught on the document while recording.
      function onKey(e) {
        if (!wrap.isConnected) { stop(); return; }
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { stop(); return; }
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        if (!KEY_RE.test(e.code)) return;
        if (!(e.ctrlKey || e.altKey || e.metaKey)) { show(t('hotkey.needMod'), false); return; }
        const mods = [e.ctrlKey && 'ctrl', e.altKey && 'opt', e.shiftKey && 'shift', e.metaKey && 'cmd'].filter(Boolean);
        stop();
        CM.setSetting(key, mods.concat(e.code).join('+'));
      }
      function onClickAway(e) { if (!wrap.isConnected || !wrap.contains(e.target)) stop(); }
      function stop() {
        if (!recording) return;
        recording = false; btn.classList.remove('on');
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onClickAway, true);
        showCurrent();
      }
      btn.onclick = () => {
        if (recording) { stop(); return; }
        recording = true; btn.classList.add('on');
        show(t('hotkey.recording'), false);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onClickAway, true);
      };
      clear.onclick = () => { stop(); CM.setSetting(key, 'off'); };
      wrap.append(btn, clear);
      const refresh = () => { if (!recording) showCurrent(); };
      wrap.refresh = refresh;
      recorders.add({ wrap, refresh, stop, seen: false });
      showCurrent();
      return wrap;
    },
  };
  CM.on('settings', refreshRecorders);
  CM.on('lang', refreshRecorders);
  CM.on('hotkeyRejected', () => CM.toast(t('hotkey.taken')));
  window.CM = CM;
})();
