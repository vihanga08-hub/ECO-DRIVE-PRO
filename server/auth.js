// Password hashing (scrypt) and HS256 JWTs using only Node's crypto module.
const crypto = require('node:crypto');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const b64 = (s) => Buffer.from(s).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
};
const verifyPassword = (pw, stored) => {
  const [salt, key] = stored.split(':');
  const a = Buffer.from(key, 'hex');
  const b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sign = (payload, ttl = 28800) => {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttl }));
  return `${head}.${body}.${mac(`${head}.${body}`)}`;
};
const verify = (token) => {
  try {
    const [h, p, s] = String(token).split('.');
    const good = mac(`${h}.${p}`);
    if (!s || s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    return data.exp > Date.now() / 1000 ? data : null;
  } catch { return null; }
};
module.exports = { hashPassword, verifyPassword, sign, verify };
