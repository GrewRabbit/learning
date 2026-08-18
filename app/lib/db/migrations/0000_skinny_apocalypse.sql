CREATE TABLE "billing_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content_hash" text,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"operator" text,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_records_type_check" CHECK (type IN ('consume', 'recharge')),
	CONSTRAINT "billing_records_amount_check" CHECK (amount > 0),
	CONSTRAINT "billing_records_balance_after_check" CHECK (balance_after >= 0),
	CONSTRAINT "billing_records_type_content_hash_check" CHECK ((type = 'consume' AND content_hash IS NOT NULL) OR (type = 'recharge' AND content_hash IS NULL))
);
--> statement-breakpoint
CREATE TABLE "primary_indexes" (
	"platform" text NOT NULL,
	"problem_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "primary_indexes_platform_problem_id_pk" PRIMARY KEY("platform","problem_id")
);
--> statement-breakpoint
CREATE TABLE "quota_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"free_balance" integer DEFAULT 0 NOT NULL,
	"recharge_balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_accounts_free_balance_check" CHECK (free_balance >= 0),
	CONSTRAINT "quota_accounts_recharge_balance_check" CHECK (recharge_balance >= 0)
);
--> statement-breakpoint
CREATE TABLE "sample_indexes" (
	"sample_fp" text PRIMARY KEY NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solutions" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"warning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solve_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" text NOT NULL,
	"input_type" text NOT NULL,
	"platform" text,
	"problem_id" text,
	"sample_fp" text,
	"content_hash" text NOT NULL,
	"cached" boolean NOT NULL,
	"validated" boolean NOT NULL,
	"billed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solve_records_input_type_check" CHECK (input_type IN ('text', 'image', 'platform')),
	CONSTRAINT "solve_records_platform_problem_id_check" CHECK ((platform IS NULL AND problem_id IS NULL) OR (platform IS NOT NULL AND problem_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "user_solution_access" (
	"user_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"first_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_solution_access_user_id_content_hash_pk" PRIMARY KEY("user_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sso_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_sso_sub_unique" UNIQUE("sso_sub")
);
--> statement-breakpoint
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_records" ADD CONSTRAINT "billing_records_content_hash_solutions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."solutions"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_indexes" ADD CONSTRAINT "primary_indexes_content_hash_solutions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."solutions"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_accounts" ADD CONSTRAINT "quota_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_indexes" ADD CONSTRAINT "sample_indexes_content_hash_solutions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."solutions"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_records" ADD CONSTRAINT "solve_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_records" ADD CONSTRAINT "solve_records_content_hash_solutions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."solutions"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_solution_access" ADD CONSTRAINT "user_solution_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_solution_access" ADD CONSTRAINT "user_solution_access_content_hash_solutions_content_hash_fk" FOREIGN KEY ("content_hash") REFERENCES "public"."solutions"("content_hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_billing_records_user_id_created_at" ON "billing_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_solve_records_user_id_created_at" ON "solve_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_solve_records_content_hash" ON "solve_records" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_user_solution_access_content_hash" ON "user_solution_access" USING btree ("content_hash");