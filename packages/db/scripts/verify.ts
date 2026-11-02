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
assert.equal(Number(tablesRes.rows[0].count), 31);

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
//   4 policy `system_delivery_scan` (Fase 6A) = 32.
assert.equal(Number(policies.rows[0].count), 32);
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
    automation_steps, sequence_enrollments
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

await db.close();
console.log("db verify (PGlite): SEMUA LULUS");
