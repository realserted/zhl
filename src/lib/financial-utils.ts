import { FinancialLoan } from '@/lib/types/financial';

/**
 * Standard amortization formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
 * Handles interest-only, zero-rate, and zero-principal edge cases.
 */
export function computeMonthlyPayment(loan: FinancialLoan): number {
  const P = loan.original_amount ?? 0;
  const n = loan.amortization ?? 0;
  const rate = (loan.interest_rate ?? 0) / 100 / 12;
  if (P === 0) return 0;
  if (loan.interest_only) return P * rate;
  if (n === 0) return 0;
  if (rate === 0) return P / n;
  return P * (rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1);
}

/**
 * Check if a loan has active payments in a given year/month.
 */
export function isLoanActiveInMonth(loan: FinancialLoan, year: number, month: number): boolean {
  if (!loan.start_date) return false;
  const sd = new Date(loan.start_date);
  const sy = sd.getFullYear(), sm = sd.getMonth() + 1;
  if (year < sy || (year === sy && month < sm)) return false;
  if (loan.balloon_date) {
    const bd = new Date(loan.balloon_date);
    const by = bd.getFullYear(), bm = bd.getMonth() + 1;
    if (year > by || (year === by && month > bm)) return false;
  }
  if (loan.amortization && !loan.interest_only) {
    const elapsed = (year - sy) * 12 + (month - sm);
    if (elapsed >= loan.amortization) return false;
  }
  return true;
}
