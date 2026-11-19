import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function execCapture(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      const signal = err && err.signal ? err.signal : null;
      resolve({
        ok: code === 0 && !signal,
        code,
        signal,
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs: Date.now() - start,
      });
    });
  });
}

export function assertExecutable(bin) {
  if (!bin || !fs.existsSync(bin)) {
    throw new Error(`Executable not found: ${bin}`);
  }
  const st = fs.statSync(bin);
  if (!st.isFile()) {
    throw new Error(`Executable path is not a regular file: ${bin}`);
  }
  try {
    fs.accessSync(bin, fs.constants.X_OK);
  } catch {
    throw new Error(`File is not executable: ${bin}`);
  }
}

export async function runCli(bin, args = [], opts = {}) {
  assertExecutable(bin);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const start = Date.now();

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin.on('error', () => {
      // Ignore EPIPE / premature close when child exits before reading stdin
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let timedOut = false;
    let settled = false;

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 500);
    }, timeoutMs);

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
        durationMs: Date.now() - start,
      });
    });

    if (!child.stdin.destroyed && !child.stdin.writableEnded) {
      try {
        if (opts.stdin !== undefined && opts.stdin !== null) {
          child.stdin.write(opts.stdin);
        }
        child.stdin.end();
      } catch {
        // Ignore synchronous write errors on already-closed stdin; close handler resolves exit status
      }
    }
  });
}

export async function createMcpClient(bin, opts = {}) {
  assertExecutable(bin);
  const args = opts.args ?? ['--mcp'];
  const defaultTimeout = opts.timeoutMs ?? 5000;

  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let stdoutBuf = '';
  let stderrBuf = '';
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const nonJsonStdoutLines = [];
  const pending = new Map();
  let exited = false;
  let stdinErrored = false;
  let exitInfo = null;
  let exitWaiters = [];

  child.stdin.on('error', () => {
    stdinErrored = true;
  });

  function rejectAllPending(reason) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    pending.clear();
  }

  function dispatchStdoutLine(rawLine) {
    const trimmed = rawLine.replace(/\r$/, '');
    if (!trimmed.trim()) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      nonJsonStdoutLines.push(trimmed);
      return;
    }
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id !== null) {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        entry.resolve(msg);
        return;
      }
    }
    // Unsolicited JSON-RPC error response with explicit id: null (must NOT match notifications without id)
    if (msg && Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id === null && pending.has(null)) {
      const entry = pending.get(null);
      pending.delete(null);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    }
  }

  function drainStdoutLines() {
    let nlIdx;
    while ((nlIdx = stdoutBuf.indexOf('\n')) !== -1) {
      const rawLine = stdoutBuf.slice(0, nlIdx);
      stdoutBuf = stdoutBuf.slice(nlIdx + 1);
      dispatchStdoutLine(rawLine);
    }
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuf += stdoutDecoder.write(chunk);
    drainStdoutLines();
  });

  child.stderr.on('data', (chunk) => {
    stderrBuf += stderrDecoder.write(chunk);
  });

  child.on('error', (err) => {
    rejectAllPending(`MCP process error: ${err.message}`);
  });

  child.on('close', (code, signal) => {
    exited = true;
    stdoutBuf += stdoutDecoder.end();
    stderrBuf += stderrDecoder.end();
    drainStdoutLines();
    if (stdoutBuf.trim()) {
      dispatchStdoutLine(stdoutBuf);
      stdoutBuf = '';
    }
    exitInfo = {
      code,
      signal,
      stderr: stderrBuf,
      nonJsonStdoutLines: [...nonJsonStdoutLines],
    };
    rejectAllPending(`MCP server exited unexpectedly (code=${code}, signal=${signal})`);
    for (const w of exitWaiters) w(exitInfo);
    exitWaiters = [];
  });

  function canWriteStdin() {
    return !exited && !stdinErrored && !child.stdin.destroyed && !child.stdin.writableEnded && child.stdin.writable;
  }

  function safeWriteStdin(text) {
    if (!canWriteStdin()) return false;
    try {
      child.stdin.write(text);
      return true;
    } catch {
      stdinErrored = true;
      return false;
    }
  }

  function sendRaw(text) {
    if (!canWriteStdin()) throw new Error('Cannot write to exited MCP server');
    if (!safeWriteStdin(text)) {
      throw new Error('Failed writing to MCP server stdin');
    }
  }

  function request(method, params = {}, reqOpts = {}) {
    if (!canWriteStdin()) return Promise.reject(new Error('MCP server already exited'));
    const id = reqOpts.id !== undefined ? reqOpts.id : nextId++;
    const timeoutMs = reqOpts.timeoutMs ?? defaultTimeout;
    const payload = { jsonrpc: '2.0', id, method };
    if (params !== undefined) payload.params = params;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request "${method}" (id=${JSON.stringify(id)}) timed out after ${timeoutMs}ms. stderr=${stderrBuf}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      safeWriteStdin(JSON.stringify(payload) + '\n');
    });
  }

  function notify(method, params = {}) {
    if (!canWriteStdin()) throw new Error('Cannot notify exited MCP server');
    const payload = { jsonrpc: '2.0', method };
    if (params !== undefined) payload.params = params;
    safeWriteStdin(JSON.stringify(payload) + '\n');
  }

  function sendRawExpectResponse(rawLine, { id = null, timeoutMs = defaultTimeout } = {}) {
    if (!canWriteStdin()) return Promise.reject(new Error('MCP server already exited'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP raw request timed out after ${timeoutMs}ms. stderr=${stderrBuf}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      safeWriteStdin(rawLine.endsWith('\n') ? rawLine : rawLine + '\n');
    });
  }

  async function initialize({ clientInfo = { name: 'e2e', version: '1.0' }, protocolVersion = '2024-11-05' } = {}) {
    return await request('initialize', { protocolVersion, capabilities: {}, clientInfo });
  }

  async function listTools() {
    return await request('tools/list', {});
  }

  async function callTool(name, args = {}) {
    return await request('tools/call', { name, arguments: args });
  }

  function getStderr() {
    return stderrBuf;
  }

  function getNonJsonStdoutLines() {
    return [...nonJsonStdoutLines];
  }

  async function close({ timeoutMs = 2000 } = {}) {
    if (exited) return exitInfo;
    if (!child.stdin.destroyed && !child.stdin.writableEnded) {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
    }

    return await new Promise((resolve) => {
      let killTimer = null;
      const timer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 500);
      }, timeoutMs);

      exitWaiters.push((info) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve(info);
      });
    });
  }

  return {
    request,
    notify,
    initialize,
    listTools,
    callTool,
    sendRaw,
    sendRawExpectResponse,
    getStderr,
    getNonJsonStdoutLines,
    close,
  };
}

export async function lintPlistOrStrings(filePath) {
  return await execCapture('/usr/bin/plutil', ['-lint', filePath]);
}

export async function readPlistJson(plistPath) {
  const { stdout } = await execFileAsync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function readStringsJson(stringsPath) {
  const { stdout } = await execFileAsync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', stringsPath], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function inspectMachOLinkage(binPath) {
  if (!binPath || !fs.existsSync(binPath)) {
    return { ok: false, reason: 'missing', frameworks: [] };
  }
  const st = fs.statSync(binPath);
  if (!st.isFile()) {
    return { ok: false, reason: 'invalid_macho', frameworks: [] };
  }
  const res = await execCapture('/usr/bin/otool', ['-L', binPath]);
  const combined = `${res.stdout}\n${res.stderr}`;
  if (!res.ok || /is not an object file|can't map file/i.test(combined)) {
    return { ok: false, reason: 'invalid_macho', frameworks: [], stderr: res.stderr };
  }
  const lines = res.stdout.split('\n').slice(1);
  const frameworks = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(.+?)\s+\(compatibility version/);
    frameworks.push(match ? match[1] : trimmed);
  }
  if (frameworks.length === 0) {
    return { ok: false, reason: 'invalid_macho', frameworks: [] };
  }
  return { ok: true, frameworks };
}

export async function otoolLinkedFrameworks(binPath) {
  const res = await inspectMachOLinkage(binPath);
  if (!res.ok) {
    throw new Error(`Failed to inspect Mach-O linkage (${res.reason}) for ${binPath}: ${res.stderr || ''}`);
  }
  return res.frameworks;
}

export async function inspectMachOBuildVersion(binPath) {
  if (!binPath || !fs.existsSync(binPath)) {
    return { ok: false, reason: 'missing', minos: null };
  }
  const res = await execCapture('/usr/bin/otool', ['-l', binPath]);
  if (!res.ok || /is not an object file/i.test(res.stdout + res.stderr)) {
    return { ok: false, reason: 'invalid_macho', minos: null };
  }
  const buildBlock = res.stdout.match(/cmd LC_BUILD_VERSION[\s\S]*?(?=Load command|\n$)/);
  if (buildBlock) {
    const minosMatch = buildBlock[0].match(/\bminos\s+([0-9.]+)/);
    if (minosMatch) return { ok: true, minos: minosMatch[1] };
  }
  const minOsxBlock = res.stdout.match(/cmd LC_VERSION_MIN_MACOSX[\s\S]*?(?=Load command|\n$)/);
  if (minOsxBlock) {
    const verMatch = minOsxBlock[0].match(/\bversion\s+([0-9.]+)/);
    if (verMatch) return { ok: true, minos: verMatch[1] };
  }
  return { ok: true, minos: null };
}

export async function inspectMachOArchs(binPath) {
  const res = await execCapture('/usr/bin/lipo', ['-archs', binPath]);
  if (!res.ok) {
    return { ok: false, archs: [], stderr: res.stderr };
  }
  return { ok: true, archs: res.stdout.trim().split(/\s+/).filter(Boolean) };
}

export async function inspectBinaryStrings(binPath) {
  const stringsRes = await execCapture('/usr/bin/strings', ['-a', binPath]);
  const nmRes = await execCapture('/usr/bin/nm', ['-g', binPath]);
  return {
    ok: stringsRes.ok,
    strings: stringsRes.stdout,
    symbols: nmRes.stdout,
  };
}

export async function verifyCodesign(bundlePath) {
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    return { ok: false, code: 1, stdout: '', stderr: `Bundle not found: ${bundlePath}` };
  }
  const res = await execCapture('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundlePath]);
  return {
    ok: res.code === 0,
    code: res.code,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}

export async function probeUnixSocket(sockPath, { timeoutMs = 1000 } = {}) {
  if (!fs.existsSync(sockPath)) {
    return { exists: false, isSocket: false, mode: null, modeOctal: null, connected: false, errorCode: 'ENOENT' };
  }
  const st = fs.lstatSync(sockPath);
  const mode = st.mode & 0o777;
  const modeOctal = '0' + mode.toString(8);
  const isSocket = st.isSocket();
  if (!isSocket) {
    return { exists: true, isSocket: false, mode, modeOctal, connected: false, errorCode: 'ENOTSOCK' };
  }

  return await new Promise((resolve) => {
    let done = false;
    const sock = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ exists: true, isSocket: true, mode, modeOctal, connected: false, errorCode: 'ETIMEDOUT' });
    }, timeoutMs);

    sock.on('connect', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ exists: true, isSocket: true, mode, modeOctal, connected: true, errorCode: null });
    });

    sock.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ exists: true, isSocket: true, mode, modeOctal, connected: false, errorCode: err.code || 'ERROR' });
    });
  });
}

export function createIsolatedHome(prefix = 'tm-e2e-') {
  const home = fs.mkdtempSync(path.join('/tmp', prefix));
  const supportDir = path.join(home, 'Library', 'Application Support', 'Clipboard Monitor');
  fs.mkdirSync(supportDir, { recursive: true });
  const sockPath = path.join(supportDir, 'textmonitor.sock');
  const supportLen = Buffer.byteLength(supportDir, 'utf8');
  const sockLen = Buffer.byteLength(sockPath, 'utf8');
  if (supportLen >= 88 || sockLen >= 104) {
    fs.rmSync(home, { recursive: true, force: true });
    throw new Error(`Isolated path too long for sun_path (<104): supportDir=${supportLen}B, sockPath=${sockLen}B (${sockPath})`);
  }
  return { home, supportDir, sockPath };
}

export async function stageEphemeralBundle(appBundle, destDir) {
  if (!appBundle || !fs.existsSync(appBundle)) {
    throw new Error(`App bundle not found: ${appBundle}`);
  }
  const srcInfo = path.join(appBundle, 'Contents', 'Info.plist');
  if (!fs.existsSync(srcInfo)) {
    throw new Error(`App bundle missing Contents/Info.plist: ${appBundle}`);
  }
  const srcPlist = await readPlistJson(srcInfo);
  const execName = srcPlist.CFBundleExecutable || 'TextMonitor';
  const srcBin = path.join(appBundle, 'Contents', 'MacOS', execName);
  assertExecutable(srcBin);

  const bundlePath = path.join(destDir, 'TextMonitorE2E.app');
  await execFileAsync('/bin/cp', ['-R', appBundle, bundlePath]);

  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
  const rand = Math.random().toString(36).slice(2, 8);
  const bundleId = `dev.danielgabbay.clipboard-monitor.e2e.${process.pid}.${rand}`;
  await execFileAsync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', bundleId, plistPath]);
  await execFileAsync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', bundlePath]);

  const binPath = path.join(bundlePath, 'Contents', 'MacOS', execName);
  assertExecutable(binPath);
  return { bundlePath, binPath, bundleId };
}

async function findRunningPidsByPath(binPath) {
  const res = await execCapture('/bin/ps', ['-axo', 'pid=,command=']);
  if (!res.ok) return [];
  const candidateSet = new Set([binPath]);
  try {
    candidateSet.add(fs.realpathSync(binPath));
  } catch {
    // ignore if path cannot be resolved
  }
  const candidates = [...candidateSet];
  const pids = [];
  for (const line of res.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const cmd = m[2].trim();
    if (Number.isInteger(pid) && pid > 0 && candidates.some((c) => cmd === c || cmd.startsWith(c + ' '))) {
      pids.push(pid);
    }
  }
  return pids;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startIsolatedApp(ctx, opts = {}) {
  if (opts.ephemeralBundle) {
    if (!ctx.appBundle || !fs.existsSync(ctx.appBundle)) {
      throw new Error(`App bundle not found: ${ctx.appBundle}`);
    }
  } else {
    assertExecutable(ctx.appBin);
  }

  let home;
  let supportDir;
  let sockPath;
  if (opts.home) {
    home = opts.home;
    supportDir = opts.supportDir || path.join(home, 'Library', 'Application Support', 'Clipboard Monitor');
    fs.mkdirSync(supportDir, { recursive: true });
    sockPath = path.join(supportDir, 'textmonitor.sock');
  } else {
    ({ home, supportDir, sockPath } = createIsolatedHome(opts.prefix || 'tm-e2e-'));
  }

  try {
    if (opts.seedHistory) {
      fs.writeFileSync(path.join(supportDir, 'history.json'), JSON.stringify(opts.seedHistory), 'utf8');
    }

    if (opts.ephemeralBundle) {
      const staged = await stageEphemeralBundle(ctx.appBundle, home);
      const stderrPath = path.join(home, 'ephemeral-stderr.log');
      const trackedPids = new Set();

      await execFileAsync('/usr/bin/open', [
        '-n',
        '-g',
        '-j',
        '-F',
        '--env',
        `HOME=${home}`,
        '--env',
        `TEXTMONITOR_SUPPORT_DIR=${supportDir}`,
        '--stderr',
        stderrPath,
        '-a',
        staged.bundlePath,
      ]);

      const collectPids = async () => {
        const found = await findRunningPidsByPath(staged.binPath);
        for (const p of found) trackedPids.add(p);
        return found;
      };

      const readErr = () => {
        try {
          return fs.readFileSync(stderrPath, 'utf8');
        } catch {
          return '';
        }
      };

      const stop = async () => {
        await collectPids();
        const allPids = [...trackedPids].filter(isPidAlive);
        for (const pid of allPids) {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // ignore
          }
        }
        const killDeadline = Date.now() + 2000;
        while (Date.now() < killDeadline) {
          if (!allPids.some(isPidAlive)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        let sentSigkill = false;
        for (const pid of allPids) {
          if (isPidAlive(pid)) {
            sentSigkill = true;
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // ignore
            }
          }
        }
        if (sentSigkill) {
          const reapDeadline = Date.now() + 250;
          while (Date.now() < reapDeadline) {
            if (!allPids.some(isPidAlive)) break;
            await new Promise((r) => setTimeout(r, 15));
          }
        }
        if (!opts.keepHomeOnStop) {
          fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
      };

      if (opts.waitForSocket !== false) {
        const deadline = Date.now() + (opts.startupTimeoutMs ?? 7000);
        let ready = false;
        while (Date.now() < deadline) {
          await collectPids();
          const probe = await probeUnixSocket(sockPath, { timeoutMs: 300 });
          if (probe.connected) {
            ready = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 120));
        }
        await collectPids();
        if (!ready) {
          const errText = readErr();
          await stop();
          throw new Error(`Timed out waiting for isolated ephemeral IPC socket at ${sockPath}. stderr=${errText}`);
        }
        if (trackedPids.size === 0) {
          const errText = readErr();
          await stop();
          throw new Error(
            `PID tracking failed for ephemeral bundle ${staged.bundlePath} (binPath=${staged.binPath}): trackedPids is empty after IPC socket became ready. stderr=${errText}`
          );
        }
      } else {
        await collectPids();
      }

      return {
        home,
        supportDir,
        sockPath,
        bundlePath: staged.bundlePath,
        binPath: staged.binPath,
        bundleId: staged.bundleId,
        trackedPids,
        isAlive: () => [...trackedPids].some(isPidAlive),
        stop,
      };
    }

    const child = spawn(ctx.appBin, [], {
      env: { ...process.env, HOME: home, TEXTMONITOR_SUPPORT_DIR: supportDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let exited = false;
    let exitCode = null;
    let exitSignal = null;
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    child.once('exit', (code, sig) => {
      exited = true;
      exitCode = code;
      exitSignal = sig;
    });

    const stop = async () => {
      if (!exited) {
        await new Promise((resolve) => {
          if (exited) return resolve();
          let settled = false;
          let killTimer = null;
          let reapTimer = null;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (killTimer) clearTimeout(killTimer);
            if (reapTimer) clearTimeout(reapTimer);
            child.off('exit', onExit);
            resolve();
          };
          const onExit = () => finish();
          child.once('exit', onExit);
          try {
            child.kill('SIGTERM');
          } catch {
            finish();
            return;
          }
          killTimer = setTimeout(() => {
            if (!exited) {
              try {
                child.kill('SIGKILL');
              } catch {
                // ignore
              }
            }
            const reapDeadline = Date.now() + 250;
            const waitReap = () => {
              if (settled) return;
              const alive = child.pid ? isPidAlive(child.pid) : false;
              if ((exited && !alive) || Date.now() >= reapDeadline) {
                finish();
              } else {
                reapTimer = setTimeout(waitReap, 15);
              }
            };
            waitReap();
          }, 2000);
        });
      }
      if (!opts.keepHomeOnStop) {
        fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    };

    if (opts.waitForSocket !== false) {
      const deadline = Date.now() + (opts.startupTimeoutMs ?? 7000);
      let ready = false;
      while (Date.now() < deadline) {
        if (exited) {
          await stop();
          throw new Error(`Isolated app exited early (code=${exitCode}, signal=${exitSignal}). stderr=${stderr}`);
        }
        const probe = await probeUnixSocket(sockPath, { timeoutMs: 300 });
        if (probe.connected) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 120));
      }

      if (!ready) {
        await stop();
        throw new Error(`Timed out waiting for isolated IPC socket at ${sockPath}. stderr=${stderr}`);
      }
    }

    return {
      home,
      supportDir,
      sockPath,
      child,
      isAlive: () => !exited,
      getExit: () => ({ exited, exitCode, exitSignal, stderr }),
      stop,
    };
  } catch (err) {
    if (!opts.home && !opts.keepHomeOnStop && home) {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    throw err;
  }
}

export async function deliverIsolatedUrl(gui, url) {
  if (!gui || !gui.bundlePath || !fs.existsSync(gui.bundlePath)) {
    throw new Error(`Isolated ephemeral bundle is missing for URL delivery: ${gui?.bundlePath}`);
  }
  await execFileAsync('/usr/bin/open', [
    '-g',
    '-j',
    '-F',
    '--env',
    `HOME=${gui.home}`,
    '--env',
    `TEXTMONITOR_SUPPORT_DIR=${gui.supportDir}`,
    '-a',
    gui.bundlePath,
    url,
  ]);
}
