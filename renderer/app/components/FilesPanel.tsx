'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  selectActiveSession,
  useSessionsStore,
} from '../../lib/stores/sessions-store';
import { cn } from '../../lib/utils';
import { basename } from '../../lib/path-helpers';

interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
}
interface FilePreview {
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
  size: number;
}

/**
 * Read-only file browser scoped to the active session's cwd.
 * Left: tree with collapsible folders + filter.  Right: text preview
 * of the selected file. Layout collapses to vertical when the panel
 * is narrow (parent decides — we just use flex-wrap-ish proportions).
 */
export function FilesPanel() {
  const cwd = useSessionsStore((s) => selectActiveSession(s)?.cwd ?? null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenByDir, setChildrenByDir] = useState<Record<string, FileEntry[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  const loadDir = useCallback(async (dir: string): Promise<void> => {
    const api = window.agentDashboard?.files;
    if (!api) return;
    setLoadingDirs((s) => new Set(s).add(dir));
    try {
      const list = await api.list(dir);
      setChildrenByDir((m) => ({ ...m, [dir]: list }));
    } catch (err) {
      setChildrenByDir((m) => ({ ...m, [dir]: [] }));
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingDirs((s) => {
        const next = new Set(s);
        next.delete(dir);
        return next;
      });
    }
  }, []);

  // Refresh root + clear state when active session's cwd changes.
  useEffect(() => {
    setExpanded(new Set());
    setChildrenByDir({});
    setSelected(null);
    setPreview(null);
    setPreviewError(null);
    if (!cwd) return;
    void loadDir(cwd);
    setExpanded(new Set([cwd]));
  }, [cwd, loadDir]);

  const toggleDir = useCallback(
    (path: string): void => {
      setExpanded((s) => {
        const next = new Set(s);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      if (!childrenByDir[path]) void loadDir(path);
    },
    [childrenByDir, loadDir],
  );

  const selectFile = useCallback(async (path: string): Promise<void> => {
    const api = window.agentDashboard?.files;
    if (!api) return;
    setSelected(path);
    setPreview(null);
    setPreviewError(null);
    try {
      const p = await api.preview(path);
      setPreview(p);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const q = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return null;
    // When filter is set, flatten loaded entries and filter by name match.
    const out: FileEntry[] = [];
    for (const list of Object.values(childrenByDir)) {
      for (const ent of list) {
        if (ent.name.toLowerCase().includes(q)) out.push(ent);
      }
    }
    return out;
  }, [q, childrenByDir]);

  if (!cwd) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted">
        Pick an active session — Files is scoped to its working directory.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {!treeCollapsed && (
        <div className="flex w-[40%] min-w-[180px] max-w-[320px] flex-col border-r border-edge/5">
          <div className="flex items-center gap-1 border-b border-edge/5 p-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files…"
              className="flex-1 rounded-md border border-edge/10 bg-sunken px-2 py-1 text-xs text-ink placeholder:text-subtle focus:border-accent/60 focus:outline-none"
            />
          </div>
        <div className="flex-1 overflow-y-auto p-1 font-mono text-xs">
          {visible ? (
            visible.length === 0 ? (
              <div className="px-2 py-1 text-muted">No matches.</div>
            ) : (
              visible.map((ent) => (
                <Row
                  key={ent.path}
                  entry={ent}
                  depth={0}
                  selected={selected === ent.path}
                  onPickFile={() => void selectFile(ent.path)}
                  onToggle={() => toggleDir(ent.path)}
                  expanded={false}
                  loading={false}
                />
              ))
            )
          ) : (
            <TreeNode
              dir={cwd}
              depth={0}
              isRoot
              expanded={expanded}
              childrenByDir={childrenByDir}
              loadingDirs={loadingDirs}
              selected={selected}
              onToggle={toggleDir}
              onPickFile={selectFile}
            />
          )}
        </div>
        </div>
      )}
      <div className="flex flex-1 flex-col min-w-0">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-muted">
            <div className="text-sm">Open a file</div>
            <div className="text-xs">Pick something from the tree on the left.</div>
          </div>
        ) : (
          <>
            <div className="flex h-7 shrink-0 items-center gap-2 border-b border-edge/5 bg-surface px-2 text-[10px] uppercase tracking-wider text-subtle">
              <button
                type="button"
                onClick={() => setTreeCollapsed((v) => !v)}
                className="rounded p-0.5 text-subtle hover:bg-canvas hover:text-ink"
                title={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
              >
                {treeCollapsed ? '▷' : '◁'}
              </button>
              <span className="truncate font-mono normal-case text-muted">{trimCwd(selected, cwd)}</span>
            </div>
            <div className="flex-1 overflow-auto bg-sunken p-3 font-mono text-[12px] leading-relaxed text-ink">
              {previewError ? (
                <div className="text-danger">{previewError}</div>
              ) : !preview ? (
                <div className="text-muted">Loading…</div>
              ) : preview.binary ? (
                <div className="text-muted">Binary file — preview skipped. ({preview.size.toLocaleString()} bytes)</div>
              ) : (
                <>
                  <pre className="whitespace-pre-wrap break-words">{preview.content}</pre>
                  {preview.truncated && (
                    <div className="mt-3 text-xs text-warning">
                      … truncated at {Math.floor(preview.content.length / 1024)} KB
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface TreeNodeProps {
  dir: string;
  depth: number;
  isRoot?: boolean;
  expanded: Set<string>;
  childrenByDir: Record<string, FileEntry[]>;
  loadingDirs: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onPickFile: (path: string) => void;
}

function TreeNode({
  dir,
  depth,
  isRoot,
  expanded,
  childrenByDir,
  loadingDirs,
  selected,
  onToggle,
  onPickFile,
}: TreeNodeProps) {
  const isExpanded = expanded.has(dir);
  const children = childrenByDir[dir];

  return (
    <>
      {!isRoot && (
        <Row
          entry={{ name: basename(dir), path: dir, kind: 'dir' }}
          depth={depth}
          expanded={isExpanded}
          loading={loadingDirs.has(dir)}
          selected={false}
          onToggle={() => onToggle(dir)}
          onPickFile={() => onToggle(dir)}
        />
      )}
      {isExpanded && children && children.map((ent) =>
        ent.kind === 'dir' ? (
          <TreeNode
            key={ent.path}
            dir={ent.path}
            depth={depth + (isRoot ? 0 : 1)}
            expanded={expanded}
            childrenByDir={childrenByDir}
            loadingDirs={loadingDirs}
            selected={selected}
            onToggle={onToggle}
            onPickFile={onPickFile}
          />
        ) : (
          <Row
            key={ent.path}
            entry={ent}
            depth={depth + (isRoot ? 0 : 1)}
            expanded={false}
            loading={false}
            selected={selected === ent.path}
            onToggle={() => onPickFile(ent.path)}
            onPickFile={() => onPickFile(ent.path)}
          />
        ),
      )}
    </>
  );
}

interface RowProps {
  entry: FileEntry;
  depth: number;
  expanded: boolean;
  loading: boolean;
  selected: boolean;
  onToggle: () => void;
  onPickFile: () => void;
}

function Row({ entry, depth, expanded, loading, selected, onToggle, onPickFile }: RowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-ink hover:bg-surface',
        selected && 'bg-surface ring-1 ring-accent/40',
      )}
      style={{ paddingLeft: 4 + depth * 12 }}
      title={entry.path}
    >
      <span className="inline-block w-3 text-subtle">
        {entry.kind === 'dir' ? (loading ? '⋯' : expanded ? '▾' : '▸') : ''}
      </span>
      <span className="text-[10px]">{entry.kind === 'dir' ? '📁' : iconFor(entry.name)}</span>
      <span className="truncate">{entry.name}</span>
      { }
      {/* Click on file should always pick file */}
      {entry.kind === 'file' && (
        <span
          className="hidden"
          onClick={(e) => {
            e.stopPropagation();
            onPickFile();
          }}
        />
      )}
    </button>
  );
}

function iconFor(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (['md', 'mdx'].includes(ext)) return '📝';
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return '⌨';
  if (['json'].includes(ext)) return '⚙';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼';
  if (['sh', 'zsh', 'bash'].includes(ext)) return '▦';
  return '·';
}

function trimCwd(path: string, cwd: string): string {
  if (path.startsWith(cwd + '/')) return path.slice(cwd.length + 1);
  return path;
}
