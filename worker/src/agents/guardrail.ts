/**
 * Post-processing guardrail applied to every outbound message before it
 * ships. Enforces formatting rules deterministically so the LLM cannot
 * regress on them.
 *
 *  - No dashes of any kind (em, en, hyphen-between-words). Replace with comma+space.
 *  - Name format: "Dr. Samuel B. Lee MD".
 *  - No emoji (emoji is only allowed in the opener, which the caller marks).
 *  - No banned opener phrases.
 *  - No named staff members.
 *  - Booking link only if budget not exhausted.
 *  - Soft length cap (3 sentences / 320 chars for an SMS).
 *
 * Returns either a cleaned message or a regenerate signal with reasons.
 */

const BANNED_OPENERS = [
  /^\s*great question[!,.\s]/i,
  /^\s*absolutely[!,.\s]/i,
  /^\s*totally[!,.\s]/i,
  /^\s*i understand[!,.\s]/i,
  /^\s*thanks for reaching out/i,
  /^\s*that's a great point/i,
  /^\s*certainly[!,.\s]/i,
];

// Phrases that sound templated or wrong in Mia's voice, regardless of position.
// "Reach out" in any form is banned when Mia refers to herself/the clinic,
// because every lead is inbound and Mia is never the initiator.
const BANNED_PHRASES: RegExp[] = [
  /\bwhat'?s on your radar\b/i,
  /\bwhat brings you here\b/i,
  /\bjust wanted to (reach out|check in)\b/i,
  /\bI figured I'?d reach out\b/i,
  /\b(I|we)(\s+just)?\s*('?m|'?re|'?ve|'?d)?\s*(wanted to\s+)?reach(ed|ing)?\s+out\b/i,
  /\breaching out to (you|check|say|follow)/i,
  /\bthanks? for reaching out\b/i,
];

const STAFF_NAMES = [
  'Danielle',
  'Lauren',
  'Emily',
  'Christine',
  'Nicole',
  'Cloie',
  'Janice',
  'Erin',
];

// Wellness-claim phrases flagged by carriers (error 30007). Reject and regenerate.
const WELLNESS_CLAIM_PATTERNS: RegExp[] = [
  /you deserve to feel/i,
  /clear,?\s*energized,?\s*and\s*balanced/i,
  /feel like yourself again/i,
  /reclaim your vitality/i,
];

const NAME_VARIANTS = [
  /Dr\.?\s+Samuel\s+Lee,?\s*M\.?D\b/gi,
  /Dr\.?\s+Samuel\s+B\.?\s+Lee,?\s*M\.?D\b/gi,
  /Dr\.?\s+Lee,?\s*M\.?D\b/gi,
];

const CANONICAL_NAME = 'Dr. Samuel B. Lee MD';

const BOOKING_LINK = 'limitlesslivingmd.com/discovery';

// Matches em dash, en dash, figure dash, horizontal bar. Hyphens between
// letters handled separately (allow in URLs and words like "US-only").
const DASH_CHARS = /[\u2012\u2013\u2014\u2015\u2212]/g;

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}\u{1F680}-\u{1F6FF}]/gu;

export type GuardrailInput = {
  candidate: string;
  linkSendCountBefore: number;
  isFirstMessage: boolean;
};

export type GuardrailResult =
  | { ok: true; clean: string; linkSentThisTurn: boolean; violations: string[] }
  | { ok: false; reason: string; violations: string[] };

export function applyGuardrail(input: GuardrailInput): GuardrailResult {
  const violations: string[] = [];
  let text = input.candidate.trim();

  // 1. Remove every dash-like character, replace with comma-space. Keep
  //    hyphens that are clearly inside a word (letter-hyphen-letter) only
  //    if they appear in approved tokens; otherwise kill them too.
  text = text.replace(DASH_CHARS, ', ');
  // Hyphens between letters (e.g. "US-only", "long-term") get softened.
  text = text.replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2');
  text = text.replace(/ ,/g, ',').replace(/,\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();

  // 2. Normalize doctor name variants.
  for (const rx of NAME_VARIANTS) {
    text = text.replace(rx, CANONICAL_NAME);
  }

  // 3. Strip emoji unless this is the first message.
  if (!input.isFirstMessage) {
    const hadEmoji = EMOJI_REGEX.test(text);
    if (hadEmoji) {
      violations.push('stripped_emoji_after_opener');
      text = text.replace(EMOJI_REGEX, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // 4. Reject banned openers -> regenerate.
  for (const rx of BANNED_OPENERS) {
    if (rx.test(text)) {
      return { ok: false, reason: `banned opener: ${rx}`, violations: [...violations, 'banned_opener'] };
    }
  }

  // 4b. Reject banned phrases anywhere in the message.
  for (const rx of BANNED_PHRASES) {
    if (rx.test(text)) {
      return {
        ok: false,
        reason: `banned phrase: ${rx}`,
        violations: [...violations, 'banned_phrase'],
      };
    }
  }

  // 5. Reject named staff -> regenerate.
  for (const name of STAFF_NAMES) {
    const rx = new RegExp(`\\b${name}\\b`);
    if (rx.test(text)) {
      return {
        ok: false,
        reason: `named staff member: ${name}`,
        violations: [...violations, 'named_staff'],
      };
    }
  }

  // 5b. Reject carrier-risk wellness-claim phrasing.
  for (const rx of WELLNESS_CLAIM_PATTERNS) {
    if (rx.test(text)) {
      return {
        ok: false,
        reason: `wellness-claim carrier risk: ${rx}`,
        violations: [...violations, 'carrier_risk_wellness_claim'],
      };
    }
  }

  // 6. Booking link budget.
  const linkPresent = text.toLowerCase().includes(BOOKING_LINK.toLowerCase());
  if (linkPresent && input.linkSendCountBefore >= 2) {
    return {
      ok: false,
      reason: 'booking link budget exhausted',
      violations: [...violations, 'link_budget_exceeded'],
    };
  }

  // 7. Length cap. SMS-friendly but not aggressive — we want the bridge
  //    sentence to survive. Modern carriers concatenate long SMS into a
  //    single message for the recipient, so 450 chars (3 segments) is a
  //    fine hard cap.
  const HARD_CAP = 450;
  if (text.length > HARD_CAP) {
    violations.push('too_long_trimmed');
    text = trimPreservingBridge(text, 3, HARD_CAP);
  }

  return {
    ok: true,
    clean: text,
    linkSentThisTurn: linkPresent,
    violations,
  };
}

function trimPreservingBridge(text: string, maxSentences: number, maxChars: number): string {
  const parts = (text.match(/[^.!?]+[.!?]?/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= maxSentences && text.length <= maxChars) return text;

  // Keep first sentence (validation) + last sentence (bridge).
  // Drop middle sentences until total length fits.
  if (parts.length <= 2) {
    // Nothing to drop. Hard-truncate as a fallback.
    return text.slice(0, maxChars).trim();
  }

  const first = parts[0];
  const last = parts[parts.length - 1];
  const middles = parts.slice(1, -1);

  let kept = `${first} ${last}`;
  if (kept.length <= maxChars && maxSentences >= 2) {
    // Try to add middles back in order until we hit a cap.
    for (const m of middles) {
      const candidate = `${first} ${m} ${last}`;
      if (candidate.length <= maxChars) kept = candidate;
      else break;
    }
    return kept;
  }

  // First + last still too long. Truncate the first, keep the bridge intact.
  const budget = maxChars - last.length - 1;
  if (budget > 40) {
    return `${first.slice(0, budget).trim()} ${last}`;
  }
  return last;
}
