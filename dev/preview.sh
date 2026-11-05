#!/bin/bash
# Generate dev/preview.html from Resources/index.html: same page, resources loaded from ../Resources and the
# fake native bridge (mock-bridge.js) installed before the page scripts. Open the result in any browser.
set -euo pipefail
cd "$(dirname "$0")"
perl -pe 's#(href|src)="([a-z][^":]*\.(css|js))"#$1="../Resources/$2"#g;
          s#(<script src="../Resources/marked.min.js"></script>)#<script src="mock-bridge.js"></script>\n$1#' \
  ../Resources/index.html > preview.html
echo "dev/preview.html"
