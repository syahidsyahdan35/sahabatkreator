-- Flow Engine (Fase 8A).
--
-- Bagian 1 (gaya drizzle-kit dari skema): enum status + tabel `flows`
-- (definisi alur berbentuk graf jsonb — format kontrak FlowGraph di
-- @sahabat-kreator/contracts), `flow_runs` (satu eksekusi per (flow,
-- pesan pemicu)), dan `flow_run_steps` (log per langkah eksekusi —
-- observabilitas).
--
-- Idempotensi eksekusi berlapis: jobId BullMQ `flow-<runId>-<seq>`
-- diturunkan dari baris run, eksekutor menolak seq basi, dan index
-- unik parsial (flow_id, trigger_message_id) di sini adalah penahan
-- terakhir — satu pesan pemicu memulai PALING BANYAK satu run per
-- flow, walau evaluasi pesan masuk berjalan dua kali (replay webhook).
CREATE TYPE "public"."flow_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."flow_run_status" AS ENUM('running', 'waiting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "flow_status" DEFAULT 'draft' NOT NULL,
	"graph" jsonb DEFAULT '{"nodes":[],"edges":[]}' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"trigger_message_id" uuid NOT NULL,
	"status" "flow_run_status" DEFAULT 'running' NOT NULL,
	"current_node_id" varchar(128),
	"next_step_seq" integer DEFAULT 1 NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}' NOT NULL,
	"error_code" varchar(128),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flow_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"node_id" varchar(128) NOT NULL,
	"node_type" varchar(64) NOT NULL,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_trigger_message_id_messages_id_fk" FOREIGN KEY ("trigger_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_run_steps" ADD CONSTRAINT "flow_run_steps_run_id_flow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flows_tenant_id_idx" ON "flows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flows_tenant_status_idx" ON "flows" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "flow_runs_tenant_id_idx" ON "flow_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flow_runs_flow_id_idx" ON "flow_runs" USING btree ("flow_id");--> statement-breakpoint
CREATE INDEX "flow_runs_conversation_id_idx" ON "flow_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "flow_runs_tenant_status_idx" ON "flow_runs" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_flow_trigger_message_unique" ON "flow_runs" USING btree ("flow_id","trigger_message_id") WHERE "trigger_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "flow_run_steps_tenant_id_idx" ON "flow_run_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flow_run_steps_run_id_idx" ON "flow_run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_run_steps_run_seq_unique" ON "flow_run_steps" USING btree ("run_id","seq");--> statement-breakpoint
-- Bagian 2 (tulis tangan) — RLS.
-- Konteks akses ketiga tabel: policy `tenant_isolation` standar.
-- API dashboard dan eksekutor worker SELALU berjalan dalam konteks
-- tenant pemilik (job `flow.step` membawa tenantId run-nya, relay
-- membaca outbox lewat lengan `system_relay` yang sudah ada) — tidak
-- ada lengan lintas tenant baru di fase ini.
-- Tanpa konteks apa pun: 0 baris terbaca, semua tulis ditolak.
ALTER TABLE "flows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "flows"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "flow_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "flow_runs"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "flow_run_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "flow_run_steps"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
