CREATE TABLE "leaderboard_snapshots" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"week_starting_date" text NOT NULL,
	"composite_score" integer DEFAULT 0 NOT NULL,
	"rank_global" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;