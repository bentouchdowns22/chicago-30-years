// The analysis charts. Each builder draws into an existing <svg> and returns update(selectedIndex).
import * as d3 from "d3";
import { Data, el, text, css, widthOf, noteBox, lineSegments, spreadLabels, fmtHM, fmtHMRound, pct, num } from "./data";

export interface Handle { update(sel: number): void }
type Pick = (yearIndex: number) => void;

const $svg = (id: string) => document.getElementById(id) as unknown as SVGSVGElement;
function frame(svg: SVGSVGElement, W: number, H: number) {
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H));
  svg.replaceChildren();
}
const yearTicks = (phone: boolean) => (phone ? [1996, 2005, 2015, 2023] : [1996, 2000, 2005, 2010, 2015, 2020, 2023]);
function yearAxis(svg: SVGSVGElement, x: d3.ScaleLinear<number, number>, y: number, phone: boolean) {
  for (const yv of yearTicks(phone)) text(svg, String(yv), { x: x(yv), y, "text-anchor": yv === 1996 ? "start" : yv === 2023 ? "end" : "middle", "font-size": 12 });
}
/** click anywhere on a year-by-year chart to jump to the nearest year */
function clickPicks(svg: SVGSVGElement, W: number, x: d3.ScaleLinear<number, number>, data: Data, pick: Pick) {
  svg.style.cursor = "pointer";
  svg.onclick = (e) => {
    const r = svg.getBoundingClientRect();
    const yv = Math.max(1996, Math.min(2023, Math.round(x.invert((e.clientX - r.left) * (W / r.width)))));
    pick(data.years.findIndex((y) => y.year === yv));
  };
}
/** runs of consecutive race years, so a chart shows a gap for 2020 */
function runs(data: Data) {
  const out: number[][] = []; let cur: number[] = [];
  data.years.forEach((y, i) => { if (y.race_held) cur.push(i); else { if (cur.length) out.push(cur); cur = []; } });
  if (cur.length) out.push(cur);
  return out;
}

// ============================================================================================
// Intro: finishers per year
// ============================================================================================
export function buildFieldSize(data: Data, ids: { svg: string; wrap: string }, pick: Pick): Handle {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap, 260), phone = W < 420, H = 150, ml = 6, mr = 6, mt = 22, mb = 24;
  frame(svg, W, H);
  const years = data.years, n = years.length, slot = (W - ml - mr) / n, bw = Math.max(3, slot * 0.7);
  const shown = years.filter((y) => y.race_held && y.show_in_count_charts !== false);
  const max = Math.max(...shown.map((y) => y.finishers!)) * 1.05;
  const bars: SVGRectElement[] = [];
  el("line", { x1: ml, x2: W - mr, y1: H - mb, y2: H - mb, stroke: css("ink-3") }, svg);
  years.forEach((y, i) => {
    const cx = ml + slot * (i + 0.5);
    if (!y.race_held || y.show_in_count_charts === false) {
      bars.push(el("rect", { width: 0, height: 0 }, svg));
      if (y.race_held) el("line", { x1: cx - bw / 2, x2: cx + bw / 2, y1: H - mb - 3, y2: H - mb - 3, stroke: css("ink-3"), "stroke-dasharray": "2 2" }, svg);
      return;
    }
    const h = (y.finishers! / max) * (H - mb - mt);
    bars.push(el("rect", { x: cx - bw / 2, y: H - mb - h, width: bw, height: h, rx: 1.5, fill: css("bar") }, svg));
  });
  const last = years[n - 1], second = years.find((y) => y.year === 1997)!;
  const lx = (y: number) => ml + slot * (years.findIndex((e) => e.year === y) + 0.5);
  text(svg, num(last.finishers!), { x: W - mr, y: H - mb - (last.finishers! / max) * (H - mb - mt) - 6, "text-anchor": "end", "font-size": 12, "font-weight": 700 }, { ink: true });
  text(svg, num(second.finishers!), { x: lx(1997), y: H - mb - (second.finishers! / max) * (H - mb - mt) - 6, "text-anchor": "start", "font-size": 12, "font-weight": 700 }, { ink: true });
  for (const yv of phone ? [1997, 2010, 2023] : [1997, 2005, 2010, 2015, 2023]) text(svg, String(yv), { x: lx(yv), y: H - 8, "text-anchor": yv === 1997 ? "start" : yv === 2023 ? "end" : "middle", "font-size": 12 });
  svg.style.cursor = "pointer";
  svg.onclick = (e) => { const r = svg.getBoundingClientRect(); pick(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) * (W / r.width) - ml) / slot)))); };
  return { update(sel) { bars.forEach((b, i) => b.setAttribute("fill", i === sel ? css("accent") : css("bar"))); } };
}

// ============================================================================================
// The middle held; the edges moved
// ============================================================================================
export function buildBand(data: Data, ids: { svg: string; wrap: string }, pick: Pick): Handle {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap), phone = W < 560, H = phone ? 300 : 350;
  const ml = 40, mr = 46, mt = 22, mb = 28;
  frame(svg, W, H);
  const x = d3.scaleLinear().domain([1996, 2023]).range([ml, W - mr]);
  const y = d3.scaleLinear().domain([2 * 3600 + 5 * 60, 6 * 3600 + 45 * 60]).range([H - mb, mt]);
  const sp = new Map(data.analysis.spread.map((r) => [r.year, r]));
  const ys = data.years;
  const mid = ys.filter((e) => e.year >= 2008 && e.year <= 2018 && e.race_held).map((e) => sp.get(e.year)!.p50);

  text(svg, "slower ↑", { x: ml, y: 11, "font-size": 12 });
  el("rect", { x: x(2007.5), y: mt, width: x(2018.5) - x(2007.5), height: H - mb - mt, fill: css("card") }, svg);
  for (const t of [3, 4, 5, 6]) {
    el("line", { x1: ml, x2: W - mr, y1: y(t * 3600), y2: y(t * 3600), stroke: css("grid") }, svg);
    text(svg, `${t}:00`, { x: ml - 6, y: y(t * 3600) + 4, "text-anchor": "end", "font-size": 12 });
  }
  yearAxis(svg, x, H - 8, phone);

  // shaded middle half, then the fastest-5% and slowest-5% lines, then the typical line
  for (const run of runs(data)) {
    const area = d3.area<number>().x((i) => x(ys[i].year)).y0((i) => y(sp.get(ys[i].year)!.p25)).y1((i) => y(sp.get(ys[i].year)!.p75)).curve(d3.curveMonotoneX);
    el("path", { d: area(run) ?? "", fill: css("accent"), "fill-opacity": 0.2 }, svg);
  }
  const series = (key: "p5" | "p50" | "p95") => lineSegments(ys.map((e) => (e.race_held ? { x: x(e.year), y: y(sp.get(e.year)![key]) } : null)));
  el("path", { d: series("p95"), fill: "none", stroke: css("ink-3"), "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);
  el("path", { d: series("p5"), fill: "none", stroke: css("ink-3"), "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);
  el("path", { d: series("p50"), fill: "none", stroke: css("ink"), "stroke-width": 2.25, "stroke-linejoin": "round" }, svg);
  ys.forEach((e) => { if (e.race_held) el("circle", { cx: x(e.year), cy: y(sp.get(e.year)!.p50), r: 2.5, fill: css("ink") }, svg); });

  // labels: what the lines are, and the width of the middle half at each end
  const a = sp.get(1996)!, b = sp.get(2023)!, fs = phone ? 11 : 12;
  const L = (s: string, px: number, py: number, anchor: "start" | "end", bold = false) =>
    text(svg, s, { x: px, y: py, "text-anchor": anchor, "font-size": fs, "font-weight": bold ? 700 : 400 }, { ink: true, halo: true });
  L(`slowest 5% finished after ${fmtHMRound(a.p95)}`, x(1996) + 6, y(a.p95) - 7, "start");
  L(`typical: ${fmtHMRound(a.p50)}`, x(1996) + 6, y(a.p50) - 6, "start", true);
  L(`middle half${phone ? ":" : " spans"} ${Math.round(a.middle_half / 60)} min`, x(1996) + 6, y(a.p50) + 15, "start", true);
  L(`fastest 5% finished before ${fmtHMRound(a.p5)}`, x(1996) + 6, y(a.p5) + 16, "start");
  L(`typical: ${fmtHMRound(b.p50)}`, x(2023) - 6, y(b.p50) - 6, "end", true);
  L(`middle half${phone ? ":" : " spans"} ${Math.round(b.middle_half / 60)} min`, x(2023) - 6, y(b.p50) + 15, "end", true);
  L(fmtHMRound(b.p95), x(2023) + 5, y(b.p95) + 4, "start");
  L(fmtHMRound(b.p5), x(2023) + 5, y(b.p5) + 4, "start");
  const s07 = sp.get(2007)!;
  const l07 = L(`2007: ${fmtHMRound(s07.p50)}, halted by heat`, x(2007) - 8, y(s07.p50) + 4, "end");
  if (x(2007) - 8 - l07.getComputedTextLength() < ml) { l07.setAttribute("x", String(x(2007) + 9)); l07.setAttribute("text-anchor", "start"); }
  const nb = noteBox(svg, phone ? "Slower in the middle years" : `Slower in the middle years: typical ${fmtHMRound(Math.min(...mid))} to ${fmtHMRound(Math.max(...mid))}`, 260, fs);
  nb.rect.setAttribute("fill-opacity", "0"); nb.rect.setAttribute("stroke", "none");
  nb.g.setAttribute("transform", `translate(${(x(2007.5) + x(2018.5)) / 2 - nb.w / 2}, ${H - mb - nb.h - 4})`);

  const vline = el("line", { y1: mt, y2: H - mb, stroke: css("accent"), "stroke-width": 1.5, opacity: 0.8 }, svg);
  const dot = el("circle", { r: 6, fill: css("accent"), stroke: css("surface"), "stroke-width": 2 }, svg);
  clickPicks(svg, W, x, data, pick);
  return {
    update(sel) {
      const e = ys[sel], r = sp.get(e.year);
      const on = e.race_held && !!r;
      vline.setAttribute("opacity", on ? "0.8" : "0"); dot.setAttribute("opacity", on ? "1" : "0");
      if (on) { vline.setAttribute("x1", String(x(e.year))); vline.setAttribute("x2", String(x(e.year))); dot.setAttribute("cx", String(x(e.year))); dot.setAttribute("cy", String(y(r!.p50))); }
    },
  };
}

// ============================================================================================
// Temperature vs typical time
// ============================================================================================
export function buildWeather(data: Data, ids: { svg: string; wrap: string }): Handle {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap), phone = W < 560, H = phone ? 280 : 330;
  const ml = 50, mr = 18, mt = 22, mb = 44;
  frame(svg, W, H);
  const w = data.analysis.weather;
  const x = d3.scaleLinear().domain([35, 88]).range([ml, W - mr]);
  const y = d3.scaleLinear().domain([4 * 3600 + 5 * 60, 5 * 3600 + 2 * 60]).range([H - mb, mt]);
  text(svg, "slower ↑", { x: ml, y: 11, "font-size": 12 });
  for (const t of [4.25, 4.5, 4.75, 5]) {
    el("line", { x1: ml, x2: W - mr, y1: y(t * 3600), y2: y(t * 3600), stroke: css("grid") }, svg);
    text(svg, `${Math.floor(t)}:${String(Math.round((t % 1) * 60)).padStart(2, "0")}`, { x: ml - 6, y: y(t * 3600) + 4, "text-anchor": "end", "font-size": 12 });
  }
  for (const t of [40, 50, 60, 70, 80]) text(svg, `${t}°`, { x: x(t), y: H - mb + 18, "text-anchor": "middle", "font-size": 12 });
  text(svg, "Noon temperature on race day (°F, a single reading)", { x: (ml + W - mr) / 2, y: H - 6, "text-anchor": "middle", "font-size": 12 });
  // the fitted line
  const fit = w.points.filter((p) => p.in_fit), x0 = Math.floor(Math.min(...fit.map((p) => p.noon_temp))), x1 = Math.ceil(Math.max(...fit.map((p) => p.noon_temp)));
  const f = (t: number) => w.slope_seconds_per_degree * t + w.intercept_seconds;
  el("line", { x1: x(x0), x2: x(x1), y1: y(f(x0)), y2: y(f(x1)), stroke: css("accent-ink"), "stroke-width": 2, "stroke-dasharray": "6 4" }, svg);
  text(svg, `r = ${w.r.toFixed(2)} across ${w.n} years`, { x: ml + 8, y: mt + 14, "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
  // the points
  w.points.forEach((p) => el("circle", { cx: x(p.noon_temp), cy: y(p.typical), r: 4.5, fill: p.in_fit ? css("ink-3") : css("surface"), stroke: p.in_fit ? css("surface") : css("ink"), "stroke-width": p.in_fit ? 1.5 : 2 }, svg));
  const place: Record<number, [number, number, "start" | "end" | "middle"]> = { 2007: [-9, 4, "end"], 2009: [0, -10, "middle"], 2010: [10, 4, "start"], 2008: [0, -10, "middle"], 2017: [-8, 4, "end"] };
  for (const [yr, [dx, dy, anchor]] of Object.entries(place)) {
    const p = w.points.find((q) => q.year === Number(yr));
    if (p) text(svg, yr === "2007" ? "2007 (halted)" : yr, { x: x(p.noon_temp) + dx, y: y(p.typical) + dy, "text-anchor": anchor, "font-size": 12, "font-weight": 700 }, { ink: true, halo: true });
  }
  const ring = el("circle", { r: 9, fill: "none", stroke: css("accent"), "stroke-width": 3 }, svg);
  return {
    update(sel) {
      const e = data.years[sel], p = w.points.find((q) => q.year === e.year);
      ring.setAttribute("opacity", p ? "1" : "0");
      if (p) { ring.setAttribute("cx", String(x(p.noon_temp))); ring.setAttribute("cy", String(y(p.typical))); }
    },
  };
}

// ============================================================================================
// The edge at 4:00
// ============================================================================================
export function buildEdge(data: Data, ids: { svg: string; wrap: string }): void {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap), phone = W < 560, H = phone ? 220 : 250;
  const ml = 10, mr = 10, mt = 30, mb = 30;
  frame(svg, W, H);
  const rn = data.analysis.round_numbers, counts = rn.pooled_counts_per_minute, start = rn.pooled_start_minute, n = counts.length;
  const slot = (W - ml - mr) / n, bw = slot * 0.78, max = Math.max(...counts) * 1.12;
  const hy = (v: number) => (v / max) * (H - mb - mt);
  el("line", { x1: ml, x2: W - mr, y1: H - mb, y2: H - mb, stroke: css("ink-3") }, svg);
  counts.forEach((c, i) => {
    const m = start + i, hot = m === 239 || m === 240;
    el("rect", { x: ml + slot * i + (slot - bw) / 2, y: H - mb - hy(c), width: bw, height: hy(c), rx: 1.5, fill: hot ? css("accent") : css("bar") }, svg);
  });
  const edgeX = ml + slot * (240 - start);
  el("line", { x1: edgeX, x2: edgeX, y1: mt - 8, y2: H - mb + 5, stroke: css("ink"), "stroke-dasharray": "3 3" }, svg);
  const top3 = H - mb - hy(rn.minute_3_59), top4 = H - mb - hy(rn.minute_4_00);
  text(svg, `3:59 minute: ${num(rn.minute_3_59)}`, { x: edgeX - 6, y: top3 - 8, "text-anchor": "end", "font-size": phone ? 12 : 13, "font-weight": 700 }, { ink: true, halo: true });
  text(svg, `4:00 minute: ${num(rn.minute_4_00)}`, { x: edgeX + 6, y: top4 - 8, "text-anchor": "start", "font-size": phone ? 12 : 13, "font-weight": 700 }, { ink: true, halo: true });
  for (const m of [225, 240, 255]) text(svg, fmtHM(m * 60), { x: ml + slot * (m - start) + (m === 255 ? slot : 0), y: H - 10, "text-anchor": m === 225 ? "start" : m === 255 ? "end" : "middle", "font-size": 12, "font-weight": m === 240 ? 700 : 400 }, { ink: m === 240 });
  text(svg, "Finish time, one bar per minute", { x: W - mr, y: 12, "text-anchor": "end", "font-size": 12 });
}

// ============================================================================================
// An older field
// ============================================================================================
export function buildAge(data: Data, ids: { svg: string; wrap: string }, pick: Pick): Handle {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap), phone = W < 560, H = phone ? 250 : 290;
  const ml = 40, mr = phone ? 124 : 128, mt = 16, mb = 28;
  frame(svg, W, H);
  const x = d3.scaleLinear().domain([1996, 2023]).range([ml, W - mr]);
  const y = d3.scaleLinear().domain([0, 0.42]).range([H - mb, mt]);
  for (const v of [0.1, 0.2, 0.3, 0.4]) {
    el("line", { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: css("grid") }, svg);
    text(svg, pct(v), { x: ml - 6, y: y(v) + 4, "text-anchor": "end", "font-size": 12 });
  }
  yearAxis(svg, x, H - 8, phone);
  const mix = new Map(data.analysis.age.mix.map((r) => [r.year, r]));
  const defs = [
    { key: "50+" as const, label: "50 and over", color: css("accent"), w: 3 },
    { key: "u30" as const, label: "under 30", color: css("orange"), w: 3 },
    { key: "30-39" as const, label: "30 to 39", color: css("ink-3"), w: 1.75 },
    { key: "40-49" as const, label: "40 to 49", color: css("ink-3"), w: 1.75 },
  ];
  for (const d of [...defs].reverse()) {
    el("path", { d: lineSegments(data.years.map((e) => (e.race_held ? { x: x(e.year), y: y(mix.get(e.year)![d.key]) } : null))), fill: "none", stroke: d.color, "stroke-width": d.w, "stroke-linejoin": "round" }, svg);
    data.years.forEach((e) => {
      if (!e.race_held) return;
      el("circle", { cx: x(e.year), cy: y(mix.get(e.year)![d.key]), r: d.w > 2 ? 3.2 : 2.2, fill: e.partial_data ? css("surface") : d.color, stroke: d.color, "stroke-width": e.partial_data ? 1.5 : 0 }, svg);
    });
  }
  const last = mix.get(2023)!;
  const ys = spreadLabels(defs.map((d) => y(last[d.key])), 15, mt + 6, H - mb - 4);
  defs.forEach((d, i) => text(svg, `${d.label} ${pct(last[d.key])}`, { x: W - mr + 8, y: ys[i] + 4, "font-size": phone ? 12 : 13, "font-weight": d.w > 2 ? 700 : 400 }, { ink: true }));
  const first = mix.get(1996)!;
  for (const d of defs.slice(0, 2)) text(svg, pct(first[d.key]), { x: x(1996) + 4, y: y(first[d.key]) + (d.key === "50+" ? 17 : -9), "text-anchor": "start", "font-size": 12, "font-weight": 700 }, { ink: true, halo: true });
  const vline = el("line", { y1: mt, y2: H - mb, stroke: css("accent"), "stroke-width": 1.5, opacity: 0.6 }, svg);
  clickPicks(svg, W, x, data, pick);
  return { update(sel) { const e = data.years[sel]; vline.setAttribute("opacity", e.race_held ? "0.6" : "0"); vline.setAttribute("x1", String(x(e.year))); vline.setAttribute("x2", String(x(e.year))); } };
}

// ============================================================================================
// Round numbers compared: how much finishing bunches up just before each
// ============================================================================================
export function buildRoundNumbers(data: Data, ids: { svg: string; wrap: string }): void {
  const svg = $svg(ids.svg), W = widthOf(ids.wrap), phone = W < 560, H = phone ? 216 : 226;
  const ml = 46, mr = phone ? 102 : 110, mt = 24, mb = 46;
  frame(svg, W, H);
  const ra = data.analysis.round_numbers.before_after_ratio;
  const rows = [["3", "3:00"], ["3.5", "3:30"], ["4", "4:00"], ["5", "5:00"]] as const;
  const x = d3.scaleLinear().domain([0.7, 1.8]).range([ml, W - mr]);
  const slot = (H - mt - mb) / rows.length;
  for (const t of [0.8, 1, 1.2, 1.4, 1.6]) {
    el("line", { x1: x(t), x2: x(t), y1: mt - 6, y2: H - mb, stroke: t === 1 ? css("ink") : css("grid"), "stroke-dasharray": t === 1 ? "3 3" : "none" }, svg);
    text(svg, t.toFixed(1), { x: x(t), y: H - mb + 16, "text-anchor": "middle", "font-size": 12, "font-weight": t === 1 ? 700 : 400 }, { ink: t === 1 });
  }
  text(svg, "no edge", { x: x(1), y: mt - 10, "text-anchor": "middle", "font-size": 12 });
  text(svg, "more runners just before \u2192", { x: W - mr, y: H - 6, "text-anchor": "end", "font-size": 12 });
  rows.forEach(([key, label], i) => {
    const v = Object.values(ra[key]), cy = mt + slot * (i + 0.5);
    const sorted = [...v].sort((p, q) => p - q), med = sorted[Math.floor(sorted.length / 2)];
    const above = v.filter((q) => q > 1).length, strong = above === v.length;
    text(svg, label, { x: ml - 8, y: cy + 4, "text-anchor": "end", "font-size": 14, "font-weight": 700 }, { ink: true });
    el("line", { x1: x(Math.min(...v)), x2: x(Math.max(...v)), y1: cy, y2: cy, stroke: strong ? css("accent") : css("ink-3"), "stroke-width": 6, "stroke-linecap": "round", opacity: 0.35 }, svg);
    el("circle", { cx: x(med), cy, r: 7, fill: strong ? css("accent") : css("ink-3"), stroke: css("surface"), "stroke-width": 2 }, svg);
    text(svg, `${above} of ${v.length} years`, { x: W - mr + 10, y: cy + 4, "font-size": phone ? 12 : 13 }, { ink: true });
  });
}
