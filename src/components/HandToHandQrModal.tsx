import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Banknote,
  Maximize2,
  Minimize2,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  X,
  Loader2,
  BookOpen,
} from 'lucide-react';
import { QrCodeImage } from './QrCodeImage';
import { buildUpiUri, formatINR } from '../lib/format';

export type PaymentMethodChoice = 'UPI_QR' | 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT';

export interface HandToHandQrConfirmPayload {
  payment_mode: PaymentMethodChoice;
  amount_paid: number;
  payment_ref: string;
  qr_confirmed: boolean;
}

interface HandToHandQrModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  upiId: string;
  payeeName: string;
  totalAmount: number;
  defaultNote: string;
  allowModeSwitch?: boolean;
  allowCreditLedger?: boolean;
  customerName?: string;
  itemCount?: number;
  isGstBill?: boolean;
  direction?: 'COLLECT' | 'PAY_SUPPLIER';
  submitting?: boolean;
  onConfirm: (payload: HandToHandQrConfirmPayload) => Promise<void> | void;
}

export const HandToHandQrModal: React.FC<HandToHandQrModalProps> = ({
  open,
  onClose,
  title = 'Hand-to-Hand QR Checkout',
  subtitle = 'Show or hand this QR to the consumer — exact bill amount is locked inside the UPI payload.',
  upiId,
  payeeName,
  totalAmount,
  defaultNote,
  allowModeSwitch = true,
  allowCreditLedger = false,
  customerName = 'Walk-in Consumer',
  itemCount,
  isGstBill = true,
  direction = 'COLLECT',
  submitting = false,
  onConfirm,
}) => {
  const [mode, setMode] = useState<PaymentMethodChoice>('UPI_QR');
  const [customPayAmount, setCustomPayAmount] = useState<string>(totalAmount.toFixed(2));
  const [cashTendered, setCashTendered] = useState<string>(Math.ceil(totalAmount).toString());
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [counterFlip, setCounterFlip] = useState<boolean>(false);
  const [simStage, setSimStage] = useState<'IDLE' | 'SCANNING' | 'VERIFIED'>('IDLE');
  const [copiedUri, setCopiedUri] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('UPI_QR');
      setCustomPayAmount(totalAmount.toFixed(2));
      setCashTendered(Math.ceil(totalAmount).toString());
      setPaymentRef('');
      setSimStage('IDLE');
      setCounterFlip(false);
    }
  }, [open, totalAmount]);

  const effectiveAmountToCollect = useMemo(() => {
    if (mode === 'CREDIT') {
      const parsed = parseFloat(customPayAmount);
      if (Number.isNaN(parsed) || parsed < 0) return 0;
      return Math.min(totalAmount, parsed);
    }
    const parsed = parseFloat(customPayAmount);
    if (Number.isNaN(parsed) || parsed <= 0) return totalAmount;
    return Math.min(totalAmount, parsed);
  }, [mode, customPayAmount, totalAmount]);

  const qrAmount = mode === 'CREDIT' && effectiveAmountToCollect > 0 ? effectiveAmountToCollect : totalAmount;

  const upiUri = useMemo(
    () =>
      buildUpiUri({
        upiId: upiId || 'merchant@upi',
        payeeName: payeeName || 'KoshBill Store',
        amount: qrAmount,
        note: defaultNote,
      }),
    [upiId, payeeName, qrAmount, defaultNote]
  );

  if (!open) return null;

  const handleSimulateScanAndConfirm = async () => {
    setSimStage('SCANNING');
    await new Promise((r) => setTimeout(r, 900));
    const generatedUtr = `UPI${Date.now().toString().slice(-10)}84`;
    setPaymentRef(generatedUtr);
    setSimStage('VERIFIED');
    await new Promise((r) => setTimeout(r, 550));
    await onConfirm({
      payment_mode: 'UPI_QR',
      amount_paid: qrAmount,
      payment_ref: generatedUtr,
      qr_confirmed: true,
    });
  };

  const handleDirectConfirm = async () => {
    const finalRef =
      paymentRef.trim() ||
      (mode === 'UPI_QR' ? `UPI${Date.now().toString().slice(-10)}` : '');
    await onConfirm({
      payment_mode: mode,
      amount_paid: mode === 'CREDIT' ? effectiveAmountToCollect : effectiveAmountToCollect,
      payment_ref: finalRef,
      qr_confirmed: mode === 'UPI_QR',
    });
  };

  const cashChange = Math.max(0, (parseFloat(cashTendered) || 0) - effectiveAmountToCollect);
  const balanceToLedger = Math.max(0, Math.round((totalAmount - effectiveAmountToCollect) * 100) / 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-4 backdrop-blur-xs">
      <div
        className={`relative w-full overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200 transition-all ${
          counterFlip ? 'max-w-md' : 'max-w-3xl'
        }`}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 border border-teal-400/30">
              <QrCode className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
              <p className="text-[11px] text-slate-300">
                {direction === 'PAY_SUPPLIER'
                  ? `Pay Supplier: ${payeeName}`
                  : `${customerName}${itemCount ? ` • ${itemCount} item(s)` : ''} • ${
                      isGstBill ? 'GST Tax Invoice' : 'Non-GST Bill of Supply'
                    }`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'UPI_QR' && (
              <button
                type="button"
                onClick={() => setCounterFlip((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
                title="Customer Counter Display View"
              >
                {counterFlip ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {counterFlip ? 'Cashier View' : 'Counter Flip View'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={submitting || simStage === 'SCANNING'}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Counter Flip Full Customer-Facing Card */}
        {counterFlip && mode === 'UPI_QR' ? (
          <div className="p-6 text-center bg-gradient-to-b from-slate-50 to-white">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-200 px-3 py-1 text-xs font-semibold text-teal-800 mb-3">
              <ShieldCheck className="h-3.5 w-3.5 text-teal-600" />
              Verified Dynamic UPI Bill QR
            </div>
            <div className="text-sm font-medium text-slate-500">{payeeName}</div>
            <div className="mt-1 text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
              {formatINR(qrAmount)}
            </div>
            <div className="mt-0.5 text-xs text-slate-500 font-mono">{upiId}</div>

            <div className="my-5 inline-block rounded-2xl border-2 border-teal-600 bg-white p-3.5 shadow-md">
              <QrCodeImage value={upiUri} size={250} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium text-slate-600 mb-5">
              <span className="rounded-md bg-slate-100 px-2 py-1">GPay</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">PhonePe</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">Paytm</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">BHIM</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">Any UPI App</span>
            </div>

            <button
              type="button"
              disabled={submitting || simStage !== 'IDLE'}
              onClick={handleDirectConfirm}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Payment Received — Issue & Print Bill
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 max-h-[85vh] overflow-y-auto">
            {/* Left column: Dynamic UPI QR Display */}
            <div className="md:col-span-6 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/80 p-5 flex flex-col items-center justify-between">
              <div className="w-full text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <Smartphone className="h-3 w-3" />
                  Amount Embedded in QR Payload
                </span>
                <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
                  {formatINR(qrAmount)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Payee: <span className="font-semibold text-slate-700">{payeeName}</span> ({upiId})
                </p>
              </div>

              <div className="relative my-4 rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm">
                <QrCodeImage value={upiUri} size={215} />

                {simStage === 'SCANNING' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-slate-900/85 text-white p-4 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-teal-400 mb-2" />
                    <p className="text-xs font-semibold">Consumer Scanned QR...</p>
                    <p className="text-[11px] text-slate-300 mt-0.5">Awaiting UPI PIN confirmation</p>
                  </div>
                )}

                {simStage === 'VERIFIED' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-emerald-700/95 text-white p-4 text-center">
                    <CheckCircle2 className="h-10 w-10 text-white mb-1.5" />
                    <p className="text-sm font-bold">Payment Confirmed!</p>
                    <p className="text-[11px] font-mono text-emerald-100 mt-0.5">{paymentRef}</p>
                  </div>
                )}
              </div>

              <div className="w-full space-y-2">
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Scan with GPay, PhonePe, Paytm, BHIM — amount auto-fills
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-2 text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      NPCI UPI URI Payload
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(upiUri);
                        setCopiedUri(true);
                        setTimeout(() => setCopiedUri(false), 1500);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-800"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedUri ? 'Copied!' : 'Copy URI'}
                    </button>
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-600" title={upiUri}>
                    {upiUri}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Payment Mode, UTR & Confirm Issue Bill */}
            <div className="md:col-span-6 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-slate-600 leading-relaxed">{subtitle}</p>
                </div>

                {allowModeSwitch && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Payment Mode
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMode('UPI_QR');
                          setCustomPayAmount(totalAmount.toFixed(2));
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          mode === 'UPI_QR'
                            ? 'border-teal-600 bg-teal-50 text-teal-900 ring-1 ring-teal-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <QrCode className="h-4 w-4 text-teal-600" />
                        UPI QR Scan
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMode('CASH');
                          setCustomPayAmount(totalAmount.toFixed(2));
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          mode === 'CASH'
                            ? 'border-teal-600 bg-teal-50 text-teal-900 ring-1 ring-teal-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Banknote className="h-4 w-4 text-emerald-600" />
                        Cash Counter
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setMode('CARD');
                          setCustomPayAmount(totalAmount.toFixed(2));
                        }}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          mode === 'CARD'
                            ? 'border-teal-600 bg-teal-50 text-teal-900 ring-1 ring-teal-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <CreditCard className="h-4 w-4 text-indigo-600" />
                        Card / NEFT
                      </button>

                      {allowCreditLedger && (
                        <button
                          type="button"
                          onClick={() => {
                            setMode('CREDIT');
                            setCustomPayAmount('0');
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                            mode === 'CREDIT'
                              ? 'border-amber-600 bg-amber-50 text-amber-900 ring-1 ring-amber-600'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <BookOpen className="h-4 w-4 text-amber-600" />
                          Khata / Credit
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Mode-specific controls */}
                {mode === 'CASH' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Cash Tendered (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={cashTendered}
                          onChange={(e) => setCashTendered(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Change to Return
                        </label>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-sm font-bold text-emerald-800 tabular-nums">
                          {formatINR(cashChange)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'CREDIT' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                      <UserCheck className="h-3.5 w-3.5" />
                      Posting to {customerName}&apos;s Khata Ledger
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Paid Now (Optional ₹)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={totalAmount}
                          step="0.01"
                          value={customPayAmount}
                          onChange={(e) => setCustomPayAmount(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold tabular-nums focus:border-teal-600 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Added to Khata Due
                        </label>
                        <div className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm font-bold text-amber-800 tabular-nums">
                          {formatINR(balanceToLedger)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    {mode === 'UPI_QR'
                      ? 'UPI UTR / Transaction Ref (Optional — auto-filled on instant scan)'
                      : 'Payment Reference / Note (Optional)'}
                  </label>
                  <input
                    type="text"
                    placeholder={mode === 'UPI_QR' ? 'e.g. UPI632699412081' : 'Receipt / Card slip ref'}
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-teal-600 focus:outline-none"
                  />
                </div>

                {/* Bill Total Breakdown Pill */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    {direction === 'PAY_SUPPLIER' ? 'Payout Amount' : 'Total Bill Amount'}
                  </span>
                  <span className="text-base font-bold text-slate-900 tabular-nums">
                    {formatINR(totalAmount)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                {mode === 'UPI_QR' && direction === 'COLLECT' && (
                  <button
                    type="button"
                    disabled={submitting || simStage !== 'IDLE'}
                    onClick={handleSimulateScanAndConfirm}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50 transition"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                    Simulate Consumer QR Scan & Auto-Confirm Bill
                  </button>
                )}

                <button
                  type="button"
                  disabled={submitting || simStage === 'SCANNING'}
                  onClick={handleDirectConfirm}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-xs hover:bg-teal-800 disabled:opacity-60 transition"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {direction === 'PAY_SUPPLIER'
                    ? `Confirm ${formatINR(qrAmount)} Paid to Supplier`
                    : mode === 'CREDIT'
                      ? `Confirm & Issue Credit Bill (${formatINR(balanceToLedger)} Due)`
                      : `Payment Received (${formatINR(effectiveAmountToCollect)}) — Issue Bill`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
