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
  /^\s*that's wonderful/i,
  /^\s*of course[!,.\s]/i,
  /^\s*thank you for sharing/i,
  /^\s*thanks for sharing/i,
  /^\s*oof\b/i,
  /^\s*quick q\b/i,
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
  // Bare "wanted to reach out" without I/we (implied self-initiator in SMS)
  /\bwant(?:ed)?\s+to\s+reach\s+out\b/i,
  // Over-the-top bot validation
  /\byour (?:hope|determination|courage|strength|journey)\b.*\b(?:inspiring|amazing|wonderful|beautiful)\b/i,
  /\bi'?m here for you\b/i,
  /\bquick q\b/i,
  /\boof\b/i,
  // Filler-prefix sneak-throughs past the ^-anchored banned opener check.
  // "Yeah absolutely" / "yep totally" / "oh of course" are still bot tells.
  /\b(?:yeah|yea|yep|yup|oh|ohh+|well|ok|okay)[\s,]+(?:absolutely|totally|of\s+course|certainly|definitely)\b/i,
  // Sales-jargon tells. "Build a stack", "build you a stack", "peptide stack",
  // "a stack for you". The word "stack" is gym-bro lingo and alien to our
  // 40-59yo core market; the FAQ never uses it.
  /\b(?:build|building|built)\s+(?:you\s+)?a\s+stack\b/i,
  /\b(?:a|your|the|peptide|custom)\s+stack\s+(?:for|around|of|that|to)\b/i,
  /\bstack\s+around\s+(?:your|both)\s+goals?\b/i,
  // Brochure-pair speak.
  /\bpair\s+(?:really\s+)?well\s+together\b/i,
  /\bwork\s+(?:really\s+)?well\s+together\s+for\b/i,
  // Over-confident sales handwave.
  /\btotally\s+doable\b/i,
  /\bboth\s+totally\s+doable\b/i,
  // "that's actually" LLM tic (more than once in a message is a tell).
  // Single use is allowed; the pattern below catches the "that's actually"
  // + "that's actually" repetition or "X is actually Y, and Z is actually W".
  /\bactually\s+[a-z]+\b.*\bactually\s+[a-z]+\b/i,
  // Observed live tells from the team's old GHL bot. Each of these was
  // flagged as wrong by Lauren/Nicole/Danielle and is OFF-BRAND.
  /\bthank(?:s)?\s+(?:you\s+)?for\s+sharing\b/i,
  /\bready\s+to\s+take\s+the\s+next\s+step\b/i,
  /\bfit\s+your\s+goals?\s+perfectly\b/i,
  /\bmap\s+(?:out\s+)?your\s+stack\b/i,
  // Mia is a SETTER, never a CLOSER. She never writes orders, never
  // commits to invoice creation, never handles fulfillment logistics.
  /\bcustom\s+order\s+(?:created|for\s+you)\b/i,
  /\bcreate(?:d)?\s+(?:a|the|your)\s+(?:custom\s+)?order\b/i,
  /\bget\s+(?:a|the|your)\s+(?:custom\s+)?order\s+(?:created|ready|going)\b/i,
  // Mia doesn't brief leads on medications to bring to the discovery
  // call. Nicole explicitly said she doesn't cover meds there. Telling
  // a lead to prepare a meds list is MISINFORMATION.
  /\b(?:list\s+of\s+|any\s+)?(?:your\s+)?medications?\s+(?:or\s+supplements?\s+)?(?:you'?re\s+|you\s+are\s+)?taking\b/i,
  /\b(?:bring|prepare|prep|have\s+ready)\s+(?:a\s+)?list\s+of\s+(?:your\s+)?(?:current\s+)?medications?\b/i,
  // Therapy-speak validators common in LLM wellness drafts.
  /\byou'?re\s+not\s+alone\b/i,
  /\bmore\s+common\s+than\s+you\s+(?:think|'d\s+think|might\s+think)\b/i,
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
  // Observed live in Nicole's bot: "help your body restore its own balance
  // rather than forcing it". Classic wellness marketing phrasing that trips
  // carrier filters and has no clinical basis to stand on.
  /\brestore\s+(?:your|its|the)\s+(?:own\s+)?(?:natural\s+)?balance\b/i,
  /\brather\s+than\s+forcing\s+it\b/i,
  /\brestore\s+(?:your|its)\s+(?:natural\s+)?harmony\b/i,
];

// Catalog dump: "PeptideA for X, PeptideB for Y, PeptideC for Z" is a brochure,
// not a text. Real texters pick one thing and go deeper. Three or more
// "PeptideName for short-phrase" items separated by commas triggers reject.
//
// Peptide-name shape is deliberately narrow to avoid false-positives on
// generic phrases like "some for fat loss, some for recovery, some for
// energy" (acceptable in openers). A peptide name here must either:
//   - have 2+ consecutive uppercase letters (BPC, NAD, GHK, GLP, TB, CJC), or
//   - be a Name-Number hyphenated form (BPC-157, TB-500, CJC-1295), or
//   - end in a peptide-family suffix (-glutide, -relin, -tide, -orelin).
const PEPTIDE_NAME_SRC = String.raw`(?:[A-Z]{2,}[A-Za-z0-9+]*(?:[-\s][A-Za-z0-9]+)?|[A-Z][A-Za-z]*[-][0-9]+|[a-z]+(?:glutide|orelin|relin|tide))`;
const CATALOG_DUMP_PATTERN = new RegExp(
  String.raw`\b${PEPTIDE_NAME_SRC}\s+for\s+[a-z][a-z \-]{1,30}?,\s+${PEPTIDE_NAME_SRC}\s+for\s+[a-z][a-z \-]{1,30}?,\s+${PEPTIDE_NAME_SRC}\s+for\b`,
);

// The canonical opener emoji. Inserted after "Limitless Living MD." on first
// message if Claude dropped it from the CASE A / CASE B templates.
const OPENER_EMOJI = '\u{1F642}';

const NAME_VARIANTS = [
  /Dr\.?\s+Samuel\s+B\.?\s+Lee,?\s*M\.?D\b/gi,
  /Dr\.?\s+Samuel\s+Lee,?\s*M\.?D\b/gi,
  /Dr\.?\s+Lee,?\s*M\.?D\b/gi,
  // Catch "Dr. Samuel Lee" without MD suffix (e.g. "Dr. Samuel Lee's clinic")
  /Dr\.?\s+Samuel\s+Lee\b(?![\s,]*M)/gi,
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
  /\bwhat (?:are you|'re you|you)\s+(?:hoping|looking|trying|wanting)\s+to\s+(?:work\s+on|focus\s+on|improve|tackle|address|shift|change)\b/i,
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
  /**
   * Lead's first name, if known from the GHL contact. When present, the
   * guardrail rejects any draft that uses the name directly, because real
   * texters almost never address the recipient by name in SMS. "Patricia,
   * that's a lot" reads like a sales script or therapist, not a friend.
   */
  leadFirstName?: string;
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
  // Note: `.test()` on a /g regex is stateful (maintains lastIndex). Reset
  // before each test so the module-level EMOJI_REGEX doesn't drag state
  // across requests in a long-lived Worker process.
  EMOJI_REGEX.lastIndex = 0;
  const hadEmoji = EMOJI_REGEX.test(text);
  if (!input.isFirstMessage) {
    if (hadEmoji) {
      violations.push('stripped_emoji_after_opener');
      text = text.replace(EMOJI_REGEX, '').replace(/\s{2,}/g, ' ').trim();
    }
  } else if (!hadEmoji) {
    // First message must contain exactly one emoji per the opener template.
    // If Claude dropped it from CASE A / CASE B ("Hey! This is Mia with
    // Dr. Samuel B. Lee MD's office at Limitless Living MD. 🙂 ..."),
    // auto-insert it after the brand sentence instead of rejecting.
    const brandBoundary = /(Limitless\s+Living\s+MD\.)\s+/;
    if (brandBoundary.test(text)) {
      text = text.replace(brandBoundary, `$1 ${OPENER_EMOJI} `);
      violations.push('inserted_missing_opener_emoji');
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

  // 4b-i. Reject catalog dump. Listing 3+ peptides with functions separated
  //       by commas reads like a brochure. Regenerate with one specific.
  if (CATALOG_DUMP_PATTERN.test(text)) {
    return {
      ok: false,
      reason: 'catalog dump detected (3+ "X for Y" items in a row). pick ONE specific and go deeper',
      violations: [...violations, 'catalog_dump'],
    };
  }

  // 4b-ii. Reject first-name addressing. Real texters do not open messages
  //        with "Patricia, that's...". If the GHL contact's firstName is
  //        known, reject any draft where the name appears at the start of
  //        a sentence followed by a comma (the addressing pattern).
  if (input.leadFirstName && input.leadFirstName.trim().length >= 2) {
    const esc = input.leadFirstName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const addressRx = new RegExp(`(?:^|[.!?]\\s+)${esc}\\s*,`, 'i');
    if (addressRx.test(text)) {
      return {
        ok: false,
        reason: `addressed lead by first name ("${input.leadFirstName}"). real texts don't do this`,
        violations: [...violations, 'addressed_by_name'],
      };
    }
  }

  // 4c. Repeated goal-menu question: auto-repair by stripping the question
  //     sentence rather than rejecting. Previous reject behavior caused
  //     guardrail exhaustion when Claude kept generating the pattern.
  if (input.priorAssistantMessages && input.priorAssistantMessages.length > 0) {
    if (matchesGoalMenuQuestion(text)) {
      const priorAsked = input.priorAssistantMessages.some(matchesGoalMenuQuestion);
      if (priorAsked) {
        violations.push('stripped_repeated_goal_question');
        // Remove the sentence containing the goal-menu question.
        const sentences = text.split(/(?<=[.!?])\s+/);
        const filtered = sentences.filter((s) => !matchesGoalMenuQuestion(s));
        text = filtered.join(' ').trim() || text;
      }
    }
  }

  // 4d. Compound questions: auto-repair by keeping only up to the first "?".
  //     Previous behavior (reject + regenerate) caused guardrail exhaustion
  //     on common inbounds. Now we surgically remove the second question
  //     and ship what's left.
  {
    const qMarkCount = (text.match(/\?/g) ?? []).length;
    if (qMarkCount >= 2 || countQuestionClauses(text) >= 2) {
      violations.push('trimmed_compound_question');
      if (qMarkCount >= 2) {
        // Two "?" marks: cut everything after the first "?"
        const firstQ = text.indexOf('?');
        if (firstQ >= 0 && firstQ < text.length - 1) {
          text = text.slice(0, firstQ + 1).trim();
        }
      } else {
        // Comma-joined compound with one "?": split into clauses, drop
        // everything from the second question-starter clause onward.
        const clauses = text.split(/([.!?,]\s+)/);
        let questionsSeen = 0;
        let cutIndex = -1;
        let pos = 0;
        for (let i = 0; i < clauses.length; i++) {
          if (QUESTION_STARTER.test(clauses[i].trim())) {
            questionsSeen++;
            if (questionsSeen === 2) { cutIndex = pos; break; }
          }
          pos += clauses[i].length;
        }
        if (cutIndex > 0) {
          // Back up over the separator (comma/period + space) before the cut
          text = text.slice(0, cutIndex).replace(/[,\s]+$/, '').trim();
          // Add a "?" if the remaining text doesn't end with punctuation
          if (!/[.!?]$/.test(text)) text += '?';
        }
      }
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
