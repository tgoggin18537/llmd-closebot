/**
 * Durable Object holding per-contact conversation state.
 *
 * One DO instance per GHL contactId. Lives as long as the relationship
 * does. Handles concurrent inbound webhooks serially via a per-contact
 * in-flight lock and a pendingMessages queue (rapid-fire batching).
 */

export type AvaMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  ghlMessageId?: string;
};

export type PendingMessage = {
  messageId: string;
  body: string;
  receivedAt: number;
};

export type AvaState = {
  contactId: string;
  phone?: string;
  createdAt: number;
  state:
    | 'new'
    | 'engaged'
    | 'booked'
    | 'customer'
    | 'existing_patient'
    | 'human_takeover'
    | 'dnc';
  goal?: string;
  painPoint?: string;
  emailCaptured?: string;
  usConfirmed?: boolean;
  linkSendCount: number;
  openerSent: boolean;
  messages: AvaMessage[];
  lastInboundGhlMessageId?: string;
  // Rapid-fire batching: in-flight lock + pending queue + replay-protection
  // ring buffer. All optional so existing persisted state without these
  // fields keeps loading cleanly (load() backfills defaults).
  inFlight?: boolean;
  inFlightSince?: number;
  pendingMessages?: PendingMessage[];
  recentInboundIds?: string[];
};

const STALE_LOCK_MS = 60_000;
const RECENT_IDS_CAP = 20;

export class ContactThread {
  private state: DurableObjectState;
  private data: AvaState | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    await this.load();

    if (url.pathname === '/get') {
      return Response.json(this.data);
    }

    if (url.pathname === '/init' && req.method === 'POST') {
      const body = (await req.json()) as Partial<AvaState>;
      if (!this.data) {
        this.data = {
          contactId: body.contactId!,
          phone: body.phone,
          createdAt: Date.now(),
          state: 'new',
          linkSendCount: 0,
          openerSent: false,
          messages: [],
          goal: body.goal,
          painPoint: body.painPoint,
          inFlight: false,
          inFlightSince: 0,
          pendingMessages: [],
          recentInboundIds: [],
        };
        await this.save();
      }
      return Response.json(this.data);
    }

    if (url.pathname === '/append' && req.method === 'POST') {
      const body = (await req.json()) as {
        message: AvaMessage;
        linkSent?: boolean;
        email?: string;
        usConfirmed?: boolean;
        newState?: AvaState['state'];
        openerSent?: boolean;
        lastInboundGhlMessageId?: string;
      };
      if (!this.data) return new Response('not initialized', { status: 409 });
      // idempotency: if the inbound ghlMessageId matches last seen, drop.
      if (
        body.message.role === 'user' &&
        body.message.ghlMessageId &&
        body.message.ghlMessageId === this.data.lastInboundGhlMessageId
      ) {
        return Response.json({ duplicate: true, state: this.data });
      }
      this.data.messages.push(body.message);
      if (body.linkSent) this.data.linkSendCount += 1;
      if (body.email) this.data.emailCaptured = body.email;
      if (body.usConfirmed !== undefined) this.data.usConfirmed = body.usConfirmed;
      if (body.newState) this.data.state = body.newState;
      if (body.openerSent) this.data.openerSent = true;
      if (body.lastInboundGhlMessageId)
        this.data.lastInboundGhlMessageId = body.lastInboundGhlMessageId;
      await this.save();
      return Response.json({ duplicate: false, state: this.data });
    }

    if (url.pathname === '/claim' && req.method === 'POST') {
      const body = (await req.json()) as {
        messageId: string;
        body: string;
        receivedAt: number;
      };
      if (!this.data) return new Response('not initialized', { status: 409 });
      const now = Date.now();
      const contactId = this.data.contactId;
      const pending = this.data.pendingMessages ?? [];
      const recent = this.data.recentInboundIds ?? [];

      // ----- Verbose debug log: emit ONE line per /claim attempt with full
      //       state visibility, so we can see exactly what dedupe (if any)
      //       is matching. Remove once the rapid-fire deploy is stable.
      const inFlightVal = !!this.data.inFlight;
      const inFlightAge = now - (this.data.inFlightSince ?? 0);
      const ringTail = recent.length > 3 ? recent.slice(-3) : recent;
      let matchedOn = 'none';
      // Only compute matchedOn when the incoming id is a non-empty string;
      // otherwise null === null gives a false "match" and lies in the log.
      if (typeof body.messageId === 'string' && body.messageId.length > 0) {
        if (body.messageId === this.data.lastInboundGhlMessageId) {
          matchedOn = 'lastInboundGhlMessageId';
        } else {
          const ringIdx = recent.indexOf(body.messageId);
          if (ringIdx !== -1) {
            matchedOn = `recentInboundIds[${ringIdx}]`;
          } else if (pending.some((p) => p.messageId === body.messageId)) {
            matchedOn = 'pendingMessages';
          }
        }
      } else {
        matchedOn = 'invalid-id-skipped';
      }
      // Hard guard: treat null/undefined/empty messageId as "no id available,
      // do not dedup". Without this guard, multiple inbounds with id=null
      // would all match each other (null === null) and cause permanent
      // silent lockout. With this guard, we accept the message and let it
      // through; the webhook resolver should always supply a real or
      // synthetic id, but if it doesn't we'd rather process duplicates than
      // drop everything.
      const idValid = typeof body.messageId === 'string' && body.messageId.length > 0;
      if (!idValid) {
        console.warn(
          `[claim] contact=${contactId} WARNING incoming messageId is invalid (${typeof body.messageId}, value=${JSON.stringify(body.messageId)}); skipping dedup`,
        );
      }

      console.log(
        `[claim-debug] contact=${contactId} incomingMsgId=${body.messageId} lastInbound=${this.data.lastInboundGhlMessageId ?? 'undefined'} ringSize=${recent.length} ringTail=${JSON.stringify(ringTail)} inFlight=${inFlightVal} inFlightAge=${inFlightAge} matchedOn=${matchedOn} idValid=${idValid}`,
      );

      // Dedupe: previously processed (only if id is valid).
      if (
        idValid &&
        (body.messageId === this.data.lastInboundGhlMessageId ||
          recent.includes(body.messageId))
      ) {
        console.log(
          `[claim] contact=${contactId} claimed=false queued=false pendingCount=${pending.length} duplicate=true`,
        );
        return Response.json({ duplicate: true });
      }
      // Dedupe: same id already queued (only if id is valid).
      if (idValid && pending.some((p) => p.messageId === body.messageId)) {
        console.log(
          `[claim] contact=${contactId} claimed=false queued=false pendingCount=${pending.length} duplicate=true`,
        );
        return Response.json({ duplicate: true });
      }

      const inFlight = !!this.data.inFlight;
      const ageMs = now - (this.data.inFlightSince ?? 0);
      const stale = inFlight && ageMs >= STALE_LOCK_MS;
      let staleRecovered = false;
      if (stale) {
        console.log(
          `[stale-lock] contact=${contactId} ageMs=${ageMs} forcing release`,
        );
        staleRecovered = true;
      }

      if (inFlight && !stale) {
        // Queue the message; lock holder will drain on /release.
        pending.push({
          messageId: body.messageId,
          body: body.body,
          receivedAt: body.receivedAt,
        });
        this.data.pendingMessages = pending;
        await this.save();
        console.log(
          `[claim] contact=${contactId} claimed=false queued=true pendingCount=${pending.length}`,
        );
        return Response.json({
          claimed: false,
          queued: true,
          pendingCount: pending.length,
        });
      }

      // Lock available (or stale-recovered). Merge any orphaned pending with
      // the new message, sorted by receivedAt, so a depth-cap deferral or a
      // crashed worker's leftovers get processed in this pass.
      const merged: PendingMessage[] = [
        ...pending,
        {
          messageId: body.messageId,
          body: body.body,
          receivedAt: body.receivedAt,
        },
      ].sort((a, b) => a.receivedAt - b.receivedAt);
      this.data.pendingMessages = [];
      this.data.inFlight = true;
      this.data.inFlightSince = now;
      await this.save();
      console.log(
        `[claim] contact=${contactId} claimed=true queued=false pendingCount=${merged.length}`,
      );
      return Response.json({
        claimed: true,
        messagesToProcess: merged,
        staleRecovered,
      });
    }

    if (url.pathname === '/release' && req.method === 'POST') {
      const body = (await req.json()) as {
        processedMessageIds: string[];
        finalize?: boolean;
      };
      if (!this.data) return new Response('not initialized', { status: 409 });

      // Update replay-protection ring buffer + last-inbound tracker.
      // Filter out null/undefined/empty ids defensively; never let an
      // invalid id poison the ring buffer or lastInboundGhlMessageId, both
      // of which would cause null=null false matches on subsequent /claim.
      const validProcessedIds = body.processedMessageIds.filter(
        (id) => typeof id === 'string' && id.length > 0,
      );
      if (validProcessedIds.length !== body.processedMessageIds.length) {
        console.warn(
          `[release] contact=${this.data.contactId} dropped ${body.processedMessageIds.length - validProcessedIds.length} invalid processedMessageIds`,
        );
      }
      if (validProcessedIds.length > 0) {
        const recent = this.data.recentInboundIds ?? [];
        for (const id of validProcessedIds) {
          if (!recent.includes(id)) recent.push(id);
        }
        while (recent.length > RECENT_IDS_CAP) recent.shift();
        this.data.recentInboundIds = recent;
        // Per spec: lastInboundGhlMessageId tracks the MOST RECENT processed
        // message in this pass (last in receivedAt order from the caller).
        this.data.lastInboundGhlMessageId =
          validProcessedIds[validProcessedIds.length - 1];
      }

      const pending = this.data.pendingMessages ?? [];
      if (pending.length > 0 && !body.finalize) {
        // Drain: hand pending back to the caller, KEEP lock held so concurrent
        // webhooks continue to queue rather than start a parallel pass.
        const drained = pending
          .slice()
          .sort((a, b) => a.receivedAt - b.receivedAt);
        this.data.pendingMessages = [];
        this.data.inFlightSince = Date.now(); // reset stale clock for next pass
        await this.save();
        return Response.json({ drained, lockReleased: false, deferredCount: 0 });
      }

      // Finalize OR pending empty: release the lock. If finalize and pending
      // is non-empty, we LEAVE pending intact so the next inbound's /claim
      // can merge them via the orphan path.
      const deferredCount = body.finalize ? pending.length : 0;
      this.data.inFlight = false;
      this.data.inFlightSince = 0;
      await this.save();
      return Response.json({ drained: [], lockReleased: true, deferredCount });
    }

    if (url.pathname === '/reset' && req.method === 'POST') {
      // Admin: wipe DO state for this contact. Next /init creates fresh.
      const wipedContactId = this.data?.contactId ?? '<uninitialized>';
      this.data = null;
      await this.state.storage.delete('state');
      console.log(`[admin-reset] contact=${wipedContactId} state wiped`);
      return Response.json({ ok: true, wiped: true, contactId: wipedContactId });
    }

    return new Response('not found', { status: 404 });
  }

  private async load() {
    if (this.data) return;
    this.data = (await this.state.storage.get<AvaState>('state')) ?? null;
    // Backfill new fields on state persisted before the in-flight lock landed.
    if (this.data) {
      if (this.data.inFlight === undefined) this.data.inFlight = false;
      if (this.data.inFlightSince === undefined) this.data.inFlightSince = 0;
      if (this.data.pendingMessages === undefined) this.data.pendingMessages = [];
      if (this.data.recentInboundIds === undefined) this.data.recentInboundIds = [];
    }
  }

  private async save() {
    if (this.data) await this.state.storage.put('state', this.data);
  }
}
