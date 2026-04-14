/**
 * Structured Limitless Living MD knowledge base, derived from
 * raw/knowledge-base.company-overview.csv and raw/training-data.overview.csv.
 *
 * Update this file when the CSV source of truth changes, then redeploy.
 */

export const LLMD_KB = {
  company: {
    name: 'Limitless Living MD',
    website: 'limitlesslivingmd.com',
    tagline: 'Physician Guided Peptide Therapy and Health Optimization',
    founder: 'Dr. Samuel B. Lee MD, board certified psychiatrist',
    positioning:
      'Medical oversight is the key differentiator. Physician guided, pharmaceutical grade peptide therapy with personalized protocols. Not a supplement company, this is prescribed medicine from licensed US pharmacies.',
    differentiators: [
      'Physician oversight, Dr. Samuel B. Lee MD prescribes every protocol',
      'Pharmaceutical grade from licensed US pharmacies',
      'Personalized protocols',
      'Whole person approach, body mind spirit',
      'Dedicated support team',
      'Microdosing protocols with fewer side effects than standard dosing',
    ],
    supportEmail: 'info@limitlesslivingmd.com',
    primarySmsNumber: '+18337154447',
    // The GHL widget URL is canonical. Funnel URL is a marketing redirect.
    bookingLinkGhl: 'https://api.leadconnectorhq.com/widget/bookings/15min-peptidediscoverycall',
    funnelLink: 'https://discover.limitlesslivingmd.com/Booking',
    // What the team says in SMS today. KEEP IN SYNC with mia.v2.ts prompt.
    smsBookingLink: 'limitlesslivingmd.com/discovery',
    instagram: '@limitlesslivingmd',
  },
  demographics: {
    totalCustomers: '417+',
    genderSplit: '76.3% female, 22.8% male',
    averageAge: 48.9,
    coreMarket: 'Women aged 40 to 59 = 57.8% of customers',
    averageOrderValue: 767,
    marketingPersona: 'Sarah, 48, Gen X, established career, financially stable, values evidence based results and personalized care.',
  },
  brandVoice: {
    rule: 'Spiritually infused but clinically positioned. Clinical is the default, spiritual bridge language is used sparingly only when the lead opens the door.',
    approvedBridges: [
      'Dr. Lee treats the whole person, body, mind, and spirit.',
      'Every protocol is designed with intention.',
      'Your body already knows how to heal, we just help it remember.',
      'Physician guided, spiritually grounded.',
      'Peptides restore the signals. Intention amplifies the healing.',
    ],
    neverUse: ['Kathara Grid', 'CDT Plates', '15-D Time Matrix', 'MCEO'],
  },
  bot: {
    mode: 'setter', // V2 = pre-call setter. Mode 2 (post-call nurture / D+2) is Phase B.
    primaryNumber: '+18337154447',
    voiceReference: "Mirror Janice's warm, no-pressure, curiosity-led setter voice.",
  },
  existingPatientTags: [
    // If any of these are on a contact, treat as existing patient and do not run setter flow.
    'customer',
    'cjc+ipamorelin',
    'nad+',
    'tirzepatide',
    'semaglutide',
    'retatrutide',
    'sermorelin',
    'bpc-157',
    'tb-500',
    'ghk-cu',
    'existing-patient',
  ],
  carrierBlockedPatterns: [
    // Phrases observed causing error 30007 blocks in production.
    'You deserve to feel clear, energized, and balanced again',
  ],
  postCallTopFiveQuestions: [
    'How do I buy the 3 month protocol?',
    'Can you send the COA?',
    'What state are you in?',
    'Can you update the invoice for a second person?',
    'Where is my shipment?',
  ],
  criticalFinding:
    'The D+2 check-in SMS after the discovery call is the single most conversion critical message. Mode 2 (Phase B) must send a personalized morning check-in asking if the lead has questions about the invoice.',
} as const;

export function hasExistingPatientTag(tags: string[] | undefined | null): boolean {
  if (!tags || tags.length === 0) return false;
  const lowered = tags.map((t) => t.toLowerCase());
  return LLMD_KB.existingPatientTags.some((t) => lowered.includes(t.toLowerCase()));
}
