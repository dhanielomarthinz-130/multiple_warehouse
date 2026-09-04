import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const db = new Database('stockflow.db');

// Enable WAL Mode and Foreign Keys for ACID compliance & integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize Database Schema
db.exec(`
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
  quantity REAL NOT NULL CHECK (quantity > 0)
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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_inventory_wh_product ON inventory(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_daily_wh_product_date ON sales_daily(warehouse_id, product_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_wh_prod ON stock_movements(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status, doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_manager ON documents(assigned_manager_id);
`);

// Safe Migration for Variant, Brand, Exp Date, and Batch Number Columns
try {
  db.exec('ALTER TABLE products ADD COLUMN variant TEXT;');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE products ADD COLUMN exp_date TEXT;');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE products ADD COLUMN batch_number TEXT;');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE products ADD COLUMN retail_price REAL DEFAULT 0;');
} catch {
  // column already exists
}

try {
  db.exec('ALTER TABLE products ADD COLUMN hpp REAL DEFAULT 0;');
} catch {
  // column already exists
}

// Populate default exp_date, batch_number, variant and brand if missing
try {
  db.exec(`
    UPDATE products SET 
      variant = CASE 
        WHEN id = 1 THEN '50ml Pump' 
        WHEN id = 2 THEN '30ml Dropper' 
        WHEN id = 3 THEN 'Matte 01 Red' 
        WHEN id = 4 THEN '250ml Bottle' 
        ELSE COALESCE(variant, 'Standard') 
      END,
      brand = COALESCE(NULLIF(brand, ''), 'ELMIA'),
      exp_date = CASE 
        WHEN id = 1 THEN '2027-12-31' 
        WHEN id = 2 THEN '2027-10-15' 
        WHEN id = 3 THEN '2026-11-20' 
        WHEN id = 4 THEN '2028-01-10' 
        ELSE COALESCE(exp_date, '2027-12-31') 
      END,
      batch_number = CASE 
        WHEN id = 1 THEN 'BATCH-2026A' 
        WHEN id = 2 THEN 'BATCH-2026B' 
        WHEN id = 3 THEN 'BATCH-2025X' 
        WHEN id = 4 THEN 'BATCH-2026C' 
        ELSE COALESCE(batch_number, 'BATCH-2026') 
      END
    WHERE exp_date IS NULL OR batch_number IS NULL OR variant IS NULL OR brand IS NULL OR brand = '';
  `);
} catch (e) {
  console.error('Error setting default product batches:', e.message);
}

// Seeding Initial Master Data
const roles = ['SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR', 'VIEWER'];
const stmtRole = db.prepare('INSERT OR IGNORE INTO roles (name) VALUES (?)');
for (const r of roles) stmtRole.run(r);

const warehouses = [
  ['Jakarta DC', 'Jl. Raya Jakarta No. 100', 'Jakarta'],
  ['Bekasi Hub', 'Jl. Industri Bekasi Blok C', 'Bekasi'],
  ['Makassar Hub', 'Jl. Logistik Makassar No. 45', 'Makassar']
];
const stmtWh = db.prepare('INSERT OR IGNORE INTO warehouses (name, address, city) VALUES (?, ?, ?)');
for (const w of warehouses) stmtWh.run(...w);

// Default Admin & Manager Users
const hash = bcrypt.hashSync('admin123', 10);
const seedUsers = [
  ['Super Admin', 'admin@stockflow.local', 'SUPER_ADMIN', null],
  ['Budi Manager (Jakarta)', 'manager@stockflow.local', 'MANAGER', 1],
  ['Jakarta Admin', 'jakarta@stockflow.local', 'WAREHOUSE_ADMIN', 1],
  ['Siti Manager (Bekasi)', 'manager_bekasi@stockflow.local', 'MANAGER', 2],
  ['Bekasi Admin', 'bekasi@stockflow.local', 'WAREHOUSE_ADMIN', 2],
  ['Andi Manager (Makassar)', 'manager_makassar@stockflow.local', 'MANAGER', 3],
  ['Makassar Admin', 'makassar@stockflow.local', 'WAREHOUSE_ADMIN', 3]
];

const stmtUserCheck = db.prepare('SELECT id FROM users WHERE email = ?');
const stmtUserInsert = db.prepare('INSERT INTO users (name, email, password, role, warehouse_id, status) VALUES (?, ?, ?, ?, ?, ?)');

for (const u of seedUsers) {
  if (!stmtUserCheck.get(u[1])) {
    stmtUserInsert.run(u[0], u[1], hash, u[2], u[3], 'ACTIVE');
  }
}

// Initial Demo Products & Inventory
const productCount = db.prepare('SELECT COUNT(*) c FROM products').get().c;
if (productCount === 0) {
  const products = [
    ['SKU001', '899001', 'Sunscreen SPF 50', 'Skincare', 'ELMIA', 'PCS', 500, 800],
    ['SKU002', '899002', 'Face Serum', 'Skincare', 'ELMIA', 'PCS', 300, 500],
    ['SKU003', '899003', 'Lip Cream', 'Cosmetics', 'ELMIA', 'PCS', 400, 700],
    ['SKU004', '899004', 'Body Lotion', 'Bodycare', 'ELMIA', 'PCS', 250, 400]
  ];
  const stmtProd = db.prepare('INSERT INTO products (sku, barcode, product_name, category, brand, unit, min_stock, reorder_point) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of products) stmtProd.run(...p);

  const stmtInv = db.prepare('INSERT OR IGNORE INTO inventory (warehouse_id, product_id, stock_on_hand) VALUES (?, ?, ?)');
  const stmtSales = db.prepare("INSERT OR IGNORE INTO sales_daily (warehouse_id, product_id, sale_date, quantity) VALUES (?, ?, date('now', ?), ?)");

  for (let w = 1; w <= 3; w++) {
    for (let p = 1; p <= 4; p++) {
      const initialStock = [1200, 900, 650, 2500][p - 1] - (w - 1) * 100;
      stmtInv.run(w, p, initialStock);

      for (let d = 1; d <= 30; d++) {
        const dailyQty = 20 + p * 7 + w * 2;
        stmtSales.run(w, p, `-${d} day`, dailyQty);
      }
    }
  }
}

try {
  db.prepare("ALTER TABLE document_items ADD COLUMN price REAL DEFAULT 0").run();
} catch (e) {}

try {
  db.prepare("UPDATE products SET hpp = 35000, retail_price = 50000 WHERE sku = 'SKU001' AND (hpp IS NULL OR hpp = 0)").run();
  db.prepare("UPDATE products SET hpp = 45000, retail_price = 65000 WHERE sku = 'SKU002' AND (hpp IS NULL OR hpp = 0)").run();
  db.prepare("UPDATE products SET hpp = 25000, retail_price = 40000 WHERE sku = 'SKU003' AND (hpp IS NULL OR hpp = 0)").run();
  db.prepare("UPDATE products SET hpp = 15000, retail_price = 25000 WHERE sku = 'SKU004' AND (hpp IS NULL OR hpp = 0)").run();

  db.prepare(`
    UPDATE document_items 
    SET price = (
      SELECT COALESCE(NULLIF(p.hpp, 0), NULLIF(p.retail_price, 0), 15000) 
      FROM products p WHERE p.id = document_items.product_id
    )
    WHERE price IS NULL OR price = 0
  `).run();
} catch (e) {}

try {
  db.prepare("UPDATE documents SET doc_type = 'PO_PRODUCT' WHERE doc_type = 'INBOUND'").run();
} catch (e) {}

export default db;
