/**
 * Small, cheap classifiers run via Haiku. Used for:
 *  - Existing patient detection (do not engage, alert team)
 *  - Email extraction (capture if present)
 *  - Intent signal (agreed_to_book / objection / question / stall)
 */

import { callClaude } from '../integrations/anthropic';

const CLASSIFIER_MODEL = 'claude-haiku-4-5-20251001';

export async function classifyExistingPatient(
  apiKey: string,
  inbound: string,
): Promise<boolean> {
  const res = await callClaude({
    apiKey,
    model: CLASSIFIER_MODEL,
    systemCached:
      'You classify whether a text message indicates the sender is an EXISTING patient/customer of a peptide therapy clinic. Reply with exactly YES or NO. Signals for YES: mentions of being a patient already, their current protocol, peptide they are already taking, their portal, their last order, reorder. Do not say YES for someone who is just asking about becoming a patient.',
    messages: [{ role: 'user', content: inbound }],
    maxTokens: 3,
    temperature: 0,
  });
  return res.text.trim().toUpperCase().startsWith('YES');
}

export function extractEmail(text: string): string | undefined {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m?.[0];
}

export async function classifyAgreedToBook(
  apiKey: string,
  inbound: string,
): Promise<boolean> {
  const res = await callClaude({
    apiKey,
    model: CLASSIFIER_MODEL,
    systemCached:
      'You classify whether a short text reply indicates the person is agreeing to book a call or receive a booking link. Reply exactly YES or NO. YES signals: "sure", "yes", "ok", "send it", "book me", "lets do it", "im in", "send the link". NO signals: questions, hesitation, pushback.',
    messages: [{ role: 'user', content: inbound }],
    maxTokens: 3,
    temperature: 0,
  });
  return res.text.trim().toUpperCase().startsWith('YES');
}

/**
 * Detects soft declines: messages where the lead wants to disengage but
 * didn't text the literal STOP that triggers carrier-level unsubscribe.
 *
 * False positives shut off engaged leads, so this MUST be conservative.
 * Stalls ("not sure yet", "maybe later") are NOT declines, they get warm
 * Mia replies. Only intent-to-disengage signals return YES.
 */
export async function classifySoftDecline(
  apiKey: string,
  inbound: string,
): Promise<boolean> {
  const res = await callClaude({
    apiKey,
    model: CLASSIFIER_MODEL,
    systemCached:
      'You classify whether a short text reply expresses CLEAR intent to stop being contacted, decline the offer, or end the conversation. Reply exactly YES or NO. YES signals (intent to disengage): "no thanks", "no thank you", "not interested", "please stop messaging", "don\'t text me", "remove me", "unsubscribe me", "cancel my orders", "I decided not to", "I changed my mind", "going a different direction". NO signals (engagement, even if hesitant or negative): questions about anything, stalls ("not sure yet", "thinking about it", "maybe later"), concerns ("worried about side effects", "is it safe"), logistics ("can\'t talk now", "busy this week"), bare "no" in a qualification context (like "no I\'m not in the US"). Be conservative. When in doubt, say NO.',
    messages: [{ role: 'user', content: inbound }],
    maxTokens: 3,
    temperature: 0,
  });
  return res.text.trim().toUpperCase().startsWith('YES');
}

/**
 * Static warm-exit reply sent when classifySoftDecline returns YES.
 * Matches Janice's actual decline-acknowledgment voice (per training data
 * conversation #14: cheryl). Short, warm, no re-pitch, no link, no emoji
 * (this is post-opener so the emoji budget is exhausted).
 */
export const SOFT_DECLINE_REPLY =
  "Totally get it. If anything ever changes or questions come up later, we're here. Wishing you the best.";
