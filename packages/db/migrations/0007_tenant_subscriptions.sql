CREATE TABLE "platform_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"financial_year" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"cycle" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount" integer NOT NULL,
	"cgst" integer DEFAULT 0 NOT NULL,
	"sgst" integer DEFAULT 0 NOT NULL,
	"igst" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"sac" text NOT NULL,
	"supplier" jsonb NOT NULL,
	"bill_to" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"utr" text NOT NULL,
	"proof_file_id" uuid,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"rejection_reason" text,
	"stale_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'trial' NOT NULL,
	"started_at" date NOT NULL,
	"trial_ends_at" date NOT NULL,
	"paid_until" date,
	"monthly_fee" integer,
	"yearly_fee" integer,
	"cycle" text,
	"grace_days" integer,
	"suspended_reason" text,
	"bill_to" jsonb,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_invoice_id_platform_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."platform_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_invoices_number_uq" ON "platform_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "platform_invoices_tenant_idx" ON "platform_invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_payments_utr_uq" ON "platform_payments" USING btree (upper("utr")) WHERE "platform_payments"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "platform_payments_status_idx" ON "platform_payments" USING btree ("status","submitted_at");--> statement-breakpoint
-- Existing properties start a 30-day free trial from today, so nobody is suspended by surprise.
INSERT INTO "tenant_subscriptions" ("tenant_id", "status", "started_at", "trial_ends_at")
SELECT "id", 'trial', current_date, current_date + 30 FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
