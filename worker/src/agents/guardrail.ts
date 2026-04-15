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
// "Reach out" self-referential forms are banned because every lead is inbound
// and Mia is never the initiator. We deliberately do NOT ban generic
// "the specialist will reach out to you" since that describes workflow.
const BANNED_PHRASES: RegExp[] = [
  /\bwhat'?s on your radar\b/i,
  /\bwhat brings you here\b/i,
  // Self-initiator framing in any conjugation/contraction:
  //  "I/we [('ll|will|'m|am|'re|are|'ve|have|'d|would)] reach(ed|ing) out"
  /\b(I|we)(?:'ll|\s+will|'m|\s+am|'re|\s+are|'ve|\s+have|'d|\s+would)?\s+reach(?:ed|ing)?\s+out\b/i,
  // "I/we (just) want(ed) to reach out" (catches non-contracted forms)
  /\b(I|we)(?:\s+just)?\s+want(?:ed)?\s+to\s+reach\s+out\b/i,
  // "just want(ed) to reach out / check in / follow up" without I/we anchor
  /\bjust\s+want(?:ed)?\s+to\s+(?:reach\s+out|check\s+in|follow\s+up)\b/i,
  // "figured I'd reach out"
  /\bfigured\s+I'?d\s+reach\s+out\b/i,
  /\bthanks?\s+for\s+reaching\s+out\b/i,
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

// The opener goal-discovery question family. Should appear exactly once per
// conversation. Each of these patterns catches a real paraphrase Claude tends
// to produce when it wants to pivot to goal discovery a second time:
//   "what are you hoping to work on"
//   "hoping peptides might help with"
//   "is there something specific you're hoping"
//   "any particular goal"
//   "what are you after"
const GOAL_MENU_QUESTION_PATTERNS: RegExp[] = [
  /\bwhat (?:are you|'re you|you)\s+(?:hoping|looking|trying|wanting)\s+to\s+(?:work\s+on|focus\s+on|improve|tackle|address)\b/i,
  /\b(?:hoping|looking|trying|wanting)\s+(?:peptides|them|this|something|anything)?\s*(?:might|to|could|can)?\s*help\s+(?:you\s+)?(?:with|out)\b/i,
  /\bis there (?:anything|something)\s+(?:specific\s+)?(?:you're|you are|you)\s+(?:hoping|looking|trying|wanting)\b/i,
  /\bany (?:specific|particular)\s+(?:goal|area|thing|peptide|issue|focus)\b/i,
  /\bwhat (?:are you|'re you|you) after\b/i,
  /\bwhat brought you\b/i,
];

function matchesGoalMenuQuestion(text: string): boolean {
  return GOAL_MENU_QUESTION_PATTERNS.some((rx) => rx.test(text));
}

// Rough one-question-per-message heuristic. Split on sentence or clause
// terminators, count clauses that begin with a question stem. Two or more
// stems in one message = compound question = reject.
// "which" and "why" are excluded because they appear in relative clauses far
// more than in questions ("which is why they help", "why it works so well").
// "who" is excluded for the same reason ("someone who knows").
const QUESTION_STARTER = /^(?:what|what's|how|how's|when|where|is\s+there|is\s+it|are\s+you|are\s+there|do\s+you|does\s+it|did\s+you|can\s+you|could\s+you|would\s+you|will\s+you|should\s+you|have\s+you|has\s+it|had\s+you|any\s+specific|any\s+particular|want(?:\s+me|\s+to)?\b)\b/i;

function countQuestionClauses(text: string): number {
  const clauses = text
    .split(/[.!?,]\s+/)
    .map((c) => c.trim())
    .filter(Boolean);
  return clauses.filter((c) => QUESTION_STARTER.test(c)).length;
}

// Matches em dash, en dash, figure dash, horizontal bar. Hyphens between
// letters handled separately (allow in URLs and words like "US-only").
const DASH_CHARS = /[\u2012\u2013\u2014\u2015\u2212]/g;

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}\u{1F680}-\u{1F6FF}]/gu;

export type GuardrailInput = {
  candidate: string;
  linkSendCountBefore: number;
  isFirstMessage: boolean;
  /** Prior assistant messages in this conversation (for repeat detection). */
  priorAssistantMessages?: string[];
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

  // 2b. If the full canonical name appears more than once in this single
  //     outgoing message, keep the first occurrence and demote the rest to
  //     "Dr. Lee". A human would not text the full name twice in one SMS.
  {
    let seen = 0;
    text = text.replace(/Dr\.\s+Samuel\s+B\.\s+Lee\s+MD\b/g, () => {
      seen += 1;
      return seen === 1 ? CANONICAL_NAME : 'Dr. Lee';
    });
    if (seen > 1) violations.push('demoted_repeat_full_name');
  }

  // 3. Strip emoji unless this is the first message.
  if (!input.isFirstMessage) {
    const hadEmoji = EMOJI_REGEX.test(text);
    if (hadEmoji) {
      violations.push('stripped_emoji_after_opener');
      text = text.replace(EMOJI_REGEX, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  // 3b. Strip AI-summary labels. These are pure tells: a real texter never
  //     prefaces an answer with "Short version:" or "TL;DR,". Rewrite rather
  //     than reject so we keep the content without another Claude call.
  {
    const before = text;
    text = text.replace(
      /^(?:\s*)(short version|quick version|quick summary|tl;?dr|in short|to sum up|in summary|long story short|the short answer)\s*[:,\-]\s*/i,
      '',
    );
    // Also handle mid-message after a leading fragment + punctuation.
    //   "Nice. Short version: peptides are..." -> "Nice. peptides are..."
    // We only strip when it directly precedes substantive content, so keep
    // the pattern anchored to a sentence-start position after . ! ? or newline.
    text = text.replace(
      /([.!?\n]\s+)(short version|quick version|quick summary|tl;?dr|in short|to sum up|in summary|long story short|the short answer)\s*[:,\-]\s*/gi,
      '$1',
    );
    if (text !== before) {
      violations.push('stripped_ai_summary_label');
      // Recapitalize the first letter of the new start if we stripped a prefix.
      text = text.replace(/^([a-z])/, (c) => c.toUpperCase());
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

  // 4c. Reject a repeat of the goal-menu opener question. It should appear
  //     at most once per conversation. If any prior assistant message already
  //     asked it (any paraphrase) and the candidate asks it again, force a
  //     regenerate.
  if (input.priorAssistantMessages && input.priorAssistantMessages.length > 0) {
    if (matchesGoalMenuQuestion(text)) {
      const priorAsked = input.priorAssistantMessages.some(matchesGoalMenuQuestion);
      if (priorAsked) {
        return {
          ok: false,
          reason: 'repeated goal-menu question (already asked once earlier in thread)',
          violations: [...violations, 'repeated_goal_question'],
        };
      }
    }
  }

  // 4d. Reject compound questions. Mia asks at most one question per message.
  //     Two checks: (a) more than one "?" in the message; (b) more than one
  //     sub-clause that starts with a question stem.
  const qMarkCount = (text.match(/\?/g) ?? []).length;
  if (qMarkCount >= 2 || countQuestionClauses(text) >= 2) {
    return {
      ok: false,
      reason: 'compound question (more than one question in one message)',
      violations: [...violations, 'compound_question'],
    };
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
