let token = sessionStorage.getItem('token'), role = sessionStorage.getItem('role');
let map, markers = {}, vehicles = [], routeLine, chart, watchId = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

async function api(path, method = 'GET', body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  if (res.status === 401) return signOut();
  return res.json();
}
function signOut() { sessionStorage.clear(); location.reload(); }
$('out').onclick = signOut;

$('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
  const data = await res.json();
  if (!res.ok) { $('err').textContent = data.error; return; }
  token = data.token; role = data.role;
  sessionStorage.setItem('token', token); sessionStorage.setItem('role', role);
  start();
};

function toast(msg) { const d = document.createElement('div'); d.textContent = msg; $('toasts').append(d); setTimeout(() => d.remove(), 5000); }

function place(v) {
  const t = `${v.plate} · ${Math.round(v.speed)} km/h`;
  if (markers[v.id]) markers[v.id].setLatLng([v.lat, v.lng]).setTooltipContent(t);
  else markers[v.id] = L.marker([v.lat, v.lng]).addTo(map).bindTooltip(t);
}

async function start() {
  $('login').hidden = true; $('app').hidden = false; $('who').textContent = role;
  map = map || L.map('map').setView([47.6779, 9.1732], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(map);
  vehicles = await api('/api/vehicles');
  vehicles.forEach(place);
  tools(); loadOrders();
  if (role !== 'driver') { loadKpi(); setInterval(loadKpi, 10000); }
  if (role === 'admin') loadAudit();
  const es = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
  es.onopen = () => ($('offline').hidden = true);
  es.onerror = () => ($('offline').hidden = false);
  es.addEventListener('position', (e) => { const p = JSON.parse(e.data); const v = vehicles.find((x) => x.id === p.id); if (v) Object.assign(v, p); place(p); });
  es.addEventListener('alert', (e) => toast(JSON.parse(e.data).message));
}

function tools() {
  if (role === 'driver') {
    $('tools').innerHTML = '<button id="share">Share my location</button>';
    $('share').onclick = () => {
      if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; $('share').textContent = 'Share my location'; return; }
      watchId = navigator.geolocation.watchPosition((p) => api('/api/telemetry', 'POST', { lat: p.coords.latitude, lng: p.coords.longitude, speed: (p.coords.speed || 0) * 3.6 }));
      $('share').textContent = 'Stop sharing';
    };
    return;
  }
  $('tools').innerHTML = `<select id="veh" aria-label="Vehicle">${vehicles.map((v) => `<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select> <button id="opt">Optimise route</button> <span id="optOut"></span>`;
  $('opt').onclick = async () => {
    const id = +$('veh').value, r = await api('/api/routes/optimize', 'POST', { vehicleId: id });
    const v = vehicles.find((x) => x.id === id);
    if (routeLine) routeLine.remove();
    if (!r.route.length) { $('optOut').textContent = 'No pending deliveries for this vehicle.'; return; }
    routeLine = L.polyline([[v.lat, v.lng], ...r.route.map((s) => [s.lat, s.lng])], { color: '#f2b134', weight: 5 }).addTo(map);
    map.fitBounds(routeLine.getBounds());
    $('optOut').textContent = `${r.km} km, ${(r.naiveKm - r.km).toFixed(2)} km shorter than the entered order`;
  };
}

async function loadOrders() {
  const os = await api('/api/orders');
  const plate = (id) => (vehicles.find((v) => v.id === id) || {}).plate || id;
  $('orders').innerHTML = '<table><tr><th>Address</th><th>Vehicle</th><th>Status</th><th></th></tr>' +
    os.map((o) => `<tr><td>${esc(o.address)}</td><td>${esc(plate(o.vehicle_id))}</td><td>${o.status}</td><td>${o.status === 'pending' ? `<button data-done="${o.id}">Mark delivered</button>` : ''}</td></tr>`).join('') + '</table>';
}
$('orders').onclick = async (e) => { if (e.target.dataset.done) { await api(`/api/orders/${e.target.dataset.done}/complete`, 'POST', {}); loadOrders(); } };

async function loadKpi() {
  const a = await api('/api/analytics');
  $('stats').hidden = false;
  ['km', 'co2Kg', 'savedKg', 'delivered'].forEach((k, i) => ($(`k${i + 1}`).textContent = a.totals[k]));
  const labels = a.vehicles.map((v) => v.plate);
  const sets = [{ label: 'CO₂ emitted (kg)', data: a.vehicles.map((v) => v.co2Kg), backgroundColor: '#0f4c4a' }, { label: 'CO₂ saved vs diesel (kg)', data: a.vehicles.map((v) => v.savedKg), backgroundColor: '#f2b134' }];
  if (chart) { chart.data.labels = labels; chart.data.datasets.forEach((d, i) => (d.data = sets[i].data)); chart.update(); }
  else chart = new Chart($('chart'), { type: 'bar', data: { labels, datasets: sets } });
}

async function loadAudit() {
  const rows = await api('/api/audit');
  $('users').hidden = false;
  $('audit').innerHTML = '<table><tr><th>When</th><th>Who</th><th>Action</th></tr>' + rows.map((r) => `<tr><td>${new Date(r.ts).toLocaleString()}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td></tr>`).join('') + '</table>';
}

if (token) start();
