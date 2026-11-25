export interface IndianState {
  code: string;
  name: string;
}

export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
];

export const DEFAULT_HSN_DIRECTORY = [
  { code: '0401', description: 'Milk and cream, not concentrated nor sweetened (Dairy)', gst_rate: 0, category: 'GOODS' },
  { code: '0402', description: 'Milk powder, condensed dairy & packaged dairy whitener', gst_rate: 5, category: 'GOODS' },
  { code: '0405', description: 'Butter, ghee and other dairy spreads', gst_rate: 12, category: 'GOODS' },
  { code: '0902', description: 'Tea, whether or not flavoured (Packaged Tea)', gst_rate: 5, category: 'GOODS' },
  { code: '1006', description: 'Pre-packaged & labelled Basmati / Non-Basmati Rice (<=25kg)', gst_rate: 5, category: 'GOODS' },
  { code: '1101', description: 'Wheat or meslin flour (Packaged Chakki Atta <=25kg)', gst_rate: 5, category: 'GOODS' },
  { code: '1512', description: 'Sunflower, safflower or mustard edible oil', gst_rate: 5, category: 'GOODS' },
  { code: '1905', description: 'Biscuits, bakery, rusks, wafers and snacks', gst_rate: 18, category: 'GOODS' },
  { code: '2106', description: 'Namkeen, bhujia, nutritional health drinks & food preps', gst_rate: 12, category: 'GOODS' },
  { code: '2202', description: 'Fruit juices, carbonated & packaged beverages', gst_rate: 12, category: 'GOODS' },
  { code: '3004', description: 'Medicaments (Tablets, capsules, syrups for retail sale)', gst_rate: 12, category: 'GOODS' },
  { code: '3005', description: 'First-aid bandages, cotton gauze & surgical dressings', gst_rate: 12, category: 'GOODS' },
  { code: '3304', description: 'Skin care creams, personal care & cosmetics', gst_rate: 18, category: 'GOODS' },
  { code: '3306', description: 'Toothpaste, oral hygiene & dental care preparations', gst_rate: 18, category: 'GOODS' },
  { code: '3401', description: 'Bath soaps, handwash & organic surface-active bars', gst_rate: 18, category: 'GOODS' },
  { code: '3402', description: 'Detergent powders, dishwash liquids & home cleaners', gst_rate: 18, category: 'GOODS' },
  { code: '8506', description: 'Primary alkaline/lithium cells and batteries', gst_rate: 18, category: 'GOODS' },
  { code: '8539', description: 'LED bulbs, tube lights & electrical lighting lamps', gst_rate: 12, category: 'GOODS' },
  { code: '9983', description: 'SAC — Delivery, packaging & retail support services', gst_rate: 18, category: 'SERVICES' },
];

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  note: string;
  transactionRef?: string;
}): string {
  const pa = (params.upiId || 'merchant@upi').trim();
  const pn = (params.payeeName || 'KoshBill Store').trim();
  const am = Math.max(0, Number(params.amount || 0)).toFixed(2);
  const tn = (params.note || 'Bill Payment').trim().slice(0, 60);
  const query = new URLSearchParams();
  query.set('pa', pa);
  query.set('pn', pn);
  query.set('am', am);
  query.set('cu', 'INR');
  query.set('tn', tn);
  if (params.transactionRef) {
    query.set('tr', params.transactionRef.slice(0, 35));
  }
  return `upi://pay?${query.toString()}`;
}

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
