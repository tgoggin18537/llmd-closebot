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
