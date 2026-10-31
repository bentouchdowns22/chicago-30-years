// The optional "see every year at once" view: one small hill per year, oldest at the top.
import * as d3 from "d3";
import { Data, el, text, haloStyle, smooth, fmtHMRound } from "./data";

export interface Stacked { setSelected(i: number): void; render(): void }

export function mountStacked(box: HTMLElement, data: Data, initial: number): Stacked {
  const { years, T0, BIN, CAP, NB } = data;
  const nRows = years.length;
  const vals = years.map((y) => (data.density(y.year) ? smooth(data.density(y.year)!.share) : new Array<number>(NB).fill(0)));
  const gmax = Math.max(...vals.map((v) => Math.max(...v)));
  let sel = initial;
  const svg = el("svg", { role: "img", "aria-label": "Every year's finish times at once: one hill per year, oldest at the top. The dotted line follows the typical runner." });
  svg.style.cssText = "display:block;width:100%;height:auto";
  box.replaceChildren(svg);

  function render() {
    const W = Math.max(300, box.clientWidth);
    const pitch = W < 560 ? 15 : 18, ridgeH = pitch * 3.6, ml = W < 560 ? 44 : 56, mr = 10, head = 30;
    const x = d3.scaleLinear().domain([T0, CAP]).range([ml, W - mr]);
    const base = years.map((_, i) => head + ridgeH + i * pitch);
    const last = base[nRows - 1], H = last + 58;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", String(W)); svg.setAttribute("height", String(H));
    svg.replaceChildren();
    const k = ridgeH / gmax * 0.95;
    const area = d3.area<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);
    const line = d3.line<number>().x((_, i) => x(T0 + (i + 0.5) * BIN)).curve(d3.curveMonotoneX);

    const g0 = el("g", {}, svg);
    for (let h = 2; h <= 7; h++) {
      el("line", { x1: x(h * 3600), x2: x(h * 3600), y1: head, y2: last + 6, stroke: "var(--grid)" }, g0);
      text(g0, `${h}:00`, { x: x(h * 3600), y: last + 22, "text-anchor": "middle", "font-size": 12 });
    }
    text(g0, "Finish time (hours:minutes)", { x: (ml + W - mr) / 2, y: H - 3, "text-anchor": "middle", "font-size": 12 });
    const gR = el("g", {}, svg);
    years.forEach((y, i) => {
      if (!y.race_held) { el("line", { x1: ml, x2: W - mr, y1: base[i], y2: base[i], stroke: "var(--ink-3)", "stroke-dasharray": "2 4" }, gR); return; }
      const b = base[i];
      area.y0(b).y1((d) => b - d * k); line.y((d) => b - d * k);
      el("path", { d: area(vals[i]) ?? "", fill: i === sel ? "var(--accent)" : "var(--surface)", "fill-opacity": i === sel ? 0.9 : 1 }, gR);
      el("path", { d: line(vals[i]) ?? "", fill: "none", stroke: i === sel ? "var(--accent-ink)" : "var(--ink-3)", "stroke-width": i === sel ? 1.75 : 1 }, gR);
    });
    // typical-runner line with a dot per year
    const segs: string[] = []; let cur: [number, number][] = [];
    years.forEach((y, i) => {
      const m = data.typical(y.year);
      if (!y.race_held || m === null) { if (cur.length) segs.push(d3.line()(cur) ?? ""); cur = []; return; }
      cur.push([x(Math.min(m, CAP)), base[i]]);
    });
    if (cur.length) segs.push(d3.line()(cur) ?? "");
    el("path", { d: segs.join(""), fill: "none", stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "2 3.5", "stroke-linecap": "round" }, svg);
    years.forEach((y, i) => {
      const m = data.typical(y.year);
      if (y.race_held && m !== null) el("circle", { cx: x(Math.min(m, CAP)), cy: base[i], r: 2.4, fill: "var(--ink)" }, svg);
    });
    // year labels
    years.forEach((y, i) => text(svg, String(y.year), { x: ml - 8, y: base[i] - 1, "text-anchor": "end", "font-size": W < 560 ? 10 : 11, "font-weight": i === sel ? 700 : 400 }, { ink: i === sel }));
    // short notes on the special years
    const fs = W < 560 ? 11 : 12;
    years.forEach((y, i) => {
      if (!y.short_note) return;
      const m = data.typical(y.year);
      const room = W - mr - 8 - (m !== null ? x(Math.min(m, CAP)) : ml) - 30;
      const maxW = m !== null ? Math.max(80, Math.min(190, room)) : 150;
      const g = el("g", {}, svg);
      const rect = el("rect", { rx: 6, fill: "var(--surface)", "fill-opacity": 0.92, stroke: "var(--ink-3)" }, g);
      const t = el("text", { "font-size": fs }, g); t.style.fill = "var(--ink)";
      const probe = el("tspan", {}, t);
      const lines: string[] = []; let ln = "";
      for (const w of y.short_note.split(" ")) {
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
      g.setAttribute("transform", `translate(${W - mr - 6 - w}, ${base[i] - 14})`);
    });
    const m0 = data.typical(years[0].year), m1 = data.typical(years[nRows - 1].year);
    if (m0 !== null) { const t = text(svg, `1996: about ${fmtHMRound(m0)}`, { x: Math.min(Math.max(x(m0), ml + 60), W - mr - 60), y: head - 14, "text-anchor": "middle", "font-size": 12, "font-weight": 700 }, { ink: true, halo: true }); haloStyle(t); }
    if (m1 !== null) text(svg, `2023: about ${fmtHMRound(m1)}`, { x: Math.min(Math.max(x(m1), ml + 60), W - mr - 60), y: last + 40, "text-anchor": "middle", "font-size": 12, "font-weight": 700 }, { ink: true, halo: true });
  }
  return { setSelected(i) { sel = i; if (box.clientWidth) render(); }, render };
}
