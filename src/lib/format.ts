export function formatINR(value: number | string | undefined | null, showSymbol = true): string {
  const num = Number(value || 0);
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return showSymbol ? `₹${formatted}` : formatted;
}

export function formatCompactINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000000) {
    return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  }
  if (abs >= 100000) {
    return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  }
  return formatINR(value);
}

export function formatBV(value: number | string | undefined | null, withSuffix = true): string {
  const num = Number(value || 0);
  const isWhole = Math.abs(num - Math.round(num)) < 0.0001;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
  return withSuffix ? `${formatted} BV` : formatted;
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const clean = dateStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return dateStr;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  return `${parts[2]} ${months[m] || parts[1]} ${parts[0]}`;
}

export function getTodayISO(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Calcutta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function getFirstOfMonthISO(): string {
  return `${getTodayISO().slice(0, 7)}-01`;
}

export function getExpiryMeta(expiryDate?: string, todayStr = getTodayISO()): {
  status: 'NO_EXPIRY' | 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'HEALTHY';
  daysLeft: number | null;
  label: string;
  badgeClass: string;
} {
  if (!expiryDate) {
    return {
      status: 'NO_EXPIRY',
      daysLeft: null,
      label: 'Non-Perishable',
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  }
  const exp = new Date(`${expiryDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date(`${todayStr.slice(0, 10)}T00:00:00Z`).getTime();
  const diffDays = Math.round((exp - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      status: 'EXPIRED',
      daysLeft: diffDays,
      label: `Expired ${Math.abs(diffDays)}d ago`,
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    };
  }
  if (diffDays <= 30) {
    return {
      status: 'CRITICAL',
      daysLeft: diffDays,
      label: diffDays === 0 ? 'Expires Today' : `Exp in ${diffDays}d`,
      badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    };
  }
  if (diffDays <= 90) {
    return {
      status: 'WARNING',
      daysLeft: diffDays,
      label: `Exp in ${diffDays}d`,
      badgeClass: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    };
  }
  return {
    status: 'HEALTHY',
    daysLeft: diffDays,
    label: formatDate(expiryDate),
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
}

export function buildUpiUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
  ref?: string;
}): string {
  const q = new URLSearchParams();
  q.set('pa', (params.upiId || 'merchant@upi').trim());
  q.set('pn', (params.payeeName || 'Store').trim());
  q.set('am', Math.max(0, Number(params.amount || 0)).toFixed(2));
  q.set('cu', 'INR');
  q.set('tn', (params.note || 'Bill Payment').trim().slice(0, 60));
  if (params.ref) {
    q.set('tr', params.ref.slice(0, 35));
  }
  return `upi://pay?${q.toString()}`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? ` ${ONES[o]}` : ''}`;
}

function integerToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  const parts: string[] = [];
  let n = Math.floor(Math.abs(num));

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;

  if (crore > 0) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitsWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitsWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) {
    if (parts.length > 0) parts.push('and');
    parts.push(twoDigitsWords(rest));
  }
  return parts.join(' ');
}

export function amountInWordsINR(amount: number): string {
  const rounded = Math.round((Math.abs(Number(amount || 0)) + Number.EPSILON) * 100) / 100;
  const rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);
  let words = `Rupees ${integerToIndianWords(rupees)}`;
  if (paise > 0) {
    words += ` and ${twoDigitsWords(paise)} Paise`;
  }
  return `${words} Only`;
}
