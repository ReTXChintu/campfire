import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { getUserByEmail, getUserById, verifyPassword } from "../lib/users";
import { requireAuth } from "../middleware/auth";
import { isAdminEmail } from "../lib/admin";

const router = Router();

// No Google OAuth, no signup — a single admin account, seeded from .env at startup (see
// lib/users.ts's seedAdminUser, called from index.ts). Both web and mobile hit this same route.
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
