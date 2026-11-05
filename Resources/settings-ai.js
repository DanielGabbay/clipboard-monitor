// Settings › ai tab (placeholder; replaced by the ai module work). See the plan for the contract:
// CM.registerTab('ai', { mount(panelEl) { ... }, update(S) { ... } }) and I18N.register({en, he}) for strings.
(function () {
  'use strict';
  I18N.register({ en: { 'settings.ai.placeholder': 'Coming soon.' } });
  CM.registerTab('ai', {
    mount(el) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t('settings.ai.placeholder'); el.appendChild(p); },
  });
})();
