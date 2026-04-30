// External data layer loader — GeoJSON, KML, Shapefile (.zip)

let uploadedLayers = [];

const LAYER_COLORS = ["#f97316","#a855f7","#ec4899","#14b8a6","#f59e0b","#6366f1"];

function initUpload() {
  document.getElementById("btn-upload-file").addEventListener("click", () => {
    document.getElementById("file-input").click();
  });

  document.getElementById("file-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) await loadExternalFile(file);
    e.target.value = "";
  });

  // Drag-and-drop onto the map area
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

async function loadExternalFile(file) {
  const name = file.name;
  const ext  = name.split(".").pop().toLowerCase();

  try {
    let geojson;

    if (ext === "geojson" || ext === "json") {
      geojson = JSON.parse(await file.text());

    } else if (ext === "kml") {
      const dom = new DOMParser().parseFromString(await file.text(), "text/xml");
      geojson   = toGeoJSON.kml(dom);

    } else if (ext === "zip") {
      // Assumes a zipped shapefile (.shp + .dbf + .prj)
      const buf = await file.arrayBuffer();
      geojson   = await shp(buf);

    } else {
      showError(`Unsupported format: .${ext}. Use .geojson, .json, .kml, or .zip (shapefile).`);
      return;
    }

    _addLayer(name, geojson);
  } catch (err) {
    showError("Failed to load file: " + err.message);
  }
}

function _addLayer(name, geojson) {
  const color = LAYER_COLORS[uploadedLayers.length % LAYER_COLORS.length];

  const layer = L.geoJSON(geojson, {
    style: { color, weight: 2, fillOpacity: 0.15, fillColor: color },
    pointToLayer: (_, latlng) =>
      L.circleMarker(latlng, {
        radius: 5, fillColor: color, color: "#fff",
        weight: 1.5, fillOpacity: 0.9,
      }),
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      if (!props) return;
      const rows = Object.entries(props)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `<tr><td class="fp-key">${k}</td><td class="fp-val">${v}</td></tr>`)
        .join("");
      if (rows) {
        layer.bindPopup(
          `<div class="feat-popup"><div class="feat-name">${name}</div><table>${rows}</table></div>`,
          { maxWidth: 260, maxHeight: 200 }
        );
      }
    },
  }).addTo(map);

  const bounds = layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });

  uploadedLayers.push({ name, layer, color, visible: true });
  renderLayerList();
}

function toggleUploadLayer(index) {
  const entry = uploadedLayers[index];
  if (!entry) return;
  if (entry.visible) {
    map.removeLayer(entry.layer);
  } else {
    map.addLayer(entry.layer);
  }
  entry.visible = !entry.visible;
  renderLayerList();
}

function removeUploadLayer(index) {
  if (!uploadedLayers[index]) return;
  map.removeLayer(uploadedLayers[index].layer);
  uploadedLayers.splice(index, 1);
  renderLayerList();
}

function clearAllUploadedLayers() {
  uploadedLayers.forEach(({ layer }) => map.removeLayer(layer));
  uploadedLayers = [];
  renderLayerList();
}

function renderLayerList() {
  const list = document.getElementById("layer-list");
  if (!uploadedLayers.length) {
    list.innerHTML = "<p class='no-layers'>No layers loaded</p>";
    return;
  }
  list.innerHTML = uploadedLayers.map((l, i) => `
    <div class="layer-item${l.visible ? "" : " layer-hidden"}">
      <span class="layer-dot" style="background:${l.visible ? l.color : "#475569"}"></span>
      <span class="layer-name" title="${l.name}">${l.name}</span>
      <button class="layer-toggle${l.visible ? "" : " is-off"}"
              onclick="toggleUploadLayer(${i})"
              title="${l.visible ? "Hide layer" : "Show layer"}"
              style="color:${l.visible ? l.color : "#475569"}">&#9679;</button>
      <button class="layer-remove" onclick="removeUploadLayer(${i})" title="Remove">&#10005;</button>
    </div>
  `).join("");
}
