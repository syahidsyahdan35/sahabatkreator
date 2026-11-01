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
assert.equal(Number(tablesRes.rows[0].count), 29);

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
// `public_code_lookup` pada payment_links (Fase 4A) = 24.
assert.equal(Number(policies.rows[0].count), 24);
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
    products, payment_links
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

await db.close();
console.log("db verify (PGlite): SEMUA LULUS");
