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

  // ---- tabs --------------------------------------------------------------------------------------------
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
    document.querySelectorAll('#settings .tabs [data-tab]').forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#settings .tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== id; });
    mountTab(id);
    const def = CM.tabs[id];
    if (def && def.update) { try { def.update(S); } catch (e) { console.error('tab ' + id, e); } }
    $('#settings').scrollTop = 0;
  }
  document.querySelectorAll('#settings .tabs [data-tab]').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
  // Modules may register after this file runs; mount them as they arrive if their tab is showing.
  CM.on('tabRegistered', (id) => { if (id === activeTab) showTab(id); });
  // A language change re-mounts module tabs so their strings follow.
  CM.on('lang', () => {
    for (const id of Object.keys(mounted)) { delete mounted[id]; const el = panel(id); if (CM.tabs[id] && el) el.innerHTML = ''; }
    showTab(activeTab);
  });
  CM.on('settingsPanel', (on) => { if (on) { fillForm(); showTab(activeTab); } });

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
  $('#s-clear').onclick = () => CM.native({ cmd: 'clearAll' });

  I18N.apply(document);
  showTab(activeTab);
  fillForm();
})();
