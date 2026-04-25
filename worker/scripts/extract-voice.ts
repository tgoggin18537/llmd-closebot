/**
 * Voice extraction. Reads evals/real-convos.jsonl, pulls every outbound
 * SMS from a named sender, sends them to Claude Opus with a structured
 * rubric, and writes the resulting voice profile to evals/voice-notes.md.
 *
 * Usage:
 *   npm run extract-voice -- --sender=lauren
 *   npm run extract-voice -- --sender=janice
 *   npm run extract-voice -- --sender=erin
 *
 * Reads ANTHROPIC_API_KEY from worker/.dev.vars.
 *
 * Output is appended (with an H1 header per sender) so you can run all
 * three and have a single voice-notes.md to consume.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEV_VARS = resolve(REPO_ROOT, '.dev.vars');
const IN_PATH = resolve(REPO_ROOT, 'evals/real-convos.jsonl');
const OUT_PATH = resolve(REPO_ROOT, 'evals/voice-notes.md');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Pulled from raw/training-data.overview.csv KEY FINDINGS.
const SENDER_USERIDS: Record<string, string> = {
  lauren: 'Ptq5d0pW1GYT2uFJraIM',
  janice: '1N3n2voecT7o7g5rqyH2',
  erin: 'lZnQHFibOdnLt3KbGw5l',
};

type Args = { sender: string; model: string; reset?: boolean };

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.+))?$/);
    if (m) args[m[1]] = m[2] ?? 'true';
  }
  if (!args.sender) {
    console.error('Usage: npm run extract-voice -- --sender=<lauren|janice|erin> [--model=claude-opus-4-5] [--reset]');
    process.exit(1);
  }
  if (!SENDER_USERIDS[args.sender.toLowerCase()]) {
    console.error(`Unknown sender "${args.sender}". Known: ${Object.keys(SENDER_USERIDS).join(', ')}`);
    process.exit(1);
  }
  return {
    sender: args.sender.toLowerCase(),
    model: args.model ?? 'claude-opus-4-5',
    reset: args.reset === 'true',
  };
}

function loadKey(): string {
  if (!existsSync(DEV_VARS)) {
    console.error(`Missing ${DEV_VARS}.`);
    process.exit(1);
  }
  for (const line of readFileSync(DEV_VARS, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    if (!v.startsWith('"') && !v.startsWith("'")) {
      const h = v.indexOf(' #');
      if (h !== -1) v = v.slice(0, h).trim();
    }
    v = v.replace(/^["']|["']$/g, '');
    if (!v || v === '...' || v.startsWith('...') || v.length < 30) {
      console.error(`ANTHROPIC_API_KEY in .dev.vars looks like a placeholder (${v.length} chars). Paste the real sk-ant-... key.`);
      process.exit(1);
    }
    return v;
  }
  console.error('ANTHROPIC_API_KEY not found in .dev.vars');
  process.exit(1);
}

function loadSenderMessages(senderUserId: string): string[] {
  if (!existsSync(IN_PATH)) {
    console.error(`Missing ${IN_PATH}. Run npm run export-convos first.`);
    process.exit(1);
  }
  const out: string[] = [];
  for (const line of readFileSync(IN_PATH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    for (const m of c.messages ?? []) {
      if (m.direction === 'outbound' && m.userId === senderUserId && m.body && m.body.trim().length > 0) {
        out.push(m.body.trim());
      }
    }
  }
  return out;
}

function buildPrompt(senderName: string, messages: string[]): string {
  const niceName = senderName[0].toUpperCase() + senderName.slice(1);
  const corpus = messages
    .map((m, i) => `--- msg ${i + 1} ---\n${m}`)
    .join('\n\n');

  return `You are analyzing the SMS voice of ${niceName}, a setter/closer at Limitless Living MD (a physician-led peptide therapy clinic). Below are ${messages.length} of her real outbound text messages to leads.

Your job: extract her distinctive linguistic moves so we can train an AI bot to sound exactly like her, NOT like a generic SDR or LLM. The bot already follows generic rules ("no em dashes, one question per message, no AI tells"). What we need from you is the SPECIFIC, OBSERVABLE moves that are uniquely ${niceName}.

Output as markdown with these H2 sections:

## Sentence shape
Average sentence length, fragment vs full sentence ratio, punctuation patterns. Quote 3-5 representative examples.

## Distinctive openers
How she ACTUALLY starts replies. Quote 5-10 verbatim opener phrases she uses repeatedly. (We're not looking for what to ban, we're looking for her real patterns.)

## Distinctive closers and CTAs
How she ends messages or transitions to a call invite. Quote her actual verbatim CTA phrases.

## Question patterns
How she asks discovery questions. Frequency, phrasing, when she asks vs when she just delivers info. Quote examples.

## Vocabulary tics
Specific words and phrases she uses repeatedly that an AI wouldn't think to use. (e.g. "for sure", "totally", "let me know", brand-specific phrasing.) List the top 10-15 with example contexts.

## Energy markers
How she conveys warmth, urgency, casualness. Emoji use. Capitalization patterns. Exclamation use.

## Objection and stall handling
When a lead pushes back, ghosts, says "not sure," or asks for more time, what specific moves does ${niceName} make? Quote 3-5 actual examples.

## Call invite phrasing
Her exact verbatim phrases for inviting a lead to book the discovery call. Multiple variations if she uses them.

## What an AI bot would miss
The 3-5 most subtle moves she makes that an LLM trained on "sound human" generic guidance would NOT replicate. Be specific.

Rules:
- QUOTE actual messages for every observation. No generalities without examples.
- If a section has no clear pattern, say so. Don't invent.
- Don't sanitize. If she uses casual / fragmented / "wrong" English, capture it.
- The point is to make this bot sound like ${niceName}, not like a polished writer.

The messages:

${corpus}`;
}

async function callAnthropic(apiKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt}`);
  }
  const data = (await res.json()) as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error(`No text in Anthropic response: ${JSON.stringify(data).slice(0, 500)}`);
  return text;
}

async function main() {
  const args = parseArgs();
  const apiKey = loadKey();
  const userId = SENDER_USERIDS[args.sender];

  const messages = loadSenderMessages(userId);
  console.log(`Sender: ${args.sender}  userId: ${userId}`);
  console.log(`Messages found: ${messages.length}`);
  if (messages.length === 0) {
    console.error('No messages for this sender. Did you export the right date range?');
    process.exit(1);
  }
  const totalChars = messages.reduce((a, m) => a + m.length, 0);
  console.log(`Total chars in corpus: ${totalChars} (~${Math.round(totalChars / 4)} tokens)`);

  const prompt = buildPrompt(args.sender, messages);
  console.log(`Calling ${args.model}...`);
  const t0 = Date.now();
  const text = await callAnthropic(apiKey, args.model, prompt);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Got ${text.length} chars back in ${elapsed}s`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  if (args.reset || !existsSync(OUT_PATH)) {
    writeFileSync(OUT_PATH, '# Voice notes\n\nExtracted from real GHL SMS conversations (March 1 to April 15, 2026).\n\n');
  }
  const niceName = args.sender[0].toUpperCase() + args.sender.slice(1);
  appendFileSync(OUT_PATH, `\n---\n\n# ${niceName}\n\n_Source: ${messages.length} outbound SMS messages. Generated by ${args.model}._\n\n${text}\n`);
  console.log(`Appended to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
