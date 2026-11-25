export interface Organization {
  id: number;
  business_name: string;
  legal_name: string;
  tagline: string;
  gst_enabled: number;
  gstin: string;
  pan: string;
  state_name: string;
  state_code: string;
  address: string;
  city: string;
  pincode: string;
  phone: string;
  email: string;
  upi_id: string;
  upi_payee_name: string;
  bank_name: string;
  bank_account_no: string;
  bank_ifsc: string;
  bank_branch: string;
  invoice_prefix: string;
  non_gst_prefix: string;
  purchase_prefix: string;
  default_tax_inclusive: number;
  terms_and_conditions: string;
  currency_symbol: string;
}

export interface User {
  id: number;
  org_id: number;
  name: string;
  email: string;
  role: string;
}

export interface IndianState {
  code: string;
  name: string;
}

export interface Batch {
  id: number;
  org_id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  unit?: string;
  category?: string;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  received_date: string;
  purchase_id: number | null;
  supplier_id: number | null;
  supplier_name?: string;
  cost_price: number;
  mrp: number;
  selling_price: number;
  initial_qty: number;
  remaining_qty: number;
  status: 'ACTIVE' | 'DEPLETED' | 'EXPIRED_WRITEOFF';
  notes: string;
}

export interface Product {
  id: number;
  org_id: number;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  hsn_code: string;
  gst_rate: number;
  default_cost_price: number;
  default_selling_price: number;
  default_mrp: number;
  default_bv: number;
  reorder_level: number;
  track_expiry: number;
  description: string;
  is_active: number;
  available_stock: number;
  expired_stock: number;
  active_batch_count: number;
  fifo_value: number;
  next_fifo_batch: Batch | null;
  batches: Batch[];
}

export interface FifoAllocationSlice {
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

export interface FifoPreviewItem {
  product_id: number;
  sufficient: boolean;
  available_qty: number;
  expired_qty: number;
  allocations: FifoAllocationSlice[];
  fifo_cost_total: number;
  suggested_selling_price: number;
  suggested_mrp: number;
}

export interface HsnCode {
  id: number;
  org_id: number;
  code: string;
  description: string;
  gst_rate: number;
  cess_rate: number;
  category: 'GOODS' | 'SERVICES';
}

export interface Customer {
  id: number;
  org_id: number;
  name: string;
  customer_type: 'B2C' | 'B2B';
  phone: string;
  email: string;
  gstin: string;
  state_name: string;
  state_code: string;
  address: string;
  credit_limit: number;
  opening_balance: number;
  current_balance: number;
  opening_bv?: number;
  earned_bv?: number;
  total_bv?: number;
  notes: string;
  invoice_count?: number;
  total_billed?: number;
}

export interface Supplier {
  id: number;
  org_id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  gstin: string;
  state_name: string;
  state_code: string;
  address: string;
  upi_id: string;
  bank_details: string;
  opening_balance: number;
  current_balance: number;
  notes: string;
  purchase_count?: number;
  total_purchased?: number;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  unit: string;
  batch_id: number;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  hsn_code: string;
  quantity: number;
  free_qty: number;
  cost_price: number;
  mrp: number;
  selling_price: number;
  taxable_amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  supplier_invoice_no: string;
  supplier_id: number;
  supplier_name: string;
  supplier_gstin: string;
  supplier_upi_id: string;
  supplier_phone: string;
  supplier_state: string;
  supplier_address?: string;
  purchase_date: string;
  due_date: string;
  is_gst: number;
  supply_type: string;
  subtotal: number;
  discount_amount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  payment_mode: string;
  payment_ref: string;
  status: string;
  notes: string;
  items: PurchaseItem[];
}

export interface InvoiceItemBatch {
  id: number;
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  cost_price: number;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  unit: string;
  hsn_code: string;
  quantity: number;
  mrp: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  taxable_amount: number;
  gst_rate: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  line_total: number;
  fifo_cost_total: number;
  bv_per_unit: number;
  bv_included: number;
  line_bv_total: number;
  batch_summary: string;
  expiry_summary: string;
  batches?: InvoiceItemBatch[];
}

export interface Invoice {
  id: number;
  invoice_number: string;
  invoice_type: 'TAX_INVOICE' | 'BILL_OF_SUPPLY';
  is_gst: number;
  tax_inclusive: number;
  supply_type: 'INTRA' | 'INTER' | 'NONE';
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_gstin: string;
  customer_address: string;
  place_of_supply: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  item_discount_total: number;
  bill_discount: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  round_off: number;
  grand_total: number;
  total_fifo_cost: number;
  total_bv: number;
  show_bv_on_bill: number;
  customer_total_bv?: number | null;
  amount_paid: number;
  balance_due: number;
  payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  payment_mode: string;
  payment_ref: string;
  upi_uri: string;
  qr_confirmed_at: string;
  status: 'ISSUED' | 'CANCELLED';
  notes: string;
  items: InvoiceItem[];
}

export interface LedgerVoucherItem {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  unit: string;
  quantity: number;
  free_qty?: number;
  unit_price?: number;
  cost_price?: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_rate: number;
  line_total: number;
  bv_per_unit?: number;
  bv_included?: number;
  line_bv_total?: number;
  batch_summary?: string;
  batch_number?: string;
  expiry_summary?: string;
  expiry_date?: string;
}

export interface LedgerVoucherMeta {
  kind: 'INVOICE' | 'PURCHASE';
  id: number;
  voucher_number: string;
  supplier_invoice_no?: string;
  voucher_date: string;
  is_gst: number;
  grand_total: number;
  total_tax: number;
  total_bv?: number;
  payment_status: string;
  status: string;
  item_count: number;
}

export interface LedgerEntry {
  id: number;
  party_type: 'CUSTOMER' | 'SUPPLIER';
  party_id: number;
  party_name?: string;
  entry_date: string;
  entry_type: string;
  voucher_no: string;
  reference_id: number | null;
  linked_invoice_id?: number;
  linked_purchase_id?: number;
  voucher_meta?: LedgerVoucherMeta;
  voucher_items?: LedgerVoucherItem[];
  debit: number;
  credit: number;
  balance_after: number;
  payment_mode: string;
  payment_ref: string;
  narration: string;
}

export type NavSection =
  | 'dashboard'
  | 'billing'
  | 'inventory'
  | 'purchases'
  | 'ledgers'
  | 'reports'
  | 'settings';
