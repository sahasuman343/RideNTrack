/**
 * Group Expense Tracking and Bill Splitting for Motorcycle Touring
 */

export type TripExpenseCategory = 'fuel' | 'food' | 'stay' | 'toll' | 'repairs' | 'other';

export const EXPENSE_CATEGORY_META: Record<TripExpenseCategory, { label: string; icon: string }> = {
  fuel: { label: 'Fuel', icon: '⛽' },
  food: { label: 'Food & Drinks', icon: '🍽️' },
  stay: { label: 'Stay / Lodging', icon: '🏨' },
  toll: { label: 'Tolls & Permits', icon: '🛣️' },
  repairs: { label: 'Repairs & Spares', icon: '🔧' },
  other: { label: 'Other', icon: '💳' },
};

export interface TripExpenseSplit {
  user_id: string;
  display_name: string;
  amount: number;
}

export interface TripExpense {
  id: string;
  ride_id: string;
  payer_id: string;
  payer_name: string;
  title: string;
  amount: number;
  currency: string;
  category: TripExpenseCategory;
  split_type: 'equal' | 'custom';
  notes?: string | null;
  created_at: string;
  splits: TripExpenseSplit[];
}

export interface ParticipantBalance {
  user_id: string;
  display_name: string;
  paid: number;
  share: number;
  net: number; // positive = owed money, negative = owes money
}

export interface TripExpenseSummary {
  currency: string;
  total_spend: number;
  my_paid: number;
  my_share: number;
  net_balance: number;
  category_breakdown: Record<string, number>;
  participant_balances: ParticipantBalance[];
}

export interface SettlementTransaction {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
  currency?: string;
}

/**
 * Greedily resolves group net balances into minimal settlement transactions ("Who owes whom").
 */
export function calculateExpenseSettlement(
  balances: Array<{ user_id: string; display_name: string; paid: number; share: number; net?: number }>,
  currency = 'INR'
): SettlementTransaction[] {
  if (!Array.isArray(balances) || balances.length < 2) return [];

  // Normalize balances with net rounded to 2 decimals
  const debtors: Array<{ userId: string; name: string; amount: number }> = [];
  const creditors: Array<{ userId: string; name: string; amount: number }> = [];

  for (const b of balances) {
    const net = b.net !== undefined ? b.net : Math.round((b.paid - b.share) * 100) / 100;
    if (net < -0.01) {
      debtors.push({ userId: b.user_id, name: b.display_name, amount: Math.abs(net) });
    } else if (net > 0.01) {
      creditors.push({ userId: b.user_id, name: b.display_name, amount: net });
    }
  }

  // Sort descending by amount
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transactions: SettlementTransaction[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx];
    const creditor = creditors[cIdx];

    const settleAmount = Math.round(Math.min(debtor.amount, creditor.amount) * 100) / 100;

    if (settleAmount > 0.01) {
      transactions.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amount: settleAmount,
        currency,
      });
    }

    debtor.amount = Math.round((debtor.amount - settleAmount) * 100) / 100;
    creditor.amount = Math.round((creditor.amount - settleAmount) * 100) / 100;

    if (debtor.amount <= 0.01) dIdx++;
    if (creditor.amount <= 0.01) cIdx++;
  }

  return transactions;
}
