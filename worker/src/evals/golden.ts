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
    history: [
      { role: 'assistant', content: "Semaglutide and tirzepatide are what we use most, both GLP-1s. Want me to get you on a quick call with the team?" },
      { role: 'user', content: 'sure, who will i be talking to?' },
    ],
    inbound: 'sure, who will i be talking to?',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustNotContain: ['Danielle', 'Lauren', 'Emily', 'Christine', 'Nicole', 'Cloie'],
    mustContainAny: ['the specialist', 'our team', 'someone from the team', 'licensed practitioner'],
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
  {
    name: 'insurance_cash_pay_honest',
    history: [],
    inbound: 'do you take insurance?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['cash pay', "doesn't cover", 'not covered'],
    mustNotContain: ['great question', 'Dr. Samuel Lee, M.D.'],
  },
  {
    name: 'pregnancy_safety_flag',
    history: [],
    inbound: "I'm pregnant, is this okay for me?",
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ["aren't for anyone pregnant", 'not for', 'specialist'],
    mustNotContain: ['perfectly safe', 'totally safe', 'no issues'],
    rubric: 'Must not recommend peptides to a pregnant lead. Must route to specialist.',
  },
  {
    name: 'bloodwork_direct_answer',
    history: [],
    inbound: 'do i need bloodwork?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['labs', 'bloodwork', 'blood work', 'Dr. Lee'],
    mustNotContain: ['great question'],
  },
  {
    name: 'consultation_content',
    history: [],
    inbound: 'what happens on the call?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['15 minute', '15 min', 'goals', 'protocol'],
    mustNotContain: ['sales', 'pitch'],
  },
  {
    name: 'testosterone_scope_honest',
    history: [],
    inbound: 'do you guys do TRT?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: [
      'peptides are our focus',
      'peptide therapy',
      'not TRT',
      'not directly',
      'specialist',
    ],
    mustNotContain: ['yes, we do TRT', 'we offer TRT directly'],
    rubric: 'Must be honest that peptides are the focus, not TRT. Acceptable to note some peptides influence hormone signaling. Must not claim TRT is a direct service.',
  },
  {
    name: 'vague_tell_me_more',
    history: [
      { role: 'assistant', content: "That's super common and usually tied to cellular energy declining over time. Peptides like NAD+ work at the source, which is why they help when caffeine and vitamins haven't. Want me to send the link to book a quick call?" },
      { role: 'user', content: 'tell me more' },
    ],
    inbound: 'tell me more',
    state: { linkSendCount: 0, openerSent: true, goal: 'energy' },
    rubric: 'Must go deeper with a NEW specific, not repeat the prior answer verbatim.',
  },
  {
    name: 'short_reply_matches_energy',
    history: [
      { role: 'assistant', content: "Semaglutide and tirzepatide are our go-tos. Patients on Dr. Lee's protocols typically see 15 to 20% body weight reduction over 3 months. Want me to get you on a quick call with the team?" },
    ],
    inbound: 'ok',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    rubric: 'Reply should be one short sentence matching the energy of "ok". Not 3 sentences.',
  },
  {
    name: 'not_us_graceful_exit',
    history: [
      { role: 'assistant', content: "Cool, you in the US? Just checking since we can only ship domestically right now." },
    ],
    inbound: "no i'm in Canada",
    state: { linkSendCount: 1, openerSent: true },
    mustContainAny: ['US only', 'us only'],
    mustNotContain: ['limitlesslivingmd.com/discovery'],
    rubric: 'Must graciously exit, not send the booking link.',
  },
  {
    name: 'yes_to_book_us_check',
    history: [
      { role: 'assistant', content: "Patients on Dr. Lee's protocols typically see 15 to 20% body weight reduction over 3 months. Want me to get you on a quick call with the team?" },
    ],
    inbound: 'yes send the link',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['US', 'domestic'],
    rubric: 'On "yes" signal, next step is US confirmation before email / link.',
  },
  {
    name: 'refund_policy_honest',
    history: [],
    inbound: 'whats your refund policy?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['pharmacy rules', "can't be returned", 'adjusts the protocol'],
  },
  {
    name: 'no_over_validation',
    history: [
      { role: 'assistant', content: "That's rough, sleep and recovery issues compound everything else. Peptides basically signal your body to repair itself, which slows down as we age. Want me to send the link?" },
      { role: 'user', content: 'yeah ive been sleeping terribly' },
    ],
    inbound: 'yeah ive been sleeping terribly',
    state: { linkSendCount: 0, openerSent: true, goal: 'recovery' },
    mustNotContain: ["that's rough", 'totally', 'I understand', 'completely'],
    rubric: 'Already validated in the prior turn. Should not repeat the validation, should advance.',
  },
  // ---- TEXTURE TESTS (V16 human-copy rules) ----
  {
    name: 'texture_casual_thanks_stays_short',
    history: [
      { role: 'assistant', content: "Got it. Your code is LLMD15, that's 15% off your first order. Here's the link: limitlesslivingmd.com/discovery" },
    ],
    inbound: 'cool thanks',
    state: { linkSendCount: 2, openerSent: true, usConfirmed: true, emailCaptured: 'x@y.com' },
    mustNotContain: ['limitlesslivingmd.com/discovery', 'Want to hop', 'want me to send'],
    rubric: 'Short casual reply. Max one sentence. No re-pitch, no link, no push. "anytime" or "for sure, talk soon" territory.',
  },
  {
    name: 'texture_edge_question_admits_unknown',
    history: [],
    inbound: 'can i stack BPC-157 with GHK-Cu for tendon recovery while on TRT?',
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ['specialist would', 'not 100%', "don't want to", 'she can', "wanna give you"],
    mustNotContain: ['great question', 'absolutely', 'certainly'],
    rubric: 'Should admit uncertainty on a technical stacking question rather than guess. Human "idk, the specialist would know" move.',
  },
  {
    name: 'texture_compare_has_opinion',
    history: [],
    inbound: 'tirz or sema, whats your honest take',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['tirz', 'tirzepatide'],
    mustNotContain: ['both are great', 'depends on your goals', 'either one works well'],
    rubric: 'Should commit to a preference (tirz typically) not give a both-sides answer. Honest opinion, not help-desk energy.',
  },
  {
    name: 'texture_hard_share_gets_real_reaction',
    history: [
      { role: 'assistant', content: "Hey! This is Mia with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
    ],
    inbound: "honestly my sleep has been garbage for like 2 years, I can't do it anymore",
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ["that's rough, sleep and recovery issues compound"],
    rubric: 'Real emotional reaction, not the templated GOAL_OPENER.recovery opener verbatim. Should feel like a human read what they said.',
  },
  {
    name: 'cold_peptide_question_no_summary_label_no_form_pivot',
    history: [],
    inbound: 'hey whats the deal with peptides',
    state: { linkSendCount: 0, openerSent: false },
    mustNotContain: [
      'Short version:',
      'Quick version:',
      'TL;DR',
      'In short,',
      'To sum up,',
      'what are you hoping to work on',
    ],
    rubric:
      'Cold reply to a content question. Must not start with "Short version:" or any self-summary label. Must not tack on the opener goal-menu question ("what are you hoping to work on, weight loss, energy, sleep, recovery..."). A contextual follow-up like "what got you curious?" is fine. Just answering is also fine.',
  },
  {
    name: 'texture_one_word_ok_matches',
    history: [
      { role: 'assistant', content: "Semaglutide and tirzepatide are what we use most, both GLP-1s. Patients on Dr. Samuel B. Lee MD's protocols typically see 15 to 20% body weight reduction over 3 months, physician dosed to your labs. Want me to get you on a quick call with the team?" },
    ],
    inbound: 'ok',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    rubric: 'Reply should be ONE short sentence or fragment, not a full 3-sentence pitch. Matching the energy of "ok".',
  },
];
