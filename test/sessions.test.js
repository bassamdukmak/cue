const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeSession, listSessions, getSession, deleteSession, exportSession, searchSessions } = require('../src/sessions');

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'cue-sessions-')); }

test('normalizes a legacy archive with missing library fields', () => {
  const session = normalizeSession({ startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T10:10:00.000Z', transcript: [{ channel: 'them', text: 'Legacy planning call' }], insightsShown: ['Watch timing'] }, 'legacy');
  assert.equal(session.id, 'legacy');
  assert.equal(session.turnCount, 1);
  assert.equal(session.title, 'Legacy planning call');
  assert.deepEqual(session.insights, ['Watch timing']);
  assert.deepEqual(session.notes.actionItems, []);
});

test('search matches title, notes, and transcript with excerpts', async () => {
  const dir = await tempDir();
  const records = [
    { id: 'title', endedAt: '2026-08-25T11:00:00.000Z', title: 'Budget review', transcript: [] },
    { id: 'notes', endedAt: '2026-08-25T12:00:00.000Z', title: 'Planning', notes: { summary: 'Approve the hiring plan.' }, transcript: [] },
    { id: 'transcript', endedAt: '2026-08-25T13:00:00.000Z', title: 'Call', transcript: [{ channel: 'them', text: 'The rollout is on Thursday.' }] }
  ];
  await Promise.all(records.map((record) => fs.writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(record))));
  const listed = await listSessions(dir);
  assert.equal(searchSessions(listed.sessions, 'budget')[0].id, 'title');
  assert.equal(searchSessions(listed.sessions, 'hiring')[0].id, 'notes');
  const hit = searchSessions(listed.sessions, 'thursday')[0];
  assert.equal(hit.id, 'transcript');
  assert.equal(hit.match.text.toLowerCase().includes('thursday'), true);
});

test('delete removes an archive and export writes markdown', async () => {
  const dir = await tempDir();
  const record = { id: 'one', title: 'Client kickoff', startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T10:05:00.000Z', persona: 'normal', notes: { summary: 'Agree next steps.', actionItems: ['Send recap'] }, transcript: [{ channel: 'you', text: 'I will send it.' }] };
  await fs.writeFile(path.join(dir, 'one.json'), JSON.stringify(record));
  const found = await getSession(dir, 'one');
  const target = path.join(dir, 'kickoff.md');
  assert.equal((await exportSession(target, found.session)).ok, true);
  assert.match(await fs.readFile(target, 'utf8'), /# Client kickoff[\s\S]*## Action items[\s\S]*Send recap/);
  assert.equal((await deleteSession(dir, 'one')).ok, true);
  await assert.rejects(fs.access(path.join(dir, 'one.json')));
});
