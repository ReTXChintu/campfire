import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { requireAuth } from "./auth";

type MediaTokenPayload = { fileId: string };

/** Accepts either a normal Bearer-authenticated request, or a `?token=` scoped media token minted
 * by GET /api/media-token — the latter is what lets a plain <video>/<img>/<track> src (which can't
 * send an Authorization header) reach these routes while still requiring the token to have been
 * minted for exactly this :fileId (or :folderId, for the folder-thumbnail route). */
export function requireMediaAccess(paramName: "fileId" | "folderId") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!token) {
      requireAuth(req, res, next);
      return;
    }

    try {
      const payload = jwt.verify(token, env.mediaTokenSecret) as MediaTokenPayload;
      if (payload.fileId !== req.params[paramName]) {
        res.status(403).json({ error: "Token not valid for this resource" });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
}
