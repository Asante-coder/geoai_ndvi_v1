let histChart = null;

function renderHistogram(bins, counts) {
  const ctx = document.getElementById("histogram-chart").getContext("2d");
  if (histChart) histChart.destroy();

  histChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: bins.map(v => v.toFixed(2)),
      datasets: [{
        label:            "Pixel Count",
        data:             counts,
        backgroundColor:  bins.map(v => ndviColor(v)),
        borderWidth:      0,
        barPercentage:    1.0,
        categoryPercentage: 1.0,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid:  { color: "#1e293b" },
        },
      },
    },
  });
}

function ndviColor(v) {
  if (v < -0.1) return "#8B4513";
  if (v <  0.0) return "#C8A87D";
  if (v <  0.2) return "#FFFF99";
  if (v <  0.4) return "#ADDD8E";
  if (v <  0.6) return "#41AB5D";
  if (v <  0.8) return "#238B45";
  return "#004529";
}
