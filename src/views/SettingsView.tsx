import React, { useEffect, useState } from 'react';
import { Building2, CheckCircle2, QrCode, Save, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { buildUpiUri } from '../lib/format';
import { IndianState, Organization } from '../types';
import { QrCodeImage } from '../components/QrCodeImage';

interface SettingsViewProps {
  organization: Organization;
  states: IndianState[];
  onOrganizationUpdated: (org: Organization) => void;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  organization,
  states,
  onOrganizationUpdated,
  notify,
}) => {
  const [form, setForm] = useState({ ...organization });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...organization });
  }, [organization]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ organization: Organization }>('/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      onOrganizationUpdated(res.organization);
      notify('Store settings, GST mode & UPI QR configuration saved!');
    } catch (err: any) {
      notify(err.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sampleQrUri = buildUpiUri({
    upiId: form.upi_id || 'merchant@upi',
    payeeName: form.upi_payee_name || form.business_name,
    amount: 250,
    note: `Test QR - ${form.business_name}`,
  });

  return (
    <form onSubmit={handleSave} className="max-w-5xl space-y-6">
      {/* Master GST Mode Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-700">
              <ShieldCheck className="h-4 w-4" />
              Tax & Compliance Mode
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              GST Billing Mode (Toggle ON for GSTIN Users, OFF for Non-GST Users)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
              When enabled, bills include GSTIN, HSN codes, CGST+SGST (intra-state) or IGST (inter-state), and GSTR-1 summaries. When disabled, KoshBill issues clean Non-GST Bills of Supply without tax clutter.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setForm({ ...form, gst_enabled: form.gst_enabled ? 0 : 1 })}
            className={`inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
              form.gst_enabled
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-300 bg-slate-100 text-slate-700'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                form.gst_enabled ? 'bg-emerald-300' : 'bg-slate-400'
              }`}
            />
            {form.gst_enabled ? 'GST Mode: ENABLED' : 'GST Mode: SKIPPED (Non-GST)'}
          </button>
        </div>

        {Boolean(form.gst_enabled) && (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                15-Digit GSTIN
              </label>
              <input
                type="text"
                maxLength={15}
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                placeholder="09AABCS1429B1Z5"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">PAN Number</label>
              <input
                type="text"
                maxLength={10}
                value={form.pan || ''}
                onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                placeholder="AABCS1429B"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Default Item Pricing
              </label>
              <select
                value={form.default_tax_inclusive}
                onChange={(e) =>
                  setForm({ ...form, default_tax_inclusive: Number(e.target.value) })
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value={0}>Tax Exclusive (+ GST added on rate)</option>
                <option value={1}>Tax Inclusive (GST included in rate)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Hand-to-Hand UPI QR Configuration + Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs">
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-teal-700" />
            <h3 className="text-base font-bold text-slate-900">
              Hand-to-Hand UPI QR Payment Configuration
            </h3>
          </div>
          <p className="text-xs text-slate-500">
            Every bill automatically embeds your Merchant UPI ID and the exact payable Rupee amount into a standard NPCI <code className="font-mono text-teal-800">upi://pay</code> QR code.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Merchant UPI VPA ID *
              </label>
              <input
                type="text"
                required
                value={form.upi_id}
                onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
                placeholder="yourstore@okicici"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                UPI Payee Display Name
              </label>
              <input
                type="text"
                value={form.upi_payee_name || ''}
                onChange={(e) => setForm({ ...form, upi_payee_name: e.target.value })}
                placeholder={form.business_name}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bank Name</label>
              <input
                type="text"
                value={form.bank_name || ''}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Account No.</label>
              <input
                type="text"
                value={form.bank_account_no || ''}
                onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">IFSC Code</label>
              <input
                type="text"
                value={form.bank_ifsc || ''}
                onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 mb-2">
            Live Test QR Preview (₹250.00 Sample)
          </span>
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs">
            <QrCodeImage value={sampleQrUri} size={145} />
          </div>
          <div className="mt-2 font-mono text-[11px] font-semibold text-slate-700">
            {form.upi_id}
          </div>
        </div>
      </div>

      {/* Store Identity & Invoice Numbering */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-2xs space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-700" />
          <h3 className="text-base font-bold text-slate-900">
            Business Identity & Printable Invoice Footer
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Store / Trade Name *
            </label>
            <input
              type="text"
              required
              value={form.business_name}
              onChange={(e) => setForm({ ...form, business_name: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tagline / Subtitle
            </label>
            <input
              type="text"
              value={form.tagline || ''}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">State</label>
            <select
              value={form.state_code}
              onChange={(e) => {
                const st = states.find((s) => s.code === e.target.value);
                setForm({
                  ...form,
                  state_code: e.target.value,
                  state_name: st?.name || form.state_name,
                });
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {states.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.code} - {st.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
            <input
              type="text"
              value={form.city || ''}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
            <input
              type="text"
              value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Full Address</label>
          <input
            type="text"
            value={form.address || ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              GST Invoice Prefix
            </label>
            <input
              type="text"
              value={form.invoice_prefix}
              onChange={(e) =>
                setForm({ ...form, invoice_prefix: e.target.value.toUpperCase() })
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Non-GST Bill Prefix
            </label>
            <input
              type="text"
              value={form.non_gst_prefix}
              onChange={(e) =>
                setForm({ ...form, non_gst_prefix: e.target.value.toUpperCase() })
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Purchase Bill Prefix
            </label>
            <input
              type="text"
              value={form.purchase_prefix}
              onChange={(e) =>
                setForm({ ...form, purchase_prefix: e.target.value.toUpperCase() })
              }
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-mono uppercase"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Printed Invoice Terms & Conditions
          </label>
          <textarea
            rows={3}
            value={form.terms_and_conditions || ''}
            onChange={(e) => setForm({ ...form, terms_and_conditions: e.target.value })}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-800 disabled:opacity-60 transition"
          >
            {saving ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving...' : 'Save All Business Settings'}
          </button>
        </div>
      </div>
    </form>
  );
};
