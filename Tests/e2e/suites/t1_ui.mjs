import fs from 'node:fs';
import path from 'node:path';

import {
  assert,
  assertContains,
  assertNotContains,
  createSuite,
} from '../lib/test_harness.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const suite = createSuite({
  name: 't1_ui',
  tier: 1,
  description:
    'E2E-M2 Tier 1: Headless browser UI feature coverage (F02, F03, F05, F06, F09, F10, F12, F13, F14, F15, F16, F17, F19, F20, F21, F22, F25)',
});

// ---------------------------------------------------------------------------
// Lazy shared browser & preview server + per-test page isolation helpers
// ---------------------------------------------------------------------------

const CLEAR_STORAGE_INIT = 'try { localStorage.clear(); } catch {}';
const LENS_WEBKIT_INIT = `${CLEAR_STORAGE_INIT}
window.webkit = {
  messageHandlers: {
    app: {
      postMessage(m) {
        (window.__sent = window.__sent || []).push(m);
      },
    },
  },
};`;

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function getPreviewEnv(ctx) {
  if (!ctx.state.previewEnv) {
    ctx.state.previewEnv = await createIsolatedPreviewEnv(ctx.repoRoot);
  }
  return ctx.state.previewEnv;
}

async function getBrowser(ctx) {
  if (!ctx.state.browser) {
    ctx.state.browser = await launchBrowser({ width: 1024, height: 768 });
  }
  return ctx.state.browser;
}

suite.afterAll(async (ctx) => {
  if (ctx.state.browser) await ctx.state.browser.close();
  if (ctx.state.previewEnv) await ctx.state.previewEnv.close();
});

async function withMonitorPage(ctx, fn, pageOpts = {}) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({
    initScript: CLEAR_STORAGE_INIT,
    ...pageOpts,
  });
  try {
    await page.goto(env.previewUrl, { settleMs: 80 });
    await page.waitFor(
      () =>
        Array.isArray(window.__sent) &&
        window.__sent.some((m) => m && m.cmd === 'dragZones') &&
        document.querySelectorAll('#hlist .item').length > 0
    );
    await page.evaluate(() => {
      if (window.I18N && window.I18N.lang !== 'en') window.MOCK.lang('en');
    });
    await page.waitFor(
      () => window.I18N && window.I18N.lang === 'en' && document.documentElement.dir === 'ltr'
    );
    await page.evaluate(() => {
      if (Array.isArray(window.__sent)) window.__sent.length = 0;
    });
    return await fn(page, env);
  } finally {
    await page.close();
  }
}

async function withActionsPage(ctx, fn, pageOpts = {}) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({
    initScript: CLEAR_STORAGE_INIT,
    ...pageOpts,
  });
  try {
    await page.goto(env.actionsPreviewUrl, { settleMs: 80 });
    await page.waitFor(
      () => typeof window.actions === 'object' && document.querySelectorAll('#list .item').length > 0
    );
    return await fn(page, env);
  } finally {
    await page.close();
  }
}

async function withLensPage(ctx, fn, pageOpts = {}) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({
    initScript: LENS_WEBKIT_INIT,
    ...pageOpts,
  });
  try {
    await page.goto(env.lensUrl, { settleMs: 80 });
    await page.waitFor(
      () => typeof window.lens === 'object' && Array.isArray(window.__sent)
    );
    return await fn(page, env);
  } finally {
    await page.close();
  }
}

async function openSettingsTab(page, tabId) {
  await page.click('#b-settings');
  await page.waitForSelector('#settings', { visible: true });
  await page.click(`#settings .tabs [data-tab="${tabId}"]`);
  await page.waitForSelector(`#settings .tab-panel[data-tab="${tabId}"]`, { visible: true });
}

async function openContentContextMenu(page) {
  await page.evaluate(() => {
    const c = document.getElementById('content');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(r.left + 40),
        clientY: Math.round(r.top + 40),
      })
    );
  });
  await page.waitForSelector('#ctx.show', { visible: true });
}

async function clearSent(page) {
  await page.evaluate(() => {
    if (Array.isArray(window.__sent)) window.__sent.length = 0;
  });
}

async function getSent(page) {
  return await page.evaluate(() => window.__sent || []);
}

async function findFlipRecorder(page) {
  return await page.evaluate(() => {
    const sec = document.querySelector('#settings [data-tab="actions"] .a-sec[data-sec="options"]');
    if (!sec) return null;
    const explicit = sec.querySelector('[data-key="flipHotkey"]');
    if (explicit) {
      const wrap = explicit.closest('.hk') || explicit.closest('.row')?.querySelector('.hk');
      if (wrap) {
        wrap.setAttribute('data-e2e-flip-hk', '1');
        return wrap.querySelector('.hk-rec')?.textContent || '';
      }
    }
    const rows = [...sec.querySelectorAll('.row')];
    for (const r of rows) {
      const hk = r.querySelector('.hk');
      if (!hk) continue;
      const btnText = hk.querySelector('.hk-rec')?.textContent || '';
      const rowText = r.textContent || '';
      if (btnText === '⌃⌥K' || /flip|היפוך|מקלדת/i.test(rowText)) {
        hk.setAttribute('data-e2e-flip-hk', '1');
        return btnText;
      }
    }
    return null;
  });
}

function listFilesRecursive(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// ===========================================================================
// F02: Unified model validation (5 tests)
// ===========================================================================

suite.test('T1-F02-01', 'F02', 'Translation LLM model picker lists only enabled providers and visible non-missing models', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.waitForSelector('select.t-model-pick', { visible: true });

    const options = await page.evaluate(() =>
      [...document.querySelectorAll('select.t-model-pick option')]
        .filter((o) => !o.disabled)
        .map((o) => ({ value: o.value, label: o.textContent }))
    );
    const vals = options.map((o) => o.value);
    assert.ok(vals.includes('p1\nclaude-sonnet-5-5'), 'Expected enabled visible model claude-sonnet-5-5');
    assert.ok(vals.includes('p1\nclaude-haiku-5-5'), 'Expected enabled visible model claude-haiku-5-5');
    assert.ok(!vals.includes('p1\nclaude-opus-5-5'), 'Hidden model claude-opus-5-5 must be excluded');
    assert.ok(!vals.some((v) => v.startsWith('p2\n')), 'Disabled provider p2 models must be excluded');
  });
});

suite.test('T1-F02-02', 'F02', 'Text Actions model picker includes Automatic plus the same enabled/visible/non-missing filter', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.waitForSelector('select.a-model-pick', { visible: true });

    const options = await page.evaluate(() =>
      [...document.querySelectorAll('select.a-model-pick option')].map((o) => ({
        value: o.value,
        label: o.textContent,
      }))
    );
    assert.equal(options[0].value, '', 'First option in a-model-pick should be Automatic ("")');
    const vals = options.map((o) => o.value);
    assert.ok(vals.includes('p1\nclaude-sonnet-5-5'));
    assert.ok(vals.includes('p1\nclaude-haiku-5-5'));
    assert.ok(!vals.includes('p1\nclaude-opus-5-5'));
    assert.ok(!vals.some((v) => v.startsWith('p2\n')));
  });
});

suite.test('T1-F02-03', 'F02', 'Enabling a disabled provider and unhiding a model updates both Translation and Actions pickers', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers[0].models.find((m) => m.id === 'claude-opus-5-5').hidden = false;
      st.providers[1].enabled = true;
      window.monitor.aiState(st);
    });
    await page.waitFor(() =>
      [...document.querySelectorAll('select.t-model-pick option')].some((o) => o.value === 'p2\nllama3.2:3b')
    );

    const trVals = await page.evaluate(() =>
      [...document.querySelectorAll('select.t-model-pick option')].map((o) => o.value)
    );
    assert.ok(trVals.includes('p1\nclaude-opus-5-5'));
    assert.ok(trVals.includes('p2\nllama3.2:3b'));

    await page.click('#settings .tabs [data-tab="actions"]');
    await page.waitForSelector('select.a-model-pick', { visible: true });
    const actVals = await page.evaluate(() =>
      [...document.querySelectorAll('select.a-model-pick option')].map((o) => o.value)
    );
    assert.ok(actVals.includes('p1\nclaude-opus-5-5'));
    assert.ok(actVals.includes('p2\nllama3.2:3b'));
  });
});

suite.test('T1-F02-04', 'F02', 'Selecting models in Translation and Actions pickers posts provider and model settings', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.waitForSelector('select.t-model-pick', { visible: true });
    await clearSent(page);
    await page.fill('select.t-model-pick', 'p1\nclaude-haiku-5-5');

    let sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'translateProvider' && m.value === 'p1'));
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'translateModel' && m.value === 'claude-haiku-5-5'));

    await page.click('#settings .tabs [data-tab="actions"]');
    await page.waitForSelector('select.a-model-pick', { visible: true });
    await clearSent(page);
    await page.fill('select.a-model-pick', 'p1\nclaude-sonnet-5-5');

    sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'actionsProvider' && m.value === 'p1'));
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'actionsModel' && m.value === 'claude-sonnet-5-5'));
  });
});

suite.test('T1-F02-05', 'F02', 'Marking a model missing removes it from both pickers and shows missing badge in AI tab', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'ai');
    await page.waitForSelector('.ai-prov[data-id="p1"] [data-act="expand"]', { visible: true });
    await page.click('.ai-prov[data-id="p1"] [data-act="expand"]');
    await page.waitForSelector('.ai-model[data-model="claude-haiku-5-5"]', { visible: true });

    await page.evaluate(() => new Promise((r) => setTimeout(r, 25)));
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers[0].models.find((m) => m.id === 'claude-haiku-5-5').missing = true;
      window.monitor.aiState(st);
    });
    const missRow = await page.waitForSelector('.ai-model.missing[data-model="claude-haiku-5-5"] .ai-badge.miss', {
      visible: true,
    });
    assert.ok(missRow.visible);

    await page.click('#settings .tabs [data-tab="translate"]');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.waitFor(
      () => ![...document.querySelectorAll('select.t-model-pick option')].some((o) => o.value === 'p1\nclaude-haiku-5-5')
    );

    await page.click('#settings .tabs [data-tab="actions"]');
    const actHasHaiku = await page.evaluate(() =>
      [...document.querySelectorAll('select.a-model-pick option')].some((o) => o.value === 'p1\nclaude-haiku-5-5')
    );
    assert.equal(actHasHaiku, false, 'Missing model must be excluded from a-model-pick');
  });
});

// ===========================================================================
// F03: Monitor keyOf(it) identity & list stability (5 tests)
// ===========================================================================

suite.test('T1-F03-01', 'F03', 'Pushing items with explicit id renders them and pin sends short key without text/image', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    await page.waitForSelector('body.show-history #hlist', { visible: true });
    await page.evaluate(() => {
      window.monitor.push({ id: 'item-alpha', time: 1700000001000, kind: 'text', text: 'Alpha clipboard item', app: 'Notes' });
      window.monitor.push({ id: 'item-beta', time: 1700000002000, kind: 'text', text: 'Beta clipboard item', app: 'Safari' });
    });
    await page.waitFor(() => document.querySelectorAll('#hlist .item').length >= 3);
    await clearSent(page);

    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#hlist .item')];
      const betaRow = rows.find((r) => r.textContent.includes('Beta clipboard item'));
      betaRow.querySelector('.acts button')?.click();
    });

    const sent = await getSent(page);
    const opMsg = sent.find((m) => m.cmd === 'historyOp');
    assert.ok(opMsg, 'Expected historyOp message');
    assert.equal(opMsg.op, 'pin');
    assert.equal(opMsg.key, 'item-beta');
    assert.equal(opMsg.text, undefined);
    assert.equal(opMsg.image, undefined);
  });
});

suite.test('T1-F03-02', 'F03', 'applyOp pin and delete target only the matching it.id', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    await page.evaluate(() => {
      window.monitor.push({ id: 'id-one', time: 1700000010000, kind: 'text', text: 'First unique item', app: 'AppA' });
      window.monitor.push({ id: 'id-two', time: 1700000011000, kind: 'text', text: 'Second unique item', app: 'AppB' });
      window.monitor.applyOp({ op: 'pin', key: 'id-one' });
    });
    await page.waitFor(() => document.querySelectorAll('#hlist .item.pinned').length === 1);

    const pinnedText = await page.evaluate(
      () => document.querySelector('#hlist .item.pinned .t')?.textContent || ''
    );
    assertContains(pinnedText, 'First unique item');

    await page.evaluate(() => window.monitor.applyOp({ op: 'delete', key: 'id-two' }));
    await page.waitFor(
      () => ![...document.querySelectorAll('#hlist .item .t')].some((n) => n.textContent.includes('Second unique item'))
    );
    const hasOne = await page.evaluate(() =>
      [...document.querySelectorAll('#hlist .item .t')].some((n) => n.textContent.includes('First unique item'))
    );
    assert.equal(hasOne, true);
  });
});

suite.test('T1-F03-03', 'F03', 'showHeld({ id }) switches #content to matching item and sets #b-hold.on', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'old-id', time: 1700000020000, kind: 'text', text: 'Older held target', app: 'App1' });
      window.monitor.push({ id: 'new-id', time: 1700000021000, kind: 'text', text: 'Newer top item', app: 'App2' });
      window.monitor.showHeld({ id: 'old-id' });
    });
    await page.waitFor(() => document.querySelector('#content')?.textContent.includes('Older held target'));
    const holdOn = await page.evaluate(() => document.querySelector('#b-hold')?.classList.contains('on'));
    assert.equal(holdOn, true);
  });
});

suite.test('T1-F03-04', 'F03', 'Context menu Open in New Window posts openItem with keyOf(it)', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'win-id-42', time: 1700000030000, kind: 'text', text: 'Window open item', app: 'Notes' });
    });
    await page.waitFor(() => document.querySelector('#content')?.textContent.includes('Window open item'));
    await openContentContextMenu(page);
    await clearSent(page);

    await page.evaluate(() => {
      const items = [...document.querySelectorAll('#ctx > [role="menuitem"]')];
      const openItem = items.find((el) => /open in new window|פתח בחלון חדש/i.test(el.textContent));
      openItem?.click();
    });

    const sent = await getSent(page);
    const msg = sent.find((m) => m.cmd === 'openItem');
    assert.ok(msg, 'Expected openItem message');
    assert.equal(msg.id, 'win-id-42');
  });
});

suite.test('T1-F03-05', 'F03', 'Long >20KB text and large image items send only short IDs in historyOp', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    const bigText = 'X'.repeat(24000);
    const bigImage = 'data:image/png;base64,' + 'A'.repeat(25000);
    await page.click('#b-hist');
    await page.evaluate(
      (txt, img) => {
        window.monitor.push({ id: 'big-txt-1', time: 1700000040000, kind: 'text', text: txt, app: 'Editor' });
        window.monitor.push({ id: 'big-img-1', time: 1700000041000, kind: 'image', image: img, size: '100x100', app: 'Preview' });
      },
      bigText,
      bigImage
    );
    await page.waitFor(() => document.querySelectorAll('#hlist .item').length >= 3);
    await clearSent(page);

    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('#hlist .item .acts button')];
      if (buttons[0]) buttons[0].click();
      if (buttons[3]) buttons[3].click();
    });

    const sent = await getSent(page);
    const ops = sent.filter((m) => m.cmd === 'historyOp');
    assert.equal(ops.length, 2);
    for (const op of ops) {
      assert.ok(typeof op.key === 'string' && op.key.length < 100, `Expected short key, got length ${op.key?.length}`);
      assert.equal(op.text, undefined);
      assert.equal(op.image, undefined);
    }
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

// ===========================================================================
// F05: Unified CM.menuKeys (10 tests: 5 Monitor + 5 Text Actions)
// ===========================================================================

suite.test('T1-F05-01', 'F05', 'Monitor #ctx ArrowDown, ArrowUp, Home, and End wrap across menuitems', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openContentContextMenu(page);
    const count = await page.evaluate(() => document.querySelectorAll('#ctx > [role="menuitem"]').length);
    assert.ok(count >= 4, `Expected >=4 menuitems, got ${count}`);

    const idx = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#ctx > [role="menuitem"]')].indexOf(document.activeElement)
      );

    assert.equal(await idx(), 0);
    await page.pressKey('ArrowDown');
    assert.equal(await idx(), 1);
    await page.pressKey('End');
    assert.equal(await idx(), count - 1);
    await page.pressKey('ArrowDown');
    assert.equal(await idx(), 0, 'ArrowDown from last should wrap to 0');
    await page.pressKey('ArrowUp');
    assert.equal(await idx(), count - 1, 'ArrowUp from 0 should wrap to last');
    await page.pressKey('Home');
    assert.equal(await idx(), 0);
  });
});

suite.test('T1-F05-02', 'F05', 'Enter invokes #ctx menuitem and closes menu; Escape closes and restores focus', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => document.getElementById('b-hold').focus());
    await openContentContextMenu(page);
    await page.pressKey('Escape');
    await page.waitFor(() => !document.getElementById('ctx').classList.contains('show'));
    const restoredId = await page.evaluate(() => document.activeElement?.id || '');
    assert.equal(restoredId, 'b-hold', 'Escape should restore focus to opener');

    await openContentContextMenu(page);
    await clearSent(page);
    await page.pressKey('Enter');
    await page.waitFor(() => !document.getElementById('ctx').classList.contains('show'));
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'copy'), 'Enter on first menuitem (Copy) should trigger copy');
  });
});

suite.test('T1-F05-03', 'F05', 'LTR ArrowRight opens Translate submenu in #ctx and ArrowLeft closes it', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openContentContextMenu(page);
    const subIdx = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#ctx > [role="menuitem"]')];
      const tr = items.find((el) => el.getAttribute('aria-haspopup') === 'menu');
      if (tr) tr.focus();
      return items.indexOf(tr);
    });
    assert.ok(subIdx >= 0, 'Expected a submenu trigger with aria-haspopup="menu"');

    await page.pressKey('ArrowRight');
    await page.waitForSelector('#ctx .ctx-sub [role="menuitem"]', { visible: true });
    const inSub = await page.evaluate(() => !!document.activeElement?.closest('.ctx-sub'));
    assert.equal(inSub, true, 'Submenu first item should receive focus');

    await page.pressKey('ArrowLeft');
    await page.waitFor(() => !document.querySelector('#ctx .ctx-sub'));
    const backOnTrigger = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-haspopup') === 'menu'
    );
    assert.equal(backOnTrigger, true);
  });
});

suite.test('T1-F05-04', 'F05', 'RTL (he) ArrowLeft opens .ctx-sub and ArrowRight closes it', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    await openContentContextMenu(page);

    await page.evaluate(() => {
      const tr = [...document.querySelectorAll('#ctx > [role="menuitem"]')].find(
        (el) => el.getAttribute('aria-haspopup') === 'menu'
      );
      tr?.focus();
    });

    await page.pressKey('ArrowLeft');
    await page.waitForSelector('#ctx .ctx-sub [role="menuitem"]', { visible: true });
    assert.equal(
      await page.evaluate(() => !!document.activeElement?.closest('.ctx-sub')),
      true
    );

    await page.pressKey('ArrowRight');
    await page.waitFor(() => !document.querySelector('#ctx .ctx-sub'));
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'menu'),
      true
    );
  });
});

suite.test('T1-F05-05', 'F05', 'Settings > AI provider .ai-menu uses CM.menuKeys (ArrowDown/ArrowUp/Escape refocuses trigger)', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'ai');
    await page.click('.ai-prov[data-id="p1"] [data-act="menu"]');
    await page.waitForSelector('.ai-menu[data-menu="card:p1"]', { visible: true });

    const active1 = await page.evaluate(() => document.activeElement?.dataset.act || '');
    assert.equal(active1, 'test');

    await page.pressKey('ArrowDown');
    const active2 = await page.evaluate(() => document.activeElement?.dataset.act || '');
    assert.equal(active2, 'edit');

    await page.pressKey('Escape');
    await page.waitFor(() => !document.querySelector('.ai-menu'));
    const trigFk = await page.evaluate(() => document.activeElement?.dataset.fk || '');
    assert.equal(trigFk, 'mt:card:p1');
  });
});

suite.test('T1-F05-06', 'F05', 'Text Actions Send-to menu opens and focuses first enabled menuitem', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Improved text', canReplace: true });
    });
    const trig = await page.waitFor(
      () =>
        [...document.querySelectorAll('#v-work button')].find(
          (b) =>
            b.offsetParent !== null &&
            /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
        )
    );
    assert.ok(trig);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    const focusedFirst = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].filter(
        (el) => !el.disabled && !el.hidden
      );
      return items.length > 0 && document.activeElement === items[0];
    });
    assert.equal(focusedFirst, true);
  });
});

suite.test('T1-F05-07', 'F05', 'Text Actions Send-to menu ArrowDown and ArrowUp navigate and wrap across items', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
          { id: 'telegram', name: 'Telegram' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Improved text', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });

    const activeIdx = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].indexOf(document.activeElement)
      );
    assert.equal(await activeIdx(), 0);
    await page.pressKey('ArrowDown');
    assert.equal(await activeIdx(), 1);
    await page.pressKey('ArrowDown');
    assert.equal(await activeIdx(), 2);
    await page.pressKey('ArrowDown');
    assert.equal(await activeIdx(), 0);
    await page.pressKey('ArrowUp');
    assert.equal(await activeIdx(), 2);
  });
});

suite.test('T1-F05-08', 'F05', 'Text Actions Send-to menu Home and End jump to first and last menuitem', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
          { id: 'telegram', name: 'Telegram' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Improved text', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await page.pressKey('End');
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].indexOf(document.activeElement)
      ),
      2
    );
    await page.pressKey('Home');
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].indexOf(document.activeElement)
      ),
      0
    );
  });
});

suite.test('T1-F05-09', 'F05', 'Pressing Enter on a focused Send-to menuitem emits sendTo and closes menu', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Ship this text', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.pressKey('Enter');
    await page.waitFor(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
    const sent = await getSent(page);
    const msg = sent.find((m) => m.cmd === 'sendTo');
    assert.ok(msg, 'Expected { cmd: "sendTo" } message');
    assert.equal(msg.text, 'Ship this text');
  });
});

suite.test('T1-F05-10', 'F05', 'Pressing Tab closes the open Text Actions Send-to menu cleanly', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Tab close check', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await page.pressKey('Tab');
    await page.waitFor(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
  });
});

// ===========================================================================
// F06: customActions & duplicate settings.tab.translate fallback removal (5 tests)
// ===========================================================================

suite.test('T1-F06-01', 'F06', 'CM.S exposes actionsList/actionsLibrary/actionsDefaults and no customActions property', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    const keys = await page.evaluate(() => Object.keys(window.CM.S));
    assert.ok(!keys.includes('customActions'), 'CM.S must not contain legacy customActions');
    assert.ok(keys.includes('actionsList'));
    assert.ok(keys.includes('actionsLibrary'));
    assert.ok(keys.includes('actionsDefaults'));
  });
});

suite.test('T1-F06-02', 'F06', 'Repository Sources/**/*.swift and Resources/*.js contain zero references to customActions', async (ctx) => {
  const files = [
    ...listFilesRecursive(path.join(ctx.repoRoot, 'Sources'), '.swift'),
    ...listFilesRecursive(path.join(ctx.repoRoot, 'Resources'), '.js'),
  ];
  const hits = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    if (content.includes('customActions')) hits.push(path.relative(ctx.repoRoot, f));
  }
  assert.deepEqual(hits, [], `Unexpected customActions references: ${hits.join(', ')}`);
});

suite.test('T1-F06-03', 'F06', 'settings.js has no duplicate settings.tab.translate fallback and tab label renders in en and he', async (ctx) => {
  const settingsJs = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings.js'), 'utf8');
  assertNotContains(settingsJs, 'settings.tab.translate', 'settings.js must not carry duplicate settings.tab.translate');

  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    const enLabel = await page.evaluate(() =>
      document.querySelector('#settings .tabs [data-tab="translate"]')?.textContent?.trim()
    );
    assert.equal(enLabel, 'Translation');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    const heLabel = await page.evaluate(() =>
      document.querySelector('#settings .tabs [data-tab="translate"]')?.textContent?.trim()
    );
    assert.equal(heLabel, 'תרגום');
  });
});

suite.test('T1-F06-04', 'F06', 'Editing an action in Settings > Text Actions persists via actionsList', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.lib-list .lib-item', { visible: true });

    await page.click('.lib-list .lib-item:first-child .lib-toggle');
    await page.waitForSelector('.lib-list .lib-item.open .lib-edit', { visible: true });
    await clearSent(page);
    await page.fill('.lib-edit input[type="text"]', 'Polish Prose');

    await page.waitFor(() =>
      (window.__sent || []).some((m) => m.cmd === 'set' && m.key === 'actionsList')
    );
    const sent = await getSent(page);
    const setMsg = [...sent].reverse().find((m) => m.cmd === 'set' && m.key === 'actionsList');
    assert.ok(setMsg);
    assert.ok(!sent.some((m) => m.key === 'customActions'));
    const parsed = JSON.parse(setMsg.value);
    assert.equal(parsed[0].name, 'Polish Prose');
  });
});

suite.test('T1-F06-05', 'F06', 'Restoring default actions resets actionsList to [] and preserves built-in actions cleanly', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.lib-btns .confirm-inline', { visible: true });
    await clearSent(page);

    await page.click('.lib-btns .confirm-inline > button');
    await page.waitForSelector('.lib-btns .confirm-inline .confirm-q', { visible: true });
    await page.click('.lib-btns .confirm-inline .confirm-q .btn.danger.primary');

    await page.waitFor(() =>
      (window.__sent || []).some((m) => m.cmd === 'set' && m.key === 'actionsList' && m.value === '[]')
    );
    const libCount = await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length);
    assert.ok(libCount >= 6);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

// ===========================================================================
// F09: Unified CM.hotkeyRecorder(key) (5 tests)
// ===========================================================================

suite.test('T1-F09-01', 'F09', 'CM.hotkeyRecorder mounts controls for all 5 shortcuts across Settings tabs', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    assert.equal((await page.query('#row-hotkey .hk .hk-rec')).visible, true, 'hotkey recorder missing');

    await page.click('#settings .tabs [data-tab="translate"]');
    await page.waitForSelector('.translate-tab', { visible: true });
    assert.equal(
      (await page.query('.f-hk[data-for="bubble"] .hk .hk-rec')).visible,
      true,
      'bubbleHotkey recorder missing'
    );
    assert.equal(
      (await page.query('.f-hk[data-for="lens"] .hk .hk-rec')).visible,
      true,
      'lensHotkey recorder missing'
    );

    await page.click('#settings .tabs [data-tab="actions"]');
    await page.waitForSelector('.actions-tab', { visible: true });
    await page.click('.a-seg button[data-sec="options"]');
    const hkCount = await page.evaluate(
      () => document.querySelectorAll('.a-sec[data-sec="options"] .hk .hk-rec').length
    );
    assert.equal(hkCount, 2, 'Expected both actionsHotkey and flipHotkey recorders in Text Actions > Options');
  });
});

suite.test('T1-F09-02', 'F09', 'Recording Ctrl+Alt+Shift+M updates display to ⌃⌥⇧M and posts set command', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    await clearSent(page);
    await page.click('#row-hotkey .hk-rec');
    await page.waitForSelector('#row-hotkey .hk-rec.on', { visible: true });
    await page.pressKey('m', { modifiers: ['Ctrl', 'Alt', 'Shift'] });

    await page.waitFor(() => document.querySelector('#row-hotkey .hk-rec')?.textContent === '⌃⌥⇧M');
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'hotkey' && m.value === 'ctrl+opt+shift+KeyM'));
  });
});

suite.test('T1-F09-03', 'F09', 'Clicking .hk-clear sets shortcut to off, hides clear button, and displays Off', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    await clearSent(page);
    await page.click('#row-hotkey .hk-clear');

    await page.waitFor(() => document.querySelector('#row-hotkey .hk-clear')?.hidden === true);
    const text = await page.evaluate(() => document.querySelector('#row-hotkey .hk-rec')?.textContent);
    assert.equal(text, 'Off');
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'hotkey' && m.value === 'off'));
  });
});

suite.test('T1-F09-04', 'F09', 'CM.hotkeyLabel renders legacy dash presets and + combos as readable glyphs', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    const labels = await page.evaluate(() => ({
      v: window.CM.hotkeyLabel('ctrl-opt-v'),
      t: window.CM.hotkeyLabel('ctrl-opt-t'),
      lt: window.CM.hotkeyLabel('ctrl-opt-cmd-t'),
      sp: window.CM.hotkeyLabel('ctrl-opt-space'),
      k: window.CM.hotkeyLabel('ctrl+opt+KeyK'),
    }));
    assert.equal(labels.v, '⌃⌥V');
    assert.equal(labels.t, '⌃⌥T');
    assert.equal(labels.lt, '⌃⌥⌘T');
    assert.equal(labels.sp, '⌃⌥Space');
    assert.equal(labels.k, '⌃⌥K');
  });
});

suite.test('T1-F09-05', 'F09', 'monitor.hotkeyRejected displays conflict toast in #toast.show', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => window.monitor.hotkeyRejected({ key: 'hotkey' }));
    const toast = await page.waitForSelector('#toast.show', { visible: true });
    const expected = await page.evaluate(() => window.t('hotkey.taken'));
    assert.equal(toast.text, expected);
  });
});

// ===========================================================================
// F10: Quick Translate in Actions (5 tests)
// ===========================================================================

suite.test('T1-F10-01', 'F10', 'quickTranslate ok renders #v-work, title, #target, #open-monitor, #text, and #replace.primary', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en,fr' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Hello world',
        text: 'שלום עולם',
        target: 'he',
        targets: 'he,en,fr',
        canReplace: true,
      });
    });
    await page.waitForSelector('#v-work', { visible: true });
    assert.equal((await page.query('#title')).text, 'Translation');
    assert.equal((await page.query('#target')).visible, true);
    assert.equal((await page.query('#open-monitor')).visible, true);
    assert.equal((await page.query('#open-monitor')).attrs.disabled, undefined);
    assertContains((await page.query('#text')).text, 'שלום עולם');
    assert.equal((await page.query('#replace')).visible, true);
    assertContains((await page.query('#replace')).attrs.class || '', 'primary');
    assert.equal((await page.query('#copy')).visible, true);
  });
});

suite.test('T1-F10-02', 'F10', 'Changing #target posts lensTarget setting and keeps focus on #target', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en,fr' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Hello world',
        text: 'שלום עולם',
        target: 'he',
        targets: 'he,en,fr',
        canReplace: true,
      });
    });
    await page.waitForSelector('#target', { visible: true });
    await clearSent(page);
    await page.fill('#target', 'fr');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'lensTarget' && m.value === 'fr'));
    const focusedId = await page.evaluate(() => document.activeElement?.id || '');
    assert.equal(focusedId, 'target');
  });
});

suite.test('T1-F10-03', 'F10', 'Collapsible source #src starts closed, holds source text, and expands on summary click', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Original paragraph under pointer',
        text: 'פסקה מתורגמת',
        target: 'he',
        canReplace: true,
      });
    });
    await page.waitForSelector('#src', { visible: true });
    assert.equal(await page.evaluate(() => document.getElementById('src').open), false);
    assert.equal((await page.query('#srctext')).text, 'Original paragraph under pointer');

    await clearSent(page);
    await page.click('#src summary');
    await page.waitFor(() => document.getElementById('src').open === true);
    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'size'));
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'size'));
  });
});

suite.test('T1-F10-04', 'F10', 'Clicking #open-monitor, #copy, and #replace emit expected bridge commands', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Original text',
        text: 'טקסט מתורגם',
        target: 'he',
        canReplace: true,
      });
    });
    await page.waitForSelector('#open-monitor', { visible: true });
    await clearSent(page);
    await page.click('#open-monitor');
    await page.click('#copy');
    await page.click('#replace');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'openInMonitor'));
    assert.ok(sent.some((m) => m.cmd === 'copy' && m.text === 'טקסט מתורגם'));
    assert.ok(sent.some((m) => m.cmd === 'replace' && m.text === 'טקסט מתורגם'));
  });
});

suite.test('T1-F10-05', 'F10', 'Clicking #back posts back and returns to #v-list with QT controls hidden', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Source text',
        text: 'טקסט',
        target: 'he',
        canReplace: true,
      });
    });
    await page.waitForSelector('#back', { visible: true });
    await clearSent(page);
    await page.click('#back');

    await page.waitForSelector('#v-list', { visible: true });
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'back'));
    assert.equal((await page.query('#target')).visible, false);
    assert.equal((await page.query('#open-monitor')).visible, false);
    assert.equal((await page.query('#src')).visible, false);
  });
});

// ===========================================================================
// F12: Settings tab reorganization (5 tests)
// ===========================================================================

suite.test('T1-F12-01', 'F12', 'settings-features.{js,css} are absent from repo and preview loads with 0 404s', async (ctx) => {
  assert.equal(fs.existsSync(path.join(ctx.repoRoot, 'Resources', 'settings-features.js')), false);
  assert.equal(fs.existsSync(path.join(ctx.repoRoot, 'Resources', 'settings-features.css')), false);

  await withMonitorPage(ctx, async (page) => {
    assert.deepEqual(page.getErrors().failedRequests, []);
    const refs = await page.evaluate(() =>
      [...document.querySelectorAll('script[src], link[href]')]
        .map((el) => el.getAttribute('src') || el.getAttribute('href'))
        .filter((u) => u.includes('settings-features'))
    );
    assert.deepEqual(refs, []);
  });
});

suite.test('T1-F12-02', 'F12', '#settings [role="tab"] contains exactly the 7 v1.2.0 tabs without features', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-settings');
    await page.waitForSelector('#settings .tabs [role="tab"]', { visible: true });
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('#settings .tabs [role="tab"]')].map((b) => b.dataset.tab)
    );
    assert.deepEqual(tabs, ['general', 'content', 'history', 'actions', 'translate', 'ai', 'about']);
  });
});

suite.test('T1-F12-03', 'F12', 'Content tab hosts relocated copyRtl, smartCards, 8 #smart-sub toggles, linkPreview, and compare', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'content');
    const keys = await page.evaluate(() =>
      [...document.querySelectorAll('#spanel-content [data-key]')].map((el) => el.dataset.key)
    );
    for (const k of [
      'f.copyRtl',
      'f.smartCards',
      'f.smartJwt',
      'f.smartJson',
      'f.smartColor',
      'f.smartTime',
      'f.smartBase64',
      'f.smartLink',
      'f.smartCron',
      'f.smartCurl',
      'f.linkPreview',
      'f.compare',
    ]) {
      assert.ok(keys.includes(k), `Missing ${k} in Content tab`);
    }
  });
});

suite.test('T1-F12-04', 'F12', 'Translation tab hosts f.translate master toggle, f.bubble, and f.lens', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    for (const k of ['f.translate', 'f.bubble', 'f.lens']) {
      const q = await page.query(`#spanel-translate [data-key="${k}"]`);
      assert.equal(q.exists, true, `Missing ${k} in Translation tab`);
    }
    await page.click('#spanel-translate input[data-key="f.translate"]');
    await page.waitFor(() => document.querySelector('#spanel-translate .t-body')?.classList.contains('off'));
  });
});

suite.test('T1-F12-05', 'F12', 'Text Actions and AI tabs host f.actions and f.ai master switches', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    assert.equal((await page.query('#spanel-actions input[data-key="f.actions"]')).visible, true);
    await page.click('#spanel-actions input[data-key="f.actions"]');
    await page.waitFor(() => document.querySelector('#spanel-actions .a-body')?.classList.contains('off'));

    await page.click('#settings .tabs [data-tab="ai"]');
    await page.waitForSelector('#spanel-ai input[data-act="toggle-ai"]', { visible: true });
    await page.click('#spanel-ai input[data-act="toggle-ai"]');
    await page.waitFor(() => document.querySelector('#spanel-ai .ai-body')?.classList.contains('off'));
  });
});

// ===========================================================================
// F13: Text Actions SSE streaming & multi-turn run (5 tests)
// ===========================================================================

suite.test('T1-F13-01', 'F13', 'status: running displays #v-work with status text and #result-foot hidden', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => window.actions.show({ status: 'running', id: 'improve' }));
    await page.waitForSelector('#v-work', { visible: true });
    assert.ok((await page.query('#status')).text.trim().length > 0);
    assert.equal((await page.query('#result-foot')).visible, false);
  });
});

suite.test('T1-F13-02', 'F13', 'Successive status: streaming calls update #text incrementally in the DOM', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'improve' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'First chunk' });
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('First chunk'));

    await page.evaluate(() => {
      window.actions.show({ status: 'streaming', id: 'improve', text: 'First chunk and second chunk' });
    });
    await page.waitFor(() =>
      (document.getElementById('text')?.textContent || '').includes('First chunk and second chunk')
    );
  });
});

suite.test('T1-F13-03', 'F13', 'Final status: result clears #status, reveals #result-foot, and focuses primary button', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'improve' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Partial' });
      window.actions.show({ status: 'result', id: 'improve', text: 'Final polished text', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'Final polished text');
    assert.equal((await page.query('#status')).text.trim(), '');
    const focused = await page.evaluate(() => document.activeElement?.id || '');
    assert.equal(focused, 'replace');
  });
});

suite.test('T1-F13-04', 'F13', 'Submitting a follow-up query after result posts run with multi-turn messages history', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'First answer', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const hasInput = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('#v-work input, #v-work textarea')].find(
        (el) => !el.hidden && el.offsetParent !== null && !el.closest('#src')
      );
      if (!inp) return false;
      inp.focus();
      inp.value = 'Make it shorter';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    assert.equal(hasInput, true, 'Expected visible follow-up input row in #v-work');

    await clearSent(page);
    await page.pressKey('Enter');
    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'run'));
    const sent = await getSent(page);
    const runMsg = sent.find((m) => m.cmd === 'run');
    assert.ok(runMsg, 'Expected { cmd: "run" }');
    assert.ok(Array.isArray(runMsg.messages) && runMsg.messages.length >= 2, 'Expected non-empty messages array');
  });
});

suite.test('T1-F13-05', 'F13', 'Streaming a follow-up turn updates #text incrementally and resolves to result', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'First answer', canReplace: true });
      window.actions.show({ status: 'running', id: 'improve', query: 'shorter' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Short ' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Short version' });
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('Short version'));
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Short version.', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'Short version.');
  });
});

// ===========================================================================
// F14: Text Actions UI upgrades (6 tests)
// ===========================================================================

suite.test('T1-F14-01', 'F14', '#chip renders as 2-line clamped blockquote with side bar (no single-line nowrap)', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    const info = await page.evaluate(() => {
      const chip = document.getElementById('chip');
      const cs = getComputedStyle(chip);
      return {
        whiteSpace: cs.whiteSpace,
        lineClamp: cs.webkitLineClamp || cs.lineClamp || '',
        borderStart: parseFloat(cs.borderInlineStartWidth || cs.borderLeftWidth || '0'),
      };
    });
    assert.notEqual(info.whiteSpace, 'nowrap', '#chip must wrap up to 2 lines instead of nowrap');
    assert.ok(info.lineClamp === '2' && info.borderStart > 0, 'Expected 2-line clamp and side bar on #chip');
  });
});

suite.test('T1-F14-02', 'F14', 'Result renders Markdown headings, lists, bold, inline code, and fenced code blocks', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({
        status: 'result',
        id: 'explain',
        text: '# Overview\n\n- **Bold** item with `inline`\n\n```js\nconst n = 1;\n```',
        canReplace: false,
      });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const tags = await page.evaluate(() => ({
      h1: !!document.querySelector('#text h1'),
      li: !!document.querySelector('#text ul li'),
      strong: !!document.querySelector('#text strong'),
      code: !!document.querySelector('#text code'),
      pre: !!document.querySelector('#text pre'),
    }));
    assert.deepEqual(tags, { h1: true, li: true, strong: true, code: true, pre: true });
  });
});

suite.test('T1-F14-03', 'F14', 'Mixed Hebrew + English result sets BiDi directions while keeping pre/code LTR', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({
        status: 'result',
        id: 'explain',
        text: 'שלום עולם זה טקסט בעברית\n\nThis is an English paragraph.\n\n```js\nconst x = 42;\n```',
        canReplace: false,
      });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const dirs = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('#text p')];
      const heP = ps.find((p) => p.textContent.includes('שלום'));
      const enP = ps.find((p) => p.textContent.includes('English'));
      const pre = document.querySelector('#text pre');
      return {
        heDir: heP?.getAttribute('dir') || (heP && getComputedStyle(heP).direction),
        enDir: enP?.getAttribute('dir') || (enP && getComputedStyle(enP).direction),
        preDir: pre ? getComputedStyle(pre).direction : null,
      };
    });
    assert.equal(dirs.heDir, 'rtl');
    assert.equal(dirs.enDir, 'ltr');
    assert.equal(dirs.preDir, 'ltr');
  });
});

suite.test('T1-F14-04', 'F14', 'Diff toggle compares source vs result and toggles back to Markdown/BiDi view', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.source = 'We moved the meeting to thursday';
      window.actions.show({
        status: 'list',
        source: window.MOCKA.source,
        actions: [{ id: 'fix', kind: 'builtin', replaces: true }],
        models: [],
        model: '',
        canReplace: true,
      });
      window.actions.show({
        status: 'result',
        id: 'fix',
        text: 'We moved the meeting to **Thursday**',
        canReplace: true,
      });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /diff|הבדל|שינויים/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      if (!b) return false;
      b.click();
      return true;
    });
    assert.equal(clicked, true, 'Expected Diff toggle button in #v-work');

    const diffText = await page.evaluate(() => document.getElementById('text')?.textContent || '');
    assertContains(diffText, 'thursday');
    assertContains(diffText, 'Thursday');

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /diff|הבדל|שינויים/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    assert.equal(await page.evaluate(() => !!document.querySelector('#text strong')), true);
  });
});

suite.test('T1-F14-05', 'F14', 'Edit mode opens textarea with result text and Copy/Replace posts edited text', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Original AI output', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /^edit$|עריכה|ערוך/i.test((x.textContent || x.title || x.getAttribute('aria-label') || '').trim())
      );
      if (!b) return false;
      b.click();
      return true;
    });
    assert.equal(opened, true, 'Expected Edit button in #v-work');

    const ta = await page.waitForSelector('#v-work textarea', { visible: true });
    assert.equal(ta.value, 'Original AI output');

    await page.fill('#v-work textarea', 'Manually edited output');
    await clearSent(page);
    await page.click('#copy');
    await page.click('#replace');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'copy' && m.text === 'Manually edited output'));
    assert.ok(sent.some((m) => m.cmd === 'replace' && m.text === 'Manually edited output'));
  });
});

suite.test('T1-F14-06', 'F14', 'Follow-up row submits query with messages history via submit button', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Initial result', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const submitted = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('#v-work input, #v-work textarea')].find(
        (el) => !el.hidden && el.offsetParent !== null && !el.closest('#src')
      );
      if (!inp) return false;
      inp.value = 'Translate to bullet points';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const form = inp.closest('form');
      const btn = form?.querySelector('button[type="submit"], button') || inp.parentElement?.querySelector('button');
      if (!btn) return false;
      window.__sent.length = 0;
      btn.click();
      return true;
    });
    assert.equal(submitted, true, 'Expected Follow-up input and submit button');
    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'run'));
    const runMsg = (await getSent(page)).find((m) => m.cmd === 'run');
    const hasPrompt =
      runMsg.query === 'Translate to bullet points' ||
      (Array.isArray(runMsg.messages) &&
        runMsg.messages.some((m) => m.role === 'user' && m.content === 'Translate to bullet points'));
    assert.equal(hasPrompt, true, 'Expected follow-up prompt in runMsg.query or runMsg.messages');
    assert.ok(Array.isArray(runMsg.messages) && runMsg.messages.length >= 2);
  });
});

// ===========================================================================
// F15: In-App AI Action Builder (5 tests)
// ===========================================================================

suite.test('T1-F15-01', 'F15', 'Settings > Text Actions > Actions renders AI Action Builder box at top of library', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.a-sec[data-sec="library"] .lib-list', { visible: true });

    const builderInfo = await page.evaluate(() => {
      const libSec = document.querySelector('.a-sec[data-sec="library"]');
      const libList = libSec.querySelector('.lib-list');
      const inputs = [...libSec.querySelectorAll('input, textarea')].filter(
        (el) => !libList.contains(el) && el.offsetParent !== null
      );
      const btns = [...libSec.querySelectorAll('button')].filter(
        (b) => !libList.contains(b) && b.offsetParent !== null && /ai|צור|התאם|generate|create/i.test(b.textContent || '')
      );
      return { inputCount: inputs.length, btnCount: btns.length };
    });
    assert.ok(builderInfo.inputCount >= 1 && builderInfo.btnCount >= 1, 'Expected AI Action Builder box in library');
  });
});

suite.test('T1-F15-02', 'F15', 'Settings AI Action Builder posts actions.generate and applies monitor.actionGenerated', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.a-sec[data-sec="library"] .lib-list', { visible: true });
    await clearSent(page);

    const triggered = await page.evaluate(() => {
      const libSec = document.querySelector('.a-sec[data-sec="library"]');
      const libList = libSec.querySelector('.lib-list');
      const inp = [...libSec.querySelectorAll('input, textarea')].find(
        (el) => !libList.contains(el) && el.offsetParent !== null
      );
      const btn = [...libSec.querySelectorAll('button')].find(
        (b) => !libList.contains(b) && !b.closest('.lib-btns') && b.offsetParent !== null && /ai|צור|התאם|generate|create|build|בנה/i.test(b.textContent || '')
      );
      if (!inp || !btn) return false;
      inp.value = 'Convert text to bullet points';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      return true;
    });
    assert.equal(triggered, true, 'AI Action Builder controls missing');

    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'actions.generate'));
    const genReq = (await getSent(page)).find((m) => m.cmd === 'actions.generate');
    assertContains(genReq.request, 'Convert text to bullet points');

    await page.evaluate((req) => {
      window.monitor.actionGenerated({
        req,
        action: { name: 'Bulletize', icon: 'list', prompt: 'Convert to bullets:\n{{ SELECTED TEXT }}', replaces: true },
      });
    }, genReq.req);

    await page.waitFor(() =>
      [...document.querySelectorAll('.lib-list .lib-name')].some((n) => n.textContent.includes('Bulletize'))
    );
  });
});

suite.test('T1-F15-03', 'F15', 'Action editor saves name and prompt via debounced oninput without requiring change event', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.click('.lib-list .lib-item:first-child .lib-toggle');
    await page.waitForSelector('.lib-list .lib-item.open .lib-edit', { visible: true });
    await clearSent(page);

    await page.evaluate(() => {
      const inp = document.querySelector('.lib-edit input[type="text"]');
      inp.value = 'Live Typed Name';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitFor(
      () =>
        (window.__sent || []).some(
          (m) => m.cmd === 'set' && m.key === 'actionsList' && String(m.value).includes('Live Typed Name')
        ),
      { timeoutMs: 3000 }
    );
  });
});

suite.test('T1-F15-04', 'F15', 'Clearing custom action name or prompt displays missing-field indicators', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.click('.lib-btns > button');
    await page.waitForSelector('.lib-item.open .lib-edit', { visible: true });

    const hasIndicator = await page.evaluate(() => {
      const ed = document.querySelector('.lib-item.open .lib-edit');
      return !!(
        ed.querySelector('[aria-invalid="true"]') ||
        ed.querySelector('.missing, .invalid, .err, .warn, [data-missing]')
      );
    });
    assert.equal(hasIndicator, true, 'Expected missing-field indicator for blank custom action name/prompt');
  });
});

suite.test('T1-F15-05', 'F15', 'Ask AI result offers Save as Action button and search bar detects action creation intent', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'ask', query: 'make it rhyme' });
      window.actions.show({ status: 'result', id: 'ask', text: 'Roses are red...', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const saveBtnFound = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) => x.offsetParent !== null && /save.*action|שמור כפעולה/i.test(x.textContent || '')
      );
      if (!b) return false;
      window.__sent.length = 0;
      b.click();
      return true;
    });
    assert.equal(saveBtnFound, true, 'Expected Save as Permanent Action button on ask result');
    await page.waitFor(() =>
      (window.__sent || []).some((m) => m.cmd === 'saveCustomAction' || m.cmd === 'actions.generate' || m.cmd === 'set')
    );

    await page.evaluate(() => window.actions.show({
      status: 'list',
      source: 'hello',
      actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
      models: [{ value: 'p1\nm', label: 'm', group: 'G' }],
      model: 'p1\nm',
      canReplace: true,
    }));
    await page.fill('#q', 'create action: make bullet list');
    await clearSent(page);
    const createRowClicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((el) => {
        const label = (el.querySelector('.label')?.textContent || el.textContent || '').trim();
        return (
          !/^(?:Ask AI:|שאל את)/i.test(label) &&
          /create|builder|צור פעולה|הוסף פעולה|בנה פעולה/i.test(label)
        );
      });
      if (!row) return false;
      row.click();
      return true;
    });
    assert.equal(createRowClicked, true, 'Expected dedicated action-creation row distinct from Ask AI row');
    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'actions.generate'));
    const genMsgs = await getSent(page);
    assert.equal(genMsgs.some((m) => m.cmd === 'run' && m.id === 'ask'), false, 'Create-action row must not emit Ask AI run');
    assert.ok(genMsgs.some((m) => m.cmd === 'actions.generate' && String(m.request || '').includes('make bullet list')));
  });
});

// ===========================================================================
// F16: Local zero-AI text actions (5 tests)
// ===========================================================================

suite.test('T1-F16-01', 'F16', 'With MOCKA.noModels = true, local actions flipKeyboard, wrapRtl, cleanSpaces remain listed', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.lang('en');
    });
    await page.waitForSelector('#nomodel', { visible: true });
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('#list .item .label')].map((el) => el.textContent)
    );
    assert.ok(titles.length >= 9);
    const hasLocalTitles = await page.evaluate(() => {
      const list = [...document.querySelectorAll('#list .item .label')].map((el) => el.textContent);
      return (
        list.some((t) => /flip|keyboard/i.test(t)) &&
        list.some((t) => /rtl/i.test(t)) &&
        list.some((t) => /clean|space|whitespace/i.test(t))
      );
    });
    assert.equal(hasLocalTitles, true, `Expected 3 local actions in list; got: ${titles.join(', ')}`);
  });
});

suite.test('T1-F16-02', 'F16', 'flipKeyboard runs with MOCKA.noModels = true and flips akuo to שלום', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.source = 'akuo';
      window.MOCKA.lang('en');
    });
    await page.waitForSelector('#list .item', { visible: true });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((r) => /flip|keyboard/i.test(r.textContent));
      if (!row) throw new Error('flipKeyboard row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'שלום');
    assert.equal((await page.query('#status.error')).exists, false);
  });
});

suite.test('T1-F16-03', 'F16', 'wrapRtl runs with MOCKA.noModels = true and wraps Hebrew text in directional isolates', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.source = 'שלום world';
      window.MOCKA.lang('en');
    });
    await page.waitForSelector('#list .item', { visible: true });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((r) => /rtl/i.test(r.textContent));
      if (!row) throw new Error('wrapRtl row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const out = (await page.query('#text')).text;
    assertContains(out, '\u2067');
    assertContains(out, '\u2069');
  });
});

suite.test('T1-F16-04', 'F16', 'cleanSpaces runs with MOCKA.noModels = true and normalizes redundant whitespace', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.source = 'hello   world  \n\n\n\nline   two';
      window.MOCKA.lang('en');
    });
    await page.waitForSelector('#list .item', { visible: true });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((r) =>
        /clean|space|whitespace/i.test(r.textContent)
      );
      if (!row) throw new Error('cleanSpaces row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const out = (await page.query('#text')).text;
    assertContains(out, 'hello world');
    assertNotContains(out, '   ');
  });
});

suite.test('T1-F16-05', 'F16', 'Hebrew UI displays localized titles for all 3 local actions with 0 missing I18N keys', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => window.MOCKA.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');

    const check = await page.evaluate(() => ({
      missing: window.I18N.missing('he'),
      flip: window.ACTIONS.title({ id: 'flipKeyboard' }),
      rtl: window.ACTIONS.title({ id: 'wrapRtl' }),
      clean: window.ACTIONS.title({ id: 'cleanSpaces' }),
      untitled: window.ACTIONS.title({ id: 'untitled' }),
    }));
    assert.deepEqual(check.missing, []);
    assert.notEqual(check.flip, check.untitled);
    assert.notEqual(check.rtl, check.untitled);
    assert.notEqual(check.clean, check.untitled);
    assert.match(check.flip, /[\u0590-\u05FF]/);
    assert.match(check.rtl, /[\u0590-\u05FF]/);
    assert.match(check.clean, /[\u0590-\u05FF]/);
  });
});

// ===========================================================================
// F17: Global quick flip (flipHotkey) (5 tests)
// ===========================================================================

suite.test('T1-F17-01', 'F17', 'CM.S.flipHotkey defaults to ctrl+opt+KeyK and renders as ⌃⌥K', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    const res = await page.evaluate(() => ({
      raw: window.CM.S.flipHotkey,
      label: window.CM.hotkeyLabel(window.CM.S.flipHotkey),
    }));
    assert.equal(res.raw, 'ctrl+opt+KeyK');
    assert.equal(res.label, '⌃⌥K');
  });
});

suite.test('T1-F17-02', 'F17', 'Sources/Settings.swift defines flipHotkey default ctrl+opt+KeyK', async (ctx) => {
  const swift = fs.readFileSync(path.join(ctx.repoRoot, 'Sources', 'Settings.swift'), 'utf8');
  assertContains(swift, '"flipHotkey": "ctrl+opt+KeyK"');
});

suite.test('T1-F17-03', 'F17', 'Settings > Text Actions > Options renders flipHotkey recorder showing ⌃⌥K', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.equal(label, '⌃⌥K', 'Expected flipHotkey recorder initialized to ⌃⌥K');
  });
});

suite.test('T1-F17-04', 'F17', 'Recording Ctrl+Alt+F on flipHotkey posts set flipHotkey and updates label to ⌃⌥F', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.ok(label !== null, 'flipHotkey recorder not found');

    await clearSent(page);
    await page.click('[data-e2e-flip-hk="1"] .hk-rec');
    await page.waitForSelector('[data-e2e-flip-hk="1"] .hk-rec.on', { visible: true });
    await page.pressKey('f', { modifiers: ['Ctrl', 'Alt'] });

    await page.waitFor(
      () => document.querySelector('[data-e2e-flip-hk="1"] .hk-rec')?.textContent === '⌃⌥F'
    );
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'flipHotkey' && m.value === 'ctrl+opt+KeyF'));
  });
});

suite.test('T1-F17-05', 'F17', 'Clearing flipHotkey posts set flipHotkey off and displays Off/כבוי', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.ok(label !== null, 'flipHotkey recorder not found');

    await clearSent(page);
    await page.click('[data-e2e-flip-hk="1"] .hk-clear');
    await page.waitFor(
      () => document.querySelector('[data-e2e-flip-hk="1"] .hk-clear')?.hidden === true
    );
    assert.equal(
      await page.evaluate(() => document.querySelector('[data-e2e-flip-hk="1"] .hk-rec')?.textContent),
      'Off'
    );
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'flipHotkey' && m.value === 'off'));
  });
});

// ===========================================================================
// F19: Monitor image OCR (5 tests)
// ===========================================================================

suite.test('T1-F19-01', 'F19', 'Pushing an image item renders OCR extraction button in en and Hebrew', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-1', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
    }, TINY_PNG_DATA_URL);
    await page.waitForSelector('#content .imgwrap img', { visible: true });

    const enBtn = await page.evaluate(() =>
      [...document.querySelectorAll('#content button')].find((b) => /ocr|extract text/i.test(b.textContent || ''))?.textContent || ''
    );
    assert.ok(enBtn.length > 0, 'Expected OCR button on image item in English');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    const heBtn = await page.evaluate(() =>
      [...document.querySelectorAll('#content button')].find((b) => /חלץ טקסט|OCR/i.test(b.textContent || ''))?.textContent || ''
    );
    assertContains(heBtn, 'חלץ טקסט');
  });
});

suite.test('T1-F19-02', 'F19', 'Clicking OCR button posts { cmd: "ocr", id, image } over bridge', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-ocr-2', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
    }, TINY_PNG_DATA_URL);
    await page.waitForSelector('#content .imgwrap img', { visible: true });
    await clearSent(page);

    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#content button')].find((x) => /ocr|חלץ טקסט/i.test(x.textContent || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    assert.equal(clicked, true, 'OCR button not found');
    const sent = await getSent(page);
    const ocrMsg = sent.find((m) => m.cmd === 'ocr');
    assert.ok(ocrMsg, 'Expected { cmd: "ocr" } message');
    assert.equal(ocrMsg.id, 'img-ocr-2');
    assert.equal(ocrMsg.image, TINY_PNG_DATA_URL);
  });
});

suite.test('T1-F19-03', 'F19', 'monitor.ocrResult renders extracted text below image with BiDi direction', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-ocr-3', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.ocrResult({ id: 'img-ocr-3', text: 'שלום עולם\nEnglish line here' });
    }, TINY_PNG_DATA_URL);

    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('שלום עולם'));
    const layout = await page.evaluate(() => {
      const imgWrap = document.querySelector('#content .imgwrap');
      const all = [...document.querySelectorAll('#content *')];
      const heEl = all.find((el) => el.children.length === 0 && el.textContent.includes('שלום עולם'));
      const enEl = all.find((el) => el.children.length === 0 && el.textContent.includes('English line here'));
      return {
        imgBottom: imgWrap?.getBoundingClientRect().bottom || 0,
        heTop: heEl?.getBoundingClientRect().top || 0,
        heDir: heEl?.getAttribute('dir') || heEl?.closest('[dir]')?.getAttribute('dir'),
        enDir: enEl?.getAttribute('dir') || enEl?.closest('[dir]')?.getAttribute('dir'),
      };
    });
    assert.ok(layout.heTop >= layout.imgBottom - 2, 'Extracted OCR text should render below image');
    assert.equal(layout.heDir, 'rtl');
    assert.equal(layout.enDir, 'ltr');
  });
});

suite.test('T1-F19-04', 'F19', 'OCR result provides Copy button posting { cmd: "copy", text }', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-ocr-4', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.ocrResult({ id: 'img-ocr-4', text: 'Extracted OCR copy text' });
    }, TINY_PNG_DATA_URL);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Extracted OCR copy text'));
    await clearSent(page);

    const copied = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#content button')];
      const cp = btns.find((b) => /copy|העתק/i.test(b.textContent || ''));
      if (!cp) return false;
      cp.click();
      return true;
    });
    assert.equal(copied, true, 'Expected Copy button in OCR result panel');
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'copy' && m.text === 'Extracted OCR copy text'));
  });
});

suite.test('T1-F19-05', 'F19', 'OCR result provides Translate button posting { cmd: "translate", text }', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-ocr-5', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.ocrResult({ id: 'img-ocr-5', text: 'Translate this OCR text' });
    }, TINY_PNG_DATA_URL);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Translate this OCR text'));
    await clearSent(page);

    const translated = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#content button')];
      const tr = btns.find((b) => /translate|תרגם/i.test(b.textContent || ''));
      if (!tr) return false;
      tr.click();
      return true;
    });
    assert.equal(translated, true, 'Expected Translate button in OCR result panel');
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'translate' && m.text === 'Translate this OCR text'));
  });
});

// ===========================================================================
// F20: Lens OCR fallback & UI (5 tests)
// ===========================================================================

suite.test('T1-F20-01', 'F20', 'lens.html loads cleanly and lens.setup configures targets, auto, reading mode, and dragZones', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    assert.deepEqual(page.getErrors().allErrors, []);
    await clearSent(page);
    await page.evaluate(() => {
      window.lens.setup({ lang: 'en', target: '', targets: 'he,en,fr', auto: true, mode: 'reading' });
    });

    const state = await page.evaluate(() => ({
      bodyReading: document.body.classList.contains('reading'),
      autoPressed: document.getElementById('auto')?.getAttribute('aria-pressed'),
      options: [...document.querySelectorAll('#target option')].map((o) => o.value),
    }));
    assert.equal(state.bodyReading, true);
    assert.equal(state.autoPressed, 'true');
    assert.deepEqual(state.options, ['', 'he', 'en', 'fr']);
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'dragZones'));
  });
});

suite.test('T1-F20-02', 'F20', 'lens.render in reading mode renders ok (with code), same, and pending blocks', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.lens.setup({ lang: 'en', mode: 'reading' });
      window.lens.render({
        mode: 'reading',
        status: 'ok',
        blocks: [
          { text: 'Hello `code()` world', state: 'ok' },
          { text: 'Unchanged line', state: 'same' },
          { text: 'Waiting...', state: 'pending' },
        ],
      });
    });

    const blocks = await page.evaluate(() => ({
      ok: document.querySelectorAll('#layer p.doc.ok').length,
      same: document.querySelectorAll('#layer p.doc.same').length,
      pending: document.querySelectorAll('#layer p.doc.pending').length,
      code: document.querySelector('#layer p.doc.ok code')?.textContent || '',
    }));
    assert.deepEqual(blocks, { ok: 1, same: 1, pending: 1, code: 'code()' });
  });
});

suite.test('T1-F20-03', 'F20', 'Switching to overlay mode posts lensMode and renders positioned .t boxes', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => window.lens.setup({ lang: 'en', mode: 'reading' }));
    await clearSent(page);
    await page.click('#mode');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'lensMode' && m.value === 'overlay'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), false);
    assert.equal((await page.query('#mode')).attrs['aria-pressed'], 'true');

    await page.evaluate(() => {
      window.lens.render({
        mode: 'overlay',
        status: 'ok',
        spans: [
          { x: 10, y: 20, w: 180, h: 24, line: true, text: 'Line overlay' },
          { x: 10, y: 55, w: 240, h: 60, line: false, text: 'Block overlay' },
        ],
      });
    });
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('#layer .t')].map((el) => ({
        cls: el.className,
        left: el.style.left,
        top: el.style.top,
        width: el.style.width,
        height: el.style.height,
        text: el.textContent,
      }))
    );
    assert.equal(boxes.length, 2);
    assertContains(boxes[0].cls, 'line');
    assert.equal(boxes[0].left, '10px');
    assert.equal(boxes[0].top, '20px');
    assertContains(boxes[1].cls, 'block');
  });
});

suite.test('T1-F20-04', 'F20', 'Toolbar target, auto, refresh, and close controls emit expected bridge messages', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => window.lens.setup({ lang: 'en', target: '', targets: 'he,en,fr', auto: true }));
    await clearSent(page);
    await page.fill('#target', 'fr');
    await page.click('#auto');
    await page.click('#refresh');
    await page.click('#close');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'lensTarget' && m.value === 'fr'));
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'lensAutoRefresh' && m.value === false));
    assert.ok(sent.some((m) => m.cmd === 'refresh'));
    assert.ok(sent.some((m) => m.cmd === 'close'));
  });
});

suite.test('T1-F20-05', 'F20', 'lens.status handles permission button and error banner cleanly', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => window.lens.status({ status: 'permission' }));
    const ax = await page.waitForSelector('#ax', { visible: true });
    assert.equal(ax.visible, true);

    await clearSent(page);
    await page.click('#ax');
    assert.ok((await getSent(page)).some((m) => m.cmd === 'openAXSettings'));

    await page.evaluate(() => window.lens.status({ status: 'error', detail: 'unsupported' }));
    const st = await page.query('#status.error');
    assert.equal(st.exists, true);
    assert.equal((await page.query('#ax')).visible, false);
    assertContains(st.text, 'not available');
  });
});

// ===========================================================================
// F21: Cron & curl Smart Cards (5 tests)
// ===========================================================================

suite.test('T1-F21-01', 'F21', 'Pushing a 5-field cron expression renders Cron Smart Card with explanation and next runs', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cron-1', time: Date.now(), kind: 'text', text: '*/15 9-17 * * 1-5', app: 'Terminal' });
    });
    const card = await page.waitForSelector('#content .card', { visible: true });
    assertContains(card.text.toLowerCase(), 'cron');
    const kindText = (await page.query('#kind')).text;
    assertContains(kindText.toLowerCase(), 'cron');
    assert.ok(card.text.length > 30, 'Expected human explanation and upcoming run times inside Cron card');
  });
});

suite.test('T1-F21-02', 'F21', 'Switching UI language to Hebrew translates Cron Smart Card description', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cron-he', time: Date.now(), kind: 'text', text: '0 9 * * 1-5', app: 'Terminal' });
      window.MOCK.lang('he');
    });
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    const card = await page.waitForSelector('#content .card', { visible: true });
    assert.match(card.text, /[\u0590-\u05FF]/, 'Expected Hebrew text in Cron Smart Card');
  });
});

suite.test('T1-F21-03', 'F21', 'Pushing a curl command renders curl Smart Card with method, URL, headers, and body', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({
        id: 'curl-1',
        time: Date.now(),
        kind: 'text',
        text: 'curl -X POST https://api.example.com/v1/items -H "Authorization: Bearer abc" -H "Content-Type: application/json" -d \'{"ok":true}\'',
        app: 'Terminal',
      });
    });
    const card = await page.waitForSelector('#content .card', { visible: true });
    assertContains(card.text, 'POST');
    assertContains(card.text, 'https://api.example.com/v1/items');
    assertContains(card.text, 'Authorization');
    assertContains(card.text, 'ok');
    assertContains(card.text, 'true');
  });
});

suite.test('T1-F21-04', 'F21', 'f.smartCron toggle hides and restores Cron Smart Card without affecting other cards', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cron-toggle', time: Date.now(), kind: 'text', text: '*/5 * * * *', app: 'Terminal' });
    });
    await page.waitForSelector('#content .card', { visible: true });

    await page.evaluate(() => window.CM.setSetting('f.smartCron', false));
    await page.waitFor(() => !document.querySelector('#content .card'));

    await page.evaluate(() => window.CM.setSetting('f.smartCron', true));
    await page.waitForSelector('#content .card', { visible: true });
  });
});

suite.test('T1-F21-05', 'F21', 'f.smartCurl and master f.smartCards toggles control curl and Cron Smart Cards', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'curl-toggle', time: Date.now(), kind: 'text', text: 'curl https://example.com/ping', app: 'Terminal' });
    });
    await page.waitForSelector('#content .card', { visible: true });

    await page.evaluate(() => window.CM.setSetting('f.smartCurl', false));
    await page.waitFor(() => !document.querySelector('#content .card'));

    await page.evaluate(() => window.CM.setSetting('f.smartCurl', true));
    await page.waitForSelector('#content .card', { visible: true });

    await page.evaluate(() => window.CM.setSetting('f.smartCards', false));
    await page.waitFor(() => !document.querySelector('#content .card'));
  });
});

// ===========================================================================
// F22: Monitor UI/UX upgrades (5 tests)
// ===========================================================================

suite.test('T1-F22-01', 'F22', '#b-theme is removed from Monitor header while theme setting remains in General tab', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    assert.deepEqual(page.getErrors().allErrors, []);
    assert.equal((await page.query('#b-theme')).exists, false, '#b-theme must be removed from index.html');

    await openSettingsTab(page, 'general');
    assert.equal((await page.query('#spanel-general .seg[data-key="theme"]')).visible, true);
  });
});

suite.test('T1-F22-02', 'F22', 'Clicking #b-copy and #b-rtl shows temporary checkmark feedback and restores original label', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cp-1', time: Date.now(), kind: 'text', text: 'שלום hello', app: 'Notes' });
    });
    await page.waitForSelector('#b-rtl', { visible: true });

    const beforeCopy = (await page.query('#b-copy')).text;
    await page.click('#b-copy');
    await page.waitFor(() => (document.getElementById('b-copy')?.textContent || '').includes('✓'));
    await page.waitFor(
      () => !(document.getElementById('b-copy')?.textContent || '').includes('✓'),
      { timeoutMs: 3000 }
    );
    assert.equal((await page.query('#b-copy')).text, beforeCopy);

    const beforeRtl = (await page.query('#b-rtl')).text;
    await page.click('#b-rtl');
    await page.waitFor(() => (document.getElementById('b-rtl')?.textContent || '').includes('✓'));
    await page.waitFor(
      () => !(document.getElementById('b-rtl')?.textContent || '').includes('✓'),
      { timeoutMs: 3000 }
    );
    assert.equal((await page.query('#b-rtl')).text, beforeRtl);
  });
});

suite.test('T1-F22-03', 'F22', 'At 320x600 narrow viewport, all 7 Settings tabs fit cleanly and #history opens as usable drawer', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.setViewport(320, 600);
    await openSettingsTab(page, 'general');
    const tabs = await page.queryAll('#settings .tabs [role="tab"]');
    assert.equal(tabs.length, 7);
    for (const tb of tabs) {
      assert.ok(tb.rect.width > 0 && tb.rect.height > 0, `Tab ${tb.text} has zero rect`);
      assert.ok(tb.rect.left >= 0 && tb.rect.left + tb.rect.width <= 321, `Tab ${tb.text} overflows 320px: ${JSON.stringify(tb.rect)}`);
    }

    await page.click('#s-close');
    await page.click('#b-hist');
    await page.waitForSelector('body.show-history #history', { visible: true });
    const rects = await page.evaluate(() => {
      const h = document.getElementById('history').getBoundingClientRect();
      const c = document.getElementById('content').getBoundingClientRect();
      return { hWidth: h.width, hRight: h.right, cWidth: c.width };
    });
    assert.ok(rects.hWidth >= 150 && rects.hRight <= 321);
    assert.ok(rects.cWidth >= 180, `Expected #history drawer overlay/responsive layout so #content stays >=180px (got ${rects.cWidth})`);
  });
});

suite.test('T1-F22-04', 'F22', 'Quick Edit (Cmd+E) opens inline editor with item text and saves edited copy back', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'qe-1', time: Date.now(), kind: 'text', text: 'Initial clip text', app: 'Notes' });
    });
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Initial clip text'));

    await page.pressKey('e', { modifiers: ['Meta'] });
    const ta = await page.waitForSelector('#content textarea', { visible: true });
    assert.equal(ta.value, 'Initial clip text');

    await clearSent(page);
    await page.fill('#content textarea', 'Edited clip text');
    await page.evaluate(() => {
      const saveBtn = [...document.querySelectorAll('#content button')].find((b) =>
        /save|שמור/i.test(b.textContent || '')
      );
      if (saveBtn) saveBtn.click();
    });

    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'copy' && m.text === 'Edited clip text'));
    assertContains((await page.query('#content')).text, 'Edited clip text');
  });
});

suite.test('T1-F22-05', 'F22', 'Compare mode shows guidance banner and Empty State displays active shortcuts in en and he', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cmp-a', time: 1700000050000, kind: 'text', text: 'First compare text', app: 'Notes' });
      window.monitor.push({ id: 'cmp-b', time: 1700000051000, kind: 'text', text: 'Second compare text', app: 'Notes' });
    });
    await page.waitFor(() =>
      [...document.querySelectorAll('#content .actions button')].some((b) => /compare|השווה/i.test(b.textContent || ''))
    );
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#content .actions button')].find((x) =>
        /compare|השווה/i.test(x.textContent || '')
      );
      b.click();
    });
    await page.waitForSelector('body.picking', { visible: true });
    const banner = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('main [role="status"], main [role="alert"], main .banner, main .pick-banner, main .compare-banner, #content .note')];
      return candidates.some((el) => el.tagName !== 'BUTTON' && el.offsetParent !== null && /choose|select|pick|click|בחר|השוואה/i.test(el.textContent || ''));
    });
    assert.equal(banner, true, 'Expected visible Compare guidance banner in picking mode');

    // Transition to Empty State by deleting all items
    await page.evaluate(() => {
      window.monitor.clearHistory();
      const firstKey = document.querySelector('#hlist .item')?.item?.id;
      if (firstKey) window.monitor.applyOp({ op: 'delete', key: firstKey });
    });
    await page.waitForSelector('#content .empty', { visible: true });
    const enEmpty = (await page.query('#content .empty')).text;
    assertContains(enEmpty, '⌃⌥V', 'Empty state should show active global shortcut');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    const heEmpty = (await page.query('#content .empty')).text;
    assertContains(heEmpty, '⌃⌥V');
    assert.match(heEmpty, /[\u0590-\u05FF]/);
  });
});

// ===========================================================================
// F25: "שלח אל… (Send to…)" menu (10 tests: 5 Monitor + 5 Text Actions)
// ===========================================================================

suite.test('T1-F25-01', 'F25', 'Monitor #ctx shows Send to submenu when sendToApps are configured', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [
        { id: 'obsidian', name: 'Obsidian' },
        { id: 'whatsapp', name: 'WhatsApp' },
        { id: 'telegram', name: 'Telegram' },
      ];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'st-1', time: Date.now(), kind: 'text', text: 'Send me', app: 'Notes' });
    });
    await openContentContextMenu(page);
    const hasSub = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].some((el) =>
        /send to|שלח אל/i.test(el.textContent || '')
      )
    );
    assert.equal(hasSub, true, 'Expected Send to… submenu entry in #ctx');
  });
});

suite.test('T1-F25-02', 'F25', 'Monitor Send to submenu lists configured apps and navigates via CM.menuKeys', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [
        { id: 'obsidian', name: 'Obsidian' },
        { id: 'whatsapp', name: 'WhatsApp' },
      ];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'st-2', time: Date.now(), kind: 'text', text: 'Nav me', app: 'Notes' });
    });
    await openContentContextMenu(page);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].find((el) =>
        /send to|שלח אל/i.test(el.textContent || '')
      );
      item?.focus();
    });
    await page.pressKey('ArrowRight');
    await page.waitForSelector('#ctx .ctx-sub [role="menuitem"]', { visible: true });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx .ctx-sub [role="menuitem"]')].map((el) => el.textContent.trim())
    );
    assert.ok(labels.includes('Obsidian'));
    assert.ok(labels.includes('WhatsApp'));

    await page.pressKey('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    assert.equal(focused, 'WhatsApp');
  });
});

suite.test('T1-F25-03', 'F25', 'Selecting an app in Monitor Send to submenu posts { cmd: "sendTo", app, text }', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [{ id: 'obsidian', name: 'Obsidian' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'st-3', time: Date.now(), kind: 'text', text: 'Note for Obsidian', app: 'Notes' });
    });
    await openContentContextMenu(page);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].find((el) =>
        /send to|שלח אל/i.test(el.textContent || '')
      );
      item?.click();
    });
    await page.waitForSelector('#ctx .ctx-sub [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.click('#ctx .ctx-sub [role="menuitem"]');

    const sent = await getSent(page);
    const msg = sent.find((m) => m.cmd === 'sendTo');
    assert.ok(msg, 'Expected { cmd: "sendTo" } message');
    assert.equal(msg.app, 'obsidian');
    assert.equal(msg.text, 'Note for Obsidian');
  });
});

suite.test('T1-F25-04', 'F25', 'Monitor Hebrew UI labels Send to submenu as שלח אל… with 0 missing I18N keys', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [{ id: 'whatsapp', name: 'WhatsApp' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.MOCK.lang('he');
    });
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);

    await openContentContextMenu(page);
    const heSub = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].some((el) =>
        el.textContent.includes('שלח אל')
      )
    );
    assert.equal(heSub, true);
  });
});

suite.test('T1-F25-05', 'F25', 'Monitor context menu supports keyboard selection of Send to app via Enter', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [{ id: 'telegram', name: 'Telegram' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'st-5', time: Date.now(), kind: 'text', text: 'Telegram payload', app: 'Notes' });
    });
    await openContentContextMenu(page);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].find((el) =>
        /send to|שלח אל/i.test(el.textContent || '')
      );
      item?.focus();
    });
    await page.pressKey('ArrowRight');
    await page.waitForSelector('#ctx .ctx-sub [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.pressKey('Enter');
    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'sendTo' && m.app === 'telegram' && m.text === 'Telegram payload'));
  });
});

suite.test('T1-F25-06', 'F25', 'Text Actions result and quickTranslate views show Send to trigger when sendToApps is provided', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Result text', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const onResult = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(onResult, true);

    await page.evaluate(() => {
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Hello',
        text: 'שלום',
        target: 'he',
        canReplace: true,
      });
    });
    const onQt = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(onQt, true);
  });
});

suite.test('T1-F25-07', 'F25', 'Clicking Send to trigger in Text Actions opens menu with one menuitem per sendToApps entry', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
          { id: 'bear', name: 'Bear' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Text for menu', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((el) => el.textContent.trim())
    );
    assert.deepEqual(names, ['Obsidian', 'WhatsApp', 'Bear']);
  });
});

suite.test('T1-F25-08', 'F25', 'Clicking an app in Text Actions Send to menu posts { cmd: "sendTo", app, text } and closes menu', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'drafts', name: 'Drafts' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Draft body', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.click('[role="menu"] [role="menuitem"]');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'sendTo' && m.app === 'drafts' && m.text === 'Draft body'));
    const closed = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
    assert.equal(closed, true);
  });
});

suite.test('T1-F25-09', 'F25', 'When sendToApps is empty or omitted in Text Actions, Send to trigger is hidden', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, sendToApps: [] });
      window.actions.show({ status: 'result', id: 'improve', text: 'No apps', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const visibleTrig = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(visibleTrig, false);
  });
});

suite.test('T1-F25-10', 'F25', 'Text Actions Hebrew UI displays שלח אל… for Send to with 0 missing I18N keys', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'he',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'תוכן בעברית', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);
    const hasHe = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /שלח אל/.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(hasHe, true);
  });
});

await suite.run();
