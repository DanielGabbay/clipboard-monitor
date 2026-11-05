// Settings › AI tab: providers (add / edit / enable / delete), API keys (write-only, kept in the Keychain by the app),
// health checks for providers and models, and the per-provider model list (search, show / hide, "New", refresh).
// Data comes from CM.ai ({providers, presets}, sent by the app as monitor.aiState) and results of long actions from
// 'aiEvent'. Contract: docs/PLAN-settings-ai-i18n.md, "AI — data model" and "Bridge contract".
//
// The tab is re-rendered from scratch on every aiState / settings update; everything the user is in the middle of
// (open form and its typed values, search text, expanded providers, open menu, pending checks, focus) lives in `ui`
// below, so a re-render never loses it.
(function () {
  'use strict';

  I18N.register({
    en: {
      'settings.ai.intro': 'API keys are stored in the macOS Keychain. Requests go directly from this Mac to the provider you choose.',
      'settings.ai.disabled': 'AI features are off.',
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
      'settings.ai.off': 'Off',
      'settings.ai.more': 'More actions for {name}',
      'settings.ai.key.saved': 'Key {hint}',
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
      'settings.ai.err.key': 'The API key was rejected.',
      'settings.ai.err.editKey': 'Edit key',
      'settings.ai.err.local': 'Could not reach the server. Is the local server running?',
      'settings.ai.err.allModels': 'Every tested model failed with the same error.',
      'settings.ai.test': 'Test',
      'settings.ai.testTitle': 'Health check: connect and authenticate',
      'settings.ai.models': 'Models',
      'settings.ai.edit': 'Edit',
      'settings.ai.delete': 'Delete',
      'settings.ai.delete.prompt': 'Delete {name} and remove its key from the Keychain?',
      'settings.ai.delete.promptNoKey': 'Delete {name}?',
      'settings.ai.delete.confirm': 'Yes, delete',
      'settings.ai.models.search': 'Search models',
      'settings.ai.models.actions': 'Actions',
      'settings.ai.models.showNew': 'Show all new ({n})',
      'settings.ai.models.showAll': 'Show all in pickers',
      'settings.ai.models.hideAll': 'Hide all from pickers',
      'settings.ai.models.testVisible': 'Test all visible',
      'settings.ai.models.refresh': 'Refresh models',
      'settings.ai.models.refreshing': 'Refreshing…',
      'settings.ai.models.lastRefresh': 'List updated {when}',
      'settings.ai.models.neverRefreshed': 'List never refreshed',
      'settings.ai.models.hidden': 'Hidden ({n})',
      'settings.ai.models.noneVisible': 'No visible models. Show some from the hidden list.',
      'settings.ai.models.none': 'No models yet. Click “Refresh models” to load them.',
      'settings.ai.models.noMatch': 'No models match “{q}”.',
      'settings.ai.models.more': '{n} more. Refine the search.',
      'settings.ai.model.new': 'New',
      'settings.ai.model.missing': 'Missing',
      'settings.ai.model.missingTitle': 'The provider no longer lists this model',
      'settings.ai.model.show': 'Show in model pickers',
      'settings.ai.refresh.added': 'Added {n} new models (hidden)',
      'settings.ai.refresh.addedOne': 'Added 1 new model (hidden)',
      'settings.ai.refresh.none': 'No new models',
      'settings.ai.refresh.failed': 'Refresh failed: {error}',
      'settings.ai.refresh.failedShort': 'Refresh failed.',
      'settings.ai.testAll.running': 'Testing {n} models…',
      'settings.ai.testAll.done': '{ok} of {total} models OK',
      'settings.ai.kind.custom': 'OpenAI-compatible',
    },
    he: {
      'settings.ai.intro': 'מפתחות API נשמרים ב־Keychain של macOS. הבקשות נשלחות ישירות מה־Mac הזה לספק שבחרת.',
      'settings.ai.disabled': 'תכונות ה־AI כבויות.',
      'settings.ai.openFeatures': 'פתח את פיצ׳רים',
      'settings.ai.providers': 'ספקים',
      'settings.ai.empty': 'עדיין אין ספקים. אפשר להוסיף ספק כדי להשתמש בתרגום ובתכונות AI אחרות.',
      'settings.ai.add': 'הוסף ספק',
      'settings.ai.form.addTitle': 'ספק חדש',
      'settings.ai.form.editTitle': 'עריכת {name}',
      'settings.ai.form.preset': 'סוג',
      'settings.ai.form.custom': 'תואם OpenAI (מותאם אישית)',
      'settings.ai.form.name': 'שם',
      'settings.ai.form.baseURL': 'כתובת בסיס (Base URL)',
      'settings.ai.form.apiKey': 'מפתח API',
      'settings.ai.form.keyPlaceholder': 'הדבק את מפתח ה־API',
      'settings.ai.form.keyKeep': 'השאר ריק כדי לשמור את המפתח הקיים',
      'settings.ai.form.keyOptional': 'לא חובה בשרת מקומי',
      'settings.ai.form.keyHint': 'נשמר רק ב־Keychain של macOS ולא יוצג שוב.',
      'settings.ai.form.removeKey': 'הסר מפתח',
      'settings.ai.form.keepKey': 'השאר מפתח',
      'settings.ai.form.keyWillRemove': 'המפתח השמור יימחק מה־Keychain בעת השמירה.',
      'settings.ai.form.autoRefresh': 'רענון אוטומטי של רשימת המודלים',
      'settings.ai.form.autoRefreshHint': 'מודלים חדשים נוספים מוסתרים, עם התג „חדש”.',
      'settings.ai.form.save': 'שמור',
      'settings.ai.form.cancel': 'בטל',
      'settings.ai.form.errName': 'יש להזין שם.',
      'settings.ai.form.errURL': 'יש להזין כתובת שמתחילה ב־http:// או ב־https://.',
      'settings.ai.saved': 'נשמר',
      'settings.ai.deleted': 'הספק נמחק',
      'settings.ai.enabled': 'פעיל',
      'settings.ai.off': 'כבוי',
      'settings.ai.more': 'פעולות נוספות עבור {name}',
      'settings.ai.key.saved': 'מפתח {hint}',
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
      'settings.ai.err.key': 'מפתח ה־API נדחה.',
      'settings.ai.err.editKey': 'ערוך מפתח',
      'settings.ai.err.local': 'אין חיבור לשרת. האם השרת המקומי פועל?',
      'settings.ai.err.allModels': 'כל המודלים שנבדקו נכשלו באותה שגיאה.',
      'settings.ai.test': 'בדוק',
      'settings.ai.testTitle': 'בדיקת תקינות: חיבור ואימות',
      'settings.ai.models': 'מודלים',
      'settings.ai.edit': 'ערוך',
      'settings.ai.delete': 'מחק',
      'settings.ai.delete.prompt': 'למחוק את {name} ולהסיר את המפתח שלו מה־Keychain?',
      'settings.ai.delete.promptNoKey': 'למחוק את {name}?',
      'settings.ai.delete.confirm': 'כן, מחק',
      'settings.ai.models.search': 'חיפוש מודלים',
      'settings.ai.models.actions': 'פעולות',
      'settings.ai.models.showNew': 'הצג את כל החדשים ({n})',
      'settings.ai.models.showAll': 'הצג הכול בבוחרי המודלים',
      'settings.ai.models.hideAll': 'הסתר הכול מבוחרי המודלים',
      'settings.ai.models.testVisible': 'בדוק את כל הגלויים',
      'settings.ai.models.refresh': 'רענן מודלים',
      'settings.ai.models.refreshing': 'מרענן…',
      'settings.ai.models.lastRefresh': 'הרשימה עודכנה {when}',
      'settings.ai.models.neverRefreshed': 'הרשימה טרם רועננה',
      'settings.ai.models.hidden': 'מוסתרים ({n})',
      'settings.ai.models.noneVisible': 'אין מודלים גלויים. אפשר להציג מודלים מהרשימה המוסתרת.',
      'settings.ai.models.none': 'אין עדיין מודלים. לחץ „רענן מודלים” כדי לטעון אותם.',
      'settings.ai.models.noMatch': 'אין מודלים שתואמים ל„{q}”.',
      'settings.ai.models.more': 'עוד {n}. צמצם את החיפוש.',
      'settings.ai.model.new': 'חדש',
      'settings.ai.model.missing': 'חסר',
      'settings.ai.model.missingTitle': 'הספק כבר לא מציג את המודל הזה',
      'settings.ai.model.show': 'הצג בבוחרי המודלים',
      'settings.ai.refresh.added': 'נוספו {n} מודלים חדשים (מוסתרים)',
      'settings.ai.refresh.addedOne': 'נוסף מודל חדש אחד (מוסתר)',
      'settings.ai.refresh.none': 'אין מודלים חדשים',
      'settings.ai.refresh.failed': 'הרענון נכשל: {error}',
      'settings.ai.refresh.failedShort': 'הרענון נכשל.',
      'settings.ai.testAll.running': 'בודק {n} מודלים…',
      'settings.ai.testAll.done': '{ok} מתוך {total} מודלים תקינים',
      'settings.ai.kind.custom': 'תואם OpenAI',
    },
  });

  const HIDDEN_LIMIT = 200;        // rows rendered in one hidden list before "N more. Refine the search."
  const PENDING_TIMEOUT = 90e3;    // give up on a check / refresh whose aiEvent never arrives
  const LOCAL_KINDS = ['ollama', 'lmstudio'];

  // ---- UI state that survives re-renders ---------------------------------------------------------------
  const ui = {
    form: null,              // {id?, preset, name, baseURL, apiKey, removeKey, autoRefresh, hasKey, error, errField}
    expanded: new Set(),     // provider ids with the model list open
    showHidden: new Set(),   // provider ids with the "Hidden (N)" list open
    search: {},              // provider id → search text
    confirmDelete: null,     // provider id waiting for the second click
    menu: null,              // open menu: 'card:<id>' | 'models:<id>'
    pending: new Map(),      // 'p:id' | 'm:id\nmodelId' | 'r:id' → timeout handle
    batches: {},             // provider id → {left: Set(modelId), ok, total} for "Test all visible"
    batchDone: {},           // provider id → {ok, total} of the last finished "Test all visible" (inline status)
    refreshErr: {},          // provider id → error text of the last failed model refresh
    knownIds: null,          // provider ids seen in the last aiState, to open a newly added provider
  };
  let root = null;
  let docListener = false;

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
  const provName = (p) => p.name || kindLabel(p.kind);
  const mKey = (id, modelId) => 'm:' + id + '\n' + modelId;
  const isPending = (k) => ui.pending.has(k);
  // Isolated LTR run so "312 ms" / "…a1b2" keep their order inside Hebrew sentences.
  const ltr = (s) => '⁦' + s + '⁩';
  const fmtMs = (ms) => ltr((ms != null ? ms : '–') + ' ms');
  const isKeyError = (err) => /\b(401|403)\b|key/i.test(err || '');
  const isConnError = (p, err) => LOCAL_KINDS.includes(p.kind) && /connect|refused|timed? ?out|offline|unreachable|network/i.test(err || '');

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

  /** Status dot (+ text) for a lastCheck object ({ok, ms, error, time}) or a pending state. */
  function statusHTML(check, pending, withText) {
    const dot = (cls, title) => `<span class="ai-dot${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ' aria-hidden="true"'}></span>`;
    const txt = (s, cls) => (withText ? `<span class="ai-st${cls ? ' ' + cls : ''}">${esc(s)}</span>` : '');
    if (pending) return dot('pending') + txt(t('settings.ai.check.pending'));
    if (!check) return dot('', withText ? '' : t('settings.ai.check.never')) + txt(t('settings.ai.check.never'));
    const when = ago(check.time);
    if (check.ok) { const s = t('settings.ai.check.ok', { ms: fmtMs(check.ms), when }); return dot('ok', withText ? '' : s) + txt(s); }
    const s = t('settings.ai.check.failed', { when });
    return dot('bad', withText ? '' : s + (check.error ? ' — ' + check.error : '')) + txt(s, 'bad');
  }

  /** Error block with a human line and a way out (Edit key / local-server hint) before the raw error. */
  function errorHTML(p, error, lead) {
    let h = `<div class="ai-err">`;
    if (lead) h += `<div class="ai-human">${esc(lead)}</div>`;
    if (isKeyError(error)) {
      h += `<div class="ai-human"><span>${esc(t('settings.ai.err.key'))}</span>` +
        `<button type="button" class="btn sm" data-act="edit-key" data-fk="ek:${esc(p.id)}">${esc(t('settings.ai.err.editKey'))}</button></div>`;
    } else if (isConnError(p, error)) {
      h += `<div class="ai-human">${esc(t('settings.ai.err.local'))}</div>`;
    }
    return h + `<div class="ai-raw"><bdi>${esc(error)}</bdi></div></div>`;
  }

  // ---- menus (button + role=menu popup; state in ui.menu so a re-render keeps it open) -------------------
  function menuHTML(key, trigger, items, cls) {
    const open = ui.menu === key;
    let h = `<span class="ai-mwrap">` +
      `<button type="button" class="btn${cls ? ' ' + cls : ''}${open ? ' on' : ''}" data-act="menu" data-menu-key="${esc(key)}" data-fk="mt:${esc(key)}"` +
      ` aria-haspopup="menu" aria-expanded="${open}"${trigger.aria ? ` aria-label="${esc(trigger.aria)}" title="${esc(trigger.aria)}"` : ''}>${trigger.html}</button>`;
    if (open) {
      h += `<div class="ai-menu" role="menu" data-menu="${esc(key)}">`;
      for (const it of items) {
        h += `<button type="button" role="menuitem" tabindex="-1" class="ai-mi${it.danger ? ' danger' : ''}" data-act="${it.act}" data-fk="mi:${esc(key)}:${it.act}"` +
          `${it.disabled ? ' disabled aria-disabled="true"' : ''}>${esc(it.label)}</button>`;
      }
      h += `</div>`;
    }
    return h + `</span>`;
  }
  const menuItems = (menu) => Array.from(menu.querySelectorAll('[role="menuitem"]:not([disabled])'));
  function openMenu(key, last) {
    ui.menu = key; render();
    const menu = root.querySelector(`.ai-menu[data-menu="${CSS.escape(key)}"]`);
    if (!menu) return;
    if (typeof CM.menuKeys === 'function') { try { CM.menuKeys(menu, { onClose: () => closeMenu(true) }); } catch (e) { console.error(e); } }
    const items = menuItems(menu);
    if (items.length) items[last ? items.length - 1 : 0].focus();
  }
  function closeMenu(refocus) {
    const key = ui.menu; if (!key) return;
    ui.menu = null;
    render(refocus ? 'mt:' + key : null);
  }
  /** Fallback keyboard handling for the open menu (used when core.js has no CM.menuKeys). */
  function menuKey(e) {
    const menu = e.target.closest('.ai-menu');
    if (menu) {
      if (typeof CM.menuKeys === 'function') return true;   // the shared helper owns the keys inside the menu
      const items = menuItems(menu), i = items.indexOf(document.activeElement), n = items.length;
      const go = (j) => { if (n) items[(j + n) % n].focus(); e.preventDefault(); };
      switch (e.key) {
        case 'ArrowDown': go(i + 1); break;
        case 'ArrowUp': go(i < 0 ? n - 1 : i - 1); break;
        case 'Home': go(0); break;
        case 'End': go(n - 1); break;
        case 'Escape': e.preventDefault(); e.stopPropagation(); closeMenu(true); break;
        case 'Tab': closeMenu(true); break;   // focus lands on the trigger; Tab then moves on from there
        default: break;
      }
      return true;
    }
    const trig = e.target.closest('[data-act="menu"]');
    if (trig && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault(); openMenu(trig.dataset.menuKey, e.key === 'ArrowUp'); return true;
    }
    if (trig && e.key === 'Escape' && ui.menu) { e.stopPropagation(); closeMenu(true); return true; }
    return false;
  }

  // ---- rendering ---------------------------------------------------------------------------------------
  /** Rebuild the tab. `focusFk` moves focus to the element with that data-fk; otherwise focus is kept. */
  function render(focusFk) {
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
      h += `<div class="ai-notice"><span>${esc(t('settings.ai.disabled'))}</span><button type="button" class="btn sm" data-act="open-features">${esc(t('settings.ai.openFeatures'))}</button></div>`;
    }
    h += `<h3>${esc(t('settings.ai.providers'))}</h3>`;
    if (!list.length && !ui.form) h += `<p class="note ai-empty">${esc(t('settings.ai.empty'))}</p>`;
    for (const p of list) h += providerHTML(p);
    if (ui.form && !ui.form.id) h += formHTML();
    else if (!ui.form) h += `<div class="ai-addrow"><button type="button" class="btn primary" data-act="add" data-fk="add">＋ ${esc(t('settings.ai.add'))}</button></div>`;
    root.dir = I18N.dir;   // the tab follows the UI language even if the panel around it does not
    root.innerHTML = h;

    const target = focusFk || fk;
    const el = target ? root.querySelector(`[data-fk="${CSS.escape(target)}"]`) : null;
    if (el && !focusFk) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
    if (scroller) scroller.scrollTop = top;
    if (el && focusFk) el.focus();
    // A menu rebuilt while open gets the shared keyboard helper again (its element is new).
    if (ui.menu && typeof CM.menuKeys === 'function') {
      const menu = root.querySelector(`.ai-menu[data-menu="${CSS.escape(ui.menu)}"]`);
      if (menu) { try { CM.menuKeys(menu, { onClose: () => closeMenu(true) }); } catch (e) { console.error(e); } }
    }
  }

  function providerHTML(p) {
    if (ui.form && ui.form.id === p.id) return formHTML(p);
    const id = esc(p.id);
    const name = provName(p);
    const models = p.models || [];
    const visible = models.filter((m) => !m.hidden).length;
    const fresh = models.filter((m) => m.isNew).length;
    const pre = presetFor(p.kind);
    const keyTxt = p.hasKey ? t('settings.ai.key.saved', { hint: p.keyHint ? ltr(p.keyHint) : '' }).trim()
      : (pre && pre.needsKey === false ? t('settings.ai.key.notNeeded') : t('settings.ai.key.none'));
    const pending = isPending('p:' + p.id);
    const open = ui.expanded.has(p.id);
    const lc = p.lastCheck;
    const kind = kindLabel(p.kind);
    const showKind = name.trim().toLowerCase() !== String(kind).trim().toLowerCase();

    let h = `<div class="ai-prov${p.enabled ? '' : ' off'}" data-id="${id}">`;
    h += `<div class="ai-ph"><span class="ai-name">${esc(name)}</span>` +
      (showKind ? `<span class="ai-kind">${esc(kind)}</span>` : '') +
      `<input type="checkbox" class="switch" data-act="toggle" data-fk="en:${id}" title="${esc(t('settings.ai.enabled'))}" aria-label="${esc(t('settings.ai.enabled') + ': ' + name)}"${p.enabled ? ' checked' : ''}></div>`;
    h += `<div class="ai-url"><bdi dir="ltr">${esc(p.baseURL)}</bdi></div>`;
    // One status line: health (or "Off"), key, model count.
    h += `<div class="ai-status">`;
    h += p.enabled ? `<span class="ai-check">${statusHTML(lc, pending, true)}</span>` : `<span class="ai-st off">${esc(t('settings.ai.off'))}</span>`;
    h += `<span class="${p.hasKey ? 'ai-key' : ''}">${esc(keyTxt)}</span>` +
      `<span>${esc(t('settings.ai.models.count', { visible, total: models.length }))}` +
      `${fresh ? ` <span class="ai-badge new">${esc(t('settings.ai.models.newCount', { n: fresh }))}</span>` : ''}</span></div>`;
    const cardErr = p.enabled && !pending && lc && !lc.ok && lc.error ? lc.error : null;
    if (cardErr) h += errorHTML(p, cardErr);

    if (ui.confirmDelete === p.id) {
      h += `<div class="confirm ai-confirm" role="group"><span>${esc(t(p.hasKey ? 'settings.ai.delete.prompt' : 'settings.ai.delete.promptNoKey', { name }))}</span>` +
        `<button type="button" class="btn danger" data-act="delete-yes" data-fk="dy:${id}">${esc(t('settings.ai.delete.confirm'))}</button>` +
        `<button type="button" class="btn" data-act="delete-no" data-fk="dn:${id}">${esc(t('settings.ai.form.cancel'))}</button></div>`;
    } else {
      h += `<div class="ai-acts">` +
        `<button type="button" class="btn${open ? ' on' : ''}" data-act="expand" data-fk="ex:${id}" aria-expanded="${open}">${esc(t('settings.ai.models'))} <span class="ai-chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>` +
        `<span class="ai-grow"></span>` +
        menuHTML('card:' + p.id, { html: '<span aria-hidden="true">…</span>', aria: t('settings.ai.more', { name }) }, [
          { act: 'test', label: t('settings.ai.test'), disabled: pending || !p.enabled },
          { act: 'edit', label: t('settings.ai.edit') },
          { act: 'delete', label: t('settings.ai.delete'), danger: true },
        ], 'ai-more') +
        `</div>`;
    }
    if (open) h += `<div class="ai-models" data-models="${id}">${modelsHTML(p, cardErr)}</div>`;
    return h + `</div>`;
  }

  function modelsHTML(p, cardErr) {
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
    const done = ui.batchDone[p.id];

    // Errors already on screen are not repeated per model: the provider's own error, or one error shared by
    // every tested model (shown once at the top of the list).
    const shown = new Set();
    if (cardErr) shown.add(cardErr);
    const checked = models.filter((m) => m.lastCheck && !isPending(mKey(p.id, m.id)));
    const failed = checked.filter((m) => !m.lastCheck.ok && m.lastCheck.error);
    let sameErr = null;
    if (p.enabled && failed.length >= 2 && failed.length === checked.length && failed.every((m) => m.lastCheck.error === failed[0].lastCheck.error)) {
      sameErr = failed[0].lastCheck.error;
    }

    let h = `<div class="ai-mtools"><input type="search" class="ai-search" dir="auto" data-act="search" data-fk="q:${id}" placeholder="${esc(t('settings.ai.models.search'))}" aria-label="${esc(t('settings.ai.models.search'))}" value="${esc(ui.search[p.id] || '')}" spellcheck="false" autocomplete="off">` +
      `<button type="button" class="btn" data-act="refresh" data-fk="rf:${id}"${refreshing ? ' disabled' : ''}>${refreshing ? '<span class="ai-dot pending" aria-hidden="true"></span>' + esc(t('settings.ai.models.refreshing')) : esc(t('settings.ai.models.refresh'))}</button>`;
    if (models.length) {
      const items = [];
      if (fresh) items.push({ act: 'show-new', label: t('settings.ai.models.showNew', { n: fresh }) });
      items.push(
        { act: 'show-all', label: t('settings.ai.models.showAll'), disabled: !hiddenTotal },
        { act: 'hide-all', label: t('settings.ai.models.hideAll'), disabled: hiddenTotal === models.length },
        { act: 'test-all', label: t('settings.ai.models.testVisible'), disabled: !!batch || hiddenTotal === models.length || !p.enabled });
      h += menuHTML('models:' + p.id, { html: `${esc(t('settings.ai.models.actions'))} <span class="ai-chev" aria-hidden="true">▾</span>` }, items);
    }
    h += `</div>`;

    // Inline status: list age, then the running / last "Test all visible".
    h += `<div class="ai-mnote" role="status" aria-live="polite"><span>${esc(p.lastRefresh ? t('settings.ai.models.lastRefresh', { when: ago(p.lastRefresh) }) : t('settings.ai.models.neverRefreshed'))}</span>`;
    if (batch) h += `<span class="ai-batch"><span class="ai-dot pending" aria-hidden="true"></span>${esc(t('settings.ai.testAll.running', { n: batch.left.size }))}</span>`;
    else if (done) h += `<span class="ai-batch ${done.ok === done.total ? 'ok' : 'bad'}">${esc(t('settings.ai.testAll.done', { ok: done.ok, total: done.total }))}</span>`;
    h += `</div>`;
    if (ui.refreshErr[p.id] && !refreshing) h += errorHTML(p, ui.refreshErr[p.id], t('settings.ai.refresh.failedShort'));
    if (sameErr && !shown.has(sameErr)) { h += errorHTML(p, sameErr, t('settings.ai.err.allModels')); }
    if (sameErr) shown.add(sameErr);

    if (!models.length) return h + `<p class="note ai-mempty">${esc(t('settings.ai.models.none'))}</p>`;
    if (q && !vis.length && !hid.length) return h + `<p class="note ai-mempty">${esc(t('settings.ai.models.noMatch', { q: ui.search[p.id].trim() }))}</p>`;

    h += `<ul class="ai-mlist">`;
    for (const m of vis) h += modelHTML(p, m, shown);
    h += `</ul>`;
    if (!vis.length && !q) h += `<p class="note ai-mempty">${esc(t('settings.ai.models.noneVisible'))}</p>`;

    if (hid.length) {
      // While searching, matching hidden models are shown without opening the section.
      const openHidden = ui.showHidden.has(p.id) || !!q;
      h += `<button type="button" class="ai-hidtoggle" data-act="toggle-hidden" data-fk="th:${id}" aria-expanded="${openHidden}"><span class="ai-chev" aria-hidden="true">${openHidden ? '▾' : '▸'}</span> ${esc(t('settings.ai.models.hidden', { n: q ? hid.length : hiddenTotal }))}</button>`;
      if (openHidden) {
        h += `<ul class="ai-mlist hidden">`;
        for (const m of hid.slice(0, HIDDEN_LIMIT)) h += modelHTML(p, m, shown);
        h += `</ul>`;
        if (hid.length > HIDDEN_LIMIT) h += `<p class="note ai-mempty">${esc(t('settings.ai.models.more', { n: hid.length - HIDDEN_LIMIT }))}</p>`;
      }
    }
    return h;
  }

  function modelHTML(p, m, shown) {
    const pending = isPending(mKey(p.id, m.id));
    const lc = m.lastCheck;
    const mid = esc(m.id);
    const fkBase = esc(p.id) + '\n' + mid;
    let h = `<li class="ai-model${m.missing ? ' missing' : ''}" data-model="${mid}">` +
      `<input type="checkbox" class="switch sm" data-act="model-vis" data-fk="mv:${fkBase}" title="${esc(t('settings.ai.model.show'))}" aria-label="${esc(t('settings.ai.model.show') + ': ' + m.id)}"${m.hidden ? '' : ' checked'}>` +
      `<span class="ai-midw"><span class="ai-mid" dir="${m.label ? 'auto' : 'ltr'}" title="${mid}">${esc(m.label || m.id)}</span></span>`;
    if (m.isNew) h += `<span class="ai-badge new">${esc(t('settings.ai.model.new'))}</span>`;
    if (m.missing) h += `<span class="ai-badge miss" title="${esc(t('settings.ai.model.missingTitle'))}">${esc(t('settings.ai.model.missing'))}</span>`;
    h += `<span class="ai-mst">${statusHTML(lc, pending, false)}${!pending && lc && lc.ok && lc.ms != null ? `<span class="ai-ms">${esc(fmtMs(lc.ms))}</span>` : ''}</span>` +
      `<button type="button" class="btn sm" data-act="test-model" data-fk="tm:${fkBase}"${pending || !p.enabled ? ' disabled' : ''}>${esc(t('settings.ai.test'))}</button>`;
    if (p.enabled && !pending && lc && !lc.ok && lc.error && !shown.has(lc.error)) h += `<div class="ai-err ai-raw"><bdi>${esc(lc.error)}</bdi></div>`;
    return h + `</li>`;
  }

  function formHTML(p) {
    const f = ui.form;
    const editing = !!f.id;
    const pre = presetFor(f.preset);
    const needsKey = !pre || pre.needsKey !== false;
    // Validation error next to its field, with the field marked.
    const inv = (field) => (f.error && f.errField === field ? ' aria-invalid="true" aria-describedby="ai-ferr"' : '');
    const errAt = (field) => (f.error && f.errField === field ? `<small class="ai-ferr" id="ai-ferr" role="alert">${esc(f.error)}</small>` : '');
    let h = `<form class="ai-form" data-form="1" autocomplete="off" novalidate><div class="ai-ftitle">${esc(editing ? t('settings.ai.form.editTitle', { name: provName(p) }) : t('settings.ai.form.addTitle'))}</div>`;
    if (!editing) {
      h += `<label class="ai-field"><span>${esc(t('settings.ai.form.preset'))}</span><select data-f="preset" data-fk="f:preset">` +
        presets().map((x) => `<option value="${esc(x.kind)}"${x.kind === f.preset ? ' selected' : ''}>${esc(x.kind === 'custom' ? t('settings.ai.form.custom') : x.name)}</option>`).join('') +
        `</select></label>`;
    }
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.name'))}</span><input type="text" dir="auto" data-f="name" data-fk="f:name" value="${esc(f.name)}" spellcheck="false"${inv('name')}>${errAt('name')}</label>`;
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.baseURL'))}</span><input type="text" class="ltr" dir="ltr" data-f="baseURL" data-fk="f:url" value="${esc(f.baseURL)}" placeholder="https://…/v1" spellcheck="false" autocapitalize="off"${inv('baseURL')}>${errAt('baseURL')}</label>`;

    const keyPh = f.removeKey ? '' : editing && f.hasKey ? t('settings.ai.form.keyKeep') : needsKey ? t('settings.ai.form.keyPlaceholder') : t('settings.ai.form.keyOptional');
    h += `<label class="ai-field"><span>${esc(t('settings.ai.form.apiKey'))}</span><span class="ai-keyrow">` +
      `<input type="password" dir="ltr" data-f="apiKey" data-fk="f:key" value="${esc(f.apiKey)}" placeholder="${esc(keyPh)}" autocomplete="new-password" spellcheck="false"${f.removeKey ? ' disabled' : ''}>` +
      (editing && f.hasKey ? `<button type="button" class="btn${f.removeKey ? '' : ' danger'}" data-act="remove-key" data-fk="f:rmkey">${esc(f.removeKey ? t('settings.ai.form.keepKey') : t('settings.ai.form.removeKey'))}</button>` : '') +
      `</span><small>${esc(f.removeKey ? t('settings.ai.form.keyWillRemove') : t('settings.ai.form.keyHint'))}</small></label>`;
    h += `<div class="ai-field row-switch"><span id="ai-auto-l">${esc(t('settings.ai.form.autoRefresh'))}<small>${esc(t('settings.ai.form.autoRefreshHint'))}</small></span>` +
      `<input type="checkbox" class="switch" data-f="autoRefresh" data-fk="f:auto" aria-labelledby="ai-auto-l"${f.autoRefresh ? ' checked' : ''}></div>`;
    if (f.error && !f.errField) h += `<div class="ai-err" role="alert">${esc(f.error)}</div>`;
    h += `<div class="ai-acts end"><button type="button" class="btn" data-act="cancel" data-fk="f:cancel">${esc(t('settings.ai.form.cancel'))}</button>` +
      `<button type="submit" class="btn primary" data-fk="f:save">${esc(t('settings.ai.form.save'))}</button></div></form>`;
    return h;
  }

  // ---- actions -----------------------------------------------------------------------------------------
  function openForm(p, focusKey) {
    ui.confirmDelete = null; ui.menu = null;
    if (p) {
      ui.form = { id: p.id, preset: p.kind, kind: p.kind, name: p.name || '', baseURL: p.baseURL || '', apiKey: '', removeKey: false,
        autoRefresh: p.autoRefresh !== false, hasKey: !!p.hasKey, enabled: p.enabled !== false, error: '', errField: '' };
    } else {
      const first = presets()[0] || { kind: 'custom', name: '', baseURL: '' };
      ui.form = { preset: first.kind, kind: first.kind, name: first.kind === 'custom' ? '' : first.name, baseURL: first.baseURL || '',
        apiKey: '', removeKey: false, autoRefresh: true, hasKey: false, enabled: true, error: '', errField: '' };
    }
    render(focusKey ? 'f:key' : p ? 'f:name' : 'f:preset');
  }

  function closeForm() {
    const id = ui.form && ui.form.id;
    ui.form = null;
    render(id ? 'mt:card:' + id : 'add');
  }

  function choosePreset(kind) {
    const f = ui.form, old = presetFor(f.kind), next = presetFor(kind) || {};
    // Replace the name / URL only when the user has not changed the previous preset's values.
    if (!f.name || (old && f.name === old.name)) f.name = kind === 'custom' ? '' : next.name || '';
    if (!f.baseURL || (old && f.baseURL === old.baseURL)) f.baseURL = next.baseURL || '';
    f.preset = f.kind = kind; f.error = ''; f.errField = '';
    render();
  }

  function saveForm() {
    const f = ui.form;
    const name = f.name.trim(), baseURL = f.baseURL.trim().replace(/\/+$/, '');
    if (!name) { f.error = t('settings.ai.form.errName'); f.errField = 'name'; render('f:name'); return; }
    if (!/^https?:\/\/[^\s/]+/i.test(baseURL)) { f.error = t('settings.ai.form.errURL'); f.errField = 'baseURL'; render('f:url'); return; }
    const provider = { name, kind: f.kind, baseURL, enabled: f.enabled, autoRefresh: !!f.autoRefresh };
    if (f.id) provider.id = f.id;
    const msg = { cmd: 'ai.save', provider };
    // Contract: omitted / empty apiKey keeps the saved key, null removes it.
    if (f.removeKey) msg.apiKey = null;
    else if (f.apiKey.trim()) msg.apiKey = f.apiKey.trim();
    f.apiKey = '';
    CM.native(msg);
    CM.toast(t('settings.ai.saved'));
    closeForm();
  }

  function checkModels(p, ids) {
    if (!ids.length) return;
    ui.batches[p.id] = { left: new Set(ids), ok: 0, total: ids.length };
    delete ui.batchDone[p.id];
    for (const mid of ids) { setPending(mKey(p.id, mid)); CM.native({ cmd: 'ai.checkModel', id: p.id, modelId: mid }); }
  }

  function setModelsHidden(p, hidden, onlyNew) {
    for (const m of p.models || []) if (!onlyNew || m.isNew) { m.hidden = hidden; m.isNew = false; }   // optimistic
    const msg = { cmd: 'ai.setModels', id: p.id, hidden };
    if (onlyNew) msg.onlyNew = true; else msg.all = true;
    CM.native(msg);
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
    const fromMenu = ui.menu && b.getAttribute('role') === 'menuitem' ? ui.menu : null;
    if (fromMenu) ui.menu = null;
    const back = fromMenu ? 'mt:' + fromMenu : null;   // focus returns to the menu button after a menu command
    switch (act) {
      case 'menu': {
        const key = b.dataset.menuKey;
        if (ui.menu === key) closeMenu(true); else openMenu(key);
        break;
      }
      case 'open-features': { const tab = document.querySelector('#settings .tabs [data-tab="features"]'); if (tab) tab.click(); break; }
      case 'add': openForm(null); break;
      case 'edit': if (p) openForm(p); break;
      case 'edit-key': if (p) openForm(p, true); break;
      case 'cancel': closeForm(); break;
      case 'remove-key': ui.form.removeKey = !ui.form.removeKey; ui.form.apiKey = ''; render(); break;
      case 'delete': ui.confirmDelete = p && p.id; render(p ? 'dn:' + p.id : null); break;
      case 'delete-no': ui.confirmDelete = null; render(p ? 'mt:card:' + p.id : null); break;
      case 'delete-yes':
        if (!p) break;
        ui.confirmDelete = null; ui.expanded.delete(p.id);
        CM.native({ cmd: 'ai.delete', id: p.id });
        CM.ai.providers = providers().filter((x) => x.id !== p.id);   // optimistic; aiState confirms
        CM.toast(t('settings.ai.deleted'));
        render('add'); break;
      case 'test': setPending('p:' + p.id); CM.native({ cmd: 'ai.checkProvider', id: p.id }); render(back); break;
      case 'expand': if (ui.expanded.has(p.id)) ui.expanded.delete(p.id); else ui.expanded.add(p.id); render(); break;
      case 'refresh': delete ui.refreshErr[p.id]; setPending('r:' + p.id); CM.native({ cmd: 'ai.refreshModels', id: p.id }); render(); break;
      case 'show-new': setModelsHidden(p, false, true); render(back); break;
      case 'show-all': setModelsHidden(p, false, false); render(back); break;
      case 'hide-all': setModelsHidden(p, true, false); render(back); break;
      case 'test-all': checkModels(p, (p.models || []).filter((x) => !x.hidden && !x.missing).map((x) => x.id)); render(back); break;
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
      if (ui.form.error) {
        // Clear the error in place (no re-render while typing).
        ui.form.error = ''; ui.form.errField = '';
        root.querySelectorAll('.ai-form .ai-ferr, .ai-form > .ai-err').forEach((x) => x.remove());
        root.querySelectorAll('.ai-form [aria-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
      }
      return;
    }
    if (el.dataset.act === 'search') {
      const card = el.closest('[data-id]'); if (!card) return;
      ui.search[card.dataset.id] = el.value;
      render();   // keeps focus and caret on the search field
    }
  }

  function onKey(e) {
    if (menuKey(e)) return;
    if (e.key === 'Escape') {
      if (ui.menu) { closeMenu(true); e.stopPropagation(); }
      else if (ui.form) { closeForm(); e.stopPropagation(); }
      else if (ui.confirmDelete) { const id = ui.confirmDelete; ui.confirmDelete = null; render('mt:card:' + id); e.stopPropagation(); }
    }
  }

  /** A press outside the open menu closes it. */
  function onDocDown(e) {
    if (!ui.menu || !root || !root.isConnected) return;
    if (e.target.closest && e.target.closest('.ai-mwrap')) return;
    ui.menu = null; render();
  }

  // ---- events from the app -----------------------------------------------------------------------------
  CM.on('aiState', (st) => {
    const ids = ((st && st.providers) || []).map((p) => p.id);
    if (ui.knownIds) for (const id of ids) if (!ui.knownIds.has(id)) ui.expanded.add(id);   // open a newly added provider
    ui.knownIds = new Set(ids);
    for (const id of Array.from(ui.expanded)) if (!ids.includes(id)) ui.expanded.delete(id);
    if (ui.form && ui.form.id && !ids.includes(ui.form.id)) ui.form = null;
    if (ui.menu && !ids.includes(ui.menu.slice(ui.menu.indexOf(':') + 1))) ui.menu = null;
    // Pick up key state that changed while editing (e.g. saved from another window).
    if (ui.form && ui.form.id) { const p = findProvider(ui.form.id); if (p) ui.form.hasKey = !!p.hasKey; }
    render();   // settings.js re-renders before this listener runs; render again with the bookkeeping applied
  });

  CM.on('aiEvent', (ev) => {
    if (!ev || !ev.id) return;
    const p = findProvider(ev.id);
    const name = p ? provName(p) : ev.id;
    if (ev.kind === 'refresh') {
      clearPending('r:' + ev.id);
      if (ev.error) { ui.refreshErr[ev.id] = ev.error; CM.toast(t('settings.ai.refresh.failed', { error: ev.error })); }
      else {
        delete ui.refreshErr[ev.id];
        const n = Array.isArray(ev.added) ? ev.added.length : Number(ev.added) || 0;
        CM.toast(n === 1 ? t('settings.ai.refresh.addedOne') : n ? t('settings.ai.refresh.added', { n }) : t('settings.ai.refresh.none'));
      }
    } else if (ev.kind === 'check') {
      if (ev.modelId) {
        clearPending(mKey(ev.id, ev.modelId));
        const b = ui.batches[ev.id];
        if (b && b.left.delete(ev.modelId)) {
          if (ev.ok) b.ok++;
          if (!b.left.size) {
            delete ui.batches[ev.id];
            ui.batchDone[ev.id] = { ok: b.ok, total: b.total };   // stays as inline status in the models panel
            CM.toast(t('settings.ai.testAll.done', { ok: b.ok, total: b.total }));
          }
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
      if (!docListener) { document.addEventListener('mousedown', onDocDown, true); docListener = true; }
      render();
      CM.native({ cmd: 'ai.list' });
    },
    update() { render(); },
  });
})();
