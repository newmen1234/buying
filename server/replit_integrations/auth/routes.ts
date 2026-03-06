import type { Express } from "express";
import { authStorage, allowedEmailsStorage, isAllowedDomain } from "./storage";
import { isAuthenticated } from "./replitAuth";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id || req.user.claims?.sub;
      const email = req.user.email;
      
      // Try to find by ID first, then by email
      let user = await authStorage.getUser(userId);
      if (!user && email) {
        user = await authStorage.getUserByEmail(email);
      }
      
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get all allowed emails (admin only)
  app.get("/api/allowed-emails", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id || req.user.claims?.sub;
      const email = req.user.email;
      let user = await authStorage.getUser(userId);
      if (!user && email) {
        user = await authStorage.getUserByEmail(email);
      }
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const emails = await allowedEmailsStorage.getAll();
      res.json(emails);
    } catch (error) {
      console.error("Error fetching allowed emails:", error);
      res.status(500).json({ message: "Failed to fetch allowed emails" });
    }
  });

  // Add allowed email with pre-configured sections (admin only)
  app.post("/api/allowed-emails", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id || req.user.claims?.sub;
      const userEmail = req.user.email;
      let user = await authStorage.getUser(userId);
      if (!user && userEmail) {
        user = await authStorage.getUserByEmail(userEmail);
      }
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { email, allowedSections = [], isAdmin = false } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      
      // Validate email is from allowed domain
      if (!isAllowedDomain(email)) {
        return res.status(400).json({ message: "Email must be from @newmen.info domain" });
      }
      
      const entry = await allowedEmailsStorage.add(email, allowedSections, isAdmin, user.email || undefined);
      res.json(entry);
    } catch (error: any) {
      console.error("Error adding allowed email:", error);
      if (error.code === "23505") {
        return res.status(400).json({ message: "Email already in list" });
      }
      res.status(500).json({ message: "Failed to add email" });
    }
  });

  // Update allowed email sections (admin only)
  app.patch("/api/allowed-emails/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id || req.user.claims?.sub;
      const email = req.user.email;
      let user = await authStorage.getUser(userId);
      if (!user && email) {
        user = await authStorage.getUserByEmail(email);
      }
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const { allowedSections = [], isAdmin = false } = req.body;
      const entry = await allowedEmailsStorage.update(req.params.id, allowedSections, isAdmin);
      if (!entry) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(entry);
    } catch (error) {
      console.error("Error updating allowed email:", error);
      res.status(500).json({ message: "Failed to update" });
    }
  });

  // Remove allowed email (admin only)
  app.delete("/api/allowed-emails/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id || req.user.claims?.sub;
      const email = req.user.email;
      let user = await authStorage.getUser(userId);
      if (!user && email) {
        user = await authStorage.getUserByEmail(email);
      }
      if (!user?.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      await allowedEmailsStorage.remove(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error removing allowed email:", error);
      res.status(500).json({ message: "Failed to remove email" });
    }
  });
}
