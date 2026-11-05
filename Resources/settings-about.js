// Settings › About: version (build) in the header line, then commit, build date, macOS version and the release notes.
// Asks the app with {cmd:'version'} on mount and renders the answer (CM.on('versionInfo'); Sources/Version.swift):
//   {version, build, commit, buildDate (ISO 8601), dirty, os, changelog (CHANGELOG.md text)}
(function () {
  'use strict';
  I18N.register({
    en: {
      'settings.about.tagline': 'The clipboard on screen, rendered properly, for mixed Hebrew and English text.',
      'settings.about.versionLine': 'Version {version} (build {build})',
      'settings.about.details': 'Details',
      'settings.about.commit': 'Commit',
      'settings.about.commit.copy': 'Click to copy',
      'settings.about.modified': 'modified',
      'settings.about.modified.hint': 'Built with uncommitted changes',
      'settings.about.buildDate': 'Built',
      'settings.about.os': 'macOS',
      'settings.about.whatsNew': 'What’s new in {version}',
      'settings.about.noNotes': 'No release notes for this version.',
      'settings.about.copyInfo': 'Copy version info',
      'settings.about.copied': 'Version info copied',
      'settings.about.commitCopied': 'Commit copied',
      'settings.about.loading': 'Loading…',
      'settings.about.unknown': 'unknown',
      'settings.about.more': 'More',
      'settings.about.license': 'MIT License. The full text is in the LICENSE file next to the source code.',
      'settings.about.readme': 'README.md in the project folder describes how to build, sign and release.',
      'settings.about.thirdParty': 'Includes marked (MIT) and highlight.js (BSD-3-Clause).',
    },
    he: {
      'settings.about.tagline': 'הלוח על המסך, מוצג כמו שצריך, גם כשהטקסט מעורב בעברית ובאנגלית.',
      'settings.about.versionLine': 'גרסה {version} (build {build})',
      'settings.about.details': 'פרטים',
      'settings.about.commit': 'Commit',
      'settings.about.commit.copy': 'לחץ להעתקה',
      'settings.about.modified': 'שונה',
      'settings.about.modified.hint': 'נבנה עם שינויים שלא נכללו ב־commit',
      'settings.about.buildDate': 'תאריך בנייה',
      'settings.about.os': 'macOS',
      'settings.about.whatsNew': 'מה חדש ב־{version}',
      'settings.about.noNotes': 'אין הערות שחרור לגרסה הזו.',
      'settings.about.copyInfo': 'העתק פרטי גרסה',
      'settings.about.copied': 'פרטי הגרסה הועתקו',
      'settings.about.commitCopied': 'ה־commit הועתק',
      'settings.about.loading': 'טוען…',
      'settings.about.unknown': 'לא ידוע',
      'settings.about.more': 'עוד',
      'settings.about.license': 'רישיון MIT. הנוסח המלא נמצא בקובץ LICENSE לצד קוד המקור.',
      'settings.about.readme': 'בנייה, חתימה ושחרור גרסה מתוארים ב־README.md שבתיקיית הפרויקט.',
      'settings.about.thirdParty': 'כולל את marked (MIT) ואת highlight.js (BSD-3-Clause).',
    },
  });

  let info = null;
  let root = null;

  // Raw HTML inside the changelog is shown as text, like the clipboard renderer does.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let md = null;
  function renderMarkdown(text) {
    if (!md) {
      const opts = { gfm: true, breaks: false, renderer: { html(token) { return esc(token.text || token.raw || ''); } } };
      if (typeof marked.Marked === 'function') md = new marked.Marked(opts);
      else { marked.use(opts); md = marked; }
    }
    return md.parse(text);
  }

  /** The body of "## [<version>] ..." up to the next "## " heading (or "## [Unreleased]" when that is all there is). */
  function notesFor(changelog, version) {
    if (!changelog) return '';
    const lines = changelog.split(/\r?\n/);
    const head = (l) => /^##\s/.test(l);
    const vesc = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let start = lines.findIndex((l) => new RegExp('^##\\s+\\[?v?' + vesc + '\\]?(\\s|$)').test(l));
    if (start < 0) start = lines.findIndex((l) => /^##\s+\[?Unreleased\]?/i.test(l));
    if (start < 0) return '';
    let end = lines.findIndex((l, i) => i > start && head(l));
    if (end < 0) end = lines.length;
    return lines.slice(start + 1, end).join('\n').trim();
  }

  function formatDate(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    try { return new Intl.DateTimeFormat(I18N.locale, { dateStyle: 'long', timeStyle: 'short' }).format(d); }
    catch (e) { return d.toLocaleString(I18N.locale); }
  }

  function plainInfo(i) {
    const lines = [
      `Clipboard Monitor ${i.version} (${i.build})`,
      `Commit: ${i.commit || 'unknown'}${i.dirty ? ' (modified)' : ''}`,
      `Built: ${i.buildDate || 'unknown'}`,
      `macOS: ${i.os || 'unknown'}`,
    ];
    return lines.join('\n');
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  /** A settings row: label on the start side, an LTR technical value on the end side. */
  function row(label, value, extra) {
    const r = h('div', 'row');
    r.appendChild(h('span', null, label));
    const v = h('span', 'about-value');
    v.dir = 'ltr';
    v.textContent = value;
    r.appendChild(v);
    if (extra) r.appendChild(extra);
    return r;
  }

  // Notes are <div>s, not <p>s: the renderer's BiDi pass treats every <p> on the page as a block and would flip a
  // Hebrew sentence full of Latin names (marked, highlight.js) to LTR. Divs follow the interface direction.
  function render() {
    if (!root) return;
    root.innerHTML = '';
    const wrap = h('div', 'about');
    root.appendChild(wrap);

    const head = h('div', 'about-head');
    head.appendChild(h('h2', 'about-name', 'Clipboard Monitor'));
    const vl = h('div', 'about-version');
    if (info) vl.textContent = t('settings.about.versionLine', { version: info.version || '?', build: info.build || '?' });
    else vl.textContent = t('settings.about.loading');
    head.appendChild(vl);
    head.appendChild(h('div', 'note about-tagline', t('settings.about.tagline')));
    wrap.appendChild(head);
    if (!info) return;

    wrap.appendChild(h('h3', null, t('settings.about.details')));
    // Commit: click to copy, plus a "modified" marker for builds with uncommitted changes.
    const c = row(t('settings.about.commit'), info.commit || t('settings.about.unknown'));
    const cv = c.querySelector('.about-value');
    if (info.commit) {
      cv.classList.add('copyable');
      cv.title = t('settings.about.commit.copy');
      cv.tabIndex = 0;
      const copy = () => { CM.native({ cmd: 'copy', text: info.commit }); CM.toast(t('settings.about.commitCopied')); };
      cv.onclick = copy;
      cv.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } };
    }
    if (info.dirty) {
      const m = h('span', 'chip about-dirty', t('settings.about.modified'));
      m.title = t('settings.about.modified.hint');
      c.insertBefore(m, cv);
    }
    wrap.appendChild(c);

    const date = row(t('settings.about.buildDate'), formatDate(info.buildDate) || info.buildDate || t('settings.about.unknown'));
    date.querySelector('.about-value').dir = 'auto';   // a localized date, not a technical value
    date.querySelector('.about-value').classList.add('date');
    if (info.buildDate) date.querySelector('.about-value').title = info.buildDate;
    wrap.appendChild(date);
    wrap.appendChild(row(t('settings.about.os'), info.os || t('settings.about.unknown')));

    const btns = h('div', 'row-btns');
    const copyBtn = h('button', 'btn about-copy', t('settings.about.copyInfo'));
    copyBtn.onclick = () => { CM.native({ cmd: 'copy', text: plainInfo(info) }); CM.toast(t('settings.about.copied')); };
    btns.appendChild(copyBtn);
    wrap.appendChild(btns);

    // Release notes are written in English; keep them LTR whatever the interface language.
    wrap.appendChild(h('h3', null, t('settings.about.whatsNew', { version: info.version || '' })));
    const notes = notesFor(info.changelog || '', info.version || '');
    if (notes) {
      const box = h('div', 'md about-notes');
      box.dir = 'ltr';
      box.lang = 'en';
      box.innerHTML = renderMarkdown(notes);
      box.querySelectorAll('a').forEach((a) => { a.removeAttribute('href'); });   // no navigation inside the panel
      wrap.appendChild(box);
    } else {
      wrap.appendChild(h('div', 'note', t('settings.about.noNotes')));
    }

    wrap.appendChild(h('h3', null, t('settings.about.more')));
    wrap.appendChild(h('div', 'note', t('settings.about.readme')));
    wrap.appendChild(h('div', 'note', t('settings.about.license')));
    wrap.appendChild(h('div', 'note', t('settings.about.thirdParty')));
  }

  CM.on('versionInfo', (i) => { info = i || null; render(); });

  CM.registerTab('about', {
    mount(el) {
      root = el;
      render();
      CM.native({ cmd: 'version' });
    },
  });
})();
