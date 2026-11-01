import { and, desc, eq, sql } from "drizzle-orm";
import {
  kbChunks,
  kbDocuments,
  type Database,
  type KbDocument,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain Knowledge Base (Fase 3A, RANCANGAN §5.1 langkah 6 & §6).
 * Transport-agnostic; semua query dalam konteks RLS tenant.
 *
 * Dokumen disimpan utuh di `kb_documents`; saat dibuat, isinya dipecah
 * menjadi chunk ±800 karakter di `kb_chunks` untuk retrieval. Chunk adalah
 * turunan murni dari dokumen — tidak ada endpoint yang mengubah chunk
 * langsung; mengubah dokumen = buat ulang (di fase ini API hanya
 * create/list/get/delete, belum ada update dokumen).
 *
 * Retrieval v1 = full-text Postgres pada kolom `search_vector`
 * (konfigurasi 'simple', ter-generate dari content — lihat schema/agents.ts
 * soal alasan 'simple' untuk korpus campuran id/en). Kolom embedding
 * pgvector sudah disiapkan tetapi retrieval semantik menyusul di fase
 * embedding; TIDAK ada query vektor di fase ini.
 */

export const KB_CHUNK_SIZE = 800;
export const KB_CHUNK_OVERLAP = 120;

/**
 * Memecah teks menjadi chunk ≤ `size` karakter dengan overlap antar chunk.
 * Memotong pada batas kata/kalimat terdekat bila memungkinkan. Fungsi murni
 * & deterministik (dipakai service dan mudah diuji).
 */
export function chunkText(
  content: string,
  size: number = KB_CHUNK_SIZE,
  overlap: number = KB_CHUNK_OVERLAP,
): string[] {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(" "),
      );
      // Hanya mundur ke batas kata bila tidak terlalu jauh (≥50% ukuran).
      if (breakAt > size * 0.5) end = start + breakAt + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    // Mundur sejauh overlap untuk konteks sambung, tetapi start WAJIB maju.
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

export type KbDocumentWithChunkCount = KbDocument & { chunkCount: number };

export async function createKbDocument(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: { title: string; content: string },
): Promise<KbDocumentWithChunkCount> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [doc] = await tx
      .insert(kbDocuments)
      .values({
        tenantId: ctx.tenantId,
        title: input.title,
        content: input.content,
      })
      .returning();
    const chunks = chunkText(input.content);
    if (chunks.length > 0) {
      await tx.insert(kbChunks).values(
        chunks.map((content, i) => ({
          tenantId: ctx.tenantId,
          documentId: doc.id,
          chunkIndex: i,
          content,
        })),
      );
    }
    return { ...doc, chunkCount: chunks.length };
  });
}

export async function listKbDocuments(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
): Promise<KbDocumentWithChunkCount[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        document: kbDocuments,
        chunkCount: sql<number>`count(${kbChunks.id})::int`,
      })
      .from(kbDocuments)
      .leftJoin(kbChunks, eq(kbChunks.documentId, kbDocuments.id))
      .where(eq(kbDocuments.tenantId, ctx.tenantId))
      .groupBy(kbDocuments.id)
      .orderBy(desc(kbDocuments.createdAt));
    return rows.map((r) => ({ ...r.document, chunkCount: r.chunkCount }));
  });
}

/** Null bila dokumen tidak ada DI tenant ini. */
export async function getKbDocument(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  documentId: string,
): Promise<KbDocumentWithChunkCount | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        document: kbDocuments,
        chunkCount: sql<number>`count(${kbChunks.id})::int`,
      })
      .from(kbDocuments)
      .leftJoin(kbChunks, eq(kbChunks.documentId, kbDocuments.id))
      .where(
        and(
          eq(kbDocuments.tenantId, ctx.tenantId),
          eq(kbDocuments.id, documentId),
        ),
      )
      .groupBy(kbDocuments.id)
      .limit(1);
    return row ? { ...row.document, chunkCount: row.chunkCount } : null;
  });
}

/** True bila dokumen milik tenant ini terhapus (chunk ikut cascade). */
export async function deleteKbDocument(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  documentId: string,
): Promise<boolean> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const deleted = await tx
      .delete(kbDocuments)
      .where(
        and(
          eq(kbDocuments.tenantId, ctx.tenantId),
          eq(kbDocuments.id, documentId),
        ),
      )
      .returning({ id: kbDocuments.id });
    return deleted.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface KbSearchHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  rank: number;
}

/**
 * Mengubah pertanyaan bebas menjadi daftar token OR untuk to_tsquery.
 *
 * Kenapa BUKAN plainto_tsquery: plainto meng-AND-kan semua kata, sehingga
 * pertanyaan alami seperti "berapa harga kelas rekaman kilat?" TIDAK akan
 * cocok dengan dokumen "Harga kelas Rekaman Kilat adalah Rp349 ribu…"
 * hanya karena kata "berapa" tidak ada di dokumen (terbukti di
 * packages/db/scripts/verify.ts). Karena itu token disaring
 * (alfanumerik, ≥3 huruf, maks 12 token unik) lalu digabung OR; urutan
 * hasil ditentukan ts_rank — chunk yang memuat lebih banyak kata tanya
 * naik ke atas. Token disanitasi ketat (hanya huruf/angka) sehingga aman
 * dari sintaks tsquery.
 */
export function buildFtsOrQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const unique = [...new Set(tokens)].slice(0, 12);
  return unique.length > 0 ? unique.join(" | ") : null;
}

/**
 * Top-N chunk paling relevan untuk sebuah pertanyaan, HANYA dari KB
 * tenant ini (RLS + filter tenant eksplisit). Kosong bila tidak ada yang
 * cocok — agent menjawab tanpa konteks KB, bukan mengarang.
 */
export async function searchKbChunks(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  query: string,
  limit = 5,
): Promise<KbSearchHit[]> {
  const orQuery = buildFtsOrQuery(query);
  if (!orQuery) return [];
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const tsquery = sql`to_tsquery('simple', ${orQuery})`;
    const rows = await tx
      .select({
        chunkId: kbChunks.id,
        documentId: kbChunks.documentId,
        documentTitle: kbDocuments.title,
        chunkIndex: kbChunks.chunkIndex,
        content: kbChunks.content,
        rank: sql<number>`ts_rank(${kbChunks.searchVector}, ${tsquery})`,
      })
      .from(kbChunks)
      .innerJoin(kbDocuments, eq(kbChunks.documentId, kbDocuments.id))
      .where(
        and(
          eq(kbChunks.tenantId, ctx.tenantId),
          sql`${kbChunks.searchVector} @@ ${tsquery}`,
        ),
      )
      .orderBy(desc(sql`ts_rank(${kbChunks.searchVector}, ${tsquery})`))
      .limit(limit);
    return rows;
  });
}
