CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bunq_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"secret_key" text NOT NULL,
	"environment" text DEFAULT 'sandbox',
	"status" text DEFAULT 'pending',
	"last_error" text,
	"user_id" text,
	"session_token" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_date" text NOT NULL,
	"orders_count" integer DEFAULT 0,
	"synced_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "cache_sync_log_sync_date_unique" UNIQUE("sync_date")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"currency_code" text NOT NULL,
	"rate" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "de_parcel_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracking_number" text NOT NULL,
	"carrier" text,
	"status" text NOT NULL,
	"sub_status" text,
	"last_event" text,
	"last_location" text,
	"last_update" text,
	"first_event_date" text,
	"last_event_date" text,
	"checked_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "de_parcel_statuses_tracking_number_unique" UNIQUE("tracking_number")
);
--> statement-breakpoint
CREATE TABLE "delivery_date_cache" (
	"order_id" text PRIMARY KEY NOT NULL,
	"delivery_date" text NOT NULL,
	"delivery_status" text NOT NULL,
	"cached_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1',
	"direction" text DEFAULT 'ru' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"email" text NOT NULL,
	"secret_key" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending',
	"last_error" text,
	"account_id" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_knowledge" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"knowledge_base_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"avatar" text,
	"department_id" integer,
	"instructions" text DEFAULT '',
	"ai_model" text DEFAULT 'gpt-5.2',
	"monthly_budget" real DEFAULT 100,
	"used_budget" real DEFAULT 0,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department_id" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'internal',
	"content" text DEFAULT '',
	"source_url" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onec_cost_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"crm_order_id" integer NOT NULL,
	"doc_ref_key" text NOT NULL,
	"doc_number" text,
	"doc_date" timestamp,
	"cost_sum" real NOT NULL,
	"currency_code" text,
	"exchange_rate" real,
	"multiplier" real,
	"cost_eur" real,
	"synced_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onesc_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"odata_url" text NOT NULL,
	"secret_key_login" text NOT NULL,
	"secret_key_password" text NOT NULL,
	"status" text DEFAULT 'pending',
	"last_error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"staff_id" integer,
	"department_id" integer,
	"group_id" integer,
	"direction" text NOT NULL,
	"amount_total" real DEFAULT 0 NOT NULL,
	"amount_newmen" real DEFAULT 0,
	"amount_vatebo" real DEFAULT 0,
	"pct_newmen" real DEFAULT 0,
	"pct_vatebo" real DEFAULT 0,
	"currency" text DEFAULT 'RUB',
	"amount_original" real,
	"staff_name" text
);
--> statement-breakpoint
CREATE TABLE "payroll_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pochta_pending_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"barcodes" jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_check_at" timestamp,
	"check_count" integer DEFAULT 0 NOT NULL,
	"result_received_at" timestamp,
	"error" text,
	"result_found" integer,
	"result_not_found" integer,
	CONSTRAINT "pochta_pending_tickets_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "pochta_tracking_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"barcode" text NOT NULL,
	"last_status" text NOT NULL,
	"last_status_detail" text,
	"last_oper_date" text,
	"index_oper" text,
	"operations_json" jsonb,
	"checked_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_crm_export_status" text,
	"last_crm_export_at" timestamp,
	CONSTRAINT "pochta_tracking_cache_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
CREATE TABLE "process_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"status" text DEFAULT 'running',
	"current_step_id" integer,
	"result" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "process_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"process_id" integer NOT NULL,
	"employee_id" integer,
	"order" integer NOT NULL,
	"name" text NOT NULL,
	"instructions" text DEFAULT '',
	"condition_type" text DEFAULT 'always',
	"condition_expression" text,
	"next_step_on_true" integer,
	"next_step_on_false" integer
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text DEFAULT 'manual',
	"schedule" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retailcrm_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"subdomain" text NOT NULL,
	"secret_key" text NOT NULL,
	"status" text DEFAULT 'pending',
	"last_error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retailcrm_orders_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"created_date" text NOT NULL,
	"status" text NOT NULL,
	"site" text,
	"total_sum" real DEFAULT 0,
	"payload" jsonb NOT NULL,
	"cached_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "retailcrm_orders_cache_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "return_conditions" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"store_name" text NOT NULL,
	"return_period_days" text,
	"return_period_starts_from" text,
	"return_initiation_type" text,
	"is_free_return" text,
	"return_shipping_payer" text,
	"return_cost_eur" text,
	"return_label_provided" text,
	"refund_method" text,
	"refund_period_days" text,
	"return_address_country" text,
	"partial_return_allowed" text,
	"notes" text,
	"policy_page_url" text,
	"ai_confidence" text,
	"status" text DEFAULT 'pending',
	"error" text,
	"ai_model" text,
	"raw_response" text,
	"collected_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revolut_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"secret_key" text NOT NULL,
	"environment" text DEFAULT 'sandbox',
	"status" text DEFAULT 'pending',
	"last_error" text,
	"client_id" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"email" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"login_url" text,
	"notes" text,
	"status" text DEFAULT 'active',
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_order_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"crm_order_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"shop_order_id" text,
	"previous_status" text,
	"new_status" text,
	"tracking_number" text,
	"check_result" text NOT NULL,
	"error_message" text,
	"screenshot_path" text,
	"duration_ms" integer,
	"ai_tokens_used" integer DEFAULT 0,
	"recipe_used" boolean DEFAULT false,
	"checked_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"login_type" text NOT NULL,
	"recipe_json" jsonb NOT NULL,
	"success_count" integer DEFAULT 0,
	"fail_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "shop_recipes_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"position" text NOT NULL,
	"email" text NOT NULL,
	"onesc_name" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	"group_id" integer
);
--> statement-breakpoint
CREATE TABLE "sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"date_from" text NOT NULL,
	"date_to" text NOT NULL,
	"status" text NOT NULL,
	"orders_count" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'wrench',
	"type" text DEFAULT 'api',
	"config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"email_account_id" integer,
	"sender" text NOT NULL,
	"sender_email" text,
	"subject" text,
	"order_id" text,
	"tracking_number" text NOT NULL,
	"carrier" text NOT NULL,
	"carrier_status" text,
	"carrier_status_details" text,
	"email_date" timestamp,
	"last_checked" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wise_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tool_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"company" text,
	"secret_key" text NOT NULL,
	"environment" text DEFAULT 'sandbox',
	"status" text DEFAULT 'pending',
	"last_error" text,
	"profile_id" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"allowed_sections" text[] DEFAULT '{}',
	"is_admin" boolean DEFAULT false,
	"added_by" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "allowed_emails_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"is_admin" boolean DEFAULT false,
	"is_approved" boolean DEFAULT false,
	"allowed_sections" text[] DEFAULT '{}',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bunq_accounts" ADD CONSTRAINT "bunq_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_chat_messages" ADD CONSTRAINT "employee_chat_messages_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_knowledge" ADD CONSTRAINT "employee_knowledge_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_knowledge" ADD CONSTRAINT "employee_knowledge_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_tools" ADD CONSTRAINT "employee_tools_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_tools" ADD CONSTRAINT "employee_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onesc_accounts" ADD CONSTRAINT "onesc_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_runs" ADD CONSTRAINT "process_runs_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retailcrm_accounts" ADD CONSTRAINT "retailcrm_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revolut_accounts" ADD CONSTRAINT "revolut_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_email_account_id_email_accounts_id_fk" FOREIGN KEY ("email_account_id") REFERENCES "public"."email_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wise_accounts" ADD CONSTRAINT "wise_accounts_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "currency_rates_date_code_idx" ON "currency_rates" USING btree ("date","currency_code");--> statement-breakpoint
CREATE UNIQUE INDEX "onec_cost_crm_order_idx" ON "onec_cost_cache" USING btree ("crm_order_id","doc_ref_key");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_credentials_domain_email_idx" ON "shop_credentials" USING btree ("domain","email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_staff_dept_group" ON "staff_assignments" USING btree ("staff_id","department_id","group_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");