import {
  assert,
  assertContains,
  assertExitCode,
  createSuite,
} from '../lib/test_harness.mjs';
import {
  createMcpClient,
  deliverIsolatedUrl,
  probeUnixSocket,
  runCli,
  startIsolatedApp,
} from '../lib/cli_mcp.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const suite = createSuite({
  name: 't4_scenarios',
  tier: 4,
  description: 'E2E-M3 Tier 4: End-to-End Real-World User Workflows (SC-01..SC-15)',
});

// ---------------------------------------------------------------------------
// Lazy shared browser/preview fixtures (zero side effects at import time)
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

suite.afterAll(async (ctx) => {
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
// Tier 4 Real-World User Scenarios (T4-SC-01 .. T4-SC-15)
// ===========================================================================

suite.test(
  'T4-SC-01',
  ['F01', 'F23', 'F26'],
  'SC-01: End-to-end CLI -> IPC -> History round-trip with ephemeral bundle',
  async (ctx) => {
    const gui = await startIsolatedApp(ctx, { prefix: 'tm-sc01-', ephemeralBundle: true });
    try {
      const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
      const probe = await probeUnixSocket(gui.sockPath);
      assert.equal(probe.exists, true);
      assert.equal(probe.isSocket, true);
      assert.equal(probe.mode, 0o600, `Expected 0600 socket permissions, got ${probe.modeOctal}`);
      assert.equal(probe.connected, true);

      const flipRes = await runCli(ctx.appBin, ['flip', 'akuo'], { env });
      assertExitCode(flipRes, 0);
      assert.equal(stripTrailingNewline(flipRes.stdout), 'שלום');

      const rtlRes = await runCli(ctx.appBin, ['rtl', 'שלום עולם'], { env });
      assertExitCode(rtlRes, 0);
      assert.equal(stripTrailingNewline(rtlRes.stdout), '\u2067שלום עולם\u2069');

      await deliverIsolatedUrl(gui, 'textmonitor://push?text=SC01_ASCII_ITEM');
      await deliverIsolatedUrl(
        gui,
        `textmonitor://x-callback-url/push?text=${encodeURIComponent('שלום_SC01')}&x-source=e2e`
      );

      await pollCliHistory(ctx, gui, 'SC01_ASCII_ITEM');
      await pollCliHistory(ctx, gui, 'שלום_SC01');

      const showRes = await runCli(ctx.appBin, ['show'], { env, timeoutMs: 2500 });
      assertExitCode(showRes, 0);
      assert.equal(gui.isAlive(), true);
    } finally {
      await gui.stop();
    }
  },
  { timeoutMs: 45000 }
);

suite.test(
  'T4-SC-02',
  ['F01', 'F26'],
  'SC-02: MCP client session lifecycle (initialize -> tools/list -> transform & IPC tools -> EOF)',
  async (ctx) => {
    const gui = await startIsolatedApp(ctx, { prefix: 'tm-sc02-' });
    try {
      const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
      const mcp = await createMcpClient(ctx.appBin, { env });
      try {
        const init = await mcp.initialize();
        assert.equal(init.jsonrpc, '2.0');
        assert.ok(init.result?.protocolVersion);
        assert.ok(init.result?.capabilities);
        assert.ok(init.result?.serverInfo);
        mcp.notify('notifications/initialized', {});

        const listed = await mcp.listTools();
        const toolNames = (listed.result?.tools || []).map((t) => t.name);
        for (const reqTool of [
          'push_to_monitor',
          'get_clipboard_history',
          'get_selected_text',
          'replace_selected_text',
          'translate_text',
          'flip_keyboard_text',
          'wrap_rtl_text',
        ]) {
          assert.equal(toolNames.includes(reqTool), true, `Missing MCP tool ${reqTool}`);
        }

        const flipRes = await mcp.callTool('flip_keyboard_text', { text: 'akuo' });
        assert.equal(Boolean(flipRes.result?.isError), false);
        assert.equal(extractMcpText(flipRes).trim(), 'שלום');

        const wrapRes = await mcp.callTool('wrap_rtl_text', { text: 'שלום world' });
        assert.equal(Boolean(wrapRes.result?.isError), false);
        assert.equal(extractMcpText(wrapRes).replace(/\r?\n$/, ''), '\u2067שלום world\u2069');

        const pushRes = await mcp.callTool('push_to_monitor', { text: 'SC02_MCP_PUSH' });
        assert.equal(Boolean(pushRes.error), false);
        assert.equal(Boolean(pushRes.result?.isError), false);

        const histRes = await mcp.callTool('get_clipboard_history', {});
        assert.equal(Boolean(histRes.result?.isError), false);
        assertContains(extractMcpText(histRes), 'SC02_MCP_PUSH');

        const closed = await mcp.close();
        assert.equal(closed.code, 0, `Expected clean MCP exit 0, got code=${closed.code}, stderr=${closed.stderr}`);
        assert.deepEqual(closed.nonJsonStdoutLines, []);
      } finally {
        await mcp.close();
      }
    } finally {
      await gui.stop();
    }
  },
  { timeoutMs: 40000 }
);

suite.test(
  'T4-SC-03',
  ['F01', 'F22', 'F27'],
  'SC-03: Hebrew-first Monitor session (RTL, Markdown/code BiDi, Copy RTL, I18N.missing)',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'he');
      assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);

      const sample = '# כותרת\nשלום **world**\n\n```js\nconst שלום = 1;\n```\n\n- פריט ראשון';
      await page.evaluate((text) => {
        window.monitor.push({ id: 'sc03-md', time: Date.now(), kind: 'text', text, app: 'Notes' });
      }, sample);
      await page.waitForSelector('#content .md h1');

      const dirs = await page.evaluate(() => ({
        h1: document.querySelector('#content .md h1')?.getAttribute('dir') || '',
        p: document.querySelector('#content .md p')?.getAttribute('dir') || '',
        ul: document.querySelector('#content .md ul')?.getAttribute('dir') || '',
        pre: getComputedStyle(document.querySelector('#content .md pre')).direction,
      }));
      assert.equal(dirs.h1, 'rtl');
      assert.equal(dirs.p, 'rtl');
      assert.equal(dirs.ul, 'rtl');
      assert.equal(dirs.pre, 'ltr');

      await clearSent(page);
      await page.click('#b-rtl');
      await page.waitFor(() => (document.querySelector('#b-rtl')?.textContent || '').includes('✓'));
      const copied = await waitForSent(page, 'copy');
      assertContains(copied.text, '# \u2067כותרת\u2069');
      assertContains(copied.text, '\u2067שלום **world**\u2069');
      assertContains(copied.text, '```js\nconst שלום = 1;\n```');
      assertContains(copied.text, '- \u2067פריט ראשון\u2069');

      await page.click('#b-raw');
      await page.waitForSelector('#content .raw');
      assertContains(await page.evaluate(() => document.querySelector('#content .raw')?.textContent || ''), 'const שלום = 1;');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-04',
  ['F12', 'F21', 'F27'],
  'SC-04: Smart Cards workflow (Cron, curl, JWT, JSON) with Settings sub-toggles',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const pay = Buffer.from(JSON.stringify({ sub: 'sc04', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const jwt = `${hdr}.${pay}.sig`;

      await page.evaluate((jwtStr) => {
        window.monitor.push({ id: 'sc04-json', time: 1001, kind: 'text', text: '{"a":1}', app: 'Term' });
        window.monitor.push({ id: 'sc04-jwt', time: 1002, kind: 'text', text: jwtStr, app: 'Term' });
        window.monitor.push({
          id: 'sc04-curl',
          time: 1003,
          kind: 'text',
          text: 'curl -X POST https://api.example.com/v1/items -H "Authorization: Bearer abc" -d \'{"ok":true}\'',
          app: 'Term',
        });
        window.monitor.push({ id: 'sc04-cron', time: 1004, kind: 'text', text: '*/15 9-17 * * 1-5', app: 'Term' });
      }, jwt);

      await page.click('#b-hist');
      for (const [needle, expectedRe] of [
        ['*/15 9-17', /cron/i],
        ['api.example.com/v1/items', /POST/i],
        ['eyJ', /HS256/i],
        ['{"a":1}', /"a"/i],
      ]) {
        await page.evaluate((n) => {
          const r = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes(n));
          if (!r) throw new Error(`Missing ${n}`);
          r.click();
        }, needle);
        await page.waitForSelector('#content .card');
        assert.equal(expectedRe.test(await page.evaluate(() => document.querySelector('#content .card')?.textContent || '')), true);
      }

      // Disable f.smartCron -> Cron card suppressed, curl stays active
      await page.click('#b-settings');
      await page.click('#stab-content');
      await page.click('#spanel-content [data-key="f.smartCron"]');
      await page.click('#s-close');

      await page.evaluate(() => {
        const r = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes('*/15 9-17'));
        r.click();
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('*/15 9-17'));
      assert.equal((await page.query('#content .card')).exists, false);

      await page.evaluate(() => {
        const r = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes('api.example.com/v1/items'));
        r.click();
      });
      await page.waitForSelector('#content .card');

      // Disable master f.smartCards -> sub-toggles disabled and all cards suppressed
      await page.click('#b-settings');
      await page.click('#stab-content');
      await page.click('#spanel-content [data-key="f.smartCards"]');
      assert.equal(await page.evaluate(() => document.querySelector('#spanel-content [data-key="f.smartCurl"]')?.disabled), true);
      await page.click('#s-close');
      assert.equal((await page.query('#content .card')).exists, false);

      // Re-enable master and Cron
      await page.click('#b-settings');
      await page.click('#stab-content');
      await page.click('#spanel-content [data-key="f.smartCards"]');
      await page.click('#spanel-content [data-key="f.smartCron"]');
      await page.click('#s-close');

      await page.evaluate(() => {
        const r = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes('*/15 9-17'));
        r.click();
      });
      await page.waitForSelector('#content .card');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-05',
  ['F03', 'F19', 'F27'],
  'SC-05: Image clipboard item -> OCR extraction -> BiDi display -> Copy & Translate',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('he');
        window.monitor.push({
          id: 'sc05-img',
          time: Date.now(),
          kind: 'image',
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          size: '120×80',
          app: 'Preview',
        });
      });
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      await page.waitForSelector('#content img');

      await clearSent(page);
      await clickControl(page, { rootSelector: '#content', textRe: /חלץ טקסט|extract text|\bocr\b/i });
      await waitForSent(page, 'ocr', (m) => m.id === 'sc05-img');

      await page.evaluate(() => {
        window.monitor.ocrResult({ id: 'sc05-img', text: 'מספר הזמנה: 9012\nStatus: Shipped' });
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('מספר הזמנה: 9012'));
      assertContains(await page.evaluate(() => document.querySelector('#content')?.textContent || ''), 'Status: Shipped');

      await clearSent(page);
      await clickControl(page, { rootSelector: '#content', textRe: /^(copy|העתק)$/i });
      const cp = await waitForSent(page, 'copy');
      assertContains(cp.text, 'מספר הזמנה: 9012');

      await clearSent(page);
      await clickControl(page, { rootSelector: '#content', textRe: /^(translate|תרגם)/i });
      const tr = await waitForSent(page, 'translate');
      await page.evaluate((req) => {
        window.monitor.translated({ req, from: 'he', to: 'en', engine: 'apple', text: 'Order number: 9012\nStatus: Shipped' });
      }, tr.req);
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Order number: 9012'));
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-06',
  ['F03', 'F22', 'F27'],
  'SC-06: Quick Edit (⌘E) -> save edited snippet -> Compare (picking) banner diff',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCK.lang('en');
      });
      await page.waitFor(() => document.documentElement.dir === 'ltr');

      await page.evaluate(() => {
        window.monitor.push({ id: 'sc06-1', time: 1000, kind: 'text', text: 'Release v1.1 draft notes', app: 'Notes' });
        window.monitor.push({ id: 'sc06-2', time: 2000, kind: 'text', text: 'Release v1.2 draft notes', app: 'Notes' });
      });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Release v1.2 draft notes'));

      await page.pressKey('e', { modifiers: ['Meta'] });
      await fillControl(
        page,
        { rootSelector: '#content', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'Release v1.2 final notes'
      );
      await clickControl(page, { rootSelector: '#content', textRe: /^(save|שמור|done|סיום)$/i });
      await page.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Release v1.2 final notes'));

      await clickControl(page, { rootSelector: '#content', textRe: /compare|השווה/i });
      await page.waitFor(() => document.body.classList.contains('picking') && document.body.classList.contains('show-history'));

      assert.equal(await hasCompareGuidanceBanner(page), true, 'Expected visible Compare picking guidance banner in en');
      await page.evaluate(() => window.MOCK.lang('he'));
      await page.waitFor(() => document.documentElement.dir === 'rtl');
      assert.equal(await hasCompareGuidanceBanner(page), true, 'Expected visible Compare picking guidance banner in he');

      await page.evaluate(() => {
        const r = [...document.querySelectorAll('#hlist .item')].find((el) => (el.textContent || '').includes('Release v1.1 draft notes'));
        if (!r) throw new Error('sc06-1 not found');
        r.click();
      });

      await page.waitForSelector('.diffhead');
      const diffHtml = await page.evaluate(() => document.querySelector('#content .diff')?.innerHTML || '');
      assertContains(diffHtml, 'wdel');
      assertContains(diffHtml, 'wadd');

      await page.click('.diffhead button');
      await page.waitFor(() => !document.querySelector('.diffhead'));
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-07',
  ['F13', 'F14', 'F27'],
  'SC-07: Text Actions SSE streaming -> Markdown + BiDi -> Diff -> Edit -> Follow-up',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.MOCKA.source = 'We moved the meeting to thursday.';
        window.MOCKA.lang('en');
      });

      await page.evaluate(() => {
        window.actions.show({ status: 'running', id: 'fix' });
        window.actions.show({ status: 'streaming', id: 'fix', text: 'We moved the **meeting**' });
        window.actions.show({ status: 'streaming', id: 'fix', text: 'We moved the **meeting** to Thursday.\n\n- סיכום בעברית' });
        window.actions.show({
          status: 'result',
          id: 'fix',
          text: 'We moved the **meeting** to Thursday.\n\n- סיכום בעברית',
          canReplace: true,
        });
      });
      await page.waitFor(() => {
        const strong = document.querySelector('#text strong');
        const li = document.querySelector('#text ul li, #text ol li');
        return Boolean(strong && li?.getAttribute('dir') === 'rtl');
      });

      const mdCheck = await page.evaluate(() => ({
        strong: Boolean(document.querySelector('#text strong')),
        liDir: document.querySelector('#text ul li, #text ol li')?.getAttribute('dir') || '',
      }));
      assert.equal(mdCheck.strong, true);
      assert.equal(mdCheck.liDir, 'rtl');

      await clickControl(page, {
        rootSelector: '#v-work',
        textRe: /^(diff|הבדלים|השווה)$/i,
        titleRe: /diff|הבדלים|שינויים/i,
      });
      await page.waitFor(() => Boolean(document.querySelector('#v-work ins, #v-work del, #v-work .wadd, #v-work .wdel, #v-work [class*="diff"]')));

      await clickControl(page, { rootSelector: '#v-work', textRe: /^(edit|ערוך)$/i });
      await fillControl(
        page,
        { rootSelector: '#v-work', selectors: ['textarea', '[contenteditable="true"]', 'input[type="text"]'] },
        'We moved the meeting to Friday.'
      );

      await clearSent(page);
      await fillControl(
        page,
        { rootSelector: '#v-work', placeholderRe: /follow[- ]?up|המשך|שאל|בקש|הנחיה/i },
        'Translate to Hebrew'
      );
      await page.pressKey('Enter');
      const fu = await waitForSent(page, 'run', (m) => Array.isArray(m.messages) && m.messages.length >= 2);
      assert.equal(fu.messages.some((m) => m.role === 'assistant' && m.content.includes('Friday')), true);

      await page.evaluate(() => {
        window.actions.show({ status: 'result', id: 'fix', text: 'הזזנו את הפגישה ליום שישי.', canReplace: true });
      });
      await clearSent(page);
      await page.click('#replace');
      assert.equal((await waitForSent(page, 'replace')).text, 'הזזנו את הפגישה ליום שישי.');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-08',
  ['F12', 'F15', 'F27'],
  'SC-08: In-App AI Action Builder (Settings debounced generation + validation + Actions save & run)',
  async (ctx) => {
    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.evaluate(() => window.MOCK.lang('he'));
      await monPage.waitFor(() => document.documentElement.dir === 'rtl');
      await monPage.click('#b-settings');
      await monPage.click('#stab-actions');
      await monPage.click('#spanel-actions .a-seg button[data-sec="library"]');

      await clearSent(monPage);
      await fillControl(
        monPage,
        {
          rootSelector: '#spanel-actions',
          placeholderRe: /צור או התאם|תאר פעולה|create or|describe.*action|builder/i,
        },
        'תרגם לאנגלית עסקית'
      );
      await monPage.click('#spanel-actions .lib-ai-row button');
      const genMsg = await waitForSent(monPage, 'actions.generate', null, 4500);
      await monPage.evaluate((req) => {
        window.monitor.actionGenerated?.({
          req,
          action: { name: 'אנגלית עסקית', icon: 'mail', prompt: '', replaces: true },
        });
      }, genMsg.req);

      const missingPrompt = await monPage.evaluate(() => {
        const ed = document.querySelector('#spanel-actions .lib-item.open, #spanel-actions .lib-edit');
        return Boolean(
          ed &&
            (ed.querySelector('[aria-invalid="true"], .missing, .err, .warn, [data-missing]') ||
              /חובה|חסר|נדרש|required|missing/i.test(ed.textContent || ''))
        );
      });
      assert.equal(missingPrompt, true);

      await clearSent(monPage);
      await fillControl(
        monPage,
        { rootSelector: '#spanel-actions .lib-item.open', selectors: ['textarea'] },
        'Translate to business English: {{ SELECTED TEXT }}'
      );
      const saved = await waitForSent(monPage, 'set', (m) => m.key === 'actionsList');
      assertContains(saved.value, 'אנגלית עסקית');
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      await actPage.evaluate(() => window.MOCKA.lang('he'));
      await actPage.waitFor(() => document.documentElement.dir === 'rtl');
      await actPage.evaluate(() => {
        window.actions.show({
          status: 'result',
          id: 'ask',
          query: 'Summarize in bullets',
          text: '- Bullet 1\n- Bullet 2',
          canReplace: false,
        });
      });

      await clearSent(actPage);
      await clickControl(actPage, {
        rootSelector: '#v-work',
        textRe: /שמור כפעולה קבועה|save as.*action/i,
      });
      const savedAction = await waitForSent(
        actPage,
        null,
        (m) => m.cmd === 'actions.generate' || m.cmd === 'saveCustomAction' || (m.cmd === 'set' && m.key === 'actionsList')
      );
      assert.ok(savedAction);
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-09',
  ['F16', 'F01', 'F27'],
  'SC-09: Zero-AI offline workflow (noModels = true) executing local actions in 0ms',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      const showLocalList = async (src) => {
        await page.evaluate((source) => {
          window.MOCKA.noModels = true;
          window.MOCKA.source = source;
          window.actions.show({
            status: 'list',
            source,
            actions: [
              { id: 'flipKeyboard', kind: 'local', replaces: true },
              { id: 'cleanSpaces', kind: 'local', replaces: true },
              { id: 'wrapRtl', kind: 'local', replaces: true },
              { id: 'improve', kind: 'builtin', replaces: true },
            ],
            models: [],
            model: '',
            canReplace: true,
          });
        }, src);
      };

      await showLocalList('akuo   guko/');
      assert.equal((await page.query('#nomodel')).visible, true);

      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /flip|הפוך/i });
      await page.waitFor(() => (document.querySelector('#text')?.textContent || '').includes('שלום   עולם.'));
      assert.equal((await page.query('#replace')).visible, true);

      await page.click('#back');
      await showLocalList('a   b\n\n\nc');
      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /clean|spaces|רווחים/i });
      await page.waitFor(() => (document.querySelector('#text')?.textContent || '').includes('a b'));

      await page.click('#back');
      await showLocalList('שלום world');
      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /rtl/i });
      await page.waitFor(() => (document.querySelector('#text')?.textContent || '').includes('\u2067שלום world\u2069'));

      await page.click('#back');
      await showLocalList('Hello world');
      await clickControl(page, { rootSelector: '#list', selectors: ['.item'], textRe: /improve/i });
      await page.waitFor(() => /No AI model/i.test(document.querySelector('#status')?.textContent || ''));
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-10',
  ['F10', 'F02', 'F27'],
  'SC-10: Quick Translate (quickTranslate mode) -> target switch -> collapsible source -> Open in Monitor / Back',
  async (ctx) => {
    const page = await openActionsPage(ctx);
    try {
      await page.evaluate(() => {
        window.actions.setup({ lang: 'en', margin: 10, target: '', targets: 'he,en,fr,de' });
        window.actions.show({
          status: 'quickTranslate',
          mode: 'quickTranslate',
          source: 'Good morning team',
          text: 'בוקר טוב צוות',
          target: '',
          targets: 'he,en,fr,de',
          canReplace: true,
        });
      });

      await page.evaluate(() => {
        document.querySelector('#src summary')?.click();
      });
      assert.equal((await page.query('#src')).attrs.open !== undefined, true);
      assert.equal((await page.query('#srctext')).text, 'Good morning team');

      await clearSent(page);
      await page.fill('#target', 'fr');
      const setTarget = await waitForSent(page, 'set', (m) => m.key === 'lensTarget');
      assert.equal(setTarget.value, 'fr');

      await page.evaluate(() => {
        window.actions.show({
          status: 'quickTranslate',
          mode: 'quickTranslate',
          source: 'Good morning team',
          text: 'Bonjour équipe',
          target: 'fr',
          targets: 'he,en,fr,de',
          canReplace: true,
        });
      });

      await clearSent(page);
      await page.click('#open-monitor');
      await waitForSent(page, 'openInMonitor');

      await clearSent(page);
      await page.click('#replace');
      assert.equal((await waitForSent(page, 'replace')).text, 'Bonjour équipe');

      await clearSent(page);
      await page.click('#back');
      await waitForSent(page, 'back');
      await page.waitForSelector('#v-list:not([hidden])');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-11',
  ['F09', 'F12', 'F17'],
  'SC-11: Settings reorganization (7 tabs, no Features tab) + recording all 5 shortcuts + relocated toggles',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.click('#b-settings');
      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll('#settings .tabs [role="tab"]')].map((b) => b.dataset.tab)
      );
      assert.deepEqual(tabs, ['general', 'content', 'history', 'actions', 'translate', 'ai', 'about']);
      assert.equal(tabs.includes('features'), false);

      // Record all 5 shortcuts
      const record = async (tab, selFn, keyChar, keyName, expectedVal) => {
        await page.click(`#stab-${tab}`);
        const sel = await page.evaluate(selFn);
        assert.ok(sel, `Recorder missing for ${keyName}`);
        await clearSent(page);
        await page.click(sel);
        await page.pressKey(keyChar, { modifiers: ['Ctrl', 'Alt'] });
        const msg = await waitForSent(page, 'set', (m) => m.key === keyName);
        assert.equal(msg.value, expectedVal);
      };

      await record('general', () => {
        const b = document.querySelector('#row-hotkey .hk-rec');
        b.id = 'sc11-hk1';
        return '#sc11-hk1';
      }, 'v', 'hotkey', 'ctrl+opt+KeyV');

      await record('actions', () => {
        const bs = [...document.querySelectorAll('#spanel-actions .hk-rec')];
        bs[0].id = 'sc11-hk2';
        bs[1].id = 'sc11-hk3';
        return '#sc11-hk2';
      }, 'a', 'actionsHotkey', 'ctrl+opt+KeyA');

      await record('actions', () => '#sc11-hk3', 'k', 'flipHotkey', 'ctrl+opt+KeyK');

      await record('translate', () => {
        const b = document.querySelector('#spanel-translate .f-hk[data-for="bubble"] .hk-rec');
        b.id = 'sc11-hk4';
        return '#sc11-hk4';
      }, 't', 'bubbleHotkey', 'ctrl+opt+KeyT');

      await record('translate', () => {
        const b = document.querySelector('#spanel-translate .f-hk[data-for="lens"] .hk-rec');
        b.id = 'sc11-hk5';
        return '#sc11-hk5';
      }, 'y', 'lensHotkey', 'ctrl+opt+KeyY');

      // Toggle relocated switches across Content, Translation, Text Actions, AI
      const checkToggle = async (tab, sel, key) => {
        await page.click(`#stab-${tab}`);
        await clearSent(page);
        await page.click(sel);
        await waitForSent(page, 'set', (m) => m.key === key);
      };
      await checkToggle('content', '#spanel-content [data-key="f.smartCards"]', 'f.smartCards');
      await checkToggle('content', '#spanel-content [data-key="f.linkPreview"]', 'f.linkPreview');
      await checkToggle('content', '#spanel-content [data-key="f.compare"]', 'f.compare');
      await checkToggle('content', '#spanel-content [data-key="f.copyRtl"]', 'f.copyRtl');
      await checkToggle('translate', '#spanel-translate [data-key="f.bubble"]', 'f.bubble');
      await checkToggle('translate', '#spanel-translate [data-key="f.lens"]', 'f.lens');
      await checkToggle('translate', '#spanel-translate [data-key="f.translate"]', 'f.translate');
      await checkToggle('actions', '#spanel-actions [data-key="f.actions"]', 'f.actions');
      await checkToggle('ai', '#spanel-ai [data-act="toggle-ai"]', 'f.ai');

      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-12',
  ['F02', 'F10', 'F13'],
  'SC-12: Model validation & provider filtering across Translation, Text Actions Settings, and Actions Popover',
  async (ctx) => {
    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.evaluate(() => {
        window.monitor.aiState({
          providers: [
            {
              id: 'anth',
              name: 'Anthropic',
              kind: 'anthropic',
              enabled: true,
              models: [
                { id: 'claude-sonnet', hidden: false, missing: false },
                { id: 'claude-opus', hidden: true, missing: false },
                { id: 'claude-old', hidden: false, missing: true },
              ],
            },
            {
              id: 'oll',
              name: 'Ollama',
              kind: 'ollama',
              enabled: false,
              models: [{ id: 'llama3.2', hidden: false, missing: false }],
            },
          ],
          presets: [],
        });
        window.monitor.setSettings({ 'f.ai': true, translateEngine: 'llm', translateProvider: 'anth', translateModel: 'claude-sonnet' });
      });

      await monPage.click('#b-settings');
      await monPage.click('#stab-translate');
      const trOpts = await monPage.queryAll('#spanel-translate .t-model-pick option');
      assert.deepEqual(trOpts.map((o) => o.value), ['anth\nclaude-sonnet']);

      await monPage.click('#stab-actions');
      const actOpts = await monPage.queryAll('#spanel-actions .a-model-pick option');
      assert.equal(actOpts.some((o) => o.value === 'anth\nclaude-sonnet'), true);
      assert.equal(actOpts.some((o) => o.value.includes('claude-opus') || o.value.includes('claude-old') || o.value.includes('llama3.2')), false);

      // Disable Anthropic -> missing-model warning appears in Translation tab
      await monPage.evaluate(() => {
        window.monitor.aiState({
          providers: [
            {
              id: 'anth',
              name: 'Anthropic',
              kind: 'anthropic',
              enabled: false,
              models: [{ id: 'claude-sonnet', hidden: false, missing: false }],
            },
          ],
          presets: [],
        });
      });
      await monPage.click('#stab-translate');
      const warnOpts = await monPage.queryAll('#spanel-translate .t-model-pick option');
      assert.equal(warnOpts.some((o) => /not available|לא זמין/i.test(o.text) && o.text.includes('claude-sonnet')), true);
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      await actPage.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Text',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [{ value: 'anth\nclaude-sonnet', label: 'claude-sonnet', group: 'Anthropic' }],
          model: 'anth\nclaude-sonnet',
          canReplace: true,
        });
      });
      assert.equal((await actPage.query('#model')).visible, true);
      assert.equal((await actPage.query('#nomodel')).visible, false);

      await actPage.evaluate(() => {
        window.actions.show({
          status: 'list',
          source: 'Text',
          actions: [{ id: 'improve', kind: 'builtin', replaces: true }],
          models: [],
          model: '',
          canReplace: true,
        });
      });
      assert.equal((await actPage.query('#model')).visible, false);
      assert.equal((await actPage.query('#nomodel')).visible, true);
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-13',
  ['F22', 'F12', 'F27'],
  'SC-13: Narrow-window (320px) responsive RTL & LTR workflow (Settings tabs, #history drawer, Empty State)',
  async (ctx) => {
    const page = await openMonitorPage(ctx);
    try {
      await page.setViewport(320, 600);
      assert.equal((await page.query('#b-theme')).exists, false);

      // Clear initial item to inspect informative Empty State
      await page.evaluate(() => {
        for (const el of [...document.querySelectorAll('#hlist .item')]) {
          const it = el.item;
          if (it) window.monitor.applyOp({ op: 'delete', key: it.id || String(it.time) });
        }
      });
      await page.waitForSelector('#content .empty');
      const emptyText = await page.evaluate(() => document.querySelector('#content .empty')?.textContent || '');
      assertContains(emptyText, '⌃⌥');

      await page.evaluate(() => {
        window.monitor.push({ id: 'sc13-1', time: 1001, kind: 'text', text: 'Responsive item one', app: 'Notes' });
        window.monitor.push({ id: 'sc13-2', time: 1002, kind: 'text', text: 'Responsive item two', app: 'Notes' });
      });
      await page.click('#b-hist');
      await page.waitFor(() => document.body.classList.contains('show-history'));
      await page.fill('#search', 'two');
      assert.equal((await page.queryAll('#hlist .item')).length, 1);
      await page.fill('#search', '');
      await page.click('#b-hist');

      for (const lang of ['en', 'he']) {
        await page.evaluate((l) => window.MOCK.lang(l), lang);
        await page.waitFor(
          lang === 'he'
            ? () => document.documentElement.dir === 'rtl'
            : () => document.documentElement.dir === 'ltr'
        );
        await page.click('#b-settings');
        for (const tab of ['general', 'content', 'history', 'actions', 'translate', 'ai', 'about']) {
          await page.click(`#stab-${tab}`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 2, `Overflow at 320px in ${lang}/${tab}: ${overflow}`);
        }
        await page.click('#s-close');
      }
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-14',
  ['F05', 'F25', 'F27'],
  'SC-14: Send-to integration with CM.menuKeys RTL/LTR across Monitor & Text Actions',
  async (ctx) => {
    const monPage = await openMonitorPage(ctx);
    try {
      await monPage.evaluate(() => {
        window.MOCK.lang('en');
        window.monitor.setSettings({
          sendToApps: [
            { id: 'obsidian', name: 'Obsidian' },
            { id: 'notes', name: 'Bear' },
          ],
        });
        window.monitor.push({ id: 'sc14-1', time: Date.now(), kind: 'text', text: 'Meeting notes', app: 'Notes' });
      });
      await monPage.waitFor(() => document.documentElement.dir === 'ltr');
      await monPage.waitFor(() => (document.querySelector('#content')?.textContent || '').includes('Meeting notes'));

      const openCtx = async () => {
        await monPage.evaluate(() => {
          const c = document.querySelector('#content');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 40 }));
        });
        await monPage.waitForSelector('#ctx.show');
      };

      // LTR submenu open/close
      await openCtx();
      for (let i = 0; i < 20; i++) {
        if (await monPage.evaluate(() => /send to|שלח אל/i.test(document.activeElement?.textContent || ''))) break;
        await monPage.pressKey('ArrowDown');
      }
      await monPage.pressKey('ArrowRight');
      await monPage.waitForSelector('#ctx .ctx-sub');
      await monPage.pressKey('ArrowLeft');
      await monPage.waitFor(() => !document.querySelector('#ctx .ctx-sub'));
      await monPage.pressKey('Escape');

      // RTL submenu open + Enter on Obsidian
      await monPage.evaluate(() => window.MOCK.lang('he'));
      await monPage.waitFor(() => document.documentElement.dir === 'rtl');
      await openCtx();
      for (let i = 0; i < 20; i++) {
        if (await monPage.evaluate(() => /send to|שלח אל/i.test(document.activeElement?.textContent || ''))) break;
        await monPage.pressKey('ArrowDown');
      }
      await monPage.pressKey('ArrowLeft');
      await monPage.waitForSelector('#ctx .ctx-sub');
      await clearSent(monPage);
      for (let i = 0; i < 6; i++) {
        if (await monPage.evaluate(() => /Obsidian/i.test(document.activeElement?.textContent || ''))) break;
        await monPage.pressKey('ArrowDown');
      }
      await monPage.pressKey('Enter');
      const monSent = await waitForSent(monPage, 'sendTo');
      assert.equal(String(monSent.app).toLowerCase(), 'obsidian');
      assert.equal(monSent.text, 'Meeting notes');
      assert.deepEqual(monPage.getErrors().allErrors, []);
    } finally {
      await monPage.close();
    }

    const actPage = await openActionsPage(ctx);
    try {
      await actPage.evaluate(() => {
        window.actions.setup({
          lang: 'en',
          margin: 10,
          sendToApps: [
            { id: 'obsidian', name: 'Obsidian' },
            { id: 'notes', name: 'Bear' },
          ],
        });
        window.actions.show({
          status: 'result',
          id: 'improve',
          text: 'Action result text',
          canReplace: true,
        });
      });
      await clearSent(actPage);
      await clickControl(actPage, {
        rootSelector: '#v-work',
        textRe: /send to|שלח אל/i,
        titleRe: /send to|שלח אל/i,
      });
      await clickControl(actPage, { textRe: /Bear/i });
      const actSent = await waitForSent(actPage, 'sendTo');
      assert.equal(String(actSent.app).toLowerCase(), 'notes');
      assert.equal(actSent.text, 'Action result text');
      assert.deepEqual(actPage.getErrors().allErrors, []);
    } finally {
      await actPage.close();
    }
  },
  { timeoutMs: 25000 }
);

suite.test(
  'T4-SC-15',
  ['F20', 'F27', 'F28'],
  'SC-15: Translation Lens (lens.html) end-to-end UI workflow (reading/overlay, status banners, Hebrew RTL)',
  async (ctx) => {
    const page = await openLensPage(ctx);
    try {
      await page.evaluate(() => {
        window.lens.setup({ lang: 'en', target: '', targets: 'he,en,es', auto: true });
        window.lens.render({
          mode: 'reading',
          blocks: [{ text: 'First `let x = 1` block', state: 'ok' }],
          status: 'ok',
        });
      });

      assert.equal(await page.evaluate(() => document.body.classList.contains('reading')), true);
      assert.equal(await page.evaluate(() => document.querySelector('#layer p.doc.ok code')?.textContent || ''), 'let x = 1');

      await clearSent(page);
      await page.fill('#target', 'es');
      const tgtMsg = await waitForSent(page, 'set', (m) => m.key === 'lensTarget');
      assert.equal(tgtMsg.value, 'es');

      await clearSent(page);
      await page.click('#auto');
      assert.equal((await page.query('#auto')).attrs['aria-pressed'], 'false');
      const autoMsg = await waitForSent(page, 'set', (m) => m.key === 'lensAutoRefresh');
      assert.equal(autoMsg.value, false);

      await page.evaluate(() => document.querySelector('#peek').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
      assert.equal(await page.evaluate(() => document.body.classList.contains('peek')), true);
      await page.evaluate(() => document.querySelector('#peek').dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
      assert.equal(await page.evaluate(() => document.body.classList.contains('peek')), false);

      await clearSent(page);
      await page.click('#mode');
      const modeMsg = await waitForSent(page, 'set', (m) => m.key === 'lensMode');
      assert.equal(modeMsg.value, 'overlay');
      await page.evaluate(() => {
        window.lens.render({
          mode: 'overlay',
          spans: [{ x: 12, y: 18, w: 160, h: 26, line: true, text: 'Hola mundo' }],
          status: 'ok',
        });
      });
      assert.equal((await page.query('#layer .t.line')).text, 'Hola mundo');

      await clearSent(page);
      await page.evaluate(() => window.lens.status({ status: 'permission' }));
      assert.equal((await page.query('#ax')).visible, true);
      await page.click('#ax');
      await waitForSent(page, 'openAXSettings');

      await page.evaluate(() => window.lens.status({ status: 'error', detail: 'notInstalled' }));
      const stInfo = await page.query('#status');
      assertContains(stInfo.attrs.class || '', 'error');
      assertContains(stInfo.text, 'Translation Languages');

      await page.evaluate(() => window.lens.setup({ lang: 'he', target: 'he', targets: 'he,en,es', auto: true }));
      assert.deepEqual(await page.evaluate(() => window.I18N.missing('he')), []);
      assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      assert.deepEqual(page.getErrors().allErrors, []);
    } finally {
      await page.close();
    }
  },
  { timeoutMs: 25000 }
);

await suite.run();
