// Shared data loading, types and small helpers (data files are described in docs/data-dictionary.md).
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
}
export interface DensityRow { year: number; gender: Group; n: number; beyond_cap: number; share: number[] }
export interface QuantRow { year: number; gender: Group; age_group: string; n: number; p25: number | null; p50: number | null; p75: number | null }

export interface Data {
  years: YearEntry[];
  T0: number; BIN: number; CAP: number; NB: number;
  density: (year: number, g?: Group) => DensityRow | undefined;
  typical: (year: number, g?: Group) => number | null; // typical (middle) finish time in seconds
  quant: (year: number, g?: Group) => QuantRow | undefined;
  womenShare: (y: YearEntry) => number | null;
}

const BASE = import.meta.env.BASE_URL;
async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

export async function loadData(): Promise<Data> {
  const [yf, df, qf] = await Promise.all([
    getJson<{ years: YearEntry[] }>("years.json"),
    getJson<{ start_seconds: number; bin_seconds: number; cap_seconds: number; bins: number; rows: DensityRow[] }>("density.json"),
    getJson<{ rows: QuantRow[] }>("quantiles.json"),
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
