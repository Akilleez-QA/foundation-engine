import { openSync, closeSync, lstatSync } from 'node:fs';
import { captureJson, captureJsonLimits } from '../../src/kits/network/captured-json.ts';

const defaultLimits = { maxBytes: 65536, maxNodes: 4096, maxDepth: 16 };
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function envelope(json, limits) {
  return captureJson(json, limits, value => exact(value, ['version', 'lineage', 'schema', 'revision', 'state', 'streams'])
    && value.version === 1 && identity(value.lineage) && identity(value.schema)
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && Array.isArray(value.streams)).value;
}
async function sqlite() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw Error('authority storage requires optional Node >=22.13');
  return import('node:sqlite');
}
function configure(db) {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
  const configuration = Object.freeze({
    sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
    journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
    synchronous: db.prepare('PRAGMA synchronous').get().synchronous,
    busyTimeout: db.prepare('PRAGMA busy_timeout').get().timeout,
    foreignKeys: db.prepare('PRAGMA foreign_keys').get().foreign_keys,
    trustedSchema: db.prepare('PRAGMA trusted_schema').get().trusted_schema,
  });
  if (configuration.journalMode !== 'wal' || configuration.synchronous !== 2 || configuration.busyTimeout !== 0
    || configuration.foreignKeys !== 1 || configuration.trustedSchema !== 0) throw Error('authority storage configuration');
  return configuration;
}
function readRecord(db, limits) {
  if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('authority storage format');
  // SQLite evaluates the length guard before transferring a potentially oversized string to JS.
  const rows = db.prepare(`SELECT id,lineage,schema_id,revision,typeof(envelope) AS kind,
    length(CAST(envelope AS BLOB)) AS bytes,
    CASE WHEN length(CAST(envelope AS BLOB)) <= ? THEN envelope ELSE NULL END AS json
    FROM checkpoint LIMIT 2`).all(limits.maxBytes);
  if (rows.length !== 1 || rows[0].id !== 1 || rows[0].kind !== 'text' || rows[0].bytes > limits.maxBytes
    || typeof rows[0].json !== 'string') throw Error('authority storage checkpoint');
  const row = rows[0], value = envelope(row.json, limits);
  if (value.lineage !== row.lineage || value.schema !== row.schema_id || value.revision !== row.revision)
    throw Error('authority storage metadata mismatch');
  return row.json;
}
/** Explicit operator initialization. Existing paths are never overwritten or seeded on open. */
export async function initializeAuthorityStorage({ path, initialJson, limits: requested = defaultLimits }) {
  const limits = captureJsonLimits(requested), value = envelope(initialJson, limits);
  if (value.revision !== 0 || value.streams.length !== 0) throw Error('authority storage genesis');
  const { DatabaseSync } = await sqlite();
  const fd = openSync(path, 'wx', 0o600); closeSync(fd);
  let db;
  try {
    db = new DatabaseSync(path); configure(db);
    db.exec(`BEGIN IMMEDIATE; CREATE TABLE checkpoint(
      id INTEGER PRIMARY KEY CHECK(id=1), lineage TEXT NOT NULL, schema_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>=0), envelope TEXT NOT NULL) STRICT;
      PRAGMA user_version=1;`);
    db.prepare('INSERT INTO checkpoint VALUES(1,?,?,?,?)').run(value.lineage, value.schema, 0, initialJson);
    db.exec('COMMIT');
  } finally { db?.close(); }
  // Initialization failure deliberately leaves an incomplete file requiring explicit operator recovery.
}
/** Tool-only adapter. Full stream/receipt semantics belong to the authority validator, not this metadata boundary. */
export async function openAuthorityStorage({ path, limits: requested = defaultLimits, hooks = {} }) {
  const limits = captureJsonLimits(requested), { DatabaseSync } = await sqlite();
  if (!lstatSync(path).isFile()) throw Error('authority storage requires an existing regular file');
  // Refuse missing/uninitialized/corrupt data before a read-write constructor could create or modify it.
  const probe = new DatabaseSync(path, { readOnly: true });
  try { readRecord(probe, limits); } finally { probe.close(); }
  const db = new DatabaseSync(path);
  let configuration;
  try { readRecord(db, limits); configuration = configure(db); } catch (error) { db.close(); throw error; }
  let closed = false, busy = false;
  function hook(name) {
    const fn = hooks[name];
    if (fn === undefined) return;
    if (typeof fn !== 'function') throw Error('authority storage hook');
    const result = fn();
    if (result && typeof result.then === 'function') {
      // Unsupported async diagnostics must not become an unhandled rejection after rollback.
      Promise.resolve(result).catch(() => {});
      throw Error('authority storage hooks must be synchronous');
    }
  }
  return Object.freeze({
    configuration,
    async settle() {
      if (closed) throw Error('authority storage closed');
      if (busy) throw Error('authority storage busy');
      // Every SQL call is synchronous and terminal before the CAS promise is returned. No queued/background writes.
    },
    async read() {
      if (closed || busy) throw Error('authority storage unavailable');
      busy = true;
      try { return readRecord(db, limits); } finally { busy = false; }
    },
    async compareAndSwap(request) {
      if (closed || busy) return 'rejected';
      busy = true;
      let began = false, commitInvoked = false;
      try {
        if (!exact(request, ['lineage', 'schema', 'revision', 'json'])) return 'rejected';
        const { lineage, schema, revision, json } = request;
        if (!identity(lineage) || !identity(schema) || !Number.isSafeInteger(revision) || revision < 0
          || revision === Number.MAX_SAFE_INTEGER) return 'rejected';
        const next = envelope(json, limits);
        if (next.lineage !== lineage || next.schema !== schema || next.revision !== revision + 1) return 'rejected';
        db.exec('BEGIN IMMEDIATE'); began = true;
        // Revalidate under the write lock: external corruption after open must not be overwritten.
        readRecord(db, limits);
        const changed = db.prepare('UPDATE checkpoint SET revision=?,envelope=? WHERE id=1 AND lineage=? AND schema_id=? AND revision=?')
          .run(next.revision, json, lineage, schema, revision).changes;
        if (changed !== 1) { db.exec('ROLLBACK'); began = false; return 'rejected'; }
        hook('beforeCommit');
        commitInvoked = true; db.exec('COMMIT'); began = false;
        hook('afterCommit');
        return 'committed';
      } catch {
        if (began) {
          try { db.exec('ROLLBACK'); began = false; }
          catch {
            // A failed cleanup cannot establish outcome/finality on this connection.
            closed = true; try { db.close(); } catch { /* Remains unavailable. */ }
            return 'unknown';
          }
        }
        return commitInvoked ? 'unknown' : 'rejected';
      } finally { busy = false; }
    },
    close() {
      if (busy) throw Error('authority storage busy');
      if (!closed) { closed = true; db.close(); }
    },
  });
}
