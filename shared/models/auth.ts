import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar, boolean, text } from "drizzle-orm/pg-core";

// Session storage table.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

// Available sections for access control — must match sidebar menu items
export const APP_SECTIONS = [
  "dashboard",
  "shop_agent",
  "tracking_de",
  "settings",
] as const;

export type AppSection = typeof APP_SECTIONS[number];

// User storage table.
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isAdmin: boolean("is_admin").default(false),
  isApproved: boolean("is_approved").default(false),
  allowedSections: text("allowed_sections").array().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Whitelist of allowed emails with pre-configured sections
export const allowedEmails = pgTable("allowed_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull().unique(),
  allowedSections: text("allowed_sections").array().default([]),
  isAdmin: boolean("is_admin").default(false),
  addedBy: varchar("added_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AllowedEmail = typeof allowedEmails.$inferSelect;
export type InsertAllowedEmail = typeof allowedEmails.$inferInsert;
