// Token Radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol in the snapshot that passes the watchlist's own rule for a
// pre-token protocol, at any TVL: no token on record, not a wrapped, staked or bridged product, not
// an exchange, and not a versioned pool. The watchlist (TVL at or above $50M) is the floor, never
// the ceiling: the early radar is every qualified protocol below it, so the board is the whole
// pre-token universe the snapshot holds, 198 rows here. The coverage accounting puts every other
// protocol somewhere too — the live table's top 24 by market cap, or an excluded row with its
// reason — so board + live table + excluded is the snapshot's full 758 protocols.
//
// Implied value is calibrated on the snapshot itself, not on a flat multiple and never on a name:
//
//   multiple   = the category's median market-cap-to-TVL among the snapshot's live-token
//                protocols (three or more of them), clamped to [0.05, 1.2]; a category with
//                fewer live protocols takes the global median instead
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// A protocol's farm plan is derived from its own record (category, chains, TVL, age), never from a
// hand-written list of names. The dashboard generates the same plan in the page from the same rules,
// so what the page shows is what board.json carries.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_live_for_category: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.2,
  min_live_for_category: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibrated multiple: the median live mcap/TVL, and how many live protocols set it. */
export interface CategoryMultiple {
  multiple: number;
  live_count: number;
  calibrated: boolean;
}

/** The calibration the snapshot itself produces: per-category multiples and the global fallback. */
export interface Calibration {
  by_category: Record<string, CategoryMultiple>;
  global_multiple: number;
  global_live_count: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_live_count: number;
    category_calibrated: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the page recomputes its implied value from these figures. */
export interface RadarRow {
  r: number;
  s: string;
  n: string;
  c: string | null;
  h: string[];
  t: number;
  g: number | null;
  a: number | null;
  v: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  s: string;
  n: string;
  c: string | null;
  h: string[];
  t: number;
  g: number | null;
  m: number | null;
}

/** Why one snapshot protocol is not on the board or in the live table. */
export type ExcludedReason = 'live-below-top24' | 'bridge' | 'liquid-staking' | 'exchange' | 'versioned-pool' | 'wrapped-staked';

/** One protocol the board does not rank and the live table does not show, with its reason. */
export interface ExcludedRow {
  s: string;
  n: string;
  c: string | null;
  t: number;
  r: ExcludedReason;
}

/** The coverage accounting: every snapshot protocol, in exactly one bucket. */
export interface Coverage {
  total: number;
  board: number;
  live_table: number;
  live_total: number;
  excluded: number;
  by_reason: { reason: ExcludedReason; label: string; count: number }[];
  rows: ExcludedRow[];
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model, and the coverage accounting. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: Calibration;
  coverage: Coverage;
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-or-not list of numbers; null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The calibration: for each category, the median market-cap-to-TVL of the snapshot's live-token
 * protocols in it (three or more), clamped to [multiple_floor, multiple_cap]; a category with fewer
 * live protocols takes the global median instead, so no single outlier sets a multiple.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalMedian = median(all) ?? model.multiple_floor;
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalMedian));
  const out: Record<string, CategoryMultiple> = {};
  for (const [cat, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (ratios.length >= model.min_live_for_category) {
      const med = median(ratios)!;
      out[cat] = { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, med)), live_count: ratios.length, calibrated: true };
    } else {
      out[cat] = { multiple: global, live_count: ratios.length, calibrated: false };
    }
  }
  return { by_category: out, global_multiple: global, global_live_count: all.length };
}

/** A category's multiple under the calibration: its own, or the global fallback when uncalibrated. */
export function multipleFor(category: string | null, calibration: Calibration): CategoryMultiple {
  const key = category ?? 'Other';
  const hit = calibration.by_category[key];
  if (hit !== undefined) return hit;
  return { multiple: calibration.global_multiple, live_count: 0, calibrated: false };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three multipliers and the implied value one protocol gets under the calibration. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; liveCount: number; calibrated: boolean; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const cat = multipleFor(protocol.category, calibration);
  const base = protocol.tvl_usd * cat.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple: cat.multiple, liveCount: cat.live_count, calibrated: cat.calibrated, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped, staked or bridged product, never a protocol of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Whole words in a name that mark a wrapped or staked product. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a pre-token protocol's name never begins with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token by its record, and not a wrapped, staked
 * or bridged product, not an exchange, and not a versioned pool. This is the watchlist's own rule,
 * applied to every row at any TVL, so a bridge or a staked product never ranks as a pre-token
 * protocol the way a TVL-only cut would let it.
 */
export function isQualified(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other qualified protocol in the snapshot, at any TVL. A chosen protocol
  // stays chosen; the board is the whole qualified universe, not a TVL cut.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isQualified(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      category_live_count: s.liveCount,
      category_calibrated: s.calibrated,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** What one transaction costs on a chain, as a rough guide for the farm plan. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'budget $5–$15 of gas per transaction on mainnet';
  if (c === 'bitcoin') return 'Bitcoin transactions are slow and costly, so use this chain only for the deposit';
  if (c === 'solana') return 'under $0.01 of gas per transaction';
  return 'under $0.10 of gas per transaction on this chain';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC to ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and let it compound.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position in an open market on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('governance') || c.includes('incentive')) return `Lock $${capital} in ${name}'s governance on ${chain} and vote once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.`,
      cost: 'nothing but the wallet',
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital; ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `Do one qualifying action every week — a deposit, a borrow, a swap, a vote or a claim — so the wallet shows a pattern, not a single touch.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page once a month, and claim only from a link that page itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: `Keep a farm log — wallet, dates, amounts and every transaction hash — so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      s: p.slug,
      n: p.name,
      c: p.category,
      h: p.chains.slice(0, 2),
      t: p.tvl_usd,
      g: p.change_7d,
      m: p.mcap_usd,
    }));
}

/** The reason a protocol is excluded, in the dashboard's own words. */
export const EXCLUDED_REASONS: Record<ExcludedReason, string> = {
  'live-below-top24': 'Has a token — below the live table’s top 24 by market cap',
  'bridge': 'Bridge — excluded by the watchlist rule',
  'liquid-staking': 'Liquid staking or restaking — excluded by the watchlist rule',
  'exchange': 'Exchange — excluded by the watchlist rule',
  'versioned-pool': 'Versioned pool — excluded by the watchlist rule',
  'wrapped-staked': 'Wrapped or staked product — excluded by the watchlist rule',
};

/**
 * Why a protocol the board does not rank and the live table does not show is left out. The order
 * mirrors isQualified: an excluded category first, then a token on record (below the live table's
 * top 24), then the name rules. A pre-token protocol the board refuses always matches one of the
 * name rules, so the last line is unreachable for it — it is there so the function is total.
 */
export function excludedReason(p: SnapshotProtocol): ExcludedReason {
  if (p.category === 'CEX') return 'exchange';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'liquid-staking';
  if (!isPreToken(p)) return 'live-below-top24';
  if (VERSIONED.test(p.name)) return 'versioned-pool';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange';
  if (PRODUCT_WORD.test(p.name)) return 'wrapped-staked';
  return 'wrapped-staked';
}

/**
 * The coverage accounting: every protocol in the snapshot lands in exactly one bucket — the ranked
 * board, the live table, or an excluded row with its reason. board + live_table + excluded is the
 * snapshot's protocol count, so the dashboard can state the coverage as a checkable total.
 */
export function coverageFor(snapshot: Snapshot, board: BoardRow[], live: LiveRow[]): Coverage {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const liveSlugs = new Set(live.map((r) => r.s));
  const rows: ExcludedRow[] = [];
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug) || liveSlugs.has(p.slug)) continue;
    rows.push({ s: p.slug, n: p.name, c: p.category, t: p.tvl_usd, r: excludedReason(p) });
  }
  rows.sort((a, b) => b.t - a.t || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  const counts = new Map<ExcludedReason, number>();
  for (const r of rows) counts.set(r.r, (counts.get(r.r) ?? 0) + 1);
  const by_reason = [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: EXCLUDED_REASONS[reason], count }))
    .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  return {
    total: snapshot.protocols.length,
    board: board.length,
    live_table: live.length,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    excluded: rows.length,
    by_reason,
    rows,
  };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    r: row.rank,
    s: row.slug,
    n: row.name,
    c: row.category,
    h: row.chains.slice(0, 2),
    t: row.tvl_usd,
    g: row.change_7d,
    a: row.age_days,
    v: row.implied_value_usd,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; calibration: Calibration } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const coverage = coverageFor(snapshot, board, live);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    coverage,
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, calibration };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/**
 * A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
 * Row keys: r rank, s slug, n name, c category, h chains (first two), t tvl_usd,
 * g change_7d, a age_days, v implied_value_usd. Live keys: s slug, n name, c category,
 * h chains, t tvl_usd, g change_7d, m mcap_usd. Coverage keys: total, board, live_table,
 * live_total, excluded, by_reason (reason, label, count), rows (s slug, n name, c category,
 * t tvl_usd, r reason).
 */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
