const path = require('node:path');
const { openDb } = require('./db');
const { createApp } = require('./app');

const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'ecodrive.db'));
const app = createApp(db);
// Simulated GPS feed. A real deployment replaces this with drivers posting to /api/telemetry.
setInterval(() => {
  for (const v of db.prepare('SELECT * FROM vehicles').all())
    app.ingest(v.id, v.lat + (Math.random() - 0.5) * 0.0012, v.lng + (Math.random() - 0.5) * 0.0012, Math.round(15 + Math.random() * 45));
}, 2000);
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`EcoDrive Pro running on http://localhost:${port}`));
