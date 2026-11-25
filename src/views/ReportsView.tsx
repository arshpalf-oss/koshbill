import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Printer,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  formatBV,
  formatDate,
  formatINR,
  getExpiryMeta,
  getFirstOfMonthISO,
  getTodayISO,
} from '../lib/format';
import { Invoice, Organization } from '../types';

interface ReportsViewProps {
  organization: Organization;
  onOpenInvoicePrint: (invoice: Invoice, initialFormat?: 'A4' | 'THERMAL' | 'OWNER_BV') => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  organization,
  onOpenInvoicePrint,
  notify,
}) => {
  const [tab, setTab] = useState<'SALES' | 'BV' | 'GST' | 'MOVEMENTS' | 'VALUATION'>('SALES');
  const [salesSubView, setSalesSubView] = useState<'ITEMIZED' | 'INVOICES' | 'PRODUCTS'>(
    'ITEMIZED'
  );
  const [bvSubView, setBvSubView] = useState<'CUSTOMER' | 'INVOICE' | 'PRODUCT'>('CUSTOMER');
  const [searchQuery, setSearchQuery] = useState('');

  const [fromDate, setFromDate] = useState(getFirstOfMonthISO());
  const [toDate, setToDate] = useState(getTodayISO());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadReports = async (f = fromDate, t = toDate) => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/reports?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`
      );
      setData(res);
    } catch (err: any) {
      notify(err.message || 'Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleOpenInvoice = async (
    invoiceId: number,
    format: 'A4' | 'THERMAL' | 'OWNER_BV' = 'A4'
  ) => {
    try {
      const res = await apiFetch<{ invoice: Invoice }>(`/invoices/${invoiceId}`);
      onOpenInvoicePrint(res.invoice, format);
    } catch (err: any) {
      notify(err.message || 'Failed to open invoice', 'error');
    }
  };

  const q = searchQuery.trim().toLowerCase();

  const filteredItemizedSales = useMemo(() => {
    const rows = data?.itemized_sales || [];
    if (!q) return rows;
    return rows.filter(
      (r: any) =>
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredSalesInvoices = useMemo(() => {
    const rows = data?.sales_invoices || [];
    if (!q) return rows;
    return rows.filter(
      (r: any) =>
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.items_summary || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredTopProducts = useMemo(() => {
    const rows = data?.top_products || [];
    if (!q) return rows;
    return rows.filter(
      (p: any) =>
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.customer_names || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredBvCustomers = useMemo(() => {
    const rows = data?.bv_report?.by_customer || [];
    if (!q) return rows;
    return rows.filter(
      (r: any) =>
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.customer_phone || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredBvInvoices = useMemo(() => {
    const rows = data?.bv_report?.by_invoice || [];
    if (!q) return rows;
    return rows.filter(
      (r: any) =>
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q) ||
        (r.items_bv_summary || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredBvProducts = useMemo(() => {
    const rows = data?.bv_report?.by_product || [];
    if (!q) return rows;
    return rows.filter(
      (r: any) =>
        (r.product_name || '').toLowerCase().includes(q) ||
        (r.sku || '').toLowerCase().includes(q) ||
        (r.customer_names || '').toLowerCase().includes(q)
    );
  }, [data, q]);

  const exportCsv = () => {
    if (!data) return;
    let csv = '';
    let filename = `koshbill_${tab.toLowerCase()}_${fromDate}_to_${toDate}.csv`;

    if (tab === 'SALES') {
      if (salesSubView === 'ITEMIZED') {
        filename = `koshbill_sales_customer_items_${fromDate}_to_${toDate}.csv`;
        csv =
          'Date,Invoice #,Customer Name,Customer Phone,Item Name,SKU,Batch,Qty,Unit,Line Total (INR),FIFO Cost (INR),Gross Profit (INR),BV Earned\n';
        for (const r of filteredItemizedSales) {
          csv += `"${r.invoice_date}","${r.invoice_number}","${r.customer_name}","${r.customer_phone || ''}","${r.product_name}","${r.sku}","${r.batch_summary || ''}",${r.quantity},"${r.unit}",${r.line_total},${r.fifo_cost_total},${r.gross_profit},${r.line_bv_total || 0}\n`;
        }
      } else if (salesSubView === 'INVOICES') {
        filename = `koshbill_sales_invoices_${fromDate}_to_${toDate}.csv`;
        csv =
          'Date,Invoice #,Customer Name,Items Purchased,Payment Mode,Grand Total (INR),Gross Profit (INR),BV Earned\n';
        for (const r of filteredSalesInvoices) {
          csv += `"${r.invoice_date}","${r.invoice_number}","${r.customer_name}","${(r.items_summary || '').replace(/"/g, '""')}","${r.payment_mode}",${r.grand_total},${r.gross_profit},${r.total_bv || 0}\n`;
        }
      } else {
        filename = `koshbill_sales_products_${fromDate}_to_${toDate}.csv`;
        csv =
          'SKU,Product,Customers,Unit,Qty Sold,Net Taxable Revenue,FIFO Cost,Gross Profit,Gross Billing,Total BV\n';
        for (const p of filteredTopProducts) {
          csv += `"${p.sku}","${p.product_name}","${(p.customer_names || '').replace(/"/g, '""')}","${p.unit}",${p.qty_sold},${p.net_revenue},${p.fifo_cost},${p.gross_profit},${p.gross_revenue},${p.total_bv || 0}\n`;
        }
      }
    } else if (tab === 'BV') {
      if (bvSubView === 'CUSTOMER') {
        filename = `koshbill_bv_by_customer_${fromDate}_to_${toDate}.csv`;
        csv =
          'Customer Name,Phone,Invoices Count,Total Qty Purchased,Period BV Earned,Lifetime Accumulated BV,Monetary Spend Ref (INR)\n';
        for (const c of filteredBvCustomers) {
          csv += `"${c.customer_name}","${c.customer_phone || ''}",${c.invoice_count},${c.total_qty},${c.period_bv},${c.lifetime_total_bv},${c.monetary_spend}\n`;
        }
      } else if (bvSubView === 'INVOICE') {
        filename = `koshbill_bv_by_invoice_${fromDate}_to_${toDate}.csv`;
        csv =
          'Date,Invoice #,Customer Name,Phone,Items & BV Summary,BV Lines Included,BV Lines Removed,Total BV Earned,Shown on Customer Bill,Invoice Monetary Total (INR)\n';
        for (const inv of filteredBvInvoices) {
          csv += `"${inv.invoice_date}","${inv.invoice_number}","${inv.customer_name}","${inv.customer_phone || ''}","${(inv.items_bv_summary || '').replace(/"/g, '""')}",${inv.included_lines},${inv.excluded_lines},${inv.total_bv},"${inv.show_bv_on_bill ? 'Yes' : 'Hidden'}",${inv.grand_total}\n`;
        }
      } else {
        filename = `koshbill_bv_by_product_${fromDate}_to_${toDate}.csv`;
        csv =
          'SKU,Product Name,Catalog Default BV/Unit,Customers,Total Qty Sold,BV Eligible Qty,BV Removed Qty,Total BV Generated\n';
        for (const p of filteredBvProducts) {
          csv += `"${p.sku}","${p.product_name}",${p.catalog_default_bv},"${(p.customer_names || '').replace(/"/g, '""')}",${p.total_qty_sold},${p.bv_eligible_qty},${p.bv_removed_qty},${p.total_bv_generated}\n`;
        }
      }
    } else if (tab === 'GST') {
      csv = 'HSN Code,GST Rate %,Unit,Total Qty,Taxable Value,CGST,SGST,IGST,Total Value\n';
      for (const h of data.gst_report?.hsn_summary || []) {
        csv += `"${h.hsn_code}",${h.gst_rate},"${h.unit}",${h.total_qty},${h.taxable_value},${h.cgst_amount},${h.sgst_amount},${h.igst_amount},${h.total_value}\n`;
      }
    } else if (tab === 'MOVEMENTS') {
      csv = 'Type,Product,SKU,Batch #,Qty Change,Balance After,Unit Cost,Voucher Ref,Notes\n';
      for (const m of data.stock_movements || []) {
        csv += `"${m.movement_type}","${m.product_name}","${m.sku}","${m.batch_number}",${m.quantity_change},${m.balance_after},${m.unit_cost},"${m.reference_no}","${m.notes}"\n`;
      }
    } else {
      csv =
        'Batch #,Product,SKU,Received Date,Expiry Date,Remaining Qty,Cost Rate,Sell Rate,FIFO Cost Value\n';
      for (const b of data.active_batches || []) {
        csv += `"${b.batch_number}","${b.product_name}","${b.sku}","${b.received_date}","${b.expiry_date}",${b.remaining_qty},${b.cost_price},${b.selling_price},${(b.remaining_qty * b.cost_price).toFixed(2)}\n`;
      }
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${filename}`);
  };

  return (
    <div className="space-y-5">
      {/* Filter & Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-600">From:</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-600">To:</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => loadReports(fromDate, toDate)}
            className="rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
          >
            Apply Range
          </button>
          <button
            type="button"
            onClick={() => {
              const f = getFirstOfMonthISO();
              const t = getTodayISO();
              setFromDate(f);
              setToDate(t);
              loadReports(f, t);
            }}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            This Month
          </button>
        </div>

        <div className="flex items-center gap-2">
          {(tab === 'SALES' || tab === 'BV') && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer, bill #, item..."
                className="w-48 sm:w-56 rounded-xl border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-teal-600 focus:outline-none"
              />
            </div>
          )}

          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5 text-teal-700" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Report
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-2xs gap-0.5">
        <button
          type="button"
          onClick={() => setTab('SALES')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
            tab === 'SALES' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Sales &amp; Customer Items
        </button>

        <button
          type="button"
          onClick={() => setTab('BV')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
            tab === 'BV'
              ? 'bg-violet-700 text-white'
              : 'text-violet-800 hover:bg-violet-50'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          BV (Business Value) Report
        </button>

        <button
          type="button"
          onClick={() => setTab('GST')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
            tab === 'GST' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          GST / GSTR-1 &amp; HSN
        </button>

        <button
          type="button"
          onClick={() => setTab('MOVEMENTS')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
            tab === 'MOVEMENTS' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          Inventory Movements
        </button>

        <button
          type="button"
          onClick={() => setTab('VALUATION')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
            tab === 'VALUATION' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          FIFO Valuation &amp; Expiry
        </button>
      </div>

      {loading || !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-400">
          Compiling report analytics...
        </div>
      ) : (
        <div id="printable-area" className="space-y-5">
          {/* TAB 1: SALES, CUSTOMER-ITEM REGISTER & FIFO PROFIT */}
          {tab === 'SALES' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">
                    Gross Sales ({data.sales_summary.invoice_count} bills)
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {formatINR(data.sales_summary.gross_revenue)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Net Sales (Excl. GST)</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {formatINR(data.sales_summary.net_taxable_sales)}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Exact FIFO Cost of Goods Sold</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-700 tabular-nums">
                    {formatINR(data.sales_summary.fifo_cogs)}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <div className="text-xs font-semibold text-emerald-800">
                    Gross Profit (FIFO Margin)
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-800 tabular-nums">
                    {formatINR(data.sales_summary.gross_profit)}
                  </div>
                </div>
              </div>

              {/* Sales Register Card with Customer Name + Sold Items */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-slate-50/60">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {salesSubView === 'ITEMIZED'
                        ? 'Customer & Sold Items Register (Every Line Item with Customer Name)'
                        : salesSubView === 'INVOICES'
                          ? 'Invoice-Wise Sales Register (Customer Name & Purchased Items)'
                          : 'Product Sales Summary & Buyers List'}
                    </h4>
                  </div>

                  <div className="no-print inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setSalesSubView('ITEMIZED')}
                      className={`rounded-md px-2.5 py-1 font-semibold transition ${
                        salesSubView === 'ITEMIZED'
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Customer + Sold Items ({filteredItemizedSales.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalesSubView('INVOICES')}
                      className={`rounded-md px-2.5 py-1 font-semibold transition ${
                        salesSubView === 'INVOICES'
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      By Invoice ({filteredSalesInvoices.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalesSubView('PRODUCTS')}
                      className={`rounded-md px-2.5 py-1 font-semibold transition ${
                        salesSubView === 'PRODUCTS'
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      By Product ({filteredTopProducts.length})
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  {salesSubView === 'ITEMIZED' ? (
                    filteredItemizedSales.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-500">
                        No sold items found in the selected date range.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <tr>
                            <th className="py-2.5 px-4 text-left font-semibold">Date &amp; Bill #</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Customer Name</th>
                            <th className="py-2.5 px-3 text-left font-semibold">
                              Sold Item &amp; FIFO Batch
                            </th>
                            <th className="py-2.5 px-3 text-right font-semibold">Qty</th>
                            <th className="py-2.5 px-3 text-right font-semibold">Bill Amt (₹)</th>
                            <th className="py-2.5 px-3 text-right font-semibold">FIFO Cost</th>
                            <th className="py-2.5 px-3 text-right font-semibold">Profit</th>
                            <th className="py-2.5 px-4 text-right font-semibold text-violet-800">
                              BV
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredItemizedSales.map((r: any) => (
                            <tr key={r.item_row_id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-4 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenInvoice(r.invoice_id, 'A4')}
                                  className="inline-flex items-center gap-1 font-mono font-bold text-teal-800 hover:underline"
                                  title="Open Invoice Bill"
                                >
                                  {r.invoice_number}
                                  <ExternalLink className="no-print h-3 w-3" />
                                </button>
                                <div className="text-[10px] text-slate-500">
                                  {formatDate(r.invoice_date)}
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{r.customer_name}</div>
                                {r.customer_phone && (
                                  <div className="text-[10px] text-slate-500">
                                    {r.customer_phone}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-slate-900">{r.product_name}</div>
                                <div className="font-mono text-[10px] text-slate-500">
                                  {r.sku}
                                  {r.batch_summary ? ` • FIFO: ${r.batch_summary}` : ''}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                                {r.quantity} {r.unit}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                                {formatINR(r.line_total)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {formatINR(r.fifo_cost_total)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-700 tabular-nums">
                                {formatINR(r.gross_profit)}
                              </td>
                              <td className="py-2.5 px-4 text-right tabular-nums">
                                {!r.bv_included && Number(r.bv_per_unit || 0) > 0 ? (
                                  <span className="text-[10px] font-semibold text-rose-600">
                                    Off
                                  </span>
                                ) : Number(r.line_bv_total || 0) > 0 ? (
                                  <span className="font-bold text-violet-800">
                                    {formatBV(r.line_bv_total)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : salesSubView === 'INVOICES' ? (
                    filteredSalesInvoices.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-500">
                        No invoices found in the selected date range.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <tr>
                            <th className="py-2.5 px-4 text-left font-semibold">Invoice #</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Date</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Customer Name</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Purchased Items</th>
                            <th className="py-2.5 px-3 text-right font-semibold">Grand Total</th>
                            <th className="py-2.5 px-3 text-right font-semibold">Profit</th>
                            <th className="py-2.5 px-4 text-right font-semibold text-violet-800">
                              BV
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredSalesInvoices.map((inv: any) => (
                            <tr key={inv.invoice_id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-4 font-mono font-bold">
                                <button
                                  type="button"
                                  onClick={() => handleOpenInvoice(inv.invoice_id, 'A4')}
                                  className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                                >
                                  {inv.invoice_number}
                                  <ExternalLink className="no-print h-3 w-3" />
                                </button>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {formatDate(inv.invoice_date)}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{inv.customer_name}</div>
                                {inv.customer_phone && (
                                  <div className="text-[10px] text-slate-500">
                                    {inv.customer_phone}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-700 max-w-xs">
                                {inv.items_summary || '—'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                                {formatINR(inv.grand_total)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-emerald-700 tabular-nums">
                                {formatINR(inv.gross_profit)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-bold text-violet-800 tabular-nums">
                                {Number(inv.total_bv || 0) > 0 ? formatBV(inv.total_bv) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2.5 px-4 text-left font-semibold">Item</th>
                          <th className="py-2.5 px-3 text-left font-semibold">
                            Customer Name(s)
                          </th>
                          <th className="py-2.5 px-3 text-right font-semibold">Qty Sold</th>
                          <th className="py-2.5 px-3 text-right font-semibold">Net Sales</th>
                          <th className="py-2.5 px-3 text-right font-semibold">FIFO COGS</th>
                          <th className="py-2.5 px-4 text-right font-semibold">Gross Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredTopProducts.map((p: any) => (
                          <tr key={p.product_id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{p.product_name}</div>
                              <div className="font-mono text-[10px] text-slate-500">{p.sku}</div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 max-w-xs">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-800">
                                <Users className="h-3 w-3 text-slate-400 shrink-0" />
                                {p.customer_names || '—'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                              {p.qty_sold} {p.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">
                              {formatINR(p.net_revenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">
                              {formatINR(p.fifo_cost)}
                            </td>
                            <td className="py-2.5 px-4 text-right tabular-nums font-bold text-emerald-700">
                              {formatINR(p.gross_profit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Payment Mode Breakdown */}
              {(data.payment_breakdown || []).length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <h4 className="text-sm font-bold text-slate-900 mb-3">
                    Collection by Payment Mode
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(data.payment_breakdown || []).map((pm: any) => (
                      <div
                        key={pm.payment_mode}
                        className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <span className="font-bold text-slate-900">{pm.payment_mode}</span>
                          <span className="ml-2 text-slate-500">({pm.count} bills)</span>
                        </div>
                        <span className="font-extrabold text-teal-800 tabular-nums">
                          {formatINR(pm.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: DEDICATED BV (BUSINESS VALUE) REPORT — 3 COMPLETE VIEWS */}
          {tab === 'BV' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                  <div className="text-xs font-semibold text-violet-800">
                    Total BV Generated (Period)
                  </div>
                  <div className="mt-1 text-xl font-extrabold text-violet-950 tabular-nums">
                    {formatBV(data.bv_report?.summary?.total_bv_earned || 0)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-violet-700">
                    Strictly non-monetary (never added to ₹ totals)
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">BV-Earning Invoices</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {data.bv_report?.summary?.bv_invoices_count || 0} bill(s)
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Unique Clients with BV</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {data.bv_report?.summary?.unique_customers_with_bv || 0} client(s)
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">BV-Eligible Units Sold</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {data.bv_report?.summary?.total_bv_units || 0} units
                  </div>
                  {(data.bv_report?.summary?.lines_with_bv_removed || 0) > 0 && (
                    <div className="mt-0.5 text-[10px] font-semibold text-rose-600">
                      {data.bv_report.summary.lines_with_bv_removed} line(s) had BV manually removed
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 bg-violet-50/40">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {bvSubView === 'CUSTOMER'
                        ? 'Customer-Wise BV Earned & Accumulated Totals'
                        : bvSubView === 'INVOICE'
                          ? 'Invoice-Wise BV Register (with Customer Name & Owner Copy Access)'
                          : 'Product-Wise BV Breakdown & Buyers'}
                    </h4>
                  </div>

                  <div className="no-print inline-flex rounded-lg border border-violet-200 bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setBvSubView('CUSTOMER')}
                      className={`rounded-md px-3 py-1 font-semibold transition ${
                        bvSubView === 'CUSTOMER'
                          ? 'bg-violet-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      1. Customer-Wise BV ({filteredBvCustomers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBvSubView('INVOICE')}
                      className={`rounded-md px-3 py-1 font-semibold transition ${
                        bvSubView === 'INVOICE'
                          ? 'bg-violet-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      2. Invoice-Wise BV ({filteredBvInvoices.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBvSubView('PRODUCT')}
                      className={`rounded-md px-3 py-1 font-semibold transition ${
                        bvSubView === 'PRODUCT'
                          ? 'bg-violet-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      3. Product-Wise BV ({filteredBvProducts.length})
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  {bvSubView === 'CUSTOMER' ? (
                    filteredBvCustomers.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-500">
                        No customer BV records found in this date range.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <tr>
                            <th className="py-2.5 px-4 text-left font-semibold">
                              Customer / Client Name
                            </th>
                            <th className="py-2.5 px-3 text-right font-semibold">Bills</th>
                            <th className="py-2.5 px-3 text-right font-semibold">Items Qty</th>
                            <th className="py-2.5 px-3 text-right font-semibold text-violet-900">
                              Period BV Earned
                            </th>
                            <th className="py-2.5 px-3 text-right font-semibold text-violet-950">
                              Lifetime Accumulated BV
                            </th>
                            <th className="py-2.5 px-4 text-right font-semibold text-slate-500">
                              Ref. Bill Spend (₹)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredBvCustomers.map((c: any, idx: number) => (
                            <tr key={c.customer_id ?? `walkin-${idx}`} className="hover:bg-slate-50">
                              <td className="py-2.5 px-4">
                                <div className="font-bold text-slate-900">{c.customer_name}</div>
                                <div className="text-[10px] text-slate-500">
                                  {c.customer_phone ||
                                    (c.customer_id ? 'Registered Client' : 'Walk-in Consumer')}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {c.invoice_count}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                {c.total_qty}
                              </td>
                              <td className="py-2.5 px-3 text-right font-bold text-violet-800 tabular-nums">
                                {formatBV(c.period_bv)}
                              </td>
                              <td className="py-2.5 px-3 text-right tabular-nums">
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 border border-violet-300 px-2.5 py-0.5 text-[11px] font-extrabold text-violet-950">
                                  {formatBV(c.lifetime_total_bv)}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-right text-slate-600 tabular-nums">
                                {formatINR(c.monetary_spend)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : bvSubView === 'INVOICE' ? (
                    filteredBvInvoices.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-500">
                        No invoices found in this date range.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <tr>
                            <th className="py-2.5 px-4 text-left font-semibold">Invoice #</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Date</th>
                            <th className="py-2.5 px-3 text-left font-semibold">Customer Name</th>
                            <th className="py-2.5 px-3 text-left font-semibold">
                              Sold Items &amp; BV Breakdown
                            </th>
                            <th className="py-2.5 px-3 text-center font-semibold">
                              Customer Bill Status
                            </th>
                            <th className="py-2.5 px-3 text-right font-semibold text-violet-950">
                              Total BV
                            </th>
                            <th className="py-2.5 px-4 text-right font-semibold no-print">
                              Owner Record
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredBvInvoices.map((inv: any) => (
                            <tr key={inv.invoice_id} className="hover:bg-slate-50">
                              <td className="py-2.5 px-4 font-mono font-bold">
                                <button
                                  type="button"
                                  onClick={() => handleOpenInvoice(inv.invoice_id, 'A4')}
                                  className="text-teal-800 hover:underline"
                                >
                                  {inv.invoice_number}
                                </button>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {formatDate(inv.invoice_date)}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{inv.customer_name}</div>
                                {inv.customer_phone && (
                                  <div className="text-[10px] text-slate-500">
                                    {inv.customer_phone}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-slate-700 max-w-xs">
                                <div>{inv.items_bv_summary || '—'}</div>
                                {inv.excluded_lines > 0 && (
                                  <div className="text-[10px] font-semibold text-rose-600 mt-0.5">
                                    {inv.excluded_lines} item(s) had BV removed on bill
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                                    inv.show_bv_on_bill
                                      ? 'bg-violet-50 text-violet-800 border-violet-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {inv.show_bv_on_bill ? 'Shown on Bill' : 'Hidden on Bill'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right font-extrabold text-violet-950 tabular-nums">
                                {formatBV(inv.total_bv)}
                              </td>
                              <td className="py-2.5 px-4 text-right no-print">
                                <button
                                  type="button"
                                  onClick={() => handleOpenInvoice(inv.invoice_id, 'OWNER_BV')}
                                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-900 hover:bg-violet-100"
                                >
                                  <Sparkles className="h-3 w-3 text-violet-700" />
                                  Owner BV Copy
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : filteredBvProducts.length === 0 ? (
                    <div className="p-10 text-center text-xs text-slate-500">
                      No product sales found in this date range.
                    </div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2.5 px-4 text-left font-semibold">Product &amp; SKU</th>
                          <th className="py-2.5 px-3 text-left font-semibold">
                            Customer Name(s)
                          </th>
                          <th className="py-2.5 px-3 text-right font-semibold">
                            Default BV / Unit
                          </th>
                          <th className="py-2.5 px-3 text-right font-semibold">Total Qty Sold</th>
                          <th className="py-2.5 px-3 text-right font-semibold">BV-Eligible Qty</th>
                          <th className="py-2.5 px-3 text-right font-semibold">BV-Removed Qty</th>
                          <th className="py-2.5 px-4 text-right font-semibold text-violet-950">
                            Total BV Generated
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredBvProducts.map((p: any) => (
                          <tr key={p.product_id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{p.product_name}</div>
                              <div className="font-mono text-[10px] text-slate-500">{p.sku}</div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 max-w-xs">
                              {p.customer_names || '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-violet-800 tabular-nums">
                              {formatBV(p.catalog_default_bv)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                              {p.total_qty_sold} {p.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-700 font-semibold tabular-nums">
                              {p.bv_eligible_qty} {p.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right text-rose-600 tabular-nums">
                              {p.bv_removed_qty > 0 ? `${p.bv_removed_qty} ${p.unit}` : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-extrabold text-violet-950 tabular-nums">
                              {formatBV(p.total_bv_generated)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}

          {/* TAB 3: GST / GSTR-1 & HSN SUMMARY */}
          {tab === 'GST' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Output GST Collected (Sales)</div>
                  <div className="mt-1 text-xl font-extrabold text-indigo-800 tabular-nums">
                    {formatINR(data.sales_summary.total_gst_collected)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    CGST: {formatINR(data.sales_summary.total_cgst)} • SGST:{' '}
                    {formatINR(data.sales_summary.total_sgst)} • IGST:{' '}
                    {formatINR(data.sales_summary.total_igst)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Input Tax Credit — ITC (Purchases)</div>
                  <div className="mt-1 text-xl font-extrabold text-teal-800 tabular-nums">
                    {formatINR(data.gst_report.purchase_itc.total_itc)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    From {data.gst_report.purchase_itc.purchase_count} purchase bill(s)
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Net GST Payable / (ITC Carryforward)</div>
                  <div className="mt-1 text-xl font-extrabold text-slate-900 tabular-nums">
                    {formatINR(data.gst_report.net_gst_payable)}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {data.gst_report.net_gst_payable < 0
                      ? 'Excess Input Tax Credit available'
                      : 'Net tax liability after ITC offset'}
                  </div>
                </div>
              </div>

              {/* B2B vs B2C Summary */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3.5">
                  <h4 className="text-sm font-bold text-slate-900">
                    GSTR-1 Outward Supplies — B2B vs B2C Breakup
                  </h4>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4 text-left">Segment</th>
                      <th className="py-2.5 px-3 text-right">Invoices</th>
                      <th className="py-2.5 px-3 text-right">Taxable Value</th>
                      <th className="py-2.5 px-3 text-right">CGST</th>
                      <th className="py-2.5 px-3 text-right">SGST</th>
                      <th className="py-2.5 px-3 text-right">IGST</th>
                      <th className="py-2.5 px-4 text-right">Invoice Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.gst_report.b2b_vs_b2c || []).map((row: any) => (
                      <tr key={row.segment}>
                        <td className="py-2.5 px-4 font-bold text-slate-900">{row.segment}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{row.invoice_count}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatINR(row.taxable_value)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(row.cgst)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(row.sgst)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(row.igst)}</td>
                        <td className="py-2.5 px-4 text-right font-bold tabular-nums">
                          {formatINR(row.invoice_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* HSN Summary Table */}
              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 px-5 py-3.5">
                  <h4 className="text-sm font-bold text-slate-900">
                    GSTR-1 Table 12 — HSN-Wise Summary of Outward Supplies
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2.5 px-4 text-left">HSN / SAC</th>
                        <th className="py-2.5 px-3 text-right">UQC</th>
                        <th className="py-2.5 px-3 text-right">Total Qty</th>
                        <th className="py-2.5 px-3 text-right">Rate</th>
                        <th className="py-2.5 px-3 text-right">Taxable Value</th>
                        <th className="py-2.5 px-3 text-right">CGST</th>
                        <th className="py-2.5 px-3 text-right">SGST</th>
                        <th className="py-2.5 px-3 text-right">IGST</th>
                        <th className="py-2.5 px-4 text-right">Total Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(data.gst_report.hsn_summary || []).map((h: any, idx: number) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                            {h.hsn_code}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-600">{h.unit}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{h.total_qty}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{h.gst_rate}%</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatINR(h.taxable_value)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatINR(h.cgst_amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatINR(h.sgst_amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatINR(h.igst_amount)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold tabular-nums">
                            {formatINR(h.total_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 4: INVENTORY MOVEMENT AUDIT TRAIL */}
          {tab === 'MOVEMENTS' && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5">
                <h4 className="text-sm font-bold text-slate-900">
                  Chronological Inventory Movement &amp; FIFO Audit Ledger
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4 text-left">Movement Type</th>
                      <th className="py-2.5 px-3 text-left">Product</th>
                      <th className="py-2.5 px-3 text-left">Batch #</th>
                      <th className="py-2.5 px-3 text-left">Voucher Ref</th>
                      <th className="py-2.5 px-3 text-right">Qty Delta</th>
                      <th className="py-2.5 px-3 text-right">Stock After</th>
                      <th className="py-2.5 px-4 text-left">Narration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.stock_movements || []).map((m: any) => {
                      const isIn = Number(m.quantity_change) > 0;
                      return (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                isIn
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-800'
                              }`}
                            >
                              {m.movement_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {m.product_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">
                            #{m.batch_number}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-teal-800">
                            {m.reference_no || '—'}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-bold tabular-nums ${
                              isIn ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {isIn ? `+${m.quantity_change}` : m.quantity_change} {m.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                            {m.balance_after} {m.unit}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500">{m.notes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: FIFO STOCK VALUATION & BATCH EXPIRY RISK */}
          {tab === 'VALUATION' && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-3.5">
                <h4 className="text-sm font-bold text-slate-900">
                  Batch-by-Batch FIFO Valuation &amp; Shelf-Life Risk Matrix
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4 text-left">Batch #</th>
                      <th className="py-2.5 px-3 text-left">Product</th>
                      <th className="py-2.5 px-3 text-left">Received (FIFO)</th>
                      <th className="py-2.5 px-3 text-left">Shelf-Life Status</th>
                      <th className="py-2.5 px-3 text-right">Rem. Qty</th>
                      <th className="py-2.5 px-3 text-right">FIFO Cost Value</th>
                      <th className="py-2.5 px-4 text-right">Retail Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.active_batches || []).map((b: any) => {
                      const meta = getExpiryMeta(b.expiry_date, data.range.today);
                      return (
                        <tr key={b.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                            {b.batch_number}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {b.product_name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {formatDate(b.received_date)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {b.remaining_qty} {b.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-900 tabular-nums">
                            {formatINR(b.remaining_qty * b.cost_price)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold text-teal-800 tabular-nums">
                            {formatINR(b.remaining_qty * b.selling_price)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
