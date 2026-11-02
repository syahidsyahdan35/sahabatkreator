/**
 * Uji integrasi @sahabat-kreator/sdk terhadap API publik v1 yang LIVE
 * (Fase 5B). Bukan unit test: skrip ini memanggil staging/production asli
 * dengan API key uji, membuktikan client bekerja apa adanya dari sudut
 * pandang konsumen eksternal.
 *
 * Env yang dibaca (kunci TIDAK PERNAH dicetak — hanya prefix):
 *   SAHABAT_KREATOR_API_KEY   (wajib) kunci tenant uji
 *   SAHABAT_KREATOR_BASE_URL  (opsional) default https://botara.my.id
 *
 * Jalankan:  pnpm --filter @sahabat-kreator/sdk verify:sdk
 * Exit code 0 = semua lulus; 1 = ada kegagalan.
 */
import {
  SahabatKreatorApiError,
  SahabatKreatorClient,
} from "../src/index.js";

const apiKey = process.env.SAHABAT_KREATOR_API_KEY;
if (!apiKey) {
  console.error("SAHABAT_KREATOR_API_KEY wajib diisi (kunci tenant uji).");
  process.exit(2);
}
const baseUrl = process.env.SAHABAT_KREATOR_BASE_URL ?? "https://botara.my.id";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const client = new SahabatKreatorClient({ baseUrl, apiKey });

const me = await client.me();
check("me() mengembalikan tenant", typeof me.tenantId === "string" && me.tenantId.length > 0, `tenant="${me.tenantName}" scopes=${me.scopes.join(",")}`);

const contacts = await client.listContacts({ limit: 5 });
check("listContacts() berhasil", Array.isArray(contacts.contacts) && typeof contacts.total === "number", `total=${contacts.total}`);

// Fase 10B: permukaan komentar (scope comments:read pada kunci uji).
// Kunci tanpa scope itu menerima API_KEY_SCOPE_DENIED bertipe — keduanya
// membuktikan endpoint + metode SDK terhubung; keberhasilan penuh hanya
// untuk kunci berscope komentar.
try {
  const comments = await client.listComments({ limit: 5 });
  check("listComments() berhasil", Array.isArray(comments.comments), `count=${comments.comments.length}`);
} catch (err) {
  const isTyped = err instanceof SahabatKreatorApiError;
  check(
    "listComments() terhubung (atau ditolak scope secara bertipe)",
    isTyped && err.code === "API_KEY_SCOPE_DENIED",
    isTyped ? `code=${err.code}` : `error tak bertipe: ${String(err)}`,
  );
}

// Fase 13A: customFields tertulis lewat SDK — buat membawa field, PATCH
// menimpa per kunci dan mempertahankan kunci lain (semantik gabung
// server). Kunci tanpa contacts:write menerima API_KEY_SCOPE_DENIED
// bertipe — itu pun membuktikan metode terhubung (pola listComments).
try {
  const stamp = Date.now();
  const createdContact = await client.createContact({
    name: `SDK Uji 13A ${stamp}`,
    customFields: { kota: "Bandung", sumber: "verify-sdk" },
  });
  check(
    "createContact(customFields) tersimpan",
    createdContact.customFields?.kota === "Bandung" &&
      createdContact.customFields?.sumber === "verify-sdk",
    `id=${createdContact.id}`,
  );
  const updatedContact = await client.updateContact(createdContact.id, {
    customFields: { kota: "Jakarta" },
  });
  check(
    "updateContact(customFields) gabung per kunci",
    updatedContact.customFields?.kota === "Jakarta" &&
      updatedContact.customFields?.sumber === "verify-sdk",
    `id=${updatedContact.id}`,
  );
} catch (err) {
  const isTyped = err instanceof SahabatKreatorApiError;
  check(
    "createContact/updateContact terhubung (atau ditolak scope secara bertipe)",
    isTyped && err.code === "API_KEY_SCOPE_DENIED",
    isTyped ? `code=${err.code}` : `error tak bertipe: ${String(err)}`,
  );
}

// Jalur error: kunci acak → SahabatKreatorApiError dengan code API_KEY_INVALID.
const badClient = new SahabatKreatorClient({
  baseUrl,
  apiKey: `sk_live_${"x".repeat(43)}`,
});
try {
  await badClient.me();
  check("kunci salah ditolak", false, "me() tidak melempar error");
} catch (err) {
  const isTyped = err instanceof SahabatKreatorApiError;
  check(
    "kunci salah → SahabatKreatorApiError API_KEY_INVALID",
    isTyped && err.code === "API_KEY_INVALID" && err.status === 401,
    isTyped ? `code=${err.code} status=${err.status}` : `error tak bertipe: ${String(err)}`,
  );
}

console.log(failures === 0 ? "\nSEMUA LULUS" : `\n${failures} KEGAGALAN`);
process.exit(failures === 0 ? 0 : 1);
