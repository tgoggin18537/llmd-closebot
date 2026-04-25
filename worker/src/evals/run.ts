/**
 * Eval runner. Runs each golden case through the EXACT production code path
 * (system prompt + FAQ injection + buildTurnContext + Claude + guardrail
 * retry loop). The output is consumed by the judge to produce a graded
 * report.
 *
 * Usage:
 *   npm run eval                              # full active set (no holdouts)
 *   npm run eval -- --include-holdout         # full active + holdout
 *   npm run eval -- --only=regression         # only regression cases
 *   npm run eval -- --only=failure-pattern    # only failure-pattern cases
 *   npm run eval -- --case=qualification_checklist_on_yes_signal
 *   npm run eval -- --concurrency=4
 *
 * Reads ANTHROPIC_API_KEY and AVA_MODEL from env (set via shell or .dev.vars).
 *
 * Output: evals/runs/<ISO-timestamp>/results.jsonl (one line per case).
 *
 * Skips the existing-patient and soft-decline routes since those short-
 * circuit before Claude in production. Use the dedicated classifier tests
 * for those.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeWithGuardrailRetry } from '../agents/respond';
import { AVA_V2_SYSTEM_PROMPT, buildTurnContext } from '../prompts/ava.v2';
import { renderFaqForPrompt } from '../prompts/faq';
import { GOLDEN, type GoldenCase } from './golden';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const SYSTEM_CACHED = `${AVA_V2_SYSTEM_PROMPT}\n\n${renderFaqForPrompt()}`;

export type CaseResult = {
  name: string;
  category: 'failure-pattern' | 'regression' | 'edge-case';
  holdOut: boolean;
  inbound: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Final accepted candidate, or empty string if guardrail exhausted retries. */
  candidate: string;
  /** Static expected behavior, kept for the judge to consider. */
  rubric?: string;
  humanGoldReply?: string;
  /** Cheap pre-checks based on mustContain/mustNotContain. */
  preChecks: { passed: boolean; reasons: string[] };
  /** Per-attempt log: every draft and rejection reason. */
  attemptLog: Array<{ draft: string; reason?: string }>;
  /** Guardrail violations on the accepted candidate (e.g. "stripped_emoji_after_opener"). */
  violations: string[];
  /** True if the guardrail retry loop never produced an accepted draft. */
  fallback: boolean;
  /** End-to-end latency in ms. */
  latencyMs: number;
  /** Aggregate Anthropic token usage across all attempts. */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
};

type Args = {
  includeHoldout: boolean;
  only?: 'failure-pattern' | 'regression' | 'edge-case';
  case?: string;
  concurrency: number;
  outDir: string;
  model: string;
};

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.+))?$/);
    if (m) args[m[1]] = m[2] ?? 'true';
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    includeHoldout: args['include-holdout'] === 'true',
    only: args.only as Args['only'],
    case: args.case,
    concurrency: args.concurrency ? Number(args.concurrency) : 1,
    outDir: args.out ?? resolve(REPO_ROOT, `evals/runs/${ts}`),
    model: args.model ?? process.env.AVA_MODEL ?? 'claude-sonnet-4-6',
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
  console.error('ANTHROPIC_API_KEY not in env or .dev.vars (or it looks like a placeholder).');
  process.exit(1);
}

function selectCases(all: GoldenCase[], args: Args): GoldenCase[] {
  let cases = all;
  if (args.case) {
    cases = cases.filter((c) => c.name === args.case);
    if (cases.length === 0) {
      console.error(`No case named "${args.case}". Run without --case to see all.`);
      process.exit(1);
    }
  } else {
    if (!args.includeHoldout) cases = cases.filter((c) => !c.holdOut);
    if (args.only) cases = cases.filter((c) => (c.category ?? 'failure-pattern') === args.only);
  }
  return cases;
}

function preChecks(c: GoldenCase, draft: string): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lowered = draft.toLowerCase();
  if (c.mustContainAny && c.mustContainAny.length) {
    const hit = c.mustContainAny.some((s) => lowered.includes(s.toLowerCase()));
    if (!hit) reasons.push(`missing required phrase; expected one of: ${c.mustContainAny.join(' | ')}`);
  }
  if (c.mustNotContain) {
    for (const s of c.mustNotContain) {
      if (lowered.includes(s.toLowerCase())) reasons.push(`contained forbidden phrase: ${s}`);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

async function runOne(apiKey: string, model: string, c: GoldenCase): Promise<CaseResult> {
  const t0 = Date.now();
  const turnCtx = buildTurnContext({
    linkSendCount: c.state.linkSendCount ?? 0,
    emailCaptured: c.state.emailCaptured,
    usConfirmed: c.state.usConfirmed,
    goalFromManychat: c.state.goal,
  });

  // Special case: existing-patient short-circuits before Claude in production.
  // Skip the live Claude call and synthesize the canned reply.
  if (c.name === 'existing_patient_bails_out') {
    const candidate = 'Got it, let me have someone from the team jump in with you here.';
    return {
      name: c.name,
      category: c.category ?? 'failure-pattern',
      holdOut: !!c.holdOut,
      inbound: c.inbound,
      history: c.history,
      candidate,
      rubric: c.rubric,
      humanGoldReply: c.humanGoldReply,
      preChecks: preChecks(c, candidate),
      attemptLog: [{ draft: candidate }],
      violations: [],
      fallback: false,
      latencyMs: Date.now() - t0,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  }

  const messages = [...c.history, { role: 'user' as const, content: c.inbound }];
  const result = await runClaudeWithGuardrailRetry({
    apiKey,
    model,
    systemCached: SYSTEM_CACHED,
    systemDynamic: turnCtx,
    messages,
    linkSendCountBefore: c.state.linkSendCount ?? 0,
    isFirstMessage: !(c.state.openerSent ?? false),
    priorAssistantMessages: c.history.filter((m) => m.role === 'assistant').map((m) => m.content),
    maxAttempts: 3,
  });

  const candidate = result.candidate;
  return {
    name: c.name,
    category: c.category ?? 'failure-pattern',
    holdOut: !!c.holdOut,
    inbound: c.inbound,
    history: c.history,
    candidate,
    rubric: c.rubric,
    humanGoldReply: c.humanGoldReply,
    preChecks: preChecks(c, candidate),
    attemptLog: result.attemptLog,
    violations: result.violations,
    fallback: candidate === '',
    latencyMs: Date.now() - t0,
    usage: result.usage,
  };
}

/** Bounded concurrency: process N cases in parallel. Lets a 45-case run finish in ~30s instead of 5 min. */
async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T, idx: number) => Promise<CaseResult>): Promise<CaseResult[]> {
  const results: CaseResult[] = new Array(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await fn(items[idx], idx);
        done++;
        process.stdout.write(`  ${done}/${items.length} ${results[idx].fallback ? 'FALLBACK' : results[idx].preChecks.passed ? 'pre-pass' : 'pre-fail'}: ${results[idx].name}\n`);
      }
    }),
  );
  return results;
}

async function main() {
  const args = parseArgs();
  const apiKey = loadKey();
  const cases = selectCases(GOLDEN, args);
  console.log(`Running ${cases.length} cases (model=${args.model}, concurrency=${args.concurrency})`);
  console.log(`Output: ${args.outDir}`);

  mkdirSync(args.outDir, { recursive: true });

  const t0 = Date.now();
  const results = await runWithConcurrency(cases, args.concurrency, (c) => runOne(apiKey, args.model, c));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Write JSONL
  const out = resolve(args.outDir, 'results.jsonl');
  writeFileSync(out, results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // Headline summary on stdout
  const prePass = results.filter((r) => r.preChecks.passed).length;
  const fallbacks = results.filter((r) => r.fallback).length;
  const totalTokens = results.reduce((a, r) => a + r.usage.input_tokens + r.usage.output_tokens, 0);
  console.log(`\n${prePass}/${results.length} passed pre-checks (${fallbacks} fallback) in ${elapsed}s, ${totalTokens} tokens`);
  console.log(`Wrote ${out}`);
  console.log(`Next: npm run judge -- --run=${args.outDir}`);
}

// @ts-ignore
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('run.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { runOne, GOLDEN };
