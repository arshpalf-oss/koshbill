import { Router, Request, Response, NextFunction } from 'express';
import { db, generateToken, hashPassword, verifyPassword } from './db.js';
import { isCloudDeploymentEnvironment, isMongoConfigured } from './mongo.js';
import { buildUpiPaymentUri, INDIAN_STATES, round2 } from './constants.js';
import {
  adjustBatchStock,
  cancelInvoice,
  createInvoiceWithFifo,
  createPurchaseBill,
  getFullInvoiceById,
  getFullPurchaseById,
  getProductTotalStock,
  getTodayDate,
  previewFifoAllocation,
  recordPartyLedgerPayment,
  seedDefaultHsnForOrg,
  settleInvoiceDue,
} from './services.js';

export interface AuthedRequest extends Request {
  user?: {
    id: number;
    org_id: number;
    name: string;
    email: string;
    role: string;
  };
}

export const apiRouter = Router();

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.org_id, u.name, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as any;

  if (!session || session.expires_at < new Date().toISOString()) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  req.user = {
    id: session.id,
    org_id: session.org_id,
    name: session.name,
    email: session.email,
    role: session.role,
  };
  next();
}

function createSessionForUser(userId: number, orgId: number): string {
  const token = generateToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO sessions (token, user_id, org_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(token, userId, orgId, expires.toISOString(), now.toISOString());
  return token;
}

// ============================================================================
// PUBLIC / AUTH ROUTES
// ============================================================================

apiRouter.get('/meta/states', (_req, res) => {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const storageMode = isMongoConfigured()
    ? 'mongodb'
    : isCloudDeploymentEnvironment()
      ? 'unconfigured_cloud'
      : 'local';
  res.json({
    states: INDIAN_STATES,
    has_users: (row?.count || 0) > 0,
    storage_mode: storageMode,
    mongodb_connected: isMongoConfigured(),
  });
});

apiRouter.post('/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(email) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = createSessionForUser(user.id, user.org_id);
    const organization = db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(user.org_id);

    res.json({
      token,
      user: {
        id: user.id,
        org_id: user.org_id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      organization,
      states: INDIAN_STATES,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

apiRouter.post('/auth/register', (req, res) => {
  try {
    const {
      business_name,
      owner_name,
      email,
      password,
      phone,
      gst_enabled,
      gstin,
      state_code,
      upi_id,
      address,
      city,
    } = req.body || {};

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!business_name || !owner_name || !cleanEmail || !password) {
      res.status(400).json({ error: 'Business name, owner name, email, and password are required' });
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
    if (exists) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const stObj = INDIAN_STATES.find((s) => s.code === state_code) || {
      code: '09',
      name: 'Uttar Pradesh',
    };
    const nowIso = new Date().toISOString();
    const isGst = Boolean(gst_enabled);

    const tx = db.transaction(() => {
      const orgRes = db
        .prepare(
          `INSERT INTO organizations (
            business_name, legal_name, gst_enabled, gstin, state_name, state_code,
            address, city, phone, email, upi_id, upi_payee_name, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          String(business_name).trim(),
          String(business_name).trim(),
          isGst ? 1 : 0,
          isGst ? String(gstin || '').trim().toUpperCase() : '',
          stObj.name,
          stObj.code,
          String(address || '').trim(),
          String(city || '').trim(),
          String(phone || '').trim(),
          cleanEmail,
          String(upi_id || 'merchant@upi').trim(),
          String(business_name).trim(),
          nowIso
        );
      const orgId = Number(orgRes.lastInsertRowid);

      const userRes = db
        .prepare(
          `INSERT INTO users (org_id, name, email, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, 'ADMIN', ?)`
        )
        .run(orgId, String(owner_name).trim(), cleanEmail, hashPassword(String(password)), nowIso);

      const userId = Number(userRes.lastInsertRowid);
      if (req.body?.load_standard_hsn) {
        seedDefaultHsnForOrg(orgId);
      }
      const token = createSessionForUser(userId, orgId);
      return { orgId, userId, token };
    });

    const { orgId, userId, token } = tx();
    const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);

    res.status(201).json({
      token,
      user: {
        id: userId,
        org_id: orgId,
        name: String(owner_name).trim(),
        email: cleanEmail,
        role: 'ADMIN',
      },
      organization,
      states: INDIAN_STATES,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// ============================================================================
// PROTECTED ROUTES
// ============================================================================

apiRouter.use(requireAuth);

apiRouter.get('/auth/me', (req: AuthedRequest, res) => {
  const organization = db
    .prepare('SELECT * FROM organizations WHERE id = ?')
    .get(req.user!.org_id);
  res.json({
    user: req.user,
    organization,
    states: INDIAN_STATES,
  });
});

apiRouter.post('/auth/logout', (req: AuthedRequest, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
  res.json({ ok: true });
});

apiRouter.put('/settings', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const body = req.body || {};
    const stObj = INDIAN_STATES.find((s) => s.code === body.state_code) || {
      code: body.state_code || '09',
      name: body.state_name || 'Uttar Pradesh',
    };

    db.prepare(
      `UPDATE organizations SET
        business_name = COALESCE(?, business_name),
        legal_name = COALESCE(?, legal_name),
        tagline = COALESCE(?, tagline),
        gst_enabled = ?,
        gstin = ?,
        pan = COALESCE(?, pan),
        state_name = ?,
        state_code = ?,
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        pincode = COALESCE(?, pincode),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        upi_id = COALESCE(?, upi_id),
        upi_payee_name = COALESCE(?, upi_payee_name),
        bank_name = COALESCE(?, bank_name),
        bank_account_no = COALESCE(?, bank_account_no),
        bank_ifsc = COALESCE(?, bank_ifsc),
        bank_branch = COALESCE(?, bank_branch),
        invoice_prefix = COALESCE(?, invoice_prefix),
        non_gst_prefix = COALESCE(?, non_gst_prefix),
        purchase_prefix = COALESCE(?, purchase_prefix),
        default_tax_inclusive = ?,
        terms_and_conditions = COALESCE(?, terms_and_conditions)
       WHERE id = ?`
    ).run(
      body.business_name,
      body.legal_name,
      body.tagline,
      body.gst_enabled ? 1 : 0,
      String(body.gstin || '').trim().toUpperCase(),
      body.pan,
      stObj.name,
      stObj.code,
      body.address,
      body.city,
      body.pincode,
      body.phone,
      body.email,
      body.upi_id ? String(body.upi_id).trim() : null,
      body.upi_payee_name,
      body.bank_name,
      body.bank_account_no,
      body.bank_ifsc,
      body.bank_branch,
      body.invoice_prefix,
      body.non_gst_prefix,
      body.purchase_prefix,
      body.default_tax_inclusive ? 1 : 0,
      body.terms_and_conditions,
      orgId
    );

    const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    res.json({ organization: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings' });
  }
});

apiRouter.patch('/settings/gst-toggle', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const enabled = req.body?.gst_enabled ? 1 : 0;
  db.prepare('UPDATE organizations SET gst_enabled = ? WHERE id = ?').run(enabled, orgId);
  const organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
  res.json({ organization });
});

// ============================================================================
// DASHBOARD OVERVIEW
// ============================================================================

apiRouter.get('/dashboard', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const today = getTodayDate();
  const monthPrefix = today.slice(0, 7); // e.g., 2026-11

  const todaySales = db
    .prepare(
      `SELECT COALESCE(SUM(grand_total), 0) as revenue, COUNT(*) as count
       FROM invoices WHERE org_id = ? AND status = 'ISSUED' AND invoice_date = ?`
    )
    .get(orgId, today) as any;

  const monthSales = db
    .prepare(
      `SELECT
        COALESCE(SUM(grand_total), 0) as revenue,
        COALESCE(SUM(taxable_amount - bill_discount), 0) as net_sales,
        COALESCE(SUM(total_fifo_cost), 0) as fifo_cost,
        COALESCE(SUM(total_tax), 0) as tax_collected,
        COUNT(*) as count
       FROM invoices
       WHERE org_id = ? AND status = 'ISSUED' AND invoice_date LIKE ?`
    )
    .get(orgId, `${monthPrefix}%`) as any;

  const receivables = db
    .prepare(
      `SELECT COALESCE(SUM(current_balance), 0) as total, COUNT(*) as count
       FROM customers WHERE org_id = ? AND current_balance > 0`
    )
    .get(orgId) as any;

  const payables = db
    .prepare(
      `SELECT COALESCE(SUM(current_balance), 0) as total, COUNT(*) as count
       FROM suppliers WHERE org_id = ? AND current_balance > 0`
    )
    .get(orgId) as any;

  const stockValuation = db
    .prepare(
      `SELECT
        COALESCE(SUM(remaining_qty * cost_price), 0) as cost_value,
        COALESCE(SUM(remaining_qty * selling_price), 0) as retail_value,
        COUNT(*) as active_batches
       FROM batches
       WHERE org_id = ? AND remaining_qty > 0 AND status = 'ACTIVE'
         AND (expiry_date = '' OR expiry_date IS NULL OR expiry_date >= ?)`
    )
    .get(orgId, today) as any;

  // Low stock products
  const productsWithStock = db
    .prepare(
      `SELECT p.*,
        COALESCE((
          SELECT SUM(b.remaining_qty) FROM batches b
          WHERE b.product_id = p.id AND b.org_id = p.org_id
            AND b.remaining_qty > 0 AND b.status = 'ACTIVE'
            AND (b.expiry_date = '' OR b.expiry_date IS NULL OR b.expiry_date >= ?)
        ), 0) as available_stock
       FROM products p
       WHERE p.org_id = ? AND p.is_active = 1`
    )
    .all(today, orgId) as any[];

  const lowStockItems = productsWithStock
    .filter((p) => Number(p.available_stock) <= Number(p.reorder_level))
    .sort((a, b) => Number(a.available_stock) - Number(b.available_stock));

  // Expiry radar: expired or expiring within 60 days
  const in60Days = new Date(`${today}T00:00:00Z`);
  in60Days.setUTCDate(in60Days.getUTCDate() + 60);
  const cutoff60 = in60Days.toISOString().slice(0, 10);

  const expiryAlerts = db
    .prepare(
      `SELECT b.*, p.name as product_name, p.sku, p.unit
       FROM batches b
       JOIN products p ON p.id = b.product_id
       WHERE b.org_id = ? AND b.remaining_qty > 0 AND b.status = 'ACTIVE'
         AND b.expiry_date != '' AND b.expiry_date IS NOT NULL
         AND b.expiry_date <= ?
       ORDER BY b.expiry_date ASC`
    )
    .all(orgId, cutoff60) as any[];

  const recentInvoices = db
    .prepare(
      `SELECT * FROM invoices
       WHERE org_id = ?
       ORDER BY invoice_date DESC, id DESC
       LIMIT 8`
    )
    .all(orgId);

  const dailySales = db
    .prepare(
      `SELECT invoice_date as date, SUM(grand_total) as total, COUNT(*) as bills
       FROM invoices
       WHERE org_id = ? AND status = 'ISSUED'
       GROUP BY invoice_date
       ORDER BY invoice_date DESC
       LIMIT 10`
    )
    .all(orgId)
    .reverse();

  res.json({
    today,
    kpis: {
      today_revenue: round2(todaySales.revenue),
      today_bills: todaySales.count,
      month_revenue: round2(monthSales.revenue),
      month_bills: monthSales.count,
      month_gross_profit: round2(Number(monthSales.net_sales) - Number(monthSales.fifo_cost)),
      month_tax_collected: round2(monthSales.tax_collected),
      total_receivables: round2(receivables.total),
      receivable_parties: receivables.count,
      total_payables: round2(payables.total),
      payable_parties: payables.count,
      inventory_fifo_value: round2(stockValuation.cost_value),
      inventory_retail_value: round2(stockValuation.retail_value),
      active_batches: stockValuation.active_batches,
      low_stock_count: lowStockItems.length,
      expiry_alert_count: expiryAlerts.length,
    },
    low_stock_items: lowStockItems.slice(0, 8),
    expiry_alerts: expiryAlerts.slice(0, 8),
    recent_invoices: recentInvoices,
    daily_sales: dailySales,
  });
});

// ============================================================================
// PRODUCTS, BATCHES & FIFO INVENTORY
// ============================================================================

apiRouter.get('/products', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const today = getTodayDate();

  const products = db
    .prepare('SELECT * FROM products WHERE org_id = ? AND is_active = 1 ORDER BY name ASC')
    .all(orgId) as any[];

  const batches = db
    .prepare(
      `SELECT b.*, s.name as supplier_name
       FROM batches b
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.org_id = ?
       ORDER BY b.received_date ASC, b.id ASC`
    )
    .all(orgId) as any[];

  const enriched = products.map((p) => {
    const pBatches = batches.filter((b) => b.product_id === p.id);
    const activeSellable = pBatches.filter(
      (b) =>
        b.status === 'ACTIVE' &&
        Number(b.remaining_qty) > 0 &&
        (!b.expiry_date || b.expiry_date >= today)
    );
    const expiredActive = pBatches.filter(
      (b) =>
        b.status === 'ACTIVE' &&
        Number(b.remaining_qty) > 0 &&
        b.expiry_date &&
        b.expiry_date < today
    );

    const availableStock = round2(
      activeSellable.reduce((sum, b) => sum + Number(b.remaining_qty), 0)
    );
    const expiredStock = round2(
      expiredActive.reduce((sum, b) => sum + Number(b.remaining_qty), 0)
    );
    const fifoNextBatch = activeSellable[0] || null;
    const fifoValue = round2(
      activeSellable.reduce((sum, b) => sum + Number(b.remaining_qty) * Number(b.cost_price), 0)
    );

    return {
      ...p,
      available_stock: availableStock,
      expired_stock: expiredStock,
      active_batch_count: activeSellable.length,
      fifo_value: fifoValue,
      next_fifo_batch: fifoNextBatch,
      batches: pBatches,
    };
  });

  res.json({ products: enriched, today });
});

apiRouter.post('/products', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const b = req.body || {};
    if (!b.name || !b.sku) {
      res.status(400).json({ error: 'Product name and SKU are required' });
      return;
    }

    const nowIso = new Date().toISOString();
    const today = getTodayDate();

    const tx = db.transaction(() => {
      const prodRes = db
        .prepare(
          `INSERT INTO products (
            org_id, sku, barcode, name, category, unit, hsn_code, gst_rate,
            default_cost_price, default_selling_price, default_mrp, default_bv, reorder_level,
            track_expiry, description, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          orgId,
          String(b.sku).trim().toUpperCase(),
          String(b.barcode || '').trim(),
          String(b.name).trim(),
          String(b.category || 'General').trim(),
          String(b.unit || 'PCS').trim().toUpperCase(),
          String(b.hsn_code || '').trim(),
          Number(b.gst_rate || 0),
          Number(b.default_cost_price || 0),
          Number(b.default_selling_price || 0),
          Number(b.default_mrp || b.default_selling_price || 0),
          Math.max(0, round2(Number(b.default_bv || 0))),
          Number(b.reorder_level ?? 10),
          b.track_expiry !== false ? 1 : 0,
          String(b.description || '').trim(),
          nowIso
        );

      const productId = Number(prodRes.lastInsertRowid);

      // Optional initial opening batch!
      const openingQty = Number(b.opening_qty || 0);
      if (openingQty > 0) {
        const batchNo =
          String(b.opening_batch_number || '').trim() ||
          `OPEN-${today.replace(/-/g, '').slice(2)}-${productId}`;
        const cost = Number(b.default_cost_price || 0);
        const mrp = Number(b.default_mrp || b.default_selling_price || 0);
        const sell = Number(b.default_selling_price || mrp);

        const batchRes = db
          .prepare(
            `INSERT INTO batches (
              org_id, product_id, batch_number, mfg_date, expiry_date, received_date,
              cost_price, mrp, selling_price, initial_qty, remaining_qty, status, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'Opening stock batch', ?)`
          )
          .run(
            orgId,
            productId,
            batchNo,
            b.opening_mfg_date || '',
            b.opening_expiry_date || '',
            today,
            cost,
            mrp,
            sell,
            openingQty,
            openingQty,
            nowIso
          );

        db.prepare(
          `INSERT INTO stock_movements (
            org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
            balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
          ) VALUES (?, ?, ?, ?, 'OPENING_STOCK', ?, ?, ?, 'MANUAL', ?, ?, 'Initial opening stock', ?)`
        ).run(
          orgId,
          productId,
          Number(batchRes.lastInsertRowid),
          batchNo,
          openingQty,
          openingQty,
          cost,
          productId,
          batchNo,
          nowIso
        );
      }

      return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    });

    const product = tx();
    res.status(201).json({ product });
  } catch (err: any) {
    if (String(err.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'A product with this SKU already exists' });
      return;
    }
    res.status(400).json({ error: err.message || 'Failed to create product' });
  }
});

apiRouter.put('/products/:id', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const id = Number(req.params.id);
    const b = req.body || {};

    db.prepare(
      `UPDATE products SET
        sku = COALESCE(?, sku),
        barcode = COALESCE(?, barcode),
        name = COALESCE(?, name),
        category = COALESCE(?, category),
        unit = COALESCE(?, unit),
        hsn_code = COALESCE(?, hsn_code),
        gst_rate = COALESCE(?, gst_rate),
        default_cost_price = COALESCE(?, default_cost_price),
        default_selling_price = COALESCE(?, default_selling_price),
        default_mrp = COALESCE(?, default_mrp),
        default_bv = COALESCE(?, default_bv),
        reorder_level = COALESCE(?, reorder_level),
        track_expiry = COALESCE(?, track_expiry),
        description = COALESCE(?, description)
       WHERE id = ? AND org_id = ?`
    ).run(
      b.sku ? String(b.sku).trim().toUpperCase() : null,
      b.barcode !== undefined ? String(b.barcode).trim() : null,
      b.name ? String(b.name).trim() : null,
      b.category ? String(b.category).trim() : null,
      b.unit ? String(b.unit).trim().toUpperCase() : null,
      b.hsn_code !== undefined ? String(b.hsn_code).trim() : null,
      b.gst_rate !== undefined ? Number(b.gst_rate) : null,
      b.default_cost_price !== undefined ? Number(b.default_cost_price) : null,
      b.default_selling_price !== undefined ? Number(b.default_selling_price) : null,
      b.default_mrp !== undefined ? Number(b.default_mrp) : null,
      b.default_bv !== undefined ? Math.max(0, round2(Number(b.default_bv || 0))) : null,
      b.reorder_level !== undefined ? Number(b.reorder_level) : null,
      b.track_expiry !== undefined ? (b.track_expiry ? 1 : 0) : null,
      b.description !== undefined ? String(b.description) : null,
      id,
      orgId
    );

    const product = db.prepare('SELECT * FROM products WHERE id = ? AND org_id = ?').get(id, orgId);
    res.json({ product });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update product' });
  }
});

apiRouter.delete('/products/:id', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const id = Number(req.params.id);
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND org_id = ?').run(id, orgId);
  res.json({ ok: true });
});

apiRouter.get('/batches', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const today = getTodayDate();
  const batches = db
    .prepare(
      `SELECT b.*, p.name as product_name, p.sku, p.unit, p.category, p.track_expiry,
              s.name as supplier_name
       FROM batches b
       JOIN products p ON p.id = b.product_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.org_id = ? AND p.is_active = 1
       ORDER BY b.received_date ASC, b.id ASC`
    )
    .all(orgId);

  res.json({ batches, today });
});

apiRouter.post('/batches', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const b = req.body || {};
    const productId = Number(b.product_id);
    const qty = round2(Number(b.quantity));
    if (!productId || qty <= 0) {
      res.status(400).json({ error: 'Product and valid quantity are required' });
      return;
    }

    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND org_id = ?')
      .get(productId, orgId) as any;
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const nowIso = new Date().toISOString();
    const receivedDate = b.received_date || getTodayDate();
    const batchNumber =
      String(b.batch_number || '').trim() ||
      `BCH-${receivedDate.replace(/-/g, '').slice(2)}-${Math.floor(100 + Math.random() * 900)}`;

    const cost = b.cost_price !== undefined ? Number(b.cost_price) : Number(product.default_cost_price);
    const mrp = b.mrp !== undefined ? Number(b.mrp) : Number(product.default_mrp);
    const sell =
      b.selling_price !== undefined ? Number(b.selling_price) : Number(product.default_selling_price);

    const tx = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO batches (
            org_id, product_id, batch_number, mfg_date, expiry_date, received_date,
            cost_price, mrp, selling_price, initial_qty, remaining_qty, status, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
        )
        .run(
          orgId,
          productId,
          batchNumber,
          b.mfg_date || '',
          b.expiry_date || '',
          receivedDate,
          cost,
          mrp,
          sell,
          qty,
          qty,
          b.notes || 'Manual stock-in batch',
          nowIso
        );

      const batchId = Number(r.lastInsertRowid);
      const stockAfter = getProductTotalStock(orgId, productId);
      db.prepare(
        `INSERT INTO stock_movements (
          org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
          balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
        ) VALUES (?, ?, ?, ?, 'OPENING_STOCK', ?, ?, ?, 'MANUAL', ?, ?, ?, ?)`
      ).run(
        orgId,
        productId,
        batchId,
        batchNumber,
        qty,
        stockAfter,
        cost,
        batchId,
        batchNumber,
        b.notes || 'Manual batch added',
        nowIso
      );

      return db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    });

    res.status(201).json({ batch: tx() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add batch' });
  }
});

apiRouter.put('/batches/:id', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const id = Number(req.params.id);
    const b = req.body || {};

    db.prepare(
      `UPDATE batches SET
        batch_number = COALESCE(?, batch_number),
        mfg_date = COALESCE(?, mfg_date),
        expiry_date = COALESCE(?, expiry_date),
        cost_price = COALESCE(?, cost_price),
        mrp = COALESCE(?, mrp),
        selling_price = COALESCE(?, selling_price),
        notes = COALESCE(?, notes)
       WHERE id = ? AND org_id = ?`
    ).run(
      b.batch_number || null,
      b.mfg_date !== undefined ? b.mfg_date : null,
      b.expiry_date !== undefined ? b.expiry_date : null,
      b.cost_price !== undefined ? Number(b.cost_price) : null,
      b.mrp !== undefined ? Number(b.mrp) : null,
      b.selling_price !== undefined ? Number(b.selling_price) : null,
      b.notes !== undefined ? b.notes : null,
      id,
      orgId
    );

    const batch = db.prepare('SELECT * FROM batches WHERE id = ? AND org_id = ?').get(id, orgId);
    res.json({ batch });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update batch' });
  }
});

apiRouter.post('/batches/:id/adjust', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const batchId = Number(req.params.id);
    const batch = adjustBatchStock(orgId, {
      batch_id: batchId,
      adjustment_type: req.body?.adjustment_type || 'ADJUSTMENT_OUT',
      quantity: Number(req.body?.quantity || 0),
      notes: req.body?.notes || '',
    });
    res.json({ batch });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Stock adjustment failed' });
  }
});

apiRouter.post('/fifo/preview', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const asOfDate = req.body?.invoice_date || getTodayDate();

    const previews = items.map((it: any) => ({
      product_id: Number(it.product_id),
      ...previewFifoAllocation(
        orgId,
        Number(it.product_id),
        Number(it.quantity || 0),
        asOfDate,
        it.preferred_batch_id ? Number(it.preferred_batch_id) : null
      ),
    }));
    res.json({ previews });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to preview FIFO allocation' });
  }
});

// ============================================================================
// HSN / SAC DIRECTORY
// ============================================================================

apiRouter.get('/hsn', (req: AuthedRequest, res) => {
  const hsnCodes = db
    .prepare('SELECT * FROM hsn_codes WHERE org_id = ? ORDER BY code ASC')
    .all(req.user!.org_id);
  res.json({ hsn_codes: hsnCodes });
});

apiRouter.post('/hsn/import-defaults', (req: AuthedRequest, res) => {
  seedDefaultHsnForOrg(req.user!.org_id);
  const hsnCodes = db
    .prepare('SELECT * FROM hsn_codes WHERE org_id = ? ORDER BY code ASC')
    .all(req.user!.org_id);
  res.json({ hsn_codes: hsnCodes });
});

apiRouter.post('/hsn', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const { code, description, gst_rate, cess_rate, category } = req.body || {};
    if (!code || !description) {
      res.status(400).json({ error: 'HSN/SAC code and description are required' });
      return;
    }
    const r = db
      .prepare(
        `INSERT INTO hsn_codes (org_id, code, description, gst_rate, cess_rate, category)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        orgId,
        String(code).trim(),
        String(description).trim(),
        Number(gst_rate ?? 18),
        Number(cess_rate ?? 0),
        category === 'SERVICES' ? 'SERVICES' : 'GOODS'
      );
    const created = db.prepare('SELECT * FROM hsn_codes WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ hsn: created });
  } catch (err: any) {
    if (String(err.message).includes('UNIQUE')) {
      res.status(409).json({ error: 'HSN/SAC code already exists in directory' });
      return;
    }
    res.status(400).json({ error: err.message || 'Failed to add HSN code' });
  }
});

apiRouter.put('/hsn/:id', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const id = Number(req.params.id);
    const { code, description, gst_rate, cess_rate, category } = req.body || {};
    db.prepare(
      `UPDATE hsn_codes SET
        code = COALESCE(?, code),
        description = COALESCE(?, description),
        gst_rate = COALESCE(?, gst_rate),
        cess_rate = COALESCE(?, cess_rate),
        category = COALESCE(?, category)
       WHERE id = ? AND org_id = ?`
    ).run(
      code ? String(code).trim() : null,
      description ? String(description).trim() : null,
      gst_rate !== undefined ? Number(gst_rate) : null,
      cess_rate !== undefined ? Number(cess_rate) : null,
      category || null,
      id,
      orgId
    );
    const updated = db.prepare('SELECT * FROM hsn_codes WHERE id = ? AND org_id = ?').get(id, orgId);
    res.json({ hsn: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update HSN code' });
  }
});

apiRouter.delete('/hsn/:id', (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM hsn_codes WHERE id = ? AND org_id = ?').run(
    Number(req.params.id),
    req.user!.org_id
  );
  res.json({ ok: true });
});

// ============================================================================
// CUSTOMERS / CLIENTS CRUD
// ============================================================================

apiRouter.get('/customers', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const customers = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED') as invoice_count,
        COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_billed,
        COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as earned_bv,
        c.opening_bv + COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_bv
       FROM customers c
       WHERE c.org_id = ?
       ORDER BY c.name ASC`
    )
    .all(orgId);
  res.json({ customers });
});

apiRouter.post('/customers', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const b = req.body || {};
    if (!b.name) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }
    const stObj = INDIAN_STATES.find((s) => s.code === b.state_code) || {
      code: '09',
      name: 'Uttar Pradesh',
    };
    const opening = round2(Number(b.opening_balance || 0));
    const openingBv = Math.max(0, round2(Number(b.opening_bv || 0)));
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO customers (
            org_id, name, customer_type, phone, email, gstin, state_name, state_code,
            address, credit_limit, opening_balance, current_balance, opening_bv, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orgId,
          String(b.name).trim(),
          b.customer_type === 'B2B' ? 'B2B' : 'B2C',
          String(b.phone || '').trim(),
          String(b.email || '').trim(),
          String(b.gstin || '').trim().toUpperCase(),
          stObj.name,
          stObj.code,
          String(b.address || '').trim(),
          Number(b.credit_limit ?? 25000),
          opening,
          opening,
          openingBv,
          String(b.notes || '').trim(),
          nowIso
        );

      const custId = Number(r.lastInsertRowid);
      if (opening !== 0) {
        db.prepare(
          `INSERT INTO ledger_entries (
            org_id, party_type, party_id, entry_date, entry_type, voucher_no,
            debit, credit, balance_after, narration, created_at
          ) VALUES (?, 'CUSTOMER', ?, ?, 'OPENING', 'OPEN-BAL', ?, ?, ?, 'Opening balance brought forward', ?)`
        ).run(
          orgId,
          custId,
          getTodayDate(),
          opening > 0 ? opening : 0,
          opening < 0 ? Math.abs(opening) : 0,
          opening,
          nowIso
        );
      }
      return db
        .prepare(
          `SELECT c.*, 0 as invoice_count, 0 as total_billed, 0 as earned_bv, c.opening_bv as total_bv
           FROM customers c WHERE c.id = ?`
        )
        .get(custId);
    });

    res.status(201).json({ customer: tx() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add customer' });
  }
});

apiRouter.put('/customers/:id', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const id = Number(req.params.id);
    const b = req.body || {};
    const stObj = INDIAN_STATES.find((s) => s.code === b.state_code);

    db.prepare(
      `UPDATE customers SET
        name = COALESCE(?, name),
        customer_type = COALESCE(?, customer_type),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        gstin = COALESCE(?, gstin),
        state_name = COALESCE(?, state_name),
        state_code = COALESCE(?, state_code),
        address = COALESCE(?, address),
        credit_limit = COALESCE(?, credit_limit),
        opening_bv = COALESCE(?, opening_bv),
        notes = COALESCE(?, notes)
       WHERE id = ? AND org_id = ?`
    ).run(
      b.name ? String(b.name).trim() : null,
      b.customer_type || null,
      b.phone !== undefined ? String(b.phone).trim() : null,
      b.email !== undefined ? String(b.email).trim() : null,
      b.gstin !== undefined ? String(b.gstin).trim().toUpperCase() : null,
      stObj ? stObj.name : null,
      stObj ? stObj.code : null,
      b.address !== undefined ? String(b.address).trim() : null,
      b.credit_limit !== undefined ? Number(b.credit_limit) : null,
      b.opening_bv !== undefined ? Math.max(0, round2(Number(b.opening_bv || 0))) : null,
      b.notes !== undefined ? String(b.notes).trim() : null,
      id,
      orgId
    );
    const customer = db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED') as invoice_count,
          COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_billed,
          COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as earned_bv,
          c.opening_bv + COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_bv
         FROM customers c WHERE c.id = ? AND c.org_id = ?`
      )
      .get(id, orgId);
    res.json({ customer });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update customer' });
  }
});

apiRouter.delete('/customers/:id', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const id = Number(req.params.id);
  const linked = db
    .prepare('SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND org_id = ?')
    .get(id, orgId) as { count: number };
  if (linked.count > 0) {
    res.status(400).json({
      error: `Cannot delete customer with ${linked.count} historical invoice(s). Ledger records must be preserved.`,
    });
    return;
  }
  db.prepare("DELETE FROM ledger_entries WHERE party_type = 'CUSTOMER' AND party_id = ? AND org_id = ?").run(
    id,
    orgId
  );
  db.prepare('DELETE FROM customers WHERE id = ? AND org_id = ?').run(id, orgId);
  res.json({ ok: true });
});

// ============================================================================
// SUPPLIERS & PURCHASES CRUD
// ============================================================================

apiRouter.get('/suppliers', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const suppliers = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'ACTIVE') as purchase_count,
        COALESCE((SELECT SUM(p.grand_total) FROM purchases p WHERE p.supplier_id = s.id AND p.status = 'ACTIVE'), 0) as total_purchased
       FROM suppliers s
       WHERE s.org_id = ?
       ORDER BY s.name ASC`
    )
    .all(orgId);
  res.json({ suppliers });
});

apiRouter.post('/suppliers', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const b = req.body || {};
    if (!b.name) {
      res.status(400).json({ error: 'Supplier name is required' });
      return;
    }
    const stObj = INDIAN_STATES.find((s) => s.code === b.state_code) || {
      code: '09',
      name: 'Uttar Pradesh',
    };
    const opening = round2(Number(b.opening_balance || 0));
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO suppliers (
            org_id, name, contact_person, phone, email, gstin, state_name, state_code,
            address, upi_id, bank_details, opening_balance, current_balance, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orgId,
          String(b.name).trim(),
          String(b.contact_person || '').trim(),
          String(b.phone || '').trim(),
          String(b.email || '').trim(),
          String(b.gstin || '').trim().toUpperCase(),
          stObj.name,
          stObj.code,
          String(b.address || '').trim(),
          String(b.upi_id || '').trim(),
          String(b.bank_details || '').trim(),
          opening,
          opening,
          String(b.notes || '').trim(),
          nowIso
        );

      const supId = Number(r.lastInsertRowid);
      if (opening !== 0) {
        db.prepare(
          `INSERT INTO ledger_entries (
            org_id, party_type, party_id, entry_date, entry_type, voucher_no,
            debit, credit, balance_after, narration, created_at
          ) VALUES (?, 'SUPPLIER', ?, ?, 'OPENING', 'OPEN-BAL', ?, ?, ?, 'Opening payable brought forward', ?)`
        ).run(
          orgId,
          supId,
          getTodayDate(),
          opening < 0 ? Math.abs(opening) : 0,
          opening > 0 ? opening : 0,
          opening,
          nowIso
        );
      }
      return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supId);
    });

    res.status(201).json({ supplier: tx() });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add supplier' });
  }
});

apiRouter.put('/suppliers/:id', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const id = Number(req.params.id);
    const b = req.body || {};
    const stObj = INDIAN_STATES.find((s) => s.code === b.state_code);

    db.prepare(
      `UPDATE suppliers SET
        name = COALESCE(?, name),
        contact_person = COALESCE(?, contact_person),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        gstin = COALESCE(?, gstin),
        state_name = COALESCE(?, state_name),
        state_code = COALESCE(?, state_code),
        address = COALESCE(?, address),
        upi_id = COALESCE(?, upi_id),
        bank_details = COALESCE(?, bank_details),
        notes = COALESCE(?, notes)
       WHERE id = ? AND org_id = ?`
    ).run(
      b.name ? String(b.name).trim() : null,
      b.contact_person !== undefined ? String(b.contact_person).trim() : null,
      b.phone !== undefined ? String(b.phone).trim() : null,
      b.email !== undefined ? String(b.email).trim() : null,
      b.gstin !== undefined ? String(b.gstin).trim().toUpperCase() : null,
      stObj ? stObj.name : null,
      stObj ? stObj.code : null,
      b.address !== undefined ? String(b.address).trim() : null,
      b.upi_id !== undefined ? String(b.upi_id).trim() : null,
      b.bank_details !== undefined ? String(b.bank_details).trim() : null,
      b.notes !== undefined ? String(b.notes).trim() : null,
      id,
      orgId
    );
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?').get(id, orgId);
    res.json({ supplier });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update supplier' });
  }
});

apiRouter.delete('/suppliers/:id', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const id = Number(req.params.id);
  const linked = db
    .prepare('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ? AND org_id = ?')
    .get(id, orgId) as { count: number };
  if (linked.count > 0) {
    res.status(400).json({
      error: `Cannot delete supplier with ${linked.count} historical purchase bill(s).`,
    });
    return;
  }
  db.prepare("DELETE FROM ledger_entries WHERE party_type = 'SUPPLIER' AND party_id = ? AND org_id = ?").run(
    id,
    orgId
  );
  db.prepare('DELETE FROM suppliers WHERE id = ? AND org_id = ?').run(id, orgId);
  res.json({ ok: true });
});

apiRouter.get('/purchases', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const purchases = db
    .prepare(
      `SELECT p.*, s.name as supplier_name, s.gstin as supplier_gstin, s.upi_id as supplier_upi_id,
              s.phone as supplier_phone, s.state_name as supplier_state
       FROM purchases p
       JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.org_id = ?
       ORDER BY p.purchase_date DESC, p.id DESC`
    )
    .all(orgId) as any[];

  const items = db
    .prepare(
      `SELECT pi.*, pr.name as product_name, pr.sku, pr.unit
       FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id
       JOIN products pr ON pr.id = pi.product_id
       WHERE pu.org_id = ?
       ORDER BY pi.id ASC`
    )
    .all(orgId) as any[];

  const enriched = purchases.map((p) => ({
    ...p,
    items: items.filter((i) => i.purchase_id === p.id),
  }));

  res.json({ purchases: enriched });
});

apiRouter.get('/purchases/:id', (req: AuthedRequest, res) => {
  const purchase = getFullPurchaseById(req.user!.org_id, Number(req.params.id));
  if (!purchase) {
    res.status(404).json({ error: 'Purchase bill not found' });
    return;
  }
  res.json({ purchase });
});

apiRouter.post('/purchases', (req: AuthedRequest, res) => {
  try {
    const purchase = createPurchaseBill(req.user!.org_id, req.body);
    res.status(201).json({ purchase });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to record purchase bill' });
  }
});

// ============================================================================
// BILLING / INVOICES & HAND-TO-HAND UPI QR
// ============================================================================

apiRouter.post('/qr/generate', (req: AuthedRequest, res) => {
  const org = db
    .prepare('SELECT * FROM organizations WHERE id = ?')
    .get(req.user!.org_id) as any;

  const amount = round2(Number(req.body?.amount || 0));
  const customUpi = req.body?.upi_id ? String(req.body.upi_id).trim() : org.upi_id;
  const customPayee = req.body?.payee_name
    ? String(req.body.payee_name).trim()
    : org.upi_payee_name || org.business_name;
  const note = req.body?.note || `Bill Payment - ${org.business_name}`;
  const ref = req.body?.ref || `KB${Date.now().toString().slice(-8)}`;

  const upiUri = buildUpiPaymentUri({
    upiId: customUpi,
    payeeName: customPayee,
    amount,
    note,
    transactionRef: ref,
  });

  res.json({
    upi_uri: upiUri,
    upi_id: customUpi,
    payee_name: customPayee,
    amount,
    ref,
  });
});

apiRouter.get('/invoices', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const invoices = db
    .prepare(
      `SELECT * FROM invoices
       WHERE org_id = ?
       ORDER BY invoice_date DESC, id DESC`
    )
    .all(orgId) as any[];

  const allItems = db
    .prepare(
      `SELECT ii.*
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.org_id = ?
       ORDER BY ii.id ASC`
    )
    .all(orgId) as any[];

  const allSlices = db
    .prepare(
      `SELECT iib.*
       FROM invoice_item_batches iib
       JOIN invoices i ON i.id = iib.invoice_id
       WHERE i.org_id = ?
       ORDER BY iib.id ASC`
    )
    .all(orgId) as any[];

  const enriched = invoices.map((inv) => {
    const invItems = allItems
      .filter((it) => it.invoice_id === inv.id)
      .map((it) => ({
        ...it,
        batches: allSlices.filter((s) => s.invoice_item_id === it.id),
      }));
    return {
      ...inv,
      items: invItems,
    };
  });

  res.json({ invoices: enriched });
});

apiRouter.get('/invoices/:id', (req: AuthedRequest, res) => {
  const invoice = getFullInvoiceById(req.user!.org_id, Number(req.params.id));
  if (!invoice) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  res.json({ invoice });
});

apiRouter.post('/invoices', (req: AuthedRequest, res) => {
  try {
    const invoice = createInvoiceWithFifo(req.user!.org_id, req.body);
    res.status(201).json({ invoice });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to issue bill' });
  }
});

apiRouter.post('/invoices/:id/settle', (req: AuthedRequest, res) => {
  try {
    const invoice = settleInvoiceDue(req.user!.org_id, Number(req.params.id), {
      amount: Number(req.body?.amount || 0),
      payment_mode: req.body?.payment_mode || 'UPI_QR',
      payment_ref: req.body?.payment_ref || '',
      entry_date: req.body?.entry_date,
    });
    res.json({ invoice });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to settle invoice' });
  }
});

apiRouter.patch('/invoices/:id/bv-visibility', (req: AuthedRequest, res) => {
  try {
    const orgId = req.user!.org_id;
    const invoiceId = Number(req.params.id);
    const show = req.body?.show_bv_on_bill ? 1 : 0;
    const existing = db
      .prepare('SELECT id FROM invoices WHERE id = ? AND org_id = ?')
      .get(invoiceId, orgId);
    if (!existing) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    db.prepare('UPDATE invoices SET show_bv_on_bill = ? WHERE id = ? AND org_id = ?').run(
      show,
      invoiceId,
      orgId
    );
    const invoice = getFullInvoiceById(orgId, invoiceId);
    res.json({ invoice });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update BV visibility' });
  }
});

apiRouter.post('/invoices/:id/cancel', (req: AuthedRequest, res) => {
  try {
    const invoice = cancelInvoice(req.user!.org_id, Number(req.params.id));
    res.json({ invoice });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to cancel invoice' });
  }
});

// ============================================================================
// LEDGERS (CUSTOMER RECEIVABLES & SUPPLIER PAYABLES)
// ============================================================================

apiRouter.get('/ledgers/summary', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const customers = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED') as invoice_count,
        COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_billed,
        COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as earned_bv,
        c.opening_bv + COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_bv
       FROM customers c
       WHERE c.org_id = ?
       ORDER BY c.current_balance DESC, c.name ASC`
    )
    .all(orgId);
  const suppliers = db
    .prepare('SELECT * FROM suppliers WHERE org_id = ? ORDER BY current_balance DESC, name ASC')
    .all(orgId);
  const recentEntries = db
    .prepare(
      `SELECT le.*,
        CASE
          WHEN le.party_type = 'CUSTOMER' THEN (SELECT name FROM customers WHERE id = le.party_id)
          ELSE (SELECT name FROM suppliers WHERE id = le.party_id)
        END as party_name
       FROM ledger_entries le
       WHERE le.org_id = ?
       ORDER BY le.entry_date DESC, le.id DESC
       LIMIT 30`
    )
    .all(orgId);

  res.json({ customers, suppliers, recent_entries: recentEntries });
});

apiRouter.get('/ledgers/:partyType/:partyId', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const partyType = String(req.params.partyType).toUpperCase() === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER';
  const partyId = Number(req.params.partyId);

  const party =
    partyType === 'CUSTOMER'
      ? db
          .prepare(
            `SELECT c.*,
              (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED') as invoice_count,
              COALESCE((SELECT SUM(i.grand_total) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_billed,
              COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as earned_bv,
              c.opening_bv + COALESCE((SELECT SUM(i.total_bv) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'ISSUED'), 0) as total_bv
             FROM customers c WHERE c.id = ? AND c.org_id = ?`
          )
          .get(partyId, orgId)
      : db.prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?').get(partyId, orgId);

  if (!party) {
    res.status(404).json({ error: `${partyType} not found` });
    return;
  }

  const rawEntries = db
    .prepare(
      `SELECT * FROM ledger_entries
       WHERE org_id = ? AND party_type = ? AND party_id = ?
       ORDER BY entry_date ASC, id ASC`
    )
    .all(orgId, partyType, partyId) as any[];

  // Enrich INVOICE & PURCHASE entries with linked bill metadata + line items
  let entries = rawEntries;
  if (partyType === 'CUSTOMER') {
    const invoiceIds = Array.from(
      new Set(rawEntries.map((e) => e.reference_id).filter((id): id is number => Boolean(id)))
    );
    const invMap = new Map<number, any>();
    const itemsByInv = new Map<number, any[]>();

    if (invoiceIds.length > 0) {
      const placeholders = invoiceIds.map(() => '?').join(',');
      const invRows = db
        .prepare(
          `SELECT id, invoice_number, invoice_date, is_gst, grand_total, total_tax,
                  total_bv, show_bv_on_bill, payment_status, status
           FROM invoices WHERE org_id = ? AND id IN (${placeholders})`
        )
        .all(orgId, ...invoiceIds) as any[];
      for (const inv of invRows) invMap.set(inv.id, inv);

      const itemRows = db
        .prepare(
          `SELECT id, invoice_id, product_id, product_name, sku, unit, quantity,
                  unit_price, discount_percent, discount_amount, gst_rate, line_total,
                  bv_per_unit, bv_included, line_bv_total, batch_summary, expiry_summary
           FROM invoice_items
           WHERE invoice_id IN (${placeholders})
           ORDER BY id ASC`
        )
        .all(...invoiceIds) as any[];
      for (const it of itemRows) {
        const arr = itemsByInv.get(it.invoice_id) || [];
        arr.push(it);
        itemsByInv.set(it.invoice_id, arr);
      }
    }

    entries = rawEntries.map((e) => {
      const refId = e.reference_id ? Number(e.reference_id) : null;
      const inv = refId ? invMap.get(refId) : null;
      if (e.entry_type === 'INVOICE' && inv) {
        const vItems = itemsByInv.get(inv.id) || [];
        return {
          ...e,
          linked_invoice_id: inv.id,
          voucher_meta: {
            kind: 'INVOICE',
            id: inv.id,
            voucher_number: inv.invoice_number,
            voucher_date: inv.invoice_date,
            is_gst: inv.is_gst,
            grand_total: inv.grand_total,
            total_tax: inv.total_tax,
            total_bv: inv.total_bv,
            payment_status: inv.payment_status,
            status: inv.status,
            item_count: vItems.length,
          },
          voucher_items: vItems,
        };
      }
      if ((e.entry_type === 'RECEIPT' || e.entry_type === 'INVOICE_CANCEL') && inv) {
        return {
          ...e,
          linked_invoice_id: inv.id,
        };
      }
      return e;
    });
  } else {
    const purchaseIds = Array.from(
      new Set(rawEntries.map((e) => e.reference_id).filter((id): id is number => Boolean(id)))
    );
    const purMap = new Map<number, any>();
    const itemsByPur = new Map<number, any[]>();

    if (purchaseIds.length > 0) {
      const placeholders = purchaseIds.map(() => '?').join(',');
      const purRows = db
        .prepare(
          `SELECT id, purchase_number, supplier_invoice_no, purchase_date, is_gst,
                  grand_total, total_tax, payment_status, status
           FROM purchases WHERE org_id = ? AND id IN (${placeholders})`
        )
        .all(orgId, ...purchaseIds) as any[];
      for (const p of purRows) purMap.set(p.id, p);

      const itemRows = db
        .prepare(
          `SELECT pi.id, pi.purchase_id, pi.product_id, pr.name as product_name, pr.sku, pr.unit,
                  pi.batch_number, pi.expiry_date, pi.quantity, pi.free_qty,
                  pi.cost_price, pi.discount_amount, pi.gst_rate, pi.line_total
           FROM purchase_items pi
           JOIN products pr ON pr.id = pi.product_id
           WHERE pi.purchase_id IN (${placeholders})
           ORDER BY pi.id ASC`
        )
        .all(...purchaseIds) as any[];
      for (const it of itemRows) {
        const arr = itemsByPur.get(it.purchase_id) || [];
        arr.push(it);
        itemsByPur.set(it.purchase_id, arr);
      }
    }

    entries = rawEntries.map((e) => {
      const refId = e.reference_id ? Number(e.reference_id) : null;
      const pur = refId ? purMap.get(refId) : null;
      if (e.entry_type === 'PURCHASE' && pur) {
        const vItems = itemsByPur.get(pur.id) || [];
        return {
          ...e,
          linked_purchase_id: pur.id,
          voucher_meta: {
            kind: 'PURCHASE',
            id: pur.id,
            voucher_number: pur.purchase_number,
            supplier_invoice_no: pur.supplier_invoice_no,
            voucher_date: pur.purchase_date,
            is_gst: pur.is_gst,
            grand_total: pur.grand_total,
            total_tax: pur.total_tax,
            payment_status: pur.payment_status,
            status: pur.status,
            item_count: vItems.length,
          },
          voucher_items: vItems,
        };
      }
      if (e.entry_type === 'PAYMENT_OUT' && pur) {
        return {
          ...e,
          linked_purchase_id: pur.id,
        };
      }
      return e;
    });
  }

  res.json({ party_type: partyType, party, entries });
});

apiRouter.post('/ledgers/payment', (req: AuthedRequest, res) => {
  try {
    const result = recordPartyLedgerPayment(req.user!.org_id, {
      party_type: req.body?.party_type === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER',
      party_id: Number(req.body?.party_id),
      amount: Number(req.body?.amount),
      payment_mode: req.body?.payment_mode || 'UPI_QR',
      payment_ref: req.body?.payment_ref || '',
      entry_date: req.body?.entry_date,
      narration: req.body?.narration || '',
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to record ledger payment' });
  }
});

// ============================================================================
// REPORTS: SALES, GST/HSN, INVENTORY MOVEMENTS & EXPIRY
// ============================================================================

apiRouter.get('/reports', (req: AuthedRequest, res) => {
  const orgId = req.user!.org_id;
  const today = getTodayDate();
  const from = String(req.query.from || `${today.slice(0, 7)}-01`);
  const to = String(req.query.to || today);

  // 1. Sales & Profitability Summary
  const salesSummary = db
    .prepare(
      `SELECT
        COUNT(*) as invoice_count,
        COALESCE(SUM(grand_total), 0) as gross_revenue,
        COALESCE(SUM(taxable_amount - bill_discount), 0) as net_taxable_sales,
        COALESCE(SUM(total_tax), 0) as total_gst_collected,
        COALESCE(SUM(cgst_amount), 0) as total_cgst,
        COALESCE(SUM(sgst_amount), 0) as total_sgst,
        COALESCE(SUM(igst_amount), 0) as total_igst,
        COALESCE(SUM(total_fifo_cost), 0) as fifo_cogs,
        COALESCE(SUM(total_bv), 0) as total_bv_generated,
        COALESCE(SUM(amount_paid), 0) as total_collected,
        COALESCE(SUM(balance_due), 0) as total_credit_pending
       FROM invoices
       WHERE org_id = ? AND status = 'ISSUED' AND invoice_date >= ? AND invoice_date <= ?`
    )
    .get(orgId, from, to) as any;

  const paymentBreakdown = db
    .prepare(
      `SELECT payment_mode, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total
       FROM invoices
       WHERE org_id = ? AND status = 'ISSUED' AND invoice_date >= ? AND invoice_date <= ?
       GROUP BY payment_mode
       ORDER BY total DESC`
    )
    .all(orgId, from, to);

  const topProducts = db
    .prepare(
      `SELECT
        ii.product_id, ii.product_name, ii.sku, ii.unit,
        GROUP_CONCAT(DISTINCT i.customer_name) as customer_names,
        COUNT(DISTINCT i.id) as invoice_count,
        SUM(ii.quantity) as qty_sold,
        SUM(ii.taxable_amount) as net_revenue,
        SUM(ii.line_total) as gross_revenue,
        SUM(ii.fifo_cost_total) as fifo_cost,
        SUM(ii.taxable_amount - ii.fifo_cost_total) as gross_profit,
        SUM(ii.line_bv_total) as total_bv
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       GROUP BY ii.product_id
       ORDER BY gross_revenue DESC`
    )
    .all(orgId, from, to);

  // Itemized Sales Register WITH Customer Name alongside sold items
  const itemizedSales = db
    .prepare(
      `SELECT
        ii.id as item_row_id,
        i.id as invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.customer_id,
        i.customer_name,
        i.customer_phone,
        i.payment_mode,
        i.payment_status,
        ii.product_id,
        ii.product_name,
        ii.sku,
        ii.unit,
        ii.quantity,
        ii.unit_price,
        ii.discount_amount,
        ii.taxable_amount,
        (ii.cgst_amount + ii.sgst_amount + ii.igst_amount) as tax_amount,
        ii.line_total,
        ii.fifo_cost_total,
        (ii.taxable_amount - ii.fifo_cost_total) as gross_profit,
        ii.bv_per_unit,
        ii.bv_included,
        ii.line_bv_total,
        ii.batch_summary
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       ORDER BY i.invoice_date DESC, i.id DESC, ii.id ASC`
    )
    .all(orgId, from, to);

  // Invoice-level Sales Register with Customer Name + Items Summary
  const salesInvoices = db
    .prepare(
      `SELECT
        i.id as invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.customer_id,
        i.customer_name,
        i.customer_phone,
        i.is_gst,
        i.taxable_amount,
        i.total_tax,
        i.grand_total,
        i.total_fifo_cost,
        (i.taxable_amount - i.bill_discount - i.total_fifo_cost) as gross_profit,
        i.total_bv,
        i.show_bv_on_bill,
        i.payment_mode,
        i.payment_status,
        (SELECT GROUP_CONCAT(ii.product_name || ' (' || ii.quantity || ' ' || ii.unit || ')', ', ')
         FROM invoice_items ii WHERE ii.invoice_id = i.id) as items_summary
       FROM invoices i
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       ORDER BY i.invoice_date DESC, i.id DESC`
    )
    .all(orgId, from, to);

  // Dedicated BV (Business Value) Analytics Suite (3 Views: Customer, Invoice, Product)
  const bvSummaryRow = db
    .prepare(
      `SELECT
        COALESCE(SUM(i.total_bv), 0) as total_bv_earned,
        COUNT(CASE WHEN i.total_bv > 0 THEN 1 END) as bv_invoices_count,
        COUNT(DISTINCT CASE WHEN i.total_bv > 0 THEN COALESCE(CAST(i.customer_id AS TEXT), i.customer_name) END) as unique_customers_with_bv
       FROM invoices i
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?`
    )
    .get(orgId, from, to) as any;

  const bvItemStats = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN ii.bv_included = 1 AND ii.bv_per_unit > 0 THEN ii.quantity ELSE 0 END), 0) as total_bv_units,
        COUNT(CASE WHEN ii.bv_included = 0 AND ii.bv_per_unit > 0 THEN 1 END) as lines_with_bv_removed
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?`
    )
    .get(orgId, from, to) as any;

  const bvByCustomer = db
    .prepare(
      `SELECT
        i.customer_id,
        CASE WHEN i.customer_id IS NOT NULL THEN COALESCE(c.name, i.customer_name) ELSE i.customer_name END as customer_name,
        CASE WHEN i.customer_id IS NOT NULL THEN COALESCE(c.phone, i.customer_phone) ELSE i.customer_phone END as customer_phone,
        COUNT(DISTINCT i.id) as invoice_count,
        COALESCE((
          SELECT SUM(ii.quantity)
          FROM invoice_items ii
          JOIN invoices inv2 ON inv2.id = ii.invoice_id
          WHERE inv2.org_id = ? AND inv2.status = 'ISSUED'
            AND inv2.invoice_date >= ? AND inv2.invoice_date <= ?
            AND (
              (i.customer_id IS NOT NULL AND inv2.customer_id = i.customer_id)
              OR (i.customer_id IS NULL AND inv2.customer_id IS NULL AND inv2.customer_name = i.customer_name)
            )
        ), 0) as total_qty,
        COALESCE(SUM(i.total_bv), 0) as period_bv,
        CASE
          WHEN i.customer_id IS NOT NULL THEN
            COALESCE(c.opening_bv, 0) + COALESCE((
              SELECT SUM(inv3.total_bv) FROM invoices inv3
              WHERE inv3.customer_id = i.customer_id AND inv3.org_id = i.org_id AND inv3.status = 'ISSUED'
            ), 0)
          ELSE COALESCE(SUM(i.total_bv), 0)
        END as lifetime_total_bv,
        COALESCE(SUM(i.grand_total), 0) as monetary_spend
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       GROUP BY COALESCE(CAST(i.customer_id AS TEXT), 'WALKIN:' || i.customer_name)
       ORDER BY period_bv DESC, monetary_spend DESC`
    )
    .all(orgId, from, to, orgId, from, to);

  const bvByInvoice = db
    .prepare(
      `SELECT
        i.id as invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.customer_id,
        i.customer_name,
        i.customer_phone,
        i.total_bv,
        i.show_bv_on_bill,
        i.grand_total,
        (SELECT GROUP_CONCAT(
          ii.product_name || ' ×' || ii.quantity ||
          CASE
            WHEN ii.bv_included = 0 AND ii.bv_per_unit > 0 THEN ' [BV Off]'
            WHEN ii.line_bv_total > 0 THEN ' [' || ii.line_bv_total || ' BV]'
            ELSE ''
          END,
          ', '
        ) FROM invoice_items ii WHERE ii.invoice_id = i.id) as items_bv_summary,
        (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.bv_included = 1 AND ii.line_bv_total > 0) as included_lines,
        (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.bv_included = 0 AND ii.bv_per_unit > 0) as excluded_lines
       FROM invoices i
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       ORDER BY i.invoice_date DESC, i.id DESC`
    )
    .all(orgId, from, to);

  const bvByProduct = db
    .prepare(
      `SELECT
        ii.product_id,
        ii.product_name,
        ii.sku,
        ii.unit,
        COALESCE(p.default_bv, 0) as catalog_default_bv,
        GROUP_CONCAT(DISTINCT i.customer_name) as customer_names,
        SUM(ii.quantity) as total_qty_sold,
        SUM(CASE WHEN ii.bv_included = 1 AND ii.bv_per_unit > 0 THEN ii.quantity ELSE 0 END) as bv_eligible_qty,
        SUM(CASE WHEN ii.bv_included = 0 AND ii.bv_per_unit > 0 THEN ii.quantity ELSE 0 END) as bv_removed_qty,
        SUM(ii.line_bv_total) as total_bv_generated,
        SUM(ii.line_total) as monetary_sales
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.id = ii.product_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ? AND i.invoice_date <= ?
       GROUP BY ii.product_id
       ORDER BY total_bv_generated DESC, total_qty_sold DESC`
    )
    .all(orgId, from, to);

  // 2. GST / GSTR-1 HSN Summary & Input Tax Credit (ITC)
  const hsnSummary = db
    .prepare(
      `SELECT
        CASE WHEN ii.hsn_code = '' THEN 'UNSPECIFIED' ELSE ii.hsn_code END as hsn_code,
        ii.gst_rate,
        ii.unit,
        SUM(ii.quantity) as total_qty,
        SUM(ii.taxable_amount) as taxable_value,
        SUM(ii.cgst_amount) as cgst_amount,
        SUM(ii.sgst_amount) as sgst_amount,
        SUM(ii.igst_amount) as igst_amount,
        SUM(ii.line_total) as total_value
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.org_id = ? AND i.status = 'ISSUED' AND i.is_gst = 1
         AND i.invoice_date >= ? AND i.invoice_date <= ?
       GROUP BY hsn_code, ii.gst_rate, ii.unit
       ORDER BY taxable_value DESC`
    )
    .all(orgId, from, to);

  const b2bVsB2c = db
    .prepare(
      `SELECT
        CASE WHEN customer_gstin != '' THEN 'B2B (With GSTIN)' ELSE 'B2C (Consumer / Unregistered)' END as segment,
        COUNT(*) as invoice_count,
        COALESCE(SUM(taxable_amount), 0) as taxable_value,
        COALESCE(SUM(cgst_amount), 0) as cgst,
        COALESCE(SUM(sgst_amount), 0) as sgst,
        COALESCE(SUM(igst_amount), 0) as igst,
        COALESCE(SUM(grand_total), 0) as invoice_value
       FROM invoices
       WHERE org_id = ? AND status = 'ISSUED' AND is_gst = 1
         AND invoice_date >= ? AND invoice_date <= ?
       GROUP BY segment`
    )
    .all(orgId, from, to);

  const purchaseItc = db
    .prepare(
      `SELECT
        COUNT(*) as purchase_count,
        COALESCE(SUM(taxable_amount), 0) as taxable_purchases,
        COALESCE(SUM(cgst_amount), 0) as itc_cgst,
        COALESCE(SUM(sgst_amount), 0) as itc_sgst,
        COALESCE(SUM(igst_amount), 0) as itc_igst,
        COALESCE(SUM(total_tax), 0) as total_itc,
        COALESCE(SUM(grand_total), 0) as gross_purchases
       FROM purchases
       WHERE org_id = ? AND status = 'ACTIVE' AND purchase_date >= ? AND purchase_date <= ?`
    )
    .get(orgId, from, to) as any;

  // 3. Inventory Movement Log
  const movements = db
    .prepare(
      `SELECT sm.*, p.name as product_name, p.sku, p.unit
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.org_id = ?
       ORDER BY sm.id DESC
       LIMIT 150`
    )
    .all(orgId);

  // 4. Batch Expiry & Valuation Breakdown
  const activeBatches = db
    .prepare(
      `SELECT b.*, p.name as product_name, p.sku, p.unit, p.category
       FROM batches b
       JOIN products p ON p.id = b.product_id
       WHERE b.org_id = ? AND b.remaining_qty > 0 AND b.status = 'ACTIVE' AND p.is_active = 1
       ORDER BY
         CASE WHEN b.expiry_date = '' OR b.expiry_date IS NULL THEN 1 ELSE 0 END ASC,
         b.expiry_date ASC,
         b.received_date ASC`
    )
    .all(orgId);

  res.json({
    range: { from, to, today },
    sales_summary: {
      ...salesSummary,
      gross_profit: round2(Number(salesSummary.net_taxable_sales) - Number(salesSummary.fifo_cogs)),
    },
    payment_breakdown: paymentBreakdown,
    top_products: topProducts,
    itemized_sales: itemizedSales,
    sales_invoices: salesInvoices,
    bv_report: {
      summary: {
        total_bv_earned: round2(Number(bvSummaryRow.total_bv_earned || 0)),
        bv_invoices_count: Number(bvSummaryRow.bv_invoices_count || 0),
        unique_customers_with_bv: Number(bvSummaryRow.unique_customers_with_bv || 0),
        total_bv_units: round2(Number(bvItemStats.total_bv_units || 0)),
        lines_with_bv_removed: Number(bvItemStats.lines_with_bv_removed || 0),
      },
      by_customer: bvByCustomer,
      by_invoice: bvByInvoice,
      by_product: bvByProduct,
    },
    gst_report: {
      hsn_summary: hsnSummary,
      b2b_vs_b2c: b2bVsB2c,
      purchase_itc: purchaseItc,
      net_gst_payable: round2(
        Number(salesSummary.total_gst_collected) - Number(purchaseItc.total_itc)
      ),
    },
    stock_movements: movements,
    active_batches: activeBatches,
  });
});
