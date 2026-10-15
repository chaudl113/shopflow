CREATE TYPE "public"."location_kind" AS ENUM('store', 'warehouse');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('receive', 'sale', 'return', 'adjust', 'transfer_out', 'transfer_in', 'transfer_cancel');--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('product', 'service');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'manager', 'cashier', 'staff');--> statement-breakpoint
CREATE TABLE "counters" (
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "counters_scope_kind_pk" PRIMARY KEY("scope","kind")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "product_type" DEFAULT 'product' NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_min" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"unit_cost_cents" integer,
	"ref_type" text,
	"ref_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_prices" (
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	CONSTRAINT "store_prices_store_id_variant_id_pk" PRIMARY KEY("store_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "location_kind" DEFAULT 'store' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"booking_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_code_unique" UNIQUE("code"),
	CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_stores" (
	"user_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "user_stores_user_id_store_id_pk" PRIMARY KEY("user_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"bookable" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"price_cents" integer NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 5 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "variants_sku_unique" UNIQUE("sku"),
	CONSTRAINT "variants_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prices" ADD CONSTRAINT "store_prices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prices" ADD CONSTRAINT "store_prices_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_store_variant_idx" ON "stock_movements" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("product_id");