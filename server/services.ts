import { db } from './db.js';
import { buildUpiPaymentUri, DEFAULT_HSN_DIRECTORY, round2 } from './constants.js';

export interface FifoSlice {
  batch_id: number;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  received_date: string;
  quantity: number;
  cost_price: number;
  mrp: number;
  selling_price: number;
}

export function getTodayDate(): string {
  // Anchored to system local timezone Asia/Calcutta
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Calcutta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

export function seedDefaultHsnForOrg(orgId: number) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO hsn_codes (org_id, code, description, gst_rate, cess_rate, category)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  const tx = db.transaction(() => {
    for (const item of DEFAULT_HSN_DIRECTORY) {
      stmt.run(orgId, item.code, item.description, item.gst_rate, item.category);
    }
  });
  tx();
}

export function getProductTotalStock(orgId: number, productId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(remaining_qty), 0) as total
       FROM batches
       WHERE org_id = ? AND product_id = ? AND remaining_qty > 0 AND status = 'ACTIVE'`
    )
    .get(orgId, productId) as { total: number };
  return round2(row?.total || 0);
}

export function previewFifoAllocation(
  orgId: number,
  productId: number,
  requestedQty: number,
  asOfDate?: string,
  preferredBatchId?: number | null
): {
  sufficient: boolean;
  available_qty: number;
  expired_qty: number;
  allocations: FifoSlice[];
  fifo_cost_total: number;
  suggested_selling_price: number;
  suggested_mrp: number;
} {
  const refDate = asOfDate || getTodayDate();
  const allActiveBatches = db
    .prepare(
      `SELECT * FROM batches
       WHERE org_id = ? AND product_id = ? AND remaining_qty > 0 AND status = 'ACTIVE'
       ORDER BY received_date ASC, id ASC`
    )
    .all(orgId, productId) as any[];

  let expiredQty = 0;
  const sellableBatches: any[] = [];
  for (const b of allActiveBatches) {
    if (b.expiry_date && b.expiry_date < refDate) {
      expiredQty += Number(b.remaining_qty);
    } else {
      sellableBatches.push(b);
    }
  }

  // If user selected a preferred batch, put it first while keeping strict FIFO order for any remainder
  if (preferredBatchId) {
    const idx = sellableBatches.findIndex((b) => b.id === preferredBatchId);
    if (idx > 0) {
      const [chosen] = sellableBatches.splice(idx, 1);
      sellableBatches.unshift(chosen);
    }
  }

  const availableQty = round2(sellableBatches.reduce((acc, b) => acc + Number(b.remaining_qty), 0));
  let remainingNeed = round2(requestedQty);
  const allocations: FifoSlice[] = [];

  for (const b of sellableBatches) {
    if (remainingNeed <= 0) break;
    const take = round2(Math.min(remainingNeed, Number(b.remaining_qty)));
    if (take > 0) {
      allocations.push({
        batch_id: b.id,
        batch_number: b.batch_number,
        mfg_date: b.mfg_date || '',
        expiry_date: b.expiry_date || '',
        received_date: b.received_date,
        quantity: take,
        cost_price: Number(b.cost_price),
        mrp: Number(b.mrp),
        selling_price: Number(b.selling_price),
      });
      remainingNeed = round2(remainingNeed - take);
    }
  }

  const fifoCostTotal = round2(
    allocations.reduce((sum, a) => sum + a.quantity * a.cost_price, 0)
  );
  const firstBatch = allocations[0] || sellableBatches[0];
  const product = db
    .prepare('SELECT default_selling_price, default_mrp FROM products WHERE id = ? AND org_id = ?')
    .get(productId, orgId) as any;

  return {
    sufficient: remainingNeed <= 0,
    available_qty: availableQty,
    expired_qty: round2(expiredQty),
    allocations,
    fifo_cost_total: fifoCostTotal,
    suggested_selling_price: firstBatch
      ? Number(firstBatch.selling_price)
      : Number(product?.default_selling_price || 0),
    suggested_mrp: firstBatch
      ? Number(firstBatch.mrp)
      : Number(product?.default_mrp || 0),
  };
}

function nextVoucherNumber(orgId: number, table: 'invoices' | 'purchases', col: string, prefix: string, year: string): string {
  const pattern = `${prefix}-${year}-%`;
  const row = db
    .prepare(`SELECT ${col} as num FROM ${table} WHERE org_id = ? AND ${col} LIKE ? ORDER BY id DESC LIMIT 1`)
    .get(orgId, pattern) as { num?: string } | undefined;
  let seq = 1;
  if (row?.num) {
    const parts = row.num.split('-');
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(lastNum)) seq = lastNum + 1;
  }
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

export interface PurchaseItemInput {
  product_id: number;
  batch_number: string;
  mfg_date?: string;
  expiry_date?: string;
  quantity: number;
  free_qty?: number;
  cost_price: number;
  mrp?: number;
  selling_price?: number;
  discount_amount?: number;
  gst_rate?: number;
  hsn_code?: string;
}

export interface CreatePurchaseInput {
  supplier_id: number;
  supplier_invoice_no?: string;
  purchase_date?: string;
  due_date?: string;
  is_gst?: boolean;
  amount_paid?: number;
  payment_mode?: string;
  payment_ref?: string;
  notes?: string;
  items: PurchaseItemInput[];
}

export const createPurchaseBill = db.transaction((orgId: number, input: CreatePurchaseInput) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as any;
  if (!org) throw new Error('Organization not found');

  const supplier = db
    .prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?')
    .get(input.supplier_id, orgId) as any;
  if (!supplier) throw new Error('Supplier not found');

  if (!input.items || input.items.length === 0) {
    throw new Error('At least one purchase item is required');
  }

  const purchaseDate = input.purchase_date || getTodayDate();
  const year = purchaseDate.slice(0, 4);
  const purchaseNumber = nextVoucherNumber(
    orgId,
    'purchases',
    'purchase_number',
    org.purchase_prefix || 'PUR',
    year
  );

  const isGst = input.is_gst !== undefined ? Boolean(input.is_gst) : Boolean(org.gst_enabled);
  const supplyType = !isGst
    ? 'NONE'
    : (supplier.state_code || org.state_code) === org.state_code
      ? 'INTRA'
      : 'INTER';

  const nowIso = new Date().toISOString();

  // Insert placeholder purchase header first
  const headerRes = db
    .prepare(
      `INSERT INTO purchases (
        org_id, purchase_number, supplier_invoice_no, supplier_id, purchase_date, due_date,
        is_gst, supply_type, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
    )
    .run(
      orgId,
      purchaseNumber,
      input.supplier_invoice_no || '',
      supplier.id,
      purchaseDate,
      input.due_date || '',
      isGst ? 1 : 0,
      supplyType,
      input.notes || '',
      nowIso
    );

  const purchaseId = Number(headerRes.lastInsertRowid);

  let subtotal = 0;
  let totalDiscount = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  for (let i = 0; i < input.items.length; i++) {
    const line = input.items[i];
    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND org_id = ?')
      .get(line.product_id, orgId) as any;
    if (!product) throw new Error(`Product ID ${line.product_id} not found`);

    const qty = Number(line.quantity);
    const freeQty = Number(line.free_qty || 0);
    if (qty <= 0) throw new Error(`Invalid quantity for ${product.name}`);

    const costPrice = Number(line.cost_price);
    const mrp = line.mrp !== undefined ? Number(line.mrp) : Number(product.default_mrp || costPrice * 1.25);
    const sellingPrice =
      line.selling_price !== undefined
        ? Number(line.selling_price)
        : Number(product.default_selling_price || mrp);
    const lineGross = round2(qty * costPrice);
    const lineDisc = round2(Number(line.discount_amount || 0));
    const taxable = round2(Math.max(0, lineGross - lineDisc));
    const gstRate = isGst
      ? line.gst_rate !== undefined
        ? Number(line.gst_rate)
        : Number(product.gst_rate || 0)
      : 0;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (isGst && gstRate > 0) {
      if (supplyType === 'INTRA') {
        cgst = round2((taxable * (gstRate / 2)) / 100);
        sgst = round2((taxable * (gstRate / 2)) / 100);
      } else {
        igst = round2((taxable * gstRate) / 100);
      }
    }
    const lineTotal = round2(taxable + cgst + sgst + igst);

    const totalBatchQty = round2(qty + freeQty);
    const effectiveUnitCost = totalBatchQty > 0 ? round2(taxable / totalBatchQty) : costPrice;
    const batchNumber =
      (line.batch_number || '').trim() ||
      `BCH-${purchaseDate.replace(/-/g, '').slice(2)}-${product.id}${i + 1}`;

    // Create Inventory Batch for FIFO!
    const batchRes = db
      .prepare(
        `INSERT INTO batches (
          org_id, product_id, batch_number, mfg_date, expiry_date, received_date,
          purchase_id, supplier_id, cost_price, mrp, selling_price,
          initial_qty, remaining_qty, status, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      )
      .run(
        orgId,
        product.id,
        batchNumber,
        line.mfg_date || '',
        line.expiry_date || '',
        purchaseDate,
        purchaseId,
        supplier.id,
        effectiveUnitCost,
        mrp,
        sellingPrice,
        totalBatchQty,
        totalBatchQty,
        `Purchased via ${purchaseNumber}`,
        nowIso
      );

    const batchId = Number(batchRes.lastInsertRowid);

    // Update product defaults to latest purchase pricing
    db.prepare(
      `UPDATE products
       SET default_cost_price = ?, default_mrp = ?, default_selling_price = ?,
           hsn_code = CASE WHEN ? != '' THEN ? ELSE hsn_code END
       WHERE id = ? AND org_id = ?`
    ).run(
      effectiveUnitCost,
      mrp,
      sellingPrice,
      line.hsn_code || '',
      line.hsn_code || '',
      product.id,
      orgId
    );

    db.prepare(
      `INSERT INTO purchase_items (
        purchase_id, product_id, batch_id, batch_number, mfg_date, expiry_date, hsn_code,
        quantity, free_qty, cost_price, mrp, selling_price, discount_amount,
        taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      purchaseId,
      product.id,
      batchId,
      batchNumber,
      line.mfg_date || '',
      line.expiry_date || '',
      line.hsn_code || product.hsn_code || '',
      qty,
      freeQty,
      costPrice,
      mrp,
      sellingPrice,
      lineDisc,
      taxable,
      gstRate,
      cgst,
      sgst,
      igst,
      lineTotal
    );

    const stockAfter = getProductTotalStock(orgId, product.id);
    db.prepare(
      `INSERT INTO stock_movements (
        org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
        balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
      ) VALUES (?, ?, ?, ?, 'PURCHASE_IN', ?, ?, ?, 'PURCHASE', ?, ?, ?, ?)`
    ).run(
      orgId,
      product.id,
      batchId,
      batchNumber,
      totalBatchQty,
      stockAfter,
      effectiveUnitCost,
      purchaseId,
      purchaseNumber,
      `Stock received from ${supplier.name}`,
      `${purchaseDate}T10:00:00.000Z`
    );

    subtotal = round2(subtotal + lineGross);
    totalDiscount = round2(totalDiscount + lineDisc);
    totalTaxable = round2(totalTaxable + taxable);
    totalCgst = round2(totalCgst + cgst);
    totalSgst = round2(totalSgst + sgst);
    totalIgst = round2(totalIgst + igst);
  }

  const totalTax = round2(totalCgst + totalSgst + totalIgst);
  const grandTotal = round2(totalTaxable + totalTax);
  const amountPaid = round2(Math.min(grandTotal, Math.max(0, Number(input.amount_paid || 0))));
  const balanceDue = round2(grandTotal - amountPaid);
  const paymentStatus =
    balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID';
  const paymentMode = amountPaid > 0 ? input.payment_mode || 'BANK_TRANSFER' : 'CREDIT';

  db.prepare(
    `UPDATE purchases SET
      subtotal = ?, discount_amount = ?, taxable_amount = ?,
      cgst_amount = ?, sgst_amount = ?, igst_amount = ?, total_tax = ?,
      grand_total = ?, amount_paid = ?, balance_due = ?,
      payment_status = ?, payment_mode = ?, payment_ref = ?
     WHERE id = ?`
  ).run(
    subtotal,
    totalDiscount,
    totalTaxable,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    grandTotal,
    amountPaid,
    balanceDue,
    paymentStatus,
    paymentMode,
    input.payment_ref || '',
    purchaseId
  );

  // Post Supplier Ledger: Purchase increases payable (Credit)
  let runningSupplierBal = round2(Number(supplier.current_balance) + grandTotal);
  db.prepare(
    `INSERT INTO ledger_entries (
      org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
      debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
    ) VALUES (?, 'SUPPLIER', ?, ?, 'PURCHASE', ?, ?, 0, ?, ?, 'CREDIT', ?, ?, ?)`
  ).run(
    orgId,
    supplier.id,
    purchaseDate,
    purchaseNumber,
    purchaseId,
    grandTotal,
    runningSupplierBal,
    input.supplier_invoice_no || '',
    `Purchase Bill ${purchaseNumber}${input.supplier_invoice_no ? ` (Supplier Inv: ${input.supplier_invoice_no})` : ''}`,
    nowIso
  );

  if (amountPaid > 0) {
    runningSupplierBal = round2(runningSupplierBal - amountPaid);
    db.prepare(
      `INSERT INTO ledger_entries (
        org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
        debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
      ) VALUES (?, 'SUPPLIER', ?, ?, 'PAYMENT_OUT', ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).run(
      orgId,
      supplier.id,
      purchaseDate,
      `PAY-${purchaseNumber}`,
      purchaseId,
      amountPaid,
      runningSupplierBal,
      paymentMode,
      input.payment_ref || '',
      `Payment made against ${purchaseNumber}`,
      nowIso
    );
  }

  db.prepare('UPDATE suppliers SET current_balance = ? WHERE id = ?').run(
    runningSupplierBal,
    supplier.id
  );

  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as any;
});

export interface InvoiceItemInput {
  product_id: number;
  quantity: number;
  unit_price?: number;
  discount_percent?: number;
  gst_rate?: number;
  preferred_batch_id?: number | null;
  bv_per_unit?: number;
  bv_included?: boolean;
}

export interface CreateInvoiceInput {
  customer_id?: number | null;
  customer_name?: string;
  customer_phone?: string;
  customer_gstin?: string;
  customer_address?: string;
  buyer_state_code?: string;
  buyer_state_name?: string;
  invoice_date?: string;
  due_date?: string;
  is_gst?: boolean;
  tax_inclusive?: boolean;
  bill_discount?: number;
  show_bv_on_bill?: boolean;
  payment_mode: 'UPI_QR' | 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT';
  amount_paid?: number;
  payment_ref?: string;
  qr_confirmed?: boolean;
  notes?: string;
  items: InvoiceItemInput[];
}

export const createInvoiceWithFifo = db.transaction((orgId: number, input: CreateInvoiceInput) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId) as any;
  if (!org) throw new Error('Organization not found');

  if (!input.items || input.items.length === 0) {
    throw new Error('Add at least one item to issue a bill');
  }

  let customer: any = null;
  if (input.customer_id) {
    customer = db
      .prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?')
      .get(input.customer_id, orgId) as any;
    if (!customer) throw new Error('Selected customer not found');
  }

  const invoiceDate = input.invoice_date || getTodayDate();
  const year = invoiceDate.slice(0, 4);
  const isGst = input.is_gst !== undefined ? Boolean(input.is_gst) : Boolean(org.gst_enabled);
  const taxInclusive =
    input.tax_inclusive !== undefined
      ? Boolean(input.tax_inclusive)
      : Boolean(org.default_tax_inclusive);

  const prefix = isGst ? org.invoice_prefix || 'INV' : org.non_gst_prefix || 'BOS';
  const invoiceNumber = nextVoucherNumber(orgId, 'invoices', 'invoice_number', prefix, year);
  const invoiceType = isGst ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY';

  const buyerStateCode =
    input.buyer_state_code || customer?.state_code || org.state_code || '09';
  const buyerStateName =
    input.buyer_state_name || customer?.state_name || org.state_name || 'Uttar Pradesh';
  const placeOfSupply = `${buyerStateName} (${buyerStateCode})`;

  const supplyType = !isGst
    ? 'NONE'
    : buyerStateCode === org.state_code
      ? 'INTRA'
      : 'INTER';

  const customerName = (input.customer_name || customer?.name || 'Walk-in Consumer').trim();
  const customerPhone = input.customer_phone ?? customer?.phone ?? '';
  const customerGstin = isGst ? (input.customer_gstin ?? customer?.gstin ?? '') : '';
  const customerAddress = input.customer_address ?? customer?.address ?? '';

  const nowIso = new Date().toISOString();

  // Insert invoice header first so we have invoiceId
  const invRes = db
    .prepare(
      `INSERT INTO invoices (
        org_id, invoice_number, invoice_type, is_gst, tax_inclusive, supply_type,
        customer_id, customer_name, customer_phone, customer_gstin, customer_address,
        place_of_supply, invoice_date, due_date, payment_mode, status, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?)`
    )
    .run(
      orgId,
      invoiceNumber,
      invoiceType,
      isGst ? 1 : 0,
      taxInclusive ? 1 : 0,
      supplyType,
      customer ? customer.id : null,
      customerName,
      customerPhone,
      customerGstin,
      customerAddress,
      placeOfSupply,
      invoiceDate,
      input.due_date || '',
      input.payment_mode || 'UPI_QR',
      input.notes || '',
      nowIso
    );

  const invoiceId = Number(invRes.lastInsertRowid);

  let subtotal = 0;
  let itemDiscountTotal = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalFifoCost = 0;
  let totalBv = 0;
  const showBvOnBill = input.show_bv_on_bill ? 1 : 0;

  for (const item of input.items) {
    const product = db
      .prepare('SELECT * FROM products WHERE id = ? AND org_id = ?')
      .get(item.product_id, orgId) as any;
    if (!product) throw new Error(`Product ${item.product_id} not found`);

    const qty = round2(Number(item.quantity));
    if (qty <= 0) throw new Error(`Quantity must be positive for ${product.name}`);

    // Execute FIFO Batch Preview & Validation
    const fifo = previewFifoAllocation(
      orgId,
      product.id,
      qty,
      invoiceDate,
      item.preferred_batch_id || null
    );
    if (!fifo.sufficient) {
      throw new Error(
        `Insufficient non-expired stock for "${product.name}". Requested: ${qty} ${product.unit}, Available (FIFO): ${fifo.available_qty} ${product.unit}${
          fifo.expired_qty > 0 ? ` (${fifo.expired_qty} expired units skipped)` : ''
        }.`
      );
    }

    const unitPrice =
      item.unit_price !== undefined ? Number(item.unit_price) : fifo.suggested_selling_price;
    const mrp = fifo.suggested_mrp || Number(product.default_mrp || unitPrice);
    const discPct = Math.min(100, Math.max(0, Number(item.discount_percent || 0)));
    const grossLine = round2(qty * unitPrice);
    const discAmt = round2((grossLine * discPct) / 100);
    const afterDisc = round2(grossLine - discAmt);

    const gstRate = isGst
      ? item.gst_rate !== undefined
        ? Number(item.gst_rate)
        : Number(product.gst_rate || 0)
      : 0;

    let taxable = afterDisc;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let lineTotal = afterDisc;

    if (isGst && gstRate > 0) {
      if (taxInclusive) {
        taxable = round2(afterDisc / (1 + gstRate / 100));
        const taxAmt = round2(afterDisc - taxable);
        if (supplyType === 'INTRA') {
          cgst = round2(taxAmt / 2);
          sgst = round2(taxAmt - cgst);
        } else {
          igst = taxAmt;
        }
        lineTotal = afterDisc;
      } else {
        taxable = afterDisc;
        if (supplyType === 'INTRA') {
          cgst = round2((taxable * (gstRate / 2)) / 100);
          sgst = round2((taxable * (gstRate / 2)) / 100);
        } else {
          igst = round2((taxable * gstRate) / 100);
        }
        lineTotal = round2(taxable + cgst + sgst + igst);
      }
    }

    const batchSummary = fifo.allocations
      .map((a) => `${a.batch_number} (${a.quantity})`)
      .join(', ');
    const expiries = fifo.allocations.map((a) => a.expiry_date).filter(Boolean).sort();
    const expirySummary = expiries[0] || '';

    // Business Value (BV) calculation — strictly separate from money!
    const bvPerUnit =
      item.bv_per_unit !== undefined
        ? Math.max(0, round2(Number(item.bv_per_unit)))
        : Math.max(0, round2(Number(product.default_bv || 0)));
    const bvIncluded = item.bv_included !== undefined ? (item.bv_included ? 1 : 0) : 1;
    const lineBvTotal = bvIncluded ? round2(qty * bvPerUnit) : 0;

    const lineRes = db
      .prepare(
        `INSERT INTO invoice_items (
          invoice_id, product_id, product_name, sku, unit, hsn_code,
          quantity, mrp, unit_price, discount_percent, discount_amount,
          taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount,
          line_total, fifo_cost_total, bv_per_unit, bv_included, line_bv_total,
          batch_summary, expiry_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        invoiceId,
        product.id,
        product.name,
        product.sku,
        product.unit,
        isGst ? product.hsn_code || '' : '',
        qty,
        mrp,
        unitPrice,
        discPct,
        discAmt,
        taxable,
        gstRate,
        cgst,
        sgst,
        igst,
        lineTotal,
        fifo.fifo_cost_total,
        bvPerUnit,
        bvIncluded,
        lineBvTotal,
        batchSummary,
        expirySummary
      );

    const invoiceItemId = Number(lineRes.lastInsertRowid);

    // Deduct each FIFO batch slice & record audit trail
    for (const slice of fifo.allocations) {
      const batchRow = db
        .prepare('SELECT remaining_qty FROM batches WHERE id = ?')
        .get(slice.batch_id) as { remaining_qty: number };
      const newRem = round2(Number(batchRow.remaining_qty) - slice.quantity);
      const newStatus = newRem <= 0 ? 'DEPLETED' : 'ACTIVE';

      db.prepare('UPDATE batches SET remaining_qty = ?, status = ? WHERE id = ?').run(
        Math.max(0, newRem),
        newStatus,
        slice.batch_id
      );

      db.prepare(
        `INSERT INTO invoice_item_batches (
          invoice_item_id, invoice_id, batch_id, batch_number, expiry_date, quantity, cost_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invoiceItemId,
        invoiceId,
        slice.batch_id,
        slice.batch_number,
        slice.expiry_date,
        slice.quantity,
        slice.cost_price
      );

      const stockAfter = getProductTotalStock(orgId, product.id);
      db.prepare(
        `INSERT INTO stock_movements (
          org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
          balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
        ) VALUES (?, ?, ?, ?, 'SALE_OUT', ?, ?, ?, 'INVOICE', ?, ?, ?, ?)`
      ).run(
        orgId,
        product.id,
        slice.batch_id,
        slice.batch_number,
        -slice.quantity,
        stockAfter,
        slice.cost_price,
        invoiceId,
        invoiceNumber,
        `FIFO deduction for ${customerName}`,
        `${invoiceDate}T14:00:00.000Z`
      );
    }

    subtotal = round2(subtotal + grossLine);
    itemDiscountTotal = round2(itemDiscountTotal + discAmt);
    totalTaxable = round2(totalTaxable + taxable);
    totalCgst = round2(totalCgst + cgst);
    totalSgst = round2(totalSgst + sgst);
    totalIgst = round2(totalIgst + igst);
    totalFifoCost = round2(totalFifoCost + fifo.fifo_cost_total);
    totalBv = round2(totalBv + lineBvTotal);
  }

  const billDiscount = round2(Math.max(0, Number(input.bill_discount || 0)));
  const totalTax = round2(totalCgst + totalSgst + totalIgst);
  const rawTotal = round2(Math.max(0, totalTaxable + totalTax - billDiscount));
  const grandTotal = rawTotal;

  let amountPaid: number;
  if (input.payment_mode === 'CREDIT') {
    if (!customer) {
      throw new Error('Please select or add a Customer to issue a Credit / Khata Ledger bill.');
    }
    amountPaid = round2(Math.min(grandTotal, Math.max(0, Number(input.amount_paid || 0))));
  } else {
    amountPaid =
      input.amount_paid !== undefined
        ? round2(Math.min(grandTotal, Math.max(0, Number(input.amount_paid))))
        : grandTotal;
    if (!customer && amountPaid < grandTotal) {
      throw new Error('Walk-in consumer bills must be paid in full, or select a Customer for partial/credit ledger.');
    }
  }

  const balanceDue = round2(grandTotal - amountPaid);
  const paymentStatus =
    balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'UNPAID';

  const upiAmount = balanceDue > 0 ? balanceDue : grandTotal;
  const upiUri = buildUpiPaymentUri({
    upiId: org.upi_id,
    payeeName: org.upi_payee_name || org.business_name,
    amount: upiAmount,
    note: `${invoiceNumber} - ${org.business_name}`,
    transactionRef: invoiceNumber,
  });

  const qrConfirmedAt =
    input.payment_mode === 'UPI_QR' && (input.qr_confirmed || paymentStatus === 'PAID')
      ? nowIso
      : '';

  db.prepare(
    `UPDATE invoices SET
      subtotal = ?, item_discount_total = ?, bill_discount = ?,
      taxable_amount = ?, cgst_amount = ?, sgst_amount = ?, igst_amount = ?,
      total_tax = ?, round_off = 0, grand_total = ?, total_fifo_cost = ?,
      total_bv = ?, show_bv_on_bill = ?,
      amount_paid = ?, balance_due = ?, payment_status = ?,
      payment_ref = ?, upi_uri = ?, qr_confirmed_at = ?
     WHERE id = ?`
  ).run(
    subtotal,
    itemDiscountTotal,
    billDiscount,
    totalTaxable,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax,
    grandTotal,
    totalFifoCost,
    totalBv,
    showBvOnBill,
    amountPaid,
    balanceDue,
    paymentStatus,
    input.payment_ref || '',
    upiUri,
    qrConfirmedAt,
    invoiceId
  );

  // Update Customer Ledger if linked
  if (customer) {
    let runningCustBal = round2(Number(customer.current_balance) + grandTotal);
    db.prepare(
      `INSERT INTO ledger_entries (
        org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
        debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
      ) VALUES (?, 'CUSTOMER', ?, ?, 'INVOICE', ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).run(
      orgId,
      customer.id,
      invoiceDate,
      invoiceNumber,
      invoiceId,
      grandTotal,
      runningCustBal,
      input.payment_mode,
      '',
      `${isGst ? 'GST Tax Invoice' : 'Bill of Supply'} ${invoiceNumber}`,
      nowIso
    );

    if (amountPaid > 0) {
      runningCustBal = round2(runningCustBal - amountPaid);
      db.prepare(
        `INSERT INTO ledger_entries (
          org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
          debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
        ) VALUES (?, 'CUSTOMER', ?, ?, 'PAYMENT_IN', ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      ).run(
        orgId,
        customer.id,
        invoiceDate,
        `RCPT-${invoiceNumber}`,
        invoiceId,
        amountPaid,
        runningCustBal,
        input.payment_mode,
        input.payment_ref || '',
        `Payment received (${input.payment_mode}) against ${invoiceNumber}`,
        nowIso
      );
    }

    db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(
      runningCustBal,
      customer.id
    );
  }

  return getFullInvoiceById(orgId, invoiceId);
});

export function getFullInvoiceById(orgId: number, invoiceId: number) {
  const invoice = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?')
    .get(invoiceId, orgId) as any;
  if (!invoice) return null;

  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC')
    .all(invoiceId) as any[];

  const batchSlices = db
    .prepare('SELECT * FROM invoice_item_batches WHERE invoice_id = ? ORDER BY id ASC')
    .all(invoiceId) as any[];

  const itemsWithBatches = items.map((it) => ({
    ...it,
    batches: batchSlices.filter((b) => b.invoice_item_id === it.id),
  }));

  let customerTotalBv: number | null = null;
  if (invoice.customer_id) {
    const custBvRow = db
      .prepare(
        `SELECT c.opening_bv + COALESCE((
          SELECT SUM(i.total_bv) FROM invoices i
          WHERE i.customer_id = c.id AND i.org_id = c.org_id AND i.status = 'ISSUED'
        ), 0) as total_bv
        FROM customers c WHERE c.id = ? AND c.org_id = ?`
      )
      .get(invoice.customer_id, orgId) as { total_bv: number } | undefined;
    if (custBvRow) {
      customerTotalBv = round2(custBvRow.total_bv || 0);
    }
  }

  return {
    ...invoice,
    customer_total_bv: customerTotalBv,
    items: itemsWithBatches,
  };
}

export function getFullPurchaseById(orgId: number, purchaseId: number) {
  const purchase = db
    .prepare(
      `SELECT p.*, s.name as supplier_name, s.gstin as supplier_gstin, s.upi_id as supplier_upi_id,
              s.phone as supplier_phone, s.state_name as supplier_state, s.address as supplier_address
       FROM purchases p
       JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ? AND p.org_id = ?`
    )
    .get(purchaseId, orgId) as any;
  if (!purchase) return null;

  const items = db
    .prepare(
      `SELECT pi.*, pr.name as product_name, pr.sku, pr.unit
       FROM purchase_items pi
       JOIN products pr ON pr.id = pi.product_id
       WHERE pi.purchase_id = ?
       ORDER BY pi.id ASC`
    )
    .all(purchaseId) as any[];

  return {
    ...purchase,
    items,
  };
}

export const cancelInvoice = db.transaction((orgId: number, invoiceId: number) => {
  const inv = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?')
    .get(invoiceId, orgId) as any;
  if (!inv) throw new Error('Invoice not found');
  if (inv.status === 'CANCELLED') throw new Error('Invoice is already cancelled');

  const slices = db
    .prepare(
      `SELECT iib.*, ii.product_id
       FROM invoice_item_batches iib
       JOIN invoice_items ii ON ii.id = iib.invoice_item_id
       WHERE iib.invoice_id = ?`
    )
    .all(invoiceId) as any[];

  const nowIso = new Date().toISOString();

  for (const s of slices) {
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(s.batch_id) as any;
    if (batch) {
      const restoredQty = round2(Number(batch.remaining_qty) + Number(s.quantity));
      db.prepare(`UPDATE batches SET remaining_qty = ?, status = 'ACTIVE' WHERE id = ?`).run(
        restoredQty,
        batch.id
      );
      const stockAfter = getProductTotalStock(orgId, s.product_id);
      db.prepare(
        `INSERT INTO stock_movements (
          org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
          balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
        ) VALUES (?, ?, ?, ?, 'SALE_CANCEL_IN', ?, ?, ?, 'INVOICE', ?, ?, ?, ?)`
      ).run(
        orgId,
        s.product_id,
        batch.id,
        s.batch_number,
        s.quantity,
        stockAfter,
        s.cost_price,
        invoiceId,
        inv.invoice_number,
        `Stock restored from cancelled invoice ${inv.invoice_number}`,
        nowIso
      );
    }
  }

  if (inv.customer_id && Number(inv.balance_due) > 0) {
    const customer = db
      .prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?')
      .get(inv.customer_id, orgId) as any;
    if (customer) {
      const newBal = round2(Number(customer.current_balance) - Number(inv.balance_due));
      db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(newBal, customer.id);
      db.prepare(
        `INSERT INTO ledger_entries (
          org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
          debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
        ) VALUES (?, 'CUSTOMER', ?, ?, 'REVERSAL', ?, ?, 0, ?, ?, 'ADJUSTMENT', '', ?, ?)`
      ).run(
        orgId,
        customer.id,
        getTodayDate(),
        `CNL-${inv.invoice_number}`,
        invoiceId,
        inv.balance_due,
        newBal,
        `Reversed unpaid balance of cancelled bill ${inv.invoice_number}`,
        nowIso
      );
    }
  }

  db.prepare(`UPDATE invoices SET status = 'CANCELLED', balance_due = 0 WHERE id = ?`).run(invoiceId);
  return getFullInvoiceById(orgId, invoiceId);
});

export const settleInvoiceDue = db.transaction(
  (
    orgId: number,
    invoiceId: number,
    payload: { amount: number; payment_mode: string; payment_ref?: string; entry_date?: string }
  ) => {
    const inv = db
      .prepare('SELECT * FROM invoices WHERE id = ? AND org_id = ?')
      .get(invoiceId, orgId) as any;
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'CANCELLED') throw new Error('Cannot pay a cancelled invoice');
    if (Number(inv.balance_due) <= 0) throw new Error('Invoice is already paid in full');

    const payAmt = round2(Math.min(Number(inv.balance_due), Math.max(0, Number(payload.amount))));
    if (payAmt <= 0) throw new Error('Payment amount must be greater than zero');

    const newPaid = round2(Number(inv.amount_paid) + payAmt);
    const newDue = round2(Number(inv.grand_total) - newPaid);
    const newStatus = newDue <= 0 ? 'PAID' : 'PARTIAL';
    const nowIso = new Date().toISOString();
    const entryDate = payload.entry_date || getTodayDate();

    db.prepare(
      `UPDATE invoices SET
        amount_paid = ?, balance_due = ?, payment_status = ?,
        payment_mode = ?, payment_ref = CASE WHEN ? != '' THEN ? ELSE payment_ref END,
        qr_confirmed_at = CASE WHEN ? = 'UPI_QR' THEN ? ELSE qr_confirmed_at END
       WHERE id = ?`
    ).run(
      newPaid,
      newDue,
      newStatus,
      payload.payment_mode || 'UPI_QR',
      payload.payment_ref || '',
      payload.payment_ref || '',
      payload.payment_mode || 'UPI_QR',
      nowIso,
      invoiceId
    );

    if (inv.customer_id) {
      const cust = db
        .prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?')
        .get(inv.customer_id, orgId) as any;
      if (cust) {
        const newBal = round2(Number(cust.current_balance) - payAmt);
        db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(newBal, cust.id);
        db.prepare(
          `INSERT INTO ledger_entries (
            org_id, party_type, party_id, entry_date, entry_type, voucher_no, reference_id,
            debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
          ) VALUES (?, 'CUSTOMER', ?, ?, 'PAYMENT_IN', ?, ?, 0, ?, ?, ?, ?, ?, ?)`
        ).run(
          orgId,
          cust.id,
          entryDate,
          `RCPT-${inv.invoice_number}-${Date.now().toString().slice(-4)}`,
          invoiceId,
          payAmt,
          newBal,
          payload.payment_mode || 'UPI_QR',
          payload.payment_ref || '',
          `Settlement received against ${inv.invoice_number}`,
          nowIso
        );
      }
    }

    return getFullInvoiceById(orgId, invoiceId);
  }
);

export const recordPartyLedgerPayment = db.transaction(
  (
    orgId: number,
    payload: {
      party_type: 'CUSTOMER' | 'SUPPLIER';
      party_id: number;
      amount: number;
      payment_mode: string;
      payment_ref?: string;
      entry_date?: string;
      narration?: string;
    }
  ) => {
    const amount = round2(Number(payload.amount));
    if (amount <= 0) throw new Error('Amount must be greater than zero');
    const entryDate = payload.entry_date || getTodayDate();
    const nowIso = new Date().toISOString();

    if (payload.party_type === 'CUSTOMER') {
      const cust = db
        .prepare('SELECT * FROM customers WHERE id = ? AND org_id = ?')
        .get(payload.party_id, orgId) as any;
      if (!cust) throw new Error('Customer not found');

      const newBal = round2(Number(cust.current_balance) - amount);
      db.prepare('UPDATE customers SET current_balance = ? WHERE id = ?').run(newBal, cust.id);

      const voucherNo = `RCPT-${entryDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;
      db.prepare(
        `INSERT INTO ledger_entries (
          org_id, party_type, party_id, entry_date, entry_type, voucher_no,
          debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
        ) VALUES (?, 'CUSTOMER', ?, ?, 'PAYMENT_IN', ?, 0, ?, ?, ?, ?, ?, ?)`
      ).run(
        orgId,
        cust.id,
        entryDate,
        voucherNo,
        amount,
        newBal,
        payload.payment_mode || 'UPI_QR',
        payload.payment_ref || '',
        payload.narration || `Ledger payment received from ${cust.name}`,
        nowIso
      );

      // Greedily mark oldest unpaid invoices for this customer as paid/partial
      let rem = amount;
      const openInvoices = db
        .prepare(
          `SELECT * FROM invoices
           WHERE org_id = ? AND customer_id = ? AND status = 'ISSUED' AND balance_due > 0
           ORDER BY invoice_date ASC, id ASC`
        )
        .all(orgId, cust.id) as any[];

      for (const inv of openInvoices) {
        if (rem <= 0) break;
        const apply = round2(Math.min(rem, Number(inv.balance_due)));
        const nextPaid = round2(Number(inv.amount_paid) + apply);
        const nextDue = round2(Number(inv.grand_total) - nextPaid);
        db.prepare(
          `UPDATE invoices SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?`
        ).run(nextPaid, nextDue, nextDue <= 0 ? 'PAID' : 'PARTIAL', inv.id);
        rem = round2(rem - apply);
      }

      return { party: db.prepare('SELECT * FROM customers WHERE id = ?').get(cust.id), voucherNo };
    } else {
      const sup = db
        .prepare('SELECT * FROM suppliers WHERE id = ? AND org_id = ?')
        .get(payload.party_id, orgId) as any;
      if (!sup) throw new Error('Supplier not found');

      const newBal = round2(Number(sup.current_balance) - amount);
      db.prepare('UPDATE suppliers SET current_balance = ? WHERE id = ?').run(newBal, sup.id);

      const voucherNo = `PVCH-${entryDate.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;
      db.prepare(
        `INSERT INTO ledger_entries (
          org_id, party_type, party_id, entry_date, entry_type, voucher_no,
          debit, credit, balance_after, payment_mode, payment_ref, narration, created_at
        ) VALUES (?, 'SUPPLIER', ?, ?, 'PAYMENT_OUT', ?, ?, 0, ?, ?, ?, ?, ?)`
      ).run(
        orgId,
        sup.id,
        entryDate,
        voucherNo,
        amount,
        newBal,
        payload.payment_mode || 'UPI_QR',
        payload.payment_ref || '',
        payload.narration || `Supplier payout to ${sup.name}`,
        nowIso
      );

      let rem = amount;
      const openPurchases = db
        .prepare(
          `SELECT * FROM purchases
           WHERE org_id = ? AND supplier_id = ? AND status = 'ACTIVE' AND balance_due > 0
           ORDER BY purchase_date ASC, id ASC`
        )
        .all(orgId, sup.id) as any[];

      for (const pur of openPurchases) {
        if (rem <= 0) break;
        const apply = round2(Math.min(rem, Number(pur.balance_due)));
        const nextPaid = round2(Number(pur.amount_paid) + apply);
        const nextDue = round2(Number(pur.grand_total) - nextPaid);
        db.prepare(
          `UPDATE purchases SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?`
        ).run(nextPaid, nextDue, nextDue <= 0 ? 'PAID' : 'PARTIAL', pur.id);
        rem = round2(rem - apply);
      }

      return { party: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(sup.id), voucherNo };
    }
  }
);

export const adjustBatchStock = db.transaction(
  (
    orgId: number,
    payload: {
      batch_id: number;
      adjustment_type: 'EXPIRED_WRITEOFF' | 'ADJUSTMENT_OUT' | 'ADJUSTMENT_IN';
      quantity: number;
      notes?: string;
    }
  ) => {
    const batch = db
      .prepare('SELECT * FROM batches WHERE id = ? AND org_id = ?')
      .get(payload.batch_id, orgId) as any;
    if (!batch) throw new Error('Batch not found');

    const qty = round2(Math.abs(Number(payload.quantity)));
    if (qty <= 0) throw new Error('Quantity must be greater than zero');

    let nextRem = Number(batch.remaining_qty);
    let delta = 0;
    let nextStatus = batch.status;

    if (payload.adjustment_type === 'ADJUSTMENT_IN') {
      nextRem = round2(nextRem + qty);
      delta = qty;
      nextStatus = 'ACTIVE';
    } else {
      if (qty > nextRem) throw new Error(`Cannot deduct ${qty}; batch only has ${nextRem} remaining`);
      nextRem = round2(nextRem - qty);
      delta = -qty;
      if (nextRem <= 0) {
        nextStatus =
          payload.adjustment_type === 'EXPIRED_WRITEOFF' ? 'EXPIRED_WRITEOFF' : 'DEPLETED';
      }
    }

    db.prepare('UPDATE batches SET remaining_qty = ?, status = ? WHERE id = ?').run(
      nextRem,
      nextStatus,
      batch.id
    );

    const stockAfter = getProductTotalStock(orgId, batch.product_id);
    db.prepare(
      `INSERT INTO stock_movements (
        org_id, product_id, batch_id, batch_number, movement_type, quantity_change,
        balance_after, unit_cost, reference_type, reference_id, reference_no, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?)`
    ).run(
      orgId,
      batch.product_id,
      batch.id,
      batch.batch_number,
      payload.adjustment_type,
      delta,
      stockAfter,
      batch.cost_price,
      batch.id,
      batch.batch_number,
      payload.notes || payload.adjustment_type,
      new Date().toISOString()
    );

    return db.prepare('SELECT * FROM batches WHERE id = ?').get(batch.id);
  }
);
