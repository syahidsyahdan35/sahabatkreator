# Modul `flows`

Flow Engine (Fase 8A — backend): CRUD definisi flow berbentuk graf,
aktivasi dengan validasi graf menyeluruh, serta pembacaan run dan
log per langkah. Implementasi di `routes.ts`; logika domain di
`@sahabat-kreator/core` (`flows.ts`); eksekusi oleh worker (job
BullMQ `flow.step` dari event outbox `flow.step_due`). Builder UI
adalah Fase 8B — format graf di `@sahabat-kreator/contracts`
(`FlowGraph`) adalah kontrak bersama keduanya.

Keputusan v1:
- Format graf: `{nodes: [{id, type, config}], edges: [{from, to,
  branch?}]}`; tepat satu node `trigger`; `branch` hanya dari node
  `condition` (wajib `yes` + `no`).
- Validasi semantik penuh HANYA saat aktivasi (draft boleh belum
  sah): error → `422 FLOW_GRAPH_INVALID` + `details.issues`;
  warning (node tak terjangkau) tidak memblokir.
- Edit hanya saat `draft` — graf flow aktif tidak berubah di bawah
  run yang hidup. Nonaktifkan mengembalikan ke draft.
- Akses: mutasi owner/admin; baca semua member workspace.
- Eksekusi: urutan evaluasi pesan masuk keyword → flow → agent;
  balasan kontak TIDAK membatalkan run flow (berbeda dengan
  sequence), opt-out membatalkan run `waiting`; cap 100 langkah/run.
