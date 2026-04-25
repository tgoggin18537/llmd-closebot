# Limitless Living MD SMS Bot (Ava) — V3 Handoff

**For Nicole**
**Date: April 25, 2026**
**Status: V3 complete and deployed to production**

---

## What V3 ships with

**3.3x improvement in voice match.** The bot now sounds materially more like Janice and Lauren than V2 did, validated against your real team conversations.

| Metric | V2 baseline | V3 result |
|---|---|---|
| Voice match (sounds like the team, not a bot) | 27% | 88% |
| Read-the-room (answers what was actually asked) | 61% | 71% |
| Format hygiene (length, formatting, no AI tells) | 75% | 81% |
| Pairwise vs real team replies | bot wins 1 of 6 | bot wins 3 of 6, ties 2 |

These numbers come from a 51-case automated eval suite that compares Ava's replies against your actual team replies (Lauren, Janice, Erin) on the same inbound, with both an LLM judge and a side-by-side human-comparison test.

## What Ava can do now that V2 couldn't

1. **Send the qualification checklist** before booking, exactly like Janice does (✅ USA, ✅ wellness goal, ✅ subcutaneous injections, ✅ $300-$500 budget). Filters out leads who can't be served BEFORE they take the specialist's time.

2. **Skip the qualification when a lead asks for the link directly.** "Send me the link" goes straight to the US check + email ask, no friction.

3. **Detect soft declines** ("no thanks," "not interested," "I changed my mind") and respond with one warm exit message + auto-tag the contact `do-not-message` so the bot won't keep messaging them. Previously these slipped through and the bot kept engaging.

4. **Handle pushback gracefully.** When a lead says "thinking about it" or "not ready," Ava acknowledges warmly with zero questions and zero re-pitch, even on subsequent factual questions.

5. **Route pregnancy/TTC questions correctly.** "I'm pregnant, is this safe?" now gets routed to "talk to your OB" — NOT pitched a discovery call as the bot would have done before.

6. **Ban the cold-blast SDR cliches** that drove your STOP rate (analysis of your March-April conversations showed roughly 60% STOP rate on the templated opener language). Ava avoids those phrases entirely.

7. **Avoid leaking model self-talk into messages.** Edge cases where the bot was outputting things like "Wait, no emoji after the first message. Let me redo this." are now silently extracted before send.

## What's in production right now

- Bot is deployed to Cloudflare Workers under your account
- Persona name is **Ava** (renamed from Mia)
- Connected to your GHL sub-account via the GHL Private Integration token
- Webhook signature verification enabled
- All shutoff tags respected (`do-not-message`, `human-takeover`, `call-booked`, `customer`, `setter | not interested`)
- Manual outbound detection (if your team texts a contact, Ava stops automatically)
- Idempotency on duplicate webhook fires
- Rate limit retry-with-backoff (handles bursts gracefully)
- Per-contact conversation memory in Cloudflare Durable Objects
- Analytics logged to D1 database

## What you need to do for full handoff

### 1. Verify the GHL setup (15 min)

Open GHL → switch to LLMD sub-account → Workflows. Confirm:

- **Workflow that fires the cold opener** sends `__INITIAL_TOUCH__` as the body to the bot's webhook (or sends the team's actual cold blast and lets Ava pick up from the lead's reply). Either pattern works.
- **Inbound Reply workflow** (Customer Replied → SMS) calls the webhook with the lead's actual message body.
- **STOP handling workflow** tags the contact `do-not-message` whenever a STOP is received. This is what stops Ava from re-engaging.
- The webhook in each workflow includes a custom header `x-ghl-webhook-secret` matching the value in your Cloudflare secrets.

### 2. Test with one contact (10 min)

- Add the tag `test-bot` to a contact you control (your phone)
- Text the GHL number from that phone, see how Ava replies
- Try a few scenarios: ask a price question, push back, say "yes", say "no thanks"
- If the replies sound right, remove `test-bot` and let it run live
- If anything is off, take screenshots and send them to Thomas

### 3. Watch the first 48 hours (passive)

- Check GHL conversations daily for the first 2 days
- Look for any conversation with a `needs-human` tag, those are flagged for your team to handle
- If you see Ava saying something off-brand, screenshot it and send to Thomas

### 4. Long term (ongoing, no action needed)

- D1 analytics tracks every turn (inbound, outbound, link sent, guardrail violations)
- Soft-decline classifier auto-tags `do-not-message` for natural-language declines
- Booking link budget caps at 2 sends per conversation (no spam)

## What's NOT included in V3 (available as add-ons)

If you want any of these, they're separate scope at the prices below. All hours are mine; Anthropic API costs (~$10-30/mo at your volume) are on you regardless.

| Add-on | Description | Price |
|---|---|---|
| **Continued voice iteration** | Push voice match from 88% to 95%+ via more eval cycles + prompt refinement | $500 / cycle |
| **Production monitoring (1 week)** | I sample 50-100 of your real conversations weekly, run them through the eval judge, send you a Friday report on what's drifting | $750 / week |
| **Follow-up cadence wiring** | Hook up the day-1 / day-3 / day-7 / day-14 drip sequences in Ava's voice | $500 |
| **Post-call nurture mode (Mode 2)** | Currently Ava only handles pre-call setter conversations. Add Lauren-style post-call check-ins (the "D+2" message that the training data showed as conversion-critical) | $1,500 |
| **New scenario additions** | Adding a custom flow (e.g. "abandoned cart bridge", "no-show recovery") | $250 / scenario |
| **Monthly retainer** | I monitor + iterate weekly, you have a Slack/email line for any questions, I handle Anthropic billing | $800 / month |
| **Fork for another clinic** | Use the V3 playbook to build a voice-matched bot for another practice | $3,000 base |

## How to reach me

Same channel we used to build V3. Reply on Upwork or the email I used during the build.

If something breaks at 2 AM and you need to disable Ava fast: tag any contact `do-not-message` to stop her individually, or add `human-takeover` to all in-progress contacts. To kill the whole bot: pause the GHL "Inbound Reply" workflow.

---

**Bottom line:** Ava V3 is a meaningful step up from V2 and competitive with your actual team in side-by-side voice testing. She's deployed, tested, and the eval pipeline catches regressions if anything changes. Pay out the $1,500 contract and she's yours.

If you want to push further, the add-ons above are how. Otherwise, monitor for a week and let me know how it lands.

Thomas
