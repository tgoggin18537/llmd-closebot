# Architecture

```
    GHL (sub-account: Limitless Living MD, +18337154447)
      │
      │ Inbound SMS → workflow → webhook
      ▼
    ┌─────────────────────────────────────────┐
    │   Cloudflare Worker (llmd-mia)          │
    │                                         │
    │   POST /webhook/ghl/inbound-sms         │
    │     1. Auth (shared secret header)      │
    │     2. Idempotency check (KV)           │
    │     3. Load contact + tags (GHL API)    │
    │     4. Shutoff guard                    │
    │         - tags                          │
    │         - recent manual team outbound   │
    │     5. Existing-patient check           │
    │         - tag based                     │
    │         - Haiku classifier              │
    │     6. Load/init Durable Object         │
    │         (per-contact conversation)      │
    │     7. Claude Sonnet 4.6 reply          │
    │         (system prompt cached)          │
    │     8. Guardrail post-processor         │
    │         - no dashes                     │
    │         - name canonicalization         │
    │         - emoji cap                     │
    │         - banned openers                │
    │         - no staff names                │
    │         - link budget                   │
    │         - carrier-risk wellness phrases │
    │     9. Send SMS (GHL API)               │
    │    10. Persist to DO + D1               │
    │    11. Tag updates (ai-bot-engaged etc) │
    └─────────────────────────────────────────┘
      │
      ├── Durable Object: ContactThread (per contactId)
      │     - messages[]
      │     - state, goal, email, US confirmed
      │     - linkSendCount (budget = 2)
      │     - idempotency on inbound messageId
      │
      ├── D1: analytics (turns, evals)
      │
      └── KV: IDEMPOTENCY (webhook dedup, 10-min TTL)
```

## Model choices

| Job | Model | Why |
|---|---|---|
| Primary reply (Mia) | `claude-sonnet-4-6` | Fast enough for SMS, strong instruction following, prompt caching on a ~5k-token system |
| Existing-patient classifier | `claude-haiku-4-5-20251001` | Binary, ~50ms, cheap |
| Future: agreed-to-book / objection type | Haiku | Same |
| Hard conversations escalation | `claude-opus-4-6` | Reserve for cases the guardrail flags twice |

## Prompt caching

The system prompt = Mia persona + rules + FAQ library + objection library,
roughly 5k tokens. It is marked `cache_control: ephemeral` on every call.
After the first turn, each subsequent turn reads it from cache (~90% token
discount).

## Durable Object

Each contact gets one DO instance, keyed by GHL `contactId`. Serial
execution per contact prevents race conditions when GHL fires two webhooks
in quick succession. Also stores the idempotency key for the last inbound
message to reject duplicates at the DO layer (belt and suspenders with
the KV idempotency check in the Worker).

## Why not just use GHL Conversation AI?

V1 did. The feedback shows its limits:

- No programmable post-processing (dashes, name format, banned phrases)
- No real memory of the conversation state between turns (link budget)
- No way to run an eval harness against prompt changes
- No way to do existing-patient classification + internal alerts
- Limited model selection and no prompt caching

V2 moves the brain to Claude while keeping GHL as the comms spine.

## Out of scope for V2

- **Mode 2: post-call nurture (D+2 check-in).** Training data flags this as
  the single most conversion-critical message. Phase B.
- Email, voice, LinkedIn channels.
- Outbound cold SMS.
- Multi-tenant.
