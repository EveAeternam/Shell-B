/** Asset libraries (server/assets.py): types and API calls for the Assets page and the Studio/Code asset picker. */
import { encPath, req } from './api';

export type AssetKind = 'image' | 'audio' | 'video' | 'model' | 'font' | 'data' | 'archive' | 'other';

export interface AssetLib {
  id: string;
  name: string;
  description: string;
  tags: string[];
  license: string;
  locked: boolean;
  forkedFrom: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  count: number;
  bytes: number;
  categories: Record<string, number>;
  covers: string[];
}

export interface Asset {
  id: string;
  libId: string;
  libName?: string;
  path: string;
  kind: AssetKind;
  mime: string;
  size: number;
  sha: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  title: string;
  description: string;
  category: string;
  tags: string[];
  license: string;
  author: string;
  sourceUrl: string;
  meta: Record<string, unknown>;
  addedBy: string;
  jobId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped';
export type LicensePolicy = 'cc0' | 'open' | 'any';

export interface AssetJob {
  id: string;
  libId: string;
  libName: string;
  agentId: string;
  brief: string;
  sources: string[];
  maxAssets: number;
  license: LicensePolicy;
  status: JobStatus;
  convId: string | null;
  result: string;
  error: string;
  added: number;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AssetLibDetail extends Omit<AssetLib, 'count' | 'bytes' | 'categories' | 'covers'> {
  assets: Asset[];
  tagCounts: Record<string, number>;
  forkedFromName: string | null;
  forks: { id: string; name: string }[];
  jobs: AssetJob[];
  mount: string;
}

export interface AssetPatch {
  title?: string; description?: string; category?: string; license?: string; author?: string; sourceUrl?: string;
  tags?: string[]; addTags?: string[]; removeTags?: string[]; meta?: Record<string, unknown>; path?: string;
}

export interface UploadOptions { folder?: string; tags?: string; category?: string; license?: string; author?: string; source_url?: string; unzip?: boolean }

const json = (body: unknown) => JSON.stringify(body);

export const CATEGORIES = ['picture', 'texture', 'sprite', 'tileset', 'icon', 'ui', 'background', 'sound', 'music', 'ambience', 'voice',
  'model', 'font', 'vector', 'video', 'data', 'other'];
export const LICENSES = ['CC0', 'CC-BY 4.0', 'CC-BY 3.0', 'CC-BY-SA 4.0', 'CC-BY-SA 3.0', 'OGA-BY', 'GPL', 'MIT', 'Public domain',
  'Royalty-free', 'Generated', 'Proprietary', 'Unknown'];

export const assetFileUrl = (a: Pick<Asset, 'libId' | 'path'>, download = false) =>
  `/api/assets/file/${a.libId}/${encPath(a.path)}${download ? '?download=1' : ''}`;
export const assetThumbUrl = (a: Pick<Asset, 'id' | 'sha'>) => `/api/assets/thumb/${a.id}?v=${(a.sha || '').slice(0, 8)}`;
export const hasThumb = (a: Asset) => a.kind === 'image' || a.path.toLowerCase().endsWith('.glb');

export const assetsApi = {
  libs: () => req<AssetLib[]>('/api/assets/libs'),
  lib: (id: string) => req<AssetLibDetail>(`/api/assets/libs/${id}`),
  createLib: (b: { name: string; description?: string; tags?: string[]; license?: string }) =>
    req<AssetLib>('/api/assets/libs', { method: 'POST', body: json(b) }),
  patchLib: (id: string, b: Partial<Pick<AssetLib, 'name' | 'description' | 'tags' | 'license' | 'locked'>>) =>
    req<AssetLib>(`/api/assets/libs/${id}`, { method: 'PATCH', body: json(b) }),
  deleteLib: (id: string) => req(`/api/assets/libs/${id}`, { method: 'DELETE' }),
  forkLib: (id: string, name?: string, ids?: string[]) => req<AssetLib>(`/api/assets/libs/${id}/fork`, { method: 'POST', body: json({ name, ids }) }),
  upload: (id: string, files: File[], o: UploadOptions = {}) => {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    Object.entries(o).forEach(([k, v]) => v !== undefined && v !== '' && fd.append(k, String(v)));
    return req<{ added: Asset[]; duplicates: number; errors: string[] }>(`/api/assets/libs/${id}/upload`, { method: 'POST', body: fd });
  },
  bulk: (id: string, ids: string[], b: { patch?: AssetPatch; delete?: boolean; copyTo?: string }) =>
    req<{ updated?: Asset[]; deleted?: number; copied?: number }>(`/api/assets/libs/${id}/bulk`, { method: 'POST', body: json({ ids, ...b }) }),
  patch: (aid: string, b: AssetPatch) => req<Asset>(`/api/assets/items/${aid}`, { method: 'PATCH', body: json(b) }),
  replace: (aid: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<Asset>(`/api/assets/items/${aid}/replace`, { method: 'POST', body: fd });
  },
  remove: (aid: string) => req(`/api/assets/items/${aid}`, { method: 'DELETE' }),
  search: (q: string, o: { tags?: string[]; category?: string; kind?: string; limit?: number } = {}) =>
    req<{ total: number; assets: Asset[] }>(`/api/assets/search?${new URLSearchParams({
      q, tags: (o.tags ?? []).join(','), category: o.category ?? '', kind: o.kind ?? '', limit: String(o.limit ?? 300),
    })}`),
  toProject: (id: string, projectId: string, ids: string[], dir = 'assets', flatten = false) =>
    req<{ saved: string[]; commit: string | null }>(`/api/assets/libs/${id}/to-project`, { method: 'POST', body: json({ projectId, ids, dir, flatten }) }),
  zipUrl: (id: string, ids?: string[]) => `/api/assets/libs/${id}/zip${ids?.length ? `?ids=${ids.join(',')}` : ''}`,
  jobs: (lib?: string) => req<AssetJob[]>(`/api/assets/jobs${lib ? `?lib=${lib}` : ''}`),
  createJob: (b: { libId?: string; libName?: string; brief: string; sources: string[]; agentId?: string; maxAssets?: number; license?: LicensePolicy }) =>
    req<AssetJob>('/api/assets/jobs', { method: 'POST', body: json(b) }),
  stopJob: (id: string) => req<AssetJob>(`/api/assets/jobs/${id}/stop`, { method: 'POST' }),
  retryJob: (id: string) => req<AssetJob>(`/api/assets/jobs/${id}/retry`, { method: 'POST' }),
  deleteJob: (id: string) => req(`/api/assets/jobs/${id}`, { method: 'DELETE' }),
};
