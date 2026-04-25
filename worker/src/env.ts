export type Env = {
  ANTHROPIC_API_KEY: string;
  GHL_API_KEY: string;
  GHL_LOCATION_ID: string;
  GHL_WEBHOOK_SECRET?: string;
  AVA_MODEL?: string;
  CONTACT_THREAD: DurableObjectNamespace;
  IDEMPOTENCY?: KVNamespace;
  DB?: D1Database;
};
