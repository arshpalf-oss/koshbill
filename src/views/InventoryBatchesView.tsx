import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Edit3,
  Hash,
  Layers,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBV, formatDate, formatINR, getExpiryMeta, getTodayISO } from '../lib/format';
import { Batch, HsnCode, Organization, Product } from '../types';

interface InventoryBatchesViewProps {
  organization: Organization;
  initialSubTab?: string;
  onGlobalRefresh: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

const UNITS = ['PCS', 'PACK', 'BOX', 'STRIP', 'BTL', 'KG', 'LTR', 'BAG'];
const GST_RATES = [0, 5, 12, 18, 28];

export const InventoryBatchesView: React.FC<InventoryBatchesViewProps> = ({
  organization,
  initialSubTab,
  onGlobalRefresh,
  notify,
}) => {
  const [tab, setTab] = useState<'PRODUCTS' | 'BATCHES' | 'HSN'>(
    initialSubTab === 'batches' ? 'BATCHES' : initialSubTab === 'hsn' ? 'HSN' : 'PRODUCTS'
  );

  useEffect(() => {
    if (initialSubTab === 'batches') setTab('BATCHES');
    if (initialSubTab === 'hsn') setTab('HSN');
  }, [initialSubTab]);

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([]);
  const [today, setToday] = useState(getTodayISO());
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [prodFilter, setProdFilter] = useState<'ALL' | 'LOW_STOCK' | 'HAS_EXPIRED'>('ALL');
  const [batchFilter, setBatchFilter] = useState<
    'ACTIVE' | 'EXP_30' | 'EXP_90' | 'EXPIRED' | 'DEPLETED'
  >('ACTIVE');
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);

  // Product Modal (Create / Edit)
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [editingProd, setEditingProd] = useState<Product | null>(null);
  const [pForm, setPForm] = useState({
    sku: '',
    barcode: '',
    name: '',
    category: 'General',
    unit: 'PCS',
    hsn_code: '',
    gst_rate: 12,
    default_cost_price: '',
    default_selling_price: '',
    default_mrp: '',
    default_bv: '',
    reorder_level: '10',
    track_expiry: true,
    description: '',
    opening_qty: '',
    opening_batch_number: '',
    opening_expiry_date: '',
  });

  // Batch Add Modal
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [bForm, setBForm] = useState({
    product_id: '',
    batch_number: '',
    mfg_date: '',
    expiry_date: '',
    received_date: getTodayISO(),
    quantity: '',
    cost_price: '',
    mrp: '',
    selling_price: '',
    notes: '',
  });

  // Batch Adjust / Write-Off Modal
  const [adjustTarget, setAdjustTarget] = useState<Batch | null>(null);
  const [adjType, setAdjType] = useState<'EXPIRED_WRITEOFF' | 'ADJUSTMENT_OUT' | 'ADJUSTMENT_IN'>(
    'EXPIRED_WRITEOFF'
  );
  const [adjQty, setAdjQty] = useState('');
  const [adjNotes, setAdjNotes] = useState('');

  // HSN Modal
  const [hsnModalOpen, setHsnModalOpen] = useState(false);
  const [editingHsn, setEditingHsn] = useState<HsnCode | null>(null);
  const [hForm, setHForm] = useState({
    code: '',
    description: '',
    gst_rate: 18,
    category: 'GOODS' as 'GOODS' | 'SERVICES',
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [pRes, bRes, hRes] = await Promise.all([
        apiFetch<{ products: Product[]; today: string }>('/products'),
        apiFetch<{ batches: Batch[]; today: string }>('/batches'),
        apiFetch<{ hsn_codes: HsnCode[] }>('/hsn'),
      ]);
      setProducts(pRes.products || []);
      setBatches(bRes.batches || []);
      setHsnCodes(hRes.hsn_codes || []);
      setToday(pRes.today || getTodayISO());
    } catch (err: any) {
      notify(err.message || 'Failed to load inventory', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openCreateProduct = () => {
    setEditingProd(null);
    setPForm({
      sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      barcode: '',
      name: '',
      category: 'Staples & Grains',
      unit: 'PCS',
      hsn_code: '',
      gst_rate: organization.gst_enabled ? 12 : 0,
      default_cost_price: '',
      default_selling_price: '',
      default_mrp: '',
      default_bv: '',
      reorder_level: '10',
      track_expiry: true,
      description: '',
      opening_qty: '',
      opening_batch_number: '',
      opening_expiry_date: '',
    });
    setProdModalOpen(true);
  };

  const openEditProduct = (p: Product) => {
    setEditingProd(p);
    setPForm({
      sku: p.sku,
      barcode: p.barcode || '',
      name: p.name,
      category: p.category,
      unit: p.unit,
      hsn_code: p.hsn_code || '',
      gst_rate: p.gst_rate,
      default_cost_price: String(p.default_cost_price),
      default_selling_price: String(p.default_selling_price),
      default_mrp: String(p.default_mrp),
      default_bv: p.default_bv > 0 ? String(p.default_bv) : '',
      reorder_level: String(p.reorder_level),
      track_expiry: Boolean(p.track_expiry),
      description: p.description || '',
      opening_qty: '',
      opening_batch_number: '',
      opening_expiry_date: '',
    });
    setProdModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingProd) {
        await apiFetch(`/products/${editingProd.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...pForm,
            default_cost_price: Number(pForm.default_cost_price || 0),
            default_selling_price: Number(pForm.default_selling_price || 0),
            default_mrp: Number(pForm.default_mrp || pForm.default_selling_price || 0),
            default_bv: Math.max(0, Number(pForm.default_bv || 0)),
            reorder_level: Number(pForm.reorder_level || 0),
          }),
        });
        notify(`Updated "${pForm.name}"`);
      } else {
        await apiFetch('/products', {
          method: 'POST',
          body: JSON.stringify({
            ...pForm,
            default_cost_price: Number(pForm.default_cost_price || 0),
            default_selling_price: Number(pForm.default_selling_price || 0),
            default_mrp: Number(pForm.default_mrp || pForm.default_selling_price || 0),
            default_bv: Math.max(0, Number(pForm.default_bv || 0)),
            reorder_level: Number(pForm.reorder_level || 0),
            opening_qty: Number(pForm.opening_qty || 0),
          }),
        });
        notify(`Created product "${pForm.name}"`);
      }
      setProdModalOpen(false);
      loadAll();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to save product', 'error');
    }
  };

  const handleDeleteProduct = async (p: Product) => {
    if (!window.confirm(`Archive product "${p.name}" from active catalog?`)) return;
    setProducts((prev) => prev.filter((item) => item.id !== p.id));
    try {
      await apiFetch(`/products/${p.id}`, { method: 'DELETE' });
      notify(`Archived "${p.name}"`);
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to archive product', 'error');
      loadAll();
    }
  };

  const openAddBatchForProduct = (p?: Product) => {
    if (!p && products.length === 0) {
      notify('Add at least one product first before adding a stock batch', 'error');
      openCreateProduct();
      return;
    }
    const target = p || products[0];
    setBForm({
      product_id: String(target.id),
      batch_number: `BCH-${today.replace(/-/g, '').slice(2)}-${Math.floor(10 + Math.random() * 89)}`,
      mfg_date: today,
      expiry_date: '',
      received_date: today,
      quantity: '20',
      cost_price: String(target.default_cost_price),
      mrp: String(target.default_mrp),
      selling_price: String(target.default_selling_price),
      notes: 'Manual FIFO stock batch entry',
    });
    setBatchModalOpen(true);
  };

  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/batches', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(bForm.product_id),
          batch_number: bForm.batch_number,
          mfg_date: bForm.mfg_date,
          expiry_date: bForm.expiry_date,
          received_date: bForm.received_date,
          quantity: Number(bForm.quantity),
          cost_price: Number(bForm.cost_price || 0),
          mrp: Number(bForm.mrp || 0),
          selling_price: Number(bForm.selling_price || 0),
          notes: bForm.notes,
        }),
      });
      setBatchModalOpen(false);
      notify(`Batch #${bForm.batch_number} added to FIFO queue`);
      loadAll();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to add batch', 'error');
    }
  };

  const openAdjustModal = (
    b: Batch,
    defaultType: 'EXPIRED_WRITEOFF' | 'ADJUSTMENT_OUT' | 'ADJUSTMENT_IN' = 'ADJUSTMENT_OUT'
  ) => {
    setAdjustTarget(b);
    setAdjType(defaultType);
    setAdjQty(
      defaultType === 'EXPIRED_WRITEOFF' ? String(b.remaining_qty) : '1'
    );
    setAdjNotes(
      defaultType === 'EXPIRED_WRITEOFF'
        ? `Expired batch write-off (${b.expiry_date})`
        : 'Physical stock audit adjustment'
    );
  };

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    try {
      await apiFetch(`/batches/${adjustTarget.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          adjustment_type: adjType,
          quantity: Number(adjQty),
          notes: adjNotes,
        }),
      });
      setAdjustTarget(null);
      notify(`Stock adjustment recorded for Batch #${adjustTarget.batch_number}`);
      loadAll();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Adjustment failed', 'error');
    }
  };

  const handleSaveHsn = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingHsn) {
        await apiFetch(`/hsn/${editingHsn.id}`, {
          method: 'PUT',
          body: JSON.stringify(hForm),
        });
        notify(`Updated HSN ${hForm.code}`);
      } else {
        await apiFetch('/hsn', {
          method: 'POST',
          body: JSON.stringify(hForm),
        });
        notify(`Added HSN ${hForm.code}`);
      }
      setHsnModalOpen(false);
      loadAll();
    } catch (err: any) {
      notify(err.message || 'Failed to save HSN code', 'error');
    }
  };

  const handleDeleteHsn = async (h: HsnCode) => {
    setHsnCodes((prev) => prev.filter((x) => x.id !== h.id));
    try {
      await apiFetch(`/hsn/${h.id}`, { method: 'DELETE' });
      notify(`Deleted HSN ${h.code}`);
    } catch (err: any) {
      notify(err.message || 'Failed to delete HSN', 'error');
      loadAll();
    }
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (prodFilter === 'LOW_STOCK' && p.available_stock > p.reorder_level) return false;
      if (prodFilter === 'HAS_EXPIRED' && p.expired_stock <= 0) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.hsn_code || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, prodFilter]);

  const filteredBatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return batches.filter((b) => {
      const meta = getExpiryMeta(b.expiry_date, today);
      const isDepleted = b.status !== 'ACTIVE' || Number(b.remaining_qty) <= 0;

      if (batchFilter === 'ACTIVE' && (isDepleted || meta.status === 'EXPIRED')) return false;
      if (batchFilter === 'EXP_30' && (isDepleted || meta.status !== 'CRITICAL')) return false;
      if (
        batchFilter === 'EXP_90' &&
        (isDepleted || (meta.status !== 'CRITICAL' && meta.status !== 'WARNING'))
      )
        return false;
      if (batchFilter === 'EXPIRED' && (isDepleted || meta.status !== 'EXPIRED')) return false;
      if (batchFilter === 'DEPLETED' && !isDepleted) return false;

      if (!q) return true;
      return (
        b.batch_number.toLowerCase().includes(q) ||
        (b.product_name || '').toLowerCase().includes(q) ||
        (b.sku || '').toLowerCase().includes(q)
      );
    });
  }, [batches, search, batchFilter, today]);

  const filteredHsn = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hsnCodes;
    return hsnCodes.filter(
      (h) => h.code.toLowerCase().includes(q) || h.description.toLowerCase().includes(q)
    );
  }, [hsnCodes, search]);

  return (
    <div className="space-y-5">
      {/* Top Sub-Navigation + Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setTab('PRODUCTS')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'PRODUCTS'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Boxes className="h-3.5 w-3.5" />
            Products & FIFO Queue ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('BATCHES')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'BATCHES'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Batches & Expiry Tracker
          </button>
          <button
            type="button"
            onClick={() => setTab('HSN')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'HSN'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Hash className="h-3.5 w-3.5" />
            HSN / SAC Codes ({hsnCodes.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          {tab === 'PRODUCTS' && (
            <>
              <button
                type="button"
                onClick={() => openAddBatchForProduct()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Layers className="h-3.5 w-3.5 text-teal-700" />
                + Add Stock Batch
              </button>
              <button
                type="button"
                onClick={openCreateProduct}
                className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                <Plus className="h-4 w-4" />
                Add Product
              </button>
            </>
          )}
          {tab === 'BATCHES' && (
            <button
              type="button"
              onClick={() => openAddBatchForProduct()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Plus className="h-4 w-4" />
              Add Manual FIFO Batch
            </button>
          )}
          {tab === 'HSN' && (
            <button
              type="button"
              onClick={() => {
                setEditingHsn(null);
                setHForm({ code: '', description: '', gst_rate: 18, category: 'GOODS' });
                setHsnModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Plus className="h-4 w-4" />
              Add HSN / SAC Code
            </button>
          )}
        </div>
      </div>

      {/* Main Content Card */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === 'HSN'
                  ? 'Search HSN/SAC code or description...'
                  : 'Search product name, SKU, category, or batch #...'
              }
              className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
            />
          </div>

          {tab === 'PRODUCTS' && (
            <div className="flex items-center gap-1.5">
              {(
                [
                  ['ALL', 'All Products'],
                  ['LOW_STOCK', 'Low Stock (Reorder)'],
                  ['HAS_EXPIRED', 'Has Expired Batch'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setProdFilter(k)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition ${
                    prodFilter === k
                      ? 'border-teal-600 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}

          {tab === 'BATCHES' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  ['ACTIVE', 'Healthy / Sellable'],
                  ['EXP_30', 'Expiring ≤ 30d'],
                  ['EXP_90', 'Expiring ≤ 90d'],
                  ['EXPIRED', 'Expired (Action Needed)'],
                  ['DEPLETED', 'Depleted / Written-off'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBatchFilter(k)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold border transition ${
                    batchFilter === k
                      ? 'border-teal-600 bg-teal-50 text-teal-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* TAB 1: PRODUCTS + EXPANDABLE FIFO QUEUE */}
        {tab === 'PRODUCTS' && (
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-10 text-center text-xs text-slate-400">Loading catalog...</div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-12 text-center">
                <Boxes className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No products found</p>
                <p className="text-xs text-slate-500 mt-1">
                  Add your first product with an opening batch to begin FIFO tracking.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Product & SKU</th>
                    <th className="py-3 px-3 text-left font-semibold">Category</th>
                    {Boolean(organization.gst_enabled) && (
                      <th className="py-3 px-3 text-left font-semibold">HSN / GST</th>
                    )}
                    <th className="py-3 px-3 text-left font-semibold">Next FIFO Batch</th>
                    <th className="py-3 px-3 text-right font-semibold">Selling / MRP</th>
                    <th className="py-3 px-3 text-right font-semibold">BV / Unit</th>
                    <th className="py-3 px-3 text-right font-semibold">Sellable Stock</th>
                    <th className="py-3 px-3 text-right font-semibold">FIFO Cost Value</th>
                    <th className="py-3 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const isExpanded = expandedProductId === p.id;
                    const isLow = p.available_stock <= p.reorder_level;
                    return (
                      <React.Fragment key={p.id}>
                        <tr className="hover:bg-slate-50/80">
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedProductId(isExpanded ? null : p.id)
                              }
                              className="flex items-start gap-2 text-left group"
                            >
                              <span className="mt-0.5 text-slate-400 group-hover:text-teal-700">
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </span>
                              <div>
                                <div className="font-bold text-slate-900 group-hover:text-teal-700">
                                  {p.name}
                                </div>
                                <div className="font-mono text-[10px] text-slate-500">
                                  {p.sku} • {p.active_batch_count} active FIFO batch(es)
                                </div>
                              </div>
                            </button>
                          </td>
                          <td className="py-3 px-3 text-slate-600">{p.category}</td>
                          {Boolean(organization.gst_enabled) && (
                            <td className="py-3 px-3 font-mono text-slate-700">
                              {p.hsn_code || '—'}{' '}
                              <span className="text-[10px] text-indigo-700 font-semibold">
                                ({p.gst_rate}%)
                              </span>
                            </td>
                          )}
                          <td className="py-3 px-3">
                            {p.next_fifo_batch ? (
                              <div>
                                <span className="rounded bg-teal-50 border border-teal-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-800">
                                  #{p.next_fifo_batch.batch_number}
                                </span>
                                {p.next_fifo_batch.expiry_date && (
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    Exp: {formatDate(p.next_fifo_batch.expiry_date)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-400">None</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            <div className="font-bold text-slate-900">
                              {formatINR(
                                p.next_fifo_batch?.selling_price ?? p.default_selling_price
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              MRP {formatINR(p.next_fifo_batch?.mrp ?? p.default_mrp)}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            {Number(p.default_bv || 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[11px] font-bold text-violet-800">
                                <Sparkles className="h-3 w-3 text-violet-600" />
                                {formatBV(p.default_bv)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold border ${
                                isLow
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {p.available_stock} {p.unit}
                            </span>
                            {p.expired_stock > 0 && (
                              <div className="text-[10px] font-semibold text-rose-600 mt-0.5">
                                +{p.expired_stock} expired!
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-bold text-slate-800 tabular-nums">
                            {formatINR(p.fifo_value)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openAddBatchForProduct(p)}
                                className="rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                                title="Add new stock batch"
                              >
                                + Batch
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditProduct(p)}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                title="Edit product"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(p)}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                title="Archive product"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded FIFO Queue Breakdown */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90">
                            <td colSpan={9} className="px-6 py-4">
                              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                                <div className="flex items-center justify-between mb-2.5">
                                  <span className="text-xs font-bold text-slate-800">
                                    FIFO Batch Queue for {p.name} (Ordered Oldest Received → Newest)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openAddBatchForProduct(p)}
                                    className="text-[11px] font-semibold text-teal-700 hover:underline"
                                  >
                                    + Add Batch to Queue
                                  </button>
                                </div>

                                {(p.batches || []).length === 0 ? (
                                  <p className="text-xs text-slate-400">No batches recorded yet.</p>
                                ) : (
                                  <table className="w-full text-[11px]">
                                    <thead className="text-slate-500 border-b border-slate-200">
                                      <tr>
                                        <th className="py-1.5 text-left">FIFO Order</th>
                                        <th className="py-1.5 text-left">Batch #</th>
                                        <th className="py-1.5 text-left">Received Date</th>
                                        <th className="py-1.5 text-left">Expiry</th>
                                        <th className="py-1.5 text-right">Cost</th>
                                        <th className="py-1.5 text-right">Sell Rate</th>
                                        <th className="py-1.5 text-right">Remaining / Initial</th>
                                        <th className="py-1.5 text-right">Adjust</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {(() => {
                                        let sellRank = 0;
                                        return (p.batches || []).map((b) => {
                                          const expMeta = getExpiryMeta(b.expiry_date, today);
                                          const sellable =
                                            b.status === 'ACTIVE' &&
                                            b.remaining_qty > 0 &&
                                            expMeta.status !== 'EXPIRED';
                                          if (sellable) sellRank += 1;
                                          return (
                                            <tr key={b.id}>
                                              <td className="py-2">
                                                {sellable ? (
                                                  <span
                                                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                                      sellRank === 1
                                                        ? 'bg-teal-700 text-white'
                                                        : 'bg-slate-100 text-slate-700'
                                                    }`}
                                                  >
                                                    {sellRank === 1
                                                      ? '#1 NEXT OUT (FIFO)'
                                                      : `#${sellRank} Queued`}
                                                  </span>
                                                ) : expMeta.status === 'EXPIRED' &&
                                                  b.remaining_qty > 0 ? (
                                                  <span className="rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                                    SKIPPED (EXPIRED)
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] text-slate-400">
                                                    {b.status}
                                                  </span>
                                                )}
                                              </td>
                                              <td className="py-2 font-mono font-bold text-slate-900">
                                                {b.batch_number}
                                              </td>
                                              <td className="py-2 text-slate-600">
                                                {formatDate(b.received_date)}
                                              </td>
                                              <td className="py-2">
                                                <span
                                                  className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${expMeta.badgeClass}`}
                                                >
                                                  {expMeta.label}
                                                </span>
                                              </td>
                                              <td className="py-2 text-right tabular-nums">
                                                {formatINR(b.cost_price)}
                                              </td>
                                              <td className="py-2 text-right font-semibold tabular-nums">
                                                {formatINR(b.selling_price)}
                                              </td>
                                              <td className="py-2 text-right font-bold tabular-nums">
                                                {b.remaining_qty} / {b.initial_qty} {p.unit}
                                              </td>
                                              <td className="py-2 text-right">
                                                {b.remaining_qty > 0 && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      openAdjustModal(
                                                        b,
                                                        expMeta.status === 'EXPIRED'
                                                          ? 'EXPIRED_WRITEOFF'
                                                          : 'ADJUSTMENT_OUT'
                                                      )
                                                    }
                                                    className="rounded border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                                                  >
                                                    {expMeta.status === 'EXPIRED'
                                                      ? 'Write-off Expired'
                                                      : 'Adjust'}
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                          );
                                        });
                                      })()}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 2: BATCHES & EXPIRY RADAR */}
        {tab === 'BATCHES' && (
          <div className="overflow-x-auto">
            {filteredBatches.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500">
                No batches match the selected expiry filter.
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Batch #</th>
                    <th className="py-3 px-3 text-left font-semibold">Product</th>
                    <th className="py-3 px-3 text-left font-semibold">Received (FIFO Date)</th>
                    <th className="py-3 px-3 text-left font-semibold">Expiry Status</th>
                    <th className="py-3 px-3 text-right font-semibold">Cost / Sell</th>
                    <th className="py-3 px-3 text-right font-semibold">Remaining Qty</th>
                    <th className="py-3 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBatches.map((b) => {
                    const meta = getExpiryMeta(b.expiry_date, today);
                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {b.batch_number}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{b.product_name}</div>
                          <div className="font-mono text-[10px] text-slate-500">{b.sku}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {formatDate(b.received_date)}
                          {b.supplier_name && (
                            <div className="text-[10px] text-slate-400">{b.supplier_name}</div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          {b.expiry_date && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {formatDate(b.expiry_date)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          <div>Cost: {formatINR(b.cost_price)}</div>
                          <div className="font-semibold text-teal-800">
                            Sell: {formatINR(b.selling_price)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900 tabular-nums">
                          {b.remaining_qty} / {b.initial_qty} {b.unit}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {b.remaining_qty > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                openAdjustModal(
                                  b,
                                  meta.status === 'EXPIRED'
                                    ? 'EXPIRED_WRITEOFF'
                                    : 'ADJUSTMENT_OUT'
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                                meta.status === 'EXPIRED'
                                  ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <SlidersHorizontal className="h-3 w-3" />
                              {meta.status === 'EXPIRED' ? 'Write-Off Expired' : 'Adjust Stock'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">{b.status}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: HSN / SAC CODES DIRECTORY */}
        {tab === 'HSN' && (
          <div className="overflow-x-auto">
            {!organization.gst_enabled && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                Your store currently has GST Mode skipped. HSN codes are saved here and will automatically appear whenever you toggle GST ON.
              </div>
            )}
            {filteredHsn.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <Hash className="h-8 w-8 text-slate-300 mx-auto" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">No HSN / SAC codes added yet</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Add your own custom commodity HSN codes or load standard Indian GST HSN reference slabs.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await apiFetch<{ hsn_codes: HsnCode[] }>('/hsn/import-defaults', {
                          method: 'POST',
                        });
                        setHsnCodes(res.hsn_codes || []);
                        notify('Imported standard GST HSN / SAC reference codes');
                      } catch (err: any) {
                        notify(err.message || 'Failed to import HSN codes', 'error');
                      }
                    }}
                    className="rounded-xl border border-teal-300 bg-teal-50 px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100"
                  >
                    Import Standard GST HSN Codes
                  </button>
                </div>
              </div>
            ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-left font-semibold">HSN / SAC Code</th>
                  <th className="py-3 px-3 text-left font-semibold">Type</th>
                  <th className="py-3 px-3 text-left font-semibold">Official Description</th>
                  <th className="py-3 px-3 text-right font-semibold">Standard GST Slab</th>
                  <th className="py-3 px-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredHsn.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">{h.code}</td>
                    <td className="py-3 px-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        {h.category === 'SERVICES' ? 'SAC (Service)' : 'HSN (Goods)'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-700">{h.description}</td>
                    <td className="py-3 px-3 text-right">
                      <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 font-mono text-[11px] font-bold text-indigo-700">
                        {h.gst_rate}% GST
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingHsn(h);
                            setHForm({
                              code: h.code,
                              description: h.description,
                              gst_rate: h.gst_rate,
                              category: h.category,
                            });
                            setHsnModalOpen(true);
                          }}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHsn(h)}
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
        )}
      </div>

      {/* PRODUCT CREATE / EDIT MODAL */}
      {prodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveProduct}
            className="max-h-[90vh] overflow-y-auto w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">
              {editingProd ? `Edit Product — ${editingProd.name}` : 'Add New Inventory Product'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Name *
                </label>
                <input
                  type="text"
                  required
                  value={pForm.name}
                  onChange={(e) => setPForm({ ...pForm, name: e.target.value })}
                  placeholder="e.g. Paracetamol 650mg Strip / Basmati Rice 5kg"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">SKU *</label>
                <input
                  type="text"
                  required
                  value={pForm.sku}
                  onChange={(e) => setPForm({ ...pForm, sku: e.target.value.toUpperCase() })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <input
                  type="text"
                  value={pForm.category}
                  onChange={(e) => setPForm({ ...pForm, category: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Unit</label>
                <select
                  value={pForm.unit}
                  onChange={(e) => setPForm({ ...pForm, unit: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reorder Alert Level
                </label>
                <input
                  type="number"
                  value={pForm.reorder_level}
                  onChange={(e) => setPForm({ ...pForm, reorder_level: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>

            {/* HSN Quick-Picker & GST Rate */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  HSN / SAC Code (Pick from Directory or Type)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={pForm.hsn_code}
                    onChange={(e) => setPForm({ ...pForm, hsn_code: e.target.value })}
                    placeholder="e.g. 3004"
                    className="w-28 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                  />
                  <select
                    value=""
                    onChange={(e) => {
                      const found = hsnCodes.find((h) => h.code === e.target.value);
                      if (found) {
                        setPForm({
                          ...pForm,
                          hsn_code: found.code,
                          gst_rate: found.gst_rate,
                        });
                      }
                    }}
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Quick-fill from HSN Directory...</option>
                    {hsnCodes.map((h) => (
                      <option key={h.id} value={h.code}>
                        {h.code} ({h.gst_rate}%) — {h.description.slice(0, 42)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  GST Rate (%)
                </label>
                <select
                  value={pForm.gst_rate}
                  onChange={(e) => setPForm({ ...pForm, gst_rate: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
                >
                  {GST_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r}% GST
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Default Pricing & Optional Business Value (BV) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Cost Price (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={pForm.default_cost_price}
                  onChange={(e) => setPForm({ ...pForm, default_cost_price: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Selling Price (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={pForm.default_selling_price}
                  onChange={(e) => setPForm({ ...pForm, default_selling_price: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={pForm.default_mrp}
                  onChange={(e) => setPForm({ ...pForm, default_mrp: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-violet-800 mb-1">
                  BV / Unit (Optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0 (None)"
                  value={pForm.default_bv}
                  onChange={(e) => setPForm({ ...pForm, default_bv: e.target.value })}
                  className="w-full rounded-xl border border-violet-300 bg-violet-50/40 px-3 py-2 text-sm font-semibold text-violet-900 tabular-nums focus:border-violet-600 focus:outline-none"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-500 -mt-2">
              <strong className="text-violet-800">BV (Business Value):</strong> Optional non-monetary value per unit sold. Tracked in a separate BV section and never added to the ₹ invoice total.
            </p>

            {/* Optional Initial Opening Batch when creating a new product */}
            {!editingProd && (
              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 space-y-2.5">
                <div className="text-xs font-bold text-teal-900">
                  Initial Opening Stock Batch (Optional — Ready for Immediate FIFO Sale)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Opening Qty
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={pForm.opening_qty}
                      onChange={(e) => setPForm({ ...pForm, opening_qty: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Batch Number
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-generated if blank"
                      value={pForm.opening_batch_number}
                      onChange={(e) =>
                        setPForm({ ...pForm, opening_batch_number: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={pForm.opening_expiry_date}
                      onChange={(e) =>
                        setPForm({ ...pForm, opening_expiry_date: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProdModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                {editingProd ? 'Save Changes' : 'Create Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ADD MANUAL BATCH MODAL */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveBatch}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">Add New FIFO Inventory Batch</h3>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Product *</label>
              <select
                required
                value={bForm.product_id}
                onChange={(e) => {
                  const p = products.find((x) => x.id === Number(e.target.value));
                  setBForm({
                    ...bForm,
                    product_id: e.target.value,
                    cost_price: p ? String(p.default_cost_price) : bForm.cost_price,
                    mrp: p ? String(p.default_mrp) : bForm.mrp,
                    selling_price: p ? String(p.default_selling_price) : bForm.selling_price,
                  });
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Batch Number *
                </label>
                <input
                  type="text"
                  required
                  value={bForm.batch_number}
                  onChange={(e) => setBForm({ ...bForm, batch_number: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Quantity Received *
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={bForm.quantity}
                  onChange={(e) => setBForm({ ...bForm, quantity: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Received Date (FIFO)
                </label>
                <input
                  type="date"
                  value={bForm.received_date}
                  onChange={(e) => setBForm({ ...bForm, received_date: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mfg Date</label>
                <input
                  type="date"
                  value={bForm.mfg_date}
                  onChange={(e) => setBForm({ ...bForm, mfg_date: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={bForm.expiry_date}
                  onChange={(e) => setBForm({ ...bForm, expiry_date: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cost Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={bForm.cost_price}
                  onChange={(e) => setBForm({ ...bForm, cost_price: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Selling Price (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={bForm.selling_price}
                  onChange={(e) => setBForm({ ...bForm, selling_price: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">MRP (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={bForm.mrp}
                  onChange={(e) => setBForm({ ...bForm, mrp: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Add Batch
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STOCK ADJUSTMENT / EXPIRED WRITE-OFF MODAL */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmAdjustment}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">
              Adjust Batch #{adjustTarget.batch_number}
            </h3>
            <p className="text-xs text-slate-500">
              Current Remaining Quantity: <strong>{adjustTarget.remaining_qty}</strong>
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Adjustment Type
              </label>
              <select
                value={adjType}
                onChange={(e) => setAdjType(e.target.value as any)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="EXPIRED_WRITEOFF">Expired Stock Write-Off (-)</option>
                <option value="ADJUSTMENT_OUT">Damage / Audit Reduction (-)</option>
                <option value="ADJUSTMENT_IN">Audit Surplus Addition (+)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Quantity *</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                required
                value={adjQty}
                onChange={(e) => setAdjQty(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Audit Reason / Notes
              </label>
              <input
                type="text"
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Confirm Adjustment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* HSN / SAC MODAL */}
      {hsnModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveHsn}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900">
              {editingHsn ? 'Edit HSN / SAC Code' : 'Add HSN / SAC Code'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  HSN / SAC Code *
                </label>
                <input
                  type="text"
                  required
                  value={hForm.code}
                  onChange={(e) => setHForm({ ...hForm, code: e.target.value })}
                  placeholder="e.g. 3004"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={hForm.category}
                  onChange={(e) => setHForm({ ...hForm, category: e.target.value as any })}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="GOODS">Goods (HSN)</option>
                  <option value="SERVICES">Services (SAC)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Description *
              </label>
              <input
                type="text"
                required
                value={hForm.description}
                onChange={(e) => setHForm({ ...hForm, description: e.target.value })}
                placeholder="Official commodity or service description"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Standard GST Slab (%)
              </label>
              <select
                value={hForm.gst_rate}
                onChange={(e) => setHForm({ ...hForm, gst_rate: Number(e.target.value) })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {GST_RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}% GST
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setHsnModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Save HSN Code
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
