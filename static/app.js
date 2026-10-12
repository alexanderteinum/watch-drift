const $ = (selector) => document.querySelector(selector);
let watches = [];
let selectedSeries = null;
let selectedWatchId = null;

function localDateTime() {
  const now = new Date();
  now.setSeconds(0, 0);
  now.setMinutes(now.getMinutes() + 1);
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function updateReferenceClock() {
  const now = new Date();
  const time = $('#reference-time');
  time.dateTime = now.toISOString();
  time.textContent = new Intl.DateTimeFormat('nb-NO', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(now);
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Noe gikk galt.');
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
    return `<li class="watch-item${isSelected ? ' selected' : ''}" data-watch-id="${w.id}"><button type="button" class="watch-select" aria-pressed="${isSelected}"><span class="watch-name">${escapeHtml(w.name)}</span></button><span class="watch-series">${w.series_count} serier</span></li>`;
  }).join('') || '<li class="muted">Ingen klokker lagt til</li>';
}

async function refreshSeries() {
  const allSeries = await api('/api/series');
  if (selectedWatchId === null) selectedWatchId = allSeries[0]?.watch_id ?? watches[0]?.id ?? null;
  const series = allSeries.filter(s => s.watch_id === selectedWatchId);
  const selectedWatch = watches.find(w => w.id === selectedWatchId);
  $('#empty-state h3').textContent = selectedWatch ? `Ingen måleserier for ${selectedWatch.name} ennå` : 'Ingen klokker lagt til';
  $('#empty-state p').textContent = selectedWatch ? 'Start en måleserie når du stiller klokka.' : 'Legg til en klokke for å komme i gang.';
  $('#empty-state').hidden = series.length > 0;
  const picker = $('#series-picker');
  picker.hidden = series.length < 2;
  picker.innerHTML = series.map(s => `<option value="${s.id}">${dateRangeLabel(s.started_at, s.ended_at)}</option>`).join('');
  if (!series.some(s => s.id === selectedSeries)) selectedSeries = series[0]?.id ?? null;
  $('#series-area').hidden = !selectedSeries;
  $('#new-series').disabled = !selectedWatchId;
  renderWatchList();
  if (selectedSeries) picker.value = String(selectedSeries);
  if (selectedSeries) await showSeries(selectedSeries);
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
  return new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function dateRangeLabel(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue || startValue);
  const shortDate = date => new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(date).replace(/\.$/, '');
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  return startYear === endYear
    ? `${shortDate(start)}–${shortDate(end)} ${endYear}`
    : `${shortDate(start)} ${startYear}–${shortDate(end)} ${endYear}`;
}

function fixedSeconds(value) {
  return new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function wholeSeconds(value) {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(value);
}

async function showSeries(id) {
  selectedSeries = id;
  const data = await api(`/api/series/${id}/measurements`);
  $('#series-area').hidden = false;
  selectedWatchId = data.series.watch_id;
  renderWatchList();
  $('#series-name').textContent = dateRangeLabel(data.series.started_at, data.measurements.at(-1)?.measured_at || data.series.started_at);
  const watch = watches.find(w => w.id === data.series.watch_id);
  $('#series-meta').textContent = watch?.name || '';
  $('#measurement-rows').innerHTML = data.measurements.map((m, index) => {
    const first = data.measurements[0];
    const previous = data.measurements[index - 1];
    const elapsedDays = (new Date(m.measured_at) - new Date(first.measured_at)) / 86400000;
    const averageRate = elapsedDays > 0 ? (m.offset_seconds - first.offset_seconds) / elapsedDays : null;
    const periodDays = previous ? (new Date(m.measured_at) - new Date(previous.measured_at)) / 86400000 : null;
    const periodRate = periodDays > 0 ? (m.offset_seconds - previous.offset_seconds) / periodDays : null;
    const tone = m.offset_seconds < 0 ? 'slow' : m.offset_seconds > 0 ? 'fast' : '';
    const periodTone = periodRate === null ? '' : periodRate < 0 ? 'slow' : periodRate > 0 ? 'fast' : '';
    return `<tr><td>${dateLabel(m.measured_at)}</td><td class="offset ${tone}">${wholeSeconds(m.offset_seconds)} s</td><td class="daily-rate">${averageRate === null ? '—' : `${fixedSeconds(averageRate)} s/d`}</td><td class="daily-rate ${periodTone}">${periodRate === null ? '—' : `${fixedSeconds(periodRate)} s/d`}</td><td class="delete-cell"><button type="button" class="delete-measurement" data-measurement-id="${m.id}" data-is-start="${index === 0}" data-is-only="${data.measurements.length === 1}" aria-label="Slett måling ${dateLabel(m.measured_at)}" title="Slett måling">×</button></td></tr>`;
  }).join('');
  const ms = data.measurements;
}

$('#watch-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { const watch = await api('/api/watches', { method: 'POST', body: JSON.stringify({ name: $('#watch-name').value }) }); selectedWatchId = watch.id; selectedSeries = null; $('#watch-name').value = ''; $('#watch-form').closest('details').open = false; await refreshWatches(); await refreshSeries(); toast('Klokka ble lagt til.'); }
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
$('#series-picker').addEventListener('change', e => showSeries(Number(e.target.value)));
$('#measurement-rows').addEventListener('click', async e => {
  const button = e.target.closest('.delete-measurement');
  if (!button) return;
  const isStart = button.dataset.isStart === 'true';
  const isOnly = button.dataset.isOnly === 'true';
  const message = isOnly
    ? 'Dette er seriens eneste måling. Slett målingen og den tomme serien?'
    : isStart
      ? 'Dette er seriens startmåling. Slette den og starte serien på nytt fra neste måling? Avvikene regnes om.'
      : 'Slette denne målingen?';
  if (!window.confirm(message)) return;
  try {
    const result = await api(`/api/series/${selectedSeries}/measurements/${button.dataset.measurementId}`, { method: 'DELETE' });
    if (result.series_deleted) selectedSeries = null;
    await refreshWatches();
    await refreshSeries();
    toast(result.series_deleted ? 'Målingen og den tomme serien ble slettet.' : 'Målingen ble slettet.');
  } catch (err) { toast(err.message); }
});
$('#cancel-series').addEventListener('click', () => $('#series-dialog').close());
$('#series-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const watchId = selectedWatchId;
    const result = await api('/api/series', { method: 'POST', body: JSON.stringify({ watch_id: watchId, started_at: new Date($('#started-at').value).toISOString() }) });
    $('#series-dialog').close(); selectedWatchId = watchId; selectedSeries = result.id; await refreshWatches(); await refreshSeries(); toast('Måleserien er startet.');
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
  if (!selectedSeries) return;
  try {
    await api(`/api/series/${selectedSeries}/measurements`, { method: 'POST', body: JSON.stringify({ measured_at: new Date($('#measured-at').value).toISOString(), offset_seconds: $('#offset').value }) });
    $('#measurement-dialog').close(); $('#offset').value = ''; $('#measured-at').value = localDateTime(); await showSeries(selectedSeries); await refreshWatches(); toast('Målingen ble lagret.');
  } catch (err) { toast(err.message); }
});

$('#measured-at').value = localDateTime();
updateReferenceClock();
setInterval(updateReferenceClock, 250);
refreshWatches().then(refreshSeries).catch(err => toast(err.message));
