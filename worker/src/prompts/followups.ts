/**
 * Follow-up SMS bodies for the drip sequence (Nicole's schedule).
 *
 * Cadence lives in GHL workflow. These are the exact message bodies. They
 * obey Mia's voice rules (no dashes, no emojis, <=3 sentences, no staff
 * names, single booking link budget across the whole sequence).
 */

export const FOLLOWUPS = {
  /** +1 day no reply, soft check in. */
  day1: "Hey, no rush, just wanted to check if you had any other questions floating around.",

  /** +3 days no reply, share something valuable (education, not sales). */
  day3:
    "Quick thing in case it's useful. Most people I talk to think peptides work like supplements, but they actually signal your cells to do specific things like burn fat or repair tissue. That's why they tend to work when other stuff hasn't.",

  /** +7 days no reply, final friendly nudge with the booking link. */
  day7:
    "Last one from me, no pressure at all. If you ever want to chat with the team about what might fit, here's the link: limitlesslivingmd.com/discovery. Hope you find what works for you.",

  /** +14 days, soft handoff to long term nurture (no bot action, GHL tags them). */
};
