// Shared data loading, types and small helpers (data files are described in docs/data-dictionary.md).
import * as d3 from "d3";

export type Group = "all" | "F" | "M";
export interface YearEntry {
  year: number;
  race_held: boolean;
  date: string | null;
  finishers: number | null;
  men: number | null;
  women: number | null;
  beyond_cap: number | null;
  weather: { temp_6am: number; temp_noon: number } | null;
  note: string | null;
  short_note?: string;
  detail_note?: string;
  sources?: string[];
  partial_data?: boolean;
  not_comparable?: boolean;
  show_in_count_charts?: boolean;
}
export interface DensityRow { year: number; gender: Group; n: number; beyond_cap: number; share: number[] }
export interface QuantRow { year: number; gender: Group; age_group: string; n: number; p5: number | null; p25: number | null; p50: number | null; p75: number | null; p95: number | null }
export interface Analysis {
  dataset: { finishers: number; races: number; first_year: number; last_year: number; no_race_year: number; fastest_seconds: number; fastest_year: number; largest_year: number; largest_finishers: number };
  spread: { year: number; p5: number; p25: number; p50: number; p75: number; p95: number; middle_half: number }[];
  weather: {
    points: { year: number; noon_temp: number; typical: number; in_fit: boolean }[];
    n: number; r: number; r_squared: number; slope_seconds_per_degree: number; intercept_seconds: number;
    warm_days: { n: number; average_typical: number }; cool_days: { n: number; average_typical: number };
    five_slowest_years_excluding_2007: { year: number; noon_temp: number }[];
  };
  round_numbers: {
    before_after_ratio: Record<string, Record<string, number>>;
    pooled_start_minute: number; pooled_counts_per_minute: number[]; minute_3_59: number; minute_4_00: number; drop_share: number;
  };
  age: {
    mix: { year: number; u30: number; "30-39": number; "40-49": number; "50+": number }[];
    standardized: { year: number; typical_actual: number; typical_1996_age_mix: number }[];
    typical_by_age_group_by_period: Record<string, Record<string, number>>;
  };
}

export interface Data {
  years: YearEntry[];
  T0: number; BIN: number; CAP: number; NB: number;
  density: (year: number, g?: Group) => DensityRow | undefined;
  typical: (year: number, g?: Group) => number | null; // typical (middle) finish time in seconds
  quant: (year: number, g?: Group) => QuantRow | undefined;
  womenShare: (y: YearEntry) => number | null;
  analysis: Analysis;
}

const BASE = import.meta.env.BASE_URL;
async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

export async function loadData(): Promise<Data> {
  const [yf, df, qf, analysis] = await Promise.all([
    getJson<{ years: YearEntry[] }>("years.json"),
    getJson<{ start_seconds: number; bin_seconds: number; cap_seconds: number; bins: number; rows: DensityRow[] }>("density.json"),
    getJson<{ rows: QuantRow[] }>("quantiles.json"),
    getJson<Analysis>("analysis.json"),
  ]);
  const dens = new Map<string, DensityRow>();
  for (const r of df.rows) dens.set(`${r.year}|${r.gender}`, r);
  const quant = new Map<string, QuantRow>();
  for (const r of qf.rows) if (r.age_group === "all") quant.set(`${r.year}|${r.gender}`, r);
  return {
    years: yf.years,
    T0: df.start_seconds, BIN: df.bin_seconds, CAP: df.cap_seconds, NB: df.bins,
    density: (y, g = "all") => dens.get(`${y}|${g}`),
    typical: (y, g = "all") => quant.get(`${y}|${g}`)?.p50 ?? null,
    quant: (y, g = "all") => quant.get(`${y}|${g}`),
    womenShare: (e) => (e.race_held && e.finishers ? (e.women as number) / e.finishers : null),
    analysis,
  };
}

// ---------- formatting ----------
export const fmtClock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
export const fmtHM = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
export const fmtHMRound = (s: number) => fmtHM(Math.round(s / 60) * 60);
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
export const num = (n: number) => n.toLocaleString("en-US");

// ---------- svg helpers ----------
const SVGNS = "http://www.w3.org/2000/svg";
export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}
export function text(parent: Element, s: string, attrs: Record<string, string | number> = {}, opts: { halo?: boolean; ink?: boolean } = {}) {
  const t = el("text", attrs, parent);
  t.textContent = s;
  if (opts.ink) t.style.fill = "var(--ink)";
  if (opts.halo) haloStyle(t);
  return t;
}
/** a surface-coloured outline behind letters keeps them readable on top of lines */
export function haloStyle(t: SVGElement) {
  t.style.paintOrder = "stroke";
  t.style.stroke = "var(--surface)";
  t.style.strokeWidth = "4px";
  t.style.strokeLinejoin = "round";
}
/** light display smoothing: 5-point weighted average, normalised at the edges */
export function smooth(a: number[]): number[] {
  const k = [1, 2, 3, 2, 1];
  return a.map((_, i) => {
    let acc = 0, w = 0;
    for (let j = -2; j <= 2; j++) {
      const v = a[i + j];
      if (v !== undefined) { acc += v * k[j + 2]; w += k[j + 2]; }
    }
    return acc / w;
  });
}

// ---------- shared chart helpers ----------
export const css = (name: string) => `var(--${name})`;
export const widthOf = (id: string, min = 300) => Math.max(min, (document.getElementById(id) as HTMLElement).clientWidth);

/** Wrap text into a note box. Returns the group so callers can place it. */
export function noteBox(parent: Element, str: string, maxW: number, fs: number) {
  const g = el("g", {}, parent);
  const rect = el("rect", { rx: 6, fill: css("surface"), "fill-opacity": 0.92, stroke: css("ink-3") }, g);
  const t = el("text", { "font-size": fs }, g); t.style.fill = css("ink");
  const probe = el("tspan", {}, t);
  const lines: string[] = []; let ln = "";
  for (const w of str.split(" ")) {
    const test = ln ? `${ln} ${w}` : w; probe.textContent = test;
    if (t.getComputedTextLength() > maxW && ln) { lines.push(ln); ln = w; } else ln = test;
  }
  lines.push(ln); t.replaceChildren();
  const lh = fs * 1.3;
  lines.forEach((s, j) => { el("tspan", { x: 0, dy: j ? lh : 0 }, t).textContent = s; });
  const bb = (t as unknown as SVGGraphicsElement).getBBox();
  const w = bb.width + 14, h = lines.length * lh + 8;
  t.setAttribute("transform", `translate(7, ${fs + 3})`);
  rect.setAttribute("width", String(w)); rect.setAttribute("height", String(h));
  return { g, rect, w, h };
}
/** A line path that breaks wherever a point is null (e.g. 2020, when there was no race). */
export function lineSegments(pts: ({ x: number; y: number } | null)[]) {
  const segs: string[] = []; let cur: [number, number][] = [];
  for (const p of pts) { if (!p) { if (cur.length) segs.push(d3.line()(cur) ?? ""); cur = []; } else cur.push([p.x, p.y]); }
  if (cur.length) segs.push(d3.line()(cur) ?? "");
  return segs.join("");
}
/** Push labels apart vertically so they never overlap. Returns adjusted y values in the input order. */
export function spreadLabels(ys: number[], minGap: number, lo: number, hi: number) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < minGap) order[k].y = order[k - 1].y + minGap;
  const over = order.length ? order[order.length - 1].y - hi : 0;
  if (over > 0) for (const o of order) o.y -= over;
  for (const o of order) o.y = Math.max(lo, o.y);
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}
