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
  createMcpClient,
  deliverIsolatedUrl,
  lintPlistOrStrings,
  otoolLinkedFrameworks,
  probeUnixSocket,
  readPlistJson,
  readStringsJson,
  runCli,
  startIsolatedApp,
  verifyCodesign,
} from '../lib/cli_mcp.mjs';
import { createIsolatedPreviewEnv, launchBrowser } from '../lib/browser.mjs';

const execFileAsync = promisify(execFile);

const suite = createSuite({
  name: 't1_cli_bundle',
  tier: 1,
  description: 'E2E-M1 Tier 1: CLI, IPC, MCP, Bundle, Transforms, I18N, Dead Cleanup, Vision Linkage & Preview',
});

// ---------------------------------------------------------------------------
// Shared lazy runtime helpers (initialized on demand, cleaned up in afterAll)
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
    ctx.state.f23App = await startIsolatedApp(ctx, { prefix: 'tm-f23-', ephemeralBundle: true });
  }
  return ctx.state.f23App;
}

async function getSharedGuiForF26(ctx) {
  if (!ctx.state.f26App) {
    ctx.state.f26App = await startIsolatedApp(ctx, {
      prefix: 'tm-f26-',
      seedHistory: [
        {
          id: 'e2e-seed-1',
          time: Date.now() - 1000,
          kind: 'text',
          text: 'E2E_SEEDED_HISTORY_ITEM',
          app: 'E2ETest',
        },
      ],
    });
  }
  return ctx.state.f26App;
}

suite.afterAll(async (ctx) => {
  if (ctx.state.f23App) await ctx.state.f23App.stop();
  if (ctx.state.f26App) await ctx.state.f26App.stop();
  if (ctx.state.browser) await ctx.state.browser.close();
  if (ctx.state.previewEnv) await ctx.state.previewEnv.close();
});

// ===========================================================================
// F01: TextTransforms engine (7 tests)
// ===========================================================================

suite.test('T1-F01-01', 'F01', 'APP_BIN flip translates akuo <-> שלום', async (ctx) => {
  const r1 = await runCli(ctx.appBin, ['flip', 'akuo']);
  assertExitCode(r1, 0);
  assert.equal(stripTrailingNewline(r1.stdout), 'שלום');

  const r2 = await runCli(ctx.appBin, ['flip', 'שלום']);
  assertExitCode(r2, 0);
  assert.equal(stripTrailingNewline(r2.stdout), 'akuo');
});

suite.test('T1-F01-02', 'F01', 'APP_BIN flip handles all 5 Hebrew final letters', async (ctx) => {
  const cases = [
    ['loi;.', 'ךםןףץ'],
    ['ךםןףץ', 'loi;.'],
    ['jkui', 'חלון'],
    ['hbau;', 'ינשוף'],
    ['tr.', 'ארץ'],
  ];
  for (const [input, expected] of cases) {
    const res = await runCli(ctx.appBin, ['flip', input]);
    assertExitCode(res, 0);
    assert.equal(stripTrailingNewline(res.stdout), expected, `flip(${input})`);
  }
});

suite.test('T1-F01-03', 'F01', 'APP_BIN flip handles SI-1452 punctuation bidirectionally', async (ctx) => {
  const cases = [
    ["akuo' guko/", 'שלום, עולם.'],
    ['fiqkt', 'כן/לא'],
    ['dwhrpv', "ג'ירפה"],
    ["יקךךםת 'םרךגץ", 'hello, world.'],
  ];
  for (const [input, expected] of cases) {
    const res = await runCli(ctx.appBin, ['flip', input]);
    assertExitCode(res, 0);
    assert.equal(stripTrailingNewline(res.stdout), expected, `flip(${input})`);
  }
});

suite.test('T1-F01-04', 'F01', 'APP_BIN rtl wraps Hebrew and mixed Hebrew/English lines with RLI..PDI', async (ctx) => {
  const r1 = await runCli(ctx.appBin, ['rtl', 'שלום עולם']);
  assertExitCode(r1, 0);
  assert.equal(stripTrailingNewline(r1.stdout), '\u2067שלום עולם\u2069');

  const r2 = await runCli(ctx.appBin, ['rtl', 'React Native הוא framework']);
  assertExitCode(r2, 0);
  assert.equal(stripTrailingNewline(r2.stdout), '\u2067React Native הוא framework\u2069');
});

suite.test('T1-F01-05', 'F01', 'APP_BIN rtl preserves Markdown prefixes outside RLI..PDI isolates', async (ctx) => {
  const input = '## כותרת\n- פריט\n1. שלב\n> ציטוט';
  const expected = '## \u2067כותרת\u2069\n- \u2067פריט\u2069\n1. \u2067שלב\u2069\n> \u2067ציטוט\u2069';
  const res = await runCli(ctx.appBin, ['rtl', input]);
  assertExitCode(res, 0);
  assert.equal(stripTrailingNewline(res.stdout), expected);
});

suite.test('T1-F01-06', 'F01', 'APP_BIN rtl leaves code fences and pure ASCII lines untouched', async (ctx) => {
  const input = 'שלום\n```js\nconst s = "שלום";\n```\nHello';
  const expected = '\u2067שלום\u2069\n```js\nconst s = "שלום";\n```\nHello';
  const res = await runCli(ctx.appBin, ['rtl', input]);
  assertExitCode(res, 0);
  assert.equal(stripTrailingNewline(res.stdout), expected);
});

suite.test('T1-F01-07', 'F01', 'TextTransforms.cleanWhitespace normalizes horizontal spaces and blank lines while preserving indentation', async (ctx) => {
  await withTempDir('tm-swift-clean-', async (tmpDir) => {
    const bin = await compileSwiftCleanWhitespaceDriver(ctx.repoRoot, tmpDir);
    const res = await runCli(bin, [], {
      stdin: '  שלום   \t  עולם  \n\n\n\n  שורה שנייה  ',
    });
    assertExitCode(res, 0);
    assert.equal(res.stdout, '  שלום עולם\n\n  שורה שנייה');
  });
});

// ===========================================================================
// F04: Dead CSS & obsolete file cleanup (5 tests)
// ===========================================================================

suite.test('T1-F04-01', 'F04', 'Dead selectors absent in Resources/settings-actions.css', async (ctx) => {
  const css = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings-actions.css'), 'utf8');
  const selectors = extractCssSelectors(css);
  for (const dead of ['.ca-del', '.a-custom-hint', '.ca', '.ca-head']) {
    assert.equal(hasCssClassToken(selectors, dead), false, `Found dead selector ${dead} in settings-actions.css`);
  }
});

suite.test('T1-F04-02', 'F04', 'Dead .about-copy selector absent in Resources/settings-about.css', async (ctx) => {
  const css = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'settings-about.css'), 'utf8');
  const selectors = extractCssSelectors(css);
  assert.equal(hasCssClassToken(selectors, '.about-copy'), false, 'Found dead selector .about-copy in settings-about.css');
});

suite.test('T1-F04-03', 'F04', 'Dead .chip.held selector absent in Resources/app.css', async (ctx) => {
  const css = fs.readFileSync(path.join(ctx.repoRoot, 'Resources', 'app.css'), 'utf8');
  const selectors = extractCssSelectors(css);
  const hasHeld = selectors.some((s) => /\.chip\.held(?![A-Za-z0-9_-])/.test(s));
  assert.equal(hasHeld, false, 'Found dead selector .chip.held in app.css');
  assert.equal(hasCssClassToken(selectors, '.chip'), true, '.chip must remain in app.css');
});

suite.test('T1-F04-04', 'F04', 'CSSOM valid and zero HTML/JS references to dead classes', async (ctx) => {
  const resDir = path.join(ctx.repoRoot, 'Resources');
  const files = fs.readdirSync(resDir).filter((f) => /\.(html|js)$/.test(f));
  const deadTokens = ['ca-del', 'a-custom-hint', 'ca-head', 'about-copy', 'chip held'];
  const heldClassRe = /\bclass\s*=\s*["'][^"']*\bheld\b|classList\.(?:add|toggle|contains|remove)\(\s*['"]held['"]|\.className\s*=\s*['"][^'"]*\bheld\b/;
  for (const file of files) {
    const content = fs.readFileSync(path.join(resDir, file), 'utf8');
    for (const tok of deadTokens) {
      assertNotContains(content, tok, `Dead token "${tok}" still referenced in Resources/${file}`);
    }
    assertNotMatches(content, heldClassRe, `Dead "held" class token still referenced in Resources/${file}`);
  }

  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    const sheets = await page.evaluate(() =>
      [...document.styleSheets].map((s) => ({
        href: s.href,
        rules: (() => {
          try {
            return s.cssRules.length;
          } catch {
            return -1;
          }
        })(),
      }))
    );
    assert.ok(sheets.length > 0, 'Expected stylesheets to load');
    for (const s of sheets) {
      assert.ok(s.rules > 0, `Stylesheet ${s.href} failed to load or has 0 rules (${s.rules})`);
    }
  } finally {
    await page.close();
  }
});

suite.test('T1-F04-05', 'F04', 'Bundled CSS in APP_BUNDLE matches cleaned sources', async (ctx) => {
  const resDir = path.join(ctx.appBundle, 'Contents', 'Resources');
  assert.ok(fs.existsSync(resDir), `Built bundle resources not found: ${resDir}`);

  const actionsSelectors = extractCssSelectors(fs.readFileSync(path.join(resDir, 'settings-actions.css'), 'utf8'));
  for (const dead of ['.ca-del', '.a-custom-hint', '.ca', '.ca-head']) {
    assert.equal(hasCssClassToken(actionsSelectors, dead), false, `Bundle settings-actions.css still has ${dead}`);
  }

  const aboutSelectors = extractCssSelectors(fs.readFileSync(path.join(resDir, 'settings-about.css'), 'utf8'));
  assert.equal(hasCssClassToken(aboutSelectors, '.about-copy'), false, 'Bundle settings-about.css still has .about-copy');

  const appSelectors = extractCssSelectors(fs.readFileSync(path.join(resDir, 'app.css'), 'utf8'));
  assert.equal(
    appSelectors.some((s) => /\.chip\.held(?![A-Za-z0-9_-])/.test(s)),
    false,
    'Bundle app.css still has .chip.held'
  );
});

// ===========================================================================
// F07: Obsolete docs deletion (5 tests)
// ===========================================================================

suite.test('T1-F07-01', 'F07', 'docs/PLAN-settings-ai-i18n.md is deleted', async (ctx) => {
  const p = path.join(ctx.repoRoot, 'docs', 'PLAN-settings-ai-i18n.md');
  assert.equal(fs.existsSync(p), false, `Obsolete doc still exists: ${p}`);
});

suite.test('T1-F07-02', 'F07', 'docs/UI-REVIEW-1.md is deleted', async (ctx) => {
  const p = path.join(ctx.repoRoot, 'docs', 'UI-REVIEW-1.md');
  assert.equal(fs.existsSync(p), false, `Obsolete doc still exists: ${p}`);
});

suite.test('T1-F07-03', 'F07', 'Deleted docs are absent from APP_BUNDLE/Contents/Resources', async (ctx) => {
  const resDir = path.join(ctx.appBundle, 'Contents', 'Resources');
  assert.ok(fs.existsSync(resDir), `Built bundle resources not found: ${resDir}`);
  assert.equal(fs.existsSync(path.join(resDir, 'PLAN-settings-ai-i18n.md')), false);
  assert.equal(fs.existsSync(path.join(resDir, 'UI-REVIEW-1.md')), false);
});

suite.test('T1-F07-04', 'F07', 'build.sh and dev/preview.sh have no references to deleted docs', async (ctx) => {
  for (const rel of ['build.sh', path.join('dev', 'preview.sh')]) {
    const text = fs.readFileSync(path.join(ctx.repoRoot, rel), 'utf8');
    assertNotContains(text, 'PLAN-settings-ai-i18n', `${rel} references PLAN-settings-ai-i18n`);
    assertNotContains(text, 'UI-REVIEW-1', `${rel} references UI-REVIEW-1`);
  }
});

suite.test('T1-F07-05', 'F07', 'Resources HTML and JS have no references to deleted docs', async (ctx) => {
  const resDir = path.join(ctx.repoRoot, 'Resources');
  for (const file of fs.readdirSync(resDir).filter((f) => /\.(html|js)$/.test(f))) {
    const text = fs.readFileSync(path.join(resDir, file), 'utf8');
    assertNotContains(text, 'PLAN-settings-ai-i18n', `Resources/${file} references PLAN-settings-ai-i18n`);
    assertNotContains(text, 'UI-REVIEW-1', `Resources/${file} references UI-REVIEW-1`);
  }
});

// ===========================================================================
// F08: Bundle metadata & docs (5 tests)
// ===========================================================================

suite.test('T1-F08-01', 'F08', 'Source Info.plist is valid and sets LSMinimumSystemVersion to 13.0', async (ctx) => {
  const plistPath = path.join(ctx.repoRoot, 'Info.plist');
  const lint = await lintPlistOrStrings(plistPath);
  assert.equal(lint.ok, true, `plutil -lint failed: ${lint.stderr}`);
  const plist = await readPlistJson(plistPath);
  assert.equal(plist.LSMinimumSystemVersion, '13.0');
  assert.equal(plist.CFBundleExecutable, 'TextMonitor');
  assert.equal(plist.CFBundleName, 'TextMonitor');
});

suite.test('T1-F08-02', 'F08', 'Built APP_BUNDLE/Contents/Info.plist is stamped for v1.2.0', async (ctx) => {
  const plistPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
  assert.ok(fs.existsSync(plistPath), `Built Info.plist not found: ${plistPath}`);
  const lint = await lintPlistOrStrings(plistPath);
  assert.equal(lint.ok, true, `plutil -lint failed: ${lint.stderr}`);
  const plist = await readPlistJson(plistPath);
  assert.equal(plist.LSMinimumSystemVersion, '13.0');
  assert.equal(plist.CFBundleShortVersionString, '1.2.0');
  assert.ok(typeof plist.CFBundleVersion === 'string' && plist.CFBundleVersion.trim().length > 0, 'Missing CFBundleVersion');
  assert.ok(typeof plist.CMGitCommit === 'string' && plist.CMGitCommit.trim().length > 0, 'Missing CMGitCommit');
  assert.ok(typeof plist.CMBuildDate === 'string' && plist.CMBuildDate.trim().length > 0, 'Missing CMBuildDate');
});

suite.test('T1-F08-03', 'F08', 'CHANGELOG.md uses TextMonitor branding and documents 1.2.0', async (ctx) => {
  const changelog = fs.readFileSync(path.join(ctx.repoRoot, 'CHANGELOG.md'), 'utf8');
  assertMatches(changelog, /^## \[1\.2\.0\]/m, 'CHANGELOG.md missing ## [1.2.0] heading');
  assertNotContains(changelog, 'Open in Clipboard Monitor', 'Stale "Open in Clipboard Monitor" found');
  const sanitized = changelog
    .replace(/formerly Clipboard Monitor/gi, '')
    .replace(/Clipboard Monitor Dev/g, '');
  assertNotContains(sanitized, 'Clipboard Monitor', 'Stale active "Clipboard Monitor" branding in CHANGELOG.md');
});

suite.test('T1-F08-04', 'F08', 'README.md Shortcuts table includes all v1.2.0 shortcuts', async (ctx) => {
  const readme = fs.readFileSync(path.join(ctx.repoRoot, 'README.md'), 'utf8');
  const secMatch = readme.match(/## Shortcuts[\s\S]*?(?=\n## |$)/);
  assert.ok(secMatch, 'README.md missing ## Shortcuts section');
  const table = secMatch[0];
  const required = ['⌃⌥V', '⌃⌥A', '⌃⌥K', '⌃⌥T', '⌃⌥⌘T', '⌘E', '⌘N', '⌘L', '⌘R', '⌘Y', '⇧⌘C', '⇧⌘T', '⇧⌘P', '⌘,'];
  for (const sc of required) {
    assertContains(table, sc, `README.md Shortcuts table missing ${sc}`);
  }
});

suite.test('T1-F08-05', 'F08', 'Executable path and codesign --verify --deep --strict pass', async (ctx) => {
  assertExecutable(ctx.appBin);
  assert.equal(path.basename(ctx.appBin), 'TextMonitor');
  const res = await verifyCodesign(ctx.appBundle);
  assert.equal(res.ok, true, `codesign verify failed: ${res.stderr || res.stdout}`);
});

// ===========================================================================
// F11: Bubble files deletion (5 tests)
// ===========================================================================

suite.test('T1-F11-01', 'F11', 'Sources/Lens/BubbleController.swift is deleted', async (ctx) => {
  const p = path.join(ctx.repoRoot, 'Sources', 'Lens', 'BubbleController.swift');
  assert.equal(fs.existsSync(p), false, `BubbleController.swift still exists: ${p}`);
});

suite.test('T1-F11-02', 'F11', 'Resources/bubble.{html,js,css} are deleted', async (ctx) => {
  for (const f of ['bubble.html', 'bubble.js', 'bubble.css']) {
    const p = path.join(ctx.repoRoot, 'Resources', f);
    assert.equal(fs.existsSync(p), false, `Resources/${f} still exists`);
  }
});

suite.test('T1-F11-03', 'F11', 'Built APP_BUNDLE contains no bubble.* resources', async (ctx) => {
  const resDir = path.join(ctx.appBundle, 'Contents', 'Resources');
  assert.ok(fs.existsSync(resDir), `Built bundle resources not found: ${resDir}`);
  for (const f of ['bubble.html', 'bubble.js', 'bubble.css']) {
    assert.equal(fs.existsSync(path.join(resDir, f)), false, `Bundle still contains ${f}`);
  }
});

suite.test('T1-F11-04', 'F11', 'Scripts and README have no active refs to BubbleController or Resources/bubble', async (ctx) => {
  for (const rel of ['build.sh', path.join('dev', 'preview.sh'), 'README.md']) {
    const text = fs.readFileSync(path.join(ctx.repoRoot, rel), 'utf8');
    assertNotContains(text, 'BubbleController', `${rel} still references BubbleController`);
    assertNotContains(text, 'Resources/bubble', `${rel} still references Resources/bubble`);
  }
});

suite.test('T1-F11-05', 'F11', 'Resources HTML/JS have zero references to bubble.html/js/css', async (ctx) => {
  const resDir = path.join(ctx.repoRoot, 'Resources');
  for (const file of fs.readdirSync(resDir).filter((f) => /\.(html|js)$/.test(f))) {
    const text = fs.readFileSync(path.join(resDir, file), 'utf8');
    assertNotMatches(text, /\bbubble\.(html|js|css)\b/, `Resources/${file} still references bubble asset`);
  }
});

// ===========================================================================
// F18: Vision OCR engine & linkage (5 tests)
// ===========================================================================

suite.test('T1-F18-01', 'F18', 'build.sh specifies -framework Vision and -framework ScreenCaptureKit', async (ctx) => {
  const buildSh = fs.readFileSync(path.join(ctx.repoRoot, 'build.sh'), 'utf8');
  for (const fw of ['Cocoa', 'WebKit', 'Security', 'ApplicationServices', 'Vision', 'ScreenCaptureKit']) {
    assertMatches(buildSh, new RegExp(`-framework\\s+${fw}\\b`), `build.sh missing -framework ${fw}`);
  }
});

suite.test('T1-F18-02', 'F18', 'otool -L "$APP_BIN" links Vision.framework', async (ctx) => {
  const libs = await otoolLinkedFrameworks(ctx.appBin);
  assert.ok(
    libs.some((l) => /\/System\/Library\/Frameworks\/Vision\.framework\//.test(l)),
    `Vision.framework not linked in ${ctx.appBin}: ${libs.join(', ')}`
  );
});

suite.test('T1-F18-03', 'F18', 'otool -L "$APP_BIN" links ScreenCaptureKit.framework', async (ctx) => {
  const libs = await otoolLinkedFrameworks(ctx.appBin);
  assert.ok(
    libs.some((l) => /\/System\/Library\/Frameworks\/ScreenCaptureKit\.framework\//.test(l)),
    `ScreenCaptureKit.framework not linked in ${ctx.appBin}: ${libs.join(', ')}`
  );
});

suite.test('T1-F18-04', 'F18', 'otool -L "$APP_BIN" preserves core frameworks', async (ctx) => {
  const libs = await otoolLinkedFrameworks(ctx.appBin);
  for (const fw of ['Cocoa', 'WebKit', 'Security', 'ApplicationServices']) {
    assert.ok(
      libs.some((l) => new RegExp(`/${fw}\\.framework/`).test(l)),
      `${fw}.framework missing from otool -L output`
    );
  }
});

suite.test('T1-F18-05', 'F18', 'APP_BIN executes CLI cleanly without dyld framework-load errors', async (ctx) => {
  const res = await runCli(ctx.appBin, ['flip', 'hello']);
  assertExitCode(res, 0);
  assertNotMatches(res.stderr, /dyld:|Library not loaded/i);
});

// ===========================================================================
// F23: URL Scheme + x-callback-url (6 tests)
// ===========================================================================

suite.test('T1-F23-01', 'F23', 'Built Info.plist is valid and defines non-empty CFBundleURLTypes', async (ctx) => {
  const plistPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
  assert.ok(fs.existsSync(plistPath), `Built Info.plist not found: ${plistPath}`);
  const lint = await lintPlistOrStrings(plistPath);
  assert.equal(lint.ok, true, lint.stderr);
  const plist = await readPlistJson(plistPath);
  assert.ok(Array.isArray(plist.CFBundleURLTypes) && plist.CFBundleURLTypes.length > 0, 'Missing CFBundleURLTypes');
});

suite.test('T1-F23-02', 'F23', 'CFBundleURLTypes declares exact "textmonitor" scheme', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.appBundle, 'Contents', 'Info.plist'));
  const schemes = (plist.CFBundleURLTypes || []).flatMap((e) => e.CFBundleURLSchemes || []);
  assert.ok(schemes.includes('textmonitor'), `Expected "textmonitor" in CFBundleURLSchemes, got: ${JSON.stringify(schemes)}`);
});

suite.test('T1-F23-03', 'F23', 'CFBundleURLTypes entry has non-empty CFBundleURLName', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.appBundle, 'Contents', 'Info.plist'));
  const entry = (plist.CFBundleURLTypes || []).find((e) => (e.CFBundleURLSchemes || []).includes('textmonitor'));
  assert.ok(entry, 'No CFBundleURLTypes entry for textmonitor');
  assert.ok(typeof entry.CFBundleURLName === 'string' && entry.CFBundleURLName.trim().length > 0, 'Empty CFBundleURLName');
  if (entry.CFBundleTypeRole !== undefined) {
    assert.ok(['Editor', 'Viewer', 'Shell', 'None'].includes(entry.CFBundleTypeRole), `Unexpected role: ${entry.CFBundleTypeRole}`);
  }
});

suite.test('T1-F23-04', 'F23', 'Source Info.plist and bundle Info.plist match on CFBundleURLTypes schemes', async (ctx) => {
  const srcPlist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const bndPlist = await readPlistJson(path.join(ctx.appBundle, 'Contents', 'Info.plist'));
  const srcSchemes = (srcPlist.CFBundleURLTypes || []).flatMap((e) => e.CFBundleURLSchemes || []).sort();
  const bndSchemes = (bndPlist.CFBundleURLTypes || []).flatMap((e) => e.CFBundleURLSchemes || []).sort();
  assert.deepEqual(srcSchemes, bndSchemes);
  assert.ok(srcSchemes.includes('textmonitor'));
});

async function deliverUrlAndAwaitHistory(ctx, gui, url, expectedSubstring, timeoutMs = 4500) {
  await deliverIsolatedUrl(gui, url);
  const deadline = Date.now() + timeoutMs;
  let lastStdout = '';
  while (Date.now() < deadline) {
    const hist = await runCli(ctx.appBin, ['history'], {
      env: { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir },
      timeoutMs: 2000,
    });
    lastStdout = hist.stdout;
    if (hist.code === 0 && hist.stdout.includes(expectedSubstring)) {
      return hist;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Expected isolated history to contain ${JSON.stringify(expectedSubstring)}, got: ${lastStdout}`);
}

suite.test('T1-F23-05', 'F23', 'Live isolated textmonitor://push adds ASCII payload to isolated history', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  await deliverUrlAndAwaitHistory(ctx, gui, 'textmonitor://push?text=E2E_URL_PUSH_123', 'E2E_URL_PUSH_123');
});

suite.test('T1-F23-06', 'F23', 'Live isolated textmonitor://push decodes UTF-8 Hebrew text cleanly', async (ctx) => {
  const gui = await getSharedGuiForF23(ctx);
  const url = 'textmonitor://push?text=%D7%A9%D7%9C%D7%95%D7%9D%20%D7%A2%D7%95%D7%9C%D7%9D_E2E';
  await deliverUrlAndAwaitHistory(ctx, gui, url, 'שלום עולם_E2E');
});

// ===========================================================================
// F24: Expanded NSServices (5 tests)
// ===========================================================================

suite.test('T1-F24-01', 'F24', 'Info.plist NSServices declares >= 4 valid entries', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const services = plist.NSServices;
  assert.ok(Array.isArray(services) && services.length >= 4, `Expected >= 4 NSServices, got ${services?.length}`);
  for (const svc of services) {
    assert.equal(svc.NSPortName, 'TextMonitor');
    assert.ok(typeof svc.NSMessage === 'string' && svc.NSMessage.length > 0);
    assert.ok(svc.NSMenuItem && typeof svc.NSMenuItem.default === 'string' && svc.NSMenuItem.default.length > 0);
    assert.ok(Array.isArray(svc.NSSendTypes) && svc.NSSendTypes.includes('public.utf8-plain-text'));
  }
});

suite.test('T1-F24-02', 'F24', 'Info.plist registers all 4 required macOS Services', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const services = plist.NSServices || [];
  const descriptors = services.map((s) => `${s.NSMessage}::${s.NSMenuItem?.default || ''}`);
  assert.ok(descriptors.some((d) => /textActions/i.test(d) || /Text Actions/i.test(d)), 'Missing Text Actions service');
  assert.ok(descriptors.some((d) => /flip/i.test(d)), 'Missing Flip Keyboard service');
  assert.ok(descriptors.some((d) => /rtl|wrap/i.test(d)), 'Missing Wrap with RTL Marks service');
  assert.ok(descriptors.some((d) => /show|monitor/i.test(d)), 'Missing Show in Monitor service');
});

suite.test('T1-F24-03', 'F24', 'In-place transform services declare NSReturnTypes while non-replacing services do not', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const services = plist.NSServices || [];
  const flipSvc = services.find((s) => /flip/i.test(`${s.NSMessage} ${s.NSMenuItem?.default}`));
  const rtlSvc = services.find((s) => /rtl|wrap/i.test(`${s.NSMessage} ${s.NSMenuItem?.default}`));
  const actionsSvc = services.find((s) => s.NSMessage === 'textActions');
  const showSvc = services.find((s) => /show|monitor/i.test(`${s.NSMessage} ${s.NSMenuItem?.default}`));

  assert.ok(flipSvc && Array.isArray(flipSvc.NSReturnTypes) && flipSvc.NSReturnTypes.includes('public.utf8-plain-text'));
  assert.ok(rtlSvc && Array.isArray(rtlSvc.NSReturnTypes) && rtlSvc.NSReturnTypes.includes('public.utf8-plain-text'));
  assert.ok(actionsSvc && (!actionsSvc.NSReturnTypes || actionsSvc.NSReturnTypes.length === 0));
  assert.ok(showSvc && (!showSvc.NSReturnTypes || showSvc.NSReturnTypes.length === 0));
});

suite.test('T1-F24-04', 'F24', 'en and he ServicesMenu.strings pass plutil -lint and match Info.plist keys', async (ctx) => {
  const plist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const enPath = path.join(ctx.repoRoot, 'Localized', 'en.lproj', 'ServicesMenu.strings');
  const hePath = path.join(ctx.repoRoot, 'Localized', 'he.lproj', 'ServicesMenu.strings');

  assert.equal((await lintPlistOrStrings(enPath)).ok, true, 'en ServicesMenu.strings failed plutil -lint');
  assert.equal((await lintPlistOrStrings(hePath)).ok, true, 'he ServicesMenu.strings failed plutil -lint');

  const enDict = await readStringsJson(enPath);
  const heDict = await readStringsJson(hePath);

  for (const svc of plist.NSServices || []) {
    const key = svc.NSMenuItem?.default;
    assert.ok(typeof enDict[key] === 'string' && enDict[key].trim().length > 0, `Missing en ServicesMenu.strings key: ${key}`);
    assert.ok(typeof heDict[key] === 'string' && heDict[key].trim().length > 0, `Missing he ServicesMenu.strings key: ${key}`);
  }
});

suite.test('T1-F24-05', 'F24', 'Built APP_BUNDLE packages Info.plist NSServices and ServicesMenu.strings', async (ctx) => {
  const bndPlistPath = path.join(ctx.appBundle, 'Contents', 'Info.plist');
  const bndEn = path.join(ctx.appBundle, 'Contents', 'Resources', 'en.lproj', 'ServicesMenu.strings');
  const bndHe = path.join(ctx.appBundle, 'Contents', 'Resources', 'he.lproj', 'ServicesMenu.strings');

  for (const p of [bndPlistPath, bndEn, bndHe]) {
    assert.ok(fs.existsSync(p), `Missing bundle file: ${p}`);
    assert.equal((await lintPlistOrStrings(p)).ok, true, `plutil -lint failed on ${p}`);
  }

  const srcPlist = await readPlistJson(path.join(ctx.repoRoot, 'Info.plist'));
  const bndPlist = await readPlistJson(bndPlistPath);
  assert.deepEqual(bndPlist.NSServices, srcPlist.NSServices);

  assert.deepEqual(
    await readStringsJson(bndEn),
    await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'en.lproj', 'ServicesMenu.strings'))
  );
  assert.deepEqual(
    await readStringsJson(bndHe),
    await readStringsJson(path.join(ctx.repoRoot, 'Localized', 'he.lproj', 'ServicesMenu.strings'))
  );
});

// ===========================================================================
// F26: Built-in CLI + IPC + --mcp (10 tests)
// ===========================================================================

suite.test('T1-F26-01', 'F26', 'APP_BIN --help and help exit 0 quickly and list all subcommands', async (ctx) => {
  for (const arg of ['--help', 'help']) {
    const res = await runCli(ctx.appBin, [arg], { timeoutMs: 1500 });
    assertExitCode(res, 0);
    assert.equal(res.timedOut, false);
    assert.ok(res.durationMs < 1500, `Expected fast CLI exit (<1500ms), took ${res.durationMs}ms`);
    for (const tok of ['rtl', 'flip', 'show', 'action', 'translate', 'history', '--mcp']) {
      assertContains(res.stdout, tok, `Help output missing "${tok}"`);
    }
  }
});

suite.test('T1-F26-02', 'F26', 'APP_BIN rtl wraps Hebrew text quickly with exit 0', async (ctx) => {
  const res = await runCli(ctx.appBin, ['rtl', 'שלום עולם'], { timeoutMs: 1500 });
  assertExitCode(res, 0);
  assert.ok(res.durationMs < 1500);
  assert.equal(stripTrailingNewline(res.stdout), '\u2067שלום עולם\u2069');
});

suite.test('T1-F26-03', 'F26', 'APP_BIN flip converts keyboard layout quickly with exit 0', async (ctx) => {
  const res = await runCli(ctx.appBin, ['flip', 'akuo'], { timeoutMs: 1500 });
  assertExitCode(res, 0);
  assert.ok(res.durationMs < 1500);
  assert.equal(stripTrailingNewline(res.stdout), 'שלום');
});

suite.test('T1-F26-04', 'F26', 'CLI flip and rtl support piped stdin cleanly', async (ctx) => {
  const rFlip = await runCli(ctx.appBin, ['flip'], { stdin: 'akuo', timeoutMs: 1500 });
  assertExitCode(rFlip, 0);
  assert.equal(stripTrailingNewline(rFlip.stdout), 'שלום');

  const rRtl = await runCli(ctx.appBin, ['rtl'], { stdin: 'שלום', timeoutMs: 1500 });
  assertExitCode(rRtl, 0);
  assert.equal(stripTrailingNewline(rRtl.stdout), '\u2067שלום\u2069');
});

suite.test('T1-F26-05', 'F26', 'Isolated GUI instance creates textmonitor.sock with 0600 permissions', async (ctx) => {
  const gui = await getSharedGuiForF26(ctx);
  const probe = await probeUnixSocket(gui.sockPath);
  assert.equal(probe.exists, true);
  assert.equal(probe.isSocket, true);
  assert.equal(probe.connected, true);
  assert.equal(probe.mode, 0o600, `Expected socket mode 0600, got ${probe.modeOctal}`);
});

suite.test('T1-F26-06', 'F26', 'Live IPC history and show respond cleanly over isolated socket', async (ctx) => {
  const gui = await getSharedGuiForF26(ctx);
  const env = { ...process.env, HOME: gui.home, TEXTMONITOR_SUPPORT_DIR: gui.supportDir };
  const hist = await runCli(ctx.appBin, ['history'], { env, timeoutMs: 2000 });
  assertExitCode(hist, 0);
  assertContains(hist.stdout, 'E2E_SEEDED_HISTORY_ITEM');

  const show = await runCli(ctx.appBin, ['show'], { env, timeoutMs: 2000 });
  assertExitCode(show, 0);
});

suite.test('T1-F26-07', 'F26', '--mcp initialize handshake and clean EOF exit', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    const init = await mcp.initialize();
    assert.equal(init.jsonrpc, '2.0');
    assert.ok(init.result, `Expected initialize result, got: ${JSON.stringify(init)}`);
    assert.ok(init.result.protocolVersion);
    assert.ok(init.result.capabilities);
    assert.ok(init.result.serverInfo);

    mcp.notify('notifications/initialized', {});
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    const closed = await mcp.close();
    assert.equal(closed.code, 0, `Expected MCP exit 0 on EOF, got code=${closed.code} stderr=${closed.stderr}`);
    assert.deepEqual(closed.nonJsonStdoutLines, []);
  }
});

suite.test('T1-F26-08', 'F26', '--mcp tools/list exposes all 7 documented tools', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    await mcp.initialize();
    const res = await mcp.listTools();
    assert.ok(res.result && Array.isArray(res.result.tools), `Invalid tools/list response: ${JSON.stringify(res)}`);
    const expected = [
      'push_to_monitor',
      'get_clipboard_history',
      'get_selected_text',
      'replace_selected_text',
      'translate_text',
      'flip_keyboard_text',
      'wrap_rtl_text',
    ];
    const byName = new Map(res.result.tools.map((t) => [t.name, t]));
    for (const name of expected) {
      const tool = byName.get(name);
      assert.ok(tool, `Missing MCP tool: ${name}`);
      assert.ok(typeof tool.description === 'string' && tool.description.length > 0, `Tool ${name} missing description`);
      assert.ok(tool.inputSchema && typeof tool.inputSchema === 'object', `Tool ${name} missing inputSchema`);
    }
  } finally {
    const closed = await mcp.close();
    assert.deepEqual(closed.nonJsonStdoutLines, []);
  }
});

suite.test('T1-F26-09', 'F26', '--mcp tools/call flip_keyboard_text flips text accurately', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    await mcp.initialize();
    const r1 = await mcp.callTool('flip_keyboard_text', { text: 'akuo' });
    assert.ok(!r1.error && !r1.result?.isError, `Unexpected error: ${JSON.stringify(r1)}`);
    const t1 = (r1.result?.content || []).map((c) => c.text || '').join('');
    assert.equal(t1, 'שלום');

    const r2 = await mcp.callTool('flip_keyboard_text', { text: 'שלום' });
    assert.ok(!r2.error && !r2.result?.isError);
    const t2 = (r2.result?.content || []).map((c) => c.text || '').join('');
    assert.equal(t2, 'akuo');
  } finally {
    await mcp.close();
  }
});

suite.test('T1-F26-10', 'F26', '--mcp tools/call wrap_rtl_text wraps Hebrew lines with isolates', async (ctx) => {
  const mcp = await createMcpClient(ctx.appBin);
  try {
    await mcp.initialize();
    const res = await mcp.callTool('wrap_rtl_text', { text: 'שלום world' });
    assert.ok(!res.error && !res.result?.isError, `Unexpected error: ${JSON.stringify(res)}`);
    const txt = (res.result?.content || []).map((c) => c.text || '').join('');
    assert.equal(txt, '\u2067שלום world\u2069');
  } finally {
    await mcp.close();
  }
});

// ===========================================================================
// F27: Hebrew UI & I18N (6 tests)
// ===========================================================================

suite.test('T1-F27-01', 'F27', 'I18N.missing("he") is empty in Monitor (preview.html)', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 250 });
    const missing = await page.evaluate(() => window.I18N.missing('he'));
    assert.deepEqual(missing, []);
  } finally {
    await page.close();
  }
});

suite.test('T1-F27-02', 'F27', 'I18N.missing("he") is empty in Text Actions (actions-preview.html)', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.actionsPreviewUrl, { settleMs: 250 });
    const missing = await page.evaluate(() => window.I18N.missing('he'));
    assert.deepEqual(missing, []);
  } finally {
    await page.close();
  }
});

suite.test('T1-F27-03', 'F27', 'I18N.missing("he") is empty in Translation Lens (lens.html)', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage({
    initScript: 'window.webkit = { messageHandlers: { app: { postMessage() {} } } };',
  });
  try {
    await page.goto(env.lensUrl, { settleMs: 200 });
    const missing = await page.evaluate(() => window.I18N.missing('he'));
    assert.deepEqual(missing, []);
  } finally {
    await page.close();
  }
});

suite.test('T1-F27-04', 'F27', 'Language toggle switches lang and dir (he/rtl <-> en/ltr)', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const p1 = await browser.newPage();
  const p2 = await browser.newPage();
  try {
    await p1.goto(env.previewUrl, { settleMs: 250 });
    await p1.evaluate(() => window.MOCK.lang('he'));
    await p1.waitFor(() => document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl');
    await p1.evaluate(() => window.MOCK.lang('en'));
    await p1.waitFor(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr');

    await p2.goto(env.actionsPreviewUrl, { settleMs: 250 });
    await p2.evaluate(() => window.MOCKA.lang('he'));
    await p2.waitFor(() => document.documentElement.lang === 'he' && document.documentElement.dir === 'rtl');
    await p2.evaluate(() => window.MOCKA.lang('en'));
    await p2.waitFor(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr');
  } finally {
    await p1.close();
    await p2.close();
  }
});

suite.test('T1-F27-05', 'F27', 'All [data-i18n*] attributes resolve in both en and he across all 3 pages', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const pages = [
    {
      url: env.previewUrl,
      setLang: async (p, l) => {
        await p.evaluate((lang) => window.MOCK.lang(lang), l);
        await p.waitFor(`document.documentElement.lang === ${JSON.stringify(l)}`);
      },
    },
    {
      url: env.actionsPreviewUrl,
      setLang: async (p, l) => {
        await p.evaluate((lang) => window.MOCKA.lang(lang), l);
        await p.waitFor(`document.documentElement.lang === ${JSON.stringify(l)}`);
      },
    },
    {
      url: env.lensUrl,
      initScript: 'window.webkit={messageHandlers:{app:{postMessage(){}}}};',
      setLang: async (p, l) => {
        await p.evaluate((lang) => window.I18N.setLang(lang), l);
        await p.waitFor(`document.documentElement.lang === ${JSON.stringify(l)}`);
      },
    },
  ];
  for (const cfg of pages) {
    const page = await browser.newPage({ initScript: cfg.initScript });
    try {
      await page.goto(cfg.url, { settleMs: 250 });
      for (const lang of ['en', 'he']) {
        await cfg.setLang(page, lang);
        const unresolved = await page.evaluate(() => {
          const bad = [];
          const check = (sel, attr, reader) => {
            document.querySelectorAll(sel).forEach((el) => {
              const key = el.getAttribute(attr);
              if (!key) return;
              const translated = window.I18N.t(key);
              if (translated === key) bad.push(`${attr}=${key} (unregistered)`);
              const val = reader(el);
              if (!val || !val.trim()) bad.push(`${attr}=${key} (empty rendered)`);
            });
          };
          check('[data-i18n]', 'data-i18n', (el) => el.textContent);
          check('[data-i18n-title]', 'data-i18n-title', (el) => el.title);
          check('[data-i18n-placeholder]', 'data-i18n-placeholder', (el) => el.placeholder);
          check('[data-i18n-aria]', 'data-i18n-aria', (el) => el.getAttribute('aria-label') || el.textContent);
          return bad;
        });
        assert.deepEqual(unresolved, [], `Unresolved i18n attributes in ${cfg.url} (${lang}): ${unresolved.join(', ')}`);
      }
    } finally {
      await page.close();
    }
  }
});

suite.test('T1-F27-06', 'F27', 'Native Loc.en and Loc.he have full key parity with non-empty strings', async (ctx) => {
  const enSrc = fs.readFileSync(path.join(ctx.repoRoot, 'Sources', 'Localization.swift'), 'utf8');
  const heSrc = fs.readFileSync(path.join(ctx.repoRoot, 'Sources', 'Localization+he.swift'), 'utf8');
  const enDict = parseSwiftStringDict(enSrc);
  const heDict = parseSwiftStringDict(heSrc);
  const enKeys = Object.keys(enDict);
  assert.ok(enKeys.length >= 20, `Expected >= 20 Loc.en keys, got ${enKeys.length}`);
  const missing = enKeys.filter((k) => !heDict[k] || !heDict[k].trim());
  assert.deepEqual(missing, [], `Missing or empty Loc.he keys: ${missing.join(', ')}`);
});

// ===========================================================================
// F28: Preview & Release Docs (6 tests)
// ===========================================================================

suite.test('T1-F28-01', 'F28', 'VERSION equals 1.2.0', async (ctx) => {
  const ver = fs.readFileSync(path.join(ctx.repoRoot, 'VERSION'), 'utf8').trim();
  assert.equal(ver, '1.2.0');
});

suite.test('T1-F28-02', 'F28', 'CHANGELOG.md contains populated [1.2.0] release section', async (ctx) => {
  const changelog = fs.readFileSync(path.join(ctx.repoRoot, 'CHANGELOG.md'), 'utf8');
  const m = changelog.match(/^## \[1\.2\.0\][^\n]*\n([\s\S]*?)(?=\n## |\s*$)/m);
  assert.ok(m, 'CHANGELOG.md missing ## [1.2.0] section');
  assertMatches(m[1], /^-\s+\S+/m, 'CHANGELOG.md [1.2.0] section has no bullet items');
});

suite.test('T1-F28-03', 'F28', 'README.md reflects v1.2.0 capabilities and removes obsolete claims', async (ctx) => {
  const readme = fs.readFileSync(path.join(ctx.repoRoot, 'README.md'), 'utf8');
  for (const term of ['OCR', '--mcp', 'textmonitor://', 'Cron', 'curl']) {
    assertContains(readme, term, `README.md missing v1.2.0 feature mention: ${term}`);
  }
  assertNotContains(readme, 'BubbleController.swift');
  assertNotContains(readme, 'settings-features.js');
  assertNotContains(readme, 'Images, video and scanned PDFs are not supported yet');
});

suite.test('T1-F28-04', 'F28', 'dev/preview.sh executes cleanly in isolated temp workspace', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  assertContains(env.previewScriptStdout, 'preview.html');
  assertContains(env.previewScriptStdout, 'actions-preview.html');
  const p1 = fs.readFileSync(path.join(env.tmpDir, 'dev', 'preview.html'), 'utf8');
  const p2 = fs.readFileSync(path.join(env.tmpDir, 'dev', 'actions-preview.html'), 'utf8');
  assert.ok(p1.length > 500 && p2.length > 300);
});

suite.test('T1-F28-05', 'F28', 'preview.html renders across tabs and languages with zero JS/console/network errors', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.previewUrl, { settleMs: 300 });
    await page.evaluate(() => window.monitor.toggleSettings(true));
    const tabs = await page.queryAll('#settings [role="tab"]');
    assert.ok(tabs.length >= 7, `Expected >= 7 settings tabs, got ${tabs.length}`);
    for (let i = 0; i < tabs.length; i++) {
      await page.evaluate((idx) => {
        document.querySelectorAll('#settings [role="tab"]')[idx]?.click();
      }, i);
      await new Promise((r) => setTimeout(r, 80));
    }
    await page.evaluate(() => window.monitor.toggleSettings(false));
    await page.evaluate(() => window.MOCK.lang('he'));
    await page.evaluate(() => window.MOCK.push('Hello **world** שלום'));
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => window.MOCK.lang('en'));
    await new Promise((r) => setTimeout(r, 100));

    const errs = page.getErrors();
    assert.deepEqual(errs.allErrors, [], `preview.html emitted errors: ${errs.allErrors.join(' | ')}`);
  } finally {
    await page.close();
  }
});

suite.test('T1-F28-06', 'F28', 'actions-preview.html renders and runs actions with zero JS/console/network errors', async (ctx) => {
  const env = await getPreviewEnv(ctx);
  const browser = await getBrowser(ctx);
  const page = await browser.newPage();
  try {
    await page.goto(env.actionsPreviewUrl, { settleMs: 300 });
    await page.evaluate(() => window.MOCKA.lang('he'));
    await new Promise((r) => setTimeout(r, 80));
    await page.evaluate(() => window.MOCKA.lang('en'));
    await new Promise((r) => setTimeout(r, 80));
    const firstAction = await page.evaluate(() => {
      const btn = document.querySelector('#list [role="option"], #list button, .act, .item');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert.equal(firstAction, true, 'No clickable action found in actions-preview.html');
    await new Promise((r) => setTimeout(r, 150));

    const errs = page.getErrors();
    assert.deepEqual(errs.allErrors, [], `actions-preview.html emitted errors: ${errs.allErrors.join(' | ')}`);
  } finally {
    await page.close();
  }
});

await suite.run();
