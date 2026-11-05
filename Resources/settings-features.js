// Settings › features tab (placeholder; replaced by the features module work). See the plan for the contract:
// CM.registerTab('features', { mount(panelEl) { ... }, update(S) { ... } }) and I18N.register({en, he}) for strings.
(function () {
  'use strict';
  I18N.register({ en: { 'settings.features.placeholder': 'Coming soon.' } });
  CM.registerTab('features', {
    mount(el) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t('settings.features.placeholder'); el.appendChild(p); },
  });
})();
