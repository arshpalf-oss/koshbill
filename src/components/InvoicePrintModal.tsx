import React, { useEffect, useMemo, useState } from 'react';
import {
  Printer,
  Receipt,
  FileText,
  X,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { Invoice, Organization } from '../types';
import { amountInWordsINR, buildUpiUri, formatBV, formatDate, formatINR } from '../lib/format';
import { QrCodeImage } from './QrCodeImage';

interface InvoicePrintModalProps {
  invoice: Invoice | null;
  organization: Organization;
  initialFormat?: 'A4' | 'THERMAL' | 'OWNER_BV';
  onClose: () => void;
  onSettleClick?: (invoice: Invoice) => void;
  onInvoiceUpdated?: (invoice: Invoice) => void;
}

export const InvoicePrintModal: React.FC<InvoicePrintModalProps> = ({
  invoice,
  organization,
  initialFormat = 'A4',
  onClose,
  onSettleClick,
  onInvoiceUpdated,
}) => {
  const [format, setFormat] = useState<'A4' | 'THERMAL' | 'OWNER_BV'>(initialFormat);
  const [showBvOnCustomerBill, setShowBvOnCustomerBill] = useState<boolean>(
    Boolean(invoice?.show_bv_on_bill)
  );
  const [savingBvToggle, setSavingBvToggle] = useState(false);

  useEffect(() => {
    setFormat(initialFormat || 'A4');
  }, [invoice?.id, initialFormat]);

  useEffect(() => {
    setShowBvOnCustomerBill(Boolean(invoice?.show_bv_on_bill));
  }, [invoice?.id, invoice?.show_bv_on_bill]);

  const hsnSummary = useMemo(() => {
    if (!invoice || !invoice.is_gst) return [];
    const map = new Map<
      string,
      {
        hsn: string;
        gst_rate: number;
        taxable: number;
        cgst: number;
        sgst: number;
        igst: number;
        total_tax: number;
      }
    >();

    for (const item of invoice.items || []) {
      const key = `${item.hsn_code || 'NA'}_${item.gst_rate}`;
      const prev = map.get(key) || {
        hsn: item.hsn_code || '—',
        gst_rate: item.gst_rate,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total_tax: 0,
      };
      prev.taxable += Number(item.taxable_amount);
      prev.cgst += Number(item.cgst_amount);
      prev.sgst += Number(item.sgst_amount);
      prev.igst += Number(item.igst_amount);
      prev.total_tax +=
        Number(item.cgst_amount) + Number(item.sgst_amount) + Number(item.igst_amount);
      map.set(key, prev);
    }
    return Array.from(map.values());
  }, [invoice]);

  if (!invoice) return null;

  const isGst = Boolean(invoice.is_gst);
  const isIntra = invoice.supply_type === 'INTRA';
  const qrAmount = invoice.balance_due > 0 ? invoice.balance_due : invoice.grand_total;
  const upiUri =
    invoice.upi_uri ||
    buildUpiUri({
      upiId: organization.upi_id,
      payeeName: organization.upi_payee_name || organization.business_name,
      amount: qrAmount,
      note: `${invoice.invoice_number} - ${organization.business_name}`,
      ref: invoice.invoice_number,
    });

  const mrpTotal = (invoice.items || []).reduce(
    (sum, i) => sum + Number(i.mrp || i.unit_price) * Number(i.quantity),
    0
  );
  const mrpSavings = Math.max(0, mrpTotal - Number(invoice.grand_total));

  const totalBv = Number(invoice.total_bv || 0);
  const items = invoice.items || [];
  const bvIncludedCount = items.filter(
    (i) => Boolean(i.bv_included ?? 1) && Number(i.line_bv_total || 0) > 0
  ).length;
  const bvRemovedCount = items.filter(
    (i) => !Boolean(i.bv_included ?? 1) && Number(i.bv_per_unit || 0) > 0
  ).length;
  const netSalesExTax = Number(invoice.taxable_amount || 0) - Number(invoice.bill_discount || 0);
  const grossMargin = netSalesExTax - Number(invoice.total_fifo_cost || 0);

  const handleToggleCustomerBvVisibility = async () => {
    const nextVal = !showBvOnCustomerBill;
    setShowBvOnCustomerBill(nextVal);
    setSavingBvToggle(true);
    try {
      const res = await apiFetch<{ invoice: Invoice }>(`/invoices/${invoice.id}/bv-visibility`, {
        method: 'PATCH',
        body: JSON.stringify({ show_bv_on_bill: nextVal }),
      });
      onInvoiceUpdated?.(res.invoice);
    } catch {
      setShowBvOnCustomerBill(!nextVal);
    } finally {
      setSavingBvToggle(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-xs">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl border border-slate-300">
        {/* Modal Toolbar (Hidden in print) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm font-bold text-slate-900">
              {invoice.invoice_number}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                invoice.status === 'CANCELLED'
                  ? 'bg-slate-100 text-slate-600 border-slate-300'
                  : invoice.payment_status === 'PAID'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {invoice.status === 'CANCELLED' ? (
                'CANCELLED'
              ) : invoice.payment_status === 'PAID' ? (
                <>
                  <CheckCircle2 className="h-3 w-3" /> PAID ({invoice.payment_mode})
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3" /> {invoice.payment_status} • Due{' '}
                  {formatINR(invoice.balance_due)}
                </>
              )}
            </span>

            {totalBv > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-xs font-bold text-violet-800">
                <Sparkles className="h-3 w-3 text-violet-600" />
                {formatBV(totalBv)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Switch Customer A4 vs Thermal vs Owner's Internal BV Record Copy */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setFormat('A4')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  format === 'A4'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Customer A4
              </button>
              <button
                type="button"
                onClick={() => setFormat('THERMAL')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  format === 'THERMAL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="h-3.5 w-3.5" />
                80mm Slip
              </button>
              <button
                type="button"
                onClick={() => setFormat('OWNER_BV')}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  format === 'OWNER_BV'
                    ? 'bg-violet-700 text-white shadow-xs'
                    : 'text-violet-800 hover:bg-violet-50'
                }`}
                title="Separate BV Record Bill for Store Owner Only"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Owner's BV Copy
              </button>
            </div>

            {/* Option to Allow or Hide BV on Customer Bill */}
            {format !== 'OWNER_BV' && (
              <button
                type="button"
                disabled={savingBvToggle}
                onClick={handleToggleCustomerBvVisibility}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  showBvOnCustomerBill
                    ? 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
                title="Control whether BV appears on the customer's printed bill"
              >
                {showBvOnCustomerBill ? (
                  <>
                    <Eye className="h-3.5 w-3.5 text-violet-700" />
                    BV Shown on Bill
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                    BV Hidden on Bill
                  </>
                )}
              </button>
            )}

            {invoice.status === 'ISSUED' && invoice.balance_due > 0 && onSettleClick && (
              <button
                type="button"
                onClick={() => onSettleClick(invoice)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition"
              >
                Collect Due via QR ({formatINR(invoice.balance_due)})
              </button>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition ${
                format === 'OWNER_BV'
                  ? 'bg-violet-700 hover:bg-violet-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              <Printer className="h-3.5 w-3.5" />
              {format === 'OWNER_BV' ? 'Print Owner BV Copy' : 'Print / Save PDF'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex justify-center">
          {format === 'A4' ? (
            <div
              id="printable-area"
              className="w-full max-w-[820px] rounded-lg border border-slate-300 bg-white p-6 sm:p-8 text-slate-900 shadow-sm text-xs"
            >
              {/* Top Document Title Banner */}
              <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
                <div>
                  <div className="inline-block rounded bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white mb-1.5">
                    {isGst ? 'GST TAX INVOICE' : 'RETAIL INVOICE / BILL OF SUPPLY'}
                  </div>
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
                    {organization.business_name}
                  </h1>
                  {organization.tagline && (
                    <p className="text-[11px] text-slate-600 mt-0.5">{organization.tagline}</p>
                  )}
                  <p className="text-[11px] text-slate-700 mt-1">
                    {organization.address}
                    {organization.city ? `, ${organization.city}` : ''}
                    {organization.pincode ? ` - ${organization.pincode}` : ''}
                  </p>
                  <p className="text-[11px] text-slate-700">
                    State:{' '}
                    <span className="font-semibold">
                      {organization.state_name} ({organization.state_code})
                    </span>
                    {organization.phone ? ` • Ph: ${organization.phone}` : ''}
                    {organization.email ? ` • ${organization.email}` : ''}
                  </p>
                  {isGst && organization.gstin && (
                    <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                      GSTIN: {organization.gstin}
                      {organization.pan ? ` • PAN: ${organization.pan}` : ''}
                    </p>
                  )}
                </div>

                <div className="text-right space-y-1">
                  <div className="text-[10px] uppercase font-semibold text-slate-500">
                    Original for Recipient
                  </div>
                  <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-right">
                    <div className="text-[10px] text-slate-500 uppercase">Invoice No.</div>
                    <div className="font-mono text-sm font-bold text-slate-900">
                      {invoice.invoice_number}
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      Date:{' '}
                      <span className="font-semibold">{formatDate(invoice.invoice_date)}</span>
                    </div>
                    {invoice.due_date && (
                      <div className="text-[10px] text-slate-500">
                        Due: {formatDate(invoice.due_date)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Buyer & Supply Details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-slate-300 py-3.5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Billed To (Customer / Client)
                  </div>
                  <div className="mt-1 text-sm font-bold text-slate-900">
                    {invoice.customer_name}
                  </div>
                  {invoice.customer_address && (
                    <div className="text-[11px] text-slate-700 mt-0.5">
                      {invoice.customer_address}
                    </div>
                  )}
                  {invoice.customer_phone && (
                    <div className="text-[11px] text-slate-700 mt-0.5">
                      Phone: {invoice.customer_phone}
                    </div>
                  )}
                  {isGst && (
                    <div className="mt-1 font-mono text-[11px] font-semibold text-slate-800">
                      Buyer GSTIN: {invoice.customer_gstin || 'Unregistered / Consumer (B2C)'}
                    </div>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  {isGst && (
                    <>
                      <div>
                        <span className="text-slate-500">Place of Supply: </span>
                        <span className="font-semibold text-slate-900">
                          {invoice.place_of_supply}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Tax Regime: </span>
                        <span className="font-semibold text-slate-900">
                          {invoice.supply_type === 'INTRA'
                            ? 'Intra-State (CGST + SGST)'
                            : 'Inter-State (IGST)'}
                        </span>
                      </div>
                    </>
                  )}
                  <div>
                    <span className="text-slate-500">Payment Status: </span>
                    <span className="font-bold text-slate-900">
                      {invoice.payment_status} ({invoice.payment_mode})
                    </span>
                  </div>
                  {invoice.payment_ref && (
                    <div className="font-mono text-[11px] text-slate-700">
                      UTR / Ref: {invoice.payment_ref}
                    </div>
                  )}
                </div>
              </div>

              {/* Line Items Table */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-y border-slate-800 bg-slate-100 text-left font-bold text-slate-900">
                      <th className="py-2 px-1.5 w-7">#</th>
                      <th className="py-2 px-2">Item Description & FIFO Batch</th>
                      {isGst && <th className="py-2 px-1.5">HSN</th>}
                      <th className="py-2 px-1.5 text-right">Qty</th>
                      <th className="py-2 px-1.5 text-right">MRP</th>
                      <th className="py-2 px-1.5 text-right">Rate</th>
                      <th className="py-2 px-1.5 text-right">Disc</th>
                      {isGst && <th className="py-2 px-1.5 text-right">Taxable</th>}
                      {isGst && <th className="py-2 px-1.5 text-right">GST</th>}
                      {showBvOnCustomerBill && (
                        <th className="py-2 px-1.5 text-right text-violet-900">BV</th>
                      )}
                      <th className="py-2 px-1.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {items.map((item, idx) => {
                      const itemTax =
                        Number(item.cgst_amount) +
                        Number(item.sgst_amount) +
                        Number(item.igst_amount);
                      return (
                        <tr key={item.id || idx} className="align-top">
                          <td className="py-2 px-1.5 text-slate-500 tabular-nums">{idx + 1}</td>
                          <td className="py-2 px-2">
                            <div className="font-semibold text-slate-900">{item.product_name}</div>
                            <div className="text-[10px] text-slate-600 font-mono mt-0.5">
                              Batch: {item.batch_summary || '—'}
                              {item.expiry_summary ? ` • Exp: ${item.expiry_summary}` : ''}
                            </div>
                          </td>
                          {isGst && (
                            <td className="py-2 px-1.5 font-mono text-slate-700">
                              {item.hsn_code || '—'}
                            </td>
                          )}
                          <td className="py-2 px-1.5 text-right font-semibold tabular-nums">
                            {item.quantity} {item.unit}
                          </td>
                          <td className="py-2 px-1.5 text-right text-slate-600 tabular-nums">
                            {formatINR(item.mrp, false)}
                          </td>
                          <td className="py-2 px-1.5 text-right tabular-nums">
                            {formatINR(item.unit_price, false)}
                          </td>
                          <td className="py-2 px-1.5 text-right text-slate-600 tabular-nums">
                            {item.discount_percent > 0 ? `${item.discount_percent}%` : '—'}
                          </td>
                          {isGst && (
                            <td className="py-2 px-1.5 text-right tabular-nums">
                              {formatINR(item.taxable_amount, false)}
                            </td>
                          )}
                          {isGst && (
                            <td className="py-2 px-1.5 text-right tabular-nums">
                              <div>{formatINR(itemTax, false)}</div>
                              <div className="text-[9px] text-slate-500">({item.gst_rate}%)</div>
                            </td>
                          )}
                          {showBvOnCustomerBill && (
                            <td className="py-2 px-1.5 text-right font-semibold text-violet-800 tabular-nums">
                              {Number(item.line_bv_total || 0) > 0
                                ? formatBV(item.line_bv_total, false)
                                : '—'}
                            </td>
                          )}
                          <td className="py-2 px-1.5 text-right font-bold text-slate-900 tabular-nums">
                            {formatINR(item.line_total, false)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals + HSN Tax Breakup */}
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-4 border-t-2 border-slate-800 pt-4">
                <div className="sm:col-span-7 space-y-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Amount Chargeable (In Words)
                    </div>
                    <div className="mt-0.5 text-xs font-bold italic text-slate-900">
                      {amountInWordsINR(invoice.grand_total)}
                    </div>
                  </div>

                  {/* HSN Tax Summary Table (Only when GST enabled) */}
                  {isGst && hsnSummary.length > 0 && (
                    <div className="rounded border border-slate-300 overflow-hidden">
                      <div className="bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700 border-b border-slate-300">
                        HSN / SAC Tax Breakup Summary
                      </div>
                      <table className="w-full text-[10px] tabular-nums">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-600">
                            <th className="py-1 px-1.5 text-left">HSN</th>
                            <th className="py-1 px-1.5 text-right">Taxable</th>
                            {isIntra ? (
                              <>
                                <th className="py-1 px-1.5 text-right">CGST</th>
                                <th className="py-1 px-1.5 text-right">SGST</th>
                              </>
                            ) : (
                              <th className="py-1 px-1.5 text-right">IGST</th>
                            )}
                            <th className="py-1 px-1.5 text-right">Total Tax</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {hsnSummary.map((h, i) => (
                            <tr key={i}>
                              <td className="py-1 px-1.5 font-mono">
                                {h.hsn} ({h.gst_rate}%)
                              </td>
                              <td className="py-1 px-1.5 text-right">
                                {formatINR(h.taxable, false)}
                              </td>
                              {isIntra ? (
                                <>
                                  <td className="py-1 px-1.5 text-right">
                                    {formatINR(h.cgst, false)}
                                  </td>
                                  <td className="py-1 px-1.5 text-right">
                                    {formatINR(h.sgst, false)}
                                  </td>
                                </>
                              ) : (
                                <td className="py-1 px-1.5 text-right">
                                  {formatINR(h.igst, false)}
                                </td>
                              )}
                              <td className="py-1 px-1.5 text-right font-semibold">
                                {formatINR(h.total_tax, false)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!isGst && mrpSavings > 0 && (
                    <div className="inline-block rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-900">
                      You Saved {formatINR(mrpSavings)} on MRP today!
                    </div>
                  )}

                  {/* Separate Non-Monetary BV Summary Box ONLY when explicitly allowed */}
                  {showBvOnCustomerBill && (
                    <div className="rounded-lg border border-violet-300 bg-violet-50/70 px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between font-bold text-violet-950">
                        <span>Business Value (BV) Earned on Bill</span>
                        <span className="tabular-nums">{formatBV(totalBv)}</span>
                      </div>
                      {invoice.customer_total_bv !== null &&
                        invoice.customer_total_bv !== undefined && (
                          <div className="flex items-center justify-between text-[10px] text-violet-800 mt-0.5">
                            <span>Accumulated Client BV</span>
                            <span className="font-semibold tabular-nums">
                              {formatBV(invoice.customer_total_bv)}
                            </span>
                          </div>
                        )}
                      <div className="text-[9px] text-slate-500 mt-0.5">
                        Note: BV is a non-monetary business value metric and is not included in the ₹ invoice amount.
                      </div>
                    </div>
                  )}
                </div>

                {/* Numeric Monetary Totals Box (Strictly ₹ Only) */}
                <div className="sm:col-span-5">
                  <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-1.5 tabular-nums">
                    <div className="flex justify-between text-slate-700">
                      <span>Gross Subtotal</span>
                      <span>{formatINR(invoice.subtotal)}</span>
                    </div>
                    {invoice.item_discount_total > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Item Discounts</span>
                        <span>-{formatINR(invoice.item_discount_total)}</span>
                      </div>
                    )}
                    {isGst && (
                      <>
                        <div className="flex justify-between text-slate-700 border-t border-slate-200 pt-1">
                          <span>Taxable Value</span>
                          <span>{formatINR(invoice.taxable_amount)}</span>
                        </div>
                        {isIntra ? (
                          <>
                            <div className="flex justify-between text-slate-600">
                              <span>Output CGST</span>
                              <span>{formatINR(invoice.cgst_amount)}</span>
                            </div>
                            <div className="flex justify-between text-slate-600">
                              <span>Output SGST</span>
                              <span>{formatINR(invoice.sgst_amount)}</span>
                            </div>
                          </>
                        ) : (
                          <div className="flex justify-between text-slate-600">
                            <span>Output IGST</span>
                            <span>{formatINR(invoice.igst_amount)}</span>
                          </div>
                        )}
                      </>
                    )}
                    {invoice.bill_discount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>Extra Bill Discount</span>
                        <span>-{formatINR(invoice.bill_discount)}</span>
                      </div>
                    )}

                    <div className="flex justify-between border-t-2 border-slate-800 pt-2 text-sm font-extrabold text-slate-900">
                      <span>Grand Total</span>
                      <span>{formatINR(invoice.grand_total)}</span>
                    </div>

                    <div className="flex justify-between text-[11px] text-slate-700 pt-1">
                      <span>Amount Paid</span>
                      <span className="font-semibold text-emerald-700">
                        {formatINR(invoice.amount_paid)}
                      </span>
                    </div>
                    {invoice.balance_due > 0 && (
                      <div className="flex justify-between text-xs font-bold text-rose-700 border-t border-slate-200 pt-1">
                        <span>Balance Due (Khata)</span>
                        <span>{formatINR(invoice.balance_due)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom QR + Bank + Signatory Row */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-4 border-t border-slate-300 pt-4 items-end">
                <div className="sm:col-span-5 flex items-center gap-3">
                  <div className="rounded-lg border border-slate-300 p-1.5 bg-white shrink-0">
                    <QrCodeImage value={upiUri} size={96} />
                  </div>
                  <div className="text-[10px] text-slate-700 space-y-0.5">
                    <div className="font-bold text-slate-900">
                      {invoice.balance_due > 0
                        ? `Scan UPI QR to Pay ${formatINR(invoice.balance_due)}`
                        : 'Embedded Bill UPI QR'}
                    </div>
                    <div className="font-mono text-slate-600">{organization.upi_id}</div>
                    {organization.bank_name && (
                      <div className="pt-1 text-slate-600">
                        <div>Bank: {organization.bank_name}</div>
                        <div>A/c: {organization.bank_account_no}</div>
                        <div>IFSC: {organization.bank_ifsc}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="sm:col-span-4 text-[10px] text-slate-600 whitespace-pre-line">
                  <div className="font-bold text-slate-800 mb-0.5">Terms & Conditions:</div>
                  {organization.terms_and_conditions}
                </div>

                <div className="sm:col-span-3 text-right">
                  <div className="text-[10px] font-semibold text-slate-700">
                    For {organization.business_name}
                  </div>
                  <div className="h-10" />
                  <div className="border-t border-slate-400 pt-1 text-[10px] font-bold text-slate-800">
                    Authorised Signatory
                  </div>
                </div>
              </div>
            </div>
          ) : format === 'THERMAL' ? (
            /* 80mm Thermal POS Receipt View */
            <div
              id="printable-area"
              className="w-[320px] rounded-lg border border-slate-300 bg-white p-4 font-mono text-[11px] text-slate-900 shadow-sm"
            >
              <div className="text-center border-b border-dashed border-slate-400 pb-2.5">
                <div className="text-sm font-bold uppercase">{organization.business_name}</div>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {organization.address}, {organization.city}
                </div>
                {organization.phone && (
                  <div className="text-[10px] text-slate-600">Ph: {organization.phone}</div>
                )}
                {isGst && organization.gstin && (
                  <div className="text-[10px] font-bold mt-0.5">GSTIN: {organization.gstin}</div>
                )}
                <div className="mt-1.5 inline-block border border-slate-800 px-2 py-0.5 text-[10px] font-bold">
                  {isGst ? 'TAX INVOICE' : 'RETAIL RECEIPT'}
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 py-2 text-[10px] space-y-0.5">
                <div className="flex justify-between">
                  <span>Bill: {invoice.invoice_number}</span>
                  <span>{invoice.invoice_date}</span>
                </div>
                <div>Customer: {invoice.customer_name}</div>
                <div>
                  Mode: {invoice.payment_mode} ({invoice.payment_status})
                </div>
              </div>

              <div className="border-b border-dashed border-slate-400 py-2 space-y-1.5">
                <div className="flex justify-between font-bold text-[10px] border-b border-slate-200 pb-1">
                  <span>ITEM / BATCH</span>
                  <span>QTY x RATE = AMT</span>
                </div>
                {items.map((it, idx) => (
                  <div key={idx} className="text-[10px]">
                    <div className="font-bold">{it.product_name}</div>
                    <div className="flex justify-between text-slate-600">
                      <span className="truncate max-w-[140px]">#{it.batch_summary}</span>
                      <span className="font-semibold text-slate-900">
                        {it.quantity} x {formatINR(it.unit_price, false)} ={' '}
                        {formatINR(it.line_total, false)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-b border-dashed border-slate-400 py-2 space-y-1 text-[11px]">
                {isGst && (
                  <>
                    <div className="flex justify-between text-[10px]">
                      <span>Taxable Amt:</span>
                      <span>{formatINR(invoice.taxable_amount)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Total GST:</span>
                      <span>{formatINR(invoice.total_tax)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-xs font-extrabold pt-1">
                  <span>NET PAYABLE:</span>
                  <span>{formatINR(invoice.grand_total)}</span>
                </div>
                {mrpSavings > 0 && (
                  <div className="text-center text-[10px] font-bold pt-1">
                    *** YOU SAVED {formatINR(mrpSavings)} ON MRP ***
                  </div>
                )}
              </div>

              {/* Separate BV Strip on Thermal ONLY when explicitly allowed */}
              {showBvOnCustomerBill && (
                <div className="border-b border-dashed border-slate-400 py-1.5 text-[10px] space-y-0.5">
                  <div className="flex justify-between font-bold">
                    <span>BV EARNED (NON-₹):</span>
                    <span>{formatBV(totalBv)}</span>
                  </div>
                  {invoice.customer_total_bv !== null &&
                    invoice.customer_total_bv !== undefined && (
                      <div className="flex justify-between text-slate-600">
                        <span>TOTAL CLIENT BV:</span>
                        <span>{formatBV(invoice.customer_total_bv)}</span>
                      </div>
                    )}
                </div>
              )}

              <div className="pt-3 flex flex-col items-center text-center">
                <QrCodeImage value={upiUri} size={135} />
                <div className="mt-1 text-[10px] font-bold">
                  {invoice.balance_due > 0
                    ? `SCAN TO PAY ${formatINR(invoice.balance_due)}`
                    : `PAID VIA ${invoice.payment_mode}`}
                </div>
                <div className="text-[9px] text-slate-500 mt-0.5">{organization.upi_id}</div>
                <div className="mt-2 text-[10px] font-semibold">Thank You! Visit Again</div>
              </div>
            </div>
          ) : (
            /* SEPARATE OWNER'S BV RECORD COPY (INTERNAL RECORD PURPOSES ONLY) */
            <div
              id="printable-area"
              className="w-full max-w-[820px] rounded-lg border-2 border-violet-800 bg-white p-6 sm:p-8 text-slate-900 shadow-sm text-xs"
            >
              {/* Confidential Internal Banner */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-violet-900 pb-4">
                <div>
                  <div className="inline-flex items-center gap-1.5 rounded bg-violet-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white mb-2">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    OWNER'S BV & INTERNAL BILL RECORD — CONFIDENTIAL
                  </div>
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
                    {organization.business_name}
                  </h1>
                  <p className="text-[11px] font-semibold text-violet-900 mt-0.5">
                    For Store Owner's Internal BV Accounting & Margin Record Only (Not a Customer Bill)
                  </p>
                </div>

                <div className="rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-2 text-right">
                  <div className="text-[10px] uppercase font-bold text-violet-700">
                    Linked Invoice Ref
                  </div>
                  <div className="font-mono text-sm font-extrabold text-slate-900">
                    {invoice.invoice_number}
                  </div>
                  <div className="text-[11px] text-slate-700">
                    Date: <strong>{formatDate(invoice.invoice_date)}</strong>
                  </div>
                  <div className="text-[10px] text-violet-800 font-semibold mt-0.5">
                    Customer Bill BV: {showBvOnCustomerBill ? 'Allowed / Visible' : 'Hidden'}
                  </div>
                </div>
              </div>

              {/* Client & Bill Metadata */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-slate-200 py-3.5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Client / Consumer Details
                  </div>
                  <div className="mt-1 text-sm font-bold text-slate-900">
                    {invoice.customer_name}
                  </div>
                  {invoice.customer_phone && (
                    <div className="text-[11px] text-slate-700">
                      Phone: {invoice.customer_phone}
                    </div>
                  )}
                  {invoice.customer_address && (
                    <div className="text-[11px] text-slate-600">{invoice.customer_address}</div>
                  )}
                </div>

                <div className="sm:text-right space-y-1">
                  <div>
                    <span className="text-slate-500">Payment Mode: </span>
                    <span className="font-bold text-slate-900">
                      {invoice.payment_mode} ({invoice.payment_status})
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Monetary Invoice Total: </span>
                    <span className="font-bold text-slate-900">
                      {formatINR(invoice.grand_total)}
                    </span>
                  </div>
                  {invoice.customer_total_bv !== null &&
                    invoice.customer_total_bv !== undefined && (
                      <div>
                        <span className="text-violet-700 font-semibold">
                          Client Accumulated Total BV:{' '}
                        </span>
                        <span className="font-extrabold text-violet-950">
                          {formatBV(invoice.customer_total_bv)}
                        </span>
                      </div>
                    )}
                </div>
              </div>

              {/* Item-wise BV & FIFO Cost Breakdown Table */}
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-y border-violet-900 bg-violet-50 text-left font-bold text-slate-900">
                      <th className="py-2 px-1.5 w-7">#</th>
                      <th className="py-2 px-2">Product & FIFO Batch</th>
                      <th className="py-2 px-1.5 text-right">Qty</th>
                      <th className="py-2 px-1.5 text-right">Sell Amt (₹)</th>
                      <th className="py-2 px-1.5 text-right">FIFO Cost (₹)</th>
                      <th className="py-2 px-1.5 text-center text-violet-900">BV Status</th>
                      <th className="py-2 px-1.5 text-right text-violet-900">BV / Unit</th>
                      <th className="py-2 px-1.5 text-right text-violet-950">Line BV Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {items.map((it, idx) => {
                      const included = Boolean(it.bv_included ?? 1);
                      const unitBv = Number(it.bv_per_unit || 0);
                      const lineBv = Number(it.line_bv_total || 0);
                      return (
                        <tr key={it.id || idx} className="align-top">
                          <td className="py-2 px-1.5 text-slate-500 tabular-nums">{idx + 1}</td>
                          <td className="py-2 px-2">
                            <div className="font-semibold text-slate-900">{it.product_name}</div>
                            <div className="font-mono text-[10px] text-slate-500">
                              {it.sku} • FIFO: {it.batch_summary || '—'}
                            </div>
                          </td>
                          <td className="py-2 px-1.5 text-right font-semibold tabular-nums">
                            {it.quantity} {it.unit}
                          </td>
                          <td className="py-2 px-1.5 text-right font-semibold tabular-nums">
                            {formatINR(it.line_total)}
                          </td>
                          <td className="py-2 px-1.5 text-right text-slate-600 tabular-nums">
                            {formatINR(it.fifo_cost_total)}
                          </td>
                          <td className="py-2 px-1.5 text-center">
                            {!included && unitBv > 0 ? (
                              <span className="rounded bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                                BV Removed
                              </span>
                            ) : lineBv > 0 ? (
                              <span className="rounded bg-violet-100 border border-violet-300 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
                                BV Applied
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">No BV</span>
                            )}
                          </td>
                          <td className="py-2 px-1.5 text-right font-mono tabular-nums text-violet-900">
                            {unitBv > 0 ? formatBV(unitBv, false) : '0'}
                          </td>
                          <td className="py-2 px-1.5 text-right font-extrabold tabular-nums text-violet-950">
                            {included ? (
                              formatBV(lineBv)
                            ) : (
                              <span className="text-rose-500 line-through">
                                {formatBV(unitBv * Number(it.quantity))}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Separate Dual Summary Boxes: Left = BV Calculation, Right = Internal ₹ Financials */}
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t-2 border-violet-900 pt-4">
                {/* Box 1: Strictly BV (Non-Monetary) */}
                <div className="rounded-xl border-2 border-violet-300 bg-violet-50/70 p-4 space-y-2 tabular-nums">
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-violet-900">
                    1. Business Value (BV) Summary — Non-Monetary
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Items Contributing BV</span>
                    <span className="font-semibold">{bvIncludedCount} line(s)</span>
                  </div>
                  {bvRemovedCount > 0 && (
                    <div className="flex justify-between text-rose-700">
                      <span>Items with BV Removed on Bill</span>
                      <span className="font-semibold">{bvRemovedCount} line(s)</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-violet-300 pt-2 text-sm font-extrabold text-violet-950">
                    <span>Total BV Earned on Bill</span>
                    <span>{formatBV(totalBv)}</span>
                  </div>
                  {invoice.customer_total_bv !== null &&
                    invoice.customer_total_bv !== undefined && (
                      <div className="flex justify-between text-xs font-bold text-violet-800 pt-1">
                        <span>Client Lifetime Accumulated BV</span>
                        <span>{formatBV(invoice.customer_total_bv)}</span>
                      </div>
                    )}
                </div>

                {/* Box 2: Strictly ₹ Financials & FIFO Profit */}
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-1.5 tabular-nums">
                  <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                    2. Monetary Bill & FIFO Margin (₹)
                  </div>
                  <div className="flex justify-between text-slate-700">
                    <span>Net Sales (Excl. Tax)</span>
                    <span>{formatINR(netSalesExTax)}</span>
                  </div>
                  {isGst && (
                    <div className="flex justify-between text-slate-600">
                      <span>GST Collected</span>
                      <span>{formatINR(invoice.total_tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-slate-900">
                    <span>Customer Invoice Total (₹)</span>
                    <span>{formatINR(invoice.grand_total)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-1">
                    <span>FIFO Batch Cost (COGS)</span>
                    <span>-{formatINR(invoice.total_fifo_cost)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold text-emerald-800 pt-1">
                    <span>Owner Net Margin (₹)</span>
                    <span>{formatINR(grossMargin)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-3 text-[10px] text-slate-500">
                <span>
                  Internal Record Copy • BV values are kept strictly separate from ₹ accounting & GST ledgers.
                </span>
                <span className="font-semibold text-slate-700">
                  Owner / Manager Verification Sign: ______________________
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
