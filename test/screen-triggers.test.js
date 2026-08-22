const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldCheckScreen } = require('../src/screen-triggers');

test('screen triggers recognize visible-material cues in the latest four turns', () => {
  assert.equal(shouldCheckScreen([{ channel: 'them', text: 'As you can see, this chart changes the forecast.' }]), true);
  assert.equal(shouldCheckScreen([{ channel: 'you', text: 'Look at the numbers shown here.' }]), true);
  assert.equal(shouldCheckScreen([{ channel: 'them', text: 'Revenue increased 25% this quarter.' }]), true);
});

test('screen triggers stay conservative and ignore older context', () => {
  assert.equal(shouldCheckScreen([{ channel: 'them', text: 'This slide matters.' }, { channel: 'them', text: 'hello' }, { channel: 'you', text: 'okay' }, { channel: 'them', text: 'next topic' }, { channel: 'you', text: 'thanks' }]), false);
  assert.equal(shouldCheckScreen([{ channel: 'system', text: 'this chart' }, { channel: 'them', text: 'I think that is sensible.' }]), false);
});

test('screen trigger is pure; caller owns the cooldown', () => {
  const turns = [{ channel: 'them', text: 'These numbers show our margin is 12%.' }];
  assert.equal(shouldCheckScreen(turns), true);
  assert.equal(shouldCheckScreen(turns), true);
  assert.deepEqual(turns, [{ channel: 'them', text: 'These numbers show our margin is 12%.' }]);
});
