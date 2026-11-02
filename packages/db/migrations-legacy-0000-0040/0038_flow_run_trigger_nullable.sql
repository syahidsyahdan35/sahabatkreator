-- Fase 12A — Ekspansi Node Flow: run yang lahir dari node goto_flow
-- tidak dipicu pesan masuk, jadi flow_runs.trigger_message_id harus
-- boleh NULL. Index unik parsial flow_runs_flow_trigger_message_unique
-- sudah memakai WHERE trigger_message_id IS NOT NULL sejak 0031,
-- sehingga idempotensi run berbasis pesan tidak berubah sama sekali.
ALTER TABLE "flow_runs" ALTER COLUMN "trigger_message_id" DROP NOT NULL;
