#!/bin/bash
# Generate dev/preview.html from Resources/index.html: same page, resources loaded from ../Resources and the
# fake native bridge (mock-bridge.js) installed before the page scripts. Open the result in any browser.
# Every CSS/JS URL gets a ?v=<timestamp> query so a reload always picks up edited files (no stale cache).
set -euo pipefail
cd "$(dirname "$0")"
V=$(date +%s)
V="$V" perl -pe '
  s#(href|src)="([a-z][^":]*\.(?:css|js))"#$1="../Resources/$2?v=$ENV{V}"#g;
  s#(<script src="\.\./Resources/marked\.min\.js\?v=\d+"></script>)#<script src="mock-bridge.js?v=$ENV{V}"></script>\n$1#;
' ../Resources/index.html > preview.html
# The Text Actions popover, with its own fake bridge (mock-actions.js).
V="$V" perl -pe '
  s#(href|src)="([a-z][^":]*\.(?:css|js))"#$1="../Resources/$2?v=$ENV{V}"#g;
  s#(<script src="\.\./Resources/i18n\.js\?v=\d+"></script>)#<script src="mock-actions.js?v=$ENV{V}"></script>\n$1#;
' ../Resources/actions.html > actions-preview.html
echo "dev/preview.html dev/actions-preview.html"
