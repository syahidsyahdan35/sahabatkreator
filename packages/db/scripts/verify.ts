/**
 * Verifikasi Fase 1A untuk @sahabat-kreator/db.
 *
 * Jalur: PGlite (@electric-sql/pglite) — Postgres asli (WASM) yang berjalan
 * lokal di VM ini karena Docker tidak tersedia. Yang dibuktikan:
 *  1. Semua file migrasi (termasuk migrasi RLS) teraplikasi bersih dari nol.
 *  2. Insert dasar 2 tenant + member + data sistem bekerja.
 *  3. Constraint unik webhook_inbox (provider + provider_event_id) menolak duplikat.
 *  4. Isolasi RLS SUNGGUHAN: sebagai role non-superuser `app_user` dengan
 *     konteks app.tenant_id = tenant A, query hanya melihat data tenant A,
 *     dan insert untuk tenant B ditolak policy (WITH CHECK).
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN_ID = "99999999-9999-4999-8999-999999999999";

// Ekstensi `vector` (pgvector) didaftarkan eksplisit: migrasi 0009 menjalankan
// CREATE EXTENSION vector dan membuat kolom vector(1536) di kb_chunks.
// Di staging ekstensi yang sama tersedia dari image pgvector/pgvector:pg16.
const db = new PGlite({ extensions: { vector } });

// ---------- 1. Terapkan migrasi dari nol ----------
const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort();
assert.ok(files.length >= 2, `diharapkan >=2 file migrasi, ditemukan ${files.length}`);
for (const file of files) {
  const sqlText = await readFile(path.join(migrationsDir, file), "utf8");
  await db.exec(sqlText.replaceAll("--> statement-breakpoint", ""));
}
console.log(`[1] migrasi teraplikasi bersih: ${files.join(", ")}`);

const tablesRes = await db.query<{ count: string }>(
  `SELECT count(*)::text AS count FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
);
console.log(`    jumlah tabel public: ${tablesRes.rows[0].count}`);
// 11 tabel Fase 1A + 4 tabel Better Auth Fase 1B (auth_user/session/account/verification)
// + 6 tabel Fase 1D (channel_accounts, channel_identities, contacts, media,
// conversations, messages) + 2 tabel Fase 2A (automations, automation_runs)
// + 4 tabel Fase 3A (agents, kb_documents, kb_chunks, agent_suggestions)
// + 2 tabel Fase 4A (products, payment_links)
// + 2 tabel Fase 2C (automation_steps, sequence_enrollments)
// + 1 tabel Fase 6C (platform_settings)
// + 1 tabel Fase 6D (profile_photos)
assert.equal(Number(tablesRes.rows[0].count), 33);

// ---------- 2. Seed 2 tenant ----------
await db.query(
  `INSERT INTO plans (id, code, name, limits) VALUES ($1, 'pro', 'Pro', '{"contacts": 5000}')`,
  [PLAN_ID],
);
await db.query(
  `INSERT INTO users (id, email, name) VALUES ($1, 'a@example.com', 'User A'), ($2, 'b@example.com', 'User B')`,
  [USER_A, USER_B],
);
await db.query(
  `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Tenant A', 'tenant-a'), ($2, 'Tenant B', 'tenant-b')`,
  [TENANT_A, TENANT_B],
);
await db.query(
  `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $3, 'owner'), ($2, $4, 'owner')`,
  [TENANT_A, TENANT_B, USER_A, USER_B],
);
await db.query(
  `INSERT INTO usage_ledger (tenant_id, type, qty) VALUES ($1, 'message', 10), ($2, 'message', 99)`,
  [TENANT_A, TENANT_B],
);
await db.query(
  `INSERT INTO audit_logs (tenant_id, actor_type, action) VALUES ($1, 'system', 'seed.a'), ($2, 'system', 'seed.b')`,
  [TENANT_A, TENANT_B],
);
await db.query(
  `INSERT INTO outbox_events (tenant_id, type, payload) VALUES ($1, 'message.received', '{}'), ($2, 'message.received', '{}')`,
  [TENANT_A, TENANT_B],
);
await db.query(
  `INSERT INTO contacts (tenant_id, name, phone) VALUES ($1, 'Kontak A', '+628110000001'), ($2, 'Kontak B', '+628110000002')`,
  [TENANT_A, TENANT_B],
);
console.log("[2] seed 2 tenant + member + usage + audit + outbox + contacts: OK");

// ---------- 3. Dedup webhook_inbox ----------
await db.query(
  `INSERT INTO webhook_inbox (tenant_id, provider, provider_event_id, payload)
   VALUES ($1, 'whatsapp', 'evt-1', '{}')`,
  [TENANT_A],
);
await assert.rejects(
  db.query(
    `INSERT INTO webhook_inbox (tenant_id, provider, provider_event_id, payload)
     VALUES ($1, 'whatsapp', 'evt-1', '{}')`,
    [TENANT_B],
  ),
  /duplicate key|unique/i,
);
console.log("[3] webhook_inbox: duplikat (provider, provider_event_id) ditolak: OK");

// ---------- 4. Isolasi RLS sebagai role non-superuser ----------
const policies = await db.query<{ count: string }>(
  `SELECT count(*)::text AS count FROM pg_policies WHERE schemaname = 'public'`,
);
// 14 policy Fase 1A–1F + automations & automation_runs (Fase 2A)
// + policy kedua `system_relay` pada outbox_events (Fase 2A)
// + agents, kb_documents, kb_chunks, agent_suggestions (Fase 3A)
// + products & payment_links tenant_isolation + lengan publik
// `public_code_lookup` pada payment_links (Fase 4A)
// + automation_steps & sequence_enrollments tenant_isolation (Fase 2C)
// + lengan publik `public_key_lookup` pada api_keys (Fase 5A)
// + lengan webhook `telegram_webhook_lookup` pada channel_accounts dan
//   4 policy `system_delivery_scan` (Fase 6A)
// + lengan lookup `provider_external_lookup` pada channel_accounts
//   (hotfix Telegram, migrasi 0020)
// + policy `platform_settings_admin` pada platform_settings dan
//   `platform_audit` pada audit_logs (Fase 6C, migrasi 0022)
// + lengan pindai `system_purge_scan` pada channel_accounts
//   (Fase 6I, migrasi 0023)
// + `tenant_isolation` pada profile_photos (Fase 6D, migrasi 0025)
// + 4 policy `meta_delivery_scan` (Fase 7A, migrasi 0026; migrasi 0027
//   membuatnya ulang termasuk provider whatsapp — jumlah tetap) = 41.
assert.equal(Number(policies.rows[0].count), 41);
console.log(`[4] policy RLS terpasang: ${policies.rows[0].count} (termasuk system_relay outbox)`);

await db.exec(`
  CREATE ROLE app_user NOLOGIN;
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    tenants, users, plans, tenant_members, invitations, api_keys,
    subscriptions, webhook_inbox, outbox_events, audit_logs, usage_ledger,
    auth_user, auth_session, auth_account, auth_verification,
    channel_accounts, channel_identities, contacts, media, conversations, messages,
    automations, automation_runs,
    agents, kb_documents, kb_chunks, agent_suggestions,
    products, payment_links,
    automation_steps, sequence_enrollments,
    platform_settings, profile_photos
  TO app_user;
`);

interface Seen {
  members: string[];
  usageTenants: string[];
  auditTenants: string[];
  contactTenants: string[];
  contactCrossInsertBlocked: boolean;
  crossInsertBlocked: boolean;
}

const seen = await db.transaction(async (tx): Promise<Seen> => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);

  const members = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM tenant_members`,
  );
  const usage = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM usage_ledger`,
  );
  const audit = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM audit_logs`,
  );
  const contactRows = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM contacts`,
  );

  let contactCrossInsertBlocked = false;
  await tx.query(`SAVEPOINT sp0`);
  try {
    await tx.query(
      `INSERT INTO contacts (tenant_id, name) VALUES ($1, 'Kontak Lintas')`,
      [TENANT_B],
    );
  } catch (err) {
    contactCrossInsertBlocked = /row-level security/i.test(String(err));
    await tx.query(`ROLLBACK TO SAVEPOINT sp0`);
  }

  let crossInsertBlocked = false;
  // savepoint agar kegagalan insert tidak membatalkan seluruh transaksi uji
  await tx.query(`SAVEPOINT sp1`);
  try {
    await tx.query(
      `INSERT INTO usage_ledger (tenant_id, type, qty) VALUES ($1, 'message', 1)`,
      [TENANT_B],
    );
  } catch (err) {
    crossInsertBlocked = /row-level security/i.test(String(err));
    await tx.query(`ROLLBACK TO SAVEPOINT sp1`);
  }

  return {
    members: members.rows.map((r) => r.tenant_id),
    usageTenants: usage.rows.map((r) => r.tenant_id),
    auditTenants: audit.rows.map((r) => r.tenant_id),
    contactTenants: contactRows.rows.map((r) => r.tenant_id),
    contactCrossInsertBlocked,
    crossInsertBlocked,
  };
});

assert.deepEqual(seen.members, [TENANT_A]);
assert.deepEqual(seen.usageTenants, [TENANT_A]);
assert.deepEqual(seen.auditTenants, [TENANT_A]);
assert.deepEqual(seen.contactTenants, [TENANT_A]);
assert.equal(seen.contactCrossInsertBlocked, true);
assert.equal(seen.crossInsertBlocked, true);
console.log(
  "[5] RLS: konteks tenant A hanya melihat data A (members/usage/audit/contacts), insert lintas tenant ditolak: OK",
);

// ---------- 5. Lengan app.user_id pada policy tenant_members (Fase 1B) ----------
// Konteks daftar-keanggotaan: tanpa app.tenant_id, hanya app.user_id.
// User A harus melihat HANYA baris keanggotaannya sendiri (tenant A),
// dan tetap tidak bisa menulis member lintas konteks (WITH CHECK tenant-only).
const selfSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.user_id', $1, true)`, [USER_A]);
  const members = await tx.query<{ tenant_id: string; user_id: string }>(
    `SELECT tenant_id, user_id FROM tenant_members`,
  );
  let crossInsertBlocked = false;
  await tx.query(`SAVEPOINT sp2`);
  try {
    await tx.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [TENANT_B, USER_B],
    );
  } catch (err) {
    crossInsertBlocked = /row-level security/i.test(String(err));
    await tx.query(`ROLLBACK TO SAVEPOINT sp2`);
  }
  return { members: members.rows, crossInsertBlocked };
});
assert.deepEqual(
  selfSeen.members.map((r) => `${r.tenant_id}:${r.user_id}`),
  [`${TENANT_A}:${USER_A}`],
);
assert.equal(selfSeen.crossInsertBlocked, true);
console.log(
  "[6] RLS app.user_id: user hanya melihat keanggotaannya sendiri, insert via konteks user ditolak: OK",
);

// ---------- 6. Lengan system_relay pada outbox_events (Fase 2A) ----------
// Worker relay berjalan TANPA konteks tenant, tetapi dengan setting
// app.system_relay='outbox' ia harus melihat event SEMUA tenant; tanpa
// setting itu (dan tanpa app.tenant_id) ia tidak boleh melihat apa pun.
const relaySeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const withoutSetting = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM outbox_events`,
  );
  await tx.query(`SELECT set_config('app.system_relay', 'outbox', true)`);
  const withSetting = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM outbox_events ORDER BY tenant_id`,
  );
  return { without: withoutSetting.rows[0].n, tenants: withSetting.rows.map((r) => r.tenant_id) };
});
assert.equal(relaySeen.without, "0");
assert.deepEqual(relaySeen.tenants, [TENANT_A, TENANT_B]);
console.log(
  "[7] RLS system_relay: tanpa setting outbox tak terlihat; dengan app.system_relay='outbox' event semua tenant terbaca: OK",
);

// ---------- 7. Fase 3A: RLS agents/KB + retrieval full-text ----------
const AGENT_A = "33333333-3333-4333-8333-333333333333";
const KB_DOC_A = "44444444-4444-4444-8444-444444444444";
await db.query(
  `INSERT INTO agents (id, tenant_id, name, system_prompt, mode, is_active)
   VALUES ($1, $2, 'Agent A', 'Kamu CS Kelas Rekaman Kilat.', 'auto', true)`,
  [AGENT_A, TENANT_A],
);
await db.query(
  `INSERT INTO agents (tenant_id, name, mode, is_active) VALUES ($1, 'Agent B', 'suggest', true)`,
  [TENANT_B],
);
await db.query(
  `INSERT INTO kb_documents (id, tenant_id, title, content)
   VALUES ($1, $2, 'Harga', 'Harga kelas Rekaman Kilat adalah Rp349 ribu dan garansi 7 hari.')`,
  [KB_DOC_A, TENANT_A],
);
await db.query(
  `INSERT INTO kb_chunks (tenant_id, document_id, chunk_index, content)
   VALUES ($1, $2, 0, 'Harga kelas Rekaman Kilat adalah Rp349 ribu dan garansi 7 hari.')`,
  [TENANT_A, KB_DOC_A],
);
// search_vector harus ter-generate dan memuat leksem '349' & 'harga'.
const sv = await db.query<{ ok: boolean }>(
  `SELECT (search_vector @@ to_tsquery('simple', 'harga | 349')) AS ok FROM kb_chunks`,
);
assert.equal(sv.rows[0].ok, true);

const kbSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  const agentsA = await tx.query<{ name: string }>(`SELECT name FROM agents`);
  const chunksA = await tx.query<{ content: string }>(
    `SELECT content FROM kb_chunks
     WHERE search_vector @@ to_tsquery('simple', 'berapa | harga | kelas | rekaman | kilat')
     ORDER BY ts_rank(search_vector, to_tsquery('simple', 'berapa | harga | kelas | rekaman | kilat')) DESC
     LIMIT 5`,
  );
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
  const agentsB = await tx.query<{ name: string }>(`SELECT name FROM agents`);
  const chunksB = await tx.query<{ content: string }>(`SELECT content FROM kb_chunks`);
  return { agentsA, chunksA, agentsB, chunksB };
});
assert.deepEqual(kbSeen.agentsA.rows.map((r) => r.name), ["Agent A"]);
assert.equal(kbSeen.chunksA.rows.length, 1);
assert.ok(kbSeen.chunksA.rows[0].content.includes("349"));
assert.deepEqual(kbSeen.agentsB.rows.map((r) => r.name), ["Agent B"]);
assert.equal(kbSeen.chunksB.rows.length, 0);
console.log(
  "[8] Fase 3A: RLS agents/KB per tenant + search_vector ter-generate + retrieval FTS (OR + ts_rank) menemukan chunk yang benar: OK",
);

// ---------- 8. Fase 4A: RLS products/payment_links + lengan publik code ----------
// Produk + tautan bayar tenant A; tenant B punya produk sendiri. Uji:
// konteks tenant hanya melihat miliknya; TANPA konteks tenant tetapi dengan
// app.payment_code, hanya baris tautan berkode itu yang terlihat (dan tabel
// products TETAP tertutup — lengan publik hanya di payment_links); tanpa
// setting apa pun, payment_links tak terlihat sama sekali.
const PRODUCT_A = "55555555-5555-4555-8555-555555555555";
const LINK_CODE_A = "pay_uji4aKodeA001";
await db.query(
  `INSERT INTO products (id, tenant_id, name, price_idr) VALUES ($1, $2, 'Kelas Rekaman Kilat', 349000)`,
  [PRODUCT_A, TENANT_A],
);
await db.query(
  `INSERT INTO products (tenant_id, name, price_idr) VALUES ($1, 'Produk B', 1000)`,
  [TENANT_B],
);
await db.query(
  `INSERT INTO payment_links (tenant_id, product_id, code, amount_idr, expires_at)
   VALUES ($1, $2, $3, 349000, now() + interval '7 days')`,
  [TENANT_A, PRODUCT_A, LINK_CODE_A],
);
// Check constraint: harga negatif wajib ditolak DB.
await assert.rejects(
  db.query(
    `INSERT INTO products (tenant_id, name, price_idr) VALUES ($1, 'Negatif', -5)`,
    [TENANT_A],
  ),
  /check|products_price_idr_nonnegative/i,
);
const paySeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  // Tanpa konteks apa pun: kosong.
  const noCtxLinks = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM payment_links`,
  );
  const noCtxProducts = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM products`,
  );
  // Konteks publik: hanya tautan berkode itu; products tetap tertutup.
  await tx.query(`SELECT set_config('app.payment_code', $1, true)`, [LINK_CODE_A]);
  const pubLinks = await tx.query<{ code: string; tenant_id: string }>(
    `SELECT code, tenant_id FROM payment_links`,
  );
  const pubProducts = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM products`,
  );
  // Konteks tenant B: produk B saja, tautan kosong.
  await tx.query(`SELECT set_config('app.payment_code', '', true)`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
  const productsB = await tx.query<{ name: string }>(`SELECT name FROM products`);
  const linksB = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM payment_links`,
  );
  return { noCtxLinks, noCtxProducts, pubLinks, pubProducts, productsB, linksB };
});
assert.equal(paySeen.noCtxLinks.rows[0].n, "0");
assert.equal(paySeen.noCtxProducts.rows[0].n, "0");
assert.deepEqual(
  paySeen.pubLinks.rows.map((r) => `${r.code}:${r.tenant_id}`),
  [`${LINK_CODE_A}:${TENANT_A}`],
);
assert.equal(paySeen.pubProducts.rows[0].n, "0");
assert.deepEqual(paySeen.productsB.rows.map((r) => r.name), ["Produk B"]);
assert.equal(paySeen.linksB.rows[0].n, "0");
console.log(
  "[9] Fase 4A: RLS products/payment_links per tenant + lengan publik app.payment_code hanya membuka baris berkode itu (products tetap tertutup) + check harga >= 0: OK",
);

// ---------- 9. Fase 2C: sequence — kind, steps, enrollment aktif unik, RLS ----------
// Automation sequence tenant A dengan 2 langkah; enrollment aktif untuk
// kontak tenant A. Uji: kind default automation lama = 'keyword'; index unik
// parsial menolak enrollment aktif kedua untuk (automation, kontak) yang
// sama tetapi MEMBOLEHKAN setelah yang pertama tidak aktif; check delay >= 0;
// konteks tenant B tidak melihat steps/enrollments tenant A.
const SEQ_AUTO_A = "66666666-6666-4666-8666-666666666666";
const CONV_A = "77777777-7777-4777-8777-777777777777";
const contactA = await db.query<{ id: string }>(
  `SELECT id FROM contacts WHERE tenant_id = $1 LIMIT 1`,
  [TENANT_A],
);
const CONTACT_A = contactA.rows[0].id;
await db.query(
  `INSERT INTO automations (tenant_id, name) VALUES ($1, 'Keyword Lama')`,
  [TENANT_A],
);
await db.query(
  `INSERT INTO automations (id, tenant_id, name, kind) VALUES ($1, $2, 'Sequence Uji', 'sequence')`,
  [SEQ_AUTO_A, TENANT_A],
);
await db.query(
  `INSERT INTO automation_steps (tenant_id, automation_id, position, delay_minutes, text)
   VALUES ($1, $2, 1, 0, 'Langkah satu'), ($1, $2, 2, 60, 'Langkah dua')`,
  [TENANT_A, SEQ_AUTO_A],
);
await assert.rejects(
  db.query(
    `INSERT INTO automation_steps (tenant_id, automation_id, position, delay_minutes, text)
     VALUES ($1, $2, 3, -1, 'Negatif')`,
    [TENANT_A, SEQ_AUTO_A],
  ),
  /check|delay_minutes_nonnegative/i,
);
await db.query(
  `INSERT INTO channel_accounts (tenant_id, provider, external_id, display_name)
   VALUES ($1, 'webchat', 'wc_verify2c', 'Webchat Uji')`,
  [TENANT_A],
);
const chanA = await db.query<{ id: string }>(
  `SELECT id FROM channel_accounts WHERE tenant_id = $1 LIMIT 1`,
  [TENANT_A],
);
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider)
   VALUES ($1, $2, $3, $4, 'webchat')`,
  [CONV_A, TENANT_A, chanA.rows[0].id, CONTACT_A],
);
await db.query(
  `INSERT INTO sequence_enrollments (tenant_id, automation_id, contact_id, conversation_id)
   VALUES ($1, $2, $3, $4)`,
  [TENANT_A, SEQ_AUTO_A, CONTACT_A, CONV_A],
);
await assert.rejects(
  db.query(
    `INSERT INTO sequence_enrollments (tenant_id, automation_id, contact_id, conversation_id)
     VALUES ($1, $2, $3, $4)`,
    [TENANT_A, SEQ_AUTO_A, CONTACT_A, CONV_A],
  ),
  /duplicate key|sequence_enrollments_active_unique/i,
);
// Setelah enrollment pertama dibatalkan, enrollment aktif baru diperbolehkan.
await db.query(
  `UPDATE sequence_enrollments SET status = 'cancelled' WHERE automation_id = $1`,
  [SEQ_AUTO_A],
);
await db.query(
  `INSERT INTO sequence_enrollments (tenant_id, automation_id, contact_id, conversation_id)
   VALUES ($1, $2, $3, $4)`,
  [TENANT_A, SEQ_AUTO_A, CONTACT_A, CONV_A],
);
const kindDefault = await db.query<{ kind: string }>(
  `SELECT kind FROM automations WHERE name = 'Keyword Lama'`,
);
assert.equal(kindDefault.rows[0].kind, "keyword");
const seqSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
  const steps = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM automation_steps`,
  );
  const enrollments = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sequence_enrollments`,
  );
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  const stepsA = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM automation_steps`,
  );
  const enrollmentsA = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM sequence_enrollments`,
  );
  return { steps, enrollments, stepsA, enrollmentsA };
});
assert.equal(seqSeen.steps.rows[0].n, "0");
assert.equal(seqSeen.enrollments.rows[0].n, "0");
assert.equal(seqSeen.stepsA.rows[0].n, "2");
assert.equal(seqSeen.enrollmentsA.rows[0].n, "2");
console.log(
  "[10] Fase 2C: kind default 'keyword' + steps (check delay >= 0) + index unik enrollment aktif per (automation, kontak) + RLS steps/enrollments per tenant: OK",
);

// ---------- 10. Fase 5A: lengan publik api_keys (lookup by hash) ----------
// API key tenant A & B (hash uji tetap). Uji sebagai app_user: tanpa konteks
// apa pun api_keys tak terlihat; dengan app.api_key_hash = hash A, HANYA
// baris A yang terlihat; konteks tenant B tetap hanya melihat kunci B
// (lengan hash tidak membocorkan lintas tenant); nilai enum audit baru
// 'api_key' (migrasi 0015) bisa dipakai pada transaksi berikutnya.
const KEY_HASH_A = "hash-uji-5a-tenant-a";
const KEY_HASH_B = "hash-uji-5a-tenant-b";
await db.query(
  `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes)
   VALUES ($1, 'Kunci A', $3, 'sk_live_aaa1', '{contacts:read}'),
          ($2, 'Kunci B', $4, 'sk_live_bbb2', '{contacts:read}')`,
  [TENANT_A, TENANT_B, KEY_HASH_A, KEY_HASH_B],
);
const keySeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const noCtx = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM api_keys`,
  );
  await tx.query(`SELECT set_config('app.api_key_hash', $1, true)`, [KEY_HASH_A]);
  const byHash = await tx.query<{ tenant_id: string; key_hash: string }>(
    `SELECT tenant_id, key_hash FROM api_keys`,
  );
  // Konteks tenant B + setting hash A yang masih terpasang: policy OR —
  // baris A terlihat KARENA hash-nya disajikan (itu memang buktinya), tetapi
  // baris B juga hanya terlihat lewat konteks tenantnya; uji kuncinya:
  // dengan hash tenant B yang SALAH (tidak dikenal), tidak ada baris ekstra.
  await tx.query(`SELECT set_config('app.api_key_hash', 'hash-tidak-dikenal', true)`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
  const tenantB = await tx.query<{ key_hash: string }>(
    `SELECT key_hash FROM api_keys`,
  );
  // Enum audit 'api_key' harus bisa dipakai sekarang (transaksi terpisah
  // dari migrasi yang menambahkannya).
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action)
     VALUES ($1, 'api_key', 'key-uji', 'message.queued')`,
    [TENANT_B],
  );
  return { noCtx, byHash, tenantB };
});
assert.equal(keySeen.noCtx.rows[0].n, "0");
assert.deepEqual(
  keySeen.byHash.rows.map((r) => `${r.key_hash}:${r.tenant_id}`),
  [`${KEY_HASH_A}:${TENANT_A}`],
);
assert.deepEqual(keySeen.tenantB.rows.map((r) => r.key_hash), [KEY_HASH_B]);
console.log(
  "[11] Fase 5A: lengan publik app.api_key_hash hanya membuka baris ber-hash yang disajikan; tanpa konteks api_keys tertutup; konteks tenant tetap terisolasi; enum audit 'api_key' terpakai: OK",
);

// ---------- 12. Fase 6A: lengan Telegram (webhook lookup + pindai pengiriman) ----------
// Akun telegram tenant A & B + percakapan telegram A dengan pesan outbound
// `queued`, plus identitas chat-nya. Uji sebagai app_user:
//  - tanpa konteks: channel_accounts tertutup;
//  - app.telegram_channel_account_id = id A → HANYA baris A yang terbuka;
//  - kolom bot_username (migrasi 0017) terbaca;
//  - app.system_delivery='telegram' → poller melihat akun/percakapan/
//    identitas telegram lintas tenant, dan JOIN antrean hanya menghasilkan
//    pesan queued milik percakapan telegram (bukan webchat).
const TG_ACC_A = "88888888-8888-4888-8888-888888888888";
const TG_ACC_B = "99999999-9999-4999-8999-999999999999";
const TG_CONV_A = "12121212-1212-4212-8212-121212121212";
await db.query(
  `INSERT INTO channel_accounts (id, tenant_id, provider, external_id, display_name, status, webhook_secret, bot_username)
   VALUES ($1, $2, 'telegram', '555001', 'Bot Uji A', 'connected', 'hash-uji-a', 'bot_uji_a'),
          ($3, $4, 'telegram', '555002', 'Bot Uji B', 'connected', 'hash-uji-b', 'bot_uji_b')`,
  [TG_ACC_A, TENANT_A, TG_ACC_B, TENANT_B],
);
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider)
   VALUES ($1, $2, $3, $4, 'telegram')`,
  [TG_CONV_A, TENANT_A, TG_ACC_A, CONTACT_A],
);
await db.query(
  `INSERT INTO channel_identities (tenant_id, contact_id, channel_account_id, provider, external_user_id)
   VALUES ($1, $2, $3, 'telegram', '424242')`,
  [TENANT_A, CONTACT_A, TG_ACC_A],
);
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, type, content_text, status)
   VALUES ($1, $2, 'outbound', 'user', 'text', 'Balasan telegram uji', 'queued'),
          ($1, $3, 'outbound', 'user', 'text', 'Balasan webchat uji', 'queued')`,
  [TENANT_A, TG_CONV_A, CONV_A],
);
const tgSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const noCtx = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM channel_accounts`,
  );
  await tx.query(`SELECT set_config('app.telegram_channel_account_id', $1, true)`, [TG_ACC_A]);
  const byId = await tx.query<{ id: string; bot_username: string }>(
    `SELECT id, bot_username FROM channel_accounts`,
  );
  await tx.query(`SELECT set_config('app.telegram_channel_account_id', '', true)`);
  await tx.query(`SELECT set_config('app.system_delivery', 'telegram', true)`);
  const scanAccounts = await tx.query<{ id: string }>(
    `SELECT id FROM channel_accounts ORDER BY id`,
  );
  const scanConvs = await tx.query<{ id: string; provider: string }>(
    `SELECT id, provider FROM conversations`,
  );
  const scanQueue = await tx.query<{ content_text: string; chat_id: string }>(
    `SELECT m.content_text, ci.external_user_id AS chat_id
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.direction = 'outbound' AND m.status = 'queued'`,
  );
  return { noCtx, byId, scanAccounts, scanConvs, scanQueue };
});
assert.equal(tgSeen.noCtx.rows[0].n, "0");
assert.deepEqual(
  tgSeen.byId.rows.map((r) => `${r.id}:${r.bot_username}`),
  [`${TG_ACC_A}:bot_uji_a`],
);
assert.deepEqual(
  tgSeen.scanAccounts.rows.map((r) => r.id),
  [TG_ACC_A, TG_ACC_B],
);
assert.deepEqual(
  tgSeen.scanConvs.rows.map((r) => `${r.id}:${r.provider}`),
  [`${TG_CONV_A}:telegram`],
);
assert.deepEqual(
  tgSeen.scanQueue.rows.map((r) => `${r.content_text}:${r.chat_id}`),
  ["Balasan telegram uji:424242"],
);
console.log(
  "[12] Fase 6A: lengan app.telegram_channel_account_id hanya membuka baris akun itu; bot_username terbaca; pindai app.system_delivery='telegram' hanya menghasilkan antrean percakapan telegram lintas tenant: OK",
);

// ---------- 13. Fase 6A.1: grup Telegram (provider_chat_id + sender_name) ----------
// Kolom baru migrasi 0019 harus ada; percakapan grup tenant A
// (provider_chat_id negatif + title) dengan pesan outbound `queued` harus
// teresolusi alamat balasannya ke ID GRUP lewat query poller
// (coalesce provider_chat_id → external_user_id identitas), sementara
// percakapan privat lama (provider_chat_id NULL) jatuh kembali ke id
// kontak. Pesan masuk grup membawa sender_name; pesan privat NULL.
const TG_GROUP_CONV = "34343434-3434-4434-8434-343434343434";
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider, provider_chat_id, title)
   VALUES ($1, $2, $3, $4, 'telegram', '-1001234567890', 'Grup Uji 6A.1')`,
  [TG_GROUP_CONV, TENANT_A, TG_ACC_A, CONTACT_A],
);
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, sender_name, type, content_text, status)
   VALUES ($1, $2, 'inbound', 'contact', 'Anggota Satu', 'text', 'Halo dari grup', 'received'),
          ($1, $2, 'outbound', 'user', NULL, 'text', 'Balasan ke grup', 'queued'),
          ($1, $3, 'inbound', 'contact', NULL, 'text', 'Halo privat', 'received')`,
  [TENANT_A, TG_GROUP_CONV, TG_CONV_A],
);
const colCheck = await db.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name IN ('conversations', 'messages')
      AND column_name IN ('provider_chat_id', 'title', 'sender_name')
    ORDER BY column_name`,
);
assert.deepEqual(
  colCheck.rows.map((r) => r.column_name),
  ["provider_chat_id", "sender_name", "title"],
);
const groupSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.system_delivery', 'telegram', true)`);
  // Cerminan query core `listQueuedTelegramDeliveries` (Fase 6A.1):
  // alamat = coalesce(provider_chat_id percakapan, identitas kontak).
  return tx.query<{ content_text: string; chat_id: string }>(
    `SELECT m.content_text,
            coalesce(cv.provider_chat_id, ci.external_user_id) AS chat_id
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_accounts ca ON ca.id = cv.channel_account_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.direction = 'outbound' AND m.status = 'queued'
      ORDER BY m.content_text`,
  );
});
assert.deepEqual(
  groupSeen.rows.map((r) => `${r.content_text}:${r.chat_id}`),
  ["Balasan ke grup:-1001234567890", "Balasan telegram uji:424242"],
);
const senderNames = await db.query<{ sender_name: string | null }>(
  `SELECT sender_name FROM messages WHERE conversation_id = $1 AND direction = 'inbound'`,
  [TG_GROUP_CONV],
);
assert.deepEqual(senderNames.rows.map((r) => r.sender_name), ["Anggota Satu"]);
console.log(
  "[13] Fase 6A.1: kolom provider_chat_id/title/sender_name ada; alamat balasan grup teresolusi ke id grup negatif lewat coalesce & privat lama jatuh ke identitas kontak; sender_name tersimpan per pesan grup: OK",
);

// ---------- 14. Hotfix Telegram: satu bot = satu koneksi ----------
// Migrasi 0020: (a) index unik parsial (provider, external_id) WHERE
// status <> 'disconnected' menolak baris AKTIF kedua untuk pasangan yang
// sama — lintas tenant maupun 'error' — tetapi membolehkan baris
// 'disconnected' kembar; (b) lengan RLS provider_external_lookup hanya
// membuka baris yang (provider, external_id)-nya persis pasangan yang
// di-set transaksi (fondasi lookup connect lintas tenant).
const TG_ACC_B_DUPE = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
await assert.rejects(
  db.query(
    `INSERT INTO channel_accounts (tenant_id, provider, external_id, status)
     VALUES ($1, 'telegram', '555001', 'connected')`,
    [TENANT_B],
  ),
  /channel_accounts_provider_external_active_unique/,
);
await assert.rejects(
  db.query(
    `INSERT INTO channel_accounts (tenant_id, provider, external_id, status)
     VALUES ($1, 'telegram', '555001', 'error')`,
    [TENANT_B],
  ),
  /channel_accounts_provider_external_active_unique/,
);
await db.query(
  `INSERT INTO channel_accounts (id, tenant_id, provider, external_id, status)
   VALUES ($1, $2, 'telegram', '555001', 'disconnected')`,
  [TG_ACC_B_DUPE, TENANT_B],
);
const guardSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const noCtx = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM channel_accounts`,
  );
  await tx.query(`SELECT set_config('app.channel_provider', 'telegram', true)`);
  await tx.query(`SELECT set_config('app.channel_external_id', '555001', true)`);
  const pair = await tx.query<{ id: string; status: string }>(
    `SELECT id, status FROM channel_accounts ORDER BY status`,
  );
  await tx.query(`SELECT set_config('app.channel_external_id', 'tidak-ada', true)`);
  const none = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM channel_accounts`,
  );
  return { noCtx, pair, none };
});
assert.equal(guardSeen.noCtx.rows[0].n, "0");
assert.deepEqual(
  guardSeen.pair.rows.map((r) => `${r.id}:${r.status}`),
  [`${TG_ACC_A}:connected`, `${TG_ACC_B_DUPE}:disconnected`],
);
assert.equal(guardSeen.none.rows[0].n, "0");
console.log(
  "[14] Hotfix Telegram: index unik parsial menolak bot aktif ganda lintas tenant (connected & error), membolehkan baris disconnected; lengan provider_external_lookup hanya membuka pasangan persis: OK",
);

// ---------- 15. Fase 6A.2: percakapan channel (kolom kind) ----------
// Migrasi 0021: (a) kolom `kind` ada, default 'private' (baris TG_CONV_A
// dari seksi [12] yang di-insert tanpa kind membuktikannya); (b) CHECK
// menolak nilai di luar private/group/channel; (c) pernyataan backfill
// migrasi (title terisi → 'group') diterapkan pada baris bergaya
// pra-0021 — percakapan grup seksi [13] di-insert dengan title + kind
// default, persis bentuk data warisan — dan mengubahnya menjadi 'group'
// sementara baris tanpa title tetap 'private'; (d) percakapan channel
// dengan kontak jangkar = channel itu sendiri (identitas
// external_user_id = id channel) menresolusi alamat posting dashboard
// lewat query poller ke ID CHANNEL.
const kindCol = await db.query<{ data_type: string; column_default: string }>(
  `SELECT data_type, column_default FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'kind'`,
);
assert.equal(kindCol.rows.length, 1);
const defaultKind = await db.query<{ kind: string }>(
  `SELECT kind FROM conversations WHERE id = $1`,
  [TG_CONV_A],
);
assert.equal(defaultKind.rows[0].kind, "private");
await assert.rejects(
  db.query(
    `INSERT INTO conversations (tenant_id, channel_account_id, contact_id, provider, kind)
     VALUES ($1, $2, $3, 'telegram', 'bogus')`,
    [TENANT_A, TG_ACC_A, CONTACT_A],
  ),
  /conversations_kind_valid/,
);
// Simulasi backfill migrasi 0021 atas data warisan bergaya pra-0021.
await db.query(`UPDATE conversations SET kind = 'group' WHERE title IS NOT NULL`);
const backfilled = await db.query<{ id: string; kind: string }>(
  `SELECT id, kind FROM conversations WHERE id IN ($1, $2) ORDER BY id`,
  [TG_GROUP_CONV, TG_CONV_A],
);
assert.deepEqual(
  backfilled.rows.map((r) => `${r.id}:${r.kind}`),
  [`${TG_CONV_A}:private`, `${TG_GROUP_CONV}:group`],
);
const CHAN_CONTACT_A = "45454545-4545-4454-8454-454545454545";
const CHAN_CONV_A = "46464646-4646-4464-8464-464646464646";
await db.query(
  `INSERT INTO contacts (id, tenant_id, name) VALUES ($1, $2, 'Kanal Uji 6A.2')`,
  [CHAN_CONTACT_A, TENANT_A],
);
await db.query(
  `INSERT INTO channel_identities (tenant_id, contact_id, channel_account_id, provider, external_user_id)
   VALUES ($1, $2, $3, 'telegram', '-100555000111')`,
  [TENANT_A, CHAN_CONTACT_A, TG_ACC_A],
);
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider, provider_chat_id, title, kind)
   VALUES ($1, $2, $3, $4, 'telegram', '-100555000111', 'Kanal Uji 6A.2', 'channel')`,
  [CHAN_CONV_A, TENANT_A, TG_ACC_A, CHAN_CONTACT_A],
);
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, sender_name, type, content_text, provider_message_id, status)
   VALUES ($1, $2, 'inbound', 'contact', 'Kanal Uji 6A.2', 'text', 'Postingan admin lain', 'telegram:555001:501', 'received'),
          ($1, $2, 'outbound', 'user', NULL, 'text', 'Postingan dari dashboard', NULL, 'queued')`,
  [TENANT_A, CHAN_CONV_A],
);
const chanSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.system_delivery', 'telegram', true)`);
  return tx.query<{ chat_id: string }>(
    `SELECT coalesce(cv.provider_chat_id, ci.external_user_id) AS chat_id
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_accounts ca ON ca.id = cv.channel_account_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.conversation_id = $1
        AND m.direction = 'outbound' AND m.status = 'queued'`,
    [CHAN_CONV_A],
  );
});
assert.deepEqual(chanSeen.rows.map((r) => r.chat_id), ["-100555000111"]);
console.log(
  "[15] Fase 6A.2: kolom kind ada + default 'private' + CHECK menolak nilai liar; backfill title→'group' tepat; percakapan channel (jangkar = channel sendiri) teresolusi alamat postingnya ke id channel lewat query poller: OK",
);

// ---------- 16. Fase 6C: platform_settings RLS fail-closed + audit platform ----------
// Tabel platform_settings BUKAN tenant-scoped: tanpa flag transaksi
// `app.platform_settings='admin'`, role aplikasi tidak melihat satu baris
// pun dan tidak bisa menulis — walau barisnya ada (ditanam superuser).
// Dengan flag, akses penuh. Audit platform (tenant_id NULL) tunduk pada
// gerbang yang sama dan TIDAK pernah terlihat dari konteks tenant.
await db.query(
  `INSERT INTO platform_settings (key, value_encrypted, updated_by)
   VALUES ('openrouter_api_key', 'v1:seed.seed.seed', $1)`,
  [USER_A],
);
const psNoFlag = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const seenRows = await tx.query<{ key: string }>(
    `SELECT key FROM platform_settings`,
  );
  let insertBlocked = false;
  await tx.query(`SAVEPOINT sp_ps`);
  try {
    await tx.query(
      `INSERT INTO platform_settings (key, value_encrypted) VALUES ('r2_access_key_id', 'v1:x.y.z')`,
    );
  } catch (err) {
    insertBlocked = /row-level security/i.test(String(err));
  }
  await tx.query(`ROLLBACK TO SAVEPOINT sp_ps`);
  return { count: seenRows.rows.length, insertBlocked };
});
assert.equal(psNoFlag.count, 0);
assert.equal(psNoFlag.insertBlocked, true);
const psFlag = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.platform_settings', 'admin', true)`);
  const seenRows = await tx.query<{ key: string }>(
    `SELECT key FROM platform_settings`,
  );
  await tx.query(
    `INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, meta)
     VALUES (NULL, 'user', $1, 'platform_settings.set', '{"key":"openrouter_api_key"}')`,
    [USER_A],
  );
  return seenRows.rows.map((r) => r.key);
});
assert.deepEqual(psFlag, ["openrouter_api_key"]);
const psTenantView = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  return tx.query<{ action: string }>(
    `SELECT action FROM audit_logs WHERE action LIKE 'platform_settings.%'`,
  );
});
assert.equal(psTenantView.rows.length, 0);
console.log(
  "[16] Fase 6C: platform_settings fail-closed tanpa flag (0 baris + insert ditolak), terbuka dengan flag app.platform_settings='admin'; audit platform tenant_id NULL tertulis ber-flag dan tak terlihat dari konteks tenant: OK",
);

// ---------- 17. Fase 6I: kolom trashed_at + lengan pindai purge ----------
// Worker purge memindai akun Sampah dari SEMUA tenant tanpa konteks
// tenant. Lengan `system_purge_scan` (migrasi 0023) menuntut flag
// app.system_relay='channel_purge' dan HANYA membuka baris trashed —
// baris aktif tidak pernah terlihat lewat lengan ini, dan tanpa flag
// role aplikasi tidak melihat apa pun di luar konteks tenantnya.
await db.query(
  `INSERT INTO channel_accounts (tenant_id, provider, external_id, status, trashed_at)
   VALUES ($1, 'webchat', 'wc_verify_trashed_a', 'disconnected', now() - interval '31 days'),
          ($1, 'webchat', 'wc_verify_active_a', 'connected', NULL),
          ($2, 'telegram', '777123', 'disconnected', now() - interval '40 days')`,
  [TENANT_A, TENANT_B],
);
const purgeNoFlag = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  return tx.query<{ external_id: string }>(
    `SELECT external_id FROM channel_accounts`,
  );
});
assert.equal(purgeNoFlag.rows.length, 0);
const purgeScan = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.system_relay', 'channel_purge', true)`);
  return tx.query<{ external_id: string }>(
    `SELECT external_id FROM channel_accounts ORDER BY external_id`,
  );
});
assert.deepEqual(
  purgeScan.rows.map((r) => r.external_id),
  ["777123", "wc_verify_trashed_a"],
);
const purgeTenantView = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  return tx.query<{ external_id: string }>(
    `SELECT external_id FROM channel_accounts ORDER BY external_id`,
  );
});
const tenantAExternalIds = purgeTenantView.rows.map((r) => r.external_id);
assert.ok(tenantAExternalIds.includes("wc_verify_active_a"));
assert.ok(tenantAExternalIds.includes("wc_verify_trashed_a"));
assert.ok(!tenantAExternalIds.includes("777123"));
console.log(
  "[17] Fase 6I: channel_accounts.trashed_at ada; tanpa flag pindai purge buta (0 baris), dengan app.system_relay='channel_purge' hanya baris trashed lintas tenant yang terlihat; konteks tenant tetap melihat semua barisnya sendiri: OK",
);

// ---------- 18. Fase 6D: profile_photos — RLS tenant + bytea + unik per pemilik ----------
// Foto profil disimpan sebagai bytea di DB dan hanya boleh terlihat dari
// konteks tenant pemiliknya. Ditanam untuk tenant A & B (superuser), lalu
// dibaca sebagai app_user: konteks A hanya melihat baris A (byte kembali
// utuh), konteks B hanya baris B, insert lintas tenant ditolak WITH CHECK,
// dan index unik (tenant_id, owner_type, owner_id) menolak foto kedua
// untuk pemilik yang sama (jalur simpan harus upsert).
const PHOTO_OWNER_A = "66666666-6666-4666-8666-666666666666";
const PHOTO_OWNER_B = "77777777-7777-4777-8777-777777777777";
await db.query(
  `INSERT INTO profile_photos (tenant_id, owner_type, owner_id, content_type, data, etag)
   VALUES ($1, 'contact', $3, 'image/png', '\\x89504e47'::bytea, 'etag-a'),
          ($2, 'channel_account', $4, 'image/jpeg', '\\xffd8ffe0'::bytea, 'etag-b')`,
  [TENANT_A, TENANT_B, PHOTO_OWNER_A, PHOTO_OWNER_B],
);
const photoViewA = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
  const rows = await tx.query<{ owner_id: string; len: number }>(
    `SELECT owner_id, octet_length(data) AS len FROM profile_photos`,
  );
  let crossInsertBlocked = false;
  await tx.query(`SAVEPOINT sp_photo`);
  try {
    await tx.query(
      `INSERT INTO profile_photos (tenant_id, owner_type, owner_id, content_type, data, etag)
       VALUES ($1, 'contact', $2, 'image/png', '\\x00'::bytea, 'etag-x')`,
      [TENANT_B, PHOTO_OWNER_B],
    );
  } catch (err) {
    crossInsertBlocked = /row-level security/i.test(String(err));
  }
  await tx.query(`ROLLBACK TO SAVEPOINT sp_photo`);
  return { rows: rows.rows, crossInsertBlocked };
});
assert.equal(photoViewA.rows.length, 1);
assert.equal(photoViewA.rows[0].owner_id, PHOTO_OWNER_A);
assert.equal(photoViewA.rows[0].len, 4);
assert.equal(photoViewA.crossInsertBlocked, true);
let photoDupeBlocked = false;
try {
  await db.query(
    `INSERT INTO profile_photos (tenant_id, owner_type, owner_id, content_type, data, etag)
     VALUES ($1, 'contact', $2, 'image/png', '\\x01'::bytea, 'etag-dupe')`,
    [TENANT_A, PHOTO_OWNER_A],
  );
} catch (err) {
  photoDupeBlocked = /profile_photos_tenant_owner_unique/i.test(String(err));
}
assert.equal(photoDupeBlocked, true);
console.log(
  "[18] Fase 6D: profile_photos terisolasi per tenant (konteks A hanya baris A, bytea utuh 4 byte, insert lintas ditolak), unik satu foto per (tenant, jenis pemilik, pemilik): OK",
);

// ---------- 19. Fase 7A: Meta (Messenger + Instagram) ----------
// Migrasi 0026: (a) kolom public_handle ada di channel_accounts;
// (b) lengan `meta_delivery_scan` — tanpa flag app.system_delivery,
// role aplikasi tidak melihat baris Meta apa pun di luar konteks
// tenant; dengan 'meta' hanya baris messenger/instagram lintas tenant
// yang terbuka (akun telegram TIDAK ikut), dan query cerminan poller
// core hanya menghasilkan antrean Meta dengan alamat penerima yang
// teresolusi (coalesce provider_chat_id → identitas kontak).
const META_ACC_A = "12121212-1212-4121-8121-121212121212";
const META_ACC_B = "34343434-3434-4343-8434-343434343434";
const META_CONV_A = "56565656-5656-4565-8565-565656565656";
const META_CONV_B = "78787878-7878-4787-8787-787878787878";
const contactB = await db.query<{ id: string }>(
  `SELECT id FROM contacts WHERE tenant_id = $1 LIMIT 1`,
  [TENANT_B],
);
const CONTACT_B = contactB.rows[0].id;
await db.query(
  `INSERT INTO channel_accounts (id, tenant_id, provider, external_id, display_name, status, public_handle)
   VALUES ($1, $3, 'messenger', 'page_verify_a', 'Page Uji A', 'connected', 'pageujia'),
          ($2, $4, 'instagram', 'ig_verify_b', 'IG Uji B', 'connected', 'igujib'),
          ('90909090-9090-4909-8909-909090909090', $3, 'telegram', '777999', 'Bot Uji Meta', 'connected', 'bot_meta')`,
  [META_ACC_A, META_ACC_B, TENANT_A, TENANT_B],
);
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider, provider_chat_id)
   VALUES ($1, $3, $5, $7, 'messenger', 'psid_verify_a'),
          ($2, $4, $6, $8, 'instagram', 'igsid_verify_b')`,
  [META_CONV_A, META_CONV_B, TENANT_A, TENANT_B, META_ACC_A, META_ACC_B, CONTACT_A, CONTACT_B],
);
await db.query(
  `INSERT INTO channel_identities (tenant_id, contact_id, channel_account_id, provider, external_user_id)
   VALUES ($1, $3, $5, 'messenger', 'psid_verify_a'),
          ($2, $4, $6, 'instagram', 'igsid_verify_b')`,
  [TENANT_A, TENANT_B, CONTACT_A, CONTACT_B, META_ACC_A, META_ACC_B],
);
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, type, content_text, status)
   VALUES ($1, $3, 'outbound', 'user', 'text', 'Balasan messenger uji', 'queued'),
          ($2, $4, 'outbound', 'user', 'text', 'Balasan instagram uji', 'queued')`,
  [TENANT_A, TENANT_B, META_CONV_A, META_CONV_B],
);
const metaCol = await db.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'channel_accounts' AND column_name = 'public_handle'`,
);
assert.deepEqual(metaCol.rows.map((r) => r.column_name), ["public_handle"]);
const metaSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const noFlag = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM channel_accounts
      WHERE provider IN ('messenger', 'instagram')`,
  );
  await tx.query(`SELECT set_config('app.system_delivery', 'meta', true)`);
  const scanAccounts = await tx.query<{ id: string }>(
    `SELECT id FROM channel_accounts ORDER BY id`,
  );
  const scanConvs = await tx.query<{ id: string }>(
    `SELECT id FROM conversations ORDER BY id`,
  );
  const scanQueue = await tx.query<{ content_text: string; recipient: string }>(
    `SELECT m.content_text,
            coalesce(cv.provider_chat_id, ci.external_user_id) AS recipient
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_accounts ca ON ca.id = cv.channel_account_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.direction = 'outbound' AND m.status = 'queued'
      ORDER BY m.content_text`,
  );
  await tx.query(`SELECT set_config('app.system_delivery', 'telegram', true)`);
  const telegramFlagMeta = await tx.query<{ id: string }>(
    `SELECT id FROM channel_accounts
      WHERE provider IN ('messenger', 'instagram')`,
  );
  return { noFlag, scanAccounts, scanConvs, scanQueue, telegramFlagMeta };
});
assert.equal(metaSeen.noFlag.rows[0].n, "0");
assert.deepEqual(
  metaSeen.scanAccounts.rows.map((r) => r.id),
  [META_ACC_A, META_ACC_B],
);
assert.deepEqual(
  metaSeen.scanConvs.rows.map((r) => r.id),
  [META_CONV_A, META_CONV_B],
);
assert.deepEqual(
  metaSeen.scanQueue.rows.map((r) => `${r.content_text}:${r.recipient}`),
  ["Balasan instagram uji:igsid_verify_b", "Balasan messenger uji:psid_verify_a"],
);
assert.equal(metaSeen.telegramFlagMeta.rows.length, 0);
console.log(
  "[19] Fase 7A: kolom public_handle ada; pindai app.system_delivery='meta' hanya membuka akun/percakapan messenger+instagram lintas tenant (telegram tertutup), antrean poller Meta teresolusi penerimanya; flag 'telegram' tidak membuka baris Meta: OK",
);

// ---------- 20. Fase 7B: WhatsApp menumpang rel Meta ----------
// (a) kolom `parent_external_id` (WABA ID) ada di channel_accounts;
// (b) lengan `meta_delivery_scan` sesudah migrasi 0027 ikut membuka
// akun/percakapan whatsapp di bawah flag 'meta' yang sama, dan antrean
// poller menyelesaikan pesan queued WhatsApp ke wa_id penerimanya;
// flag 'telegram' tetap tidak membuka baris WhatsApp.
const WA_ACC = "23232323-2323-4232-8232-232323232323";
const WA_CONV = "45454545-4545-4454-8454-454545454545";
const WA_WABA = "waba_verify_1";
const WA_PHONE_ID = "phone_verify_1";
await db.query(
  `INSERT INTO channel_accounts (id, tenant_id, provider, external_id, parent_external_id, display_name, status, public_handle)
   VALUES ($1, $2, 'whatsapp', $3, $4, 'WA Uji', 'connected', '+62 812-3456-7890')`,
  [WA_ACC, TENANT_A, WA_PHONE_ID, WA_WABA],
);
await db.query(
  `INSERT INTO conversations (id, tenant_id, channel_account_id, contact_id, provider, provider_chat_id)
   VALUES ($1, $2, $3, $4, 'whatsapp', '6281234567890')`,
  [WA_CONV, TENANT_A, WA_ACC, CONTACT_A],
);
await db.query(
  `INSERT INTO channel_identities (tenant_id, contact_id, channel_account_id, provider, external_user_id)
   VALUES ($1, $2, $3, 'whatsapp', '6281234567890')`,
  [TENANT_A, CONTACT_A, WA_ACC],
);
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, type, content_text, status, provider_message_id)
   VALUES ($1, $2, 'outbound', 'user', 'text', 'Balasan whatsapp uji', 'sent', 'meta:phone_verify_1:wamid.verify.1')`,
  [TENANT_A, WA_CONV],
);
const waCol = await db.query<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns
    WHERE table_name = 'channel_accounts' AND column_name = 'parent_external_id'`,
);
assert.deepEqual(waCol.rows.map((r) => r.column_name), ["parent_external_id"]);
const waParent = await db.query<{ parent_external_id: string }>(
  `SELECT parent_external_id FROM channel_accounts WHERE id = $1`,
  [WA_ACC],
);
assert.equal(waParent.rows[0].parent_external_id, WA_WABA);
const waSeen = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  const noFlag = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM channel_accounts WHERE provider = 'whatsapp'`,
  );
  await tx.query(`SELECT set_config('app.system_delivery', 'meta', true)`);
  const scanAccounts = await tx.query<{ id: string }>(
    `SELECT id FROM channel_accounts WHERE provider = 'whatsapp' ORDER BY id`,
  );
  const scanQueue = await tx.query<{ content_text: string; recipient: string }>(
    `SELECT m.content_text,
            coalesce(cv.provider_chat_id, ci.external_user_id) AS recipient
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_accounts ca ON ca.id = cv.channel_account_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.direction = 'outbound' AND m.status = 'queued'
        AND cv.provider = 'whatsapp'
      ORDER BY m.content_text`,
  );
  await tx.query(`SELECT set_config('app.system_delivery', 'telegram', true)`);
  const telegramFlagWa = await tx.query<{ id: string }>(
    `SELECT id FROM channel_accounts WHERE provider = 'whatsapp'`,
  );
  return { noFlag, scanAccounts, scanQueue, telegramFlagWa };
});
assert.equal(waSeen.noFlag.rows[0].n, "0");
assert.deepEqual(waSeen.scanAccounts.rows.map((r) => r.id), [WA_ACC]);
assert.deepEqual(waSeen.scanQueue.rows, []);
assert.equal(waSeen.telegramFlagWa.rows.length, 0);
// Antrean queued WhatsApp: tambahkan satu pesan queued lalu pastikan
// query cerminan poller (flag 'meta') menyelesaikannya ke wa_id.
await db.query(
  `INSERT INTO messages (tenant_id, conversation_id, direction, sender_type, type, content_text, status)
   VALUES ($1, $2, 'outbound', 'user', 'text', 'Antre whatsapp uji', 'queued')`,
  [TENANT_A, WA_CONV],
);
const waQueue = await db.transaction(async (tx) => {
  await tx.query(`SET LOCAL ROLE app_user`);
  await tx.query(`SELECT set_config('app.system_delivery', 'meta', true)`);
  return tx.query<{ content_text: string; recipient: string }>(
    `SELECT m.content_text,
            coalesce(cv.provider_chat_id, ci.external_user_id) AS recipient
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN channel_accounts ca ON ca.id = cv.channel_account_id
       JOIN channel_identities ci
         ON ci.channel_account_id = cv.channel_account_id
        AND ci.contact_id = cv.contact_id
      WHERE m.direction = 'outbound' AND m.status = 'queued'
        AND cv.provider = 'whatsapp'`,
  );
});
assert.deepEqual(
  waQueue.rows.map((r) => `${r.content_text}:${r.recipient}`),
  ["Antre whatsapp uji:6281234567890"],
);
console.log(
  "[20] Fase 7B: kolom parent_external_id (WABA) ada & terisi; pindai app.system_delivery='meta' membuka akun whatsapp lintas tenant dan antrean queued WhatsApp teresolusi ke wa_id penerima; flag 'telegram' tidak membuka baris WhatsApp: OK",
);

await db.close();
console.log("db verify (PGlite): SEMUA LULUS");
