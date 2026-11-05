#!/bin/bash
# Cut a release: scripts/release.sh <version> [--dry-run]
#   1. checks that <version> is semver (1.2.3, 1.2.3-beta.1) and that the working tree is clean
#   2. writes VERSION
#   3. in CHANGELOG.md renames "## [Unreleased]" or "## [<version>] - Unreleased" to "## [<version>] - <today>"
#      and adds an empty "## [Unreleased]" section above it
#   4. commits "Release v<version>" and creates the annotated tag v<version>
# Nothing is pushed. With --dry-run it only prints what it would do (and what would stop it).
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "usage: scripts/release.sh <version> [--dry-run]" >&2; exit 2; }
VERSION="" DRY=0
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $a" >&2; usage ;;
    *) [ -z "$VERSION" ] || usage; VERSION="${a#v}" ;;
  esac
done
[ -n "$VERSION" ] || usage

SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
[[ "$VERSION" =~ $SEMVER ]] || { echo "not a semantic version: $VERSION" >&2; exit 1; }

TAG="v$VERSION"
TODAY=$(date +%Y-%m-%d)
FAILED=0
fail() { if [ "$DRY" = 1 ]; then echo "would stop: $*" >&2; FAILED=1; else echo "$*" >&2; exit 1; fi; }

[ -z "$(git status --porcelain)" ] || fail "working tree is not clean (commit first)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then fail "tag $TAG already exists"; fi
[ -f CHANGELOG.md ] || fail "CHANGELOG.md not found"

# Which heading becomes the release heading.
ESC_V=$(printf '%s' "$VERSION" | sed 's/[.+]/\\&/g')
FROM="" PATTERN=""
if grep -qE "^## \[$ESC_V\] - Unreleased[[:space:]]*$" CHANGELOG.md 2>/dev/null; then
  FROM="## [$VERSION] - Unreleased"; PATTERN="^## \\[$ESC_V\\] - Unreleased[[:space:]]*$"
elif grep -qE '^## \[Unreleased\][[:space:]]*$' CHANGELOG.md 2>/dev/null; then
  FROM="## [Unreleased]"; PATTERN='^## \[Unreleased\][[:space:]]*$'
else
  fail "CHANGELOG.md has neither \"## [Unreleased]\" nor \"## [$VERSION] - Unreleased\""
fi
TO="## [$VERSION] - $TODAY"

if [ "$DRY" = 1 ]; then
  echo "release $TAG (dry run, nothing changed)"
  echo "  VERSION: $(tr -d '[:space:]' < VERSION) -> $VERSION"
  if [ -n "$FROM" ]; then echo "  CHANGELOG.md: \"$FROM\" -> \"$TO\", with a new empty \"## [Unreleased]\" above it"; fi
  echo "  git commit -m \"Release $TAG\"   (VERSION, CHANGELOG.md)"
  echo "  git tag -a $TAG -m \"Release $TAG\""
  echo "  not pushed; afterwards: git push && git push origin $TAG"
  if [ "$FAILED" = 1 ]; then echo "dry run found problems (see above)" >&2; exit 1; fi
  exit 0
fi

printf '%s\n' "$VERSION" > VERSION
# Rename only the first matching heading and put a fresh Unreleased section above it.
# (Passed through the environment: awk -v would interpret the backslashes in the pattern.)
PAT="$PATTERN" NEWHEAD="$TO" awk '
  !done && $0 ~ ENVIRON["PAT"] { print "## [Unreleased]"; print ""; print ENVIRON["NEWHEAD"]; done = 1; next }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md

git add VERSION CHANGELOG.md
git commit -q -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"
echo "released $TAG ($(git rev-parse --short HEAD)); not pushed. Push with: git push && git push origin $TAG"
