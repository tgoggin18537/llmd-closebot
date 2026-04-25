/**
 * Static audit: every FAQ / opener / objection answer run through the
 * guardrail to catch voice-rule violations. Also flags over-3-sentence
 * answers. Zero Claude cost.
 *
 *   npx tsx worker/src/agents/audit-content.ts
 */

import { FAQ, OBJECTIONS, GOAL_OPENERS } from '../prompts/faq';
import { FOLLOWUPS } from '../prompts/followups';
import { applyGuardrail } from './guardrail';

const problems: string[] = [];

function sentences(s: string): number {
  // Strip abbreviation periods so they don't count as sentence ends.
  const cleaned = s
    .replace(/\bDr\./g, 'Dr')
    .replace(/\bMr\./g, 'Mr')
    .replace(/\bMrs\./g, 'Mrs')
    .replace(/\bMs\./g, 'Ms')
    .replace(/\bM\.D\.?/g, 'MD')
    .replace(/\bU\.S\.?/g, 'US')
    .replace(/\b([A-Z])\.(?=\s)/g, '$1'); // "B. Lee" -> "B Lee"
  return (cleaned.match(/[.!?](\s|$)/g) ?? []).length;
}

function audit(label: string, s: string) {
  const g = applyGuardrail({ candidate: s, linkSendCountBefore: 0, isFirstMessage: false });
  if (!g.ok) {
    problems.push(`[REJECT] ${label}: ${g.reason}\n  text: "${s}"`);
    return;
  }
  if (g.clean !== s) {
    problems.push(`[REWRITTEN] ${label}: guardrail rewrote\n  orig:  "${s}"\n  clean: "${g.clean}"`);
  }
  const n = sentences(s);
  if (n > 3) problems.push(`[LONG] ${label}: ${n} sentences\n  text: "${s}"`);
  if (s.length > 320) problems.push(`[CHARS] ${label}: ${s.length} chars\n  text: "${s}"`);
}

for (const [goal, msg] of Object.entries(GOAL_OPENERS)) audit(`GOAL_OPENER.${goal}`, msg);
for (const e of FAQ) audit(`FAQ[${e.triggers[0]}]`, e.answer);
for (const e of OBJECTIONS) audit(`OBJECTION[${e.triggers[0]}]`, e.answer);
for (const [key, msg] of Object.entries(FOLLOWUPS)) audit(`FOLLOWUP.${key}`, msg);

if (problems.length === 0) {
  console.log('CONTENT AUDIT: clean. All FAQ/openers/objections/followups pass guardrail and voice rules.');
} else {
  for (const p of problems) console.log(p + '\n');
  console.log(`${problems.length} issues found.`);
  process.exit(1);
}
