// Shared notes API backed by Netlify Blobs (one blob per note).
//   GET    /api/notes       -> list all notes
//   PUT    /api/notes       -> upsert many (body: array of notes) — used by Import
//   PUT    /api/notes/:id   -> upsert one
//   DELETE /api/notes/:id   -> delete one
import { getStore } from '@netlify/blobs';

const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Open', 'Completed'];
const LEGACY = { 'In Progress': 'Open', 'In-Progress': 'Open', Done: 'Completed' };
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

function clean(id, n) {
  if (!ID_RE.test(id || '')) throw new Error('invalid id');
  const note = String(n.note ?? '').trim().slice(0, 2000);
  const owner = String(n.owner ?? '').trim().slice(0, 100);
  if (!note || !owner) throw new Error('note and owner are required');
  const status = LEGACY[n.status] || n.status;
  return {
    id,
    note,
    owner,
    priority: PRIORITIES.includes(n.priority) ? n.priority : 'Medium',
    status: STATUSES.includes(status) ? status : 'Open',
    create_date: DATE_RE.test(n.create_date) ? n.create_date : new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };
}

export default async (req, context) => {
  const store = getStore({ name: 'itsd-notes', consistency: 'strong' });
  const id = context.params?.id;

  try {
    if (req.method === 'GET' && !id) {
      const { blobs } = await store.list();
      const notes = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
      return json(notes.filter(Boolean));
    }

    if (req.method === 'PUT' && !id) {
      const body = await req.json();
      if (!Array.isArray(body) || body.length > 2000) return json({ error: 'expected an array (max 2000)' }, 400);
      const notes = body.map((n) => clean(n.id, n));
      await Promise.all(notes.map((n) => store.setJSON(n.id, n)));
      return json({ saved: notes.length });
    }

    if (req.method === 'PUT' && id) {
      const n = clean(id, await req.json());
      await store.setJSON(id, n);
      return json(n);
    }

    if (req.method === 'DELETE' && id) {
      await store.delete(id);
      return json({ deleted: id });
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    return json({ error: err.message }, 400);
  }
};

export const config = { path: ['/api/notes', '/api/notes/:id'] };
