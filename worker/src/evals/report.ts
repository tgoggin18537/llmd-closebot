/**
 * Generate a markdown report from a judged eval run. Designed to be
 * scannable in under 2 minutes: headline pass rates at the top, diff vs the
 * previous baseline run, then top failures with full judge reasoning.
 *
 * Usage:
 *   npm run eval-report -- --run=evals/runs/<timestamp>
 *
 * Output: <run-dir>/report.md
 *
 * If a previous run directory exists in evals/runs/, automatically finds
 * the most recent one as the baseline for diffing.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseResult } from './run';
import type { Judgment, Dimension } from './judge';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const RUNS_DIR = resolve(REPO_ROOT, 'evals/runs');

const ALL_DIMS: Dimension[] = ['voice', 'hygiene', 'read_the_room', 'no_cliches'];

type Args = { runDir: string; baselineDir?: string };

function parseArgs(): Args {
  const args: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.+))?$/);
    if (m) args[m[1]] = m[2] ?? 'true';
  }
  if (!args.run) {
    console.error('Usage: npm run eval-report -- --run=evals/runs/<timestamp> [--baseline=evals/runs/<other>]');
    process.exit(1);
  }
  return {
    runDir: resolve(args.run),
    baselineDir: args.baseline ? resolve(args.baseline) : undefined,
  };
}

function findPriorRun(currentDir: string): string | undefined {
  if (!existsSync(RUNS_DIR)) return undefined;
  const all = readdirSync(RUNS_DIR)
    .map((n) => resolve(RUNS_DIR, n))
    .filter((p) => statSync(p).isDirectory() && p !== currentDir)
    .sort();
  return all[all.length - 1];
}

function loadResults(dir: string): CaseResult[] {
  const path = resolve(dir, 'results.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function loadJudgments(dir: string): Judgment[] {
  const path = resolve(dir, 'judgments.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

type Stats = {
  total: number;
  overallPass: number;
  fallbacks: number;
  byDim: Record<Dimension, { pass: number; total: number }>;
  pairwise: { bot: number; human: number; tie: number; total: number };
};

function computeStats(judgments: Judgment[]): Stats {
  const stats: Stats = {
    total: judgments.length,
    overallPass: judgments.filter((j) => j.overallPass).length,
    fallbacks: judgments.filter((j) => j.fallback).length,
    byDim: {
      voice: { pass: 0, total: 0 },
      hygiene: { pass: 0, total: 0 },
      read_the_room: { pass: 0, total: 0 },
      no_cliches: { pass: 0, total: 0 },
    },
    pairwise: { bot: 0, human: 0, tie: 0, total: 0 },
  };
  for (const j of judgments) {
    for (const d of j.dimensions) {
      stats.byDim[d.dimension].total++;
      if (d.passed) stats.byDim[d.dimension].pass++;
    }
    if (j.pairwise) {
      stats.pairwise.total++;
      stats.pairwise[j.pairwise.winner]++;
    }
  }
  return stats;
}

function pct(p: number, t: number): string {
  if (t === 0) return 'n/a';
  return `${((p / t) * 100).toFixed(0)}%`;
}

function delta(curr: number, prev: number): string {
  const d = curr - prev;
  if (d === 0) return '±0';
  if (d > 0) return `+${d}`;
  return `${d}`;
}

function renderHeadline(stats: Stats, prior?: Stats): string {
  const lines: string[] = [];
  lines.push('## Headline');
  lines.push('');
  lines.push('| Metric | Current | Prior | Δ |');
  lines.push('|---|---|---|---|');
  lines.push(`| Cases | ${stats.total} | ${prior?.total ?? '—'} | ${prior ? delta(stats.total, prior.total) : '—'} |`);
  lines.push(`| Overall pass | ${stats.overallPass}/${stats.total} (${pct(stats.overallPass, stats.total)}) | ${prior ? `${prior.overallPass}/${prior.total} (${pct(prior.overallPass, prior.total)})` : '—'} | ${prior ? delta(stats.overallPass, prior.overallPass) : '—'} |`);
  lines.push(`| Fallbacks | ${stats.fallbacks} | ${prior?.fallbacks ?? '—'} | ${prior ? delta(stats.fallbacks, prior.fallbacks) : '—'} |`);
  for (const dim of ALL_DIMS) {
    const c = stats.byDim[dim];
    const p = prior?.byDim[dim];
    lines.push(`| ${dim} | ${c.pass}/${c.total} (${pct(c.pass, c.total)}) | ${p ? `${p.pass}/${p.total} (${pct(p.pass, p.total)})` : '—'} | ${p ? delta(c.pass, p.pass) : '—'} |`);
  }
  if (stats.pairwise.total > 0) {
    lines.push(
      `| pairwise voice | bot ${stats.pairwise.bot} / human ${stats.pairwise.human} / tie ${stats.pairwise.tie} (of ${stats.pairwise.total}) | ${prior && prior.pairwise.total > 0 ? `bot ${prior.pairwise.bot} / human ${prior.pairwise.human} / tie ${prior.pairwise.tie}` : '—'} | ${prior && prior.pairwise.total > 0 ? delta(stats.pairwise.bot, prior.pairwise.bot) + ' bot' : '—'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function renderCase(r: CaseResult, j: Judgment): string {
  const lines: string[] = [];
  const status = j.overallPass ? '✅' : j.fallback ? '🚧' : '❌';
  const tags = [j.category, j.holdOut ? 'HOLDOUT' : null].filter(Boolean).join(' / ');
  lines.push(`### ${status} ${r.name}  _(${tags})_`);
  lines.push('');
  if (r.history.length > 0) {
    lines.push('**Prior turns:**');
    for (const m of r.history) {
      lines.push(`- ${m.role}: ${m.content.replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }
  lines.push(`**Inbound:** ${r.inbound.replace(/\n/g, ' ')}`);
  lines.push('');
  if (j.fallback) {
    lines.push('**Bot reply:** _(none, guardrail exhausted retries)_');
    lines.push('');
    lines.push('**Drafts attempted:**');
    for (const a of r.attemptLog) {
      lines.push(`- _${a.reason ?? 'no reason'}_: ${a.draft.slice(0, 200)}`);
    }
    lines.push('');
    return lines.join('\n');
  }
  lines.push('**Bot reply:**');
  lines.push('');
  lines.push(`> ${r.candidate.replace(/\n/g, '\n> ')}`);
  lines.push('');
  if (r.humanGoldReply) {
    lines.push('**Real team reply (for comparison):**');
    lines.push('');
    lines.push(`> ${r.humanGoldReply.replace(/\n/g, '\n> ')}`);
    lines.push('');
  }
  if (!j.preChecksPassed) {
    lines.push('**Pre-check failures:**');
    for (const reason of j.preCheckReasons) lines.push(`- ${reason}`);
    lines.push('');
  }
  if (r.violations.length > 0) {
    lines.push(`**Guardrail violations:** ${r.violations.join(', ')}`);
    lines.push('');
  }
  if (r.attemptLog.length > 1) {
    lines.push(`**Retries:** ${r.attemptLog.length - 1} (final draft accepted on attempt ${r.attemptLog.length})`);
    lines.push('');
  }
  lines.push('**Judge verdicts:**');
  lines.push('');
  for (const d of j.dimensions) {
    const mark = d.passed ? '✅' : '❌';
    lines.push(`- ${mark} **${d.dimension}**: ${d.reasoning.replace(/\n/g, ' ').slice(0, 400)}${d.reasoning.length > 400 ? '...' : ''}`);
  }
  lines.push('');
  if (j.pairwise) {
    const mark = j.pairwise.winner === 'bot' ? '🤖 bot wins' : j.pairwise.winner === 'human' ? '👤 human wins' : '🤝 tie';
    lines.push(`**Pairwise voice:** ${mark} (ordering 1 picked ${j.pairwise.orderingABotFirst}, ordering 2 picked ${j.pairwise.orderingAHumanFirst})`);
    lines.push('');
    lines.push(`<details><summary>Judge reasoning (click to expand)</summary>`);
    lines.push('');
    lines.push(`**Ordering 1 (bot=A, human=B):** ${j.pairwise.reasoningBotFirst.replace(/\n/g, ' ')}`);
    lines.push('');
    lines.push(`**Ordering 2 (human=A, bot=B):** ${j.pairwise.reasoningHumanFirst.replace(/\n/g, ' ')}`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs();
  const results = loadResults(args.runDir);
  const judgments = loadJudgments(args.runDir);
  if (results.length === 0 || judgments.length === 0) {
    console.error(`No results or judgments in ${args.runDir}.`);
    process.exit(1);
  }

  const baselineDir = args.baselineDir ?? findPriorRun(args.runDir);
  const baselineJudgments = baselineDir ? loadJudgments(baselineDir) : [];
  const stats = computeStats(judgments);
  const priorStats = baselineJudgments.length > 0 ? computeStats(baselineJudgments) : undefined;

  // Pair up results and judgments by name.
  const byName = new Map<string, { r: CaseResult; j: Judgment }>();
  for (const r of results) byName.set(r.name, { r, j: judgments.find((j) => j.name === r.name)! });

  // Sort: failures first (sorted by category: regression > failure-pattern > edge-case), then passes.
  const order = (cat: string) => (cat === 'regression' ? 0 : cat === 'failure-pattern' ? 1 : 2);
  const allCases = [...byName.values()].sort((a, b) => {
    const failDiff = Number(b.j.fallback) + Number(!b.j.overallPass) - (Number(a.j.fallback) + Number(!a.j.overallPass));
    if (failDiff !== 0) return failDiff > 0 ? 1 : -1;
    return order(a.j.category) - order(b.j.category);
  });

  // What newly broke vs prior?
  const newlyFailed: string[] = [];
  const newlyPassed: string[] = [];
  if (priorStats) {
    const priorByName = new Map<string, Judgment>();
    for (const j of baselineJudgments) priorByName.set(j.name, j);
    for (const j of judgments) {
      const prior = priorByName.get(j.name);
      if (!prior) continue;
      if (prior.overallPass && !j.overallPass) newlyFailed.push(j.name);
      if (!prior.overallPass && j.overallPass) newlyPassed.push(j.name);
    }
  }

  // ------------ Build the report ------------
  const lines: string[] = [];
  lines.push(`# Eval report — ${basename(args.runDir)}`);
  lines.push('');
  if (baselineDir) lines.push(`_Baseline: ${basename(baselineDir)}_`);
  else lines.push('_No baseline (first run)._');
  lines.push('');
  lines.push(renderHeadline(stats, priorStats));

  if (newlyFailed.length > 0 || newlyPassed.length > 0) {
    lines.push('## Diff vs baseline');
    lines.push('');
    if (newlyFailed.length > 0) {
      lines.push('**Newly failing:**');
      for (const n of newlyFailed) lines.push(`- ❌ ${n}`);
      lines.push('');
    }
    if (newlyPassed.length > 0) {
      lines.push('**Newly passing:**');
      for (const n of newlyPassed) lines.push(`- ✅ ${n}`);
      lines.push('');
    }
  }

  // Top failures section (failures only, sorted)
  const failures = allCases.filter(({ j }) => !j.overallPass || j.fallback);
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push(`${failures.length} of ${allCases.length} cases failed. Sorted by category (regression > failure-pattern > edge-case).`);
    lines.push('');
    for (const { r, j } of failures) lines.push(renderCase(r, j));
  }

  // Passes (collapsed by default)
  const passes = allCases.filter(({ j }) => j.overallPass && !j.fallback);
  if (passes.length > 0) {
    lines.push('## Passes');
    lines.push('');
    lines.push(`<details><summary>${passes.length} cases passed (click to expand)</summary>`);
    lines.push('');
    for (const { r, j } of passes) lines.push(renderCase(r, j));
    lines.push('</details>');
    lines.push('');
  }

  const out = resolve(args.runDir, 'report.md');
  writeFileSync(out, lines.join('\n'));
  console.log(`Wrote ${out}`);
  console.log(`\nQuick summary:`);
  console.log(`  ${stats.overallPass}/${stats.total} passed overall`);
  for (const dim of ALL_DIMS) {
    const r = stats.byDim[dim];
    console.log(`  ${dim}: ${r.pass}/${r.total} (${pct(r.pass, r.total)})`);
  }
  if (stats.pairwise.total > 0) {
    console.log(`  pairwise: bot ${stats.pairwise.bot} / human ${stats.pairwise.human} / tie ${stats.pairwise.tie}`);
  }
  if (newlyFailed.length > 0) console.log(`  ⚠️ ${newlyFailed.length} newly failing vs baseline`);
  if (newlyPassed.length > 0) console.log(`  ✅ ${newlyPassed.length} newly passing vs baseline`);
}

// @ts-ignore
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('report.ts')) {
  main();
}
