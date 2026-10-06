import { req } from './api';

/** Composer shortcuts (server/composer.py): saved #variables, saved /prompts, skills and tool commands. */
export interface ComposerVariable { name: string; value: string; description: string; updatedAt?: number }
export interface ComposerPrompt { name: string; title: string; content: string; description: string; updatedAt?: number }
export interface ComposerCatalog {
  variables: ComposerVariable[];
  prompts: ComposerPrompt[];
  skills: { name: string; description: string }[];
  toolCommands: { name: string; tool: string; description: string }[];
}
/** Something a # can reference: a library entry (see server/library.py entries()). `here` = an artifact of this chat. */
export interface ComposerRef { ref: string; kind: string; sub: string; title: string; about: string; updated: number; here: boolean }

const json = (b: unknown) => JSON.stringify(b);
let cached: Promise<ComposerCatalog> | null = null;

export const composerApi = {
  /** Cached for the page's life; call refresh() after editing shortcuts. */
  catalog: () => (cached ??= req<ComposerCatalog>('/api/composer').catch(e => { cached = null; throw e; })),
  refresh: () => { cached = null; return composerApi.catalog(); },
  /** The user's likely next message after the last reply ("" when there's none); see server/composer.py suggest(). */
  suggest: (conv: string) => req<{ suggestion: string }>(`/api/composer/suggest?${new URLSearchParams({ conv })}`),
  refs: (q: string, conv?: string) => req<ComposerRef[]>(`/api/composer/refs?${new URLSearchParams({ q, conv: conv ?? '' })}`),
  saveVariable: (v: ComposerVariable & { oldName?: string }) => req<ComposerVariable>('/api/composer/variables', { method: 'PUT', body: json(v) }),
  deleteVariable: (name: string) => req(`/api/composer/variables/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  savePrompt: (p: ComposerPrompt & { oldName?: string }) => req<ComposerPrompt>('/api/composer/prompts', { method: 'PUT', body: json(p) }),
  deletePrompt: (name: string) => req(`/api/composer/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};
