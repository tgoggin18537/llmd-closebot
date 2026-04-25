/**
 * Render a random sample of two-way real conversations as readable markdown
 * threads. The point is to make it easy to read 30 real conversations and
 * open-code the failure modes (per Hamel Husain's "look at the data BEFORE
 * writing the rubric" principle).
 *
 * Output: evals/real-samples.md
 *
 * Usage:
 *   npm run render-samples                  # default: 30 random two-way convos
 *   npm run render-samples -- --n=50
 *   npm run render-samples -- --sender=lauren  # only convos with replies from one sender
 *   npm run render-samples -- --seed=42        # reproducible random pick
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const IN_PATH = resolve(REPO_ROOT, 'evals/real-convos.jsonl');
const OUT_PATH = resolve(REPO_ROOT, 'evals/real-samples.md');

// Pulled from raw/training-data.overview.csv KEY FINDINGS.
const SENDER_NAMES: Record<string, string> = {
  Ptq5d0pW1GYT2uFJraIM: 'Lauren',
  '1N3n2voecT7o7g5rqyH2': 'Janice',
  lZnQHFibOdnLt3KbGw5l: 'Erin',
};

type Args = { n: number; sender?: string; seed?: number };

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.+))?$/);
    if (m) args[m[1]] = m[2] ?? 'true';
  }
  return {
    n: args.n ? Number(args.n) : 30,
    sender: args.sender?.toLowerCase(),
    seed: args.seed ? Number(args.seed) : undefined,
  };
}

/** Mulberry32 deterministic PRNG so --seed produces a reproducible sample. */
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function senderLabel(userId: string | undefined): string {
  if (!userId) return 'team';
  return SENDER_NAMES[userId] ?? `team (${userId.slice(0, 8)})`;
}

type Convo = {
  conversationId: string;
  contactId: string;
  firstName: string | null;
  tags: string[];
  messages: Array<{ id: string; direction?: 'inbound' | 'outbound'; body: string; dateAdded: string; userId?: string; source?: string }>;
};

function loadConvos(): Convo[] {
  if (!existsSync(IN_PATH)) {
    console.error(`Missing ${IN_PATH}. Run npm run export-convos first.`);
    process.exit(1);
  }
  const out: Convo[] = [];
  for (const line of readFileSync(IN_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

function isTwoWay(c: Convo): boolean {
  let hasIn = false;
  let hasOut = false;
  for (const m of c.messages) {
    if (m.direction === 'inbound') hasIn = true;
    if (m.direction === 'outbound') hasOut = true;
  }
  return hasIn && hasOut;
}

function hasSender(c: Convo, senderUserId: string): boolean {
  return c.messages.some((m) => m.direction === 'outbound' && m.userId === senderUserId);
}

function renderConvo(c: Convo, idx: number): string {
  const lines: string[] = [];
  lines.push(`## ${idx}. ${c.firstName ?? 'unknown'}  \\#${c.conversationId.slice(0, 8)}`);
  lines.push('');
  lines.push(`**Tags:** ${c.tags.join(', ') || '(none)'}`);
  lines.push('');
  lines.push('**Failure modes observed (tag with one or more, then add notes):**');
  lines.push('');
  lines.push('- [ ] generic AI tells (Great question, Absolutely, etc.)');
  lines.push('- [ ] wrong tone (too formal, too eager, too clinical, too markety)');
  lines.push('- [ ] missed answering the question');
  lines.push('- [ ] compound question / 2+ questions');
  lines.push('- [ ] re-asked something already answered');
  lines.push('- [ ] over-validation ("totally", "I hear you" etc.)');
  lines.push('- [ ] catalog dump / lists peptides without being asked');
  lines.push('- [ ] used staff first names');
  lines.push('- [ ] re-pitched after pushback / not interested');
  lines.push('- [ ] missed a buying signal (didn\'t invite to call when should have)');
  lines.push('- [ ] over-invited (invited to call multiple turns in a row)');
  lines.push('- [ ] lied / made up a fact');
  lines.push('- [ ] too long / too markety');
  lines.push('- [ ] other (describe):');
  lines.push('');
  lines.push('**Notes:**');
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of c.messages) {
    const who = m.direction === 'inbound' ? `**${c.firstName ?? 'lead'}**` : `**${senderLabel(m.userId)}**`;
    const ts = m.dateAdded ? new Date(m.dateAdded).toISOString().slice(0, 16).replace('T', ' ') : '';
    const body = m.body.replace(/\n+/g, '\n> ').trim();
    lines.push(`${who}  \`${ts}\`${m.source ? ` _(${m.source})_` : ''}`);
    lines.push('');
    lines.push(`> ${body}`);
    lines.push('');
  }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const args = parseArgs();
  const all = loadConvos();
  let pool = all.filter(isTwoWay);
  console.log(`Loaded ${all.length} conversations, ${pool.length} two-way`);

  if (args.sender) {
    const userId = Object.entries(SENDER_NAMES).find(([, name]) => name.toLowerCase() === args.sender)?.[0];
    if (!userId) {
      console.error(`Unknown sender "${args.sender}". Known: ${Object.values(SENDER_NAMES).join(', ').toLowerCase()}`);
      process.exit(1);
    }
    pool = pool.filter((c) => hasSender(c, userId));
    console.log(`Filtered to ${pool.length} convos involving ${args.sender}`);
  }

  const seed = args.seed ?? Math.floor(Math.random() * 2 ** 30);
  const rng = makeRng(seed);
  shuffleInPlace(pool, rng);
  const sample = pool.slice(0, args.n);
  console.log(`Sampling ${sample.length} (seed=${seed})`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const header = [
    '# Real conversation samples',
    '',
    `_${sample.length} two-way conversations from \`real-convos.jsonl\`. Seed: ${seed}._`,
    `_${args.sender ? `Filtered to those involving ${args.sender}.` : 'Across all senders.'}_`,
    '',
    'Read each thread. For every reply from the team that you would NOT want the bot to send, check the matching failure mode boxes and add a one-line note about what specifically is wrong. These notes seed the rubric and the test scenarios.',
    '',
    'Tip: skim the threads first. Tag heavily on the second pass. Quality of failure-mode tags matters more than coverage.',
    '',
    '---',
    '',
  ].join('\n');
  const body = sample.map((c, i) => renderConvo(c, i + 1)).join('\n');
  writeFileSync(OUT_PATH, header + body);
  console.log(`Wrote ${OUT_PATH}`);
}

main();
