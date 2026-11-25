import React, { useEffect, useState } from 'react';
import {
  Boxes,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import { IndianState, Organization, User } from '../types';

interface AuthViewProps {
  states: IndianState[];
  hasUsers?: boolean;
  storageMode?: 'mongodb' | 'local' | 'unconfigured_cloud';
  onAuthenticated: (payload: {
    user: User;
    organization: Organization;
    states?: IndianState[];
  }) => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  states,
  hasUsers = true,
  storageMode = 'local',
  onAuthenticated,
}) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>(hasUsers ? 'LOGIN' : 'REGISTER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(hasUsers ? 'LOGIN' : 'REGISTER');
  }, [hasUsers]);

  // Login state (completely clean — no demo credentials)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register state
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [gstEnabled, setGstEnabled] = useState(true);
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('09');
  const [upiId, setUpiId] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [loadStandardHsn, setLoadStandardHsn] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(res.token);
      onAuthenticated(res);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          business_name: businessName,
          owner_name: ownerName,
          email: regEmail,
          password: regPassword,
          phone,
          gst_enabled: gstEnabled,
          gstin: gstEnabled ? gstin : '',
          state_code: stateCode,
          upi_id: upiId.trim(),
          city,
          address,
          load_standard_hsn: loadStandardHsn,
        }),
      });
      setStoredToken(res.token);
      onAuthenticated(res);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const availableStates =
    states.length > 0
      ? states
      : [
          { code: '09', name: 'Uttar Pradesh' },
          { code: '07', name: 'Delhi' },
          { code: '05', name: 'Uttarakhand' },
          { code: '27', name: 'Maharashtra' },
          { code: '29', name: 'Karnataka' },
        ];

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-slate-50">
      {/* Left Brand Showcase */}
      <div className="lg:col-span-5 bg-slate-900 text-white p-8 sm:p-12 flex flex-col justify-between">
        <div>
          <div className="inline-flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500 text-slate-950 font-black text-lg shadow-sm">
              K
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight">KoshBill</span>
              <span className="ml-2 rounded-md bg-teal-500/20 border border-teal-400/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-teal-300">
                ERP & POS
              </span>
            </div>
          </div>

          <h1 className="mt-8 text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            FIFO Batch Inventory, Optional GST Billing & Hand-to-Hand QR Checkout.
          </h1>
          <p className="mt-4 text-sm text-slate-300 leading-relaxed">
            Built for pharmacies, supermarkets, kirana stores, distributors, and retail businesses — whether GST-registered or non-GST.
          </p>

          <div className="mt-8 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-slate-800 p-2 text-teal-400 border border-slate-700">
                <Boxes className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">True First-In, First-Out (FIFO) & Expiry Guard</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically sells oldest stock batches first, splits multi-batch orders, and skips expired batches.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-slate-800 p-2 text-teal-400 border border-slate-700">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">1-Click GST / Non-GST Billing + Khata Ledgers</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Use full GSTIN, HSN & CGST/SGST/IGST tax invoices — or toggle GST off for clean retail Bills of Supply.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-slate-800 p-2 text-teal-400 border border-slate-700">
                <QrCode className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Hand-to-Hand Amount-Embedded UPI QR</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Consumer scans QR with exact bill amount locked in, pays via any UPI app, and the bill is confirmed & issued.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <span>
            {storageMode === 'mongodb'
              ? 'MongoDB Atlas Cloud • Multi-Store SaaS'
              : 'Cloud-Ready Multi-Store Ledger Engine'}
          </span>
          <span className="inline-flex items-center gap-1 text-teal-400">
            <ShieldCheck className="h-3.5 w-3.5" /> Isolated Business Accounts
          </span>
        </div>
      </div>

      {/* Right Auth Form */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-xl space-y-5">
          {storageMode === 'unconfigured_cloud' && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-xs text-amber-950 space-y-1">
              <div className="font-bold">Almost ready — Connect your MongoDB Atlas URI!</div>
              <div className="text-amber-900 leading-relaxed">
                1. In MongoDB Atlas, enable <span className="font-mono font-semibold">0.0.0.0/0</span> under <b>Network Access</b> and copy your <span className="font-mono font-semibold">mongodb+srv://...</span> connection string.<br />
                2. In Vercel / Render <b>Settings → Environment Variables</b>, add <span className="font-mono font-semibold">MONGODB_URI</span> and redeploy.
              </div>
            </div>
          )}

          {!hasUsers && storageMode !== 'unconfigured_cloud' && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50/70 px-4 py-3.5 text-xs text-teal-900">
              <div className="font-bold">Welcome to KoshBill Cloud ERP</div>
              <div className="mt-0.5 text-teal-800">
                Register your business below to get your own private, isolated inventory, GST/Non-GST billing, BV & Khata ledger workspace.
              </div>
            </div>
          )}

          {/* Auth Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-7 shadow-xs">
            <div className="flex rounded-xl bg-slate-100 p-1 mb-3">
              <button
                type="button"
                onClick={() => {
                  setTab('LOGIN');
                  setError('');
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                  tab === 'LOGIN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sign In to Store
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('REGISTER');
                  setError('');
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                  tab === 'REGISTER'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Register New Business
              </button>
            </div>

            <p className="mb-4 text-[11px] text-slate-500 text-center">
              {tab === 'LOGIN'
                ? 'New here? Click "Register New Business" above to create your free private store workspace.'
                : 'Each registered business gets its own 100% isolated products, batches, bills & ledgers.'}
            </p>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                {error}
              </div>
            )}

            {tab === 'LOGIN' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    placeholder="you@yourbusiness.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-teal-600 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Sign In to Dashboard
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Store / Business Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Enter your store name"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Owner Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      placeholder="Enter owner name"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      required
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder="owner@yourstore.com"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Password (min 6 chars) *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Create password"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* GST Registration Toggle right during onboarding */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        Enable GST Billing (GSTIN, HSN & CGST/SGST/IGST)?
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {gstEnabled
                          ? 'GST mode active — enter your GSTIN below (can be toggled anytime).'
                          : 'Skipping GST — clean retail Bills of Supply without tax columns.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGstEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        gstEnabled ? 'bg-teal-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition ${
                          gstEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {gstEnabled && (
                    <div className="mt-3">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        15-Digit GSTIN
                      </label>
                      <input
                        type="text"
                        maxLength={15}
                        value={gstin}
                        onChange={(e) => setGstin(e.target.value.toUpperCase())}
                        placeholder="15-character GSTIN"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-mono uppercase focus:border-teal-600 focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Merchant UPI ID (For Bill QR) *
                    </label>
                    <input
                      type="text"
                      required
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="yourupi@bank"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Business State
                    </label>
                    <select
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    >
                      {availableStates.map((st) => (
                        <option key={st.code} value={st.code}>
                          {st.code} - {st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      City / Town
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shop Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, Market, Landmark"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={loadStandardHsn}
                    onChange={(e) => setLoadStandardHsn(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  <span>Include standard Indian GST HSN/SAC tax rate codes in HSN directory</span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Create Store & Launch KoshBill
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
