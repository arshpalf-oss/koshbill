import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  IndianRupee,
  Plus,
  Printer,
  QrCode,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatDate, formatINR, getExpiryMeta } from '../lib/format';
import { Invoice, NavSection, Organization } from '../types';

interface DashboardViewProps {
  organization: Organization;
  onNavigate: (section: NavSection, subAction?: string) => void;
  onOpenInvoicePrint: (invoiceId: number) => void;
  onOpenSettleInvoice: (invoice: Invoice) => void;
  refreshTrigger: number;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  organization,
  onNavigate,
  onOpenInvoicePrint,
  onOpenSettleInvoice,
  refreshTrigger,
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch('/dashboard')
      .then((res) => {
        if (mounted) setData(res);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refreshTrigger, organization.gst_enabled]);

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200/70" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 h-72 rounded-2xl bg-slate-200/70" />
          <div className="h-72 rounded-2xl bg-slate-200/70" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, low_stock_items, expiry_alerts, recent_invoices, daily_sales, today } = data;
  const maxDailySale = Math.max(
    1,
    ...(daily_sales || []).map((d: any) => Number(d.total || 0))
  );

  return (
    <div className="space-y-6">
      {/* Top Action Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:px-6 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{organization.business_name}</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                organization.gst_enabled
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {organization.gst_enabled
                ? `GST Active${organization.gstin ? ` • ${organization.gstin}` : ''}`
                : 'Non-GST Retail Mode'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Store Date: <span className="font-semibold text-slate-700">{formatDate(today)}</span> •
            UPI QR ID: <span className="font-mono text-teal-700">{organization.upi_id}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('billing', 'new')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs hover:bg-teal-800 transition"
          >
            <QrCode className="h-4 w-4" />
            New Counter Bill + QR
          </button>
          <button
            type="button"
            onClick={() => onNavigate('purchases', 'new')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Plus className="h-4 w-4 text-teal-700" />
            Stock-In Purchase
          </button>
          <button
            type="button"
            onClick={() => onNavigate('ledgers')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Wallet className="h-4 w-4 text-amber-600" />
            Khata Ledgers
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Today&apos;s Counter Sales</span>
            <div className="rounded-lg bg-teal-50 p-2 text-teal-700">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900 tabular-nums">
            {formatINR(kpis.today_revenue)}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
            <span>{kpis.today_bills} bill(s) issued today</span>
            <button
              type="button"
              onClick={() => onNavigate('billing', 'history')}
              className="font-semibold text-teal-700 hover:underline inline-flex items-center gap-0.5"
            >
              View <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Month Sales & FIFO Profit</span>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900 tabular-nums">
            {formatINR(kpis.month_revenue)}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-emerald-700 font-semibold tabular-nums">
              FIFO Profit: {formatINR(kpis.month_gross_profit)}
            </span>
            <span className="text-slate-400 tabular-nums">{kpis.month_bills} bills</span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Khata Receivables vs Payables</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
              <Wallet className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900 tabular-nums">
            {formatINR(kpis.total_receivables)}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              From {kpis.receivable_parties} client(s)
            </span>
            <span className="text-rose-700 font-medium tabular-nums">
              To Pay: {formatINR(kpis.total_payables)}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Active FIFO Stock Valuation</span>
            <div className="rounded-lg bg-indigo-50 p-2 text-indigo-700">
              <Boxes className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 text-2xl font-extrabold text-slate-900 tabular-nums">
            {formatINR(kpis.inventory_fifo_value)}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500">
            <span>{kpis.active_batches} active FIFO batches</span>
            <span className="tabular-nums">Retail: {formatINR(kpis.inventory_retail_value)}</span>
          </div>
        </div>
      </div>

      {/* Middle Row: Sales Trend + Batch Expiry & Reorder Watch */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Daily Revenue Chart & Recent Invoices */}
        <div className="lg:col-span-7 space-y-5">
          {/* Revenue Trend Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Recent Billing Activity</h3>
                <p className="text-xs text-slate-500">
                  Daily gross billing volume across GST & Non-GST counter sales
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="text-xs font-semibold text-teal-700 hover:underline"
              >
                Full Reports →
              </button>
            </div>

            {daily_sales.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                No sales issued yet. Issue your first counter bill to see daily trends!
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-7 gap-2.5 items-end pt-4">
                {daily_sales.slice(-7).map((d: any) => {
                  const pct = Math.max(14, Math.round((Number(d.total) / maxDailySale) * 110));
                  return (
                    <div
                      key={d.date}
                      className="flex flex-col items-center rounded-xl border border-slate-100 bg-slate-50/70 p-2.5"
                    >
                      <div className="text-[10px] font-bold text-slate-700 tabular-nums mb-1.5">
                        {formatINR(d.total)}
                      </div>
                      <div className="h-28 w-full flex items-end justify-center">
                        <div
                          style={{ height: `${pct}px` }}
                          className="w-8 rounded-t-lg bg-teal-600 transition-all"
                        />
                      </div>
                      <div className="mt-2 text-[10px] font-semibold text-slate-600">
                        {formatDate(d.date).slice(0, 6)}
                      </div>
                      <div className="text-[10px] text-slate-400">{d.bills} bill(s)</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Bills Table */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">Latest Issued Bills</h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('billing', 'history')}
                className="text-xs font-semibold text-teal-700 hover:underline"
              >
                All Invoices →
              </button>
            </div>

            {recent_invoices.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No invoices issued yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-semibold">Invoice #</th>
                      <th className="py-2.5 px-3 text-left font-semibold">Customer</th>
                      <th className="py-2.5 px-3 text-right font-semibold">Total</th>
                      <th className="py-2.5 px-3 text-center font-semibold">Status</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recent_invoices.map((inv: Invoice) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-bold text-slate-900">
                            {inv.invoice_number}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {formatDate(inv.invoice_date)} •{' '}
                            {inv.is_gst ? 'GST' : 'Non-GST'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">
                          {inv.customer_name}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                          {formatINR(inv.grand_total)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                              inv.status === 'CANCELLED'
                                ? 'bg-slate-100 text-slate-500 border-slate-200'
                                : inv.payment_status === 'PAID'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {inv.status === 'CANCELLED'
                              ? 'CANCELLED'
                              : `${inv.payment_status} (${inv.payment_mode})`}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {inv.status === 'ISSUED' && inv.balance_due > 0 && (
                              <button
                                type="button"
                                onClick={() => onOpenSettleInvoice(inv)}
                                className="rounded-lg bg-amber-50 border border-amber-200 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                                title="Collect balance via Hand-to-Hand QR"
                              >
                                QR Pay
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenInvoicePrint(inv.id)}
                              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              title="View & Print Invoice"
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: FIFO Batch Expiry Radar + Low Stock Alerts */}
        <div className="lg:col-span-5 space-y-5">
          {/* Batch Expiry Radar */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Batch Expiry Radar (≤ 60d)</h3>
                  <p className="text-[11px] text-slate-500">
                    Expired batches are auto-skipped by FIFO billing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory', 'batches')}
                className="text-xs font-semibold text-teal-700 hover:underline"
              >
                Manage →
              </button>
            </div>

            {expiry_alerts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                All active batches have healthy shelf life (&gt; 60 days).
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {expiry_alerts.map((b: any) => {
                  const meta = getExpiryMeta(b.expiry_date, today);
                  return (
                    <div
                      key={b.id}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-slate-900">
                          {b.product_name}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Batch #{b.batch_number} • Qty: {b.remaining_qty} {b.unit}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Low Stock Reorder Watchlist */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Low Stock Reorder Alerts</h3>
                  <p className="text-[11px] text-slate-500">
                    Sellable non-expired stock at or below reorder level
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('purchases', 'new')}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-100"
              >
                <ShoppingBag className="h-3 w-3" /> Restock
              </button>
            </div>

            {low_stock_items.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                All products are well stocked above reorder thresholds.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {low_stock_items.map((item: any) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">
                        {item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono">
                        {item.sku} • Reorder Level: {item.reorder_level} {item.unit}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="inline-block rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 tabular-nums">
                        {item.available_stock} {item.unit} left
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
