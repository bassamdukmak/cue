const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('Hide and the global shortcut share the complete-overlay path', () => {
  const start = renderer.indexOf('function toggleHide');
  const body = renderer.slice(start, renderer.indexOf("$('#hide-btn').addEventListener", start));
  assert.match(body, /body\.classList\.add\('overlay-hidden'\)/);
  assert.match(body, /#insights-panel/);
  assert.match(body, /#transcript-sidebar/);
  assert.match(renderer, /cue\.on\('hide:toggle', toggleHide\)/);
  assert.match(styles, /body\.overlay-hidden #app > :not\(#toolbar\)/);
  assert.match(styles, /#panel-wrap\.collapsed \{ display: none; \}/);
});

test('Overflow controls are interactive in both Electron hit-test paths', () => {
  for (const id of ['more-control', 'more-menu', 'settings-menu-btn']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(styles, new RegExp(`#${id}`));
    assert.match(renderer, new RegExp(`#${id}`));
  }
});

test('Past sessions is reachable and interactive in both Electron hit-test paths', () => {
  for (const id of ['past-sessions-btn', 'sessions-scrim', 'session-library']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(styles, new RegExp(`#${id}`));
    assert.match(renderer, new RegExp(`#${id}`));
  }
  assert.match(styles, /#session-library[^\n]*-webkit-app-region: no-drag/);
});
