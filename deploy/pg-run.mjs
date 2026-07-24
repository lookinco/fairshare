#!/usr/bin/env node
// Minimal Postgres client: TLS + SCRAM-SHA-256, no deps. One-off migration runner.
// Usage: pg-run.mjs <host> <port> <user> <db> <password> <sqlFile>
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import fs from 'node:fs';

const [host, port, user, database, password, sqlFile] = process.argv.slice(2);
const sql = fs.readFileSync(sqlFile, 'utf8');

// ---- wire helpers ----
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
function msg(type, body) {           // typed frontend message
  const len = i32(body.length + 4);
  return type ? Buffer.concat([Buffer.from(type), len, body]) : Buffer.concat([len, body]);
}

function connect() {
  return new Promise((resolve, reject) => {
    const raw = net.connect({ host, port: +port }, () => {
      // SSLRequest
      raw.write(Buffer.concat([i32(8), i32(80877103)]));
    });
    raw.once('error', reject);
    raw.once('data', (d) => {
      if (d[0] !== 0x53) return reject(new Error('server refused SSL: ' + d));
      const sock = tls.connect({ socket: raw, servername: host, rejectUnauthorized: false }, () => resolve(sock));
      sock.once('error', reject);
    });
  });
}

// ---- SCRAM-SHA-256 ----
function scramClientFirst(nonce) { return `n,,n=,r=${nonce}`; }
function parseKV(s) { const o = {}; for (const p of s.split(',')) { const i = p.indexOf('='); o[p.slice(0, i)] = p.slice(i + 1); } return o; }

async function run() {
  const sock = await connect();

  // buffered message reader
  let buf = Buffer.alloc(0);
  const waiters = [];
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 5) break;
      const len = buf.readInt32BE(1);
      if (buf.length < len + 1) break;
      const type = String.fromCharCode(buf[0]);
      const body = buf.slice(5, len + 1);
      buf = buf.slice(len + 1);
      const w = waiters.shift();
      if (w) w({ type, body });
      else pending.push({ type, body });
    }
  });
  const pending = [];
  const next = () => new Promise((res) => { if (pending.length) res(pending.shift()); else waiters.push(res); });
  async function until(types) { for (;;) { const m = await next(); if (m.type === 'E') throw new Error('PG error: ' + parseErr(m.body)); if (types.includes(m.type)) return m; } }

  function parseErr(b) { const parts = []; let i = 0; while (i < b.length && b[i] !== 0) { const f = String.fromCharCode(b[i]); let j = i + 1; while (b[j] !== 0) j++; parts.push(f + b.slice(i + 1, j).toString()); i = j + 1; } return parts.join(' '); }

  // Startup
  const startup = Buffer.concat([i32(196608), cstr('user'), cstr(user), cstr('database'), cstr(database), Buffer.from([0])]);
  sock.write(msg(null, startup));

  // Expect AuthenticationSASL ('R', subtype 10)
  let m = await until(['R']);
  if (m.body.readInt32BE(0) !== 10) throw new Error('expected SASL auth, got ' + m.body.readInt32BE(0));

  const cnonce = crypto.randomBytes(18).toString('base64');
  const clientFirst = scramClientFirst(cnonce);
  const saslInit = Buffer.concat([cstr('SCRAM-SHA-256'), i32(Buffer.byteLength(clientFirst)), Buffer.from(clientFirst)]);
  sock.write(msg('p', saslInit));

  // AuthenticationSASLContinue (subtype 11)
  m = await until(['R']);
  if (m.body.readInt32BE(0) !== 11) throw new Error('expected SASLContinue');
  const serverFirst = m.body.slice(4).toString();
  const sf = parseKV(serverFirst);
  const salt = Buffer.from(sf.s, 'base64');
  const iter = parseInt(sf.i, 10);
  const rnonce = sf.r;

  const saltedPassword = crypto.pbkdf2Sync(password, salt, iter, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const clientFinalNoProof = `c=biws,r=${rnonce}`;
  const authMessage = `${clientFirst.slice(3)},${serverFirst},${clientFinalNoProof}`; // client-first-bare drops "n,,"
  const clientSig = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
  const clientProof = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) clientProof[i] = clientKey[i] ^ clientSig[i];
  const clientFinal = `${clientFinalNoProof},p=${clientProof.toString('base64')}`;
  sock.write(msg('p', Buffer.from(clientFinal)));

  // AuthenticationSASLFinal (subtype 12), then AuthenticationOk (0)
  m = await until(['R']);
  if (m.body.readInt32BE(0) === 12) m = await until(['R']);
  if (m.body.readInt32BE(0) !== 0) throw new Error('auth not OK');

  // Wait for ReadyForQuery
  await until(['Z']);

  // Simple Query with full SQL (one implicit transaction)
  sock.write(msg('Q', cstr(sql)));

  const done = [];
  for (;;) {
    const r = await next();
    if (r.type === 'E') { console.error('PG error: ' + parseErr(r.body)); sock.destroy(); process.exit(1); }
    if (r.type === 'C') done.push(r.body.toString().replace(/\0$/, ''));
    if (r.type === 'Z') break;
  }
  console.log('OK — statements completed:');
  for (const c of done) console.log('  ' + c);
  sock.end();
}

run().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
