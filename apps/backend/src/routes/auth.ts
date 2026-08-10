import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { upsertUser, getUserById } from "../lib/users";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";

passport.use(
  new GoogleStrategy(
    {
      clientID: env.googleClientId,
      clientSecret: env.googleClientSecret,
      callbackURL: env.authCallbackUrl,
    },
    (_accessToken, _refreshToken, profile: Profile, done) => {
      done(null, profile);
    },
  ),
);

const router = Router();

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"], session: false }));

router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${env.frontendUrl}/login?error=1` }),
  async (req, res) => {
    const profile = req.user as Profile;
    const email = profile.emails?.[0]?.value;
    if (!email) {
      res.redirect(`${env.frontendUrl}/login?error=1`);
      return;
    }

    const user = await upsertUser({
      googleId: profile.id,
      email,
      name: profile.displayName ?? null,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    });

    const token = jwt.sign({ userId: user._id, email: user.email }, env.authJwtSecret, {
      expiresIn: "30d",
    });

    res.redirect(`${env.frontendUrl}/login#token=${token}`);
  },
);

const mobileOAuthClient = new OAuth2Client();

// The mobile app (apps/mobile) signs in natively via google_sign_in — no browser redirect, no
// callback URL — and hands us the resulting Google ID token to exchange for our own session JWT,
// same as the web OAuth callback above does after its handshake. `audience` must list every
// platform-specific OAuth client (Android/iOS) the token could have been minted for; the web
// client id is also accepted since Flutter Web (used for local dev/testing) authenticates against
// it. Requires GOOGLE_ANDROID_CLIENT_ID/GOOGLE_IOS_CLIENT_ID to be configured — see apps/mobile's
// README for the Google Cloud setup this needs (SHA-1 fingerprint / bundle id registration).
router.post("/google/mobile", async (req, res) => {
  const { idToken } = req.body as { idToken?: string };
  if (!idToken) {
    res.status(400).json({ error: "idToken is required" });
    return;
  }

  const audience = [env.googleClientId, ...env.googleMobileClientIds];

  let payload;
  try {
    const ticket = await mobileOAuthClient.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "Invalid Google ID token" });
    return;
  }

  const email = payload?.email;
  const googleId = payload?.sub;
  if (!email || !googleId) {
    res.status(401).json({ error: "Invalid Google ID token" });
    return;
  }

  const user = await upsertUser({
    googleId,
    email,
    name: payload?.name ?? null,
    avatarUrl: payload?.picture ?? null,
  });

  const token = jwt.sign({ userId: user._id, email: user.email }, env.authJwtSecret, {
    expiresIn: "30d",
  });

  res.json({ token });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await getUserById(req.authUser!.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    userId: user._id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isAdmin: isAdminEmail(user.email),
  });
});

export default router;
