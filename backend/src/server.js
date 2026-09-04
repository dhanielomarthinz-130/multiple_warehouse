import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'stockflow_pro_secret';

// Database helper functions
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);

// Authentication Middleware
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized access. Please login.' });
  }
}

// Role Authorization Middleware
function allow(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ message: 'Forbidden. Insufficient permissions.' });
  };
}

// Multi-Warehouse Scope Helper
function getWarehouseFilter(req) {
  if (req.user.role === 'SUPER_ADMIN') {
    const qWh = req.query.warehouse_id;
    return qWh && qWh !== 'all' ? Number(qWh) : null;
  }
  return req.user.warehouse_id ? Number(req.user.warehouse_id) : null;
}

// Audit Trail Helper
function audit(user, action, entity, entity_id, detail = '') {
  try {
    db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(user?.id || null, action, entity, String(entity_id || ''), detail);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// Get inventory record helper
function getStock(warehouse_id, product_id) {
  return one('SELECT * FROM inventory WHERE warehouse_id = ? AND product_id = ?', warehouse_id, product_id);
}

// Low level movement helper (Must be called inside a transaction context)
function recordMovement({ warehouse_id, product_id, type, qty, ref, note, user }) {
  let inv = getStock(warehouse_id, product_id);
  if (!inv) {
    db.prepare('INSERT INTO inventory (warehouse_id, product_id, stock_on_hand) VALUES (?, ?, 0)')
      .run(warehouse_id, product_id);
    inv = getStock(warehouse_id, product_id);
  }

  const before = Number(inv.stock_on_hand);
  const after = before + Number(qty);

  if (after < 0) {
    throw new Error(`Insufficient stock for product ID ${product_id} at warehouse ID ${warehouse_id}. Current: ${before}, Required: ${Math.abs(qty)}.`);
  }

  db.prepare('UPDATE inventory SET stock_on_hand = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(after, inv.id);

  db.prepare(`
    INSERT INTO stock_movements (warehouse_id, product_id, movement_type, quantity, before_stock, after_stock, reference_number, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(warehouse_id, product_id, type, qty, before, after, ref, note, user.id);

  return { before, after };
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const u = one('SELECT * FROM users WHERE email = ?', email);
  if (!u || !bcrypt.compareSync(password, u.password)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  if (u.status !== 'ACTIVE') {
    return res.status(403).json({ message: 'User account is inactive.' });
  }

  const token = jwt.sign(
    { id: u.id, name: u.name, role: u.role, warehouse_id: u.warehouse_id },
    SECRET,
    { expiresIn: '12h' }
  );

  audit(u, 'LOGIN', 'USER', u.id, 'User logged in successfully');
  res.json({ token, user: { id: u.id, name: u.name, role: u.role, warehouse_id: u.warehouse_id } });
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = one('SELECT id, name, email, role, warehouse_id, status FROM users WHERE id = ?', req.user.id);
  res.json(u || req.user);
});

app.get('/api/managers', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  if (targetWh) {
    res.json(q("SELECT id, name, email, role, warehouse_id FROM users WHERE role IN ('MANAGER', 'SUPER_ADMIN') AND status = 'ACTIVE' AND (warehouse_id = ? OR warehouse_id IS NULL)", targetWh));
  } else {
    res.json(q("SELECT id, name, email, role, warehouse_id FROM users WHERE role IN ('MANAGER', 'SUPER_ADMIN') AND status = 'ACTIVE'"));
  }
});

// ============================================================================
// DASHBOARD & ANALYTICS
// ============================================================================

app.get('/api/dashboard', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const where = targetWh ? 'WHERE i.warehouse_id = ?' : '';
  const args = targetWh ? [targetWh] : [];

  const total = one(`SELECT COALESCE(SUM(stock_on_hand), 0) total FROM inventory i ${where}`, ...args).total;
  const skus = one(`SELECT COUNT(*) c FROM inventory i ${where}`, ...args).c;

  const alerts = q(`
    SELECT p.sku, p.product_name, w.name AS warehouse, i.stock_on_hand,
      (SELECT COALESCE(SUM(quantity)/30.0, 0) FROM sales_daily s 
       WHERE s.product_id = p.id AND s.warehouse_id = i.warehouse_id AND s.sale_date >= date('now', '-30 day')) AS ads30
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    ${where}
    ORDER BY i.stock_on_hand ASC
    LIMIT 10
  `, ...args).map(x => ({
    ...x,
    doi30: x.ads30 > 0 ? +(x.stock_on_hand / x.ads30).toFixed(1) : null
  }));

  const inboundWhere = targetWh
    ? "WHERE warehouse_id = ? AND created_at >= datetime('now', '-1 day') AND movement_type = 'INBOUND'"
    : "WHERE created_at >= datetime('now', '-1 day') AND movement_type = 'INBOUND'";

  const outboundWhere = targetWh
    ? "WHERE warehouse_id = ? AND created_at >= datetime('now', '-1 day') AND movement_type = 'OUTBOUND'"
    : "WHERE created_at >= datetime('now', '-1 day') AND movement_type = 'OUTBOUND'";

  const inbound = one(`SELECT COALESCE(SUM(quantity), 0) n FROM stock_movements ${inboundWhere}`, ...(targetWh ? [targetWh] : [])).n;
  const outbound = one(`SELECT COALESCE(SUM(ABS(quantity)), 0) n FROM stock_movements ${outboundWhere}`, ...(targetWh ? [targetWh] : [])).n;

  res.json({ total_stock: total, sku_count: skus, inbound_today: inbound, outbound_today: outbound, alerts });
});

app.get('/api/analytics/doi', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const rows = targetWh ? q('SELECT * FROM inventory WHERE warehouse_id = ?', targetWh) : q('SELECT * FROM inventory');
  let stats = { critical: 0, healthy: 0, slow: 0, overstock: 0, no_sales: 0 };

  for (const i of rows) {
    const ads = one(
      "SELECT COALESCE(SUM(quantity)/30.0, 0) a FROM sales_daily WHERE product_id = ? AND warehouse_id = ? AND sale_date >= date('now', '-30 day')",
      i.product_id, i.warehouse_id
    ).a;

    const doi = ads > 0 ? i.stock_on_hand / ads : null;
    if (doi === null) stats.no_sales++;
    else if (doi < 7) stats.critical++;
    else if (doi <= 30) stats.healthy++;
    else if (doi <= 60) stats.slow++;
    else stats.overstock++;
  }

  res.json(stats);
});

// ============================================================================
// MASTER DATA (WAREHOUSES & PRODUCTS)
// ============================================================================

app.get('/api/warehouses', auth, (req, res) => {
  const rows = q(`
    SELECT w.*, 
      (SELECT COALESCE(SUM(stock_on_hand), 0) FROM inventory WHERE warehouse_id = w.id) AS total_stock,
      (SELECT COUNT(*) FROM inventory WHERE warehouse_id = w.id) AS total_skus
    FROM warehouses w 
    ORDER BY w.id
  `);
  res.json(rows);
});

app.post('/api/warehouses', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const { name, address, city, status } = req.body;
  if (!name) return res.status(400).json({ message: 'Warehouse name is required.' });

  const result = db.prepare('INSERT INTO warehouses (name, address, city, status) VALUES (?, ?, ?, ?)')
    .run(name, address || '', city || '', status || 'ACTIVE');

  audit(req.user, 'CREATE_WAREHOUSE', 'WAREHOUSE', result.lastInsertRowid, `Created warehouse ${name}`);
  res.json({ id: result.lastInsertRowid, message: 'Warehouse created successfully.' });
});

app.put('/api/warehouses/:id', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const { id } = req.params;
  const { name, address, city, status } = req.body;

  const w = one('SELECT * FROM warehouses WHERE id = ?', id);
  if (!w) return res.status(404).json({ message: 'Warehouse not found.' });

  db.prepare('UPDATE warehouses SET name = ?, address = ?, city = ?, status = ? WHERE id = ?')
    .run(name || w.name, address ?? w.address, city ?? w.city, status || w.status, id);

  audit(req.user, 'UPDATE_WAREHOUSE', 'WAREHOUSE', id, `Updated warehouse ${name || w.name}`);
  res.json({ message: 'Warehouse updated successfully.' });
});

app.delete('/api/warehouses/:id', auth, allow('SUPER_ADMIN'), (req, res) => {
  const { id } = req.params;
  const inv = one('SELECT COUNT(*) c FROM inventory WHERE warehouse_id = ? AND stock_on_hand > 0', id);
  if (inv && inv.c > 0) {
    return res.status(400).json({ message: 'Cannot delete warehouse with active stock. Deactivate it instead.' });
  }

  try {
    db.prepare('DELETE FROM warehouses WHERE id = ?').run(id);
    audit(req.user, 'DELETE_WAREHOUSE', 'WAREHOUSE', id, `Deleted warehouse ID ${id}`);
    res.json({ message: 'Warehouse deleted successfully.' });
  } catch {
    res.status(400).json({ message: 'Cannot delete warehouse: Referenced by existing documents. Change status to INACTIVE instead.' });
  }
});

app.get('/api/products', auth, (req, res) => {
  res.json(q('SELECT * FROM products ORDER BY product_name'));
});

app.post('/api/products', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN'), (req, res) => {
  const b = req.body;
  if (!b.sku || !b.product_name) {
    return res.status(400).json({ message: 'SKU and product_name are required.' });
  }

  try {
    const existing = b.id
      ? db.prepare('SELECT * FROM products WHERE id = ?').get(b.id)
      : db.prepare('SELECT * FROM products WHERE sku = ?').get(b.sku);

    const retailPrice = parseFloat(b.retail_price) || 0;
    const hpp = parseFloat(b.hpp) || 0;

    if (existing) {
      db.prepare(`
        UPDATE products 
        SET sku = ?, barcode = ?, product_name = ?, variant = ?, category = ?, brand = ?, exp_date = ?, batch_number = ?, unit = ?, min_stock = ?, reorder_point = ?, retail_price = ?, hpp = ?
        WHERE id = ?
      `).run(
        b.sku, b.barcode || '', b.product_name, b.variant || '', b.category || '', b.brand || '',
        b.exp_date || '', b.batch_number || '', b.unit || 'PCS', b.min_stock || 0, b.reorder_point || 0,
        retailPrice, hpp, existing.id
      );

      audit(req.user, 'UPDATE', 'PRODUCT', existing.id, `Updated product SKU: ${b.sku} (${b.variant || 'No variant'})`);
      return res.json({ id: existing.id, sku: b.sku, product_name: b.product_name, variant: b.variant, retail_price: retailPrice, hpp, updated: true });
    }

    const result = db.prepare(`
      INSERT INTO products (sku, barcode, product_name, variant, category, brand, exp_date, batch_number, unit, min_stock, reorder_point, retail_price, hpp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.sku, b.barcode || '', b.product_name, b.variant || '', b.category || '', b.brand || '',
      b.exp_date || '', b.batch_number || '', b.unit || 'PCS', b.min_stock || 0, b.reorder_point || 0,
      retailPrice, hpp
    );

    audit(req.user, 'CREATE', 'PRODUCT', result.lastInsertRowid, `Created product SKU: ${b.sku} (${b.variant || 'No variant'})`);
    res.json({ id: result.lastInsertRowid, sku: b.sku, product_name: b.product_name, variant: b.variant, retail_price: retailPrice, hpp });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ============================================================================
// INVENTORY & STOCK MOVEMENTS
// ============================================================================

app.get('/api/inventory', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const sql = `
    SELECT i.*, p.sku, p.barcode, p.product_name, p.variant, p.category, p.brand, p.exp_date, p.batch_number, p.unit, p.retail_price, p.hpp, w.name AS warehouse,
      COALESCE((SELECT SUM(quantity)/7.0 FROM sales_daily s WHERE s.product_id = i.product_id AND s.warehouse_id = i.warehouse_id AND s.sale_date >= date('now', '-7 day')), 0) ads7,
      COALESCE((SELECT SUM(quantity)/30.0 FROM sales_daily s WHERE s.product_id = i.product_id AND s.warehouse_id = i.warehouse_id AND s.sale_date >= date('now', '-30 day')), 0) ads30
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    ${targetWh ? 'WHERE i.warehouse_id = ?' : ''}
    ORDER BY p.product_name
  `;

  let rows = q(sql, ...(targetWh ? [targetWh] : []));
  rows = rows.map(x => ({
    ...x,
    doi7: x.ads7 > 0 ? +(x.stock_on_hand / x.ads7).toFixed(1) : null,
    doi30: x.ads30 > 0 ? +(x.stock_on_hand / x.ads30).toFixed(1) : null,
    status: x.ads30 === 0 ? 'NO SALES' : (x.stock_on_hand / x.ads30 < 7 ? 'CRITICAL' : (x.stock_on_hand / x.ads30 <= 30 ? 'HEALTHY' : (x.stock_on_hand / x.ads30 <= 60 ? 'SLOW MOVING' : 'OVERSTOCK')))
  }));

  res.json(rows);
});

app.get('/api/inventory/history', auth, (req, res) => {
  const { sku, product_id } = req.query;
  let prod;
  if (product_id) {
    prod = q('SELECT * FROM products WHERE id = ?', product_id)[0];
  } else if (sku) {
    prod = q('SELECT * FROM products WHERE sku = ?', sku)[0];
  }
  if (!prod) return res.status(404).json({ message: 'Product not found.' });

  // Fetch document movement history for this product
  const docMovements = q(`
    SELECT 
      d.doc_number,
      d.doc_type,
      d.status,
      d.created_at AS timestamp,
      w.name AS warehouse_name,
      dw.name AS dest_warehouse_name,
      di.quantity,
      u.name AS actor_name
    FROM document_items di
    JOIN documents d ON d.id = di.document_id
    JOIN warehouses w ON w.id = d.warehouse_id
    LEFT JOIN warehouses dw ON dw.id = d.destination_warehouse_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE di.product_id = ?
    ORDER BY d.created_at DESC
  `, prod.id);

  // Fetch audit trail logs referencing this product SKU or ID
  const auditMovements = q(`
    SELECT 
      a.created_at AS timestamp,
      COALESCE(u.name, 'System') AS actor_name,
      a.action AS doc_type,
      a.detail AS notes
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE (a.entity = 'PRODUCT' AND a.entity_id = ?) OR a.detail LIKE ?
    ORDER BY a.created_at DESC
  `, String(prod.id), `%${prod.sku}%`);

  res.json({
    product: prod,
    movements: docMovements,
    audit: auditMovements
  });
});

// ============================================================================
// DOCUMENTS (INBOUND, OUTBOUND, TRANSFER) & MANAGER APPROVAL FLOW
// ============================================================================

function createDocumentHandler(type) {
  return (req, res) => {
    const b = req.body;
    if (!b.warehouse_id || !b.items || !b.items.length) {
      return res.status(400).json({ message: 'warehouse_id and at least one item are required.' });
    }

    // Enforce origin warehouse isolation for non-SUPER_ADMIN
    if (req.user.role !== 'SUPER_ADMIN' && req.user.warehouse_id && Number(b.warehouse_id) !== Number(req.user.warehouse_id)) {
      return res.status(403).json({ message: `Forbidden. You are assigned to Warehouse ID ${req.user.warehouse_id} and cannot create requests for Warehouse ID ${b.warehouse_id}.` });
    }

    const type = b.doc_type || defaultType || 'PO_PRODUCT';
    const prefixMap = { INBOUND: 'PO', OUTBOUND: 'OUT', TRANSFER: 'TRF', ADJUSTMENT: 'ADJ', PO_PRODUCT: 'PO-PRD', PO_OPERATIONAL: 'PO-OPS' };
    const prefix = prefixMap[type] || 'PO';
    const num = b.doc_number || `${prefix}-${Date.now()}`;
    const assignedManagerId = b.assigned_manager_id || null;

    // Execute within Transaction
    const transaction = db.transaction(() => {
      const doc = db.prepare(`
        INSERT INTO documents (doc_type, doc_number, warehouse_id, destination_warehouse_id, status, partner, document_date, created_by, assigned_manager_id)
        VALUES (?, ?, ?, ?, 'PENDING_APPROVAL', ?, date('now'), ?, ?)
      `).run(type, num, b.warehouse_id, b.destination_warehouse_id || null, b.partner || '', req.user.id, assignedManagerId);

      const stmtItem = db.prepare('INSERT INTO document_items (document_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');
      for (const item of b.items) {
        stmtItem.run(doc.lastInsertRowid, item.product_id, item.quantity, item.price || 0);
      }

      audit(req.user, 'SUBMIT_REQUEST', type, doc.lastInsertRowid, `Submitted ${type} request ${num} to Manager ID ${assignedManagerId || 'Global'}`);
      return doc.lastInsertRowid;
    });

    try {
      const docId = transaction();
      res.json({ id: docId, doc_number: num, status: 'PENDING_APPROVAL' });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  };
}

app.post('/api/inbounds', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR'), createDocumentHandler('INBOUND'));
app.post('/api/outbounds', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR'), createDocumentHandler('OUTBOUND'));
app.post('/api/transfers', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR'), createDocumentHandler('TRANSFER'));

app.get('/api/documents', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  let docs;

  if (req.user.role === 'SUPER_ADMIN') {
    if (targetWh) {
      docs = q(`
        SELECT d.*, 
          w.name AS warehouse, 
          dw.name AS destination_warehouse, 
          uc.name AS creator_name,
          um.name AS assigned_manager_name,
          ua.name AS approver_name
        FROM documents d
        LEFT JOIN warehouses w ON w.id = d.warehouse_id
        LEFT JOIN warehouses dw ON dw.id = d.destination_warehouse_id
        LEFT JOIN users uc ON uc.id = d.created_by
        LEFT JOIN users um ON um.id = d.assigned_manager_id
        LEFT JOIN users ua ON ua.id = d.approved_by
        WHERE d.warehouse_id = ? OR d.destination_warehouse_id = ?
        ORDER BY d.id DESC
      `, targetWh, targetWh);
    } else {
      docs = q(`
        SELECT d.*, 
          w.name AS warehouse, 
          dw.name AS destination_warehouse, 
          uc.name AS creator_name,
          um.name AS assigned_manager_name,
          ua.name AS approver_name
        FROM documents d
        LEFT JOIN warehouses w ON w.id = d.warehouse_id
        LEFT JOIN warehouses dw ON dw.id = d.destination_warehouse_id
        LEFT JOIN users uc ON uc.id = d.created_by
        LEFT JOIN users um ON um.id = d.assigned_manager_id
        LEFT JOIN users ua ON ua.id = d.approved_by
        ORDER BY d.id DESC
      `);
    }
  } else {
    // Non-Super Admin: Restricted to assigned warehouse (origin or destination) or assigned manager
    const whId = req.user.warehouse_id || 0;
    docs = q(`
      SELECT d.*, 
        w.name AS warehouse, 
        dw.name AS destination_warehouse, 
        uc.name AS creator_name,
        um.name AS assigned_manager_name,
        ua.name AS approver_name
      FROM documents d
      LEFT JOIN warehouses w ON w.id = d.warehouse_id
      LEFT JOIN warehouses dw ON dw.id = d.destination_warehouse_id
      LEFT JOIN users uc ON uc.id = d.created_by
      LEFT JOIN users um ON um.id = d.assigned_manager_id
      LEFT JOIN users ua ON ua.id = d.approved_by
      WHERE d.warehouse_id = ? OR d.destination_warehouse_id = ? OR d.assigned_manager_id = ? OR d.created_by = ?
      ORDER BY d.id DESC
    `, whId, whId, req.user.id, req.user.id);
  }

  // Attach items to each document
  const stmtItems = db.prepare(`
    SELECT di.*, COALESCE(NULLIF(di.price, 0), NULLIF(p.hpp, 0), NULLIF(p.retail_price, 0), 15000) AS unit_price,
           p.sku, p.barcode, p.product_name, p.variant, p.brand, p.unit, p.hpp, p.retail_price
    FROM document_items di
    JOIN products p ON p.id = di.product_id
    WHERE di.document_id = ?
  `);

  const result = docs.map(d => ({
    ...d,
    items: stmtItems.all(d.id)
  }));

  res.json(result);
});

// Toggle Item-Level Rejection Endpoint
app.post('/api/document-items/:id/toggle-reject', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const item = one('SELECT * FROM document_items WHERE id = ?', req.params.id);
  if (!item) return res.status(404).json({ message: 'Document item not found.' });

  const doc = one('SELECT * FROM documents WHERE id = ?', item.document_id);
  if (!doc) return res.status(404).json({ message: 'Document not found.' });

  if (doc.status !== 'PENDING_APPROVAL') {
    return res.status(400).json({ message: 'Status item hanya dapat diubah saat dokumen status PENDING MANAGER.' });
  }

  const newRejectedState = item.is_rejected ? 0 : 1;
  db.prepare('UPDATE document_items SET is_rejected = ? WHERE id = ?').run(newRejectedState, item.id);

  audit(req.user, newRejectedState ? 'REJECT_ITEM' : 'RESTORE_ITEM', 'DOCUMENT_ITEM', item.id, `${newRejectedState ? 'Rejected' : 'Restored'} item ${item.product_id} in document ${doc.doc_number}`);
  res.json({ id: item.id, is_rejected: newRejectedState, message: newRejectedState ? 'Item ditolak (Rejected)' : 'Item diterima (Approved)' });
});

// Manager Approval Transaction Endpoint
app.post('/api/documents/:id/approve', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const d = one('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ message: 'Document not found.' });

  if (req.user.role !== 'SUPER_ADMIN') {
    if (d.assigned_manager_id !== req.user.id && Number(d.warehouse_id) !== Number(req.user.warehouse_id)) {
      return res.status(403).json({ message: 'Forbidden. You are not authorized to approve documents for this warehouse.' });
    }
  }

  if (d.status === 'APPROVED' || d.status === 'RECEIVED') {
    return res.status(400).json({ message: 'Document is already processed.' });
  }

  if (d.status === 'REJECTED') {
    return res.status(400).json({ message: 'Cannot approve a rejected document.' });
  }

  const items = q('SELECT * FROM document_items WHERE document_id = ? AND (is_rejected IS NULL OR is_rejected = 0)', d.id);

  const processApproval = db.transaction(() => {
    for (const it of items) {
      if (d.doc_type === 'INBOUND' || d.doc_type.startsWith('PO')) {
        recordMovement({ warehouse_id: d.warehouse_id, product_id: it.product_id, type: 'INBOUND', qty: it.quantity, ref: d.doc_number, note: `Approved Purchase Order (PO) by Manager (${req.user.name})`, user: req.user });
      } else if (d.doc_type === 'OUTBOUND') {
        recordMovement({ warehouse_id: d.warehouse_id, product_id: it.product_id, type: 'OUTBOUND', qty: -it.quantity, ref: d.doc_number, note: `Approved Outbound by Manager (${req.user.name})`, user: req.user });
      } else if (d.doc_type === 'TRANSFER') {
        recordMovement({ warehouse_id: d.warehouse_id, product_id: it.product_id, type: 'TRANSFER_OUT', qty: -it.quantity, ref: d.doc_number, note: `Transfer Approved - In Transit by Manager (${req.user.name})`, user: req.user });
      }
    }

    const nextStatus = d.doc_type === 'TRANSFER' ? 'IN_TRANSIT' : 'APPROVED';
    db.prepare('UPDATE documents SET status = ?, approved_by = ? WHERE id = ?').run(nextStatus, req.user.id, d.id);
    audit(req.user, 'APPROVE', d.doc_type, d.id, `Manager ${req.user.name} approved document ${d.doc_number} (New Status: ${nextStatus})`);
  });

  try {
    processApproval();
    res.json({ message: `Document ${d.doc_number} approved successfully by Manager.` });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Manager Rejection Endpoint
app.post('/api/documents/:id/reject', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const d = one('SELECT * FROM documents WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ message: 'Document not found.' });

  if (req.user.role !== 'SUPER_ADMIN') {
    if (d.assigned_manager_id !== req.user.id && Number(d.warehouse_id) !== Number(req.user.warehouse_id)) {
      return res.status(403).json({ message: 'Forbidden. You are not authorized to reject documents for this warehouse.' });
    }
  }

  if (d.status !== 'PENDING_APPROVAL') {
    return res.status(400).json({ message: 'Only documents pending approval can be rejected.' });
  }

  const { reason } = req.body;
  db.prepare("UPDATE documents SET status = 'REJECTED', approved_by = ?, rejection_reason = ? WHERE id = ?")
    .run(req.user.id, reason || 'Rejected by Manager', d.id);

  audit(req.user, 'REJECT', d.doc_type, d.id, `Manager ${req.user.name} rejected document ${d.doc_number}. Reason: ${reason || 'None'}`);
  res.json({ message: `Document ${d.doc_number} rejected.` });
});

// Receiving Inter-Warehouse Transfer Endpoint
app.post('/api/transfers/:id/receive', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN'), (req, res) => {
  const d = one("SELECT * FROM documents WHERE id = ? AND doc_type = 'TRANSFER'", req.params.id);
  if (!d || d.status !== 'IN_TRANSIT') {
    return res.status(400).json({ message: 'Transfer document is not in transit.' });
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    if (Number(d.destination_warehouse_id) !== Number(req.user.warehouse_id)) {
      return res.status(403).json({ message: 'Forbidden. You can only receive transfers addressed to your assigned warehouse.' });
    }
  }

  const items = q('SELECT * FROM document_items WHERE document_id = ?', d.id);

  const processReceive = db.transaction(() => {
    for (const it of items) {
      recordMovement({ warehouse_id: d.destination_warehouse_id, product_id: it.product_id, type: 'TRANSFER_IN', qty: it.quantity, ref: d.doc_number, note: 'Transfer Received', user: req.user });
    }

    db.prepare("UPDATE documents SET status = 'RECEIVED' WHERE id = ?").run(d.id);
    audit(req.user, 'RECEIVE', 'TRANSFER', d.id, `Received transfer ${d.doc_number} at destination warehouse ID ${d.destination_warehouse_id}`);
  });

  try {
    processReceive();
    res.json({ message: `Transfer ${d.doc_number} received successfully at destination warehouse.` });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ============================================================================
// STOCK OPNAME & ADJUSTMENT
// ============================================================================

app.get('/api/stock-opname', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const where = targetWh ? 'WHERE o.warehouse_id = ?' : '';
  const args = targetWh ? [targetWh] : [];
  res.json(q(`
    SELECT o.*, w.name AS warehouse, p.sku, p.product_name, u.name AS auditor_name
    FROM stock_opname o
    JOIN warehouses w ON w.id = o.warehouse_id
    JOIN products p ON p.id = o.product_id
    LEFT JOIN users u ON u.id = o.created_by
    ${where}
    ORDER BY o.id DESC
  `, ...args));
});

app.post('/api/stock-opname', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN', 'OPERATOR'), (req, res) => {
  const { warehouse_id, product_id, actual_qty, note } = req.body;
  if (!warehouse_id || !product_id || actual_qty === undefined) {
    return res.status(400).json({ message: 'warehouse_id, product_id, and actual_qty are required.' });
  }

  if (req.user.role !== 'SUPER_ADMIN' && req.user.warehouse_id && Number(warehouse_id) !== Number(req.user.warehouse_id)) {
    return res.status(403).json({ message: `Forbidden. You are assigned to Warehouse ID ${req.user.warehouse_id} and cannot submit opname for Warehouse ID ${warehouse_id}.` });
  }

  const inv = getStock(warehouse_id, product_id);
  const system_qty = inv ? Number(inv.stock_on_hand) : 0;
  const variance = Number(actual_qty) - system_qty;

  const result = db.prepare(`
    INSERT INTO stock_opname (warehouse_id, product_id, system_qty, actual_qty, variance, status, note, created_by)
    VALUES (?, ?, ?, ?, ?, 'PENDING_APPROVAL', ?, ?)
  `).run(warehouse_id, product_id, system_qty, actual_qty, variance, note || '', req.user.id);

  audit(req.user, 'CREATE', 'STOCK_OPNAME', result.lastInsertRowid, `Recorded opname variance: ${variance}`);
  res.json({ id: result.lastInsertRowid, variance, status: 'PENDING_APPROVAL' });
});

app.post('/api/stock-opname/:id/adjust', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const op = one('SELECT * FROM stock_opname WHERE id = ?', req.params.id);
  if (!op) return res.status(404).json({ message: 'Stock opname record not found.' });

  if (req.user.role !== 'SUPER_ADMIN' && req.user.warehouse_id && Number(op.warehouse_id) !== Number(req.user.warehouse_id)) {
    return res.status(403).json({ message: 'Forbidden. You are not authorized to approve opname adjustments for this warehouse.' });
  }

  if (op.status === 'APPROVED') return res.status(400).json({ message: 'Opname adjustment already approved.' });

  const processAdjustment = db.transaction(() => {
    if (op.variance !== 0) {
      const type = op.variance > 0 ? 'ADJUSTMENT_ADD' : 'ADJUSTMENT_SUB';
      recordMovement({
        warehouse_id: op.warehouse_id,
        product_id: op.product_id,
        type,
        qty: op.variance,
        ref: `OPNAME-${op.id}`,
        note: `Stock Opname Adjustment (${op.note || 'No note'})`,
        user: req.user
      });
    }

    db.prepare("UPDATE stock_opname SET status = 'APPROVED', approved_by = ? WHERE id = ?")
      .run(req.user.id, op.id);

    audit(req.user, 'APPROVE', 'STOCK_OPNAME', op.id, `Approved stock opname adjustment variance: ${op.variance}`);
  });

  try {
    processAdjustment();
    res.json({ message: 'Stock opname adjustment approved and stock updated successfully.' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ============================================================================
// USERS & AUDIT LOGS
// ============================================================================

app.get('/api/audit-logs', auth, allow('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE_ADMIN'), (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const where = targetWh ? 'WHERE u.warehouse_id = ? OR u.warehouse_id IS NULL' : '';
  const args = targetWh ? [targetWh] : [];
  res.json(q(`
    SELECT a.*, u.name AS user_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.id DESC
    LIMIT 200
  `, ...args));
});

app.get('/api/users', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  res.json(q('SELECT id, name, email, role, warehouse_id, status, created_at FROM users ORDER BY id'));
});

app.post('/api/users', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const { name, email, password, role, warehouse_id } = req.body;
  if (!name || !email) return res.status(400).json({ message: 'Name and email are required.' });

  try {
    const hash = bcrypt.hashSync(password || 'password123', 10);
    const result = db.prepare(`
      INSERT INTO users (name, email, password, role, warehouse_id, status)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE')
    `).run(name, email, hash, role || 'OPERATOR', warehouse_id || null);

    audit(req.user, 'CREATE', 'USER', result.lastInsertRowid, `Created user ${email} (${role})`);
    res.json({ id: result.lastInsertRowid, name, email, role });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/users/:id', auth, (req, res) => {
  const targetId = Number(req.params.id);
  const canManage = ['SUPER_ADMIN', 'MANAGER'].includes(req.user.role);
  if (!canManage && req.user.id !== targetId) {
    return res.status(403).json({ message: 'Forbidden. You cannot edit other user accounts.' });
  }

  const existing = one('SELECT * FROM users WHERE id = ?', targetId);
  if (!existing) return res.status(404).json({ message: 'User account not found.' });

  const { name, email, password, role, warehouse_id, status } = req.body;

  const newName = name || existing.name;
  const newEmail = email || existing.email;
  const newRole = canManage ? (role || existing.role) : existing.role;
  const newWh = canManage ? (warehouse_id !== undefined ? (warehouse_id ? Number(warehouse_id) : null) : existing.warehouse_id) : existing.warehouse_id;
  const newStatus = canManage ? (status || existing.status) : existing.status;

  let newHash = existing.password;
  if (password && password.trim().length > 0) {
    newHash = bcrypt.hashSync(password.trim(), 10);
  }

  try {
    db.prepare(`
      UPDATE users SET name = ?, email = ?, password = ?, role = ?, warehouse_id = ?, status = ?
      WHERE id = ?
    `).run(newName, newEmail, newHash, newRole, newWh, newStatus, targetId);

    audit(req.user, 'UPDATE', 'USER', targetId, `Updated user ${newEmail}${password ? ' (Password changed)' : ''}`);
    res.json({ message: `User ${newEmail} updated successfully.`, user: { id: targetId, name: newName, email: newEmail, role: newRole, warehouse_id: newWh, status: newStatus } });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete('/api/users/:id', auth, allow('SUPER_ADMIN', 'MANAGER'), (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id === targetId) {
    return res.status(400).json({ message: 'You cannot delete your own account.' });
  }

  const existing = one('SELECT * FROM users WHERE id = ?', targetId);
  if (!existing) return res.status(404).json({ message: 'User account not found.' });

  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
    audit(req.user, 'DELETE', 'USER', targetId, `Deleted user ${existing.email}`);
    res.json({ message: `User ${existing.email} deleted successfully.` });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// CSV Export Report
app.get('/api/reports/inventory.csv', auth, (req, res) => {
  const targetWh = getWarehouseFilter(req);
  const where = targetWh ? 'WHERE i.warehouse_id = ?' : '';
  const args = targetWh ? [targetWh] : [];
  const rows = q(`
    SELECT w.name AS warehouse, p.sku, p.product_name, i.stock_on_hand, p.unit
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    JOIN warehouses w ON w.id = i.warehouse_id
    ${where}
    ORDER BY w.name, p.product_name
  `, ...args);

  const escapeCsv = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory_report.csv');
  res.send([
    'Warehouse,SKU,Product,Stock On Hand,Unit',
    ...rows.map(x => [x.warehouse, x.sku, x.product_name, x.stock_on_hand, x.unit].map(escapeCsv).join(','))
  ].join('\n'));
});

// Start Server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`STOCKFLOW PRO API server running on port ${PORT}`));
