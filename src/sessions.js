const fs = require('node:fs/promises');
const path = require('node:path');

const emptyNotes = () => ({ summary: '', keyPoints: [], decisions: [], actionItems: [], followUp: [] });
const clip = (text, n = 80) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, n).replace(/[\s.,;:]+$/, '');

function fallbackTitle(transcript) {
  const turn = (transcript || []).find((item) => item?.channel === 'them' && String(item.text || '').trim());
  return clip(turn?.text, 80) || 'Untitled session';
}

function normalizeNotes(notes, legacy = {}) {
  const source = notes && typeof notes === 'object' ? notes : legacy;
  return {
    summary: typeof source.summary === 'string' ? source.summary : '',
    keyPoints: Array.isArray(source.keyPoints) ? source.keyPoints.filter((x) => typeof x === 'string') : [],
    decisions: Array.isArray(source.decisions) ? source.decisions.filter((x) => typeof x === 'string') : [],
    actionItems: Array.isArray(source.actionItems) ? source.actionItems.filter((x) => typeof x === 'string') : [],
    followUp: Array.isArray(source.followUp) ? source.followUp.filter((x) => typeof x === 'string') : (source.followUp ? [String(source.followUp)] : [])
  };
}

function normalizeSession(value, id = '') {
  const raw = value && typeof value === 'object' ? value : {};
  const transcript = Array.isArray(raw.transcript) ? raw.transcript.filter((turn) => turn && typeof turn.text === 'string') : [];
  const notes = raw.notes ? normalizeNotes(raw.notes) : normalizeNotes(null, raw);
  return {
    id: String(raw.id || id || ''),
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    endedAt: typeof raw.endedAt === 'string' ? raw.endedAt : '',
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    turnCount: Number.isFinite(raw.turnCount) ? raw.turnCount : transcript.length,
    title: clip(raw.title, 100) || fallbackTitle(transcript),
    notes,
    transcript,
    insights: Array.isArray(raw.insights) ? raw.insights.filter((x) => typeof x === 'string') : (Array.isArray(raw.insightsShown) ? raw.insightsShown.filter((x) => typeof x === 'string') : [])
  };
}

function sessionFile(dir, id) {
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) return null;
  return path.join(dir, `${id}.json`);
}

async function writeArchive(file, value) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2));
    await fs.rename(temp, file);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function listSessions(dir) {
  try {
    const files = await fs.readdir(dir);
    const sessions = (await Promise.all(files.filter((file) => file.endsWith('.json')).map(async (file) => {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
        return normalizeSession(raw, path.basename(file, '.json'));
      } catch { return null; }
    }))).filter(Boolean).sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt)));
    return { ok: true, sessions };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: true, sessions: [] };
    return { ok: false, error: error.message, sessions: [] };
  }
}

async function getSession(dir, id) {
  const file = sessionFile(dir, id);
  if (!file) return { ok: false, error: 'Invalid session id.' };
  try {
    const session = normalizeSession(JSON.parse(await fs.readFile(file, 'utf8')), id);
    return { ok: true, session, sessionMarkdown: sessionMarkdown(session) };
  } catch (error) {
    return { ok: false, error: error.code === 'ENOENT' ? 'Session not found.' : error.message };
  }
}

function searchableText(session) {
  const notes = session.notes || emptyNotes();
  return [session.title, notes.summary, ...notes.keyPoints, ...notes.decisions, ...notes.actionItems, ...notes.followUp, ...session.transcript.map((turn) => turn.text)].filter(Boolean);
}

function searchSessions(sessions, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.map((session) => {
    const field = searchableText(session).find((text) => text.toLowerCase().includes(needle));
    if (!field) return null;
    const index = field.toLowerCase().indexOf(needle);
    const start = Math.max(0, index - 42);
    const text = field.slice(start, index + needle.length + 78);
    return { ...session, match: { text, start: index - start, length: needle.length } };
  }).filter(Boolean);
}

function sessionMarkdown(session) {
  const notes = session.notes || emptyNotes();
  const list = (title, items) => items.length ? `\n## ${title}\n${items.map((item) => `- ${item}`).join('\n')}\n` : '';
  return `# ${session.title}\n\n${session.startedAt ? `Started: ${session.startedAt}\n` : ''}${session.endedAt ? `Ended: ${session.endedAt}\n` : ''}${session.persona ? `Persona: ${session.persona}\n` : ''}${notes.summary ? `\n## Summary\n${notes.summary}\n` : ''}${list('Key points', notes.keyPoints)}${list('Decisions', notes.decisions)}${list('Action items', notes.actionItems)}${list('Follow-up', notes.followUp)}\n## Transcript\n${session.transcript.map((turn) => `**${turn.channel === 'them' ? 'Them' : 'You'}:** ${turn.text}`).join('\n\n')}\n`;
}

async function deleteSession(dir, id) {
  const file = sessionFile(dir, id);
  if (!file) return { ok: false, error: 'Invalid session id.' };
  try {
    await fs.unlink(file);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.code === 'ENOENT' ? 'Session not found.' : error.message };
  }
}

async function exportSession(file, session) {
  try {
    await fs.writeFile(file, sessionMarkdown(session), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { normalizeSession, fallbackTitle, writeArchive, listSessions, getSession, deleteSession, exportSession, searchSessions, sessionMarkdown };
