// Standalone HTML report generator

function downloadReport(scene, stats, histogram) {
  const chartCanvas = document.getElementById("histogram-chart");
  const chartImg    = (chartCanvas && histChart) ? chartCanvas.toDataURL("image/png") : null;
  const html        = _buildHtml(scene, stats, chartImg);
  const fname       = `ndvi_report_${(scene.id || "scene").replace(/\s/g,"_")}_${_today()}.html`;
  _triggerDownload(html, fname, "text/html");
}

function downloadStatsCSV(scene, stats) {
  const rows = [
    ["Field", "Value"],
    ["Scene ID",        scene.id],
    ["Date",            scene.datetime ? scene.datetime.slice(0,10) : ""],
    ["Cloud Cover (%)", scene.cloud_cover >= 0 ? scene.cloud_cover.toFixed(2) : ""],
    ["Min NDVI",        stats.min?.toFixed(4)],
    ["Max NDVI",        stats.max?.toFixed(4)],
    ["Mean NDVI",       stats.mean?.toFixed(4)],
    ["Std Dev",         stats.std?.toFixed(4)],
    ["Median",          stats.median?.toFixed(4)],
    ["P10",             stats.p10?.toFixed(4)],
    ["P25",             stats.p25?.toFixed(4)],
    ["P75",             stats.p75?.toFixed(4)],
    ["P90",             stats.p90?.toFixed(4)],
    ["Vegetation >0.3 (%)", stats.vegetation_pct?.toFixed(2)],
    ["Valid Pixels",    stats.pixel_count],
  ];
  const csv   = rows.map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
  const fname = `ndvi_stats_${(scene.id || "scene").replace(/\s/g,"_")}_${_today()}.csv`;
  _triggerDownload(csv, fname, "text/csv");
}

function _triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function _today() { return new Date().toISOString().slice(0, 10); }

function _buildHtml(scene, stats, chartImg) {
  const now   = new Date().toLocaleString();
  const sRows = [
    ["Min NDVI",         stats.min?.toFixed(4)],
    ["Max NDVI",         stats.max?.toFixed(4)],
    ["Mean NDVI",        stats.mean?.toFixed(4)],
    ["Std Dev",          stats.std?.toFixed(4)],
    ["Median",           stats.median?.toFixed(4)],
    ["P10 / P90",        `${stats.p10?.toFixed(3)} / ${stats.p90?.toFixed(3)}`],
    ["Vegetation >0.3",  `${stats.vegetation_pct?.toFixed(1)}%`],
    ["Valid Pixels",     stats.pixel_count?.toLocaleString()],
  ].map(([k,v]) => `<tr><td>${k}</td><td>${v ?? "—"}</td></tr>`).join("");

  const categories = [
    ["#0369a1", "Sea / Deep water",      "≤ −0.3"],
    ["#8B4513", "Water / Bare rock",     "−0.3 – 0.0"],
    ["#C8A87D", "Bare soil / Urban",     "0.0 – 0.1"],
    ["#d4d400", "Sparse / Stressed veg", "0.1 – 0.2"],
    ["#ADDD8E", "Low / Moderate veg",    "0.2 – 0.4"],
    ["#41AB5D", "Healthy vegetation",    "0.4 – 0.6"],
    ["#238B45", "Dense / Vigorous veg",  "0.6 – 0.8"],
    ["#004529", "Very dense canopy",     "> 0.8"],
  ].map(([c,l,r]) =>
    `<tr><td><span style="display:inline-block;width:12px;height:12px;background:${c};border-radius:2px;margin-right:6px;vertical-align:middle"></span>${l}</td><td>${r}</td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>NDVI Report — ${scene.id || "Scene"}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;color:#1e293b;padding:24px}
    .page{max-width:800px;margin:0 auto}
    .header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#e0e6f0;padding:28px 32px;border-radius:12px;margin-bottom:24px}
    .header h1{font-size:1.5rem;color:#7dd3fc;margin-bottom:6px}
    .header p{font-size:0.8rem;color:#94a3b8;line-height:1.6}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px 22px}
    .card.full{grid-column:1/-1}
    .card h2{font-size:0.72rem;text-transform:uppercase;letter-spacing:.07em;color:#64748b;margin-bottom:14px;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:0.82rem}
    td{padding:5px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
    td:last-child{text-align:right;font-weight:600;color:#0369a1}
    .legend-bar{height:14px;border-radius:6px;background:linear-gradient(to right,#0369a1,#8B4513,#C8A87D,#FFFF99,#ADDD8E,#41AB5D,#238B45,#004529);margin:10px 0 4px}
    .legend-labels{display:flex;justify-content:space-between;font-size:0.67rem;color:#64748b}
    .chart-img{width:100%;border-radius:6px;background:#0f172a;display:block;padding:6px}
    .badge{display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:20px;padding:2px 10px;font-size:0.72rem;font-weight:600;margin-top:4px}
    .footer{text-align:center;font-size:0.68rem;color:#94a3b8;margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0}
    @media print{body{background:#fff;padding:0}.header{-webkit-print-color-adjust:exact;print-color-adjust:exact}.legend-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>&#128752; NDVI Vegetation Health Report</h1>
    <p>
      <strong>Scene:</strong> ${scene.id || "—"} &nbsp;·&nbsp;
      <strong>Date:</strong> ${scene.datetime ? scene.datetime.slice(0,10) : "—"} &nbsp;·&nbsp;
      <strong>Cloud cover:</strong> ${scene.cloud_cover >= 0 ? scene.cloud_cover.toFixed(1)+"%" : "—"}
    </p>
    <p style="margin-top:6px">Generated: ${now} &nbsp;·&nbsp; Sentinel-2 L2A &nbsp;·&nbsp; GeoAI NDVI</p>
  </div>

  <div class="grid">

    <div class="card">
      <h2>Scene Metadata</h2>
      <table>
        <tr><td>Scene ID</td><td style="word-break:break-all">${scene.id || "—"}</td></tr>
        <tr><td>Acquisition date</td><td>${scene.datetime ? scene.datetime.slice(0,10) : "—"}</td></tr>
        <tr><td>Cloud cover</td><td>${scene.cloud_cover >= 0 ? scene.cloud_cover.toFixed(2)+"%" : "—"}</td></tr>
        <tr><td>Bounding box</td><td style="font-size:0.72rem">${scene.bbox ? scene.bbox.map(v=>v.toFixed(3)).join(", ") : "—"}</td></tr>
      </table>
    </div>

    <div class="card">
      <h2>NDVI Statistics</h2>
      <table>${sRows}</table>
    </div>

    ${chartImg ? `
    <div class="card full">
      <h2>NDVI Distribution Histogram</h2>
      <img src="${chartImg}" class="chart-img" alt="NDVI Histogram"/>
    </div>` : ""}

    <div class="card full">
      <h2>NDVI Legend &amp; Classification</h2>
      <div class="legend-bar"></div>
      <div class="legend-labels"><span>−1 Sea</span><span>0 Bare</span><span>+1 Dense veg</span></div>
      <table style="margin-top:14px">${categories}</table>
    </div>

  </div>

  <div class="footer">
    Data source: Copernicus Sentinel-2 (ESA) — free and open under the Copernicus Open Access Hub licence.<br/>
    Report generated by <strong>GeoAI NDVI</strong> &nbsp;·&nbsp; <em>${now}</em>
  </div>

</div>
</body>
</html>`;
}
