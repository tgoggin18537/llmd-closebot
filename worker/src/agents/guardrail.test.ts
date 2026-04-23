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
  leadFirstName?: string;
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
    name: 'strips: repeats opener goal-menu after it was already asked',
    candidate:
      "Peptides are amino acid chains, basically signaling molecules. What are you hoping to work on?",
    priorAssistantMessages: [
      "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD. 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true, notContains: ['What are you hoping to work on'], violationsIncludes: ['stripped_repeated_goal_question'] },
  },
  {
    name: 'strips: repeats paraphrased goal-menu',
    candidate:
      "Makes sense. What are you looking to work on, energy or weight?",
    priorAssistantMessages: [
      "Hey! What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true, notContains: ['What are you looking to work on'], violationsIncludes: ['stripped_repeated_goal_question'] },
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
    name: 'strips: "hoping peptides might help with" after goal already asked',
    candidate: "Nice, that's a cool reason. Is there something specific you're hoping peptides might help with?",
    priorAssistantMessages: [
      "Hey! What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true, notContains: ["hoping peptides might help with"], violationsIncludes: ['stripped_repeated_goal_question'] },
  },
  {
    name: 'strips: "any specific goal" after goal already asked',
    candidate: "Got it. Any specific goal in mind?",
    priorAssistantMessages: [
      "What are you hoping to work on, weight loss, energy, sleep, recovery, something else?",
    ],
    expect: { ok: true, notContains: ['Any specific goal'], violationsIncludes: ['stripped_repeated_goal_question'] },
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
    name: 'trims: compound question joined by comma',
    candidate: "Nice, word of mouth is the best intro. What's drawing you in most, is there something specific you're hoping peptides might help with?",
    expect: { ok: true, notContains: ["is there something specific"], violationsIncludes: ['trimmed_compound_question'] },
  },
  {
    name: 'trims: two distinct questions to first one only',
    candidate: "What got you curious? Any specific goal in mind?",
    expect: { ok: true, contains: ["What got you curious?"], notContains: ["Any specific goal"], violationsIncludes: ['trimmed_compound_question'] },
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

  // ---- "OF COURSE" + FILLER-PREFIX SLIP-THROUGHS ----
  {
    name: 'bans: of course as opener',
    candidate: "Of course, peptides work by signaling.",
    expect: { ok: false, reasonIncludes: 'banned opener' },
  },
  {
    name: 'bans: Yeah of course (filler-prefixed slip-through)',
    candidate: "Yeah of course. We have protocols for weight loss, energy, sleep, and recovery.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: yeah absolutely (filler-prefixed slip-through)',
    candidate: "yeah absolutely, that's a common goal.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: Yep totally (filler-prefixed)',
    candidate: "Yep totally, peptides can help with that.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: Oh totally (filler-prefixed)',
    candidate: "Oh totally, that makes sense.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'allows: yeah that makes sense (not a banned combo)',
    candidate: "yeah that makes sense, peptides help with energy.",
    expect: { ok: true },
  },

  // ---- "STACK" / SALES JARGON ----
  {
    name: 'bans: build a stack',
    candidate: "The specialist can build a stack around both goals.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: build you a stack',
    candidate: "Cool, she can build you a stack for muscle and fat loss.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: stack around both goals',
    candidate: "We can put together a stack around both goals of yours.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: peptide stack for weight',
    candidate: "Here's a custom stack for weight loss patients.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: pair well together',
    candidate: "Nice, those actually pair well together.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: work really well together for',
    candidate: "They work really well together for body recomp.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: totally doable',
    candidate: "Both totally doable with peptides.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: actually ... actually (double LLM tic)',
    candidate: "Those actually pair with energy, and it's actually pretty simple to start.",
    // Caught by either the double-actually regex or the pair-well regex; either is fine.
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'allows: single actually',
    candidate: "That's actually a good point.",
    expect: { ok: true },
  },

  // ---- CATALOG DUMP ----
  {
    name: 'bans: catalog dump (3 peptides with function)',
    candidate:
      "BPC-157 for gut repair, NAD+ for cellular energy and cognition, GHK Cu for skin and tissue, these are the protocols Dr. Lee builds.",
    expect: { ok: false, reasonIncludes: 'catalog dump' },
  },
  {
    name: 'allows: 2 peptides mentioned (not a catalog)',
    candidate:
      "For weight loss we use semaglutide and tirzepatide, GLP-1s that work on the hormone signals controlling hunger.",
    expect: { ok: true },
  },
  {
    name: 'allows: single peptide deep dive',
    candidate:
      "NAD+ is the big one for energy at your age. It works at the mitochondrial level, which is why it hits when other things haven't.",
    expect: { ok: true },
  },

  // ---- FIRST NAME ADDRESSING ----
  {
    name: 'bans: addressing lead by first name at start',
    candidate: "Patricia, that's a lot to carry when you're clearly doing everything right.",
    leadFirstName: 'Patricia',
    expect: { ok: false, reasonIncludes: 'addressed lead by first name' },
  },
  {
    name: 'bans: addressing lead by name after a sentence',
    candidate: "That's rough. Patricia, peptides can help with that.",
    leadFirstName: 'Patricia',
    expect: { ok: false, reasonIncludes: 'addressed lead by first name' },
  },
  {
    name: 'allows: no name ban when firstName not provided',
    candidate: "Patricia, that's a lot to carry.",
    expect: { ok: true },
  },
  {
    name: 'allows: name-like word elsewhere in sentence (not address)',
    candidate: "Peptides can help patricia skin issues too.",
    leadFirstName: 'Patricia',
    // Lowercase + no comma = not an address. Allow.
    expect: { ok: true },
  },

  // ---- NICOLE-BOT OBSERVED TELLS ----
  {
    name: 'bans: Thank you for sharing (opener)',
    candidate: "Thank you for sharing all that.",
    expect: { ok: false, reasonIncludes: 'banned opener' },
  },
  {
    name: 'bans: Thank you for sharing (mid-message)',
    candidate: "Got it. Thank you for sharing all of that context.",
    expect: { ok: false, reasonIncludes: 'banned' },
  },
  {
    name: 'bans: Ready to take the next step',
    candidate: "Ready to take the next step with Epithalon?",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: fit your goals perfectly',
    candidate: "The specialist can map a protocol to fit your goals perfectly.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: map your stack',
    candidate: "She can map your stack to what you want.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: custom order created for you',
    candidate: "I will get a custom order created for you right away.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: get the order created',
    candidate: "Just let me know and I can get the order created.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: medications list (misinformation about discovery call)',
    candidate: "Helpful to have a list of medications you're taking for the call.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: "bans: bring medications list for prep",
    candidate: "Bring a list of your current medications so we can review.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: "bans: you're not alone (therapy-speak)",
    candidate: "That's rough, but you're not alone. Peptides can help.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: more common than you think',
    candidate: "Sciatica after GLP-1s is more common than you think.",
    expect: { ok: false, reasonIncludes: 'banned phrase' },
  },
  {
    name: 'bans: restore your own balance (wellness-claim carrier risk)',
    candidate: "Peptides help restore your own balance instead of forcing results.",
    expect: { ok: false, reasonIncludes: 'wellness-claim' },
  },
  {
    name: 'bans: rather than forcing it (wellness-claim)',
    candidate: "They work with your body rather than forcing it.",
    expect: { ok: false, reasonIncludes: 'wellness-claim' },
  },

  // ---- FIRST-MESSAGE EMOJI AUTO-REPAIR ----
  {
    name: 'repairs: missing emoji in CASE B first message',
    candidate:
      "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD. We do peptide therapy, so the protocols really depend on what you're trying to work on.",
    isFirstMessage: true,
    expect: {
      ok: true,
      contains: ['\u{1F642}', 'We do peptide therapy'],
      violationsIncludes: ['inserted_missing_opener_emoji'],
    },
  },
  {
    name: 'preserves: emoji already present in first message',
    candidate: "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD. \u{1F642} We do peptide therapy.",
    isFirstMessage: true,
    expect: { ok: true, contains: ['\u{1F642}'] },
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
    leadFirstName: c.leadFirstName,
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
