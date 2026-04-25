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

import { runClaudeWithGuardrailRetry } from '../agents/respond';
import {
  addTag,
  addContactNote,
  getContact,
  sendSms,
  wasManualOutboundRecent,
} from '../integrations/ghl';
import { AVA_V2_SYSTEM_PROMPT, buildTurnContext } from '../prompts/ava.v2';
import { renderFaqForPrompt } from '../prompts/faq';
import {
  classifyExistingPatient,
  classifySoftDecline,
  extractEmail,
  SOFT_DECLINE_REPLY,
} from '../agents/classifier';
import { hasExistingPatientTag } from '../prompts/kb';
import type { AvaState, AvaMessage, PendingMessage } from '../memory/ContactThread';
import type { Env } from '../env';

const SHUTOFF_TAGS = ['do-not-message', 'human-takeover', 'call-booked', 'customer'];
const ENGAGED_TAG = 'ai-bot-engaged';

const OPENER =
  "Hey! This is Ava with Dr. Samuel B. Lee MD's office at Limitless Living MD. 🙂 Saw you were checking us out. What are you hoping to work on, weight loss, energy, sleep, recovery, something else?";

const SYSTEM_CACHED = `${AVA_V2_SYSTEM_PROMPT}\n\n${renderFaqForPrompt()}`;

/**
 * Resolve a stable, non-empty messageId from the GHL webhook payload.
 * GHL has shipped multiple payload shapes over time and at least one
 * client workflow sends `messageId: null`. We try the documented field
 * first, then known aliases, then fall back to a synthetic sha256 of
 * (contactId + body + minute-bucket) so dedup still works for a 60s
 * window even when GHL gives us nothing usable.
 */
async function resolveInboundMessageId(
  payload: any,
  contactId: string,
  body: string,
  receivedAt: number,
): Promise<{ id: string; source: string }> {
  const candidates: Array<[string, unknown]> = [
    ['payload.messageId', payload?.messageId],
    ['payload.id', payload?.id],
    ['payload.message?.id', payload?.message?.id],
    ['payload.ghlMessageId', payload?.ghlMessageId],
  ];
  for (const [src, c] of candidates) {
    if (typeof c === 'string' && c.length > 0) return { id: c, source: src };
  }
  // Synthetic fallback: stable for the same (contact, body, minute) triple.
  const minute = Math.floor(receivedAt / 60_000);
  const seed = `${contactId}:${body}:${minute}`;
  const buf = new TextEncoder().encode(seed);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { id: `synthetic-${hex}`, source: 'synthetic' };
}

export async function handleInboundSms(req: Request, env: Env): Promise<Response> {
  const payload = (await req.json()) as any;

  // Signed webhook check (simple shared secret header).
  const sig = req.headers.get('x-ghl-webhook-secret');
  if (env.GHL_WEBHOOK_SECRET && sig !== env.GHL_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  // TODO(remove-after-diagnosis): one-shot full-body trace so we can see
  // exactly what GHL is sending. Strip once messageId source is confirmed.
  console.log(`[webhook-body-debug] ${JSON.stringify(payload)}`);

  const contactId: string = payload.contactId;
  const inboundBody: string = (payload.body ?? '').trim();

  if (!contactId || !inboundBody) {
    return new Response('bad request', { status: 400 });
  }

  const receivedAt = Date.now();
  const resolved = await resolveInboundMessageId(payload, contactId, inboundBody, receivedAt);
  const inboundMessageId: string = resolved.id;
  console.log(
    `[webhook-msgid] contact=${contactId} resolvedId=${inboundMessageId} source=${resolved.source}`,
  );

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
  const leadFirstName: string | undefined = contact.firstName ?? contact.first_name;
  if (SHUTOFF_TAGS.some((t) => tags.includes(t))) {
    return Response.json({ skipped: 'shutoff_tag_present', tags });
  }

  // ----- Durable Object load/init (moved up so manual-outbound check can
  //       use the set of bot-sent messageIds as ground truth) -----
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
  let state = (await initRes.json()) as AvaState;

  // ----- Recent manual SMS guard -----
  // We know which outbound messageIds Ava herself sent (persisted in the DO).
  // If any outbound in the window has an id NOT in that set, a human teammate
  // sent it from the inbox and Ava should stay quiet.
  const botGhlMessageIds = new Set<string>(
    state.messages
      .filter((m) => m.role === 'assistant' && !!m.ghlMessageId)
      .map((m) => m.ghlMessageId as string),
  );
  const manualDetected = await wasManualOutboundRecent(
    { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
    contactId,
    botGhlMessageIds,
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
      `[Ava] Existing-patient signal detected. Inbound: "${inboundBody}". Team action needed.`,
    );
    return Response.json({ handled: 'existing_patient' });
  }

  // ----- Initial-touch short-circuit -----
  // Workflow 1 fires the 5-minute-after-add SMS by POSTing body=__INITIAL_TOUCH__.
  // Send the opener verbatim, do not call Claude on a sentinel string.
  if (inboundBody === '__INITIAL_TOUCH__') {
    if (state.openerSent) {
      return Response.json({ skipped: 'opener_already_sent' });
    }
    const sent = await sendSms(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      { contactId, message: OPENER },
    );
    await stub.fetch('https://do/append', {
      method: 'POST',
      body: JSON.stringify({
        message: { role: 'assistant', content: OPENER, at: Date.now(), ghlMessageId: sent.messageId } as AvaMessage,
        openerSent: true,
        newState: 'engaged',
      }),
    });
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      ENGAGED_TAG,
    );
    return Response.json({ handled: 'initial_touch', sent: OPENER });
  }

  // ----- Direct-inbound opener short-circuit -----
  // Lead texted directly without going through the __INITIAL_TOUCH__ workflow.
  // Send the scripted opener verbatim so the conversation always starts the
  // same way. Claude handles all subsequent turns after openerSent=true.
  if (!state.openerSent) {
    const sent = await sendSms(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      { contactId, message: OPENER },
    );
    await stub.fetch('https://do/append', {
      method: 'POST',
      body: JSON.stringify({
        message: { role: 'user', content: inboundBody, at: Date.now(), ghlMessageId: inboundMessageId } as AvaMessage,
      }),
    });
    await stub.fetch('https://do/append', {
      method: 'POST',
      body: JSON.stringify({
        message: { role: 'assistant', content: OPENER, at: Date.now(), ghlMessageId: sent.messageId } as AvaMessage,
        openerSent: true,
        newState: 'engaged',
      }),
    });
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      ENGAGED_TAG,
    );
    return Response.json({ handled: 'direct_inbound_opener', sent: OPENER });
  }

  // ----- Soft-decline check (catches "no thanks" / "not interested" without literal STOP) -----
  // Carrier-level STOP is handled by the do-not-message tag at the top of this
  // function. This catches the natural-language declines that don't trigger
  // carrier unsubscribe but still mean the lead wants out. Sends one warm
  // acknowledgment, tags do-not-message so future inbounds skip immediately.
  const isSoftDecline = await classifySoftDecline(env.ANTHROPIC_API_KEY, inboundBody);
  if (isSoftDecline) {
    const sentDecline = await sendSms(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      { contactId, message: SOFT_DECLINE_REPLY },
    );
    await addTag(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      'do-not-message',
    );
    await addContactNote(
      { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
      contactId,
      `[Ava] Soft-decline detected. Inbound: "${inboundBody}". Sent warm exit, tagged do-not-message.`,
    );
    // Persist both turns to DO so the thread history reflects what happened.
    await stub.fetch('https://do/append', {
      method: 'POST',
      body: JSON.stringify({
        message: { role: 'user', content: inboundBody, at: Date.now(), ghlMessageId: inboundMessageId } as AvaMessage,
        lastInboundGhlMessageId: inboundMessageId,
      }),
    });
    await stub.fetch('https://do/append', {
      method: 'POST',
      body: JSON.stringify({
        message: { role: 'assistant', content: SOFT_DECLINE_REPLY, at: Date.now(), ghlMessageId: sentDecline.messageId } as AvaMessage,
      }),
    });
    return Response.json({ handled: 'soft_decline', sent: SOFT_DECLINE_REPLY });
  }

  // ----- Claim per-contact in-flight lock (rapid-fire batching) -----
  // From here on we hold the lock until /release. Concurrent webhooks for
  // the same contact will queue into pendingMessages and we'll drain them
  // in the loop below up to MAX_DEPTH passes.
  const claimRes = await stub.fetch('https://do/claim', {
    method: 'POST',
    body: JSON.stringify({
      messageId: inboundMessageId,
      body: inboundBody,
      receivedAt: Date.now(),
    }),
  });
  const claim = (await claimRes.json()) as
    | { duplicate: true }
    | { claimed: false; queued: true; pendingCount: number }
    | { claimed: true; messagesToProcess: PendingMessage[]; staleRecovered?: boolean };
  if ('duplicate' in claim && claim.duplicate) {
    return Response.json({ skipped: 'duplicate_inbound_via_claim' });
  }
  if ('queued' in claim && claim.queued) {
    return Response.json({ queued: true, pendingCount: claim.pendingCount });
  }

  // We hold the lock. Drain loop.
  let messagesToProcess: PendingMessage[] = (claim as {
    claimed: true;
    messagesToProcess: PendingMessage[];
  }).messagesToProcess;
  const MAX_DEPTH = 3;
  let depth = 0;
  let succeeded = false;
  let lastResponse: Response | null = null;
  const maxAttempts = 3;

  try {
    while (messagesToProcess.length > 0 && depth < MAX_DEPTH) {
      depth++;
      const isFirstPass = depth === 1;

      // Re-load state so each drain pass sees the prior pass's appended turns.
      const stateRes = await stub.fetch('https://do/get');
      const currentState = (await stateRes.json()) as AvaState;

      const turnCtx = buildTurnContext({
        linkSendCount: currentState.linkSendCount,
        goalFromManychat: currentState.goal,
        painPointFromManychat: currentState.painPoint,
        emailCaptured: currentState.emailCaptured,
        usConfirmed: currentState.usConfirmed,
      });
      const history = currentState.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      // Append every messagesToProcess as a separate user turn (Option 1).
      // The new prompt rule 7 instructs Claude to respond to the most recent
      // SUBSTANTIVE message and ignore filler pokes ("?", "hello").
      for (const msg of messagesToProcess) {
        history.push({ role: 'user', content: msg.body });
      }

      const respondRes = await runClaudeWithGuardrailRetry({
        apiKey: env.ANTHROPIC_API_KEY,
        model: env.AVA_MODEL || 'claude-sonnet-4-6',
        systemCached: SYSTEM_CACHED,
        systemDynamic: turnCtx,
        messages: history,
        linkSendCountBefore: currentState.linkSendCount,
        isFirstMessage: !currentState.openerSent,
        priorAssistantMessages: currentState.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => m.content),
        maxAttempts,
      });
      const candidate = respondRes.candidate;
      const violations = respondRes.violations;
      const linkSentThisTurn = respondRes.linkSentThisTurn;
      const attemptLog = respondRes.attemptLog;

      const processedIds = messagesToProcess.map((m) => m.messageId);
      const inboundForLog = messagesToProcess.map((m) => m.body).join(' || ');

      if (!candidate) {
        // Guardrail never passed after N attempts. Static fallback + needs-human.
        const FALLBACK = "hey let me grab the right person for this, one sec";
        const sentFallback = await sendSms(
          { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
          { contactId, message: FALLBACK },
        );
        await addTag(
          { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
          contactId,
          'needs-human',
        );
        const draftDump = attemptLog
          .map((a, i) => `  attempt ${i + 1}${a.reason ? ` (rejected: ${a.reason})` : ''}:\n    ${a.draft}`)
          .join('\n');
        await addContactNote(
          { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
          contactId,
          `[Ava] Guardrail exhausted after ${maxAttempts} attempts. Sent fallback "${FALLBACK}". Inbound: "${inboundForLog}".\nDrafts:\n${draftDump}`,
        );
        for (const msg of messagesToProcess) {
          await stub.fetch('https://do/append', {
            method: 'POST',
            body: JSON.stringify({
              message: { role: 'user', content: msg.body, at: msg.receivedAt, ghlMessageId: msg.messageId } as AvaMessage,
            }),
          });
        }
        await stub.fetch('https://do/append', {
          method: 'POST',
          body: JSON.stringify({
            message: { role: 'assistant', content: FALLBACK, at: Date.now(), ghlMessageId: sentFallback.messageId } as AvaMessage,
          }),
        });
        // Finalize: release lock, leave any newly-queued pending for the
        // next inbound (with needs-human tag, unlikely to fire again).
        const releaseRes = await stub.fetch('https://do/release', {
          method: 'POST',
          body: JSON.stringify({ processedMessageIds: processedIds, finalize: true }),
        });
        const release = (await releaseRes.json()) as {
          drained: PendingMessage[];
          lockReleased: boolean;
          deferredCount: number;
        };
        console.log(`[release] contact=${contactId} drained=0 depth=${depth} fallback=true deferred=${release.deferredCount}`);
        succeeded = true;
        lastResponse = Response.json({
          handled: 'guardrail_fallback',
          sent: FALLBACK,
          rejectedDrafts: attemptLog
            .filter((a) => a.reason)
            .map((a) => ({ reason: a.reason, draft: a.draft })),
        });
        break;
      }

      // Late manual-outbound check (only on first pass; on drain passes the
      // race window vs a teammate sending manually is near-zero seconds).
      if (isFirstPass) {
        await new Promise((r) => setTimeout(r, 3000));
        const manualDetectedLate = await wasManualOutboundRecent(
          { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
          contactId,
          botGhlMessageIds,
          600,
        );
        if (manualDetectedLate) {
          await addTag(
            { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
            contactId,
            'human-takeover',
          );
          // Bail without persisting the user/assistant turns. Finalize lock.
          await stub.fetch('https://do/release', {
            method: 'POST',
            body: JSON.stringify({ processedMessageIds: processedIds, finalize: true }),
          });
          console.log(`[release] contact=${contactId} drained=0 depth=${depth} manualLate=true`);
          succeeded = true;
          lastResponse = Response.json({ skipped: 'manual_team_message_detected_late' });
          break;
        }
      }

      const sent = await sendSms(
        { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
        { contactId, message: candidate },
      );

      // Email capture: scan only the newest pending message body (the one
      // most likely to contain a freshly-typed email). Cheap regex, no harm
      // in running per pass.
      const newestBody = messagesToProcess[messagesToProcess.length - 1]?.body ?? '';
      const emailSeen = extractEmail(newestBody);

      // Persist every pending user turn, then the assistant reply.
      for (let i = 0; i < messagesToProcess.length; i++) {
        const msg = messagesToProcess[i];
        const isLastUserMsg = i === messagesToProcess.length - 1;
        await stub.fetch('https://do/append', {
          method: 'POST',
          body: JSON.stringify({
            message: { role: 'user', content: msg.body, at: msg.receivedAt, ghlMessageId: msg.messageId } as AvaMessage,
            email: isLastUserMsg ? emailSeen : undefined,
          }),
        });
      }
      await stub.fetch('https://do/append', {
        method: 'POST',
        body: JSON.stringify({
          message: { role: 'assistant', content: candidate, at: Date.now(), ghlMessageId: sent.messageId } as AvaMessage,
          linkSent: linkSentThisTurn,
          openerSent: true,
          newState: currentState.state === 'new' ? 'engaged' : undefined,
        }),
      });

      // Tag on first touch (preserved from original; rarely reachable here
      // because the opener short-circuits handle openerSent=false earlier).
      if (!currentState.openerSent) {
        await addTag(
          { locationId: env.GHL_LOCATION_ID, apiKey: env.GHL_API_KEY },
          contactId,
          ENGAGED_TAG,
        );
      }

      // Analytics for this pass.
      if (env.DB) {
        try {
          await env.DB.prepare(
            'INSERT INTO turns (contact_id, inbound, outbound, link_sent, violations, at) VALUES (?, ?, ?, ?, ?, ?)',
          )
            .bind(
              contactId,
              inboundForLog,
              candidate,
              linkSentThisTurn ? 1 : 0,
              JSON.stringify(violations),
              new Date().toISOString(),
            )
            .run();
        } catch (e) {
          console.error('d1 write failed', e);
        }
      }

      // Release: drain pending if any, finalize on depth cap.
      const finalize = depth >= MAX_DEPTH;
      const releaseRes = await stub.fetch('https://do/release', {
        method: 'POST',
        body: JSON.stringify({ processedMessageIds: processedIds, finalize }),
      });
      const release = (await releaseRes.json()) as {
        drained: PendingMessage[];
        lockReleased: boolean;
        deferredCount: number;
      };
      console.log(`[release] contact=${contactId} drained=${release.drained.length} depth=${depth}`);
      lastResponse = Response.json({ handled: 'ok', sent: candidate, violations, depth });

      if (release.lockReleased) {
        if (finalize && release.deferredCount > 0) {
          console.log(`[drain-cap] contact=${contactId} hit recursion cap, deferring`);
        }
        succeeded = true;
        break;
      }
      messagesToProcess = release.drained;
    }
    // Loop exited cleanly with no more work and no break: mark success.
    succeeded = true;
  } finally {
    if (!succeeded) {
      try {
        await stub.fetch('https://do/release', {
          method: 'POST',
          body: JSON.stringify({ processedMessageIds: [], finalize: true }),
        });
        console.error(`[release] contact=${contactId} forced after error`);
      } catch (e) {
        console.error('failed to force-release lock', e);
      }
    }
  }

  return lastResponse ?? Response.json({ handled: 'no_op' });
}
