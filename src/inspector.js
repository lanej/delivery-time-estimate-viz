import { select, scaleLinear, line, area, max } from "d3";
import { inspectSite, siteDensity } from "./recording.js";

export function mountInspector(root, day, onSelect) {
  const events = new AbortController();
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: events.signal });
  const field = (id) => root.querySelector(`#${id}`);
  const search = field("site-search"), choices = field("site-select"), areaSelect = field("site-area"), zipSelect = field("site-zip");
  const svg = select(field("site-distribution"));
  let state = null;
  let selected = Math.max(0, day.sites.findIndex((site) => site.id === day.scans[0]?.siteId));
  const option = (value, label) => { const el = document.createElement("option"); el.value = value; el.textContent = label; return el; };
  areaSelect.replaceChildren(option("", "All service areas"), ...day.regions.map((region, i) => option(String(i), region.name)));
  const zips = [...new Set(day.sites.map((site) => site.zip).filter(Boolean))].sort();
  zipSelect.replaceChildren(option("", "All ZIPs"), ...zips.map((zip) => option(zip, zip)));
  zipSelect.parentElement.hidden = !zips.length;
  search.value = "";

  function candidates() {
    const query = search.value.trim().toLocaleLowerCase();
    return day.sites.flatMap((site, i) =>
      (areaSelect.value === "" || site.region === Number(areaSelect.value))
      && (!zipSelect.value || site.zip === zipSelect.value)
      && (!query || `${site.label} ${site.id} ${site.zip}`.toLocaleLowerCase().includes(query)) ? [i] : []);
  }
  function fillChoices() {
    const available = candidates();
    if (!available.includes(selected)) selected = available[0] ?? -1;
    choices.replaceChildren(...available.map((i) => option(String(i), day.sites[i].label)));
    choices.value = String(selected);
    choices.disabled = !available.length;
    field("site-count").textContent = `${available.length} of ${day.sites.length} locations`;
    draw(); onSelect(selected);
  }
  function setSelected(index) {
    if (index < 0 || index >= day.sites.length) return;
    if (!candidates().includes(index)) { search.value = ""; areaSelect.value = ""; zipSelect.value = ""; }
    selected = index;
    fillChoices();
  }
  function draw() {
    svg.selectAll("*").remove();
    if (!state || selected < 0) {
      field("site-title").textContent = "No matching locations";
      field("site-meta").textContent = "Try a different search or service area.";
      for (const id of ["site-median", "site-window", "site-change", "site-evidence", "site-chart-note", "site-forecast"]) field(id).textContent = "—";
      svg.attr("aria-label", "No matching location selected");
      return;
    }
    const { site, current, previous, observed } = inspectSite(day, state, selected);
    field("site-title").textContent = site.label;
    field("site-meta").textContent = `${day.regions[site.region].name} area${site.zip ? ` · ZIP ${site.zip}` : ""} · ${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`;
    field("site-median-label").textContent = observed ? "Confirmed delivery" : state.complete ? "Simulated final time" : "Median forecast";
    field("site-median").textContent = current ? day.clock(current.median * 60) : "No prediction";
    field("site-window").textContent = current ? `${Math.round((current.upper - current.lower) * 60)} min` : "Unknown";
    const delta = current && previous ? Math.round(((current.upper - current.lower) - (previous.upper - previous.lower)) * 60) : null;
    field("site-change").textContent = delta === null ? "Initial forecast" : delta === 0 ? "Window unchanged" : `Window ${delta < 0 ? "narrowed" : "widened"} ${Math.abs(delta)} min`;
    const snapshot = state.snapshot;
    field("site-forecast").textContent = `Forecast available ${day.clock(snapshot.at)} · evidence through ${day.clock(snapshot.asOf)} · ${snapshot.modelVersion}`;
    const pending = day.scans.slice(0, state.stage).filter((scan) => !snapshot.evidenceIds.includes(scan.id)).length;
    const added = snapshot.evidenceIds.filter((id) => !state.previous?.evidenceIds.includes(id));
    const latest = added.length === 1 ? day.scans.find((scan) => scan.id === added[0]) : null;
    field("site-evidence").textContent = observed
      ? `Delivered ${day.clock(observed.time * 60)}; evidence arrived ${day.clock(observed.availableMinutes)}.${pending ? ` ${pending} available observation(s) are not in this forecast yet.` : ""}`
      : pending ? `${pending} available observation(s) are not in this forecast yet.`
      : latest ? `This forecast added a delivery in ${day.regions[latest.region].name} at ${day.clock(latest.time * 60)}.`
      : added.length ? `This forecast includes ${added.length} additional delivery observations.`
      : state.previous ? "No additional delivery evidence in this forecast update." : "Initial forecast before local delivery evidence.";

    const currentDensity = observed ? null : siteDensity(day, snapshot, selected);
    const previousDensity = siteDensity(day, state.previous, selected);
    const x = scaleLinear().domain([day.timeMin, day.timeMax]).range([44, 552]);
    const densityMax = Math.max(max(currentDensity || [], (p) => p[1]) || 0, max(previousDensity || [], (p) => p[1]) || 0, 1e-8);
    const y = scaleLinear().domain([0, densityMax]).range([126, 22]);
    const path = line().x((p) => x(p[0])).y((p) => y(p[1]));
    const fill = area().x((p) => x(p[0])).y0(126).y1((p) => y(p[1]));
    for (const t of x.ticks(4)) {
      svg.append("line").attr("x1", x(t)).attr("x2", x(t)).attr("y1", 18).attr("y2", 135).attr("class", "distribution-grid");
      svg.append("text").attr("x", x(t)).attr("y", 163).attr("text-anchor", "middle").attr("class", "distribution-tick").text(day.clock(t * 60));
    }
    if (previousDensity) svg.append("path").attr("d", path(previousDensity)).attr("class", "distribution-previous");
    if (currentDensity) {
      svg.append("path").attr("d", fill(currentDensity)).attr("class", "distribution-fill");
      svg.append("path").attr("d", path(currentDensity)).attr("class", "distribution-current");
    }
    function band(value, row, className) {
      if (!value) return;
      svg.append("line").attr("x1", x(value.lower)).attr("x2", x(value.upper)).attr("y1", row).attr("y2", row).attr("class", className);
      svg.append("circle").attr("cx", x(value.median)).attr("cy", row).attr("r", 3).attr("class", `${className}-median`);
    }
    band(previous, 137, "distribution-before-band");
    band(current, 146, "distribution-band");
    if (current) svg.append("line").attr("x1", x(current.median)).attr("x2", x(current.median)).attr("y1", 20).attr("y2", 148)
      .attr("class", observed || state.complete ? "distribution-actual" : "distribution-median");
    const caption = observed ? "Confirmed time · dashed curve is the previous forecast"
      : state.complete ? "Resolved synthetic outcome · dashed curve is the previous forecast"
      : currentDensity ? "Relative likelihood · solid = current · dashed = previous forecast"
      : current ? "Quantiles only: no full density supplied · solid = current · dashed = previous range"
      : "No prediction supplied for this location";
    field("site-chart-note").textContent = caption;
    svg.attr("aria-label", `${site.label}. ${current ? `Median ${day.clock(current.median * 60)}. Central 80 percent range ${day.clock(current.lower * 60)} to ${day.clock(current.upper * 60)}.` : "Prediction unavailable."} ${caption}`);
  }
  listen(search, "input", fillChoices);
  listen(areaSelect, "change", fillChoices);
  listen(zipSelect, "change", fillChoices);
  listen(choices, "change", () => { selected = Number(choices.value); draw(); onSelect(selected); });
  fillChoices();
  return { select: setSelected, get selected() { return selected; }, candidates,
    update(nextState) { state = nextState; draw(); },
    dispose() { events.abort(); svg.selectAll("*").remove(); } };
}
