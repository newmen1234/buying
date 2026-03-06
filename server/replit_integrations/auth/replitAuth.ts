import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { authStorage, isEmailAllowed } from "./storage";


export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

function getCallbackURL(hostname: string): string {
  return `https://${hostname}/api/callback`;
}

async function upsertUser(profile: Profile) {
  const email = profile.emails?.[0]?.value;
  console.log("upsertUser called with profile id:", profile.id, "email:", email);
  try {
    const user = await authStorage.upsertUser({
      id: profile.id,
      email: email || "",
      firstName: profile.name?.givenName || profile.displayName || "",
      lastName: profile.name?.familyName || "",
      profileImageUrl: profile.photos?.[0]?.value || "",
    });
    console.log("User upserted successfully:", user.id);
    return user;
  } catch (error) {
    console.error("Error upserting user:", error);
    throw error;
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const baseURL = process.env.PUBLIC_URL || "https://logistics.orbis.channel";
  const callbackURL = `${baseURL}/api/callback`;
  
  console.log("Google OAuth callback URL:", callbackURL);

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    console.warn("[auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
  } else {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL,
        scope: ["profile", "email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          console.log(`Google OAuth login attempt - email: "${email}", profile id: ${profile.id}, displayName: "${profile.displayName}"`);
          
          const emailAllowed = await isEmailAllowed(email);
          if (!emailAllowed) {
            console.log(`Email validation failed for: "${email}" (lowercase: "${email?.toLowerCase()}")`);
            return done(null, false, { message: "email_not_allowed" });
          }
          console.log(`Email validation passed for: "${email}"`);
          
          await upsertUser(profile);
          
          const user = {
            id: profile.id,
            email: email,
            firstName: profile.name?.givenName || profile.displayName || "",
            lastName: profile.name?.familyName || "",
            profileImageUrl: profile.photos?.[0]?.value || "",
            access_token: accessToken,
            refresh_token: refreshToken,
          };
          
          return done(null, user);
        } catch (error) {
          console.error("Auth verification error:", error);
          return done(error as Error, false);
        }
      }
    )
  );

  } // end if GOOGLE_CLIENT_ID

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    console.log("Login request - redirecting to Google OAuth");
    passport.authenticate("google", {
      scope: ["profile", "email"],
      prompt: "select_account",
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    console.log("Callback received");
    passport.authenticate("google", (err: any, user: any, info: any) => {
      console.log("Passport authenticate result - err:", err, "user:", user ? "exists" : "null", "info:", info);
      if (err) {
        console.error("Auth callback error:", err);
        return res.redirect("/?error=auth_failed");
      }
      if (!user) {
        console.log("No user returned, info:", info);
        if (info?.message === "email_not_allowed") {
          return res.redirect("/?error=email_not_allowed");
        }
        return res.redirect("/?error=no_user");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error("Login error:", loginErr);
          return res.redirect("/?error=login_failed");
        }
        console.log("User logged in successfully:", user.email);
        // Explicitly save session before redirect
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.redirect("/?error=session_failed");
          }
          console.log("Session saved successfully, redirecting...");
          return res.redirect("/");
        });
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  console.log("isAuthenticated check - session:", req.sessionID, "isAuthenticated:", req.isAuthenticated(), "user:", req.user ? "exists" : "null");
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};
