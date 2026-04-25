import React, { useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { DiffViewer } from '@renderer/components/chat/viewers/DiffViewer';
import { useStore } from '@renderer/store';
import { isDemoTeamName } from '@renderer/utils/demoTeamFixture';

import type { FileChangeWithContent } from '@shared/types/review';

import { LiquidGlass } from '../LiquidGlass';

interface Props {
  open: boolean;
  teamName: string;
  taskId: string;
  filePath: string;
  onClose: () => void;
}

const DEMO_DIFF_BEFORE = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.qty;
  }
  return total;
}
`;
const DEMO_DIFF_AFTER = `function calculateTotal(items, opts = {}) {
  const taxRate = opts.taxRate ?? 0;
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.price * item.qty;
  }
  const tax = subtotal * taxRate;
  return { subtotal, tax, total: subtotal + tax };
}
`;

export const AuroraReviewDiffDialog = ({
  open,
  teamName,
  taskId,
  filePath,
  onClose,
}: Props): React.JSX.Element | null => {
  const updateKanban = useStore((s) => s.updateKanban);

  const [content, setContent] = useState<FileChangeWithContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isDemo = isDemoTeamName(teamName);

  useEffect(() => {
    if (!open) return;
    if (isDemo) {
      setContent(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    void (async () => {
      try {
        const data = await api.review.getFileContent(teamName, undefined, filePath, []);
        if (!cancelled) setContent(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load file diff');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isDemo, teamName, filePath]);

  if (!open) return null;

  const before = isDemo ? DEMO_DIFF_BEFORE : (content?.originalFullContent ?? '');
  const after = isDemo ? DEMO_DIFF_AFTER : (content?.modifiedFullContent ?? '');

  const handleApprove = async (): Promise<void> => {
    setSubmitting(true);
    try {
      await updateKanban(teamName, taskId, { op: 'set_column', column: 'approved' });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestChanges = async (): Promise<void> => {
    const comment = window.prompt('What changes are needed?', '');
    if (comment === null) return;
    setSubmitting(true);
    try {
      await updateKanban(teamName, taskId, { op: 'request_changes', comment: comment.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request changes failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(20, 19, 26, 0.32)', backdropFilter: 'blur(8px)' }}
        aria-hidden="true"
      />
      <LiquidGlass
        radius={20}
        shadow="lifted"
        className="relative w-full max-w-[920px] overflow-hidden"
      >
        <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--glass-shade)] px-5 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-3)]">
                Review · {taskId}
              </p>
              <p className="truncate text-[13px] font-medium text-[color:var(--ink-1)]">
                {filePath}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--ink-3)] transition-colors hover:bg-white/10 hover:text-[color:var(--ink-1)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2 2l8 8M10 2l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="min-h-[200px] flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <p className="text-center text-[13px] text-[color:var(--ink-3)]">Loading diff…</p>
            ) : error ? (
              <p className="text-center text-[13px] text-red-400">{error}</p>
            ) : (
              <>
                {isDemo ? (
                  <p className="mb-3 text-[12px] text-[color:var(--ink-3)]">
                    Demo team — synthetic diff for stage walkthrough.
                  </p>
                ) : null}
                <DiffViewer
                  fileName={filePath}
                  oldString={before}
                  newString={after}
                  syntaxHighlight
                />
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[color:var(--glass-shade)] px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-full border border-[color:var(--glass-shade)] bg-white/40 px-4 text-[12px] font-medium text-[color:var(--ink-1)] transition-colors hover:bg-white/60 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRequestChanges}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-4 text-[12px] font-medium text-amber-500 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-full px-4 text-[12px] font-medium text-white transition-transform duration-300 hover:-translate-y-px disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, var(--a-violet) 0%, var(--a-cyan) 100%)',
                boxShadow: '0 8px 22px -10px rgba(124, 92, 255, 0.5)',
              }}
            >
              Approve
            </button>
          </div>
        </div>
      </LiquidGlass>
    </div>
  );
};
