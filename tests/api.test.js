const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { haversine, optimizeRoute } = require('../server/geo');

let server, base;
before(async () => {
  server = createApp(openDb());
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.closeAllConnections(); server.close(); });

const call = async (method, path, token, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const login = async (username) => (await call('POST', '/api/login', '', { username, password: 'demo123' })).body.token;

test('haversine: one degree of latitude is about 111 km', () => {
  assert.ok(Math.abs(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111.19) < 0.5);
});

test('optimiser visits every stop and is not longer than the entered order', () => {
  const start = { lat: 47.67, lng: 9.17 };
  const stops = [[47.69, 9.19], [47.66, 9.17], [47.68, 9.15], [47.65, 9.2]].map(([lat, lng]) => ({ lat, lng }));
  const r = optimizeRoute(start, stops);
  assert.equal(r.route.length, stops.length);
  assert.ok(r.km <= r.naiveKm + 1e-9);
});

test('auth: wrong password 401, valid login returns token, no token 401', async () => {
  assert.equal((await call('POST', '/api/login', '', { username: 'admin', password: 'x' })).status, 401);
  assert.ok(await login('admin'));
  assert.equal((await call('GET', '/api/vehicles', '')).status, 401);
});

test('RBAC: analytics, audit and order creation are role-restricted', async () => {
  const [d, m, a] = [await login('driver1'), await login('manager'), await login('admin')];
  assert.equal((await call('GET', '/api/analytics', d)).status, 403);
  assert.equal((await call('GET', '/api/analytics', m)).status, 200);
  assert.equal((await call('GET', '/api/audit', m)).status, 403);
  assert.equal((await call('GET', '/api/audit', a)).status, 200);
  assert.equal((await call('POST', '/api/orders', d, { vehicleId: 1, address: 'x', lat: 47, lng: 9 })).status, 403);
});

test('driver sees only own vehicle and cannot write telemetry to another one', async () => {
  const d = await login('driver1'), m = await login('manager');
  assert.equal((await call('GET', '/api/vehicles', d)).body.length, 1);
  await call('POST', '/api/telemetry', d, { vehicleId: 2, lat: 47.7, lng: 9.2, speed: 10 });
  const vs = (await call('GET', '/api/vehicles', m)).body;
  assert.equal(vs.find((v) => v.id === 1).lat, 47.7);
  assert.notEqual(vs.find((v) => v.id === 2).lat, 47.7);
});

test('telemetry validation rejects bad coordinates', async () => {
  assert.equal((await call('POST', '/api/telemetry', await login('driver1'), { lat: 999, lng: 9 })).status, 400);
});

test('orders: create, optimise route, complete, analytics count', async () => {
  const m = await login('manager'), d = await login('driver1');
  const created = await call('POST', '/api/orders', m, { vehicleId: 1, address: 'Test Street 1', lat: 47.67, lng: 9.18 });
  assert.equal(created.status, 201);
  const r = await call('POST', '/api/routes/optimize', m, { vehicleId: 1 });
  assert.ok(r.body.route.length >= 5 && r.body.km <= r.body.naiveKm);
  assert.equal((await call('POST', `/api/orders/${created.body.id}/complete`, d, {})).status, 200);
  assert.equal((await call('GET', '/api/analytics', m)).body.totals.delivered, 1);
});

test('SSE streams position events', async () => {
  const t = await login('manager'), ac = new AbortController();
  const res = await fetch(`${base}/api/stream?token=${t}`, { signal: ac.signal });
  const reader = res.body.getReader();
  await reader.read();
  await call('POST', '/api/telemetry', t, { vehicleId: 3, lat: 47.68, lng: 9.16, speed: 20 });
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: position/);
  ac.abort();
});

test('login is rate limited after 5 failures', async () => {
  const s = createApp(openDb());
  await new Promise((r) => s.listen(0, r));
  const url = `http://localhost:${s.address().port}/api/login`;
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await fetch(url, { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'bad' }) })).status);
  s.close();
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
});
