import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Boxes,
  CheckCircle2,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Settings,
  ShoppingBag,
  ShoppingCart,
  X,
  AlertCircle,
} from 'lucide-react';
import { apiFetch, getStoredToken, setStoredToken } from './lib/api';
import { formatINR } from './lib/format';
import {
  IndianState,
  Invoice,
  NavSection,
  Organization,
  User,
} from './types';
import { AuthView } from './views/AuthView';
import { DashboardView } from './views/DashboardView';
import { PosBillingView } from './views/PosBillingView';
import { InventoryBatchesView } from './views/InventoryBatchesView';
import { PurchasesSuppliersView } from './views/PurchasesSuppliersView';
import { ClientsLedgersView } from './views/ClientsLedgersView';
import { ReportsView } from './views/ReportsView';
import { SettingsView } from './views/SettingsView';
import { InvoicePrintModal } from './components/InvoicePrintModal';
import {
  HandToHandQrConfirmPayload,
  HandToHandQrModal,
} from './components/HandToHandQrModal';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [states, setStates] = useState<IndianState[]>([]);
  const [hasUsers, setHasUsers] = useState<boolean>(true);
  const [storageMode, setStorageMode] = useState<
    'mongodb' | 'local' | 'unconfigured_cloud' | 'mongodb_error'
  >('local');
  const [mongoError, setMongoError] = useState<string | null>(null);
  const [detectedEnvVar, setDetectedEnvVar] = useState<string | null>(null);

  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [subAction, setSubAction] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Global Invoice Print & Due Settlement Modals
  const [printingInvoice, setPrintingInvoice] = useState<Invoice | null>(null);
  const [printInitialFormat, setPrintInitialFormat] = useState<'A4' | 'THERMAL' | 'OWNER_BV'>(
    'A4'
  );
  const [settlingInvoice, setSettlingInvoice] = useState<Invoice | null>(null);
  const [settlingSubmitting, setSettlingSubmitting] = useState(false);

  // Toast notifications
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      apiFetch<{
        states: IndianState[];
        has_users?: boolean;
        storage_mode?: 'mongodb' | 'local' | 'unconfigured_cloud' | 'mongodb_error';
        mongodb_error?: string | null;
        env_var?: string | null;
      }>('/meta/states')
        .then((r) => {
          setStates(r.states || []);
          setHasUsers(Boolean(r.has_users));
          if (r.storage_mode) setStorageMode(r.storage_mode);
          setMongoError(r.mongodb_error || null);
          setDetectedEnvVar(r.env_var || null);
        })
        .catch(() => {})
        .finally(() => setBooting(false));
      return;
    }

    apiFetch<{ user: User; organization: Organization; states: IndianState[] }>('/auth/me')
      .then((res) => {
        setUser(res.user);
        setOrganization(res.organization);
        setHasUsers(true);
        if (res.states) setStates(res.states);
      })
      .catch(() => {
        setStoredToken(null);
        return apiFetch<{
          states: IndianState[];
          has_users?: boolean;
          storage_mode?: 'mongodb' | 'local' | 'unconfigured_cloud' | 'mongodb_error';
          mongodb_error?: string | null;
          env_var?: string | null;
        }>('/meta/states').then((r) => {
          setStates(r.states || []);
          setHasUsers(Boolean(r.has_users));
          if (r.storage_mode) setStorageMode(r.storage_mode);
          setMongoError(r.mongodb_error || null);
          setDetectedEnvVar(r.env_var || null);
        });
      })
      .finally(() => setBooting(false));
  }, []);

  const handleNavigate = (section: NavSection, sub?: string) => {
    setActiveNav(section);
    setSubAction(sub);
    setMobileMenuOpen(false);
  };

  const handleGlobalGstToggle = async () => {
    if (!organization) return;
    const nextVal = organization.gst_enabled ? 0 : 1;
    // Optimistic update
    setOrganization({ ...organization, gst_enabled: nextVal });
    try {
      const res = await apiFetch<{ organization: Organization }>('/settings/gst-toggle', {
        method: 'PATCH',
        body: JSON.stringify({ gst_enabled: Boolean(nextVal) }),
      });
      setOrganization(res.organization);
      notify(
        nextVal
          ? 'GST Mode Enabled — Tax Invoices & HSN breakup active'
          : 'Switched to Non-GST Mode — Clean retail Bills of Supply active'
      );
    } catch (err: any) {
      setOrganization(organization);
      notify(err.message || 'Failed to toggle GST mode', 'error');
    }
  };

  const handleOpenInvoicePrint = useCallback(
    (inv: Invoice, fmt: 'A4' | 'THERMAL' | 'OWNER_BV' = 'A4') => {
      setPrintInitialFormat(fmt);
      setPrintingInvoice(inv);
      if (inv.id && inv.customer_total_bv === undefined) {
        apiFetch<{ invoice: Invoice }>(`/invoices/${inv.id}`)
          .then((res) => setPrintingInvoice(res.invoice))
          .catch(() => {});
      }
    },
    []
  );

  const handleOpenInvoicePrintById = async (
    invoiceId: number,
    fmt: 'A4' | 'THERMAL' | 'OWNER_BV' = 'A4'
  ) => {
    try {
      const res = await apiFetch<{ invoice: Invoice }>(`/invoices/${invoiceId}`);
      setPrintInitialFormat(fmt);
      setPrintingInvoice(res.invoice);
    } catch (err: any) {
      notify(err.message || 'Could not load invoice', 'error');
    }
  };

  const handleConfirmSettleInvoice = async (payload: HandToHandQrConfirmPayload) => {
    if (!settlingInvoice) return;
    setSettlingSubmitting(true);
    try {
      const res = await apiFetch<{ invoice: Invoice }>(
        `/invoices/${settlingInvoice.id}/settle`,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: payload.amount_paid,
            payment_mode: payload.payment_mode,
            payment_ref: payload.payment_ref,
          }),
        }
      );
      setSettlingInvoice(null);
      setPrintingInvoice(res.invoice);
      setRefreshCounter((c) => c + 1);
      notify(
        `Received ${formatINR(payload.amount_paid)} for ${res.invoice.invoice_number}!`
      );
    } catch (err: any) {
      notify(err.message || 'Failed to settle invoice', 'error');
    } finally {
      setSettlingSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setOrganization(null);
    setHasUsers(true);
    setActiveNav('dashboard');
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-white font-black text-lg animate-pulse">
            K
          </div>
          <p className="text-xs font-semibold text-slate-500">Loading KoshBill Workspace...</p>
        </div>
      </div>
    );
  }

  if (!user || !organization) {
    return (
      <AuthView
        states={states}
        hasUsers={hasUsers}
        storageMode={storageMode}
        mongoError={mongoError}
        detectedEnvVar={detectedEnvVar}
        onAuthenticated={(payload) => {
          setUser(payload.user);
          setOrganization(payload.organization);
          setHasUsers(true);
          if (payload.states) setStates(payload.states);
          setActiveNav('dashboard');
        }}
      />
    );
  }

  const navItems: Array<{
    id: NavSection;
    label: string;
    subtitle: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    {
      id: 'dashboard',
      label: 'Overview',
      subtitle: 'KPIs & Expiry Radar',
      icon: LayoutDashboard,
    },
    {
      id: 'billing',
      label: 'Billing & QR POS',
      subtitle: 'FIFO Bills & QR Scan',
      icon: ShoppingCart,
    },
    {
      id: 'inventory',
      label: 'FIFO Inventory',
      subtitle: 'Batches, Expiry & HSN',
      icon: Boxes,
    },
    {
      id: 'purchases',
      label: 'Purchases & Stock-In',
      subtitle: 'Suppliers & New Batches',
      icon: ShoppingBag,
    },
    {
      id: 'ledgers',
      label: 'Clients & Ledgers',
      subtitle: 'Khata, Bills & Client BV',
      icon: BookOpen,
    },
    {
      id: 'reports',
      label: 'Reports, BV & GSTR-1',
      subtitle: 'Sales, BV, GST & Stock',
      icon: BarChart3,
    },
    {
      id: 'settings',
      label: 'Store & GST Settings',
      subtitle: 'GST Toggle & UPI QR',
      icon: Settings,
    },
  ];

  const activeNavMeta = navItems.find((n) => n.id === activeNav) || navItems[0];

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900 text-slate-200 border-r border-slate-800">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-500 text-slate-950 font-black text-base">
            K
          </div>
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-white tracking-tight truncate">
              KoshBill ERP
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {organization.business_name}
            </div>
          </div>
        </div>

        {/* Quick Counter Bill CTA */}
        <div className="p-3.5 border-b border-slate-800">
          <button
            type="button"
            onClick={() => handleNavigate('billing', 'new')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-teal-500 transition shadow-xs"
          >
            <QrCode className="h-4 w-4" />
            New Bill + Payment QR
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  isActive
                    ? 'bg-slate-800 text-white ring-1 ring-teal-500/40'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-teal-400' : 'text-slate-400'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{item.label}</div>
                  <div className="text-[10px] text-slate-500 truncate">{item.subtitle}</div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="border-t border-slate-800 p-3.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">{user.name}</div>
            <div className="text-[10px] text-slate-400 truncate">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-400 transition"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-slate-900 text-white flex flex-col z-10">
            <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
              <span className="font-bold text-sm">KoshBill Navigation</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                      active ? 'bg-slate-800 text-white' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4 text-teal-400" />
                    <div>
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div className="text-[10px] text-slate-400">{item.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-xs font-semibold text-rose-300 hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Sticky Top Header */}
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 backdrop-blur-xs px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-700"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                {activeNavMeta.label}
              </h1>
              <p className="hidden sm:block text-[11px] text-slate-500 truncate">
                {activeNavMeta.subtitle}
              </p>
            </div>
          </div>

          {/* Right Header Controls: 1-Click GST Mode Switcher + Quick QR Bill */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleGlobalGstToggle}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                organization.gst_enabled
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                  : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              title="Click to switch your store between GST Billing Mode and Non-GST Mode"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  organization.gst_enabled ? 'bg-indigo-600' : 'bg-slate-400'
                }`}
              />
              {organization.gst_enabled ? 'GST Mode: ON' : 'GST Skipped (Non-GST)'}
            </button>
          </div>
        </header>

        {/* Active Module Content */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {activeNav === 'dashboard' && (
            <DashboardView
              organization={organization}
              onNavigate={handleNavigate}
              onOpenInvoicePrint={handleOpenInvoicePrintById}
              onOpenSettleInvoice={(inv) => setSettlingInvoice(inv)}
              refreshTrigger={refreshCounter}
            />
          )}

          {activeNav === 'billing' && (
            <PosBillingView
              organization={organization}
              states={states}
              initialSubTab={subAction}
              onOpenInvoicePrint={handleOpenInvoicePrint}
              onOpenSettleInvoice={(inv) => setSettlingInvoice(inv)}
              onGlobalRefresh={() => setRefreshCounter((c) => c + 1)}
              notify={notify}
            />
          )}

          {activeNav === 'inventory' && (
            <InventoryBatchesView
              organization={organization}
              initialSubTab={subAction}
              onGlobalRefresh={() => setRefreshCounter((c) => c + 1)}
              notify={notify}
            />
          )}

          {activeNav === 'purchases' && (
            <PurchasesSuppliersView
              organization={organization}
              states={states}
              initialSubTab={subAction}
              onGlobalRefresh={() => setRefreshCounter((c) => c + 1)}
              notify={notify}
            />
          )}

          {activeNav === 'ledgers' && (
            <ClientsLedgersView
              organization={organization}
              states={states}
              onOpenInvoicePrint={handleOpenInvoicePrint}
              onGlobalRefresh={() => setRefreshCounter((c) => c + 1)}
              notify={notify}
            />
          )}

          {activeNav === 'reports' && (
            <ReportsView
              organization={organization}
              onOpenInvoicePrint={handleOpenInvoicePrint}
              notify={notify}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              organization={organization}
              states={states}
              onOrganizationUpdated={(org) => setOrganization(org)}
              notify={notify}
            />
          )}
        </main>
      </div>

      {/* Global Printable Invoice Viewer Modal */}
      {printingInvoice && (
        <InvoicePrintModal
          invoice={printingInvoice}
          organization={organization}
          initialFormat={printInitialFormat}
          onClose={() => setPrintingInvoice(null)}
          onInvoiceUpdated={(updated) => {
            setPrintingInvoice(updated);
            setRefreshCounter((c) => c + 1);
          }}
          onSettleClick={(inv) => {
            setPrintingInvoice(null);
            setSettlingInvoice(inv);
          }}
        />
      )}

      {/* Global Unpaid Invoice Hand-to-Hand QR Settlement Modal */}
      {settlingInvoice && (
        <HandToHandQrModal
          open={Boolean(settlingInvoice)}
          onClose={() => setSettlingInvoice(null)}
          title={`Settle Bill ${settlingInvoice.invoice_number}`}
          subtitle="Show this QR to the customer — exact remaining due amount is embedded inside the UPI QR."
          upiId={organization.upi_id}
          payeeName={organization.upi_payee_name || organization.business_name}
          totalAmount={settlingInvoice.balance_due}
          defaultNote={`Settlement ${settlingInvoice.invoice_number}`}
          allowModeSwitch
          allowCreditLedger={false}
          customerName={settlingInvoice.customer_name}
          isGstBill={Boolean(settlingInvoice.is_gst)}
          submitting={settlingSubmitting}
          onConfirm={handleConfirmSettleInvoice}
        />
      )}

      {/* Toast Stack */}
      <div className="no-print fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-lg transition ${
              t.type === 'error'
                ? 'border-rose-200 bg-rose-950 text-rose-100'
                : 'border-slate-800 bg-slate-900 text-white'
            }`}
          >
            {t.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
