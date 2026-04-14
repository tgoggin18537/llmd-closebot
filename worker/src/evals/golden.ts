/**
 * Golden conversations. Every case here is a trap V1 fell into.
 * The eval harness runs the full pipeline (Claude + guardrail) against each
 * case and asserts the output contains / avoids specific signals.
 */

export type GoldenCase = {
  name: string;
  /** Prior conversation turns. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** The latest inbound to respond to. */
  inbound: string;
  /** State fields at time of reply. */
  state: {
    linkSendCount?: number;
    openerSent?: boolean;
    emailCaptured?: string;
    usConfirmed?: boolean;
    goal?: string;
  };
  /** The reply MUST contain at least one of these (case-insensitive). */
  mustContainAny?: string[];
  /** The reply MUST NOT contain any of these (case-insensitive). */
  mustNotContain?: string[];
  /** Freeform judge rubric for LLM-as-judge scoring (0-5). */
  rubric?: string;
};

export const GOLDEN: GoldenCase[] = [
  {
    name: 'sema_vs_tirz_direct_answer',
    history: [
      { role: 'assistant', content: "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: 'weight loss' },
      { role: 'assistant', content: "That's frustrating and usually not a willpower thing. Peptides like semaglutide and tirzepatide work on the actual hormone signals that control hunger and metabolism, which is why they help when diet alone hasn't moved the needle. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'whats the difference between sema and tirz',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['GIP', 'dual', 'tirzepatide targets both'],
    mustNotContain: ['we\'ll cover that on the call', 'the specialist will explain'],
    rubric: 'Answer must give one real specific (GIP vs GLP-1 only) before bridging to a call.',
  },
  {
    name: 'fda_approved_straight_answer',
    history: [],
    inbound: 'is this FDA approved?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['503A', '503B', 'compounding pharmac'],
    mustNotContain: ['cannot comment', 'we can\'t discuss'],
  },
  {
    name: 'budget_200_honesty',
    history: [],
    inbound: 'whats your cheapest option, my budget is $200',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['start around $300', 'typically start around $300'],
    mustNotContain: ['really flexible', 'very flexible', 'we can work with that'],
  },
  {
    name: 'shipping_timeline',
    history: [],
    inbound: 'how long does shipping take?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['5 to 10 business days', '5-10 business days'],
  },
  {
    name: 'want_dr_lee_directly',
    history: [],
    inbound: 'can i talk to Dr Lee directly?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['personally oversees', 'trained directly'],
    mustNotContain: ['limitlesslivingmd.com/discovery'], // don't push link on this turn
  },
  {
    name: 'telehealth_consultant_identity',
    history: [],
    inbound: 'who does the telehealth consultations?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['licensed practitioners', 'trained directly under'],
    mustNotContain: ['Danielle', 'Lauren', 'Emily', 'Christine'],
  },
  {
    name: 'no_dashes_anywhere',
    history: [],
    inbound: 'tell me about your long-term program',
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['—', '–', '\u2014', '\u2013'],
    rubric: 'Must contain zero em dashes, en dashes, or letter-hyphen-letter hyphens.',
  },
  {
    name: 'no_banned_opener',
    history: [],
    inbound: 'what are peptides?',
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['Great question', 'Absolutely', 'Thanks for reaching out'],
  },
  {
    name: 'link_budget_exhausted',
    history: [
      { role: 'assistant', content: 'Here is the link: limitlesslivingmd.com/discovery' },
      { role: 'user', content: 'ok maybe' },
      { role: 'assistant', content: 'No rush at all, here it is whenever: limitlesslivingmd.com/discovery' },
    ],
    inbound: 'idk maybe another time',
    state: { linkSendCount: 2, openerSent: true },
    mustNotContain: ['limitlesslivingmd.com/discovery'],
    rubric: 'Must not send the booking link a third time. Should drop into education or soft close.',
  },
  {
    name: 'existing_patient_bails_out',
    history: [],
    inbound: "I'm already a patient, just checking on my protocol",
    state: { linkSendCount: 0, openerSent: true },
    // The inbound webhook short-circuits before Claude for this case. Harness
    // handles this specially; here we at least assert the fallback text.
    mustContainAny: ['someone from the team jump in'],
    mustNotContain: ['limitlesslivingmd.com/discovery'],
  },
  {
    name: 'name_format_correct',
    history: [],
    inbound: 'who is the doctor behind this?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['Dr. Samuel B. Lee MD'],
    mustNotContain: ['Dr. Samuel Lee, M.D.', 'Dr. Lee, MD', 'Samuel Lee, MD'],
  },
  {
    name: 'no_staff_names',
    history: [],
    inbound: 'who will be reaching out to me?',
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['Danielle', 'Lauren', 'Emily', 'Christine'],
    mustContainAny: ['the specialist', 'our team', 'someone from the team'],
  },
  {
    name: 'one_emoji_budget',
    history: [
      { role: 'assistant', content: "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: 'energy' },
    ],
    inbound: 'tell me more!',
    state: { linkSendCount: 0, openerSent: true, goal: 'energy' },
    mustNotContain: ['🙂', '😊', '💪', '✨', '🙏', '🎉'],
    rubric: 'Zero emoji after the opener.',
  },
];
