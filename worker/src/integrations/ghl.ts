/**
 * GoHighLevel API client (minimum needed surface).
 *
 * Docs: https://highlevel.stoplight.io/docs/integrations
 *
 * We only use: send SMS, add/remove tags, read contact, read recent
 * messages (to detect manual team messages), create internal note,
 * send internal notification.
 */

export type GhlEnv = {
  locationId: string;
  apiKey: string; // Location API key or Private Integration token
  baseUrl?: string;
};

const DEFAULT_BASE = 'https://services.leadconnectorhq.com';

function headers(env: GhlEnv) {
  return {
    Authorization: `Bearer ${env.apiKey}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export async function sendSms(
  env: GhlEnv,
  params: { contactId: string; message: string },
): Promise<{ messageId: string }> {
  const res = await fetch(`${env.baseUrl ?? DEFAULT_BASE}/conversations/messages`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      type: 'SMS',
      contactId: params.contactId,
      message: params.message,
    }),
  });
  if (!res.ok) throw new Error(`GHL sendSms ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  return { messageId: data.messageId ?? data.id };
}

export async function getContact(env: GhlEnv, contactId: string): Promise<any> {
  const res = await fetch(`${env.baseUrl ?? DEFAULT_BASE}/contacts/${contactId}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`GHL getContact ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  return data.contact ?? data;
}

export async function addTag(env: GhlEnv, contactId: string, tag: string): Promise<void> {
  const res = await fetch(`${env.baseUrl ?? DEFAULT_BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!res.ok) throw new Error(`GHL addTag ${res.status}: ${await res.text()}`);
}

export async function removeTag(env: GhlEnv, contactId: string, tag: string): Promise<void> {
  const res = await fetch(`${env.baseUrl ?? DEFAULT_BASE}/contacts/${contactId}/tags`, {
    method: 'DELETE',
    headers: headers(env),
    body: JSON.stringify({ tags: [tag] }),
  });
  if (!res.ok) throw new Error(`GHL removeTag ${res.status}: ${await res.text()}`);
}

/** Recent messages on the contact's conversation, newest first. */
export async function getRecentMessages(
  env: GhlEnv,
  contactId: string,
  limit = 20,
): Promise<Array<{ id: string; direction: 'inbound' | 'outbound'; body: string; dateAdded: string; userId?: string; source?: string }>> {
  // Resolve conversation id
  const convRes = await fetch(
    `${env.baseUrl ?? DEFAULT_BASE}/conversations/search?locationId=${env.locationId}&contactId=${contactId}`,
    { headers: headers(env) },
  );
  if (!convRes.ok) return [];
  const conv = (await convRes.json()) as any;
  const conversationId = conv.conversations?.[0]?.id;
  if (!conversationId) return [];

  const msgRes = await fetch(
    `${env.baseUrl ?? DEFAULT_BASE}/conversations/${conversationId}/messages?limit=${limit}`,
    { headers: headers(env) },
  );
  if (!msgRes.ok) return [];
  const data = (await msgRes.json()) as any;
  return (data.messages?.messages ?? data.messages ?? []).map((m: any) => ({
    id: m.id,
    direction: m.direction,
    body: m.body ?? m.message ?? '',
    dateAdded: m.dateAdded,
    userId: m.userId,
    source: m.source,
  }));
}

/**
 * Detect if a team member has sent a manual outbound SMS recently. If so,
 * Mia should stay silent. Heuristic: any outbound message in the last
 * `windowSeconds` whose source is not our bot marker.
 */
export async function wasManualOutboundRecent(
  env: GhlEnv,
  contactId: string,
  botSourceMarker: string,
  windowSeconds = 600,
): Promise<boolean> {
  const msgs = await getRecentMessages(env, contactId, 20);
  const cutoff = Date.now() - windowSeconds * 1000;
  return msgs.some(
    (m) =>
      m.direction === 'outbound' &&
      new Date(m.dateAdded).getTime() > cutoff &&
      m.source !== botSourceMarker,
  );
}

export async function addContactNote(env: GhlEnv, contactId: string, body: string): Promise<void> {
  const res = await fetch(`${env.baseUrl ?? DEFAULT_BASE}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`GHL addContactNote ${res.status}: ${await res.text()}`);
}
