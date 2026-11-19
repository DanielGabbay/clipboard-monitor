import fs from 'node:fs';
import path from 'node:path';

import {
  assert,
  assertContains,
  assertExitCode,
  assertNotContains,
  createSuite,
  extractCssSelectors,
  hasCssClassToken,
} from '../lib/test_harness.mjs';
import {
  createIsolatedHome,
  createMcpClient,
  deliverIsolatedUrl,
  otoolLinkedFrameworks,
  probeUnixSocket,
  readPlistJson,
  readStringsJson,
  runCli,
  startIsolatedApp,
  verifyCodesign,
} from '../lib/cli_mcp.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const suite = createSuite({
  name: 't3_pairwise',
  tier: 3,
  description: 'E2E-M3 Tier 3: Cross-Feature Pairwise Interactions Across F01-F28',
});

// ---------------------------------------------------------------------------
// Lazy shared fixtures & teardown (zero side effects at import time)
// ---------------------------------------------------------------------------

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

async function getSharedEphemeralGui(ctx) {
  if (!ctx.state.ephemeralGui) {
    ctx.state.ephemeralGui = await startIsolatedApp(ctx, {
      prefix: 'tm-t3-f23-',
      ephemeralBundle: true,
    });
  }
  return ctx.state.ephemeralGui;
}

suite.afterAll(async (ctx) => {
  if (ctx.state.ephemeralGui) await ctx.state.ephemeralGui.stop();
  if (ctx.state.browser) await ctx.state.browser.close();
  if (ctx.state.previewEnv) await ctx.state.previewEnv.close();
});

// ---------------------------------------------------------------------------
// Opaque-box DOM, bridge & CLI helpers
// ---------------------------------------------------------------------------

const LENS_INIT_SCRIPT = `
  window.__sent = [];
  window.webkit = {
    messageHandlers: {
      app: {
        postMessage(m) {
          window.__sent.push(m);
        }
      }
    }
  };
`;

function stripTrailingNewline(s) {
  return String(s ?? '').replace(/\r?\n$/, '');
}

async function getSent(page, cmd) {
  return await page.evaluate((c) => (window.__sent || []).filter((m) => !c || m.cmd === c), cmd || null);
}

async function clearSent(page) {
  await page.evaluate(() => {
    if (Array.isArray(window.__sent)) window.__sent.length = 0;
    else window.__sent = [];
  });
}

async function waitForSent(page, cmd, predicate, timeoutMs = 4500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await getSent(page, cmd);
    const hit = predicate ? list.find(predicate) : list[list.length - 1];
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  const all = await getSent(page);
  throw new assert.AssertionError({
    message: `Timed out waiting for __sent cmd="${cmd}". Captured: ${JSON.stringify(all.slice(-10))}`,
  });
}

async function tagControl(
  page,
  { selectors = [], textRe = null, titleRe = null, placeholderRe = null, rootSelector = null } = {}
) {
  const token = 'e2e_' + Math.random().toString(36).slice(2, 10);
  const info = await page.evaluate(
    (opts) => {
      const root = opts.rootSelector ? document.querySelector(opts.rootSelector) : document;
      if (!root) return { found: false, reason: 'rootSelector not found' };
      const isVisible = (el) => {
        if (!el || el.hidden || el.disabled) return false;
        for (let cur = el; cur; cur = cur.parentElement) {
          if (cur.hidden) return false;
          const cs = getComputedStyle(cur);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) <= 0) return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0 || el.getClientRects().length > 0;
      };
      const toRe = (spec) => (spec ? new RegExp(spec.source, spec.flags) : null);
      const tRe = toRe(opts.textRe);
      const tiRe = toRe(opts.titleRe);
      const pRe = toRe(opts.placeholderRe);

      for (const sel of opts.selectors || []) {
        const matches = [...root.querySelectorAll(sel)].filter((el) => isVisible(el));
        for (const el of matches) {
          const txt = (el.textContent || '').trim();
          const ttl = ((el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
          const ph = (el.getAttribute('placeholder') || '').trim();
          if (tRe && !tRe.test(txt)) continue;
          if (tiRe && !tiRe.test(ttl)) continue;
          if (pRe && !pRe.test(ph)) continue;
          el.setAttribute('data-e2e-target', opts.token);
          return { found: true, tag: el.tagName.toLowerCase(), text: txt };
        }
      }

      const candidates = [
        ...root.querySelectorAll(
          'button, a, [role="button"], [role="menuitem"], [role="tab"], input, textarea, select, summary, [data-act]'
        ),
      ];
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const txt = (el.textContent || '').trim();
        const ttl = ((el.getAttribute('title') || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
        const ph = (el.getAttribute('placeholder') || '').trim();
        if (tRe && tRe.test(txt)) {
          el.setAttribute('data-e2e-target', opts.token);
          return { found: true, tag: el.tagName.toLowerCase(), text: txt };
        }
        if (tiRe && tiRe.test(ttl)) {
          el.setAttribute('data-e2e-target', opts.token);
          return { found: true, tag: el.tagName.toLowerCase(), text: txt || ttl };
        }
        if (pRe && pRe.test(ph)) {
          el.setAttribute('data-e2e-target', opts.token);
          return { found: true, tag: el.tagName.toLowerCase(), text: ph };
        }
      }
      return { found: false, reason: 'no matching visible control' };
    },
    {
      token,
      selectors,
      rootSelector,
      textRe: textRe ? { source: textRe.source, flags: textRe.flags } : null,
      titleRe: titleRe ? { source: titleRe.source, flags: titleRe.flags } : null,
      placeholderRe: placeholderRe ? { source: placeholderRe.source, flags: placeholderRe.flags } : null,
    }
  );
  if (!info.found) {
    throw new assert.AssertionError({
      message: `Control not found (selectors=${JSON.stringify(selectors)}, textRe=${textRe}, titleRe=${titleRe}, placeholderRe=${placeholderRe}): ${info.reason}`,
    });
  }
  return `[data-e2e-target="${token}"]`;
}

async function clickControl(page, spec) {
  const sel = await tagControl(page, spec);
  try {
    await page.click(sel);
  } finally {
    await page
      .evaluate((s) => {
        document.querySelectorAll(s).forEach((el) => el.removeAttribute('data-e2e-target'));
      }, sel)
      .catch(() => {});
  }
}

async function fillControl(page, spec, value) {
  const sel = await tagControl(page, spec);
  try {
    await page.fill(sel, value);
  } finally {
    await page
      .evaluate((s) => {
        document.querySelectorAll(s).forEach((el) => el.removeAttribute('data-e2e-target'));
      }, sel)
      .catch(() => {});
  }
}

async function openMonitorPage(ctx, pageOpts = {}) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage(pageOpts);
  await page.goto(env.previewUrl, { settleMs: 200 });
  await page.waitFor(() => Boolean(window.CM && window.monitor && document.querySelector('#kind')));
  return page;
}

async function openActionsPage(ctx, pageOpts = {}) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage(pageOpts);
  await page.goto(env.actionsPreviewUrl, { settleMs: 150 });
  await page.waitFor(() => Boolean(window.actions && window.MOCKA && document.querySelector('#card')));
  return page;
}

async function openLensPage(ctx) {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({ initScript: LENS_INIT_SCRIPT });
  await page.goto(env.lensUrl, { settleMs: 150 });
  await page.waitFor(() => Boolean(window.lens && window.I18N && document.querySelector('#bar')));
  return page;
}

async function pollCliHistory(ctx, gui, needle, timeoutMs = 6000) {
  const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
  const deadline = Date.now() + timeoutMs;
  let lastRes = null;
  while (Date.now() < deadline) {
    const res = await runCli(ctx.appBin, ['history'], { env, timeoutMs: 2500 });
    lastRes = res;
    if (res.code === 0 && res.stdout.includes(needle)) {
      return res;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new assert.AssertionError({
    message: `Timed out waiting for ${JSON.stringify(needle)} in APP_BIN history. Last: code=${lastRes?.code}, stdout=${JSON.stringify((lastRes?.stdout || '').slice(0, 400))}, stderr=${JSON.stringify((lastRes?.stderr || '').slice(0, 400))}`,
  });
}

function extractMcpText(res) {
  const content = res?.result?.content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c.text === 'string' ? c.text : JSON.stringify(c))).join('\n');
  }
  return JSON.stringify(res?.result ?? '');
}

async function hasCompareGuidanceBanner(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('main *, #content *, #history *')];
    return els.some((el) => {
      if (el.closest('.actions, #hlist, .diff, .diffhead, .card, .plain, .md, pre, details.raw-text')) return false;
      if (el.querySelector('.actions, #hlist, .plain, .md, pre')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return false;
      const r = el.getBoundingClientRect();
      if (r.height <= 0 || r.width <= 0) return false;
      const txt = (el.textContent || '').trim();
      return /pick|choose|select|click.*history|compar|בחר.*(?:פריט|היסטורי|השווא)|לחץ.*(?:פריט|היסטורי)|להשוואה|להשוות|בחירת פריט|השוואה/i.test(txt);
    });
  });
}

// ===========================================================================
// Tier 3 Pairwise Tests (T3-PW-01 .. T3-PW-34)
// ===========================================================================

suite.test(
  'T3-PW-01',
  ['F13', 'F14', 'F27'],
  'Hebrew RTL + Streaming Markdown + BiDi + Diff + Follow-up',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCKA.source = 'הפגישה נדחתה ליום חמישי because `api/v2` needs fixes.';
        window.MOCKA.lang('he');
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');

      const missingHe = await page.evaluate(() => window.I18N.missing('he'));
      assert.deepEqual(missingHe, [], `Missing Hebrew keys: ${missingHe.join(', ')}`);

      await page.evaluate(() => {
        window.actions.show({ status: 'running', id: 'improve' });
        window.actions.show({
          status: 'streaming',
          id: 'improve',
          text: '**עדכון:** הפגישה נדחתה',
        });
      });
      await page.waitFor(() => (document.querySelector('#text')?.textContent || '').includes('עדכון:'));

      const fullResult = '**עדכון:** הפגישה נדחתה ליום חמישי כי `api/v2` דורש תיקון.\n\n- בדיקה ראשונה';
      await page.evaluate((txt) => {
        window.actions.show({ status: 'streaming', id: 'improve', text: txt });
        window.actions.show({ status: 'result', id: 'improve', text: txt, canReplace: true });
      }, fullResult);
      await page.waitFor(() => {
        const textEl = document.querySelector('#text');
        const blk = textEl?.querySelector('p, li');
        return Boolean(textEl?.querySelector('strong') && blk?.getAttribute('dir') === 'rtl');
      });

      const rendered = await page.evaluate(() => {
        const textEl = document.querySelector('#text');
        const strong = textEl?.querySelector('strong');
        const code = textEl?.querySelector('code');
        const li = textEl?.querySelector('ul li, ol li');
        return {
          hasStrong: Boolean(strong && strong.textContent.includes('עדכון')),
          hasCode: Boolean(code && code.textContent === 'api/v2'),
          codeDir: code ? getComputedStyle(code).direction : '',
          hasList: Boolean(li),
          blockDir: (textEl?.querySelector('p, li') || textEl)?.getAttribute('dir') || '',
        };
      });
      assert.equal(rendered.hasStrong, true, 'Expected Markdown <strong> in streamed result');
      assert.equal(rendered.hasCode, true, 'Expected Markdown inline <code> for api/v2');
      assert.equal(rendered.hasList, true, 'Expected Markdown <li> in streamed result');
      assert.equal(rendered.blockDir, 'rtl', 'Expected Hebrew BiDi rtl on Markdown block');

      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /^(diff|הבדלים|השווה)$/i,
        titleRe: /diff|הבדלים|שינויים/i,
      });
      const diffCheck = await page.evaluate(() => {
        const work = document.querySelector('#v-work');
        return Boolean(
          work?.querySelector('ins, del, .wadd, .wdel, .diff, [class*="diff"], [data-diff]')
        );
      });
      assert.equal(diffCheck, true, 'Expected Diff toggle to display added/removed markers');

      await clearSent(page);
      await fillControl(page, {
        rootSelector: '#v-work',
        placeholderRe: /follow[- ]?up|המשך|שאל|בקש|הנחיה/i,
        titleRe: /follow[- ]?up|המשך/i,
      }, 'קצר לשורה אחת');
      await page.pressKey('Enter');

      const followMsg = await waitForSent(page, 'run', (m) => Array.isArray(m.messages) && m.messages.length >= 2);
      assert.equal(followMsg.messages[0].role, 'user');
      assert.equal(followMsg.messages.some((m) => m.role === 'assistant'), true);
      assert.equal(followMsg.messages[followMsg.messages.length - 1].role, 'user');
      assertContains(followMsg.messages[followMsg.messages.length - 1].content, 'קצר לשורה אחת');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, [], `Unexpected errors: ${errs.allErrors.join('; ')}`);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-02',
  ['F22', 'F03'],
  'Compare (picking) banner + Quick Edit (Meta+E) + keyOf(it) ID stability',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('en');
      });
      await page.waitFor(() => document.documentElement.dir === 'ltr');

      await page.evaluate(() => {
        window.monitor.push({ id: 'cmp-a', time: 1000, kind: 'text', text: 'Shared prefix alpha', app: 'Notes' });
        window.monitor.push({ id: 'cmp-b', time: 2000, kind: 'text', text: 'Shared prefix beta', app: 'Notes' });
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Shared prefix beta'));

      await clearSent(page);
      await page.pressKey('e', { modifiers: ['Meta'] });
      await fillControl(
        page,
        { rootSelector: '#content', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'Edited snippet v2'
      );
      await clickControl(page, {
        rootSelector: '#content',
        textRe: /^(save|שמור|done|סיום)$/i,
      });

      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Edited snippet v2'));
      const editSent = await getSent(page);
      assert.equal(
        editSent.some((m) => (m.cmd === 'copy' || m.cmd === 'editItem' || m.cmd === 'saveHistory') && JSON.stringify(m).includes('Edited snippet v2')),
        true,
        `Expected Quick Edit save command in __sent, got ${JSON.stringify(editSent)}`
      );

      await clickControl(page, {
        rootSelector: '#content',
        textRe: /compare|השווה/i,
      });
      await page.waitFor(() => document.body.classList.contains('picking'));
      assert.equal(await page.evaluate(() => document.body.classList.contains('show-history')), true);

      const hasEnBanner = await hasCompareGuidanceBanner(page);
      assert.equal(hasEnBanner, true, 'Expected visible Compare picking guidance banner in en');

      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      const hasHeBanner = await hasCompareGuidanceBanner(page);
      assert.equal(hasHeBanner, true, 'Expected visible Compare picking guidance banner in he');

      await page.evaluate(() => {
        const items = [...document.querySelectorAll('#hlist .item')];
        const target = items.find((el) => (el.textContent || '').includes('Shared prefix alpha'));
        if (!target) throw new Error('cmp-a not found in #hlist');
        target.click();
      });

      await page.waitForSelector('.diffhead');
      const diffText = await page.evaluate(() => document.querySelector('#content')?.textContent || '');
      assertContains(diffText, 'Shared prefix alpha');
      assertContains(diffText, 'Edited snippet v2');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-03',
  ['F16', 'F25'],
  'Local zero-AI actions (flipKeyboard/wrapRtl/cleanSpaces) + Send-to submenu',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCKA.noModels = true;
        window.MOCKA.source = 'akuo guko/';
        window.actions.setup({
          lang: 'en',
          margin: 10,
          sendToApps: [
            { id: 'obsidian', name: 'Obsidian' },
            { id: 'bear', name: 'Bear' },
          ],
        });
        window.actions.show({
          status: 'list',
          source: 'akuo guko/',
          actions: [
            { id: 'flipKeyboard', kind: 'local', replaces: true },
            { id: 'wrapRtl', kind: 'local', replaces: true },
            { id: 'cleanSpaces', kind: 'local', replaces: true },
            { id: 'improve', kind: 'builtin', replaces: true },
          ],
          models: [],
          model: '',
          canReplace: true,
        });
      });

      assert.equal((await page.query('#nomodel')).visible, true, '#nomodel should be visible when noModels=true');
      await clearSent(page);

      await clickControl(page, {
        rootSelector: '#list',
        selectors: ['.item'],
        textRe: /flip|הפוך/i,
      });

      await page.waitFor(() => !document.querySelector('#v-work')?.hidden);
      await page.waitFor(() => (document.querySelector('#text')?.textContent || '').includes('שלום עולם'));
      const statusText = (await page.query('#status')).text;
      assert.equal(/no ai model/i.test(statusText), false, 'Local action must not fail with noModel error');

      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /send to|שלח אל/i,
        titleRe: /send to|שלח אל/i,
      });
      await clickControl(page, { textRe: /Obsidian/i });

      const sentMsg = await waitForSent(page, 'sendTo');
      assert.equal(String(sentMsg.app).toLowerCase(), 'obsidian');
      assertContains(sentMsg.text, 'שלום עולם');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-04',
  ['F09', 'F12', 'F17'],
  'Settings master toggles off/on + unified CM.hotkeyRecorder across all 5 hotkeys',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('en'));
      await page.waitFor(() => document.documentElement.dir === 'ltr');
      await page.click('#b-settings');
      await page.waitForSelector('#settings .tabs');

      const recordKey = async (tab, rowQueryFn, keyChar, expectedSettingKey, expectedCombo) => {
        await page.click(`#stab-${tab}`);
        await clearSent(page);
        const recSel = await page.evaluate(rowQueryFn);
        assert.ok(recSel, `Missing recorder for ${expectedSettingKey} in tab ${tab}`);
        await page.click(recSel);
        await page.pressKey(keyChar, { modifiers: ['Ctrl', 'Shift'] });
        const msg = await waitForSent(page, 'set', (m) => m.key === expectedSettingKey);
        assert.equal(msg.value, expectedCombo);
      };

      await recordKey(
        'general',
        () => {
          const btn = document.querySelector('#row-hotkey .hk-rec');
          if (!btn) return null;
          btn.id = 'e2e-rec-hotkey';
          return '#e2e-rec-hotkey';
        },
        'm',
        'hotkey',
        'ctrl+shift+KeyM'
      );

      await recordKey(
        'actions',
        () => {
          const btns = [...document.querySelectorAll('#spanel-actions .hk-rec')];
          if (btns.length < 2) return null;
          btns[0].id = 'e2e-rec-actions';
          btns[1].id = 'e2e-rec-flip';
          return '#e2e-rec-actions';
        },
        'a',
        'actionsHotkey',
        'ctrl+shift+KeyA'
      );

      await recordKey(
        'actions',
        () => '#e2e-rec-flip',
        'k',
        'flipHotkey',
        'ctrl+shift+KeyK'
      );

      await recordKey(
        'translate',
        () => {
          const b = document.querySelector('#spanel-translate .f-hk[data-for="bubble"] .hk-rec');
          if (!b) return null;
          b.id = 'e2e-rec-bubble';
          return '#e2e-rec-bubble';
        },
        'b',
        'bubbleHotkey',
        'ctrl+shift+KeyB'
      );

      await recordKey(
        'translate',
        () => {
          const l = document.querySelector('#spanel-translate .f-hk[data-for="lens"] .hk-rec');
          if (!l) return null;
          l.id = 'e2e-rec-lens';
          return '#e2e-rec-lens';
        },
        'l',
        'lensHotkey',
        'ctrl+shift+KeyL'
      );

      // Toggle master switches off then back on and verify child hotkey recorders disable & restore
      await page.click('#stab-actions');
      await page.click('#spanel-actions [data-key="f.actions"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-actions .a-body');
        return body && (body.inert || body.classList.contains('off'));
      });
      await page.click('#spanel-actions [data-key="f.actions"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-actions .a-body');
        return body && !body.inert && !body.classList.contains('off');
      });
      assert.equal(await page.evaluate(() => window.CM.S.flipHotkey), 'ctrl+shift+KeyK');

      await page.click('#stab-translate');
      await page.click('#spanel-translate [data-key="f.bubble"]');
      await page.waitFor(() => document.querySelector('#e2e-rec-bubble')?.disabled === true);
      await page.click('#spanel-translate [data-key="f.lens"]');
      await page.waitFor(() => document.querySelector('#e2e-rec-lens')?.disabled === true);
      await page.click('#spanel-translate [data-key="f.translate"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-translate .t-body');
        return body && (body.inert || body.classList.contains('off'));
      });

      await page.click('#spanel-translate [data-key="f.translate"]');
      await page.click('#spanel-translate [data-key="f.bubble"]');
      await page.click('#spanel-translate [data-key="f.lens"]');
      await page.waitFor(() => {
        const b = document.querySelector('#e2e-rec-bubble');
        const l = document.querySelector('#e2e-rec-lens');
        return b && !b.disabled && l && !l.disabled;
      });
      assert.equal(await page.evaluate(() => window.CM.S.bubbleHotkey), 'ctrl+shift+KeyB');
      assert.equal(await page.evaluate(() => window.CM.S.lensHotkey), 'ctrl+shift+KeyL');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-05',
  ['F01', 'F23', 'F26'],
  'CLI (flip/rtl) + MCP (flip_keyboard_text/wrap_rtl_text) + URL scheme (textmonitor://)',
  async (ctx) => {
    const gui = await getSharedEphemeralGui(ctx);
    const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };

    const flipCli = await runCli(ctx.appBin, ['flip', 'akuo'], { env });
    assertExitCode(flipCli, 0);
    assert.equal(stripTrailingNewline(flipCli.stdout), 'שלום');

    const rtlCli = await runCli(ctx.appBin, ['rtl', 'שלום'], { env });
    assertExitCode(rtlCli, 0);

    const mcp = await createMcpClient(ctx.appBin, { env });
    try {
      const init = await mcp.initialize();
      assert.equal(init.jsonrpc, '2.0');
      mcp.notify('notifications/initialized', {});

      const flipMcp = await mcp.callTool('flip_keyboard_text', { text: 'akuo' });
      assert.equal(Boolean(flipMcp.result?.isError), false);
      assert.equal(extractMcpText(flipMcp).trim(), 'שלום');

      const wrapMcp = await mcp.callTool('wrap_rtl_text', { text: stripTrailingNewline(flipCli.stdout) });
      assert.equal(Boolean(wrapMcp.result?.isError), false);
      const wrapped = extractMcpText(wrapMcp).replace(/\r?\n$/, '');
      assert.equal(wrapped, stripTrailingNewline(rtlCli.stdout));
      assert.equal(wrapped, '\u2067שלום\u2069');

      const marker = `PW05_${Date.now()}_${wrapped}`;
      await deliverIsolatedUrl(gui, `textmonitor://push?text=${encodeURIComponent(marker)}`);
      await pollCliHistory(ctx, gui, marker);
      assert.equal(gui.isAlive(), true);
    } finally {
      await mcp.close();
    }
  },
  { timeoutMs: 35000 }
);

suite.test(
  'T3-PW-06',
  ['F10', 'F25', 'F02'],
  'Quick Translate + Open in TextMonitor + Back + Send-to + filtered models',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.actions.setup({
          lang: 'en',
          margin: 10,
          target: 'fr',
          targets: 'he,en,fr',
          sendToApps: [{ id: 'telegram', name: 'Telegram' }],
        });
        window.actions.show({
          status: 'quickTranslate',
          mode: 'quickTranslate',
          source: 'Hello team',
          text: 'Bonjour équipe',
          target: 'fr',
          targets: 'he,en,fr',
          canReplace: true,
        });
      });

      assert.equal((await page.query('#target')).value, 'fr');
      assert.equal((await page.query('#open-monitor')).visible, true);

      await clearSent(page);
      await page.click('#open-monitor');
      await waitForSent(page, 'openInMonitor');

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /send to|שלח אל/i,
        titleRe: /send to|שלח אל/i,
      });
      await clickControl(page, { textRe: /Telegram/i });
      const sentTo = await waitForSent(page, 'sendTo');
      assert.equal(String(sentTo.app).toLowerCase(), 'telegram');
      assertContains(sentTo.text, 'Bonjour équipe');

      await clearSent(page);
      await page.click('#back');
      await waitForSent(page, 'back');
      await page.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Hello team',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [{ value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' }],
          model: 'p1\nclaude-sonnet-5-5',
          canReplace: true,
        });
      });
      await page.waitForSelector('#v-list #list .item');
      const modelOptions = await page.queryAll('#model option');
      assert.equal(modelOptions.length, 1);
      assert.equal(modelOptions[0].value, 'p1\nclaude-sonnet-5-5');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-07',
  ['F19', 'F27', 'F25'],
  'Image OCR + BiDi + Copy/Translate + Send-to in Hebrew UI',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('he');
        window.monitor.setSettings({
          sendToApps: [{ id: 'whatsapp', name: 'WhatsApp' }],
        });
        window.monitor.push({
          id: 'img-ocr-1',
          time: Date.now(),
          kind: 'image',
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          size: '200×100',
          app: 'Preview',
        });
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await page.waitForSelector('#content img');

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#content',
        textRe: /חלץ טקסט|extract text|\bocr\b/i,
      });
      const ocrMsg = await waitForSent(page, 'ocr', (m) => m.id === 'img-ocr-1');
      assertContains(ocrMsg.image, 'data:image/png');

      await page.evaluate(() => {
        window.monitor.ocrResult({ id: 'img-ocr-1', text: 'חשבונית 42\nTotal: $100' });
      });
      await page.waitFor(() => {
        const els = [...document.querySelectorAll('#content *')];
        const hebEl = els.find((e) => e.children.length === 0 && e.textContent.trim() === 'חשבונית 42');
        const engEl = els.find((e) => e.children.length === 0 && e.textContent.trim() === 'Total: $100');
        const hebDir = hebEl?.closest('#content [dir]')?.getAttribute('dir') || '';
        const engDir = engEl?.closest('#content [dir]')?.getAttribute('dir') || '';
        return Boolean(hebEl && engEl && hebDir === 'rtl' && engDir === 'ltr');
      });

      const bidiOk = await page.evaluate(() => {
        const els = [...document.querySelectorAll('#content *')];
        const hebEl = els.find((e) => e.children.length === 0 && e.textContent.trim() === 'חשבונית 42');
        const engEl = els.find((e) => e.children.length === 0 && e.textContent.trim() === 'Total: $100');
        const hebDir = hebEl?.closest('#content [dir]')?.getAttribute('dir') || '';
        const engDir = engEl?.closest('#content [dir]')?.getAttribute('dir') || '';
        return {
          found: Boolean(hebEl && engEl),
          hebDir,
          engDir,
        };
      });
      assert.equal(bidiOk.found, true, 'Expected OCR Hebrew & English lines rendered below image');
      assert.equal(bidiOk.hebDir, 'rtl', 'Expected dir="rtl" on Hebrew OCR line');
      assert.equal(bidiOk.engDir, 'ltr', 'Expected dir="ltr" on English OCR line');

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#content',
        textRe: /^(copy|העתק)$/i,
      });
      const copySent = await waitForSent(page, 'copy');
      assertContains(copySent.text, 'חשבונית 42');

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#content',
        textRe: /^(translate|תרגם)/i,
      });
      const trSent = await waitForSent(page, 'translate');
      assertContains(trSent.text, 'חשבונית 42');

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#content',
        textRe: /send to|שלח אל/i,
        titleRe: /send to|שלח אל/i,
      });
      await clickControl(page, { textRe: /WhatsApp/i });
      const sendSent = await waitForSent(page, 'sendTo');
      assert.equal(String(sendSent.app).toLowerCase(), 'whatsapp');
      assertContains(sendSent.text, 'חשבונית 42');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-08',
  ['F21', 'F12', 'F22'],
  'Cron & curl Smart Cards + Settings sub-toggles (f.smartCron/f.smartCurl) + Copy RTL ✓ feedback',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.monitor.push({ id: 'pw08-cron', time: 1000, kind: 'text', text: '*/15 9-17 * * 1-5', app: 'Terminal' });
      });
      await page.waitForSelector('.card .card-title');
      let cardText = await page.evaluate(() => document.querySelector('#content .card')?.textContent || '');
      assert.equal(/cron/i.test(cardText), true, `Expected Cron smart card, got: ${cardText}`);

      await page.evaluate(() => {
        window.monitor.push({
          id: 'pw08-curl',
          time: 2000,
          kind: 'text',
          text: 'curl -X POST https://api.example.com/v1 -d \'{"a":1}\'',
          app: 'Terminal',
        });
      });
      await page.waitFor(() => (document.querySelector('#content .card')?.textContent || '').includes('api.example.com'));
      cardText = await page.evaluate(() => document.querySelector('#content .card')?.textContent || '');
      assertContains(cardText, 'POST');
      assertContains(cardText, 'api.example.com');

      await page.click('#b-settings');
      await page.click('#stab-content');
      await page.click('#spanel-content [data-key="f.smartCron"]');
      await page.click('#s-close');

      // Cron card should now be suppressed, curl card still shown
      await page.evaluate(() => {
        const items = [...document.querySelectorAll('#hlist .item')];
        const cronRow = items.find((el) => (el.textContent || '').includes('*/15 9-17'));
        if (cronRow) cronRow.click();
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('*/15 9-17'));
      assert.equal((await page.query('#content .card')).exists, false, 'Cron card should be hidden when f.smartCron=false');

      await page.evaluate(() => {
        const items = [...document.querySelectorAll('#hlist .item')];
        const curlRow = items.find((el) => (el.textContent || '').includes('api.example.com'));
        if (curlRow) curlRow.click();
      });
      await page.waitForSelector('#content .card');

      // Test temporary ✓ feedback on #b-copy and #b-rtl
      await page.evaluate(() => {
        window.monitor.push({ id: 'pw08-heb', time: 3000, kind: 'text', text: 'שלום world', app: 'Notes' });
      });
      await page.waitFor(() => !(document.querySelector('#b-rtl')?.hidden));

      await clearSent(page);
      await page.click('#b-rtl');
      await page.waitFor(() => (document.querySelector('#b-rtl')?.textContent || '').includes('✓'));
      const rtlCopy = await waitForSent(page, 'copy');
      assert.equal(rtlCopy.text, '\u2067שלום world\u2069');
      await page.waitFor(() => !(document.querySelector('#b-rtl')?.textContent || '').includes('✓'), { timeoutMs: 4000 });

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-09',
  ['F15', 'F14', 'F27'],
  'AI Action Builder + search-bar creation intent + Follow-up + Hebrew I18N',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCKA.lang('he');
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);

      await clearSent(page);
      await page.fill('#q', 'צור פעולה שמסכמת בנקודות');
      await page.pressKey('Enter');

      // Either search-bar intent triggers actions.generate or runs ask AI
      const runOrGen = await waitForSent(page, null, (m) => m.cmd === 'run' || m.cmd === 'actions.generate');
      if (runOrGen.cmd === 'actions.generate') {
        await page.evaluate((req) => {
          window.actions.generated?.({
            req,
            action: { name: 'סיכום בנקודות', icon: 'list', prompt: 'סכם בנקודות', replaces: false },
          });
        }, runOrGen.req);
      }

      await page.evaluate(() => {
        window.actions.show({
          status: 'result',
          id: 'ask',
          query: 'סכם בנקודות',
          text: '- נקודה ראשונה\n- נקודה שנייה',
          canReplace: false,
        });
      });

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /שמור כפעולה קבועה|save as.*action/i,
      });
      const saveMsg = await waitForSent(
        page,
        null,
        (m) => m.cmd === 'actions.generate' || m.cmd === 'saveCustomAction' || (m.cmd === 'set' && m.key === 'actionsList')
      );
      assert.ok(saveMsg);

      // Follow-up input coexists cleanly in #v-work
      await fillControl(
        page,
        {
          rootSelector: '#v-work',
          placeholderRe: /follow[- ]?up|המשך|שאל|בקש|הנחיה/i,
        },
        'הוסף כותרת'
      );
      await clearSent(page);
      await page.pressKey('Enter');
      const fuMsg = await waitForSent(page, 'run');
      assert.equal(Array.isArray(fuMsg.messages), true);

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-10',
  ['F02', 'F10', 'F13'],
  'Unified model validation (enabled && !hidden && !missing) across Translation & Actions',
  async (ctx) => {
    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.evaluate(() => {
        window.monitor.aiState({
          providers: [
            {
              id: 'p1',
              name: 'EnabledProv',
              kind: 'anthropic',
              enabled: true,
              models: [
                { id: 'm1-ok', hidden: false, missing: false },
                { id: 'm2-hidden', hidden: true, missing: false },
                { id: 'm3-missing', hidden: false, missing: true },
              ],
            },
            {
              id: 'p2',
              name: 'DisabledProv',
              kind: 'ollama',
              enabled: false,
              models: [{ id: 'm4-disabled', hidden: false, missing: false }],
            },
          ],
          presets: [],
        });
        window.monitor.setSettings({
          'f.ai': true,
          'f.translate': true,
          'f.actions': true,
          translateEngine: 'llm',
          translateProvider: 'p1',
          translateModel: 'm2-hidden',
        });
      });

      await monPage.click('#b-settings');
      await monPage.click('#stab-translate');
      const trOpts = await monPage.queryAll('#spanel-translate .t-model-pick option');
      const trVals = trOpts.map((o) => o.value);
      assert.equal(trVals.includes('p1\nm1-ok'), true);
      assert.equal(trVals.some((v) => v.includes('m3-missing')), false);
      assert.equal(trVals.some((v) => v.includes('m4-disabled')), false);
      assert.equal(
        trOpts.some((o) => o.text.includes('m2-hidden') && /not available|לא זמין/i.test(o.text)),
        true,
        'Expected unavailable warning option for hidden selected translateModel'
      );

      await monPage.click('#stab-actions');
      const actOpts = await monPage.queryAll('#spanel-actions .a-model-pick option');
      const actVals = actOpts.map((o) => o.value);
      assert.equal(actVals.includes('p1\nm1-ok'), true);
      assert.equal(actVals.some((v) => v.includes('m2-hidden')), false);
      assert.equal(actVals.some((v) => v.includes('m3-missing')), false);
      assert.equal(actVals.some((v) => v.includes('m4-disabled')), false);
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      await actPage.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Sample text',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [{ value: 'p1\nm1-ok', label: 'm1-ok', group: 'EnabledProv' }],
          model: 'p1\nm1-ok',
          canReplace: true,
        });
      });
      const popOpts = await actPage.queryAll('#model option');
      assert.deepEqual(
        popOpts.map((o) => o.value),
        ['p1\nm1-ok']
      );
      assert.equal((await actPage.query('#nomodel')).visible, false);

      await actPage.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Sample text',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [],
          model: '',
          canReplace: true,
        });
      });
      assert.equal((await actPage.query('#nomodel')).visible, true);
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  }
);

suite.test(
  'T3-PW-11',
  ['F05', 'F25', 'F27'],
  'CM.menuKeys RTL/LTR navigation across Send-to & Context menus',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('en');
        window.monitor.setSettings({
          sendToApps: [
            { id: 'obsidian', name: 'Obsidian' },
            { id: 'bear', name: 'Bear' },
          ],
        });
        window.monitor.push({ id: 'pw11-item', time: Date.now(), kind: 'text', text: 'Menu navigation text', app: 'Notes' });
      });
      await page.waitFor(() => document.documentElement.dir === 'ltr');
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Menu navigation text'));

      const openCtx = async () => {
        await page.evaluate(() => {
          const c = document.querySelector('#content');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: r.left + 40,
              clientY: r.top + 40,
            })
          );
        });
        await page.waitForSelector('#ctx.show');
      };

      // LTR: ArrowRight opens submenu, ArrowLeft closes it
      await openCtx();
      for (let i = 0; i < 20; i++) {
        const txt = await page.evaluate(() => document.activeElement?.textContent || '');
        if (/send to|שלח אל/i.test(txt)) break;
        await page.pressKey('ArrowDown');
      }
      assert.equal(
        await page.evaluate(() => /send to|שלח אל/i.test(document.activeElement?.textContent || '')),
        true,
        'Send-to menu item should be reachable via ArrowDown in #ctx'
      );
      await page.pressKey('ArrowRight');
      await page.waitForSelector('#ctx .ctx-sub');
      await page.pressKey('ArrowLeft');
      await page.waitFor(() => !document.querySelector('#ctx .ctx-sub'));
      await page.pressKey('Escape');
      await page.waitFor(() => !document.querySelector('#ctx.show'));

      // RTL (Hebrew): ArrowLeft opens submenu, ArrowRight closes it, Enter dispatches sendTo
      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await openCtx();
      for (let i = 0; i < 20; i++) {
        const txt = await page.evaluate(() => document.activeElement?.textContent || '');
        if (/send to|שלח אל/i.test(txt)) break;
        await page.pressKey('ArrowDown');
      }
      await page.pressKey('ArrowLeft');
      await page.waitForSelector('#ctx .ctx-sub');
      await page.pressKey('ArrowRight');
      await page.waitFor(() => !document.querySelector('#ctx .ctx-sub'));
      await page.pressKey('ArrowLeft');
      await page.waitForSelector('#ctx .ctx-sub');

      await clearSent(page);
      for (let i = 0; i < 6; i++) {
        const txt = await page.evaluate(() => document.activeElement?.textContent || '');
        if (/Obsidian/i.test(txt)) break;
        await page.pressKey('ArrowDown');
      }
      await page.pressKey('Enter');
      const sentTo = await waitForSent(page, 'sendTo');
      assert.equal(String(sentTo.app).toLowerCase(), 'obsidian');
      assertContains(sentTo.text, 'Menu navigation text');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-12',
  ['F20', 'F27'],
  'Translation Lens (lens.html) reading/overlay + I18N RTL/LTR',
  async (ctx) => {
    const page = await openLensPage(ctx);
    try {
      await page.evaluate(() => {
        window.lens.setup({ lang: 'he', target: 'he', targets: 'he,en,fr', auto: true });
        window.lens.render({
          mode: 'reading',
          blocks: [{ text: 'שלום `code` עולם', state: 'ok' }],
          status: 'ok',
        });
      });

      assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);
      assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), true);
      const docCode = await page.evaluate(() => document.querySelector('#layer p.doc.ok code')?.textContent || '');
      assert.equal(docCode, 'code');
      assert.equal(await page.evaluate(() => document.querySelector('#layer p.doc.ok')?.getAttribute('dir')), 'auto');

      await clearSent(page);
      await page.click('#mode');
      const modeMsg = await waitForSent(page, 'set', (m) => m.key === 'lensMode');
      assert.equal(modeMsg.value, 'overlay');
      assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), false);

      await page.evaluate(() => {
        window.lens.render({
          mode: 'overlay',
          spans: [{ x: 10, y: 20, w: 140, h: 24, line: true, text: 'שלום' }],
          status: 'ok',
        });
      });
      const spanInfo = await page.evaluate(() => {
        const el = document.querySelector('#layer .t.line');
        if (!el) return null;
        return {
          text: el.textContent,
          dir: el.getAttribute('dir'),
          fontSize: parseFloat(el.style.fontSize || '0'),
        };
      });
      assert.ok(spanInfo, 'Expected .t.line overlay span');
      assert.equal(spanInfo.text, 'שלום');
      assert.equal(spanInfo.dir, 'auto');
      assert.ok(spanInfo.fontSize >= 7 && spanInfo.fontSize <= 40, `Unexpected fontSize=${spanInfo.fontSize}`);

      await page.evaluate(() => window.lens.setup({ lang: 'en', target: 'he', targets: 'he,en,fr', auto: true }));
      assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr');

      await page.evaluate(() => document.querySelector('#peek').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      assert.equal(await page.evaluate(() => document.body.classList.contains('peek')), true);
      await page.evaluate(() => document.querySelector('#peek').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      assert.equal(await page.evaluate(() => document.body.classList.contains('peek')), false);

      await clearSent(page);
      await page.evaluate(() => window.lens.status({ status: 'permission' }));
      assert.equal((await page.query('#ax')).visible, true);
      await page.click('#ax');
      await waitForSent(page, 'openAXSettings');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-13',
  ['F12', 'F22', 'F27'],
  '320px narrow viewport + 7 Settings tabs + #history drawer in RTL/LTR',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.setViewport(320, 600);
      assert.equal((await page.query('#b-theme')).exists, false, '#b-theme must be removed in M4');

      for (const lang of ['en', 'he']) {
        await page.evaluate((l) => window.MOCK.lang(l), lang);
        await page.waitFor(
          lang === 'he'
            ? () => document.documentElement.dir === 'rtl'
            : () => document.documentElement.dir === 'ltr'
        );

        await page.click('#b-settings');
        await page.waitForSelector('#settings .tabs');
        const tabIds = await page.evaluate(() =>
          [...document.querySelectorAll('#settings .tabs [role="tab"]')].map((b) => b.dataset.tab)
        );
        assert.deepEqual(tabIds, ['general', 'content', 'history', 'actions', 'translate', 'ai', 'about']);

        for (const id of tabIds) {
          await page.click(`#stab-${id}`);
          const tabMetrics = await page.evaluate((tabId) => {
            const p = document.querySelector(`#spanel-${tabId}`);
            return {
              visible: Boolean(p && !p.hidden),
              docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          }, id);
          assert.equal(tabMetrics.visible, true, `Tab panel ${id} should be visible`);
          assert.ok(tabMetrics.docOverflow <= 2, `Horizontal overflow at 320px in ${lang}/${id}: ${tabMetrics.docOverflow}`);
        }
        await page.click('#s-close');

        await page.evaluate(() => {
          window.monitor.push({ id: 'n1', time: 1001, kind: 'text', text: 'Narrow item 1', app: 'Test' });
          window.monitor.push({ id: 'n2', time: 1002, kind: 'text', text: 'Narrow item 2', app: 'Test' });
          window.monitor.push({ id: 'n3', time: 1003, kind: 'text', text: 'Narrow item 3', app: 'Test' });
        });
        await page.click('#b-hist');
        await page.waitFor(() => document.body.classList.contains('show-history'));
        const histInfo = await page.evaluate(() => ({
          searchVisible: document.querySelector('#search')?.getBoundingClientRect().width > 0,
          itemCount: document.querySelectorAll('#hlist .item').length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        assert.equal(histInfo.searchVisible, true);
        assert.ok(histInfo.itemCount >= 3);
        assert.ok(histInfo.overflow <= 2, `History drawer overflow at 320px (${lang}): ${histInfo.overflow}`);
        await page.click('#b-hist');
      }

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-14',
  ['F01', 'F16', 'F26'],
  'CLI (flip/rtl) vs local zero-AI actions (flipKeyboard/wrapRtl) parity',
  async (ctx) => {
    const iso = createIsolatedHome('tm-pw14-');
    const env = { ...process.env, HOME: iso.home, TEXTMONITOR_SUPPORT_DIR: iso.supportDir };
    const flipCorpus = ['akuo', 'loi;.', 'dwhrpv'];
    const cliFlips = [];
    const rtlInput = 'שלום world\n```\nשלום\n```';
    let cliRtl = '';
    try {
      for (const input of flipCorpus) {
        const res = await runCli(ctx.appBin, ['flip', input], { env });
        assertExitCode(res, 0);
        cliFlips.push([input, stripTrailingNewline(res.stdout)]);
      }

      const rtlRes = await runCli(ctx.appBin, ['rtl', rtlInput], { env });
      assertExitCode(rtlRes, 0);
      cliRtl = stripTrailingNewline(rtlRes.stdout);
    } finally {
      fs.rmSync(iso.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }

    const page = await openActionsPage(ctx);
    try {
      for (const [input, expected] of cliFlips) {
        await page.evaluate((src) => {
          window.MOCKA.noModels = true;
          window.MOCKA.source = src;
          window.actions.show({
            status: 'list',
            source: src,
            actions: [{ id: 'flipKeyboard', kind: 'local', replaces: true }],
            models: [],
            model: '',
            canReplace: true,
          });
        }, input);
        await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /flip|הפוך/i });
        await page.waitFor(() => !document.querySelector('#v-work')?.hidden && (document.querySelector('#text')?.textContent || '').length > 0);
        const uiOut = await page.evaluate(() => document.querySelector('#text')?.textContent || '');
        assert.equal(uiOut, expected, `Local flipKeyboard mismatch for ${input}`);
      }

      await page.evaluate((src) => {
        window.MOCKA.noModels = true;
        window.MOCKA.source = src;
        window.actions.show({
          status: 'list',
          source: src,
          actions: [{ id: 'wrapRtl', kind: 'local', replaces: true }],
          models: [],
          model: '',
          canReplace: true,
        });
      }, rtlInput);
      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /rtl/i });
      await page.waitFor(() => !document.querySelector('#v-work')?.hidden && (document.querySelector('#text')?.textContent || '').includes('\u2067'));
      const uiRtl = await page.evaluate(() =>
        [...document.querySelectorAll('#text p, #text pre, #text div')].map((n) => n.textContent).join('\n') ||
        document.querySelector('#text')?.textContent ||
        ''
      );
      assertContains(uiRtl, '\u2067שלום world\u2069');
      assert.equal(cliRtl.includes('\u2067שלום world\u2069'), true);
      assert.equal(cliRtl.includes('\u2067שלום\u2069\n```'), false);
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-15',
  ['F15', 'F12', 'F27'],
  'AI Action Builder in Settings > Text Actions + f.actions toggle + Hebrew I18N',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);

      await page.click('#b-settings');
      await page.click('#stab-actions');
      await page.click('#spanel-actions .a-seg button[data-sec="library"]');

      await clearSent(page);
      await fillControl(
        page,
        {
          rootSelector: '#spanel-actions',
          placeholderRe: /צור או התאם|תאר פעולה|create or|describe.*action|builder/i,
          titleRe: /צור או התאם|action builder/i,
        },
        'סכם ב־3 נקודות'
      );

      await page.click('#spanel-actions .lib-ai-row button');
      const genMsg = await waitForSent(page, 'actions.generate', null, 4500);
      assertContains(genMsg.request, 'סכם ב־3 נקודות');

      await page.evaluate((req) => {
        window.monitor.actionGenerated?.({
          req,
          action: { name: 'סיכום קצר', icon: 'list', prompt: '', replaces: false },
        });
      }, genMsg.req);

      const hasMissingIndicator = await page.evaluate(() => {
        const openItem = document.querySelector('#spanel-actions .lib-item.open, #spanel-actions .lib-edit');
        if (!openItem) return false;
        return Boolean(
          openItem.querySelector('[aria-invalid="true"], .missing, .err, .warn, [data-missing]') ||
            /חובה|חסר|נדרש|required|missing/i.test(openItem.textContent || '')
        );
      });
      assert.equal(hasMissingIndicator, true, 'Expected missing-field indicator when prompt is empty');

      // Turn f.actions off -> builder & library become disabled/inert
      await page.click('#spanel-actions [data-key="f.actions"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-actions .a-body');
        return body && (body.inert || body.classList.contains('off'));
      });

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-16',
  ['F03', 'F19', 'F22'],
  'Image item keyOf(it) stability + OCR + Quick Edit isolation',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      const img1 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      const img2 =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQzwAEjDAGACcqAz3f6kL4AAAAAElFTkSuQmCC';

      await page.evaluate(
        ({ a, b }) => {
          window.monitor.push({ id: 'img-1', time: 1000, kind: 'image', image: a, size: '1×1', app: 'Preview' });
          window.monitor.push({ id: 'img-2', time: 2000, kind: 'image', image: b, size: '2×2', app: 'Preview' });
          window.monitor.push({ id: 'txt-1', time: 3000, kind: 'text', text: 'Original text item', app: 'Notes' });
        },
        { a: img1, b: img2 }
      );

      // Select img-2 via #hlist
      await page.click('#b-hist');
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const row2 = rows.find((r) => (r.textContent || '').includes('2×2'));
        if (!row2) throw new Error('img-2 row not found');
        row2.click();
      });
      await page.waitForSelector('#content img');

      await clearSent(page);
      await clickControl(page, { rootSelector: '#content', textRe: /חלץ טקסט|extract text|\bocr\b/i });
      await waitForSent(page, 'ocr', (m) => m.id === 'img-2');
      await page.evaluate(() => window.monitor.ocrResult({ id: 'img-2', text: 'OCR extracted line' }));
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('OCR extracted line'));

      // Switch to txt-1, Quick Edit it
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const rowTxt = rows.find((r) => (r.textContent || '').includes('Original text item'));
        if (!rowTxt) throw new Error('txt-1 row not found');
        rowTxt.click();
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Original text item'));
      await page.pressKey('e', { modifiers: ['Meta'] });
      await fillControl(
        page,
        { rootSelector: '#content', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'Edited txt-1'
      );
      await clickControl(page, { rootSelector: '#content', textRe: /^(save|שמור|done|סיום)$/i });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Edited txt-1'));

      // Switch to img-1 (must NOT have img-2 OCR text) then back to img-2 (must keep OCR text)
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const row1 = rows.find((r) => (r.textContent || '').includes('1×1'));
        if (!row1) throw new Error('img-1 row not found');
        row1.click();
      });
      await page.waitForSelector('#content img');
      assertNotContains(await page.evaluate(() => document.querySelector('#content')?.textContent || ''), 'OCR extracted line');

      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const row2 = rows.find((r) => (r.textContent || '').includes('2×2'));
        if (!row2) throw new Error('img-2 row not found');
        row2.click();
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('OCR extracted line'));
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-17',
  ['F10', 'F13', 'F14'],
  'Quick Translate -> Back -> Streaming Action -> Diff toggle',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.actions.setup({ lang: 'en', margin: 10, target: 'he', targets: 'he,en,fr' });
        window.actions.show({
          status: 'quickTranslate',
          mode: 'quickTranslate',
          source: 'We shipped v1.2 yesterday.',
          text: 'שחררנו את גרסה 1.2 אתמול.',
          target: 'he',
          targets: 'he,en,fr',
          canReplace: true,
        });
      });
      assert.equal((await page.query('#target')).visible, true);

      await clearSent(page);
      await page.click('#back');
      await waitForSent(page, 'back');

      await page.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'We shipped v1.2 yesterday.',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [{ value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' }],
          model: 'p1\nclaude-sonnet-5-5',
          canReplace: true,
        });
      });

      assert.equal((await page.query('#target')).visible, false);
      assert.equal((await page.query('#open-monitor')).visible, false);
      assert.equal((await page.query('#src')).visible, false);

      await page.evaluate(() => {
        window.actions.show({ status: 'running', id: 'improve' });
        window.actions.show({ status: 'streaming', id: 'improve', text: 'We released' });
        window.actions.show({ status: 'result', id: 'improve', text: 'We released v1.2 yesterday.', canReplace: true });
      });

      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /^(diff|הבדלים|השווה)$/i,
        titleRe: /diff|הבדלים|שינויים/i,
      });
      const diffHtml = await page.evaluate(() => document.querySelector('#v-work')?.innerHTML || '');
      assert.equal(/shipped|released/i.test(diffHtml), true);

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-18',
  ['F21', 'F25', 'F27'],
  'Cron & curl Smart Cards + Send-to + Hebrew UI',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('he');
        window.monitor.setSettings({
          sendToApps: [{ id: 'shortcuts', name: 'Shortcuts' }],
        });
        window.monitor.push({ id: 'pw18-cron', time: 1000, kind: 'text', text: '0 8 * * 1-5', app: 'Notes' });
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await page.waitForSelector('#content .card');

      await page.evaluate(() => {
        window.monitor.push({ id: 'pw18-curl', time: 2000, kind: 'text', text: 'curl https://example.com/api', app: 'Notes' });
      });
      await page.waitFor(() => (document.querySelector('#content .card')?.textContent || '').includes('example.com/api'));

      await clearSent(page);
      await page.evaluate(() => {
        const c = document.querySelector('#content');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }));
      });
      await page.waitForSelector('#ctx.show');
      await clickControl(page, { rootSelector: '#ctx', textRe: /send to|שלח אל/i });
      await page.waitForSelector('#ctx .ctx-sub');
      await clickControl(page, { rootSelector: '#ctx .ctx-sub', textRe: /Shortcuts/i });

      const sentTo = await waitForSent(page, 'sendTo');
      assert.equal(String(sentTo.app).toLowerCase(), 'shortcuts');
      assertContains(sentTo.text, 'curl https://example.com/api');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-19',
  ['F09', 'F17', 'F22'],
  'flipHotkey recording (CM.hotkeyRecorder) + Empty State active shortcuts display',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      // Delete any preloaded item so Empty State is displayed
      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('#hlist .item')]) {
          const it = el.item;
          if (it) window.monitor.applyOp({ op: 'delete', key: it.id || String(it.time) });
        }
      });
      await page.waitForSelector('#content .empty');

      await page.click('#b-settings');
      await page.click('#stab-actions');
      const flipRecSel = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('#spanel-actions .hk-rec')];
        if (btns.length < 2) return null;
        btns[1].id = 'e2e-pw19-flip';
        return '#e2e-pw19-flip';
      });
      assert.ok(flipRecSel, 'Expected flipHotkey recorder in Settings > Text Actions');

      await clearSent(page);
      await page.click(flipRecSel);
      await page.pressKey('f', { modifiers: ['Ctrl', 'Meta'] });
      const msg = await waitForSent(page, 'set', (m) => m.key === 'flipHotkey');
      assert.equal(msg.value, 'ctrl+cmd+KeyF');
      assert.equal((await page.query(flipRecSel)).text, '⌃⌘F');

      await page.click('#s-close');
      await page.waitForSelector('#content .empty');
      const emptyText = await page.evaluate(() => document.querySelector('#content .empty')?.textContent || '');
      assertContains(emptyText, '⌃⌘F', 'Expected updated flipHotkey label ⌃⌘F in Empty State');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-20',
  ['F16', 'F13', 'F14'],
  'Local zero-AI action vs AI streaming action + Edit / Follow-up behavior',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCKA.noModels = false;
        window.MOCKA.source = 'hello   world';
        window.actions.show({
          status: 'list',
          source: 'hello   world',
          actions: [
            { id: 'cleanSpaces', kind: 'local', replaces: true },
            { id: 'summarize', kind: 'builtin', replaces: false },
          ],
          models: [{ value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' }],
          model: 'p1\nclaude-sonnet-5-5',
          canReplace: true,
        });
      });

      await clearSent(page);
      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /clean|spaces|רווחים/i });
      await page.waitFor(() => !document.querySelector('#v-work')?.hidden && (document.querySelector('#text')?.textContent || '').includes('hello world'));
      await waitForSent(page, 'run', (m) => m.id === 'cleanSpaces');

      await clickControl(page, { rootSelector: '#v-work', textRe: /^(edit|ערוך)$/i });
      await fillControl(
        page,
        { rootSelector: '#v-work', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'hello clean world'
      );
      await clearSent(page);
      await page.click('#copy');
      const copyMsg = await waitForSent(page, 'copy');
      assert.equal(copyMsg.text, 'hello clean world');

      await page.click('#back');
      await page.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Long paragraph for summarize.',
          actions: [
            { id: 'cleanSpaces', kind: 'local', replaces: true },
            { id: 'summarize', kind: 'builtin', replaces: false },
          ],
          models: [{ value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' }],
          model: 'p1\nclaude-sonnet-5-5',
          canReplace: true,
        });
      });

      await page.evaluate(() => {
        window.actions.show({ status: 'running', id: 'summarize' });
        window.actions.show({ status: 'streaming', id: 'summarize', text: 'Summary v1' });
        window.actions.show({ status: 'result', id: 'summarize', text: 'Summary v1 complete.', canReplace: false });
      });

      await clearSent(page);
      await fillControl(
        page,
        { rootSelector: '#v-work', placeholderRe: /follow[- ]?up|המשך|שאל|בקש|הנחיה/i },
        'Make shorter'
      );
      await page.pressKey('Enter');
      const fu = await waitForSent(page, 'run', (m) => Array.isArray(m.messages) && m.messages.length >= 2);
      assertContains(fu.messages[fu.messages.length - 1].content, 'Make shorter');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-21',
  ['F23', 'F26', 'F27'],
  'textmonitor://push UTF-8 Hebrew + IPC history + APP_BIN rtl parity',
  async (ctx) => {
    const gui = await getSharedEphemeralGui(ctx);
    const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
    const marker1 = `בדיקת_URL_עברית_${Date.now()}`;
    const marker2 = `שלום_x_callback_${Date.now()}`;

    await deliverIsolatedUrl(gui, `textmonitor://push?text=${encodeURIComponent(marker1)}`);
    await deliverIsolatedUrl(gui, `textmonitor://x-callback-url/push?text=${encodeURIComponent(marker2)}&x-source=e2e`);

    await pollCliHistory(ctx, gui, marker1);
    await pollCliHistory(ctx, gui, marker2);

    const rtlRes = await runCli(ctx.appBin, ['rtl', marker1], { env });
    assertExitCode(rtlRes, 0);
    assert.equal(stripTrailingNewline(rtlRes.stdout), `\u2067${marker1}\u2069`);
  },
  { timeoutMs: 35000 }
);

suite.test(
  'T3-PW-22',
  ['F02', 'F12', 'F15'],
  'Model validation + f.ai master toggle + AI Action Builder availability',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.monitor.aiState({
          providers: [
            {
              id: 'p1',
              name: 'Anthropic',
              kind: 'anthropic',
              enabled: true,
              models: [{ id: 'claude-sonnet-5-5', hidden: false, missing: false }],
            },
          ],
          presets: [],
        });
        window.monitor.setSettings({ 'f.ai': false, translateEngine: 'llm' });
      });

      await page.click('#b-settings');
      await page.click('#stab-translate');
      assert.equal((await page.query('#spanel-translate .t-ai-off')).visible, true);
      assert.equal((await page.query('#spanel-translate .t-model')).visible, false);

      await page.click('#stab-actions');
      await page.click('#spanel-actions .a-seg button[data-sec="library"]');
      // With f.ai=false, builder should either be disabled or show an AI-disabled notice
      const builderOff = await page.evaluate(() => {
        const panel = document.querySelector('#spanel-actions');
        if (!panel) return false;
        const inp = [...panel.querySelectorAll('input, textarea')].find((el) =>
          /צור או התאם|תאר פעולה|create or|describe.*action|builder/i.test(el.placeholder || el.title || el.getAttribute('aria-label') || '')
        );
        const notice = /turn on ai|הפעל ai|ai.*off|כבוי/i.test(panel.textContent || '');
        return Boolean((inp && (inp.disabled || inp.hidden)) || notice);
      });
      assert.equal(builderOff, true, 'Expected AI Action Builder to be disabled or show AI-off notice when f.ai=false');

      await page.click('#stab-ai');
      await page.click('#spanel-ai [data-act="toggle-ai"]');
      await page.waitFor(() => window.CM.S['f.ai'] === true);

      await page.click('#stab-translate');
      assert.equal((await page.query('#spanel-translate .t-ai-off')).visible, false);
      assert.equal((await page.query('#spanel-translate .t-model')).visible, true);
      const opts = await page.queryAll('#spanel-translate .t-model-pick option');
      assert.equal(opts.some((o) => o.value === 'p1\nclaude-sonnet-5-5'), true);

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-23',
  ['F03', 'F10', 'F22'],
  'keyOf(it) ID collision guard + Quick Edit + Open in TextMonitor (translateTo)',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.monitor.push({ id: 'id-1', time: 1000, kind: 'text', text: 'First item', app: 'Notes' });
        window.monitor.push({ id: 'id-2', time: 1000, kind: 'text', text: 'Second item', app: 'Notes' });
      });
      await page.click('#b-hist');
      await page.waitFor(() => {
        const t = document.querySelector('#hlist')?.textContent || '';
        return t.includes('First item') && t.includes('Second item');
      });

      await clearSent(page);
      await page.evaluate(() => {
        window.monitor.push({
          id: 'id-qt',
          time: 2000,
          kind: 'text',
          text: 'Hello world',
          translateTo: 'he',
          app: 'Safari',
        });
      });
      const trMsg = await waitForSent(page, 'translate', (m) => m.target === 'he' && m.text === 'Hello world');
      assert.equal(trMsg.target, 'he');

      // Select id-1, Quick Edit it, verify id-2 remains verbatim
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const r1 = rows.find((r) => (r.textContent || '').includes('First item'));
        if (!r1) throw new Error('id-1 not found');
        r1.click();
      });
      await page.pressKey('e', { modifiers: ['Meta'] });
      await fillControl(
        page,
        { rootSelector: '#content', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'First item edited'
      );
      await clickControl(page, { rootSelector: '#content', textRe: /^(save|שמור|done|סיום)$/i });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('First item edited'));

      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#hlist .item')];
        const r2 = rows.find((r) => (r.textContent || '').includes('Second item'));
        if (!r2) throw new Error('id-2 not found');
        r2.click();
      });
      assertContains(await page.evaluate(() => document.querySelector('#content')?.textContent || ''), 'Second item');

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-24',
  ['F05', 'F12', 'F27'],
  'Settings tablist keyboard RTL/LTR + Context menu CM.menuKeys RTL/LTR',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('en'));
      await page.waitFor(() => document.documentElement.dir === 'ltr');
      await page.click('#b-settings');
      await page.waitForSelector('#stab-general');
      await page.evaluate(() => document.querySelector('#stab-general').focus());
      await page.pressKey('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.tab), 'content');
      await page.pressKey('End');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.tab), 'about');
      await page.pressKey('Home');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.tab), 'general');

      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await page.evaluate(() => document.querySelector('#stab-general').focus());
      await page.pressKey('ArrowLeft');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.tab), 'content');
      await page.pressKey('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.tab), 'general');
      await page.click('#s-close');

      await page.evaluate(() => {
        document.querySelector('#b-raw')?.focus();
        const c = document.querySelector('#content');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }));
      });
      await page.waitForSelector('#ctx.show');
      await page.pressKey('End');
      assert.equal(await page.evaluate(() => document.activeElement?.classList?.contains('danger')), true);
      await page.pressKey('Home');
      await page.pressKey('Escape');
      await page.waitFor(() => !document.querySelector('#ctx.show'));

      const errs = page.getErrors();
      assert.deepEqual(errs.allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-25',
  ['F09', 'F12', 'F27'],
  'CM.hotkeyRecorder across all 5 shortcuts in Hebrew RTL (dir=ltr, validation, clear)',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');

      await page.click('#b-settings');
      const testRecorder = async (tab, setupFn, keyName, settingKey) => {
        await page.click(`#stab-${tab}`);
        const ids = await page.evaluate(setupFn);
        assert.ok(ids?.rec && ids?.clr, `Missing recorder controls for ${settingKey}`);

        // Bare key without modifier -> needMod
        await page.click(ids.rec);
        await page.pressKey('k');
        const needModText = await page.evaluate((s) => document.querySelector(s)?.textContent || '', ids.rec);
        assertContains(needModText, '⌃');
        assert.equal(await page.evaluate((s) => document.querySelector(s)?.getAttribute('dir'), ids.rec), null);

        // Ctrl+Alt+KeyJ -> dir="ltr" and ⌃⌥J
        await clearSent(page);
        await page.pressKey('j', { modifiers: ['Ctrl', 'Alt'] });
        const setMsg = await waitForSent(page, 'set', (m) => m.key === settingKey);
        assert.equal(setMsg.value, 'ctrl+opt+KeyJ');
        const recState = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return { text: el?.textContent || '', dir: el?.getAttribute('dir') || '' };
        }, ids.rec);
        assert.equal(recState.text, '⌃⌥J');
        assert.equal(recState.dir, 'ltr');

        // Clear -> 'off' / 'כבוי'
        await clearSent(page);
        await page.click(ids.clr);
        const offMsg = await waitForSent(page, 'set', (m) => m.key === settingKey && m.value === 'off');
        assert.equal(offMsg.value, 'off');
        const offText = await page.evaluate((s) => document.querySelector(s)?.textContent || '', ids.rec);
        assert.equal(offText, 'כבוי');
      };

      await testRecorder(
        'general',
        () => {
          const r = document.querySelector('#row-hotkey .hk-rec');
          const c = document.querySelector('#row-hotkey .hk-clear');
          if (!r || !c) return null;
          r.id = 'e2e-he-r1';
          c.id = 'e2e-he-c1';
          return { rec: '#e2e-he-r1', clr: '#e2e-he-c1' };
        },
        'j',
        'hotkey'
      );

      await testRecorder(
        'actions',
        () => {
          const rs = [...document.querySelectorAll('#spanel-actions .hk-rec')];
          const cs = [...document.querySelectorAll('#spanel-actions .hk-clear')];
          if (rs.length < 2 || cs.length < 2) return null;
          rs[0].id = 'e2e-he-r2';
          cs[0].id = 'e2e-he-c2';
          rs[1].id = 'e2e-he-r3';
          cs[1].id = 'e2e-he-c3';
          return { rec: '#e2e-he-r2', clr: '#e2e-he-c2' };
        },
        'j',
        'actionsHotkey'
      );

      await testRecorder('actions', () => ({ rec: '#e2e-he-r3', clr: '#e2e-he-c3' }), 'j', 'flipHotkey');

      await testRecorder(
        'translate',
        () => {
          const r = document.querySelector('#spanel-translate .f-hk[data-for="bubble"] .hk-rec');
          const c = document.querySelector('#spanel-translate .f-hk[data-for="bubble"] .hk-clear');
          if (!r || !c) return null;
          r.id = 'e2e-he-r4';
          c.id = 'e2e-he-c4';
          return { rec: '#e2e-he-r4', clr: '#e2e-he-c4' };
        },
        'j',
        'bubbleHotkey'
      );

      await testRecorder(
        'translate',
        () => {
          const r = document.querySelector('#spanel-translate .f-hk[data-for="lens"] .hk-rec');
          const c = document.querySelector('#spanel-translate .f-hk[data-for="lens"] .hk-clear');
          if (!r || !c) return null;
          r.id = 'e2e-he-r5';
          c.id = 'e2e-he-c5';
          return { rec: '#e2e-he-r5', clr: '#e2e-he-c5' };
        },
        'j',
        'lensHotkey'
      );
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-26',
  ['F13', 'F14', 'F25'],
  'Streaming Markdown -> Edit mode -> Send-to dispatches edited text',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.actions.setup({
          lang: 'en',
          margin: 10,
          sendToApps: [{ id: 'drafts', name: 'Drafts' }],
        });
        window.actions.show({
          status: 'list',
          source: 'Draft source',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [{ value: 'p1\nclaude-sonnet-5-5', label: 'claude-sonnet-5-5', group: 'Anthropic' }],
          model: 'p1\nclaude-sonnet-5-5',
          canReplace: true,
        });
      });

      await page.evaluate(() => {
        window.actions.show({ status: 'running', id: 'improve' });
        window.actions.show({ status: 'streaming', id: 'improve', text: '**Draft** v1' });
        window.actions.show({ status: 'result', id: 'improve', text: 'Draft v1', canReplace: true });
      });

      await clickControl(page, { rootSelector: '#v-work', textRe: /^(edit|ערוך)$/i });
      await fillControl(
        page,
        { rootSelector: '#v-work', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'Draft v2 (final)'
      );

      await clearSent(page);
      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /send to|שלח אל/i,
        titleRe: /send to|שלח אל/i,
      });
      await clickControl(page, { textRe: /Drafts/i });
      const sentTo = await waitForSent(page, 'sendTo');
      assert.equal(String(sentTo.app).toLowerCase(), 'drafts');
      assert.equal(sentTo.text, 'Draft v2 (final)');

      await clearSent(page);
      await page.click('#copy');
      const copyMsg = await waitForSent(page, 'copy');
      assert.equal(copyMsg.text, 'Draft v2 (final)');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-27',
  ['F15', 'F16', 'F27'],
  'Local actions (flipKeyboard, wrapRtl, cleanSpaces) localized titles + library persistence',
  async (ctx) => {
    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.click('#b-settings');
      await monPage.click('#stab-actions');
      await monPage.click('#spanel-actions .a-seg button[data-sec="library"]');
      await monPage.click('#spanel-actions .lib-btns button');

      await clearSent(monPage);
      const moveDown = await monPage.evaluate(() => document.querySelectorAll('#spanel-actions .lib-item .lib-move')[1] ? true : false);
      assert.equal(moveDown, true);
      await monPage.evaluate(() => {
        const items = [...document.querySelectorAll('#spanel-actions .lib-item')];
        items[0].querySelectorAll('.lib-move')[1].click();
      });
      const listMsg = await waitForSent(monPage, 'set', (m) => m.key === 'actionsList');
      const parsed = JSON.parse(listMsg.value);
      assert.equal(Array.isArray(parsed) && parsed.length > 0, true);
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      for (const lang of ['en', 'he']) {
        await actPage.evaluate((l) => {
          window.actions.setup({ lang: l, margin: 10 });
          window.actions.show({
            status: 'list',
            source: 'akuo',
            actions: [
              { id: 'flipKeyboard', kind: 'local', replaces: true },
              { id: 'wrapRtl', kind: 'local', replaces: true },
              { id: 'cleanSpaces', kind: 'local', replaces: true },
            ],
            models: [],
            model: '',
            canReplace: true,
          });
        }, lang);
        assert.deepEqual(await actPage.evaluate(() => window.I18N.missing('he')), []);
        const labels = await actPage.evaluate(() =>
          [...document.querySelectorAll('#list .item .label')].map((el) => el.textContent.trim())
        );
        assert.equal(labels.length, 3);
        assert.equal(labels.every((t) => t.length > 0 && !/untitled|ללא שם/i.test(t)), true, `Localized local titles in ${lang}: ${labels.join(', ')}`);

        await actPage.fill('#q', lang === 'he' ? 'הפוך' : 'flip');
        const filtered = await actPage.queryAll('#list .item');
        assert.equal(filtered.length >= 1, true);
      }
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  }
);

suite.test(
  'T3-PW-28',
  ['F18', 'F19', 'F20'],
  'Vision OCR linkage contract + Monitor ocrResult error/success + Lens OCR fallback blocks',
  async (ctx) => {
    const frameworks = await otoolLinkedFrameworks(ctx.appBin);
    assert.equal(
      frameworks.some((f) => /Vision\.framework/i.test(f)),
      true,
      `Expected Vision.framework in ${ctx.appBin}, got: ${frameworks.join(', ')}`
    );
    assert.equal(
      frameworks.some((f) => /ScreenCaptureKit\.framework/i.test(f)),
      true,
      `Expected ScreenCaptureKit.framework in ${ctx.appBin}, got: ${frameworks.join(', ')}`
    );

    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.evaluate(() => {
        window.monitor.push({
          id: 'img-pw28',
          time: Date.now(),
          kind: 'image',
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          size: '100×50',
          app: 'Preview',
        });
      });
      await clickControl(monPage, { rootSelector: '#content', textRe: /חלץ טקסט|extract text|\bocr\b/i });
      await waitForSent(monPage, 'ocr', (m) => m.id === 'img-pw28');

      await monPage.evaluate(() => window.monitor.ocrResult({ id: 'img-pw28', error: 'No text found' }));
      await monPage.waitFor(() => /No text found/i.test(document.querySelector('#content')?.textContent || ''));

      await monPage.evaluate(() => window.monitor.ocrResult({ id: 'img-pw28', text: 'Detected OCR line' }));
      await monPage.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Detected OCR line'));
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const lensPage = await openLensPage(ctx);
    try {
      await lensPage.evaluate(() => {
        window.lens.setup({ lang: 'en', target: 'he', targets: 'he,en', auto: true });
        window.lens.render({
          mode: 'reading',
          blocks: [{ text: 'Detected OCR line', state: 'ok' }],
          status: 'ok',
        });
      });
      assertContains(await lensPage.evaluate(() => document.querySelector('#layer')?.textContent || ''), 'Detected OCR line');
      assert.deepEqual(lensPage.getErrors().allErrors, []);
    } finally {
      await lensPage.close();
    }
  }
);

suite.test(
  'T3-PW-29',
  ['F21', 'F03', 'F27'],
  'Smart Card switching (Cron, curl, JWT, Hebrew Markdown) + keyOf(it) + I18N',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const pay = Buffer.from(JSON.stringify({ sub: '123', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const jwt = `${hdr}.${pay}.sig`;

      await page.evaluate((jwtStr) => {
        window.monitor.push({ id: 'sc-cron', time: 1001, kind: 'text', text: '*/5 * * * *', app: 'Term' });
        window.monitor.push({ id: 'sc-curl', time: 1002, kind: 'text', text: 'curl https://api.example.com/users', app: 'Term' });
        window.monitor.push({ id: 'sc-jwt', time: 1003, kind: 'text', text: jwtStr, app: 'Term' });
        window.monitor.push({ id: 'sc-md', time: 1004, kind: 'text', text: '# כותרת\nשלום **עולם**', app: 'Notes' });
      }, jwt);

      await page.click('#b-hist');
      for (const lang of ['en', 'he']) {
        await page.evaluate((l) => window.MOCK.lang(l), lang);
        await page.waitFor(
          lang === 'he'
            ? () => document.documentElement.dir === 'rtl'
            : () => document.documentElement.dir === 'ltr'
        );

        const checks = [
          ['*/5 * * * *', /cron/i],
          ['api.example.com/users', /curl/i],
          ['eyJ', /jwt/i],
          ['כותרת', /markdown/i],
        ];
        for (const [needle, kindRe] of checks) {
          await page.evaluate((n) => {
            const row = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes(n));
            if (!row) throw new Error(`Missing row ${n}`);
            row.click();
          }, needle);
          await page.waitFor(`/${kindRe.source}/i.test(document.querySelector('#kind')?.textContent || '')`);
        }
      }
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-30',
  ['F22', 'F25', 'F27'],
  'Header Copy / Copy RTL ✓ feedback + Context menu Send-to + f.copyRtl guard',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('he');
        window.monitor.setSettings({ sendToApps: [{ id: 'obsidian', name: 'Obsidian' }] });
        window.monitor.push({ id: 'pw30-1', time: Date.now(), kind: 'text', text: 'שלום world', app: 'Notes' });
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await page.waitFor(() => !(document.querySelector('#b-rtl')?.hidden));

      await clearSent(page);
      await page.click('#b-copy');
      await page.waitFor(() => (document.querySelector('#b-copy')?.textContent || '').includes('✓'));
      assert.equal((await waitForSent(page, 'copy')).text, 'שלום world');

      await clearSent(page);
      await page.click('#b-rtl');
      await page.waitFor(() => (document.querySelector('#b-rtl')?.textContent || '').includes('✓'));
      assert.equal((await waitForSent(page, 'copy')).text, '\u2067שלום world\u2069');

      // Disable f.copyRtl -> #b-rtl hidden and RTL copy items absent from #ctx, while Send-to stays
      await page.click('#b-settings');
      await page.click('#stab-content');
      await page.click('#spanel-content [data-key="f.copyRtl"]');
      await page.click('#s-close');

      assert.equal((await page.query('#b-rtl')).visible, false);
      await page.evaluate(() => {
        const c = document.querySelector('#content');
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 30 }));
      });
      await page.waitForSelector('#ctx.show');
      const menuLabels = await page.evaluate(() =>
        [...document.querySelectorAll('#ctx > .mi')].map((m) => m.textContent.trim())
      );
      assert.equal(menuLabels.some((l) => /RTL/i.test(l)), false, 'Copy with RTL marks must be hidden when f.copyRtl=false');
      assert.equal(menuLabels.some((l) => /send to|שלח אל/i.test(l)), true, 'Send-to submenu must remain active');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-31',
  ['F23', 'F24', 'F08'],
  'Info.plist URL scheme (textmonitor://) + NSServices + 1.2.0 bundle & codesign parity',
  async (ctx) => {
    const repoPlist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
    const bundlePlistPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
    assert.equal(fs.existsSync(bundlePlistPath), true, `Missing built Info.plist at ${bundlePlistPath}`);
    const bundlePlist = await readPlistJson(bundlePlistPath);

    for (const plist of [repoPlist, bundlePlist]) {
      assert.equal(plist.LSMinimumSystemVersion, '13.0');
      assert.equal(plist.CFBundleShortVersionString, '1.2.0');
      const schemes = (plist.CFBundleURLTypes || []).flatMap((u) => u.CFBundleURLSchemes || []);
      assert.equal(schemes.includes('textmonitor'), true, 'CFBundleURLTypes must declare textmonitor scheme');
      const services = plist.NSServices || [];
      assert.ok(services.length >= 4, `Expected >= 4 NSServices entries, got ${services.length}`);
      const withReturn = services.filter((s) => Array.isArray(s.NSReturnTypes) && s.NSReturnTypes.length > 0);
      assert.ok(withReturn.length >= 2, 'Expected NSReturnTypes on Flip & Wrap NSServices');
    }

    const cs = await verifyCodesign(ctx.appBundle);
    assert.equal(cs.ok, true, `codesign --verify failed: ${cs.stderr}`);
  }
);

suite.test(
  'T3-PW-32',
  ['F26', 'F01', 'F24'],
  'CLI flip/rtl + MCP flip_keyboard_text/wrap_rtl_text + ServicesMenu.strings parity',
  async (ctx) => {
    const enStrings = await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'en.lproj', 'ServicesMenu.strings'));
    const heStrings = await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'he.lproj', 'ServicesMenu.strings'));
    assert.deepEqual(Object.keys(enStrings).sort(), Object.keys(heStrings).sort(), 'ServicesMenu.strings key mismatch');
    assert.ok(Object.keys(enStrings).length >= 4, 'Expected >= 4 entries in ServicesMenu.strings');

    const iso = createIsolatedHome('tm-pw32-');
    const env = { ...process.env, HOME: iso.home, TEXTMONITOR_SUPPORT_DIR: iso.supportDir };
    const mcp = await createMcpClient(ctx.appBin, { env });
    try {
      await mcp.initialize();
      mcp.notify('notifications/initialized', {});
      for (const input of ["akuo' guko/", 'שלום, עולם.']) {
        const cliFlip = await runCli(ctx.appBin, ['flip', input], { env });
        assertExitCode(cliFlip, 0);
        const mcpFlip = await mcp.callTool('flip_keyboard_text', { text: input });
        assert.equal(extractMcpText(mcpFlip).trim(), stripTrailingNewline(cliFlip.stdout));

        const cliRtl = await runCli(ctx.appBin, ['rtl', input], { env });
        assertExitCode(cliRtl, 0);
        const mcpRtl = await mcp.callTool('wrap_rtl_text', { text: input });
        assert.equal(extractMcpText(mcpRtl).replace(/\r?\n$/, ''), stripTrailingNewline(cliRtl.stdout));
      }
    } finally {
      await mcp.close();
      fs.rmSync(iso.home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
);

suite.test(
  'T3-PW-33',
  ['F12', 'F17', 'F22'],
  'f.actions toggle disables flipHotkey while Empty State / CM.S preserves config',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('en'));
      await page.waitFor(() => document.documentElement.dir === 'ltr');
      await page.click('#b-settings');
      await page.click('#stab-actions');
      const recSel = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('#spanel-actions .hk-rec')];
        if (btns.length < 2) return null;
        btns[1].id = 'e2e-pw33-flip';
        return '#e2e-pw33-flip';
      });
      assert.ok(recSel, 'Missing flipHotkey recorder in Settings > Text Actions');

      await page.click(recSel);
      await page.pressKey('l', { modifiers: ['Ctrl', 'Alt'] });
      await waitForSent(page, 'set', (m) => m.key === 'flipHotkey' && m.value === 'ctrl+opt+KeyL');

      await page.click('#spanel-actions [data-key="f.actions"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-actions .a-body');
        return body && (body.inert || body.classList.contains('off'));
      });
      assert.equal(await page.evaluate(() => window.CM.S.flipHotkey), 'ctrl+opt+KeyL');

      await page.click('#spanel-actions [data-key="f.actions"]');
      await page.waitFor(() => {
        const body = document.querySelector('#spanel-actions .a-body');
        return body && !body.inert && !body.classList.contains('off');
      });
      assert.equal((await page.query(recSel)).text, '⌃⌥L');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  }
);

suite.test(
  'T3-PW-34',
  ['F28', 'F04', 'F06', 'F11'],
  'Isolated dev/preview.sh + zero dead CSS / bubble.* / settings-features.* / customActions leaks',
  async (ctx) => {
    const saCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings-actions.css'), 'utf8');
    const saSel = extractCssSelectors(saCss);
    for (const dead of ['.ca-del', '.a-custom-hint', '.ca', '.ca-head']) {
      assert.equal(hasCssClassToken(saSel, dead), false, `Dead selector ${dead} found in settings-actions.css`);
    }

    const abCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings-about.css'), 'utf8');
    assert.equal(hasCssClassToken(extractCssSelectors(abCss), '.about-copy'), false);

    const appCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'app.css'), 'utf8');
    assert.equal(
      extractCssSelectors(appCss).some((s) => /\.chip\.held(?![A-Za-z0-9_-])/.test(s)),
      false,
      'Dead .chip.held found in app.css'
    );

    for (const removed of [
      'Resources/bubble.html',
      'Resources/bubble.js',
      'Resources/bubble.css',
      'Resources/settings-features.js',
      'Resources/settings-features.css',
      'Sources/Lens/BubbleController.swift',
    ]) {
      assert.equal(fs.existsSync(path.join(ctx.repoRoot, removed)), false, `Removed file still exists: ${removed}`);
    }

    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.click('#b-settings');
      for (const tab of ['general', 'content', 'history', 'actions', 'translate', 'ai', 'about']) {
        await monPage.click(`#stab-${tab}`);
      }
      assert.equal((await monPage.query('#stab-features')).exists, false);
      assert.equal(await monPage.evaluate(() => 'customActions' in window.CM.S), false);
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      await actPage.click('#list .item');
      await actPage.waitFor(() => !document.querySelector('#v-work')?.hidden && !(document.querySelector('#result-foot')?.hidden));
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  }
);

await suite.run();
