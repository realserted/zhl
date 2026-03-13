'use client';

import { CalendarEvent, OutOfOffice } from '@/lib/types/calendar-event';
import { formatTime12, formatDateShort, getGoogleCalendarUrl } from '@/lib/calendar-utils';
import { Plus, X, MapPin, Clock, Video, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/shared/Button';

interface DayDetailModalProps {
  selectedDay: string | null;
  onClose: () => void;
  events: CalendarEvent[];
  oooEntries: OutOfOffice[];
  canEdit: boolean;
  userId?: string;
  projectUsers: { user_id: string; user_name: string }[];
  oooMap: Map<string, OutOfOffice>;
  onSchedule: (day: number) => void;
  onEditEvent: (ev: CalendarEvent) => void;
  onRemoveOoo: (id: string) => Promise<boolean>;
  onToggleOoo: (userId: string, userName: string, date: string) => void;
}

export function DayDetailModal({
  selectedDay,
  onClose,
  events,
  oooEntries,
  canEdit,
  userId,
  projectUsers,
  oooMap,
  onSchedule,
  onEditEvent,
  onRemoveOoo,
  onToggleOoo,
}: DayDetailModalProps) {
  if (!selectedDay) return null;

  const dayEvents = events.filter((e) => e.event_date === selectedDay);
  const dayOoo = oooEntries.filter((e) => e.ooo_date === selectedDay);
  const availableForOoo = projectUsers
    .filter((pu) => !oooMap.get(`${pu.user_id}-${selectedDay}`))
    .filter((pu) => canEdit || pu.user_id === userId);

  return (
    <Modal isOpen onClose={onClose} title={formatDateShort(selectedDay)} maxWidth="sm">
      <div className="space-y-4">
        {/* Meetings */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Meetings</p>
          {dayEvents.length > 0 ? dayEvents.map((ev) => (
            <div key={ev.id} className="px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 space-y-1">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold">{ev.title}</span>
                  {ev.event_time && (
                    <span className="text-xs text-muted-foreground ml-2">
                      <Clock className="h-3 w-3 inline -mt-0.5 mr-0.5" />
                      {formatTime12(ev.event_time)}
                      <span className="ml-1 opacity-60">({ev.duration || 30}m)</span>
                    </span>
                  )}
                  {ev.location && (
                    <span className="text-xs text-muted-foreground ml-2">
                      <MapPin className="h-3 w-3 inline -mt-0.5 mr-0.5" />{ev.location}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                  <a
                    href={getGoogleCalendarUrl({ title: ev.title, date: ev.event_date, time: ev.event_time, duration: ev.duration, location: ev.location })}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    title="Add to Google Calendar"
                  >
                    GCal
                  </a>
                  {canEdit && (
                    <button onClick={() => { onClose(); onEditEvent(ev); }} className="text-[10px] font-bold text-primary hover:underline">
                      Edit
                    </button>
                  )}
                </div>
              </div>
              {ev.meet_link && (
                <a
                  href={ev.meet_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  <Video className="h-3 w-3" />Join Meeting<ExternalLink className="h-2.5 w-2.5 opacity-50" />
                </a>
              )}
            </div>
          )) : (
            <p className="text-xs text-muted-foreground px-1">No meetings</p>
          )}
          {canEdit && (
            <button
              onClick={() => { onClose(); onSchedule(parseInt(selectedDay.split('-')[2])); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-primary/5 transition-colors text-left border border-dashed border-primary/20"
            >
              <Plus className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">Schedule Meeting</span>
            </button>
          )}
        </div>

        {/* Out of Office */}
        <div className="space-y-2 pt-3 border-t border-border/50">
          <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">Out of Office</p>
          {dayOoo.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-yellow-400/10 border border-yellow-400/20">
              <div>
                <span className="text-sm font-semibold">{entry.user_name}</span>
                <span className="text-xs text-muted-foreground ml-2">{entry.note}</span>
              </div>
              {(canEdit || entry.user_id === userId) && (
                <button
                  onClick={async () => { await onRemoveOoo(entry.id); }}
                  className="p-1 hover:bg-destructive/10 rounded-lg transition-colors"
                  title="Remove"
                >
                  <X className="h-4 w-4 text-destructive" />
                </button>
              )}
            </div>
          ))}
          {availableForOoo.length > 0 && (
            <div className="space-y-1 mt-1">
              <p className="text-[10px] text-muted-foreground px-1">Mark as out:</p>
              {availableForOoo.map((pu) => (
                <button
                  key={pu.user_id}
                  onClick={() => onToggleOoo(pu.user_id, pu.user_name, selectedDay)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-yellow-400/10 transition-colors text-left"
                >
                  <Plus className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                  <span className="text-xs font-medium">{pu.user_name}{pu.user_id === userId ? ' (You)' : ''}</span>
                </button>
              ))}
            </div>
          )}
          {dayOoo.length === 0 && availableForOoo.length === 0 && (
            <p className="text-xs text-muted-foreground px-1">No one is out</p>
          )}
        </div>

        <div className="pt-3 border-t border-border/50">
          <Button variant="outline" onClick={onClose} className="w-full py-3 text-xs font-black tracking-widest">
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
