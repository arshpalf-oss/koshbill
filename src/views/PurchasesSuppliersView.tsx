import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Edit3,
  FilePlus2,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatDate, formatINR, getTodayISO } from '../lib/format';
import { IndianState, Organization, Product, Purchase, Supplier } from '../types';
import {
  HandToHandQrConfirmPayload,
  HandToHandQrModal,
} from '../components/HandToHandQrModal';

interface PurchaseRowDraft {
  id: string;
  product_id: number;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  quantity: number;
  free_qty: number;
  cost_price: number;
  mrp: number;
  selling_price: number;
  gst_rate: number;
}

interface PurchasesSuppliersViewProps {
  organization: Organization;
  states: IndianState[];
  initialSubTab?: string;
  onGlobalRefresh: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const PurchasesSuppliersView: React.FC<PurchasesSuppliersViewProps> = ({
  organization,
  states,
  initialSubTab,
  onGlobalRefresh,
  notify,
}) => {
  const [tab, setTab] = useState<'HISTORY' | 'NEW' | 'SUPPLIERS'>(
    initialSubTab === 'new' ? 'NEW' : 'HISTORY'
  );

  useEffect(() => {
    if (initialSubTab === 'new') setTab('NEW');
  }, [initialSubTab]);

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [today, setToday] = useState(getTodayISO());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedPurchaseId, setExpandedPurchaseId] = useState<number | null>(null);

  // New Purchase Form State
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(getTodayISO());
  const [dueDate, setDueDate] = useState('');
  const [isGstPurchase, setIsGstPurchase] = useState<boolean>(Boolean(organization.gst_enabled));
  const [payMode, setPayMode] = useState<'CREDIT' | 'BANK_TRANSFER' | 'CASH' | 'UPI_QR'>('CREDIT');
  const [amountPaid, setAmountPaid] = useState<string>('0');
  const [payRef, setPayRef] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [rows, setRows] = useState<PurchaseRowDraft[]>([]);
  const [savingPurchase, setSavingPurchase] = useState(false);

  // Supplier CRUD Modal
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSup, setEditingSup] = useState<Supplier | null>(null);
  const [sForm, setSForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    gstin: '',
    state_code: organization.state_code || '09',
    address: '',
    upi_id: '',
    bank_details: '',
    opening_balance: '0',
    notes: '',
  });

  // Supplier UPI QR Payout Modal
  const [payoutSupplier, setPayoutSupplier] = useState<Supplier | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payingSupplier, setPayingSupplier] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [purRes, supRes, prodRes] = await Promise.all([
        apiFetch<{ purchases: Purchase[] }>('/purchases'),
        apiFetch<{ suppliers: Supplier[] }>('/suppliers'),
        apiFetch<{ products: Product[]; today: string }>('/products'),
      ]);
      setPurchases(purRes.purchases || []);
      setSuppliers(supRes.suppliers || []);
      setProducts(prodRes.products || []);
      const currentDay = prodRes.today || getTodayISO();
      setToday(currentDay);
      setPurchaseDate(currentDay);

      if (!supplierId && supRes.suppliers?.length > 0) {
        setSupplierId(supRes.suppliers[0].id);
      }
      if (rows.length === 0 && prodRes.products?.length > 0) {
        const first = prodRes.products[0];
        setRows([
          {
            id: 'row-1',
            product_id: first.id,
            batch_number: `BCH-${currentDay.replace(/-/g, '').slice(2)}-01`,
            mfg_date: currentDay,
            expiry_date: '',
            quantity: 20,
            free_qty: 0,
            cost_price: first.default_cost_price,
            mrp: first.default_mrp,
            selling_price: first.default_selling_price,
            gst_rate: first.gst_rate,
          },
        ]);
      }
    } catch (err: any) {
      notify(err.message || 'Failed to load purchases & suppliers', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === Number(supplierId)) || null,
    [suppliers, supplierId]
  );

  const addDraftRow = () => {
    if (products.length === 0) {
      notify('Add at least one product in Inventory first', 'error');
      return;
    }
    const p = products[0];
    setRows((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random()}`,
        product_id: p.id,
        batch_number: `BCH-${purchaseDate.replace(/-/g, '').slice(2)}-${prev.length + 1}`,
        mfg_date: purchaseDate,
        expiry_date: '',
        quantity: 10,
        free_qty: 0,
        cost_price: p.default_cost_price,
        mrp: p.default_mrp,
        selling_price: p.default_selling_price,
        gst_rate: p.gst_rate,
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<PurchaseRowDraft>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const purchaseTotals = useMemo(() => {
    const supplyType = !isGstPurchase
      ? 'NONE'
      : (selectedSupplier?.state_code || organization.state_code) === organization.state_code
        ? 'INTRA'
        : 'INTER';

    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    for (const r of rows) {
      const lineTaxable = Number(r.quantity || 0) * Number(r.cost_price || 0);
      taxable += lineTaxable;
      if (isGstPurchase && r.gst_rate > 0) {
        if (supplyType === 'INTRA') {
          cgst += (lineTaxable * (r.gst_rate / 2)) / 100;
          sgst += (lineTaxable * (r.gst_rate / 2)) / 100;
        } else {
          igst += (lineTaxable * r.gst_rate) / 100;
        }
      }
    }

    const totalTax = cgst + sgst + igst;
    const grandTotal = Math.round((taxable + totalTax) * 100) / 100;
    return { supplyType, taxable, cgst, sgst, igst, totalTax, grandTotal };
  }, [rows, isGstPurchase, selectedSupplier, organization.state_code]);

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      notify('Please select a supplier', 'error');
      return;
    }
    if (rows.length === 0) {
      notify('Add at least one line item', 'error');
      return;
    }

    setSavingPurchase(true);
    try {
      const paidVal =
        payMode === 'CREDIT' ? parseFloat(amountPaid) || 0 : purchaseTotals.grandTotal;
      const res = await apiFetch<{ purchase: Purchase }>('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: Number(supplierId),
          supplier_invoice_no: supplierInvoiceNo,
          purchase_date: purchaseDate,
          due_date: dueDate,
          is_gst: isGstPurchase,
          payment_mode: payMode,
          amount_paid: paidVal,
          payment_ref: payRef,
          notes: purchaseNotes,
          items: rows.map((r) => ({
            product_id: r.product_id,
            batch_number: r.batch_number,
            mfg_date: r.mfg_date,
            expiry_date: r.expiry_date,
            quantity: r.quantity,
            free_qty: r.free_qty,
            cost_price: r.cost_price,
            mrp: r.mrp,
            selling_price: r.selling_price,
            gst_rate: r.gst_rate,
          })),
        }),
      });

      notify(
        `Purchase ${res.purchase.purchase_number} recorded & ${rows.length} new FIFO batch(es) stocked!`
      );
      setSupplierInvoiceNo('');
      setPurchaseNotes('');
      setPayRef('');
      setTab('HISTORY');
      await loadData();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to record purchase bill', 'error');
    } finally {
      setSavingPurchase(false);
    }
  };

  const openAddSupplier = () => {
    setEditingSup(null);
    setSForm({
      name: '',
      contact_person: '',
      phone: '',
      email: '',
      gstin: '',
      state_code: organization.state_code || '09',
      address: '',
      upi_id: '',
      bank_details: '',
      opening_balance: '0',
      notes: '',
    });
    setSupModalOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSup(s);
    setSForm({
      name: s.name,
      contact_person: s.contact_person || '',
      phone: s.phone || '',
      email: s.email || '',
      gstin: s.gstin || '',
      state_code: s.state_code || '09',
      address: s.address || '',
      upi_id: s.upi_id || '',
      bank_details: s.bank_details || '',
      opening_balance: String(s.opening_balance || 0),
      notes: s.notes || '',
    });
    setSupModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSup) {
        await apiFetch(`/suppliers/${editingSup.id}`, {
          method: 'PUT',
          body: JSON.stringify(sForm),
        });
        notify(`Updated supplier "${sForm.name}"`);
      } else {
        const res = await apiFetch<{ supplier: Supplier }>('/suppliers', {
          method: 'POST',
          body: JSON.stringify({
            ...sForm,
            opening_balance: Number(sForm.opening_balance || 0),
          }),
        });
        setSupplierId(res.supplier.id);
        notify(`Added supplier "${sForm.name}"`);
      }
      setSupModalOpen(false);
      loadData();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to save supplier', 'error');
    }
  };

  const handleDeleteSupplier = async (s: Supplier) => {
    if (!window.confirm(`Delete supplier "${s.name}"?`)) return;
    try {
      await apiFetch(`/suppliers/${s.id}`, { method: 'DELETE' });
      notify(`Deleted supplier "${s.name}"`);
      loadData();
    } catch (err: any) {
      notify(err.message || 'Cannot delete supplier', 'error');
    }
  };

  const handleConfirmSupplierPayout = async (payload: HandToHandQrConfirmPayload) => {
    if (!payoutSupplier) return;
    setPayingSupplier(true);
    try {
      await apiFetch('/ledgers/payment', {
        method: 'POST',
        body: JSON.stringify({
          party_type: 'SUPPLIER',
          party_id: payoutSupplier.id,
          amount: payload.amount_paid,
          payment_mode: payload.payment_mode,
          payment_ref: payload.payment_ref,
          narration: `Supplier payout via ${payload.payment_mode}`,
        }),
      });
      notify(`Paid ${formatINR(payload.amount_paid)} to ${payoutSupplier.name}`);
      setPayoutSupplier(null);
      loadData();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to record supplier payout', 'error');
    } finally {
      setPayingSupplier(false);
    }
  };

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter(
      (p) =>
        p.purchase_number.toLowerCase().includes(q) ||
        p.supplier_name.toLowerCase().includes(q) ||
        (p.supplier_invoice_no || '').toLowerCase().includes(q)
    );
  }, [purchases, search]);

  const filteredSuppliers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.gstin || '').toLowerCase().includes(q) ||
        (s.phone || '').toLowerCase().includes(q)
    );
  }, [suppliers, search]);

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setTab('HISTORY')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'HISTORY'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingBag className="h-3.5 w-3.5" />
            Purchase Bills ({purchases.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('NEW')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'NEW'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            + Record Stock-In Purchase
          </button>
          <button
            type="button"
            onClick={() => setTab('SUPPLIERS')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'SUPPLIERS'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            Suppliers ({suppliers.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAddSupplier}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Building2 className="h-3.5 w-3.5 text-teal-700" />
            + Add Supplier
          </button>
        </div>
      </div>

      {/* TAB: NEW PURCHASE STOCK-IN COMPOSER */}
      {tab === 'NEW' && (
        <form
          onSubmit={handleSubmitPurchase}
          className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xs space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Record Supplier Purchase Bill (Creates New FIFO Inventory Batches)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every purchased line item enters your inventory as a distinct batch with Mfg/Expiry & Cost for FIFO tracking.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsGstPurchase((v) => !v)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                isGstPurchase
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                  : 'border-slate-300 bg-slate-50 text-slate-700'
              }`}
            >
              {isGstPurchase
                ? `GST Purchase (${purchaseTotals.supplyType === 'INTER' ? 'IGST ITC' : 'CGST+SGST ITC'})`
                : 'Non-GST Purchase Bill'}
            </button>
          </div>

          {/* Supplier & Dates Header */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Supplier *
              </label>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
              >
                <option value="">Choose supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.state_name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Supplier Invoice No.
              </label>
              <input
                type="text"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                placeholder="e.g. SUP/26-27/904"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Purchase / Received Date *
              </label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Credit Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
          </div>

          {/* Line Items Batch Entry Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold min-w-[200px]">Product</th>
                  <th className="py-2.5 px-2 text-left font-semibold min-w-[125px]">Batch # *</th>
                  <th className="py-2.5 px-2 text-left font-semibold">Expiry Date</th>
                  <th className="py-2.5 px-2 text-right font-semibold w-20">Qty *</th>
                  <th className="py-2.5 px-2 text-right font-semibold w-16">Free</th>
                  <th className="py-2.5 px-2 text-right font-semibold w-24">Cost Rate</th>
                  <th className="py-2.5 px-2 text-right font-semibold w-24">Sell Rate</th>
                  <th className="py-2.5 px-2 text-right font-semibold w-24">MRP</th>
                  {isGstPurchase && (
                    <th className="py-2.5 px-2 text-right font-semibold w-20">GST %</th>
                  )}
                  <th className="py-2.5 px-3 text-right font-semibold">Line Total</th>
                  <th className="py-2.5 px-2 w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const lineNet =
                    r.quantity * r.cost_price * (1 + (isGstPurchase ? r.gst_rate / 100 : 0));
                  return (
                    <tr key={r.id}>
                      <td className="py-2 px-3">
                        <select
                          value={r.product_id}
                          onChange={(e) => {
                            const p = products.find((x) => x.id === Number(e.target.value));
                            if (p) {
                              updateRow(r.id, {
                                product_id: p.id,
                                cost_price: p.default_cost_price,
                                mrp: p.default_mrp,
                                selling_price: p.default_selling_price,
                                gst_rate: p.gst_rate,
                              });
                            }
                          }}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.unit})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          required
                          value={r.batch_number}
                          onChange={(e) => updateRow(r.id, { batch_number: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="date"
                          value={r.expiry_date}
                          onChange={(e) => updateRow(r.id, { expiry_date: e.target.value })}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="1"
                          required
                          value={r.quantity}
                          onChange={(e) =>
                            updateRow(r.id, { quantity: Math.max(1, Number(e.target.value)) })
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right font-semibold tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0"
                          value={r.free_qty}
                          onChange={(e) =>
                            updateRow(r.id, { free_qty: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={r.cost_price}
                          onChange={(e) =>
                            updateRow(r.id, { cost_price: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={r.selling_price}
                          onChange={(e) =>
                            updateRow(r.id, { selling_price: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={r.mrp}
                          onChange={(e) =>
                            updateRow(r.id, { mrp: Math.max(0, Number(e.target.value)) })
                          }
                          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right tabular-nums"
                        />
                      </td>
                      {isGstPurchase && (
                        <td className="py-2 px-2">
                          <select
                            value={r.gst_rate}
                            onChange={(e) =>
                              updateRow(r.id, { gst_rate: Number(e.target.value) })
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-1.5 py-1.5 text-right tabular-nums"
                          >
                            {[0, 5, 12, 18, 28].map((g) => (
                              <option key={g} value={g}>
                                {g}%
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="py-2 px-3 text-right font-bold text-slate-900 tabular-nums">
                        {formatINR(lineNet)}
                      </td>
                      <td className="py-2 px-2">
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                            className="text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={addDraftRow}
            className="inline-flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100"
          >
            <Plus className="h-3.5 w-3.5" /> Add Another Batch Line Item
          </button>

          {/* Footer Payment & Summary */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 border-t border-slate-200 pt-4 items-end">
            <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Settlement Mode
                </label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
                >
                  <option value="CREDIT">On Supplier Credit / Partial</option>
                  <option value="BANK_TRANSFER">Paid Full (NEFT / IMPS)</option>
                  <option value="UPI_QR">Paid Full (UPI Scan)</option>
                  <option value="CASH">Paid Full (Cash)</option>
                </select>
              </div>

              {payMode === 'CREDIT' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Advance / Paid Now (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs tabular-nums"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  UTR / Payment Reference
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Optional UTR / Ref"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
                />
              </div>
            </div>

            <div className="md:col-span-5 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs tabular-nums">
              <div className="flex justify-between text-slate-600">
                <span>Taxable Value</span>
                <span>{formatINR(purchaseTotals.taxable)}</span>
              </div>
              {isGstPurchase && (
                <div className="flex justify-between text-indigo-700">
                  <span>
                    Input GST ({purchaseTotals.supplyType === 'INTER' ? 'IGST' : 'CGST+SGST'})
                  </span>
                  <span>+{formatINR(purchaseTotals.totalTax)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-extrabold text-slate-900">
                <span>Purchase Total</span>
                <span>{formatINR(purchaseTotals.grandTotal)}</span>
              </div>
              <button
                type="submit"
                disabled={savingPurchase}
                className="w-full mt-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-60 transition"
              >
                {savingPurchase
                  ? 'Saving Purchase & Batches...'
                  : 'Save Purchase Bill & Stock FIFO Batches'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB: PURCHASES REGISTER */}
      {tab === 'HISTORY' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search purchase voucher, supplier name, or supplier invoice..."
                className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-xs text-slate-400">Loading purchases...</div>
          ) : filteredPurchases.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-500">
              No purchase bills recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Voucher #</th>
                    <th className="py-3 px-3 text-left font-semibold">Date</th>
                    <th className="py-3 px-3 text-left font-semibold">Supplier & Inv #</th>
                    <th className="py-3 px-3 text-right font-semibold">Input Tax</th>
                    <th className="py-3 px-3 text-right font-semibold">Grand Total</th>
                    <th className="py-3 px-3 text-right font-semibold">Balance Payable</th>
                    <th className="py-3 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPurchases.map((pur) => {
                    const expanded = expandedPurchaseId === pur.id;
                    const supObj = suppliers.find((s) => s.id === pur.supplier_id);
                    return (
                      <React.Fragment key={pur.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedPurchaseId(expanded ? null : pur.id)
                              }
                              className="flex items-center gap-1.5 font-mono font-bold text-slate-900 hover:text-teal-700"
                            >
                              {expanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              {pur.purchase_number}
                            </button>
                          </td>
                          <td className="py-3 px-3 text-slate-600">
                            {formatDate(pur.purchase_date)}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-900">{pur.supplier_name}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              Inv: {pur.supplier_invoice_no || '—'} • {pur.items?.length || 0}{' '}
                              batch(es)
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-slate-600">
                            {pur.is_gst ? formatINR(pur.total_tax) : 'Non-GST'}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                            {formatINR(pur.grand_total)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold tabular-nums">
                            {pur.balance_due > 0 ? (
                              <span className="text-rose-700">{formatINR(pur.balance_due)}</span>
                            ) : (
                              <span className="text-emerald-700">PAID</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {pur.balance_due > 0 && supObj && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayoutSupplier(supObj);
                                  setPayoutAmount(pur.balance_due);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                              >
                                <QrCode className="h-3 w-3" /> Pay via QR
                              </button>
                            )}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-6 py-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="text-[11px] font-bold text-slate-700 mb-2">
                                  Batches Created by {pur.purchase_number}
                                </div>
                                <table className="w-full text-[11px]">
                                  <thead className="text-slate-500 border-b border-slate-100">
                                    <tr>
                                      <th className="py-1 text-left">Item</th>
                                      <th className="py-1 text-left">Batch #</th>
                                      <th className="py-1 text-left">Expiry</th>
                                      <th className="py-1 text-right">Qty (+Free)</th>
                                      <th className="py-1 text-right">Cost</th>
                                      <th className="py-1 text-right">Sell / MRP</th>
                                      <th className="py-1 text-right">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {(pur.items || []).map((it) => (
                                      <tr key={it.id}>
                                        <td className="py-1.5 font-semibold text-slate-800">
                                          {it.product_name}
                                        </td>
                                        <td className="py-1.5 font-mono text-teal-800">
                                          #{it.batch_number}
                                        </td>
                                        <td className="py-1.5 text-slate-600">
                                          {formatDate(it.expiry_date)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {it.quantity}
                                          {it.free_qty > 0 ? ` + ${it.free_qty} free` : ''}{' '}
                                          {it.unit}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatINR(it.cost_price)}
                                        </td>
                                        <td className="py-1.5 text-right tabular-nums">
                                          {formatINR(it.selling_price)} / {formatINR(it.mrp)}
                                        </td>
                                        <td className="py-1.5 text-right font-bold tabular-nums">
                                          {formatINR(it.line_total)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB: SUPPLIERS DIRECTORY */}
      {tab === 'SUPPLIERS' && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search supplier name, GSTIN, or phone..."
                className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredSuppliers.length === 0 ? (
              <div className="p-12 text-center">
                <Truck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No suppliers added yet</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click &quot;+ Add Supplier&quot; above to add your wholesalers and record stock-in purchases.
                </p>
              </div>
            ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold">Supplier</th>
                  <th className="py-3 px-3 text-left font-semibold">State & GSTIN</th>
                  <th className="py-3 px-3 text-left font-semibold">Supplier UPI ID</th>
                  <th className="py-3 px-3 text-right font-semibold">Purchases</th>
                  <th className="py-3 px-3 text-right font-semibold">Payable Balance</th>
                  <th className="py-3 px-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{s.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {s.contact_person ? `${s.contact_person} • ` : ''}
                        {s.phone}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-slate-700">
                        {s.state_name} ({s.state_code})
                      </div>
                      <div className="font-mono text-[10px] text-slate-500">
                        {s.gstin || 'Unregistered'}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-teal-700">{s.upi_id || '—'}</td>
                    <td className="py-3 px-3 text-right tabular-nums">
                      <div>{formatINR(s.total_purchased || 0)}</div>
                      <div className="text-[10px] text-slate-400">
                        {s.purchase_count || 0} bill(s)
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums">
                      {s.current_balance > 0 ? (
                        <span className="text-rose-700">{formatINR(s.current_balance)}</span>
                      ) : (
                        <span className="text-emerald-700">Settled (₹0.00)</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {s.current_balance > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayoutSupplier(s);
                              setPayoutAmount(s.current_balance);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                          >
                            <QrCode className="h-3 w-3" /> Pay QR
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditSupplier(s)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSupplier(s)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* SUPPLIER ADD / EDIT MODAL */}
      {supModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveSupplier}
            className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-3.5"
          >
            <h3 className="text-base font-bold text-slate-900">
              {editingSup ? `Edit Supplier — ${editingSup.name}` : 'Add New Supplier'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier Business Name *
                </label>
                <input
                  type="text"
                  required
                  value={sForm.name}
                  onChange={(e) => setSForm({ ...sForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  value={sForm.contact_person}
                  onChange={(e) => setSForm({ ...sForm, contact_person: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={sForm.phone}
                  onChange={(e) => setSForm({ ...sForm, phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier UPI ID (For QR Payouts)
                </label>
                <input
                  type="text"
                  placeholder="supplier@sbi"
                  value={sForm.upi_id}
                  onChange={(e) => setSForm({ ...sForm, upi_id: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supplier GSTIN (Optional)
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={sForm.gstin}
                  onChange={(e) => setSForm({ ...sForm, gstin: e.target.value.toUpperCase() })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                <select
                  value={sForm.state_code}
                  onChange={(e) => setSForm({ ...sForm, state_code: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {states.map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.code} - {st.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={sForm.address}
                onChange={(e) => setSForm({ ...sForm, address: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {!editingSup && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opening Payable Balance (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={sForm.opening_balance}
                  onChange={(e) => setSForm({ ...sForm, opening_balance: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSupModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Save Supplier
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUPPLIER PAYOUT QR MODAL */}
      {payoutSupplier && (
        <HandToHandQrModal
          open={Boolean(payoutSupplier)}
          onClose={() => setPayoutSupplier(null)}
          title={`Supplier Payout QR — ${payoutSupplier.name}`}
          subtitle="Scan the supplier's UPI QR with your business phone to pay exact payable dues and post a debit voucher to Supplier Ledger."
          upiId={payoutSupplier.upi_id || 'supplier@upi'}
          payeeName={payoutSupplier.name}
          totalAmount={payoutAmount}
          defaultNote={`Supplier Settlement - ${organization.business_name}`}
          allowModeSwitch
          allowCreditLedger={false}
          direction="PAY_SUPPLIER"
          submitting={payingSupplier}
          onConfirm={handleConfirmSupplierPayout}
        />
      )}
    </div>
  );
};
