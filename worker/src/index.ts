/**
 * Cloudflare Worker entry. Routes:
 *  POST /webhook/ghl/inbound-sms   — inbound SMS from GHL
 *  GET  /health                    — liveness
 */

import { handleInboundSms } from './routes/webhook';
import { handleSimulate } from './routes/simulate';
import type { Env } from './env';

export { ContactThread } from './memory/ContactThread';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return Response.json({ ok: true, service: 'llmd-mia', ts: Date.now() });
      }
      if (req.method === 'POST' && url.pathname === '/webhook/ghl/inbound-sms') {
        return await handleInboundSms(req, env);
      }
      if (req.method === 'POST' && url.pathname === '/debug/simulate') {
        return await handleSimulate(req, env);
      }
      if (req.method === 'POST' && url.pathname === '/admin/reset-contact') {
        // Temporary admin endpoint: wipe DO state for a single contact.
        // Gated behind the same webhook secret as the inbound-sms route.
        const sig = req.headers.get('x-ghl-webhook-secret');
        if (env.GHL_WEBHOOK_SECRET && sig !== env.GHL_WEBHOOK_SECRET) {
          return new Response('forbidden', { status: 403 });
        }
        const contactId = url.searchParams.get('contactId');
        if (!contactId) {
          return new Response('missing contactId query param', { status: 400 });
        }
        const doId = env.CONTACT_THREAD.idFromName(contactId);
        const stub = env.CONTACT_THREAD.get(doId);
        const resetRes = await stub.fetch('https://do/reset', { method: 'POST' });
        const resetBody = (await resetRes.json()) as Record<string, unknown>;
        console.log(`[admin] reset-contact contactId=${contactId} result=${JSON.stringify(resetBody)}`);
        return Response.json({ ok: true, contactId, ...resetBody });
      }
      return new Response('not found', { status: 404 });
    } catch (err: any) {
      console.error('worker error', err);
      return new Response(`error: ${err?.message ?? err}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
