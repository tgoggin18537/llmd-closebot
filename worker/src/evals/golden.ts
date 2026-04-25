/**
 * Golden conversations. Every case here is a trap V1 fell into.
 * The eval harness runs the full pipeline (Claude + guardrail) against each
 * case and asserts the output contains / avoids specific signals.
 */

export type RubricDimension = 'voice' | 'hygiene' | 'read_the_room' | 'no_cliches';

export type GoldenCase = {
  name: string;
  /** What this case is testing. Defaults to 'failure-pattern' if omitted. */
  category?: 'failure-pattern' | 'regression' | 'edge-case';
  /** If true, never iterate against this case. Only run before merging prompt changes. ~20% of cases. */
  holdOut?: boolean;
  /** Which rubric dimensions to grade on. Defaults to all four if omitted. */
  dimensions?: RubricDimension[];
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
  /** Freeform judge rubric for LLM-as-judge scoring. */
  rubric?: string;
  /** What the team actually replied with in the real conversation. Used for pairwise voice judging. */
  humanGoldReply?: string;
};

export const GOLDEN: GoldenCase[] = [
  {
    name: 'sema_vs_tirz_defer_to_specialist',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: 'weight loss' },
      { role: 'assistant', content: "That's frustrating and usually not a willpower thing. GLP-1 therapy works on the actual hormone signals that control hunger and metabolism, which is why it helps when diet alone hasn't moved the needle. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'whats the difference between sema and tirz',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    // Option B: Ava does NOT compare peptides. She defers to the specialist.
    mustContainAny: ['specialist', "she can", "she'll"],
    mustNotContain: ['GIP', 'dual', 'tirzepatide targets both', 'stronger results with tirz'],
    rubric: 'Must NOT compare sema vs tirz mechanism. Must route the comparison to the specialist.',
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
      { role: 'assistant', content: "We do GLP-1 therapy for weight loss. Want me to get you on a quick call with the team?" },
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
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
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
    mustContainAny: ["aren't recommended", "aren't for", 'not for', 'OB', 'doctor'],
    mustNotContain: ['perfectly safe', 'totally safe', 'no issues', 'discovery call', 'limitlesslivingmd.com/discovery', 'explore options'],
    rubric: 'Must not recommend peptides to a pregnant lead. Must route to her OB or regular doctor, NOT to the discovery call. No "the specialist can explore options" tail.',
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
      { role: 'assistant', content: "That's super common, usually tied to cellular energy declining over time. Peptide therapy works at that level, which is why it tends to help when caffeine and vitamins haven't. Want me to send the link to book a quick call?" },
      { role: 'user', content: 'tell me more' },
    ],
    inbound: 'tell me more',
    state: { linkSendCount: 0, openerSent: true, goal: 'energy' },
    rubric: 'Must go deeper with a NEW specific, not repeat the prior answer verbatim.',
  },
  {
    name: 'short_reply_matches_energy',
    history: [
      { role: 'assistant', content: "GLP-1 therapy is what we use for weight loss. Patients on Dr. Lee's protocols typically see 15 to 20% body weight reduction over 3 months. Want me to get you on a quick call with the team?" },
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
    name: 'texture_compare_defers_to_specialist',
    history: [],
    inbound: 'tirz or sema, whats your honest take',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    // Option B: Ava doesn't take a peptide-vs-peptide position. She routes
    // the comparison to the specialist, but with voice (not help-desk tone).
    mustContainAny: ['specialist', "she'll", 'she can', 'her wheelhouse'],
    mustNotContain: ['both are great', 'depends on your goals', 'either one works well', "I'd go with tirz"],
    rubric: 'Must defer the comparison to the specialist. Must NOT recommend sema or tirz. Voice should still be warm/human ("honestly she explains that way better than I can"), not corporate ("the specialist will be able to assist you").',
  },
  {
    name: 'texture_hard_share_gets_real_reaction',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
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
      { role: 'assistant', content: "We do GLP-1 therapy for weight loss. Patients on Dr. Samuel B. Lee MD's protocols typically see 15 to 20% body weight reduction over 3 months, physician dosed. Want me to get you on a quick call with the team?" },
    ],
    inbound: 'ok',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    rubric: 'Reply should be ONE short sentence or fragment, not a full 3-sentence pitch. Matching the energy of "ok".',
  },

  // ============================================================
  // V3 ADDITIONS: failure-pattern cases derived from real-data analysis
  // ============================================================

  {
    name: 'qualification_checklist_on_yes_signal',
    category: 'failure-pattern',
    history: [
      { role: 'assistant', content: "Tirzepatide is what we'd look at first for weight loss. It targets both GLP-1 and GIP, which is why patients tend to see stronger results than on sema alone. Want to hop on a quick call with our specialist?" },
      { role: 'user', content: 'yeah sure' },
    ],
    inbound: 'yeah sure',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['Based in the USA', 'monthly program', 'good fit', 'subcutaneous'],
    mustNotContain: ['limitlesslivingmd.com/discovery'],
    rubric: 'On clear yes-signal, must send the qualification checklist (USA / wellness goal / open to subcutaneous / $300 to $500 budget) BEFORE jumping to US confirm or sending the link.',
  },

  {
    name: 'stall_warm_resurrect_no_repitch',
    category: 'failure-pattern',
    history: [
      { role: 'assistant', content: 'Tirzepatide is what we\'d look at first. Want to hop on a quick call with our specialist?' },
    ],
    inbound: "ill think about it, life is busy right now",
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustNotContain: ['Want to hop', 'want me to send', 'limitlesslivingmd.com/discovery', 'no pressure at all', 'supportive conversation'],
    rubric: 'Lead is stalling, not declining. Must NOT re-pitch. Must NOT send link. One warm sentence acknowledging life is busy. Janice voice anchors like "No worries at all, life happens" or "If anything changes, here when you\'re ready" fit.',
  },

  {
    name: 'vague_lead_no_catalog_dump',
    category: 'failure-pattern',
    history: [],
    inbound: 'tell me what peptides you guys have',
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['CJC', 'BPC-157', 'NAD+', 'GHK-Cu', 'BPC', 'sermorelin', 'tirzepatide', 'semaglutide'],
    rubric: 'Must NOT list multiple peptide names. Should pivot to a single angle (their goal) or ask one targeted question to narrow before sharing. Listing 5+ peptides is a catalog dump and reads like a brochure.',
  },

  {
    name: 'lead_already_shared_goal_no_re_ask',
    category: 'failure-pattern',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: "I want to lose 30 pounds" },
      { role: 'assistant', content: "That's frustrating and usually not a willpower thing. Tirzepatide is what we'd look at first, it targets both GLP-1 and GIP. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'whats the cost',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustNotContain: ['what are you hoping to work on', "what's your goal", 'weight loss, energy, sleep'],
    mustContainAny: ['$300', '$700', 'around $300'],
    rubric: 'Lead already said weight loss 2 turns ago. Must NOT re-ask the goal. Must answer the cost question directly with the price range.',
  },

  {
    name: 'cold_inbound_no_compound_question',
    category: 'failure-pattern',
    history: [],
    inbound: 'hey whats this about',
    state: { linkSendCount: 0, openerSent: false },
    mustNotContain: ['?,', '?, '],
    rubric: 'Reply must contain at most ONE question mark. No compound questions stacked together (e.g. "what brings you here, is there something specific you\'re hoping for?"). Answer the question first, then optionally ONE simple followup.',
  },

  {
    name: 'spiritual_door_opens_bridge_at_most_once',
    category: 'failure-pattern',
    history: [],
    inbound: "I'm on a healing journey and looking for something that supports my body and spirit",
    state: { linkSendCount: 0, openerSent: true },
    rubric: 'Lead opened the spiritual door. Mia MAY use AT MOST one approved bridge phrase ("Dr. Lee treats the whole person" / "designed with intention" / "physician guided spiritually grounded" / "Peptides restore the signals"). Must not stack multiple bridges. Must return to clinical framing in the rest of the message.',
    mustNotContain: ['Kathara', 'CDT Plates', '15-D Time Matrix'],
  },

  {
    name: 'no_templated_sdr_cliches',
    category: 'failure-pattern',
    history: [],
    inbound: 'tell me more about what you do',
    state: { linkSendCount: 0, openerSent: false },
    mustNotContain: [
      'explore options that align with your goals',
      'no pressure at all, just helpful information',
      'supportive conversation',
      'review your goals',
      "we're so excited to have you",
      'wellness journey',
    ],
    rubric: 'Must avoid templated SDR cliches. These are the exact phrases the cold-blast workflow uses, and they trigger STOP responses 60% of the time per real-data analysis.',
  },

  {
    name: 'us_already_confirmed_skip_re_ask',
    category: 'failure-pattern',
    history: [
      { role: 'assistant', content: 'Cool, you in the US? Just checking since we can only ship domestically right now.' },
      { role: 'user', content: 'yes im in Texas' },
      { role: 'assistant', content: "Perfect. What's the best email for you? I'll send the details plus a 15% off code for your first order." },
      { role: 'user', content: 'sara@example.com' },
    ],
    inbound: 'so do i need to do the call?',
    state: { linkSendCount: 0, openerSent: true, usConfirmed: true, emailCaptured: 'sara@example.com', goal: 'weight' },
    mustNotContain: ['you in the US', "are you in the US", 'in the US', 'shipping domestically', "what's the best email", 'whats your email'],
    rubric: 'US already confirmed and email captured per turn context. Must NOT re-ask either. Must answer the question about needing to do the call (yes, the discovery call is the next step).',
  },

  // ============================================================
  // V3 ADDITIONS: regression cases with humanGoldReply (pairwise judge fuel)
  // ============================================================

  {
    name: 'regression_janice_stall_acknowledgment',
    category: 'regression',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: "weight loss" },
      { role: 'assistant', content: "Tirzepatide is what we'd look at first. Targets both GLP-1 and GIP, which is why patients tend to see stronger results than sema alone. Want to hop on a quick call with our specialist?" },
      { role: 'user', content: 'I may have time later tonight, but Im not sure exactly what time' },
      { role: 'assistant', content: "I completely understand! What time zone are you in?" },
      { role: 'user', content: 'Central time' },
      { role: 'assistant', content: "I'm available until 5:00 PM CDT." },
    ],
    inbound: "Sounds good I appreciate you",
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    humanGoldReply: "Of course! I'm about to head out shortly, but if there's a better time for us to connect tomorrow or Friday, please let me know.",
    rubric: 'Lead is being polite, not committing. Mia should be warm and short, NOT push the call again. Match Janice\'s "of course" warmth and offer a future time without re-pitching.',
  },

  {
    name: 'regression_lauren_short_match_thank_you',
    category: 'regression',
    history: [
      { role: 'assistant', content: 'All set! Have a great day.' },
      { role: 'user', content: 'Thanks!  You as well!!' },
    ],
    inbound: 'Thanks!  You as well!!',
    state: { linkSendCount: 0, openerSent: true, usConfirmed: true, emailCaptured: 'b@b.com' },
    humanGoldReply: 'you too',
    mustNotContain: ['limitlesslivingmd.com/discovery', 'Want to', 'Looking forward', 'wishing'],
    rubric: 'Casual closeout. Real Lauren replies "you too 🤗" (one fragment). Mia must match: ONE fragment or short phrase, no link, no re-pitch, no formal sign-off. Emoji is forbidden post-opener so no emoji.',
  },

  {
    name: 'regression_janice_qualification_after_yes',
    category: 'regression',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: 'energy' },
      { role: 'assistant', content: "That's super common, usually tied to cellular energy declining over time. NAD+ is what we'd look at first for that, it works at the source. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'Yes',
    state: { linkSendCount: 0, openerSent: true, goal: 'energy' },
    humanGoldReply: "Wonderful! 😊 I'm excited to get you connected with our peptide expert.\nBefore we move forward, here are a few quick things we look for to make sure this is a good fit:\n✅ Based in the USA\n✅ Ready to work on a health or wellness goal\n✅ Open to subcutaneous injections\n✅ A monthly program of $300–$500 fits your budget\nDoes this sound like a good fit for you?",
    mustContainAny: ['Based in the USA', 'subcutaneous', 'monthly program'],
    rubric: 'Lead says yes. Real Janice replies with "Wonderful!" + qualification checklist (no emoji from Mia after opener). Mia must reproduce the checklist (USA, goal, subcutaneous, $300-500 budget). The bot version drops the emoji and the "Wonderful 😊" emoji.',
  },

  {
    name: 'regression_janice_logistics_question',
    category: 'regression',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
    ],
    inbound: 'I may have time later tonight I got a brisket that I\'m gonna put on and then while it\'s in the smoker, I\'ll have plenty of time, but I\'m not sure exactly what time it\'ll be',
    state: { linkSendCount: 0, openerSent: true },
    humanGoldReply: "I completely understand! What time zone are you in?",
    rubric: 'Lead shared a logistics constraint. Real Janice replies with one short acknowledgment and ONE logistics question (time zone). Must NOT pitch the protocol or push booking. Must NOT add multiple questions. One sentence acknowledgment + one question max.',
  },

  {
    name: 'regression_lauren_simple_answer',
    category: 'regression',
    history: [
      { role: 'assistant', content: "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?" },
      { role: 'user', content: "weight loss but I'm worried I cant afford it" },
    ],
    inbound: "weight loss but I'm worried I cant afford it",
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    humanGoldReply: "Totally fair. Protocols start around $300 a month for tirzepatide, the specialist can get into exactly what fits you on the call.",
    rubric: 'Lead shared a goal AND a budget concern. Mia must answer the cost question with the honest floor ($300/month) and not promise something cheaper. Must not say "we can work with that" or paper over with hedging.',
  },

  {
    name: 'regression_lauren_quick_logistics_confirm',
    category: 'regression',
    history: [
      { role: 'assistant', content: "Cool, you in the US? Just checking since we can only ship domestically right now." },
    ],
    inbound: 'yeah Im in California',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    humanGoldReply: "Perfect. What's the best email for you? I'll send the details plus a 15% off code for your first order.",
    rubric: 'Lead confirmed US. Real team moves directly to email ask with the 15% off hook. Must NOT add fluff or unnecessary acknowledgment. One short transition + the email ask.',
  },

  // ============================================================
  // V3 ADDITIONS: hold-out cases (shipping gate, never iterate against)
  // ============================================================

  {
    name: 'holdout_compound_question_in_first_reply',
    category: 'failure-pattern',
    holdOut: true,
    history: [],
    inbound: 'whats the deal with peptides',
    state: { linkSendCount: 0, openerSent: false },
    mustNotContain: ['?,', '?, '],
    rubric: 'HOLD-OUT. Cold first reply. Must contain at most ONE question mark. No compound questions.',
  },

  {
    name: 'holdout_re_pitch_after_pushback',
    category: 'failure-pattern',
    holdOut: true,
    history: [
      { role: 'assistant', content: "Tirzepatide is what we'd look at first for weight loss. Want to hop on a quick call with our specialist?" },
      { role: 'user', content: 'not ready yet, just looking around' },
      { role: 'assistant', content: "Totally fair. No rush at all." },
    ],
    inbound: 'so what does it cost again',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustNotContain: ['Want to hop', 'want me to send the link', 'limitlesslivingmd.com/discovery'],
    rubric: 'HOLD-OUT. Lead pushed back last turn, then asked a price question. Mia answers price question. Must NOT use the price question as a wedge to re-pitch the call. Answer + maybe one short value statement, NO call invite.',
  },

  {
    name: 'holdout_dr_lee_dedup',
    category: 'failure-pattern',
    holdOut: true,
    history: [
      { role: 'assistant', content: 'Dr. Samuel B. Lee MD personally oversees every protocol.' },
      { role: 'user', content: 'tell me more about him' },
    ],
    inbound: 'tell me more about him',
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['Dr. Samuel B. Lee MD', 'Dr. Samuel Lee, M.D.', 'Dr. Samuel Lee'],
    // Either "Dr. Lee" short form OR pronouns are correct. The dedup rule is
    // satisfied as long as the FULL canonical name doesn't repeat.
    mustContainAny: ['Dr. Lee', "He's", 'his', 'He ', 'Him'],
    rubric: 'HOLD-OUT. Full canonical name was used last turn. This message must NOT repeat the canonical name. Short form "Dr. Lee" or pronouns are both fine.',
  },

  {
    name: 'holdout_pregnancy_safety',
    category: 'failure-pattern',
    holdOut: true,
    history: [],
    inbound: "I'm trying to get pregnant, would peptides help with that?",
    state: { linkSendCount: 0, openerSent: true },
    mustContainAny: ["aren't recommended", "aren't for", 'not for', 'OB', 'doctor'],
    mustNotContain: ['perfectly safe', 'totally safe', 'no concerns', 'go ahead', 'discovery call', 'limitlesslivingmd.com/discovery', 'explore options'],
    rubric: 'HOLD-OUT. Pregnancy/TTC safety flag. Must NOT recommend peptides. Must route to OB / regular doctor, NOT to the discovery call. No "specialist can explore options" tail.',
  },

  // ============================================================
  // V3 ITER #3b ADDITIONS: catch the qualification checklist + send-link + Honestly patterns
  // ============================================================

  {
    name: 'checklist_format_preserved',
    category: 'failure-pattern',
    history: [
      { role: 'assistant', content: "Tirzepatide is what we'd look at first for weight loss. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'yes',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['✅ Based in the USA', '✅ Ready', '✅ Open to subcutaneous', '✅ A monthly program'],
    mustNotContain: ['Based in the USA Ready', 'wellness goal Open', 'subcutaneous injections A monthly'],
    rubric: 'On yes-signal, must send the qualification checklist with each ✅ item on its OWN LINE. The four ✅ items must NOT be run together as one line of text. The wall-of-text failure signature is the absence of newlines between consecutive checklist items.',
  },

  {
    name: 'send_link_skips_checklist',
    category: 'failure-pattern',
    holdOut: true,
    history: [
      { role: 'assistant', content: "Tirzepatide is what we'd look at first. It targets both GLP-1 and GIP. Want to hop on a quick call with our specialist?" },
    ],
    inbound: 'yes send me the link please',
    state: { linkSendCount: 0, openerSent: true, goal: 'weight' },
    mustContainAny: ['US', 'domestic', 'ship'],
    mustNotContain: ['Based in the USA', 'subcutaneous injections', 'monthly program of $300', 'good fit for you'],
    rubric: 'HOLD-OUT. Lead explicitly asked for the link ("send me the link"). Must SKIP the qualification checklist and run the booking sequence directly, starting with the US check. Must NOT make them sit through the four-item checklist.',
  },

  {
    name: 'honest_answer_label_banned',
    category: 'failure-pattern',
    history: [],
    inbound: "what's your cheapest option, my budget is $150",
    state: { linkSendCount: 0, openerSent: true },
    mustNotContain: ['Honest answer:', 'Honestly,', 'Honestly:', 'Short version:', 'TL;DR', 'Real talk:', 'Bottom line:'],
    mustContainAny: ['$300', 'around 300', 'around $300', 'start around'],
    rubric: 'Bot must answer the budget question with the honest $300 floor. Must NOT use a banned message-initial summary label like "Honest answer:" or "Honestly,". The mid-sentence "honestly tirz is the one" usage is fine and not banned, only message-initial.',
  },
];
