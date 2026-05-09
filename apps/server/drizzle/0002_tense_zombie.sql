CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" text NOT NULL,
	"side" "trade_side" NOT NULL,
	"usd_amount" numeric(20, 8) NOT NULL,
	"qty" numeric(20, 8) NOT NULL,
	"price_at_execution" numeric(20, 8) NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"total_value_usd" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_snapshots_user_id_snapshot_date_pk" PRIMARY KEY("user_id","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_user_id_created_at_idx" ON "trades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_id_idempotency_key_uq" ON "trades" USING btree ("user_id","idempotency_key");