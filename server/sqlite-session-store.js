/* sqlite-session-store.js
 * A minimal, dependency-free express-session store backed by the app's existing
 * better-sqlite3 database. Because the DB lives on the persistent Railway volume,
 * sessions now survive restarts and redeploys (previously they were held in the
 * default in-memory store and wiped on every deploy, logging everyone out).
 */

const session = require('express-session');

module.exports = function createSqliteSessionStore(db) {
  const Store = session.Store;

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    TEXT PRIMARY KEY,
      sess   TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
  `);

  const selectStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
  const upsertStmt = db.prepare(
    `INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
     ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`
  );
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
  const touchStmt = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
  const clearExpiredStmt = db.prepare('DELETE FROM sessions WHERE expire < ?');

  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
  function expireAt(sess) {
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_TTL_MS);
  }

  class SqliteStore extends Store {
    get(sid, cb) {
      try {
        const row = selectStmt.get(sid);
        if (!row) return cb(null, null);
        if (row.expire < Date.now()) {
          deleteStmt.run(sid);
          return cb(null, null);
        }
        return cb(null, JSON.parse(row.sess));
      } catch (err) {
        return cb(err);
      }
    }

    set(sid, sess, cb) {
      try {
        upsertStmt.run(sid, JSON.stringify(sess), expireAt(sess));
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    destroy(sid, cb) {
      try {
        deleteStmt.run(sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }

    touch(sid, sess, cb) {
      try {
        touchStmt.run(expireAt(sess), sid);
        return cb && cb(null);
      } catch (err) {
        return cb && cb(err);
      }
    }
  }

  // Sweep expired sessions hourly; don't keep the process alive just for this.
  const sweep = setInterval(() => {
    try { clearExpiredStmt.run(Date.now()); } catch (e) { /* ignore */ }
  }, 60 * 60 * 1000);
  if (typeof sweep.unref === 'function') sweep.unref();

  return new SqliteStore();
};
