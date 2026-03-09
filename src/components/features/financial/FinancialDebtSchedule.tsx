'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { ProjectPermission } from '@/lib/types/project';
import { FinancialLoan } from '@/lib/types/financial';
import { getLoans, createLoan, updateLoan, deleteLoan } from '@/lib/db/financial';
import { logUserAction } from '@/lib/db/user-logs';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
}

interface ScheduleRow {
  due: string;
  month: number;
  payment: number;    // actual cash out that month
  interest: number;   // interest portion
  principal: number;  // principal portion
  balance: number;    // remaining balance AFTER this payment
  isBalloon: boolean; // true if this row is the balloon payoff point
}

export default function FinancialDebtSchedule({ selectedProjectId, userPermission }: Props) {
  const { user } = useAuth();
  const [loans, setLoans] = useState<FinancialLoan[]>([]);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const displayNameRef = useRef('Unknown');
  const userEmailRef = useRef('');

  const permLevel = userPermission?.perm_reports ?? 'Admin';
  const canEdit = permLevel === 'Edit' || permLevel === 'Admin' || !userPermission;

  useEffect(() => {
    if (!user) return;
    userEmailRef.current = user.email || '';
    supabase
      .from('zhl_accounts')
      .select('display_name')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        displayNameRef.current = data?.display_name || user.email || 'Unknown';
      });
  }, [user]);

  useEffect(() => {
    getLoans(selectedProjectId).then((data) => {
      setLoans(data);
      if (data.length > 0) setSelectedLoanId(data[0].id);
    });
  }, [selectedProjectId]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({
      projectId: selectedProjectId,
      userId: user.id,
      userName: displayNameRef.current,
      userEmail: userEmailRef.current,
      action,
    });
  };

  const selectedLoan = loans.find((l) => l.id === selectedLoanId) ?? null;

  const handleAddLoan = async () => {
    const loan = await createLoan(selectedProjectId);
    if (loan) {
      setLoans((prev) => [...prev, loan]);
      setSelectedLoanId(loan.id);
      log('Added a new loan');
    }
  };

  const handleDeleteLoan = async () => {
    if (!selectedLoan || !confirm(`Delete "${selectedLoan.loan_name || 'Untitled Loan'}"?`)) return;
    if (await deleteLoan(selectedLoan.id)) {
      setLoans((prev) => prev.filter((l) => l.id !== selectedLoan.id));
      setSelectedLoanId(
        loans.length > 1 ? loans.find((l) => l.id !== selectedLoan.id)?.id ?? null : null
      );
      log(`Deleted loan "${selectedLoan.loan_name || 'Untitled'}"`);
    }
  };

  const saveField = async (field: string, rawValue: string) => {
    setEditingField(null);
    if (!selectedLoan) return;
    const current = (selectedLoan as unknown as Record<string, unknown>)[field];
    const numFields = ['amortization', 'interest_rate', 'original_amount', 'due_on_the'];
    const val = numFields.includes(field)
      ? (parseFloat(rawValue) || null)
      : (rawValue.trim() || null);
    if (val === current) return;
    const ok = await updateLoan(selectedLoan.id, field, val);
    if (ok) {
      setLoans((prev) =>
        prev.map((l) => (l.id === selectedLoan.id ? { ...l, [field]: val } : l))
      );
      log(`Updated loan ${field} to "${rawValue}"`);
    }
  };

  const toggleInterestOnly = async () => {
    if (!selectedLoan || !canEdit) return;
    const newVal = !selectedLoan.interest_only;
    const ok = await updateLoan(selectedLoan.id, 'interest_only', newVal);
    if (ok) {
      setLoans((prev) =>
        prev.map((l) => (l.id === selectedLoan.id ? { ...l, interest_only: newVal } : l))
      );
      log(`Set loan to ${newVal ? 'interest only' : 'amortizing'}`);
    }
  };

  // ── Auto-calculated monthly payment ──────────────────────────────────────
  const computedPayment = useMemo((): number | null => {
    if (!selectedLoan?.original_amount || !selectedLoan?.amortization) return null;
    const P = Number(selectedLoan.original_amount);
    const n = Number(selectedLoan.amortization);
    const r = (selectedLoan.interest_rate ?? 0) / 100 / 12;

    if (selectedLoan.interest_only) {
      return Number((P * r).toFixed(2));
    }
    if (r === 0) {
      return Number((P / n).toFixed(2));
    }
    // Standard amortization formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
    const factor = Math.pow(1 + r, n);
    return Number(((P * r * factor) / (factor - 1)).toFixed(2));
  }, [selectedLoan?.original_amount, selectedLoan?.amortization, selectedLoan?.interest_rate, selectedLoan?.interest_only]);

  // ── Amortization schedule ────────────────────────────────────────────────
  const schedule = useMemo((): ScheduleRow[] => {
    if (!selectedLoan?.original_amount || !selectedLoan?.amortization || computedPayment == null) return [];

    // Due day of month (1–31), default to 1
    const dueDay = Math.min(31, Math.max(1, Number(selectedLoan.due_on_the) || 1));

    // Start date: use start_date if set, otherwise 1st of current month
    let startDate: Date;
    if (selectedLoan.start_date) {
      startDate = new Date(selectedLoan.start_date + 'T00:00:00');
    } else {
      startDate = new Date();
      startDate.setDate(1);
    }

    const monthlyRate = (selectedLoan.interest_rate ?? 0) / 100 / 12;
    const maxMonths = Number(selectedLoan.amortization);
    const balloonDate = selectedLoan.balloon_date
      ? new Date(selectedLoan.balloon_date + 'T00:00:00')
      : null;

    let balance = Number(selectedLoan.original_amount);

    const rows: ScheduleRow[] = [];

    // Month 0 — opening balance, no payment yet
    const openingDate = new Date(startDate.getFullYear(), startDate.getMonth(), dueDay);
    rows.push({
      due: fmtDate(openingDate),
      month: 0,
      payment: 0,
      interest: 0,
      principal: 0,
      balance,
      isBalloon: false,
    });

    for (let i = 1; i <= maxMonths; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, dueDay);

      const interest = balance * monthlyRate;
      const hitsBalloon = balloonDate ? d >= balloonDate : false;

      if (selectedLoan.interest_only) {
        rows.push({
          due: fmtDate(d),
          month: i,
          payment: Number(interest.toFixed(2)),
          interest,
          principal: 0,
          balance,
          isBalloon: hitsBalloon,
        });
        if (hitsBalloon) break;
      } else {
        // Last payment: pay exactly the remaining balance + interest
        const isLastPayment = (computedPayment - interest) >= balance || i === maxMonths;
        const principal = isLastPayment ? balance : (computedPayment - interest);
        const payment = isLastPayment ? (balance + interest) : computedPayment;
        balance = isLastPayment ? 0 : (balance - principal);

        rows.push({
          due: fmtDate(d),
          month: i,
          payment: Number(payment.toFixed(2)),
          interest,
          principal,
          balance,
          isBalloon: hitsBalloon,
        });

        if (isLastPayment || hitsBalloon) break;
      }
    }

    return rows;
  }, [selectedLoan, computedPayment]);

  // Today's year+month for row highlighting
  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${t.getMonth()}`;
  })();

  // ── Loan detail fields list ───────────────────────────────────────────────
  const loanFields: { field: string; label: string; type?: string; computed?: boolean }[] = [
    { field: 'loan_name',       label: 'LOAN NAME' },
    { field: 'lender',          label: 'Lender' },
    { field: 'start_date',      label: 'Start Date',            type: 'date' },
    { field: 'due_on_the',      label: 'Due Day',               type: 'number' },
    { field: 'amortization',    label: 'Amortization (months)', type: 'number' },
    { field: 'interest_rate',   label: 'Interest Rate',         type: 'number' },
    { field: 'original_amount', label: 'Original Loan Amount',  type: 'number' },
    { field: 'monthly_payment', label: 'Monthly Payment',       computed: true },
    { field: 'balloon_date',    label: 'Balloon',               type: 'date' },
  ];

  const money = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      {/* ── Loan selector row ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {loans.map((loan) => (
          <button
            key={loan.id}
            onClick={() => setSelectedLoanId(loan.id)}
            className={`px-5 py-2 text-[11px] font-bold tracking-wider uppercase rounded-xl transition-all ${
              selectedLoanId === loan.id
                ? 'bg-primary/10 text-primary border border-primary/30 shadow-sm shadow-primary/5'
                : 'border border-border text-foreground hover:bg-muted/50'
            }`}
          >
            {loan.loan_name || 'Untitled Loan'}
          </button>
        ))}
        {canEdit && (
          <button
            onClick={handleAddLoan}
            className="ml-auto flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase text-primary hover:text-primary/80 transition-all"
          >
            <Plus className="h-4 w-4" /> Add Loan
          </button>
        )}
      </div>

      {selectedLoan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left: Loan details ───────────────────────────────────────── */}
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm overflow-x-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-muted/30 border-b border-border/50">
              <span className="text-[11px] font-bold tracking-wider uppercase text-foreground/80">LOAN DETAILS</span>
              {canEdit && (
                <button
                  onClick={handleDeleteLoan}
                  title="Delete loan"
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <table className="w-full text-xs sm:text-sm">
              <tbody>
                {loanFields.map(({ field, label, type, computed }) => {
                  // Computed row (Monthly Payment) — read-only display
                  if (computed) {
                    return (
                      <tr key={field} className="border-b border-border/50 bg-primary/5">
                        <td className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-[175px] whitespace-nowrap">
                          {label}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className="text-[13px] font-bold text-primary px-2 py-0.5 rounded bg-primary/10">
                            {computedPayment != null
                              ? `$${money(computedPayment)}`
                              : <span className="text-muted-foreground/40 italic font-normal">Enter amount, rate & term</span>
                            }
                          </span>
                        </td>
                        <td />
                      </tr>
                    );
                  }

                  const raw = (selectedLoan as unknown as Record<string, unknown>)[field];
                  const displayVal = raw != null ? String(raw) : '';
                  const isEditing = editingField === field;

                  // Format for display
                  let formatted: string = displayVal;
                  if (field === 'interest_rate' && displayVal)
                    formatted = `${Number(displayVal).toFixed(3)}%`;
                  else if (field === 'original_amount' && displayVal)
                    formatted = `$${money(Number(displayVal))}`;
                  else if (field === 'due_on_the' && displayVal)
                    formatted = ordinal(Number(displayVal));
                  else if ((field === 'balloon_date' || field === 'start_date') && displayVal)
                    formatted = fmtDisplayDate(displayVal);

                  return (
                    <tr
                      key={field}
                      className={`border-b border-border/50 hover:bg-muted/30 transition-colors group ${
                        field === 'loan_name' ? 'bg-muted/30' : ''
                      }`}
                    >
                      <td className="px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-[175px] whitespace-nowrap">
                        {label}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {isEditing ? (
                          <input
                            autoFocus
                            type={type ?? 'text'}
                            step={type === 'number' ? 'any' : undefined}
                            min={field === 'due_on_the' ? 1 : undefined}
                            max={field === 'due_on_the' ? 31 : undefined}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => saveField(field, editValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveField(field, editValue);
                              if (e.key === 'Escape') setEditingField(null);
                            }}
                            className="w-full px-2 py-0.5 bg-background border border-input rounded text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        ) : (
                          <span
                            onClick={
                              canEdit
                                ? () => { setEditingField(field); setEditValue(displayVal); }
                                : undefined
                            }
                            className={`text-sm tracking-tight block min-h-5 px-2 py-0.5 rounded ${
                              canEdit ? 'cursor-pointer hover:bg-muted/60 transition-colors' : ''
                            } ${field === 'loan_name' ? 'font-bold text-primary text-base' : 'font-medium text-foreground'}`}
                          >
                            {formatted || (
                              <span className="text-muted-foreground/40 italic">—</span>
                            )}
                          </span>
                        )}
                      </td>

                      {/* "or Interest only" toggle next to Amortization row */}
                      {field === 'amortization' ? (
                        <td className="px-4 py-4 whitespace-nowrap">
                          <button
                            onClick={toggleInterestOnly}
                            disabled={!canEdit}
                            className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded transition-colors border ${
                              selectedLoan.interest_only
                                ? 'border-primary text-primary bg-primary/10 shadow-sm shadow-primary/5'
                                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50'
                            }`}
                          >
                            {selectedLoan.interest_only ? 'Interest only ✓' : 'or Interest only'}
                          </button>
                        </td>
                      ) : (
                        <td />
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Notes box */}
            <div className="px-5 py-4 border-t border-border/50">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2">
                Notes
              </label>
              <textarea
                value={selectedLoan.notes ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setLoans((prev) =>
                    prev.map((l) => (l.id === selectedLoan.id ? { ...l, notes: val } : l))
                  );
                }}
                onBlur={(e) => saveField('notes', e.target.value)}
                readOnly={!canEdit}
                placeholder={canEdit ? 'Add notes (e.g. PPP, SBA, refinance details...)' : 'No notes'}
                className="w-full px-3 py-2 bg-muted/30 border border-border/50 rounded-lg text-sm font-medium text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring resize-y min-h-[80px]"
                rows={3}
              />
            </div>

            {/* Quick stats footer */}
            {schedule.length > 1 && (
              <div className="px-4 py-3 border-t border-border bg-muted/30 space-y-1 text-xs text-muted-foreground">
                {(() => {
                  const totalInterest = schedule.reduce((sum, r) => sum + r.interest, 0);
                  const totalPaid = schedule.reduce((sum, r) => sum + r.payment, 0);
                  return (
                    <>
                      <div>
                        Schedule length:{' '}
                        <span className="font-semibold text-foreground">
                          {schedule.length - 1} months ({((schedule.length - 1) / 12).toFixed(1)} years)
                        </span>
                      </div>
                      <div>
                        Total interest paid:{' '}
                        <span className="font-semibold text-foreground">${money(totalInterest)}</span>
                      </div>
                      <div>
                        Total amount paid:{' '}
                        <span className="font-semibold text-foreground">${money(totalPaid)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ── Right: Amortization schedule ─────────────────────────────── */}
          <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm flex flex-col">
            <div className="px-5 py-3.5 bg-muted/30 border-b border-border/50">
              <span className="text-[11px] font-bold tracking-wider uppercase text-foreground/80">AMORTIZATION SCHEDULE</span>
            </div>

            <div className="overflow-y-auto max-h-[600px] custom-scrollbar">
              <table className="w-full text-xs sm:text-sm">
                <thead className="sticky top-0 bg-muted/30 backdrop-blur-md z-10">
                  <tr className="border-b border-border/50">
                    <th className="px-4 py-4 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Due</th>
                    <th className="px-4 py-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Month</th>
                    <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Payment</th>
                    <th className="px-4 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Rem. Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                        Enter Original Loan Amount, Interest Rate, and Amortization to generate the schedule.
                      </td>
                    </tr>
                  ) : (
                    schedule.map((row, idx) => {
                      // Detect today's row
                      const rowKey = (() => {
                        const d = parseScheduleDate(row.due);
                        return d ? `${d.getFullYear()}-${d.getMonth()}` : '';
                      })();
                      const isCurrentMonth = rowKey === todayKey;

                      return (
                        <tr
                          key={idx}
                          className={`border-b border-border/50 hover:bg-muted/30 transition-colors group ${
                            row.isBalloon
                              ? 'bg-orange-500/10 font-bold'
                              : isCurrentMonth
                              ? 'bg-primary/10'
                              : idx % 2 !== 0
                              ? 'bg-muted/10'
                              : ''
                          }`}
                        >
                          {/* Due date */}
                          <td className="px-4 py-4 whitespace-nowrap text-foreground/90 font-medium">
                            {row.due}
                            {row.isBalloon && (
                              <span className="ml-1.5 text-[10px] font-bold text-orange-500">
                                BALLOON
                              </span>
                            )}
                          </td>

                          {/* Month */}
                          <td className="px-4 py-4 text-center whitespace-nowrap text-foreground/80">
                            {row.month}
                          </td>

                          {/* Payment */}
                          <td className="px-4 py-4 text-right whitespace-nowrap text-foreground font-medium">
                            {row.payment > 0 ? `$${money(row.payment)}` : ''}
                          </td>

                          {/* Remaining balance */}
                          <td className="px-4 py-4 text-right whitespace-nowrap font-bold tracking-tight text-foreground">
                            ${money(row.balance)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-12">
          {loans.length === 0
            ? 'No loans yet. Click "+ Add Loan" to create one.'
            : 'Select a loan above to view its amortization schedule.'}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format Date → "1 Jan 2026" */
function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format YYYY-MM-DD → "M/D/YYYY" for compact display */
function fmtDisplayDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Format a number as ordinal: 1→"1st", 2→"2nd", 15→"15th", etc. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]} of the month`;
}

/** Parse "d Mon YYYY" back to a Date (for today-row comparison) */
function parseScheduleDate(s: string): Date | null {
  const monthIdx: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const parts = s.split(' ');
  if (parts.length !== 3) return null;
  const day   = parseInt(parts[0], 10);
  const month = monthIdx[parts[1]];
  const year  = parseInt(parts[2], 10);
  if (isNaN(day) || month === undefined || isNaN(year)) return null;
  return new Date(year, month, day);
}
