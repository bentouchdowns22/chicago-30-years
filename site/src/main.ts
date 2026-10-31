import * as d3 from "d3";
import { loadData, YearEntry, el, text, smooth, css, widthOf, noteBox, lineSegments, fmtClock, fmtHMRound, pct, num } from "./data";
import { mountStacked } from "./stacked";
import { buildAge, buildBand, buildEdge, buildFieldSize, buildRoundNumbers, buildWeather, Handle } from "./charts";

const $ = <T extends HTMLElement | SVGElement>(id: string) => document.getElementById(id) as unknown as T;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function main() {
  const data = await loadData();
  const { years, T0, BIN, CAP, NB, analysis } = data;
  const nRows = years.length;
  const idx = (year: number) => years.findIndex((y) => y.year === year);
  const yr = (year: number) => years[idx(year)];
  const FIRST = years.findIndex((y) => y.race_held);
  const LAST = nRows - 1;
  let sel = LAST;
  let playing = false;
  let timer: number | undefined;

  // ---------- the numbers the page rests on (all from the data files) ----------
  const t96 = data.typical(1996)!, t23 = data.typical(2023)!;
  const share = (year: number) => data.womenShare(yr(year))!;
  const sp = new Map(analysis.spread.map((r) => [r.year, r]));
  const mins = (s: number) => Math.round(s / 60);
  // ---------- intro: the dataset in a few numbers ----------
  const ds = analysis.dataset;
  const stats: [string, string][] = [
    ["Finishers in the data", num(ds.finishers)],
    [`Races, ${ds.first_year}\u2013${ds.last_year}`, String(ds.races)],
    [`Fastest finish, ${ds.fastest_year}`, fmtClock(ds.fastest_seconds)],
    [`Largest field, ${ds.largest_year}`, num(ds.largest_finishers)],
  ];
  const statsEl = $<HTMLElement>("stats");
  for (const [k, v] of stats) {
    const box = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    box.append(dt, dd); statsEl.appendChild(box);
  }

  // ---------- captions for the analysis sections ----------
  const w = analysis.weather, rn = analysis.round_numbers, ag = analysis.age;
  const mid = years.filter((y) => y.year >= 2008 && y.year <= 2018 && y.race_held).map((y) => data.typical(y.year)!);
  const ratios = (h: string) => Object.values(rn.before_after_ratio[h]);
  const a = sp.get(1996)!, b = sp.get(2023)!;
  $("band-caption").textContent =
    `Each year, the top line is the time only 5% of runners took longer than, the bottom line is the time only 5% beat, and the thick line is the typical runner (half were faster, half slower). ` +
    `The shaded band holds the middle half of runners. The typical time barely moved, but the band widened from ${mins(a.middle_half)} to ${mins(b.middle_half)} minutes: ` +
    `the fastest 5% got faster (${fmtHMRound(a.p5)} to ${fmtHMRound(b.p5)}) and the slowest 5% slower (${fmtHMRound(a.p95)} to ${fmtHMRound(b.p95)}). ` +
    `From 2008 to 2018 the typical time sat between ${fmtHMRound(Math.min(...mid))} and ${fmtHMRound(Math.max(...mid))}. 1996 and 2022 are missing some results, which barely changes their typical times.`;
  const slow5 = w.five_slowest_years_excluding_2007.map((p) => p.year).sort((x, y) => x - y);
  const list = (ys: number[]) => `${ys.slice(0, -1).join(", ")} and ${ys[ys.length - 1]}`;
  $("wx-caption").textContent =
    `Warm race days line up with slow years. The five slowest years after 2007 (${list(slow5)}) all had noon temperatures of ${Math.min(...w.five_slowest_years_excluding_2007.map((p) => p.noon_temp))}°F or higher. ` +
    `Across ${w.n} years, each extra degree went with about ${Math.round(w.slope_seconds_per_degree)} seconds on the typical finish time (r = ${w.r.toFixed(2)}, so temperature lines up with about half of the year-to-year differences). ` +
    `On the ${w.warm_days.n} days at or above 70°F the typical time averaged ${fmtHMRound(w.warm_days.average_typical)}; on the ${w.cool_days.n} days at or below 50°F it averaged ${fmtHMRound(w.cool_days.average_typical)}. ` +
    `This is a pattern, not proof: it is one noon reading at one weather station, and other things differed between years too. 2007 is shown but left out of the line.`;
  const r4 = ratios("4"), r5 = ratios("5");
  $("edge-caption").textContent =
    `Each bar is one minute on the clock, adding up every year from 1996 to 2023. In the minute just before 4:00:00, ${num(rn.minute_3_59)} runners finished; in the minute just after, ${num(rn.minute_4_00)} (${Math.round(rn.drop_share * 100)}% fewer). ` +
    `In every year, more runners finished in the five minutes before 4:00 than in the five minutes after (${Math.min(...r4).toFixed(2)} to ${Math.max(...r4).toFixed(2)} times as many), and the same holds around 5:00 (${Math.min(...r5).toFixed(2)} to ${Math.max(...r5).toFixed(2)}). Finish times pile up just under round numbers.`;
  // the 4:00 section: facts, the comparison chart, and the research behind it
  const mc = rn.most_common_minute, u4 = rn.share_under_4h;
  const facts: [string, string][] = [
    [mc.label, `the most common finish minute in Chicago (${num(mc.count)} runners)`],
    [pct(u4.pooled), `of finishers broke four hours (${pct(u4.lowest_year[1])} in ${u4.lowest_year[0]} to ${pct(u4.highest_year[1])} in ${u4.highest_year[0]})`],
    [`${r4.filter((q) => q > 1).length} of ${r4.length}`, "years with more runners just before 4:00 than just after"],
  ];
  const factsEl = $<HTMLElement>("edge-facts");
  for (const [big, small] of facts) {
    const box = document.createElement("div");
    const dd = document.createElement("dd"); dd.textContent = big;
    const dt = document.createElement("dt"); dt.textContent = small;
    box.append(dd, dt); factsEl.appendChild(box);
  }
  const rr = (k: string) => Object.values(rn.before_after_ratio[k]);
  const medOf = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
  const cnt = (k: string) => rr(k).filter((q) => q > 1).length;
  $("rn-caption").textContent =
    `Each row compares the five minutes just before a round number with the five minutes just after it. The dot is the typical year and the bar runs from the lowest year to the highest. 1.0 means no edge; 1.5 means half again as many runners just before. ` +
    `The edge is clear at 4:00 (more runners just before in all ${rr("4").length} years) and 5:00 (all ${rr("5").length}), weaker at 3:00 (${cnt("3")} of ${rr("3").length} years), and missing at 3:30 (the typical year is ${medOf(rr("3.5")).toFixed(2)}).`;
  const psych = $<HTMLElement>("edge-psych");
  const para = (cls: string, ...parts: (string | Node)[]) => { const p = document.createElement("p"); if (cls) p.className = cls; p.append(...parts); psych.appendChild(p); };
  const link = (href: string, label: string) => { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = label; return a; };
  para("", "Researchers who studied more than 9 million marathon finishing times found the same pattern as this chart: far more runners finish just before a round number than just after it (Allen, Dechow, Pope and Wu, 2017, ",
    link("https://www.nber.org/papers/w20343", "free version"), "). Their explanation is that round numbers work as goals. A runner who is close to four hours treats 4:00 as a line to beat.");
  para("", "The idea behind it is called loss aversion: missing a goal hurts more than reaching it feels good. Finishing in 3:59 or 4:01 is only two minutes apart, but it feels like the difference between meeting a goal and missing it, so many runners find extra effort in the last miles. That fits the drop right after 4:00 in the chart.");
  para("", `Why four hours? It is a round number almost every runner has heard of, and the pace it takes is within reach for many recreational runners: about ${rn.pace_for_4h.per_mile} per mile (${rn.pace_for_4h.per_km} per kilometer) for the whole race. In Chicago, ${pct(u4.pooled)} of finishers broke it.`);
  para("note", "What this data can and can\u2019t show: it shows the pattern clearly. It can\u2019t show what any runner was thinking, so the psychology comes from the research, not from this dataset.");

  const std23 = ag.standardized.find((r) => r.year === 2023)!;
  const gaps = Object.values(ag.typical_by_age_group_by_period).map((v) => (v["2008-2018"] - v["1996-2006"]) / 60);
  const mixOf = (year: number) => ag.mix.find((r) => r.year === year)!;
  $("age-caption").textContent =
    `Share of finishers in each age group. Finishers aged 50 or over grew from ${pct(mixOf(1996)["50+"])} to ${pct(mixOf(2023)["50+"])}, while those under 30 fell from ${pct(mixOf(1996).u30)} to ${pct(mixOf(2023).u30)}. ` +
    `That shift moved the typical time very little: holding 1996's age mix fixed, 2023's typical time would be about ${fmtHMRound(std23.typical_1996_age_mix)} instead of ${fmtHMRound(std23.typical_actual)}. ` +
    `Every age group's typical time was ${Math.round(Math.min(...gaps))} to ${Math.round(Math.max(...gaps))} minutes slower in 2008–2018 than in 1996–2006. Ages in the data are 5-year groups. Hollow dots: 1996 and 2022 are missing some results.`;

  // ---------- hero: one big hill for the selected year, 1996 faint behind it ----------
  const slider = $<HTMLInputElement>("year"), out = $<HTMLOutputElement>("year-out"), playBtn = $<HTMLButtonElement>("play");
  const smoothed = years.map((y) => (data.density(y.year) ? smooth(data.density(y.year)!.share) : new Array<number>(NB).fill(0)));
  const gmax = Math.max(...smoothed.map((v) => Math.max(...v)));
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

    const ghost = smoothed[FIRST];
    heroArea.y1((d) => hBase - d * k); heroLine.y((d) => hBase - d * k);
    el("path", { d: heroArea(ghost) ?? "", fill: css("ink"), "fill-opacity": 0.08 }, hero);
    el("path", { d: heroLine(ghost) ?? "", fill: "none", stroke: css("ink-3"), "stroke-width": 1.25, "stroke-dasharray": "4 3" }, hero);
    const gx = hx(Math.min(t96, CAP));
    gLine = el("line", { x1: gx, x2: gx, y1: topZone - 6, y2: hBase, stroke: css("ink-3"), "stroke-dasharray": "3 3" }, hero);
    gLabel = text(hero, `1996: ${fmtHMRound(t96)}`, { y: topZone - 10, "font-size": 12, "font-weight": 700 }, { ink: true, halo: true });

    selPath = el("path", { fill: css("accent"), "fill-opacity": 0.88 }, hero);
    selLine = el("path", { fill: "none", stroke: css("accent-ink"), "stroke-width": 2, "stroke-linejoin": "round" }, hero);
    medLine = el("line", { y1: topZone - 6, stroke: css("ink"), "stroke-width": 1.5 }, hero);
    medDot = el("circle", { r: 5, cy: hBase, fill: css("surface"), stroke: css("ink"), "stroke-width": 2.5 }, hero);
    medLabel = text(hero, "", { y: topZone - 10, "font-size": 13, "font-weight": 700 }, { ink: true, halo: true });
    noRace = text(hero, "no race", { x: hW / 2, y: hBase - hHill / 2, "text-anchor": "middle", "font-size": phone ? 22 : 28, "font-style": "italic", opacity: 0 }, { ink: true });

    yearText = el("text", { x: 12, y: fs * 0.88, "font-size": fs, "font-weight": 700 }, hero);
    yearText.style.fontFamily = "var(--display)"; yearText.style.letterSpacing = "-0.03em"; yearText.style.fill = "var(--ink)";
    subText = text(hero, "", { x: 14, y: fs + 22, "font-size": 14 });
    statusG = el("g", {}, hero);
    heroLabels();
    paintHero();
  }

  function heroLabels() {
    const y = years[sel], phone = hW < 560;
    yearText.textContent = String(y.year);
    subText.textContent = y.race_held ? `${num(y.finishers!)} finishers${y.partial_data ? " in the data" : ""}` : "";
    medLabel.textContent = y.race_held && sel !== FIRST ? `Typical in ${y.year}: ${fmtHMRound(data.typical(y.year)!)}` : y.race_held ? `Typical: ${fmtHMRound(t96)}` : "";
    gLabel.setAttribute("opacity", sel === FIRST || !y.race_held ? "0" : "1");
    gLine.setAttribute("opacity", sel === FIRST ? "0" : "1");
    statusG.replaceChildren();
    if (y.short_note && y.year !== 2020) {
      const { g, w: bw } = noteBox(statusG, y.short_note, Math.min(phone ? 150 : 230, hW * 0.4), phone ? 11 : 12);
      g.setAttribute("transform", `translate(${hW - 12 - bw}, ${phone ? 6 : 10})`);
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

  // ---------- women's share (a smaller, secondary section) ----------
  const women = $<SVGSVGElement>("women");
  let womenSel: SVGCircleElement, wX: d3.ScaleLinear<number, number>, wY: d3.ScaleLinear<number, number>, wW = 0;
  const peakWomen = years.filter((y) => y.race_held).reduce((p, q) => (share(q.year) > share(p.year) ? q : p));
  function buildWomen() {
    const W = wW = widthOf("women-wrap"), phone = W < 560, H = phone ? 190 : 220;
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
    el("path", { d: lineSegments(years.map((y) => (y.race_held ? { x: wX(y.year), y: wY(share(y.year)) } : null))), fill: "none", stroke: css("accent-ink"), "stroke-width": 2, "stroke-linejoin": "round" }, women);
    years.forEach((y) => {
      if (!y.race_held) return;
      const hollow = !!y.partial_data;
      el("circle", { cx: wX(y.year), cy: wY(share(y.year)), r: 3, fill: hollow ? css("surface") : css("accent-ink"), stroke: css("accent-ink"), "stroke-width": hollow ? 1.5 : 0 }, women);
    });
    const labelled: [number, string, "above" | "below", "start" | "middle" | "end"][] = [
      [1996, pct(share(1996)), "below", "start"],
      [2007, `2007: ${pct(share(2007), 1)}`, "below", "middle"],
      [peakWomen.year, `${peakWomen.year}: ${pct(share(peakWomen.year), 1)}`, "above", "middle"],
      [2023, pct(share(2023)), "below", "end"],
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
  women.addEventListener("click", (e) => {
    const r = women.getBoundingClientRect();
    const v = Math.max(1996, Math.min(2023, Math.round(wX.invert((e.clientX - r.left) * (wW / r.width)))));
    stopPlay(); select(idx(v));
  });

  // ---------- 2007 and its neighbours: two measures, 2005-2009 ----------
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
      const link = document.createElement("a"); link.href = u; link.target = "_blank"; link.rel = "noopener"; link.textContent = new URL(u).hostname.replace(/^www\./, "");
      cap.append(k ? ", " : "", link);
    });
    cap.append("). The data can’t show how many runners were stopped.");
  }

  // ---------- every-year view and More details ----------
  const stackBox = $<HTMLDetailsElement>("stack-box");
  const stacked = mountStacked($("stacked"), data, sel);
  stackBox.addEventListener("toggle", () => { if (stackBox.open) stacked.render(); });

  function renderDetails() {
    const t = $<HTMLTableElement>("table"); t.replaceChildren();
    const head = t.createTHead().insertRow();
    ["Year", "Runners who finished", "Typical finish time", "A quarter had finished by", "Three quarters had finished by", "Middle half spans (min)", "Finished after 7:00", "Women’s share of finishers", "Temperature, 6 AM → noon (°F)"].forEach((c) => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = c; head.appendChild(th);
    });
    const body = t.createTBody();
    years.forEach((y) => {
      const r = body.insertRow();
      const q = data.quant(y.year), d = data.density(y.year);
      const tag = y.not_comparable ? " (stopped by heat)" : y.partial_data ? " (some results missing)" : "";
      const cells = y.race_held && q && d
        ? [`${y.year}${tag}`, num(y.finishers!), fmtClock(q.p50!), fmtClock(q.p25!), fmtClock(q.p75!), String(mins(sp.get(y.year)!.middle_half)), num(d.beyond_cap), pct(share(y.year), 1),
           y.weather ? `${Math.round(y.weather.temp_6am)} → ${Math.round(y.weather.temp_noon)}` : "—"]
        : [`${y.year} (no race)`, "—", "—", "—", "—", "—", "—", "—", "—"];
      cells.forEach((c) => { r.insertCell().textContent = c; });
    });
    const ul = $<HTMLElement>("special"); ul.replaceChildren();
    years.filter((y) => y.short_note).forEach((y) => {
      const li = document.createElement("li");
      const b2 = document.createElement("strong"); b2.textContent = `${y.year}. `;
      li.append(b2, `${y.detail_note ?? y.note ?? ""} `);
      y.sources?.forEach((u, k) => {
        const link = document.createElement("a"); link.href = u; link.rel = "noopener"; link.target = "_blank"; link.textContent = new URL(u).hostname.replace(/^www\./, "");
        li.append(k === 0 ? "Sources: " : ", ", link);
      });
      ul.appendChild(li);
    });
    $<HTMLElement>("past7").textContent = NEIGH.map((y) => `${y}: ${num(data.density(y)!.beyond_cap)}`).join("; ") + ".";
    const slow = years.filter((y) => y.race_held).map((y) => ({ y, m: data.typical(y.year)! })).reduce((p, q) => (q.m > p.m ? q : p));
    $<HTMLElement>("summary").textContent =
      `The typical finish time (half finished faster, half slower) was ${fmtClock(t96)} in 1996 and ${fmtClock(t23)} in 2023. ` +
      `The middle half of finishers spanned ${mins(a.middle_half)} minutes in 1996 and ${mins(b.middle_half)} in 2023. ` +
      `The slowest year was ${slow.y.year} (${fmtClock(slow.m)}), the race stopped by heat. Warm race days lined up with slow years (r = ${w.r.toFixed(2)}). ` +
      `Women were ${pct(share(1996), 1)} of finishers in 1996 and ${pct(share(2023), 1)} in 2023. There was no race in 2020, and 1996 and 2022 are missing some results.`;
  }

  // ---------- controls ----------
  const handles: Handle[] = [];
  const statusEl = $<HTMLElement>("status");
  function select(i: number) {
    sel = Math.max(0, Math.min(nRows - 1, i));
    const y = years[sel];
    slider.value = String(sel); out.textContent = String(y.year);
    slider.style.setProperty("--pct", `${(sel / (nRows - 1)) * 100}%`);
    slider.setAttribute("aria-valuetext", y.race_held ? String(y.year) : `${y.year}, no race`);
    statusEl.textContent = y.race_held
      ? `${y.year}: typical finish time ${fmtClock(data.typical(y.year)!)}, ${num(y.finishers!)} finishers.${y.note && y.short_note ? " " + y.note : ""}`
      : `${y.year}: no race.`;
    heroLabels(); paintHero(); updateWomen(); handles.forEach((h) => h.update(sel)); stacked.setSelected(sel); startAnim();
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
  const pick = (i: number) => { stopPlay(); select(i); };

  // ---------- start ----------
  // optional deep link for sharing/testing, e.g. #year=2007&theme=light&open=stack,more
  const hash = new URLSearchParams(location.hash.slice(1));
  const hy = idx(Number(hash.get("year")));
  if (hy >= 0) sel = hy;
  for (const k of (hash.get("open") ?? "").split(",")) {
    if (k === "stack") stackBox.open = true;
    if (k === "more") document.querySelectorAll<HTMLDetailsElement>("details.more").forEach((d) => { if (d.id !== "stack-box") d.open = true; });
  }
  const ht = hash.get("theme");
  if (ht === "light" || ht === "dark") document.documentElement.dataset.theme = ht;
  vals = smoothed[sel].slice(); hMed = data.typical(years[sel].year) ?? t23; hOp = years[sel].race_held ? 1 : 0;

  function buildAll() {
    buildHero(); buildWomen(); buildSeason();
    handles.length = 0;
    handles.push(
      buildFieldSize(data, { svg: "field", wrap: "field-wrap" }, pick),
      buildBand(data, { svg: "band", wrap: "band-wrap" }, pick),
      buildWeather(data, { svg: "wx", wrap: "wx-wrap" }),
      buildAge(data, { svg: "age", wrap: "age-wrap" }, pick),
    );
    buildEdge(data, { svg: "edge", wrap: "edge-wrap" });
    buildRoundNumbers(data, { svg: "rn", wrap: "rn-wrap" });
    if (stackBox.open) stacked.render();
  }
  buildAll(); renderSeasonCaption(); renderDetails(); select(sel);
  let lastW = $<HTMLElement>("hero-wrap").clientWidth;
  new ResizeObserver(() => {
    const wNow = $<HTMLElement>("hero-wrap").clientWidth;
    if (Math.abs(wNow - lastW) < 2) return;
    lastW = wNow; buildAll(); select(sel);
  }).observe($<HTMLElement>("hero-wrap"));
}

main().catch((err) => {
  const m = document.querySelector("main");
  const p = document.createElement("p"); p.textContent = `Sorry, the page could not load: ${err instanceof Error ? err.message : String(err)}. Try a hard refresh (Cmd+Shift+R, or Ctrl+Shift+R on Windows).`;
  m?.prepend(p); console.error(err);
});
