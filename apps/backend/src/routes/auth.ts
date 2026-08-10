import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { createUser, EmailAlreadyRegisteredError, getUserByEmail, getUserById, verifyPassword } from "../lib/users";
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
