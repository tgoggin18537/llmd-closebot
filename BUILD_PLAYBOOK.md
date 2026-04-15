# Build Playbook: Voice-Matched SMS Setter Bot

This document is the cold-start context for building a voice-matched SMS setter bot for a new client. Read it before touching code. The architecture, patterns, and failure modes captured here came from shipping llmd-closebot for Limitless Living MD — don't rediscover them, start from them.

---

## Core thesis

The single metric is: **does this sound like a human, not an SDR script or an LLM?**
Every architectural choice, prompt rule, and guardrail check serves that one thing.

---

## Architecture

```
Inbound SMS (GHL webhook)
  → Cloudflare Worker
  → [idempotency KV] [shutoff tag check] [manual-outbound check] [existing patient check]
  → Durable Object (per-contact state)
  → Claude Sonnet (writer brain)
  → Guardrail (regex rule enforcer)
  → retry loop (up to 3 attempts)
  → safe fallback SMS if still failing
  → GHL sendSms
  → persist turn to DO + D1 analytics
```

**Key pattern: two brains.** Claude writes, the guardrail enforces rules deterministically on every draft. They argue; Claude writes, guardrail rejects with a specific reason, Claude rewrites. This is how we keep the LLM from regressing on voice rules.

---

## Stack

- **Cloudflare Workers** — edge compute
- **Durable Objects** — per-contact conversation state, `linkSendCount`, email, `usConfirmed`, `openerSent`, `lastInboundGhlMessageId`, the full message history (ground truth for bot-sent messageIds)
- **D1** — turn-by-turn analytics (inbound, outbound, link_sent, violations)
- **KV** — idempotency on webhook `messageId` (10 min TTL)
- **Anthropic Claude** — Sonnet for writes, Haiku for classifiers (existing patient, agreed-to-book), prompt caching on the static system prompt
- **GoHighLevel** — SMS + CRM. Workflows trigger the webhook on Customer Replied.

---

## What's reusable vs client-specific

**Reusable (copy directly from llmd-closebot):**
- `worker/src/agents/guardrail.ts` — dashes, name normalization, emoji budget, banned openers/phrases, link budget, compound-question check, goal-menu repeat check, AI-summary-label strip, wellness-claim carrier risk
- `worker/src/agents/guardrail.test.ts` — 50+ deterministic tests
- `worker/src/agents/audit-content.ts` — runs every FAQ/opener through the guardrail at build time
- `worker/src/agents/classifier.ts` — existing-patient + agreed-to-book Haiku classifiers
- `worker/src/memory/ContactThread.ts` — Durable Object
- `worker/src/integrations/ghl.ts` — sendSms, getContact, addTag, recentMessages, **wasManualOutboundRecent (uses DO ground truth, not GHL source field — see failure pattern #7)**
- `worker/src/integrations/anthropic.ts` — Claude client with prompt caching
- `worker/src/routes/webhook.ts` — inbound flow, idempotency, shutoff, manual-outbound, existing-patient, retry loop, fallback
- `worker/src/evals/run.ts` — eval harness structure
- `worker/src/db/schema.sql` — D1 turns table

**Client-specific (rewrite per client):**
- `worker/src/prompts/<name>.ts` — system prompt, voice rules specific to this client's tone, opener text
- `worker/src/prompts/faq.ts` — FAQ library, goal openers, objection responses (all from the client's approved answers)
- `worker/src/prompts/kb.ts` — doctor/brand name, existing-patient tag list, brand voice notes, carrier-blocked phrases
- `worker/src/prompts/followups.ts` — drip sequences
- `worker/src/evals/golden.ts` — conversation-level eval cases derived from this client's failure patterns
- `worker/src/agents/guardrail.ts` — replace `STAFF_NAMES`, `NAME_VARIANTS`, `CANONICAL_NAME`, wellness patterns with this client's
- `OPENER` constant in `webhook.ts` — verbatim from client

---

## Universal voice rules (carry forward to every client)

These aren't LLMD-specific. They apply to any voice-matched bot.

- **No AI tells:** Ban openers "Great question", "Absolutely", "Thanks for reaching out", "I understand", "Certainly", "That's a great point", "Happy to help". Strip summary labels "Short version:", "TL;DR", "In short,", "To sum up," deterministically.
- **No self-initiator framing:** every lead is inbound, the bot is responding. Ban "I reached out", "wanted to reach out", "figured I'd reach out" in every conjugation and contraction.
- **One question per message:** reject compound questions (≥2 `?` marks OR ≥2 clause-starters like `what/how/are you/do you/is there`).
- **The opener's goal-discovery question asked exactly once per conversation.** Regex family catches paraphrases.
- **No dashes anywhere.** Strip em, en, figure dashes; soften letter-hyphen-letter to space.
- **No staff names.** Use "the specialist", "our team", "someone from the team".
- **One emoji budget.** First message only. Strip emoji in any subsequent reply.
- **Name format:** `CANONICAL_NAME` on first mention in a conversation, short form after. Dedupe repeated full names within a single message.
- **Carrier wellness-claim phrases** trigger error 30007 SMS blocks. Maintain an active list, reject + regenerate.
- **Admit uncertainty.** Bots always have an answer — humans sometimes say "hmm idk, the specialist would know." Prompt this explicitly.
- **Has opinions.** When asked to compare, pick a side. "Both are great options" = help-desk energy.
- **Match energy.** Short casual inbound → short casual reply. "Ok" → "anytime" or "for sure, talk soon."
- **Don't repeat validation.** Say "yeah that makes sense" once per conversation and move on.
- **Has varied rhythm.** Fragments, one-word replies when the moment fits. The biggest bot tell is a rigid 3-sentence rhythm every turn.

---

## Failure patterns (each one is a real regression — lock it in from day one)

1. **"Short version:" / "TL;DR" labels.** Claude loves summary labels. Strip deterministically in guardrail.
2. **Compound question.** "What's drawing you in, is there something specific you want help with?" Count `?` marks + clause-starters.
3. **Goal-menu repeat.** Asking "what are you hoping to work on" twice in a thread. Track via guardrail with `priorAssistantMessages` parameter. Match paraphrases, not just verbatim.
4. **Staple-opener pivot.** After a content question, tacking on the opener's goal-menu as a form-field pivot. Prompt rule + guardrail.
5. **Clipped goal-menu mid-conversation.** Listing the full service categories when a contextual follow-up would land better. Prompt for contextual follow-ups like "what got you curious?".
6. **AI 3-beat structure.** Definition → mechanism → call-pivot on every reply. Prompt for varied rhythm, explicit "don't always use the 3-beat shape."
7. **Manual-outbound false positive.** The GHL `/conversations/messages` API does NOT let you stamp a custom source on sends — every bot-sent outbound looks identical to a human inbox send. Fix: use the set of `ghlMessageId`s persisted in the Durable Object as ground truth. Any outbound in the window whose id isn't in that set was sent by a human.
8. **Silent-fail on guardrail exhaust.** If Claude and guardrail can't agree after N attempts, never return 200-skipped with no SMS. Ship a safe static fallback ("hmm good one, let me think on that real quick"), tag `needs-human`, dump every rejected draft + rejection reason into a contact note for diagnosis.
9. **Echo-back validation.** "You want more energy, got it." Ban. Just respond to it.
10. **Over-validation.** "totally", "completely understand", "I hear you" every turn. Cap at once per conversation.
11. **Carrier 30007 blocks.** Wellness-claim phrasing triggers carrier filters. Maintain list, reject + regenerate.
12. **Existing-patient misrouting.** Two-layer detection (tag check first — instant/free; Haiku classifier second — catches inbound text signals). Reply "let me have someone from the team jump in," tag `needs-human`, drop a note, stop.
13. **Shutoff tags ignored.** `do-not-message`, `call-booked`, `customer`, `human-takeover` → skip webhook entirely before any processing.
14. **Initial-touch sentinel confusion.** If webhook body equals `__INITIAL_TOUCH__`, send opener verbatim without calling Claude. Prevents Claude from being confused by a sentinel string.
15. **Idempotency on re-fires.** GHL can fire the same webhook twice. Dedupe on `{contactId}:{messageId}` in KV with 10-minute TTL. Also track `lastInboundGhlMessageId` in DO.

---

## Build process (step by step)

1. **Get source data from client:**
   - Approved verbatim answers to top 20-30 FAQs (they're the law)
   - Doctor/brand/team names, brand rules, spiritual or technical vocab
   - Banned phrases (things the team has explicitly said "never say")
   - List of existing-patient tags in their CRM
   - **Voice samples — 50-150 real conversations that converted.** Best input for voice matching.
2. **Analyze conversations.** Derive: opener structure, average reply length, rhythm/cadence, their actual vocabulary, objection patterns, when they invite to a call, how they handle stalls. Look for the "tells" that make this specific SDR sound like a person.
3. **Write the system prompt** (`prompts/<name>.ts`). Use llmd's `mia.v2.ts` as template. Keep universal voice rules. Replace client-specific sections.
4. **Build the FAQ library** (`prompts/faq.ts`). Use client's approved answers verbatim where possible. Add `notes` on when to use verbatim vs adapt.
5. **Write goal openers** — one per goal. 1-3 sentences each. No compound questions, no wellness claims.
6. **Build golden eval cases** (`evals/golden.ts`). One per failure pattern above + one per major FAQ. Each case has `mustContainAny` / `mustNotContain` / `rubric`.
7. **Customize the guardrail** — copy llmd's. Swap `STAFF_NAMES`, `CANONICAL_NAME`, `NAME_VARIANTS`, `WELLNESS_CLAIM_PATTERNS`. Add client-specific banned phrases.
8. **Run `audit-content.ts`** — ensures every FAQ/opener/objection passes the guardrail. Fix any rejections by rewriting the content, not loosening the guardrail.
9. **Run the eval harness** (Claude-in-the-loop). Must hit 100% before deploying. Any flaky cases are real signals — fix the prompt, don't relax the test.
10. **Deploy to Cloudflare Workers, wire GHL workflows.**
11. **Live adversarial testing.** Try to break every rule. Iterate.
12. **Ship to client team for testing** with `test-bot` tag. Listen carefully to what they flag as "sounds like a bot" — those are the next set of failure patterns.

---

## GHL workflow map (all clients)

- **Workflow 1 — First Touch.** 5-min delay after lead add → POST webhook with body `__INITIAL_TOUCH__` → opener sent verbatim.
- **Workflow 2 — Inbound Reply.** Customer Replied (SMS) → If/Else shutoff tags → POST webhook with inbound → Mia responds. 30s wait → end.
- **Workflow 3 — Shutoff.** On manual outbound SMS from team OR on shutoff tag add → stop all bot workflows on contact.
- **Workflow 4 — Follow-up Cadence.** +1d, +3d, +7d, +14d drips if no response and not shutoff.
- **Workflow 5 — Needs-Human Alert.** When tag `needs-human` is added, notify team (Slack/SMS/email).

---

## Starting a new session

When you start a new Claude Code session on a new client's bot:

1. Put this playbook at the repo root as `BUILD_PLAYBOOK.md`.
2. First user message: *"Read `BUILD_PLAYBOOK.md`. The client is [X]. Here's the voice source data: [Google Sheet / CSV / paste]. Build a voice-matched setter bot following the playbook."*
3. Ask the session to propose the system prompt structure first, before writing code, so you can review the voice direction.
4. Build FAQ + prompt + evals before touching infra (infra is boilerplate from the fork).
5. Run eval harness and `audit-content.ts` as the acceptance gate. Don't ship until both are clean.

---

## Key implementation pointers

- **Guardrail split: rewrites vs rejects.**
  - *Rewrites* (never fail): dashes, emoji strip, name normalization, summary label strip. Clean the text and pass.
  - *Rejects* (force regenerate): banned openers, banned phrases, staff names, wellness claims, repeated goal-menu, compound questions, link budget exceeded.
- **Retry loop:** max 3 attempts. Nudge prompt on each retry includes the specific rule broken, plus "one question maximum, no repeat of any goal-discovery question already asked."
- **Fallback on exhaust:** always ship, never silent-fail. Send "hmm good one, let me think on that real quick", add `needs-human` tag, dump every rejected draft with reason to a contact note. This gives us diagnostic data every time the bot can't land a compliant reply.
- **Prompt caching:** the full static system prompt + FAQ library is the cached block. Turn-level context (link budget, goal hint, us-confirmed, email-captured) is dynamic and cheap. This keeps per-turn cost low.
- **Existing-patient detection order:** tag check first (free, instant). Haiku classifier second (cheap, catches inbound text signals that tags miss).
- **Manual-outbound check must run AFTER DO load** — the DO has the ground truth set of bot-sent `ghlMessageId`s. Ordering matters.

---

## One-liner on why this exists

The rules in this doc are earned. Every banned phrase, every guardrail check, every failure pattern was a real thing we shipped and had to fix live. Start from this, don't rediscover it.
