/**
 * Claude + guardrail retry loop, factored so production webhook AND eval
 * harness call the exact same code path.
 *
 * The loop:
 *   1. Call Claude with the system prompt + history
 *   2. Run the candidate through the guardrail
 *   3. If guardrail accepts: return the cleaned candidate
 *   4. If guardrail rejects: append a "[system note] you violated X, rewrite"
 *      message to history and retry, up to maxAttempts
 *   5. If still failing after maxAttempts: return empty candidate, caller
 *      decides fallback (production webhook ships a static safe reply +
 *      tags needs-human; eval harness records the failure)
 *
 * Side effects: none. This is a pure function over its inputs. The history
 * array IS mutated in place when retries push system notes (matches the
 * prior inline behavior). If you need to preserve the original, clone first.
 */

import { callClaude } from '../integrations/anthropic';
import { applyGuardrail } from './guardrail';

export type RespondInput = {
  apiKey: string;
  model: string;
  systemCached: string;
  systemDynamic: string;
  /** Conversation history. The last message must be the user's inbound. Mutated in place on retries. */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  linkSendCountBefore: number;
  isFirstMessage: boolean;
  priorAssistantMessages: string[];
  maxAttempts?: number;
  maxTokens?: number;
  temperature?: number;
};

export type RespondResult = {
  /** Final clean reply, or empty string if guardrail never accepted. */
  candidate: string;
  /** True if the accepted candidate contains a booking link (caller should bump linkSendCount). */
  linkSentThisTurn: boolean;
  /** Guardrail violation tags on the accepted draft (e.g. "stripped_emoji_after_opener"). */
  violations: string[];
  /** Per-attempt log: every draft Claude produced and the rejection reason if any. */
  attemptLog: Array<{ draft: string; reason?: string }>;
  /** Aggregate token usage across all attempts (for cost analysis). */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
};

export async function runClaudeWithGuardrailRetry(input: RespondInput): Promise<RespondResult> {
  const maxAttempts = input.maxAttempts ?? 3;
  const maxTokens = input.maxTokens ?? 300;
  const temperature = input.temperature ?? 0.8;

  const attemptLog: Array<{ draft: string; reason?: string }> = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const claudeRes = await callClaude({
      apiKey: input.apiKey,
      model: input.model,
      systemCached: input.systemCached,
      systemDynamic: input.systemDynamic,
      messages: input.messages,
      maxTokens,
      temperature,
    });

    usage.input_tokens += claudeRes.usage.input_tokens ?? 0;
    usage.output_tokens += claudeRes.usage.output_tokens ?? 0;
    usage.cache_creation_input_tokens += claudeRes.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += claudeRes.usage.cache_read_input_tokens ?? 0;

    const guard = applyGuardrail({
      candidate: claudeRes.text,
      linkSendCountBefore: input.linkSendCountBefore,
      isFirstMessage: input.isFirstMessage,
      priorAssistantMessages: input.priorAssistantMessages,
    });

    if (guard.ok) {
      attemptLog.push({ draft: claudeRes.text });
      return {
        candidate: guard.clean,
        linkSentThisTurn: guard.linkSentThisTurn,
        violations: guard.violations,
        attemptLog,
        usage,
      };
    }

    attemptLog.push({ draft: claudeRes.text, reason: guard.reason });
    // Nudge the model to retry with the specific rule that broke.
    input.messages.push({
      role: 'user',
      content: `[system note] Your last draft violated a rule: ${guard.reason}. Rewrite following all rules. Keep it to one short reply, one question maximum. Do not repeat any goal-discovery question already asked earlier in the thread.`,
    });
  }

  // Exhausted all attempts. Caller decides fallback behavior.
  return {
    candidate: '',
    linkSentThisTurn: false,
    violations: [],
    attemptLog,
    usage,
  };
}
