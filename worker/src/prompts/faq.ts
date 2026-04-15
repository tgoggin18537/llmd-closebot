/**
 * Approved FAQ and objection answers.
 *
 * These are the tested, team-approved answers to common questions. They are
 * injected into the system prompt as a reference library. Mia should stay
 * close to verbatim on facts while adapting phrasing to flow with the
 * conversation. Never invent new facts.
 *
 * Verbatim source answers come from Lauren (4/13 8:09 PM, 4/14 11:10 AM)
 * and Nicole (4/13 7:32 PM).
 */

export type FaqEntry = {
  triggers: string[];
  answer: string;
  notes?: string;
};

export const GOAL_OPENERS: Record<'energy' | 'weight' | 'recovery' | 'curious', string> = {
  energy:
    "That's super common, usually tied to cellular energy declining over time. Peptides like NAD+ work at the source, which is why they help when caffeine and vitamins haven't. Want to hop on a quick call with our specialist?",
  weight:
    "That's frustrating and usually not a willpower thing. Peptides like semaglutide and tirzepatide work on the actual hormone signals that control hunger and metabolism, which is why they help when diet alone hasn't moved the needle. Want to hop on a quick call with our specialist?",
  recovery:
    "That's rough, sleep and recovery issues compound everything else. Peptides basically signal your body to repair itself, which slows down as we age. Want me to send the link to chat with our specialist?",
  curious:
    "Nice. Peptides are signaling molecules your body already makes, the therapeutic ones just amp up specific ones, some for fat loss, some for recovery, some for energy. Easiest way to find the right fit is a quick call with our specialist.",
};

export const FAQ: FaqEntry[] = [
  {
    triggers: ['sema vs tirz', 'semaglutide vs tirzepatide', 'difference between sema', 'which is better sema'],
    answer:
      "Semaglutide is a single GLP-1 receptor agonist while tirzepatide targets both GLP-1 and GIP, which is why patients typically see stronger results with tirzepatide. Our specialist can help figure out which one fits your situation best on a quick call.",
  },
  {
    triggers: ['weight loss peptide', 'peptides for weight', 'what do you use for weight'],
    answer:
      "Semaglutide and tirzepatide are what we use most, both GLP-1s. Patients on Dr. Samuel B. Lee MD's protocols typically see 15 to 20% body weight reduction over 3 months, physician dosed to your labs. Want me to get you on a quick call with the team?",
  },
  {
    triggers: ['fda approved', 'fda approval', 'is this fda'],
    answer:
      "Peptides are not FDA approved as a category but ours come from 503A and 503B certified US compounding pharmacies with certificates of analysis, and everything is physician supervised by Dr. Samuel B. Lee MD.",
  },
  {
    triggers: ['how much', 'what does it cost', 'price', 'how much does it cost'],
    answer:
      "Depends on the protocol, ranges from about $300 to $700 a month. The specialist can tell you exactly what you'd need for your situation.",
  },
  {
    triggers: [
      'budget is',
      'my budget',
      '$200 is my budget',
      'is that possible',
      'can you do it for less',
      'cheaper option',
      'can afford',
      'i have $',
      'can only spend',
      'is $X doable',
    ],
    answer:
      "Honest answer: our protocols start around $300 a month, so there's a gap from $200. The discovery call is a good place to see if any protocol fits your situation, but I don't want to promise something cheaper that may not exist.",
    notes: 'If the lead states a budget under $300, USE THIS ANSWER verbatim (adapting only the specific dollar amount). Do NOT ask "what budget are you working with" when they already told you. Do NOT say "really flexible" or "might find something closer to your range" about pricing, that is dishonest. Be honest about the $300 floor.',
  },
  {
    triggers: ['shipping', 'how long does shipping', 'when will it arrive', 'delivery time'],
    answer:
      "Once your order is placed and processed it typically arrives within 5 to 10 business days.",
  },
  {
    triggers: ['talk to dr lee directly', 'speak with dr lee', 'dr lee himself'],
    answer:
      "That means a lot and makes total sense. Dr. Samuel B. Lee MD personally oversees every protocol, and the discovery call is actually the closest thing to that since his specialists are trained directly by him and follow his exact approach.",
  },
  {
    triggers: ['who does the consultations', 'telehealth consultants', 'who am i talking to on the call', 'who is the specialist'],
    answer:
      "Our telehealth consultations are conducted by licensed practitioners trained directly under Dr. Samuel B. Lee MD, a board certified psychiatrist with extensive experience in peptide therapy and integrative medicine.",
  },
  {
    triggers: ['are they safe', 'is it safe', 'safety'],
    answer:
      "Yeah, ours are pharmaceutical grade from US compounding pharmacies. Most common side effect is mild soreness at the injection site. The specialist can walk through anything specific you're worried about.",
  },
  {
    triggers: ['is it injections', 'are these shots', 'do i inject', 'is it a needle'],
    answer:
      "Most protocols are, yeah. Tiny needles, same kind diabetics use, takes about 10 seconds. Reason is absorption, pills get destroyed by stomach acid while injections get almost 100% into your system.",
  },
  {
    triggers: ['scared of needles', 'afraid of needles', 'hate needles'],
    answer:
      "Yeah that's fair. Our specialist was the same way, she's on four peptides herself now and says by week two it's like brushing your teeth. She can walk you through what it feels like on the call.",
  },
  {
    triggers: ['is this legit', 'how do i know this is real', 'can i trust'],
    answer:
      "We only use US compounding pharmacies with certificates of analysis so you know exactly what you're getting, plus there's a telehealth review before anything ships. If you know Dr. Samuel B. Lee MD's work, you know he wouldn't put his name on something sketchy.",
  },
  {
    triggers: ['tried peptides before', "didn't work before", 'they did not work'],
    answer:
      "That's usually a sourcing or a dosing thing, a lot of sketchy stuff floating around. Ours are pharmaceutical grade from regulated US pharmacies with physician dosing. The specialist can look at what you tried and see if something different would fit.",
  },
  {
    triggers: ['how fast', 'how long until', 'how quickly', 'when will i see results'],
    answer:
      "Depends what you're working on. Energy and sleep can shift in days to weeks, body comp takes longer, usually 2 to 3 months for real visible change. The specialist can give you a realistic timeline for your goal.",
  },
  {
    triggers: ['insurance', 'do you take insurance', 'is this covered', 'will my insurance pay'],
    answer:
      "Peptide therapy is cash pay only, insurance doesn't cover compounded peptides. That's also why you're getting it at wholesale from a compounding pharmacy instead of retail.",
  },
  {
    triggers: ['pregnant', 'pregnancy', 'breastfeeding', 'trying to conceive', 'ttc'],
    answer:
      "Peptides aren't for anyone pregnant, breastfeeding, or trying to conceive. The specialist can talk through options that would fit your situation on the call.",
    notes: 'Safety critical. Never recommend peptides to pregnancy-related questions.',
  },
  {
    triggers: ['bloodwork', 'blood work', 'labs', 'do i need lab', 'tests required'],
    answer:
      "For most protocols Dr. Lee reviews recent labs or orders them, just to make sure the protocol matches what your body actually needs. The specialist walks you through it on the call.",
  },
  {
    triggers: ['side effects', 'bad reaction', 'what if i have side effects'],
    answer:
      "Most common one is mild soreness at the injection site, most people don't notice it past week one. Anything else, Dr. Lee adjusts the protocol to fit. You're not on your own with it.",
  },
  {
    triggers: ['refund', 'money back', 'guarantee', 'can i get my money back'],
    answer:
      "Once a compounded prescription ships it can't be returned, pharmacy rules. If something's not working Dr. Lee adjusts the protocol rather than starting over, that's kind of the point of the physician oversight.",
  },
  {
    triggers: ['consultation', 'what happens on the call', 'whats on the call', 'what is the call'],
    answer:
      "It's a 15 minute call with the specialist to talk through your goals, any history that matters, and which protocol would actually fit. No pressure, just figuring out if it makes sense.",
  },
  {
    triggers: ['age', 'how old', 'minimum age', 'can my kid'],
    answer:
      "Peptide protocols are for adults only. The specialist can talk through age specifics on the call if that's part of what you're asking.",
  },
  {
    triggers: ['other medications', 'currently taking', 'drug interactions', 'meds'],
    answer:
      "Dr. Lee reviews current meds before prescribing so nothing clashes, that's part of the protocol review. The specialist can get your list on the call.",
  },
  {
    triggers: ['testosterone', 'trt', 'hrt', 'hormone replacement'],
    answer:
      "Peptides are our focus, not TRT or HRT directly. Some peptides influence hormone signaling, the specialist can get into whether that's relevant to what you're looking for.",
  },
  {
    triggers: ['costco', 'compounding pharmacy', 'gray market', 'cheaper peptides online'],
    answer:
      "Gray market peptides are a gamble, quality and dosing can be all over the place. Ours come from 503A and 503B certified US pharmacies with certificates of analysis, and Dr. Samuel B. Lee MD reviews every protocol.",
  },
  {
    triggers: ['new patients', 'taking new', 'accepting new'],
    answer:
      "Yep, new patients can still book. The 15 minute call is the first step for anyone working with Dr. Lee.",
  },
  {
    triggers: ['shortage', 'glp-1 shortage', 'running out', 'availability'],
    answer:
      "Because we work through 503A and 503B compounding pharmacies, supply has been stable even when the brand name stuff has hit shortages. The specialist can confirm what's on hand.",
  },
  {
    triggers: ['how does it work', 'whats a peptide', 'what are peptides'],
    answer:
      "Peptides are short chains of amino acids, basically signaling molecules your body already makes. Therapeutic ones amplify specific signals, burn fat, repair tissue, boost energy. The specialist can get into the one that fits what you want.",
  },
  {
    triggers: ['can i change protocol', 'change my protocol', 'switch peptide'],
    answer:
      "Yeah protocols get adjusted, that's the point of physician oversight. Dr. Lee tweaks based on how you're responding.",
  },
];

export const OBJECTIONS: FaqEntry[] = [
  {
    triggers: ["not ready", "need to think"],
    answer:
      "Yeah no rush. Want me to send the link anyway so it's there when you want it?",
  },
  {
    triggers: ["is this a sales call", "are you selling", "what is the call"],
    answer:
      "Nope, it's educational. Specialist looks at your goals and tells you what might help. If it's not a fit, she'll say so.",
  },
  {
    triggers: ["too expensive", "can't afford", "that's a lot"],
    answer:
      "I hear you. The specialist can help figure out what you actually need, it's not always the priciest option, and I've got a 15% off code for your first order. What's your best email and I'll send it over?",
  },
  {
    triggers: ["don't have time", "no time", "too busy"],
    answer:
      "It's 15 minutes, basically a coffee break. Here's the link whenever: limitlesslivingmd.com/discovery",
  },
  {
    triggers: ["just send info", "just email me", "send details"],
    answer:
      "Sure, what's your email? I'll send some info plus a 15% off code.",
  },
];

/** Rendered for inclusion in the system prompt. */
export function renderFaqForPrompt(): string {
  const faqLines = FAQ.map(
    (e) => `Q signal: ${e.triggers[0]}\nApproved answer: "${e.answer}"${e.notes ? `\nNote: ${e.notes}` : ''}`,
  ).join('\n\n');
  const objLines = OBJECTIONS.map(
    (e) => `Objection: ${e.triggers[0]}\nApproved response: "${e.answer}"`,
  ).join('\n\n');
  const openerLines = Object.entries(GOAL_OPENERS)
    .map(([goal, msg]) => `Goal ${goal}: "${msg}"`)
    .join('\n\n');
  return [
    '# GOAL OPENERS',
    openerLines,
    '',
    '# FAQ ANSWER LIBRARY (use close to verbatim, adapt phrasing only for flow)',
    faqLines,
    '',
    '# OBJECTION RESPONSES',
    objLines,
  ].join('\n');
}
