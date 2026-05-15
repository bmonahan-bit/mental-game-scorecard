import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Check if current user has an active subscription ────────
export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    if (!sub) return null;
    // Return sub with computed active flag (queries can't write)
    const now = Date.now();
    const isActive = (sub.status === "active" || sub.status === "trialing") && sub.expiresAt > now;
    return { ...sub, isActive };
  },
});

// ── Activate subscription (called after StoreKit purchase) ──
export const activateSubscription = mutation({
  args: {
    plan: v.string(),
    platform: v.optional(v.string()),
    appleTransactionId: v.optional(v.string()),
    appleOriginalTransactionId: v.optional(v.string()),
    googleOrderId: v.optional(v.string()),
    googlePurchaseToken: v.optional(v.string()),
    expiresAt: v.float64(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const userId = identity.subject;
    const now = Date.now();

    // Check for existing subscription
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const fields = {
      status: "active" as const,
      plan: args.plan,
      platform: args.platform,
      appleTransactionId: args.appleTransactionId,
      appleOriginalTransactionId: args.appleOriginalTransactionId,
      googleOrderId: args.googleOrderId,
      googlePurchaseToken: args.googlePurchaseToken,
      expiresAt: args.expiresAt,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }

    return await ctx.db.insert("subscriptions", {
      ...fields,
      userId,
      startsAt: now,
    });
  },
});

// ── Cancel subscription ─────────────────────────────────────
export const cancelSubscription = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .first();
    if (sub) {
      await ctx.db.patch(sub._id, {
        status: "cancelled",
        cancelledAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});
