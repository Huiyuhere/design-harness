import { safeRepositoryPath } from './archive-policy';

export type SourceChange = { path: string; before: string | null; after: string };
export type PreviewDraft = { key: string; files: SourceChange[] };
export type PreviewDraftStore = {
  load(key: string): Promise<PreviewDraft | undefined>;
  save(draft: PreviewDraft): Promise<void>;
};

export function validateDraft(draft: PreviewDraft) {
  const paths = new Set<string>();
  if (!draft || typeof draft.key !== 'string' || !Array.isArray(draft.files) || draft.files.length > 1000) throw new Error('Invalid saved source draft.');
  for (const file of draft.files) {
    safeRepositoryPath(file.path);
    if (/^(?:\.github\/workflows\/|\.design-harness-runtime(?:\/|$))/i.test(file.path) || paths.has(file.path)) throw new Error('Unsafe or duplicate draft file.');
    if ((file.before !== null && typeof file.before !== 'string') || typeof file.after !== 'string') throw new Error('Invalid source change.');
    paths.add(file.path);
  }
  if (new TextEncoder().encode(JSON.stringify(draft)).byteLength > 10 * 1024 * 1024) throw new Error('This source draft exceeds 10 MiB. Export or publish before adding more edits.');
  return draft;
}

// Only approved source deltas, not dependencies or an extra repository tree.
// Browser-local durability; this is not a substitute for server/project backup.
export const browserPreviewDrafts: PreviewDraftStore = {
  async load(key) { return transact('readonly', store => store.get(key)); },
  async save(draft) { validateDraft(draft); await transact('readwrite', store => store.put(draft)); },
};

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const open = indexedDB.open('design-harness-source-drafts', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('drafts', { keyPath: 'key' });
    open.onsuccess = () => { if (blocked) open.result.close(); else resolve(open.result); };
    open.onerror = () => reject(new Error('Local draft storage is unavailable. No source was changed.'));
    open.onblocked = () => { blocked = true; reject(new Error('Close older Harness tabs to unlock draft storage.')); };
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', mode); const request = action(tx.objectStore('drafts'));
      // Request success alone is not proof the transaction was durably committed.
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Unable to save the local draft. Check browser storage space.'));
    });
  } finally { db.close(); }
}
