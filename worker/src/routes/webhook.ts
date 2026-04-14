/**
 * Inbound SMS webhook from GHL.
 *
 * Shape expected (configure in GHL workflow "Webhook" action):
 *   {
 *     "type": "InboundMessage",
 *     "contactId": "...",
 *     "conversationId": "...",
 *     "messageId": "...",
 *     "messageType": "SMS",
 *     "body": "the inbound text",
 *     "phone": "+15555551212",
 *     "tags": ["test-bot", ...],
 *     "customData": { "goal": "...", "painPoint": "..." }
 *   }
 */

import { callClaude } from '../integrations/anthropic';
import {
  addTag,
  addContactNote,
  getContact,
  sendSms,
  wasManualOutboundRecent,
} from '../integrations/ghl';
import { MIA_V2_SYSTEM_PROMPT, buildTurnContext } from '../prompts/mia.v2';
import { renderFaqForPrompt } from '../prompts/faq';
import { applyGuardrail } from '../agents/guardrail';
import {
  classifyExistingPatient,
  extractEmail,
} from '../agents/classifier';
import { hasExistingPatientTag } from '../prompts/kb';
import type { MiaState, MiaMessage } from '../memory/ContactThread';
import type { Env } from '../env';

const BOT_SOURCE_MARKER = 'mia-bot-v2';
const SHUTOFF_TAGS = ['do-not-message', 'human-takeover', 'call-booked', 'customer'];
const ENGAGED_TAG = 'ai-bot-engaged';

const SYSTEM_CACHED = `${MIA_V2_SYSTEM_PROMPT}\n\n${renderFaqForPrompt()}`;

export async function handleInboundSms(req: Request, env: Env): Promise<Response> {
  const payload = (await req.json()) as any;

  // Signed webhook check (simple shared secret header).
  const sig = req.headers.get('x-ghl-webhook-secret');
  if (env.GHL_WEBHOOK_SECRET && sig !== env.GHL_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const contactId: string = payload.contactId;
  const inboundBody: string = (payload.body ?? '').trim();
  const inboundMessageId: string = payload.messageId;

  if (!contactId || !inboundBody) {
    return new Response('bad request', { status: 400 });
  }

  // ----- Idempotency -----
  const idemKey = `idem:${contactId}:${inboundMessageId}`;
  if (env.IDEMPOTENCY && (await env.IDEMPOTENCY.get(idemKey))) {
    return Response.json({ skipped: 'duplicate_webhook' });
  }
  if (env.IDEMPOTENCY) {
    await env.IDEMPOTENCY.put(idemKey, '1', { expirationTtl: 600 });
  }

  // ----- Shutoff tag guard -----
  const contact = await getContact(
    { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
    contactId,
  );
  const tags: string[] = contact.tags ?? [];
  if (SHUTOFF_TAGS.some((t) => tags.includes(t))) {
    return Response.json({ skipped: 'shutoff_tag_present', tags });
  }

  // ----- Recent manual SMS guard -----
  const manualDetected = await wasManualOutboundRecent(
    { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
    contactId,
    BOT_SOURCE_MARKER,
    600,
  );
  if (manualDetected) {
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      'human-takeover',
    );
    return Response.json({ skipped: 'manual_team_message_detected' });
  }

  // ----- Existing patient checks (tag first, then classifier) -----
  const tagBasedExisting = hasExistingPatientTag(tags);
  const isExisting =
    tagBasedExisting ||
    (await classifyExistingPatient(env.ANTHROPIC_API_KEY, inboundBody));
  if (isExisting) {
    await sendSms(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      {
        contactId,
        message: 'Got it, let me have someone from the team jump in with you here.',
      },
    );
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      'needs-human',
    );
    await addContactNote(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      `[Mia] Existing-patient signal detected. Inbound: "${inboundBody}". Team action needed.`,
    );
    return Response.json({ handled: 'existing_patient' });
  }

  // ----- Durable Object load/init -----
  const doId = env.CONTACT_THREAD.idFromName(contactId);
  const stub = env.CONTACT_THREAD.get(doId);

  const initRes = await stub.fetch('https://do/init', {
    method: 'POST',
    body: JSON.stringify({
      contactId,
      phone: payload.phone,
      goal: payload.customData?.goal,
      painPoint: payload.customData?.painPoint,
    }),
  });
  let state = (await initRes.json()) as MiaState;

  // ----- Build Claude call -----
  const turnCtx = buildTurnContext({
    linkSendCount: state.linkSendCount,
    goalFromManychat: state.goal,
    painPointFromManychat: state.painPoint,
    emailCaptured: state.emailCaptured,
    usConfirmed: state.usConfirmed,
  });

  const history = state.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  history.push({ role: 'user', content: inboundBody });

  let candidate = '';
  const maxAttempts = 2;
  let violations: string[] = [];
  let linkSentThisTurn = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const claudeRes = await callClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.MIA_MODEL || 'claude-sonnet-4-6',
      systemCached: SYSTEM_CACHED,
      systemDynamic: turnCtx,
      messages: history,
      maxTokens: 300,
      temperature: 0.8,
    });

    const guard = applyGuardrail({
      candidate: claudeRes.text,
      linkSendCountBefore: state.linkSendCount,
      isFirstMessage: !state.openerSent,
    });

    if (guard.ok) {
      candidate = guard.clean;
      violations = guard.violations;
      linkSentThisTurn = guard.linkSentThisTurn;
      break;
    } else {
      // Nudge the model to retry with the reason.
      history.push({
        role: 'user',
        content: `[system note] Your last draft violated a rule: ${guard.reason}. Rewrite following all rules.`,
      });
    }
  }

  if (!candidate) {
    // Guardrail never passed, let a human handle it.
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      'needs-human',
    );
    await addContactNote(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      `[Mia] Could not produce a compliant reply after ${maxAttempts} attempts. Last inbound: "${inboundBody}"`,
    );
    return Response.json({ skipped: 'guardrail_exhausted' });
  }

  // ----- Send -----
  const sent = await sendSms(
    { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
    { contactId, message: candidate },
  );

  // ----- Capture email if present -----
  const emailSeen = extractEmail(inboundBody);

  // ----- Persist to DO -----
  await stub.fetch('https://do/append', {
    method: 'POST',
    body: JSON.stringify({
      message: { role: 'user', content: inboundBody, at: Date.now(), ghlMessageId: inboundMessageId } as MiaMessage,
      lastInboundGhlMessageId: inboundMessageId,
      email: emailSeen,
    }),
  });
  await stub.fetch('https://do/append', {
    method: 'POST',
    body: JSON.stringify({
      message: { role: 'assistant', content: candidate, at: Date.now(), ghlMessageId: sent.messageId } as MiaMessage,
      linkSent: linkSentThisTurn,
      openerSent: true,
      newState: state.state === 'new' ? 'engaged' : undefined,
    }),
  });

  // Tag on first touch.
  if (!state.openerSent) {
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      ENGAGED_TAG,
    );
  }

  // ----- Analytics -----
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO turns (contact_id, inbound, outbound, link_sent, violations, at) VALUES (?, ?, ?, ?, ?, ?)',
      )
        .bind(
          contactId,
          inboundBody,
          candidate,
          linkSentThisTurn ? 1 : 0,
          JSON.stringify(violations),
          new Date().toISOString(),
        )
        .run();
    } catch (e) {
      // non-fatal
      console.error('d1 write failed', e);
    }
  }

  return Response.json({ handled: 'ok', sent: candidate, violations });
}
