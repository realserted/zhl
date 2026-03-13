'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { Modal } from '@/components/shared/Modal';
import { Tasker, TaskerLog } from '@/lib/types/tasker';
import { getTaskerLogs, addTaskerLog } from '@/lib/db/taskers';

interface TaskerLogModalProps {
  tasker: Tasker | null;
  onClose: () => void;
  userId: string;
  displayName: string;
}

export function TaskerLogModal({ tasker, onClose, userId, displayName }: TaskerLogModalProps) {
  const [logs, setLogs] = useState<TaskerLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [hideSystemLogs, setHideSystemLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tasker) return;
    setLoadingLogs(true);
    getTaskerLogs(tasker.id).then((data) => {
      setLogs(data);
      setLoadingLogs(false);
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });
  }, [tasker]);

  const handleClose = () => {
    setLogs([]);
    setNewMessage('');
    onClose();
  };

  const handleSendMessage = async () => {
    if (!tasker || !newMessage.trim()) return;
    setSendingMessage(true);
    const log = await addTaskerLog({
      tasker_id: tasker.id,
      user_id: userId,
      user_name: displayName,
      type: 'comment',
      message: newMessage.trim(),
    });
    if (log) {
      setLogs((prev) => [...prev, log]);
      setNewMessage('');
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
    setSendingMessage(false);
  };

  const inputClass =
    'w-full px-3 py-2 bg-muted/50 border border-border/50 rounded-xl text-sm font-medium transition-all focus:ring-2 focus:ring-primary/20 outline-none placeholder:text-muted-foreground/50';

  return (
    <Modal
      isOpen={!!tasker}
      onClose={handleClose}
      title={`Log: ${tasker?.task_name}`}
      maxWidth="lg"
      noScroll
    >
      <div className="flex flex-col h-[60vh]">
        {/* Toggle: Hide system messages */}
        <div className="px-8 py-2 border-b border-border/50 bg-muted/20 flex items-center gap-2 shrink-0">
          <button
            onClick={() => setHideSystemLogs(!hideSystemLogs)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${hideSystemLogs ? 'bg-primary' : 'bg-border'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${hideSystemLogs ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
          </button>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hide system messages</span>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-muted/10 custom-scrollbar">
          {loadingLogs ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-accent" />
              <span className="text-sm font-bold uppercase tracking-widest">Loading Logs...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground opacity-50">
              <MessageCircle className="w-12 h-12 mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">No logs yet.</p>
              <p className="text-xs font-medium">Start the conversation below.</p>
            </div>
          ) : (
            logs
              .filter((log) => !hideSystemLogs || log.type !== 'change')
              .map((log) => (
              <div key={log.id} className="flex gap-4 items-start">
                <div className="w-24 shrink-0 pt-1.5 text-right border-r border-border/30 pr-4">
                  <div className="text-[10px] font-semibold text-muted-foreground/70">
                    {new Date(log.created_at).toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' })}
                  </div>
                  <div className="text-[10px] font-medium text-muted-foreground/50 mt-0.5">
                    {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
                  </div>
                </div>
                <div className={`flex-1 flex flex-col gap-1.5 ${
                  log.type === 'change'
                    ? 'items-center py-1'
                    : log.user_name === displayName
                      ? 'items-end'
                      : 'items-start'
                }`}>
                  {log.type === 'change' ? (
                    <div className="px-4 py-2 bg-muted/50 rounded-full border border-border/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                      {log.message}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                          {log.user_name}
                        </span>
                      </div>
                      <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm font-medium shadow-sm border ${
                        log.user_name === displayName
                          ? 'bg-accent text-accent-foreground rounded-tr-none border-accent/20'
                          : 'bg-background border-border/50 rounded-tl-none'
                      }`}>
                        {log.message}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>

        <div className="p-6 border-t border-border/50 bg-background/50 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              className={inputClass}
              placeholder="Type a message..."
            />
            <button
              onClick={handleSendMessage}
              disabled={sendingMessage || !newMessage.trim()}
              className="p-3 bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-50 transition-all active:scale-95 shadow-lg shadow-primary/20"
            >
              {sendingMessage ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
