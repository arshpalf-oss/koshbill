import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  ExternalLink,
  FileText,
  Layers,
  Printer,
  QrCode,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBV, formatDate, formatINR } from '../lib/format';
import {
  Customer,
  IndianState,
  Invoice,
  LedgerEntry,
  Organization,
  Purchase,
  Supplier,
} from '../types';
import {
  HandToHandQrConfirmPayload,
  HandToHandQrModal,
} from '../components/HandToHandQrModal';
import { PurchasePrintModal } from '../components/PurchasePrintModal';

interface ClientsLedgersViewProps {
  organization: Organization;
  states: IndianState[];
  onOpenInvoicePrint: (invoice: Invoice, initialFormat?: 'A4' | 'THERMAL' | 'OWNER_BV') => void;
  onGlobalRefresh: () => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ClientsLedgersView: React.FC<ClientsLedgersViewProps> = ({
  organization,
  states,
  onOpenInvoicePrint,
  onGlobalRefresh,
  notify,
}) => {
  const [tab, setTab] = useState<'CUSTOMER_LEDGER' | 'SUPPLIER_LEDGER' | 'CLIENTS_CRUD'>(
    'CUSTOMER_LEDGER'
  );

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null);
  const [statementEntries, setStatementEntries] = useState<LedgerEntry[]>([]);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [search, setSearch] = useState('');

  // Inline Expandable Voucher Items State + Full Purchase Voucher Modal
  const [expandedEntryIds, setExpandedEntryIds] = useState<Record<number, boolean>>({});
  const [expandAllItems, setExpandAllItems] = useState(false);
  const [printingPurchase, setPrintingPurchase] = useState<Purchase | null>(null);
  const [loadingVoucherId, setLoadingVoucherId] = useState<number | null>(null);

  // Client CRUD Modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Customer | null>(null);
  const [cForm, setCForm] = useState({
    name: '',
    customer_type: 'B2C' as 'B2C' | 'B2B',
    phone: '',
    email: '',
    gstin: '',
    state_code: organization.state_code || '09',
    address: '',
    credit_limit: '25000',
    opening_balance: '0',
    opening_bv: '0',
    notes: '',
  });

  // QR Settlement Modal (For Customer Receivable OR Supplier Payable)
  const [settleModalOpen, setSettleModalOpen] = useState(false);
  const [settleAmountInput, setSettleAmountInput] = useState<string>('');
  const [settling, setSettling] = useState(false);

  const loadParties = async () => {
    try {
      const [custRes, supRes] = await Promise.all([
        apiFetch<{ customers: Customer[] }>('/customers'),
        apiFetch<{ suppliers: Supplier[] }>('/suppliers'),
      ]);
      const custs = custRes.customers || [];
      const sups = supRes.suppliers || [];
      setCustomers(custs);
      setSuppliers(sups);

      if (
        tab === 'CUSTOMER_LEDGER' &&
        (!selectedPartyId || !custs.some((c) => c.id === selectedPartyId))
      ) {
        const withDue = custs.find((c) => c.current_balance > 0) || custs[0];
        if (withDue) setSelectedPartyId(withDue.id);
      }
      if (
        tab === 'SUPPLIER_LEDGER' &&
        (!selectedPartyId || !sups.some((s) => s.id === selectedPartyId))
      ) {
        const withDue = sups.find((s) => s.current_balance > 0) || sups[0];
        if (withDue) setSelectedPartyId(withDue.id);
      }
    } catch (err: any) {
      notify(err.message || 'Failed to load clients & ledgers', 'error');
    }
  };

  useEffect(() => {
    loadParties();
  }, [tab]);

  useEffect(() => {
    if (!selectedPartyId || tab === 'CLIENTS_CRUD') return;
    const partyType = tab === 'SUPPLIER_LEDGER' ? 'SUPPLIER' : 'CUSTOMER';
    setLoadingStatement(true);
    setExpandedEntryIds({});
    apiFetch<{ entries: LedgerEntry[] }>(`/ledgers/${partyType}/${selectedPartyId}`)
      .then((res) => setStatementEntries(res.entries || []))
      .catch(() => setStatementEntries([]))
      .finally(() => setLoadingStatement(false));
  }, [selectedPartyId, tab]);

  const activeParty = useMemo(() => {
    if (tab === 'CUSTOMER_LEDGER') {
      return customers.find((c) => c.id === selectedPartyId) || null;
    }
    if (tab === 'SUPPLIER_LEDGER') {
      return suppliers.find((s) => s.id === selectedPartyId) || null;
    }
    return null;
  }, [tab, customers, suppliers, selectedPartyId]);

  const totalReceivables = useMemo(
    () => customers.reduce((s, c) => s + Math.max(0, Number(c.current_balance)), 0),
    [customers]
  );
  const totalPayables = useMemo(
    () => suppliers.reduce((s, x) => s + Math.max(0, Number(x.current_balance)), 0),
    [suppliers]
  );

  const hasExpandableVouchers = useMemo(
    () => statementEntries.some((e) => (e.voucher_items || []).length > 0),
    [statementEntries]
  );

  const toggleEntryExpanded = (entryId: number) => {
    setExpandedEntryIds((prev) => ({
      ...prev,
      [entryId]: !(prev[entryId] ?? expandAllItems),
    }));
  };

  const handleToggleExpandAll = () => {
    const next = !expandAllItems;
    setExpandAllItems(next);
    setExpandedEntryIds({});
  };

  const handleOpenInvoiceModal = async (
    invoiceId: number,
    format: 'A4' | 'THERMAL' | 'OWNER_BV' = 'A4'
  ) => {
    setLoadingVoucherId(invoiceId);
    try {
      const res = await apiFetch<{ invoice: Invoice }>(`/invoices/${invoiceId}`);
      onOpenInvoicePrint(res.invoice, format);
    } catch (err: any) {
      notify(err.message || 'Failed to load invoice bill', 'error');
    } finally {
      setLoadingVoucherId(null);
    }
  };

  const handleOpenPurchaseModal = async (purchaseId: number) => {
    setLoadingVoucherId(purchaseId);
    try {
      const res = await apiFetch<{ purchase: Purchase }>(`/purchases/${purchaseId}`);
      setPrintingPurchase(res.purchase);
    } catch (err: any) {
      notify(err.message || 'Failed to load purchase voucher', 'error');
    } finally {
      setLoadingVoucherId(null);
    }
  };

  const openAddClient = () => {
    setEditingClient(null);
    setCForm({
      name: '',
      customer_type: 'B2C',
      phone: '',
      email: '',
      gstin: '',
      state_code: organization.state_code || '09',
      address: '',
      credit_limit: '25000',
      opening_balance: '0',
      opening_bv: '0',
      notes: '',
    });
    setClientModalOpen(true);
  };

  const openEditClient = (c: Customer) => {
    setEditingClient(c);
    setCForm({
      name: c.name,
      customer_type: c.customer_type,
      phone: c.phone || '',
      email: c.email || '',
      gstin: c.gstin || '',
      state_code: c.state_code || '09',
      address: c.address || '',
      credit_limit: String(c.credit_limit || 25000),
      opening_balance: String(c.opening_balance || 0),
      opening_bv: String(c.opening_bv || 0),
      notes: c.notes || '',
    });
    setClientModalOpen(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingClient) {
        await apiFetch(`/customers/${editingClient.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...cForm,
            credit_limit: Number(cForm.credit_limit || 0),
            opening_bv: Math.max(0, Number(cForm.opening_bv || 0)),
          }),
        });
        notify(`Updated client "${cForm.name}"`);
      } else {
        const res = await apiFetch<{ customer: Customer }>('/customers', {
          method: 'POST',
          body: JSON.stringify({
            ...cForm,
            credit_limit: Number(cForm.credit_limit || 0),
            opening_balance: Number(cForm.opening_balance || 0),
            opening_bv: Math.max(0, Number(cForm.opening_bv || 0)),
          }),
        });
        setSelectedPartyId(res.customer.id);
        notify(`Created client "${cForm.name}"`);
      }
      setClientModalOpen(false);
      loadParties();
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Failed to save client', 'error');
    }
  };

  const handleDeleteClient = async (c: Customer) => {
    if (!window.confirm(`Delete client "${c.name}"?`)) return;
    try {
      await apiFetch(`/customers/${c.id}`, { method: 'DELETE' });
      notify(`Deleted client "${c.name}"`);
      loadParties();
    } catch (err: any) {
      notify(err.message || 'Cannot delete client', 'error');
    }
  };

  const handleConfirmSettlement = async (payload: HandToHandQrConfirmPayload) => {
    if (!activeParty) return;
    const pType = tab === 'SUPPLIER_LEDGER' ? 'SUPPLIER' : 'CUSTOMER';
    setSettling(true);
    try {
      await apiFetch('/ledgers/payment', {
        method: 'POST',
        body: JSON.stringify({
          party_type: pType,
          party_id: activeParty.id,
          amount: payload.amount_paid,
          payment_mode: payload.payment_mode,
          payment_ref: payload.payment_ref,
          narration:
            pType === 'CUSTOMER'
              ? `Khata payment received via ${payload.payment_mode}`
              : `Supplier payout via ${payload.payment_mode}`,
        }),
      });
      setSettleModalOpen(false);
      notify(
        `Recorded ${formatINR(payload.amount_paid)} ${
          pType === 'CUSTOMER' ? 'receipt' : 'payout'
        } in ${activeParty.name}'s ledger!`
      );
      await loadParties();
      const refreshed = await apiFetch<{ entries: LedgerEntry[] }>(
        `/ledgers/${pType}/${activeParty.id}`
      );
      setStatementEntries(refreshed.entries || []);
      onGlobalRefresh();
    } catch (err: any) {
      notify(err.message || 'Ledger settlement failed', 'error');
    } finally {
      setSettling(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.gstin || '').toLowerCase().includes(q)
    );
  }, [customers, search]);

  return (
    <div className="space-y-5">
      {/* Summary Header + Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-2xs">
          <button
            type="button"
            onClick={() => {
              setTab('CUSTOMER_LEDGER');
              if (customers[0]) setSelectedPartyId(customers[0].id);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'CUSTOMER_LEDGER'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Customer Khata ({formatINR(totalReceivables)})
          </button>

          <button
            type="button"
            onClick={() => {
              setTab('SUPPLIER_LEDGER');
              if (suppliers[0]) setSelectedPartyId(suppliers[0].id);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'SUPPLIER_LEDGER'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Wallet className="h-3.5 w-3.5" />
            Supplier Ledgers ({formatINR(totalPayables)})
          </button>

          <button
            type="button"
            onClick={() => setTab('CLIENTS_CRUD')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              tab === 'CLIENTS_CRUD'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Clients Directory ({customers.length})
          </button>
        </div>

        <button
          type="button"
          onClick={openAddClient}
          className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
        >
          <UserPlus className="h-4 w-4" />
          Add New Client
        </button>
      </div>

      {tab === 'CLIENTS_CRUD' ? (
        /* CLIENTS DIRECTORY FULL CRUD WITH SEPARATE ACCUMULATED BV TRACKING */
        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
          <div className="border-b border-slate-200 p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search client name, phone, or GSTIN..."
                className="w-full rounded-xl border border-slate-300 pl-9 pr-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {filteredCustomers.length === 0 ? (
              <div className="p-12 text-center">
                <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">No clients added yet</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click &quot;Add New Client&quot; above to manage B2B/B2C buyers, accumulated BV, and Khata ledgers.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-3 px-4 text-left font-semibold">Client Name</th>
                    <th className="py-3 px-3 text-left font-semibold">Segment</th>
                    <th className="py-3 px-3 text-left font-semibold">State & GSTIN</th>
                    <th className="py-3 px-3 text-right font-semibold">Total Billed (₹)</th>
                    <th className="py-3 px-3 text-right font-semibold text-violet-800">
                      Accumulated BV
                    </th>
                    <th className="py-3 px-3 text-right font-semibold">Khata Receivable</th>
                    <th className="py-3 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{c.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {c.phone || 'No phone'}
                          {c.address ? ` • ${c.address}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            c.customer_type === 'B2B'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {c.customer_type}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-slate-700">
                          {c.state_name} ({c.state_code})
                        </div>
                        {c.gstin && (
                          <div className="font-mono text-[10px] text-slate-500">{c.gstin}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {formatINR(c.total_billed || 0)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {c.invoice_count || 0} bill(s)
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-[11px] font-bold text-violet-900">
                          <Sparkles className="h-3 w-3 text-violet-600" />
                          {formatBV(c.total_bv || 0)}
                        </span>
                        {Number(c.opening_bv || 0) > 0 && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Incl. {formatBV(c.opening_bv)} opening
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-bold tabular-nums">
                        {c.current_balance > 0 ? (
                          <span className="text-amber-700">{formatINR(c.current_balance)} Dr</span>
                        ) : (
                          <span className="text-emerald-700">Settled</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPartyId(c.id);
                              setTab('CUSTOMER_LEDGER');
                            }}
                            className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
                          >
                            Open Ledger
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditClient(c)}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteClient(c)}
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
      ) : (
        /* MASTER-DETAIL LEDGER STATEMENT VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Party Selector List */}
          <div className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="border-b border-slate-200 p-3.5">
              <div className="text-xs font-bold text-slate-800 mb-2">
                {tab === 'CUSTOMER_LEDGER'
                  ? 'Customer Accounts (Receivables)'
                  : 'Supplier Accounts (Payables)'}
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter accounts..."
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
            </div>

            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {(tab === 'CUSTOMER_LEDGER' ? customers : suppliers)
                .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
                .map((p) => {
                  const selected = p.id === selectedPartyId;
                  const custBv =
                    tab === 'CUSTOMER_LEDGER' ? Number((p as Customer).total_bv || 0) : 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPartyId(p.id)}
                      className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 transition ${
                        selected ? 'bg-teal-50 border-l-4 border-teal-700' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-900">{p.name}</div>
                        <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span>
                            {p.state_name} {p.gstin ? `• ${p.gstin}` : ''}
                          </span>
                          {custBv > 0 && (
                            <span className="rounded bg-violet-50 border border-violet-200 px-1.5 py-0.1 text-[9px] font-bold text-violet-800 tabular-nums">
                              {formatBV(custBv)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div
                          className={`text-xs font-extrabold ${
                            p.current_balance > 0
                              ? tab === 'CUSTOMER_LEDGER'
                                ? 'text-amber-700'
                                : 'text-rose-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatINR(p.current_balance)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {p.current_balance > 0
                            ? tab === 'CUSTOMER_LEDGER'
                              ? 'To Collect (Dr)'
                              : 'To Pay (Cr)'
                            : 'Settled'}
                        </div>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Right Chronological Running Ledger Statement */}
          <div className="lg:col-span-8 rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
            {!activeParty ? (
              <div className="p-12 text-center text-xs text-slate-500">
                Select an account on the left to inspect its chronological ledger statement.
              </div>
            ) : (
              <div id="printable-area">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-5">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {organization.business_name} •{' '}
                      {tab === 'CUSTOMER_LEDGER'
                        ? 'Customer Khata Statement'
                        : 'Supplier Payable Statement'}
                    </div>
                    <h3 className="text-lg font-extrabold text-slate-900 mt-0.5">
                      {activeParty.name}
                    </h3>
                    <p className="text-xs text-slate-600">
                      {activeParty.phone ? `Ph: ${activeParty.phone} • ` : ''}
                      {activeParty.state_name} ({activeParty.state_code})
                      {activeParty.gstin ? ` • GSTIN: ${activeParty.gstin}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Separate Non-Monetary Client BV Card (Hidden when printing Customer Khata Statement) */}
                    {tab === 'CUSTOMER_LEDGER' && (
                      <div className="no-print rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2 text-right">
                        <div className="text-[10px] uppercase font-bold text-violet-700">
                          Client Accumulated BV
                        </div>
                        <div className="text-base font-extrabold text-violet-950 tabular-nums">
                          {formatBV((activeParty as Customer).total_bv || 0)}
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-right">
                      <div className="text-[10px] uppercase font-semibold text-slate-400">
                        Closing Balance (₹)
                      </div>
                      <div className="text-base font-extrabold text-slate-900 tabular-nums">
                        {formatINR(activeParty.current_balance)}{' '}
                        <span className="text-xs font-semibold text-slate-500">
                          {activeParty.current_balance > 0
                            ? tab === 'CUSTOMER_LEDGER'
                              ? 'Dr'
                              : 'Cr'
                            : ''}
                        </span>
                      </div>
                    </div>

                    <div className="no-print flex flex-wrap items-center gap-2">
                      {hasExpandableVouchers && (
                        <button
                          type="button"
                          onClick={handleToggleExpandAll}
                          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
                            expandAllItems
                              ? 'border-teal-600 bg-teal-50 text-teal-800'
                              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                          title="Expand or collapse itemized product lines under all bills"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          {expandAllItems ? 'Collapse Items' : 'Expand All Items'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSettleAmountInput(
                            activeParty.current_balance > 0
                              ? String(activeParty.current_balance)
                              : '500'
                          );
                          setSettleModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-teal-800"
                      >
                        <QrCode className="h-4 w-4" />
                        {tab === 'CUSTOMER_LEDGER' ? 'Collect via QR' : 'Record Payout QR'}
                      </button>

                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Printer className="h-4 w-4" />
                        Print Statement
                      </button>
                    </div>
                  </div>
                </div>

                {/* Helpful Hint Bar (Hidden in Print) */}
                {statementEntries.length > 0 && (
                  <div className="no-print flex items-center justify-between gap-2 border-b border-slate-200 bg-teal-50/40 px-4 py-2 text-[11px] text-slate-600">
                    <span>
                      Tip: Click any <strong>Bill / Voucher #</strong> to open &amp; print the full bill, or click{' '}
                      <strong>Items</strong> to expand sold/purchased products inline.
                    </span>
                  </div>
                )}

                {/* Statement Table */}
                <div className="overflow-x-auto">
                  {loadingStatement ? (
                    <div className="p-10 text-center text-xs text-slate-400">
                      Loading ledger entries...
                    </div>
                  ) : statementEntries.length === 0 ? (
                    <div className="p-10 text-center text-xs text-slate-500">
                      No transactions recorded in this ledger yet.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-3 px-4 text-left font-semibold">Date</th>
                          <th className="py-3 px-3 text-left font-semibold">Voucher / Bill #</th>
                          <th className="py-3 px-3 text-left font-semibold">
                            Particulars &amp; Bill Actions
                          </th>
                          <th className="py-3 px-3 text-right font-semibold">Debit (₹)</th>
                          <th className="py-3 px-3 text-right font-semibold">Credit (₹)</th>
                          <th className="py-3 px-4 text-right font-semibold">Running Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementEntries.map((entry) => {
                          const vItems = entry.voucher_items || [];
                          const hasItems = vItems.length > 0;
                          const isExpanded = expandedEntryIds[entry.id] ?? expandAllItems;
                          const canOpenInvoice = Boolean(entry.linked_invoice_id);
                          const canOpenPurchase = Boolean(entry.linked_purchase_id);
                          const isBusy =
                            loadingVoucherId !== null &&
                            (loadingVoucherId === entry.linked_invoice_id ||
                              loadingVoucherId === entry.linked_purchase_id);

                          return (
                            <React.Fragment key={entry.id}>
                              <tr className="hover:bg-slate-50/90 align-top">
                                <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                                  {formatDate(entry.entry_date)}
                                </td>

                                {/* Clickable Voucher # */}
                                <td className="py-3 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                                  {canOpenInvoice ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenInvoiceModal(entry.linked_invoice_id!, 'A4')
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-bold text-teal-800 hover:bg-teal-100 transition"
                                      title="Click to open full printable Invoice Bill"
                                    >
                                      {entry.voucher_no}
                                      <ExternalLink className="no-print h-3 w-3 text-teal-600" />
                                    </button>
                                  ) : canOpenPurchase ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenPurchaseModal(entry.linked_purchase_id!)
                                      }
                                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-800 hover:bg-indigo-100 transition"
                                      title="Click to open full printable Purchase Voucher"
                                    >
                                      {entry.voucher_no}
                                      <ExternalLink className="no-print h-3 w-3 text-indigo-600" />
                                    </button>
                                  ) : (
                                    <span>{entry.voucher_no}</span>
                                  )}
                                </td>

                                {/* Particulars + Inline Expand Toggle + View Bill Action */}
                                <td className="py-3 px-3">
                                  <div className="text-slate-900 font-medium">
                                    {entry.narration}
                                  </div>
                                  {(entry.payment_mode || entry.payment_ref) && (
                                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                      {entry.payment_mode}
                                      {entry.payment_ref ? ` • Ref: ${entry.payment_ref}` : ''}
                                    </div>
                                  )}

                                  {/* Interactive Voucher Controls (Hidden in Print) */}
                                  {(hasItems || canOpenInvoice || canOpenPurchase) && (
                                    <div className="no-print mt-1.5 flex flex-wrap items-center gap-1.5">
                                      {hasItems && (
                                        <button
                                          type="button"
                                          onClick={() => toggleEntryExpanded(entry.id)}
                                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                                        >
                                          {isExpanded ? (
                                            <ChevronDown className="h-3 w-3 text-teal-700" />
                                          ) : (
                                            <ChevronRight className="h-3 w-3 text-slate-500" />
                                          )}
                                          {isExpanded
                                            ? `Hide Items (${vItems.length})`
                                            : `Show Items (${vItems.length})`}
                                        </button>
                                      )}

                                      {canOpenInvoice && entry.entry_type === 'INVOICE' && (
                                        <>
                                          <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() =>
                                              handleOpenInvoiceModal(
                                                entry.linked_invoice_id!,
                                                'A4'
                                              )
                                            }
                                            className="inline-flex items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-800 hover:bg-teal-100"
                                          >
                                            <FileText className="h-3 w-3" />
                                            {isBusy ? 'Opening...' : 'View / Print Bill'}
                                          </button>

                                          {Number(entry.voucher_meta?.total_bv || 0) > 0 && (
                                            <button
                                              type="button"
                                              disabled={isBusy}
                                              onClick={() =>
                                                handleOpenInvoiceModal(
                                                  entry.linked_invoice_id!,
                                                  'OWNER_BV'
                                                )
                                              }
                                              className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800 hover:bg-violet-100"
                                              title="Open Owner's Internal BV Copy"
                                            >
                                              <Sparkles className="h-3 w-3 text-violet-600" />
                                              {formatBV(entry.voucher_meta?.total_bv)} (Owner Copy)
                                            </button>
                                          )}
                                        </>
                                      )}

                                      {canOpenPurchase && entry.entry_type === 'PURCHASE' && (
                                        <button
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() =>
                                            handleOpenPurchaseModal(entry.linked_purchase_id!)
                                          }
                                          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-800 hover:bg-indigo-100"
                                        >
                                          <FileText className="h-3 w-3" />
                                          {isBusy ? 'Opening...' : 'View Purchase Bill'}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-3 text-right tabular-nums font-semibold text-slate-800">
                                  {entry.debit > 0 ? formatINR(entry.debit, false) : '—'}
                                </td>
                                <td className="py-3 px-3 text-right tabular-nums font-semibold text-emerald-700">
                                  {entry.credit > 0 ? formatINR(entry.credit, false) : '—'}
                                </td>
                                <td className="py-3 px-4 text-right tabular-nums font-bold text-slate-900">
                                  {formatINR(Math.abs(entry.balance_after))}{' '}
                                  <span className="text-[10px] text-slate-500">
                                    {entry.balance_after > 0
                                      ? tab === 'CUSTOMER_LEDGER'
                                        ? 'Dr'
                                        : 'Cr'
                                      : ''}
                                  </span>
                                </td>
                              </tr>

                              {/* Inline Expanded Product Breakdown Row */}
                              {hasItems && isExpanded && (
                                <tr className="bg-slate-50/90">
                                  <td colSpan={6} className="px-4 sm:px-6 py-2.5">
                                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
                                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100 text-[11px]">
                                        <span className="font-bold text-slate-800">
                                          Itemized Products on {entry.voucher_no}
                                        </span>
                                        {entry.voucher_meta?.kind === 'INVOICE' ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenInvoiceModal(entry.linked_invoice_id!, 'A4')
                                            }
                                            className="no-print text-[11px] font-semibold text-teal-700 hover:underline"
                                          >
                                            Open Full Invoice →
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleOpenPurchaseModal(entry.linked_purchase_id!)
                                            }
                                            className="no-print text-[11px] font-semibold text-indigo-700 hover:underline"
                                          >
                                            Open Full Purchase Bill →
                                          </button>
                                        )}
                                      </div>

                                      <table className="w-full text-[11px]">
                                        <thead className="text-slate-500 border-b border-slate-100">
                                          <tr>
                                            <th className="py-1 text-left">Product</th>
                                            <th className="py-1 text-left">Batch</th>
                                            <th className="py-1 text-right">Qty</th>
                                            <th className="py-1 text-right">Rate (₹)</th>
                                            <th className="py-1 text-right">GST</th>
                                            <th className="py-1 text-right">Line Total (₹)</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {vItems.map((it) => (
                                            <tr key={it.id}>
                                              <td className="py-1.5 pr-2">
                                                <span className="font-semibold text-slate-900">
                                                  {it.product_name}
                                                </span>{' '}
                                                <span className="font-mono text-[10px] text-slate-400">
                                                  ({it.sku})
                                                </span>
                                              </td>
                                              <td className="py-1.5 font-mono text-[10px] text-slate-600">
                                                {it.batch_summary || it.batch_number || '—'}
                                              </td>
                                              <td className="py-1.5 text-right font-semibold tabular-nums">
                                                {it.quantity}
                                                {Number(it.free_qty || 0) > 0
                                                  ? ` (+${it.free_qty})`
                                                  : ''}{' '}
                                                {it.unit}
                                              </td>
                                              <td className="py-1.5 text-right tabular-nums">
                                                {formatINR(
                                                  it.unit_price ?? it.cost_price ?? 0,
                                                  false
                                                )}
                                              </td>
                                              <td className="py-1.5 text-right text-slate-500 tabular-nums">
                                                {it.gst_rate > 0 ? `${it.gst_rate}%` : '—'}
                                              </td>
                                              <td className="py-1.5 text-right font-bold text-slate-900 tabular-nums">
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
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CLIENT ADD / EDIT MODAL */}
      {clientModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleSaveClient}
            className="max-h-[90vh] overflow-y-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-slate-200 space-y-3.5"
          >
            <h3 className="text-base font-bold text-slate-900">
              {editingClient ? `Edit Client — ${editingClient.name}` : 'Add New Client / Customer'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  required
                  value={cForm.name}
                  onChange={(e) => setCForm({ ...cForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                <select
                  value={cForm.customer_type}
                  onChange={(e) => setCForm({ ...cForm, customer_type: e.target.value as any })}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="B2C">Consumer (B2C)</option>
                  <option value="B2B">Business (B2B)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <input
                  type="text"
                  value={cForm.phone}
                  onChange={(e) => setCForm({ ...cForm, phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
                <select
                  value={cForm.state_code}
                  onChange={(e) => setCForm({ ...cForm, state_code: e.target.value })}
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

            {cForm.customer_type === 'B2B' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Buyer GSTIN
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={cForm.gstin}
                  onChange={(e) => setCForm({ ...cForm, gstin: e.target.value.toUpperCase() })}
                  placeholder="09AAAAA0000A1Z5"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={cForm.address}
                onChange={(e) => setCForm({ ...cForm, address: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Credit Limit (₹)
                </label>
                <input
                  type="number"
                  value={cForm.credit_limit}
                  onChange={(e) => setCForm({ ...cForm, credit_limit: e.target.value })}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              {!editingClient && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Opening Khata (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cForm.opening_balance}
                    onChange={(e) => setCForm({ ...cForm, opening_balance: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-violet-800 mb-1">
                  Opening BV (Optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cForm.opening_bv}
                  onChange={(e) => setCForm({ ...cForm, opening_bv: e.target.value })}
                  className="w-full rounded-xl border border-violet-300 bg-violet-50/40 px-3 py-2 text-sm font-semibold text-violet-900 tabular-nums"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setClientModalOpen(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-teal-700 px-5 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Save Client
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AMOUNT SELECTOR + HAND-TO-HAND QR FOR LEDGER SETTLEMENT */}
      {settleModalOpen && activeParty && (
        <HandToHandQrModal
          open={settleModalOpen}
          onClose={() => setSettleModalOpen(false)}
          title={
            tab === 'CUSTOMER_LEDGER'
              ? `Collect Khata Dues — ${activeParty.name}`
              : `Pay Supplier Dues — ${activeParty.name}`
          }
          subtitle={
            tab === 'CUSTOMER_LEDGER'
              ? 'Customer scans this QR to settle their outstanding Khata balance directly into your UPI.'
              : 'Scan Supplier UPI QR to settle payable ledger balance.'
          }
          upiId={
            tab === 'CUSTOMER_LEDGER'
              ? organization.upi_id
              : (activeParty as Supplier).upi_id || 'supplier@upi'
          }
          payeeName={
            tab === 'CUSTOMER_LEDGER'
              ? organization.upi_payee_name || organization.business_name
              : activeParty.name
          }
          totalAmount={Math.max(
            1,
            parseFloat(settleAmountInput) || activeParty.current_balance || 500
          )}
          defaultNote={`Ledger Settlement - ${activeParty.name}`}
          allowModeSwitch
          allowCreditLedger={false}
          customerName={activeParty.name}
          direction={tab === 'CUSTOMER_LEDGER' ? 'COLLECT' : 'PAY_SUPPLIER'}
          submitting={settling}
          onConfirm={handleConfirmSettlement}
        />
      )}

      {/* PRINTABLE PURCHASE VOUCHER MODAL (FOR SUPPLIER LEDGER) */}
      <PurchasePrintModal
        purchase={printingPurchase}
        organization={organization}
        onClose={() => setPrintingPurchase(null)}
      />
    </div>
  );
};
