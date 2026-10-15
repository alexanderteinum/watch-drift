const $ = (selector) => document.querySelector(selector);
let watches = [];
let selectedSeries = null;
let selectedWatchId = null;
let deviationChart = null;
let chartMeasurements = [];
let chartWatchRange = null;
let chartWatchMeasurements = [];
let chartMetric = 'deviation';
let chartSeriesList = null;
let printMode = false;
const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');

function localDateTime() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 1);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function updateReferenceClock() {
  const now = new Date();
  const formattedTime = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(now);
  document.querySelectorAll('.reference-clock .clock-time').forEach(time => {
    time.dateTime = now.toISOString();
    time.textContent = formattedTime;
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

async function refreshWatches() {
  watches = await api('/api/watches');
  renderWatchList();
  $('#new-series').disabled = watches.length === 0;
}

function renderWatchList() {
  $('#watch-list').innerHTML = watches.map(w => {
    const isSelected = w.id === selectedWatchId;
    return `<li class="watch-item${isSelected ? ' selected' : ''}" data-watch-id="${w.id}"><button type="button" class="watch-select" aria-pressed="${isSelected}"><span class="watch-name">${escapeHtml(w.name)}</span></button><span class="watch-series">${w.series_count} series</span></li>`;
  }).join('') || '<li class="muted">No watches added</li>';
}

async function refreshSeries() {
  const allSeries = await api('/api/series');
  if (selectedWatchId === null) selectedWatchId = allSeries[0]?.watch_id ?? watches[0]?.id ?? null;
  const series = allSeries.filter(s => s.watch_id === selectedWatchId);
  const selectedWatch = watches.find(w => w.id === selectedWatchId);
  $('#empty-state h3').textContent = selectedWatch ? `No measurement series for ${selectedWatch.name} yet` : 'No watches added';
  $('#empty-state p').textContent = selectedWatch ? 'Start a measurement series when you set the watch.' : 'Add a watch to get started.';
  $('#empty-state').hidden = series.length > 0;
  const picker = $('#series-picker');
  picker.hidden = series.length === 0;
  picker.innerHTML = series.length
    ? `<option value="all">All series</option>${series.map(s => `<option value="${s.id}">${dateRangeLabel(s.started_at, s.ended_at)}</option>`).join('')}`
    : '';
  if (!series.length) selectedSeries = null;
  else if (selectedSeries !== 'all' && !series.some(s => s.id === selectedSeries)) selectedSeries = series[0]?.id ?? null;
  $('#series-area').hidden = !selectedSeries;
  $('#new-series').disabled = !selectedWatchId;
  renderWatchList();
  if (selectedSeries) picker.value = String(selectedSeries);
  if (selectedSeries === 'all') await showAllSeries();
  else if (selectedSeries) await showSeries(selectedSeries);
}

async function selectWatch(watchId) {
  selectedWatchId = watchId;
  selectedSeries = null;
  renderWatchList();
  await refreshSeries();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function dateLabel(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function renderDeviationChart(measurements, watchRange = chartWatchRange, seriesList = null) {
  chartMeasurements = measurements;
  chartWatchRange = watchRange;
  chartSeriesList = seriesList;
  const section = $('#chart-section');
  if (!window.Chart || measurements.length < 2) {
    section.hidden = true;
    if (deviationChart) deviationChart.destroy();
    deviationChart = null;
    return;
  }

  if (deviationChart) deviationChart.destroy();
  section.hidden = false;
  const dark = colorScheme.matches && !printMode;
  const textColor = printMode ? '#555' : getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  const gridColor = dark ? 'rgba(174,181,191,.14)' : 'rgba(82,94,108,.12)';
  const average = chartMetric === 'average';
  const unit = average ? 's/d' : 's';
  $('#chart-title').textContent = average ? 'Average over time' : 'Deviation over time';
  $('#deviation-chart').setAttribute('aria-label', average ? 'Average watch deviation since series start in seconds per day over time' : 'Watch deviation in seconds over time');
  const toPoints = rows => rows.map(m => {
    const elapsedDays = (new Date(m.measured_at) - new Date(rows[0].measured_at)) / 86400000;
    return { x: new Date(m.measured_at).getTime(), y: average
      ? (elapsedDays > 0 ? (m.offset_seconds - rows[0].offset_seconds) / elapsedDays : null)
      : Number(m.offset_seconds) };
  }).filter(point => point.y !== null && Number.isFinite(point.y));
  const watchGroups = new Map();
  chartWatchMeasurements.forEach(m => {
    if (!watchGroups.has(m.series_id)) watchGroups.set(m.series_id, []);
    watchGroups.get(m.series_id).push(m);
  });
  const values = average
    ? [...watchGroups.values()].flatMap(rows => toPoints(rows).map(point => point.y))
    : measurements.map(m => Number(m.offset_seconds));
  const minValue = average ? Math.min(0, ...values) : Number(watchRange?.min_offset ?? Math.min(...values));
  const maxValue = average ? Math.max(0, ...values) : Number(watchRange?.max_offset ?? Math.max(...values));
  const rangePadding = Math.max((maxValue - minValue) * 0.06, average ? 0.1 : 1);
  const yMin = minValue - rangePadding;
  const yMax = maxValue + rangePadding;
  const groups = seriesList
    ? seriesList.map(series => ({ label: dateRangeLabel(series.started_at, series.ended_at), rows: measurements.filter(m => m.series_id === series.id) }))
    : [{ rows: measurements }];
  const datasets = groups.map(group => ({
    label: group.label,
    data: toPoints(group.rows),
    borderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    pointBorderWidth: 0,
    tension: 0,
  }));
  const shortDate = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
    .format(new Date(Number(value))).replace(/\.$/, '');

  Chart.defaults.font.family = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  deviationChart = new Chart($('#deviation-chart'), {
    type: 'line',
    data: {
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        colors: { forceOverride: true },
        legend: {
          display: Boolean(seriesList && seriesList.length > 1),
          labels: { color: textColor, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16 },
        },
        tooltip: {
          callbacks: {
            title: items => items.length ? dateLabel(new Date(items[0].parsed.x)) : '',
            label: item => `${average ? fixedSeconds(item.parsed.y) : wholeSeconds(item.parsed.y)} ${unit}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },
          border: { display: false },
          ticks: { color: textColor, maxTicksLimit: 6, maxRotation: 0, callback: shortDate },
        },
        y: {
          min: yMin,
          max: yMax,
          grid: { color: context => Number(context.tick.value) === 0 ? (dark ? 'rgba(174,181,191,.3)' : 'rgba(82,94,108,.25)') : gridColor },
          border: { display: false },
          ticks: {
            color: textColor,
            callback: value => `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value)} ${unit}`,
          },
        },
      },
    },
  });
  if (printMode) {
    const bounds = $('#deviation-chart').parentElement.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) deviationChart.resize(bounds.width, bounds.height);
  }
}

colorScheme.addEventListener('change', () => {
  if (chartMeasurements.length > 1) renderDeviationChart(chartMeasurements, chartWatchRange, chartSeriesList);
});

window.addEventListener('beforeprint', () => {
  printMode = true;
  if (chartMeasurements.length > 1) renderDeviationChart(chartMeasurements, chartWatchRange, chartSeriesList);
});
window.addEventListener('afterprint', () => {
  printMode = false;
  if (chartMeasurements.length > 1) renderDeviationChart(chartMeasurements, chartWatchRange, chartSeriesList);
});

function dateRangeLabel(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue || startValue);
  const shortDate = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date).replace(/\.$/, '');
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  return startYear === endYear
    ? `${shortDate(start)}–${shortDate(end)} ${endYear}`
    : `${shortDate(start)} ${startYear}–${shortDate(end)} ${endYear}`;
}

function fixedSeconds(value) {
  return new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function wholeSeconds(value) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value);
}

async function showSeries(id) {
  selectedSeries = id;
  const data = await api(`/api/series/${id}/measurements`);
  $('#series-area').hidden = false;
  $('#open-measurement-dialog').hidden = false;
  selectedWatchId = data.series.watch_id;
  renderWatchList();
  updatePrintMeta(dateRangeLabel(data.series.started_at, data.measurements.at(-1)?.measured_at || data.series.started_at));
  const watchData = await api(`/api/watches/${data.series.watch_id}/measurements`);
  chartWatchMeasurements = watchData.measurements;
  renderDeviationChart(data.measurements, data.watch_range);
  renderMeasurementRows(data.measurements, false);
}

async function showAllSeries() {
  const data = await api(`/api/watches/${selectedWatchId}/measurements`);
  selectedSeries = 'all';
  $('#series-area').hidden = false;
  $('#open-measurement-dialog').hidden = true;
  updatePrintMeta('All series');
  chartWatchMeasurements = data.measurements;
  renderDeviationChart(data.measurements, data.watch_range, data.series);
  renderMeasurementRows(data.measurements, true);
}

function updatePrintMeta(seriesLabel) {
  const watch = watches.find(item => item.id === selectedWatchId);
  const watchName = $('#print-watch-name');
  const seriesName = $('#print-series-label');
  if (watchName) watchName.textContent = watch?.name || '';
  if (seriesName) seriesName.textContent = seriesLabel;
}

function renderMeasurementRows(measurements, includeSeries) {
  $('.table-wrap').classList.toggle('all-series', includeSeries);
  const groups = new Map();
  measurements.forEach(measurement => {
    if (!groups.has(measurement.series_id ?? selectedSeries)) groups.set(measurement.series_id ?? selectedSeries, []);
    groups.get(measurement.series_id ?? selectedSeries).push(measurement);
  });
  const seriesLabels = new Map();
  if (includeSeries) {
    $('#measurement-headers').innerHTML = '<th>SERIES</th><th>MEASURED AT</th><th>DEVIATION SINCE START</th><th>AVERAGE SINCE START</th><th>AVERAGE LAST PERIOD</th><th></th>';
    for (const [seriesId, rows] of groups) {
      seriesLabels.set(seriesId, dateRangeLabel(rows[0].series_started_at, rows[rows.length - 1].measured_at));
    }
  } else {
    $('#measurement-headers').innerHTML = '<th>MEASURED AT</th><th>DEVIATION SINCE START</th><th>AVERAGE SINCE START</th><th>AVERAGE LAST PERIOD</th><th></th>';
  }
  $('#measurement-rows').innerHTML = measurements.map(m => {
    const seriesId = m.series_id ?? selectedSeries;
    const rows = groups.get(seriesId);
    const index = rows.indexOf(m);
    const first = rows[0];
    const previous = rows[index - 1];
    const elapsedDays = (new Date(m.measured_at) - new Date(first.measured_at)) / 86400000;
    const averageRate = elapsedDays > 0 ? (m.offset_seconds - first.offset_seconds) / elapsedDays : null;
    const periodDays = previous ? (new Date(m.measured_at) - new Date(previous.measured_at)) / 86400000 : null;
    const periodRate = periodDays > 0 ? (m.offset_seconds - previous.offset_seconds) / periodDays : null;
    const tone = m.offset_seconds < 0 ? 'slow' : m.offset_seconds > 0 ? 'fast' : '';
    const periodTone = periodRate === null ? '' : periodRate < 0 ? 'slow' : periodRate > 0 ? 'fast' : '';
    const seriesCell = includeSeries ? `<td>${escapeHtml(seriesLabels.get(seriesId))}</td>` : '';
    return `<tr>${seriesCell}<td>${dateLabel(m.measured_at)}</td><td class="offset ${tone}">${wholeSeconds(m.offset_seconds)} s</td><td class="daily-rate">${averageRate === null ? '—' : `${fixedSeconds(averageRate)} s/d`}</td><td class="daily-rate ${periodTone}">${periodRate === null ? '—' : `${fixedSeconds(periodRate)} s/d`}</td><td class="delete-cell"><button type="button" class="delete-measurement" data-series-id="${seriesId}" data-measurement-id="${m.id}" data-is-start="${index === 0}" data-is-only="${rows.length === 1}" aria-label="Delete measurement ${dateLabel(m.measured_at)}" title="Delete measurement">×</button></td></tr>`;
  }).join('');
}

$('#watch-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { const watch = await api('/api/watches', { method: 'POST', body: JSON.stringify({ name: $('#watch-name').value }) }); selectedWatchId = watch.id; selectedSeries = null; $('#watch-name').value = ''; $('#watch-form').closest('details').open = false; await refreshWatches(); await refreshSeries(); toast('Watch added.'); }
  catch (err) { toast(err.message); }
});

$('#watch-list').addEventListener('click', e => {
  const item = e.target.closest('.watch-item');
  if (item?.dataset.watchId) selectWatch(Number(item.dataset.watchId));
});

$('#new-series').addEventListener('click', () => {
  if (!selectedWatchId) return;
  $('#started-at').value = localDateTime();
  $('#series-dialog').showModal();
});
$('#series-picker').addEventListener('change', e => e.target.value === 'all' ? showAllSeries() : showSeries(Number(e.target.value)));
$('#measurement-rows').addEventListener('click', async e => {
  const button = e.target.closest('.delete-measurement');
  if (!button) return;
  const isStart = button.dataset.isStart === 'true';
  const isOnly = button.dataset.isOnly === 'true';
  const viewingAllSeries = selectedSeries === 'all';
  const message = isOnly
    ? 'This is the only measurement in this series. Delete the measurement and the empty series?'
    : isStart
      ? 'This is the starting measurement. Delete it and restart the series from the next measurement? Deviations will be recalculated.'
      : 'Delete this measurement?';
  if (!window.confirm(message)) return;
  try {
    const result = await api(`/api/series/${button.dataset.seriesId}/measurements/${button.dataset.measurementId}`, { method: 'DELETE' });
    if (result.series_deleted && !viewingAllSeries) selectedSeries = null;
    await refreshWatches();
    await refreshSeries();
    toast(result.series_deleted ? 'Measurement and empty series deleted.' : 'Measurement deleted.');
  } catch (err) { toast(err.message); }
});
const closeSeriesDialog = () => $('#series-dialog').close();
$('#cancel-series').addEventListener('click', closeSeriesDialog);
$('#cancel-new-series').addEventListener('click', closeSeriesDialog);
$('#series-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const watchId = selectedWatchId;
    const result = await api('/api/series', { method: 'POST', body: JSON.stringify({ watch_id: watchId, started_at: new Date($('#started-at').value).toISOString() }) });
    $('#series-dialog').close(); selectedWatchId = watchId; selectedSeries = result.id; await refreshWatches(); await refreshSeries(); toast('Measurement series started.');
  } catch (err) { toast(err.message); }
});

$('#open-measurement-dialog').addEventListener('click', () => {
  $('#measured-at').value = localDateTime();
  $('#measurement-dialog').showModal();
  $('#offset').focus({ preventScroll: true });
});
$('#close-measurement-dialog').addEventListener('click', () => $('#measurement-dialog').close());
$('#measurement-dialog').addEventListener('close', () => { $('#offset').value = ''; });

$('#measurement-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!selectedSeries || selectedSeries === 'all') return;
  try {
    await api(`/api/series/${selectedSeries}/measurements`, { method: 'POST', body: JSON.stringify({ measured_at: new Date($('#measured-at').value).toISOString(), offset_seconds: $('#offset').value }) });
    $('#measurement-dialog').close(); $('#offset').value = ''; $('#measured-at').value = localDateTime(); await showSeries(selectedSeries); await refreshWatches(); toast('Measurement saved.');
  } catch (err) { toast(err.message); }
});

$('#measured-at').value = localDateTime();
updateReferenceClock();
setInterval(updateReferenceClock, 250);
refreshWatches().then(refreshSeries).catch(err => toast(err.message));

$('#chart-metric').addEventListener('change', e => {
  chartMetric = e.target.value;
  renderDeviationChart(chartMeasurements, chartWatchRange, chartSeriesList);
});
