import * as d3 from "d3";

// ---------- data shapes (see docs/data-dictionary.md) ----------
type Group = "all" | "F" | "M";
interface YearEntry {
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
interface DensityRow { year: number; gender: Group; n: number; beyond_cap: number; share: number[] }
interface DensityFile { start_seconds: number; bin_seconds: number; cap_seconds: number; bins: number; rows: DensityRow[] }
interface QuantRow { year: number; gender: Group; age_group: string; n: number; p25: number | null; p50: number | null; p75: number | null }

const BASE = import.meta.env.BASE_URL;
async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  return res.json() as Promise<T>;
}

// ---------- small helpers ----------
const $ = <T extends HTMLElement | SVGElement>(id: string) => document.getElementById(id) as unknown as T;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmtClock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const fmtHM = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
const fmtHMRound = (s: number) => fmtHM(Math.round(s / 60) * 60);
const WHO: Record<Group, string> = { all: "runners", F: "women", M: "men" };
const ONE: Record<Group, string> = { all: "runner", F: "woman", M: "man" };
const SVGNS = "http://www.w3.org/2000/svg";
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
}
/** text that stays readable on top of lines: a surface-coloured outline behind the letters */
function halo(t: SVGElement) {
  t.style.paintOrder = "stroke";
  t.style.stroke = "var(--surface)";
  t.style.strokeWidth = "4px";
  t.style.strokeLinejoin = "round";
}

// light display smoothing: 5-point weighted average, normalised at the edges
function smooth(a: number[]): number[] {
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

async function main() {
  const [yearsFile, densityFile, quantFile] = await Promise.all([
    getJson<{ years: YearEntry[] }>("years.json"),
    getJson<DensityFile>("density.json"),
    getJson<{ rows: QuantRow[] }>("quantiles.json"),
  ]);
  const years = yearsFile.years; // 1996..2023 including a "no race" 2020 entry
  const { start_seconds: T0, bin_seconds: BIN, cap_seconds: CAP, bins: NB } = densityFile;

  const dens = new Map<string, DensityRow>();
  for (const r of densityFile.rows) dens.set(`${r.year}|${r.gender}`, r);
  const median = new Map<string, number | null>();
  const qrow = new Map<string, QuantRow>();
  for (const r of quantFile.rows) if (r.age_group === "all") { median.set(`${r.year}|${r.gender}`, r.p50); qrow.set(`${r.year}|${r.gender}`, r); }

  const nRows = years.length;
  const firstRace = years.findIndex((y) => y.race_held);
  const lastRace = nRows - 1 - [...years].reverse().findIndex((y) => y.race_held);
  const zeros = () => new Array<number>(NB).fill(0);
  const raw: Record<Group, number[][]> = { all: [], F: [], M: [] };
  const smoothed: Record<Group, number[][]> = { all: [], F: [], M: [] };
  for (const g of ["all", "F", "M"] as Group[]) {
    for (const y of years) {
      const d = dens.get(`${y.year}|${g}`);
      raw[g].push(d ? d.share : zeros());
      smoothed[g].push(d ? smooth(d.share) : zeros());
    }
  }
  const globalMax = Math.max(...(["all", "F", "M"] as Group[]).flatMap((g) => smoothed[g].map((r) => Math.max(...r))));

  // ---------- state ----------
  let group: Group = "all";
  let sel = nRows - 1;
  let playing = false;
  let timer: number | undefined;

  // ---------- layout ----------
  const svg = $<SVGSVGElement>("chart");
  const wrap = $<HTMLDivElement>("chart-wrap");
  const tip = $<HTMLDivElement>("tip");
  let W = 0, H = 0, ml = 0, mr = 0, pitch = 0, ridgeH = 0, head = 0;
  let x: d3.ScaleLinear<number, number>;
  let baseY: number[] = [];

  let disp: number[][] = [];
  let medDisp: number[] = [];
  let ovVals = zeros(), ovY = 0, ovMed = 0, ovOpacity = 1;
  let ridgeFill: SVGPathElement[] = [], ridgeLine: SVGPathElement[] = [], medDots: SVGCircleElement[] = [];
  let medianPath: SVGPathElement, ovFill: SVGPathElement, ovLine: SVGPathElement, ovDot: SVGCircleElement, ovLabel: SVGTextElement;
  let storyTop: SVGTextElement, storyBottom: SVGTextElement, storyLeader: SVGLineElement;
  let yearLabels: SVGTextElement[] = [], hair: SVGLineElement;
  let areaGen: d3.Area<number>, lineGen: d3.Line<number>;
  let animating = false, lastT = 0;

  const targetVals = (i: number) => smoothed[group][i];
  const targetMed = (i: number): number | null => median.get(`${years[i].year}|${group}`) ?? null;
  const medX = (m: number) => x(Math.min(m, CAP));

  /** A small note box on the chart, wrapped to maxW and pinned to the right edge, starting just above a year's row. */
  function pill(parent: Element, text: string, row: number, maxW: number, fs: number) {
    const g = el("g", {}, parent);
    const rect = el("rect", { rx: 6, fill: "var(--surface)", "fill-opacity": 0.9, stroke: "var(--ink-3)", "stroke-width": 1 }, g);
    const t = el("text", { "font-size": fs }, g);
    t.style.fill = "var(--ink)";
    const probe = el("tspan", {}, t);
    const lines: string[] = [];
    let line = "";
    for (const w of text.split(" ")) {
      const test = line ? `${line} ${w}` : w;
      probe.textContent = test;
      if (t.getComputedTextLength() > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    t.replaceChildren();
    const lh = fs * 1.3;
    lines.forEach((ln, k) => { el("tspan", { x: 0, dy: k ? lh : 0 }, t).textContent = ln; });
    const bb = (t as unknown as SVGGraphicsElement).getBBox();
    const w = bb.width + 14, h = lines.length * lh + 8;
    t.setAttribute("transform", `translate(7, ${fs + 3})`);
    rect.setAttribute("width", String(w)); rect.setAttribute("height", String(h));
    g.setAttribute("transform", `translate(${W - mr - 6 - w}, ${baseY[row] - 14})`);
  }

  function layout() {
    W = Math.max(320, wrap.clientWidth);
    pitch = W < 560 ? 16 : W < 820 ? 18 : 20;
    ridgeH = pitch * 3.6;
    ml = W < 560 ? 50 : 62; mr = 12; head = 52;
    const plotW = W - ml - mr;
    x = d3.scaleLinear().domain([T0, CAP]).range([ml, W - mr]);
    baseY = years.map((_, i) => head + ridgeH + i * pitch);
    const lastBase = baseY[nRows - 1];
    H = lastBase + 66;
    areaGen = d3.area<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);
    lineGen = d3.line<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.replaceChildren();
    el("title", { id: "chart-title" }, svg).textContent = "How long Chicago Marathon runners took to finish, each year from 1996 to 2023";
    el("desc", { id: "chart-desc" }, svg).textContent =
      "One hill per year, oldest at the top. The further right a hill sits, the slower the finish times; the taller it is, the more runners finished at that time. A dotted line follows the typical runner. The selected year is shown in blue. A written summary and a table are under More details.";

    // time axis
    const gGrid = el("g", {}, svg);
    for (let h = 2; h <= 7; h++) {
      const gx = x(h * 3600);
      el("line", { x1: gx, x2: gx, y1: head, y2: lastBase + 6, stroke: "var(--grid)", "stroke-width": 1 }, gGrid);
      el("text", { x: gx, y: lastBase + 38, "text-anchor": "middle", "font-size": 12 }, gGrid).textContent = `${h}:00`;
    }
    el("text", { x: ml + plotW / 2, y: H - 6, "text-anchor": "middle", "font-size": W < 560 ? 12 : 13 }, gGrid).textContent =
      W < 560 ? "Finish time (hours:minutes) → slower" : "Finish time, in hours:minutes (4:30 = 4 hours 30 minutes) → slower";

    // hills, oldest (top) to newest (bottom): later rows cover earlier ones
    const gR = el("g", {}, svg);
    ridgeFill = []; ridgeLine = [];
    years.forEach((y) => {
      if (!y.race_held) {
        ridgeFill.push(el("path", { fill: "none" }, gR)); ridgeLine.push(el("path", { fill: "none" }, gR));
        return;
      }
      ridgeFill.push(el("path", { fill: "var(--surface)", stroke: "none" }, gR));
      ridgeLine.push(el("path", { fill: "none", stroke: "var(--ink-3)", "stroke-width": 1, "stroke-linejoin": "round" }, gR));
    });
    years.forEach((y, i) => {
      if (!y.race_held) el("line", { x1: ml, x2: W - mr, y1: baseY[i], y2: baseY[i], stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "2 4" }, gR);
    });

    // the typical-runner (middle finisher) marker: dotted line plus a dot for every year
    medianPath = el("path", { fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "2 3.5", "stroke-linecap": "round" }, svg);
    medDots = years.map((y, i) => el("circle", { r: 2.4, cy: baseY[i], fill: "var(--ink)", opacity: y.race_held ? 1 : 0 }, svg));
    storyLeader = el("line", { stroke: "var(--ink)", "stroke-width": 1, opacity: 0.6 }, svg);
    storyTop = el("text", { "font-size": W < 560 ? 12 : 13, "font-weight": 700, "text-anchor": "middle" }, svg);
    storyBottom = el("text", { "font-size": W < 560 ? 12 : 13, "font-weight": 700, "text-anchor": "middle" }, svg);
    for (const t of [storyTop, storyBottom]) { t.style.fill = "var(--ink)"; halo(t); }

    // year labels down the left side
    const gL = el("g", {}, svg);
    el("text", { x: ml - 8, y: baseY[0] - 16, "text-anchor": "end", "font-size": 11, "font-weight": 700 }, gL).textContent = "Year";
    yearLabels = years.map((y, i) => {
      const t = el("text", { x: ml - 8, y: baseY[i] - 1, "text-anchor": "end", "font-size": W < 560 ? 10 : 11 }, gL);
      t.textContent = String(y.year);
      return t;
    });

    // the selected year: a bold hill that glides and reshapes between years
    const gO = el("g", {}, svg);
    ovFill = el("path", { fill: "var(--accent)", "fill-opacity": 0.9 }, gO);
    ovLine = el("path", { fill: "none", stroke: "var(--accent-ink)", "stroke-width": 1.75, "stroke-linejoin": "round" }, gO);
    ovDot = el("circle", { r: 5, fill: "var(--surface)", stroke: "var(--ink)", "stroke-width": 2.5 }, gO);
    ovLabel = el("text", { "font-size": 12, "font-weight": 700 }, gO);
    ovLabel.style.fill = "var(--ink)"; halo(ovLabel);
    // short notes on the three special years, on top, sized to stay clear of that year's typical-runner dot
    const gN = el("g", {}, svg);
    const fs = W < 560 ? 11 : 12;
    years.forEach((y, i) => {
      if (!y.short_note) return;
      const meds = (["all", "F", "M"] as Group[]).map((g) => median.get(`${y.year}|${g}`)).filter((m): m is number => typeof m === "number");
      const dotRight = meds.length ? Math.max(...meds.map(medX)) : ml;
      const avail = W - mr - 8 - dotRight - 16;
      const maxW = meds.length ? Math.max(70, Math.min(190, avail - 14)) : Math.min(190, Math.max(120, plotW * 0.2));
      pill(gN, y.short_note, i, maxW, fs);
    });
    hair = el("line", { y1: head, y2: lastBase + 6, stroke: "var(--ink)", "stroke-width": 1, opacity: 0 }, svg);

    disp = years.map((_, i) => targetVals(i).slice());
    medDisp = years.map((_, i) => targetMed(i) ?? 0);
    snapOverlay();
    refreshLabels();
    drawAll();
  }

  function snapOverlay() {
    ovVals = targetVals(sel).slice();
    ovY = baseY[sel];
    ovMed = targetMed(sel) ?? 0;
    ovOpacity = years[sel].race_held ? 1 : 0;
  }

  // ---------- drawing ----------
  function drawRow(i: number) {
    if (!years[i].race_held) return;
    const b = baseY[i], k = ridgeH / globalMax * 0.95;
    areaGen.y0(b).y1((d) => b - d * k);
    lineGen.y((d) => b - d * k);
    ridgeFill[i].setAttribute("d", areaGen(disp[i]) ?? "");
    ridgeLine[i].setAttribute("d", lineGen(disp[i]) ?? "");
  }
  function drawOverlay() {
    const k = ridgeH / globalMax * 0.95;
    areaGen.y0(ovY).y1((d) => ovY - d * k);
    lineGen.y((d) => ovY - d * k);
    ovFill.setAttribute("d", areaGen(ovVals) ?? "");
    ovLine.setAttribute("d", lineGen(ovVals) ?? "");
    for (const n of [ovFill, ovLine, ovDot, ovLabel]) n.setAttribute("opacity", String(ovOpacity));
    const mx = medX(ovMed);
    ovDot.setAttribute("cx", String(mx)); ovDot.setAttribute("cy", String(ovY));
    const right = mx > W * 0.6;
    ovLabel.setAttribute("x", String(mx + (right ? -10 : 10)));
    ovLabel.setAttribute("y", String(ovY - 9));
    ovLabel.setAttribute("text-anchor", right ? "end" : "start");
  }
  function drawMedianLine() {
    const segs: string[] = [];
    let cur: [number, number][] = [];
    years.forEach((y, i) => {
      if (!y.race_held) { if (cur.length) segs.push(d3.line()(cur) ?? ""); cur = []; medDots[i].setAttribute("opacity", "0"); return; }
      const mx = medX(medDisp[i]);
      cur.push([mx, baseY[i]]);
      medDots[i].setAttribute("cx", String(mx));
    });
    if (cur.length) segs.push(d3.line()(cur) ?? "");
    medianPath.setAttribute("d", segs.join(""));
    // labels at both ends of the dotted line: the thing to notice
    const mx0 = medX(medDisp[firstRace]), mx1 = medX(medDisp[lastRace]);
    const half = W < 560 ? 105 : 130;
    const cx0 = Math.min(Math.max(mx0, ml + half), W - mr - half);
    const cx1 = Math.min(Math.max(mx1, ml + 70), W - mr - 70);
    storyTop.setAttribute("x", String(cx0)); storyTop.setAttribute("y", String(head - 18));
    storyLeader.setAttribute("x1", String(mx0)); storyLeader.setAttribute("x2", String(mx0));
    storyLeader.setAttribute("y1", String(head - 13)); storyLeader.setAttribute("y2", String(baseY[firstRace] - 3));
    storyBottom.setAttribute("x", String(cx1)); storyBottom.setAttribute("y", String(baseY[lastRace] + 19));
  }
  function drawAll() { for (let i = 0; i < nRows; i++) drawRow(i); drawOverlay(); drawMedianLine(); }
  function refreshLabels() {
    yearLabels.forEach((t, i) => {
      const on = i === sel;
      t.setAttribute("font-weight", on ? "700" : "400");
      t.style.fill = on ? "var(--ink)" : "";
    });
    const m = targetMed(sel);
    const atEnd = sel === firstRace || sel === lastRace; // the story labels already show these two
    ovLabel.textContent = years[sel].race_held && m !== null && !atEnd ? `Typical ${ONE[group]}: ${fmtHMRound(m)}` : "";
    const m0 = targetMed(firstRace), m1 = targetMed(lastRace);
    storyTop.textContent = m0 !== null ? `${years[firstRace].year}: the typical ${ONE[group]} took about ${fmtHMRound(m0)}` : "";
    storyBottom.textContent = m1 !== null ? `${years[lastRace].year}: about ${fmtHMRound(m1)}` : "";
  }

  // ---------- animation: displayed values glide toward targets ----------
  function startAnim() {
    if (reduceMotion) {
      disp = years.map((_, i) => targetVals(i).slice());
      medDisp = years.map((_, i) => targetMed(i) ?? 0);
      snapOverlay(); drawAll(); return;
    }
    if (!animating) { animating = true; lastT = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now: number) {
    const dt = Math.min(64, now - lastT); lastT = now;
    const kRows = 1 - Math.exp(-dt / 140), kOv = 1 - Math.exp(-dt / 110);
    let busy = false;
    for (let i = 0; i < nRows; i++) {
      if (!years[i].race_held) continue;
      const t = targetVals(i), d = disp[i];
      let moved = false;
      for (let j = 0; j < NB; j++) {
        const diff = t[j] - d[j];
        if (Math.abs(diff) > globalMax * 0.0004) { d[j] += diff * kRows; moved = true; } else d[j] = t[j];
      }
      const tm = targetMed(i) ?? medDisp[i];
      if (Math.abs(tm - medDisp[i]) > 20) { medDisp[i] += (tm - medDisp[i]) * kRows; moved = true; } else medDisp[i] = tm;
      if (moved) { drawRow(i); busy = true; }
    }
    const tv = targetVals(sel), ty = baseY[sel], tm = targetMed(sel) ?? ovMed, to = years[sel].race_held ? 1 : 0;
    let ovMoved = false;
    for (let j = 0; j < NB; j++) {
      const diff = tv[j] - ovVals[j];
      if (Math.abs(diff) > globalMax * 0.0004) { ovVals[j] += diff * kOv; ovMoved = true; } else ovVals[j] = tv[j];
    }
    if (Math.abs(ty - ovY) > 0.2) { ovY += (ty - ovY) * kOv; ovMoved = true; } else ovY = ty;
    if (Math.abs(tm - ovMed) > 20) { ovMed += (tm - ovMed) * kOv; ovMoved = true; } else ovMed = tm;
    if (Math.abs(to - ovOpacity) > 0.01) { ovOpacity += (to - ovOpacity) * kOv; ovMoved = true; } else ovOpacity = to;
    if (ovMoved) { drawOverlay(); busy = true; }
    if (busy) { drawMedianLine(); requestAnimationFrame(frame); } else animating = false;
  }

  // ---------- text panels ----------
  const groupCount = (y: YearEntry) => (group === "all" ? y.finishers : group === "F" ? y.women : y.men);
  function renderReadout() {
    const y = years[sel], box = $<HTMLElement>("readout");
    box.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = String(y.year);
    if (y.race_held && y.date) { const sp = document.createElement("span"); sp.textContent = y.date.replace(/, \d{4}$/, ""); h.appendChild(sp); }
    box.appendChild(h);
    const addNote = () => { if (y.note) { const p = document.createElement("p"); p.className = "note"; p.textContent = y.note; box.appendChild(p); } };
    if (!y.race_held) { addNote(); $<HTMLElement>("cap-note").textContent = ""; return; }
    const dl = document.createElement("dl");
    const add = (label: string, value: string) => {
      const d = document.createElement("div");
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      d.append(dt, dd); dl.appendChild(d);
    };
    const m = targetMed(sel);
    if (m !== null) add(`The typical ${ONE[group]} finished in`, `${fmtClock(m)}  (h:mm:ss)`);
    add(`${WHO[group][0].toUpperCase()}${WHO[group].slice(1)} who finished`, (groupCount(y) ?? 0).toLocaleString("en-US"));
    if (y.weather) add("Temperature, 6 AM → noon", `${Math.round(y.weather.temp_6am)}° → ${Math.round(y.weather.temp_noon)}°F`);
    box.appendChild(dl);
    addNote();
    const d = dens.get(`${y.year}|${group}`)!;
    $<HTMLElement>("cap-note").textContent =
      `The chart stops at 7:00. In ${y.year}, ${d.beyond_cap.toLocaleString("en-US")} ${WHO[group]} (${(d.beyond_cap / d.n * 100).toFixed(1)}%) finished later than that; they are still counted in all the numbers.`;
  }
  function renderSummary() {
    const meds = years.filter((y) => y.race_held && median.get(`${y.year}|${group}`) != null)
      .map((y) => ({ y, m: median.get(`${y.year}|${group}`)! }));
    const first = meds[0], last = meds[meds.length - 1];
    const slow = meds.reduce((a, b) => (b.m > a.m ? b : a)), fast = meds.reduce((a, b) => (b.m < a.m ? b : a));
    const extra = slow.y.not_comparable ? " (that race was stopped by heat)" : "";
    $<HTMLElement>("summary").textContent =
      `For ${group === "all" ? "everyone who finished" : WHO[group]}, the typical finish time (half finished faster, half slower) was ${fmtClock(first.m)} in ${first.y.year} and ${fmtClock(last.m)} in ${last.y.year}. ` +
      `The quickest year was ${fast.y.year} (${fmtClock(fast.m)}) and the slowest was ${slow.y.year} (${fmtClock(slow.m)})${extra}. There was no race in 2020, and 2022 is missing about 8% of its finishers.`;
  }
  function renderTable() {
    const t = $<HTMLTableElement>("table"); t.replaceChildren();
    const head = t.createTHead().insertRow();
    ["Year", `${WHO[group][0].toUpperCase()}${WHO[group].slice(1)} who finished`, "A quarter had finished by", "Typical runner (half had finished by)", "Three quarters had finished by", "Finished after 7:00"].forEach((c) => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = c; head.appendChild(th);
    });
    const body = t.createTBody();
    years.forEach((y) => {
      const r = body.insertRow();
      const q = qrow.get(`${y.year}|${group}`), d = dens.get(`${y.year}|${group}`);
      const tag = y.not_comparable ? " (stopped by heat)" : y.partial_data ? " (some results missing)" : "";
      const cells = y.race_held && q && d
        ? [`${y.year}${tag}`, (groupCount(y) ?? 0).toLocaleString("en-US"), q.p25 ? fmtClock(q.p25) : "n/a", q.p50 ? fmtClock(q.p50) : "n/a", q.p75 ? fmtClock(q.p75) : "n/a", d.beyond_cap.toLocaleString("en-US")]
        : [`${y.year} (no race)`, "—", "—", "—", "—", "—"];
      cells.forEach((c) => { r.insertCell().textContent = c; });
    });
  }
  function renderSpecial() {
    const ul = $<HTMLElement>("special"); ul.replaceChildren();
    years.filter((y) => y.short_note).forEach((y) => {
      const li = document.createElement("li");
      const b = document.createElement("strong"); b.textContent = `${y.year}. `;
      li.append(b, `${y.detail_note ?? y.note ?? ""} `);
      y.sources?.forEach((u, k) => {
        const a = document.createElement("a"); a.href = u; a.rel = "noopener"; a.target = "_blank";
        a.textContent = new URL(u).hostname.replace(/^www\./, "");
        li.append(k === 0 ? "Sources: " : ", ", a);
      });
      ul.appendChild(li);
    });
  }

  // ---------- controls ----------
  const slider = $<HTMLInputElement>("year"), out = $<HTMLOutputElement>("year-out"), playBtn = $<HTMLButtonElement>("play");
  function select(i: number) {
    sel = Math.max(0, Math.min(nRows - 1, i));
    slider.value = String(sel);
    out.textContent = String(years[sel].year);
    slider.setAttribute("aria-valuetext", years[sel].race_held ? String(years[sel].year) : `${years[sel].year}, no race`);
    refreshLabels(); renderReadout(); startAnim();
  }
  function setGroup(g: Group) {
    group = g;
    document.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.group === g)));
    refreshLabels(); renderReadout(); renderSummary(); renderTable(); startAnim();
  }
  function setPlaying(on: boolean) {
    playing = on;
    window.clearTimeout(timer);
    playBtn.textContent = on ? "❚❚ Pause" : "▶ Play";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play through the years");
    $<HTMLElement>("readout").setAttribute("aria-live", on ? "off" : "polite");
    if (on) {
      if (sel >= nRows - 1) select(0);
      const stepFn = () => {
        if (sel >= nRows - 1) { setPlaying(false); return; }
        select(sel + 1);
        timer = window.setTimeout(stepFn, 850);
      };
      timer = window.setTimeout(stepFn, 700);
    }
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  slider.addEventListener("input", () => { if (playing) setPlaying(false); select(Number(slider.value)); });
  document.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => setGroup(b.dataset.group as Group)));

  // ---------- hover / click on the chart ----------
  const rowAt = (py: number) => Math.max(0, Math.min(nRows - 1, Math.round((py - baseY[0]) / pitch)));
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (W / r.width), sy = (e.clientY - r.top) * (H / r.height);
    if (sx < ml || sx > W - mr || sy < head - 10 || sy > baseY[nRows - 1] + 8) { tip.hidden = true; hair.setAttribute("opacity", "0"); return; }
    const i = rowAt(sy), y = years[i];
    const bin = Math.max(0, Math.min(NB - 1, Math.floor((x.invert(sx) - T0) / BIN)));
    hair.setAttribute("x1", String(sx)); hair.setAttribute("x2", String(sx)); hair.setAttribute("opacity", "0.35");
    const t0 = T0 + bin * BIN;
    tip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = y.race_held ? String(y.year) : `${y.year}: no race`;
    tip.appendChild(strong);
    if (y.race_held) {
      const share = raw[group][i][bin] ?? 0;
      tip.append(`About ${(share * 100).toFixed(1)}% of ${WHO[group]} finished between ${fmtHM(t0)} and ${fmtHM(t0 + BIN)}. Tap to pick this year.`);
    }
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(8, e.clientX - wr.left + 14), wr.width - 250);
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, e.clientY - wr.top - 70)}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; hair.setAttribute("opacity", "0"); });
  svg.addEventListener("click", (e) => {
    const r = svg.getBoundingClientRect();
    const sy = (e.clientY - r.top) * (H / r.height);
    if (playing) setPlaying(false);
    select(rowAt(sy));
  });

  // ---------- start ----------
  // optional deep link for sharing/testing, e.g. #year=2007&group=F&theme=light
  const hash = new URLSearchParams(location.hash.slice(1));
  const hy = years.findIndex((y) => String(y.year) === hash.get("year"));
  if (hy >= 0) sel = hy;
  const ht = hash.get("theme");
  if (ht === "light" || ht === "dark") document.documentElement.dataset.theme = ht;
  const hg = hash.get("group");
  if (hg === "F" || hg === "M" || hg === "all") group = hg;
  layout();
  renderSpecial();
  select(sel);
  setGroup(group);
  let lastW = wrap.clientWidth;
  new ResizeObserver(() => {
    if (Math.abs(wrap.clientWidth - lastW) < 2) return;
    lastW = wrap.clientWidth; layout();
  }).observe(wrap);
}

main().catch((err) => {
  const box = document.getElementById("readout");
  if (box) box.textContent = `Sorry, the chart could not load: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
