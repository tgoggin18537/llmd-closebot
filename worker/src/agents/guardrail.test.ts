/**
 * Deterministic guardrail tests. Zero Claude calls, runs in under a second.
 * Covers every class of failure the guardrail is supposed to catch or fix.
 *
 * Run:
 *   npx tsx worker/src/agents/guardrail.test.ts
 */

import { applyGuardrail } from './guardrail';

type Case = {
  name: string;
  candidate: string;
  isFirstMessage?: boolean;
  linkSendCountBefore?: number;
  priorAssistantMessages?: string[];
  expect:
    | { ok: true; contains?: string[]; notContains?: string[]; violationsIncludes?: string[] }
    | { ok: false; reasonIncludes: string };
};

const CASES: Case[] = [
  // ---- REACH OUT BAN (self-initiator) ----
  {
    name: 'bans: I wanted to reach out',
    candidate: "Hey! I wanted to reach out about your peptide goals.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: just wanted to reach out',
    candidate: "Just wanted to reach out and see how you were doing.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: I figured Id reach out',
    candidate: "I figured I'd reach out since you were checking us out.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: Im reaching out',
    candidate: "Hey, I'm reaching out from Dr. Lee's office.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: we reached out',
    candidate: "We reached out to check in on you.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: Ill reach out',
    candidate: "I'll reach out later with more info.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: I will reach out',
    candidate: "I will reach out once the specialist is free.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: thanks for reaching out',
    candidate: "Thanks for reaching out about peptides.",
    // Caught by either the banned-opener or banned-phrase rule; either is fine.
    expect: { ok: false, reasonIncludes: 'banned' },
  },
  {
    name: 'bans: just wanted to check in',
    candidate: "Just wanted to check in on you.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: just wanted to follow up',
    candidate: "Just wanted to follow up on your goals.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'ALLOWS: the specialist will reach out (not Mia-as-initiator)',
    candidate: "Cool, the specialist will reach out to you to schedule.",
    expect: { ok: true, notContains: [] },
  },
  {
    name: 'ALLOWS: someone from the team will reach out',
    candidate: "Someone from the team will reach out once your labs are back.",
    expect: { ok: true },
  },
  {
    name: 'ALLOWS: user asked who is reaching out — answer with specialist',
    candidate: "Our licensed practitioners handle the call. They reach out after you book.",
    expect: { ok: true },
  },

  // ---- GOAL QUESTION DRIFT ----
  {
    name: 'bans: whats on your radar',
    candidate: "Hey! What's on your radar today?",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: what brings you here',
    candidate: "Hey, what brings you here?",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },

  // ---- BANNED OPENERS ----
  {
    name: 'bans: great question',
    candidate: "Great question! Peptides are amino acid chains...",
    expect: { ok: false, reasonIncludes: 'banned opener' },
  },
  {
    name: 'bans: absolutely',
    candidate: "Absolutely! We can help with that.",
    expect: { ok: false, reasonIncludes: 'banned opener' },
  },

  // ---- STAFF NAMES ----
  {
    name: 'bans: names Lauren',
    candidate: "Lauren from our team can walk you through it.",
    expect: { ok: false, reasonIncludes: 'named staff' },
  },
  {
    name: 'bans: names Danielle',
    candidate: "Danielle will call you later.",
    expect: { ok: false, reasonIncludes: 'named staff' },
  },

  // ---- DASHES ----
  {
    name: 'strips: em dash replaced with comma',
    candidate: "Peptides work by signaling\u2014your cells amplify specific pathways.",
    expect: {
      ok: true,
      contains: [', your cells'],
      notContains: ['\u2014', ' - '],
    },
  },
  {
    name: 'strips: hyphen between words',
    candidate: "We do long-term physician-guided protocols.",
    expect: {
      ok: true,
      notContains: ['long-term', 'physician-guided'],
      contains: ['long term', 'physician guided'],
    },
  },

  // ---- EMOJI ----
  {
    name: 'strips: emoji after opener',
    candidate: "Peptides work great 💪 want to chat?",
    isFirstMessage: false,
    expect: { ok: true, notContains: ['💪'], violationsIncludes: ['stripped_emoji_after_opener'] },
  },
  {
    name: 'allows: emoji in first message',
    candidate: "Hey! This is Mia 🙂 We do peptide therapy.",
    isFirstMessage: true,
    expect: { ok: true, contains: ['🙂'] },
  },

  // ---- NAME NORMALIZATION + DEDUPE ----
  {
    name: 'normalizes: Dr. Samuel Lee MD -> canonical',
    candidate: "Dr. Samuel Lee MD runs every protocol.",
    expect: { ok: true, contains: ['Dr. Samuel B. Lee MD'] },
  },
  {
    name: 'normalizes: Dr. Samuel Lee, M.D. -> canonical',
    candidate: "Dr. Samuel Lee, M.D. is the doctor here.",
    expect: { ok: true, contains: ['Dr. Samuel B. Lee MD'], notContains: ['M.D.'] },
  },
  {
    name: 'dedupes: full name twice in one message -> first full, second "Dr. Lee"',
    candidate:
      "Dr. Samuel B. Lee MD personally oversees every protocol, and Dr. Samuel B. Lee MD reviews every plan.",
    expect: {
      ok: true,
      contains: ['Dr. Samuel B. Lee MD personally', 'Dr. Lee reviews'],
      violationsIncludes: ['demoted_repeat_full_name'],
    },
  },
  {
    name: 'preserves: full name once + "Dr. Lee" later stays as written',
    candidate: "Dr. Samuel B. Lee MD founded the clinic. Dr. Lee personally reviews labs.",
    expect: {
      ok: true,
      contains: ['Dr. Samuel B. Lee MD founded', 'Dr. Lee personally'],
    },
  },

  // ---- WELLNESS-CLAIM CARRIER RISK ----
  {
    name: 'bans: you deserve to feel',
    candidate: "You deserve to feel energized and balanced again.",
    expect: { ok: false, reasonIncludes: 'wellness-claim' },
  },
  {
    name: 'bans: reclaim your vitality',
    candidate: "Peptides help you reclaim your vitality.",
    expect: { ok: false, reasonIncludes: 'wellness-claim' },
  },

  // ---- AI-SUMMARY LABEL STRIP ----
  {
    name: 'strips: Short version: at start',
    candidate: "Short version: peptides are signaling molecules. Pretty cool stuff.",
    expect: {
      ok: true,
      notContains: ['Short version:'],
      contains: ['Peptides are signaling molecules'],
      violationsIncludes: ['stripped_ai_summary_label'],
    },
  },
  {
    name: 'strips: TL;DR at start',
    candidate: "TL;DR: tirz is the stronger one.",
    expect: {
      ok: true,
      notContains: ['TL;DR', 'tl;dr'],
      contains: ['Tirz is the stronger one'],
      violationsIncludes: ['stripped_ai_summary_label'],
    },
  },
  {
    name: 'strips: In short, mid-message',
    candidate: "Good question. In short, it's physician dosed.",
    expect: {
      ok: true,
      notContains: ['In short,'],
      contains: ["Good question.", "physician dosed"],
      violationsIncludes: ['stripped_ai_summary_label'],
    },
  },
  {
    name: 'strips: Short version, mid-message after period',
    candidate: "Nice. Short version: peptides are amino acid chains.",
    expect: {
      ok: true,
      notContains: ['Short version:'],
      contains: ['Nice.', 'peptides are amino acid chains'],
      violationsIncludes: ['stripped_ai_summary_label'],
    },
  },
  {
    name: 'allows: "short" as a regular word (not as a summary label)',
    candidate: "These are short peptide chains your body already makes.",
    expect: {
      ok: true,
      contains: ['short peptide chains'],
    },
  },

  // ---- REPEATED GOAL-MENU QUESTION ----
  {
    name: 'bans: repeats opener goal-menu after it was already asked',
    candidate:
      "Peptides are amino acid chains, basically signaling molecules. What are you hoping to work on?",
    priorAssistantMessages: [
      "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD. 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: false, reasonIncludes: 'repeated goal-menu' },
  },
  {
    name: 'bans: repeats paraphrased goal-menu',
    candidate:
      "Makes sense. What are you looking to work on, energy or weight?",
    priorAssistantMessages: [
      "Hey! What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: false, reasonIncludes: 'repeated goal-menu' },
  },
  {
    name: 'allows: goal-menu once (no prior history)',
    candidate: "Nice. What are you hoping to work on, weight loss or energy?",
    priorAssistantMessages: [],
    expect: { ok: true, contains: ['What are you hoping to work on'] },
  },
  {
    name: 'allows: contextual follow-up after prior goal-menu ask',
    candidate: "Makes sense. What got you curious about peptides in the first place?",
    priorAssistantMessages: [
      "Hey! What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true, contains: ['What got you curious'] },
  },

  // ---- BROADER GOAL-MENU PARAPHRASES ----
  {
    name: 'bans: "hoping peptides might help with" after goal already asked',
    candidate: "Nice, that's a cool reason. Is there something specific you're hoping peptides might help with?",
    priorAssistantMessages: [
      "Hey! What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: false, reasonIncludes: 'repeated goal-menu' },
  },
  {
    name: 'bans: "any specific goal" after goal already asked',
    candidate: "Got it. Any specific goal in mind?",
    priorAssistantMessages: [
      "What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: false, reasonIncludes: 'repeated goal-menu' },
  },
  {
    name: 'allows: "what got you curious" after goal already asked (contextual)',
    candidate: "Nice. What got you curious about peptides?",
    priorAssistantMessages: [
      "What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true },
  },

  // ---- COMPOUND QUESTIONS ----
  {
    name: 'bans: compound question joined by comma',
    candidate: "Nice, word of mouth is the best intro. What's drawing you in most, is there something specific you're hoping peptides might help with?",
    expect: { ok: false, reasonIncludes: 'compound question' },
  },
  {
    name: 'bans: two distinct questions',
    candidate: "What got you curious? Any specific goal in mind?",
    expect: { ok: false, reasonIncludes: 'compound question' },
  },
  {
    name: 'allows: single question with preamble',
    candidate: "Yeah that's super common. What got you curious about peptides?",
    expect: { ok: true },
  },
  {
    name: 'allows: statement + one question',
    candidate: "Peptides work by signaling your cells. Want me to send the link?",
    expect: { ok: true },
  },
  {
    name: 'allows: two statements no questions',
    candidate: "Yeah, that's usually a sourcing thing. Ours come from US compounding pharmacies.",
    expect: { ok: true },
  },

  // ---- LINK BUDGET ----
  {
    name: 'bans: link when budget exhausted',
    candidate: "Here's the link: limitlesslivingmd.com/discovery",
    linkSendCountBefore: 2,
    expect: { ok: false, reasonIncludes: 'link budget' },
  },
  {
    name: 'allows: link when budget remaining',
    candidate: "Here's the link: limitlesslivingmd.com/discovery",
    linkSendCountBefore: 1,
    expect: { ok: true, contains: ['limitlesslivingmd.com/discovery'] },
  },

  // ---- LENGTH CAP ----
  {
    name: 'allows: 3 sentence message under cap',
    candidate:
      "That's super common and tied to cellular energy declining over time. Peptides like NAD+ work at the source. Want me to send the link?",
    expect: { ok: true },
  },
  {
    name: 'trims: 5-sentence message preserving bridge',
    candidate:
      "Validation sentence here. Middle one with a specific number like 15 to 20%. Middle two more detail about mechanism. Middle three about Dr. Lee. Want me to send the link so you can chat with the specialist about your situation in detail?",
    expect: { ok: true, contains: ['Validation', 'Want me to send the link'] },
  },
];

function check(label: string, c: Case): { passed: boolean; detail: string } {
  const res = applyGuardrail({
    candidate: c.candidate,
    linkSendCountBefore: c.linkSendCountBefore ?? 0,
    isFirstMessage: c.isFirstMessage ?? false,
    priorAssistantMessages: c.priorAssistantMessages,
  });

  if (c.expect.ok) {
    if (!res.ok) {
      return { passed: false, detail: `expected ok, got reject: ${res.reason}` };
    }
    const clean = res.clean;
    for (const s of c.expect.contains ?? []) {
      if (!clean.includes(s)) return { passed: false, detail: `clean missing "${s}". clean="${clean}"` };
    }
    for (const s of c.expect.notContains ?? []) {
      if (clean.includes(s)) return { passed: false, detail: `clean contained "${s}". clean="${clean}"` };
    }
    for (const v of c.expect.violationsIncludes ?? []) {
      if (!res.violations.includes(v)) {
        return { passed: false, detail: `violations missing "${v}". got=${JSON.stringify(res.violations)}` };
      }
    }
    return { passed: true, detail: '' };
  } else {
    if (res.ok) return { passed: false, detail: `expected reject, got ok. clean="${res.clean}"` };
    if (!res.reason.toLowerCase().includes(c.expect.reasonIncludes.toLowerCase())) {
      return { passed: false, detail: `reason missing "${c.expect.reasonIncludes}". got="${res.reason}"` };
    }
    return { passed: true, detail: '' };
  }
}

function main() {
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    const r = check(c.name, c);
    if (r.passed) {
      passed += 1;
      console.log(`PASS  ${c.name}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${c.name}`);
      console.log(`      ${r.detail}`);
    }
  }
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main();
