import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
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
