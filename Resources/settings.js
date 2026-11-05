// Settings panel shell: tab bar, generic binding of [data-key] controls to settings, and the simple tabs
// (General, Content, History). Feature / AI / About tabs are modules that call CM.registerTab(id, {mount, update}).
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const S = CM.S;
  const panel = (id) => document.querySelector(`#settings .tab-panel[data-tab="${id}"]`);
  const mounted = {};
  let activeTab = 'general';
  try { activeTab = localStorage.getItem('cm.settingsTab') || 'general'; } catch (e) { /* no storage */ }

  // Strings owned by the shell.
  I18N.register({
    en: {
      'settings.history.clear.confirm': 'Clear history? Pinned items stay.',
      'settings.history.clear.yes': 'Clear history',
      'settings.history.clear.cancel': 'Cancel',
      'settings.history.cleared': 'History cleared',
    },
    he: {
      'settings.history.clear.confirm': 'לנקות את ההיסטוריה? פריטים מוצמדים נשארים.',
      'settings.history.clear.yes': 'נקה היסטוריה',
      'settings.history.clear.cancel': 'בטל',
      'settings.history.cleared': 'ההיסטוריה נוקתה',
    },
  });
  // Fallback for the Translation tab label; i18n-core owns it, so only fill it when core does not have it yet.
  {
    const K = 'settings.tab.translate';
    if (t(K) === K) I18N.register({ en: { [K]: 'Translation' } });
    if (I18N.missing('he').includes(K)) I18N.register({ he: { [K]: 'תרגום' } });
  }

  /** aria-label from a string key, for icon-capable buttons: <button data-i18n-aria="header.raw">. */
  function applyAria(root) {
    root.querySelectorAll('[data-i18n-aria]').forEach((e) => e.setAttribute('aria-label', t(e.dataset.i18nAria)));
  }

  // ---- tabs --------------------------------------------------------------------------------------------
  const tabButtons = () => [...document.querySelectorAll('#settings .tabs [data-tab]')];
  // ARIA wiring: ids, aria-controls / aria-labelledby, roving tabindex (set in showTab).
  document.querySelector('#settings .tabs').setAttribute('aria-orientation', 'horizontal');
  tabButtons().forEach((b) => {
    const id = b.dataset.tab, p = panel(id);
    b.id = 'stab-' + id;
    if (p) { p.id = 'spanel-' + id; b.setAttribute('aria-controls', p.id); p.setAttribute('aria-labelledby', b.id); }
  });
  function mountTab(id) {
    const def = CM.tabs[id], el = panel(id);
    if (!def || !el || mounted[id]) return;
    mounted[id] = true;
    try { def.mount(el); I18N.apply(el); } catch (e) { console.error('tab ' + id, e); }
  }
  function updateTabs() {
    for (const id of Object.keys(mounted)) {
      const def = CM.tabs[id];
      if (def && def.update) { try { def.update(S); } catch (e) { console.error('tab ' + id, e); } }
    }
  }
  function showTab(id) {
    if (!panel(id)) id = 'general';
    activeTab = id;
    try { localStorage.setItem('cm.settingsTab', id); } catch (e) { /* no storage */ }
    tabButtons().forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    document.querySelectorAll('#settings .tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== id; });
    mountTab(id);
    const def = CM.tabs[id];
    if (def && def.update) { try { def.update(S); } catch (e) { console.error('tab ' + id, e); } }
    $('#settings').scrollTop = 0;
  }
  const activeTabButton = () => tabButtons().find((b) => b.dataset.tab === activeTab);
  tabButtons().forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  // Tablist keys: Left / Right move (mirrored in RTL, where the first tab is on the right), Home / End jump.
  // Selection follows focus.
  $('#settings .tabs').addEventListener('keydown', (e) => {
    const list = tabButtons().filter((b) => !b.hidden);
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    let n;
    if (e.key === 'ArrowRight') n = i + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') n = i + (rtl ? 1 : -1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    else return;
    e.preventDefault();
    const b = list[(n + list.length) % list.length];
    showTab(b.dataset.tab);
    b.focus();
  });
  // Modules may register after this file runs; mount them as they arrive if their tab is showing.
  CM.on('tabRegistered', (id) => { if (id === activeTab) showTab(id); });
  // A language change re-mounts module tabs so their strings follow.
  CM.on('lang', () => {
    for (const id of Object.keys(mounted)) { delete mounted[id]; const el = panel(id); if (CM.tabs[id] && el) el.innerHTML = ''; }
    applyAria(document);
    showTab(activeTab);
  });
  // Opening Settings puts focus on the active tab; closing it returns focus to the gear button if it was inside.
  CM.on('settingsPanel', (on) => {
    if (on) {
      fillForm(); showTab(activeTab);
      const b = activeTabButton(); if (b) b.focus({ preventScroll: true });
    } else {
      hideClearConfirm(false);
      if ($('#settings').contains(document.activeElement)) $('#b-settings').focus();
    }
  });

  // ---- generic [data-key] binding (General / Content / History tabs) -----------------------------------
  function fillForm() {
    document.querySelectorAll('#settings [data-key]').forEach((el) => {
      const k = el.dataset.key, v = S[k];
      if (el.classList.contains('seg')) el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el) el.value = String(v);
    });
    $('#zoom-label').textContent = Math.round(S.zoom * 100) + '%';
    $('#ratio-label').textContent = t('settings.content.ratio.value', { pct: Math.round(S.ratio * 100) });
    $('#row-ratio').style.opacity = S.detect === 'majority' ? 1 : .4;
    $('#row-login').style.display = S.loginSupported ? '' : 'none';
  }

  /** Binds every [data-key] control inside root. Modules may call CM.bindControls(panelEl) for their own rows. */
  function bindControls(root) {
    root.querySelectorAll('[data-key]').forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      const k = el.dataset.key;
      if (el.classList.contains('seg')) {
        el.querySelectorAll('button').forEach((b) => { b.onclick = () => CM.setSetting(k, b.dataset.v); });
      } else if (el.type === 'checkbox') {
        el.onchange = () => CM.setSetting(k, el.checked);
      } else if (el.type === 'range') {
        el.oninput = () => { S[k] = Number(el.value); fillForm(); };
        el.onchange = () => CM.setSetting(k, Number(el.value));
      } else if (el.tagName === 'TEXTAREA' || el.type === 'text') {
        let tm; el.oninput = () => { clearTimeout(tm); tm = setTimeout(() => CM.setSetting(k, el.value), 500); };
      } else {
        el.onchange = () => CM.setSetting(k, el.dataset.number != null || k === 'maxHistory' ? Number(el.value) : el.value);
      }
    });
  }
  CM.bindControls = bindControls;
  CM.fillForm = fillForm;
  bindControls($('#settings'));

  CM.on('settings', () => { fillForm(); updateTabs(); });
  CM.on('aiState', updateTabs);

  // ---- buttons -----------------------------------------------------------------------------------------
  const THEMES = ['system', 'light', 'dark'];
  $('#b-theme').onclick = () => {
    const next = THEMES[(THEMES.indexOf(S.theme) + 1) % THEMES.length];
    CM.setSetting('theme', next);
    CM.toast(t('toast.appearance', { theme: t('settings.general.theme.' + next) }));
  };
  $('#b-settings').onclick = () => window.monitor.toggleSettings();
  $('#s-close').onclick = () => window.monitor.toggleSettings(false);
  $('#s-newwin').onclick = () => CM.native({ cmd: 'newWindow' });
  $('#s-newtab').onclick = () => CM.native({ cmd: 'newTab' });
  // Clear history: two-step inline confirm (no window.confirm). Cancel gets focus, so Return does not clear.
  const clearConfirm = $('#s-clear-confirm');
  function hideClearConfirm(refocus) {
    if (clearConfirm.hidden) return;
    clearConfirm.hidden = true;
    $('#s-clear').hidden = false;
    if (refocus) $('#s-clear').focus();
  }
  $('#s-clear').onclick = () => {
    $('#s-clear').hidden = true;
    clearConfirm.hidden = false;
    $('#s-clear-no').focus();
  };
  $('#s-clear-no').onclick = () => hideClearConfirm(true);
  $('#s-clear-yes').onclick = () => {
    CM.native({ cmd: 'clearAll' });
    hideClearConfirm(true);
    CM.toast(t('settings.history.cleared'));
  };
  // Escape inside the confirm cancels it instead of closing Settings.
  clearConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); hideClearConfirm(true); }
  });
  CM.on('lang', () => hideClearConfirm(false));

  I18N.apply(document);
  applyAria(document);
  showTab(activeTab);
  fillForm();
})();
