#!/usr/bin/env bash
#
# fork-new-client.sh — one-shot fork of llmd-closebot into a new-client repo.
#
# Usage (from anywhere):
#   ./scripts/fork-new-client.sh <client-name> [target-parent-dir]
#
# Example:
#   cd ~/code/llmd-closebot
#   ./scripts/fork-new-client.sh spiffy
#   # -> creates ~/code/spiffy-closebot as a stripped template
#
# What it does:
#   1. Copies this repo to <target-parent-dir>/<client>-closebot
#   2. Removes .git
#   3. Strips client-specific content (prompts, FAQ, KB, golden evals, raw data)
#   4. Leaves TODO markers and the universal infra intact
#   5. Prints a checklist of manual edits still needed
#
# After it runs, start a fresh Claude Code session in the new directory and
# paste BUILD_PLAYBOOK.md as cold-start context.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <client-name> [target-parent-dir]"
  echo "Example: $0 spiffy ~/code"
  exit 1
fi

CLIENT="$1"
PARENT_DIR="${2:-$(dirname "$(pwd)")}"
SOURCE_DIR="$(pwd)"
TARGET="${PARENT_DIR}/${CLIENT}-closebot"

if [[ ! -f "${SOURCE_DIR}/BUILD_PLAYBOOK.md" ]]; then
  echo "ERROR: run this from the llmd-closebot root (BUILD_PLAYBOOK.md not found)"
  exit 1
fi

if [[ -d "${TARGET}" ]]; then
  echo "ERROR: ${TARGET} already exists. Pick a different name or delete it."
  exit 1
fi

echo "→ Copying ${SOURCE_DIR} to ${TARGET}..."
cp -R "${SOURCE_DIR}" "${TARGET}"
cd "${TARGET}"

echo "→ Removing git history (fresh repo for new client)..."
rm -rf .git

echo "→ Removing llmd-specific raw data..."
rm -rf raw/

echo "→ Blanking worker/src/prompts/faq.ts..."
cat > worker/src/prompts/faq.ts <<'EOF'
/**
 * Approved FAQ and objection answers for THIS CLIENT.
 *
 * TODO: Fill in GOAL_OPENERS, FAQ, OBJECTIONS from the client's verbatim
 * approved copy. Each answer should pass the guardrail (run audit-content.ts
 * to verify after filling in).
 */

export type FaqEntry = {
  triggers: string[];
  answer: string;
  notes?: string;
};

export const GOAL_OPENERS: Record<'energy' | 'weight' | 'recovery' | 'curious', string> = {
  energy: 'TODO',
  weight: 'TODO',
  recovery: 'TODO',
  curious: 'TODO',
};

export const FAQ: FaqEntry[] = [];

export const OBJECTIONS: FaqEntry[] = [];

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
EOF

echo "→ Blanking worker/src/prompts/followups.ts..."
cat > worker/src/prompts/followups.ts <<'EOF'
/**
 * Follow-up drip sequences for THIS CLIENT.
 * TODO: Fill in +1d / +3d / +7d / +14d bodies.
 */
export const FOLLOWUPS: Record<string, string> = {};
EOF

echo "→ Blanking worker/src/prompts/kb.ts..."
cat > worker/src/prompts/kb.ts <<'EOF'
/**
 * Client knowledge base. TODO: fill in from client intake.
 */

export const CLIENT_KB = {
  brand: 'TODO',
  doctor: 'TODO',
  phone: 'TODO',
  // If any of these tags are on a contact, treat as existing patient.
  existingPatientTags: [
    'customer',
    'existing-patient',
    // TODO: add this client's active-product tags (e.g., peptide names)
  ],
  // Phrases that have caused carrier 30007 blocks in prod.
  carrierBlockedPatterns: [] as string[],
};

export function hasExistingPatientTag(tags: string[] | undefined | null): boolean {
  if (!tags || tags.length === 0) return false;
  const lowered = tags.map((t) => t.toLowerCase());
  return CLIENT_KB.existingPatientTags.some((t) => lowered.includes(t.toLowerCase()));
}
EOF

echo "→ Blanking worker/src/prompts/mia.v2.ts..."
cat > worker/src/prompts/mia.v2.ts <<'EOF'
/**
 * System prompt for THIS CLIENT.
 *
 * TODO: Write the client-specific system prompt following BUILD_PLAYBOOK.md.
 * Keep universal voice rules (no AI tells, one question per message, etc).
 * Replace all client-specific content (brand, doctor name, opener text,
 * spiritual/clinical vocab, team references).
 */

export const MIA_V2_SYSTEM_PROMPT = `TODO: replace with full client system prompt`;

/** Per-turn dynamic context injected after the static prompt (not cached). */
export function buildTurnContext(ctx: {
  linkSendCount: number;
  goalFromManychat?: string;
  painPointFromManychat?: string;
  emailCaptured?: string;
  usConfirmed?: boolean;
  lastMessagesHint?: string;
}): string {
  const parts: string[] = ['# TURN CONTEXT'];
  parts.push(`Booking link sent so far: ${ctx.linkSendCount}/2`);
  if (ctx.linkSendCount >= 2) {
    parts.push('You have used your booking link budget. Do NOT send the link again. Switch to education mode.');
  }
  if (ctx.goalFromManychat) parts.push(`Known goal from Manychat: ${ctx.goalFromManychat}`);
  if (ctx.painPointFromManychat) parts.push(`Known pain point from Manychat: ${ctx.painPointFromManychat}`);
  if (ctx.emailCaptured) parts.push(`Email already captured: ${ctx.emailCaptured}. Do not ask again.`);
  if (ctx.usConfirmed) parts.push('US residency already confirmed. Do not ask again.');
  if (ctx.lastMessagesHint) parts.push(ctx.lastMessagesHint);
  return parts.join('\n');
}
EOF

echo "→ Blanking worker/src/evals/golden.ts..."
cat > worker/src/evals/golden.ts <<'EOF'
/**
 * Golden conversations for THIS CLIENT.
 * TODO: Fill in one case per failure pattern + one per major FAQ.
 * See BUILD_PLAYBOOK.md for the 15 failure patterns you should cover.
 */

export type GoldenCase = {
  name: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  inbound: string;
  state: {
    linkSendCount?: number;
    openerSent?: boolean;
    emailCaptured?: string;
    usConfirmed?: boolean;
    goal?: string;
  };
  mustContainAny?: string[];
  mustNotContain?: string[];
  rubric?: string;
};

export const GOLDEN: GoldenCase[] = [];
EOF

echo "→ Updating package.json name..."
if [[ -f worker/package.json ]]; then
  # Use perl for portable in-place edit (works on macOS + Linux)
  perl -i -pe "s/\"name\":\s*\"[^\"]+\"/\"name\": \"${CLIENT}-closebot-worker\"/" worker/package.json
fi

echo "→ Updating wrangler.toml name..."
if [[ -f worker/wrangler.toml ]]; then
  perl -i -pe "s/^name\s*=.*/name = \"${CLIENT}-closebot\"/" worker/wrangler.toml
fi

echo "→ Copying BUILD_PLAYBOOK.md reference to root (kept from template)..."
# already there from the cp, just confirming

echo "→ Initializing fresh git repo..."
git init -q
git add -A
git commit -q -m "Initial fork from llmd-closebot template (stripped for ${CLIENT})"

echo ""
echo "✅ Fork complete at: ${TARGET}"
echo ""
echo "--- NEXT STEPS ---"
echo ""
echo "1. Manual edits you still need to make:"
echo "   • worker/src/agents/guardrail.ts"
echo "     - STAFF_NAMES array"
echo "     - CANONICAL_NAME"
echo "     - NAME_VARIANTS regexes"
echo "     - WELLNESS_CLAIM_PATTERNS (add any carrier-blocked phrases)"
echo "   • worker/src/agents/guardrail.test.ts"
echo "     - Swap name / staff / wellness test strings for new client"
echo "   • worker/src/routes/webhook.ts"
echo "     - OPENER constant (verbatim first-touch copy)"
echo "     - SHUTOFF_TAGS (usually same structure, maybe different tag names)"
echo "   • worker/.dev.vars (copy from .dev.vars.example)"
echo "     - GHL_API_KEY (new client's private integration token)"
echo "     - GHL_LOCATION_ID (new client's location)"
echo "     - GHL_WEBHOOK_SECRET (openssl rand -hex 32)"
echo "     - ANTHROPIC_API_KEY"
echo "   • worker/wrangler.toml"
echo "     - D1 binding id (run: wrangler d1 create ${CLIENT}_bot)"
echo "     - KV binding id (run: wrangler kv:namespace create IDEMPOTENCY)"
echo ""
echo "2. Open a fresh Claude Code session in:"
echo "     ${TARGET}"
echo ""
echo "3. First user message (paste this):"
echo ""
echo "     Read BUILD_PLAYBOOK.md at the repo root. The client is ${CLIENT}."
echo "     Here's the voice source data: [paste Google Sheet CSV or link]."
echo "     Analyze the voice, then follow the playbook to build a ${CLIENT}-"
echo "     matched setter bot. Propose the system prompt structure first"
echo "     before writing code so I can review the voice direction."
echo ""
echo "4. Once prompt + FAQ + evals are written:"
echo "     cd worker"
echo "     npx tsx src/agents/audit-content.ts    # must be clean"
echo "     npx tsx src/agents/guardrail.test.ts   # must be green"
echo "     npm run eval                            # must hit 100%"
echo ""
echo "5. Deploy: wrangler deploy"
echo ""
