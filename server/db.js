const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE, name TEXT, role TEXT, pass TEXT, vehicle_id INTEGER);
    CREATE TABLE IF NOT EXISTS vehicles(id INTEGER PRIMARY KEY, plate TEXT, kind TEXT, lat REAL, lng REAL, speed REAL DEFAULT 0, km REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS positions(id INTEGER PRIMARY KEY, vehicle_id INTEGER, lat REAL, lng REAL, speed REAL, ts INTEGER);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, vehicle_id INTEGER, address TEXT, lat REAL, lng REAL, status TEXT DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user TEXT, action TEXT, ts INTEGER);`);
  if (!db.prepare('SELECT COUNT(*) c FROM users').get().c) seed(db);
  return db;
}

function seed(db) {
  const pass = hashPassword('demo123');
  const u = db.prepare('INSERT INTO users(username,name,role,pass,vehicle_id) VALUES(?,?,?,?,?)');
  u.run('admin', 'Admin', 'admin', pass, null);
  u.run('manager', 'Fleet Manager', 'manager', pass, null);
  u.run('driver1', 'Driver One', 'driver', pass, 1);
  u.run('driver2', 'Driver Two', 'driver', pass, 2);
  const v = db.prepare('INSERT INTO vehicles(plate,kind,lat,lng) VALUES(?,?,?,?)'); // around Konstanz
  v.run('KN-EV 101', 'e-van', 47.6779, 9.1732);
  v.run('KN-EB 102', 'e-bike', 47.6645, 9.1810);
  v.run('KN-DL 203', 'diesel', 47.6870, 9.1590);
  const o = db.prepare('INSERT INTO orders(vehicle_id,address,lat,lng) VALUES(?,?,?,?)');
  o.run(1, 'Marktstaette 1', 47.6612, 9.1750);
  o.run(1, 'Universitaetsstrasse 10', 47.6896, 9.1877);
  o.run(1, 'Hafenstrasse 5', 47.6590, 9.1760);
  o.run(1, 'Reichenaustrasse 20', 47.6760, 9.1920);
}
module.exports = { openDb };
