import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export function findChromeBinary() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function safeResolveUnder(rootDir, relPath) {
  const cleanRel = relPath.replace(/^\/+/, '');
  const resolved = path.resolve(rootDir, cleanRel);
  const rootResolved = path.resolve(rootDir);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return resolved;
}

export async function createIsolatedPreviewEnv(repoRoot) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-e2e-preview-'));
  let server = null;

  try {
    const devDir = path.join(tmpDir, 'dev');
    fs.mkdirSync(devDir, { recursive: true });

    for (const file of ['preview.sh', 'mock-bridge.js', 'mock-actions.js']) {
      const src = path.join(repoRoot, 'dev', file);
      const dst = path.join(devDir, file);
      fs.copyFileSync(src, dst);
      if (file === 'preview.sh') fs.chmodSync(dst, 0o755);
    }

    const resourcesLink = path.join(tmpDir, 'Resources');
    fs.symlinkSync(path.join(repoRoot, 'Resources'), resourcesLink, 'dir');

    const { stdout: previewScriptStdout } = await execFileAsync('bash', ['preview.sh'], {
      cwd: devDir,
      encoding: 'utf8',
    });

    const previewHtml = path.join(devDir, 'preview.html');
    const actionsPreviewHtml = path.join(devDir, 'actions-preview.html');
    if (!fs.existsSync(previewHtml) || !fs.existsSync(actionsPreviewHtml)) {
      throw new Error('dev/preview.sh did not generate both preview.html and actions-preview.html');
    }

    const repoResourcesRoot = path.join(repoRoot, 'Resources');

    server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = decodeURIComponent(u.pathname);

        if (pathname === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }

        let filePath = null;
        if (pathname.startsWith('/dev/')) {
          filePath = safeResolveUnder(devDir, pathname.slice('/dev/'.length));
        } else if (pathname.startsWith('/Resources/')) {
          filePath = safeResolveUnder(repoResourcesRoot, pathname.slice('/Resources/'.length));
        }

        if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err.message);
      }
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address();
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    return {
      tmpDir,
      baseUrl,
      previewUrl: `${baseUrl}/dev/preview.html`,
      actionsPreviewUrl: `${baseUrl}/dev/actions-preview.html`,
      lensUrl: `${baseUrl}/Resources/lens.html`,
      previewScriptStdout: previewScriptStdout.trim(),
      async close() {
        if (server) {
          await new Promise((resolve) => {
            try {
              server.closeAllConnections?.();
            } catch {
              // ignore
            }
            server.close(() => resolve());
          });
          server = null;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
  } catch (err) {
    if (server) {
      try {
        server.closeAllConnections?.();
        server.close();
      } catch {
        // ignore
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw err;
  }
}

const KEY_DEFS = {
  Escape: { code: 'Escape', keyCode: 27 },
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', key: ' ', keyCode: 32, text: ' ' },
  ' ': { code: 'Space', key: ' ', keyCode: 32, text: ' ' },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

function resolveKeyDescriptor(key, opts = {}) {
  const def = KEY_DEFS[key] || {};
  let code = opts.code || def.code;
  let keyCode = opts.keyCode ?? def.keyCode;
  const resolvedKey = def.key || key;

  if (!code && key.length === 1) {
    if (/[a-zA-Z]/.test(key)) {
      const upper = key.toUpperCase();
      code = `Key${upper}`;
      keyCode = keyCode ?? upper.charCodeAt(0);
    } else if (/[0-9]/.test(key)) {
      code = `Digit${key}`;
      keyCode = keyCode ?? key.charCodeAt(0);
    } else {
      keyCode = keyCode ?? key.charCodeAt(0);
    }
  }

  let modMask = 0;
  for (const m of opts.modifiers || []) {
    if (m === 'Alt') modMask |= 1;
    else if (m === 'Ctrl' || m === 'Control') modMask |= 2;
    else if (m === 'Meta' || m === 'Command') modMask |= 4;
    else if (m === 'Shift') modMask |= 8;
  }

  const text = (modMask & (1 | 2 | 4)) === 0 ? (def.text ?? (key.length === 1 ? key : undefined)) : undefined;
  return {
    key: resolvedKey,
    code: code || resolvedKey,
    windowsVirtualKeyCode: keyCode || 0,
    nativeVirtualKeyCode: keyCode || 0,
    modifiers: modMask,
    text,
  };
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      const onOpen = () => {
        ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = (ev) => {
        ws.removeEventListener('open', onOpen);
        reject(new Error(`CDP WebSocket connection failed: ${ev?.message || 'error'}`));
      };

      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.id !== undefined) {
          const entry = this.pending.get(msg.id);
          if (entry) {
            this.pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(`CDP ${entry.method} error: ${msg.error.message} (${msg.error.code})`));
            } else {
              entry.resolve(msg.result || {});
            }
          }
        } else if (msg.method) {
          const handlers = this.listeners.get(msg.method);
          if (handlers) {
            for (const h of handlers) {
              try {
                h(msg.params || {});
              } catch {
                // ignore listener failure
              }
            }
          }
        }
      });

      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, entry] of this.pending) {
          entry.reject(new Error('CDP WebSocket closed'));
        }
        this.pending.clear();
      });
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  send(method, params = {}) {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP session closed before sending ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

export async function launchBrowser(opts = {}) {
  const chromePath = opts.chromePath || findChromeBinary();
  if (!chromePath) {
    throw new Error('No Chromium/Chrome binary found. Set CHROME_BIN or install Google Chrome.');
  }
  const defaultWidth = opts.width ?? 1024;
  const defaultHeight = opts.height ?? 768;
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-chrome-prof-'));

  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--remote-debugging-port=0',
    `--user-data-dir=${tmpProfile}`,
    'about:blank',
  ];

  const proc = spawn(chromePath, chromeArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let exited = false;
  proc.once('exit', () => {
    exited = true;
  });

  let port;
  try {
    port = await new Promise((resolve, reject) => {
      let stderrBuf = '';
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for Chrome DevTools port. stderr=${stderrBuf}`));
      }, 10000);

      const onData = (chunk) => {
        stderrBuf += chunk.toString('utf8');
        const m = stderrBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
        if (m) {
          clearTimeout(timer);
          proc.stderr.off('data', onData);
          resolve(Number(m[1]));
        }
      };

      proc.stderr.on('data', onData);
      proc.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.once('exit', (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited prematurely (code=${code}, signal=${signal}). stderr=${stderrBuf}`));
      });
    });
  } catch (err) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    fs.rmSync(tmpProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw err;
  }

  const openPages = new Set();

  async function newPage(pageOpts = {}) {
    const width = pageOpts.width ?? defaultWidth;
    const height = pageOpts.height ?? defaultHeight;

    let resp = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    if (!resp.ok) {
      resp = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`);
    }
    if (!resp.ok) {
      throw new Error(`Failed to open CDP page: HTTP ${resp.status}`);
    }
    const target = await resp.json();
    const cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.connect();

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const logErrors = [];
    const requestUrls = new Map();

    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ').trim();
        consoleErrors.push(text || 'console.error');
      }
    });

    cdp.on('Runtime.exceptionThrown', (p) => {
      const ex = p.exceptionDetails || {};
      const desc = ex.exception?.description || ex.text || 'Uncaught exception';
      pageErrors.push(`${desc} (${ex.url || 'inline'}:${ex.lineNumber ?? 0})`);
    });

    cdp.on('Log.entryAdded', (p) => {
      const entry = p.entry || {};
      if (entry.level === 'error') {
        logErrors.push(`${entry.text || 'Log error'} (${entry.url || ''})`);
      }
    });

    cdp.on('Network.requestWillBeSent', (p) => {
      if (p.requestId && p.request?.url) {
        requestUrls.set(p.requestId, p.request.url);
      }
    });

    cdp.on('Network.responseReceived', (p) => {
      if (p.response && p.response.status >= 400) {
        failedRequests.push(`${p.response.status} ${p.response.url}`);
      }
    });

    cdp.on('Network.loadingFailed', (p) => {
      if (!p.canceled) {
        const u = requestUrls.get(p.requestId) || p.requestId || 'unknown';
        failedRequests.push(`FAILED ${u}: ${p.errorText || 'loadingFailed'}`);
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    if (pageOpts.initScript) {
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: pageOpts.initScript });
    }

    async function evaluate(fnOrExpr, ...args) {
      let expression;
      if (typeof fnOrExpr === 'function') {
        expression = `(${fnOrExpr.toString()})(...${JSON.stringify(args)})`;
      } else {
        expression = String(fnOrExpr);
      }
      const res = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) {
        const ex = res.exceptionDetails;
        const msg = ex.exception?.description || ex.text || 'Evaluation failed';
        throw new Error(`Page evaluate error: ${msg}`);
      }
      return res.result ? res.result.value : undefined;
    }

    async function goto(url, { settleMs = 150, timeoutMs = 10000 } = {}) {
      let offLoad;
      const loadPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          offLoad?.();
          reject(new Error(`Timed out waiting for page load: ${url}`));
        }, timeoutMs);
        offLoad = cdp.on('Page.loadEventFired', () => {
          clearTimeout(timer);
          offLoad?.();
          resolve();
        });
      });

      const nav = await cdp.send('Page.navigate', { url });
      if (nav.errorText) {
        offLoad?.();
        throw new Error(`Navigation error (${url}): ${nav.errorText}`);
      }
      await loadPromise;
      if (settleMs > 0) {
        await new Promise((r) => setTimeout(r, settleMs));
      }
    }

    async function setViewport(w, h) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    async function waitFor(fnOrExpr, { timeoutMs = 5000, intervalMs = 50 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let lastErr = null;
      while (Date.now() < deadline) {
        try {
          const val = await evaluate(fnOrExpr);
          if (val) return val;
        } catch (err) {
          lastErr = err;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(
        `Timed out waiting for condition after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`
      );
    }

    async function query(selector) {
      return await evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) {
          return { exists: false, visible: false, text: '', value: '', attrs: {}, rect: null };
        }
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        let ancestorsVisible = true;
        for (let cur = el.parentElement; cur; cur = cur.parentElement) {
          if (cur.hidden) {
            ancestorsVisible = false;
            break;
          }
          const cs = getComputedStyle(cur);
          if (cs.display === 'none' || Number(cs.opacity) <= 0) {
            ancestorsVisible = false;
            break;
          }
        }
        const visible =
          ancestorsVisible &&
          !el.hidden &&
          st.display !== 'none' &&
          st.visibility !== 'hidden' &&
          Number(st.opacity) > 0 &&
          (r.width > 0 || r.height > 0 || el.getClientRects().length > 0);
        const attrs = {};
        for (const a of el.attributes) attrs[a.name] = a.value;
        return {
          exists: true,
          visible,
          text: el.textContent ?? '',
          value: 'value' in el ? String(el.value ?? '') : '',
          attrs,
          rect: { x: r.x, y: r.y, left: r.left, top: r.top, width: r.width, height: r.height },
        };
      }, selector);
    }

    async function queryAll(selector) {
      return await evaluate((sel) => {
        return [...document.querySelectorAll(sel)].map((el) => {
          const st = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          let ancestorsVisible = true;
          for (let cur = el.parentElement; cur; cur = cur.parentElement) {
            if (cur.hidden) {
              ancestorsVisible = false;
              break;
            }
            const cs = getComputedStyle(cur);
            if (cs.display === 'none' || Number(cs.opacity) <= 0) {
              ancestorsVisible = false;
              break;
            }
          }
          const visible =
            ancestorsVisible &&
            !el.hidden &&
            st.display !== 'none' &&
            st.visibility !== 'hidden' &&
            Number(st.opacity) > 0 &&
            (r.width > 0 || r.height > 0 || el.getClientRects().length > 0);
          const attrs = {};
          for (const a of el.attributes) attrs[a.name] = a.value;
          return {
            text: el.textContent ?? '',
            value: 'value' in el ? String(el.value ?? '') : '',
            visible,
            attrs,
            rect: { x: r.x, y: r.y, left: r.left, top: r.top, width: r.width, height: r.height },
          };
        });
      }, selector);
    }

    async function waitForSelector(selector, { visible = true, timeoutMs = 5000, intervalMs = 50 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let lastErr = null;
      while (Date.now() < deadline) {
        try {
          const q = await query(selector);
          if (q.exists && (!visible || q.visible)) return q;
        } catch (err) {
          lastErr = err;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      throw new Error(
        `Timed out waiting for selector "${selector}" (visible=${visible}) after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ''}`
      );
    }

    async function click(selector) {
      const info = await evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        let ancestorsVisible = true;
        for (let cur = el.parentElement; cur; cur = cur.parentElement) {
          if (cur.hidden) {
            ancestorsVisible = false;
            break;
          }
          const cs = getComputedStyle(cur);
          if (cs.display === 'none' || Number(cs.opacity) <= 0) {
            ancestorsVisible = false;
            break;
          }
        }
        const visible =
          ancestorsVisible &&
          !el.hidden &&
          st.display !== 'none' &&
          st.visibility !== 'hidden' &&
          Number(st.opacity) > 0 &&
          (r.width > 0 || r.height > 0 || el.getClientRects().length > 0);
        return {
          found: true,
          tag: el.tagName.toLowerCase(),
          visible,
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          width: r.width,
          height: r.height,
        };
      }, selector);
      if (!info.found) {
        throw new Error(`click: element not found for selector "${selector}"`);
      }
      if (info.tag === 'option') {
        await evaluate((sel) => {
          document.querySelector(sel)?.click();
        }, selector);
        return;
      }
      if (!info.visible || info.width <= 0 || info.height <= 0) {
        throw new Error(
          `click: element "${selector}" (<${info.tag}>) is not visible or has zero bounding rect (visible=${info.visible}, width=${info.width}, height=${info.height})`
        );
      }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: info.x,
        y: info.y,
        button: 'left',
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: info.x,
        y: info.y,
        button: 'left',
        clickCount: 1,
      });
    }

    async function fill(selector, value) {
      const ok = await evaluate(
        (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          el.focus();
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        },
        selector,
        String(value)
      );
      if (!ok) {
        throw new Error(`fill: element not found for selector "${selector}"`);
      }
    }

    async function pressKey(key, keyOpts = {}) {
      const desc = resolveKeyDescriptor(key, keyOpts);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: desc.key,
        code: desc.code,
        modifiers: desc.modifiers,
        windowsVirtualKeyCode: desc.windowsVirtualKeyCode,
        nativeVirtualKeyCode: desc.nativeVirtualKeyCode,
      });
      if (desc.text) {
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          key: desc.key,
          code: desc.code,
          modifiers: desc.modifiers,
          text: desc.text,
          unmodifiedText: desc.text,
          windowsVirtualKeyCode: desc.windowsVirtualKeyCode,
        });
      }
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: desc.key,
        code: desc.code,
        modifiers: desc.modifiers,
        windowsVirtualKeyCode: desc.windowsVirtualKeyCode,
        nativeVirtualKeyCode: desc.nativeVirtualKeyCode,
      });
    }

    function getErrors() {
      return {
        consoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
        logErrors: [...logErrors],
        allErrors: [...pageErrors, ...consoleErrors, ...logErrors, ...failedRequests],
      };
    }

    function clearErrors() {
      consoleErrors.length = 0;
      pageErrors.length = 0;
      failedRequests.length = 0;
      logErrors.length = 0;
    }

    let pageClosed = false;
    async function close() {
      if (pageClosed) return;
      pageClosed = true;
      openPages.delete(page);
      cdp.close();
      try {
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
      } catch {
        // ignore
      }
    }

    const page = {
      goto,
      setViewport,
      evaluate,
      waitFor,
      waitForSelector,
      query,
      queryAll,
      click,
      fill,
      pressKey,
      getErrors,
      clearErrors,
      close,
    };
    openPages.add(page);
    return page;
  }

  async function close() {
    for (const p of [...openPages]) {
      try {
        await p.close();
      } catch {
        // ignore
      }
    }
    if (!exited) {
      const waitExit = new Promise((resolve) => {
        if (exited) return resolve();
        let killTimer = null;
        const onExit = () => {
          if (killTimer) clearTimeout(killTimer);
          resolve();
        };
        proc.once('exit', onExit);
        try {
          proc.kill('SIGTERM');
        } catch {
          proc.off('exit', onExit);
          if (killTimer) clearTimeout(killTimer);
          resolve();
          return;
        }
        killTimer = setTimeout(() => {
          proc.off('exit', onExit);
          if (!exited) {
            try {
              proc.kill('SIGKILL');
            } catch {
              // ignore
            }
          }
          resolve();
        }, 3000);
      });
      await waitExit;
    }
    fs.rmSync(tmpProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  return {
    chromePath,
    port,
    newPage,
    close,
  };
}
