import React from 'react';
import { Printer, X, CheckCircle2, AlertCircle, Truck } from 'lucide-react';
import { Organization, Purchase } from '../types';
import { amountInWordsINR, formatDate, formatINR } from '../lib/format';

interface PurchasePrintModalProps {
  purchase: Purchase | null;
  organization: Organization;
  onClose: () => void;
}

export const PurchasePrintModal: React.FC<PurchasePrintModalProps> = ({
  purchase,
  organization,
  onClose,
}) => {
  if (!purchase) return null;

  const isGst = Boolean(purchase.is_gst);
  const isIntra = purchase.supply_type === 'INTRA';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-xs">
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-slate-100 shadow-2xl border border-slate-300">
        {/* Toolbar */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Truck className="h-4 w-4 text-teal-700" />
            <span className="font-mono text-sm font-bold text-slate-900">
              {purchase.purchase_number}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                purchase.payment_status === 'PAID'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {purchase.payment_status === 'PAID' ? (
                <>
                  <CheckCircle2 className="h-3 w-3" /> PAID ({purchase.payment_mode})
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3" /> {purchase.payment_status} • Payable{' '}
                  {formatINR(purchase.balance_due)}
                </>
              )}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 transition"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Purchase Voucher
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

        {/* Printable Document */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex justify-center">
          <div
            id="printable-area"
            className="w-full max-w-[820px] rounded-lg border border-slate-300 bg-white p-6 sm:p-8 text-slate-900 shadow-sm text-xs"
          >
            <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <div className="inline-block rounded bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white mb-1.5">
                  {isGst ? 'GST PURCHASE VOUCHER (STOCK-IN)' : 'PURCHASE STOCK-IN VOUCHER'}
                </div>
                <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
                  {organization.business_name}
                </h1>
                <p className="text-[11px] text-slate-700 mt-1">
                  {organization.address}
                  {organization.city ? `, ${organization.city}` : ''} • {organization.state_name} (
                  {organization.state_code})
                </p>
                {isGst && organization.gstin && (
                  <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                    Buyer GSTIN: {organization.gstin}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-right">
                <div className="text-[10px] uppercase text-slate-500">Purchase Voucher No.</div>
                <div className="font-mono text-sm font-bold text-slate-900">
                  {purchase.purchase_number}
                </div>
                {purchase.supplier_invoice_no && (
                  <div className="font-mono text-[11px] text-slate-700">
                    Supplier Bill: {purchase.supplier_invoice_no}
                  </div>
                )}
                <div className="text-[11px] text-slate-600 mt-0.5">
                  Date: <strong>{formatDate(purchase.purchase_date)}</strong>
                </div>
              </div>
            </div>

            {/* Supplier Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-b border-slate-300 py-3.5">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Purchased From (Supplier / Distributor)
                </div>
                <div className="mt-1 text-sm font-bold text-slate-900">
                  {purchase.supplier_name}
                </div>
                {purchase.supplier_address && (
                  <div className="text-[11px] text-slate-700 mt-0.5">
                    {purchase.supplier_address}
                  </div>
                )}
                <div className="text-[11px] text-slate-700 mt-0.5">
                  State: {purchase.supplier_state}
                  {purchase.supplier_phone ? ` • Ph: ${purchase.supplier_phone}` : ''}
                </div>
                {purchase.supplier_gstin && (
                  <div className="font-mono text-[11px] font-semibold text-slate-800 mt-0.5">
                    Supplier GSTIN: {purchase.supplier_gstin}
                  </div>
                )}
              </div>

              <div className="sm:text-right space-y-1">
                <div>
                  <span className="text-slate-500">Tax Regime: </span>
                  <span className="font-semibold text-slate-900">
                    {!isGst
                      ? 'Non-GST Purchase'
                      : isIntra
                        ? 'Intra-State ITC (CGST + SGST)'
                        : 'Inter-State ITC (IGST)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Settlement Status: </span>
                  <span className="font-bold text-slate-900">
                    {purchase.payment_status} ({purchase.payment_mode})
                  </span>
                </div>
                {purchase.payment_ref && (
                  <div className="font-mono text-[11px] text-slate-700">
                    Ref: {purchase.payment_ref}
                  </div>
                )}
              </div>
            </div>

            {/* Items Table */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-y border-slate-800 bg-slate-100 text-left font-bold text-slate-900">
                    <th className="py-2 px-1.5 w-7">#</th>
                    <th className="py-2 px-2">Product & FIFO Batch Created</th>
                    <th className="py-2 px-1.5 text-right">Qty (+Free)</th>
                    <th className="py-2 px-1.5 text-right">Cost Rate</th>
                    <th className="py-2 px-1.5 text-right">MRP / Sell</th>
                    {isGst && <th className="py-2 px-1.5 text-right">Taxable</th>}
                    {isGst && <th className="py-2 px-1.5 text-right">ITC GST</th>}
                    <th className="py-2 px-1.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(purchase.items || []).map((it, idx) => {
                    const tax =
                      Number(it.cgst_amount || 0) +
                      Number(it.sgst_amount || 0) +
                      Number(it.igst_amount || 0);
                    return (
                      <tr key={it.id || idx} className="align-top">
                        <td className="py-2 px-1.5 text-slate-500 tabular-nums">{idx + 1}</td>
                        <td className="py-2 px-2">
                          <div className="font-semibold text-slate-900">{it.product_name}</div>
                          <div className="font-mono text-[10px] text-slate-600 mt-0.5">
                            Batch #{it.batch_number}
                            {it.expiry_date ? ` • Exp: ${formatDate(it.expiry_date)}` : ''}
                          </div>
                        </td>
                        <td className="py-2 px-1.5 text-right font-semibold tabular-nums">
                          {it.quantity}
                          {Number(it.free_qty || 0) > 0 ? ` (+${it.free_qty})` : ''} {it.unit}
                        </td>
                        <td className="py-2 px-1.5 text-right tabular-nums">
                          {formatINR(it.cost_price, false)}
                        </td>
                        <td className="py-2 px-1.5 text-right text-slate-600 tabular-nums">
                          {formatINR(it.mrp, false)} / {formatINR(it.selling_price, false)}
                        </td>
                        {isGst && (
                          <td className="py-2 px-1.5 text-right tabular-nums">
                            {formatINR(it.taxable_amount, false)}
                          </td>
                        )}
                        {isGst && (
                          <td className="py-2 px-1.5 text-right tabular-nums">
                            {formatINR(tax, false)} ({it.gst_rate}%)
                          </td>
                        )}
                        <td className="py-2 px-1.5 text-right font-bold text-slate-900 tabular-nums">
                          {formatINR(it.line_total, false)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-4 border-t-2 border-slate-800 pt-4">
              <div className="sm:col-span-7">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Purchase Amount (In Words)
                </div>
                <div className="mt-0.5 text-xs font-bold italic text-slate-900">
                  {amountInWordsINR(purchase.grand_total)}
                </div>
                {purchase.notes && (
                  <div className="mt-2 text-[11px] text-slate-600">Notes: {purchase.notes}</div>
                )}
              </div>

              <div className="sm:col-span-5">
                <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-1.5 tabular-nums">
                  <div className="flex justify-between text-slate-700">
                    <span>Taxable Purchase Value</span>
                    <span>{formatINR(purchase.taxable_amount)}</span>
                  </div>
                  {isGst && (
                    <div className="flex justify-between text-slate-600">
                      <span>Total Input GST (ITC)</span>
                      <span>{formatINR(purchase.total_tax)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t-2 border-slate-800 pt-2 text-sm font-extrabold text-slate-900">
                    <span>Grand Total</span>
                    <span>{formatINR(purchase.grand_total)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-700 pt-1">
                    <span>Amount Paid</span>
                    <span className="font-semibold text-emerald-700">
                      {formatINR(purchase.amount_paid)}
                    </span>
                  </div>
                  {purchase.balance_due > 0 && (
                    <div className="flex justify-between text-xs font-bold text-rose-700 border-t border-slate-200 pt-1">
                      <span>Supplier Balance Payable</span>
                      <span>{formatINR(purchase.balance_due)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
