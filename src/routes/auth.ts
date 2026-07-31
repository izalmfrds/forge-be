import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { authRequired, signAccessToken } from "../lib/auth.js";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

router.post("/register", asyncHandler(async (req, res) => {
  const input = credentialsSchema.extend({
    name: z.string().trim().min(1).max(80).optional(),
  }).parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError(409, "EMAIL_TAKEN", "Email is already registered");

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      password: await bcrypt.hash(input.password, 12),
    },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return res.status(201).json({ user, token: signAccessToken(user) });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const input = credentialsSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.password))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }
  return res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token: signAccessToken(user),
  });
}));

router.get("/me", authRequired, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
  return res.json(user);
}));

export default router;
