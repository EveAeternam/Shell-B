import { useState, useMemo } from 'react';
import clsx from 'clsx';
import {
  Boxes, Check, Code, Copy, Download, Eye, Maximize2, Minimize2, RotateCw, X,
} from 'lucide-react';
import type { ArtifactGroup } from '../types';
import { srcDoc, artifactScope } from '../components/ArtifactPanel';
import { Markdown } from '../components/Markdown';

interface Props {
  groups: ArtifactGroup[];
  activeId: string;
  version?: number;
  dark: boolean;
  convId?: string;
  onSelect: (id: string, version?: number) => void;
  onClose: () => void;
}

export function MobileArtifactSheet({
  groups,
  activeId,
  version,
  dark,
  convId,
  onSelect,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const group = groups.find(g => g.id === activeId) ?? groups[groups.length - 1];
  const versions = group?.versions ?? [];
  const current = (version ? versions.find(v => v.version === version) : versions[versions.length - 1]) ?? versions[0];

  const html = useMemo(() => {
    if (!current) return '';
    return srcDoc(
      current.type,
      current.content,
      dark,
      convId && group ? artifactScope(convId, group.id) : undefined,
      false,
      convId
    );
  }, [current, dark, convId, group]);

  if (!group || !current) return null;

  const canPreview = current.type === 'html' || current.type === 'svg' || current.type === 'mermaid' || current.type === 'markdown';

  const copy = () => {
    navigator.clipboard.writeText(current.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const ext = current.type === 'markdown' ? 'md' : current.type === 'mermaid' ? 'mmd' : current.type;
    const blob = new Blob([current.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm animate-fade-in',
        fullscreen ? 'p-0' : 'justify-end'
      )}
      onClick={onClose}
    >
      <div
        className={clsx(
          'bg-[var(--bg-primary)] border-t border-[var(--border-subtle)] flex flex-col overflow-hidden animate-slide-up',
          fullscreen
            ? 'w-full h-full rounded-none'
            : 'rounded-t-2xl max-h-[92vh] h-[85vh] pb-[env(safe-area-inset-bottom)]'
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="h-12 shrink-0 px-3 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Boxes className="w-4 h-4 text-[var(--accent)] shrink-0" />
            <span className="text-xs font-semibold truncate text-[var(--text-primary)]">
              {group.title}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--text-muted)] shrink-0">
              {current.type}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {versions.length > 1 && (
              <select
                aria-label="Artifact version"
                value={current.version}
                onChange={e => onSelect(group.id, Number(e.target.value))}
                className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--text-primary)] font-mono"
              >
                {versions.map(v => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            )}

            {canPreview && (
              <button
                onClick={() => setFrameKey(k => k + 1)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                title="Reload"
                aria-label="Reload preview"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              onClick={() => setFullscreen(f => !f)}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={copy}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Copy code"
              aria-label="Copy code"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={download}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Download"
              aria-label="Download artifact"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] ml-1"
              aria-label="Close artifact"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tab switch if previewable */}
        {canPreview && (
          <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 text-xs shrink-0">
            <button
              onClick={() => setTab('preview')}
              className={clsx(
                'flex items-center gap-1.5 py-2 px-3 border-b-2 font-medium transition -mb-px',
                tab === 'preview'
                  ? 'border-[var(--accent)] text-[var(--accent-soft)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              onClick={() => setTab('code')}
              className={clsx(
                'flex items-center gap-1.5 py-2 px-3 border-b-2 font-medium transition -mb-px',
                tab === 'code'
                  ? 'border-[var(--accent)] text-[var(--accent-soft)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              )}
            >
              <Code className="w-3.5 h-3.5" />
              Source
            </button>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 min-h-0 bg-[var(--bg-primary)] overflow-hidden relative">
          {tab === 'preview' && canPreview ? (
            current.type === 'markdown' ? (
              <div className="h-full overflow-y-auto p-4 prose-shellb">
                <Markdown text={current.content} />
              </div>
            ) : (
              <iframe
                key={frameKey}
                srcDoc={html}
                sandbox="allow-scripts allow-forms allow-modals"
                className="w-full h-full border-0 bg-transparent"
                title={group.title}
              />
            )
          ) : (
            <pre className="h-full overflow-auto p-3 text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-code)] whitespace-pre-wrap select-text">
              <code>{current.content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
