/**
 * GHL setup script. Prepares the Limitless Living MD sub-account so the
 * workflow spec in docs/ghl-workflow-spec.md can be built without any
 * manual "does this tag exist?" trial-and-error.
 *
 * Usage:
 *   GHL_API_KEY=... GHL_LOCATION_ID=... WORKER_URL=https://llmd-mia.<sub>.workers.dev \
 *     npx tsx ghl-setup/setup.ts
 *
 * Optional flags:
 *   --dry-run     print actions without making changes
 *   --webhook     test webhook connectivity only
 *   --tags        manage tags only
 */

const BASE = 'https://services.leadconnectorhq.com';

type Env = {
  apiKey: string;
  locationId: string;
  workerUrl?: string;
  webhookSecret?: string;
};

const REQUIRED_TAGS = [
  { name: 'test-bot', purpose: 'Enables V2 only in test environment' },
  { name: 'ai-bot-engaged', purpose: 'Set by bot on first outbound' },
  { name: 'needs-human', purpose: 'Bot asked a human to take over' },
  { name: 'human-takeover', purpose: 'Team member wants the bot silent' },
  { name: 'do-not-message', purpose: 'Hard stop, never text' },
  { name: 'call-booked', purpose: 'Set when discovery call is booked' },
  { name: 'existing-patient', purpose: 'Prior purchase indicator' },
  { name: 'long-term-nurture', purpose: 'After 14d no reply, bot stops' },
];

// Product purchase tags that should be treated as existing-patient.
// These should already exist from commerce; we verify, not create.
const EXISTING_PATIENT_PRODUCT_TAGS = [
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
];

function headers(env: Env) {
  return {
    Authorization: `Bearer ${env.apiKey}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function listLocationTags(env: Env): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${BASE}/locations/${env.locationId}/tags`, {
    headers: headers(env),
  });
  if (!res.ok) {
    console.error(`listLocationTags failed: ${res.status} ${await res.text()}`);
    return [];
  }
  const data = (await res.json()) as any;
  return (data.tags ?? []).map((t: any) => ({ id: t.id, name: t.name }));
}

async function createLocationTag(env: Env, name: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`   [dry-run] would create tag: ${name}`);
    return;
  }
  const res = await fetch(`${BASE}/locations/${env.locationId}/tags`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    console.error(`   create failed for "${name}": ${res.status} ${await res.text()}`);
    return;
  }
  console.log(`   created tag: ${name}`);
}

// Note: GET /locations/{id} requires agency-scoped auth. Sub-account
// Private Integration tokens get 403 there. We use listLocationTags as
// the connectivity smoke test instead.

async function probeWebhook(env: Env): Promise<void> {
  if (!env.workerUrl) {
    console.log('skip webhook probe: WORKER_URL not set');
    return;
  }
  const url = `${env.workerUrl.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`webhook health OK at ${url}`);
    } else {
      console.error(`webhook health ${res.status} at ${url}`);
    }
  } catch (e: any) {
    console.error(`webhook health unreachable at ${url}: ${e.message}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const webhookOnly = args.has('--webhook');
  const tagsOnly = args.has('--tags');

  const env: Env = {
    apiKey: process.env.GHL_API_KEY ?? '',
    locationId: process.env.GHL_LOCATION_ID ?? '',
    workerUrl: process.env.WORKER_URL,
    webhookSecret: process.env.GHL_WEBHOOK_SECRET,
  };

  if (!env.apiKey || !env.locationId) {
    console.error('GHL_API_KEY and GHL_LOCATION_ID are required');
    process.exit(1);
  }

  console.log(`GHL setup for location ${env.locationId}${dryRun ? ' (DRY RUN)' : ''}`);

  if (!webhookOnly) {
    console.log('\n== Tags ==');
    let existing: Array<{ id: string; name: string }> = [];
    try {
      existing = await listLocationTags(env);
      console.log(`connected, ${existing.length} existing tags in this location`);
    } catch (e: any) {
      console.error(`Failed to list tags: ${e.message}`);
      console.error('Your Private Integration token is missing the required scope.');
      console.error('Add these scopes in GHL → Settings → Private Integrations:');
      console.error('  - locations/tags.readonly');
      console.error('  - locations/tags.write');
      console.error('  - contacts.readonly');
      console.error('  - contacts.write');
      console.error('  - contacts/tags.readonly');
      console.error('  - contacts/tags.write');
      console.error('  - conversations.readonly');
      console.error('  - conversations/message.readonly');
      console.error('  - conversations/message.write');
      console.error('  - contacts/notes.write');
      process.exit(1);
    }
    const existingNames = new Set(existing.map((t) => t.name.toLowerCase()));

    for (const t of REQUIRED_TAGS) {
      if (existingNames.has(t.name.toLowerCase())) {
        console.log(` ok  ${t.name}`);
      } else {
        console.log(` new ${t.name} (${t.purpose})`);
        await createLocationTag(env, t.name, dryRun);
      }
    }

    console.log('\n== Existing-patient product tag audit ==');
    for (const t of EXISTING_PATIENT_PRODUCT_TAGS) {
      if (existingNames.has(t.toLowerCase())) {
        console.log(` ok  ${t}`);
      } else {
        console.log(` --  ${t} not present (ok if you have no customers on it yet)`);
      }
    }
  }

  if (!tagsOnly) {
    console.log('\n== Webhook connectivity ==');
    await probeWebhook(env);
  }

  console.log('\nDone. Next: follow docs/ghl-workflow-spec.md to wire Workflows 1 through 5.');
}

// @ts-ignore allow direct execution under tsx
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('setup.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
