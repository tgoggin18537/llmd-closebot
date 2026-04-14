# ghl-setup

Tools and instructions for bringing a GoHighLevel sub-account online with
Mia V2.

## One-time setup (per GHL sub-account)

### 1. Create a Private Integration token

GHL UI → Settings → Private Integrations → **Create new**. Scope the token
to ALL of:

- `locations/tags.readonly`
- `locations/tags.write`
- `contacts.readonly`
- `contacts.write`
- `contacts/tags.readonly`
- `contacts/tags.write`
- `conversations.readonly`
- `conversations/message.readonly`
- `conversations/message.write`
- `contacts/notes.write`

If you miss any, the setup script will tell you which are needed.

Copy the token. That's `GHL_API_KEY` in `.dev.vars`.

The Location ID is in Settings → Company → Location info (or the URL
`/location/<locationId>/...`). That's `GHL_LOCATION_ID`.

### 2. Run the setup script

From the repo root:

```sh
cd worker && npm install && cd ..
GHL_API_KEY=pk_...            \
GHL_LOCATION_ID=...            \
WORKER_URL=https://llmd-mia.<subdomain>.workers.dev \
  npx tsx ghl-setup/setup.ts
```

The script:
- Verifies the token can read the location.
- Creates any required tags that don't exist yet (`test-bot`,
  `ai-bot-engaged`, `needs-human`, `human-takeover`, `do-not-message`,
  `call-booked`, `existing-patient`, `long-term-nurture`).
- Reports which existing-patient product tags are already in the account
  (`tirzepatide`, `nad+`, `cjc+ipamorelin`, etc.).
- Pings the Worker's `/health` endpoint to confirm webhooks can reach it.

Pass `--dry-run` to preview without writing.

### 3. Build Workflows 1 through 5 in the GHL UI

Follow `docs/ghl-workflow-spec.md`. Everything the workflows reference
(tags, the Worker URL, the webhook secret header) will already exist
after step 2.

### 4. Test

Tag a test contact with `test-bot`, text the LLMD line, verify Mia
responds. Then adversarial-test with Lauren/Nicole until zero flags.
