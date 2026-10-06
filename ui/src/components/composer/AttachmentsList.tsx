import { FileText, Loader2, X } from 'lucide-react';
import type { Attachment } from '../../types';
import { fmtBytes } from '../../api';
import { refIcon } from '../ComposerShortcuts';

interface AttachmentsListProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  canSee: boolean;
  agentName: string;
}

export function AttachmentsList({ attachments, onRemove, canSee, agentName }: AttachmentsListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-[var(--border-subtle)]">
      {attachments.map(a => (
        <div key={a.id} className="relative group/att">
          {a.kind === 'ref' ? (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-xs h-9" title={a.ref}>
              <span className="text-[var(--accent)]">{refIcon(a.refKind)}</span>
              <span className="font-medium max-w-[180px] truncate">{a.name}</span>
            </div>
          ) : a.kind === 'image' && (a.localPreview || a.url) ? (
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-[var(--border-subtle)] relative">
              <img src={a.localPreview || a.url} alt={a.name} className="w-full h-full object-cover" />
              {a.uploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-xs h-16">
              {a.uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-[var(--accent)]" />}
              <span className="flex flex-col">
                <span className="font-medium max-w-[140px] truncate">{a.name}</span>
                <span className="text-[10px] text-[var(--text-muted)]">{fmtBytes(a.size)}</span>
              </span>
            </div>
          )}
          <button
            onClick={() => onRemove(a.id)}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-strong)] flex items-center justify-center opacity-0 group-hover/att:opacity-100 transition"
            aria-label={`Remove ${a.name}`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      {attachments.some(a => a.kind === 'image') && !canSee && (
        <span className="self-center text-[10px] text-[var(--text-muted)]">
          {agentName}'s model is text-only; images go to the vision model.
        </span>
      )}
    </div>
  );
}
