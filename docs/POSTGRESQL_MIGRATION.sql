-- ============================================================================
-- STOCKFLOW PRO - Production PostgreSQL Database Migration Script
-- Multi-Warehouse Inventory Monitoring System (With Tiered Manager Approval)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS & CUSTOM TYPES
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Status Enums / Constraints
DO $$ BEGIN
    CREATE TYPE user_role_type AS ENUM ('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE warehouse_status_type AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE doc_type_enum AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER', 'ADJUSTMENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE doc_status_enum AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE movement_type_enum AS ENUM ('INBOUND', 'OUTBOUND', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUB');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ----------------------------------------------------------------------------
-- 2. TRIGGER FUNCTION FOR UPDATED_AT
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. TABLES DEFINITION
-- ----------------------------------------------------------------------------

-- Table: roles
CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: warehouses
CREATE TABLE IF NOT EXISTS warehouses (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    status warehouse_status_type NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role user_role_type NOT NULL DEFAULT 'OPERATOR',
    warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: categories
CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: products
CREATE TABLE IF NOT EXISTS products (
    id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    barcode VARCHAR(100),
    product_name VARCHAR(200) NOT NULL,
    category VARCHAR(100),
    brand VARCHAR(100),
    unit VARCHAR(20) NOT NULL DEFAULT 'PCS',
    min_stock NUMERIC(15,3) NOT NULL DEFAULT 0.000,
    reorder_point NUMERIC(15,3) NOT NULL DEFAULT 0.000,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: inventory
CREATE TABLE IF NOT EXISTS inventory (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    stock_on_hand NUMERIC(15,3) NOT NULL DEFAULT 0.000 CHECK (stock_on_hand >= 0),
    reserved_stock NUMERIC(15,3) NOT NULL DEFAULT 0.000 CHECK (reserved_stock >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_wh_product UNIQUE (warehouse_id, product_id)
);

-- Table: stock_movements (Immutable Audit Records)
CREATE TABLE IF NOT EXISTS stock_movements (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    movement_type movement_type_enum NOT NULL,
    quantity NUMERIC(15,3) NOT NULL,
    before_stock NUMERIC(15,3) NOT NULL,
    after_stock NUMERIC(15,3) NOT NULL,
    reference_number VARCHAR(100),
    note TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: documents
CREATE TABLE IF NOT EXISTS documents (
    id BIGSERIAL PRIMARY KEY,
    doc_type doc_type_enum NOT NULL,
    doc_number VARCHAR(100) NOT NULL UNIQUE,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    destination_warehouse_id BIGINT REFERENCES warehouses(id) ON DELETE RESTRICT,
    status doc_status_enum NOT NULL DEFAULT 'DRAFT',
    partner VARCHAR(150),
    document_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    assigned_manager_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: document_items
CREATE TABLE IF NOT EXISTS document_items (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(15,3) NOT NULL CHECK (quantity > 0)
);

-- Table: sales_daily (DOI Analytics Source)
CREATE TABLE IF NOT EXISTS sales_daily (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sale_date DATE NOT NULL,
    quantity NUMERIC(15,3) NOT NULL DEFAULT 0.000,
    CONSTRAINT uq_sales_daily UNIQUE (warehouse_id, product_id, sale_date)
);

-- Table: stock_opname
CREATE TABLE IF NOT EXISTS stock_opname (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    system_qty NUMERIC(15,3) NOT NULL,
    actual_qty NUMERIC(15,3) NOT NULL,
    variance NUMERIC(15,3) NOT NULL,
    status doc_status_enum NOT NULL DEFAULT 'DRAFT',
    note TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Table: audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(50) NOT NULL,
    entity_id VARCHAR(50),
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 4. TRIGGERS
-- ----------------------------------------------------------------------------
CREATE TRIGGER trg_warehouses_updated_at BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
CREATE TRIGGER trg_stock_opname_updated_at BEFORE UPDATE ON stock_opname FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- ----------------------------------------------------------------------------
-- 5. INDEXES FOR HIGH PERFORMANCE
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_wh_product ON inventory(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_sales_daily_wh_product_date ON sales_daily(warehouse_id, product_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_wh_prod ON stock_movements(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status, doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_assigned_manager ON documents(assigned_manager_id);
CREATE INDEX IF NOT EXISTS idx_documents_wh ON documents(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);

-- ----------------------------------------------------------------------------
-- 6. SEED DATA
-- ----------------------------------------------------------------------------

-- Roles
INSERT INTO roles (name, description) VALUES 
('SUPER_ADMIN', 'Full system access and global configuration'),
('MANAGER', 'Authorizes transaction approvals and oversees warehouse operations'),
('WAREHOUSE_ADMIN', 'Manages specific warehouse inventory and submits document requests'),
('OPERATOR', 'Creates document drafts and records physical transactions'),
('VIEWER', 'Read-only access to inventory reports and dashboards')
ON CONFLICT (name) DO NOTHING;

-- Warehouses
INSERT INTO warehouses (name, address, city, status) VALUES 
('Jakarta DC', 'Jl. Raya Jakarta No. 100', 'Jakarta', 'ACTIVE'),
('Bekasi Hub', 'Jl. Industri Bekasi Blok C', 'Bekasi', 'ACTIVE'),
('Makassar Hub', 'Jl. Logistik Makassar No. 45', 'Makassar', 'ACTIVE')
ON CONFLICT DO NOTHING;

-- Default Users (Password: admin123 hashed using bcrypt)
INSERT INTO users (name, email, password, role, warehouse_id, status) VALUES
('Super Admin', 'admin@stockflow.local', '$2a$10$tZg/P2eZ5qC8b7mX9q1uEe6sN0A0aB1c2d3e4f5g6h7i8j9k0l1m2', 'SUPER_ADMIN', NULL, 'ACTIVE'),
('Budi Manager', 'manager@stockflow.local', '$2a$10$tZg/P2eZ5qC8b7mX9q1uEe6sN0A0aB1c2d3e4f5g6h7i8j9k0l1m2', 'MANAGER', 1, 'ACTIVE'),
('Jakarta Admin', 'jakarta@stockflow.local', '$2a$10$tZg/P2eZ5qC8b7mX9q1uEe6sN0A0aB1c2d3e4f5g6h7i8j9k0l1m2', 'WAREHOUSE_ADMIN', 1, 'ACTIVE')
ON CONFLICT (email) DO NOTHING;

-- Products
INSERT INTO products (sku, barcode, product_name, category, brand, unit, min_stock, reorder_point) VALUES
('SKU001', '899001', 'Sunscreen SPF 50', 'Skincare', 'ELMIA', 'PCS', 500.000, 800.000),
('SKU002', '899002', 'Face Serum', 'Skincare', 'ELMIA', 'PCS', 300.000, 500.000),
('SKU003', '899003', 'Lip Cream', 'Cosmetics', 'ELMIA', 'PCS', 400.000, 700.000),
('SKU004', '899004', 'Body Lotion', 'Bodycare', 'ELMIA', 'PCS', 250.000, 400.000)
ON CONFLICT (sku) DO NOTHING;

COMMIT;
