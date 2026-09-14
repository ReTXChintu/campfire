import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { claimPairing, pollAndConsumePairing, startPairing } from "../lib/devicePairings";
import {
  createUser,
  EmailAlreadyRegisteredError,
  getUserByEmail,
  getUserById,
  resetPassword,
  verifyPassword,
} from "../lib/users";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";

const router = Router();

const MIN_PASSWORD_LENGTH = 8;

function signToken(user: { _id: string; email: string }): string {
  return jwt.sign({ userId: user._id, email: user.email }, env.authJwtSecret, { expiresIn: "30d" });
}

// No Google OAuth — a self-issued JWT, no session store. The one admin account is seeded from
// .env at startup (see lib/users.ts's seedAdminUser); everyone else signs up below. Both web and
// mobile hit these same routes.
router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const user = await getUserByEmail(email);
  const valid = user ? await verifyPassword(user, password) : false;
  if (!user || !valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  res.json({ token: signToken(user) });
});

// Open signup, no invite code — matches the old "any Google account can sign in" behavior, just
// with a password instead of an OAuth handshake. Never grants admin (see lib/admin.ts).
router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }

  let user;
  try {
    user = await createUser({ email, password, name: name?.trim() || null });
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
  }

  res.json({ token: signToken(user) });
});

// No email/token step, no old-password check — personal-use app, forgetting the password
// shouldn't lock anyone out. See lib/users.ts's resetPassword for the admin-account caveat.
router.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body as { email?: string; newPassword?: string };
  if (!email || !newPassword) {
    res.status(400).json({ error: "email and newPassword are required" });
    return;
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }

  const updated = await resetPassword(email, newPassword);
  if (!updated) {
    res.status(404).json({ error: "No account with that email" });
    return;
  }

  const user = await getUserByEmail(email);
  res.json({ token: signToken(user!) });
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

// TV pairing-code login — a TV isn't logged in yet, so it shows a short human-typeable code (and a
// QR code encoding a claim URL) instead of a password field; a phone/browser that's already logged
// in claims it, and the TV polls until claimed. See lib/devicePairings.ts.
router.post("/pair/start", async (_req, res) => {
  const { code, expiresAt } = await startPairing();
  res.json({ code, expiresAt: expiresAt.toISOString() });
});

router.post("/pair/claim", requireAuth, async (req, res) => {
  const { code } = req.body as { code?: string };
  if (!code) {
    res.status(400).json({ error: "code is required" });
    return;
  }
  const claimed = await claimPairing(code.trim().toUpperCase(), req.authUser!.userId);
  if (!claimed) {
    res.status(404).json({ error: "Invalid or expired code" });
    return;
  }
  res.json({ ok: true });
});

router.get("/pair/poll/:code", async (req, res) => {
  const result = await pollAndConsumePairing(req.params.code.trim().toUpperCase());
  if (result.status === "not_found") {
    res.status(404).json({ error: "Invalid or expired code" });
    return;
  }
  if (result.status === "pending") {
    res.json({ status: "pending" });
    return;
  }
  const user = await getUserById(result.userId);
  if (!user) {
    res.status(404).json({ error: "Account no longer exists" });
    return;
  }
  res.json({ status: "claimed", token: signToken(user) });
});

export default router;
