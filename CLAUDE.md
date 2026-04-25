# llmd-closebot — Ava SMS setter bot for Limitless Living MD

## What this is

A voice-matched SMS setter bot for Nicole's peptide therapy clinic (Limitless Living MD). Persona is "Ava" (formerly "Mia," renamed during V3). $1,500 contract, currently in V3 eval-driven iteration.

**Single goal:** make Ava the best voice-matched SMS bot in the world. Voice match is the north star metric. Sales appropriateness is NOT a separate dimension. Thesis: if we sound like the team and say what they say when they say it, the sales close themselves.

## Stack

- Cloudflare Workers (edge compute)
- Durable Objects (per-contact conversation state, message history, qualifiers)
- D1 (turn-by-turn analytics)
- KV (idempotency on inbound webhook messageId)
- Anthropic Claude (Sonnet for replies, Haiku for soft-decline + existing-patient classifiers)
- GoHighLevel (SMS + CRM, fires the inbound webhook)

## Architecture

```
Inbound SMS (GHL webhook)
  → Cloudflare Worker
  → [idempotency KV] [shutoff tag] [manual-outbound] [existing-patient] [INITIAL_TOUCH] [SOFT-DECLINE]
  → Durable Object (per-contact state)
  → runClaudeWithGuardrailRetry()    ← shared with eval pipeline
      → Claude Sonnet (writer)
      → guardrail (regex enforcer, rewrites + rejects)
      → retry up to 3 attempts
      → static fallback if exhausted
  → GHL sendSms
  → persist turn to DO + D1 analytics
```

The retry loop is factored into `agents/respond.ts:runClaudeWithGuardrailRetry()` so production webhook AND eval pipeline call the exact same code path.

## Key files

- `BUILD_PLAYBOOK.md` — architecture, voice rules, failure patterns. Earned knowledge from V2.
- `V3_HANDOFF.md` — running session log, eval results, iteration history.
- `worker/src/prompts/ava.v2.ts` — THE prompt. Source of truth for voice.
- `worker/src/prompts/faq.ts` — approved FAQ answers (cached in system prompt).
- `worker/src/prompts/kb.ts` — brand vocab, existing-patient tags, carrier-blocked patterns.
- `worker/src/agents/respond.ts` — shared Claude+guardrail loop.
- `worker/src/agents/guardrail.ts` — regex enforcer.
- `worker/src/agents/classifier.ts` — Haiku classifiers.
- `worker/src/routes/webhook.ts` — production request handler.
- `worker/src/evals/` — golden cases, runner, judge, report.
- `worker/.dev.vars` — local secrets, gitignored. Has `ANTHROPIC_API_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`.

## Eval pipeline

```
npm run eval                              # run all cases (excludes holdouts by default)
npm run eval -- --include-holdout         # include the 4 holdout cases (shipping gate)
npm run judge -- --run=<results-dir>      # judge a results dir
npm run eval-report -- --run=<results-dir>  # generate markdown report
```

Each run writes to `worker/evals/runs/<timestamp>/` with `results.jsonl`, `judgments.jsonl`, `report.md`.

## Latest baseline (compare against this)

Pre-V3 baseline at `worker/evals/runs/2026-04-24T23-13-32/`. Iter #1 results at `2026-04-25T00-07-20/`. Holdout-included run at `2026-04-25T00-55-14/`.

Latest iter (after self-correction extraction guardrail): `2026-04-25T03-19-51/`.

## Critical things to know

- The judge had a max_tokens truncation bug. Bumped to 2000 + added `extractBinaryVerdict()` fallback. If voice numbers crater, check for token truncation warnings.
- The eval is independent of the judge. Re-run judge on existing results if you only changed `judge.ts`. Saves time + money.
- Holdouts (4 cases) excluded from default runs. Only with `--include-holdout` before merging prompt changes. Unbiased shipping gate.
- Pre-checks (regex assertions on `mustContainAny`/`mustNotContain`) are brittle. Don't trust pre-check failures alone, also look at judge dimensions.
- Pairwise voice is the strongest signal. Per-dim binary judges are useful diagnostics but flicker on holistic things.
- Default rate limits are tight: 30k input tokens/min, 8k output tokens/min for Sonnet. Concurrency=1 default for both eval and judge.
- Cost per full eval+judge run: ~$3-5.
- The cold opener is sent by GHL workflow, NOT Ava. The OPENER constant in webhook.ts is dead code, the `__INITIAL_TOUCH__` sentinel is a safety net.
- Soft-decline classifier intercepts "no thanks"/"not interested" before Claude. Sends warm exit + tags `do-not-message`.
- `worker/evals/real-convos.jsonl` is gitignored (real PII-redacted conversations from GHL). Don't commit.
- Voice judge whitelist in `judge.ts:voicePrompt` is calibration. Don't strip the team-verbatim phrases.
- `MIA_MODEL` env var stayed as-is despite the rename. Internal types `MiaState`/`MiaMessage` also unchanged. Just config + type names, persona is Ava.

## How to continue work

1. Read `V3_HANDOFF.md` first for current state and last decisions.
2. Check the latest eval run: `ls worker/evals/runs/`. Read the `report.md`.
3. Edit `prompts/ava.v2.ts`, re-run eval, watch the diff.
4. Update `V3_HANDOFF.md` with what you did and what's next.
