// Settings › AI tab: providers (add / edit / enable / delete), API keys (write-only, kept in the Keychain by the app),
// health checks for providers and models, and the per-provider model list (search, show / hide, "New", refresh).
// Data comes from CM.ai ({providers, presets}, sent by the app as monitor.aiState) and results of long actions from
// 'aiEvent'. Contract: docs/PLAN-settings-ai-i18n.md, "AI — data model" and "Bridge contract".
//
// The tab is re-rendered from scratch on every aiState / settings update; everything the user is in the middle of
// (open form and its typed values, search text, expanded providers, pending checks, focus) lives in `ui` below, so
// a re-render never loses it.
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.ai.intro': 'API keys are stored in the macOS Keychain. Requests go directly from this Mac to the provider you choose.',
      'settings.ai.disabled': 'AI features are turned off in Features. You can still manage providers here.',
      'settings.ai.openFeatures': 'Open Features',
      'settings.ai.providers': 'Providers',
      'settings.ai.empty': 'No providers yet. Add one to use AI translation and other AI features.',
      'settings.ai.add': 'Add provider',
      'settings.ai.form.addTitle': 'New provider',
      'settings.ai.form.editTitle': 'Edit {name}',
      'settings.ai.form.preset': 'Type',
      'settings.ai.form.custom': 'OpenAI-compatible (custom)',
      'settings.ai.form.name': 'Name',
      'settings.ai.form.baseURL': 'Base URL',
      'settings.ai.form.apiKey': 'API key',
      'settings.ai.form.keyPlaceholder': 'Paste the API key',
      'settings.ai.form.keyKeep': 'Leave empty to keep the saved key',
      'settings.ai.form.keyOptional': 'Optional for local servers',
      'settings.ai.form.keyHint': 'Saved only in the macOS Keychain and never shown again.',
      'settings.ai.form.removeKey': 'Remove key',
      'settings.ai.form.keepKey': 'Keep key',
      'settings.ai.form.keyWillRemove': 'The saved key will be removed from the Keychain when you save.',
      'settings.ai.form.autoRefresh': 'Refresh models automatically',
      'settings.ai.form.autoRefreshHint': 'New models are added hidden and marked “New”.',
      'settings.ai.form.save': 'Save',
      'settings.ai.form.cancel': 'Cancel',
      'settings.ai.form.errName': 'Enter a name.',
      'settings.ai.form.errURL': 'Enter a URL that starts with http:// or https://.',
      'settings.ai.saved': 'Saved',
      'settings.ai.deleted': 'Provider deleted',
      'settings.ai.enabled': 'Enabled',
      'settings.ai.key.saved': 'Key saved in Keychain {hint}',
      'settings.ai.key.none': 'No key',
      'settings.ai.key.notNeeded': 'No key needed',
      'settings.ai.models.count': '{visible} / {total} models visible',
      'settings.ai.models.newCount': '{n} new',
      'settings.ai.check.never': 'Not checked yet',
      'settings.ai.check.ok': 'OK · {ms} · {when}',
      'settings.ai.check.failed': 'Failed · {when}',
      'settings.ai.check.pending': 'Checking…',
      'settings.ai.check.toastOk': '{name}: OK ({ms})',
      'settings.ai.check.toastFail': '{name}: {error}',
      'settings.ai.test': 'Test',
      'settings.ai.testTitle': 'Health check: connect and authenticate',
      'settings.ai.models': 'Models',
      'settings.ai.edit': 'Edit',
      'settings.ai.delete': 'Delete',
      'settings.ai.delete.prompt': 'Delete {name} and remove its key from the Keychain?',
      'settings.ai.delete.confirm': 'Yes, delete',
      'settings.ai.models.search': 'Search models',
      'settings.ai.models.showNew': 'Show all new ({n})',
      'settings.ai.models.showAll': 'Show all',
      'settings.ai.models.hideAll': 'Hide all',
      'settings.ai.models.testVisible': 'Test all visible',
      'settings.ai.models.refresh': 'Refresh models',
      'settings.ai.models.refreshing': 'Refreshing…',
      'settings.ai.models.lastRefresh': 'List updated {when}',
      'settings.ai.models.neverRefreshed': 'List never refreshed',
      'settings.ai.models.hidden': 'Hidden ({n})',
      'settings.ai.models.noneVisible': 'No visible models. Show some from the hidden list.',
      'settings.ai.models.none': 'No models yet. Use “Refresh models” to load them.',
      'settings.ai.models.noMatch': 'No models match “{q}”.',
      'settings.ai.models.more': '{n} more — refine the search',
      'settings.ai.model.new': 'New',
      'settings.ai.model.missing': 'Missing',
      'settings.ai.model.missingTitle': 'The provider no longer lists this model',
      'settings.ai.model.show': 'Show in model lists',
      'settings.ai.refresh.added': 'Added {n} new models (hidden)',
      'settings.ai.refresh.addedOne': 'Added 1 new model (hidden)',
      'settings.ai.refresh.none': 'No new models',
      'settings.ai.refresh.failed': 'Refresh failed: {error}',
      'settings.ai.testAll.done': '{ok} of {total} models OK',
      'settings.ai.kind.custom': 'OpenAI-compatible',
    },
    he: {
      'settings.ai.intro': 'מפתחות API נשמרים ב-Keychain של macOS. הבקשות נשלחות ישירות מה-Mac הזה לספק שבחרת.',
      'settings.ai.disabled': 'תכונות ה-AI כבויות בטאב פיצ׳רים. עדיין אפשר לנהל כאן ספקים.',
      'settings.ai.openFeatures': 'לטאב פיצ׳רים',
      'settings.ai.providers': 'ספקים',
      'settings.ai.empty': 'עדיין אין ספקים. הוסיפו ספק כדי להשתמש בתרגום ובתכונות AI אחרות.',
      'settings.ai.add': 'הוספת ספק',
      'settings.ai.form.addTitle': 'ספק חדש',
      'settings.ai.form.editTitle': 'עריכת {name}',
      'settings.ai.form.preset': 'סוג',
      'settings.ai.form.custom': 'תואם OpenAI (מותאם אישית)',
      'settings.ai.form.name': 'שם',
      'settings.ai.form.baseURL': 'כתובת בסיס (Base URL)',
      'settings.ai.form.apiKey': 'מפתח API',
      'settings.ai.form.keyPlaceholder': 'הדביקו את מפתח ה-API',
      'settings.ai.form.keyKeep': 'השאירו ריק כדי לשמור את המפתח הקיים',
      'settings.ai.form.keyOptional': 'לא חובה בשרת מקומי',
      'settings.ai.form.keyHint': 'נשמר רק ב-Keychain של macOS ולא יוצג שוב.',
      'settings.ai.form.removeKey': 'הסר מפתח',
      'settings.ai.form.keepKey': 'השאר מפתח',
      'settings.ai.form.keyWillRemove': 'המפתח השמור יימחק מה-Keychain בעת השמירה.',
      'settings.ai.form.autoRefresh': 'רענון אוטומטי של רשימת המודלים',
      'settings.ai.form.autoRefreshHint': 'מודלים חדשים נוספים מוסתרים, עם התג „חדש”.',
      'settings.ai.form.save': 'שמור',
      'settings.ai.form.cancel': 'ביטול',
      'settings.ai.form.errName': 'יש להזין שם.',
      'settings.ai.form.errURL': 'יש להזין כתובת שמתחילה ב-http:// או https://.',
      'settings.ai.saved': 'נשמר',
      'settings.ai.deleted': 'הספק נמחק',
      'settings.ai.enabled': 'פעיל',
      'settings.ai.key.saved': 'מפתח שמור ב-Keychain {hint}',
      'settings.ai.key.none': 'אין מפתח',
      'settings.ai.key.notNeeded': 'לא נדרש מפתח',
      'settings.ai.models.count': '{visible} מתוך {total} מודלים גלויים',
      'settings.ai.models.newCount': 'חדשים: {n}',
      'settings.ai.check.never': 'טרם נבדק',
      'settings.ai.check.ok': 'תקין · {ms} · {when}',
      'settings.ai.check.failed': 'נכשל · {when}',
      'settings.ai.check.pending': 'בודק…',
      'settings.ai.check.toastOk': '{name}: תקין ({ms})',
      'settings.ai.check.toastFail': '{name}: {error}',
      'settings.ai.test': 'בדיקה',
      'settings.ai.testTitle': 'בדיקת תקינות: חיבור ואימות',
      'settings.ai.models': 'מודלים',
      'settings.ai.edit': 'עריכה',
      'settings.ai.delete': 'מחק',
      'settings.ai.delete.prompt': 'למחוק את {name} ולהסיר את המפתח שלו מה-Keychain?',
      'settings.ai.delete.confirm': 'כן, מחק',
      'settings.ai.models.search': 'חיפוש מודלים',
      'settings.ai.models.showNew': 'הצג את כל החדשים ({n})',
      'settings.ai.models.showAll': 'הצג הכול',
      'settings.ai.models.hideAll': 'הסתר הכול',
      'settings.ai.models.testVisible': 'בדוק את כל הגלויים',
      'settings.ai.models.refresh': 'רענון מודלים',
      'settings.ai.models.refreshing': 'מרענן…',
      'settings.ai.models.lastRefresh': 'הרשימה עודכנה {when}',
      'settings.ai.models.neverRefreshed': 'הרשימה טרם רועננה',
      'settings.ai.models.hidden': 'מוסתרים ({n})',
      'settings.ai.models.noneVisible': 'אין מודלים גלויים. אפשר להציג מודלים מהרשימה המוסתרת.',
      'settings.ai.models.none': 'אין עדיין מודלים. לחצו „רענון מודלים” כדי לטעון אותם.',
      'settings.ai.models.noMatch': 'אין מודלים שתואמים ל„{q}”.',
      'settings.ai.models.more': 'עוד {n} — צמצמו את החיפוש',
      'settings.ai.model.new': 'חדש',
      'settings.ai.model.missing': 'חסר',
      'settings.ai.model.missingTitle': 'הספק כבר לא מציג את המודל הזה',
      'settings.ai.model.show': 'הצג ברשימות המודלים',
      'settings.ai.refresh.added': 'נוספו {n} מודלים חדשים (מוסתרים)',
      'settings.ai.refresh.addedOne': 'נוסף מודל חדש אחד (מוסתר)',
      'settings.ai.refresh.none': 'אין מודלים חדשים',
      'settings.ai.refresh.failed': 'הרענון נכשל: {error}',
      'settings.ai.testAll.done': '{ok} מתוך {total} מודלים תקינים',
      'settings.ai.kind.custom': 'תואם OpenAI',
    },
  });

  const HIDDEN_LIMIT = 200;        // rows rendered in one hidden list before "N more — refine the search"
  const PENDING_TIMEOUT = 90e3;    // give up on a check / refresh whose aiEvent never arrives

  // ---- UI state that survives re-renders ---------------------------------------------------------------
  const ui = {
    form: null,              // {id?, preset, name, baseURL, apiKey, removeKey, autoRefresh, hasKey, error}
    expanded: new Set(),     // provider ids with the model list open
    showHidden: new Set(),   // provider ids with the "Hidden (N)" list open
    search: {},              // provider id → search text
    confirmDelete: null,     // provider id waiting for the second click
    pending: new Map(),      // 'p:id' | 'm:id\nmodelId' | 'r:id' → timeout handle
    batches: {},             // provider id → {left: Set(modelId), ok, total} for "Test all visible"
    knownIds: null,          // provider ids seen in the last aiState, to open a newly added provider
  };
  let root = null;

  // ---- helpers -----------------------------------------------------------------------------------------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const providers = () => (CM.ai && CM.ai.providers) || [];
  const presets = () => {
    const list = ((CM.ai && CM.ai.presets) || []).slice();
    if (!list.some((p) => p.kind === 'custom')) list.push({ kind: 'custom', name: 'OpenAI-compatible', baseURL: '', needsKey: false });
    return list;
  };
  const presetFor = (kind) => presets().find((p) => p.kind === kind);
  const findProvider = (id) => providers().find((p) => p.id === id);
  const kindLabel = (kind) => (kind === 'custom' ? t('settings.ai.kind.custom') : (presetFor(kind) || {}).name || kind);
  const mKey = (id, modelId) => 'm:' + id + '\n' + modelId;
  const isPending = (k) => ui.pending.has(k);
  // Isolated LTR run so "312 ms" / "…a1b2" keep their order inside Hebrew sentences.
  const ltr = (s) => '\u2066' + s + '\u2069';
  const fmtMs = (ms) => ltr((ms != null ? ms : '–') + ' ms');

  function setPending(k) {
    clearTimeout(ui.pending.get(k));
    ui.pending.set(k, setTimeout(() => { ui.pending.delete(k); render(); }, PENDING_TIMEOUT));
  }
  function clearPending(k) { clearTimeout(ui.pending.get(k)); ui.pending.delete(k); }

  /** "5 minutes ago" in the UI language. Accepts epoch ms or seconds. */
  function ago(time) {
    if (!time) return '';
    let ms = Number(time); if (ms < 1e12) ms *= 1000;
    const sec = Math.round((ms - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(I18N.locale, { numeric: 'auto' });
    const a = Math.abs(sec);
    if (a < 45) return rtf.format(0, 'second');
    if (a < 3600) return rtf.format(Math.round(sec / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day');
    return new Date(ms).toLocaleDateString(I18N.locale);
  }

  /** Status dot + text for a lastCheck object ({ok, ms, error, time}) or a pending state. */
  function statusHTML(check, pending, withText) {
    if (pending) return `<span class="ai-dot pending" aria-hidden="true"></span>${withText ? `<span class="ai-st">${esc(t('settings.ai.check.pending'))}</span>` : ''}`;
    if (!check) return `<span class="ai-dot" title="${esc(t('settings.ai.check.never'))}"></span>${withText ? `<span class="ai-st">${esc(t('settings.ai.check.never'))}</span>` : ''}`;
    const when = ago(check.time);
    if (check.ok) {
      const txt = t('settings.ai.check.ok', { ms: fmtMs(check.ms), when });
      return `<span class="ai-dot ok" title="${esc(txt)}"></span>${withText ? `<span class="ai-st">${esc(txt)}</span>` : ''}`;
    }
    const txt = t('settings.ai.check.failed', { when });
    return `<span class="ai-dot bad" title="${esc(txt + (check.error ? ' — ' + check.error : ''))}"></span>` +
      (withText ? `<span class="ai-st bad">${esc(txt)}</span>` : '');
  }

  // ---- rendering ---------------------------------------------------------------------------------------
  function render() {
    if (!root || !root.isConnected) return;
    // Keep focus, caret and scroll across the rebuild.
    const scroller = document.getElementById('settings');
    const top = scroller ? scroller.scrollTop : 0;
    const act = document.activeElement;
    const fk = act && root.contains(act) ? act.dataset.fk : null;
    let sel = null;
    if (fk && act.setSelectionRange && act.type !== 'checkbox') { try { sel = [act.selectionStart, act.selectionEnd]; } catch (e) { /* not text */ } }

    const list = providers();
    let h = `<p class="note ai-intro">${esc(t('settings.ai.intro'))}</p>`;
    if (CM.S['f.ai'] === false) {
      h += `<div class="ai-notice"><span>${esc(t('settings.ai.disabled'))}</span><button data-act="open-features">${esc(t('settings.ai.openFeatures'))}</button></div>`;
    }
    h += `<h3>${esc(t('settings.ai.providers'))}</h3>`;
    if (!list.length && !ui.form) h += `<p class="note ai-empty">${esc(t('settings.ai.empty'))}</p>`;
    for (const p of list) h += providerHTML(p);
    if (ui.form && !ui.form.id) h += formHTML();
    else if (!ui.form) h += `<div class="ai-addrow"><button class="ai-btn primary" data-act="add">＋ ${esc(t('settings.ai.add'))}</button></div>`;
    root.dir = I18N.dir;   // the tab follows the UI language even if the panel around it does not
    root.innerHTML = h;

    if (fk) {
      const el = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
    }
    if (scroller) scroller.scrollTop = top;
  }

  function providerHTML(p) {
    if (ui.form && ui.form.id === p.id) return formHTML(p);
    const id = esc(p.id);
    const models = p.models || [];
    const visible = models.filter((m) => !m.hidden).length;
    const fresh = models.filter((m) => m.isNew).length;
    const pre = presetFor(p.kind);
    const keyTxt = p.hasKey ? t('settings.ai.key.saved', { hint: p.keyHint ? ltr(p.keyHint) : '' }).trim()
      : (pre && pre.needsKey === false ? t('settings.ai.key.notNeeded') : t('settings.ai.key.none'));
    const pending = isPending('p:' + p.id);
    const open = ui.expanded.has(p.id);
    const lc = p.lastCheck;

    let h = `<div class="ai-prov${p.enabled ? '' : ' off'}" data-id="${id}">`;
    h += `<div class="ai-ph">${statusHTML(lc, pending, false)}<span class="ai-name">${esc(p.name || kindLabel(p.kind))}</span>` +
      `<span class="ai-kind">${esc(kindLabel(p.kind))}</span>` +
      `<input type="checkbox" class="switch" data-act="toggle" data-fk="en:${id}" title="${esc(t('settings.ai.enabled'))}" aria-label="${esc(t('settings.ai.enabled'))}"${p.enabled ? ' checked' : ''}></div>`;
    h += `<div class="ai-url"><bdi dir="ltr">${esc(p.baseURL)}</bdi></div>`;
    h += `<div class="ai-meta"><span class="${p.hasKey ? 'ai-key' : ''}">${esc(keyTxt)}</span><span>${esc(t('settings.ai.models.count', { visible, total: models.length }))}` +
      `${fresh ? ` <span class="ai-badge new">${esc(t('settings.ai.models.newCount', { n: fresh }))}</span>` : ''}</span></div>`;
    h += `<div class="ai-check">${statusHTML(lc, pending, true)}</div>`;
    if (!pending && lc && !lc.ok && lc.error) h += `<div class="ai-err"><bdi>${esc(lc.error)}</bdi></div>`;

    if (ui.confirmDelete === p.id) {
      h += `<div class="ai-confirm"><span>${esc(t('settings.ai.delete.prompt', { name: p.name || kindLabel(p.kind) }))}</span>` +
        `<button class="ai-btn danger" data-act="delete-yes">${esc(t('settings.ai.delete.confirm'))}</button>` +
        `<button class="ai-btn" data-act="delete-no">${esc(t('settings.ai.form.cancel'))}</button></div>`;
    } else {
      h += `<div class="ai-acts">` +
        `<button class="ai-btn" data-act="test" title="${esc(t('settings.ai.testTitle'))}"${pending ? ' disabled' : ''}>${esc(t('settings.ai.test'))}</button>` +
        `<button class="ai-btn${open ? ' on' : ''}" data-act="expand" aria-expanded="${open}">${esc(t('settings.ai.models'))} <span class="ai-chev">${open ? '▴' : '▾'}</span></button>` +
        `<button class="ai-btn" data-act="edit">${esc(t('settings.ai.edit'))}</button>` +
        `<button class="ai-btn danger" data-act="delete">${esc(t('settings.ai.delete'))}</button></div>`;
    }
    if (open) h += `<div class="ai-models" data-models="${id}">${modelsHTML(p)}</div>`;
    return h + `</div>`;
  }

  function modelsHTML(p) {
    const id = esc(p.id);
    const models = p.models || [];
    const q = (ui.search[p.id] || '').trim().toLowerCase();
    const match = (m) => !q || m.id.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q);
    const vis = models.filter((m) => !m.hidden && match(m));
    const hid = models.filter((m) => m.hidden && match(m));
    const hiddenTotal = models.filter((m) => m.hidden).length;
    const fresh = models.filter((m) => m.isNew).length;
    const refreshing = isPending('r:' + p.id);
    const batch = ui.batches[p.id];

    let h = `<div class="ai-mtools"><input type="search" class="ai-search" dir="auto" data-act="search" data-fk="q:${id}" placeholder="${esc(t('settings.ai.models.search'))}" value="${esc(ui.search[p.id] || '')}" spellcheck="false" autocomplete="off">` +
      `<button class="ai-btn" data-act="refresh"${refreshing ? ' disabled' : ''}>${refreshing ? '<span class="ai-dot pending"></span>' + esc(t('settings.ai.models.refreshing')) : esc(t('settings.ai.models.refresh'))}</button></div>`;
    h += `<div class="ai-mbtns">`;
    if (fresh) h += `<button class="ai-btn" data-act="show-new">${esc(t('settings.ai.models.showNew', { n: fresh }))}</button>`;
    if (models.length) {
      h += `<button class="ai-btn" data-act="show-all"${hiddenTotal ? '' : ' disabled'}>${esc(t('settings.ai.models.showAll'))}</button>` +
        `<button class="ai-btn" data-act="hide-all"${hiddenTotal < models.length ? '' : ' disabled'}>${esc(t('settings.ai.models.hideAll'))}</button>` +
        `<button class="ai-btn" data-act="test-all"${batch || hiddenTotal === models.length ? ' disabled' : ''}>${batch ? '<span class="ai-dot pending"></span>' : ''}${esc(t('settings.ai.models.testVisible'))}</button>`;
    }
    h += `</div><div class="ai-mnote note">${esc(p.lastRefresh ? t('settings.ai.models.lastRefresh', { when: ago(p.lastRefresh) }) : t('settings.ai.models.neverRefreshed'))}</div>`;

    if (!models.length) return h + `<p class="note ai-mempty">${esc(t('settings.ai.models.none'))}</p>`;
    if (q && !vis.length && !hid.length) return h + `<p class="note ai-mempty">${esc(t('settings.ai.models.noMatch', { q: ui.search[p.id].trim() }))}</p>`;

    h += `<ul class="ai-mlist">`;
    for (const m of vis) h += modelHTML(p, m);
    h += `</ul>`;
    if (!vis.length && !q) h += `<p class="note ai-mempty">${esc(t('settings.ai.models.noneVisible'))}</p>`;

    if (hid.length) {
      // While searching, matching hidden models are shown without opening the section.
      const openHidden = ui.showHidden.has(p.id) || !!q;
      h += `<button class="ai-hidtoggle" data-act="toggle-hidden" aria-expanded="${openHidden}"><span class="ai-chev">${openHidden ? '▾' : '▸'}</span> ${esc(t('settings.ai.models.hidden', { n: q ? hid.length : hiddenTotal }))}</button>`;
      if (openHidden) {
        h += `<ul class="ai-mlist hidden">`;
        for (const m of hid.slice(0, HIDDEN_LIMIT)) h += modelHTML(p, m);
        h += `</ul>`;
        if (hid.length > HIDDEN_LIMIT) h += `<p class="note ai-mempty">${esc(t('settings.ai.models.more', { n: hid.length - HIDDEN_LIMIT }))}</p>`;
      }
    }
    return h;
  }

  function modelHTML(p, m) {
    const pending = isPending(mKey(p.id, m.id));
    const lc = m.lastCheck;
    const mid = esc(m.id);
    let h = `<li class="ai-model${m.missing ? ' missing' : ''}" data-model="${mid}">` +
      `<input type="checkbox" class="switch sm" data-act="model-vis" data-fk="mv:${esc(p.id)}\n${mid}" title="${esc(t('settings.ai.model.show'))}" aria-label="${esc(t('settings.ai.model.show'))}"${m.hidden ? '' : ' checked'}>` +
      `<span class="ai-mid" dir="ltr" title="${mid}">${esc(m.label || m.id)}</span>`;
    if (m.isNew) h += `<span class="ai-badge new">${esc(t('settings.ai.model.new'))}</span>`;
    if (m.missing) h += `<span class="ai-badge miss" title="${esc(t('settings.ai.model.missingTitle'))}">${esc(t('settings.ai.model.missing'))}</span>`;
    h += `<span class="ai-mst">${statusHTML(lc, pending, false)}${!pending && lc && lc.ok && lc.ms != null ? `<span class="ai-ms">${esc(fmtMs(lc.ms))}</span>` : ''}</span>` +
      `<button class="ai-btn sm" data-act="test-model"${pending ? ' disabled' : ''}>${esc(t('settings.ai.test'))}</button>`;
    if (!pending && lc && !lc.ok && lc.error) h += `<div class="ai-err"><bdi>${esc(lc.error)}</bdi></div>`;
    return h + `</li>`;
  }

  function formHTML(p) {
    const f = ui.form;
    const editing = !!f.id;
    const pre = presetFor(f.preset);
    const needsKey = !pre || pre.needsKey !== false;
    let h = `<form class="ai-form" data-form="1" autocomplete="off" novalidate><div class="ai-ftitle">${esc(editing ? t('settings.ai.form.editTitle', { name: p.name || kindLabel(p.kind) }) : t('settings.ai.form.addTitle'))}</div>`;
    if (!editing) {
      h += `<label class="ai-field"><span>${esc(t('settings.ai.form.preset'))}</span><select data-f="preset" data-fk="f:preset">` +
        presets().map((x) => `<option value="${esc(x.kind)}"${x.kind === f.preset ? ' selected' : ''}>${esc(x.kind === 'custom' ? t('settings.ai.form.custom') : x.name)}</option>`).join('') +
        `</select></label>`;
    }
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.name'))}</span><input type="text" dir="auto" data-f="name" data-fk="f:name" value="${esc(f.name)}" spellcheck="false"></label>`;
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.baseURL'))}</span><input type="text" dir="ltr" data-f="baseURL" data-fk="f:url" value="${esc(f.baseURL)}" placeholder="https://…/v1" spellcheck="false" autocapitalize="off"></label>`;

    const keyPh = f.removeKey ? '' : editing && f.hasKey ? t('settings.ai.form.keyKeep') : needsKey ? t('settings.ai.form.keyPlaceholder') : t('settings.ai.form.keyOptional');
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.apiKey'))}</span><span class="ai-keyrow">` +
      `<input type="password" dir="ltr" data-f="apiKey" data-fk="f:key" value="${esc(f.apiKey)}" placeholder="${esc(keyPh)}" autocomplete="new-password" spellcheck="false"${f.removeKey ? ' disabled' : ''}>` +
      (editing && f.hasKey ? `<button type="button" class="ai-btn${f.removeKey ? '' : ' danger'}" data-act="remove-key">${esc(f.removeKey ? t('settings.ai.form.keepKey') : t('settings.ai.form.removeKey'))}</button>` : '') +
      `</span><small>${esc(f.removeKey ? t('settings.ai.form.keyWillRemove') : t('settings.ai.form.keyHint'))}</small></label>`;
    h += `<div class="ai-field row-switch"><span>${esc(t('settings.ai.form.autoRefresh'))}<small>${esc(t('settings.ai.form.autoRefreshHint'))}</small></span>` +
      `<input type="checkbox" class="switch" data-f="autoRefresh" data-fk="f:auto"${f.autoRefresh ? ' checked' : ''}></div>`;
    if (f.error) h += `<div class="ai-err" role="alert">${esc(f.error)}</div>`;
    h += `<div class="ai-acts end"><button type="button" class="ai-btn" data-act="cancel">${esc(t('settings.ai.form.cancel'))}</button>` +
      `<button type="submit" class="ai-btn primary">${esc(t('settings.ai.form.save'))}</button></div></form>`;
    return h;
  }

  // ---- actions -----------------------------------------------------------------------------------------
  function openForm(p) {
    ui.confirmDelete = null;
    if (p) {
      ui.form = { id: p.id, preset: p.kind, kind: p.kind, name: p.name || '', baseURL: p.baseURL || '', apiKey: '', removeKey: false,
        autoRefresh: p.autoRefresh !== false, hasKey: !!p.hasKey, enabled: p.enabled !== false, error: '' };
    } else {
      const first = presets()[0] || { kind: 'custom', name: '', baseURL: '' };
      ui.form = { preset: first.kind, kind: first.kind, name: first.kind === 'custom' ? '' : first.name, baseURL: first.baseURL || '',
        apiKey: '', removeKey: false, autoRefresh: true, hasKey: false, enabled: true, error: '' };
    }
    render();
    const el = root.querySelector(p ? '[data-f="name"]' : '[data-f="preset"]');
    if (el) el.focus();
  }

  function choosePreset(kind) {
    const f = ui.form, old = presetFor(f.kind), next = presetFor(kind) || {};
    // Replace the name / URL only when the user has not changed the previous preset's values.
    if (!f.name || (old && f.name === old.name)) f.name = kind === 'custom' ? '' : next.name || '';
    if (!f.baseURL || (old && f.baseURL === old.baseURL)) f.baseURL = next.baseURL || '';
    f.preset = f.kind = kind; f.error = '';
    render();
  }

  function saveForm() {
    const f = ui.form;
    const name = f.name.trim(), baseURL = f.baseURL.trim().replace(/\/+$/, '');
    if (!name) { f.error = t('settings.ai.form.errName'); render(); return; }
    if (!/^https?:\/\/[^\s/]+/i.test(baseURL)) { f.error = t('settings.ai.form.errURL'); render(); return; }
    const provider = { name, kind: f.kind, baseURL, enabled: f.enabled, autoRefresh: !!f.autoRefresh };
    if (f.id) provider.id = f.id;
    const msg = { cmd: 'ai.save', provider };
    // Contract: omitted / empty apiKey keeps the saved key, null removes it.
    if (f.removeKey) msg.apiKey = null;
    else if (f.apiKey.trim()) msg.apiKey = f.apiKey.trim();
    f.apiKey = '';
    CM.native(msg);
    ui.form = null;
    CM.toast(t('settings.ai.saved'));
    render();
  }

  function checkModels(p, ids) {
    if (!ids.length) return;
    ui.batches[p.id] = { left: new Set(ids), ok: 0, total: ids.length };
    for (const mid of ids) { setPending(mKey(p.id, mid)); CM.native({ cmd: 'ai.checkModel', id: p.id, modelId: mid }); }
  }

  function setModelsHidden(p, hidden, onlyNew) {
    for (const m of p.models || []) if (!onlyNew || m.isNew) { m.hidden = hidden; m.isNew = false; }   // optimistic
    const msg = { cmd: 'ai.setModels', id: p.id, hidden };
    if (onlyNew) msg.onlyNew = true; else msg.all = true;
    CM.native(msg);
    render();
  }

  function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b) || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'toggle' || act === 'model-vis' || act === 'search') return;   // handled by change / input
    const card = b.closest('[data-id]');
    const p = card ? findProvider(card.dataset.id) : null;
    const li = b.closest('[data-model]');
    const m = p && li ? (p.models || []).find((x) => x.id === li.dataset.model) : null;
    switch (act) {
      case 'open-features': { const tab = document.querySelector('#settings .tabs [data-tab="features"]'); if (tab) tab.click(); break; }
      case 'add': openForm(null); break;
      case 'edit': if (p) openForm(p); break;
      case 'cancel': ui.form = null; render(); break;
      case 'remove-key': ui.form.removeKey = !ui.form.removeKey; ui.form.apiKey = ''; render(); break;
      case 'delete': ui.confirmDelete = p && p.id; render(); break;
      case 'delete-no': ui.confirmDelete = null; render(); break;
      case 'delete-yes':
        if (!p) break;
        ui.confirmDelete = null; ui.expanded.delete(p.id);
        CM.native({ cmd: 'ai.delete', id: p.id });
        CM.ai.providers = providers().filter((x) => x.id !== p.id);   // optimistic; aiState confirms
        CM.toast(t('settings.ai.deleted'));
        render(); break;
      case 'test': setPending('p:' + p.id); CM.native({ cmd: 'ai.checkProvider', id: p.id }); render(); break;
      case 'expand': if (ui.expanded.has(p.id)) ui.expanded.delete(p.id); else ui.expanded.add(p.id); render(); break;
      case 'refresh': setPending('r:' + p.id); CM.native({ cmd: 'ai.refreshModels', id: p.id }); render(); break;
      case 'show-new': setModelsHidden(p, false, true); break;
      case 'show-all': setModelsHidden(p, false, false); break;
      case 'hide-all': setModelsHidden(p, true, false); break;
      case 'test-all': checkModels(p, (p.models || []).filter((x) => !x.hidden && !x.missing).map((x) => x.id)); render(); break;
      case 'toggle-hidden': if (ui.showHidden.has(p.id)) ui.showHidden.delete(p.id); else ui.showHidden.add(p.id); render(); break;
      case 'test-model':
        if (!m) break;
        setPending(mKey(p.id, m.id)); CM.native({ cmd: 'ai.checkModel', id: p.id, modelId: m.id }); render(); break;
      default: break;
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.f && ui.form) {
      if (el.dataset.f === 'preset') { choosePreset(el.value); return; }
      if (el.dataset.f === 'autoRefresh') { ui.form.autoRefresh = el.checked; return; }
      return;
    }
    const card = el.closest('[data-id]');
    const p = card ? findProvider(card.dataset.id) : null;
    if (!p) return;
    if (el.dataset.act === 'toggle') {
      p.enabled = el.checked;
      CM.native({ cmd: 'ai.toggle', id: p.id, enabled: el.checked });
      render();
    } else if (el.dataset.act === 'model-vis') {
      const li = el.closest('[data-model]');
      const m = li && (p.models || []).find((x) => x.id === li.dataset.model);
      if (!m) return;
      m.hidden = !el.checked; m.isNew = false;
      CM.native({ cmd: 'ai.setModel', id: p.id, modelId: m.id, hidden: m.hidden });
      render();
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.f && ui.form && el.dataset.f !== 'preset' && el.dataset.f !== 'autoRefresh') {
      ui.form[el.dataset.f] = el.value;
      if (ui.form.error) { ui.form.error = ''; const er = root.querySelector('.ai-form .ai-err'); if (er) er.remove(); }
      return;
    }
    if (el.dataset.act === 'search') {
      const card = el.closest('[data-id]'); if (!card) return;
      ui.search[card.dataset.id] = el.value;
      render();   // keeps focus and caret on the search field
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (ui.form) { ui.form = null; render(); e.stopPropagation(); }
      else if (ui.confirmDelete) { ui.confirmDelete = null; render(); e.stopPropagation(); }
    }
  }

  // ---- events from the app -----------------------------------------------------------------------------
  CM.on('aiState', (st) => {
    const ids = ((st && st.providers) || []).map((p) => p.id);
    if (ui.knownIds) for (const id of ids) if (!ui.knownIds.has(id)) ui.expanded.add(id);   // open a newly added provider
    ui.knownIds = new Set(ids);
    for (const id of Array.from(ui.expanded)) if (!ids.includes(id)) ui.expanded.delete(id);
    if (ui.form && ui.form.id && !ids.includes(ui.form.id)) ui.form = null;
    // Pick up key state that changed while editing (e.g. saved from another window).
    if (ui.form && ui.form.id) { const p = findProvider(ui.form.id); if (p) ui.form.hasKey = !!p.hasKey; }
    render();   // settings.js re-renders before this listener runs; render again with the bookkeeping applied
  });

  CM.on('aiEvent', (ev) => {
    if (!ev || !ev.id) return;
    const p = findProvider(ev.id);
    const name = p ? p.name || kindLabel(p.kind) : ev.id;
    if (ev.kind === 'refresh') {
      clearPending('r:' + ev.id);
      if (ev.error) CM.toast(t('settings.ai.refresh.failed', { error: ev.error }));
      else {
        const n = Array.isArray(ev.added) ? ev.added.length : Number(ev.added) || 0;
        CM.toast(n === 1 ? t('settings.ai.refresh.addedOne') : n ? t('settings.ai.refresh.added', { n }) : t('settings.ai.refresh.none'));
      }
    } else if (ev.kind === 'check') {
      if (ev.modelId) {
        clearPending(mKey(ev.id, ev.modelId));
        const b = ui.batches[ev.id];
        if (b && b.left.delete(ev.modelId)) {
          if (ev.ok) b.ok++;
          if (!b.left.size) { delete ui.batches[ev.id]; CM.toast(t('settings.ai.testAll.done', { ok: b.ok, total: b.total })); }
        }
      } else {
        clearPending('p:' + ev.id);
        CM.toast(ev.ok ? t('settings.ai.check.toastOk', { name, ms: fmtMs(ev.ms) })
          : t('settings.ai.check.toastFail', { name, error: ev.error || t('settings.ai.check.failed', { when: '' }) }));
      }
    }
    render();
  });

  CM.registerTab('ai', {
    mount(el) {
      root = document.createElement('div');
      root.className = 'ai-tab';
      el.appendChild(root);
      root.addEventListener('click', onClick);
      root.addEventListener('change', onChange);
      root.addEventListener('input', onInput);
      root.addEventListener('keydown', onKey);
      root.addEventListener('submit', (e) => { e.preventDefault(); if (ui.form) saveForm(); });
      render();
      CM.native({ cmd: 'ai.list' });
    },
    update() { render(); },
  });
})();
