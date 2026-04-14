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
    "That's super common and usually tied to cellular energy declining over time. Peptides like NAD+ work at the source, which is why they help when caffeine and vitamins haven't. Our specialist does free 15 minute calls to figure out what might work. Want me to send the link?",
  weight:
    "That's frustrating and usually not a willpower thing. Peptides like semaglutide and tirzepatide work on the actual hormone signals that control hunger and metabolism, which is why they help when diet alone hasn't moved the needle. Want to hop on a quick call with our specialist?",
  recovery:
    "That's rough, sleep and recovery issues compound everything else. Peptides basically signal your body to repair itself, which slows down as we age. Our specialist does free calls to figure out what might help. Want the link?",
  curious:
    "Nice. Short version: peptides are amino acid chains that signal your cells to do specific things, burn fat, repair tissue, boost energy. Your body already makes them, therapeutic ones just boost where you need it. Easiest way to go deeper is a quick call with our specialist.",
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
      "Semaglutide and tirzepatide are our go-tos, both GLP-1s. Patients on Dr. Samuel B. Lee MD's protocols typically see 15 to 20% body weight reduction over 3 months, and because it's physician dosed to your labs you're not guessing at it alone. Want me to get you on a quick call with the team so they can figure out which one fits your body best?",
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
    triggers: ['budget is', 'can you do it for less', 'cheaper option', 'can afford', '$200 budget'],
    answer:
      "Our protocols typically start around $300 per month. The call is the best place to look at what fits your situation and whether there is an option that works for you.",
    notes: 'Do not say "really flexible" about pricing. Be honest.',
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
      "Totally fair. Our specialist was the same way, now she's on four peptides herself and says by week two it's like brushing your teeth. She can walk you through exactly what it feels like on the call.",
  },
  {
    triggers: ['is this legit', 'how do i know this is real', 'can i trust'],
    answer:
      "We only use US compounding pharmacies with certificates of analysis so you know exactly what you're getting, plus there's a telehealth review before anything ships. If you know Dr. Samuel B. Lee MD's work, you know he wouldn't put his name on something sketchy.",
  },
  {
    triggers: ['tried peptides before', "didn't work before", 'they did not work'],
    answer:
      "That can be a sourcing or a dosing thing. There's a lot of sketchy stuff out there. Ours are pharmaceutical grade from regulated US pharmacies. The specialist can look at what you tried and see if something different would fit better.",
  },
  {
    triggers: ['how fast', 'how long until', 'how quickly', 'when will i see results'],
    answer:
      "Depends what you're working on. Energy and sleep can shift in days to weeks, body comp takes longer, usually 2 to 3 months for real visible change. The specialist can give you a realistic timeline for your goal.",
  },
];

export const OBJECTIONS: FaqEntry[] = [
  {
    triggers: ["not ready", "need to think"],
    answer:
      "Totally fine. Want me to send the link anyway? It'll be there when you want it, no pressure.",
  },
  {
    triggers: ["is this a sales call", "are you selling", "what is the call"],
    answer:
      "Nope, it's educational. Specialist looks at your goals and tells you what might help. If it's not a fit, she'll say so.",
  },
  {
    triggers: ["too expensive", "can't afford", "that's a lot"],
    answer:
      "I hear you. The specialist can help figure out what you actually need, it's not always the priciest option. Plus I've got a 15% off code. What's your best email and I'll send it over?",
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
