import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";

const router = Router();

// One token per fileId covers every media resource for that file (stream, subtitle, thumbnail) —
// see middleware/mediaAuth.ts. 2h expiry, not a short-lived one: this token gets re-checked on
// every Range request the browser issues over the course of playback, including seeks well into a
// long movie.
router.get("/", requireAuth, (req, res) => {
  const fileId = typeof req.query.fileId === "string" ? req.query.fileId : null;
  if (!fileId) {
    res.status(400).json({ error: "fileId is required" });
    return;
  }

  const token = jwt.sign({ fileId }, env.mediaTokenSecret, { expiresIn: "2h" });
  res.json({ token });
});

export default router;
