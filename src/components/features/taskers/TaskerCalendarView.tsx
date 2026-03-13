'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tasker } from '@/lib/types/tasker';

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  'In Progress': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  Complete: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  Archived: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

const PRIORITY_LABELS: Record<number, string> = {
  0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent', 5: 'Critical',
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

interface TaskerCalendarViewProps {
  calendarDate: { year: number; month: number };
  setCalendarDate: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  filteredTaskers: Tasker[];
  onOpenLog: (tasker: Tasker) => void;
}

export function TaskerCalendarView({ calendarDate, setCalendarDate, filteredTaskers, onOpenLog }: TaskerCalendarViewProps) {
  const { year, month } = calendarDate;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const cells: { dateStr: string; day: number; inMonth: boolean }[] = [];
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    cells.push({ dateStr: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: true });
  }
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const m = month === 11 ? 1 : month + 2;
    const y = month === 11 ? year + 1 : year;
    cells.push({ dateStr: `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d, inMonth: false });
  }

  const taskersForDate = (dateStr: string) => filteredTaskers.filter(t => t.due_date === dateStr);

  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-border/50 shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-background/50 backdrop-blur-sm">
        <button
          onClick={() => setCalendarDate(d => d.month === 0 ? { year: d.year - 1, month: 11 } : { year: d.year, month: d.month - 1 })}
          className="p-2 rounded-xl hover:bg-muted transition-all active:scale-95 border border-border/50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-4">
          <span className="font-bold text-lg tracking-tight">{MONTH_NAMES[month]} {year}</span>
          <button
            onClick={() => { const n = new Date(); setCalendarDate({ year: n.getFullYear(), month: n.getMonth() }); }}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 bg-muted/50 border border-border/50 rounded-lg hover:bg-muted transition-all"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => setCalendarDate(d => d.month === 11 ? { year: d.year + 1, month: 0 } : { year: d.year, month: d.month + 1 })}
          className="p-2 rounded-xl hover:bg-muted transition-all active:scale-95 border border-border/50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-border/50 bg-muted/30">
        {DAY_NAMES.map(d => (
          <div key={d} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-r border-border/50 last:border-r-0">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          const dayTaskers = taskersForDate(cell.dateStr);
          const isToday = cell.dateStr === todayStr;
          return (
            <div
              key={idx}
              className={`min-h-[120px] p-2 border-r border-b border-border/50 last:border-r-0 transition-colors group hover:bg-muted/20 ${!cell.inMonth ? 'bg-muted/10 opacity-60' : 'bg-transparent'}`}
            >
              <div className={`text-xs font-bold mb-2 w-7 h-7 flex items-center justify-center rounded-xl transition-all ${
                isToday
                  ? 'bg-primary text-primary-foreground shadow-md scale-110'
                  : cell.inMonth
                    ? 'text-foreground group-hover:bg-muted/50'
                    : 'text-muted-foreground/30'
              }`}>
                {cell.day}
              </div>
              <div className="flex flex-col gap-1">
                {dayTaskers.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onOpenLog(t)}
                    title={`${t.task_name}${t.responsible_name ? ` — ${t.responsible_name}` : ''}`}
                    className={`w-full text-left px-2 py-1 rounded-lg text-[9px] font-bold truncate leading-tight transition-all border border-transparent hover:border-border/50 shadow-sm ${STATUS_COLORS[t.status]} hover:opacity-90 active:scale-[0.98]`}
                  >
                    {t.priority > 0 && <span className="opacity-70 mr-1">[{PRIORITY_LABELS[t.priority]}]</span>}
                    {t.task_name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 px-6 py-4 border-t border-border/50 bg-muted/30">
        {Object.entries(STATUS_COLORS).map(([status, cls]) => (
          <span key={status} className={`inline-flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-border/50 shadow-sm ${cls}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
            {status}
          </span>
        ))}
      </div>
    </div>
  );
}
