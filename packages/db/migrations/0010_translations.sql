CREATE TABLE "content_translations" (
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"locale" text NOT NULL,
	"strings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_translations_tenant_id_scope_locale_pk" PRIMARY KEY("tenant_id","scope","locale")
);
--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "languages" text[] DEFAULT '{en}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "content_translations" ADD CONSTRAINT "content_translations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;