/**
 * Durable Object holding per-contact conversation state.
 *
 * One DO instance per GHL contactId. Lives as long as the relationship
 * does. Handles concurrent inbound webhooks serially.
 */

export type MiaMessage = {
  role: 'user' | 'assistant';
  content: string;
  at: number;
  ghlMessageId?: string;
};

export type MiaState = {
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
  messages: MiaMessage[];
  lastInboundGhlMessageId?: string;
};

export class ContactThread {
  private state: DurableObjectState;
  private data: MiaState | null = null;

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
      const body = (await req.json()) as Partial<MiaState>;
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
        };
        await this.save();
      }
      return Response.json(this.data);
    }

    if (url.pathname === '/append' && req.method === 'POST') {
      const body = (await req.json()) as {
        message: MiaMessage;
        linkSent?: boolean;
        email?: string;
        usConfirmed?: boolean;
        newState?: MiaState['state'];
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

    return new Response('not found', { status: 404 });
  }

  private async load() {
    if (this.data) return;
    this.data = (await this.state.storage.get<MiaState>('state')) ?? null;
  }

  private async save() {
    if (this.data) await this.state.storage.put('state', this.data);
  }
}
