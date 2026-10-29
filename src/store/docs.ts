import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Metadata lives in AsyncStorage; page images live in documentDirectory/scans/<docId>/<page>.jpg. */

export type PageMeta = {
  /** File name inside the document folder, e.g. "1.jpg". Numbers are never reused. */
  file: string;
  width: number;
  height: number;
  /** Small preview of this page (e.g. "1.thumb.jpg") for grids. Missing on old documents. */
  thumb?: string;
};

export type Doc = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Pages in reading order. */
  pages: PageMeta[];
  /** Small cover image (thumb.jpg) used by the library grid. */
  thumbFile?: string;
};

/** A page to store: JPEG as base64 (engine output) or an existing local image uri. */
export type PageInput = {
  width: number;
  height: number;
} & ({ base64: string; uri?: never } | { uri: string; base64?: never });

export type StoreResult<T> = { ok: true; value: T } | { ok: false; message: string };

const KEY = 'kitescan:docs:v1';
const THUMB_FILE = 'thumb.jpg';
const COVER_SIDE = 360;
const PAGE_THUMB_SIDE = 360;

const FRIENDLY = {
  read: 'Your library could not be loaded. Pull down to try again.',
  write: 'That could not be saved. Check that your phone has free storage and try again.',
  missing: 'That document no longer exists.',
  changed: 'The pages changed in the meantime. Please try again.',
} as const;

// ---------------------------------------------------------------- paths

function root(): string {
  const dir = FileSystem.documentDirectory;
  if (!dir) throw new Error('No document directory');
  return `${dir}scans/`;
}
const docDir = (id: string) => `${root()}${id}/`;

export function pageUri(docId: string, page: PageMeta): string {
  return `${docDir(docId)}${page.file}`;
}

/** Small preview of a page, falling back to the full image for documents saved before previews existed. */
export function pageThumbUri(docId: string, page: PageMeta): string {
  return `${docDir(docId)}${page.thumb ?? page.file}`;
}

/** Cover image for the grid: the small thumbnail when it exists, else the first page. */
export function coverUri(doc: Doc): string | null {
  if (doc.thumbFile) return `${docDir(doc.id)}${doc.thumbFile}`;
  const first = doc.pages[0];
  return first ? pageUri(doc.id, first) : null;
}

const thumbNameFor = (file: string) => `${file.replace(/\.jpg$/i, '')}.thumb.jpg`;

// ------------------------------------------------------- serialised writes

// Every read-modify-write goes through this queue so two quick actions cannot overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// ------------------------------------------------------------ raw storage

function isDoc(v: unknown): v is Doc {
  if (!v || typeof v !== 'object') return false;
  const d = v as Doc;
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    typeof d.createdAt === 'number' &&
    Array.isArray(d.pages)
  );
}

async function readAll(): Promise<Doc[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed.filter(isDoc).map((d) => ({ ...d, updatedAt: d.updatedAt ?? d.createdAt }));
  } catch {
    // Keep the unreadable blob instead of overwriting it with the next save.
    await AsyncStorage.setItem(`${KEY}:corrupt-${Date.now()}`, raw).catch(() => undefined);
    return [];
  }
}

async function writeAll(docs: Doc[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(docs));
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29 Oct, 7:41 PM" (or "29 Oct 2026, 7:41 PM"): fixed format, independent of the phone's locale. */
export function formatDocDate(ts: number, withYear = false): string {
  const d = new Date(ts);
  const hours = d.getHours() % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const year = withYear ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${hours}:${minutes} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

/** "Scan 29 Oct, 7:41 PM" */
export const defaultDocName = (ts: number): string => `Scan ${formatDocDate(ts)}`;

// ------------------------------------------------------------- file work

async function writePageFile(docId: string, file: string, input: PageInput): Promise<void> {
  const to = `${docDir(docId)}${file}`;
  if (input.base64 !== undefined) {
    await FileSystem.writeAsStringAsync(to, input.base64, { encoding: FileSystem.EncodingType.Base64 });
  } else {
    await FileSystem.copyAsync({ from: input.uri, to });
  }
}

/** Writes a downscaled copy of a stored page. Best effort: callers fall back to the full image. */
async function writeSmallCopy(docId: string, source: PageMeta, outFile: string, side: number): Promise<string | undefined> {
  try {
    // Decoded at thumbnail size from the start, so a long document never holds full-size bitmaps in memory.
    const ref = await ImageManipulator.manipulate(pageUri(docId, source), { maxWidth: side, maxHeight: side }).renderAsync();
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
    const to = `${docDir(docId)}${outFile}`;
    await FileSystem.deleteAsync(to, { idempotent: true });
    await FileSystem.copyAsync({ from: saved.uri, to });
    return outFile;
  } catch {
    return undefined;
  }
}

const writeCover = (docId: string, firstPage: PageMeta | undefined) =>
  firstPage ? writeSmallCopy(docId, firstPage, THUMB_FILE, COVER_SIDE) : Promise.resolve(undefined);

function nextPageNumber(pages: PageMeta[]): number {
  return pages.reduce((n, p) => Math.max(n, parseInt(p.file, 10) || 0), 0) + 1;
}

/** Stores one page and its preview, returning the metadata entry. */
async function storePage(docId: string, number: number, input: PageInput): Promise<PageMeta> {
  const file = `${number}.jpg`;
  await writePageFile(docId, file, input);
  const meta: PageMeta = { file, width: input.width, height: input.height };
  meta.thumb = await writeSmallCopy(docId, meta, thumbNameFor(file), PAGE_THUMB_SIDE);
  if (!meta.thumb) delete meta.thumb;
  return meta;
}

async function removePageFiles(docId: string, page: PageMeta): Promise<void> {
  await FileSystem.deleteAsync(`${docDir(docId)}${page.file}`, { idempotent: true });
  if (page.thumb) await FileSystem.deleteAsync(`${docDir(docId)}${page.thumb}`, { idempotent: true });
}

// ------------------------------------------------------------------ CRUD

/** All documents, newest first. */
export async function listDocs(): Promise<StoreResult<Doc[]>> {
  try {
    const docs = await readAll();
    docs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { ok: true, value: docs };
  } catch {
    return { ok: false, message: FRIENDLY.read };
  }
}

export async function getDoc(id: string): Promise<StoreResult<Doc>> {
  try {
    const doc = (await readAll()).find((d) => d.id === id);
    return doc ? { ok: true, value: doc } : { ok: false, message: FRIENDLY.missing };
  } catch {
    return { ok: false, message: FRIENDLY.read };
  }
}

/** Creates a document from one or more pages. */
export function createDoc(pages: PageInput[], name?: string): Promise<StoreResult<Doc>> {
  return serial(async () => {
    if (pages.length === 0) return { ok: false, message: 'There is nothing to save yet.' } as const;
    const id = newId();
    try {
      await FileSystem.makeDirectoryAsync(docDir(id), { intermediates: true });
      const metas: PageMeta[] = [];
      for (let i = 0; i < pages.length; i++) metas.push(await storePage(id, i + 1, pages[i]));
      const now = Date.now();
      const doc: Doc = {
        id,
        name: name?.trim() || defaultDocName(now),
        createdAt: now,
        updatedAt: now,
        pages: metas,
        thumbFile: await writeCover(id, metas[0]),
      };
      await writeAll([doc, ...(await readAll())]);
      return { ok: true, value: doc } as const;
    } catch {
      await FileSystem.deleteAsync(docDir(id), { idempotent: true }).catch(() => undefined);
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}

/** Appends pages to the end of an existing document, all or nothing. */
export function addPages(docId: string, pages: PageInput[]): Promise<StoreResult<Doc>> {
  return serial(async () => {
    if (pages.length === 0) return { ok: false, message: 'There is nothing to save yet.' } as const;
    const written: PageMeta[] = [];
    try {
      const docs = await readAll();
      const doc = docs.find((d) => d.id === docId);
      if (!doc) return { ok: false, message: FRIENDLY.missing } as const;
      let n = nextPageNumber(doc.pages);
      for (const input of pages) written.push(await storePage(docId, n++, input));
      const hadPages = doc.pages.length > 0;
      doc.pages.push(...written);
      if (!hadPages || !doc.thumbFile) doc.thumbFile = await writeCover(docId, doc.pages[0]);
      doc.updatedAt = Date.now();
      await writeAll(docs);
      return { ok: true, value: doc } as const;
    } catch {
      for (const p of written) await removePageFiles(docId, p).catch(() => undefined);
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}

export const addPage = (docId: string, page: PageInput) => addPages(docId, [page]);

/** Saves pages into an existing document when docId is given, otherwise into a brand new one. */
export function savePages(docId: string | undefined, pages: PageInput[]): Promise<StoreResult<Doc>> {
  return docId ? addPages(docId, pages) : createDoc(pages);
}

/** Puts the pages in the given order. `files` must be exactly the document's current page files. */
export function reorderPages(docId: string, files: string[]): Promise<StoreResult<Doc>> {
  return serial(async () => {
    try {
      const docs = await readAll();
      const doc = docs.find((d) => d.id === docId);
      if (!doc) return { ok: false, message: FRIENDLY.missing } as const;

      const byFile = new Map(doc.pages.map((p) => [p.file, p]));
      const sameSet = files.length === doc.pages.length && new Set(files).size === files.length && files.every((f) => byFile.has(f));
      if (!sameSet) return { ok: false, message: FRIENDLY.changed } as const;

      const firstBefore = doc.pages[0]?.file;
      doc.pages = files.map((f) => byFile.get(f) as PageMeta);
      if (doc.pages[0]?.file !== firstBefore) doc.thumbFile = await writeCover(docId, doc.pages[0]);
      doc.updatedAt = Date.now();
      await writeAll(docs);
      return { ok: true, value: doc } as const;
    } catch {
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}

/** Removes one page. Deleting the last page deletes the document. */
export function deletePage(docId: string, file: string): Promise<StoreResult<Doc | null>> {
  return serial(async () => {
    try {
      const docs = await readAll();
      const doc = docs.find((d) => d.id === docId);
      if (!doc) return { ok: false, message: FRIENDLY.missing } as const;
      const page = doc.pages.find((p) => p.file === file);
      const wasFirst = doc.pages[0]?.file === file;
      doc.pages = doc.pages.filter((p) => p.file !== file);
      if (page) await removePageFiles(docId, page);
      if (doc.pages.length === 0) {
        await FileSystem.deleteAsync(docDir(docId), { idempotent: true });
        await writeAll(docs.filter((d) => d.id !== docId));
        return { ok: true, value: null } as const;
      }
      if (wasFirst) doc.thumbFile = await writeCover(docId, doc.pages[0]);
      doc.updatedAt = Date.now();
      await writeAll(docs);
      return { ok: true, value: doc } as const;
    } catch {
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}

export function renameDoc(id: string, name: string): Promise<StoreResult<Doc>> {
  return serial(async () => {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: 'Please enter a name.' } as const;
    try {
      const docs = await readAll();
      const doc = docs.find((d) => d.id === id);
      if (!doc) return { ok: false, message: FRIENDLY.missing } as const;
      doc.name = trimmed.slice(0, 80);
      doc.updatedAt = Date.now();
      await writeAll(docs);
      return { ok: true, value: doc } as const;
    } catch {
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}

/** Deletes the document's metadata and its whole image folder. */
export function deleteDoc(id: string): Promise<StoreResult<true>> {
  return serial(async () => {
    try {
      const docs = await readAll();
      await writeAll(docs.filter((d) => d.id !== id));
      await FileSystem.deleteAsync(docDir(id), { idempotent: true });
      return { ok: true, value: true } as const;
    } catch {
      return { ok: false, message: FRIENDLY.write } as const;
    }
  });
}
