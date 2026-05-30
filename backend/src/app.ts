import cors from "cors";
import express, { Response } from "express";
import morgan from "morgan";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { prisma } from "./db.js";

function sendError(res: Response, status: number, message: string, code?: string) {
  return res.status(status).json({ error: message, ...(code ? { code } : {}) });
}

export function createApp() {
  const app = express();

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map(o => o.trim());

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  }));
  app.use(express.json());
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

  // ── Health check with database connectivity ────────────────────────────

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        ok: true,
        service: "NovaSupport backend",
        network: "Stellar Testnet",
        database: "connected",
      });
    } catch {
      res.status(503).json({
        ok: false,
        service: "NovaSupport backend",
        database: "unreachable",
      });
    }
  });

  // ── List profiles with pagination ──────────────────────────────────────

  app.get("/profiles", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;

      const [profiles, total] = await Promise.all([
        prisma.profile.findMany({
          take: limit,
          skip: offset,
          orderBy: { createdAt: "desc" },
          include: { acceptedAssets: true },
        }),
        prisma.profile.count(),
      ]);

      res.json({ profiles, total, limit, offset });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Get profile by username ────────────────────────────────────────────

  app.get("/profiles/:username", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
        include: {
          acceptedAssets: true,
        },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      res.json(profile);
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  const stellarAddress = z.string().refine(
    (val) => StrKey.isValidEd25519PublicKey(val),
    { message: "Must be a valid Stellar public key" }
  );

  const createProfileSchema = z.object({
    username: z.string().min(3).max(32).regex(/^[a-z0-9-]+$/),
    displayName: z.string().min(1).max(64),
    bio: z.string().max(280).optional().default(""),
    walletAddress: stellarAddress,
    email: z.string().email().optional().nullable(),
    websiteUrl: z.string().url().startsWith("https://").optional().nullable(),
    twitterHandle: z.string().max(15).regex(/^[a-zA-Z0-9_]+$/).optional().nullable(),
    githubHandle: z.string().max(39).regex(/^[a-zA-Z0-9-]+$/).optional().nullable(),
    ownerId: z.string().min(1),
    acceptedAssets: z.array(z.object({
      code: z.string().min(1).max(12),
      issuer: z.string().optional(),
    })).min(1),
  });

  app.post("/profiles", async (req, res) => {
    const parsed = createProfileSchema.safeParse(req.body);

    if (!parsed.success) {
      return sendError(res, 400, "Invalid request body");
    }

    const { username, displayName, bio, walletAddress, email, websiteUrl, twitterHandle, githubHandle, ownerId, acceptedAssets } = parsed.data;

    try {
      const profile = await prisma.profile.create({
        data: {
          username,
          displayName,
          bio,
          walletAddress,
          email,
          websiteUrl,
          twitterHandle,
          githubHandle,
          ownerId,
          acceptedAssets: { create: acceptedAssets },
        },
        include: { acceptedAssets: true },
      });
      return res.status(201).json(profile);
    } catch (e: any) {
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        const field = e.meta?.target?.includes("email") ? "Email" : "Username";
        return sendError(res, 409, `${field} already taken`, `${field.toUpperCase()}_TAKEN`);
      }
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Update profile ────────────────────────────────────────────────────

  const updateProfileSchema = z.object({
    displayName: z.string().min(1).max(64).optional(),
    bio: z.string().max(280).optional(),
    avatarUrl: z.string().url().optional().nullable(),
    email: z.string().email().optional().nullable(),
    websiteUrl: z.string().url().startsWith("https://").optional().nullable(),
    twitterHandle: z.string().max(15).regex(/^[a-zA-Z0-9_]+$/).optional().nullable(),
    githubHandle: z.string().max(39).regex(/^[a-zA-Z0-9-]+$/).optional().nullable(),
  });

  app.patch("/profiles/:username", async (req, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);

    if (!parsed.success) {
      return sendError(res, 400, "Invalid request body");
    }

    const profile = await prisma.profile.findUnique({
      where: { username: req.params.username },
    });

    if (!profile) {
      return sendError(res, 404, "Profile not found");
    }

    try {
      const updated = await prisma.profile.update({
        where: { username: req.params.username },
        data: parsed.data,
        include: { acceptedAssets: true },
      });
      return res.json(updated);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
        return sendError(res, 409, "Email already in use", "EMAIL_TAKEN");
      }
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Support transactions ───────────────────────────────────────────────

  const supportPayloadSchema = z.object({
    txHash: z.string().min(3),
    amount: z.string().min(1),
    assetCode: z.string().min(1),
    assetIssuer: z.string().optional().nullable(),
    status: z.string().default("pending"),
    message: z.string().max(280).optional().nullable(),
    stellarNetwork: z.string().default("TESTNET"),
    supporterAddress: z.string().optional().nullable(),
    recipientAddress: z.string().min(1),
    profileId: z.string().min(1),
    supporterId: z.string().optional().nullable(),
  });

  app.get("/profiles/:username/transactions", async (req, res) => {
    const { username } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;
    const network = req.query.network as string | undefined;

    const profile = await prisma.profile.findUnique({
      where: { username },
    });

    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const where = {
      recipientAddress: profile.walletAddress,
      ...(network ? { stellarNetwork: network } : {}),
    };

    const [transactions, total] = await Promise.all([
      prisma.supportTransaction.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.supportTransaction.count({ where }),
    ]);

    res.json({ transactions, total, limit, offset });
  });

  app.post("/support-transactions", async (req, res) => {
    const parsed = supportPayloadSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const supportRecord = await prisma.supportTransaction.create({
      data: parsed.data,
    });

    res.status(201).json(supportRecord);
  });

  // ── Analytics ──────────────────────────────────────────────────────────

  app.get("/analytics/:campaignId", async (req, res) => {
    // Mock analytics logic (future: fetch optimized views from DB)
    const { campaignId } = req.params;

    const data = {
      summary: {
        totalRaised: 12540.5,
        totalContributors: 142,
        avgContribution: 88.3,
        activeDrips: 12,
      },
      dailyContributions: [
        { date: "2024-03-21", amount: 450 },
        { date: "2024-03-22", amount: 620 },
        { date: "2024-03-23", amount: 380 },
        { date: "2024-03-24", amount: 940 },
        { date: "2024-03-25", amount: 1100 },
        { date: "2024-03-26", amount: 850 },
        { date: "2024-03-27", amount: 1200 },
      ],
      assetBreakdown: [
        { name: "XLM", value: 8500 },
        { name: "USDC", value: 3200 },
        { name: "AQUA", value: 840.5 },
      ],
    };

    if (campaignId === "error") {
      return sendError(res, 404, "Analytics not found for this campaign");
    }

    res.json(data);
  });

  // ── Analytics Timeseries (profile-based, with period-over-period) ─────

  const timeseriesPeriodSchema = z.enum(["daily", "weekly", "monthly"]);

  function groupTransactionsByPeriod(
    transactions: { createdAt: Date; amount: string }[],
    period: string,
    from: Date,
    to: Date,
  ) {
    const buckets: Record<string, number> = {};
    const fmt = period === "monthly" ? "yyyy-MM" : period === "weekly" ? "yyyy-ww" : "yyyy-MM-dd";

    for (const tx of transactions) {
      const d = tx.createdAt;
      const key = period === "monthly"
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : period === "weekly"
          ? getWeekKey(d)
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      buckets[key] = (buckets[key] || 0) + parseFloat(tx.amount.toString());
    }

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount: parseFloat(amount.toFixed(7)) }));
  }

  function getWeekKey(d: Date): string {
    const start = new Date(d.getTime());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
  }

  app.get("/profiles/:username/analytics/timeseries", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const compare = req.query.compare === "true";
      const periodParsed = timeseriesPeriodSchema.safeParse(req.query.period ?? "daily");
      const period = periodParsed.success ? periodParsed.data : "daily";

      const to = req.query.to ? new Date(req.query.to as string) : new Date();
      const from = req.query.from
        ? new Date(req.query.from as string)
        : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

      const currentTxs = await prisma.supportTransaction.findMany({
        where: {
          recipientAddress: profile.walletAddress,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: "asc" },
      });

      const currentTotal = currentTxs.reduce((sum, tx) => sum + parseFloat(tx.amount.toString()), 0);
      const currentTxCount = currentTxs.length;
      const data = groupTransactionsByPeriod(currentTxs, period, from, to);

      let previousTotal = 0;
      let previousTxCount = 0;
      let changePercent: number | null = null;
      let txCountChangePercent: number | null = null;

      if (compare) {
        const periodMs = to.getTime() - from.getTime();
        const prevFrom = new Date(from.getTime() - periodMs);
        const prevTo = new Date(from.getTime());

        const prevTxs = await prisma.supportTransaction.findMany({
          where: {
            recipientAddress: profile.walletAddress,
            createdAt: { gte: prevFrom, lt: prevTo },
          },
        });

        previousTotal = prevTxs.reduce((sum, tx) => sum + parseFloat(tx.amount.toString()), 0);
        previousTxCount = prevTxs.length;

        if (previousTotal > 0) {
          changePercent = Math.round(((currentTotal - previousTotal) / previousTotal) * 10000) / 100;
        }
        if (previousTxCount > 0) {
          txCountChangePercent = Math.round(((currentTxCount - previousTxCount) / previousTxCount) * 10000) / 100;
        }
      }

      res.json({
        period,
        data,
        summary: {
          currentTotal: currentTotal.toFixed(7),
          previousTotal: previousTotal.toFixed(7),
          changePercent,
          currentTxCount,
          previousTxCount,
          txCountChangePercent,
        },
      });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Profile Stats ──────────────────────────────────────────────────────

  app.get("/profiles/:username/stats", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const [transactions, uniqueSupporters] = await Promise.all([
        prisma.supportTransaction.findMany({
          where: { recipientAddress: profile.walletAddress },
        }),
        prisma.supportTransaction.findMany({
          where: { recipientAddress: profile.walletAddress },
          distinct: ["supporterAddress"],
          select: { supporterAddress: true },
        }),
      ]);

      const assetBreakdown: Record<string, number> = {};
      let totalEarned = 0;

      transactions.forEach((tx) => {
        const amount = parseFloat(tx.amount.toString());
        totalEarned += amount;
        const key = `${tx.assetCode}${tx.assetIssuer ? `:${tx.assetIssuer}` : ""}`;
        assetBreakdown[key] = (assetBreakdown[key] || 0) + amount;
      });

      res.json({
        totalEarned,
        totalTransactions: transactions.length,
        uniqueSupporters: uniqueSupporters.length,
        assetBreakdown,
      });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Milestones ─────────────────────────────────────────────────────────

  const createMilestoneSchema = z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional().nullable(),
    targetAmount: z.string().min(1),
    assetCode: z.string().default("XLM"),
  });

  app.post("/profiles/:username/milestones", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const parsed = createMilestoneSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, "Invalid request body");
      }

      const milestone = await prisma.milestone.create({
        data: {
          title: parsed.data.title,
          description: parsed.data.description,
          targetAmount: parsed.data.targetAmount,
          assetCode: parsed.data.assetCode,
          profileId: profile.id,
        },
      });

      res.status(201).json(milestone);
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.get("/profiles/:username/milestones", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const milestones = await prisma.milestone.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({ milestones });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.patch("/profiles/:username/milestones/:milestoneId", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const milestone = await prisma.milestone.findUnique({
        where: { id: req.params.milestoneId },
      });

      if (!milestone || milestone.profileId !== profile.id) {
        return sendError(res, 404, "Milestone not found");
      }

      const parsed = createMilestoneSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, "Invalid request body");
      }

      const updated = await prisma.milestone.update({
        where: { id: req.params.milestoneId },
        data: parsed.data,
      });

      res.json(updated);
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.delete("/profiles/:username/milestones/:milestoneId", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const milestone = await prisma.milestone.findUnique({
        where: { id: req.params.milestoneId },
      });

      if (!milestone || milestone.profileId !== profile.id) {
        return sendError(res, 404, "Milestone not found");
      }

      await prisma.milestone.delete({
        where: { id: req.params.milestoneId },
      });

      res.status(204).send();
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Webhooks ───────────────────────────────────────────────────────────

  const createWebhookSchema = z.object({
    url: z.string().url().startsWith("https://"),
  });

  function generateSecret(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let secret = "";
    for (let i = 0; i < 48; i++) {
      secret += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return secret;
  }

  app.get("/profiles/:username/webhooks", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const webhooks = await prisma.webhook.findMany({
        where: { profileId: profile.id },
        orderBy: { createdAt: "desc" },
      });

      res.json({ webhooks });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.post("/profiles/:username/webhooks", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const parsed = createWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(res, 400, "Invalid request body");
      }

      const secret = generateSecret();

      const webhook = await prisma.webhook.create({
        data: {
          url: parsed.data.url,
          secret,
          profileId: profile.id,
        },
      });

      res.status(201).json(webhook);
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.delete("/profiles/:username/webhooks/:webhookId", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const webhook = await prisma.webhook.findUnique({
        where: { id: req.params.webhookId },
      });

      if (!webhook || webhook.profileId !== profile.id) {
        return sendError(res, 404, "Webhook not found");
      }

      await prisma.webhook.delete({
        where: { id: req.params.webhookId },
      });

      res.status(204).send();
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  app.get("/profiles/:username/webhooks/:webhookId/deliveries", async (req, res) => {
    try {
      const profile = await prisma.profile.findUnique({
        where: { username: req.params.username },
      });

      if (!profile) {
        return sendError(res, 404, "Profile not found");
      }

      const webhook = await prisma.webhook.findUnique({
        where: { id: req.params.webhookId },
      });

      if (!webhook || webhook.profileId !== profile.id) {
        return sendError(res, 404, "Webhook not found");
      }

      const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: webhook.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      });

      res.json({ deliveries });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  // ── Supporters ─────────────────────────────────────────────────────────

  app.get("/supporters/:address", async (req, res) => {
    try {
      const { address } = req.params;

      if (!StrKey.isValidEd25519PublicKey(address)) {
        return sendError(res, 400, "Invalid Stellar address");
      }

      const transactions = await prisma.supportTransaction.findMany({
        where: { supporterAddress: address },
        include: { profile: true },
        orderBy: { createdAt: "desc" },
      });

      if (transactions.length === 0) {
        return res.json({
          address,
          totalTransactions: 0,
          profilesSupported: 0,
          totalByAsset: {},
          transactions: [],
        });
      }

      const profilesSupported = new Set(transactions.map((tx) => tx.profileId)).size;
      const totalByAsset: Record<string, number> = {};

      transactions.forEach((tx) => {
        const amount = parseFloat(tx.amount.toString());
        const key = `${tx.assetCode}${tx.assetIssuer ? `:${tx.assetIssuer}` : ""}`;
        totalByAsset[key] = (totalByAsset[key] || 0) + amount;
      });

      res.json({
        address,
        totalTransactions: transactions.length,
        profilesSupported,
        totalByAsset,
        transactions: transactions.map((tx) => ({
          id: tx.id,
          amount: tx.amount.toString(),
          assetCode: tx.assetCode,
          assetIssuer: tx.assetIssuer,
          txHash: tx.txHash,
          createdAt: tx.createdAt,
          profile: {
            username: tx.profile.username,
            displayName: tx.profile.displayName,
          },
        })),
      });
    } catch {
      return sendError(res, 500, "Internal server error");
    }
  });

  return app;
}

export const app = createApp();
