import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  agentSuggestions,
  auditLogs,
  automationRuns,
  broadcastRecipients,
  channelIdentities,
  contacts,
  conversations,
  flowRuns,
  paymentLinks,
  profilePhotos,
  sequenceEnrollments,
  type Contact,
  type Database,
} from "@sahabat-kreator/db";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tx";

/**
 * Service domain kontak/audiens (Fase 1D, RANCANGAN §6).
 * Transport-agnostic; semua query berjalan dalam konteks RLS tenant
 * (`withTenantDb` → set_config('app.tenant_id')) dan sekaligus difilter
 * eksplisit tenant_id sebagai lapis kedua.
 */

export interface CreateContactInput {
  name: string;
  phone?: string;
  email?: string;
  tags?: string[];
}

export interface UpdateContactInput {
  name?: string;
  tags?: string[];
  pipelineStage?: string;
  optInStatus?: "unknown" | "opted_in" | "opted_out";
}

export interface ListContactsInput {
  search?: string;
  limit: number;
  offset: number;
}

export async function createContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: CreateContactInput,
): Promise<Contact> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        tags: input.tags ?? [],
      })
      .returning();
    return row;
  });
}

export async function listContacts(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  input: ListContactsInput,
): Promise<{ contacts: Contact[]; total: number }> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(contacts.tenantId, ctx.tenantId)];
    const search = input.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const found = or(
        ilike(contacts.name, pattern),
        ilike(contacts.phone, pattern),
        ilike(contacts.email, pattern),
      );
      if (found) conditions.push(found);
    }
    const where = and(...conditions);
    const rows = await tx
      .select()
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.name))
      .limit(input.limit)
      .offset(input.offset);
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(where);
    return { contacts: rows, total: countRow?.count ?? 0 };
  });
}

/** Null bila kontak tidak ada DI tenant ini (API menerjemahkan ke 404). */
export async function getContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  contactId: string,
): Promise<Contact | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)),
      )
      .limit(1);
    return row ?? null;
  });
}

/** Null bila kontak tidak ada DI tenant ini (API menerjemahkan ke 404). */
export async function updateContact(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
  contactId: string,
  input: UpdateContactInput,
): Promise<Contact | null> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const patch: Partial<Contact> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.pipelineStage !== undefined) patch.pipelineStage = input.pipelineStage;
    if (input.optInStatus !== undefined) {
      patch.optInStatus = input.optInStatus;
      // opted_in dicatat sebagai consent; opted_out mencabutnya.
      patch.consentAt = input.optInStatus === "opted_in" ? new Date() : null;
    }
    const [row] = await tx
      .update(contacts)
      .set(patch)
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, contactId)),
      )
      .returning();
    return row ?? null;
  });
}

// ---------------------------------------------------------------------------
// Dedup & merge kontak (Fase 9B)
// ---------------------------------------------------------------------------

/**
 * Normalisasi telepon untuk pencocokan duplikat: hanya digit; awalan
 * "0" khas Indonesia diganti "62" dan "+" dibuang, sehingga
 * "0812-3456", "+62 812 3456", dan "628123456" dianggap sama. Nomor
 * terlalu pendek (< 7 digit) bukan sinyal yang bisa dipercaya → null.
 */
export function normalizeContactPhone(raw: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  return digits.length >= 7 ? digits : null;
}

/** Normalisasi email untuk pencocokan: trim + lowercase; wajib memuat "@". */
export function normalizeContactEmail(raw: string | null): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export interface DuplicateReason {
  type: "phone" | "email" | "channel_identity";
  /** Nilai ternormalisasi bersama (telepon digit / email / "provider:externalUserId"). */
  value: string;
  contactIds: string[];
}

export interface DuplicateContactGroup {
  contacts: Contact[];
  reasons: DuplicateReason[];
}

type SignalKey = string;

function phoneSignal(contact: Contact): SignalKey | null {
  const n = normalizeContactPhone(contact.phone);
  return n ? `phone:${n}` : null;
}
function emailSignal(contact: Contact): SignalKey | null {
  const n = normalizeContactEmail(contact.email);
  return n ? `email:${n}` : null;
}

/**
 * Kelompok kandidat duplikat dalam tenant: komponen terhubung dari
 * kontak-kontak yang berbagi telepon ternormalisasi, email
 * ternormalisasi, atau identitas channel (provider + external_user_id)
 * yang sama. Identitas pada SATU akun channel tidak mungkin ganda
 * (index unik), tetapi orang yang sama bisa menempel di dua kontak
 * lewat DUA akun channel berbeda (mis. dua bot Telegram) — itu yang
 * ditangkap sinyal identitas di sini.
 *
 * Implementasi memuat semua kontak tenant ke memori — jumlah kontak
 * per workspace pada skala produk ini masih wajar, dan pengelompokan
 * komponen terhubung (union-find) memang pekerjaan graf, bukan SQL.
 */
export async function findDuplicateContacts(
  db: Database,
  ctx: Pick<TenantContext, "tenantId">,
): Promise<DuplicateContactGroup[]> {
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(contacts)
      .where(eq(contacts.tenantId, ctx.tenantId))
      .orderBy(asc(contacts.createdAt));
    if (rows.length < 2) return [];
    const identities = await tx
      .select({
        contactId: channelIdentities.contactId,
        provider: channelIdentities.provider,
        externalUserId: channelIdentities.externalUserId,
      })
      .from(channelIdentities)
      .where(eq(channelIdentities.tenantId, ctx.tenantId));

    // Peta sinyal → kontak pemiliknya.
    const signalOwners = new Map<SignalKey, Set<string>>();
    const addSignal = (key: SignalKey | null, contactId: string) => {
      if (!key) return;
      const set = signalOwners.get(key) ?? new Set<string>();
      set.add(contactId);
      signalOwners.set(key, set);
    };
    for (const contact of rows) {
      addSignal(phoneSignal(contact), contact.id);
      addSignal(emailSignal(contact), contact.id);
    }
    for (const identity of identities) {
      addSignal(
        `identity:${identity.provider}:${identity.externalUserId}`,
        identity.contactId,
      );
    }

    // Union-find atas kontak yang berbagi sinyal.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur) !== cur) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    for (const contact of rows) parent.set(contact.id, contact.id);
    const reasons: DuplicateReason[] = [];
    for (const [key, owners] of signalOwners) {
      if (owners.size < 2) continue;
      const ids = [...owners].sort();
      const type = key.startsWith("phone:")
        ? "phone"
        : key.startsWith("email:")
          ? "email"
          : "channel_identity";
      reasons.push({
        type,
        value: key.slice(key.indexOf(":") + 1),
        contactIds: ids,
      });
      const [first, ...others] = ids;
      for (const other of others) {
        parent.set(find(other), find(first));
      }
    }

    const byRoot = new Map<string, Contact[]>();
    for (const contact of rows) {
      const root = find(contact.id);
      const list = byRoot.get(root) ?? [];
      list.push(contact);
      byRoot.set(root, list);
    }
    const groups: DuplicateContactGroup[] = [];
    for (const members of byRoot.values()) {
      if (members.length < 2) continue;
      const memberIds = new Set(members.map((m) => m.id));
      groups.push({
        contacts: members,
        reasons: reasons.filter((r) =>
          r.contactIds.every((id) => memberIds.has(id)),
        ),
      });
    }
    groups.sort(
      (a, b) =>
        b.contacts.length - a.contacts.length ||
        (a.contacts[0]?.createdAt.getTime() ?? 0) -
          (b.contacts[0]?.createdAt.getTime() ?? 0),
    );
    return groups;
  });
}

export type MergeContactsResult =
  | { kind: "ok"; survivor: Contact }
  | { kind: "not_found" }
  | { kind: "same_contact" };

/** Sinyal yang cocok antara DUA kontak (untuk meta audit merge). */
function sharedSignalsBetween(
  a: Contact,
  b: Contact,
  identitiesA: Array<{ provider: string; externalUserId: string }>,
  identitiesB: Array<{ provider: string; externalUserId: string }>,
): string[] {
  const found: string[] = [];
  const pa = normalizeContactPhone(a.phone);
  if (pa && pa === normalizeContactPhone(b.phone)) found.push("phone");
  const ea = normalizeContactEmail(a.email);
  if (ea && ea === normalizeContactEmail(b.email)) found.push("email");
  const keysB = new Set(
    identitiesB.map((i) => `${i.provider}:${i.externalUserId}`),
  );
  if (
    identitiesA.some((i) => keysB.has(`${i.provider}:${i.externalUserId}`))
  ) {
    found.push("channel_identity");
  }
  return found;
}

/**
 * Gabungkan `mergedId` ke `survivorId` dalam SATU transaksi tenant:
 * - identitas channel + percakapan + riwayat (automation run, flow run,
 *   saran agent, tautan bayar) berpindah ke survivor;
 * - enrollment sequence aktif yang bertabrakan dengan enrollment aktif
 *   survivor pada automation yang sama DIBATALKAN dulu (index unik
 *   parsial), sisanya berpindah;
 * - baris penerima broadcast yang bertabrakan (broadcast sama) dihapus
 *   — salinan survivor yang dipertahankan; sisanya berpindah;
 * - foto profil kontak: berpindah bila survivor belum punya; bila
 *   keduanya punya, foto survivor menang dan foto sumber dihapus;
 * - field survivor: tags = gabungan; custom_fields survivor menang
 *   konflik & kunci kosong terisi dari sumber; phone/email survivor
 *   diisi dari sumber bila kosong; stage survivor dipertahankan;
 *   opt-in: opted_out MENANG bila salah satu opted_out (yang lebih
 *   aman), consentAt mengikuti hasil akhir;
 * - kontak sumber dihapus; audit `contact.merged` mencatat kedua id,
 *   sinyal kecocokan yang terdeteksi (bisa kosong untuk merge manual),
 *   dan hitungan perpindahan.
 * Merge TIDAK mensyaratkan sinyal bersama — keputusan manusia
 * (owner/admin) yang memanggilnya; sinyal hanya dicatat.
 */
export async function mergeContacts(
  db: Database,
  ctx: Pick<TenantContext, "tenantId" | "userId">,
  input: { survivorId: string; mergedId: string },
): Promise<MergeContactsResult> {
  if (input.survivorId === input.mergedId) return { kind: "same_contact" };
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const load = async (id: string) => {
      const [row] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, id)))
        .limit(1);
      return row ?? null;
    };
    const survivor = await load(input.survivorId);
    const merged = await load(input.mergedId);
    if (!survivor || !merged) return { kind: "not_found" as const };

    const identitiesOf = (contactId: string) =>
      tx
        .select({
          provider: channelIdentities.provider,
          externalUserId: channelIdentities.externalUserId,
        })
        .from(channelIdentities)
        .where(
          and(
            eq(channelIdentities.tenantId, ctx.tenantId),
            eq(channelIdentities.contactId, contactId),
          ),
        );
    const reasons = sharedSignalsBetween(
      survivor,
      merged,
      await identitiesOf(survivor.id),
      await identitiesOf(merged.id),
    );

    const movedIdentities = await tx
      .update(channelIdentities)
      .set({ contactId: survivor.id, updatedAt: new Date() })
      .where(
        and(
          eq(channelIdentities.tenantId, ctx.tenantId),
          eq(channelIdentities.contactId, merged.id),
        ),
      )
      .returning({ id: channelIdentities.id });
    const movedConversations = await tx
      .update(conversations)
      .set({ contactId: survivor.id, updatedAt: new Date() })
      .where(
        and(
          eq(conversations.tenantId, ctx.tenantId),
          eq(conversations.contactId, merged.id),
        ),
      )
      .returning({ id: conversations.id });
    await tx
      .update(automationRuns)
      .set({ contactId: survivor.id })
      .where(
        and(
          eq(automationRuns.tenantId, ctx.tenantId),
          eq(automationRuns.contactId, merged.id),
        ),
      );
    await tx
      .update(flowRuns)
      .set({ contactId: survivor.id })
      .where(
        and(
          eq(flowRuns.tenantId, ctx.tenantId),
          eq(flowRuns.contactId, merged.id),
        ),
      );
    await tx
      .update(agentSuggestions)
      .set({ contactId: survivor.id })
      .where(
        and(
          eq(agentSuggestions.tenantId, ctx.tenantId),
          eq(agentSuggestions.contactId, merged.id),
        ),
      );
    await tx
      .update(paymentLinks)
      .set({ contactId: survivor.id })
      .where(
        and(
          eq(paymentLinks.tenantId, ctx.tenantId),
          eq(paymentLinks.contactId, merged.id),
        ),
      );

    // Enrollment sequence: batalkan yang aktif & bertabrakan lebih dulu.
    await tx.execute(sql`
      UPDATE sequence_enrollments m
         SET status = 'cancelled', next_run_at = NULL, updated_at = now()
       WHERE m.tenant_id = ${ctx.tenantId}
         AND m.contact_id = ${merged.id}
         AND m.status = 'active'
         AND EXISTS (
           SELECT 1 FROM sequence_enrollments s
            WHERE s.tenant_id = ${ctx.tenantId}
              AND s.contact_id = ${survivor.id}
              AND s.automation_id = m.automation_id
              AND s.status = 'active'
         )`);
    await tx
      .update(sequenceEnrollments)
      .set({ contactId: survivor.id, updatedAt: new Date() })
      .where(
        and(
          eq(sequenceEnrollments.tenantId, ctx.tenantId),
          eq(sequenceEnrollments.contactId, merged.id),
        ),
      );

    // Penerima broadcast: hapus baris sumber yang broadcast-nya sudah
    // dimiliki survivor (unik (broadcast, kontak)), sisanya pindah.
    const survivorBroadcasts = await tx
      .select({ broadcastId: broadcastRecipients.broadcastId })
      .from(broadcastRecipients)
      .where(
        and(
          eq(broadcastRecipients.tenantId, ctx.tenantId),
          eq(broadcastRecipients.contactId, survivor.id),
        ),
      );
    if (survivorBroadcasts.length > 0) {
      await tx
        .delete(broadcastRecipients)
        .where(
          and(
            eq(broadcastRecipients.tenantId, ctx.tenantId),
            eq(broadcastRecipients.contactId, merged.id),
            inArray(
              broadcastRecipients.broadcastId,
              survivorBroadcasts.map((r) => r.broadcastId),
            ),
          ),
        );
    }
    await tx
      .update(broadcastRecipients)
      .set({ contactId: survivor.id, updatedAt: new Date() })
      .where(
        and(
          eq(broadcastRecipients.tenantId, ctx.tenantId),
          eq(broadcastRecipients.contactId, merged.id),
        ),
      );

    // Foto profil kontak (owner polimorfik, tanpa FK): pindah bila
    // survivor belum punya; foto sumber terhapus dalam kedua kasus
    // (baris survivor dipertahankan).
    const photos = await tx
      .select({ id: profilePhotos.id, ownerId: profilePhotos.ownerId })
      .from(profilePhotos)
      .where(
        and(
          eq(profilePhotos.tenantId, ctx.tenantId),
          eq(profilePhotos.ownerType, "contact"),
          inArray(profilePhotos.ownerId, [survivor.id, merged.id]),
        ),
      );
    const survivorPhoto = photos.find((p) => p.ownerId === survivor.id);
    const mergedPhoto = photos.find((p) => p.ownerId === merged.id);
    if (mergedPhoto && !survivorPhoto) {
      await tx
        .update(profilePhotos)
        .set({ ownerId: survivor.id })
        .where(eq(profilePhotos.id, mergedPhoto.id));
    } else if (mergedPhoto) {
      await tx
        .delete(profilePhotos)
        .where(eq(profilePhotos.id, mergedPhoto.id));
    }

    // Field gabungan pada survivor.
    const tags = [...new Set([...survivor.tags, ...merged.tags])];
    const customFields: Record<string, unknown> = {
      ...(merged.customFields as Record<string, unknown>),
      ...(survivor.customFields as Record<string, unknown>),
    };
    const optInStatus =
      survivor.optInStatus === "opted_out" || merged.optInStatus === "opted_out"
        ? "opted_out"
        : survivor.optInStatus;
    const consentAt =
      optInStatus === "opted_out"
        ? null
        : (survivor.consentAt ?? merged.consentAt);
    const lastContactedAt =
      survivor.lastContactedAt && merged.lastContactedAt
        ? survivor.lastContactedAt > merged.lastContactedAt
          ? survivor.lastContactedAt
          : merged.lastContactedAt
        : (survivor.lastContactedAt ?? merged.lastContactedAt);
    const [updated] = await tx
      .update(contacts)
      .set({
        tags,
        customFields,
        phone: survivor.phone ?? merged.phone,
        email: survivor.email ?? merged.email,
        optInStatus,
        consentAt,
        lastContactedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contacts.tenantId, ctx.tenantId),
          eq(contacts.id, survivor.id),
        ),
      )
      .returning();

    await tx
      .delete(contacts)
      .where(
        and(eq(contacts.tenantId, ctx.tenantId), eq(contacts.id, merged.id)),
      );

    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: ctx.userId,
      action: "contact.merged",
      meta: {
        contactId: survivor.id,
        mergedContactId: merged.id,
        mergedContactName: merged.name,
        reasons,
        movedIdentities: movedIdentities.length,
        movedConversations: movedConversations.length,
      },
    });

    return { kind: "ok" as const, survivor: updated };
  });
}

