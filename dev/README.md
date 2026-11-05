# dev/

Not packaged into the app. `mock-bridge.js` lets you open the UI in a browser without building:

1. Open `dev/preview.html` in a browser (it loads `../Resources/*` plus `mock-bridge.js`).
2. Use `MOCK.lang('he')`, `MOCK.push('text')`, `MOCK.ai(...)` in the console. Messages the page sends are logged
   and kept in `window.__sent`.
