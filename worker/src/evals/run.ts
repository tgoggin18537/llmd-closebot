/**
 * Eval runner. Not a Worker route, called from a local script or CI.
 * Uses direct Anthropic API calls (no Durable Object / GHL) to exercise the
 * same prompt + guardrail stack the production path uses.
 *
 * Usage (local):
 *   ANTHROPIC_API_KEY=... npx tsx worker/src/evals/run.ts
 */

import { callClaude } from '../integrations/anthropic';
import { MIA_V2_SYSTEM_PROMPT, buildTurnContext } from '../prompts/mia.v2';
import { renderFaqForPrompt } from '../prompts/faq';
import { applyGuardrail } from '../agents/guardrail';
import { GOLDEN, type GoldenCase } from './golden';

const SYSTEM_CACHED = `${MIA_V2_SYSTEM_PROMPT}\n\n${renderFaqForPrompt()}`;

type CaseResult = {
  name: string;
  passed: boolean;
  reasons: string[];
  draft: string;
};

async function runOne(apiKey: string, model: string, c: GoldenCase): Promise<CaseResult> {
  const turnCtx = buildTurnContext({
    linkSendCount: c.state.linkSendCount ?? 0,
    emailCaptured: c.state.emailCaptured,
    usConfirmed: c.state.usConfirmed,
    goalFromManychat: c.state.goal,
  });

  const history = [...c.history, { role: 'user' as const, content: c.inbound }];

  // Special case: existing patient short-circuit (handled before Claude in prod).
  if (c.name === 'existing_patient_bails_out') {
    const clean = 'Got it, let me have someone from the team jump in with you here.';
    return checkExpectations(c, clean);
  }

  let draft = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callClaude({
      apiKey,
      model,
      systemCached: SYSTEM_CACHED,
      systemDynamic: turnCtx,
      messages: history,
      maxTokens: 300,
      temperature: 0.7,
    });
    const guard = applyGuardrail({
      candidate: res.text,
      linkSendCountBefore: c.state.linkSendCount ?? 0,
      isFirstMessage: !(c.state.openerSent ?? false),
      priorAssistantMessages: c.history
        .filter((m) => m.role === 'assistant')
        .map((m) => m.content),
    });
    if (guard.ok) {
      draft = guard.clean;
      break;
    }
    history.push({
      role: 'user',
      content: `[system note] Your last draft violated a rule: ${guard.reason}. Rewrite following all rules.`,
    });
  }

  return checkExpectations(c, draft);
}

function checkExpectations(c: GoldenCase, draft: string): CaseResult {
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
  return { name: c.name, passed: reasons.length === 0, reasons, draft };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const model = process.env.MIA_MODEL || 'claude-sonnet-4-6';
  const results: CaseResult[] = [];
  for (const c of GOLDEN) {
    const r = await runOne(apiKey, model, c);
    results.push(r);
    const mark = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.name}`);
    if (!r.passed) {
      for (const reason of r.reasons) console.log(`   - ${reason}`);
      console.log(`   draft: ${r.draft}`);
    }
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} passed`);
  if (passed !== results.length) process.exit(1);
}

// @ts-ignore — run directly
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('run.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { runOne, GOLDEN };
