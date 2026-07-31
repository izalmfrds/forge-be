import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { AppError } from "./errors.js";

type TokenPayload = {
  sub: string;
  email: string;
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change-me-in-production") {
    throw new AppError(500, "SERVER_MISCONFIGURED", "JWT_SECRET is not configured");
  }
  return secret;
}

export function signAccessToken(user: { id: string; email: string }) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret(), { expiresIn: "7d" });
}

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  if (process.env.AUTH_DISABLED === "true" && process.env.NODE_ENV !== "production") {
    req.auth = {
      userId: process.env.DEV_USER_ID || "dev-user",
      email: process.env.DEV_USER_EMAIL || "dev@forge.local",
    };
    return next();
  }

  const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return next(new AppError(401, "UNAUTHORIZED", "Bearer token is required"));

  try {
    const payload = jwt.verify(token, jwtSecret()) as TokenPayload;
    req.auth = { userId: payload.sub, email: payload.email };
    return next();
  } catch {
    return next(new AppError(401, "INVALID_TOKEN", "Access token is invalid or expired"));
  }
}

export async function assertProjectAccess(projectId: string, userId: string, roles?: string[]) {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true, project: { select: { deletedAt: true } } },
  });
  if (!membership || membership.project.deletedAt) {
    throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  if (roles && !roles.includes(membership.role)) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
  }
  return membership;
}
