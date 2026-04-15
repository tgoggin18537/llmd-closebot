/**
 * /debug/simulate
 *
 * Dry-run endpoint. Takes a conversation history and the latest user
 * message, returns what Mia would reply WITHOUT sending anything through
 * GHL and WITHOUT persisting to the Durable Object.
 *
 * Used for:
 *  - Testing Mia before GHL workflows are wired up.
 *  - Lauren/Nicole adversarial testing via curl or a tiny web UI.
 *  - CI eval runs against the live Worker.
 *
 * Auth: requires the same GHL_WEBHOOK_SECRET header as inbound webhooks.
 */

import { callClaude } from '../integrations/anthropic';
import { MIA_V2_SYSTEM_PROMPT, buildTurnContext } from '../prompts/mia.v2';
import { renderFaqForPrompt } from '../prompts/faq';
import { applyGuardrail } from '../agents/guardrail';
import type { Env } from '../env';

const SYSTEM_CACHED = `${MIA_V2_SYSTEM_PROMPT}\n\n${renderFaqForPrompt()}`;

type SimInput = {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  inbound: string;
  state?: {
    linkSendCount?: number;
    openerSent?: boolean;
    emailCaptured?: string;
    usConfirmed?: boolean;
    goal?: string;
    painPoint?: string;
  };
};

export async function handleSimulate(req: Request, env: Env): Promise<Response> {
  if (env.GHL_WEBHOOK_SECRET) {
    const sig = req.headers.get('x-ghl-webhook-secret');
    if (sig !== env.GHL_WEBHOOK_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
  }

  const body = (await req.json()) as SimInput;
  if (!body.inbound) {
    return new Response('bad request: inbound required', { status: 400 });
  }

  const history = (body.history ?? []).map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: 'user' as const, content: body.inbound });

  const state = body.state ?? {};
  const turnCtx = buildTurnContext({
    linkSendCount: state.linkSendCount ?? 0,
    goalFromManychat: state.goal,
    painPointFromManychat: state.painPoint,
    emailCaptured: state.emailCaptured,
    usConfirmed: state.usConfirmed,
  });

  let draft = '';
  let lastViolations: string[] = [];
  let lastReason: string | undefined;
  let linkSentThisTurn = false;
  const attempts: Array<{ raw: string; guard: any }> = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.MIA_MODEL || 'claude-sonnet-4-6',
      systemCached: SYSTEM_CACHED,
      systemDynamic: turnCtx,
      messages: history,
      maxTokens: 300,
      temperature: 0.7,
    });
    const guard = applyGuardrail({
      candidate: res.text,
      linkSendCountBefore: state.linkSendCount ?? 0,
      isFirstMessage: !(state.openerSent ?? false),
    });
    attempts.push({ raw: res.text, guard });
    if (guard.ok) {
      draft = guard.clean;
      lastViolations = guard.violations;
      linkSentThisTurn = guard.linkSentThisTurn;
      break;
    }
    lastReason = guard.reason;
    history.push({
      role: 'user',
      content: `[system note] Your last draft violated a rule: ${guard.reason}. Rewrite following all rules.`,
    });
  }

  return Response.json({
    ok: !!draft,
    reply: draft || null,
    violations: lastViolations,
    linkSentThisTurn,
    lastGuardrailReason: draft ? null : lastReason,
    attempts,
  });
}
