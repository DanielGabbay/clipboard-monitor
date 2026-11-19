import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  assert,
  assertContains,
  assertExitCode,
  assertMatches,
  assertNotContains,
  assertNotMatches,
  createSuite,
  extractCssSelectors,
  hasCssClassToken,
  withTempDir,
} from '../lib/test_harness.mjs';
import {
  assertExecutable,
  createIsolatedHome,
  createMcpClient,
  deliverIsolatedUrl,
  inspectBinaryStrings,
  inspectMachOArchs,
  inspectMachOBuildVersion,
  inspectMachOLinkage,
  lintPlistOrStrings,
  otoolLinkedFrameworks,
  probeUnixSocket,
  readPlistJson,
  readStringsJson,
  runCli,
  startIsolatedApp,
} from '../lib/cli_mcp.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const execFileAsync = promisify(execFile);

const suite = createSuite({
  name: 't2_cli_bundle',
  tier: 2,
  description: 'E2E-M1 Tier 2: Boundary, Corner-Case, Error-Handling & Packaging Guards',
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stripTrailingNewline(s) {
  return String(s ?? '').replace(/\r?\n$/, '');
}

function parseSwiftStringDict(swiftSource) {
  const dict = {};
  const re = /^\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?/gm;
  let m;
  while ((m = re.exec(swiftSource)) !== null) {
    const k = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const v = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    dict[k] = v;
  }
  return dict;
}

async function compileSwiftCleanWhitespaceDriver(repoRoot, tmpDir) {
  const transformsPath = path.join(repoRoot, 'Sources', 'TextTransforms.swift');
  assert.ok(fs.existsSync(transformsPath), `Missing ${transformsPath}`);
  const driverPath = path.join(tmpDir, 'main.swift');
  const binPath = path.join(tmpDir, 'clean_driver');
  fs.writeFileSync(
    driverPath,
    `import Foundation
let data = FileHandle.standardInput.readDataToEndOfFile()
let input = String(data: data, encoding: .utf8) ?? ""
FileHandle.standardOutput.write(Data(TextTransforms.cleanWhitespace(input).utf8))
`,
    'utf8'
  );
  await execFileAsync('/usr/bin/swiftc', ['-O', transformsPath, driverPath, '-o', binPath], {
    encoding: 'utf8',
  });
  return binPath;
}

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

async function getSharedGuiForF23(ctx) {
  if (!ctx.state.f23App) {
    ctx.state.f23App = await startIsolatedApp(ctx, { prefix: 'tm-t2f23-', ephemeralBundle: true });
    await new Promise((r) => setTimeout(r, 600));
  }
  return ctx.state.f23App;
}

const I18N_CAPTURE_INIT = `
(function () {
  window.__i18nDicts = { en: {}, he: {} };
  let realI18N;
  Object.defineProperty(window, 'I18N', {
    configurable: true,
    enumerable: true,
    get() { return realI18N; },
    set(val) {
      realI18N = val;
      if (val && typeof val.register === 'function') {
        const origReg = val.register.bind(val);
        val.register = function (d) {
          for (const lang of Object.keys(d || {})) {
            window.__i18nDicts[lang] = Object.assign(window.__i18nDicts[lang] || {}, d[lang]);
          }
          return origReg(d);
        };
      }
    },
  });
})();
`;

suite.afterAll(async (ctx) => {
  if (ctx.state.f23App) await ctx.state.f23App.stop();
  if (ctx.state.browser) await ctx.state.browser.close();
  if (ctx.state.previewEnv) await ctx.state.previewEnv.close();
});

// ===========================================================================
// F01: TextTransforms boundaries (8 tests)
// ===========================================================================

suite.test('T2-F01-01', 'F01', 'flip and rtl handle empty and whitespace-only inputs cleanly', async (ctx) => {
  for (const cmd of ['flip', 'rtl']) {
    const rEmpty = await runCli(ctx.appBin, [cmd], { stdin: '' });
    assertExitCode(rEmpty, 0);
    assert.equal(stripTrailingNewline(rEmpty.stdout), '');

    const rWs = await runCli(ctx.appBin, [cmd, '   \t  ']);
    assertExitCode(rWs, 0);
    assert.equal(stripTrailingNewline(rWs.stdout), '   \t  ');
  }
});

suite.test('T2-F01-02', 'F01', 'flip preserves digits, ASCII symbols, and emoji', async (ctx) => {
  const res = await runCli(ctx.appBin, ['flip', 'akuo 12345 !@# 🚀']);
  assertExitCode(res, 0);
  assert.equal(stripTrailingNewline(res.stdout), 'שלום 12345 !@# 🚀');
});

suite.test('T2-F01-03', 'F01', 'flip handles uppercase CapsLock Latin input', async (ctx) => {
  const res = await runCli(ctx.appBin, ['flip', 'AKUO']);
  assertExitCode(res, 0);
  assert.equal(stripTrailingNewline(res.stdout), 'שלום');
});

suite.test('T2-F01-04', 'F01', 'flip handles mixed Hebrew and English while preserving digits, emoji, and valid UTF-8', async (ctx) => {
  const res = await runCli(ctx.appBin, ['flip', 'שלום hello 123 🚀']);
  assertExitCode(res, 0);
  assertNotContains(res.stdout, '\uFFFD', 'Invalid UTF-8 replacement character detected');
  assert.equal(stripTrailingNewline(res.stdout), 'שלום יקךךם 123 🚀');
});

suite.test('T2-F01-05', 'F01', 'rtl is idempotent and strips legacy directional control characters', async (ctx) => {
  const input = '\u2067\u200Fשלום\u202C\u2069\n\u200EHello\u202A';
  const expected = '\u2067שלום\u2069\nHello';
  const r1 = await runCli(ctx.appBin, ['rtl', input]);
  assertExitCode(r1, 0);
  assert.equal(stripTrailingNewline(r1.stdout), expected);

  const r2 = await runCli(ctx.appBin, ['rtl', expected]);
  assertExitCode(r2, 0);
  assert.equal(stripTrailingNewline(r2.stdout), expected);
});

suite.test('T2-F01-06', 'F01', 'rtl skips emoji-only, wraps Arabic, and ignores ~~~ fences', async (ctx) => {
  const rEmoji = await runCli(ctx.appBin, ['rtl', '🚀🎉']);
  assertExitCode(rEmoji, 0);
  assert.equal(stripTrailingNewline(rEmoji.stdout), '🚀🎉');

  const rArabic = await runCli(ctx.appBin, ['rtl', 'مرحبا']);
  assertExitCode(rArabic, 0);
  assert.equal(stripTrailingNewline(rArabic.stdout), '\u2067مرحبا\u2069');

  const rTilde = await runCli(ctx.appBin, ['rtl', '~~~\nשלום\n~~~']);
  assertExitCode(rTilde, 0);
  assert.equal(stripTrailingNewline(rTilde.stdout), '~~~\nשלום\n~~~');
});

suite.test('T2-F01-07', 'F01', 'flip and rtl handle 50 KB input under 2000ms without truncation', async (ctx) => {
  const enBig = 'akuo '.repeat(10000);
  const heBig = 'שלום '.repeat(10000);

  const rFlip = await runCli(ctx.appBin, ['flip'], { stdin: enBig, timeoutMs: 4000 });
  assertExitCode(rFlip, 0);
  assert.ok(rFlip.durationMs < 2000, `flip 50KB took ${rFlip.durationMs}ms`);
  assert.equal(stripTrailingNewline(rFlip.stdout), heBig);

  const rRtl = await runCli(ctx.appBin, ['rtl'], { stdin: heBig, timeoutMs: 4000 });
  assertExitCode(rRtl, 0);
  assert.ok(rRtl.durationMs < 2000, `rtl 50KB took ${rRtl.durationMs}ms`);
  assert.equal(stripTrailingNewline(rRtl.stdout), `\u2067${heBig}\u2069`);
});

suite.test('T2-F01-08', 'F01', 'TextTransforms.cleanWhitespace handles empty, whitespace-only, leading/trailing blank lines, and CRLF boundaries', async (ctx) => {
  await withTempDir('tm-swift-clean-t2-', async (tmpDir) => {
    const bin = await compileSwiftCleanWhitespaceDriver(ctx.repoRoot, tmpDir);

    const rEmpty = await runCli(bin, [], { stdin: '' });
    assertExitCode(rEmpty, 0);
    assert.equal(rEmpty.stdout, '');

    const rWs = await runCli(bin, [], { stdin: '   \n\t  ' });
    assertExitCode(rWs, 0);
    assert.equal(rWs.stdout, '');

    const rCrlf = await runCli(bin, [], { stdin: '\r\n\r\na   \t  x  \r\n\r\n\r\n  b  \r\n\r\n' });
    assertExitCode(rCrlf, 0);
    assert.equal(rCrlf.stdout, 'a x\n\n  b');
  });
});

// ===========================================================================
// F04: Dead CSS boundaries (5 tests)
// ===========================================================================

suite.test('T2-F04-01', 'F04', '.hk-clear rule and computed styling remain intact after .ca-del removal', async (ctx) => {
  const actionsCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings-actions.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'app.css'), 'utf8');
  const combinedCss = actionsCss + '\n' + appCss;
  assertMatches(combinedCss, /#settings(?:\s+\.actions-tab)?\s+\.hk-clear\b/, 'Missing .hk-clear rule');
  assertMatches(combinedCss, /#settings(?:\s+\.actions-tab)?\s+\.hk-clear:hover\b/, 'Missing .hk-clear:hover rule');

  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="actions"]');
    await page.waitForSelector('#settings .actions-tab .hk-clear');
    const style = await page.evaluate(() => {
      const btn = document.querySelector('#settings .actions-tab .hk-clear');
      const cs = getComputedStyle(btn);
      return { borderTopWidth: cs.borderTopWidth, bg: cs.backgroundColor };
    });
    assert.equal(style.borderTopWidth, '0px');
  } finally {
    await page.close();
  }
});

suite.test('T2-F04-02', 'F04', 'About Copy version info button remains visibly styled via .btn without .about-copy', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="about"]');
    await page.waitForSelector('#settings .about .row-btns button.btn');
    const style = await page.evaluate(() => {
      const btn = document.querySelector('#settings .about .row-btns button.btn');
      const cs = getComputedStyle(btn);
      return {
        hasBtn: btn.classList.contains('btn'),
        borderTopWidth: cs.borderTopWidth,
        backgroundColor: cs.backgroundColor,
      };
    });
    assert.equal(style.hasBtn, true, 'About copy button must carry .btn');
    assert.equal(style.borderTopWidth, '1px');
    assert.notEqual(style.backgroundColor, 'rgba(0, 0, 0, 0)');
  } finally {
    await page.close();
  }
});

suite.test('T2-F04-03', 'F04', 'Tokenized .ca removal leaves .card, .card-title, and calc() intact', async (ctx) => {
  const appCss = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'app.css'), 'utf8');
  const appSelectors = extractCssSelectors(appCss);
  assert.equal(hasCssClassToken(appSelectors, '.card'), true, '.card must remain in app.css');
  assert.equal(hasCssClassToken(appSelectors, '.card-title'), true, '.card-title must remain in app.css');
  assertContains(appCss, 'calc(', 'calc() expressions must remain intact in app.css');
});

suite.test('T2-F04-04', 'F04', '.chip.paused and #b-hold.on styles stay intact after .chip.held removal', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => {
      window.monitor.setState({ paused: true });
      window.monitor.toggleHold();
    });
    await page.waitFor(() => !document.querySelector('#paused').hidden && document.querySelector('#b-hold').classList.contains('on'));
    const styles = await page.evaluate(() => {
      const paused = getComputedStyle(document.querySelector('#paused'));
      const hold = getComputedStyle(document.querySelector('#b-hold'));
      return {
        pausedBorder: paused.borderTopStyle,
        holdColor: hold.color,
        holdBorderColor: hold.borderTopColor,
        holdBorderStyle: hold.borderTopStyle,
        bodyColor: getComputedStyle(document.body).color,
      };
    });
    assert.notEqual(styles.pausedBorder, 'none');
    assert.notEqual(styles.holdColor, styles.bodyColor, '#b-hold.on should have active accent color');
    assert.notEqual(styles.holdBorderStyle, 'none', '#b-hold.on should have a visible border');
    assert.notEqual(styles.holdBorderColor, 'rgba(0, 0, 0, 0)', '#b-hold.on border color should be non-transparent');
  } finally {
    await page.close();
  }
});

suite.test('T2-F04-05', 'F04', 'Zero legacy .ca* or .a-custom-hint elements exist in Settings Text Actions DOM', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="actions"]');
    await page.waitForSelector('#settings .actions-tab');
    const count = await page.evaluate(
      () => document.querySelectorAll('.ca, .ca-head, .ca-del, .a-custom-hint').length
    );
    assert.equal(count, 0);
  } finally {
    await page.close();
  }
});

// ===========================================================================
// F07: Obsolete docs deletion boundaries (5 tests)
// ===========================================================================

suite.test('T2-F07-01', 'F07', 'No case-variant or backup leftovers for obsolete docs in docs/', async (ctx) => {
  const docsDir = path.join(ctx.repoRoot, 'docs');
  if (!fs.existsSync(docsDir)) return;
  const entries = fs.readdirSync(docsDir, { recursive: true });
  for (const e of entries) {
    assertNotMatches(String(e), /plan-settings-ai-i18n|ui-review-1/i, `Found leftover doc: ${e}`);
  }
});

suite.test('T2-F07-02', 'F07', 'Preview and Settings About work cleanly even without docs/ directory', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  assert.equal(fs.existsSync(path.join(env.tmpDir, 'docs')), false);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="about"]');
    await page.waitForSelector('#settings .about-notes');
    assert.deepEqual(page.getErrors().allErrors, []);
  } finally {
    await page.close();
  }
});

suite.test('T2-F07-03', 'F07', 'Zero dangling markdown links to obsolete docs in README.md and CHANGELOG.md', async (ctx) => {
  for (const rel of ['README.md', 'CHANGELOG.md']) {
    const text = fs.readFileSync(path.join(ctx.repoRoot, rel), 'utf8');
    const links = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    for (const target of links) {
      assertNotMatches(target, /PLAN-settings-ai-i18n|UI-REVIEW-1/i, `Dangling doc link in ${rel}: ${target}`);
    }
  }
});

suite.test('T2-F07-04', 'F07', 'Zero failed network requests or console errors when opening Settings About', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    page.clearErrors();
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="about"]');
    await page.waitForSelector('#settings .about-notes');
    const errs = page.getErrors();
    assert.deepEqual(errs.failedRequests, []);
    assert.deepEqual(errs.consoleErrors, []);
    assert.deepEqual(errs.pageErrors, []);
  } finally {
    await page.close();
  }
});

suite.test('T2-F07-05', 'F07', 'Deleted docs were not relocated into Resources/ or dev/', async (ctx) => {
  for (const dir of ['Resources', 'dev']) {
    const entries = fs.readdirSync(path.join(ctx.repoRoot, dir), { recursive: true });
    for (const e of entries) {
      assertNotMatches(String(e), /plan-settings-ai-i18n|ui-review-1/i, `Relocated obsolete doc in ${dir}: ${e}`);
    }
  }
});

// ===========================================================================
// F08: Bundle metadata & docs boundaries (5 tests)
// ===========================================================================

suite.test('T2-F08-01', 'F08', 'Strict LSMinimumSystemVersion format (13.0) in source and bundle plists', async (ctx) => {
  const srcPlist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  assertMatches(String(srcPlist.LSMinimumSystemVersion), /^13\.0(\.\d+)?$/);

  const bndPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
  assert.ok(fs.existsSync(bndPath), `Built Info.plist not found: ${bndPath}`);
  const bndPlist = await readPlistJson(bndPath);
  assertMatches(String(bndPlist.LSMinimumSystemVersion), /^13\.0(\.\d+)?$/);
});

suite.test('T2-F08-02', 'F08', 'CMBuildDate is valid ISO-8601 UTC and CFBundleShortVersionString matches VERSION', async (ctx) => {
  const ver = fs.readFileSync(path.join(ctx.repoRoot, 'VERSION'), 'utf8').trim();
  const bndPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
  assert.ok(fs.existsSync(bndPath), `Built Info.plist not found: ${bndPath}`);
  const bndPlist = await readPlistJson(bndPath);
  assert.equal(bndPlist.CFBundleShortVersionString, ver);
  assertMatches(String(bndPlist.CMBuildDate || ''), /Z$/);
  assert.ok(!Number.isNaN(Date.parse(bndPlist.CMBuildDate)), `Invalid CMBuildDate: ${bndPlist.CMBuildDate}`);
});

suite.test('T2-F08-03', 'F08', 'README.md Shortcuts table has valid 2-column structure and no duplicates', async (ctx) => {
  const readme = fs.readFileSync(path.join(ctx.repoRoot, 'README.md'), 'utf8');
  const secMatch = readme.match(/## Shortcuts[\s\S]*?(?=\n## |$)/);
  assert.ok(secMatch, 'Missing ## Shortcuts section');
  const rows = secMatch[0]
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .slice(2);
  assert.ok(rows.length >= 12, `Expected >= 12 shortcut rows, got ${rows.length}`);
  const seenKeys = new Set();
  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    assert.equal(cells.length, 2, `Malformed shortcut row: ${row}`);
    assert.ok(cells[0].length > 0 && cells[1].length > 0, `Empty shortcut cell in row: ${row}`);
    assert.equal(seenKeys.has(cells[0]), false, `Duplicate shortcut cell: ${cells[0]}`);
    seenKeys.add(cells[0]);
  }
});

suite.test('T2-F08-04', 'F08', 'Settings About renders 1.2.0 changelog notes without fallback "No release notes"', async (ctx) => {
  const changelog = fs.readFileSync(path.join(ctx.repoRoot, 'CHANGELOG.md'), 'utf8');
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="about"]');
    await page.evaluate((cl) => {
      window.monitor.versionInfo({
        version: '1.2.0',
        build: '100',
        commit: 'abc1234',
        buildDate: new Date().toISOString(),
        dirty: false,
        os: 'macOS 15',
        changelog: cl,
      });
    }, changelog);
    const notes = await page.waitForSelector('#settings .about-notes');
    assert.ok(notes.text.trim().length > 0);
    const fullAbout = await page.query('#settings .about');
    assertNotContains(fullAbout.text, 'No release notes');
  } finally {
    await page.close();
  }
});

suite.test('T2-F08-05', 'F08', 'Bundled CHANGELOG.md matches repo CHANGELOG.md byte-for-byte', async (ctx) => {
  const src = fs.readFileSync(path.join(ctx.repoRoot, 'CHANGELOG.md'));
  const bndPath = path.join(ctx.appBundle, 'Contents', 'Resources', 'CHANGELOG.md');
  assert.ok(fs.existsSync(bndPath), `Missing bundled CHANGELOG.md: ${bndPath}`);
  const bnd = fs.readFileSync(bndPath);
  assert.equal(Buffer.compare(src, bnd), 0, 'Bundled CHANGELOG.md differs from REPO_ROOT/CHANGELOG.md');
});

// ===========================================================================
// F11: Bubble files deletion boundaries (5 tests)
// ===========================================================================

suite.test('T2-F11-01', 'F11', 'APP_BIN contains no BubbleController or BubblePanel symbols', async (ctx) => {
  assertExecutable(ctx.appBin);
  const info = await inspectBinaryStrings(ctx.appBin);
  assertNotMatches(info.symbols, /BubbleController|BubblePanel/);
  assertNotMatches(info.strings, /BubbleController|BubblePanel/);
});

suite.test('T2-F11-02', 'F11', 'actions-preview.html is self-contained without bubble.* and loads with zero 404s', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.actionsPreviewUrl, { settleMs: 250 });
    const errs = page.getErrors();
    assert.deepEqual(errs.allErrors, [], `actions-preview.html errors: ${errs.allErrors.join(' | ')}`);
  } finally {
    await page.close();
  }
});

suite.test('T2-F11-03', 'F11', 'Preserved f.bubble and bubbleHotkey settings remain intact in Translation tab', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="translate"]');
    await page.waitForSelector('#settings .tab-panel[data-tab="translate"] [data-key="f.bubble"]');
    const bubbleToggle = await page.query('#settings .tab-panel[data-tab="translate"] [data-key="f.bubble"]');
    const bubbleHotkeyControls = await page.queryAll(
      '#settings .tab-panel[data-tab="translate"] [data-key="bubbleHotkey"], #settings .tab-panel[data-tab="translate"] .hk .hk-rec'
    );
    assert.equal(bubbleToggle.exists, true, 'f.bubble toggle missing from Translation tab');
    assert.ok(bubbleHotkeyControls.length > 0, 'bubbleHotkey control missing from Translation tab');
    const hkInfo = await page.evaluate(() => ({
      hasLegacySelect: Boolean(document.querySelector('#settings .tab-panel[data-tab="translate"] [data-key="bubbleHotkey"]')),
      recLabels: [...document.querySelectorAll('#settings .tab-panel[data-tab="translate"] .hk .hk-rec')].map((el) =>
        (el.textContent || '').trim()
      ),
      setting: window.CM?.S?.bubbleHotkey ?? null,
    }));
    assert.ok(hkInfo.setting && String(hkInfo.setting).length > 0, `CM.S.bubbleHotkey should be set, got: ${JSON.stringify(hkInfo)}`);
    if (!hkInfo.hasLegacySelect) {
      assert.ok(
        hkInfo.recLabels.includes('⌃⌥T'),
        `Expected CM.hotkeyRecorder('bubbleHotkey') label "⌃⌥T" in Translation tab, got: ${JSON.stringify(hkInfo)}`
      );
    }
  } finally {
    await page.close();
  }
});

suite.test('T2-F11-04', 'F11', 'dev/preview.sh succeeds cleanly without bubble.* files', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  assertNotContains(env.previewScriptStdout.toLowerCase(), 'error');
  assertNotContains(env.previewScriptStdout.toLowerCase(), 'no such file');
});

suite.test('T2-F11-05', 'F11', 'APP_BIN contains no bubble.html resource string', async (ctx) => {
  assertExecutable(ctx.appBin);
  const info = await inspectBinaryStrings(ctx.appBin);
  assertNotContains(info.strings, 'bubble.html');
});

// ===========================================================================
// F18: Vision OCR linkage boundaries (5 tests)
// ===========================================================================

suite.test('T2-F18-01', 'F18', 'otool -L "$APP_BIN" has zero non-system or Homebrew dylib dependencies', async (ctx) => {
  const libs = await otoolLinkedFrameworks(ctx.appBin);
  for (const lib of libs) {
    const allowed =
      lib.startsWith('/System/Library/') ||
      lib.startsWith('/usr/lib/') ||
      lib.startsWith('@executable_path') ||
      lib.startsWith('@rpath');
    assert.equal(allowed, true, `Disallowed non-system dylib dependency: ${lib}`);
    assertNotMatches(lib, /^\/(opt\/homebrew|usr\/local|Users)\//, `Forbidden local dependency: ${lib}`);
  }
});

suite.test('T2-F18-02', 'F18', 'Mach-O LC_BUILD_VERSION minos is >= 13.0', async (ctx) => {
  assertExecutable(ctx.appBin);
  const res = await inspectMachOBuildVersion(ctx.appBin);
  assert.equal(res.ok, true);
  assert.ok(res.minos, 'Could not find minos in otool -l');
  const major = Number(String(res.minos).split('.')[0]);
  assert.ok(major >= 13, `Expected minos >= 13.0, got ${res.minos}`);
});

suite.test('T2-F18-03', 'F18', 'Linkage inspector handles missing and non-Mach-O files gracefully without throwing', async (ctx) => {
  const missing = await inspectMachOLinkage('/nonexistent/TextMonitor_E2E_Missing');
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'missing');

  const nonMacho = await inspectMachOLinkage(path.join(ctx.repoRoot, 'Info.plist'));
  assert.equal(nonMacho.ok, false);
  assert.equal(nonMacho.reason, 'invalid_macho');
});

suite.test('T2-F18-04', 'F18', 'Built APP_BIN is not stale relative to build.sh and VERSION', async (ctx) => {
  assertExecutable(ctx.appBin);
  const binStat = fs.statSync(ctx.appBin);
  const buildStat = fs.statSync(path.join(ctx.repoRoot, 'build.sh'));
  assert.ok(binStat.mtimeMs >= buildStat.mtimeMs, 'APP_BIN is older than build.sh');
  const bndPlist = await readPlistJson(path.join(ctx.appBundle, 'Contents', 'Info.plist'));
  assert.equal(bndPlist.CFBundleShortVersionString, '1.2.0');
});

suite.test('T2-F18-05', 'F18', 'Built APP_BIN supports host CPU architecture', async (ctx) => {
  assertExecutable(ctx.appBin);
  const res = await inspectMachOArchs(ctx.appBin);
  assert.equal(res.ok, true);
  const expectedArch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  assert.ok(
    res.archs.includes(expectedArch),
    `Expected ${expectedArch} in binary architectures ${JSON.stringify(res.archs)}`
  );
});

// ===========================================================================
// F23: URL scheme boundaries (6 tests)
// ===========================================================================

suite.test('T2-F23-01', 'F23', 'Info.plist CFBundleURLTypes has no duplicates, trailing slashes, or http/https hijack', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.appBundle, 'Contents', 'Info.plist'));
  const schemes = (plist.CFBundleURLTypes || []).flatMap((e) => e.CFBundleURLSchemes || []);
  const tmCount = schemes.filter((s) => s === 'textmonitor').length;
  assert.equal(tmCount, 1, `Expected exactly 1 "textmonitor" scheme, found ${tmCount}`);
  for (const s of schemes) {
    assertNotContains(s, '://');
    assert.ok(!['http', 'https', 'file'].includes(s.toLowerCase()), `Disallowed scheme ${s}`);
  }
});

async function sendUrlAndAssertAlive(ctx, gui, url) {
  await deliverIsolatedUrl(gui, url);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gui.isAlive(), true, `Isolated GUI crashed after URL: ${url}`);
  const hist = await runCli(ctx.appBin, ['history'], {
    env: { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir },
    timeoutMs: 2500,
  });
  assertExitCode(hist, 0);
  return hist;
}

suite.test('T2-F23-02', 'F23', 'Unknown textmonitor:// action keeps isolated app alive and responsive', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://unknown-action-xyz?text=foo');
});

suite.test('T2-F23-03', 'F23', 'Missing or empty text parameter in textmonitor://push does not crash or record empty item', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
  const before = await runCli(ctx.appBin, ['history'], { env, timeoutMs: 2500 });
  assertExitCode(before, 0);

  await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://push');
  const after = await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://push?text=');

  const inspectHistory = (stdout) => {
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) return { isJson: true, items: parsed, count: parsed.length };
    } catch {
      // plain text fallback
    }
    const lines = stdout.split('\n').filter((l) => l.length > 0);
    return { isJson: false, lines, count: lines.length };
  };

  const bInfo = inspectHistory(before.stdout);
  const aInfo = inspectHistory(after.stdout);
  assert.equal(aInfo.count, bInfo.count, `History item count grew on empty push (${bInfo.count} -> ${aInfo.count})`);
  assert.equal(after.stdout, before.stdout, 'History output changed on empty textmonitor://push');
  if (aInfo.isJson) {
    assert.equal(aInfo.items.some((it) => typeof it.text === 'string' && it.text === ''), false);
  } else {
    assert.ok(aInfo.lines.every((l) => l.trim().length > 0));
  }
});

suite.test('T2-F23-04', 'F23', 'textmonitor://x-callback-url/push delivers payload to isolated history', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  await deliverIsolatedUrl(gui, 'textmonitor://x-callback-url/push?text=XCB_OK_E2E&x-source=e2e');
  const deadline = Date.now() + 4500;
  let found = false;
  let last = '';
  while (Date.now() < deadline) {
    const hist = await runCli(ctx.appBin, ['history'], {
      env: { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir },
      timeoutMs: 2000,
    });
    last = hist.stdout;
    if (hist.code === 0 && hist.stdout.includes('XCB_OK_E2E')) {
      found = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.equal(found, true, `x-callback-url/push item not found in history: ${last}`);
});

suite.test('T2-F23-05', 'F23', 'Malformed percent-encoding in textmonitor://push does not crash app', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://push?text=%ZZ%E0%A4%A');
});

suite.test('T2-F23-06', 'F23', 'textmonitor://translate and textmonitor://lens URLs handle cleanly without crash', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://translate?text=hello&to=he');
  await sendUrlAndAssertAlive(ctx, gui, 'textmonitor://lens');
});

// ===========================================================================
// F24: Expanded NSServices boundaries (5 tests)
// ===========================================================================

suite.test('T2-F24-01', 'F24', 'NSServices entries have unique NSMessage selectors and NSMenuItem.default titles', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const services = plist.NSServices || [];
  const msgs = services.map((s) => s.NSMessage);
  const titles = services.map((s) => s.NSMenuItem?.default);
  assert.equal(new Set(msgs).size, services.length, `Duplicate NSMessage in NSServices: ${msgs.join(', ')}`);
  assert.equal(new Set(titles).size, services.length, `Duplicate NSMenuItem.default in NSServices: ${titles.join(', ')}`);
});

suite.test('T2-F24-02', 'F24', 'Hebrew ServicesMenu.strings values contain Hebrew and follow maqaf rule', async (ctx) => {
  const enDict = await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'en.lproj', 'ServicesMenu.strings'));
  const heDict = await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'he.lproj', 'ServicesMenu.strings'));
  for (const [key, heVal] of Object.entries(heDict)) {
    assertMatches(heVal, /[\u0590-\u05FF]/, `Hebrew ServicesMenu value lacks Hebrew characters: ${key}=${heVal}`);
    assert.notEqual(heVal, enDict[key], `Hebrew ServicesMenu value untranslated for ${key}`);
    assertNotMatches(heVal, /[בלהוכמש]-[A-Za-z]/, `ASCII hyphen instead of maqaf in ServicesMenu: ${heVal}`);
  }
});

suite.test('T2-F24-03', 'F24', 'NSServices NSMessage values are valid Objective-C selector identifiers', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  for (const svc of plist.NSServices || []) {
    assertMatches(String(svc.NSMessage), /^[A-Za-z_][A-Za-z0-9_]*$/, `Invalid NSMessage selector: ${svc.NSMessage}`);
  }
});

suite.test('T2-F24-04', 'F24', 'CFBundleLocalizations includes both en and he matching Localized/*.lproj', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const locs = plist.CFBundleLocalizations || [];
  assert.ok(locs.includes('en'), 'Info.plist CFBundleLocalizations missing en');
  assert.ok(locs.includes('he'), 'Info.plist CFBundleLocalizations missing he');
});

suite.test('T2-F24-05', 'F24', 'ServicesMenu.strings files have no duplicate keys or silent shadowing', async (ctx) => {
  for (const lang of ['en', 'he']) {
    const p = path.join(ctx.repoRoot, 'Localized', `${lang}.lproj`, 'ServicesMenu.strings');
    const raw = fs.readFileSync(p, 'utf8');
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const lineEntries = [...stripped.matchAll(/"(?:[^"\\]|\\.)+"\s*=\s*"(?:[^"\\]|\\.)*"\s*;/g)];
    const parsed = await readStringsJson(p);
    assert.equal(
      Object.keys(parsed).length,
      lineEntries.length,
      `Possible duplicate or malformed key in ${lang}.lproj/ServicesMenu.strings`
    );
  }
});

// ===========================================================================
// F26: Built-in CLI + IPC + --mcp boundaries (10 tests)
// ===========================================================================

suite.test('T2-F26-01', 'F26', 'CLI unknown subcommand exits non-zero quickly with stderr error', async (ctx) => {
  const res = await runCli(ctx.appBin, ['unknown-subcmd-xyz'], { timeoutMs: 1500 });
  assert.notEqual(res.code, 0);
  assert.equal(res.signal, null);
  assert.equal(res.timedOut, false);
  assert.ok(res.stderr.trim().length > 0, 'Expected stderr error message on unknown subcommand');
});

suite.test('T2-F26-02', 'F26', 'CLI missing args and empty stdin terminate quickly without hanging', async (ctx) => {
  const { home, supportDir } = createIsolatedHome('tm-t2f2602-');
  try {
    const env = { ...process.env, HOME: home, TEXTMONITOR_SUPPORT_DIR: supportDir };
    for (const args of [['flip'], ['rtl'], ['action'], ['translate']]) {
      const res = await runCli(ctx.appBin, args, { env, stdin: '', timeoutMs: 1500 });
      assert.equal(res.timedOut, false, `CLI ${args.join(' ')} hung`);
      assert.equal(res.signal, null, `CLI ${args.join(' ')} crashed with signal ${res.signal}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

suite.test('T2-F26-03', 'F26', 'IPC-backed CLI commands fail cleanly when no server socket exists', async (ctx) => {
  const { home, supportDir } = createIsolatedHome('tm-noipc-');
  try {
    const env = { ...process.env, HOME: home, TEXTMONITOR_SUPPORT_DIR: supportDir };
    for (const sub of ['history', 'show', 'action', 'translate']) {
      const res = await runCli(ctx.appBin, [sub], { env, timeoutMs: 2000 });
      assert.notEqual(res.code, 0, `Expected non-zero exit for ${sub} without IPC server`);
      assert.equal(res.timedOut, false);
      assert.equal(res.signal, null);
      assert.ok((res.stderr + res.stdout).trim().length > 0, `Expected diagnostic error for ${sub}`);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

suite.test('T2-F26-04', 'F26', 'Stale textmonitor.sock (ECONNREFUSED) is unlinked and rebound 0600 on launch', async (ctx) => {
  const { home, supportDir, sockPath } = createIsolatedHome('tm-stale-');
  let app = null;
  try {
    // Create a stale Unix domain socket using Python (does not unlink on close)
    await execFileAsync(
      'python3',
      [
        '-c',
        'import socket, sys; s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.bind(sys.argv[1]); s.listen(1); s.close()',
        sockPath,
      ],
      { encoding: 'utf8' }
    );

    const beforeProbe = await probeUnixSocket(sockPath);
    assert.equal(beforeProbe.exists, true);
    assert.equal(beforeProbe.connected, false);
    assert.equal(beforeProbe.errorCode, 'ECONNREFUSED');

    const env = { ...process.env, HOME: home, TEXTMONITOR_SUPPORT_DIR: supportDir };
    const beforeCli = await runCli(ctx.appBin, ['history'], {
      env,
      timeoutMs: 2000,
    });
    assert.notEqual(beforeCli.code, 0);

    app = await startIsolatedApp(ctx, { home, supportDir, keepHomeOnStop: true });
    const afterProbe = await probeUnixSocket(sockPath);
    assert.equal(afterProbe.connected, true);
    assert.equal(afterProbe.mode, 0o600);

    const afterCli = await runCli(ctx.appBin, ['history'], {
      env,
      timeoutMs: 2000,
    });
    assertExitCode(afterCli, 0);
  } finally {
    if (app) await app.stop();
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

suite.test('T2-F26-05', 'F26', '>104-byte socket path is handled safely without SIGABRT/crash', async (ctx) => {
  const longBase = fs.mkdtempSync('/tmp/tm-longpath-');
  const longHome = path.join(longBase, 'a'.repeat(55));
  const supportDir = path.join(longHome, 'Library', 'Application Support', 'Clipboard Monitor');
  fs.mkdirSync(supportDir, { recursive: true });
  const sockPath = path.join(supportDir, 'textmonitor.sock');
  assert.ok(Buffer.byteLength(sockPath, 'utf8') > 104, `Expected >104 bytes, got ${Buffer.byteLength(sockPath, 'utf8')}`);

  let app = null;
  try {
    app = await startIsolatedApp(ctx, { home: longHome, supportDir, waitForSocket: false, keepHomeOnStop: true });
    await new Promise((r) => setTimeout(r, 800));
    const exit = app.getExit();
    assert.equal(exit.exitSignal, null, `App crashed with signal ${exit.exitSignal} on >104B sun_path`);

    const cliRes = await runCli(ctx.appBin, ['history'], {
      env: { ...process.env, HOME: longHome, TEXTMONITOR_SUPPORT_DIR: supportDir },
      timeoutMs: 2000,
    });
    assert.equal(cliRes.signal, null, `CLI crashed with signal ${cliRes.signal} on >104B sun_path`);
    assert.equal(cliRes.timedOut, false);
  } finally {
    if (app) await app.stop();
    fs.rmSync(longBase, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

suite.test('T2-F26-06', 'F26', '--mcp handles malformed JSON (-32700) and stays alive for subsequent requests', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    const errRes = await mcp.sendRawExpectResponse('{not valid json', { id: null });
    assert.equal(errRes.jsonrpc, '2.0');
    assert.equal(errRes.error?.code, -32700);

    await mcp.initialize();
    const toolsRes = await mcp.listTools();
    assert.ok(Array.isArray(toolsRes.result?.tools) && toolsRes.result.tools.length === 7);
  } finally {
    await mcp.close();
  }
});

suite.test('T2-F26-07', 'F26', '--mcp returns JSON-RPC -32601 on unknown method with matching id', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    await mcp.initialize();
    const res = await mcp.request('unknown/op', {}, { id: 77 });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 77);
    assert.equal(res.error?.code, -32601);
  } finally {
    await mcp.close();
  }
});

suite.test('T2-F26-08', 'F26', '--mcp returns structured error on unknown tool and invalid params', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    await mcp.initialize();
    const rUnknown = await mcp.callTool('no_such_tool', {});
    assert.ok(
      rUnknown.error?.code === -32601 || rUnknown.error?.code === -32602 || rUnknown.result?.isError === true,
      `Expected error for unknown tool, got ${JSON.stringify(rUnknown)}`
    );

    const rMissingParam = await mcp.callTool('flip_keyboard_text', {});
    assert.ok(
      rMissingParam.error?.code === -32602 || rMissingParam.result?.isError === true,
      `Expected invalid params error for missing text, got ${JSON.stringify(rMissingParam)}`
    );

    const rWrongType = await mcp.callTool('flip_keyboard_text', { text: 123 });
    assert.ok(
      rWrongType.error?.code === -32602 || rWrongType.result?.isError === true,
      `Expected invalid params error for non-string text, got ${JSON.stringify(rWrongType)}`
    );
  } finally {
    await mcp.close();
  }
});

suite.test('T2-F26-09', 'F26', '--mcp preserves id types (0, string, number), tolerates blank lines, and emits zero non-JSON stdout', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    mcp.sendRaw('\n\n');
    const r0 = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0' } }, { id: 0 });
    assert.strictEqual(r0.id, 0);

    mcp.sendRaw('\n');
    const rStr = await mcp.request('tools/call', { name: 'flip_keyboard_text', arguments: { text: 'akuo' } }, { id: 'abc' });
    assert.strictEqual(rStr.id, 'abc');

    const rNum = await mcp.request('tools/call', { name: 'wrap_rtl_text', arguments: { text: 'שלום' } }, { id: 99 });
    assert.strictEqual(rNum.id, 99);
  } finally {
    const closed = await mcp.close();
    assert.deepEqual(closed.nonJsonStdoutLines, []);
  }
});

suite.test('T2-F26-10', 'F26', '--mcp handles IPC-off tool cleanly, processes 50KB wrap_rtl_text, and exits 0 on EOF', async (ctx) => {
  const { home, supportDir } = createIsolatedHome('tm-mcp-noipc-');
  const mcp = await createMcpClient(ctx.appBin, { env: { HOME: home, TEXTMONITOR_SUPPORT_DIR: supportDir } });
  try {
    await mcp.initialize();
    const rHist = await mcp.callTool('get_clipboard_history', {});
    assert.ok(
      Boolean(rHist.error) || rHist.result?.isError === true,
      `Expected structured error when IPC server is absent, got: ${JSON.stringify(rHist)}`
    );

    const big = 'שלום '.repeat(10000);
    const rBig = await mcp.callTool('wrap_rtl_text', { text: big });
    assert.ok(!rBig.error && !rBig.result?.isError);
    const txt = (rBig.result?.content || []).map((c) => c.text || '').join('');
    assert.equal(txt, `\u2067${big}\u2069`);
  } finally {
    const startClose = Date.now();
    const closed = await mcp.close({ timeoutMs: 1500 });
    assert.equal(closed.code, 0);
    assert.ok(Date.now() - startClose < 1500);
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// ===========================================================================
// F27: Hebrew UI & I18N boundaries (5 tests)
// ===========================================================================

async function collectPageDicts(ctx, url, initScript = '') {
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({ initScript: I18N_CAPTURE_INIT + '\n' + initScript });
  try {
    await page.goto(url, { settleMs: 250 });
    return await page.evaluate(() => window.__i18nDicts || { en: {}, he: {} });
  } finally {
    await page.close();
  }
}

suite.test('T2-F27-01', 'F27', 'Interpolation {var} placeholder parity between en and he across all 3 pages', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const sources = [
    { name: 'preview.html', dicts: await collectPageDicts(ctx, env.previewUrl) },
    { name: 'actions-preview.html', dicts: await collectPageDicts(ctx, env.actionsPreviewUrl) },
    {
      name: 'lens.html',
      dicts: await collectPageDicts(ctx, env.lensUrl, 'window.webkit={messageHandlers:{app:{postMessage(){}}}};'),
    },
  ];
  const extractVars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const src of sources) {
    const en = src.dicts.en || {};
    const he = src.dicts.he || {};
    for (const key of Object.keys(en)) {
      if (!(key in he)) continue;
      assert.deepEqual(
        extractVars(he[key]),
        extractVars(en[key]),
        `Placeholder mismatch in ${src.name} for "${key}": en=${JSON.stringify(en[key])}, he=${JSON.stringify(he[key])}`
      );
    }
  }
});

suite.test('T2-F27-02', 'F27', 'Zero orphaned Hebrew keys missing from English dictionaries', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const pages = [
    { name: 'preview.html', dicts: await collectPageDicts(ctx, env.previewUrl) },
    { name: 'actions-preview.html', dicts: await collectPageDicts(ctx, env.actionsPreviewUrl) },
    {
      name: 'lens.html',
      dicts: await collectPageDicts(ctx, env.lensUrl, 'window.webkit={messageHandlers:{app:{postMessage(){}}}};'),
    },
  ];
  for (const p of pages) {
    const en = p.dicts.en || {};
    const he = p.dicts.he || {};
    const orphaned = Object.keys(he).filter((k) => !(k in en));
    assert.deepEqual(orphaned, [], `Orphaned he keys in ${p.name}: ${orphaned.join(', ')}`);
  }
});

suite.test('T2-F27-03', 'F27', 'Hebrew UI strings obey maqaf rule and TextMonitor branding', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const dictsList = [
    await collectPageDicts(ctx, env.previewUrl),
    await collectPageDicts(ctx, env.actionsPreviewUrl),
    await collectPageDicts(ctx, env.lensUrl, 'window.webkit={messageHandlers:{app:{postMessage(){}}}};'),
  ];
  const heSwift = parseSwiftStringDict(
    fs.readFileSync(path.join(ctx.repoRoot, 'Sources', 'Localization+he.swift'), 'utf8')
  );

  for (const dicts of dictsList) {
    for (const [k, v] of Object.entries(dicts.he || {})) {
      assertNotMatches(v, /[בלהוכמש]-[A-Za-z]/, `ASCII hyphen after Hebrew prefix in key "${k}": ${v}`);
      assertNotContains(v, 'Clipboard Monitor', `Stale branding in Hebrew UI key "${k}": ${v}`);
    }
  }
  for (const [k, v] of Object.entries(heSwift)) {
    assertNotMatches(v, /[בלהוכמש]-[A-Za-z]/, `ASCII hyphen after Hebrew prefix in Loc.he["${k}"]: ${v}`);
    assertNotContains(v, 'Clipboard Monitor', `Stale branding in Loc.he["${k}"]: ${v}`);
  }
});

suite.test('T2-F27-04', 'F27', 'I18N handles unknown key and unknown language gracefully', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 200 });
    const res = await page.evaluate(() => {
      const missingKey = window.I18N.t('no.such.key.e2e');
      window.I18N.setLang('xx');
      return {
        missingKey,
        lang: window.I18N.lang,
        dir: document.documentElement.dir,
      };
    });
    assert.equal(res.missingKey, 'no.such.key.e2e');
    assert.equal(res.lang, 'en');
    assert.equal(res.dir, 'ltr');
  } finally {
    await page.close();
  }
});

suite.test('T2-F27-05', 'F27', 'Clipboard content and technical inputs remain LTR under RTL Hebrew UI', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => {
      window.MOCK.lang('he');
      window.MOCK.push('Hello world plain text');
    });
    await page.waitFor(() => document.documentElement.dir === 'rtl' && document.querySelector('#content .plain, #content .md'));
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="history"]');
    const dirs = await page.evaluate(() => {
      const contentEl = document.querySelector('#content .plain, #content .md');
      const ltrInput = document.querySelector('#settings .ltr');
      return {
        docDir: document.documentElement.dir,
        contentDir: contentEl ? getComputedStyle(contentEl).direction : null,
        ltrInputDir: ltrInput ? getComputedStyle(ltrInput).direction : null,
      };
    });
    assert.equal(dirs.docDir, 'rtl');
    assert.equal(dirs.contentDir, 'ltr');
    assert.equal(dirs.ltrInputDir, 'ltr');
  } finally {
    await page.close();
  }
});

// ===========================================================================
// F28: Preview & Release Docs boundaries (5 tests)
// ===========================================================================

suite.test('T2-F28-01', 'F28', 'Generated preview HTML asset URLs carry ?v=<digits> and resolve on disk', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const devDir = path.join(env.tmpDir, 'dev');
  for (const name of ['preview.html', 'actions-preview.html']) {
    const html = fs.readFileSync(path.join(devDir, name), 'utf8');
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(urls.length > 0, `No asset URLs found in ${name}`);
    for (const u of urls) {
      if (/^https?:/i.test(u)) continue;
      assertMatches(u, /\?v=\d+$/, `Asset URL missing ?v=<digits> in ${name}: ${u}`);
      const cleanRel = u.replace(/\?v=\d+$/, '');
      const resolved = path.resolve(devDir, cleanRel);
      assert.ok(fs.existsSync(resolved), `Broken asset reference in ${name}: ${u} -> ${resolved}`);
    }
  }
});

suite.test('T2-F28-02', 'F28', 'Mock bridge script injection order is preserved in generated previews', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const previewHtml = fs.readFileSync(path.join(env.tmpDir, 'dev', 'preview.html'), 'utf8');
  const idxMock = previewHtml.indexOf('mock-bridge.js');
  const idxCore = previewHtml.indexOf('core.js');
  assert.ok(idxMock >= 0 && idxCore > idxMock, 'mock-bridge.js must load before core.js in preview.html');

  const actionsHtml = fs.readFileSync(path.join(env.tmpDir, 'dev', 'actions-preview.html'), 'utf8');
  const idxMockA = actionsHtml.indexOf('mock-actions.js');
  const idxI18n = actionsHtml.indexOf('i18n.js');
  const idxActions = actionsHtml.indexOf('actions.js');
  assert.ok(idxMockA >= 0 && idxI18n > idxMockA && idxActions > idxMockA, 'mock-actions.js must load before i18n.js/actions.js');
});

suite.test('T2-F28-03', 'F28', 'dev/mock-bridge.js reports version 1.2.0 and Settings About renders it', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    await page.click('#settings [role="tab"][data-tab="about"]');
    const verNode = await page.waitForSelector('#settings .about-version');
    await page.waitFor(() => (document.querySelector('#settings .about-version')?.textContent || '').includes('1.2.0'));
    const txt = (await page.query('#settings .about-version')).text;
    assertContains(txt, '1.2.0', `Expected About version line to show 1.2.0, got: ${txt || verNode.text}`);
    assertNotContains(txt, '1.1.0');
  } finally {
    await page.close();
  }
});

suite.test('T2-F28-04', 'F28', 'VERSION file adheres to strict semver format without v prefix or extra lines', async (ctx) => {
  const raw = fs.readFileSync(path.join(ctx.repoRoot, 'VERSION'), 'utf8');
  assertMatches(raw, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\n?$/, `Invalid VERSION format: ${JSON.stringify(raw)}`);
  assertNotMatches(raw, /^v/i);
});

suite.test('T2-F28-05', 'F28', 'dev/preview.sh is idempotent modulo ?v= and does not mutate Resources/', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const devDir = path.join(env.tmpDir, 'dev');
  const firstPreview = fs.readFileSync(path.join(devDir, 'preview.html'), 'utf8').replace(/\?v=\d+/g, '?v=X');
  const firstActions = fs.readFileSync(path.join(devDir, 'actions-preview.html'), 'utf8').replace(/\?v=\d+/g, '?v=X');

  await execFileAsync('bash', ['preview.sh'], { cwd: devDir, encoding: 'utf8' });

  const secondPreview = fs.readFileSync(path.join(devDir, 'preview.html'), 'utf8').replace(/\?v=\d+/g, '?v=X');
  const secondActions = fs.readFileSync(path.join(devDir, 'actions-preview.html'), 'utf8').replace(/\?v=\d+/g, '?v=X');
  assert.equal(secondPreview, firstPreview);
  assert.equal(secondActions, firstActions);
});

await suite.run();
