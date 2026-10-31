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
const GROUP_NAME: Record<Group, string> = { all: "all finishers", F: "women", M: "men" };
const SVGNS = "http://www.w3.org/2000/svg";
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent?.appendChild(n);
  return n;
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

  // lookups
  const dens = new Map<string, DensityRow>();
  for (const r of densityFile.rows) dens.set(`${r.year}|${r.gender}`, r);
  const median = new Map<string, number | null>();
  const qrow = new Map<string, QuantRow>();
  for (const r of quantFile.rows) if (r.age_group === "all") { median.set(`${r.year}|${r.gender}`, r.p50); qrow.set(`${r.year}|${r.gender}`, r); }

  const nRows = years.length;
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
  let W = 0, H = 0, ml = 0, mr = 0, pitch = 0, ridgeH = 0, top = 0;
  let x: d3.ScaleLinear<number, number>;
  let baseY: number[] = [];

  // animated ("displayed") values chase their targets each frame
  let disp: number[][] = [];
  let medDisp: number[] = [];
  let ovVals = zeros(), ovY = 0, ovMed = 0, ovOpacity = 1;
  let ridgeFill: SVGPathElement[] = [], ridgeLine: SVGPathElement[] = [];
  let medianPath: SVGPathElement, ovFill: SVGPathElement, ovLine: SVGPathElement, ovDot: SVGCircleElement, ovLabel: SVGTextElement;
  let yearLabels: SVGTextElement[] = [], hair: SVGLineElement;
  let areaGen: d3.Area<number>, lineGen: d3.Line<number>;
  let animating = false, lastT = 0;

  const targetVals = (i: number) => smoothed[group][i];
  const targetMed = (i: number): number | null => median.get(`${years[i].year}|${group}`) ?? null;
  const medX = (m: number) => x(Math.min(m, CAP));

  function layout() {
    W = Math.max(320, wrap.clientWidth);
    pitch = W < 560 ? 14 : W < 820 ? 17 : 20;
    ridgeH = pitch * 3.6;
    ml = W < 560 ? 58 : 70; mr = 14; top = 6;
    const plotH = ridgeH + (nRows - 1) * pitch;
    H = top + plotH + 44;
    x = d3.scaleLinear().domain([T0, CAP]).range([ml, W - mr]);
    baseY = years.map((_, i) => top + ridgeH + i * pitch);
    areaGen = d3.area<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);
    lineGen = d3.line<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.replaceChildren();
    el("title", { id: "chart-title" }, svg).textContent = "Chicago Marathon finish-time distributions, 1996 to 2023";
    el("desc", { id: "chart-desc" }, svg).textContent =
      "A stacked ridgeline chart with one hill per race year, oldest at the top. Each hill shows how many runners finished at each point on the clock between 2 and 7 hours. The selected year is highlighted. A text summary and a table follow the chart.";

    // grid + axis
    const gGrid = el("g", {}, svg);
    for (let h = 2; h <= 7; h++) {
      const gx = x(h * 3600);
      el("line", { x1: gx, x2: gx, y1: top, y2: baseY[nRows - 1] + 6, stroke: "var(--grid)", "stroke-width": 1 }, gGrid);
      const t = el("text", { x: gx, y: baseY[nRows - 1] + 22, "text-anchor": "middle", "font-size": 12 }, gGrid);
      t.textContent = `${h}:00`;
    }
    el("text", { x: (ml + W - mr) / 2, y: H - 4, "text-anchor": "middle", "font-size": 12 }, gGrid).textContent =
      "Finish time (hours:minutes on the clock)";

    // ridges, top (oldest) to bottom (newest): later rows occlude earlier ones
    const gR = el("g", {}, svg);
    ridgeFill = []; ridgeLine = []; yearLabels = [];
    years.forEach((y, i) => {
      if (!y.race_held) {
        el("line", { x1: ml, x2: W - mr, y1: baseY[i], y2: baseY[i], stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "2 4" }, gR);
        ridgeFill.push(el("path", { fill: "none" }, gR)); ridgeLine.push(el("path", { fill: "none" }, gR));
        return;
      }
      ridgeFill.push(el("path", { fill: "var(--surface)", stroke: "none" }, gR));
      ridgeLine.push(el("path", { fill: "none", stroke: "var(--ink-3)", "stroke-width": 1, "stroke-linejoin": "round" }, gR));
    });
    // median guide
    medianPath = el("path", { fill: "none", stroke: "var(--ink-2)", "stroke-width": 1.25, "stroke-dasharray": "1.5 3", "stroke-linecap": "round", opacity: 0.8 }, svg);
    // year labels
    const gL = el("g", {}, svg);
    const nr = years.findIndex((y) => !y.race_held);
    if (nr >= 0) {
      el("text", { x: x(2.35 * 3600), y: baseY[nr] - 3, "font-size": 11, "font-style": "italic" }, gL).textContent = "2020: no race";
    }
    const step = pitch >= 17 ? 1 : 2;
    years.forEach((y, i) => {
      const flag = y.not_comparable ? " †" : y.partial_data ? " ‡" : "";
      const t = el("text", { x: ml - 8, y: baseY[i] - 1, "text-anchor": "end", "font-size": 11 }, gL);
      t.textContent = `${y.year}${flag}`;
      if (y.year % step !== 0 && !flag && i !== nRows - 1) t.setAttribute("display", "none");
      yearLabels.push(t);
    });
    // selected-year overlay (a bold ridge that glides and morphs between years)
    const gO = el("g", {}, svg);
    ovFill = el("path", { fill: "var(--accent)", "fill-opacity": 0.9 }, gO);
    ovLine = el("path", { fill: "none", stroke: "var(--accent-ink)", "stroke-width": 1.75, "stroke-linejoin": "round" }, gO);
    ovDot = el("circle", { r: 4, fill: "var(--surface)", stroke: "var(--ink)", "stroke-width": 2 }, gO);
    ovLabel = el("text", { "font-size": 12, "font-weight": 700, "text-anchor": "start" }, gO);
    ovLabel.style.fill = "var(--ink)";
    hair = el("line", { y1: top, y2: baseY[nRows - 1] + 6, stroke: "var(--ink)", "stroke-width": 1, opacity: 0 }, svg);

    // initialise displayed values to the targets (no animation on first layout / resize)
    disp = years.map((_, i) => targetVals(i).slice());
    medDisp = years.map((_, i) => targetMed(i) ?? 0);
    snapOverlay();
    drawAll();
    refreshLabels();
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
    ovFill.setAttribute("opacity", String(ovOpacity));
    ovLine.setAttribute("opacity", String(ovOpacity));
    const mx = medX(ovMed);
    ovDot.setAttribute("cx", String(mx)); ovDot.setAttribute("cy", String(ovY));
    ovDot.setAttribute("opacity", String(ovOpacity));
    const right = mx > W * 0.62;
    ovLabel.setAttribute("x", String(mx + (right ? -9 : 9)));
    ovLabel.setAttribute("y", String(ovY - 8));
    ovLabel.setAttribute("text-anchor", right ? "end" : "start");
    ovLabel.setAttribute("opacity", String(ovOpacity));
  }
  function drawMedianLine() {
    // split into segments so 2020 shows as a gap
    const seg: string[] = [];
    let cur: [number, number][] = [];
    years.forEach((y, i) => {
      if (!y.race_held) { if (cur.length) seg.push(d3.line()(cur) ?? ""); cur = []; return; }
      cur.push([medX(medDisp[i]), baseY[i]]);
    });
    if (cur.length) seg.push(d3.line()(cur) ?? "");
    medianPath.setAttribute("d", seg.join(""));
  }
  function drawAll() { for (let i = 0; i < nRows; i++) drawRow(i); drawOverlay(); drawMedianLine(); }
  function refreshLabels() {
    yearLabels.forEach((t, i) => {
      const on = i === sel;
      t.setAttribute("font-weight", on ? "700" : "400");
      t.style.fill = on ? "var(--ink)" : "";
      if (on) t.removeAttribute("display");
      else if (years[i].year % (pitch >= 17 ? 1 : 2) !== 0 && !years[i].not_comparable && !years[i].partial_data && i !== nRows - 1) t.setAttribute("display", "none");
    });
    ovLabel.textContent = years[sel].race_held && targetMed(sel) !== null ? `Median ${fmtHM(targetMed(sel)!)}` : "";
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
    // overlay
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

  // ---------- readout, summary, table ----------
  function groupCount(y: YearEntry): number | null {
    return group === "all" ? y.finishers : group === "F" ? y.women : y.men;
  }
  function renderReadout() {
    const y = years[sel], box = $<HTMLElement>("readout");
    box.replaceChildren();
    const h = document.createElement("h2");
    h.textContent = y.race_held ? `${y.year}${y.date ? " · " + y.date : ""}` : `${y.year} · no race`;
    box.appendChild(h);
    if (!y.race_held) {
      const p = document.createElement("p"); p.className = "note"; p.textContent = y.note ?? "No race this year."; box.appendChild(p); return;
    }
    const dl = document.createElement("dl");
    const add = (label: string, value: string) => {
      const wrapDiv = document.createElement("div");
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = value;
      wrapDiv.append(dt, dd); dl.appendChild(wrapDiv);
    };
    const n = groupCount(y)!;
    add(`Finishers (${GROUP_NAME[group]})`, n.toLocaleString("en-US") + (y.partial_data ? " (partial)" : ""));
    const m = targetMed(sel);
    add("Median finish", m !== null ? fmtClock(m) : "n/a");
    const q = qrow.get(`${y.year}|${group}`);
    if (q && q.p25 !== null && q.p75 !== null) add("Middle half finished between", `${fmtClock(q.p25)} and ${fmtClock(q.p75)}`);
    if (y.weather) add("Temperature at 6 AM → noon", `${Math.round(y.weather.temp_6am)}° → ${Math.round(y.weather.temp_noon)}°F`);
    const d = dens.get(`${y.year}|${group}`)!;
    add("Finished after 7:00", `${d.beyond_cap.toLocaleString("en-US")} (${(d.beyond_cap / d.n * 100).toFixed(1)}%)`);
    box.appendChild(dl);
    if (y.note) {
      const p = document.createElement("p"); p.className = "note"; p.textContent = y.note; box.appendChild(p);
    }
    if (y.sources?.length) {
      const s = document.createElement("p"); s.className = "sources"; s.append("Sources: ");
      y.sources.forEach((u) => {
        const a = document.createElement("a"); a.href = u; a.rel = "noopener"; a.target = "_blank";
        a.textContent = new URL(u).hostname.replace(/^www\./, ""); s.appendChild(a);
      });
      box.appendChild(s);
    }
  }
  function renderSummary() {
    const held = years.filter((y) => y.race_held && median.get(`${y.year}|${group}`) != null);
    const meds = held.map((y) => ({ y, m: median.get(`${y.year}|${group}`)! }));
    const first = meds[0], last = meds[meds.length - 1];
    const slow = meds.reduce((a, b) => (b.m > a.m ? b : a)), fast = meds.reduce((a, b) => (b.m < a.m ? b : a));
    const note = slow.y.not_comparable ? " (the 2007 race was halted by heat)" : "";
    $<HTMLElement>("summary").textContent =
      `Text summary: for ${GROUP_NAME[group]}, the median finish time was ${fmtClock(first.m)} in ${first.y.year} and ${fmtClock(last.m)} in ${last.y.year}. ` +
      `The quickest yearly median was ${fmtClock(fast.m)} in ${fast.y.year}; the slowest was ${fmtClock(slow.m)} in ${slow.y.year}${note}. ` +
      `There was no race in 2020, and 2022 has partial data.`;
  }
  function renderTable() {
    const t = $<HTMLTableElement>("table"); t.replaceChildren();
    const head = t.createTHead().insertRow();
    ["Year", `Finishers (${GROUP_NAME[group]})`, "25th percentile", "Median", "75th percentile", "After 7:00"].forEach((c) => {
      const th = document.createElement("th"); th.scope = "col"; th.textContent = c; head.appendChild(th);
    });
    const body = t.createTBody();
    years.forEach((y) => {
      const r = body.insertRow();
      const q = qrow.get(`${y.year}|${group}`), d = dens.get(`${y.year}|${group}`);
      const label = y.race_held ? `${y.year}${y.not_comparable ? " †" : y.partial_data ? " ‡" : ""}` : `${y.year} (no race)`;
      const cells = y.race_held && q && d
        ? [label, (groupCount(y) ?? 0).toLocaleString("en-US"), q.p25 ? fmtClock(q.p25) : "n/a", q.p50 ? fmtClock(q.p50) : "n/a", q.p75 ? fmtClock(q.p75) : "n/a", d.beyond_cap.toLocaleString("en-US")]
        : [label, "—", "—", "—", "—", "—"];
      cells.forEach((c) => { r.insertCell().textContent = c; });
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
  function rowAt(py: number): number {
    return Math.max(0, Math.min(nRows - 1, Math.round((py - baseY[0]) / pitch)));
  }
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (W / r.width), sy = (e.clientY - r.top) * (H / r.height);
    if (sx < ml || sx > W - mr) { tip.hidden = true; hair.setAttribute("opacity", "0"); return; }
    const i = rowAt(sy), y = years[i];
    const bin = Math.max(0, Math.min(NB - 1, Math.floor((x.invert(sx) - T0) / BIN)));
    hair.setAttribute("x1", String(sx)); hair.setAttribute("x2", String(sx)); hair.setAttribute("opacity", "0.35");
    const t0 = T0 + bin * BIN;
    tip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = y.race_held ? String(y.year) : `${y.year} (no race)`;
    tip.appendChild(strong);
    if (y.race_held) {
      const share = raw[group][i][bin] ?? 0;
      tip.append(`${fmtHM(t0)}–${fmtHM(t0 + BIN)}: ${(share * 100).toFixed(1)}% of ${GROUP_NAME[group]} finished in this 2-minute window`);
      if (y.not_comparable) tip.append(" †");
      if (y.partial_data) tip.append(" ‡");
    }
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(8, e.clientX - wr.left + 14), wr.width - 250);
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, e.clientY - wr.top - 60)}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; hair.setAttribute("opacity", "0"); });
  svg.addEventListener("click", (e) => {
    const r = svg.getBoundingClientRect();
    const sy = (e.clientY - r.top) * (H / r.height);
    if (playing) setPlaying(false);
    select(rowAt(sy));
  });

  // ---------- start ----------
  // optional deep link, e.g. #year=2007&group=F
  const hash = new URLSearchParams(location.hash.slice(1));
  const hy = years.findIndex((y) => String(y.year) === hash.get("year"));
  if (hy >= 0) sel = hy;
  const ht = hash.get("theme");
  if (ht === "light" || ht === "dark") document.documentElement.dataset.theme = ht;
  const hg = hash.get("group");
  if (hg === "F" || hg === "M" || hg === "all") group = hg;
  layout();
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
