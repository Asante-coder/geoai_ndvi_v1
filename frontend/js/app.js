let scenes       = [];
let currentScene = null;
let currentAOI   = null;
let lastResult   = null;   // stores {stats, histogram} after compute for report

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initUpload();

  document.getElementById("cloud-max").addEventListener("input", (e) => {
    document.getElementById("cloud-val").textContent = e.target.value + "%";
  });

  document.getElementById("btn-search").addEventListener("click", onSearch);
  document.getElementById("btn-compute").addEventListener("click", onCompute);
  document.getElementById("btn-clear").addEventListener("click", onClear);
  document.getElementById("scene-select").addEventListener("change", onSceneSelect);
  document.getElementById("btn-clear-layers").addEventListener("click", clearAllUploadedLayers);

  document.getElementById("btn-report-html").addEventListener("click", () => {
    if (currentScene && lastResult)
      downloadReport(currentScene, lastResult.stats, lastResult.histogram);
  });
  document.getElementById("btn-report-csv").addEventListener("click", () => {
    if (currentScene && lastResult)
      downloadStatsCSV(currentScene, lastResult.stats);
  });
});

async function onSearch() {
  const aoi = getAOIGeometry();
  if (!aoi) { showError("Draw an AOI polygon on the map first."); return; }

  currentAOI = aoi;
  setLoading(true, "Searching scenes…");

  try {
    scenes = await searchScenes({
      geometry:  aoi,
      dateStart: document.getElementById("date-start").value,
      dateEnd:   document.getElementById("date-end").value,
      maxCloud:  parseFloat(document.getElementById("cloud-max").value),
    });

    if (!scenes.length) { showError("No scenes found. Expand date range or cloud cover."); return; }

    populateSceneList(scenes);
    show("scene-list");
    hide("error-msg");
  } catch (err) {
    showError("Scene search failed: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function onCompute() {
  if (!currentScene) { showError("Select a scene first."); return; }

  setBusy(true);
  setLoading(true, "Computing NDVI… this may take a moment.");

  try {
    const result = await computeNdvi({
      sceneId:  currentScene.id,
      redHref:  currentScene.red_href,
      nirHref:  currentScene.nir_href,
      geometry: currentAOI,
    });

    lastResult = result;

    addNdviLayer(currentScene.id);
    const dt = currentScene.datetime ? currentScene.datetime.slice(0, 10) : currentScene.id.slice(0, 16);
    registerNdviLayer(currentScene.id, getNdviLayer(), `NDVI · ${dt}`);
    fitToAOI();
    renderStats(result.stats);
    renderHistogram(result.histogram.bins, result.histogram.counts);
    show("stats-panel");
    hide("error-msg");
  } catch (err) {
    showError("NDVI computation failed: " + err.message);
  } finally {
    setLoading(false);
    setBusy(false);
  }
}

function onClear() {
  clearNdviLayer();
  unregisterNdviLayer();
  hide("stats-panel");
  document.getElementById("stats-table").innerHTML = "";
  if (typeof histChart !== "undefined" && histChart) {
    histChart.destroy();
    histChart = null;
  }
  hide("scene-list");
  document.getElementById("scene-select").innerHTML = "";
  scenes = [];
  currentScene = null;
  lastResult   = null;
  clearAOI();
  hide("error-msg");
}

function onSceneSelect() {
  const idx = document.getElementById("scene-select").selectedIndex;
  currentScene = scenes[idx] || null;
}

function populateSceneList(scenes) {
  const sel = document.getElementById("scene-select");
  sel.innerHTML = scenes.map((s, i) => {
    const dt = s.datetime ? s.datetime.slice(0, 10) : "Unknown";
    const cc = s.cloud_cover >= 0 ? `&#9729; ${s.cloud_cover.toFixed(1)}%` : "";
    return `<option value="${i}">${dt}  ${cc}</option>`;
  }).join("");
  currentScene = scenes[0];
}

function renderStats(stats) {
  if (!stats || !Object.keys(stats).length) return;
  const rows = [
    ["Min",              stats.min?.toFixed(4)],
    ["Max",              stats.max?.toFixed(4)],
    ["Mean",             stats.mean?.toFixed(4)],
    ["Std Dev",          stats.std?.toFixed(4)],
    ["Median",           stats.median?.toFixed(4)],
    ["P10 / P90",        `${stats.p10?.toFixed(3)} / ${stats.p90?.toFixed(3)}`],
    ["Vegetation >0.3",  `${stats.vegetation_pct?.toFixed(1)}%`],
    ["Valid Pixels",     stats.pixel_count?.toLocaleString()],
  ];
  document.getElementById("stats-table").innerHTML =
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${v ?? "—"}</td></tr>`).join("");
}

// ── Helpers ────────────────────────────────────────────

function setLoading(on, msg = "Processing…") {
  const el = document.getElementById("loader");
  if (on) {
    document.getElementById("loader-msg").textContent = msg;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function setBusy(on) {
  ["btn-search","btn-compute","btn-clear","btn-report-html","btn-report-csv"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = on;
  });
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function show(id) { document.getElementById(id).classList.remove("hidden"); }
function hide(id) { document.getElementById(id).classList.add("hidden"); }
