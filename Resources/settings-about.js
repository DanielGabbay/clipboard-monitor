// Settings › about tab (placeholder; replaced by the about module work). See the plan for the contract:
// CM.registerTab('about', { mount(panelEl) { ... }, update(S) { ... } }) and I18N.register({en, he}) for strings.
(function () {
  'use strict';
  I18N.register({ en: { 'settings.about.placeholder': 'Coming soon.' } });
  CM.registerTab('about', {
    mount(el) { const p = document.createElement('p'); p.className = 'note'; p.textContent = t('settings.about.placeholder'); el.appendChild(p); },
  });
})();
