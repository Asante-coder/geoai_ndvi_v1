// Data layer + NDVI layer manager — unified QGIS-style panel

let managedLayers = [];
let _dragSrcIdx   = null;

const LAYER_COLORS = ["#f97316","#a855f7","#ec4899","#14b8a6","#f59e0b","#6366f1"];

// ── Init ─────────────────────────────────────────────────────

function initUpload() {
  document.getElementById("btn-upload-file").addEventListener("click", () =>
    document.getElementById("file-input").click());

  document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await loadExternalFile(file);
    e.target.value = "";
  });

  const mapEl = document.getElementById("map");
  mapEl.addEventListener("dragover",  (e) => { e.preventDefault(); mapEl.classList.add("drag-over"); });
  mapEl.addEventListener("dragleave", ()  => mapEl.classList.remove("drag-over"));
  mapEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    mapEl.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) await loadExternalFile(file);
  });

  renderLayerList();
}

// ── File loading ──────────────────────────────────────────────

async function loadExternalFile(file) {
  const name = file.name;
  const ext  = name.split(".").pop().toLowerCase();
  try {
    let geojson;
    if      (ext === "geojson" || ext === "json") geojson = JSON.parse(await file.text());
    else if (ext === "kml") geojson = toGeoJSON.kml(new DOMParser().parseFromString(await file.text(), "text/xml"));
    else if (ext === "zip") geojson = await shp(await file.arrayBuffer());
    else { showError(`Unsupported format: .${ext}. Use .geojson, .json, .kml, or .zip.`); return; }
    _addDataLayer(name, geojson);
  } catch (err) {
    showError("Failed to load file: " + err.message);
  }
}

// ── Add data layer ────────────────────────────────────────────

function _addDataLayer(name, geojson) {
  const id    = `data-${Date.now()}`;
  const color = LAYER_COLORS[managedLayers.filter(l => l.type === "data").length % LAYER_COLORS.length];

  // Each layer gets its own Leaflet pane so z-order is fully controllable
  const paneName = `layer-pane-${id}`;
  map.createPane(paneName);

  const layer = L.geoJSON(geojson, {
    pane:  paneName,
    style: { color, weight: 2, fillOpacity: 0.15, fillColor: color },
    pointToLayer: (_, latlng) => L.circleMarker(latlng, {
      pane: paneName,
      radius: 5, fillColor: color, color: "#fff", weight: 1.5, fillOpacity: 0.9,
    }),
    onEachFeature: (feature, lyr) => {
      const props = feature.properties;
      if (!props) return;
      const rows = Object.entries(props)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `<tr><td class="fp-key">${k}</td><td class="fp-val">${v}</td></tr>`)
        .join("");
      if (rows) lyr.bindPopup(
        `<div class="feat-popup"><div class="feat-name">${name}</div><table>${rows}</table></div>`,
        { maxWidth: 260, maxHeight: 200 }
      );
    },
  }).addTo(map);

  const bounds = layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

  managedLayers.unshift({ id, name, layer, color, visible: true, type: "data" });
  _refreshZOrder();
  renderLayerList();
}

// ── NDVI layer registration ───────────────────────────────────

function registerNdviLayer(sceneId, layer, label) {
  unregisterNdviLayer();
  managedLayers.unshift({ id: "ndvi", name: label, layer, color: null, visible: true, type: "ndvi" });
  _refreshZOrder();
  renderLayerList();
}

function unregisterNdviLayer() {
  managedLayers = managedLayers.filter(l => l.type !== "ndvi");
  renderLayerList();
}

// ── Visibility toggle ─────────────────────────────────────────

function toggleLayer(id) {
  const entry = managedLayers.find(l => l.id === id);
  if (!entry) return;
  entry.visible = !entry.visible;
  entry.visible ? map.addLayer(entry.layer) : map.removeLayer(entry.layer);
  renderLayerList();
}

// ── Remove / clear ────────────────────────────────────────────

function removeUploadLayer(id) {
  const entry = managedLayers.find(l => l.id === id);
  if (!entry) return;
  if (map.hasLayer(entry.layer)) map.removeLayer(entry.layer);
  managedLayers = managedLayers.filter(l => l.id !== id);
  renderLayerList();
}

function clearAllUploadedLayers() {
  managedLayers.filter(l => l.type === "data").forEach(l => {
    if (map.hasLayer(l.layer)) map.removeLayer(l.layer);
  });
  managedLayers = managedLayers.filter(l => l.type !== "data");
  renderLayerList();
}

// ── Z-order via custom pane z-indices ─────────────────────────

function _refreshZOrder() {
  // Index 0 = top of list = drawn on top = highest z-index
  managedLayers.forEach((l, i) => {
    const paneName = l.type === "ndvi" ? "layer-pane-ndvi" : `layer-pane-${l.id}`;
    const pane = map.getPane(paneName);
    if (pane) pane.style.zIndex = 401 + (managedLayers.length - 1 - i);
  });
}

// ── Drag & drop reorder ───────────────────────────────────────

function _onLayerDragStart(e, index) {
  _dragSrcIdx = index;
  e.dataTransfer.effectAllowed = "move";
  e.currentTarget.classList.add("dragging");
}

function _onLayerDragOver(e, index) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  document.querySelectorAll(".layer-item[data-index]").forEach((el, i) => {
    el.classList.toggle("drop-target", i === index && i !== _dragSrcIdx);
  });
}

function _onLayerDragEnd() {
  _dragSrcIdx = null;
  document.querySelectorAll(".layer-item[data-index]").forEach(el =>
    el.classList.remove("dragging", "drop-target"));
}

function _onLayerDrop(e, targetIndex) {
  e.preventDefault();
  if (_dragSrcIdx === null || _dragSrcIdx === targetIndex) { _onLayerDragEnd(); return; }
  const [moved] = managedLayers.splice(_dragSrcIdx, 1);
  managedLayers.splice(targetIndex, 0, moved);
  _refreshZOrder();
  renderLayerList();
}

// ── Render ────────────────────────────────────────────────────

function renderLayerList() {
  const list = document.getElementById("layer-list");
  if (!managedLayers.length) {
    list.innerHTML = "<p class='no-layers'>No layers loaded</p>";
    return;
  }

  list.innerHTML = managedLayers.map((l, i) => {
    const dotHtml = l.type === "ndvi"
      ? `<span class="layer-dot ndvi-dot" title="NDVI raster layer"></span>`
      : `<span class="layer-dot" style="background:${l.visible ? l.color : "#475569"}"></span>`;

    const removeBtn = l.type !== "ndvi"
      ? `<button class="layer-remove" onclick="removeUploadLayer('${l.id}')" title="Remove">&#10005;</button>`
      : "";

    return `
      <div class="layer-item${l.visible ? "" : " layer-hidden"}"
           data-index="${i}"
           draggable="true"
           ondragstart="_onLayerDragStart(event,${i})"
           ondragover="_onLayerDragOver(event,${i})"
           ondragend="_onLayerDragEnd()"
           ondrop="_onLayerDrop(event,${i})">
        <span class="drag-handle" title="Drag to reorder">&#8942;</span>
        <input class="layer-checkbox" type="checkbox"
               ${l.visible ? "checked" : ""}
               onchange="toggleLayer('${l.id}')"
               title="${l.visible ? "Hide layer" : "Show layer"}">
        ${dotHtml}
        <span class="layer-name" title="${l.name}">${l.name}</span>
        ${removeBtn}
      </div>`;
  }).join("");
}
