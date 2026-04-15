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
      return new Response('not found', { status: 404 });
    } catch (err: any) {
      console.error('worker error', err);
      return new Response(`error: ${err?.message ?? err}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
