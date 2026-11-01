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

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAN_ID = "99999999-9999-4999-8999-999999999999";

const db = new PGlite();

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
assert.equal(Number(tablesRes.rows[0].count), 15);

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
console.log("[2] seed 2 tenant + member + usage + audit + outbox: OK");

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
assert.equal(Number(policies.rows[0].count), 8);
console.log(`[4] policy RLS terpasang: ${policies.rows[0].count} (8 tabel tenant-scoped)`);

await db.exec(`
  CREATE ROLE app_user NOLOGIN;
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    tenants, users, plans, tenant_members, invitations, api_keys,
    subscriptions, webhook_inbox, outbox_events, audit_logs, usage_ledger,
    auth_user, auth_session, auth_account, auth_verification
  TO app_user;
`);

interface Seen {
  members: string[];
  usageTenants: string[];
  auditTenants: string[];
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
    crossInsertBlocked,
  };
});

assert.deepEqual(seen.members, [TENANT_A]);
assert.deepEqual(seen.usageTenants, [TENANT_A]);
assert.deepEqual(seen.auditTenants, [TENANT_A]);
assert.equal(seen.crossInsertBlocked, true);
console.log(
  "[5] RLS: konteks tenant A hanya melihat data A (members/usage/audit), insert lintas tenant ditolak: OK",
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

await db.close();
console.log("db verify (PGlite): SEMUA LULUS");
