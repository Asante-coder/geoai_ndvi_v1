let map, drawnLayer, ndviLayer, drawControl;
let activeSceneId  = null;
let clickPopup     = null;
let searchMarker   = null;

// ── Basemap definitions ──────────────────────────────────
const BASEMAPS = {
  "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors", maxZoom: 19,
  }),
  "Satellite (ESRI)": L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "© Esri, Maxar, Earthstar Geographics", maxZoom: 19,
  }),
  "Terrain (ESRI)": L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: "© Esri, HERE, Garmin, FAO", maxZoom: 19,
  }),
  "Dark (CartoDB)": L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19,
  }),
  "Light (CartoDB)": L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 19,
  }),
};

function initMap() {
  map = L.map("map").setView([0, 0], 3);

  // Start with OpenStreetMap
  BASEMAPS["OpenStreetMap"].addTo(map);

  // Basemap layer control (top-right)
  L.control.layers(BASEMAPS, {}, { position: "topright", collapsed: true }).addTo(map);

  // ── Geocoder search ──────────────────────────────────
  L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "Search place or address…",
    errorMessage: "Place not found.",
    geocoder: L.Control.Geocoder.nominatim(),
    position: "topleft",
  })
    .on("markgeocode", (e) => {
      const { center, bbox, name } = e.geocode;

      // Remove previous search marker
      if (searchMarker) { searchMarker.remove(); searchMarker = null; }

      // Place a named marker at the result
      searchMarker = L.marker(center, {
        icon: L.divIcon({
          className: "search-marker-icon",
          html: `<div class="search-pin"></div>`,
          iconSize:   [18, 18],
          iconAnchor: [9, 18],
        }),
      })
        .bindPopup(`<div class="search-popup-label">${name}</div>`, { className: "search-popup" })
        .addTo(map)
        .openPopup();

      // Fly to result
      if (bbox) {
        map.fitBounds([[bbox.getSouth(), bbox.getWest()], [bbox.getNorth(), bbox.getEast()]],
          { maxZoom: 14 });
      } else {
        map.setView(center, 12);
      }
    })
    .addTo(map);

  // ── AOI drawing ──────────────────────────────────────
  drawnLayer = new L.FeatureGroup().addTo(map);
  drawControl = new L.Control.Draw({
    draw: {
      polygon:      { allowIntersection: false },
      rectangle:    true,
      circle:       false,
      polyline:     false,
      marker:       false,
      circlemarker: false,
    },
    edit: { featureGroup: drawnLayer },
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, (e) => {
    drawnLayer.clearLayers();
    drawnLayer.addLayer(e.layer);
  });

  // ── NDVI click-to-inspect ────────────────────────────
  map.on("click", onMapClick);
}

async function onMapClick(e) {
  if (!activeSceneId) return;

  const { lat, lng } = e.latlng;

  if (clickPopup) clickPopup.remove();
  clickPopup = L.popup({ maxWidth: 190, className: "ndvi-popup" })
    .setLatLng(e.latlng)
    .setContent(_loadingPopupHtml())
    .openOn(map);

  try {
    const data = await fetchNdviValue(activeSceneId, lat, lng);
    clickPopup.setContent(_ndviPopupHtml(data, lat, lng));
  } catch {
    clickPopup.setContent("<div class='popup-error'>Could not read value.</div>");
  }
}

function _loadingPopupHtml() {
  return `<div class="popup-loading">
    <div class="popup-spinner"></div><span>Reading…</span>
  </div>`;
}

function _ndviPopupHtml(data, lat, lng) {
  const { value, category } = data;
  const valStr  = value !== null ? value.toFixed(3) : "—";
  const barPct  = value !== null ? ((value + 1) / 2 * 100).toFixed(1) : 50;

  return `
    <div class="ndvi-popup-body">
      <div class="popup-coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
      <div class="popup-value-row">
        <span class="popup-label">NDVI</span>
        <span class="popup-value">${valStr}</span>
      </div>
      <div class="popup-bar-track">
        <div class="popup-bar-marker" style="left:${barPct}%"></div>
      </div>
      <div class="popup-bar-scale"><span>-1</span><span>0</span><span>+1</span></div>
      <div class="popup-category" style="border-left:3px solid ${category.color}">
        <span class="popup-swatch" style="background:${category.color}"></span>
        ${category.label}
      </div>
    </div>`;
}

// ── Public helpers ───────────────────────────────────────

function getAOIGeometry() {
  const layers = drawnLayer.getLayers();
  if (!layers.length) return null;
  return layers[0].toGeoJSON().geometry;
}

function addNdviLayer(sceneId) {
  if (ndviLayer) map.removeLayer(ndviLayer);
  activeSceneId = sceneId;

  // Dedicated pane so upload.js can control its z-order alongside data layers
  if (!map.getPane("layer-pane-ndvi")) map.createPane("layer-pane-ndvi");

  ndviLayer = L.tileLayer(tileUrl(sceneId), {
    opacity:     0.8,
    maxZoom:     16,
    attribution: "NDVI · Sentinel-2 L2A",
    pane:        "layer-pane-ndvi",
  }).addTo(map);
}

function getNdviLayer() { return ndviLayer; }

function fitToAOI() {
  const layers = drawnLayer.getLayers();
  if (layers.length) map.fitBounds(drawnLayer.getBounds(), { padding: [20, 20] });
}

function clearNdviLayer() {
  if (ndviLayer)   { map.removeLayer(ndviLayer); ndviLayer = null; }
  if (clickPopup)  { clickPopup.remove();        clickPopup = null; }
  activeSceneId = null;
}

function clearAOI() {
  drawnLayer.clearLayers();
}
