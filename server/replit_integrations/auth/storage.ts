import { users, allowedEmails, type User, type UpsertUser, type AllowedEmail, APP_SECTIONS } from "@shared/models/auth";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";

// Allowed domain for login (required)
const ALLOWED_DOMAIN = "newmen.info";

// Interface for auth storage operations
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getUserCount(): Promise<number>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return result[0]?.count || 0;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    console.log("upsertUser called with:", JSON.stringify(userData));
    
    try {
      // Check if user already exists by email
      const [existingByEmail] = await db.select().from(users).where(eq(users.email, userData.email || ""));
      console.log("Existing user by email:", existingByEmail?.id || "none");
      
      if (existingByEmail) {
        // Update existing user (keep their admin/approved status)
        const [updated] = await db
          .update(users)
          .set({
            id: userData.id, // Update to Google ID
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.email, userData.email || ""))
          .returning();
        console.log("User updated:", updated.id);
        return updated;
      }

      // Check if this is the first user - make them admin with full access
      const userCount = await this.getUserCount();
      const isFirstUser = userCount === 0;
      console.log("User count:", userCount, "isFirstUser:", isFirstUser);

      // Check if email is pre-configured in whitelist
      const whitelistEntry = await allowedEmailsStorage.getByEmail(userData.email || "");
      console.log("Whitelist entry:", whitelistEntry?.email || "none");

      // Create new user with pre-configured settings from whitelist
      const [user] = await db
        .insert(users)
        .values({
          ...userData,
          isAdmin: isFirstUser || (whitelistEntry?.isAdmin ?? false),
          isApproved: isFirstUser || !!whitelistEntry,
          allowedSections: isFirstUser 
            ? APP_SECTIONS as unknown as string[] 
            : (whitelistEntry?.allowedSections || []),
        })
        .returning();
      console.log("User created:", user.id, "isAdmin:", user.isAdmin, "isApproved:", user.isApproved);

      // Remove whitelist entry after user is created (invitation consumed)
      if (whitelistEntry) {
        await allowedEmailsStorage.remove(whitelistEntry.id);
        console.log("Whitelist entry removed:", whitelistEntry.email);
      }

      return user;
    } catch (error) {
      console.error("Error in upsertUser:", error);
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();

// Allowed emails storage
class AllowedEmailsStorage {
  async getAll(): Promise<AllowedEmail[]> {
    return await db.select().from(allowedEmails).orderBy(allowedEmails.createdAt);
  }

  async add(email: string, sections: string[], isAdmin: boolean, addedBy?: string): Promise<AllowedEmail> {
    const [entry] = await db
      .insert(allowedEmails)
      .values({ 
        email: email.toLowerCase(), 
        allowedSections: sections,
        isAdmin,
        addedBy 
      })
      .returning();
    return entry;
  }

  async update(id: string, sections: string[], isAdmin: boolean): Promise<AllowedEmail | undefined> {
    const [entry] = await db
      .update(allowedEmails)
      .set({ allowedSections: sections, isAdmin })
      .where(eq(allowedEmails.id, id))
      .returning();
    return entry;
  }

  async remove(id: string): Promise<void> {
    await db.delete(allowedEmails).where(eq(allowedEmails.id, id));
  }

  async getByEmail(email: string): Promise<AllowedEmail | undefined> {
    const [entry] = await db.select().from(allowedEmails).where(eq(allowedEmails.email, email.toLowerCase()));
    return entry;
  }

  async isEmailInWhitelist(email: string): Promise<boolean> {
    console.log(`Checking whitelist for email: "${email}" (lowercase: "${email.toLowerCase()}")`);
    const entry = await this.getByEmail(email);
    console.log(`Whitelist check result: ${entry ? "FOUND" : "NOT FOUND"}`);
    return !!entry;
  }

  async getCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(allowedEmails);
    return result[0]?.count || 0;
  }
}

export const allowedEmailsStorage = new AllowedEmailsStorage();

// Export domain check helper
export function isAllowedDomain(email: string | undefined | null): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// Check if email is allowed (domain + whitelist or existing approved user)
export async function isEmailAllowed(email: string | undefined | null): Promise<boolean> {
  if (!email) return false;
  
  // First check domain
  if (!isAllowedDomain(email)) {
    return false;
  }
  
  // Check whitelist
  const inWhitelist = await allowedEmailsStorage.isEmailInWhitelist(email);
  if (inWhitelist) return true;
  
  // Also allow existing approved users (they were previously approved)
  const existingUser = await authStorage.getUserByEmail(email);
  if (existingUser?.isApproved) {
    console.log(`Email "${email}" not in whitelist but is an existing approved user - allowing`);
    return true;
  }
  
  return false;
}
