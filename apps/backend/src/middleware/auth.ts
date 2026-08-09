import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { isAdminEmail } from "../lib/admin";

export type AuthUser = { userId: string; email: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Named `authUser`, not `user` — Passport's own type augmentation already claims `req.user`
    // (as `Express.User`, used transiently during the OAuth handshake in routes/auth.ts) and a
    // second, differently-typed `user` declaration on the same interface would conflict.
    interface Request {
      authUser?: AuthUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = jwt.verify(token, env.authJwtSecret) as AuthUser;
    req.authUser = { userId: payload.userId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!isAdminEmail(req.authUser?.email)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}
