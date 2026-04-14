# GHL Workflow Spec (Mia V2)

Click-by-click instructions for building the five workflows Mia depends
on. Do them in order. Everything lives in the **Limitless Living MD**
sub-account, SMS number **+1 833 715 4447**.

> Before starting: run `ghl-setup/setup.ts` once. It creates the required
> tags and verifies the Worker's `/health` endpoint is reachable. See
> `ghl-setup/README.md`.

## Shared settings you'll need

- **Worker URL**: `https://llmd-mia.<your-subdomain>.workers.dev`
- **Webhook endpoint**: `${WORKER_URL}/webhook/ghl/inbound-sms`
- **Webhook header**: `x-ghl-webhook-secret: <the value of GHL_WEBHOOK_SECRET secret>`
- **Bot SMS source marker**: Worker sends with source tag `mia-bot-v2`

## Tag map

| Tag | Who sets it | Effect |
|---|---|---|
| `test-bot` | Manual | Required during testing; production workflows should gate on this being ABSENT before going live, or on being PRESENT during test period |
| `ai-bot-engaged` | Bot | Mia has replied at least once |
| `needs-human` | Bot | Mia handed off (existing patient / guardrail exhausted) |
| `human-takeover` | Manual / auto | Bot must go silent |
| `do-not-message` | Manual | Hard stop |
| `call-booked` | Booking calendar | Shuts off all cadences |
| `customer` | Purchase automation | Shuts off all cadences |
| `existing-patient` | Bot / admin | Shuts off setter flow |
| `long-term-nurture` | Bot | +14d no reply, moves out of setter |

Product-purchase tags that also imply `existing-patient`: `cjc+ipamorelin`,
`nad+`, `tirzepatide`, `semaglutide`, `retatrutide`, `sermorelin`,
`bpc-157`, `tb-500`, `ghk-cu`.

---

## Workflow 1 — First Touch (5-minute delay)

Builds the protected window Nicole asked for (4/13 7:32 PM, section 1).

**Automation → Workflows → + Create Workflow → Start from scratch**

Name: **Mia · 01 First Touch**

### Triggers
- **Trigger 1**: *Contact Tag · Added* → Tag = `new-lead`
- **Trigger 2** (alternate entry): *Contact Created* (filter: has phone number)

### Steps
1. **Wait Event** → *Time Delay* = 5 minutes
2. **If/Else** — condition A (any true):
   - Contact has tag `call-booked`
   - Contact has tag `customer`
   - Contact has tag `human-takeover`
   - Contact has tag `do-not-message`
   - Contact has tag `existing-patient`
   - Contact has any of the product-purchase tags above
   → **Yes** branch → end workflow
3. **If/Else** — condition B:
   - *Conversation has outbound message in last 5 minutes from User (not from API/workflow)*
   (In GHL: use "Check Conversation" filter, scope to Outbound, Time window 5 min, Sent by = non-bot users)
   → **Yes** branch → Add Tag `human-takeover`, end workflow
4. **Webhook (Custom Webhook action)**
   - Method: `POST`
   - URL: `${WORKER_URL}/webhook/ghl/inbound-sms`
   - Headers: `x-ghl-webhook-secret: {{custom_values.ghl_webhook_secret}}`
   - Body (JSON):
     ```json
     {
       "type": "InitialTouch",
       "contactId": "{{contact.id}}",
       "messageId": "initial-{{contact.id}}-{{workflow.execution_id}}",
       "messageType": "SMS",
       "body": "__INITIAL_TOUCH__",
       "phone": "{{contact.phone}}",
       "tags": "{{contact.tags}}",
       "customData": {
         "goal": "{{contact.goal}}",
         "painPoint": "{{contact.pain_point}}"
       }
     }
     ```
5. **Add Contact Tag** → `ai-bot-engaged`
6. **End**

> Store the webhook secret once in Settings → Custom Values as
> `ghl_webhook_secret` so you never paste it into workflow steps.

---

## Workflow 2 — Inbound Reply

Routes any lead reply to Mia. Independent of Workflow 1.

**Automation → Workflows → + Create Workflow → Start from scratch**

Name: **Mia · 02 Inbound Reply**

### Trigger
- *Customer Replied* → Channel = SMS

### Steps
1. **If/Else** — any true:
   - Contact has tag `call-booked`
   - Contact has tag `customer`
   - Contact has tag `human-takeover`
   - Contact has tag `do-not-message`
   - Contact has tag `existing-patient`
   - Contact has any product-purchase tag
   → **Yes** branch → end
2. **Webhook (Custom Webhook action)**
   - Method: `POST`
   - URL: `${WORKER_URL}/webhook/ghl/inbound-sms`
   - Headers: `x-ghl-webhook-secret: {{custom_values.ghl_webhook_secret}}`
   - Body:
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
3. **Wait Event** → 30 seconds (dedup guard against GHL re-triggers; the
   Worker is also idempotent on `{contactId, messageId}`)
4. **End**

---

## Workflow 3 — Shutoff

Any time the conversation becomes a human's job, cancel Mia cleanly.

**Automation → Workflows → + Create Workflow → Start from scratch**

Name: **Mia · 03 Shutoff**

### Triggers (any one fires)
- Contact Tag Added: `call-booked`
- Contact Tag Added: `customer`
- Contact Tag Added: `human-takeover`
- Contact Tag Added: `do-not-message`
- Contact Tag Added: `existing-patient`
- Contact Tag Added: any product-purchase tag (`tirzepatide`, `semaglutide`, `cjc+ipamorelin`, `nad+`, `retatrutide`, `sermorelin`, `bpc-157`, `tb-500`, `ghk-cu`)
- *Conversation Outbound Message Sent* → Sent by = Team Member (not API)

### Steps
1. **Remove Contact Tag** → `ai-bot-engaged`
2. **Cancel Workflow** → *Mia · 04 Follow-up Cadence* (if active for this contact)
3. **Create Contact Note** → body: *"Mia disengaged (trigger: {{trigger.name}})."*
4. **End**

---

## Workflow 4 — Follow-up Cadence

Nicole's +1d / +3d / +7d / +14d schedule. All message bodies obey Mia's
voice rules (no dashes, no emojis, no wellness claims).

**Automation → Workflows → + Create Workflow → Start from scratch**

Name: **Mia · 04 Follow-up Cadence**

### Trigger
- Contact Tag Added: `ai-bot-engaged`

### Steps
1. **Wait Event** → 1 day
2. **If/Else** — still engaged (tag `ai-bot-engaged` present AND no inbound message since workflow start) → Yes continue, No → end
3. **Send SMS**:
   > Hey, no rush, just wanted to check if you had any other questions floating around.
4. **Wait Event** → 2 days (total +3)
5. **If/Else** — same check → else end
6. **Send SMS**:
   > Quick thing in case it's useful. Most people I talk to think peptides work like supplements, but they actually signal your cells to do specific things like burn fat or repair tissue. That's why they tend to work when other stuff hasn't.
7. **Wait Event** → 4 days (total +7)
8. **If/Else** — same check → else end
9. **Send SMS**:
   > Last one from me, no pressure at all. If you ever want to chat with the team about what might fit, here's the link: limitlesslivingmd.com/discovery. Hope you find what works for you.
10. **Wait Event** → 7 days (total +14)
11. **If/Else** — same check → else end
12. **Remove Contact Tag** → `ai-bot-engaged`
13. **Add Contact Tag** → `long-term-nurture`
14. **End**

> Carrier safety: all three bodies intentionally avoid wellness-claim
> phrasing ("you deserve to feel clear, energized, and balanced" style).
> That phrase was blocked with Error 30007 on the old automated
> no-show SMS. If you change these bodies, keep them factual and light.

---

## Workflow 5 — Existing-Patient / Handoff Alert

Surfaces to the team when Mia decides a human is needed.

**Automation → Workflows → + Create Workflow → Start from scratch**

Name: **Mia · 05 Needs-Human Alert**

### Trigger
- Contact Tag Added: `needs-human`

### Steps
1. **Internal Notification** → Send Email
   - To: `lauren@limitlesslivingmd.com`
   - CC: `info@limitlesslivingmd.com`
   - Subject: *Mia flagged a conversation, needs human takeover*
   - Body: Contact {{contact.first_name}} {{contact.last_name}} ({{contact.phone}}). Open: `https://app.gohighlevel.com/v2/location/{{location.id}}/contacts/detail/{{contact.id}}`
2. **Internal Notification** → Push (optional, to Lauren's mobile app)
3. **Create Task** → Assignee: Lauren → Title: *Take over SMS conversation* → Due: today
4. **End**

---

## Duplicate-message prevention

Lauren reported Mia sending the same response twice on 4/14.

**Three layers of defense:**

1. **GHL workflow layer** — Workflow 2 Step 3 inserts a 30-second wait
   before completing, which prevents fast re-triggers on the same
   `message.id` from firing the webhook twice.
2. **Worker KV idempotency** — on receipt, the Worker stores
   `idem:{contactId}:{messageId}` in KV with a 10-minute TTL and refuses
   to process a duplicate.
3. **Durable Object check** — the per-contact DO tracks
   `lastInboundGhlMessageId` and rejects appends for the same id.

If duplicates still occur, check:
- **GHL execution logs** for the contact. If the same `message.id`
  triggered two executions of Workflow 2, the trigger is too broad.
- **Multiple workflows firing** on the same inbound (e.g. an older bot
  workflow still enabled alongside Workflow 2). Disable the duplicates.

---

## Test checklist

Use a test contact tagged `test-bot`.

- [ ] Text the LLMD line from a fresh number, confirm first touch fires exactly once after 5-minute delay
- [ ] Confirm `ai-bot-engaged` tag applied after first touch
- [ ] Reply to the bot; confirm reply is processed exactly once (check GHL execution log)
- [ ] Add `human-takeover` tag mid-conversation; send another inbound; confirm Mia does NOT reply
- [ ] Add `tirzepatide` tag on a test contact; send inbound; confirm `needs-human` is applied and Workflow 5 fires the email
- [ ] Let a test contact go silent 24h, confirm +1d message fires
- [ ] Run `npm run eval` in `worker/` — all 13 golden cases pass
