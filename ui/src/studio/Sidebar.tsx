import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import clsx from 'clsx';
import {
  Box, ChevronDown, ChevronRight, FileCode, FileImage, FilePlus, FileText, FileType, Folder, History, Home, Loader2, Pencil,
  RotateCcw, Trash2, Upload, Film, Music2, FileArchive, Shapes,
} from 'lucide-react';
import type { Commit, ProjectFile } from '../types';
import { api, fmtBytes, rawUrl } from '../api';
import { relTime } from '../components/common';
import { AssetPicker } from '../components/Assets';

type Node = { name: string; path: string; file?: ProjectFile; children: Node[] };

function buildTree(files: ProjectFile[]): Node[] {
  const root: Node = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let cur = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let next = cur.children.find(c => c.name === part);
      if (!next) { next = { name: part, path, children: [] }; cur.children.push(next); }
      if (i === parts.length - 1) next.file = f;
      cur = next;
    });
  }
  const sort = (n: Node) => {
    const pinned = (x: Node) => (x.name === 'DESIGN.md' || x.name === 'README.md' ? -1 : 0);
    n.children.sort((a, b) => (a.file ? 1 : 0) - (b.file ? 1 : 0) || pinned(a) - pinned(b) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function FileIcon({ f, projectId }: { f: ProjectFile; projectId: string }) {
  if (f.kind === 'image' || f.kind === 'svg') {
    return <img src={`${rawUrl(projectId, f.path)}?t=${Math.round(f.mtime)}`} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0 bg-[var(--bg-tertiary)]" loading="lazy" />;
  }
  const I = f.kind === 'html' ? FileCode : f.kind === 'font' ? FileType : f.kind === 'video' ? Film : f.kind === 'audio' ? Music2 : f.kind === 'model' ? Box
    : f.kind === 'binary' || f.kind === 'pdf' ? FileArchive : f.kind === 'markdown' || f.kind === 'text' ? FileText : FileImage;
  return <I className={clsx('w-4 h-4 shrink-0', f.kind === 'html' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')} />;
}

interface FilesProps {
  projectId: string;
  files: ProjectFile[];
  selected?: string;
  entry: string;
  onSelect: (path: string) => void;
  onChanged: () => void;
  code?: boolean;
}

export function FilesPanel({ projectId, files, selected, entry, onSelect, onChanged, code }: FilesProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setUploading(list.length);
    try {
      const r = await api.uploadAssets(projectId, list, code ? 'uploads' : 'assets');
      onChanged();
      if (r.saved.length === 1) onSelect(r.saved[0]);
    } finally { setUploading(0); }
  };

  const node = (n: Node, depth: number) => {
    const pad = { paddingLeft: 8 + depth * 12 };
    if (!n.file) {
      const isClosed = closed.has(n.path);
      return (
        <div key={n.path}>
          <button style={pad} onClick={() => setClosed(s => { const x = new Set(s); isClosed ? x.delete(n.path) : x.add(n.path); return x; })}
            className="w-full flex items-center gap-1.5 pr-2 py-1 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded-md">
            {isClosed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <Folder className="w-3.5 h-3.5 text-[var(--text-muted)]" />{n.name}
            <span className="ml-auto text-[10px] text-[var(--text-muted)]">{n.children.length}</span>
          </button>
          {!isClosed && n.children.map(c => node(c, depth + 1))}
        </div>
      );
    }
    const f = n.file;
    const active = selected === f.path;
    return (
      <div key={f.path} style={pad} onClick={() => renaming !== f.path && onSelect(f.path)} title={`${f.path} · ${fmtBytes(f.size)}`}
        className={clsx('group flex items-center gap-1.5 pr-1 py-1 rounded-md cursor-pointer text-[12.5px]',
          active ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]')}>
        <span className="w-3" />
        <FileIcon f={f} projectId={projectId} />
        {renaming === f.path ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onClick={e => e.stopPropagation()}
            onKeyDown={async e => {
              if (e.key === 'Escape') setRenaming(null);
              if (e.key === 'Enter' && draft.trim() && draft.trim() !== f.path) { await api.moveFile(projectId, f.path, draft.trim()); setRenaming(null); onChanged(); }
            }}
            onBlur={() => setRenaming(null)}
            className="flex-1 min-w-0 bg-[var(--bg-primary)] px-1 rounded border border-[var(--accent)] focus:outline-none font-mono text-[11.5px]" />
        ) : (
          <span className="flex-1 min-w-0 truncate">{n.name}</span>
        )}
        {!code && f.path === entry && <Home className="w-3 h-3 text-[var(--accent)] shrink-0" aria-label="Entry page" />}
        {renaming !== f.path && (
          <span className="hidden group-hover:flex items-center shrink-0" onClick={e => e.stopPropagation()}>
            {!code && f.kind === 'html' && f.path !== entry && (
              <button className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)]" title="Make this the entry page"
                onClick={async () => { await api.patchProject(projectId, { entry: f.path }); onChanged(); }}><Home className="w-3 h-3" /></button>
            )}
            <button className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Rename / move"
              onClick={() => { setRenaming(f.path); setDraft(f.path); }}><Pencil className="w-3 h-3" /></button>
            <button className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-400" title="Delete"
              onClick={async () => { if (confirm(`Delete ${f.path}? You can restore it from History.`)) { await api.deleteFile(projectId, f.path); onChanged(); } }}>
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={clsx('flex-1 min-h-0 flex flex-col', drag && 'ring-2 ring-inset ring-[var(--accent)]')}
      onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); upload(Array.from(e.dataTransfer.files)); }}>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <input ref={input} type="file" multiple className="hidden" onChange={e => { upload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <button onClick={() => input.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]">
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? `Uploading ${uploading}…` : code ? 'Upload files' : 'Upload assets'}
        </button>
        <button title="Add from an asset library" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          onClick={() => setPicking(true)}><Shapes className="w-4 h-4" /></button>
        <button title="New file" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          onClick={async () => {
            const name = prompt(code ? 'New file path (e.g. src/utils.py, tests/test_utils.py):' : 'New file path (e.g. about.html, css/styles.css):');
            if (name?.trim()) { await api.saveFile(projectId, name.trim(), ''); onChanged(); onSelect(name.trim()); }
          }}><FilePlus className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1 pb-2">
        {tree.map(n => node(n, 0))}
        <p className="px-3 pt-3 text-[10.5px] leading-relaxed text-[var(--text-muted)]">
          {code ? <>Drop data files, logs, specs or a .zip here. Uploads go to <span className="font-mono">uploads/</span> and the agent can read them.</>
            : <>Drop logos, photos, fonts, PDFs or a .zip here. Uploads go to <span className="font-mono">assets/</span> and the agent can see them.</>}
        </p>
      </div>
      {picking && <AssetPicker projectId={projectId} onClose={() => setPicking(false)}
        onAdded={saved => { setPicking(false); onChanged(); if (saved.length === 1) onSelect(saved[0]); }} />}
    </div>
  );
}

export function HistoryPanel({ projectId, version, onRestored }: { projectId: string; version: number; onRestored: () => void }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.history(projectId).then(setCommits).catch(() => setCommits([]));
  useEffect(() => { load(); }, [projectId, version]);
  useEffect(() => { if (open) api.diff(projectId, open).then(setDiff); else setDiff(''); }, [open, projectId]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
      {commits.map((c, i) => {
        const [who, ...rest] = c.message.includes(': ') ? c.message.split(': ') : ['', c.message];
        return (
          <div key={c.sha} className={clsx('rounded-lg border', open === c.sha ? 'border-[var(--border-strong)] bg-[var(--bg-tertiary)]' : 'border-transparent hover:bg-[var(--bg-tertiary)]')}>
            <button onClick={() => setOpen(open === c.sha ? null : c.sha)} className="w-full text-left px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="font-mono">{c.sha}</span>
                {who && <span className="px-1 rounded bg-[var(--bg-hover)] text-[var(--text-secondary)]">{who}</span>}
                {i === 0 && <span className="px-1 rounded bg-emerald-500/15 text-emerald-400">current</span>}
                <span className="ml-auto">{relTime(c.timestamp)}</span>
              </div>
              <div className="text-[12px] text-[var(--text-primary)] line-clamp-2 mt-0.5">{rest.join(': ') || c.message}</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{c.changes.length} file{c.changes.length === 1 ? '' : 's'}</div>
            </button>
            {open === c.sha && (
              <div className="px-2 pb-2 space-y-1.5">
                <div className="space-y-0.5">
                  {c.changes.slice(0, 20).map(ch => (
                    <div key={ch.path} className="flex items-center gap-1.5 text-[11px] font-mono">
                      <span className={clsx('w-3 text-center', ch.status === 'A' ? 'text-emerald-400' : ch.status === 'D' ? 'text-red-400' : 'text-sky-400')}>{ch.status}</span>
                      <span className="truncate text-[var(--text-secondary)]">{ch.path}</span>
                    </div>
                  ))}
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-[var(--bg-code)] border border-[var(--border-subtle)] p-2 text-[10.5px] leading-snug font-mono">
                  {diff.split('\n').slice(0, 600).map((l, k) => (
                    <div key={k} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-emerald-400' : l.startsWith('-') && !l.startsWith('---') ? 'text-red-400' : l.startsWith('@@') ? 'text-sky-400' : 'text-[var(--text-muted)]'}>{l || ' '}</div>
                  ))}
                </pre>
                {i > 0 && (
                  <button disabled={busy} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs bg-[var(--bg-hover)] hover:brightness-110 disabled:opacity-50"
                    onClick={async () => {
                      if (!confirm(`Restore the project to ${c.sha}? Your current state stays in history, so this is undoable.`)) return;
                      setBusy(true);
                      try { await api.restore(projectId, c.sha); onRestored(); setOpen(null); } finally { setBusy(false); }
                    }}>
                    <RotateCcw className="w-3.5 h-3.5" /> Restore this version
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {commits.length === 0 && <div className="text-xs text-[var(--text-muted)] text-center py-6 flex items-center justify-center gap-1.5"><History className="w-3.5 h-3.5" />No versions yet</div>}
    </div>
  );
}
