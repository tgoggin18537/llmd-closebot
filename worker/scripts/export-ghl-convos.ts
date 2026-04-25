/**
 * Export GHL conversations to evals/real-convos.jsonl.
 *
 * Usage:
 *   npm run export-convos -- --start=2026-03-01 --end=2026-04-15
 *
 * Reads GHL_API_KEY and GHL_LOCATION_ID from worker/.dev.vars.
 *
 * Pulls every conversation in the date range, redacts PII (phone, email,
 * last name), and writes one conversation per line as JSONL. Output is
 * gitignored.
 *
 * Two-phase pull:
 *   1. POST /conversations/search to list conversation ids in the window.
 *   2. GET /conversations/{id}/messages?limit=100 for each, filter by
 *      message dateAdded.
 *
 * Pagination: GHL returns `startAfterDate` and `startAfter` to use as the
 * next cursor. Loops until the response is empty or older than --start.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEV_VARS = resolve(REPO_ROOT, '.dev.vars');
const OUT_PATH = resolve(REPO_ROOT, 'evals/real-convos.jsonl');
const GHL_BASE = 'https://services.leadconnectorhq.com';

type Args = { start: string; end: string; out: string; limit?: number; resumeFrom?: number };

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  if (!args.start || !args.end) {
    console.error('Usage: npm run export-convos -- --start=YYYY-MM-DD --end=YYYY-MM-DD [--limit=N] [--out=path] [--resume-from=N]');
    process.exit(1);
  }
  return {
    start: args.start,
    end: args.end,
    out: args.out ?? OUT_PATH,
    limit: args.limit ? Number(args.limit) : undefined,
    resumeFrom: args['resume-from'] ? Number(args['resume-from']) : undefined,
  };
}

/**
 * Fetch with a 15s timeout and retry-with-backoff on 429 / 5xx. Returns the
 * Response on the final attempt regardless. Caller should still check ok.
 */
async function fetchWithRetry(url: string, init: RequestInit & { headers: Record<string, string> }, attempts = 4): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 429 || res.status >= 500) {
        const wait = 1000 * Math.pow(2, i); // 1s, 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      const wait = 1000 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error('fetchWithRetry exhausted attempts');
}

function loadEnv(): { apiKey: string; locationId: string } {
  if (!existsSync(DEV_VARS)) {
    console.error(`Missing ${DEV_VARS}. Copy .dev.vars.example to .dev.vars and fill it in.`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(DEV_VARS, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip inline comment ("KEY=value   # note") unless value is quoted.
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }
    value = value.replace(/^["']|["']$/g, '');
    env[m[1]] = value;
  }
  const isPlaceholder = (v: string | undefined) =>
    !v || v === '...' || v.startsWith('...') || v.includes('REPLACE_ME') || v.includes('placeholder');
  if (isPlaceholder(env.GHL_API_KEY) || isPlaceholder(env.GHL_LOCATION_ID)) {
    console.error('GHL_API_KEY and GHL_LOCATION_ID look like placeholders in .dev.vars. Fill in real values.');
    console.error(`  GHL_API_KEY=${env.GHL_API_KEY?.slice(0, 8) ?? '(missing)'}...`);
    console.error(`  GHL_LOCATION_ID=${env.GHL_LOCATION_ID ?? '(missing)'}`);
    process.exit(1);
  }
  return { apiKey: env.GHL_API_KEY, locationId: env.GHL_LOCATION_ID };
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

type ConversationRef = { id: string; contactId: string; lastMessageDate?: string };

async function listConversations(env: { apiKey: string; locationId: string }, startMs: number, endMs: number): Promise<ConversationRef[]> {
  const all: ConversationRef[] = [];
  let startAfterDate: number | undefined;
  let startAfter: string | undefined;
  let pages = 0;

  while (true) {
    pages++;
    const params = new URLSearchParams({
      locationId: env.locationId,
      limit: '100',
      sort: 'desc',
      sortBy: 'last_message_date',
    });
    if (startAfterDate) params.set('startAfterDate', String(startAfterDate));
    if (startAfter) params.set('startAfter', startAfter);

    const res = await fetchWithRetry(`${GHL_BASE}/conversations/search?${params}`, {
      method: 'GET',
      headers: headers(env.apiKey),
    });
    if (!res.ok) {
      console.error(`Page ${pages} failed: ${res.status} ${await res.text()}`);
      break;
    }
    const data = (await res.json()) as any;
    const conversations: any[] = data.conversations ?? [];
    if (conversations.length === 0) break;

    let pageMin = Infinity;
    for (const c of conversations) {
      const last = c.lastMessageDate ? new Date(c.lastMessageDate).getTime() : 0;
      if (last && last < pageMin) pageMin = last;
      if (last >= startMs && last <= endMs) {
        all.push({ id: c.id, contactId: c.contactId, lastMessageDate: c.lastMessageDate });
      }
    }
    process.stdout.write(`  page ${pages}: +${conversations.length} (kept ${all.length} so far)\n`);

    // Stop when the page's oldest message is older than start.
    if (pageMin < startMs) break;
    // Cursor for next page.
    const last = conversations[conversations.length - 1];
    startAfterDate = last.lastMessageDate ? new Date(last.lastMessageDate).getTime() : startAfterDate;
    startAfter = last.id;
    if (pages > 200) {
      console.error('Hit 200 page safety limit, stopping.');
      break;
    }
  }
  return all;
}

async function fetchMessages(env: { apiKey: string }, conversationId: string): Promise<any[]> {
  try {
    const res = await fetchWithRetry(`${GHL_BASE}/conversations/${conversationId}/messages?limit=100`, {
      headers: headers(env.apiKey),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    return data.messages?.messages ?? data.messages ?? [];
  } catch {
    return [];
  }
}

async function fetchContact(env: { apiKey: string }, contactId: string): Promise<any> {
  try {
    const res = await fetchWithRetry(`${GHL_BASE}/contacts/${contactId}`, { headers: headers(env.apiKey) });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data.contact ?? data;
  } catch {
    return null;
  }
}

function redact(text: string, lastName?: string): string {
  let t = text ?? '';
  // Phone: tolerant of formats like (555) 123-4567, 555.123.4567, +1 555 123 4567, 5551234567
  t = t.replace(/\+?\d[\d\s().\-]{8,}\d/g, '<phone>');
  // Email (literal @)
  t = t.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '<email>');
  // Email (URL-encoded @ as %40)
  t = t.replace(/[A-Za-z0-9._%+\-]+%40[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/gi, '<email>');
  // Last name (case insensitive, word boundaries)
  if (lastName && lastName.length >= 2) {
    const re = new RegExp(`\\b${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    t = t.replace(re, '<lastname>');
  }
  return t;
}

/**
 * GHL message type filter. We only want SMS for voice extraction. The GHL
 * API uses both numeric `type` (1 = SMS) and string `messageType` ('TYPE_SMS'
 * or 'SMS'). Accept all spellings.
 */
function isSmsMessage(m: any): boolean {
  if (m.type === 1 || m.type === '1') return true;
  const mt = String(m.messageType ?? m.type ?? '').toUpperCase();
  return mt === 'SMS' || mt === 'TYPE_SMS';
}

async function main() {
  const args = parseArgs();
  const env = loadEnv();
  const startMs = new Date(`${args.start}T00:00:00Z`).getTime();
  const endMs = new Date(`${args.end}T23:59:59Z`).getTime();

  console.log(`Pulling conversations between ${args.start} and ${args.end} (location ${env.locationId})`);
  console.log('Phase 1: list conversations');
  const refs = await listConversations(env, startMs, endMs);
  console.log(`Phase 1 done: ${refs.length} conversations in window`);

  if (args.limit) refs.splice(args.limit);

  mkdirSync(dirname(args.out), { recursive: true });

  // Resume support: if --resume-from=N, append to existing file starting at index N.
  // Otherwise truncate.
  const startIdx = args.resumeFrom ?? 0;
  if (startIdx === 0) writeFileSync(args.out, '');
  console.log(`Phase 2: fetch messages + contacts (starting at ${startIdx})`);
  let written = 0;
  let errors = 0;
  const tStart = Date.now();
  for (let i = startIdx; i < refs.length; i++) {
    const r = refs[i];
    let messages: any[] = [];
    let contact: any = null;
    try {
      [messages, contact] = await Promise.all([fetchMessages(env, r.id), fetchContact(env, r.contactId)]);
    } catch {
      errors++;
    }
    const lastName = contact?.lastName;
    const firstName = contact?.firstName;
    const tags: string[] = contact?.tags ?? [];

    const msgs = messages
      .filter((m: any) => isSmsMessage(m))
      .filter((m: any) => {
        const t = m.dateAdded ? new Date(m.dateAdded).getTime() : 0;
        return t >= startMs && t <= endMs;
      })
      .map((m: any) => ({
        id: m.id,
        direction: m.direction,
        body: redact(m.body ?? m.message ?? '', lastName),
        dateAdded: m.dateAdded,
        userId: m.userId,
        source: m.source,
      }))
      .filter((m) => m.body.trim().length > 0)
      .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime());

    if (msgs.length > 0) {
      appendFileSync(
        args.out,
        JSON.stringify({
          conversationId: r.id,
          contactId: r.contactId,
          firstName: firstName ?? null,
          tags,
          messages: msgs,
        }) + '\n',
      );
      written++;
    }

    // Heartbeat every 25 iterations (regardless of skip), with rate.
    if ((i + 1) % 25 === 0) {
      const rate = (i + 1 - startIdx) / ((Date.now() - tStart) / 1000);
      const eta = ((refs.length - i - 1) / rate / 60).toFixed(1);
      process.stdout.write(`  ${i + 1}/${refs.length} | wrote ${written} | errors ${errors} | ${rate.toFixed(1)}/s | eta ${eta}m\n`);
    }
  }

  console.log(`\nDone. Wrote ${written} conversations to ${args.out} (${errors} errors). Resume next time with --resume-from=${refs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
