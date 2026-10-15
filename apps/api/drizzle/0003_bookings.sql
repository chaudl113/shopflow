-- Needed so the exclusion constraint below can combine "=" on a uuid with "&&" on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('online', 'staff');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('booked', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"store_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"source" "booking_source" NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"quoted_price_cents" integer NOT NULL,
	"sale_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "bookings_sale_id_unique" UNIQUE("sale_id")
);
--> statement-breakpoint
CREATE TABLE "staff_hours" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_services" (
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "staff_services_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_hours" ADD CONSTRAINT "staff_hours_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_hours" ADD CONSTRAINT "staff_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_store_starts_idx" ON "bookings" USING btree ("store_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_staff_starts_idx" ON "bookings" USING btree ("staff_id","starts_at");--> statement-breakpoint
CREATE INDEX "staff_hours_store_user_idx" ON "staff_hours" USING btree ("store_id","user_id");--> statement-breakpoint
-- Hand-written: drizzle-kit has no syntax for these.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_ends_after_starts" CHECK ("ends_at" > "starts_at");--> statement-breakpoint
ALTER TABLE "staff_hours" ADD CONSTRAINT "staff_hours_valid" CHECK ("weekday" BETWEEN 1 AND 7 AND "start_min" >= 0 AND "end_min" <= 1440 AND "start_min" < "end_min");--> statement-breakpoint
-- One person cannot be in two live appointments at once, in any store. Half-open ranges let
-- a 10:00-11:00 booking sit right after a 09:00-10:00 one.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
	"staff_id" WITH =,
	tstzrange("starts_at", "ends_at", '[)') WITH &&
) WHERE ("status" IN ('booked', 'completed'));
