'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../../lib/auth-context';
import { supabase } from '../../../lib/supabase';
import { ProjectPermission } from '../../../lib/types/project';
import { FinancialLoan } from '../../../lib/types/financial';
import { getLoans, createLoan, updateLoan, deleteLoan } from '../../../lib/db/financial';
import { logUserAction } from '../../../lib/db/user-logs';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
  selectedProjectId: string;
  userPermission?: ProjectPermission | null;
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
    supabase.from('accounts').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { displayNameRef.current = data?.display_name || user.email || 'Unknown'; });
  }, [user]);

  useEffect(() => {
    getLoans(selectedProjectId).then((data) => {
      setLoans(data);
      if (data.length > 0) setSelectedLoanId(data[0].id);
    });
  }, [selectedProjectId]);

  const log = (action: string) => {
    if (!user) return;
    logUserAction({ projectId: selectedProjectId, userId: user.id, userName: displayNameRef.current, userEmail: userEmailRef.current, action });
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
      setSelectedLoanId(loans.length > 1 ? loans.find((l) => l.id !== selectedLoan.id)?.id ?? null : null);
      log(`Deleted loan "${selectedLoan.loan_name || 'Untitled'}"`);
    }
  };

  const saveField = async (field: string, rawValue: string) => {
    setEditingField(null);
    if (!selectedLoan) return;
    const current = (selectedLoan as unknown as Record<string, unknown>)[field];
    const numFields = ['amortization', 'interest_rate', 'original_amount', 'payment'];
    const val = numFields.includes(field) ? (parseFloat(rawValue) || null) : (rawValue || null);
    if (val === current) return;

    const ok = await updateLoan(selectedLoan.id, field, val);
    if (ok) {
      setLoans((prev) => prev.map((l) => (l.id === selectedLoan.id ? { ...l, [field]: val } : l)));
      log(`Updated loan ${field} to "${rawValue}"`);
    }
  };

  const toggleInterestOnly = async () => {
    if (!selectedLoan || !canEdit) return;
    const newVal = !selectedLoan.interest_only;
    const ok = await updateLoan(selectedLoan.id, 'interest_only', newVal);
    if (ok) {
      setLoans((prev) => prev.map((l) => (l.id === selectedLoan.id ? { ...l, interest_only: newVal } : l)));
      log(`Set loan to ${newVal ? 'interest only' : 'amortizing'}`);
    }
  };

  // Calculate amortization schedule
  const schedule = useMemo(() => {
    if (!selectedLoan?.original_amount || !selectedLoan?.payment) return [];
    const rows: { due: string; month: number; payment: number; balance: number }[] = [];
    const startDate = selectedLoan.balloon_date ? new Date(selectedLoan.balloon_date) : new Date();
    const monthlyRate = (selectedLoan.interest_rate ?? 0) / 100 / 12;
    const maxMonths = selectedLoan.amortization ?? 360;
    let balance = Number(selectedLoan.original_amount);
    const payment = Number(selectedLoan.payment);

    // Month 0 — starting balance
    rows.push({
      due: formatDate(startDate),
      month: 0,
      payment: 0,
      balance,
    });

    for (let i = 1; i <= maxMonths && balance > -payment * maxMonths; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);

      if (selectedLoan.interest_only) {
        const interestPayment = balance * monthlyRate;
        rows.push({ due: formatDate(d), month: i, payment, balance: balance });
      } else {
        const interest = balance * monthlyRate;
        const principal = payment - interest;
        balance -= principal;
        rows.push({ due: formatDate(d), month: i, payment, balance });
      }
    }
    return rows;
  }, [selectedLoan]);

  const loanFields: { field: string; label: string; type?: string }[] = [
    { field: 'loan_name', label: 'LOAN NAME' },
    { field: 'lender', label: 'Lender' },
    { field: 'due_on_the', label: 'Due on the' },
    { field: 'autopays_on_the', label: 'Autopays on the' },
    { field: 'amortization', label: 'Amortization', type: 'number' },
    { field: 'interest_rate', label: 'Interest', type: 'number' },
    { field: 'original_amount', label: 'Original Loan Amount', type: 'number' },
    { field: 'payment', label: 'Payment', type: 'number' },
    { field: 'balloon_date', label: 'Balloon', type: 'date' },
  ];

  return (
    <div>
      {/* Loan selector + Add */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {loans.map((loan) => (
          <button
            key={loan.id}
            onClick={() => setSelectedLoanId(loan.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg border transition-colors ${
              selectedLoanId === loan.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-foreground hover:bg-muted'
            }`}
          >
            {loan.loan_name || 'Untitled Loan'}
          </button>
        ))}
        {canEdit && (
          <button onClick={handleAddLoan} className="flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent/80">
            <Plus className="h-4 w-4" /> Add Loan
          </button>
        )}
      </div>

      {selectedLoan ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Loan details card */}
          <div className="border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">{selectedLoan.loan_name || 'Loan Details'}</h3>
              {canEdit && (
                <button onClick={handleDeleteLoan} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {loanFields.map(({ field, label, type }) => {
                  const rawVal = (selectedLoan as unknown as Record<string, unknown>)[field];
                  const displayVal = rawVal != null ? String(rawVal) : '';
                  const isEditing = editingField === field;

                  return (
                    <tr key={field} className="border-b border-border/30">
                      <td className="py-2 pr-4 font-semibold text-xs text-foreground w-[160px]">{label}</td>
                      <td className="py-2">
                        {isEditing ? (
                          <input
                            autoFocus
                            type={type ?? 'text'}
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
                            onClick={canEdit ? () => { setEditingField(field); setEditValue(displayVal); } : undefined}
                            className={`text-xs block min-h-[1.25rem] px-2 py-0.5 rounded ${canEdit ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                          >
                            {field === 'interest_rate' && displayVal ? `${displayVal}%` :
                             field === 'original_amount' && displayVal ? `$${Number(displayVal).toLocaleString()}` :
                             field === 'payment' && displayVal ? `$${Number(displayVal).toLocaleString()}` :
                             displayVal || <span className="text-muted-foreground/40">-</span>}
                          </span>
                        )}
                      </td>
                      {field === 'amortization' && (
                        <td className="py-2 pl-2">
                          <button
                            onClick={toggleInterestOnly}
                            className={`text-xs px-2 py-0.5 rounded border ${
                              selectedLoan.interest_only
                                ? 'border-accent text-accent bg-accent/10'
                                : 'border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            {selectedLoan.interest_only ? 'Interest only' : 'or Interest only'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Amortization table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 z-10">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold">Due</th>
                    <th className="px-3 py-2 text-center font-semibold">Month</th>
                    <th className="px-3 py-2 text-right font-semibold">Payment</th>
                    <th className="px-3 py-2 text-right font-semibold">Rem. Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground text-sm">
                        Fill in loan details to see amortization schedule.
                      </td>
                    </tr>
                  ) : (
                    schedule.map((row, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="px-3 py-1.5 text-foreground">{row.due}</td>
                        <td className="px-3 py-1.5 text-center text-foreground">{row.month}</td>
                        <td className="px-3 py-1.5 text-right text-foreground">
                          {row.payment > 0 ? `$${row.payment.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-medium ${row.balance < 0 ? 'text-red-400' : 'text-foreground'}`}>
                          {row.month === 0 ? '' : `${row.balance < 0 ? '-' : ''}$${Math.abs(row.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-8">
          {loans.length === 0 ? 'No loans yet. Click "+ Add Loan" to create one.' : 'Select a loan to view details.'}
        </div>
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
