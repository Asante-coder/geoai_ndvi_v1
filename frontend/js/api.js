const API_BASE = "";

async function searchScenes({ geometry, dateStart, dateEnd, maxCloud }) {
  const res = await fetch(`${API_BASE}/api/scenes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry,
      date_start: dateStart,
      date_end:   dateEnd,
      max_cloud:  maxCloud,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function computeNdvi({ sceneId, redHref, nirHref, geometry }) {
  const res = await fetch(`${API_BASE}/api/ndvi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene_id:  sceneId,
      red_href:  redHref,
      nir_href:  nirHref,
      geometry,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function tileUrl(sceneId) {
  return `${API_BASE}/api/tiles/${sceneId}/{z}/{x}/{y}.png`;
}

async function fetchNdviValue(sceneId, lat, lng) {
  const res = await fetch(
    `${API_BASE}/api/ndvi/${encodeURIComponent(sceneId)}/value?lat=${lat}&lng=${lng}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
