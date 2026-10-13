/*
 * bidi-fix.js: the shared BiDi engine used by every injection route in this toolkit
 * (Violentmonkey userscript, Electron asar patch, CDP live injection, DevTools console).
 *
 * Usage: paste/inject this file, then call
 *   window.__bidiFix.install({ ...config })
 * Calling install() again replaces the previous config (idempotent).
 *
 * Config (all optional):
 *   blocks     CSS selector list of text blocks whose direction should follow their content
 *              (messages, paragraphs, list items, table cells...). Default: common block tags.
 *   editors    Selector list of inputs/contenteditable that should flip as you type.
 *   forceRtl   Selector list forced to dir=rtl regardless of content.
 *   forceLtr   Selector list forced to dir=ltr (code, URLs, numbers-only widgets).
 *   detect     'majority' (default): RTL if Hebrew/Arabic letters >= ratio of all strong letters.
 *              Right for "React Native הוא framework..." (starts English, is Hebrew). One direction per block.
 *              'first-strong': same rule the browser uses for dir=auto (first strong letter wins), applied
 *              per paragraph via unicode-bidi:plaintext. Right for blocks mixing whole Hebrew and English lines.
 *   ratio      Threshold for 'majority' (default 0.3: a line that is 30% Hebrew reads as Hebrew).
 *   align      true (default): also set text-align:start so RTL blocks align right.
 *   isolateInline  Selector list of inline elements (mentions, links, chips) to wrap as bidi
 *              isolates so they don't scramble neighbouring text. Default: 'a, code, kbd'.
 *   css        Extra CSS appended verbatim.
 *   debug      true: outline every block the engine touched (red=rtl, blue=ltr).
 */
(function () {
  'use strict';
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/g; // Hebrew, Arabic, Syriac, Thaana, presentation forms
  const LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/g; // Latin, Greek, Cyrillic
  const FIRST_STRONG_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]|[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

  const DEFAULTS = {
    blocks: 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, summary, label',
    editors: 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    forceRtl: '',
    forceLtr: 'pre, code, kbd, samp, .hljs, [class*="language-"]',
    detect: 'majority',
    ratio: 0.3,
    align: true,
    isolateInline: 'a, code, kbd',
    css: '',
    debug: false,
  };

  function detectDir(text, cfg) {
    if (!text) return null;
    if (cfg.detect === 'first-strong') {
      const m = text.match(FIRST_STRONG_RE);
      if (!m) return null;
      return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(m[0]) ? 'rtl' : 'ltr';
    }
    const rtl = (text.match(RTL_RE) || []).length;
    if (!rtl) return 'ltr';
    const ltr = (text.match(LTR_RE) || []).length;
    return rtl / (rtl + ltr) >= cfg.ratio ? 'rtl' : 'ltr';
  }

  function buildCss(cfg) {
    const out = [];
    if (cfg.blocks) {
      // 'first-strong' -> plaintext: each paragraph inside the block (even <br>-separated lines) resolves its own direction.
      // 'majority' -> isolate: the dir attribute we computed wins (plaintext would override it with first-strong).
      const ub = cfg.detect === 'first-strong' ? 'plaintext' : 'isolate';
      out.push(`:is(${cfg.blocks})[data-bidi-fix] { unicode-bidi: ${ub}; ${cfg.align ? 'text-align: start;' : ''} }`);
    }
    if (cfg.editors) out.push(`:is(${cfg.editors}) { unicode-bidi: plaintext; text-align: start; }`);
    if (cfg.isolateInline) out.push(`:is(${cfg.isolateInline}) { unicode-bidi: isolate; }`);
    if (cfg.forceLtr) out.push(`:is(${cfg.forceLtr}) { direction: ltr !important; unicode-bidi: isolate !important; text-align: left; }`);
    if (cfg.forceRtl) out.push(`:is(${cfg.forceRtl}) { direction: rtl !important; text-align: right; }`);
    // RTL lists: put bullets on the right
    out.push(`:is(ul, ol)[dir="rtl"] { padding-right: 2em; padding-left: 0; }`);
    if (cfg.debug) {
      out.push(`[data-bidi-fix="rtl"] { outline: 1px dashed red !important; }`);
      out.push(`[data-bidi-fix="ltr"] { outline: 1px dashed #36f !important; }`);
    }
    if (cfg.css) out.push(cfg.css);
    return out.join('\n');
  }

  function safeMatches(el, sel) {
    if (!sel) return false;
    try { return el.matches(sel); } catch (e) { return false; }
  }

  function applyTo(el, cfg) {
    if (!(el instanceof Element)) return;
    if (cfg.forceLtr) { try { if (el.closest(cfg.forceLtr)) return; } catch (e) { /* bad selector */ } }
    if (safeMatches(el, cfg.forceRtl)) { el.setAttribute('dir', 'rtl'); return; }
    const isField = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    const text = isField ? el.value : (el.innerText !== undefined ? el.innerText : el.textContent);
    const dir = detectDir(text, cfg);
    if (!dir) return;
    if (el.getAttribute('data-bidi-fix') !== dir) {
      el.setAttribute('data-bidi-fix', dir);
      el.setAttribute('dir', dir);
      // Lists: give the parent list the direction of its first item so markers sit on the right side
      if (el.tagName === 'LI' && el.parentElement && el.parentElement === el.parentElement.closest('ul,ol')) {
        const first = el.parentElement.querySelector(':scope > li');
        if (first === el) el.parentElement.setAttribute('dir', dir);
      }
    }
  }

  function scan(root, cfg) {
    const sel = [cfg.blocks, cfg.editors, cfg.forceRtl].filter(Boolean).join(', ');
    if (!sel) return;
    if (root instanceof Element && safeMatches(root, sel)) applyTo(root, cfg);
    let list;
    try { list = (root.querySelectorAll ? root : document).querySelectorAll(sel); } catch (e) { console.warn('[bidi-fix] bad selector', sel, e); return; }
    list.forEach((el) => applyTo(el, cfg));
  }

  const state = W.__bidiFix && W.__bidiFix._state || { style: null, sheet: null, observer: null, timer: null, pending: new Set(), onInput: null };

  function ensureSheet(doc) {
    if (!doc.adoptedStyleSheets.includes(state.sheet)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, state.sheet];
  }

  function install(userCfg) {
    const cfg = Object.assign({}, DEFAULTS, userCfg || {});
    const doc = document;
    const css = buildCss(cfg);
    // Prefer a constructed stylesheet: it is not blocked by a strict Content-Security-Policy (style-src),
    // which many Electron apps and big web apps set. Fall back to a <style> element.
    if (!state.style && !state.sheet && 'adoptedStyleSheets' in Document.prototype) {
      try { state.sheet = new CSSStyleSheet(); } catch (e) { state.sheet = null; }
    }
    if (state.sheet) {
      state.sheet.replaceSync(css);
      ensureSheet(doc);
    } else {
      if (!state.style) { state.style = doc.createElement('style'); state.style.id = 'bidi-fix-style'; }
      state.style.textContent = css;
      (doc.head || doc.documentElement).appendChild(state.style);
    }

    scan(doc, cfg);

    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver((muts) => {
      for (const m of muts) {
        const target = m.type === 'characterData' ? m.target.parentElement : m.target;
        if (target) state.pending.add(target);
        m.addedNodes && m.addedNodes.forEach((n) => { if (n.nodeType === 1) state.pending.add(n); });
      }
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        const sel = [cfg.blocks, cfg.editors, cfg.forceRtl].filter(Boolean).join(', ');
        state.pending.forEach((n) => {
          scan(n, cfg);
          // text changed inside an existing block: re-evaluate its nearest block ancestor
          const host = n.closest && sel && n.closest(sel);
          if (host) applyTo(host, cfg);
        });
        state.pending.clear();
        // our stylesheet can be dropped by SPA head rewrites
        if (state.sheet) ensureSheet(doc);
        else if (!state.style.isConnected) (doc.head || doc.documentElement).appendChild(state.style);
      }, 120);
    });
    state.observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

    if (state.onInput) doc.removeEventListener('input', state.onInput, true);
    state.onInput = (e) => { if (cfg.editors && e.target.closest && e.target.closest(cfg.editors)) applyTo(e.target.closest(cfg.editors), cfg); };
    doc.addEventListener('input', state.onInput, true);

    if (cfg.debug) console.log('[bidi-fix] installed', cfg);
    return cfg;
  }

  function uninstall() {
    if (state.observer) state.observer.disconnect();
    if (state.style) state.style.remove();
    if (state.sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== state.sheet);
    if (state.onInput) document.removeEventListener('input', state.onInput, true);
    document.querySelectorAll('[data-bidi-fix]').forEach((el) => { el.removeAttribute('data-bidi-fix'); el.removeAttribute('dir'); });
  }

  W.__bidiFix = { install, uninstall, detectDir: (t, c) => detectDir(t, Object.assign({}, DEFAULTS, c)), _state: state, version: '1.0.0' };
})();
