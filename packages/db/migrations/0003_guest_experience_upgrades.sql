CREATE TABLE "external_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feed_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"uid" text NOT NULL,
	"summary" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ical_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"room_type_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"token" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"overall" integer NOT NULL,
	"recommend" integer,
	"aspects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment" text,
	"public_consent" boolean DEFAULT false NOT NULL,
	"staff_reply" text,
	"replied_by_user_id" uuid,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_feedback_overall_ck" CHECK ("guest_feedback"."overall" between 1 and 5),
	CONSTRAINT "guest_feedback_nps_ck" CHECK ("guest_feedback"."recommend" is null or "guest_feedback"."recommend" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "precheckin" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "precheckin_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "bill_to" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pre_arrival_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "feedback_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bill_to" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supplier" jsonb;--> statement-breakpoint
ALTER TABLE "restaurant_reservations" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurant_reservations" ADD COLUMN "waitlist_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experience_bookings" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_blocks" ADD CONSTRAINT "external_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_blocks" ADD CONSTRAINT "external_blocks_feed_id_ical_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."ical_feeds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_blocks" ADD CONSTRAINT "external_blocks_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ical_feeds" ADD CONSTRAINT "ical_feeds_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_feedback" ADD CONSTRAINT "guest_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_feedback" ADD CONSTRAINT "guest_feedback_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_feedback" ADD CONSTRAINT "guest_feedback_replied_by_user_id_users_id_fk" FOREIGN KEY ("replied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_blocks_feed_uid_uq" ON "external_blocks" USING btree ("feed_id","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_feedback_booking_uq" ON "guest_feedback" USING btree ("booking_id");