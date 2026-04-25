/**
 * LLM-as-judge for eval results. Runs two grading modes:
 *
 *   Mode A: per-dimension binary judge (Sonnet). For every case, grades
 *           voice / hygiene / read_the_room / no_cliches as PASS/FAIL with
 *           written reasoning. Each dimension is its own isolated judge call
 *           (per Anthropic guidance: do not stuff multiple dims into one rubric).
 *
 *   Mode B: pairwise voice judge (Opus). For cases that have humanGoldReply,
 *           shows the bot reply and the human reply side-by-side, asks which
 *           sounds more like the team. Runs BOTH orderings (A/B and B/A) per
 *           the position-bias literature; only counts as a win if both
 *           orderings agree. TIE on disagreement.
 *
 * Usage:
 *   npm run judge -- --run=evals/runs/<timestamp>
 *   npm run judge -- --run=evals/runs/<timestamp> --concurrency=4
 *
 * Reads ANTHROPIC_API_KEY from env or .dev.vars.
 *
 * Output: <run-dir>/judgments.jsonl (one line per case).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseResult } from './run';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const PER_DIM_MODEL = 'claude-sonnet-4-6';
const PAIRWISE_MODEL = 'claude-opus-4-5';

export type Dimension = 'voice' | 'hygiene' | 'read_the_room' | 'no_cliches';
const ALL_DIMS: Dimension[] = ['voice', 'hygiene', 'read_the_room', 'no_cliches'];

export type DimVerdict = {
  dimension: Dimension;
  passed: boolean;
  reasoning: string;
};

export type PairwiseVerdict = {
  /** 'bot' = bot won both orderings. 'human' = human won both. 'tie' = orderings disagreed or judge said TIE. */
  winner: 'bot' | 'human' | 'tie';
  orderingABotFirst: 'A' | 'B' | 'TIE';
  orderingAHumanFirst: 'A' | 'B' | 'TIE';
  reasoningBotFirst: string;
  reasoningHumanFirst: string;
};

export type Judgment = {
  name: string;
  category: 'failure-pattern' | 'regression' | 'edge-case';
  holdOut: boolean;
  fallback: boolean;
  preChecksPassed: boolean;
  preCheckReasons: string[];
  dimensions: DimVerdict[];
  pairwise?: PairwiseVerdict;
  /** Aggregate: did this case pass all graded dimensions AND pre-checks? */
  overallPass: boolean;
};

type Args = { runDir: string; concurrency: number };

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.+))?$/);
    if (m) args[m[1]] = m[2] ?? 'true';
  }
  if (!args.run) {
    console.error('Usage: npm run judge -- --run=evals/runs/<timestamp> [--concurrency=4]');
    process.exit(1);
  }
  return {
    runDir: resolve(args.run),
    concurrency: args.concurrency ? Number(args.concurrency) : 1,
  };
}

function loadKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const devVars = resolve(REPO_ROOT, '.dev.vars');
  try {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if (!v.startsWith('"') && !v.startsWith("'")) {
        const h = v.indexOf(' #');
        if (h !== -1) v = v.slice(0, h).trim();
      }
      v = v.replace(/^["']|["']$/g, '');
      if (v && v.length >= 30) return v;
    }
  } catch {
    // fall through
  }
  console.error('ANTHROPIC_API_KEY not in env or .dev.vars.');
  process.exit(1);
}

async function callJudge(apiKey: string, model: string, prompt: string, maxTokens = 2000): Promise<string> {
  // Retry on 429 (rate limit) and 5xx with exponential backoff or
  // retry-after header. Mirrors anthropic.ts. Up to 5 attempts.
  let res!: Response;
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.ok) break;
    if (res.status !== 429 && res.status < 500) {
      lastErr = await res.text();
      throw new Error(`Anthropic ${res.status}: ${lastErr}`);
    }
    lastErr = await res.text();
    if (attempt === 4) break;
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!res.ok) throw new Error(`Anthropic ${res.status} after retries: ${lastErr}`);
  const data = (await res.json()) as any;
  return data.content?.[0]?.text ?? '';
}

function extractTag(text: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : undefined;
}

/**
 * Pull a PASS/FAIL verdict out of judge output. Tries the <verdict> tag
 * first. If the judge ran out of tokens before writing the tag, falls back
 * to scanning the last 200 chars for "PASS" or "FAIL". Returns undefined
 * only if neither is found, in which case the caller must decide.
 */
function extractBinaryVerdict(text: string): 'PASS' | 'FAIL' | undefined {
  const tagged = extractTag(text, 'verdict');
  if (tagged) {
    const v = tagged.toUpperCase();
    if (v.includes('PASS')) return 'PASS';
    if (v.includes('FAIL')) return 'FAIL';
  }
  // Fallback: scan the tail of the response. Judges often state verdict
  // in the last paragraph even when they ran out of room for the tag.
  const tail = text.slice(-300).toUpperCase();
  // Look for explicit phrasing first to avoid false positives on words
  // like "PASSing" or "FAILure" appearing earlier.
  if (/\bVERDICT[:\s]+PASS\b/.test(tail) || /\b(IS|GETS|EARNS) (A )?PASS\b/.test(tail)) return 'PASS';
  if (/\bVERDICT[:\s]+FAIL\b/.test(tail) || /\b(IS|GETS|EARNS) (A )?FAIL\b/.test(tail)) return 'FAIL';
  // Last resort: bare PASS/FAIL keyword in last 100 chars.
  const lastChunk = text.slice(-100).toUpperCase();
  if (/\bPASS\b/.test(lastChunk) && !/\bFAIL\b/.test(lastChunk)) return 'PASS';
  if (/\bFAIL\b/.test(lastChunk) && !/\bPASS\b/.test(lastChunk)) return 'FAIL';
  return undefined;
}

function renderHistory(history: Array<{ role: string; content: string }>): string {
  if (history.length === 0) return '(no prior turns, this is the start of the conversation)';
  return history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
}

// ============================================================
// Per-dimension judge prompts. Each is isolated to one dimension.
// ============================================================

function voicePrompt(c: CaseResult): string {
  return `You are grading whether a text-message reply sounds like the team that texts leads at Limitless Living MD, a physician-led peptide therapy practice, NOT like a templated SDR bot.

WHITELIST (these are TEAM-VERBATIM phrases, do NOT mark as bot tells):
- "Wonderful!" — used by Janice when transitioning into the qualification checklist
- "I'm excited to get you connected" — Janice's bridge to the specialist
- "That's super common" — used in the FAQ for energy questions, not a bot tell
- "Amazing!" / "Yay!" — Lauren's reactions
- "yeah that's tough" — appropriate empathy on hard shares
- "Honestly tirz is the one" — opinion-having on the comparison question
- "Would you be open to that?" — Janice permission framing
- "for sure" / "for real" — natural connectors
- "All set!" / "Talk soon" — casual closeouts
These phrases are how the actual team texts. They are PASS signals when used in their natural context, NOT failures.

The team's voice patterns to PASS:
- Janice (setter): permission framing ("would you be open to that?"), no discovery questions, qualification checklists, gentle resurrects ("no worries at all, life happens")
- Lauren (transactional): short fragments, casual ("quick note", "either works just checking", "all set!"), real human reactions ("yay", "amazing", "for sure")
- Has opinions when asked, admits uncertainty when honest ("hmm honestly not 100% on that, the specialist would know exactly")
- Just answers a factual question and stops, without tacking on a goal pivot or a call invite

Voice patterns that FAIL (templated SDR / AI bot):
- Stacked cliches: "explore options that align with your goals", "no pressure at all, just helpful information", "supportive conversation", "review your goals and see what options may be a good fit", "we're so excited", "your wellness journey"
- Tacking on the goal-menu question ("what are you hoping to work on, weight loss, energy, sleep, recovery, something else?") to the end of an answer when it's not the very first message
- Tacking on a call invite to a simple factual question
- Asking probing questions after pushback ("what's making you hesitant?")
- Robotic 3-sentence rhythm every reply (validation + specific + call invite) when the moment doesn't call for it
- Compound questions ("what brings you here, is there something specific...")
- Re-asking something already answered
- Banned openers: "Great question", "Absolutely", "Totally", "I understand", "Thanks for reaching out", "Of course", "Honest answer:"
- Self-summary labels: "Short version:", "TL;DR", "In short"
- Self-correction leaking ("Wait, let me redo this", "no emoji after the first message")

CONTEXT (prior conversation):
${renderHistory(c.history)}

INBOUND: ${c.inbound}

REPLY:
${c.candidate}

Be specific in your reasoning. Quote phrases from the reply that signal team voice (PASS) or templated SDR voice (FAIL). Apply the WHITELIST: do not penalize team-verbatim phrases.

Reason in <thinking> tags, then output your final verdict in <verdict> tags as either PASS or FAIL.`;
}

function hygienePrompt(c: CaseResult): string {
  const isFirst = c.history.length === 0 || !c.history.some((m) => m.role === 'assistant');
  return `You are grading whether a text-message reply meets formatting requirements.

ALL of these must be true to PASS:
- 1 to 3 sentences total. NEVER more than 3.
- ZERO em dashes (—), en dashes (–), or letter-hyphen-letter hyphens between words (e.g. "long-term" must be "long term").
- ZERO emoji${isFirst ? ' (this IS the first assistant message, ONE smiley emoji is allowed)' : ' (this is NOT the first assistant message, zero emoji)'}.
- ZERO markdown formatting (no **bold**, no *italic*, no _underscores_, no headers).
- ZERO of these AI-tell openers: "Great question", "Absolutely", "Totally", "I understand", "Thanks for reaching out", "That's a great point", "Happy to help", "Of course", "Certainly".
- ZERO self-summary labels: "Short version:", "Quick version:", "TL;DR", "In short,", "To sum up,", "Long story short,", "The short answer", "Honest answer:", "Honestly,", "Real talk:", "Bottom line:". Mid-sentence "honestly" is fine; only message-initial is banned.
- AT MOST one question mark in the entire reply.
- If the doctor's name appears, it must be either "Dr. Samuel B. Lee MD" (full canonical) or "Dr. Lee" (short). Never "Dr. Samuel Lee, M.D." or "Dr. Samuel Lee" (missing MD).
- Must NOT name any team members (Lauren, Janice, Erin, Danielle, Emily, Christine, Nicole, Cloie). "The specialist" / "our team" only.

EXCEPTION (qualification checklist): If the reply is the qualification checklist (signature: contains 4 ✅ checkmark emojis, one per qualification item like "Based in the USA", "Open to subcutaneous injections", etc.), the following carve-outs apply:
- The 4 ✅ checkmark emojis are ALLOWED and MANDATORY for legibility. Do not flag them as emoji violations.
- The checklist counts as a single message UNIT for the 3-sentence rule. The intro line + 4 ✅ items + closing question are not "6 sentences", they are one structured checklist.
- Newlines between items are required. The checklist is the team's intentional qualification flow before the booking sequence.

REPLY:
${c.candidate}

Check each rule. Quote any violation specifically. Apply the qualification checklist exception if the reply is a checklist.

Reason in <thinking> tags, then output your verdict in <verdict> tags as PASS or FAIL.`;
}

function readTheRoomPrompt(c: CaseResult): string {
  return `You are grading whether a reply actually addresses what the lead said in the conversation.

PASS criteria (all):
- The reply answers the question the lead asked (if they asked one).
- The reply acknowledges facts the lead already shared (goal, budget, age, location, condition, medication). Does NOT re-ask something already answered.
- The reply matches energy: short reply for a short message; casual for casual; one-liner for one-word inbounds like "ok" or "thanks".
- The reply does NOT pivot away from the actual topic to push a call invite when the moment doesn't warrant it.

FAIL signals:
- Asking the lead to restate something they already told you.
- Long 3-sentence reply to a 1-word casual message (UNLESS that one-word message was a yes-signal triggering the qualification checklist or booking sequence — see exception below).
- Ignoring the actual question and re-pitching.
- Tacking on a call invite when the lead just asked a simple factual question.
- Using a generic goal-menu pivot when the lead asked something specific.

INTENDED FLOWS (do NOT mark these as FAIL):

1. **Yes-signal → qualification checklist.** When the lead agrees to a call ("sure", "yes", "ok", "sounds good", "yeah sure", "book me", "I'm in"), the team's intentional flow is to send the qualification checklist BEFORE the booking sequence. The checklist asks them to confirm: based in the USA, ready to work on a goal, open to subcutaneous injections, $300-$500 budget. This is NOT a bait-and-switch or unnecessary friction — it filters out leads who can't be served, which is the team's standard practice. A checklist response to "yes" / "ok" / "yeah sure" is the CORRECT response, not a FAIL. Even if the inbound is one word.

2. **"Send me the link" → booking sequence US check.** When the lead explicitly asks for the link ("send me the link", "give me the link", "send it"), the team SKIPS the qualification checklist and goes directly to the booking sequence, which starts with the US check ("Cool, you in the US? Just checking since we can only ship domestically right now."). This US check is not "ignoring the request" — it's the FIRST step of fulfilling it, because they can only send the link to US residents. Treat the US-check response to "send me the link" as PASS.

3. **Pushback → warm acknowledgment.** When the lead pushes back ("not ready", "thinking about it", "maybe later"), the bot's job is one warm short reply with NO question, NO call invite, and NO mention of the specialist or the call. Treat this as PASS even though it might look minimal.

CONTEXT (prior conversation):
${renderHistory(c.history)}

INBOUND: ${c.inbound}

REPLY:
${c.candidate}

Reason in <thinking> tags about whether the reply READ THE ROOM. Quote from the inbound and history to identify what the lead expected the reply to address. Apply the INTENDED FLOWS exceptions.

Output verdict in <verdict> tags as PASS or FAIL.`;
}

function noClichesPrompt(c: CaseResult): string {
  return `You are grading whether a reply contains templated SDR cliches that signal "automated cold blast" rather than "real human."

These EXACT phrases are banned. Any presence (verbatim or near-paraphrase) is FAIL:
- "explore options that align with your goals"
- "no pressure at all, just helpful information"
- "supportive conversation"
- "review your goals and see what options may be a good fit"
- "we're so excited to have you"
- "your wellness journey"
- "feel free to" (in marketing register)
- "we're here to support your"
- Any stacking of multiple SDR-marketing phrases in one reply, even if individually permissible.

Reasonable specific business language (e.g. "discovery call", "the specialist", "tirzepatide") is FINE. We are looking for the marketing-cliche register, not specific clinical language.

REPLY:
${c.candidate}

Quote any cliches present. If none, PASS.

Reason in <thinking> tags, then output verdict in <verdict> tags as PASS or FAIL.`;
}

const PROMPT_FOR_DIM: Record<Dimension, (c: CaseResult) => string> = {
  voice: voicePrompt,
  hygiene: hygienePrompt,
  read_the_room: readTheRoomPrompt,
  no_cliches: noClichesPrompt,
};

async function judgeDim(apiKey: string, c: CaseResult, dim: Dimension): Promise<DimVerdict> {
  const text = await callJudge(apiKey, PER_DIM_MODEL, PROMPT_FOR_DIM[dim](c));
  const verdict = extractBinaryVerdict(text);
  const reasoning = extractTag(text, 'thinking') ?? text;
  // If we still couldn't parse a verdict (rare with the fallback in place),
  // log it so we can detect and fix the prompt. Default to FAIL conservatively.
  if (!verdict) {
    console.warn(`[judge] No verdict found for ${c.name}/${dim}. Last 200 chars: ${text.slice(-200)}`);
  }
  return {
    dimension: dim,
    passed: verdict === 'PASS',
    reasoning: reasoning.slice(0, 1500),
  };
}

// ============================================================
// Pairwise voice judge (Opus, both orderings, consensus only)
// ============================================================

function pairwisePrompt(c: CaseResult, replyA: string, replyB: string): string {
  return `You are picking which of two text-message replies sounds more like the team that texts leads at Limitless Living MD, a physician-led peptide therapy practice. NOT which is more polished, NOT which is more salesy. Which sounds more like a real human team member.

The team's voice patterns:
- Janice (setter): permission framing, no discovery questions, qualification checklists, gentle resurrects ("no worries at all, life happens")
- Lauren (transactional): short fragments, casual ("quick note", "either works just checking", "all set!"), real human reactions
- Has opinions, admits uncertainty when honest, varies sentence shape

Templated SDR voice (the OPPOSITE, less human):
- Stacked cliches ("explore options that align with your goals", "no pressure at all", "supportive conversation")
- Robotic 3-sentence rhythm every turn
- Generic SDR scripts

CONTEXT (prior conversation):
${renderHistory(c.history)}

INBOUND: ${c.inbound}

REPLY A:
${replyA}

REPLY B:
${replyB}

Reason carefully in <thinking> tags about which reply sounds more like the real team. Quote specific phrases that swayed your judgment.

Output your verdict in <winner> tags as exactly A, B, or TIE.`;
}

async function judgePairwise(apiKey: string, c: CaseResult): Promise<PairwiseVerdict | undefined> {
  if (!c.humanGoldReply || c.fallback) return undefined;
  const bot = c.candidate;
  const human = c.humanGoldReply;

  // Ordering 1: bot=A, human=B
  const text1 = await callJudge(apiKey, PAIRWISE_MODEL, pairwisePrompt(c, bot, human), 1000);
  const w1 = (extractTag(text1, 'winner')?.toUpperCase() ?? 'TIE') as 'A' | 'B' | 'TIE';
  const r1 = extractTag(text1, 'thinking') ?? text1;

  // Ordering 2: bot=B, human=A (positions swapped)
  const text2 = await callJudge(apiKey, PAIRWISE_MODEL, pairwisePrompt(c, human, bot), 1000);
  const w2 = (extractTag(text2, 'winner')?.toUpperCase() ?? 'TIE') as 'A' | 'B' | 'TIE';
  const r2 = extractTag(text2, 'thinking') ?? text2;

  // Bot wins both orderings? -> bot. Human wins both orderings? -> human. Otherwise tie.
  let winner: 'bot' | 'human' | 'tie' = 'tie';
  if (w1 === 'A' && w2 === 'B') winner = 'bot';
  else if (w1 === 'B' && w2 === 'A') winner = 'human';

  return {
    winner,
    orderingABotFirst: w1,
    orderingAHumanFirst: w2,
    reasoningBotFirst: r1.slice(0, 1500),
    reasoningHumanFirst: r2.slice(0, 1500),
  };
}

// ============================================================
// Main
// ============================================================

async function judgeOne(apiKey: string, c: CaseResult): Promise<Judgment> {
  // Skip judging if Claude never produced a candidate. Pre-checks fail by default.
  if (c.fallback) {
    return {
      name: c.name,
      category: c.category,
      holdOut: c.holdOut,
      fallback: true,
      preChecksPassed: false,
      preCheckReasons: ['guardrail exhausted retries, no reply produced'],
      dimensions: [],
      overallPass: false,
    };
  }

  const dimVerdicts = await Promise.all(ALL_DIMS.map((dim) => judgeDim(apiKey, c, dim)));
  const pairwise = await judgePairwise(apiKey, c);

  const allDimsPassed = dimVerdicts.every((d) => d.passed);
  const overallPass = c.preChecks.passed && allDimsPassed;

  return {
    name: c.name,
    category: c.category,
    holdOut: c.holdOut,
    fallback: false,
    preChecksPassed: c.preChecks.passed,
    preCheckReasons: c.preChecks.reasons,
    dimensions: dimVerdicts,
    pairwise,
    overallPass,
  };
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx], idx);
        done++;
        process.stdout.write(`  ${done}/${items.length}\n`);
      }
    }),
  );
  return results;
}

async function main() {
  const args = parseArgs();
  const apiKey = loadKey();
  const resultsPath = resolve(args.runDir, 'results.jsonl');
  if (!existsSync(resultsPath)) {
    console.error(`Missing ${resultsPath}. Run \`npm run eval\` first.`);
    process.exit(1);
  }

  const results: CaseResult[] = readFileSync(resultsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  console.log(`Judging ${results.length} cases (per-dim=${PER_DIM_MODEL}, pairwise=${PAIRWISE_MODEL}, concurrency=${args.concurrency})`);

  const t0 = Date.now();
  const judgments = await runWithConcurrency(results, args.concurrency, (r) => judgeOne(apiKey, r));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const out = resolve(args.runDir, 'judgments.jsonl');
  writeFileSync(out, judgments.map((j) => JSON.stringify(j)).join('\n') + '\n');

  // Headline summary
  const overall = judgments.filter((j) => j.overallPass).length;
  const dimRates: Record<Dimension, { pass: number; total: number }> = {
    voice: { pass: 0, total: 0 },
    hygiene: { pass: 0, total: 0 },
    read_the_room: { pass: 0, total: 0 },
    no_cliches: { pass: 0, total: 0 },
  };
  for (const j of judgments) {
    for (const d of j.dimensions) {
      dimRates[d.dimension].total++;
      if (d.passed) dimRates[d.dimension].pass++;
    }
  }
  const pairwiseCases = judgments.filter((j) => j.pairwise);
  const botWins = pairwiseCases.filter((j) => j.pairwise!.winner === 'bot').length;
  const humanWins = pairwiseCases.filter((j) => j.pairwise!.winner === 'human').length;
  const ties = pairwiseCases.filter((j) => j.pairwise!.winner === 'tie').length;

  console.log(`\nOverall: ${overall}/${judgments.length} passed all checks (${elapsed}s)`);
  for (const dim of ALL_DIMS) {
    const r = dimRates[dim];
    console.log(`  ${dim}: ${r.pass}/${r.total} (${((r.pass / r.total) * 100).toFixed(0)}%)`);
  }
  if (pairwiseCases.length > 0) {
    console.log(`  pairwise voice: bot ${botWins}, human ${humanWins}, tie ${ties} (of ${pairwiseCases.length})`);
  }
  console.log(`Wrote ${out}`);
  console.log(`Next: npm run eval-report -- --run=${args.runDir}`);
}

// @ts-ignore
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('judge.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
