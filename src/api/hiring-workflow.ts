import { apiFetch } from '../lib/api';
export async function hiringRequest(path: string, body?: unknown) { const r = await apiFetch('/api/hiring' + path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const d = await r.json(); if (!r.ok)
    throw Error(d.error || 'Hiring unavailable.'); return d; }
