// NotesPanel — reusable notes-and-tags right-pane card.
//
// Two modes:
//
//   1. Log mode (Wave 16 F2-fu13) — when `contactId` is passed:
//      The notes surface becomes an append-only activity-log shape.
//      Past notes (filtered by contactId, optionally also opportunityId)
//      are read from `blinkerApi.notes.list(...)` and rendered newest-
//      first. The add-note textarea + Submit button calls
//      `blinkerApi.addNote(...)` which dual-writes the note record AND
//      a paired `type: 'note'` activity per the canon contract
//      (architecture/12-notes-activities-pattern.md).
//
//   2. Legacy mode — when `notes` + `onNotesChange` are passed:
//      Single textarea bound to a parent-owned string. Existing
//      behavior, preserved for back-compat during migration of refi /
//      insurance / protection AgentViews from per-workflow string
//      slots to log mode.
//
// Tags work the same in both modes — parent-owned arrays + callbacks.
//
// Originally lifted from refi-portal/src/components/NotesPanel.jsx in
// Wave 15c. Wave 16 F2-fu13 added the log-mode branch.
//
// Canon dependencies (consumed indirectly via TagPicker):
//   - canon/personas.json   (parent reads to derive
//                            canAddTags / canCreateTags)
//   - canon/system-tags.json (TagPicker reads directly via
//                            ../../canon/system-tags.json)
import { useEffect, useMemo, useState } from 'react';
import { StickyNote, Send, User as UserIcon } from 'lucide-react';
import { TagPicker } from './TagPicker.jsx';
import { track } from '../telemetry/index.js';
import { blinkerApi } from '../api/index.js';

const DEFAULT_NOTES_PLACEHOLDER =
  'Quick notes on this contact — call back times, edge cases, anything to remember next session.';
const DEFAULT_HEADING = 'Agent notes';
const DEFAULT_PERSISTENCE_HINT =
  'Phase 1: notes live in this session only. Mission-control owns the persisted activity log.';
const DEFAULT_LOG_HINT =
  'Phase 1: notes persist locally per contact. Phase 2 reads through the platform API.';

// Relative-time formatter for log-mode timestamps. Recent entries get
// "5m ago" / "2h ago"; older fall back to the absolute date.
function _relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  // Older: render the date.
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

export function NotesPanel({
  // Log-mode props (Wave 16 F2-fu13). When `contactId` is set, the
  // panel switches to append-only log shape sourced from
  // blinkerApi.notes.{list,addNote}.
  contactId,
  opportunityId,
  authorId,                  // 'agent_session' fallback when undefined

  // Legacy props (single-textarea). Ignored in log mode.
  notes = '',
  onNotesChange,
  notesPlaceholder = DEFAULT_NOTES_PLACEHOLDER,

  // Tags (parent-owned). Hide the entire tags section by passing
  // showTags={false}.
  showTags = true,
  selectedTagIds = [],
  onTagAdd,
  onTagRemove,
  onTagCreate,
  canAddTags = false,
  canCreateTags = false,
  sessionCreatedTags = [],
  orgId,

  // Both modes.
  persona = 'agent',
  trackingPrefix = 'agent',
  headingLabel = DEFAULT_HEADING,
  sessionPersistenceHint,
}) {
  const isLogMode = !!contactId;

  if (isLogMode) {
    return (
      <NotesPanelLog
        contactId={contactId}
        opportunityId={opportunityId}
        authorId={authorId}
        showTags={showTags}
        selectedTagIds={selectedTagIds}
        onTagAdd={onTagAdd}
        onTagRemove={onTagRemove}
        onTagCreate={onTagCreate}
        canAddTags={canAddTags}
        canCreateTags={canCreateTags}
        sessionCreatedTags={sessionCreatedTags}
        orgId={orgId}
        persona={persona}
        trackingPrefix={trackingPrefix}
        headingLabel={headingLabel}
        sessionPersistenceHint={sessionPersistenceHint || DEFAULT_LOG_HINT}
      />
    );
  }

  return (
    <NotesPanelLegacy
      notes={notes}
      onNotesChange={onNotesChange}
      notesPlaceholder={notesPlaceholder}
      showTags={showTags}
      selectedTagIds={selectedTagIds}
      onTagAdd={onTagAdd}
      onTagRemove={onTagRemove}
      onTagCreate={onTagCreate}
      canAddTags={canAddTags}
      canCreateTags={canCreateTags}
      sessionCreatedTags={sessionCreatedTags}
      orgId={orgId}
      persona={persona}
      trackingPrefix={trackingPrefix}
      headingLabel={headingLabel}
      sessionPersistenceHint={sessionPersistenceHint || DEFAULT_PERSISTENCE_HINT}
      opportunityId={opportunityId}
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Log mode (Wave 16 F2-fu13)
// ────────────────────────────────────────────────────────────────────

function NotesPanelLog({
  contactId,
  opportunityId,
  authorId,
  showTags,
  selectedTagIds,
  onTagAdd,
  onTagRemove,
  onTagCreate,
  canAddTags,
  canCreateTags,
  sessionCreatedTags,
  orgId,
  persona,
  trackingPrefix,
  headingLabel,
  sessionPersistenceHint,
}) {
  // Local optimistic copy of the list so submit-then-render is instant
  // without re-reading localStorage. Initial value is read from the
  // SDK lazily on mount + whenever contactId/opportunityId changes.
  const [notesLog, setNotesLog] = useState(() =>
    blinkerApi.notes.list({ contact_id: contactId, opportunity_id: opportunityId }),
  );
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Re-read when the contact/opp scope changes (e.g., the agent flips
  // between opportunities in CoPilot without unmounting NotesPanel).
  useEffect(() => {
    setNotesLog(
      blinkerApi.notes.list({ contact_id: contactId, opportunity_id: opportunityId }),
    );
    setDraft('');
  }, [contactId, opportunityId]);

  const sortedLog = useMemo(
    () =>
      [...notesLog].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      ),
    [notesLog],
  );

  function handleSubmit() {
    const body = draft.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const { note } = blinkerApi.addNote({
        contact_id: contactId,
        opportunity_id: opportunityId || null,
        body,
        author_id: authorId || 'agent_session',
        author_persona: persona,
      });
      setNotesLog((prev) => [note, ...prev]);
      setDraft('');
      track(`${trackingPrefix}.note_added`, {
        contact_id: contactId,
        opportunity_id: opportunityId || null,
        body_length: body.length,
        persona,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e) {
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
          {headingLabel}
        </span>
      </div>
      <div className="p-3 space-y-3">
        {showTags && (
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5">
              Contact tags
            </div>
            <TagPicker
              selectedTagIds={selectedTagIds}
              onAdd={onTagAdd}
              onRemove={onTagRemove}
              onCreate={onTagCreate}
              canAdd={canAddTags}
              canCreate={canCreateTags}
              orgId={orgId}
              persona={persona}
              sessionCreated={sessionCreatedTags}
              trackingPrefix={`${trackingPrefix}.tag_picker`}
            />
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5">
            Notes
          </div>

          {/* Past-notes log */}
          {sortedLog.length === 0 ? (
            <div className="text-[11px] text-slate-400 px-2 py-3">
              No notes yet. Add the first one below.
            </div>
          ) : (
            <ul className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
              {sortedLog.map((n) => (
                <li
                  key={n.id}
                  className="bg-slate-50 border border-slate-200 rounded-md px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 mb-1">
                    <span className="flex items-center gap-1">
                      <UserIcon className="w-3 h-3" />
                      <span className="font-mono">{n.author_id || 'unknown'}</span>
                      {n.author_persona && (
                        <span className="text-slate-400">· {n.author_persona}</span>
                      )}
                    </span>
                    <span title={n.created_at}>{_relTime(n.created_at)}</span>
                  </div>
                  <div className="text-xs text-slate-700 whitespace-pre-wrap">
                    {n.body}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Add-note textarea + submit */}
          <div className="mt-2 space-y-1.5">
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
          </div>

          <div className="text-[11px] text-slate-400 mt-2">{sessionPersistenceHint}</div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Legacy single-textarea mode (preserved for back-compat during the
// per-workflow migration to log mode).
// ────────────────────────────────────────────────────────────────────

function NotesPanelLegacy({
  notes,
  onNotesChange,
  notesPlaceholder,
  showTags,
  selectedTagIds,
  onTagAdd,
  onTagRemove,
  onTagCreate,
  canAddTags,
  canCreateTags,
  sessionCreatedTags,
  orgId,
  persona,
  trackingPrefix,
  headingLabel,
  sessionPersistenceHint,
  opportunityId,
}) {
  const [persisted, setPersisted] = useState(notes);

  function handleBlur() {
    if (notes === persisted) return;
    setPersisted(notes);
    track(`${trackingPrefix}.notes.changed`, {
      opportunity_id: opportunityId,
      has_text: notes.trim().length > 0,
      text_length: notes.length,
    });
  }

  function handleChange(e) {
    onNotesChange?.(e.target.value);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <StickyNote className="w-4 h-4 text-amber-500" />
        <span className="text-xs uppercase tracking-wide font-semibold text-slate-600">
          {headingLabel}
        </span>
      </div>
      <div className="p-3 space-y-3">
        {showTags && (
          <div>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5">
              Contact tags
            </div>
            <TagPicker
              selectedTagIds={selectedTagIds}
              onAdd={onTagAdd}
              onRemove={onTagRemove}
              onCreate={onTagCreate}
              canAdd={canAddTags}
              canCreate={canCreateTags}
              orgId={orgId}
              persona={persona}
              sessionCreated={sessionCreatedTags}
              trackingPrefix={`${trackingPrefix}.tag_picker`}
            />
          </div>
        )}

        <div>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5">
            Notes
          </div>
          <textarea
            value={notes}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={notesPlaceholder}
            className="w-full min-h-[160px] border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-blue-500 resize-y"
          />
          <div className="text-[11px] text-slate-400 mt-1.5">
            {sessionPersistenceHint}
          </div>
        </div>
      </div>
    </div>
  );
}
