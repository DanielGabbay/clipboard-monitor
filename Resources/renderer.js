// Renderer: clipboard history, rendering, smart cards, compare, translation UI, context menu, window.monitor API.
// Settings UI lives in settings.js (+ settings-*.js tabs); shared bridge/settings/events in core.js; strings in i18n-core-*.js.
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const native = CM.native;
  const toast = CM.toast;
  const MAX_SAVED_IMAGE = 400000; // data-URL chars; bigger images are shown but not kept across restarts

  const S = CM.S;   // live settings object shared with settings.js (mutated in place, never replaced)

  // BiDi: majority detection per block (see toolkit README "Choosing the detection mode").
  // Rich HTML from web pages often holds text directly in <div>s, so leaf divs count as blocks there.
  const BIDI = {
    blocks: 'p, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, .line, .decoded, ' +
            '.rich div:not(:has(div, p, ul, ol, table, pre, h1, h2, h3, h4, blockquote))',
    editors: '#search, #settings textarea, #settings input[type=text]', detect: 'majority', ratio: 0.3, align: true,
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
    if (!txt || txt.length > 200000) return null;
    const single = !/\s/.test(txt);
    // JWT
    if (single && /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/.test(txt)) {
      try {
        const [h, p] = txt.split('.').slice(0, 2).map((x) => JSON.parse(b64decode(x)));
        if (h && h.alg) return { title: t('smart.jwt'), build: (card) => {
          const now = Date.now();
          if (p.exp) {
            const exp = p.exp * 1000;
            card.appendChild(elt('div', 'badge ' + (exp < now ? 'bad' : 'good'), exp < now ? t('smart.jwt.expired', { when: relTime(exp) }) : t('smart.jwt.valid', { when: relTime(exp) })));
          }
          const kv = [['alg', h.alg], ['typ', h.typ]];
          for (const k of ['iss', 'sub', 'aud']) if (p[k] != null) kv.push([k, String(p[k])]);
          for (const k of ['iat', 'nbf', 'exp']) if (p[k]) kv.push([k, fullDate(p[k] * 1000)]);
          card.appendChild(kvTable(kv));
          card.appendChild(elt('div', 'sub', t('smart.jwt.header'))); card.appendChild(jsonView(h));
          card.appendChild(elt('div', 'sub', t('smart.jwt.payload'))); card.appendChild(jsonView(p));
          card.appendChild(elt('div', 'note', t('smart.jwt.unverified')));
        } };
      } catch (e) { /* not a JWT */ }
    }
    // URL
    if (single && /^https?:\/\/[^\s]+$/i.test(txt)) {
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
        row.append(open, prev); card.appendChild(row);
        const slot = elt('div', 'preview'); slot.dataset.url = u.href; card.appendChild(slot);
        if (previews[u.href]) fillPreview(slot, previews[u.href]);
      } };
    }
    // Color
    const col = parseColor(txt);
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
    if (ms && ms > Date.UTC(1990, 0) && ms < Date.UTC(2100, 0)) return { title: t('smart.time'), build: (card) => {
      card.appendChild(elt('div', 'big', fullDate(ms)));
      card.appendChild(elt('div', 'note', relTime(ms)));
      card.appendChild(kvTable([['UTC', new Date(ms).toISOString()], [t('smart.time.unixS'), String(Math.floor(ms / 1000))], [t('smart.time.unixMs'), String(ms)]], true));
    } };
    // JSON
    if (item.fmt === 'json') return { title: t('smart.json'), build: (card) => jsonExplorer(card, JSON.parse(txt)) };
    // Base64 (only when it decodes to readable UTF-8)
    if (single && txt.length >= 12 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(txt) && !/^\d+$/.test(txt)) {
      try {
        const dec = b64decode(txt);
        if (printable(dec)) return { title: t('smart.base64'), build: (card) => {
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
    for (const [k, v] of rows) {
      const tr = elt('tr'); tr.append(elt('th', '', k));
      const td = elt('td', '', v == null ? '' : String(v));
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
  function jsonView(v, depth = 0) {
    if (v === null || typeof v !== 'object') {
      const s = elt('span', 'j-' + (v === null ? 'null' : typeof v), typeof v === 'string' ? JSON.stringify(v) : String(v));
      return s;
    }
    const isArr = Array.isArray(v), keys = Object.keys(v);
    const d = elt('details', 'jnode'); if (depth < 2) d.open = true;
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
  let translateReq = 0;
  function requestTranslation(item) {
    item.translation = { pending: true };
    const req = String(++translateReq);
    item.translation.req = req;
    native({ cmd: 'translate', text: item.text, req });
    render();
  }

  let compareWith = null;  // another history item shown as a diff against the shown one
  let picking = false;     // next history click picks the item to compare with
  let view = 'original';   // 'original' | 'translation' for the shown item
  let lastShown = null;

  const hasTr = (it) => !!(it && it.translation && it.translation.text);
  // Text the window currently shows (the translation when that view is on); Copy / Copy RTL use it.
  const shownText = (it) => (view === 'translation' && hasTr(it) ? it.translation.text : it.text);
  const translatable = (it) => it && it.text && it.fmt !== 'json' && /[A-Za-z֐-׿]{2}/.test(it.text) && !detectSmart(it);
  const toEnglish = (t) => (t.match(/[֐-׿]/g) || []).length >= (t.match(/[A-Za-z]/g) || []).length;

  function actionBar(c, item) {
    const bar = elt('div', 'actions');
    const tr = item.translation;
    if (translatable(item)) {
      if (hasTr(item)) {
        const b = elt('button', view === 'translation' ? 'on' : '', view === 'translation' ? t('tr.showOriginal') : t('tr.showTranslation'));
        b.onclick = () => { view = view === 'translation' ? 'original' : 'translation'; render(); };
        bar.appendChild(b);
        if (view === 'translation') bar.appendChild(elt('span', 'note', (tr.from || '') + ' → ' + (tr.to || '') + ' · ' + t('tr.onDevice')));
      } else if (tr && tr.pending) {
        bar.appendChild(elt('span', 'note', t('tr.translating')));
      } else {
        const b = elt('button', '', toEnglish(item.text) ? t('tr.toEnglish') : t('tr.toHebrew'));
        b.onclick = () => requestTranslation(item);
        bar.appendChild(b);
      }
    }
    if (item.text && history.filter((h) => h.text).length > 1) {
      const b = elt('button', picking ? 'on' : '', picking ? t('compare.picking') : t('compare.button'));
      b.title = t('compare.title');
      b.onclick = () => { picking = !picking; if (picking) document.body.classList.add('show-history'); render(); renderHistory(); };
      bar.appendChild(b);
    }
    if (bar.children.length) c.appendChild(bar);
    if (tr && tr.error) {
      const n = elt('div', 'card warn');
      if (tr.error === 'notInstalled') {
        n.appendChild(elt('div', '', t('tr.err.notInstalled', { from: tr.from || '', to: tr.to || '' })));
        const row = elt('div', 'row-btns'); const o = elt('button', '', t('tr.openLanguages'));
        o.onclick = () => native({ cmd: 'openTranslationSettings' }); const r = elt('button', '', t('tr.tryAgain'));
        r.onclick = () => requestTranslation(item); row.append(o, r); n.appendChild(row);
      } else if (tr.error === 'unsupported') {
        n.appendChild(elt('div', '', t('tr.err.unsupported')));
      } else {
        n.appendChild(elt('div', '', t('tr.err.failed', { error: tr.error })));
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
        if (fmt !== 'json' || !smart) renderBody(c, fmt, text, item.html);
        if (smart) {
          const card = elt('div', 'card'); card.appendChild(elt('div', 'card-title', smart.title));
          try { smart.build(card); c.appendChild(card); } catch (e) { if (fmt === 'json') renderBody(c, fmt, text); }
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
  function updateHeader() {
    const item = history[shownIndex];
    const smart = item && item.fmt === 'text' && detectSmart(item);
    $('#kind').textContent = item ? (smart ? smart.title : label(item.fmt)) : '—';
    const bits = [];
    if (item && item.app) bits.push(item.app);
    if (item && item.time) {
      const today = new Date(item.time).toDateString() === new Date().toDateString();
      bits.push((today ? '' : new Date(item.time).toLocaleDateString(I18N.locale) + ' ') + timeStr(item.time, true));
    }
    if (item && item.text) bits.push(t('header.chars', { n: item.text.length.toLocaleString(I18N.locale) }));
    if (shownIndex > 0) bits.push(t('header.historyPos', { i: shownIndex + 1, n: history.length }));
    $('#src').textContent = bits.join(' · ');
    const hasText = !!(item && item.text);
    $('#b-raw').classList.toggle('on', raw);
    $('#b-raw').disabled = !hasText;
    $('#b-copy').disabled = !hasText;
    $('#b-rtl').disabled = !hasText || !HEB.test(shownText(item));
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

  function renderHistory() {
    const h = $('#hlist');
    h.innerHTML = '';
    const q = query.trim().toLowerCase();
    let shown = 0;
    const match = (it) => !q || (it.text || '').toLowerCase().includes(q) || (it.app || '').toLowerCase().includes(q);
    const idx = history.map((it, i) => i).filter((i) => match(history[i]));
    const pinned = idx.filter((i) => history[i].pinned), recent = idx.filter((i) => !history[i].pinned);
    const section = (label) => { const d = document.createElement('div'); d.className = 'sec'; d.textContent = label; h.appendChild(d); };
    const row = (i) => {
      const it = history[i];
      shown++;
      const d = document.createElement('div');
      d.className = 'item' + (i === shownIndex ? ' sel' : '') + (it.pinned ? ' pinned' : '') + (it === compareWith ? ' cmp' : '');
      d.dataset.index = i;
      const tx = document.createElement('div'); tx.className = 't';
      tx.textContent = it.text ? it.text.slice(0, 200) : (it.fmt === 'image' ? '🖼 ' + t('content.image', { size: it.size || '' }) : it.fmt === 'secret' ? '🔒 ' + t('history.hidden') : '…');
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
        if (picking) { picking = false; if (i !== shownIndex && it.text) compareWith = it; render(); renderHistory(); return; }
        shownIndex = i; render(); renderHistory();
      };
      h.appendChild(d);
    };
    if (pinned.length) { section(t('history.pinned')); pinned.forEach(row); if (recent.length) section(t('history.recent')); }
    recent.forEach(row);
    if (!shown) { h.innerHTML = '<div class="none"></div>'; h.firstChild.textContent = q ? t('history.noMatches') : t('history.empty'); }
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
      .map(({ fmt, self, translation, ...rest }) => rest);
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
      history.forEach((it) => { it.fmt = classify(it); });
      render(); renderHistory();
    }
  }
  CM.on('settings', applySettings);

  // Pin / unpin / delete go through the app so every window applies them.
  function op(kind, it) { native({ cmd: 'historyOp', op: kind, key: keyOf(it) }); }

  // ---- right-click menu ------------------------------------------------------------------------------
  const ctx = $('#ctx');
  function closeMenu() { ctx.classList.remove('show'); }
  function openMenu(x, y, entries) {
    ctx.innerHTML = '';
    for (const e of entries) {
      if (e === '-') { ctx.appendChild(document.createElement('hr')); continue; }
      if (!e) continue;
      const d = document.createElement('div');
      d.className = 'mi' + (e.danger ? ' danger' : '');
      d.textContent = e.label;
      if (e.key) { const k = document.createElement('kbd'); k.textContent = e.key; d.appendChild(k); }
      d.onclick = () => { closeMenu(); e.run(); };
      ctx.appendChild(d);
    }
    ctx.classList.add('show');
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    ctx.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  }
  function copyText(text, rtl) { native({ cmd: 'copy', text: rtl ? wrapRtl(text) : text }); toast(rtl ? t('toast.copiedRtl') : t('toast.copied')); }
  function itemEntries(it, i, inContent) {
    const sel = inContent ? String(window.getSelection() || '') : '';
    return [
      sel && { label: t('menu.copySelection'), run: () => copyText(sel) },
      sel && HEB.test(sel) && { label: t('menu.copySelectionRtl'), run: () => copyText(sel, true) },
      sel && '-',
      it.text && { label: t('menu.copy'), run: () => copyText(inContent ? shownText(it) : it.text) },
      it.text && HEB.test(inContent ? shownText(it) : it.text) && { label: t('menu.copyRtl'), key: inContent ? '⇧⌘C' : '', run: () => copyText(inContent ? shownText(it) : it.text, true) },
      it.text && '-',
      { label: it.pinned ? t('menu.unpin') : t('menu.pin'), run: () => op(it.pinned ? 'unpin' : 'pin', it) },
      { label: t('menu.openInWindow'), run: () => native({ cmd: 'openItem', id: keyOf(it) }) },
      inContent ? { label: held ? t('menu.follow') : t('menu.hold'), key: '⌘L', run: () => window.monitor.toggleHold() }
                : { label: t('menu.show'), run: () => { shownIndex = i; render(); renderHistory(); } },
      inContent && it.text && { label: raw ? t('menu.showRendered') : t('menu.showRaw'), key: '⌘R', run: () => window.monitor.toggleRaw() },
      inContent && translatable(it) && !hasTr(it) && { label: toEnglish(it.text) ? t('tr.toEnglish') : t('tr.toHebrew'), run: () => requestTranslation(it) },
      inContent && hasTr(it) && { label: view === 'translation' ? t('tr.showOriginal') : t('tr.showTranslation'), run: () => { view = view === 'translation' ? 'original' : 'translation'; render(); } },
      !inContent && it.text && i !== shownIndex && history[shownIndex] && history[shownIndex].text && { label: t('menu.compareWithShown'), run: () => { compareWith = it; picking = false; render(); renderHistory(); } },
      inContent && compareWith && { label: t('menu.closeCompare'), run: () => { compareWith = null; render(); renderHistory(); } },
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
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) closeMenu(); });
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
      const it = history.find((h) => h.translation && h.translation.req === r.req);
      if (!it) return;
      it.translation = r.error ? { error: r.error, from: r.from, to: r.to } : { text: r.text, from: r.from, to: r.to };
      if (it === history[shownIndex] && !r.error) view = 'translation';
      if (it === history[shownIndex]) render();
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
    if (e.key === 'Escape') { e.target.value = ''; query = ''; renderHistory(); e.target.blur(); }
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(a.href)) native({ cmd: 'open', url: a.href });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctx.classList.contains('show')) { closeMenu(); return; }
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
