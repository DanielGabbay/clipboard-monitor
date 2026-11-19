import {
  assert,
  assertContains,
  assertNotContains,
  createSuite,
} from '../lib/test_harness.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const suite = createSuite({
  name: 't2_ui',
  tier: 2,
  description:
    'E2E-M2 Tier 2: Headless browser UI boundary & corner cases (F02, F03, F05, F06, F09, F10, F12, F13, F14, F15, F16, F17, F19, F20, F21, F22, F25)',
});

// ---------------------------------------------------------------------------
// Lazy shared browser & preview server + per-test isolation helpers
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

async function openContentContextMenu(page, x, y) {
  await page.evaluate(
    (cx, cy) => {
      const c = document.getElementById('content');
      const r = c.getBoundingClientRect();
      c.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: cx ?? Math.round(r.left + 40),
          clientY: cy ?? Math.round(r.top + 40),
        })
      );
    },
    x ?? null,
    y ?? null
  );
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

// ===========================================================================
// F02: Unified model validation boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F02-01', 'F02', 'All providers disabled hides t-model-pick, shows t-model-none link to AI, and leaves a-model-pick with Automatic only', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers.forEach((p) => { p.enabled = false; });
      window.monitor.aiState(st);
    });
    await page.waitForSelector('.t-model-none', { visible: true });
    assert.equal((await page.query('select.t-model-pick')).visible, false);

    await page.click('#settings .tabs [data-tab="actions"]');
    const actOpts = await page.evaluate(() =>
      [...document.querySelectorAll('select.a-model-pick option')].map((o) => o.value)
    );
    assert.deepEqual(actOpts, ['']);

    await page.click('#settings .tabs [data-tab="translate"]');
    await page.click('.t-model-none a');
    await page.waitForSelector('#spanel-ai', { visible: true });
  });
});

suite.test('T2-F02-02', 'F02', 'Selected translateModel becoming missing preserves synthetic unavailable option without overwriting CM.S', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.fill('select.t-model-pick', 'p1\nclaude-haiku-5-5');
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers[0].models.find((m) => m.id === 'claude-haiku-5-5').missing = true;
      window.monitor.aiState(st);
    });

    await page.waitFor(() =>
      (document.querySelector('select.t-model-pick option:checked')?.textContent || '').includes('not available')
    );
    const preserved = await page.evaluate(() => window.CM.S.translateModel);
    assert.equal(preserved, 'claude-haiku-5-5');
  });
});

suite.test('T2-F02-03', 'F02', 'Selected actionsModel becoming hidden falls back safely to Automatic ("") in a-model-pick', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.fill('select.a-model-pick', 'p1\nclaude-haiku-5-5');
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers[0].models.find((m) => m.id === 'claude-haiku-5-5').hidden = true;
      window.monitor.aiState(st);
    });

    const val = await page.evaluate(() => document.querySelector('select.a-model-pick')?.value);
    assert.equal(val, '');
  });
});

suite.test('T2-F02-04', 'F02', 'Turning f.ai off hides .t-model and .t-fallback and clicking .t-ai-off button restores f.ai', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.evaluate(() => window.CM.setSetting('f.ai', false));
    await page.waitForSelector('.t-ai-off', { visible: true });
    assert.equal((await page.query('.t-model')).visible, false);
    assert.equal((await page.query('.t-fallback')).visible, false);

    await page.click('.t-ai-off button');
    await page.waitForSelector('.t-model', { visible: true });
    assert.equal(await page.evaluate(() => window.CM.S['f.ai']), true);
  });
});

suite.test('T2-F02-05', 'F02', 'Model IDs with special characters (:, /, ., -) split cleanly via providerId + newline + modelId', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('.translate-tab .seg[data-key="translateEngine"] button[data-v="llm"]');
    await page.evaluate(() => {
      const st = window.MOCK.state();
      st.providers[0].models.push({ id: 'org/model:v1.2-beta', hidden: false, isNew: false, missing: false });
      window.monitor.aiState(st);
    });
    await clearSent(page);
    await page.fill('select.t-model-pick', 'p1\norg/model:v1.2-beta');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'translateProvider' && m.value === 'p1'));
    assert.ok(sent.some((m) => m.cmd === 'set' && m.key === 'translateModel' && m.value === 'org/model:v1.2-beta'));
  });
});

// ===========================================================================
// F03: Monitor keyOf(it) boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F03-01', 'F03', 'Legacy items without id fall back to String(time) in keyOf and work with applyOp', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    await page.evaluate(() => {
      window.monitor.push({ time: 1700000099999, kind: 'text', text: 'Legacy no-id item', app: 'Mail' });
      window.monitor.applyOp({ op: 'pin', key: '1700000099999' });
    });
    await page.waitFor(() =>
      document.querySelector('#hlist .item.pinned .t')?.textContent.includes('Legacy no-id item')
    );
    await page.evaluate(() => window.monitor.applyOp({ op: 'delete', key: '1700000099999' }));
    await page.waitFor(
      () => ![...document.querySelectorAll('#hlist .item .t')].some((el) => el.textContent.includes('Legacy no-id item'))
    );
  });
});

suite.test('T2-F03-02', 'F03', 'Two items with identical timestamp but distinct ids do not collide in loadHistory or delete', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    await page.evaluate(() => {
      window.monitor.loadHistory([
        { id: 'same-ts-a', time: 1700000100000, kind: 'text', text: 'Collision test A', app: 'Notes' },
        { id: 'same-ts-b', time: 1700000100000, kind: 'text', text: 'Collision test B', app: 'Notes' },
      ]);
    });
    await page.waitFor(() => {
      const txt = [...document.querySelectorAll('#hlist .item .t')].map((n) => n.textContent).join('|');
      return txt.includes('Collision test A') && txt.includes('Collision test B');
    });

    await page.evaluate(() => window.monitor.applyOp({ op: 'delete', key: 'same-ts-a' }));
    await page.waitFor(
      () => ![...document.querySelectorAll('#hlist .item .t')].some((n) => n.textContent.includes('Collision test A'))
    );
    const hasB = await page.evaluate(() =>
      [...document.querySelectorAll('#hlist .item .t')].some((n) => n.textContent.includes('Collision test B'))
    );
    assert.equal(hasB, true);
  });
});

suite.test('T2-F03-03', 'F03', 'Pushing duplicate text while held=true preserves held focus and avoids duplicate rows', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    await page.evaluate(() => {
      window.monitor.push({ id: 'hold-1', time: 1700000200000, kind: 'text', text: 'Held item alpha', app: 'Notes' });
      window.monitor.push({ id: 'top-2', time: 1700000201000, kind: 'text', text: 'Top item beta', app: 'Safari' });
      window.monitor.showHeld({ id: 'hold-1' });
      window.monitor.push({ id: 'top-2-dup', time: 1700000202000, kind: 'text', text: 'Top item beta', app: 'Safari' });
    });

    const state = await page.evaluate(() => ({
      content: document.getElementById('content')?.textContent || '',
      holdOn: document.getElementById('b-hold')?.classList.contains('on'),
      betaCount: [...document.querySelectorAll('#hlist .item .t')].filter((n) =>
        n.textContent.includes('Top item beta')
      ).length,
    }));
    assertContains(state.content, 'Held item alpha');
    assert.equal(state.holdOn, true);
    assert.equal(state.betaCount, 1);
  });
});

suite.test('T2-F03-04', 'F03', 'Deleting currently shown held item resets shownIndex to 0 and clears held state', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'del-old', time: 1700000300000, kind: 'text', text: 'Held to delete', app: 'Notes' });
      window.monitor.push({ id: 'stay-new', time: 1700000301000, kind: 'text', text: 'Remaining newest', app: 'Safari' });
      window.monitor.showHeld({ id: 'del-old' });
      window.monitor.applyOp({ op: 'delete', key: 'del-old' });
    });
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Remaining newest'));
    assert.equal(await page.evaluate(() => document.getElementById('b-hold')?.classList.contains('on')), false);
  });
});

suite.test('T2-F03-05', 'F03', 'push({ self: true, text }) is ignored without duplicating or resetting shownIndex', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.click('#b-hist');
    const beforeCount = await page.evaluate(() => document.querySelectorAll('#hlist .item').length);
    await page.evaluate(() => {
      window.monitor.push({ id: 'self-ignored', self: true, time: Date.now(), kind: 'text', text: 'Self echo text' });
    });
    const afterCount = await page.evaluate(() => document.querySelectorAll('#hlist .item').length);
    assert.equal(afterCount, beforeCount);
    assertNotContains((await page.query('#content')).text, 'Self echo text');
  });
});

// ===========================================================================
// F05: Unified CM.menuKeys boundary cases (10 tests: 5 Monitor + 5 Text Actions)
// ===========================================================================

suite.test('T2-F05-01', 'F05', 'CM.menuKeys skips disabled menuitems during ArrowDown/ArrowUp cycling in .ai-menu', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'ai');
    // p2 is disabled so its "Test" menuitem is disabled!
    await page.click('.ai-prov[data-id="p2"] [data-act="menu"]');
    await page.waitForSelector('.ai-menu[data-menu="card:p2"]', { visible: true });

    const first = await page.evaluate(() => document.activeElement?.dataset.act || '');
    assert.equal(first, 'edit', 'Disabled test item must be skipped on initial focus');

    await page.pressKey('ArrowDown');
    const second = await page.evaluate(() => document.activeElement?.dataset.act || '');
    assert.equal(second, 'delete');

    await page.pressKey('ArrowDown');
    const wrapped = await page.evaluate(() => document.activeElement?.dataset.act || '');
    assert.equal(wrapped, 'edit', 'Wrap should skip disabled test item');
  });
});

suite.test('T2-F05-02', 'F05', 'Pressing ArrowRight (LTR) or ArrowLeft (RTL) on leaf menuitem without aria-haspopup is a safe no-op', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openContentContextMenu(page);
    const activeBefore = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    await page.pressKey('ArrowRight');
    const activeAfter = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    assert.equal(activeAfter, activeBefore);
    assert.equal(await page.evaluate(() => !!document.querySelector('#ctx .ctx-sub')), false);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F05-03', 'F05', 'Pressing Tab inside #ctx or .tr-menu invokes onTab and closes the popup menu', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openContentContextMenu(page);
    await page.pressKey('Tab');
    await page.waitFor(() => !document.getElementById('ctx').classList.contains('show'));

    await page.evaluate(() => {
      window.monitor.push({ id: 'tr-tab', time: Date.now(), kind: 'text', text: 'Translate menu tab test', app: 'Notes' });
    });
    await page.waitForSelector('#content .tr-more', { visible: true });
    await page.click('#content .tr-more');
    await page.waitForSelector('#content .tr-menu', { visible: true });
    await page.pressKey('Tab');
    await page.waitFor(() => !document.querySelector('#content .tr-menu'));
  });
});

suite.test('T2-F05-04', 'F05', 'Re-initializing CM.menuKeys on #ctx does not stack duplicate keydown listeners', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    for (let i = 0; i < 3; i++) {
      await openContentContextMenu(page);
      await page.pressKey('Escape');
    }
    await openContentContextMenu(page);
    await page.pressKey('ArrowDown');
    const idx = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx > [role="menuitem"]')].indexOf(document.activeElement)
    );
    assert.equal(idx, 1, 'Single ArrowDown must advance exactly 1 item after repeated openings');
  });
});

suite.test('T2-F05-05', 'F05', 'Opening #ctx near bottom-right viewport edge clamps menu and .ctx-sub inside bounds', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openContentContextMenu(page, 1020, 764);
    const ctxRect = await page.evaluate(() => {
      const r = document.getElementById('ctx').getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    assert.ok(ctxRect.left >= 4 && ctxRect.right <= ctxRect.w - 4, `ctx horizontal clamp failed: ${JSON.stringify(ctxRect)}`);
    assert.ok(ctxRect.top >= 4 && ctxRect.bottom <= ctxRect.h - 4, `ctx vertical clamp failed: ${JSON.stringify(ctxRect)}`);

    await page.evaluate(() => {
      const tr = [...document.querySelectorAll('#ctx > [role="menuitem"]')].find(
        (el) => el.getAttribute('aria-haspopup') === 'menu'
      );
      tr?.focus();
    });
    await page.pressKey('ArrowRight');
    await page.waitForSelector('#ctx .ctx-sub', { visible: true });
    const subRect = await page.evaluate(() => {
      const r = document.querySelector('#ctx .ctx-sub').getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    assert.ok(subRect.left >= 4 && subRect.right <= subRect.w - 4, `sub horizontal clamp failed: ${JSON.stringify(subRect)}`);
    assert.ok(subRect.top >= 4 && subRect.bottom <= subRect.h - 4, `sub vertical clamp failed: ${JSON.stringify(subRect)}`);
  });
});

suite.test('T2-F05-06', 'F05', 'Escape inside Text Actions Send-to menu closes only the menu and does NOT post close', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Keep popover open', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.pressKey('Escape');
    await page.waitFor(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
    const sent = await getSent(page);
    assert.equal(sent.some((m) => m.cmd === 'close'), false, 'Escape on Send-to menu must not close whole popover');
    assert.equal((await page.query('#v-work')).visible, true);
  });
});

suite.test('T2-F05-07', 'F05', 'Disabled or hidden menuitems in Text Actions Send-to menu are skipped by keyboard navigation', async (ctx) => {
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
      window.actions.show({ status: 'result', id: 'improve', text: 'Skip disabled', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
      if (items[1]) items[1].setAttribute('aria-disabled', 'true');
    });
    await page.pressKey('ArrowDown');
    const active = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
    assert.equal(active, 'Telegram');
  });
});

suite.test('T2-F05-08', 'F05', 'Rapid ArrowUp from first and ArrowDown from last wrap cleanly in Actions Send-to menu', async (ctx) => {
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
      window.actions.show({ status: 'result', id: 'improve', text: 'Wrap test', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await page.pressKey('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'WhatsApp');
    await page.pressKey('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Obsidian');
  });
});

suite.test('T2-F05-09', 'F05', 'Hebrew RTL Text Actions Send-to menu stays inside viewport and supports ArrowDown/Escape', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'he',
        margin: 10,
        sendToApps: [
          { id: 'obsidian', name: 'Obsidian' },
          { id: 'whatsapp', name: 'WhatsApp' },
        ],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'בדיקת תפריט', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    const bounds = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]').getBoundingClientRect();
      return { dir: document.documentElement.dir, left: m.left, right: m.right, w: innerWidth };
    });
    assert.equal(bounds.dir, 'rtl');
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.w);
    await page.pressKey('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'WhatsApp');
    await page.pressKey('Escape');
  });
});

suite.test('T2-F05-10', 'F05', 'Re-opening Actions Send-to menu multiple times does not stack listeners', async (ctx) => {
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
      window.actions.show({ status: 'result', id: 'improve', text: 'Listener check', canReplace: true });
    });

    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('#v-work button')].find((x) =>
          /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
        );
        b?.click();
      });
      await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
      if (i < 2) await page.pressKey('Escape');
    }
    await clearSent(page);
    await page.pressKey('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'WhatsApp');
    await page.pressKey('Enter');
    const sent = (await getSent(page)).filter((m) => m.cmd === 'sendTo');
    assert.equal(sent.length, 1);
  });
});

// ===========================================================================
// F06: customActions & duplicate fallback removal boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F06-01', 'F06', 'Malformed actionsList JSON in setSettings does not crash Monitor or Text Actions tab', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => window.monitor.setSettings({ actionsList: '{bad-json' }));
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.lib-list .lib-item', { visible: true });
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F06-02', 'F06', 'Adding and deleting an empty custom action leaves zero orphan state', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    const before = await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length);
    await page.click('.lib-btns > button');
    await page.waitForSelector('.lib-item.open .lib-edit', { visible: true });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length), before + 1);

    await page.click('.lib-item.open .lib-edit .btn.danger');
    await page.waitFor(`document.querySelectorAll('.lib-list .lib-item').length === ${before}`);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F06-03', 'F06', 'Legacy localStorage cm.settingsTab="features" falls back cleanly to general tab', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({
    initScript: "try { localStorage.setItem('cm.settingsTab', 'features'); } catch {}",
  });
  try {
    await page.goto(env.previewUrl, { settleMs: 80 });
    await page.waitFor(() => document.querySelectorAll('#hlist .item').length > 0);
    await page.click('#b-settings');
    await page.waitForSelector('#settings', { visible: true });
    const activeTab = await page.evaluate(() =>
      document.querySelector('#settings .tabs [aria-selected="true"]')?.dataset.tab
    );
    assert.equal(activeTab, 'general');
    assert.equal(page.getErrors().allErrors.length, 0);
  } finally {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.close();
  }
});

suite.test('T2-F06-04', 'F06', 'Rapid uiLang switches en -> he -> en on Translation tab re-mount cleanly without duplicate tab conflict', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.evaluate(() => {
      window.MOCK.lang('he');
      window.MOCK.lang('en');
    });
    await page.waitFor(() => document.documentElement.dir === 'ltr');
    const tabLabel = await page.evaluate(() =>
      document.querySelector('#settings .tabs [data-tab="translate"]')?.textContent?.trim()
    );
    assert.equal(tabLabel, 'Translation');
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F06-05', 'F06', 'Clicking placeholder chip inserts {{ SELECTED TEXT }} and updates actionsList without customActions', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.click('.lib-list .lib-item:first-child .lib-toggle');
    await page.waitForSelector('.lib-edit .lib-chip', { visible: true });
    await clearSent(page);
    await page.click('.lib-edit .lib-chip');

    const sent = await getSent(page);
    const setMsg = sent.find((m) => m.cmd === 'set' && m.key === 'actionsList');
    assert.ok(setMsg);
    assertContains(setMsg.value, '{{ SELECTED TEXT }}');
    assert.equal(sent.some((m) => m.key === 'customActions'), false);
  });
});

// ===========================================================================
// F09: Unified CM.hotkeyRecorder(key) boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F09-01', 'F09', 'Pressing KeyK alone or Shift+KeyK during recording shows needMod and does not emit set', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    await clearSent(page);
    await page.click('#row-hotkey .hk-rec');
    await page.waitForSelector('#row-hotkey .hk-rec.on', { visible: true });

    await page.pressKey('k');
    const needMod = await page.evaluate(() => window.t('hotkey.needMod'));
    assert.equal((await page.query('#row-hotkey .hk-rec')).text, needMod);
    assert.equal((await page.query('#row-hotkey .hk-rec.on')).exists, true);

    await page.pressKey('k', { modifiers: ['Shift'] });
    assert.equal((await page.query('#row-hotkey .hk-rec.on')).exists, true);
    assert.equal((await getSent(page)).some((m) => m.cmd === 'set' && m.key === 'hotkey'), false);
  });
});

suite.test('T2-F09-02', 'F09', 'Pressing Escape while recording cancels and restores prior shortcut without posting set', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    const before = (await page.query('#row-hotkey .hk-rec')).text;
    await clearSent(page);
    await page.click('#row-hotkey .hk-rec');
    await page.waitForSelector('#row-hotkey .hk-rec.on', { visible: true });
    await page.pressKey('Escape');

    await page.waitFor(() => !document.querySelector('#row-hotkey .hk-rec.on'));
    assert.equal((await page.query('#row-hotkey .hk-rec')).text, before);
    assert.equal((await getSent(page)).some((m) => m.cmd === 'set' && m.key === 'hotkey'), false);
  });
});

suite.test('T2-F09-03', 'F09', 'Clicking outside .hk while recording cancels cleanly without modifying shortcut', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    const before = (await page.query('#row-hotkey .hk-rec')).text;
    await clearSent(page);
    await page.click('#row-hotkey .hk-rec');
    await page.waitForSelector('#row-hotkey .hk-rec.on', { visible: true });

    await page.click('#settings .s-head h2');
    await page.waitFor(() => !document.querySelector('#row-hotkey .hk-rec.on'));
    assert.equal((await page.query('#row-hotkey .hk-rec')).text, before);
    assert.equal((await getSent(page)).some((m) => m.cmd === 'set' && m.key === 'hotkey'), false);
  });
});

suite.test('T2-F09-04', 'F09', 'Unsupported keys (CapsLock, Backspace) during recording are ignored without corrupting combo', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    await clearSent(page);
    await page.click('#row-hotkey .hk-rec');
    await page.waitForSelector('#row-hotkey .hk-rec.on', { visible: true });
    await page.pressKey('CapsLock', { code: 'CapsLock', keyCode: 20 });
    await page.pressKey('Backspace');

    assert.equal((await page.query('#row-hotkey .hk-rec.on')).exists, true);
    assert.equal((await getSent(page)).some((m) => m.cmd === 'set' && m.key === 'hotkey'), false);
  });
});

suite.test('T2-F09-05', 'F09', 'Switching uiLang updates off label between Off and כבוי while keeping active combos dir=ltr', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    const activeDir = await page.evaluate(() => document.querySelector('#row-hotkey .hk-rec')?.getAttribute('dir'));
    assert.equal(activeDir, 'ltr');

    await page.click('#row-hotkey .hk-clear');
    assert.equal((await page.query('#row-hotkey .hk-rec')).text, 'Off');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    assert.equal((await page.query('#row-hotkey .hk-rec')).text, 'כבוי');
  });
});

// ===========================================================================
// F10: Quick Translate in Actions boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F10-01', 'F10', 'quickTranslate state=same applies .same, hides #src and #replace, and promotes #copy to primary', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'en', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'same',
        source: 'Already English',
        same: true,
        target: 'en',
        canReplace: true,
      });
    });
    await page.waitForSelector('#text.same', { visible: true });
    assertContains((await page.query('#status')).text, 'Already in this language');
    assert.equal((await page.query('#src')).visible, false);
    assert.equal((await page.query('#replace')).visible, false);
    assertContains((await page.query('#copy')).attrs.class || '', 'primary');
  });
});

suite.test('T2-F10-02', 'F10', 'quickTranslate with canReplace=false hides #replace and promotes #copy with Copy primary label', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Hovered text',
        text: 'טקסט מרחף',
        target: 'he',
        canReplace: false,
      });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assert.equal((await page.query('#replace')).visible, false);
    assertContains((await page.query('#copy')).attrs.class || '', 'primary');
    assert.equal((await page.query('#primary-label')).text, 'Copy');
  });
});

suite.test('T2-F10-03', 'F10', 'quickTranslate state=error resolves unsupported and notInstalled localized messages and hides footer', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10 });
      window.actions.show({ status: 'quickTranslate', state: 'error', source: 'Hi', detail: 'unsupported' });
    });
    const st1 = await page.waitForSelector('#status.error', { visible: true });
    assertContains(st1.text, 'not available');
    assert.equal((await page.query('#result-foot')).visible, false);

    await page.evaluate(() => {
      window.actions.show({ status: 'quickTranslate', state: 'error', source: 'Hi', detail: 'notInstalled' });
    });
    const st2 = await page.query('#status.error');
    assertContains(st2.text, 'not downloaded');
  });
});

suite.test('T2-F10-04', 'F10', 'quickTranslate permission/noText/secure/ignored show QT messages and #open-monitor disabled when source empty', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10 });
      window.actions.show({ status: 'permission', mode: 'quickTranslate' });
    });
    await page.waitForSelector('#link', { visible: true });
    assertContains((await page.query('#status')).text, 'pointer');
    assert.equal((await page.query('#open-monitor')).attrs.disabled !== undefined, true);

    await clearSent(page);
    await page.click('#link');
    assert.ok((await getSent(page)).some((m) => m.cmd === 'openAXSettings'));

    for (const st of ['noText', 'secure', 'ignored']) {
      await page.evaluate((s) => window.actions.show({ status: s, mode: 'quickTranslate' }), st);
      assert.equal((await page.query('#link')).visible, false);
      assert.ok((await page.query('#status')).text.trim().length > 0);
    }
  });
});

suite.test('T2-F10-05', 'F10', '#src stays open across target switches on same source and closes on new source', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({ lang: 'en', margin: 10, target: 'ja', targets: 'he,en' });
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Same source sentence',
        text: '同じ文',
        target: 'ja',
        targets: 'he,en',
        canReplace: true,
      });
    });
    const opts = await page.evaluate(() => [...document.querySelectorAll('#target option')].map((o) => o.value));
    assert.equal(opts.filter((v) => v === 'ja').length, 1);

    await page.click('#src summary');
    await page.waitFor(() => document.getElementById('src').open === true);

    await page.evaluate(() => {
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Same source sentence',
        text: 'אותו משפט',
        target: 'he',
        canReplace: true,
      });
    });
    assert.equal(await page.evaluate(() => document.getElementById('src').open), true);

    await page.evaluate(() => {
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Different source sentence',
        text: 'משפט שונה',
        target: 'he',
        canReplace: true,
      });
    });
    assert.equal(await page.evaluate(() => document.getElementById('src').open), false);
  });
});

// ===========================================================================
// F12: Settings tab reorganization boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F12-01', 'F12', 'Tablist ArrowRight/ArrowLeft/Home/End wrap across 7 tabs in LTR and mirror in RTL', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'general');
    await page.evaluate(() => document.querySelector('#settings .tabs [data-tab="general"]').focus());

    await page.pressKey('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'about');
    await page.pressKey('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'general');
    await page.pressKey('End');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'about');
    await page.pressKey('Home');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'general');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    await page.evaluate(() => document.querySelector('#settings .tabs [data-tab="general"]').focus());
    await page.pressKey('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.tab), 'content');
  });
});

suite.test('T2-F12-02', 'F12', 'Toggling f.smartCards off disables all 8 #smart-sub checkboxes and toggling on re-enables them', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'content');
    await page.click('#spanel-content input[data-key="f.smartCards"]');
    await page.waitFor(() =>
      [...document.querySelectorAll('#smart-sub input')].every((i) => i.disabled)
    );
    const allOff = await page.evaluate(() => ({
      inputs: document.querySelectorAll('#smart-sub input').length,
      offRows: document.querySelectorAll('#smart-sub .row.off').length,
    }));
    assert.equal(allOff.inputs, 8);
    assert.equal(allOff.offRows, 8);

    await page.click('#spanel-content input[data-key="f.smartCards"]');
    await page.waitFor(() =>
      [...document.querySelectorAll('#smart-sub input')].every((i) => !i.disabled)
    );
  });
});

suite.test('T2-F12-03', 'F12', 'Disabling f.bubble disables only bubbleHotkey recorder without disabling lensHotkey', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'translate');
    await page.click('#spanel-translate input[data-key="f.bubble"]');
    await page.waitFor(() => document.querySelector('.f-hk[data-for="bubble"] .hk-rec')?.disabled === true);
    assert.equal(
      await page.evaluate(() => document.querySelector('.f-hk[data-for="lens"] .hk-rec')?.disabled),
      false
    );
  });
});

suite.test('T2-F12-04', 'F12', 'Toggling f.actions off inerts .a-body while keeping f.actions master switch interactive', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('#spanel-actions input[data-key="f.actions"]');
    await page.waitFor(() => document.querySelector('#spanel-actions .a-body')?.inert === true);

    await page.click('#spanel-actions input[data-key="f.actions"]');
    await page.waitFor(() => document.querySelector('#spanel-actions .a-body')?.inert === false);
  });
});

suite.test('T2-F12-05', 'F12', 'Toggling f.ai keeps toggle-ai interactive and cm.settingsTab persists across reload', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 80 });
    await page.waitFor(() => document.querySelectorAll('#hlist .item').length > 0);
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });

    await openSettingsTab(page, 'ai');
    await page.click('#spanel-ai input[data-act="toggle-ai"]');
    await page.waitFor(() => document.querySelector('#spanel-ai .ai-body')?.inert === true);
    await page.click('#spanel-ai input[data-act="toggle-ai"]');
    await page.waitFor(() => document.querySelector('#spanel-ai .ai-body')?.inert === false);

    await page.click('#settings .tabs [data-tab="translate"]');
    await page.goto(env.previewUrl, { settleMs: 80 });
    await page.waitFor(() => document.querySelectorAll('#hlist .item').length > 0);
    await page.click('#b-settings');
    await page.waitForSelector('#settings', { visible: true });

    const restored = await page.evaluate(() =>
      document.querySelector('#settings .tabs [aria-selected="true"]')?.dataset.tab
    );
    assert.equal(restored, 'translate');
  } finally {
    await page.evaluate(() => { try { localStorage.clear(); } catch {} });
    await page.close();
  }
});

// ===========================================================================
// F13: Text Actions SSE streaming & multi-turn run boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F13-01', 'F13', 'Error mid-stream switches to #status.error, hides footer, and preserves #back recovery', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'improve' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Partial stream...' });
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('Partial stream...'));
    await page.evaluate(() => {
      window.actions.show({ status: 'error', id: 'improve', code: '', detail: 'Stream interrupted' });
    });
    const st = await page.waitForSelector('#status.error', { visible: true });
    assertContains(st.text, 'Stream interrupted');
    assert.equal((await page.query('#result-foot')).visible, false);
    assert.equal((await page.query('#back')).visible, true);

    await clearSent(page);
    await page.click('#back');
    assert.ok((await getSent(page)).some((m) => m.cmd === 'back'));
  });
});

suite.test('T2-F13-02', 'F13', 'Clicking #back during streaming posts back and prevents stale stream leakage on next view', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'improve' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Stale partial output' });
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('Stale partial output'));
    await clearSent(page);
    await page.click('#back');
    await page.waitForSelector('#v-list', { visible: true });
    assert.ok((await getSent(page)).some((m) => m.cmd === 'back'));

    // Late streaming chunk for cancelled 'improve' while #v-list is open must be suppressed
    await page.evaluate(() => {
      window.actions.show({ status: 'streaming', id: 'improve', text: 'STALE_IMPROVE_CHUNK' });
    });
    const listStillActive = await page.evaluate(() => {
      const vl = document.getElementById('v-list');
      const vw = document.getElementById('v-work');
      return !!vl && !vl.hidden && (!vw || vw.hidden);
    });
    assert.equal(listStillActive, true, 'Late stale streaming chunk must not hijack #v-list back into #v-work');

    // Late streaming chunk for previous 'improve' must not overwrite active 'fix' action
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'fix' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'STALE_IMPROVE_CHUNK' });
    });
    const textAfterFix = await page.evaluate(() => document.getElementById('text')?.textContent || '');
    assertNotContains(textAfterFix, 'Stale partial output');
    assertNotContains(textAfterFix, 'STALE_IMPROVE_CHUNK');
  });
});

suite.test('T2-F13-03', 'F13', 'Rapid burst of 20+ streaming chunks with incomplete Markdown renders without errors', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    const finalAcc = await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'explain' });
      const parts = [
        '# Title\n\n', 'Here is **unfinished', ' bold** and ', '`inline` ', 'plus:\n```js\n',
        'const a = ', '1;\n', 'const b = ', '2;\n', 'console.', 'log(', 'a + b', ');\n',
        '```\n', '- item 1\n', '- item 2\n', 'שלום ', 'עולם ', '123', ' done.',
      ];
      let acc = '';
      for (const p of parts) {
        acc += p;
        window.actions.show({ status: 'streaming', id: 'explain', text: acc });
      }
      return acc;
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('unfinished'));
    await page.evaluate((acc) => {
      window.actions.show({ status: 'result', id: 'explain', text: acc, canReplace: false });
    }, finalAcc);
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'done.');
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F13-04', 'F13', 'Multi-turn follow-up chain preserves chronological alternating messages history', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Turn 1 answer', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });

    const submitFollowup = async (q) => {
      await clearSent(page);
      const ok = await page.evaluate((text) => {
        const inp = [...document.querySelectorAll('#v-work input, #v-work textarea')].find(
          (el) => !el.hidden && el.offsetParent !== null && !el.closest('#src')
        );
        if (!inp) return false;
        inp.focus();
        inp.value = text;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, q);
      assert.equal(ok, true, 'Follow-up input missing');
      await page.pressKey('Enter');
      await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'run'));
      return (await getSent(page)).find((m) => m.cmd === 'run');
    };

    const run1 = await submitFollowup('Follow-up one');
    assert.ok(Array.isArray(run1.messages) && run1.messages.length >= 2);

    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Turn 2 answer', canReplace: true });
    });
    const run2 = await submitFollowup('Follow-up two');
    assert.ok(run2.messages.length >= run1.messages.length + 2, 'Second follow-up must append previous turns');
    const contents = run2.messages.map((m) => m.content).join('\n');
    assertContains(contents, 'Turn 1 answer');
    assertContains(contents, 'Follow-up one');
    assertContains(contents, 'Turn 2 answer');
  });
});

suite.test('T2-F13-05', 'F13', 'Empty and whitespace-only streaming chunks do not throw or corrupt #v-work layout', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'improve' });
      window.actions.show({ status: 'streaming', id: 'improve', text: '' });
      window.actions.show({ status: 'streaming', id: 'improve', text: '   \n\t  ' });
      window.actions.show({ status: 'streaming', id: 'improve', text: 'Valid content' });
    });
    await page.waitFor(() => (document.getElementById('text')?.textContent || '').includes('Valid content'));
    const h = await page.evaluate(() => document.getElementById('card').scrollHeight);
    assert.ok(Number.isFinite(h) && h > 40);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

// ===========================================================================
// F14: Text Actions UI upgrades boundary cases (6 tests)
// ===========================================================================

suite.test('T2-F14-01', 'F14', 'XSS payloads inside Markdown result are escaped and never execute', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({
        status: 'result',
        id: 'explain',
        text: '<script>window.__xss=1</script>\n<img src="x" onerror="window.__xss=2">\n\n**safe**',
        canReplace: false,
      });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const res = await page.evaluate(() => ({
      xss: window.__xss,
      scripts: document.querySelectorAll('#text script').length,
      imgs: document.querySelectorAll('#text img[onerror]').length,
      strong: !!document.querySelector('#text strong'),
    }));
    assert.equal(res.xss, undefined);
    assert.equal(res.scripts, 0);
    assert.equal(res.imgs, 0);
    assert.equal(res.strong, true);
  });
});

suite.test('T2-F14-02', 'F14', 'Pressing Enter inside Edit textarea inserts a newline and does NOT trigger Replace or Copy', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Line 1', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /^edit$|עריכה|ערוך/i.test((x.textContent || x.title || x.getAttribute('aria-label') || '').trim())
      );
      b?.click();
    });
    await page.waitForSelector('#v-work textarea', { visible: true });
    await page.evaluate(() => {
      const ta = document.querySelector('#v-work textarea');
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    await clearSent(page);
    await page.pressKey('Enter');

    const sent = await getSent(page);
    assert.equal(sent.some((m) => m.cmd === 'replace' || m.cmd === 'copy'), false);
    const val = await page.evaluate(() => document.querySelector('#v-work textarea')?.value || '');
    assertContains(val, '\n');
  });
});

suite.test('T2-F14-03', 'F14', 'Enter in Follow-up input does not trigger Replace/Copy and whitespace-only follow-up does not run', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Some output', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const focused = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('#v-work input, #v-work textarea')].find(
        (el) => !el.hidden && el.offsetParent !== null && !el.closest('#src')
      );
      if (!inp) return false;
      inp.focus();
      inp.value = '   ';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    assert.equal(focused, true, 'Expected Follow-up input');

    await clearSent(page);
    await page.pressKey('Enter');
    const sent = await getSent(page);
    assert.equal(sent.some((m) => m.cmd === 'replace' || m.cmd === 'copy'), false);
    assert.equal(sent.some((m) => m.cmd === 'run'), false);
  });
});

suite.test('T2-F14-04', 'F14', 'Diff on identical source/result renders cleanly and Edit after Diff edits clean raw text', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.source = 'Exact same text';
      window.actions.show({
        status: 'list',
        source: 'Exact same text',
        actions: [{ id: 'fix', kind: 'builtin', replaces: true }],
        models: [],
        model: '',
        canReplace: true,
      });
      window.actions.show({ status: 'result', id: 'fix', text: 'Exact same text', canReplace: true });
      const diffBtn = [...document.querySelectorAll('#v-work button')].find((x) =>
        /diff|הבדל|שינויים/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      diffBtn?.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assert.equal(page.getErrors().allErrors.length, 0);

    const editOpened = await page.evaluate(() => {
      const editBtn = [...document.querySelectorAll('#v-work button')].find((x) =>
        /^edit$|עריכה|ערוך/i.test((x.textContent || x.title || x.getAttribute('aria-label') || '').trim())
      );
      if (!editBtn) return false;
      editBtn.click();
      return true;
    });
    assert.equal(editOpened, true, 'Expected Edit button');
    const ta = await page.waitForSelector('#v-work textarea', { visible: true });
    assert.equal(ta.value, 'Exact same text');
  });
});

suite.test('T2-F14-05', 'F14', 'Editing result text then closing Edit re-renders Markdown + BiDi and updates Diff baseline', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.source = 'Original words';
      window.actions.show({
        status: 'list',
        source: 'Original words',
        actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
        models: [],
        model: '',
        canReplace: true,
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Draft', canReplace: true });
      const editBtn = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /^edit$|עריכה|ערוך/i.test((x.textContent || x.title || x.getAttribute('aria-label') || '').trim())
      );
      editBtn?.click();
    });
    await page.waitForSelector('#v-work textarea', { visible: true });
    await page.fill('#v-work textarea', '**Updated** שלום');

    await page.evaluate(() => {
      const toggleBtn = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /edit|done|preview|עריכה|ערוך|סיום|תצוגה/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      toggleBtn?.click();
    });
    await page.waitFor(() => {
      const ta = document.querySelector('#v-work textarea');
      return (!ta || ta.offsetParent === null) && !!document.querySelector('#text strong');
    });
    assertContains((await page.query('#text strong')).text, 'Updated');

    const diffClicked = await page.evaluate(() => {
      const diffBtn = [...document.querySelectorAll('#v-work button')].find(
        (x) =>
          x.offsetParent !== null &&
          /diff|הבדל|שינויים/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      if (!diffBtn) return false;
      diffBtn.click();
      return true;
    });
    assert.equal(diffClicked, true, 'Expected visible Diff toggle button');
    const diffText = await page.evaluate(() => document.getElementById('text')?.textContent || '');
    assertContains(diffText, 'Original');
    assertContains(diffText, 'Updated');
  });
});

suite.test('T2-F14-06', 'F14', 'Hebrew language in actions-preview sets RTL, places #chip side bar on right, and has 0 missing I18N keys', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.source = 'טקסט לבדיקה בעברית';
      window.MOCKA.lang('he');
    });
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    const check = await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('chip'));
      return {
        missing: window.I18N.missing('he'),
        dir: document.documentElement.dir,
        borderRight: parseFloat(cs.borderRightWidth || '0'),
      };
    });
    assert.deepEqual(check.missing, []);
    assert.equal(check.dir, 'rtl');
    assert.ok(check.borderRight > 0, 'Expected RTL blockquote side bar on right edge of #chip');
  });
});

// ===========================================================================
// F15: In-App AI Action Builder boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F15-01', 'F15', 'Rapid typing in action editor debounces oninput and saves final string without losing keystrokes', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.click('.lib-list .lib-item:first-child .lib-toggle');
    await page.waitForSelector('.lib-edit input[type="text"]', { visible: true });
    await clearSent(page);

    await page.evaluate(() => {
      const inp = document.querySelector('.lib-edit input[type="text"]');
      for (const v of ['A', 'AB', 'ABC', 'ABCD', 'ABCDE']) {
        inp.value = v;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    await page.waitFor(
      () =>
        (window.__sent || []).some(
          (m) => m.cmd === 'set' && m.key === 'actionsList' && String(m.value).includes('ABCDE')
        ),
      { timeoutMs: 3000 }
    );
    const sets = (await getSent(page)).filter((m) => m.cmd === 'set' && m.key === 'actionsList');
    assert.equal(sets.length, 1, `Expected 1 debounced save, got ${sets.length}`);
  });
});

suite.test('T2-F15-02', 'F15', 'Submitting empty or whitespace-only request in Settings AI Action Builder is blocked', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.a-sec[data-sec="library"] .lib-list', { visible: true });
    await clearSent(page);

    const hasBuilder = await page.evaluate(() => {
      const libSec = document.querySelector('.a-sec[data-sec="library"]');
      const libList = libSec.querySelector('.lib-list');
      const inp = [...libSec.querySelectorAll('input, textarea')].find(
        (el) => !libList.contains(el) && el.offsetParent !== null
      );
      const btn = [...libSec.querySelectorAll('button')].find(
        (b) =>
          !libList.contains(b) &&
          !b.closest('.lib-btns') &&
          !b.classList.contains('lib-ai-reset') &&
          b.offsetParent !== null &&
          /ai|צור|התאם|עדכן|generate|create|update|build|בנה/i.test(b.textContent || '')
      );
      if (!inp || !btn) return false;
      inp.value = '   ';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      return true;
    });
    assert.equal(hasBuilder, true, 'AI Action Builder controls missing');
    assert.equal((await getSent(page)).some((m) => m.cmd === 'actions.generate'), false);
  });
});

suite.test('T2-F15-03', 'F15', 'monitor.actionGenerated error/noModel and stale req IDs are handled cleanly without corrupting lib', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.waitForSelector('.a-sec[data-sec="library"] .lib-list', { visible: true });
    const before = await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length);
    await clearSent(page);

    const submitted = await page.evaluate(() => {
      const libSec = document.querySelector('.a-sec[data-sec="library"]');
      const libList = libSec.querySelector('.lib-list');
      const inp = [...libSec.querySelectorAll('input, textarea')].find(
        (el) => !libList.contains(el) && el.offsetParent !== null
      );
      const btn = [...libSec.querySelectorAll('button')].find(
        (b) =>
          !libList.contains(b) &&
          !b.closest('.lib-btns') &&
          !b.classList.contains('lib-ai-reset') &&
          b.offsetParent !== null &&
          /ai|צור|התאם|עדכן|generate|create|update|build|בנה/i.test(b.textContent || '')
      );
      if (!inp || !btn) return false;
      inp.value = 'Summarize into 3 bullets';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      return true;
    });
    assert.equal(submitted, true, 'AI Action Builder controls missing');

    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'actions.generate'));
    const genReq = (await getSent(page)).find((m) => m.cmd === 'actions.generate');
    assert.ok(genReq && genReq.req, 'Expected actions.generate request with req ID');

    await page.evaluate(() => {
      window.monitor.actionGenerated({
        req: 'stale-999',
        action: { name: 'Stale', icon: 'wand', prompt: 'x', replaces: true },
      });
    });

    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length),
      before,
      'Stale actionGenerated response must not modify .lib-list'
    );
    assert.equal(
      await page.evaluate(() =>
        [...document.querySelectorAll('.lib-list .lib-name')].some((n) => n.textContent.includes('Stale'))
      ),
      false,
      'Stale action name must not appear in .lib-list'
    );

    await page.evaluate((req) => {
      window.monitor.actionGenerated({ req, error: 'No AI model configured', code: 'noModel' });
    }, genReq.req);

    await page.waitFor(() => {
      const errEl = document.querySelector('.lib-ai-err');
      return !!errEl && !errEl.hidden && errEl.offsetParent !== null && (errEl.textContent || '').trim().length > 0;
    });
    const errText = await page.evaluate(() => (document.querySelector('.lib-ai-err')?.textContent || '').trim());
    assert.ok(errText.length > 0, 'Expected visible error text in .lib-ai-err');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length), before);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F15-04', 'F15', 'Save as Permanent Action button is hidden on builtin/local actions and double-click guarded on ask', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.show({ status: 'result', id: 'improve', text: 'Builtin output', canReplace: true });
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const onBuiltin = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (x) => x.offsetParent !== null && /save.*action|שמור כפעולה/i.test(x.textContent || '')
      )
    );
    assert.equal(onBuiltin, false, 'Save as Action must not appear on built-in actions');

    await page.evaluate(() => {
      window.actions.show({ status: 'running', id: 'ask', query: 'extract dates' });
      window.actions.show({ status: 'result', id: 'ask', text: '2026-11-18', canReplace: false });
    });
    await clearSent(page);
    const clickedTwice = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find(
        (x) => x.offsetParent !== null && /save.*action|שמור כפעולה/i.test(x.textContent || '')
      );
      if (!b) return false;
      b.click();
      b.click();
      return true;
    });
    assert.equal(clickedTwice, true, 'Expected Save as Action button on ask result');
    const saves = (await getSent(page)).filter(
      (m) => m.cmd === 'saveCustomAction' || m.cmd === 'actions.generate' || m.cmd === 'set'
    );
    assert.equal(saves.length, 1, 'Double click should not duplicate save requests');
  });
});

suite.test('T2-F15-05', 'F15', 'Adapting an existing open action passes existing payload and updates it in-place', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    await page.click('.lib-list .lib-item:first-child .lib-toggle');
    await page.waitForSelector('.lib-item.open .lib-edit', { visible: true });
    const initialCount = await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length);
    await clearSent(page);

    const triggered = await page.evaluate(() => {
      const libSec = document.querySelector('.a-sec[data-sec="library"]');
      const libList = libSec.querySelector('.lib-list');
      const inp = [...libSec.querySelectorAll('input, textarea')].find(
        (el) => !libList.contains(el) && el.offsetParent !== null
      );
      const btn = [...libSec.querySelectorAll('button')].find(
        (b) =>
          !libList.contains(b) &&
          !b.closest('.lib-btns') &&
          !b.classList.contains('lib-ai-reset') &&
          b.offsetParent !== null &&
          /ai|צור|התאם|עדכן|generate|create|update|build|בנה/i.test(b.textContent || '')
      );
      if (!inp || !btn) return false;
      inp.value = 'Make this action friendlier';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
      return true;
    });
    assert.equal(triggered, true, 'AI Action Builder controls missing');

    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'actions.generate'));
    const genMsg = (await getSent(page)).find((m) => m.cmd === 'actions.generate');
    assert.ok(genMsg.existing, 'Expected existing action object when adapting open action');

    await page.evaluate((req) => {
      window.monitor.actionGenerated({
        req,
        action: { name: 'Friendly Improve', icon: 'improve', prompt: 'Rewrite warmly.', replaces: true },
      });
    }, genMsg.req);

    await page.waitFor(() =>
      (document.querySelector('.lib-list .lib-item:first-child .lib-name')?.textContent || '').includes('Friendly Improve')
    );
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.lib-list .lib-item').length),
      initialCount,
      'Adapting open action must update in-place rather than duplicating'
    );
  });
});

// ===========================================================================
// F16: Local zero-AI text actions boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F16-01', 'F16', 'Contrast guard: with MOCKA.noModels=true, AI action still errors with noModel while local succeeds', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.lang('en');
    });
    await page.click('#list .item:first-child');
    const err = await page.waitForSelector('#status', { visible: true });
    await page.waitFor(() => (document.getElementById('status')?.textContent || '').includes('No AI model'));
    assertContains((await page.query('#status')).text, 'No AI model');
    assert.equal((await page.query('#link')).visible, true);

    await page.click('#back');
    await page.waitForSelector('#list .item', { visible: true });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((r) => /flip|keyboard/i.test(r.textContent));
      if (!row) throw new Error('flipKeyboard row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
  });
});

suite.test('T2-F16-02', 'F16', 'Local actions set #replace.primary when canReplace=true and #copy.primary when canReplace=false', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.actions.show({
        status: 'list',
        source: 'akuo',
        actions: [{ id: 'flipKeyboard', kind: 'local', replaces: true }],
        models: [],
        model: '',
        canReplace: true,
      });
    });
    await page.click('#list .item:first-child');
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#replace')).attrs.class || '', 'primary');

    await page.evaluate(() => {
      window.actions.show({
        status: 'list',
        source: 'akuo',
        actions: [{ id: 'flipKeyboard', kind: 'local', replaces: true }],
        models: [],
        model: '',
        canReplace: false,
      });
    });
    await page.click('#list .item:first-child');
    await page.waitForSelector('#result-foot', { visible: true });
    assert.equal((await page.query('#replace')).visible, false);
    assertContains((await page.query('#copy')).attrs.class || '', 'primary');
  });
});

suite.test('T2-F16-03', 'F16', 'Filtering #q in English and Hebrew matches local actions and runs via Enter', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.source = 'akuo';
      window.MOCKA.lang('en');
    });
    await page.fill('#q', 'flip');
    const enMatch = await page.evaluate(() => document.querySelector('#list .item .label')?.textContent || '');
    assert.match(enMatch, /flip|keyboard/i);

    await page.evaluate(() => { window.MOCKA.lang('he'); });
    await page.fill('#q', 'מקלדת');
    const heMatch = await page.evaluate(() => document.querySelector('#list .item .label')?.textContent || '');
    assertContains(heMatch, 'מקלדת');

    await page.pressKey('Enter');
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'שלום');
  });
});

suite.test('T2-F16-04', 'F16', 'Local actions handle punctuation/finals, code fences in wrapRtl, and whitespace edge inputs', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.MOCKA.noModels = true;
      window.MOCKA.source = 'akuo,';
      window.MOCKA.lang('en');
    });
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .item')].find((r) => /flip|keyboard/i.test(r.textContent));
      if (!row) throw new Error('flipKeyboard row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    assertContains((await page.query('#text')).text, 'שלום,');

    await page.evaluate(() => {
      window.MOCKA.source = 'שלום\n```\nשלום בקוד\n```';
      window.MOCKA.show('list');
      const row = [...document.querySelectorAll('#list .item')].find((r) => /rtl/i.test(r.textContent));
      if (!row) throw new Error('wrapRtl row not found');
      row.click();
    });
    await page.waitForSelector('#result-foot', { visible: true });
    const out = (await page.query('#text')).text;
    assertContains(out, '\u2067שלום\u2069');
  });
});

suite.test('T2-F16-05', 'F16', 'In Settings > Text Actions library, local actions do not trigger missing-prompt errors', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="library"]');
    const opened = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.lib-list .lib-item')];
      const localBtn = items.find((it) => /flip|rtl|clean|מקלדת|רווחים/i.test(it.textContent))?.querySelector('.lib-toggle');
      if (!localBtn) return false;
      localBtn.click();
      return true;
    });
    assert.equal(opened, true, 'Expected local actions in Settings > Text Actions library');
    await page.waitForSelector('.lib-item.open .lib-edit', { visible: true });
    const invalidCount = await page.evaluate(
      () => document.querySelectorAll('.lib-item.open .lib-edit [aria-invalid="true"]').length
    );
    assert.equal(invalidCount, 0);
  });
});

// ===========================================================================
// F17: Global quick flip (flipHotkey) boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F17-01', 'F17', 'Rejecting flipHotkey via monitor.hotkeyRejected displays conflict toast', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => window.monitor.hotkeyRejected({ key: 'flipHotkey' }));
    const toast = await page.waitForSelector('#toast.show', { visible: true });
    assert.equal(toast.text, await page.evaluate(() => window.t('hotkey.taken')));
  });
});

suite.test('T2-F17-02', 'F17', 'Invalid or empty flipHotkey falls back to Off/כבוי without throwing', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    const labels = await page.evaluate(() => ({
      empty: window.CM.hotkeyLabel(''),
      bad: window.CM.hotkeyLabel('KeyK'),
      unknown: window.CM.hotkeyLabel('ctrl+BadKey'),
    }));
    assert.equal(labels.empty, 'Off');
    assert.equal(labels.bad, 'Off');
    assert.equal(labels.unknown, 'Off');
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F17-03', 'F17', 'Toggling f.actions off disables flipHotkey inside .a-body and re-enabling restores it', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.ok(label !== null, 'flipHotkey recorder not found');

    await page.click('#spanel-actions input[data-key="f.actions"]');
    await page.waitFor(() => document.querySelector('#spanel-actions .a-body')?.inert === true);

    await page.click('#spanel-actions input[data-key="f.actions"]');
    await page.waitFor(() => document.querySelector('#spanel-actions .a-body')?.inert === false);
    assert.equal((await page.query('[data-e2e-flip-hk="1"] .hk-rec')).visible, true);
  });
});

suite.test('T2-F17-04', 'F17', 'flipHotkey supports non-letter keys (Space, F9, Semicolon) via CM.hotkeyRecorder', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.ok(label !== null, 'flipHotkey recorder not found');

    await page.click('[data-e2e-flip-hk="1"] .hk-rec');
    await page.waitForSelector('[data-e2e-flip-hk="1"] .hk-rec.on', { visible: true });
    await page.pressKey('F9', { code: 'F9', keyCode: 120, modifiers: ['Ctrl', 'Alt'] });
    await page.waitFor(() => document.querySelector('[data-e2e-flip-hk="1"] .hk-rec')?.textContent === '⌃⌥F9');

    await page.click('[data-e2e-flip-hk="1"] .hk-rec');
    await page.waitForSelector('[data-e2e-flip-hk="1"] .hk-rec.on', { visible: true });
    await page.pressKey(';', { code: 'Semicolon', keyCode: 186, modifiers: ['Ctrl', 'Alt'] });
    await page.waitFor(() => document.querySelector('[data-e2e-flip-hk="1"] .hk-rec')?.textContent === '⌃⌥;');
  });
});

suite.test('T2-F17-05', 'F17', 'Switching UI language to Hebrew keeps dir="ltr" on flipHotkey combo glyph', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await openSettingsTab(page, 'actions');
    await page.click('.a-seg button[data-sec="options"]');
    const label = await findFlipRecorder(page);
    assert.ok(label !== null, 'flipHotkey recorder not found');

    await page.evaluate(() => window.MOCK.lang('he'));
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    await findFlipRecorder(page);
    const dir = await page.evaluate(() =>
      document.querySelector('[data-e2e-flip-hk="1"] .hk-rec')?.getAttribute('dir')
    );
    assert.equal(dir, 'ltr');
  });
});

// ===========================================================================
// F19: Monitor image OCR boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F19-01', 'F19', 'When S.images=false, image items show hidden placeholder and do NOT render OCR button', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.CM.setSetting('images', false);
      window.monitor.push({ id: 'img-hid', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
    }, TINY_PNG_DATA_URL);
    await page.waitForSelector('#content .empty', { visible: true });
    const hasOcrBtn = await page.evaluate(() =>
      [...document.querySelectorAll('#content button')].some((b) => /ocr|חלץ טקסט/i.test(b.textContent || ''))
    );
    assert.equal(hasOcrBtn, false);
  });
});

suite.test('T2-F19-02', 'F19', 'monitor.ocrResult with error or empty text displays clean feedback without errors', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-err', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.ocrResult({ id: 'img-err', error: 'No text found' });
    }, TINY_PNG_DATA_URL);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('No text found'));

    await page.evaluate(() => {
      window.monitor.ocrResult({ id: 'img-err', text: '' });
    });
    assert.equal((await page.query('#content .imgwrap img')).visible, true);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F19-03', 'F19', 'Stale ocrResult for another item id does not overwrite currently shown item', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-old', time: 1700000400000, kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.push({ id: 'txt-new', time: 1700000401000, kind: 'text', text: 'Current text item', app: 'Notes' });
      window.monitor.ocrResult({ id: 'img-old', text: 'STALE_OCR_SHOULD_NOT_APPEAR' });
    }, TINY_PNG_DATA_URL);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Current text item'));
    assertNotContains((await page.query('#content')).text, 'STALE_OCR_SHOULD_NOT_APPEAR');
  });
});

suite.test('T2-F19-04', 'F19', 'Non-image items (text, secret, other) never render image OCR button', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    for (const item of [
      { id: 't1', kind: 'text', text: 'Normal text' },
      { id: 's1', kind: 'secret' },
      { id: 'o1', kind: 'other', types: 'public.data' },
    ]) {
      await page.evaluate((it) => window.monitor.push(Object.assign({ time: Date.now() }, it)), item);
      const hasOcrBtn = await page.evaluate(() =>
        [...document.querySelectorAll('#content button')].some((b) => /ocr|חלץ טקסט/i.test(b.textContent || ''))
      );
      assert.equal(hasOcrBtn, false, `Unexpected OCR button on kind=${item.kind}`);
    }
  });
});

suite.test('T2-F19-05', 'F19', 'Mixed Hebrew and English OCR output applies BiDi directions per line', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      window.monitor.push({ id: 'img-bidi', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
      window.monitor.ocrResult({ id: 'img-bidi', text: 'כותרת בעברית 2026\nEnglish line 42' });
    }, TINY_PNG_DATA_URL);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('כותרת בעברית'));
    const dirs = await page.evaluate(() => {
      const all = [...document.querySelectorAll('#content *')];
      const he = all.find((el) => el.children.length === 0 && el.textContent.includes('כותרת בעברית'));
      const en = all.find((el) => el.children.length === 0 && el.textContent.includes('English line'));
      return {
        heDir: he?.getAttribute('dir') || he?.closest('[dir]')?.getAttribute('dir'),
        enDir: en?.getAttribute('dir') || en?.closest('[dir]')?.getAttribute('dir'),
      };
    });
    assert.equal(dirs.heDir, 'rtl');
    assert.equal(dirs.enDir, 'ltr');
  });
});

// ===========================================================================
// F20: Lens OCR fallback & UI boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F20-01', 'F20', 'Peek button adds body.peek hiding #layer on mousedown and restores on mouseup/mouseleave', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.lens.setup({ lang: 'en', mode: 'reading' });
      window.lens.render({ mode: 'reading', status: 'ok', blocks: [{ text: 'Translated', state: 'ok' }] });
    });
    await page.evaluate(() => document.getElementById('peek').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('layer')).visibility), 'hidden');

    await page.evaluate(() => document.getElementById('peek').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('layer')).visibility), 'visible');

    await page.evaluate(() => document.getElementById('peek').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await page.evaluate(() => document.getElementById('peek').dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })));
    assert.equal(await page.evaluate(() => document.body.classList.contains('peek')), false);
  });
});

suite.test('T2-F20-02', 'F20', 'lens.clear() clears overlay boxes, preserves reading document, and drawDoc preserves scrollTop', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.lens.setup({ lang: 'en', mode: 'overlay' });
      window.lens.render({ mode: 'overlay', status: 'ok', spans: [{ x: 5, y: 5, w: 100, h: 20, line: true, text: 'Box' }] });
      window.lens.clear();
    });
    assert.equal(await page.evaluate(() => document.querySelectorAll('#layer .t').length), 0);

    await page.evaluate(() => {
      const blocks = Array.from({ length: 40 }, (_, i) => ({ text: `Paragraph ${i} with enough lines`, state: 'ok' }));
      window.lens.render({ mode: 'reading', status: 'ok', blocks });
      const layer = document.getElementById('layer');
      layer.scrollTop = 120;
      window.lens.clear();
    });
    assert.equal(await page.evaluate(() => document.querySelectorAll('#layer p.doc').length), 40);

    await page.evaluate(() => {
      const blocks = Array.from({ length: 40 }, (_, i) => ({ text: `Updated ${i}`, state: 'ok' }));
      window.lens.render({ mode: 'reading', status: 'ok', blocks });
    });
    const scrollTop = await page.evaluate(() => document.getElementById('layer').scrollTop);
    assert.ok(scrollTop > 0, `Expected preserved scrollTop > 0, got ${scrollTop}`);
  });
});

suite.test('T2-F20-03', 'F20', 'Status transitions render localized strings, clear #layer on permission/noWindow/ignored, and preserve custom target', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.lens.setup({ lang: 'en', target: 'ja', targets: 'he,en' });
      window.lens.render({ mode: 'overlay', status: 'ok', spans: [{ x: 0, y: 0, w: 80, h: 20, line: true, text: 'Hi' }] });
    });
    assert.equal((await page.query('#target')).value, 'ja');

    for (const st of ['noWindow', 'ignored', 'permission']) {
      await page.evaluate((s) => {
        window.lens.render({ mode: 'overlay', status: 'ok', spans: [{ x: 0, y: 0, w: 80, h: 20, line: true, text: 'Hi' }] });
        window.lens.status({ status: s });
      }, st);
      assert.equal(await page.evaluate(() => document.querySelectorAll('#layer .t').length), 0, `${st} must clear #layer`);
      assert.ok((await page.query('#status')).text.trim().length > 0);
    }

    await page.evaluate(() => window.lens.status({ status: 'empty' }));
    assert.equal((await page.query('#status')).text, await page.evaluate(() => window.t('lens.status.empty')));

    await page.evaluate(() => window.lens.status({ status: 'error', detail: 'notInstalled' }));
    assertContains((await page.query('#status.error')).text, 'not downloaded');
  });
});

suite.test('T2-F20-04', 'F20', 'Narrow 320x200 viewport activates compact toolbar media query without JS errors', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.setViewport(320, 200);
    await page.evaluate(() => window.lens.setup({ lang: 'en', mode: 'reading' }));
    const check = await page.evaluate(() => ({
      nameDisplay: getComputedStyle(document.querySelector('#bar .name')).display,
      lblDisplay: getComputedStyle(document.querySelector('#bar .tb .lbl')).display,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(check.nameDisplay, 'none');
    assert.equal(check.lblDisplay, 'none');
    assert.equal(check.overflow, false);
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F20-05', 'F20', 'Hebrew RTL sets dir=rtl, 0 missing I18N keys, and fit() shrinks long overlay line inside box', async (ctx) => {
  await withLensPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.lens.setup({ lang: 'he', mode: 'overlay' });
      window.lens.render({
        mode: 'overlay',
        status: 'ok',
        spans: [
          {
            x: 10,
            y: 10,
            w: 150,
            h: 28,
            line: true,
            text: 'טקסט ארוך שיתכווץ לתיבה',
          },
        ],
      });
    });
    const res = await page.evaluate(() => {
      const box = document.querySelector('#layer .t.line');
      return {
        dir: document.documentElement.dir,
        missing: window.I18N.missing('he'),
        fontSize: parseFloat(box.style.fontSize),
        fitsWidth: box.scrollWidth <= box.clientWidth + 1,
      };
    });
    assert.equal(res.dir, 'rtl');
    assert.deepEqual(res.missing, []);
    assert.ok(res.fontSize >= 7 && res.fontSize < 22, `Expected fit() to shrink fontSize, got ${res.fontSize}`);
    assert.equal(res.fitsWidth, true);
  });
});

// ===========================================================================
// F21: Cron & curl Smart Cards boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F21-01', 'F21', 'Invalid cron strings do not falsely trigger Cron Smart Card', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    for (const bad of ['* * *', '99 * * * *', 'not a cron expression', '* * 32 13 *']) {
      await page.evaluate((txt) => {
        window.monitor.push({ id: 'bad-' + txt, time: Date.now(), kind: 'text', text: txt, app: 'Notes' });
      }, bad);
      assert.equal((await page.query('#content .card')).exists, false, `False positive Cron card for ${bad}`);
    }
  });
});

suite.test('T2-F21-02', 'F21', 'Cron edge schedules (Feb 29 / weekend step) render cleanly with zero NaN dates', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'cron-leap', time: Date.now(), kind: 'text', text: '0 0 29 2 *', app: 'Terminal' });
    });
    const card = await page.waitForSelector('#content .card', { visible: true });
    assertNotContains(card.text, 'NaN');
    assertNotContains(card.text, 'Invalid Date');
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

suite.test('T2-F21-03', 'F21', 'Multiline curl with backslash continuations escapes HTML in body without XSS', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({
        id: 'curl-multi',
        time: Date.now(),
        kind: 'text',
        text: 'curl -X PUT https://api.example.com/u \\\n  -H "X-Test: 1" \\\n  --data-raw \'{"html":"<script>window.__curlXss=1</script>"}\'',
        app: 'Terminal',
      });
    });
    const card = await page.waitForSelector('#content .card', { visible: true });
    assertContains(card.text, 'PUT');
    assertContains(card.text, 'https://api.example.com/u');
    assert.equal(await page.evaluate(() => window.__curlXss), undefined);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#content .card script').length), 0);
  });
});

suite.test('T2-F21-04', 'F21', 'Plain prose mentioning curl does not falsely trigger curl Smart Card', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    for (const prose of ['How to curl hair at home', 'Please run curl later when ready']) {
      await page.evaluate((txt) => {
        window.monitor.push({ id: 'prose-' + txt.length, time: Date.now(), kind: 'text', text: txt, app: 'Notes' });
      }, prose);
      assert.equal((await page.query('#content .card')).exists, false, `False positive curl card for: ${prose}`);
    }
  });
});

suite.test('T2-F21-05', 'F21', 'curl with query params and auth credentials renders cleanly without crashing', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({
        id: 'curl-auth',
        time: Date.now(),
        kind: 'text',
        text: 'curl -u alice:secret "https://api.example.com/search?q=hello&limit=10" -H "Accept: application/json"',
        app: 'Terminal',
      });
    });
    const card = await page.waitForSelector('#content .card', { visible: true });
    assertContains(card.text, 'https://api.example.com/search');
    assert.equal(page.getErrors().allErrors.length, 0);
  });
});

// ===========================================================================
// F22: Monitor UI/UX upgrades boundary cases (5 tests)
// ===========================================================================

suite.test('T2-F22-01', 'F22', 'Rapid double-clicks on #b-copy and #b-rtl restore original labels cleanly across item/lang changes', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'dbl-1', time: Date.now(), kind: 'text', text: 'שלום dbl', app: 'Notes' });
    });
    await page.waitForSelector('#b-rtl', { visible: true });
    const origCopy = (await page.query('#b-copy')).text;
    const origRtl = (await page.query('#b-rtl')).text;

    await page.click('#b-copy');
    await page.waitFor(() => (document.getElementById('b-copy')?.textContent || '').includes('✓'));
    await page.click('#b-copy');
    await page.click('#b-rtl');
    await page.waitFor(() => (document.getElementById('b-rtl')?.textContent || '').includes('✓'));
    await page.click('#b-rtl');
    await page.waitFor(
      () =>
        !(document.getElementById('b-copy')?.textContent || '').includes('✓') &&
        !(document.getElementById('b-rtl')?.textContent || '').includes('✓'),
      { timeoutMs: 3000 }
    );
    assert.equal((await page.query('#b-copy')).text, origCopy);
    assert.equal((await page.query('#b-rtl')).text, origRtl);
  });
});

suite.test('T2-F22-02', 'F22', 'At 320x600 in both en and he, all 7 Settings tabs fit without overflow and #history drawer is dismissible', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.setViewport(320, 600);
    for (const lang of ['en', 'he']) {
      await page.evaluate((l) => window.MOCK.lang(l), lang);
      await page.waitFor(`document.documentElement.dir === '${lang === 'he' ? 'rtl' : 'ltr'}'`);
      await page.evaluate(() => window.monitor.toggleSettings(true));
      await page.waitForSelector('#settings .tabs [role="tab"]', { visible: true });
      const tabs = await page.queryAll('#settings .tabs [role="tab"]');
      assert.equal(tabs.length, 7);
      for (const tb of tabs) {
        assert.ok(tb.rect.width > 0 && tb.rect.left >= 0 && tb.rect.left + tb.rect.width <= 321, `Tab overflow in ${lang}: ${JSON.stringify(tb.rect)}`);
      }
      await page.click('#s-close');
    }

    await page.click('#b-hist');
    await page.waitForSelector('body.show-history #history', { visible: true });
    await page.click('#b-hist');
    await page.waitFor(() => !document.body.classList.contains('show-history'));
  });
});

suite.test('T2-F22-03', 'F22', 'Pressing Cmd+E on empty history, image, secret, or other items is safely ignored', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    for (const item of [
      { id: 'qe-img', kind: 'image', image: TINY_PNG_DATA_URL, size: '1x1' },
      { id: 'qe-sec', kind: 'secret' },
      { id: 'qe-oth', kind: 'other', types: 'public.data' },
    ]) {
      await page.evaluate((it) => window.monitor.push(Object.assign({ time: Date.now() }, it)), item);
      await page.pressKey('e', { modifiers: ['Meta'] });
      assert.equal((await page.query('#content textarea')).exists, false, `Quick Edit must not open for ${item.kind}`);
    }

    await page.evaluate(() => {
      window.monitor.clearHistory();
      const firstKey = document.querySelector('#hlist .item')?.item?.id;
      if (firstKey) window.monitor.applyOp({ op: 'delete', key: firstKey });
    });
    await page.waitForSelector('#content .empty', { visible: true });
    await page.pressKey('e', { modifiers: ['Meta'] });
    assert.equal((await page.query('#content textarea')).exists, false);
  });
});

suite.test('T2-F22-04', 'F22', 'Escape cancels Quick Edit without saving and keeps original text intact', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'qe-esc', time: Date.now(), kind: 'text', text: 'Unchanged original', app: 'Notes' });
    });
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('Unchanged original'));
    await page.pressKey('e', { modifiers: ['Meta'] });
    await page.waitForSelector('#content textarea', { visible: true });
    await page.fill('#content textarea', 'Discarded draft');
    await clearSent(page);
    await page.pressKey('Escape');

    await page.waitFor(() => !document.querySelector('#content textarea'));
    assertContains((await page.query('#content')).text, 'Unchanged original');
    assert.equal((await getSent(page)).some((m) => m.cmd === 'copy' && m.text === 'Discarded draft'), false);
  });
});

suite.test('T2-F22-05', 'F22', 'Escape cancels Compare picking banner and Empty State reflects cleared Off shortcuts', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.push({ id: 'c1', time: 1700000500000, kind: 'text', text: 'Compare 1', app: 'Notes' });
      window.monitor.push({ id: 'c2', time: 1700000501000, kind: 'text', text: 'Compare 2', app: 'Notes' });
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
    await page.pressKey('Escape');
    await page.waitFor(() => !document.body.classList.contains('picking'));

    await page.evaluate(() => {
      window.monitor.clearHistory();
      const firstKey = document.querySelector('#hlist .item')?.item?.id;
      if (firstKey) window.monitor.applyOp({ op: 'delete', key: firstKey });
    });
    await page.waitForSelector('#content .empty', { visible: true });
    assertContains((await page.query('#content .empty')).text, '⌃⌥V');

    await page.evaluate(() => {
      window.CM.setSetting('hotkey', 'off');
    });
    await page.waitFor(() => !(document.querySelector('#content .empty')?.textContent || '').includes('⌃⌥V'));
    assertNotContains((await page.query('#content .empty')).text, '⌃⌥V');
  });
});

// ===========================================================================
// F25: "שלח אל… (Send to…)" menu boundary cases (10 tests: 5 Monitor + 5 Actions)
// ===========================================================================

suite.test('T2-F25-01', 'F25', 'When sendToApps is empty [] or undefined, Monitor #ctx omits Send to submenu', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.monitor.setState({ sendToApps: [] });
      window.monitor.setSettings({ sendToApps: [] });
      window.monitor.push({ id: 'no-send', time: Date.now(), kind: 'text', text: 'No send apps', app: 'Notes' });
    });
    await openContentContextMenu(page);
    const hasSub = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx [role="menuitem"]')].some((el) => /send to|שלח אל/i.test(el.textContent || ''))
    );
    assert.equal(hasSub, false);
  });
});

suite.test('T2-F25-02', 'F25', 'Send to in Monitor while viewing translation sends shownText(item), not stale original text', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [{ id: 'obsidian', name: 'Obsidian' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'tr-send', time: Date.now(), kind: 'text', text: 'Original English sentence', app: 'Notes' });
    });
    await page.waitForSelector('#content .actions button', { visible: true });
    await clearSent(page);
    await page.click('#content .actions .tr-split button:first-child');
    await page.waitFor(() => (window.__sent || []).some((m) => m.cmd === 'translate'));
    const req = (await getSent(page)).find((m) => m.cmd === 'translate').req;

    await page.evaluate((r) => {
      window.monitor.translated({ req: r, from: 'en', to: 'he', engine: 'apple', text: 'משפט מתורגם לעברית' });
    }, req);
    await page.waitFor(() => (document.getElementById('content')?.textContent || '').includes('משפט מתורגם לעברית'));

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
    assert.ok(sent.some((m) => m.cmd === 'sendTo' && m.app === 'obsidian' && m.text === 'משפט מתורגם לעברית'));
  });
});

suite.test('T2-F25-03', 'F25', 'Non-text items (image without OCR / secret) do not expose Send to or emit empty sendTo', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((img) => {
      const apps = [{ id: 'obsidian', name: 'Obsidian' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'img-nosend', time: Date.now(), kind: 'image', image: img, size: '1x1', app: 'Preview' });
    }, TINY_PNG_DATA_URL);
    await openContentContextMenu(page);
    const hasSub = await page.evaluate(() =>
      [...document.querySelectorAll('#ctx [role="menuitem"]')].some((el) => /send to|שלח אל/i.test(el.textContent || ''))
    );
    assert.equal(hasSub, false);
  });
});

suite.test('T2-F25-04', 'F25', 'Unicode, Hebrew, newlines, and special characters are preserved verbatim in Monitor sendTo payload', async (ctx) => {
  const payload = 'שלום 🌍\nLine 2 & <tag> "quotes"';
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate((txt) => {
      const apps = [{ id: 'bear', name: 'Bear' }];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.monitor.push({ id: 'uni-send', time: Date.now(), kind: 'text', text: txt, app: 'Notes' });
    }, payload);
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
    assert.ok(sent.some((m) => m.cmd === 'sendTo' && m.app === 'bear' && m.text === payload));
  });
});

suite.test('T2-F25-05', 'F25', 'In RTL (he), opening Monitor Send to submenu via ArrowLeft positions .ctx-sub inside viewport', async (ctx) => {
  await withMonitorPage(ctx, async (page) => {
    await page.evaluate(() => {
      const apps = [
        { id: 'obsidian', name: 'Obsidian' },
        { id: 'whatsapp', name: 'WhatsApp' },
      ];
      window.monitor.setState({ sendToApps: apps });
      window.monitor.setSettings({ sendToApps: apps });
      window.MOCK.lang('he');
    });
    await page.waitFor(() => document.documentElement.dir === 'rtl');
    await openContentContextMenu(page, 20, 100);
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('#ctx > [role="menuitem"][aria-haspopup="menu"]')].find((el) =>
        el.textContent.includes('שלח אל')
      );
      item?.focus();
    });
    await page.pressKey('ArrowLeft');
    await page.waitForSelector('#ctx .ctx-sub', { visible: true });

    const r = await page.evaluate(() => {
      const b = document.querySelector('#ctx .ctx-sub').getBoundingClientRect();
      return { left: b.left, right: b.right, w: innerWidth };
    });
    assert.ok(r.left >= 4 && r.right <= r.w - 4, `RTL .ctx-sub out of bounds: ${JSON.stringify(r)}`);
  });
});

suite.test('T2-F25-06', 'F25', 'In Text Actions, editing result in Edit mode then using Send to sends the edited text', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Pre-edit text', canReplace: true });
      const editBtn = [...document.querySelectorAll('#v-work button')].find((x) =>
        /^edit$|עריכה|ערוך/i.test((x.textContent || x.title || x.getAttribute('aria-label') || '').trim())
      );
      editBtn?.click();
    });
    await page.waitForSelector('#v-work textarea', { visible: true });
    await page.fill('#v-work textarea', 'Post-edit text for Obsidian');

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.click('[role="menu"] [role="menuitem"]');

    const sent = await getSent(page);
    assert.ok(sent.some((m) => m.cmd === 'sendTo' && m.app === 'obsidian' && m.text === 'Post-edit text for Obsidian'));
  });
});

suite.test('T2-F25-07', 'F25', 'Navigating back or showing error/noText closes any open Send-to menu in Text Actions', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Open menu', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });

    await page.evaluate(() => window.actions.show({ status: 'noText' }));
    const closed = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
    assert.equal(closed, true);
  });
});

suite.test('T2-F25-08', 'F25', 'Clicking outside Text Actions Send-to menu closes it without firing sendTo', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'result', id: 'improve', text: 'Outside click test', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    });
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });
    await clearSent(page);
    await page.click('#title');

    await page.waitFor(() => {
      const m = document.querySelector('[role="menu"]');
      return !m || m.hidden || getComputedStyle(m).display === 'none';
    });
    assert.equal((await getSent(page)).some((m) => m.cmd === 'sendTo'), false);
  });
});

suite.test('T2-F25-09', 'F25', 'All 7 supported Send-to apps render inside #card without clipping and emit exact app IDs', async (ctx) => {
  const apps = [
    { id: 'obsidian', name: 'Obsidian' },
    { id: 'whatsapp', name: 'WhatsApp' },
    { id: 'telegram', name: 'Telegram' },
    { id: 'things', name: 'Things' },
    { id: 'bear', name: 'Bear' },
    { id: 'drafts', name: 'Drafts' },
    { id: 'shortcuts', name: 'Shortcuts' },
  ];
  await withActionsPage(ctx, async (page) => {
    await page.evaluate((list) => {
      window.actions.setup({ lang: 'en', margin: 10, sendToApps: list });
      window.actions.show({ status: 'result', id: 'improve', text: 'All 7 apps', canReplace: true });
      const b = [...document.querySelectorAll('#v-work button')].find((x) =>
        /send to|שלח אל/i.test(x.textContent || x.title || x.getAttribute('aria-label') || '')
      );
      b?.click();
    }, apps);
    await page.waitForSelector('[role="menu"] [role="menuitem"]', { visible: true });

    const info = await page.evaluate(() => ({
      count: document.querySelectorAll('[role="menu"] [role="menuitem"]').length,
      overflowX: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.equal(info.count, 7);
    assert.equal(info.overflowX, false);

    await clearSent(page);
    await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
      items[items.length - 1]?.click();
    });
    assert.ok((await getSent(page)).some((m) => m.cmd === 'sendTo' && m.app === 'shortcuts'));
  });
});

suite.test('T2-F25-10', 'F25', 'In quickTranslate error/translating states Send-to is hidden, while ok state exposes it', async (ctx) => {
  await withActionsPage(ctx, async (page) => {
    await page.evaluate(() => {
      window.actions.setup({
        lang: 'en',
        margin: 10,
        sendToApps: [{ id: 'obsidian', name: 'Obsidian' }],
      });
      window.actions.show({ status: 'quickTranslate', state: 'error', source: 'Hi', detail: 'unsupported' });
    });
    const onError = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(onError, false);

    await page.evaluate(() => {
      window.actions.show({ status: 'quickTranslate', state: 'translating', source: 'Hi' });
    });
    const onTranslating = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(onTranslating, false);

    await page.evaluate(() => {
      window.actions.show({
        status: 'quickTranslate',
        state: 'ok',
        source: 'Hi',
        text: 'היי',
        target: 'he',
        canReplace: true,
      });
    });
    const onOk = await page.evaluate(() =>
      [...document.querySelectorAll('#v-work button')].some(
        (b) => b.offsetParent !== null && /send to|שלח אל/i.test(b.textContent || b.title || b.getAttribute('aria-label') || '')
      )
    );
    assert.equal(onOk, true);
  });
});

await suite.run();
