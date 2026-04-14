# GHL Workflow Spec (for Lauren / Nicole / GHL admin)

This document is the source of truth for the GoHighLevel automations Mia V2
depends on. The Worker handles message content; GHL handles triggers, timers,
tags, and shutoffs.

Everything below uses sub-account **Limitless Living MD**, SMS number
**+1 833 715 4447**.

---

## Global tag map

Create these contact tags if they do not already exist:

| Tag | Owner | Purpose |
|---|---|---|
| `test-bot` | manual | Enables V2 in the test environment only |
| `ai-bot-engaged` | bot | Set when Mia sends her first message |
| `needs-human` | bot | Bot asked a human to take over (existing patient, guardrail exhausted) |
| `human-takeover` | manual | Team member wants to take over — bot goes silent |
| `do-not-message` | manual | Hard stop. Never text again. |
| `call-booked` | workflow | Set when a discovery call is booked |
| `customer` | workflow | Set when a purchase is made |
| `existing-patient` | manual/bot | Any prior-purchase indicator |

Existing product-purchase tags already in GHL that should be treated as
`existing-patient` by Mia: `cjc+ipamorelin`, `nad+`, `tirzepatide`,
`semaglutide`, `retatrutide`, `sermorelin`, `bpc-157`, `tb-500`, `ghk-cu`.

---

## Workflow 1 — New inbound lead, first touch

**Trigger:** Contact phone number added OR tag `new-lead` added.

**Steps:**
1. **Wait 5 minutes.**
2. **If/else: Contact has any of** `call-booked`, `customer`, `human-takeover`, `do-not-message`, `existing-patient`, or any product-purchase tag → exit.
3. **If/else: Any outbound SMS sent by a team member to this contact in the last 5 minutes →** add tag `human-takeover` and exit. (This catches "Lauren jumped in manually.")
4. **Webhook:** POST `https://llmd-mia.<your-subdomain>.workers.dev/webhook/ghl/inbound-sms` with body:
   ```json
   {
     "type": "InitialTouch",
     "contactId": "{{contact.id}}",
     "messageId": "initial-{{contact.id}}-{{workflow.execution_id}}",
     "messageType": "SMS",
     "body": "__INITIAL_TOUCH__",
     "phone": "{{contact.phone}}",
     "tags": "{{contact.tags}}",
     "customData": { "goal": "{{contact.goal}}", "painPoint": "{{contact.pain_point}}" }
   }
   ```
   Include header `x-ghl-webhook-secret: <GHL_WEBHOOK_SECRET>`.
5. **Add tag** `ai-bot-engaged`.

---

## Workflow 2 — Inbound SMS reply from a lead

**Trigger:** Customer replies (SMS inbound).

**Steps:**
1. **If/else: Contact has any of** `call-booked`, `customer`, `human-takeover`, `do-not-message`, `existing-patient`, or any product-purchase tag → exit. (These conversations are for humans.)
2. **Webhook:** POST same endpoint as above, body:
   ```json
   {
     "type": "InboundMessage",
     "contactId": "{{contact.id}}",
     "messageId": "{{message.id}}",
     "messageType": "SMS",
     "body": "{{message.body}}",
     "phone": "{{contact.phone}}",
     "tags": "{{contact.tags}}"
   }
   ```
3. **Wait 30 seconds.** Deduplication guard; prevents fast re-trigger from double-firing. Worker itself is idempotent on `(contactId, messageId)`, this just reduces noise.

---

## Workflow 3 — Bot shutoff on state change

**Trigger:** Any of:
- Tag added: `call-booked`, `customer`, `human-takeover`, `do-not-message`, `existing-patient`
- Any product-purchase tag added
- Team member sends an outbound SMS on this contact

**Steps:**
1. **Remove tag** `ai-bot-engaged`.
2. **Cancel** any contact workflow named `Mia followup`.
3. (Optional) Post a contact Note: "Mia disengaged due to <trigger>."

---

## Workflow 4 — Mia follow-up cadence

**Trigger:** Tag `ai-bot-engaged` added.

**Steps:**

1. **Wait 1 day.** Goto step 2 only if contact has NOT received an inbound SMS since engagement started AND still has `ai-bot-engaged`.
   - **Send SMS:** *"Hey, no rush, just wanted to check if you had any other questions floating around."*
2. **Wait 2 more days (= +3 days from engagement).** Same conditions.
   - **Send SMS:** *"Quick thing in case it's useful. Most people I talk to think peptides work like supplements, but they actually signal your cells to do specific things like burn fat or repair tissue. That's why they tend to work when other stuff hasn't."*
3. **Wait 4 more days (= +7 days).** Same conditions.
   - **Send SMS:** *"Last one from me, no pressure at all. If you ever want to chat with the team about what might fit, here's the link: limitlesslivingmd.com/discovery. Hope you find what works for you."*
4. **Wait 7 more days (= +14 days).** Same conditions.
   - **Remove tag** `ai-bot-engaged`.
   - **Add tag** `long-term-nurture`.

Any inbound reply, booked call, or purchase cancels the rest of this
workflow (Workflow 3 handles the cancel).

**Message body rules:** no em dashes, no en dashes, no emojis, no wellness
claim phrasing ("you deserve to feel clear, energized, and balanced"
style — this got carrier blocked on previous runs, error 30007).

---

## Workflow 5 — Existing patient alert

**Trigger:** Tag `needs-human` added (set by the Worker).

**Steps:**
1. **Internal Notification:** send email + push to Lauren (and Cloie as backup): subject *"Mia flagged an existing patient reply"*, body links to the conversation in GHL.
2. Optionally assign a task to Lauren: *"Take over this conversation, Mia has disengaged."*

---

## Duplicate-message bug mitigation

Lauren reported Mia sending the same response twice (4/14 11:10). Causes +
fixes:

- **GHL cause:** workflow re-triggered on the same inbound (e.g. contact
  was edited, or the workflow has multiple triggers). Fix: ensure
  Workflow 2 has exactly one trigger (Customer Replied, SMS inbound) and
  step 3 inserts a 30s wait gate.
- **Worker cause:** covered by idempotency on `(contactId, messageId)`
  in KV with 10-minute TTL.
- **Belt and suspenders:** the Durable Object itself also checks
  `lastInboundGhlMessageId` before processing.

If duplicates still occur in testing, check the GHL workflow execution
logs for duplicate executions against the same `message.id`, and verify
`X-GHL-Webhook-Secret` is being sent on exactly one workflow (not two).

---

## Test plan

1. Set `test-bot` tag on a test contact.
2. Text the LLMD line (+1 833 715 4447) to simulate inbound.
3. Verify Workflow 2 fires exactly once.
4. Verify Mia responds within 5 seconds.
5. Verify `ai-bot-engaged` is applied (first touch only).
6. Add `human-takeover` tag mid-conversation. Send another inbound. Verify Mia does NOT reply.
7. Add a purchase-tag like `tirzepatide`. Send another inbound. Verify `needs-human` is set and Mia replies with the single handoff line.
8. Test the 13 golden eval cases in `worker/src/evals/golden.ts`.
9. Let it sit a day; verify Workflow 4 fires the +1 day message with no dashes, no emojis, and correct wording.
