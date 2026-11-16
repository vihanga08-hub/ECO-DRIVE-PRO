const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { sign, verify, verifyPassword } = require('./auth');
const { haversine, optimizeRoute } = require('./geo');

const CO2 = { 'e-van': 0.07, 'e-bike': 0.004, diesel: 0.25 }; // kg CO2 per km, rough estimates
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https://unpkg.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self'";

const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const readBody = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve(null); } });
});
const ok = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

function createApp(db) {
  const clients = new Set(), attempts = new Map(), table = [];
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const audit = (user, action) => db.prepare('INSERT INTO audit(user,action,ts) VALUES(?,?,?)').run(user, action, Date.now());
  const add = (method, re, roles, fn) => table.push({ method, re, roles, fn }); // roles: null=public, []=any signed-in, [..]=listed roles
  const push = (event, data, vehicleId) => {
    for (const c of clients) {
      if (c.user.role === 'driver' && c.user.vehicleId !== vehicleId) continue; // drivers only get their own vehicle
      c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  function ingest(id, lat, lng, speed) {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(id);
    if (!v) return null;
    db.prepare('UPDATE vehicles SET lat=?,lng=?,speed=?,km=km+? WHERE id=?').run(lat, lng, speed, haversine(v, { lat, lng }), id);
    db.prepare('INSERT INTO positions(vehicle_id,lat,lng,speed,ts) VALUES(?,?,?,?,?)').run(id, lat, lng, speed, Date.now());
    push('position', { id, plate: v.plate, lat, lng, speed }, id);
    if (speed > 50) push('alert', { id, message: `Speeding: ${v.plate} at ${Math.round(speed)} km/h` }, id);
    return { id, lat, lng, speed };
  }

  add('POST', /^\/api\/login$/, null, ({ body, ip }) => {
    const a = attempts.get(ip) || { n: 0, reset: Date.now() + 60000 };
    if (Date.now() > a.reset) { a.n = 0; a.reset = Date.now() + 60000; }
    attempts.set(ip, a);
    if (a.n >= 5) return [429, { error: 'Too many attempts. Try again in a minute.' }];
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(body.username || ''));
    if (!u || !verifyPassword(String(body.password || ''), u.pass)) { a.n++; return [401, { error: 'Wrong username or password.' }]; }
    audit(u.username, 'login');
    return [200, { token: sign({ id: u.id, role: u.role, name: u.name, vehicleId: u.vehicle_id }), role: u.role, name: u.name }];
  });

  add('GET', /^\/api\/vehicles$/, [], ({ user }) =>
    [200, user.role === 'driver' ? q('SELECT * FROM vehicles WHERE id=?', user.vehicleId) : q('SELECT * FROM vehicles')]);

  add('POST', /^\/api\/telemetry$/, [], ({ user, body }) => {
    const id = user.role === 'driver' ? user.vehicleId : body.vehicleId; // a driver can never write to another vehicle
    const { lat, lng, speed = 0 } = body;
    if (!ok(lat, -90, 90) || !ok(lng, -180, 180) || !ok(speed, 0, 250)) return [400, { error: 'lat, lng and speed must be valid numbers.' }];
    const r = ingest(id, lat, lng, speed);
    return r ? [200, r] : [404, { error: 'Unknown vehicle.' }];
  });

  add('GET', /^\/api\/analytics$/, ['admin', 'manager'], () => {
    const vehicles = q('SELECT * FROM vehicles').map((v) => ({
      plate: v.plate, kind: v.kind, km: +v.km.toFixed(2), co2Kg: +(v.km * CO2[v.kind]).toFixed(2),
      savedKg: +(v.km * (CO2.diesel - CO2[v.kind])).toFixed(2),
      delivered: db.prepare("SELECT COUNT(*) c FROM orders WHERE vehicle_id=? AND status='done'").get(v.id).c,
    }));
    const sum = (k) => +vehicles.reduce((s, v) => s + v[k], 0).toFixed(2);
    return [200, { vehicles, totals: { km: sum('km'), co2Kg: sum('co2Kg'), savedKg: sum('savedKg'), delivered: sum('delivered') } }];
  });

  add('GET', /^\/api\/orders$/, [], ({ user }) =>
    [200, user.role === 'driver' ? q('SELECT * FROM orders WHERE vehicle_id=?', user.vehicleId) : q('SELECT * FROM orders')]);

  add('POST', /^\/api\/orders$/, ['admin', 'manager'], ({ user, body }) => {
    const { vehicleId, address, lat, lng } = body;
    if (!address || !ok(lat, -90, 90) || !ok(lng, -180, 180) || !db.prepare('SELECT 1 FROM vehicles WHERE id=?').get(vehicleId))
      return [400, { error: 'Address, coordinates and a valid vehicle are required.' }];
    const r = db.prepare('INSERT INTO orders(vehicle_id,address,lat,lng) VALUES(?,?,?,?)').run(vehicleId, String(address).slice(0, 120), lat, lng);
    audit(user.name, `created order ${r.lastInsertRowid}`);
    return [201, { id: Number(r.lastInsertRowid) }];
  });

  add('POST', /^\/api\/orders\/(\d+)\/complete$/, [], ({ user, m }) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(+m[1]);
    if (!o || (user.role === 'driver' && o.vehicle_id !== user.vehicleId)) return [404, { error: 'Order not found.' }];
    db.prepare("UPDATE orders SET status='done' WHERE id=?").run(o.id);
    audit(user.name, `completed order ${o.id}`);
    return [200, { id: o.id, status: 'done' }];
  });

  add('POST', /^\/api\/routes\/optimize$/, ['admin', 'manager'], ({ body }) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id=?').get(body.vehicleId);
    if (!v) return [404, { error: 'Unknown vehicle.' }];
    const stops = q("SELECT id,address,lat,lng FROM orders WHERE vehicle_id=? AND status='pending'", v.id);
    if (!stops.length) return [200, { route: [], km: 0, naiveKm: 0 }];
    const r = optimizeRoute(v, stops);
    return [200, { route: r.route, km: +r.km.toFixed(2), naiveKm: +r.naiveKm.toFixed(2) }];
  });

  add('GET', /^\/api\/audit$/, ['admin'], () => [200, q('SELECT * FROM audit ORDER BY id DESC LIMIT 20')]);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', CSP);
      if (!url.pathname.startsWith('/api/')) {
        const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
        if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname === '/api/stream') { // Server-Sent Events: EventSource cannot set headers, so the token comes in the query string
        const user = verify(url.searchParams.get('token'));
        if (!user) return send(res, 401, { error: 'Sign in to continue.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        const c = { user, res };
        clients.add(c);
        return req.on('close', () => clients.delete(c));
      }
      const h = table.find((t) => t.method === req.method && t.re.test(url.pathname));
      if (!h) return send(res, 404, { error: 'Not found.' });
      let user = null;
      if (h.roles) {
        user = verify((req.headers.authorization || '').replace('Bearer ', ''));
        if (!user) return send(res, 401, { error: 'Sign in to continue.' });
        if (h.roles.length && !h.roles.includes(user.role)) return send(res, 403, { error: 'Your role cannot open this resource.' });
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (body === null) return send(res, 400, { error: 'Invalid JSON.' });
      const [status, data] = h.fn({ user, body, ip: req.socket.remoteAddress, m: url.pathname.match(h.re) });
      send(res, status, data);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Server error.' });
    }
  });
  server.ingest = ingest;
  return server;
}
module.exports = { createApp };
