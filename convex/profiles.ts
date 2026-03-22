import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Get current user's profile ───────────────────────────────
export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("profiles")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
  },
});

// ── Upsert profile (create or update) ───────────────────────
export const upsertProfile = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    topHero: v.optional(v.string()),
    topBandit: v.optional(v.string()),
    roundsCount: v.number(),
    avgNet: v.optional(v.number()),
    handicap: v.optional(v.number()),
    source: v.string(),
    cloudSync: v.boolean(),
    legacyUid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const clerkId = identity.subject;
    const now = Date.now();

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .first();

    // Check for legacy migration — match by email
    if (!existing && args.legacyUid) {
      const byEmail = await ctx.db
        .query("profiles")
        .withIndex("by_email", (q) => q.eq("email", args.email))
        .first();
      if (byEmail) {
        // Migrate: update clerkId on existing record
        await ctx.db.patch(byEmail._id, {
          clerkId,
          lastUpdated: now,
          legacyUid: args.legacyUid,
        });
        return byEmail._id;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        topHero: args.topHero,
        topBandit: args.topBandit,
        roundsCount: args.roundsCount,
        avgNet: args.avgNet,
        handicap: args.handicap,
        lastUpdated: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("profiles", {
      clerkId,
      email: args.email,
      name: args.name,
      topHero: args.topHero,
      topBandit: args.topBandit,
      roundsCount: args.roundsCount,
      avgNet: args.avgNet,
      handicap: args.handicap,
      source: args.source,
      cloudSync: args.cloudSync,
      optedIn: true,
      legacyUid: args.legacyUid,
      joinedAt: now,
      lastUpdated: now,
    });
  },
});

// ── Admin: list all profiles (requires admin check) ──────────
export const listAllProfiles = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    // Only allow if user has admin email
    const adminEmails = (import.meta.env?.VITE_ADMIN_EMAILS || "").split(",");
    if (!adminEmails.includes(identity.email)) {
      throw new Error("Not authorized");
    }
    return await ctx.db.query("profiles").collect();
  },
});

// ── Opt out of emails ────────────────────────────────────────
export const optOut = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (profile) {
      await ctx.db.patch(profile._id, { optedIn: false, lastUpdated: Date.now() });
    }
  },
});

// ── Delete my profile ────────────────────────────────────────
export const deleteMyProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (profile) await ctx.db.delete(profile._id);
  },
});
