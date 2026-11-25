import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Minus,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBV, formatDate, formatINR, getExpiryMeta, getTodayISO } from '../lib/format';
import {
  Customer,
  IndianState,
  Invoice,
  Organization,
  Product,
} from '../types';
import {
  HandToHandQrConfirmPayload,
  HandToHandQrModal,
} from '../components/HandToHandQrModal';

interface CartLine {
  product_id: number;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  preferred_batch_id: number | null;
  bv_per_unit: number;
  bv_included: boolean;
}

interface PosBillingViewProps {
  organization: Organization;
  states: IndianState[];
  initialSubTab?: string;
  onOpenInvoicePrint: (invoice: Invoice, initialFormat?: 'A4' | 'THERMAL' | 'OWNER_BV') => void;
  onOpenSettleInvoice: (invoice: Invoice) => void;
  onGlobalRefresh: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const PosBillingView: React.FC<PosBillingViewProps> = ({
  organization,
  states,
  initialSubTab,
  onOpenInvoicePrint,
  onOpenSettleInvoice,
  onGlobalRefresh,
  notify,
}) => {
  const [subTab, setSubTab] = useState<'POS' | 'HISTORY'>(
    initialSubTab === 'history' ? 'HISTORY' : 'POS'
  );

  useEffect(() => {
    if (initialSubTab === 'history') setSubTab('HISTORY');
    if (initialSubTab === 'new') setSubTab('POS');
  }, [initialSubTab]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [today, setToday] = useState(getTodayISO());
  const [loading, setLoading] = useState(true);

  // Catalog search & filter
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Bill Composer State
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [buyerStateCode, setBuyerStateCode] = useState(organization.state_code || '09');
  const [isGstBill, setIsGstBill] = useState<boolean>(Boolean(organization.gst_enabled));
  const [taxInclusive, setTaxInclusive] = useState<boolean>(
    Boolean(organization.default_tax_inclusive)
  );
  const [billDiscount, setBillDiscount] = useState<string>('0');
  const [showBvOnBill, setShowBvOnBill] = useState<boolean>(false);
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Sync default GST toggle if organization-level toggle changes while cart is empty
  useEffect(() => {
    setIsGstBill(Boolean(organization.gst_enabled));
    setTaxInclusive(Boolean(organization.default_tax_inclusive));
  }, [organization.gst_enabled, organization.default_tax_inclusive]);

  // Quick Add Customer Modal
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [qcName, setQcName] = useState('');
  const [qcPhone, setQcPhone] = useState('');
  const [qcType, setQcType] = useState<'B2C' | 'B2B'>('B2C');
  const [qcGstin, setQcGstin] = useState('');
  const [qcStateCode, setQcStateCode] = useState(organization.state_code || '09');

  // Checkout QR Modal + Newly Issued Banner
  const [qrCheckoutOpen, setQrCheckoutOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [lastIssuedInvoice, setLastIssuedInvoice] = useState<Invoice | null>(null);

  // History filters
  const [invSearch, setInvSearch] = useState('');
  const [invFilter, setInvFilter] = useState<'ALL' | 'GST' | 'NON_GST' | 'DUE' | 'UPI'>('ALL');

  const fetchPosData = async () => {
    setLoading(true);
    try {
      const [prodRes, custRes, invRes] = await Promise.all([
        apiFetch<{ products: Product[]; today: string }>('/products'),
        apiFetch<{ customers: Customer[] }>('/customers'),
        apiFetch<{ invoices: Invoice[] }>('/invoices'),
      ]);
      setProducts(prodRes.products || []);
      setToday(prodRes.today || getTodayISO());
      setCustomers(custRes.customers || []);
      setInvoices(invRes.invoices || []);
    } catch (err: any) {
      notify(err.message || 'Failed to load billing data', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosData();
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  useEffect(() => {
    if (selectedCustomer) {
      setBuyerStateCode(selectedCustomer.state_code || organization.state_code || '09');
    } else {
      setBuyerStateCode(organization.state_code || '09');
    }
  }, [selectedCustomer, organization.state_code]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ['ALL', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.hsn_code || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, selectedCategory]);

  // Client-side exact FIFO allocation preview (mirrors backend 1:1 for zero-latency UI!)
  const cartEnriched = useMemo(() => {
    const supplyType = !isGstBill
      ? 'NONE'
      : buyerStateCode === organization.state_code
        ? 'INTRA'
        : 'INTER';

    return cart
      .map((line) => {
        const product = products.find((p) => p.id === line.product_id);
        if (!product) return null;

        const sellableBatches = (product.batches || []).filter(
          (b) =>
            b.status === 'ACTIVE' &&
            Number(b.remaining_qty) > 0 &&
            (!b.expiry_date || b.expiry_date >= today)
        );

        const orderedBatches = [...sellableBatches];
        if (line.preferred_batch_id) {
          const idx = orderedBatches.findIndex((b) => b.id === line.preferred_batch_id);
          if (idx > 0) {
            const [picked] = orderedBatches.splice(idx, 1);
            orderedBatches.unshift(picked);
          }
        }

        let need = Number(line.quantity);
        const allocations: Array<{
          batch_id: number;
          batch_number: string;
          expiry_date: string;
          qty: number;
          cost_price: number;
        }> = [];

        for (const b of orderedBatches) {
          if (need <= 0) break;
          const take = Math.min(need, Number(b.remaining_qty));
          if (take > 0) {
            allocations.push({
              batch_id: b.id,
              batch_number: b.batch_number,
              expiry_date: b.expiry_date,
              qty: Math.round(take * 100) / 100,
              cost_price: Number(b.cost_price),
            });
            need = Math.round((need - take) * 100) / 100;
          }
        }

        const gross = line.quantity * line.unit_price;
        const discAmt = (gross * (line.discount_percent || 0)) / 100;
        const afterDisc = Math.max(0, gross - discAmt);
        const gstRate = isGstBill ? Number(product.gst_rate || 0) : 0;

        let taxable = afterDisc;
        let cgst = 0;
        let sgst = 0;
        let igst = 0;
        let lineTotal = afterDisc;

        if (isGstBill && gstRate > 0) {
          if (taxInclusive) {
            taxable = afterDisc / (1 + gstRate / 100);
            const taxAmt = afterDisc - taxable;
            if (supplyType === 'INTRA') {
              cgst = taxAmt / 2;
              sgst = taxAmt - cgst;
            } else {
              igst = taxAmt;
            }
            lineTotal = afterDisc;
          } else {
            taxable = afterDisc;
            if (supplyType === 'INTRA') {
              cgst = (taxable * (gstRate / 2)) / 100;
              sgst = (taxable * (gstRate / 2)) / 100;
            } else {
              igst = (taxable * gstRate) / 100;
            }
            lineTotal = taxable + cgst + sgst + igst;
          }
        }

        const lineBvTotal = line.bv_included
          ? Math.round(line.quantity * Math.max(0, Number(line.bv_per_unit || 0)) * 100) / 100
          : 0;

        return {
          ...line,
          product,
          sellableBatches,
          allocations,
          insufficient: need > 0,
          gross,
          discAmt,
          taxable,
          gstRate,
          cgst,
          sgst,
          igst,
          lineTotal,
          lineBvTotal,
        };
      })
      .filter(Boolean) as any[];
  }, [cart, products, isGstBill, taxInclusive, buyerStateCode, organization.state_code, today]);

  const totals = useMemo(() => {
    const subtotal = cartEnriched.reduce((s, l) => s + l.gross, 0);
    const itemDisc = cartEnriched.reduce((s, l) => s + l.discAmt, 0);
    const taxable = cartEnriched.reduce((s, l) => s + l.taxable, 0);
    const cgst = cartEnriched.reduce((s, l) => s + l.cgst, 0);
    const sgst = cartEnriched.reduce((s, l) => s + l.sgst, 0);
    const igst = cartEnriched.reduce((s, l) => s + l.igst, 0);
    const totalTax = cgst + sgst + igst;
    const extraDisc = Math.max(0, parseFloat(billDiscount) || 0);
    const grandTotal = Math.max(0, Math.round((taxable + totalTax - extraDisc) * 100) / 100);
    const totalBv = Math.round(cartEnriched.reduce((s, l) => s + l.lineBvTotal, 0) * 100) / 100;
    const bvActiveLines = cartEnriched.filter((l) => l.bv_included && l.bv_per_unit > 0).length;
    const bvRemovedLines = cartEnriched.filter((l) => !l.bv_included && l.bv_per_unit > 0).length;
    const hasAnyBvConfigured = cartEnriched.some(
      (l) => l.bv_per_unit > 0 || Number(l.product.default_bv || 0) > 0
    );
    const hasInsufficient = cartEnriched.some((l) => l.insufficient);

    return {
      subtotal,
      itemDisc,
      taxable,
      cgst,
      sgst,
      igst,
      totalTax,
      extraDisc,
      grandTotal,
      totalBv,
      bvActiveLines,
      bvRemovedLines,
      hasAnyBvConfigured,
      hasInsufficient,
    };
  }, [cartEnriched, billDiscount]);

  const addProductToCart = (product: Product) => {
    if (product.available_stock <= 0) {
      notify(
        product.expired_stock > 0
          ? `Cannot add "${product.name}" — only expired stock (${product.expired_stock} ${product.unit}) remains!`
          : `"${product.name}" is out of stock. Record a purchase or opening batch first.`,
        'error'
      );
      return;
    }

    setLastIssuedInvoice(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.available_stock) {
          notify(
            `Max available non-expired FIFO stock for ${product.name} is ${product.available_stock} ${product.unit}`,
            'error'
          );
          return prev;
        }
        return prev.map((l) =>
          l.product_id === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      const nextPrice = product.next_fifo_batch
        ? Number(product.next_fifo_batch.selling_price)
        : Number(product.default_selling_price);
      return [
        ...prev,
        {
          product_id: product.id,
          quantity: 1,
          unit_price: nextPrice,
          discount_percent: 0,
          preferred_batch_id: null,
          bv_per_unit: Math.max(0, Number(product.default_bv || 0)),
          bv_included: true,
        },
      ];
    });
  };

  const updateCartLine = (productId: number, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev
        .map((l) => (l.product_id === productId ? { ...l, ...patch } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ customer: Customer }>('/customers', {
        method: 'POST',
        body: JSON.stringify({
          name: qcName,
          phone: qcPhone,
          customer_type: qcType,
          gstin: qcType === 'B2B' ? qcGstin : '',
          state_code: qcStateCode,
        }),
      });
      setCustomers((prev) => [...prev, res.customer]);
      setSelectedCustomerId(res.customer.id);
      setShowQuickCustomer(false);
      setQcName('');
      setQcPhone('');
      setQcGstin('');
      notify(`Client "${res.customer.name}" added & selected`);
    } catch (err: any) {
      notify(err.message || 'Failed to add client', 'error');
    }
  };

  const handleConfirmAndIssueInvoice = async (payment: HandToHandQrConfirmPayload) => {
    setIssuing(true);
    try {
      const buyerSt = states.find((s) => s.code === buyerStateCode);
      const res = await apiFetch<{ invoice: Invoice }>('/invoices', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: selectedCustomerId,
          customer_name: selectedCustomer
            ? selectedCustomer.name
            : walkInName.trim() || 'Walk-in Consumer',
          customer_phone: selectedCustomer ? selectedCustomer.phone : walkInPhone.trim(),
          customer_gstin: selectedCustomer ? selectedCustomer.gstin : '',
          customer_address: selectedCustomer ? selectedCustomer.address : '',
          buyer_state_code: buyerStateCode,
          buyer_state_name: buyerSt?.name || organization.state_name,
          is_gst: isGstBill,
          tax_inclusive: taxInclusive,
          bill_discount: parseFloat(billDiscount) || 0,
          show_bv_on_bill: showBvOnBill,
          payment_mode: payment.payment_mode,
          amount_paid: payment.amount_paid,
          payment_ref: payment.payment_ref,
          qr_confirmed: payment.qr_confirmed,
          notes: invoiceNotes,
          items: cart.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_percent: l.discount_percent,
            preferred_batch_id: l.preferred_batch_id,
            bv_per_unit: l.bv_per_unit,
            bv_included: l.bv_included,
          })),
        }),
      });

      setQrCheckoutOpen(false);
      setCart([]);
      setBillDiscount('0');
      setShowBvOnBill(false);
      setInvoiceNotes('');
      setWalkInName('');
      setWalkInPhone('');
      setLastIssuedInvoice(res.invoice);
      setInvoices((prev) => [res.invoice, ...prev]);
      notify(
        `Bill ${res.invoice.invoice_number} confirmed & issued (${formatINR(res.invoice.grand_total)})!`
      );
      await fetchPosData();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to issue bill', 'error');
    } finally {
      setIssuing(false);
    }
  };

  const handleCancelInvoice = async (inv: Invoice) => {
    if (
      !window.confirm(
        `Cancel bill ${inv.invoice_number}? Exact FIFO batch quantities will be restored to inventory and customer khata adjusted.`
      )
    ) {
      return;
    }
    // Optimistic update
    setInvoices((prev) =>
      prev.map((i) => (i.id === inv.id ? { ...i, status: 'CANCELLED', balance_due: 0 } : i))
    );
    try {
      await apiFetch(`/invoices/${inv.id}/cancel`, { method: 'POST' });
      notify(`Invoice ${inv.invoice_number} cancelled & FIFO batches restored`);
      fetchPosData();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to cancel invoice', 'error');
      fetchPosData();
    }
  };

  const filteredInvoices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (invFilter === 'GST' && !inv.is_gst) return false;
      if (invFilter === 'NON_GST' && inv.is_gst) return false;
      if (invFilter === 'DUE' && (inv.status !== 'ISSUED' || inv.balance_due <= 0)) return false;
      if (invFilter === 'UPI' && inv.payment_mode !== 'UPI_QR') return false;
      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.customer_name.toLowerCase().includes(q) ||
        (inv.customer_phone || '').toLowerCase().includes(q) ||
        (inv.payment_ref || '').toLowerCase().includes(q)
      );
    });
  }, [invoices, invSearch, invFilter]);

  return (
    <div className="space-y-5">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setSubTab('POS')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              subTab === 'POS'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            POS Counter & QR Billing
          </button>
          <button
            type="button"
            onClick={() => setSubTab('HISTORY')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
              subTab === 'HISTORY'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            Invoices Register ({invoices.length})
          </button>
        </div>

        {/* Celebratory Banner right after issuing a bill */}
        {lastIssuedInvoice && subTab === 'POS' && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs">
            <span className="inline-flex items-center gap-1.5 font-bold text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Issued {lastIssuedInvoice.invoice_number} ({formatINR(lastIssuedInvoice.grand_total)})
            </span>
            {Number(lastIssuedInvoice.total_bv || 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 border border-violet-300 px-2.5 py-0.5 text-[11px] font-bold text-violet-900">
                <Sparkles className="h-3 w-3 text-violet-700" />
                {formatBV(lastIssuedInvoice.total_bv)}
              </span>
            )}
            <button
              type="button"
              onClick={() => onOpenInvoicePrint(lastIssuedInvoice, 'A4')}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1 font-semibold text-white hover:bg-emerald-800"
            >
              <Printer className="h-3.5 w-3.5" />
              Customer Bill
            </button>
            <button
              type="button"
              onClick={() => onOpenInvoicePrint(lastIssuedInvoice, 'OWNER_BV')}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-1 font-semibold text-white hover:bg-violet-800"
              title="Open Internal Owner's BV Record Copy"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Owner BV Copy
            </button>
          </div>
        )}
      </div>

      {subTab === 'POS' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT: Product Catalog with Live FIFO Batch Indicators */}
          <div className="xl:col-span-7 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search item name, SKU, barcode, or HSN code..."
                  className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold border transition ${
                    selectedCategory === cat
                      ? 'border-teal-600 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Product Cards Grid */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-pulse">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-28 rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="py-12 text-center">
                <Boxes className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No matching products found</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Try clearing search filters or add new items in Inventory.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[640px] overflow-y-auto pr-1">
                {filteredProducts.map((p) => {
                  const inCart = cart.find((c) => c.product_id === p.id);
                  const nextBatch = p.next_fifo_batch;
                  const expMeta = getExpiryMeta(nextBatch?.expiry_date, today);
                  const sellPrice = nextBatch
                    ? Number(nextBatch.selling_price)
                    : Number(p.default_selling_price);
                  const mrpPrice = nextBatch ? Number(nextBatch.mrp) : Number(p.default_mrp);
                  const outOfStock = p.available_stock <= 0;

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addProductToCart(p)}
                      className={`group relative text-left rounded-xl border p-3.5 transition ${
                        outOfStock
                          ? 'border-slate-200 bg-slate-50/70 opacity-65 cursor-not-allowed'
                          : inCart
                            ? 'border-teal-600 bg-teal-50/40 ring-1 ring-teal-600'
                            : 'border-slate-200 bg-white hover:border-teal-500 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-900">
                            {p.name}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {p.sku}
                            {isGstBill && p.hsn_code ? ` • HSN ${p.hsn_code}` : ''}
                            {isGstBill ? ` • GST ${p.gst_rate}%` : ''}
                          </div>
                        </div>

                        {inCart && (
                          <span className="shrink-0 rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold text-white tabular-nums">
                            {inCart.quantity} in bill
                          </span>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-baseline justify-between">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-sm font-extrabold text-slate-900 tabular-nums">
                            {formatINR(sellPrice)}
                          </span>
                          {mrpPrice > sellPrice && (
                            <span className="text-[10px] text-slate-400 line-through tabular-nums">
                              MRP {formatINR(mrpPrice)}
                            </span>
                          )}
                          {Number(p.default_bv || 0) > 0 && (
                            <span className="rounded bg-violet-50 border border-violet-200 px-1.5 py-0.2 text-[10px] font-bold text-violet-800 tabular-nums">
                              {formatBV(p.default_bv)}
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[11px] font-bold tabular-nums ${
                            outOfStock
                              ? 'text-rose-600'
                              : p.available_stock <= p.reorder_level
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {p.available_stock} {p.unit}
                        </span>
                      </div>

                      {/* FIFO Batch Preview Strip */}
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-[10px]">
                        {nextBatch ? (
                          <>
                            <span className="font-mono text-slate-600 truncate">
                              FIFO #{nextBatch.batch_number} ({nextBatch.remaining_qty})
                            </span>
                            {nextBatch.expiry_date && (
                              <span
                                className={`shrink-0 rounded border px-1.5 py-0.2 font-semibold ${expMeta.badgeClass}`}
                              >
                                {expMeta.label}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-rose-600 font-medium">
                            {p.expired_stock > 0
                              ? `Only expired stock (${p.expired_stock}) left`
                              : 'No active FIFO batch'}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Invoice Cart, GST/Non-GST Toggle, FIFO Split & QR Checkout */}
          <div className="xl:col-span-5 rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            {/* Invoice Mode & GST Toggle Header */}
            <div className="border-b border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Current Counter Bill</h3>
                  <p className="text-[11px] text-slate-500">
                    {isGstBill
                      ? buyerStateCode === organization.state_code
                        ? `GST Tax Invoice • Intra-State CGST+SGST (${organization.state_code})`
                        : `GST Tax Invoice • Inter-State IGST (${organization.state_code} → ${buyerStateCode})`
                      : 'Non-GST Retail Bill of Supply (Tax Skipped)'}
                  </p>
                </div>

                {/* Per-Invoice GST Toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsGstBill((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition ${
                      isGstBill
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                    title="Users with GSTIN can enable GST; users without GST can skip it"
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        isGstBill ? 'bg-indigo-600' : 'bg-slate-400'
                      }`}
                    />
                    {isGstBill ? 'GST: ON' : 'GST: SKIPPED'}
                  </button>

                  {isGstBill && (
                    <button
                      type="button"
                      onClick={() => setTaxInclusive((v) => !v)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                      title="Switch between Tax Exclusive and MRP/Tax Inclusive rates"
                    >
                      {taxInclusive ? 'Tax Incl.' : 'Tax Excl.'}
                    </button>
                  )}
                </div>
              </div>

              {/* Customer Selector */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCustomerId ?? ''}
                    onChange={(e) =>
                      setSelectedCustomerId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium focus:border-teal-600 focus:outline-none"
                  >
                    <option value="">Walk-in Retail Consumer (Direct)</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.customer_type}
                        {c.current_balance > 0 ? ` • Due ${formatINR(c.current_balance)}` : ''})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowQuickCustomer(true)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                    title="Quick Add New Client"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>

                {!selectedCustomer && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Consumer Name (Optional)"
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Consumer Mobile (Optional)"
                      value={walkInPhone}
                      onChange={(e) => setWalkInPhone(e.target.value)}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                )}

                {selectedCustomer && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px]">
                    <span className="text-slate-600">
                      State:{' '}
                      <strong className="text-slate-800">
                        {selectedCustomer.state_name} ({selectedCustomer.state_code})
                      </strong>
                      {isGstBill && selectedCustomer.gstin
                        ? ` • GSTIN: ${selectedCustomer.gstin}`
                        : ''}
                    </span>
                    <div className="flex items-center gap-2.5 tabular-nums">
                      <span className="font-bold text-violet-800">
                        Accumulated BV: {formatBV(selectedCustomer.total_bv || 0)}
                      </span>
                      <span className="font-semibold text-amber-800">
                        Khata Bal: {formatINR(selectedCustomer.current_balance)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
              {cartEnriched.length === 0 ? (
                <div className="py-12 px-6 text-center">
                  <QrCode className="h-9 w-9 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    Click any product on the left to build a bill
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    FIFO batches auto-allocate oldest non-expired stock & generate a scannable payment QR.
                  </p>
                </div>
              ) : (
                cartEnriched.map((line) => (
                  <div key={line.product_id} className="p-3.5 space-y-2 hover:bg-slate-50/60">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {line.product.name}
                        </div>
                        {/* FIFO Batch Allocation Badge */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {line.allocations.map((a: any) => (
                            <span
                              key={a.batch_id}
                              className="inline-flex items-center rounded bg-teal-50 border border-teal-200 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-teal-800"
                            >
                              FIFO #{a.batch_number} × {a.qty}
                            </span>
                          ))}
                          {line.insufficient && (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-50 border border-rose-200 px-1.5 py-0.2 text-[10px] font-bold text-rose-700">
                              <AlertCircle className="h-3 w-3" /> Exceeds stock!
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => updateCartLine(line.product_id, { quantity: 0 })}
                        className="text-slate-400 hover:text-rose-600 p-1"
                        title="Remove item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Qty, Rate, Disc %, Batch Override & Line Total */}
                    <div className="grid grid-cols-12 gap-2 items-center text-xs">
                      <div className="col-span-4 flex items-center rounded-lg border border-slate-300 bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            updateCartLine(line.product_id, { quantity: line.quantity - 1 })
                          }
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          min="0.1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) =>
                            updateCartLine(line.product_id, {
                              quantity: Math.max(0.1, parseFloat(e.target.value) || 0),
                            })
                          }
                          className="w-full text-center font-bold tabular-nums focus:outline-none text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (line.quantity + 1 <= line.product.available_stock) {
                              updateCartLine(line.product_id, { quantity: line.quantity + 1 });
                            } else {
                              notify(`Max available stock is ${line.product.available_stock}`, 'error');
                            }
                          }}
                          className="px-2 py-1 text-slate-600 hover:bg-slate-100"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>

                      <div className="col-span-3">
                        <input
                          type="number"
                          step="0.01"
                          value={line.unit_price}
                          onChange={(e) =>
                            updateCartLine(line.product_id, {
                              unit_price: Math.max(0, parseFloat(e.target.value) || 0),
                            })
                          }
                          title="Unit Selling Rate (₹)"
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-right font-semibold tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>

                      <div className="col-span-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={line.discount_percent || ''}
                          placeholder="0%"
                          onChange={(e) =>
                            updateCartLine(line.product_id, {
                              discount_percent: Math.min(
                                100,
                                Math.max(0, parseFloat(e.target.value) || 0)
                              ),
                            })
                          }
                          title="Discount %"
                          className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-right tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>

                      <div className="col-span-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatINR(line.lineTotal)}
                      </div>
                    </div>

                    {/* Per-Line BV (Business Value) Control — Separate from ₹ Price */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-100 bg-violet-50/50 px-2.5 py-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            updateCartLine(line.product_id, {
                              bv_included: !line.bv_included,
                            })
                          }
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold transition ${
                            line.bv_included
                              ? 'border-violet-300 bg-violet-600 text-white hover:bg-violet-700'
                              : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100'
                          }`}
                          title={
                            line.bv_included
                              ? 'Click to remove BV from this product on this bill'
                              : 'BV removed for this product — click to re-enable'
                          }
                        >
                          {line.bv_included ? 'BV ON' : 'BV Removed'}
                        </button>
                        <span className="text-slate-500">BV/Unit:</span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={!line.bv_included}
                          value={line.bv_per_unit || ''}
                          placeholder="0"
                          onChange={(e) =>
                            updateCartLine(line.product_id, {
                              bv_per_unit: Math.max(0, parseFloat(e.target.value) || 0),
                            })
                          }
                          className="w-16 rounded border border-violet-200 bg-white px-1.5 py-0.5 text-right text-[11px] font-bold text-violet-900 tabular-nums disabled:opacity-45"
                        />
                      </div>

                      <div className="font-bold tabular-nums">
                        {line.bv_included ? (
                          line.lineBvTotal > 0 ? (
                            <span className="text-violet-900">= {formatBV(line.lineBvTotal)}</span>
                          ) : (
                            <span className="text-slate-400">0 BV</span>
                          )
                        ) : (
                          <span className="text-rose-600 line-through">
                            {formatBV(line.quantity * (line.bv_per_unit || 0))}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Optional Manual Batch Override when > 1 active batch exists */}
                    {line.sellableBatches.length > 1 && (
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                        <span>Batch Selection:</span>
                        <select
                          value={line.preferred_batch_id ?? ''}
                          onChange={(e) =>
                            updateCartLine(line.product_id, {
                              preferred_batch_id: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                        >
                          <option value="">Auto-FIFO (Oldest First)</option>
                          {line.sellableBatches.map((b: any) => (
                            <option key={b.id} value={b.id}>
                              #{b.batch_number} ({b.remaining_qty} left • ₹{b.selling_price})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Bill Totals & Hand-to-Hand QR Checkout Trigger */}
            <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="space-y-1.5 text-xs tabular-nums">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal ({cartEnriched.length} items)</span>
                  <span>{formatINR(totals.subtotal)}</span>
                </div>
                {totals.itemDisc > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Item Discounts</span>
                    <span>-{formatINR(totals.itemDisc)}</span>
                  </div>
                )}
                {isGstBill && (
                  <div className="flex justify-between text-indigo-700 font-medium">
                    <span>
                      {buyerStateCode === organization.state_code
                        ? `CGST (${formatINR(totals.cgst)}) + SGST (${formatINR(totals.sgst)})`
                        : `IGST (${formatINR(totals.igst)})`}
                    </span>
                    <span>+{formatINR(totals.totalTax)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-600">Extra Bill Discount (₹)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={billDiscount}
                    onChange={(e) => setBillDiscount(e.target.value)}
                    className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-xs font-semibold tabular-nums focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <div className="flex items-baseline justify-between border-t border-slate-300 pt-2.5">
                  <span className="text-sm font-bold text-slate-900">Payable Total</span>
                  <span className="text-xl font-extrabold text-slate-900">
                    {formatINR(totals.grandTotal)}
                  </span>
                </div>
              </div>

              {/* Separate Non-Monetary Business Value (BV) Section */}
              {cartEnriched.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-bold text-violet-950">
                      <Sparkles className="h-3.5 w-3.5 text-violet-700" />
                      Business Value (BV) — Separate from ₹ Bill
                    </span>
                    <span className="text-sm font-extrabold text-violet-900 tabular-nums">
                      {formatBV(totals.totalBv)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-violet-800">
                    <span>
                      {totals.bvActiveLines} item(s) with BV
                      {totals.bvRemovedLines > 0
                        ? ` • ${totals.bvRemovedLines} removed on bill`
                        : ''}
                    </span>
                    {selectedCustomer && (
                      <span className="font-semibold tabular-nums">
                        Client Total: {formatBV(selectedCustomer.total_bv || 0)} →{' '}
                        {formatBV((selectedCustomer.total_bv || 0) + totals.totalBv)}
                      </span>
                    )}
                  </div>

                  <label className="flex items-center justify-between gap-2 pt-1.5 border-t border-violet-200/80 cursor-pointer select-none">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                      {showBvOnBill ? (
                        <Eye className="h-3.5 w-3.5 text-violet-700" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      {showBvOnBill
                        ? 'BV Allowed on Customer Invoice'
                        : 'Hidden on Customer Invoice (Owner Copy Only)'}
                    </span>
                    <input
                      type="checkbox"
                      checked={showBvOnBill}
                      onChange={(e) => setShowBvOnBill(e.target.checked)}
                      className="h-4 w-4 rounded border-violet-300 text-violet-700 focus:ring-violet-600"
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    title="Clear Cart"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}

                <button
                  type="button"
                  disabled={cart.length === 0 || totals.hasInsufficient || totals.grandTotal <= 0}
                  onClick={() => setQrCheckoutOpen(true)}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-bold text-white shadow-xs hover:bg-teal-800 disabled:opacity-50 transition"
                >
                  <QrCode className="h-4 w-4" />
                  Generate Payment QR & Issue ({formatINR(totals.grandTotal)})
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ISSUED INVOICES REGISTER */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="Search invoice no, customer, phone, or UPI UTR..."
                className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['ALL', 'All Bills'],
                  ['GST', 'GST Invoices'],
                  ['NON_GST', 'Non-GST Bills'],
                  ['UPI', 'UPI QR Paid'],
                  ['DUE', 'Pending / Credit'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setInvFilter(key)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition ${
                    invFilter === key
                      ? 'border-teal-600 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              No invoices match your filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Invoice #</th>
                    <th className="py-3 px-3 text-left font-semibold">Date</th>
                    <th className="py-3 px-3 text-left font-semibold">Customer</th>
                    <th className="py-3 px-3 text-left font-semibold">Regime</th>
                    <th className="py-3 px-3 text-right font-semibold">Tax</th>
                    <th className="py-3 px-3 text-right font-semibold">Grand Total</th>
                    <th className="py-3 px-3 text-right font-semibold">BV (Internal)</th>
                    <th className="py-3 px-3 text-right font-semibold">Balance Due</th>
                    <th className="py-3 px-3 text-center font-semibold">Payment</th>
                    <th className="py-3 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50/80 ${
                        inv.status === 'CANCELLED' ? 'opacity-55 bg-slate-50' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 px-3 text-slate-600">{formatDate(inv.invoice_date)}</td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">{inv.customer_name}</div>
                        {inv.customer_gstin && (
                          <div className="font-mono text-[10px] text-slate-500">
                            {inv.customer_gstin}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            inv.is_gst
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {inv.is_gst
                            ? inv.supply_type === 'INTER'
                              ? 'IGST'
                              : 'CGST+SGST'
                            : 'Non-GST'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-slate-600">
                        {inv.is_gst ? formatINR(inv.total_tax) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatINR(inv.grand_total)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {Number(inv.total_bv || 0) > 0 ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[10px] font-bold text-violet-800">
                              {formatBV(inv.total_bv)}
                            </span>
                            <span className="text-[9px] text-slate-400 mt-0.5">
                              {inv.show_bv_on_bill ? 'Shown on bill' : 'Owner only'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-bold tabular-nums">
                        {inv.balance_due > 0 ? (
                          <span className="text-amber-700">{formatINR(inv.balance_due)}</span>
                        ) : (
                          <span className="text-slate-400">₹0.00</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                            inv.status === 'CANCELLED'
                              ? 'bg-slate-100 text-slate-500 border-slate-200'
                              : inv.payment_status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {inv.status === 'CANCELLED'
                            ? 'CANCELLED'
                            : `${inv.payment_status} • ${inv.payment_mode}`}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {inv.status === 'ISSUED' && inv.balance_due > 0 && (
                            <button
                              type="button"
                              onClick={() => onOpenSettleInvoice(inv)}
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                            >
                              <QrCode className="h-3 w-3" /> QR Settle
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenInvoicePrint(inv, 'A4')}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            <Printer className="h-3 w-3" /> Bill
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenInvoicePrint(inv, 'OWNER_BV')}
                            className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-800 hover:bg-violet-100"
                            title="Open Owner's Internal BV Record Copy"
                          >
                            <Sparkles className="h-3 w-3" /> BV Copy
                          </button>
                          {inv.status === 'ISSUED' && (
                            <button
                              type="button"
                              onClick={() => handleCancelInvoice(inv)}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                              title="Cancel Bill & Restore FIFO Batches"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Quick Add Customer Modal */}
      {showQuickCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleQuickAddCustomer}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">Quick Add Client</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Client Name *
              </label>
              <input
                type="text"
                required
                value={qcName}
                onChange={(e) => setQcName(e.target.value)}
                placeholder="Enter client or business name"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={qcPhone}
                  onChange={(e) => setQcPhone(e.target.value)}
                  placeholder="+91..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                <select
                  value={qcType}
                  onChange={(e) => setQcType(e.target.value as 'B2C' | 'B2B')}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="B2C">Consumer (B2C)</option>
                  <option value="B2B">Business (B2B GST)</option>
                </select>
              </div>
            </div>
            {qcType === 'B2B' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Buyer GSTIN
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={qcGstin}
                  onChange={(e) => setQcGstin(e.target.value.toUpperCase())}
                  placeholder="09AAAAA0000A1Z5"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
              <select
                value={qcStateCode}
                onChange={(e) => setQcStateCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} - {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowQuickCustomer(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Save & Select Client
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hand-to-Hand QR Checkout Modal */}
      <HandToHandQrModal
        open={qrCheckoutOpen}
        onClose={() => setQrCheckoutOpen(false)}
        upiId={organization.upi_id}
        payeeName={organization.upi_payee_name || organization.business_name}
        totalAmount={totals.grandTotal}
        defaultNote={`Counter Bill - ${organization.business_name}`}
        allowModeSwitch
        allowCreditLedger={Boolean(selectedCustomer)}
        customerName={
          selectedCustomer
            ? selectedCustomer.name
            : walkInName.trim() || 'Walk-in Consumer'
        }
        itemCount={cartEnriched.length}
        isGstBill={isGstBill}
        submitting={issuing}
        onConfirm={handleConfirmAndIssueInvoice}
      />
    </div>
  );
};
