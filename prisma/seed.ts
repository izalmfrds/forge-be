import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createRequirementDraft } from "../src/services/requirements.js";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL || "demo@forge.local";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      id: process.env.DEV_USER_ID || "dev-user",
      email,
      name: "Forge Demo",
      password: await bcrypt.hash(process.env.SEED_USER_PASSWORD || "forge-demo-123", 12),
    },
  });
  const existing = await prisma.project.findFirst({ where: { name: "Atlas", createdBy: user.id } });
  if (existing) return;

  const project = await prisma.project.create({
    data: {
      name: "Atlas",
      type: "Brand system",
      desc: "Identity, tokens, and the marketing site rebuild.",
      stage: 1,
      prog: 40,
      req: true,
      reqVersion: 1,
      reqUpdatedAt: new Date(),
      createdBy: user.id,
      owners: [user.id],
      members: { create: { userId: user.id, role: "owner" } },
      screens: {
        create: {
          name: "Atlas Design",
          w: 3000,
          h: 1024,
          nodes: [],
          guides: [],
        },
      },
    },
  });
  const requirement = createRequirementDraft(project);
  await prisma.requirement.create({
    data: {
      projectId: project.id,
      version: 1,
      prd: requirement.prd,
      stories: requirement.stories,
      fr: requirement.fr,
      nfr: requirement.nfr,
      ac: requirement.ac,
      rules: requirement.rules,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
