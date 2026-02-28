'use client';

import { useState, useEffect, useMemo } from 'react';
import { ProjectPermission } from '@/lib/types/project';
import { FinancialTransaction, FinancialTxCategory, FinancialLoan } from '@/lib/types/financial';
import {
  getTransactions,
  getTxCategories,
  getLoans,
} from '@/lib/db/financial';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function computeMonthlyPayment(loan: FinancialLoan): number {
  const P = loan.original_amount ?? 0;
  const n = loan.amortization ?? 0;
  const rate = (loan.interest_rate ?? 0) / 100 / 12;
  if (P === 0) return 0;
  if (loan.interest_only) return P * rate;
  if (n === 0) return 0;
  if (rate === 0) return P / n;
  return P * (rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1);
}

function isLoanActiveInMonth(loan: FinancialLoan, year: number, month: number): boolean {
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

export default function FinancialOverview({ selectedProjectId }: Props) {
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [categories, setCategories] = useState<FinancialTxCategory[]>([]);
  const [loans, setLoans] = useState<FinancialLoan[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getTransactions(selectedProjectId),
      getTxCategories(selectedProjectId),
      getLoans(selectedProjectId),
    ]).then(([txs, cats, lns]) => {
      setTransactions(txs);
      setCategories(cats);
      setLoans(lns);
      setLoading(false);
    });
  }, [selectedProjectId]);

  const categoryMap = useMemo(() => {
    const m = new Map<string, FinancialTxCategory>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  // Filter transactions for the selected year
  const yearTxs = useMemo(
    () =>
      transactions.filter((tx) => {
        if (!tx.date || tx.amount == null) return false;
        return new Date(tx.date).getFullYear() === year;
      }),
    [transactions, year],
  );

  // Aggregate by category + month → Map<categoryId, Map<month, total>>
  const txByCatMonth = useMemo(() => {
    const m = new Map<string, Map<number, number>>();
    for (const tx of yearTxs) {
      const catId = tx.category_id || '__uncategorized__';
      if (!m.has(catId)) m.set(catId, new Map());
      const month = new Date(tx.date!).getMonth() + 1;
      const mm = m.get(catId)!;
      mm.set(month, (mm.get(month) ?? 0) + (tx.amount ?? 0));
    }
    return m;
  }, [yearTxs]);

  // Separate into income vs expense by net total sign per category
  const { incomeItems, expenseItems } = useMemo(() => {
    const income: { id: string; name: string }[] = [];
    const expense: { id: string; name: string }[] = [];
    for (const [catId, monthMap] of txByCatMonth) {
      let total = 0;
      for (const v of monthMap.values()) total += v;
      const name =
        catId === '__uncategorized__'
          ? 'Uncategorized'
          : (categoryMap.get(catId)?.name ?? 'Unknown');
      if (total >= 0) income.push({ id: catId, name });
      else expense.push({ id: catId, name });
    }
    income.sort((a, b) => a.name.localeCompare(b.name));
    expense.sort((a, b) => a.name.localeCompare(b.name));
    return { incomeItems: income, expenseItems: expense };
  }, [txByCatMonth, categoryMap]);

  const getCatVal = (catId: string, month: number) =>
    txByCatMonth.get(catId)?.get(month) ?? 0;

  const getIncomeTotal = (month: number) =>
    incomeItems.reduce((s, c) => s + getCatVal(c.id, month), 0);

  const getExpenseTotal = (month: number) =>
    expenseItems.reduce((s, c) => s + Math.abs(getCatVal(c.id, month)), 0);

  const getLoanTotal = (month: number) =>
    loans.reduce((s, ln) => {
      if (!isLoanActiveInMonth(ln, year, month)) return s;
      return s + computeMonthlyPayment(ln);
    }, 0);

  const getCashflow = (month: number) =>
    getIncomeTotal(month) - getExpenseTotal(month) - getLoanTotal(month);

  const fmt = (n: number) =>
    n === 0
      ? ''
      : `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const fmtSigned = (n: number) => {
    if (n === 0) return '';
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading overview...</div>;
  }

  return (
    <div className="overflow-x-auto">
      {/* Year selector */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setYear((y) => y - 1)} className="p-1 hover:bg-muted rounded">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} className="p-1 hover:bg-muted rounded">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-2 py-1 min-w-[180px] sticky left-0 bg-background z-10"></th>
            {MONTHS.map((m, i) => (
              <th key={i} className="text-center px-2 py-1 min-w-[70px] font-semibold text-foreground">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* GROSS INCOME */}
          <SectionHeader label="GROSS INCOME" getTotal={getIncomeTotal} fmt={fmt} />
          {incomeItems.map((c) => (
            <ItemRow key={c.id} label={c.name} getVal={(m) => getCatVal(c.id, m)} fmt={fmt} />
          ))}
          {incomeItems.length === 0 && <EmptyRow text="No income transactions" />}

          {/* EXPENSES */}
          <SectionHeader label="EXPENSES" getTotal={getExpenseTotal} fmt={fmt} />
          {expenseItems.map((c) => (
            <ItemRow
              key={c.id}
              label={c.name}
              getVal={(m) => Math.abs(getCatVal(c.id, m))}
              fmt={fmt}
            />
          ))}
          {expenseItems.length === 0 && <EmptyRow text="No expense transactions" />}

          {/* LOANS */}
          <SectionHeader label="LOANS" getTotal={getLoanTotal} fmt={fmt} />
          {loans.map((ln) => (
            <ItemRow
              key={ln.id}
              label={ln.loan_name || 'Unnamed Loan'}
              getVal={(m) => (isLoanActiveInMonth(ln, year, m) ? computeMonthlyPayment(ln) : 0)}
              fmt={fmt}
            />
          ))}
          {loans.length === 0 && <EmptyRow text="No loans in debt schedule" />}

          {/* CASHFLOW */}
          <tr>
            <td colSpan={13} className="h-2" />
          </tr>
          <tr className="bg-muted/30">
            <td className="px-2 py-1 font-bold text-foreground text-xs sticky left-0 bg-muted/30 z-10">
              CASHFLOW
            </td>
            {MONTHS.map((_, i) => {
              const v = getCashflow(i + 1);
              return (
                <td
                  key={i}
                  className={`text-center px-2 py-1 font-semibold ${v < 0 ? 'text-red-400' : v > 0 ? 'text-green-400' : ''}`}
                >
                  {fmtSigned(v)}
                </td>
              );
            })}
          </tr>

          {/* Bank Balance */}
          <tr>
            <td colSpan={13} className="h-2" />
          </tr>
          <tr className="bg-muted/30">
            <td className="px-2 py-1 font-bold text-xs sticky left-0 bg-muted/30 z-10 text-foreground">
              Bank Balance - Projected
            </td>
            {MONTHS.map((_, i) => (
              <td key={i} className="text-center px-2 py-1 font-bold">
                {fmtSigned(getCashflow(i + 1))}
              </td>
            ))}
          </tr>
          <tr className="bg-green-600/20">
            <td className="px-2 py-1 font-bold text-xs sticky left-0 bg-green-600/20 z-10 text-green-400">
              Bank Balance - Actual
            </td>
            {MONTHS.map((_, i) => (
              <td key={i} className="text-center px-2 py-1 font-bold text-green-400">
                {fmtSigned(getCashflow(i + 1))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function SectionHeader({
  label,
  getTotal,
  fmt,
}: {
  label: string;
  getTotal: (m: number) => number;
  fmt: (n: number) => string;
}) {
  return (
    <tr className="bg-muted/30">
      <td className="px-2 py-1 font-bold text-foreground text-xs sticky left-0 bg-muted/30 z-10">
        {label}
      </td>
      {MONTHS.map((_, i) => (
        <td key={i} className="text-center px-2 py-1 font-semibold text-foreground">
          {fmt(getTotal(i + 1))}
        </td>
      ))}
    </tr>
  );
}

function ItemRow({
  label,
  getVal,
  fmt,
}: {
  label: string;
  getVal: (m: number) => number;
  fmt: (n: number) => string;
}) {
  return (
    <tr className="border-b border-border/30 hover:bg-muted/20">
      <td className="px-2 py-1 sticky left-0 bg-background z-10 text-foreground pl-4">{label}</td>
      {MONTHS.map((_, i) => (
        <td key={i} className="text-center px-2 py-1">
          {fmt(getVal(i + 1))}
        </td>
      ))}
    </tr>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <tr>
      <td colSpan={13} className="px-4 py-1 text-muted-foreground italic text-xs">
        {text}
      </td>
    </tr>
  );
}
