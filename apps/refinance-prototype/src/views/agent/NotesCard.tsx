// NotesCard — refi-local agent notes, wired to the REAL blinker backend
// (/api/v3/admin/notes via blinkerWrite). Distinct from the shared
// blinker-platform NotesPanel, which only persists to localStorage through
// the platform SDK and therefore can't round-trip to MissionControl.
//
// Notes attach to the handed-off ProductPackage (see blinkerWrite.notes*),
// authored by the agent (backend stamps current_user from the access_token).
// MissionControl reads the same notes on the package detail page (/refiapp),
// so a note added here shows up there.
//
// Standalone refi (no package_id / token in the URL) has no backend target,
// so the card renders a disabled hint instead of a broken add box.
import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { StickyNote, Send, User as UserIcon } from 'lucide-react';
import type { NoteEntry } from '../../lib/blinkerWrite';

interface NotesCardProps {
  enabled: boolean;
  onLoad: () => Promise<NoteEntry[]>;
  onCreate: (body: string) => Promise<NoteEntry | null>;
}

// Relative-time formatter — matches the shared NotesPanel's _relTime so the
// two surfaces read the same.
function relTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export const NotesCard: FC<NotesCardProps> = ({ enabled, onLoad, onCreate }) => {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setNotes(await onLoad());
    } catch {
      setError('Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [enabled, onLoad]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleSubmit(): Promise<void> {
    const body = draft.trim();
    if (!body || submitting || !enabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await onCreate(body);
      if (created) {
        setNotes((prev) => [created, ...prev]);
        setDraft('');
      } else {
        setError('Failed to add note');
      }
    } catch {
      setError('Failed to add note');
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Cmd/Ctrl-Enter submits; plain Enter inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-amber-500" />
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          Package notes
        </span>
      </div>
      <div className="p-3 space-y-3">
        {!enabled ? (
          <div className="text-[11px] text-slate-400 px-2 py-3">
            Notes save to this package once launched from MissionControl
            (no package linked in this session).
          </div>
        ) : (
          <>
            <div>
              {loading ? (
                <div className="text-[11px] text-slate-400 px-2 py-3">Loading notes…</div>
              ) : notes.length === 0 ? (
                <div className="text-[11px] text-slate-400 px-2 py-3">
                  No notes yet. Add the first one below.
                </div>
              ) : (
                <ul className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
                  {notes.map((n) => (
                    <li
                      key={n.id}
                      className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 mb-1">
                        <span className="flex items-center gap-1">
                          <UserIcon className="w-3 h-3" />
                          <span className="font-mono">{n.author_id || 'agent'}</span>
                        </span>
                        <span title={n.created_at}>{relTime(n.created_at)}</span>
                      </div>
                      <div className="text-xs text-slate-700 whitespace-pre-wrap">
                        {n.body}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Add a note…"
                className="w-full min-h-[64px] border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-500 resize-y"
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400">⌘/Ctrl + Enter to submit</span>
                <button
                  onClick={handleSubmit}
                  disabled={!draft.trim() || submitting}
                  className={
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold ' +
                    (!draft.trim() || submitting
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white')
                  }
                >
                  <Send className="w-3 h-3" />
                  {submitting ? 'Saving…' : 'Add note'}
                </button>
              </div>
              {error && <div className="text-[11px] text-rose-500">{error}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NotesCard;
