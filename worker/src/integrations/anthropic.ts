/**
 * Anthropic API client for Workers.
 *
 * Uses prompt caching on the big static system prompt so every turn gets
 * ~90% discount on those tokens after the first hit.
 */

export type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ClaudeCallInput = {
  apiKey: string;
  model: string;
  systemCached: string; // static, cached
  systemDynamic?: string; // per-turn, not cached
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type ClaudeCallOutput = {
  text: string;
  stopReason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export async function callClaude(input: ClaudeCallInput): Promise<ClaudeCallOutput> {
  const system: any[] = [
    {
      type: 'text',
      text: input.systemCached,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (input.systemDynamic) {
    system.push({ type: 'text', text: input.systemDynamic });
  }

  const body = {
    model: input.model,
    max_tokens: input.maxTokens ?? 400,
    temperature: input.temperature ?? 0.7,
    system,
    messages: input.messages,
  };

  // Retry on 429 (rate limit) and 5xx with exponential backoff. Honors the
  // `retry-after` header when Anthropic provides one (in seconds), otherwise
  // falls back to exponential: 1s, 2s, 4s, 8s, 16s. Max 5 attempts.
  let res!: Response;
  let lastErr = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) break;
    if (res.status !== 429 && res.status < 500) {
      // 4xx other than 429 is a real error, don't retry.
      lastErr = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${lastErr}`);
    }
    lastErr = await res.text();
    if (attempt === 4) break;
    const retryAfterRaw = Number(res.headers.get('retry-after'));
    const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
      ? Math.min(retryAfterRaw, 30)
      : 0;
    const waitMs = retryAfter > 0
      ? retryAfter * 1000
      : 1000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  if (!res.ok) throw new Error(`Anthropic API ${res.status} after retries: ${lastErr}`);

  const data = (await res.json()) as any;
  const text: string = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  return {
    text,
    stopReason: data.stop_reason ?? null,
    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}
