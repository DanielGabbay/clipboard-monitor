// Renderer: clipboard history, rendering, smart cards, compare, translation UI, context menu, window.monitor API.
// Settings UI lives in settings.js (+ settings-*.js tabs); shared bridge/settings/events in core.js; strings in i18n-core-*.js.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const native = CM.native;
  const toast = CM.toast;
  const MAX_SAVED_IMAGE = 400000; // data-URL chars; bigger images are shown but not kept across restarts

  const S = CM.S;   // live settings object shared with settings.js (mutated in place, never replaced)
  const on = (name) => CM.feature(name);   // feature switches (Settings › Features)

  // Strings added with the feature switches / translate-to work (the core strings are in i18n-core-*.js).
  I18N.register({
    en: {
      'tr.translateTo': 'Translate to…', 'tr.translateToLang': 'Translate to {lang}', 'tr.more.title': 'Translate to another language',
      'tr.auto': 'Hebrew ↔ English (automatic)',
      'tr.fallback': 'AI translation failed ({error}), used on-device.', 'tr.fallbackNoError': 'AI translation failed, used on-device.',
      'tr.err.llm': 'AI translation failed: {error}',
      'menu.translate': 'Translate', 'menu.rawText': 'Raw text', 'history.label': 'Clipboard history',
    },
    he: {
      'tr.translateTo': 'תרגם ל…', 'tr.translateToLang': 'תרגם ל{lang}', 'tr.more.title': 'תרגום לשפה אחרת',
      'tr.auto': 'עברית ↔ אנגלית (אוטומטי)',
      'tr.fallback': 'תרגום ה-AI נכשל ({error}), תורגם במכשיר.', 'tr.fallbackNoError': 'תרגום ה-AI נכשל, תורגם במכשיר.',
      'tr.err.llm': 'תרגום ה-AI נכשל: {error}',
      'menu.translate': 'תרגם', 'menu.rawText': 'טקסט גולמי', 'history.label': 'היסטוריית הלוח',
    },
  });

  // BiDi: majority detection per block (see toolkit README "Choosing the detection mode").
  // Rich HTML from web pages often holds text directly in <div>s, so leaf divs count as blocks there.
  const BIDI = {
    // Only the clipboard view: Settings and other chrome follow the UI direction instead of per-block detection.
    blocks: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th', 'dd', 'dt', 'figcaption', '.line', '.decoded',
             '.rich div:not(:has(div, p, ul, ol, table, pre, h1, h2, h3, h4, blockquote))'].map((s) => '#content ' + s).join(', '),
    editors: '#search, #settings textarea:not([dir]), #settings input[type=text]:not([dir])', detect: 'majority', ratio: 0.3, align: true,
    forceLtr: 'pre, kbd, samp', isolateInline: 'a, code, kbd, strong, em, b, i',
  };
  const detectDir = (t) => window.__bidiFix.detectDir(t, BIDI);
  const FONTS = {
    system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Arial Hebrew", sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, "Arial Hebrew", sans-serif',
    serif: 'ui-serif, "New York", "Times New Roman", "Taamey Frank CLM", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  };

  // ---- "Copy RTL": same rule as text/bidi_text.py wrap (isolate mode) -------------------------------
  const CONTROLS = /[⁦-⁩‪-‮‎‏؜]/g;
  const HEB = /[֐-׿יִ-ﭏ؀-ۿ]/;
  const PREFIX = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|#{1,6}\s+|\|\s*)*)/;
  function wrapRtl(text) {
    let inFence = false; // code inside ``` fences stays untouched
    return text.split('\n').map((line) => {
      const clean = line.replace(CONTROLS, '');
      if (/^\s*(```|~~~)/.test(clean)) { inFence = !inFence; return clean; }
      if (inFence || !clean.trim() || !HEB.test(clean)) return clean;
      const pre = clean.match(PREFIX)[0], body = clean.slice(pre.length);
      return body.trim() ? pre + '⁧' + body + '⁩' : clean;
    }).join('\n');
  }

  // ---- formats --------------------------------------------------------------------------------------
  // Raw HTML inside Markdown is shown as text, never executed.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  marked.use({ gfm: true, breaks: true, renderer: { html(token) { return esc(token.text || token.raw || ''); } } });

  function looksLikeMarkdown(t) {
    if (!/\n/.test(t) && !/^#{1,6}\s|\*\*.+\*\*|\[.+\]\(.+\)|`[^`]+`/.test(t)) return false;
    let score = 0;
    const rules = [
      [/^#{1,6}\s+\S/m, 2], [/^```/m, 3], [/^\s{0,3}[-*+]\s+\S/m, 1], [/^\s{0,3}\d+[.)]\s+\S/m, 1],
      [/\*\*[^*\n]+\*\*|__[^_\n]+__/, 1], [/\[[^\]\n]+\]\([^)\s]+\)/, 2], [/^\s{0,3}>\s/m, 1],
      [/^\|?.*\|.*\n\|?\s*:?-{3,}/m, 3], [/`[^`\n]+`/, 1], [/^\s*[-*_]{3,}\s*$/m, 1], [/^\s*- \[[ xX]\]/m, 2],
    ];
    for (const [re, w] of rules) if (re.test(t)) score += w;
    return score >= 2;
  }
  function looksLikeJson(t) {
    const s = t.trim();
    if (!/^[\[{]/.test(s)) return null;
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return null; }
  }
  // Rich HTML is worth showing only when it carries document structure. Code editors (VS Code etc.)
  // put styled <div>/<span> soup on the clipboard; the plain text is the better view for those.
  const STRUCTURAL = /<(p|h[1-6]|ul|ol|li|table|a\s|strong|em|blockquote|img)\b/i;

  function classify(item) {
    if (item.kind !== 'text') return item.kind;
    if (S.rich && item.html && STRUCTURAL.test(item.html)) return 'rich';
    if (looksLikeJson(item.text)) return 'json';
    if (S.markdown && looksLikeMarkdown(item.text)) return 'markdown';
    return 'text';
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, link, meta, title, base, iframe, frame, object, embed, form, input, button, select, textarea, noscript, template, svg, math')
      .forEach((n) => n.remove());
    doc.body.querySelectorAll('*').forEach((el) => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const keep = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start'].includes(n);
        if (!keep || ((n === 'href' || n === 'src') && /^\s*(javascript|vbscript|data:(?!image\/))/i.test(a.value))) el.removeAttribute(a.name);
      }
    });
    return doc.body.innerHTML;
  }

  function highlight(root) {
    if (!S.highlight) return;
    root.querySelectorAll('pre code').forEach((code) => {
      if (code.textContent.length > 30000) return;
      const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1];
      try {
        if (lang && hljs.getLanguage(lang)) hljs.highlightElement(code);
        else {
          const r = hljs.highlightAuto(code.textContent);
          if (r.relevance >= 5) { code.innerHTML = r.value; code.classList.add('hljs'); }
        }
      } catch (e) { /* leave plain */ }
    });
  }

  // Lists and tables take one direction from their whole text, so bullets stay on one side and
  // column order is consistent; mixed items still render correctly inside that base direction.
  function fixContainers(box) {
    box.querySelectorAll('ul, ol').forEach((l) => l.setAttribute('dir', detectDir(l.innerText) || 'ltr'));
    box.querySelectorAll('table').forEach((t) => t.setAttribute('dir', detectDir(t.innerText) || 'ltr'));
    box.querySelectorAll('input[type=checkbox]').forEach((c) => c.setAttribute('disabled', ''));
  }

  function renderPlain(text) {
    const box = document.createElement('div');
    box.className = 'plain';
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      const d = document.createElement('div');
      d.className = 'line';
      d.textContent = line;
      box.appendChild(d);
    }
    return box;
  }

  // ---- state ----------------------------------------------------------------------------------------
  let history = [];      // newest first: {kind, text?, html?, image?, app?, time, fmt}
  let shownIndex = 0;
  let raw = false;
  let held = false;      // this window stays on the shown item instead of following the clipboard
  let query = '';
  let state = { paused: false };

  // ---- smart actions by content type ---------------------------------------------------------------
  const elt = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const b64decode = (s) => {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  };
  const printable = (s) => s.length > 0 && (s.match(/[\x20-\x7E֐-׿\n\r\t -￿]/g) || []).length / s.length > 0.95;
  const relTime = (ms) => {
    const rtf = new Intl.RelativeTimeFormat(I18N.locale, { numeric: 'auto' });
    const d = (ms - Date.now()) / 1000, a = Math.abs(d);
    for (const [u, sec] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]])
      if (a >= sec) return rtf.format(Math.round(d / sec), u);
    return rtf.format(Math.round(d), 'second');
  };
  const fullDate = (ms) => new Date(ms).toLocaleString(I18N.locale, { dateStyle: 'full', timeStyle: 'medium' });

  // Each detector returns { title, build(card) } or null. Only single-token clips are inspected.
  function detectSmart(item) {
    const txt = (item.text || '').trim();
    if (!txt || txt.length > 200000 || !on('smartCards')) return null;
    const single = !/\s/.test(txt);
    // JWT
    if (on('smartJwt') && single && /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/.test(txt)) {
      try {
        const [h, p] = txt.split('.').slice(0, 2).map((x) => JSON.parse(b64decode(x)));
        if (h && h.alg) return { kind: 'jwt', title: t('smart.jwt'), build: (card) => {
          const now = Date.now();
          if (p.exp) {
            const exp = p.exp * 1000;
            card.appendChild(elt('div', 'badge ' + (exp < now ? 'bad' : 'good'), exp < now ? t('smart.jwt.expired', { when: relTime(exp) }) : t('smart.jwt.valid', { when: relTime(exp) })));
          }
          const kv = [['alg', h.alg], ['typ', h.typ]];
          for (const k of ['iss', 'sub', 'aud']) if (p[k] != null) kv.push([k, String(p[k])]);
          for (const k of ['iat', 'nbf', 'exp']) if (p[k]) kv.push([k, fullDate(p[k] * 1000), 'date']);
          card.appendChild(kvTable(kv));
          card.appendChild(elt('div', 'sub', t('smart.jwt.header'))); card.appendChild(jsonView(h));
          card.appendChild(elt('div', 'sub', t('smart.jwt.payload'))); card.appendChild(jsonView(p));
          card.appendChild(elt('div', 'note', t('smart.jwt.unverified')));
        } };
      } catch (e) { /* not a JWT */ }
    }
    // URL
    if (on('smartLink') && single && /^https?:\/\/[^\s]+$/i.test(txt)) {
      let u; try { u = new URL(txt); } catch (e) { u = null; }
      if (u) return { title: t('smart.link'), build: (card) => {
        const kv = [[t('smart.link.host'), u.host], [t('smart.link.path'), decodeURIComponent(u.pathname)]];
        if (u.hash) kv.push([t('smart.link.hash'), decodeURIComponent(u.hash)]);
        card.appendChild(kvTable(kv));
        const params = [...u.searchParams];
        if (params.length) { card.appendChild(elt('div', 'sub', t('smart.link.query'))); card.appendChild(kvTable(params)); }
        const row = elt('div', 'row-btns');
        const open = elt('button', '', t('smart.link.open')); open.onclick = () => native({ cmd: 'open', url: u.href });
        const prev = elt('button', '', t('smart.link.preview')); prev.onclick = () => { prev.dataset.loading = '1'; prev.disabled = true; prev.textContent = t('smart.link.loading'); native({ cmd: 'preview', url: u.href }); };
        row.append(open); if (on('linkPreview')) row.append(prev); card.appendChild(row);
        const slot = elt('div', 'preview'); slot.dataset.url = u.href; card.appendChild(slot);
        if (previews[u.href]) fillPreview(slot, previews[u.href]);
      } };
    }
    // Color
    const col = on('smartColor') && parseColor(txt);
    if (col) return { title: t('smart.color'), build: (card) => {
      const sw = elt('div', 'swatch'); sw.style.background = txt; card.appendChild(sw);
      const [r, g, b, a] = col, [hh, ss, ll] = rgbToHsl(r, g, b);
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('') + (a < 1 ? Math.round(a * 255).toString(16).padStart(2, '0') : '');
      const vals = [['HEX', hex], ['RGB', a < 1 ? `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})` : `rgb(${r}, ${g}, ${b})`],
                    ['HSL', a < 1 ? `hsla(${hh}, ${ss}%, ${ll}%, ${+a.toFixed(3)})` : `hsl(${hh}, ${ss}%, ${ll}%)`],
                    ['Swift', `Color(red: ${(r / 255).toFixed(3)}, green: ${(g / 255).toFixed(3)}, blue: ${(b / 255).toFixed(3)})`]];
      card.appendChild(kvTable(vals, true));
    } };
    // Timestamp (Unix seconds / milliseconds, or ISO 8601)
    let ms = null;
    if (/^\d{10}$/.test(txt)) ms = Number(txt) * 1000;
    else if (/^\d{13}$/.test(txt)) ms = Number(txt);
    else if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(txt)) ms = Date.parse(txt);
    if (on('smartTime') && ms && ms > Date.UTC(1990, 0) && ms < Date.UTC(2100, 0)) return { title: t('smart.time'), build: (card) => {
      card.appendChild(elt('div', 'big', fullDate(ms)));
      card.appendChild(elt('div', 'note', relTime(ms)));
      card.appendChild(kvTable([['UTC', new Date(ms).toISOString()], [t('smart.time.unixS'), String(Math.floor(ms / 1000))], [t('smart.time.unixMs'), String(ms)]], true));
    } };
    // JSON
    if (on('smartJson') && item.fmt === 'json') return { title: t('smart.json'), build: (card) => jsonExplorer(card, JSON.parse(txt)) };
    // Base64 (only when it decodes to readable UTF-8)
    if (on('smartBase64') && single && txt.length >= 12 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(txt) && !/^\d+$/.test(txt)) {
      try {
        const dec = b64decode(txt);
        if (printable(dec)) return { kind: 'base64', title: t('smart.base64'), build: (card) => {
          card.appendChild(elt('div', 'sub', t('smart.base64.decoded')));
          let parsed = null; try { parsed = JSON.parse(dec); } catch (e) { /* text */ }
          if (parsed && typeof parsed === 'object') card.appendChild(jsonView(parsed));
          else { const p = elt('div', 'decoded', dec); card.appendChild(p); }
          const row = elt('div', 'row-btns'); const cp = elt('button', '', t('smart.base64.copy'));
          cp.onclick = () => copyText(dec); row.appendChild(cp); card.appendChild(row);
        } };
      } catch (e) { /* not base64 */ }
    }
    return null;
  }

  function kvTable(rows, copyable) {
    const tb = elt('table', 'kv');
    for (const [k, v, cls] of rows) {   // optional cls, e.g. 'date' (body font instead of monospace)
      const tr = elt('tr'); tr.append(elt('th', '', k));
      const td = elt('td', cls || '', v == null ? '' : String(v));
      if (copyable) { td.title = t('smart.clickToCopy'); td.classList.add('copy'); td.onclick = () => copyText(String(v)); }
      tr.append(td); tb.append(tr);
    }
    return tb;
  }

  function parseColor(t) {
    let m = t.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (m) {
      let h = m[1]; if (h.length <= 4) h = [...h].map((c) => c + c).join('');
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    m = t.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) return [+m[1], +m[2], +m[3], m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1];
    m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      const [r, g, b] = hslToRgb(+m[1], +m[2], +m[3]);
      return [r, g, b, m[4] ? (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]) : 1];
    }
    return null;
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }

  // JSON tree with collapsible nodes
  // JSON trees are code: always left to right, even in a Hebrew UI (the depth-0 node carries the jtree class).
  function jsonView(v, depth = 0) {
    if (v === null || typeof v !== 'object') {
      const s = elt('span', 'j-' + (v === null ? 'null' : typeof v), typeof v === 'string' ? JSON.stringify(v) : String(v));
      return s;
    }
    const isArr = Array.isArray(v), keys = Object.keys(v);
    const d = elt('details', 'jnode'); if (depth < 2) d.open = true;
    if (depth === 0) d.setAttribute('dir', 'ltr');
    const sum = elt('summary', '', isArr ? `[ ${keys.length} ]` : `{ ${keys.length} }`); d.appendChild(sum);
    for (const k of keys) {
      const row = elt('div', 'jrow');
      row.appendChild(elt('span', 'jkey', isArr ? k : JSON.stringify(k)));
      row.appendChild(document.createTextNode(': '));
      row.appendChild(jsonView(v[k], depth + 1));
      d.appendChild(row);
    }
    return d;
  }
  // Path filter: .a.b[0], .items[].name, [2]
  function jsonQuery(data, path) {
    const toks = path.trim().match(/\.[^.[\]]+|\[\d*\]/g) || [];
    if (path.trim() && toks.join('') !== path.trim()) throw new Error(t('smart.json.syntax'));
    let cur = [data];
    for (const tk of toks) {
      const next = [];
      for (const v of cur) {
        if (tk === '[]') { if (Array.isArray(v)) next.push(...v); else if (v && typeof v === 'object') next.push(...Object.values(v)); }
        else if (tk[0] === '[') { if (Array.isArray(v) && v[+tk.slice(1, -1)] !== undefined) next.push(v[+tk.slice(1, -1)]); }
        else if (v && typeof v === 'object' && tk.slice(1) in v) next.push(v[tk.slice(1)]);
      }
      cur = next;
    }
    return toks.some((tk) => tk === '[]') ? cur : cur[0];
  }
  function jsonExplorer(card, data) {
    const bar = elt('div', 'row-btns');
    const q = elt('input', 'jq'); q.type = 'text'; q.placeholder = t('smart.json.filter'); q.spellcheck = false;
    const mini = elt('button', '', t('smart.json.copyMin')); mini.onclick = () => copyText(JSON.stringify(current()));
    const pretty = elt('button', '', t('smart.json.copyResult')); pretty.onclick = () => copyText(JSON.stringify(current(), null, 2));
    bar.append(q, pretty, mini); card.appendChild(bar);
    const out = elt('div', 'jtree'); card.appendChild(out);
    const err = elt('div', 'note'); card.appendChild(err);
    let result = data;
    const current = () => result;
    const run = () => {
      try { result = q.value.trim() ? jsonQuery(data, q.value) : data; err.textContent = ''; }
      catch (e) { err.textContent = e.message; return; }
      out.innerHTML = ''; out.appendChild(result === undefined ? elt('span', 'note', t('smart.json.noMatch')) : jsonView(result));
    };
    q.oninput = run; run();
  }

  const previews = {};
  function fillPreview(slot, p) {
    slot.innerHTML = '';
    if (p.error && !p.title) { slot.appendChild(elt('div', 'note', t('smart.link.previewFailed', { error: p.error }))); return; }
    if (p.image) { const img = elt('img'); img.src = p.image; img.alt = ''; img.onerror = () => img.remove(); slot.appendChild(img); }
    if (p.site) slot.appendChild(elt('div', 'note', p.site));
    if (p.title) slot.appendChild(elt('div', 'ptitle', p.title));
    if (p.description) slot.appendChild(elt('div', 'pdesc', p.description));
    window.__bidiFix.install(BIDI);
  }

  // ---- diff ----------------------------------------------------------------------------------------
  // LCS over tokens; returns [{t: '=', '-', '+', v}]
  function lcsDiff(a, b) {
    const n = a.length, m = b.length;
    if (n * m > 4e6) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: '=', v: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', v: a[i++] });
      else out.push({ t: '+', v: b[j++] });
    }
    while (i < n) out.push({ t: '-', v: a[i++] });
    while (j < m) out.push({ t: '+', v: b[j++] });
    return out;
  }
  const words = (s) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
  function wordLine(el, ops, keep) {
    for (const o of ops) {
      if (o.t !== '=' && o.t !== keep) continue;
      if (o.t === '=') el.appendChild(document.createTextNode(o.v));
      else el.appendChild(elt('span', 'w' + (o.t === '+' ? 'add' : 'del'), o.v));
    }
  }
  function renderDiff(c, older, newer) {
    const head = elt('div', 'diffhead');
    head.appendChild(elt('span', 'chip', t('compare.chip')));
    head.appendChild(elt('span', 'note', `${older.app || ''} ${timeStr(older.time)}  →  ${newer.app || ''} ${timeStr(newer.time)}`));
    const close = elt('button', '', t('compare.close')); close.onclick = () => { compareWith = null; render(); };
    head.appendChild(close); c.appendChild(head);
    const A = (older.text || '').replace(/\r\n?/g, '\n').split('\n'), B = (newer.text || '').replace(/\r\n?/g, '\n').split('\n');
    const ops = lcsDiff(A, B);
    if (!ops) { c.appendChild(elt('div', 'empty', t('compare.tooLarge'))); return; }
    let add = 0, del = 0;
    const box = elt('div', 'diff');
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      // pair a run of '-' lines with the following '+' run for word-level highlighting
      if (o.t === '-' && ops[k + 1] && ops[k + 1].t === '+') {
        const dels = [], adds = [];
        while (ops[k] && ops[k].t === '-') dels.push(ops[k++].v);
        while (ops[k] && ops[k].t === '+') adds.push(ops[k++].v);
        k--;
        const n = Math.max(dels.length, adds.length);
        for (let x = 0; x < n; x++) {
          const wd = dels[x] != null && adds[x] != null ? lcsDiff(words(dels[x]), words(adds[x])) : null;
          if (dels[x] != null) { const l = elt('div', 'line dl'); if (wd) wordLine(l, wd, '-'); else l.textContent = dels[x]; box.appendChild(l); del++; }
          if (adds[x] != null) { const l = elt('div', 'line al'); if (wd) wordLine(l, wd, '+'); else l.textContent = adds[x]; box.appendChild(l); add++; }
        }
        continue;
      }
      const l = elt('div', 'line ' + (o.t === '+' ? 'al' : o.t === '-' ? 'dl' : 'eq'), o.v);
      if (o.t === '+') add++; if (o.t === '-') del++;
      box.appendChild(l);
    }
    head.insertBefore(elt('span', 'stat', `+${add}  −${del}`), close);
    if (!add && !del) c.appendChild(elt('div', 'note', t('compare.identical')));
    c.appendChild(box);
  }

  // ---- translation ---------------------------------------------------------------------------------
  // Translations live on the item, one per target: item.translations['auto' | 'ar' | ...] =
  //   {pending, req, sig} → {text, from, to, engine, model, provider, fallback, sig} or {error, from, to, engine, sig}.
  // item.trKey is the last chosen target; Show original / Show translation works with it. Neither is saved.
  let translateReq = 0;
  const trKeyOf = (target) => target || 'auto';
  // What a cached translation was made with; a translation from another engine / model is redone on request.
  const engineSig = () => (S.translateEngine === 'llm' && on('ai') ? 'llm:' + (S.translateProvider || '') + '/' + (S.translateModel || '') : 'apple');
  const curTr = (it) => (it && it.translations && it.trKey ? it.translations[it.trKey] : null);
  function requestTranslation(item, target, force) {
    const key = trKeyOf(target);
    item.translations = item.translations || {};
    const have = item.translations[key];
    item.trKey = key;
    if (!force && have && (have.pending || (have.text && have.sig === engineSig()))) {
      if (have.text) view = 'translation';
      render(); return;
    }
    const req = String(++translateReq);
    item.translations[key] = { pending: true, req, sig: engineSig() };
    const msg = { cmd: 'translate', text: item.text, req };
    if (target) msg.target = target;
    native(msg);
    render();
  }
  function langName(code) {
    if (!code) return '';
    try { return new Intl.DisplayNames([I18N.locale], { type: 'language' }).of(code) || code; } catch (e) { return code; }
  }
  const targetList = () => String(S.translateTargets || '').split(',').map((x) => x.trim()).filter(Boolean);
  // Context-menu "Translate ▸" submenu: Hebrew ↔ English (automatic) and every target, except the translation
  // already on screen (Show original / Show translation covers that one).
  const translateEntries = (it) => [{ key: 'auto', target: '', label: t('tr.auto') }]
    .concat(targetList().map((code) => ({ key: code, target: code, label: langName(code) })))
    .filter((x) => !(hasTr(it) && it.trKey === x.key))
    .map((x) => ({ label: x.label, run: () => requestTranslation(it, x.target) }));
  // "on-device" for Apple; "model (Provider)" for the AI engine.
  function engineLabel(tr) {
    if (tr.engine !== 'llm') return t('tr.onDevice');
    const pid = tr.provider || S.translateProvider;
    const p = ((CM.ai && CM.ai.providers) || []).find((x) => x.id === pid);
    const m = p && (p.models || []).find((x) => x.id === tr.model);
    const name = (m && m.label) || tr.model || '';
    return p && p.name ? (name ? name + ' (' + p.name + ')' : p.name) : name || 'AI';
  }

  let compareWith = null;  // another history item shown as a diff against the shown one
  let picking = false;     // next history click picks the item to compare with
  let view = 'original';   // 'original' | 'translation' for the shown item
  let lastShown = null;

  const hasTr = (it) => on('translate') && !!(curTr(it) && curTr(it).text);
  // Text the window currently shows (the translation when that view is on); Copy / Copy RTL use it.
  const shownText = (it) => (view === 'translation' && hasTr(it) ? curTr(it).text : it.text);
  const translatable = (it) => on('translate') && it && it.text && it.fmt !== 'json' && /[A-Za-z֐-׿]{2}/.test(it.text) && !detectSmart(it);
  const toEnglish = (t) => (t.match(/[֐-׿]/g) || []).length >= (t.match(/[A-Za-z]/g) || []).length;
  const autoLabel = (it) => (toEnglish(it.text) ? t('tr.toEnglish') : t('tr.toHebrew'));
  const canCompare = () => on('compare') && history.filter((h) => h.text).length > 1;

  // The small "Translate to…" menu under the ▾ button.
  function translateMenu(wrap, item, opener) {
    const old = wrap.querySelector('.tr-menu');
    const close = (refocus) => {
      const m = wrap.querySelector('.tr-menu'); if (m) m.remove();
      if (opener) { opener.setAttribute('aria-expanded', 'false'); if (refocus && opener.isConnected) opener.focus(); }
    };
    if (old) { close(false); return; }
    const m = elt('div', 'tr-menu');
    m.setAttribute('role', 'menu'); m.setAttribute('aria-label', t('tr.translateTo'));
    const title = elt('div', 'tm-title', t('tr.translateTo')); title.dir = I18N.dir; title.setAttribute('role', 'presentation'); m.appendChild(title);
    const add = (labelText, target, langCode) => {
      const cur = item.trKey === trKeyOf(target) && hasTr(item);
      const d = menuItem(labelText, cur ? 'cur' : '');
      if (cur) d.setAttribute('aria-current', 'true');
      d.dir = I18N.dir;   // the menu box follows the action bar; its rows follow the interface language
      if (langCode) d.lang = langCode;
      d.onclick = (e) => { e.stopPropagation(); close(true); requestTranslation(item, target); };
      m.appendChild(d);
    };
    add(t('tr.auto'), '');
    for (const code of targetList()) add(langName(code), code);
    menuKeys(m, { escape: () => close(true), tab: () => close(false) });
    wrap.appendChild(m);
    if (opener) opener.setAttribute('aria-expanded', 'true');
    const first = m.querySelector('.mi'); if (first) first.focus();
  }
  document.addEventListener('mousedown', (e) => {
    if (!(e.target.closest && e.target.closest('.tr-split'))) document.querySelectorAll('.tr-menu').forEach((m) => m.remove());
  });

  function actionBar(c, item) {
    const bar = elt('div', 'actions');
    const tr = curTr(item);
    const extras = [];
    if (translatable(item)) {
      const split = elt('span', 'tr-split');
      if (tr && tr.pending) {
        bar.appendChild(elt('span', 'note', t('tr.translating')));
      } else {
        let main;
        if (hasTr(item)) {
          main = elt('button', view === 'translation' ? 'on' : '', view === 'translation' ? t('tr.showOriginal') : t('tr.showTranslation'));
          main.onclick = () => { view = view === 'translation' ? 'original' : 'translation'; render(); };
        } else {
          main = elt('button', '', autoLabel(item));
          main.onclick = () => requestTranslation(item, '');
        }
        const more = elt('button', 'tr-more', '▾');
        more.title = t('tr.more.title'); more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.onclick = (e) => { e.stopPropagation(); translateMenu(split, item, more); };
        split.append(main, more);
        bar.appendChild(split);
        if (hasTr(item) && view === 'translation') {
          const from = langName(tr.from), to = langName(tr.to);
          const arrow = I18N.dir === 'rtl' ? ' ← ' : ' → ';
          const note = elt('span', 'note tr-note', (from || to ? from + arrow + to + ' · ' : '') + engineLabel(tr));
          note.dir = I18N.dir;
          bar.appendChild(note);
          if (tr.fallback) extras.push(elt('span', 'tr-warn', tr.fallback.error ? t('tr.fallback', { error: tr.fallback.error }) : t('tr.fallbackNoError')));
        }
      }
    }
    if (item.text && canCompare()) {
      const b = elt('button', picking ? 'on' : '', picking ? t('compare.picking') : t('compare.button'));
      b.title = t('compare.title');
      b.onclick = () => { picking = !picking; if (picking) document.body.classList.add('show-history'); render(); renderHistory(); };
      bar.appendChild(b);
    }
    extras.forEach((x) => bar.appendChild(x));
    if (bar.children.length) c.appendChild(bar);
    if (on('translate') && tr && tr.error) {
      const target = item.trKey === 'auto' ? '' : item.trKey;
      const retry = () => { const r = elt('button', '', t('tr.tryAgain')); r.onclick = () => requestTranslation(item, target, true); return r; };
      const n = elt('div', 'card warn');
      if (tr.error === 'notInstalled') {
        n.appendChild(elt('div', '', t('tr.err.notInstalled', { from: langName(tr.from), to: langName(tr.to) })));
        const row = elt('div', 'row-btns'); const o = elt('button', '', t('tr.openLanguages'));
        o.onclick = () => native({ cmd: 'openTranslationSettings' }); row.append(o, retry()); n.appendChild(row);
      } else if (tr.error === 'unsupported') {
        n.appendChild(elt('div', '', t('tr.err.unsupported')));
      } else {
        n.appendChild(elt('div', '', tr.engine === 'llm' ? t('tr.err.llm', { error: tr.error }) : t('tr.err.failed', { error: tr.error })));
        const row = elt('div', 'row-btns'); row.append(retry()); n.appendChild(row);
      }
      c.appendChild(n);
    }
  }

  function renderBody(c, fmt, text, html) {
    if (fmt === 'json') {
      const pre = document.createElement('pre'); const code = document.createElement('code');
      code.className = 'language-json'; code.textContent = looksLikeJson(text);
      pre.appendChild(code); c.appendChild(pre); highlight(c);
    } else if (fmt === 'markdown' || fmt === 'rich') {
      const box = document.createElement('div');
      box.className = fmt === 'rich' ? 'md rich' : 'md';
      box.innerHTML = fmt === 'rich' ? sanitize(html) : marked.parse(text);
      c.appendChild(box);
      fixContainers(box); highlight(box);
    } else {
      c.appendChild(renderPlain(text));
    }
  }

  function render() {
    const c = $('#content');
    c.innerHTML = '';
    const item = history[shownIndex];
    if (item !== lastShown) { lastShown = item; view = 'original'; }
    if (compareWith && (compareWith === item || !history.includes(compareWith))) compareWith = null;
    document.body.classList.toggle('picking', picking);
    if (!item) { c.innerHTML = '<div class="empty"></div>'; c.firstChild.textContent = t('empty.copy'); updateHeader(); return; }
    const fmt = item.fmt;
    if (compareWith && item.text && compareWith.text) {
      const [older, newer] = compareWith.time <= item.time ? [compareWith, item] : [item, compareWith];
      renderDiff(c, older, newer);
    } else if (fmt === 'image') {
      if (S.images) {
        c.innerHTML = '<div class="imgwrap"><img alt=""></div><p class="note"></p>';
        c.querySelector('img').src = item.image;
        c.querySelector('.note').textContent = t('content.image', { size: item.size || '' });
      } else {
        c.innerHTML = '<div class="empty"></div>';
        c.firstChild.textContent = '🖼 ' + t('content.imageHidden', { size: item.size || '' });
      }
    } else if (fmt === 'secret') {
      c.innerHTML = '<div class="empty"></div>'; c.firstChild.textContent = '🔒 ' + t('content.secret');
    } else if (fmt === 'other') {
      c.innerHTML = '<div class="empty"></div>';
      c.firstChild.textContent = t('content.other', { types: item.types || t('content.unknown') });
    } else {
      actionBar(c, item);
      const text = shownText(item);
      if (raw) {
        const box = document.createElement('div'); box.className = 'raw';
        box.textContent = text; c.appendChild(box);
      } else if (view === 'translation' && hasTr(item)) {
        // A translation of rich HTML is plain text (or Markdown) now.
        renderBody(c, fmt === 'rich' ? classify({ kind: 'text', text }) : fmt, text);
      } else {
        const smart = detectSmart(item);
        // JWT / Base64: the decoded card is what matters; the token itself follows, collapsed.
        const cardFirst = !!smart && (smart.kind === 'jwt' || smart.kind === 'base64');
        if (!cardFirst && (fmt !== 'json' || !smart)) renderBody(c, fmt, text, item.html);
        if (smart) {
          const card = elt('div', 'card'); card.appendChild(elt('div', 'card-title', smart.title));
          let built = false;
          try { smart.build(card); c.appendChild(card); built = true; } catch (e) { if (fmt === 'json' || cardFirst) renderBody(c, fmt, text, item.html); }
          if (cardFirst && built) {
            const det = elt('details', 'raw-text');
            det.appendChild(elt('summary', '', t('menu.rawText')));
            renderBody(det, fmt, text, item.html);
            c.appendChild(det);
          }
        }
      }
    }
    window.__bidiFix.install(BIDI);
    c.scrollTop = 0;
    updateHeader();
  }

  const label = (fmt) => t('fmt.' + fmt);
  const timeStr = (ms, sec) => new Date(ms).toLocaleTimeString(I18N.locale, sec ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  let lastTitle = '';
  // Narrow window: #src drops the time so the header buttons don't squeeze it to nothing.
  const narrow = () => innerWidth < 520;
  let srcNarrow = narrow();
  window.addEventListener('resize', () => { if (narrow() !== srcNarrow) updateHeader(); });
  function updateHeader() {
    const item = history[shownIndex];
    const smart = item && item.fmt === 'text' && detectSmart(item);
    $('#kind').textContent = item ? (smart ? smart.title : label(item.fmt)) : '—';
    const bits = [];
    if (item && item.app) bits.push(item.app);
    if (item && item.time && !narrow()) {
      const today = new Date(item.time).toDateString() === new Date().toDateString();
      bits.push((today ? '' : new Date(item.time).toLocaleDateString(I18N.locale) + ' ') + timeStr(item.time, true));
    }
    if (item && item.text) bits.push(t('header.chars', { n: item.text.length.toLocaleString(I18N.locale) }));
    if (shownIndex > 0) bits.push(t('header.historyPos', { i: shownIndex + 1, n: history.length }));
    $('#src').textContent = bits.join(' · ');
    srcNarrow = narrow();
    const hasText = !!(item && item.text);
    $('#b-raw').classList.toggle('on', raw);
    $('#b-raw').disabled = !hasText;
    $('#b-copy').disabled = !hasText;
    // Copy RTL only makes sense for text with Hebrew in it; hide it otherwise (a disabled button just takes room).
    $('#b-rtl').hidden = !on('copyRtl') || !hasText || !HEB.test(shownText(item));
    $('#b-rtl').disabled = false;
    $('#b-hold').classList.toggle('on', held);
    $('#b-hist').classList.toggle('on', document.body.classList.contains('show-history'));
    $('#b-settings').classList.toggle('on', document.body.classList.contains('show-settings'));
    $('#paused').hidden = !state.paused;
    // Window / tab title: "Clipboard" while live, the held item's first words while held.
    const firstLine = (s) => (s.split('\n').map((l) => l.replace(/^\s*(#{1,6}|[-*+>]|\d+[.)])\s+/, '').trim()).find(Boolean) || '');
    const title = held && item ? (firstLine(item.text || label(item.fmt)).slice(0, 32) || t('title.held')) : t('title.live');
    if (title !== lastTitle) { lastTitle = title; native({ cmd: 'title', title }); }
    reportDragZones();
  }

  // History previews show Markdown as plain words: no heading / list / quote markers, ** or backticks.
  function previewText(it) {
    const s = it.text.slice(0, 600);
    if (it.fmt !== 'markdown') return s.slice(0, 200);
    return s.split('\n').filter((l) => !/^\s*(```|~~~)/.test(l))
      .map((l) => l.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/, '')
        .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1').replace(/\*\*|__|`/g, ''))
      .join('\n').slice(0, 200);
  }

  function renderHistory() {
    const h = $('#hlist');
    // Keep keyboard focus on the same item (or the same place, if it was deleted) across re-renders.
    const ae = document.activeElement;
    const fRow = ae && h.contains(ae) ? ae.closest('.item') : null;
    const rowsBefore = [...h.querySelectorAll('.item')];
    const focusItem = fRow ? fRow.item : null, focusPos = fRow ? rowsBefore.indexOf(fRow) : -1;
    h.setAttribute('role', 'listbox'); h.setAttribute('aria-label', t('history.label'));
    h.innerHTML = '';
    const q = query.trim().toLowerCase();
    let shown = 0;
    const match = (it) => !q || (it.text || '').toLowerCase().includes(q) || (it.app || '').toLowerCase().includes(q);
    const idx = history.map((it, i) => i).filter((i) => match(history[i]));
    const pinned = idx.filter((i) => history[i].pinned), recent = idx.filter((i) => !history[i].pinned);
    const section = (label) => { const d = document.createElement('div'); d.className = 'sec'; d.setAttribute('role', 'presentation'); d.textContent = label; h.appendChild(d); };
    const row = (i) => {
      const it = history[i];
      shown++;
      const d = document.createElement('div');
      d.className = 'item' + (i === shownIndex ? ' sel' : '') + (it.pinned ? ' pinned' : '') + (it === compareWith ? ' cmp' : '');
      d.dataset.index = i; d.item = it;
      d.tabIndex = 0; d.setAttribute('role', 'option'); d.setAttribute('aria-selected', String(i === shownIndex));
      const tx = document.createElement('div'); tx.className = 't';
      tx.textContent = it.text ? previewText(it) : (it.fmt === 'image' ? '🖼 ' + t('content.image', { size: it.size || '' }) : it.fmt === 'secret' ? '🔒 ' + t('history.hidden') : '…');
      const s = document.createElement('div'); s.className = 's';
      if (it.pinned) s.innerHTML = '<span class="pin-mark">' + ICON_PIN + '</span>';
      s.append([label(it.fmt), it.app, timeStr(it.time)].filter(Boolean).join(' · '));
      const acts = document.createElement('div'); acts.className = 'acts';
      const bp = document.createElement('button'); bp.innerHTML = ICON_PIN; bp.title = it.pinned ? t('menu.unpin') : t('menu.pin');
      bp.onclick = (e) => { e.stopPropagation(); op(it.pinned ? 'unpin' : 'pin', it); };
      const bd = document.createElement('button'); bd.innerHTML = ICON_DEL; bd.title = t('menu.delete');
      bd.onclick = (e) => { e.stopPropagation(); op('delete', it); };
      acts.append(bp, bd);
      d.append(tx, s, acts);
      d.onclick = () => {
        if (picking && on('compare')) { picking = false; if (i !== shownIndex && it.text) compareWith = it; render(); renderHistory(); return; }
        shownIndex = i; render(); renderHistory();
      };
      d.addEventListener('keydown', (e) => {
        if (e.target !== d) return;   // the pin / delete buttons keep their own keys
        const rows = [...h.querySelectorAll('.item')], k = rows.indexOf(d);
        if (e.key === 'Enter' || e.key === ' ') d.click();
        else if (e.key === 'Delete' || e.key === 'Backspace') op('delete', it);
        else if (e.key === 'ArrowDown') { if (rows[k + 1]) rows[k + 1].focus(); }
        else if (e.key === 'ArrowUp') { if (k > 0) rows[k - 1].focus(); else $('#search').focus(); }
        else if (e.key === 'Home') rows[0].focus();
        else if (e.key === 'End') rows[rows.length - 1].focus();
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          const r = d.getBoundingClientRect();
          openMenu(I18N.dir === 'rtl' ? r.right : r.left, r.bottom, itemEntries(it, i, false));
        } else return;
        e.preventDefault(); e.stopPropagation();
      });
      h.appendChild(d);
    };
    if (pinned.length) { section(t('history.pinned')); pinned.forEach(row); if (recent.length) section(t('history.recent')); }
    recent.forEach(row);
    if (!shown) { h.innerHTML = '<div class="none" role="presentation"></div>'; h.firstChild.textContent = q ? t('history.noMatches') : t('history.empty'); }
    if (fRow) {
      const rows = [...h.querySelectorAll('.item')];
      const target = rows.find((r) => r.item === focusItem) || rows[Math.min(focusPos, rows.length - 1)];
      (target || $('#search')).focus();
    }
  }

  // Items are matched by content across windows (ids can differ between windows' histories).
  const keyOf = (it) => it.text || it.image || it.id || String(it.time);
  // Keep pinned items and the shown item; drop the oldest unpinned ones beyond the history size.
  function trim() {
    const max = Number(S.maxHistory) || 50;
    const shownItem = history[shownIndex];
    let n = 0;
    history = history.filter((it) => it.pinned || ++n <= max || it === shownItem);
    shownIndex = Math.max(0, history.indexOf(shownItem));
  }
  const ICON_PIN = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5l4 4-2.2 1-2.6 2.6.3 3-1.5.4-5-5 .4-1.5 3 .3 2.6-2.6z"/><path d="M5.5 10.5L2.5 13.5"/></svg>';
  const ICON_DEL = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => native({ cmd: 'saveHistory', items: exportHistory() });
    if (now) run(); else saveTimer = setTimeout(run, 600);
  }
  function exportHistory() {
    return history.filter((it) => it.fmt !== 'secret' && !(it.image && it.image.length > MAX_SAVED_IMAGE))
      .map(({ fmt, self, translation, translations, trKey, ...rest }) => rest);
  }

  // ---- settings that affect rendering (the Settings UI itself is settings.js) -------------------------
  let renderedWith = '';
  function applySettings() {
    BIDI.detect = S.detect; BIDI.ratio = Number(S.ratio);
    document.documentElement.style.setProperty('--font', FONTS[S.font] || FONTS.system);
    trim();
    // Re-render only when something that affects rendering changed.
    const sig = [S.detect, S.ratio, S.rich, S.markdown, S.highlight, S.images, I18N.lang,
      Object.keys(S).filter((k) => k.startsWith('f.')).map((k) => S[k]).join(',')].join('|');
    if (sig !== renderedWith) {
      renderedWith = sig;
      if (!on('compare')) { picking = false; compareWith = null; }
      if (!on('translate')) view = 'original';
      history.forEach((it) => { it.fmt = classify(it); });
      render(); renderHistory();
    }
  }
  CM.on('settings', applySettings);

  // Pin / unpin / delete go through the app so every window applies them.
  function op(kind, it) { native({ cmd: 'historyOp', op: kind, key: keyOf(it) }); }

  // ---- menus: keyboard ------------------------------------------------------------------------------
  // Arrow keys / Home / End move focus over the box's own .mi rows, Enter / Space activate, Escape and Tab call
  // the handlers. `forward` (ArrowRight, ArrowLeft in RTL) opens a submenu, `back` (the other arrow) leaves one.
  function menuKeys(box, { escape, tab, forward, back }) {
    box.addEventListener('keydown', (e) => {
      const list = [...box.querySelectorAll(':scope > .mi')];
      const i = list.indexOf(document.activeElement);
      const fwdKey = I18N.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight', backKey = I18N.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const go = (k) => { if (list.length) list[(k + list.length) % list.length].focus(); };
      switch (e.key) {
        case 'ArrowDown': go(i + 1); break;
        case 'ArrowUp': go(i < 0 ? -1 : i - 1); break;
        case 'Home': go(0); break;
        case 'End': go(-1); break;
        case 'Enter': case ' ': if (list[i]) list[i].click(); break;
        case 'Escape': if (escape) escape(); break;
        case 'Tab': if (tab) tab(); break;
        default:
          if (e.key === fwdKey && forward && list[i] && list[i].getAttribute('aria-haspopup')) forward(list[i]);
          else if (e.key === backKey && back) back();
          else return;
      }
      e.preventDefault(); e.stopPropagation();
    });
  }
  // One menu row: role menuitem, focusable by script only (the menu moves focus itself).
  function menuItem(labelText, cls) {
    const d = elt('div', 'mi' + (cls ? ' ' + cls : ''), labelText);
    d.setAttribute('role', 'menuitem'); d.tabIndex = -1;
    return d;
  }

  // ---- right-click menu ------------------------------------------------------------------------------
  // Entries: {label, key?, danger?, run} or {label, sub: [entries]} (a submenu, opened to the inline-end side), '-'.
  const ctx = $('#ctx');
  ctx.setAttribute('role', 'menu');
  let menuOpener = null;   // element focused before the menu opened; focus goes back there on close
  let subMenu = null;
  function closeSub() {
    if (!subMenu) return;
    const p = subMenu.parentItem; subMenu.remove(); subMenu = null;
    if (p) p.setAttribute('aria-expanded', 'false');
  }
  function closeMenu(restore) {
    if (!ctx.classList.contains('show')) return;
    closeSub();
    ctx.classList.remove('show');
    const back = menuOpener; menuOpener = null;
    if (restore && back && back.isConnected && back.focus) back.focus();
    if (ctx.contains(document.activeElement)) document.activeElement.blur();   // never leave focus in the hidden menu
  }
  function fillMenu(box, entries) {
    for (const e of entries) {
      if (e === '-') { const hr = document.createElement('hr'); hr.setAttribute('role', 'separator'); box.appendChild(hr); continue; }
      if (!e) continue;
      const d = menuItem(e.label, e.danger ? 'danger' : '');
      if (e.key) { const k = document.createElement('kbd'); k.textContent = e.key; d.appendChild(k); }
      if (e.sub) {
        d.setAttribute('aria-haspopup', 'menu'); d.setAttribute('aria-expanded', 'false'); d.subEntries = e.sub;
        const arrow = elt('span', 'sub-arrow', I18N.dir === 'rtl' ? '◂' : '▸');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.style.cssText = 'margin-inline-start:auto;padding-inline-start:12px;opacity:.6';   // like #ctx .mi kbd
        d.appendChild(arrow);
        d.onclick = (ev) => { ev.stopPropagation(); openSub(d, e.sub, true); };
        d.onmouseenter = () => { if (!subMenu || subMenu.parentItem !== d) openSub(d, e.sub, false); };
      } else {
        d.onclick = (ev) => { ev.stopPropagation(); closeMenu(true); e.run(); };
        if (box === ctx) d.onmouseenter = closeSub;
      }
      box.appendChild(d);
    }
  }
  function openMenu(x, y, entries) {
    const wasOpen = ctx.classList.contains('show');
    closeSub();
    if (!wasOpen) menuOpener = document.activeElement;
    ctx.innerHTML = '';
    fillMenu(ctx, entries);
    ctx.classList.add('show');
    const r = ctx.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';   // macOS opens menus to the left of the cursor in RTL
    ctx.style.left = Math.max(4, Math.min(rtl ? x - r.width : x, innerWidth - r.width - 4)) + 'px';
    ctx.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    const first = ctx.querySelector(':scope > .mi'); if (first) first.focus();
  }
  // Submenu: a second panel inside #ctx (so #ctx .mi / hr styles apply), beside its row on the inline-end side.
  function openSub(parentItem, entries, focusFirst) {
    closeSub();
    const sub = elt('div', 'ctx-sub');
    sub.setAttribute('role', 'menu'); sub.setAttribute('aria-label', parentItem.firstChild.textContent);
    // Panel look copied from #ctx (its rules are id-based).
    const cs = getComputedStyle(ctx);
    Object.assign(sub.style, { position: 'fixed', zIndex: '21', boxSizing: 'border-box', minWidth: '170px', maxHeight: (innerHeight - 8) + 'px',
      overflowY: 'auto', padding: cs.padding, borderRadius: cs.borderRadius, background: cs.backgroundColor, border: cs.border, boxShadow: cs.boxShadow });
    fillMenu(sub, entries);
    sub.parentItem = parentItem;
    ctx.appendChild(sub); subMenu = sub;
    parentItem.setAttribute('aria-expanded', 'true');
    menuKeys(sub, {
      escape: () => { closeSub(); parentItem.focus(); }, back: () => { closeSub(); parentItem.focus(); },
      tab: () => closeMenu(true),
    });
    const pr = parentItem.getBoundingClientRect(), sr = sub.getBoundingClientRect();
    const rightFits = pr.right + sr.width <= innerWidth - 4, leftFits = pr.left - sr.width >= 4;
    const toRight = I18N.dir === 'rtl' ? !leftFits && rightFits : rightFits || !leftFits;
    const left = toRight ? pr.right + 2 : pr.left - sr.width - 2;
    sub.style.left = Math.max(4, Math.min(left, innerWidth - sr.width - 4)) + 'px';
    sub.style.top = Math.max(4, Math.min(pr.top - 5, innerHeight - sr.height - 4)) + 'px';
    if (focusFirst) { const f = sub.querySelector('.mi'); if (f) f.focus(); }
  }
  menuKeys(ctx, {
    escape: () => closeMenu(true), tab: () => closeMenu(true),
    forward: (item) => openSub(item, item.subEntries, true),
  });
  function copyText(text, rtl) { native({ cmd: 'copy', text: rtl ? wrapRtl(text) : text }); toast(rtl ? t('toast.copiedRtl') : t('toast.copied')); }
  function itemEntries(it, i, inContent) {
    const sel = inContent ? String(window.getSelection() || '') : '';
    return [
      sel && { label: t('menu.copySelection'), run: () => copyText(sel) },
      sel && on('copyRtl') && HEB.test(sel) && { label: t('menu.copySelectionRtl'), run: () => copyText(sel, true) },
      sel && '-',
      it.text && { label: t('menu.copy'), run: () => copyText(inContent ? shownText(it) : it.text) },
      it.text && on('copyRtl') && HEB.test(inContent ? shownText(it) : it.text) && { label: t('menu.copyRtl'), key: inContent ? '⇧⌘C' : '', run: () => copyText(inContent ? shownText(it) : it.text, true) },
      it.text && '-',
      { label: it.pinned ? t('menu.unpin') : t('menu.pin'), run: () => op(it.pinned ? 'unpin' : 'pin', it) },
      { label: t('menu.openInWindow'), run: () => native({ cmd: 'openItem', id: keyOf(it) }) },
      inContent ? { label: held ? t('menu.follow') : t('menu.hold'), key: '⌘L', run: () => window.monitor.toggleHold() }
                : { label: t('menu.show'), run: () => { shownIndex = i; render(); renderHistory(); } },
      inContent && it.text && { label: raw ? t('menu.showRendered') : t('menu.showRaw'), key: '⌘R', run: () => window.monitor.toggleRaw() },
      inContent && hasTr(it) && { label: view === 'translation' ? t('tr.showOriginal') : t('tr.showTranslation'), run: () => { view = view === 'translation' ? 'original' : 'translation'; render(); } },
      inContent && translatable(it) && { label: t('menu.translate'), sub: translateEntries(it) },
      !inContent && on('compare') && it.text && i !== shownIndex && history[shownIndex] && history[shownIndex].text && { label: t('menu.compareWithShown'), run: () => { compareWith = it; picking = false; render(); renderHistory(); } },
      inContent && compareWith && on('compare') && { label: t('menu.closeCompare'), run: () => { compareWith = null; render(); renderHistory(); } },
      '-',
      { label: t('menu.delete'), danger: true, run: () => op('delete', it) },
    ];
  }
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, select')) return;      // keep the native menu for editing fields
    e.preventDefault();
    const row = e.target.closest('#hlist .item');
    if (row) { const i = Number(row.dataset.index); openMenu(e.clientX, e.clientY, itemEntries(history[i], i, false)); return; }
    if (e.target.closest('#content') && history[shownIndex]) { openMenu(e.clientX, e.clientY, itemEntries(history[shownIndex], shownIndex, true)); return; }
    closeMenu();
  });
  document.addEventListener('mousedown', (e) => { if (!(e.target.closest && e.target.closest('#ctx'))) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  document.getElementById('content').addEventListener('scroll', closeMenu);

  // ---- API used by the app --------------------------------------------------------------------------
  window.monitor = {
    push(item) {
      // Our own Copy / Copy RTL: the user already sees this content, don't add a near-duplicate.
      if (item.self) return;
      item = Object.assign({}, item);
      item.time = item.time || Date.now();
      item.fmt = classify(item);
      const same = (a) => a && a.fmt === item.fmt && (item.text ? a.text === item.text : item.image ? a.image === item.image : false);
      const dup = history.findIndex(same);
      if (dup === 0 && (shownIndex === 0 || held)) { history[0].time = item.time; updateHeader(); return; }
      let shownItem = history[shownIndex];
      if (dup >= 0) {
        item.pinned = history[dup].pinned;
        if (history[dup] === shownItem) shownItem = item;
        history.splice(dup, 1);
      }
      history.unshift(item);
      if (held && shownItem) {
        // keep showing the held item; only the history list moves
        shownIndex = history.indexOf(shownItem);
        trim();
        updateHeader(); renderHistory();
      } else {
        shownIndex = 0;
        trim();
        render(); renderHistory();
      }
      save();
    },
    loadHistory(items) {
      if (!Array.isArray(items)) return;
      const byKey = new Map(history.map((h) => [keyOf(h), h]));
      for (const it of items) {
        const mine = byKey.get(keyOf(it));
        if (mine) { if (it.pinned) mine.pinned = true; continue; }
        it.fmt = classify(it); history.push(it);
      }
      const shownItem = history[shownIndex];
      history.sort((a, b) => b.time - a.time);
      shownIndex = Math.max(0, history.indexOf(shownItem));
      trim();
      render(); renderHistory();
    },
    exportHistory,
    saveNow() { save(true); },
    setSettings(s) {
      Object.assign(S, s);
      if (I18N.setLang(S.uiLangResolved || 'en')) CM.emit('lang', I18N.lang);
      CM.emit('settings', S);
    },
    aiState(st) { CM.ai = st || { providers: [], presets: [] }; CM.emit('aiState', CM.ai); },
    aiEvent(ev) { CM.emit('aiEvent', ev); },
    versionInfo(info) { CM.emit('versionInfo', info); },
    setState(s) { state = Object.assign(state, s); updateHeader(); },
    setInsets(i) {
      const r = document.documentElement.style;
      r.setProperty('--pad-l', i.left + 'px'); r.setProperty('--pad-r', i.right + 'px'); r.setProperty('--pad-t', (i.top || 0) + 'px');
      reportDragZones();
    },
    toggleRaw() { raw = !raw; render(); },
    toggleHold() {
      held = !held;
      if (!held && shownIndex !== 0) { shownIndex = 0; render(); renderHistory(); }
      toast(held ? t('toast.holding') : t('toast.following'));
      updateHeader();
    },
    toggleHistory() {
      document.body.classList.toggle('show-history'); updateHeader();
      if (document.body.classList.contains('show-history')) $('#search').focus();
    },
    toggleSettings(force) {
      const on = document.body.classList.toggle('show-settings', force);
      CM.emit('settingsPanel', on);
      updateHeader();
    },
    openSettings() { this.toggleSettings(true); },
    // Clearing keeps pinned items and the item on screen.
    clearHistory() {
      const shownItem = history[shownIndex];
      history = history.filter((it) => it.pinned || it === shownItem);
      shownIndex = Math.max(0, history.indexOf(shownItem));
      render(); renderHistory(); save(true);
    },
    applyOp({ op: kind, key }) {
      const i = history.findIndex((it) => keyOf(it) === key);
      if (i < 0) return;
      if (kind === 'pin' || kind === 'unpin') { history[i].pinned = kind === 'pin'; renderHistory(); }
      if (kind === 'delete') {
        const shownItem = history[shownIndex];
        history.splice(i, 1);
        if (shownItem === undefined || history.indexOf(shownItem) < 0) { shownIndex = 0; held = false; render(); }
        else shownIndex = history.indexOf(shownItem);
        renderHistory(); updateHeader();
      }
      save();
    },
    showHeld({ id: key }) {
      const i = history.findIndex((it) => keyOf(it) === key);
      if (i < 0) return;
      shownIndex = i; held = true; render(); renderHistory();
    },
    translated(r) {
      let it = null, key = null;
      for (const h of history) {
        for (const [k, v] of Object.entries(h.translations || {})) if (v && v.req === r.req) { it = h; key = k; }
        if (it) break;
      }
      if (!it) return;
      const sig = it.translations[key].sig;
      const base = { from: r.from, to: r.to, engine: r.engine || 'apple', model: r.model || '', provider: r.provider || '', sig };
      if (r.error) it.translations[key] = Object.assign(base, { error: r.error });
      else {
        // fallbackFrom: the AI engine failed and Apple translated instead. It may be a string ('llm') with the
        // reason in fallbackError, or an object {engine, model, error}.
        const fb = r.fallbackFrom ? { error: typeof r.fallbackFrom === 'object' ? (r.fallbackFrom.error || '')
          : (r.fallbackError || (r.fallbackFrom !== 'llm' ? r.fallbackFrom : '')) } : null;
        // A fallback result was made on-device: cache it as such so the next request tries the AI model again.
        it.translations[key] = Object.assign(base, { text: r.text, fallback: fb }, fb ? { sig: 'apple' } : {});
      }
      const shown = it === history[shownIndex] && it.trKey === key;
      if (shown && !r.error) view = 'translation';
      if (shown) render();
      CM.emit('translated', r);
    },
    previewed(p) {
      previews[p.url] = p;
      document.querySelectorAll('.preview').forEach((slot) => { if (slot.dataset.url === p.url) fillPreview(slot, p); });
      document.querySelectorAll('.card button[data-loading]').forEach((b) => b.remove());
    },
    copyRtl() {
      const it = history[shownIndex];
      if (!it || !it.text) return;
      native({ cmd: 'copy', text: wrapRtl(shownText(it)) });
      toast(t('toast.copiedRtl'));
    },
  };

  $('#b-raw').onclick = () => window.monitor.toggleRaw();
  $('#b-hist').onclick = () => window.monitor.toggleHistory();
  $('#b-hold').onclick = () => window.monitor.toggleHold();
  $('#b-copy').onclick = () => { const it = history[shownIndex]; if (it && it.text) { native({ cmd: 'copy', text: shownText(it) }); toast(t('toast.copied')); } };
  $('#b-rtl').onclick = () => window.monitor.copyRtl();
  $('#kind').ondblclick = () => native({ cmd: 'pause' });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderHistory(); });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('#hlist .item'); if (first) first.click(); }
    if (e.key === 'ArrowDown') { const first = $('#hlist .item'); if (first) { e.preventDefault(); first.focus(); } }
    if (e.key === 'Escape') { e.target.value = ''; query = ''; renderHistory(); e.target.blur(); }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(a.href)) native({ cmd: 'open', url: a.href });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctx.classList.contains('show')) { closeMenu(true); return; }
    if (e.key === 'Escape' && document.body.classList.contains('show-settings')) { window.monitor.toggleSettings(false); return; }
    if (e.key === 'Escape' && (picking || compareWith)) { picking = false; compareWith = null; render(); renderHistory(); return; }
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowDown' && shownIndex < history.length - 1) { shownIndex++; render(); renderHistory(); }
    if (e.key === 'ArrowUp' && shownIndex > 0) { shownIndex--; render(); renderHistory(); }
  });

  // Tell the app which parts of the header are controls; the rest of the header drags the window.
  function reportDragZones() {
    const header = $('header');
    const controls = [...document.querySelectorAll('header button, header .chip')].filter((e) => e.offsetParent)
      .map((e) => { const r = e.getBoundingClientRect(); return [r.left - 2, r.top - 2, r.width + 4, r.height + 4]; });
    native({ cmd: 'dragZones', header: header.getBoundingClientRect().bottom, controls });
  }
  new ResizeObserver(reportDragZones).observe($('header'));
  window.addEventListener('resize', reportDragZones);
  CM.on('lang', () => { render(); renderHistory(); });
  applySettings(); updateHeader(); renderHistory();
})();
