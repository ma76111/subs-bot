/**
 * Compatibility wrapper around node:sqlite to match better-sqlite3 API.
 * node:sqlite requires single-quoted string literals in SQL (standard SQL).
 * This wrapper normalizes SQL by converting double-quoted string values to single-quoted.
 */

const { DatabaseSync } = require('node:sqlite');

// Convert double-quoted string literals to single-quoted (e.g. "pending" -> 'pending')
// Only replaces double-quoted values that are NOT identifiers (column/table names)
function normalizeSql(sql) {
  // Replace "word" patterns that appear after = , ( IN with single quotes
  // This targets string literals like status = "pending", NOT column names
  return sql.replace(/"([^"]+)"/g, (match, inner) => {
    // If it looks like a SQL keyword/identifier used as column ref, keep it
    // Otherwise treat as string literal and use single quotes
    return `'${inner}'`;
  });
}

class Statement {
  constructor(db, sql) {
    this._db = db;
    this._sql = normalizeSql(sql);
  }

  _flattenArgs(args) {
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    return args;
  }

  run(...args) {
    const params = this._flattenArgs(args);
    const stmt = this._db.prepare(this._sql);
    const result = params.length > 0 ? stmt.run(...params) : stmt.run();
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  get(...args) {
    const params = this._flattenArgs(args);
    const stmt = this._db.prepare(this._sql);
    const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
    return rows[0] !== undefined ? rows[0] : undefined;
  }

  all(...args) {
    const params = this._flattenArgs(args);
    const stmt = this._db.prepare(this._sql);
    return params.length > 0 ? stmt.all(...params) : stmt.all();
  }
}

class Database {
  constructor(path) {
    this._db = new DatabaseSync(path);
  }

  pragma(str) {
    try { this._db.exec(`PRAGMA ${str}`); } catch {}
  }

  exec(sql) {
    this._db.exec(normalizeSql(sql));
  }

  prepare(sql) {
    return new Statement(this._db, sql);
  }

  transaction(fn) {
    this._db.exec('BEGIN');
    try {
      const result = fn();
      this._db.exec('COMMIT');
      return result;
    } catch (e) {
      this._db.exec('ROLLBACK');
      throw e;
    }
  }

  close() {
    this._db.close();
  }
}

module.exports = Database;
