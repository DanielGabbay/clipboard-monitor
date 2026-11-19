import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../../..');

export { assert };

export function getEnvContext() {
  const repoRoot = path.resolve(process.env.REPO_ROOT || DEFAULT_REPO_ROOT);
  const appBundle = path.resolve(process.env.APP_BUNDLE || path.join(repoRoot, 'build', 'TextMonitor.app'));
  const appBin = path.resolve(process.env.APP_BIN || path.join(appBundle, 'Contents', 'MacOS', 'TextMonitor'));
  return { repoRoot, appBundle, appBin };
}

export async function withTempDir(prefix, fn) {
  const cleanPrefix = String(prefix || 'tm-e2e-').replace(/X+$/, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), cleanPrefix));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export async function withShortTempDir(prefix, fn) {
  const cleanPrefix = String(prefix || 'tm-').replace(/X+$/, '');
  const dir = fs.mkdtempSync(path.join('/tmp', cleanPrefix));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

export function assertContains(haystack, needle, msg) {
  const h = String(haystack ?? '');
  const n = String(needle ?? '');
  if (!h.includes(n)) {
    throw new assert.AssertionError({
      message: msg || `Expected string to contain ${JSON.stringify(n)}, got: ${JSON.stringify(h.slice(0, 400))}`,
      actual: h,
      expected: n,
      operator: 'contains',
    });
  }
}

export function assertNotContains(haystack, needle, msg) {
  const h = String(haystack ?? '');
  const n = String(needle ?? '');
  if (h.includes(n)) {
    throw new assert.AssertionError({
      message: msg || `Expected string NOT to contain ${JSON.stringify(n)}`,
      actual: h,
      expected: `not containing ${n}`,
      operator: 'notContains',
    });
  }
}

export function assertMatches(str, regex, msg) {
  const s = String(str ?? '');
  if (!regex.test(s)) {
    throw new assert.AssertionError({
      message: msg || `Expected ${JSON.stringify(s.slice(0, 400))} to match ${regex}`,
      actual: s,
      expected: String(regex),
      operator: 'matches',
    });
  }
}

export function assertNotMatches(str, regex, msg) {
  const s = String(str ?? '');
  if (regex.test(s)) {
    throw new assert.AssertionError({
      message: msg || `Expected ${JSON.stringify(s.slice(0, 400))} NOT to match ${regex}`,
      actual: s,
      expected: `not matching ${regex}`,
      operator: 'notMatches',
    });
  }
}

export function assertExitCode(res, expected, msg) {
  if (!res || res.code !== expected) {
    const detail = res
      ? `code=${res.code}, signal=${res.signal}, timedOut=${res.timedOut}, stderr=${JSON.stringify((res.stderr || '').slice(0, 400))}`
      : 'null result';
    throw new assert.AssertionError({
      message: msg || `Expected exit code ${expected}, got ${detail}`,
      actual: res ? res.code : null,
      expected,
      operator: 'exitCode',
    });
  }
}

function parseCliArgs(argv) {
  let mode = 'run';
  let json = false;
  let filter = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') mode = 'list';
    else if (a === '--dry-run') mode = 'dry-run';
    else if (a === '--run') mode = 'run';
    else if (a === '--json') json = true;
    else if (a === '--filter' && i + 1 < argv.length) filter = argv[++i];
    else if (a.startsWith('--filter=')) filter = a.slice('--filter='.length);
  }
  return { mode, json, filter };
}

const ID_RE = /^T[1-4]-(F\d{2}|PW|SC)-\d{2,}$/;

export function createSuite({ name, tier, description = '' }) {
  const tests = [];
  const beforeHooks = [];
  const afterHooks = [];

  function beforeAll(fn) {
    beforeHooks.push(fn);
  }

  function afterAll(fn) {
    afterHooks.push(fn);
  }

  function test(id, featureOrFeatures, title, fn, opts = {}) {
    const features = Array.isArray(featureOrFeatures) ? featureOrFeatures : [featureOrFeatures];
    tests.push({
      id,
      feature: features[0] || '',
      features,
      title,
      fn,
      opts,
    });
  }

  function validateDefinitions(ctx) {
    const errors = [];
    const seen = new Set();
    const validTests = new Set();
    let valid = 0;

    try {
      fs.accessSync(ctx.repoRoot, fs.constants.R_OK);
    } catch (e) {
      errors.push(`repoRoot not readable (${ctx.repoRoot}): ${e.message}`);
    }

    for (const t of tests) {
      let ok = true;
      if (!ID_RE.test(t.id)) {
        errors.push(`Invalid test ID format: ${t.id}`);
        ok = false;
      }
      if (seen.has(t.id)) {
        errors.push(`Duplicate test ID: ${t.id}`);
        ok = false;
      }
      seen.add(t.id);
      if (!t.title || typeof t.title !== 'string' || !t.title.trim()) {
        errors.push(`Empty title for test ${t.id}`);
        ok = false;
      }
      if (!t.features.length || t.features.some((f) => typeof f !== 'string' || !f.trim())) {
        errors.push(`Invalid feature tag(s) for test ${t.id}`);
        ok = false;
      }
      if (typeof t.fn !== 'function') {
        errors.push(`Missing test function for ${t.id}`);
        ok = false;
      }
      if (ok) {
        valid++;
        validTests.add(t);
      }
    }

    return { ok: errors.length === 0, errors, valid, validTests };
  }

  async function runWithTimeout(fn, ctx, timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fn(ctx)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Test timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(argv = process.argv.slice(2)) {
    const { mode, json, filter } = parseCliArgs(argv);
    const ctx = getEnvContext();
    const filterLower = filter.toLowerCase();

    const matchesFilter = (t) => {
      if (!filterLower) return true;
      return (
        t.id.toLowerCase().includes(filterLower) ||
        t.title.toLowerCase().includes(filterLower) ||
        t.features.some((f) => f.toLowerCase().includes(filterLower))
      );
    };

    if (mode === 'list') {
      const listed = tests.filter(matchesFilter).map((t) => ({
        id: t.id,
        feature: t.feature,
        features: t.features,
        title: t.title,
      }));
      const payload = {
        suite: name,
        tier,
        description,
        count: listed.length,
        tests: listed,
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      process.exitCode = 0;
      return 0;
    }

    if (mode === 'dry-run') {
      const validation = validateDefinitions(ctx);
      const filteredTests = tests.filter(matchesFilter);
      const filteredValid = filteredTests.filter((t) => validation.validTests.has(t)).length;
      const payload = {
        suite: name,
        tier,
        mode: 'dry-run',
        ok: validation.ok,
        count: filteredTests.length,
        totalRegistered: tests.length,
        valid: filterLower ? filteredValid : validation.valid,
        totalValid: validation.valid,
        errors: validation.errors,
        appBinExists: fs.existsSync(ctx.appBin),
        appBundleExists: fs.existsSync(ctx.appBundle),
      };
      process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      process.exitCode = validation.ok ? 0 : 1;
      return process.exitCode;
    }

    // --run mode
    const suiteStart = Date.now();
    const results = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const toRun = tests.filter(matchesFilter);
    const sharedCtx = { ...ctx, state: {} };
    let beforeAllError = null;

    if (toRun.length > 0) {
      try {
        for (const hook of beforeHooks) {
          await hook(sharedCtx);
        }
      } catch (err) {
        beforeAllError = err;
      }
    }

    try {
      for (const t of tests) {
        if (!matchesFilter(t)) {
          skipped++;
          results.push({
            id: t.id,
            feature: t.feature,
            features: t.features,
            title: t.title,
            status: 'skipped',
            durationMs: 0,
          });
          continue;
        }

        const tStart = Date.now();
        if (beforeAllError) {
          failed++;
          results.push({
            id: t.id,
            feature: t.feature,
            features: t.features,
            title: t.title,
            status: 'failed',
            durationMs: 0,
            error: `beforeAll failed: ${beforeAllError.stack || beforeAllError.message || String(beforeAllError)}`,
          });
          continue;
        }

        try {
          const timeoutMs = t.opts?.timeoutMs ?? 20000;
          await runWithTimeout(t.fn, sharedCtx, timeoutMs);
          passed++;
          results.push({
            id: t.id,
            feature: t.feature,
            features: t.features,
            title: t.title,
            status: 'passed',
            durationMs: Date.now() - tStart,
          });
        } catch (err) {
          failed++;
          results.push({
            id: t.id,
            feature: t.feature,
            features: t.features,
            title: t.title,
            status: 'failed',
            durationMs: Date.now() - tStart,
            error: err?.stack || err?.message || String(err),
          });
        }
      }
    } finally {
      if (toRun.length > 0) {
        for (const hook of afterHooks) {
          try {
            await hook(sharedCtx);
          } catch (hookErr) {
            process.stderr.write(`[${name}] afterAll error: ${hookErr?.stack || hookErr}\n`);
          }
        }
      }
    }

    const durationMs = Date.now() - suiteStart;
    const ok = failed === 0;
    const summary = {
      total: results.length,
      passed,
      failed,
      skipped,
      durationMs,
    };

    if (json) {
      process.stdout.write(
        JSON.stringify({ suite: name, tier, mode: 'run', ok, summary, results }, null, 2) + '\n'
      );
    } else {
      process.stdout.write(`=== ${name} (Tier ${tier}) ===\n`);
      for (const r of results) {
        if (r.status === 'skipped') continue;
        const tag = r.status === 'passed' ? 'PASS' : 'FAIL';
        process.stdout.write(`[${tag}] ${r.id} (${r.features.join(',')}) ${r.title} (${r.durationMs}ms)\n`);
        if (r.error) {
          process.stdout.write(`       ${r.error.split('\n').join('\n       ')}\n`);
        }
      }
      process.stdout.write(
        `Summary: ${passed} passed, ${failed} failed, ${skipped} skipped (${durationMs}ms)\n`
      );
    }

    process.exitCode = ok ? 0 : 1;
    return process.exitCode;
  }

  return { beforeAll, afterAll, test, run };
}

export function extractCssSelectors(cssText) {
  const noComments = String(cssText || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  const GROUP_AT_RULE_RE = /^@(media|supports|layer|container|document|scope)\b/i;

  function parseBlock(src) {
    let i = 0;
    let buf = '';
    let quote = null;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        buf += ch;
        if (ch === '\\' && i + 1 < src.length) {
          buf += src[++i];
        } else if (ch === quote) {
          quote = null;
        }
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
        i++;
        continue;
      }
      if (ch === ';') {
        buf = '';
        i++;
        continue;
      }
      if (ch === '{') {
        const header = buf.trim();
        buf = '';
        i++;
        const bodyStart = i;
        let depth = 1;
        let innerQuote = null;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (innerQuote) {
            if (c === '\\' && i + 1 < src.length) {
              i += 2;
              continue;
            }
            if (c === innerQuote) innerQuote = null;
            i++;
            continue;
          }
          if (c === '"' || c === "'") {
            innerQuote = c;
          } else if (c === '{') {
            depth++;
          } else if (c === '}') {
            depth--;
            if (depth === 0) break;
          }
          i++;
        }
        const body = src.slice(bodyStart, i);
        if (i < src.length && src[i] === '}') i++;

        if (header.startsWith('@')) {
          if (GROUP_AT_RULE_RE.test(header)) {
            parseBlock(body);
          }
        } else if (header) {
          selectors.push(header);
        }
        continue;
      }
      buf += ch;
      i++;
    }
  }

  parseBlock(noComments);
  return selectors;
}

export function hasCssClassToken(selectors, className) {
  const bare = className.startsWith('.') ? className.slice(1) : className;
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])`);
  return selectors.some((sel) => re.test(sel));
}
