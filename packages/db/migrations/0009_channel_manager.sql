CREATE TABLE "channel_ari_state" (
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"key" text NOT NULL,
	"date" date NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "channel_ari_state_connection_id_key_date_pk" PRIMARY KEY("connection_id","key","date")
);
--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"environment" text DEFAULT 'staging' NOT NULL,
	"external_property_id" text NOT NULL,
	"api_key_enc" text,
	"horizon_days" integer DEFAULT 365 NOT NULL,
	"last_push_at" timestamp with time zone,
	"last_pull_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"rate_plan_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"external_room_type_id" text NOT NULL,
	"external_rate_plan_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"ok" boolean NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "channel_ref" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "channel_total" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "channel_issue" text;--> statement-breakpoint
ALTER TABLE "channel_ari_state" ADD CONSTRAINT "channel_ari_state_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_ari_state" ADD CONSTRAINT "channel_ari_state_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sync_log" ADD CONSTRAINT "channel_sync_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sync_log" ADD CONSTRAINT "channel_sync_log_connection_id_channel_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_tenant_provider_uq" ON "channel_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_mappings_plan_uq" ON "channel_mappings" USING btree ("connection_id","rate_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_mappings_ext_uq" ON "channel_mappings" USING btree ("connection_id","external_rate_plan_id");--> statement-breakpoint
CREATE INDEX "channel_sync_log_conn_idx" ON "channel_sync_log" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_channel_ref_uq" ON "bookings" ("tenant_id", "channel_ref") WHERE "channel_ref" IS NOT NULL;
