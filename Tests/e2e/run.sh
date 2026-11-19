#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export APP_BUNDLE="${APP_BUNDLE:-$REPO_ROOT/build/TextMonitor.app}"
export APP_BIN="${APP_BIN:-$APP_BUNDLE/Contents/MacOS/TextMonitor}"
TIER="${TIER:-all}"

MODE="run"
JSON_OUT=0
FILTER=""

usage() {
  cat <<'EOF'
Usage: Tests/e2e/run.sh [options]

Options:
  --tier <1|2|3|4|all>   Select tier to run (default: $TIER or "all")
  --list                 List discovered tests without executing
  --dry-run              Validate suite structure and environment without running
  --filter <substring>   Filter tests by ID, feature tag, or title
  --json                 Emit aggregated JSON output
  -h, --help             Show this help message

Environment variables:
  REPO_ROOT              Repository root path
  APP_BUNDLE             Path to TextMonitor.app bundle
  APP_BIN                Path to TextMonitor Mach-O executable
  TIER                   Default tier selection (overridden by --tier)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      if [[ $# -lt 2 ]]; then
        echo "Error: --tier requires an argument" >&2
        exit 2
      fi
      TIER="$2"
      shift 2
      ;;
    --tier=*)
      TIER="${1#--tier=}"
      shift
      ;;
    --list)
      MODE="list"
      shift
      ;;
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --json)
      JSON_OUT=1
      shift
      ;;
    --filter)
      if [[ $# -lt 2 ]]; then
        echo "Error: --filter requires an argument" >&2
        exit 2
      fi
      FILTER="$2"
      shift 2
      ;;
    --filter=*)
      FILTER="${1#--filter=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$TIER" in
  1|2|3|4|all) ;;
  *)
    echo "Error: invalid --tier '$TIER' (expected 1, 2, 3, 4, or all)" >&2
    exit 2
    ;;
esac

SUITES_DIR="$SCRIPT_DIR/suites"
SUITES=()
if [[ -d "$SUITES_DIR" ]]; then
  if [[ "$TIER" == "all" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && SUITES+=("$line")
    done < <(LC_ALL=C find "$SUITES_DIR" -maxdepth 1 -type f -name 't[1-4]_*.mjs' | LC_ALL=C sort)
  else
    while IFS= read -r line; do
      [[ -n "$line" ]] && SUITES+=("$line")
    done < <(LC_ALL=C find "$SUITES_DIR" -maxdepth 1 -type f -name "t${TIER}_*.mjs" | LC_ALL=C sort)
  fi
fi

if [[ ${#SUITES[@]} -eq 0 ]]; then
  echo "Error: no suite modules matched tier '$TIER' under $SUITES_DIR" >&2
  exit 2
fi

MODE_FLAG="--run"
if [[ "$MODE" == "list" ]]; then
  MODE_FLAG="--list"
elif [[ "$MODE" == "dry-run" ]]; then
  MODE_FLAG="--dry-run"
fi

TMP_OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tm-e2e-runner.XXXXXX")"
cleanup() {
  rm -rf "$TMP_OUT_DIR"
}
trap cleanup EXIT

IDX=0
for suite in "${SUITES[@]}"; do
  OUT_FILE="$TMP_OUT_DIR/suite_${IDX}.json"
  ERR_FILE="$TMP_OUT_DIR/suite_${IDX}.err"
  SUITE_CMD=(node "$suite" "$MODE_FLAG" --json)
  if [[ -n "$FILTER" ]]; then
    SUITE_CMD+=(--filter "$FILTER")
  fi
  set +e
  "${SUITE_CMD[@]}" >"$OUT_FILE" 2>"$ERR_FILE"
  RC=$?
  set -e
  printf '%s\t%s\t%s\t%s\n' "$suite" "$RC" "$OUT_FILE" "$ERR_FILE" >> "$TMP_OUT_DIR/manifest.tsv"
  IDX=$((IDX + 1))
done

node -e '
const fs = require("node:fs");
const mode = process.argv[1];
const tier = process.argv[2];
const jsonOut = process.argv[3] === "1";
const repoRoot = process.argv[4];
const appBundle = process.argv[5];
const appBin = process.argv[6];
const manifestPath = process.argv[7];

const lines = fs.readFileSync(manifestPath, "utf8").trim().split("\n").filter(Boolean);
const suites = [];
const tiers = {};
const totals = { suites: 0, tests: 0, passed: 0, failed: 0, skipped: 0 };
let allOk = true;

for (const line of lines) {
  const [suitePath, rcStr, outPath, errPath] = line.split("\t");
  const rc = Number(rcStr);
  const rawOut = fs.readFileSync(outPath, "utf8");
  const rawErr = fs.readFileSync(errPath, "utf8");
  let parsed = null;
  let parseError = null;
  try {
    parsed = JSON.parse(rawOut);
  } catch (e) {
    parseError = e.message;
  }

  totals.suites += 1;
  if (!parsed) {
    allOk = false;
    suites.push({
      file: suitePath,
      exitCode: rc,
      ok: false,
      parseError,
      stderr: rawErr,
    });
    continue;
  }

  const sTier = String(parsed.tier ?? "unknown");
  if (!tiers[sTier]) {
    tiers[sTier] = { suites: 0, tests: 0, passed: 0, failed: 0, skipped: 0, ok: true };
  }
  tiers[sTier].suites += 1;

  if (mode === "list") {
    const count = Number(parsed.count || 0);
    totals.tests += count;
    tiers[sTier].tests += count;
    if (rc !== 0) {
      allOk = false;
      tiers[sTier].ok = false;
    }
  } else if (mode === "dry-run") {
    const count = Number(parsed.count || 0);
    const valid = Number(parsed.valid || 0);
    const suiteOk = rc === 0 && parsed.ok === true;
    totals.tests += count;
    totals.passed += suiteOk ? count : 0;
    totals.failed += suiteOk ? 0 : Math.max(1, count - valid);
    tiers[sTier].tests += count;
    tiers[sTier].passed += suiteOk ? count : 0;
    tiers[sTier].failed += suiteOk ? 0 : Math.max(1, count - valid);
    if (!suiteOk) {
      allOk = false;
      tiers[sTier].ok = false;
    }
  } else {
    const sum = parsed.summary || {};
    const total = Number(sum.total || 0);
    const passed = Number(sum.passed || 0);
    const failed = Number(sum.failed || 0);
    const skipped = Number(sum.skipped || 0);
    const suiteOk = rc === 0 && parsed.ok === true && failed === 0;
    totals.tests += total;
    totals.passed += passed;
    totals.failed += failed;
    totals.skipped += skipped;
    tiers[sTier].tests += total;
    tiers[sTier].passed += passed;
    tiers[sTier].failed += failed;
    tiers[sTier].skipped += skipped;
    if (!suiteOk) {
      allOk = false;
      tiers[sTier].ok = false;
    }
  }

  suites.push({
    file: suitePath,
    exitCode: rc,
    ...parsed,
    ...(rawErr ? { stderr: rawErr } : {}),
  });
}

const report = {
  mode,
  tier,
  repoRoot,
  appBundle,
  appBin,
  ok: allOk,
  totals,
  tiers,
  suites,
};

if (jsonOut) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  process.stdout.write(`TextMonitor E2E Runner [mode=${mode} tier=${tier}]\n`);
  for (const s of suites) {
    if (s.parseError) {
      process.stdout.write(`[ERROR] ${s.file}: invalid JSON output (${s.parseError})\n`);
      if (s.stderr) process.stdout.write(`  stderr: ${s.stderr}\n`);
      continue;
    }
    if (mode === "list") {
      process.stdout.write(`- Tier ${s.tier} | ${s.suite}: ${s.count} tests\n`);
      for (const t of s.tests || []) {
        process.stdout.write(`    ${t.id} [${(t.features || [t.feature]).join(",")}] ${t.title}\n`);
      }
    } else if (mode === "dry-run") {
      const status = s.ok ? "OK" : "FAIL";
      process.stdout.write(`- [${status}] Tier ${s.tier} | ${s.suite}: ${s.count} tests (${s.valid} valid, appBin=${s.appBinExists}, appBundle=${s.appBundleExists})\n`);
      for (const err of s.errors || []) {
        process.stdout.write(`    ERROR: ${err}\n`);
      }
    } else {
      const sum = s.summary || {};
      const status = s.ok ? "PASS" : "FAIL";
      process.stdout.write(`- [${status}] Tier ${s.tier} | ${s.suite}: ${sum.passed}/${sum.total} passed, ${sum.failed} failed, ${sum.skipped} skipped (${sum.durationMs}ms)\n`);
      for (const r of s.results || []) {
        if (r.status === "failed") {
          process.stdout.write(`    [FAIL] ${r.id} (${r.feature}) ${r.title}\n`);
          if (r.error) {
            process.stdout.write(`           ${r.error.split("\n").join("\n           ")}\n`);
          }
        }
      }
    }
  }
  process.stdout.write("--- Tier Summary ---\n");
  for (const tKey of Object.keys(tiers).sort()) {
    const td = tiers[tKey];
    if (mode === "list") {
      process.stdout.write(`  Tier ${tKey}: ${td.tests} tests across ${td.suites} suite(s)\n`);
    } else {
      process.stdout.write(`  Tier ${tKey}: ${td.passed} passed, ${td.failed} failed, ${td.skipped} skipped (${td.tests} total)\n`);
    }
  }
  process.stdout.write(`Total: ${totals.suites} suite(s), ${totals.tests} tests, ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped — ${allOk ? "OK" : "FAILED"}\n`);
}

process.exit(allOk ? 0 : 1);
' "$MODE" "$TIER" "$JSON_OUT" "$REPO_ROOT" "$APP_BUNDLE" "$APP_BIN" "$TMP_OUT_DIR/manifest.tsv"
