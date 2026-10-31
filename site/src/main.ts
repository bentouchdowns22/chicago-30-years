import * as d3 from "d3";
import { loadData, YearEntry, el, text, smooth, fmtClock, fmtHMRound, pct, num } from "./data";
import { mountStacked } from "./stacked";

const $ = <T extends HTMLElement | SVGElement>(id: string) => document.getElementById(id) as unknown as T;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (name: string) => `var(--${name})`;

async function main() {
  const data = await loadData();
  const { years, T0, BIN, CAP, NB } = data;
  const nRows = years.length;
  const idx = (year: number) => years.findIndex((y) => y.year === year);
  const yr = (year: number) => years[idx(year)];
  const FIRST = years.findIndex((y) => y.race_held);
  const LAST = nRows - 1;
  let sel = LAST;
  let playing = false;
  let timer: number | undefined;

  // ---------- the numbers the story rests on (all from the data files) ----------
  const t96 = data.typical(1996)!, t23 = data.typical(2023)!;
  const share = (year: number) => data.womenShare(yr(year))!;
  const midYears = years.filter((y) => y.year >= 2008 && y.year <= 2018 && y.race_held);
  const midTimes = midYears.map((y) => data.typical(y.year)!);
  const midLo = Math.min(...midTimes), midHi = Math.max(...midTimes);
  const peakWomen = years.filter((y) => y.race_held).reduce((a, b) => (share(b.year) > share(a.year) ? b : a));
  $("head-a").textContent = `The typical Chicago Marathon finish time barely changed between 1996 and 2023: about ${fmtHMRound(t96)}, then ${fmtHMRound(t23)}.`;
  $("head-b").textContent = `But the field did: women went from ${pct(share(1996))} of finishers to ${pct(share(2023))}.`;

  // ---------- shared pieces ----------
  const slider = $<HTMLInputElement>("year"), out = $<HTMLOutputElement>("year-out"), playBtn = $<HTMLButtonElement>("play");
  const smoothed = years.map((y) => (data.density(y.year) ? smooth(data.density(y.year)!.share) : new Array<number>(NB).fill(0)));
  const gmax = Math.max(...smoothed.map((v) => Math.max(...v)));
  const widthOf = (id: string) => Math.max(300, $<HTMLElement>(id).clientWidth);

  /** Wrap text into a note box. Returns the box's group so callers can place it. */
  function noteBox(parent: Element, str: string, maxW: number, fs: number) {
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

  // =====================================================================================
  // 1. HERO: one big hill for the selected year, 1996 faint behind it
  // =====================================================================================
  const hero = $<SVGSVGElement>("hero");
  let hW = 0, hH = 0, hBase = 0, hHill = 0, hx: d3.ScaleLinear<number, number>;
  let vals = smoothed[sel].slice(), hMed = data.typical(years[sel].year) ?? t23, hOp = 1;
  let selPath: SVGPathElement, selLine: SVGPathElement, medLine: SVGLineElement, medDot: SVGCircleElement, medLabel: SVGTextElement;
  let gLabel: SVGTextElement, gLine: SVGLineElement;
  let yearText: SVGTextElement, subText: SVGTextElement, statusG: SVGGElement, noRace: SVGTextElement;
  let heroArea: d3.Area<number>, heroLine: d3.Line<number>;
  let animating = false, lastT = 0;

  function buildHero() {
    hW = widthOf("hero-wrap");
    const phone = hW < 560;
    const fs = phone ? 52 : 72, topZone = fs + (phone ? 58 : 38);
    hHill = phone ? 110 : 190;
    hBase = topZone + hHill; hH = hBase + 56;
    hx = d3.scaleLinear().domain([T0, CAP]).range([12, hW - 12]);
    heroArea = d3.area<number>().x((_, i) => hx(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX).y0(hBase);
    heroLine = d3.line<number>().x((_, i) => hx(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);
    hero.setAttribute("viewBox", `0 0 ${hW} ${hH}`); hero.setAttribute("width", String(hW)); hero.setAttribute("height", String(hH));
    hero.replaceChildren();
    el("title", { id: "hero-title" }, hero).textContent = "How long Chicago Marathon runners took to finish, for the selected year, with 1996 faintly behind it";
    const k = (hHill * 0.9) / gmax;
    const g0 = el("g", {}, hero);
    for (let h = 2; h <= 7; h++) {
      const gx = hx(h * 3600);
      el("line", { x1: gx, x2: gx, y1: topZone, y2: hBase + 5, stroke: css("grid") }, g0);
      text(g0, `${h}:00`, { x: gx, y: hBase + 22, "text-anchor": h === 7 ? "end" : h === 2 ? "start" : "middle", "font-size": 12 });
    }
    text(g0, "Finish time, in hours:minutes  → slower", { x: hW / 2, y: hH - 8, "text-anchor": "middle", "font-size": 13 });
    el("line", { x1: 12, x2: hW - 12, y1: hBase, y2: hBase, stroke: css("ink-3") }, g0);

    // the 1996 ghost
    const ghost = smoothed[FIRST];
    heroArea.y1((d) => hBase - d * k); heroLine.y((d) => hBase - d * k);
    el("path", { d: heroArea(ghost) ?? "", fill: css("ink"), "fill-opacity": 0.08 }, hero);
    el("path", { d: heroLine(ghost) ?? "", fill: "none", stroke: css("ink-3"), "stroke-width": 1.25, "stroke-dasharray": "4 3" }, hero);
    const gx = hx(Math.min(t96, CAP));
    gLine = el("line", { x1: gx, x2: gx, y1: topZone - 6, y2: hBase, stroke: css("ink-3"), "stroke-dasharray": "3 3" }, hero);
    gLabel = text(hero, `1996: ${fmtHMRound(t96)}`, { y: topZone - 10, "font-size": 12, "font-weight": 700 }, { ink: true, halo: true });

    // the selected year
    selPath = el("path", { fill: css("accent"), "fill-opacity": 0.88 }, hero);
    selLine = el("path", { fill: "none", stroke: css("accent-ink"), "stroke-width": 2, "stroke-linejoin": "round" }, hero);
    medLine = el("line", { y1: topZone - 6, stroke: css("ink"), "stroke-width": 1.5 }, hero);
    medDot = el("circle", { r: 5, cy: hBase, fill: css("surface"), stroke: css("ink"), "stroke-width": 2.5 }, hero);
    medLabel = text(hero, "", { y: topZone - 10, "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
    noRace = text(hero, "no race", { x: hW / 2, y: hBase - hHill / 2, "text-anchor": "middle", "font-size": phone ? 22 : 28, "font-style": "italic", opacity: 0 }, { ink: true });

    // year and finisher count, large, on the chart
    yearText = el("text", { x: 12, y: fs * 0.88, "font-size": fs, "font-weight": 700 }, hero);
    yearText.style.fontFamily = "var(--serif)"; yearText.style.fill = "var(--ink)";
    subText = text(hero, "", { x: 14, y: fs + 22, "font-size": 14 });
    statusG = el("g", {}, hero);

    heroLabels();
    paintHero();
  }

  function heroLabels() {
    const y = years[sel], phone = hW < 560;
    yearText.textContent = String(y.year);
    subText.textContent = y.race_held ? `${num(y.finishers!)} finishers` : "";
    medLabel.textContent = y.race_held && sel !== FIRST ? `Typical in ${y.year}: ${fmtHMRound(data.typical(y.year)!)}` : y.race_held ? `Typical: ${fmtHMRound(t96)}` : "";
    gLabel.setAttribute("opacity", sel === FIRST || !y.race_held ? "0" : "1");
    gLine.setAttribute("opacity", sel === FIRST ? "0" : "1");
    // short note on the chart for special years
    statusG.replaceChildren();
    if (y.short_note && y.year !== 2020) {
      const { g, w } = noteBox(statusG, y.short_note, Math.min(phone ? 150 : 230, hW * 0.4), phone ? 11 : 12);
      g.setAttribute("transform", `translate(${hW - 12 - w}, ${phone ? 6 : 10})`);
    }
    noRace.textContent = y.race_held ? "" : `${y.year}: no race`;
    noRace.setAttribute("opacity", y.race_held ? "0" : "1");
  }

  function paintHero() {
    const k = (hHill * 0.9) / gmax;
    heroArea.y1((d) => hBase - d * k); heroLine.y((d) => hBase - d * k);
    selPath.setAttribute("d", heroArea(vals) ?? ""); selLine.setAttribute("d", heroLine(vals) ?? "");
    selPath.setAttribute("opacity", String(hOp)); selLine.setAttribute("opacity", String(hOp));
    const mx = hx(Math.min(hMed, CAP));
    medLine.setAttribute("x1", String(mx)); medLine.setAttribute("x2", String(mx)); medLine.setAttribute("y2", String(hBase));
    medDot.setAttribute("cx", String(mx));
    for (const n of [medLine, medDot, medLabel]) n.setAttribute("opacity", String(hOp));
    // labels sit on opposite sides of the two nearby lines so they never collide
    const gx = hx(Math.min(t96, CAP));
    const right = mx >= gx - 1;
    medLabel.setAttribute("x", String(mx + (right ? 7 : -7))); medLabel.setAttribute("text-anchor", right ? "start" : "end");
    gLabel.setAttribute("x", String(gx + (right ? -7 : 7))); gLabel.setAttribute("text-anchor", right ? "end" : "start");
  }

  const targetVals = () => smoothed[sel];
  const targetMed = () => data.typical(years[sel].year) ?? hMed;
  const targetOp = () => (years[sel].race_held ? 1 : 0);
  function startAnim() {
    if (reduceMotion) { vals = targetVals().slice(); hMed = targetMed(); hOp = targetOp(); paintHero(); return; }
    if (!animating) { animating = true; lastT = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now: number) {
    const dt = Math.min(64, now - lastT); lastT = now;
    const k = 1 - Math.exp(-dt / 120);
    const tv = targetVals(), tm = targetMed(), to = targetOp();
    let busy = false;
    for (let j = 0; j < NB; j++) {
      const diff = tv[j] - vals[j];
      if (Math.abs(diff) > gmax * 0.0004) { vals[j] += diff * k; busy = true; } else vals[j] = tv[j];
    }
    if (Math.abs(tm - hMed) > 15) { hMed += (tm - hMed) * k; busy = true; } else hMed = tm;
    if (Math.abs(to - hOp) > 0.01) { hOp += (to - hOp) * k; busy = true; } else hOp = to;
    paintHero();
    if (busy) requestAnimationFrame(frame); else animating = false;
  }

  // =====================================================================================
  // helpers for the two year-by-year line charts
  // =====================================================================================
  function nearestYearIndex(svgEl: SVGSVGElement, W: number, x: d3.ScaleLinear<number, number>, e: MouseEvent) {
    const r = svgEl.getBoundingClientRect();
    const v = Math.round(x.invert((e.clientX - r.left) * (W / r.width)));
    return Math.max(0, Math.min(nRows - 1, idx(Math.max(1996, Math.min(2023, v)))));
  }
  const lineSegments = (pts: ({ x: number; y: number } | null)[]) => {
    const segs: string[] = []; let cur: [number, number][] = [];
    for (const p of pts) { if (!p) { if (cur.length) segs.push(d3.line()(cur) ?? ""); cur = []; } else cur.push([p.x, p.y]); }
    if (cur.length) segs.push(d3.line()(cur) ?? "");
    return segs.join("");
  };

  // =====================================================================================
  // 1b. Typical finish time by year (under the hero)
  // =====================================================================================
  const trend = $<SVGSVGElement>("trend");
  let trendSel: SVGCircleElement, trendX: d3.ScaleLinear<number, number>, trendY: d3.ScaleLinear<number, number>, trendW = 0;
  function buildTrend() {
    const W = trendW = widthOf("trend-wrap"), phone = W < 560, H = phone ? 190 : 210;
    const ml = 40, mr = 14, mt = 14, mb = 28;
    trendX = d3.scaleLinear().domain([1996, 2023]).range([ml, W - mr]);
    trendY = d3.scaleLinear().domain([3 * 3600 + 50 * 60, 5 * 3600 + 8 * 60]).range([H - mb, mt]);
    trend.setAttribute("viewBox", `0 0 ${W} ${H}`); trend.setAttribute("width", String(W)); trend.setAttribute("height", String(H));
    trend.replaceChildren();
    el("rect", { x: trendX(2007.5), y: mt, width: trendX(2018.5) - trendX(2007.5), height: H - mb - mt, fill: css("card") }, trend);
    for (const t of [4, 4.5, 5]) {
      const yy = trendY(t * 3600);
      el("line", { x1: ml, x2: W - mr, y1: yy, y2: yy, stroke: css("grid") }, trend);
      text(trend, `${Math.floor(t)}:${t % 1 ? "30" : "00"}`, { x: ml - 6, y: yy + 4, "text-anchor": "end", "font-size": 12 });
    }
    for (const yv of (phone ? [1996, 2005, 2015, 2023] : [1996, 2000, 2005, 2010, 2015, 2020, 2023])) text(trend, String(yv), { x: trendX(yv), y: H - 8, "text-anchor": yv === 1996 ? "start" : yv === 2023 ? "end" : "middle", "font-size": 12 });
    const pts = years.map((y) => (y.race_held ? { x: trendX(y.year), y: trendY(data.typical(y.year)!) } : null));
    el("path", { d: lineSegments(pts), fill: "none", stroke: css("ink"), "stroke-width": 1.75, "stroke-linejoin": "round" }, trend);
    years.forEach((y) => { if (y.race_held) el("circle", { cx: trendX(y.year), cy: trendY(data.typical(y.year)!), r: 2.6, fill: css("ink") }, trend); });
    // labels say what the data shows, not why
    const bandMid = (trendX(2007.5) + trendX(2018.5)) / 2;
    const nb = noteBox(trend, `Slower in the middle years: ${fmtHMRound(midLo)} to ${fmtHMRound(midHi)} from 2008 to 2018`, Math.max(110, trendX(2018.5) - trendX(2007.5) - 24), phone ? 11 : 12);
    nb.rect.setAttribute("fill-opacity", "0"); nb.rect.setAttribute("stroke", "none");
    nb.g.setAttribute("transform", `translate(${bandMid - nb.w / 2}, ${H - mb - nb.h - 8})`);
    const y07 = data.typical(2007)!;
    const l07 = text(trend, `2007: ${fmtHMRound(y07)}, halted by heat`, { x: trendX(2007) - 8, y: trendY(y07) + 4, "text-anchor": "end", "font-size": 12 }, { ink: true, halo: true });
    if (trendX(2007) - 8 - l07.getComputedTextLength() < ml) { l07.setAttribute("x", String(trendX(2007) + 9)); l07.setAttribute("text-anchor", "start"); }
    text(trend, fmtHMRound(t96), { x: trendX(1996) + 2, y: trendY(t96) - 9, "text-anchor": "start", "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
    text(trend, fmtHMRound(t23), { x: trendX(2023), y: trendY(t23) + 20, "text-anchor": "end", "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
    trendSel = el("circle", { r: 6, fill: css("accent"), stroke: css("surface"), "stroke-width": 2 }, trend);
    updateTrend();
    trend.style.cursor = "pointer";
  }
  function updateTrend() {
    const y = years[sel], m = data.typical(y.year);
    trendSel.setAttribute("opacity", y.race_held && m !== null ? "1" : "0");
    if (y.race_held && m !== null) { trendSel.setAttribute("cx", String(trendX(y.year))); trendSel.setAttribute("cy", String(trendY(m))); }
  }
  trend.addEventListener("click", (e) => { stopPlay(); select(nearestYearIndex(trend, trendW, trendX, e)); });

  // =====================================================================================
  // 2. Women's share of finishers
  // =====================================================================================
  const women = $<SVGSVGElement>("women");
  let womenSel: SVGCircleElement, wX: d3.ScaleLinear<number, number>, wY: d3.ScaleLinear<number, number>, wW = 0;
  function buildWomen() {
    const W = wW = widthOf("women-wrap"), phone = W < 560, H = phone ? 210 : 250;
    const ml = 44, mr = 16, mt = 16, mb = 28;
    wX = d3.scaleLinear().domain([1996, 2023]).range([ml, W - mr]);
    wY = d3.scaleLinear().domain([0.25, 0.55]).range([H - mb, mt]);
    women.setAttribute("viewBox", `0 0 ${W} ${H}`); women.setAttribute("width", String(W)); women.setAttribute("height", String(H));
    women.replaceChildren();
    for (const v of [0.3, 0.4, 0.5]) {
      el("line", { x1: ml, x2: W - mr, y1: wY(v), y2: wY(v), stroke: css("grid") }, women);
      text(women, pct(v), { x: ml - 6, y: wY(v) + 4, "text-anchor": "end", "font-size": 12 });
    }
    for (const yv of (phone ? [1996, 2005, 2015, 2023] : [1996, 2000, 2005, 2010, 2015, 2020, 2023])) text(women, String(yv), { x: wX(yv), y: H - 8, "text-anchor": yv === 1996 ? "start" : yv === 2023 ? "end" : "middle", "font-size": 12 });
    const pts = years.map((y) => (y.race_held ? { x: wX(y.year), y: wY(share(y.year)) } : null));
    el("path", { d: lineSegments(pts), fill: "none", stroke: css("accent-ink"), "stroke-width": 2, "stroke-linejoin": "round" }, women);
    years.forEach((y) => {
      if (!y.race_held) return;
      const hollow = !!y.partial_data;
      el("circle", { cx: wX(y.year), cy: wY(share(y.year)), r: 3, fill: hollow ? css("surface") : css("accent-ink"), stroke: css("accent-ink"), "stroke-width": hollow ? 1.5 : 0 }, women);
    });
    // labeled dots, no explanation: both ends, the 2007 dip, the 2017 peak
    const labelled: [number, string, "above" | "below", "start" | "middle" | "end"][] = [
      [1996, pct(share(1996)), "below", "start"],
      [2007, `2007: ${pct(share(2007), 1)}`, "below", "middle"],
      [peakWomen.year, `${peakWomen.year}: ${pct(share(peakWomen.year), 1)}`, "above", "middle"],
      [2023, pct(share(2023)), "above", "end"],
    ];
    for (const [yv, lab, pos, anchor] of labelled) {
      const cx = wX(yv), cy = wY(share(yv));
      el("circle", { cx, cy, r: 5, fill: css("accent-ink"), stroke: css("surface"), "stroke-width": 2 }, women);
      text(women, lab, { x: cx + (anchor === "start" ? -2 : anchor === "end" ? 2 : 0), y: cy + (pos === "above" ? -12 : 20), "text-anchor": anchor, "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
    }
    womenSel = el("circle", { r: 8, fill: "none", stroke: css("accent"), "stroke-width": 3 }, women);
    updateWomen();
    women.style.cursor = "pointer";
  }
  function updateWomen() {
    const y = years[sel];
    womenSel.setAttribute("opacity", y.race_held ? "1" : "0");
    if (y.race_held) { womenSel.setAttribute("cx", String(wX(y.year))); womenSel.setAttribute("cy", String(wY(share(y.year)))); }
  }
  women.addEventListener("click", (e) => { stopPlay(); select(nearestYearIndex(women, wW, wX, e)); });

  // =====================================================================================
  // 3. 2007 and its neighbours: two measures, 2005-2009
  // =====================================================================================
  const NEIGH = [2005, 2006, 2007, 2008, 2009];
  function bars(svgId: string, wrapId: string, vOf: (y: YearEntry) => number, label: (v: number) => string) {
    const svg = $<SVGSVGElement>(svgId);
    const W = Math.max(140, $<HTMLElement>(wrapId).clientWidth), H = 200, mt = 24, mb = 26, n = NEIGH.length;
    const max = Math.max(...NEIGH.map((y) => vOf(yr(y)))) * 1.04;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H));
    svg.replaceChildren();
    const slot = (W - 8) / n, bw = Math.min(46, slot * 0.62);
    el("line", { x1: 4, x2: W - 4, y1: H - mb, y2: H - mb, stroke: css("ink-3") }, svg);
    NEIGH.forEach((year, i) => {
      const v = vOf(yr(year)), h = (v / max) * (H - mb - mt), cx = 4 + slot * (i + 0.5), hot = year === 2007;
      el("rect", { x: cx - bw / 2, y: H - mb - h, width: bw, height: h, rx: 3, fill: hot ? css("accent") : css("bar") }, svg);
      text(svg, label(v), { x: cx, y: H - mb - h - 6, "text-anchor": "middle", "font-size": 13, "font-weight": hot ? 700 : 400 }, { ink: true });
      text(svg, String(year), { x: cx, y: H - 8, "text-anchor": "middle", "font-size": 12, "font-weight": hot ? 700 : 400 }, { ink: hot });
    });
  }
  function buildSeason() {
    bars("b-count", "b-count-wrap", (y) => y.finishers!, (v) => `${(v / 1000).toFixed(1)}k`);
    bars("b-time", "b-time-wrap", (y) => data.typical(y.year)!, (v) => fmtHMRound(v));
  }
  function renderSeasonCaption() {
    const cap = $<HTMLElement>("y07-caption");
    const f = (year: number) => num(Math.round(yr(year).finishers! / 1000) * 1000);
    cap.replaceChildren();
    cap.append(
      `In 2007 the data has about 25,000 finishers, compared with about ${f(2006)} in 2006 and about ${f(2008)} in 2008. ` +
      `The typical finish time was ${fmtHMRound(data.typical(2007)!)}, compared with ${fmtHMRound(data.typical(2006)!)} in 2006 and ${fmtHMRound(data.typical(2008)!)} in 2008. ` +
      `Reports say record heat halted the race (`);
    (yr(2007).sources ?? []).forEach((u, k) => {
      const a = document.createElement("a"); a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = new URL(u).hostname.replace(/^www\./, "");
      cap.append(k ? ", " : "", a);
    });
    cap.append("). The data can’t show how many runners were stopped.");
  }

  // =====================================================================================
  // 4. The optional every-year view, and More details
  // =====================================================================================
  const stackBox = $<HTMLDetailsElement>("stack-box");
  const stacked = mountStacked($("stacked"), data, sel);
  stackBox.addEventListener("toggle", () => { if (stackBox.open) stacked.render(); });

  function renderDetails() {
    const t = $<HTMLTableElement>("table"); t.replaceChildren();
    const head = t.createTHead().insertRow();
    ["Year", "Runners who finished", "Women’s share of finishers", "Typical finish time", "A quarter had finished by", "Three quarters had finished by", "Finished after 7:00", "Temperature, 6 AM → noon (°F)"].forEach((c) => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = c; head.appendChild(th);
    });
    const body = t.createTBody();
    years.forEach((y) => {
      const r = body.insertRow();
      const q = data.quant(y.year), d = data.density(y.year);
      const tag = y.not_comparable ? " (stopped by heat)" : y.partial_data ? " (some results missing)" : "";
      const cells = y.race_held && q && d
        ? [`${y.year}${tag}`, num(y.finishers!), pct(share(y.year), 1), fmtClock(q.p50!), fmtClock(q.p25!), fmtClock(q.p75!), num(d.beyond_cap),
           y.weather ? `${Math.round(y.weather.temp_6am)} → ${Math.round(y.weather.temp_noon)}` : "—"]
        : [`${y.year} (no race)`, "—", "—", "—", "—", "—", "—", "—"];
      cells.forEach((c) => { r.insertCell().textContent = c; });
    });
    const ul = $<HTMLElement>("special"); ul.replaceChildren();
    years.filter((y) => y.short_note).forEach((y) => {
      const li = document.createElement("li");
      const b = document.createElement("strong"); b.textContent = `${y.year}. `;
      li.append(b, `${y.detail_note ?? y.note ?? ""} `);
      y.sources?.forEach((u, k) => {
        const a = document.createElement("a"); a.href = u; a.rel = "noopener"; a.target = "_blank"; a.textContent = new URL(u).hostname.replace(/^www\./, "");
        li.append(k === 0 ? "Sources: " : ", ", a);
      });
      ul.appendChild(li);
    });
    $<HTMLElement>("past7").textContent = NEIGH.map((y) => `${y}: ${num(data.density(y)!.beyond_cap)}`).join("; ") + ".";
    const slow = years.filter((y) => y.race_held).map((y) => ({ y, m: data.typical(y.year)! })).reduce((a, b) => (b.m > a.m ? b : a));
    $<HTMLElement>("summary").textContent =
      `The typical finish time (half finished faster, half slower) was ${fmtClock(t96)} in 1996 and ${fmtClock(t23)} in 2023. ` +
      `From 2008 to 2018 it ran between ${fmtClock(midLo)} and ${fmtClock(midHi)}. The slowest year was ${slow.y.year} (${fmtClock(slow.m)}), the race stopped by heat. ` +
      `Women were ${pct(share(1996), 1)} of finishers in 1996 and ${pct(share(2023), 1)} in 2023; the highest share was ${pct(share(peakWomen.year), 1)} in ${peakWomen.year}. ` +
      `There was no race in 2020, and 2022 is missing about 8% of its results.`;
  }

  // =====================================================================================
  // controls
  // =====================================================================================
  const statusEl = $<HTMLElement>("status");
  function select(i: number) {
    sel = Math.max(0, Math.min(nRows - 1, i));
    const y = years[sel];
    slider.value = String(sel); out.textContent = String(y.year);
    slider.setAttribute("aria-valuetext", y.race_held ? String(y.year) : `${y.year}, no race`);
    statusEl.textContent = y.race_held
      ? `${y.year}: typical finish time ${fmtClock(data.typical(y.year)!)}, ${num(y.finishers!)} finishers.${y.note && y.short_note ? " " + y.note : ""}`
      : `${y.year}: no race.`;
    heroLabels(); paintHero(); updateTrend(); updateWomen(); stacked.setSelected(sel); startAnim();
  }
  function stopPlay() { if (playing) setPlaying(false); }
  function setPlaying(on: boolean) {
    playing = on; window.clearTimeout(timer);
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play through the years");
    statusEl.setAttribute("aria-live", on ? "off" : "polite");
    if (on) {
      if (sel >= LAST) select(0);
      const step = () => { if (sel >= LAST) { setPlaying(false); return; } select(sel + 1); timer = window.setTimeout(step, 850); };
      timer = window.setTimeout(step, 600);
    }
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  slider.addEventListener("input", () => { stopPlay(); select(Number(slider.value)); });

  // ---------- start ----------
  // optional deep link for sharing/testing, e.g. #year=2007&theme=light
  const hash = new URLSearchParams(location.hash.slice(1));
  const hy = idx(Number(hash.get("year")));
  if (hy >= 0) sel = hy;
  for (const k of (hash.get("open") ?? "").split(",")) { if (k === "stack") stackBox.open = true; if (k === "more") document.querySelectorAll<HTMLDetailsElement>("details.more").forEach((d) => { if (d.id !== "stack-box") d.open = true; }); }
  const ht = hash.get("theme");
  if (ht === "light" || ht === "dark") document.documentElement.dataset.theme = ht;
  vals = smoothed[sel].slice(); hMed = data.typical(years[sel].year) ?? t23; hOp = years[sel].race_held ? 1 : 0;

  function buildAll() { buildHero(); buildTrend(); buildWomen(); buildSeason(); if (stackBox.open) stacked.render(); }
  buildAll(); renderSeasonCaption(); renderDetails(); select(sel);
  let lastW = $<HTMLElement>("hero-wrap").clientWidth;
  new ResizeObserver(() => {
    const w = $<HTMLElement>("hero-wrap").clientWidth;
    if (Math.abs(w - lastW) < 2) return;
    lastW = w; buildAll(); select(sel);
  }).observe($<HTMLElement>("hero-wrap"));
}

main().catch((err) => {
  const m = document.querySelector("main");
  const p = document.createElement("p"); p.textContent = `Sorry, the page could not load: ${err instanceof Error ? err.message : String(err)}`;
  m?.prepend(p); console.error(err);
});
