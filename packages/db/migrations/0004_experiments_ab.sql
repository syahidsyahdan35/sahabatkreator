CREATE TABLE "flow_experiment_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"node_id" varchar(128) NOT NULL,
	"contact_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"branch" varchar(8) NOT NULL,
	"label" varchar(255),
	"percent_a" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD COLUMN "variant" varchar(8) DEFAULT 'a' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "ab_split_percent_b" integer;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "variant_b_message_text" varchar(4096);--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "variant_b_whatsapp_template_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "variant_b_template_variable_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "flow_experiment_assignments" ADD CONSTRAINT "flow_experiment_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_experiment_assignments" ADD CONSTRAINT "flow_experiment_assignments_flow_id_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_experiment_assignments" ADD CONSTRAINT "flow_experiment_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_experiment_assignments" ADD CONSTRAINT "flow_experiment_assignments_run_id_flow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flow_experiment_assignments_sticky_unique" ON "flow_experiment_assignments" USING btree ("tenant_id","flow_id","node_id","contact_id");--> statement-breakpoint
CREATE INDEX "flow_experiment_assignments_tenant_id_idx" ON "flow_experiment_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "flow_experiment_assignments_split_idx" ON "flow_experiment_assignments" USING btree ("tenant_id","flow_id","node_id","branch");--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_variant_b_whatsapp_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("variant_b_whatsapp_template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_recipients_broadcast_variant_idx" ON "broadcast_recipients" USING btree ("broadcast_id","variant");--> statement-breakpoint
-- [K-13D] SQL kustom yang tidak bisa diekspresikan drizzle-kit (pola
-- blok [K-13C] di 0003): Row Level Security untuk tabel baru Fase 13D
-- — tenant_isolation standar. Penugasan eksperimen hanya pernah
-- diakses dalam konteks tenant pemiliknya (eksekutor worker + laporan
-- dashboard), jadi tidak ada lengan sempit.
ALTER TABLE "flow_experiment_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "flow_experiment_assignments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);