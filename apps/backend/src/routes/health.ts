import { Router } from "express";
import { getDb } from "../lib/mongodb";

const router = Router();

router.get("/db", async (_req, res) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

export default router;
