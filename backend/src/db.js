import pg from 'pg';
import bcrypt from 'bcryptjs';
import { createRequire } from 'module';

const { Pool } = pg;
const isPg = Boolean(process.env.DATABASE_URL);

let pool = null;
let sqliteDb = null;

if (isPg) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    sqliteDb = new Database('stockflow.db');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');

    // Initialize SQLite Schema locally if not existing
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        status TEXT DEFAULT 'ACTIVE'
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'OPERATOR',
        warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        barcode TEXT,
        product_name TEXT NOT NULL,
        variant TEXT,
        category TEXT,
        brand TEXT,
        unit TEXT DEFAULT 'PCS',
        min_stock REAL DEFAULT 0,
        reorder_point REAL DEFAULT 0,
        retail_price REAL DEFAULT 0,
        hpp REAL DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE'
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        stock_on_hand REAL DEFAULT 0 CHECK (stock_on_hand >= 0),
        reserved_stock REAL DEFAULT 0 CHECK (reserved_stock >= 0),
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(warehouse_id, product_id)
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        movement_type TEXT NOT NULL,
        quantity REAL NOT NULL,
        before_stock REAL NOT NULL,
        after_stock REAL NOT NULL,
        reference_number TEXT,
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type TEXT NOT NULL,
        doc_number TEXT UNIQUE NOT NULL,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        destination_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE RESTRICT,
        status TEXT DEFAULT 'DRAFT',
        partner TEXT,
        document_date TEXT DEFAULT (date('now')),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        assigned_manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejection_reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS document_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        quantity REAL NOT NULL CHECK (quantity > 0),
        price REAL DEFAULT 0,
        is_rejected INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sales_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        sale_date TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        UNIQUE(warehouse_id, product_id, sale_date)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        detail TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_opname (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        system_qty REAL NOT NULL,
        actual_qty REAL NOT NULL,
        variance REAL NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        note TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.warn('SQLite init warning:', e.message);
  }
}

function translateSqlForPg(sql) {
  let paramIndex = 1;
  let isInsertIgnore = /^INSERT OR IGNORE INTO/i.test(sql.trim());
  let pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);

  pgSql = pgSql
    .replace(/datetime\('now',\s*'\-1 day'\)/gi, "(NOW() - INTERVAL '1 day')")
    .replace(/date\('now',\s*'\-30 day'\)/gi, "(CURRENT_DATE - INTERVAL '30 days')")
    .replace(/date\('now',\s*'\-7 day'\)/gi, "(CURRENT_DATE - INTERVAL '7 days')")
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO");

  if (isInsertIgnore && !/ON CONFLICT/i.test(pgSql)) {
    pgSql += " ON CONFLICT DO NOTHING";
  }

  if (/^INSERT INTO/i.test(pgSql.trim()) && !/RETURNING/i.test(pgSql) && !/ON CONFLICT/i.test(pgSql)) {
    pgSql += " RETURNING id";
  }

  return pgSql;
}

const db = {
  isPg,
  prepare: (sql) => {
    if (isPg) {
      const pgSql = translateSqlForPg(sql);
      return {
        get: async (...args) => {
          const res = await pool.query(pgSql, args);
          return res.rows[0] || undefined;
        },
        all: async (...args) => {
          const res = await pool.query(pgSql, args);
          return res.rows || [];
        },
        run: async (...args) => {
          const res = await pool.query(pgSql, args);
          const lastInsertRowid = res.rows?.[0]?.id || 0;
          return { changes: res.rowCount || 0, lastInsertRowid };
        }
      };
    } else {
      const stmt = sqliteDb.prepare(sql);
      return {
        get: async (...args) => stmt.get(...args),
        all: async (...args) => stmt.all(...args),
        run: async (...args) => stmt.run(...args)
      };
    }
  },
  transaction: (fn) => {
    if (isPg) {
      return async (...args) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(...args);
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      };
    } else {
      const tx = sqliteDb.transaction((...args) => fn(...args));
      return async (...args) => tx(...args);
    }
  }
};

export default db;

