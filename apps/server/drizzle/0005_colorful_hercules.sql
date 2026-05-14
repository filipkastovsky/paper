CREATE TABLE "daily_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"asset_id" text NOT NULL,
	"baseline_price_usd" text NOT NULL,
	"direction_resolved" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"daily_question_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"stake" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payout" integer,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_points" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_predictions" ADD CONSTRAINT "user_predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_predictions" ADD CONSTRAINT "user_predictions_daily_question_id_daily_questions_id_fk" FOREIGN KEY ("daily_question_id") REFERENCES "public"."daily_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_points" ADD CONSTRAINT "prediction_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_questions_date_uq" ON "daily_questions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "user_predictions_user_question_uq" ON "user_predictions" USING btree ("user_id","daily_question_id");--> statement-breakpoint
CREATE INDEX "user_predictions_user_id_idx" ON "user_predictions" USING btree ("user_id");