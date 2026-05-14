import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Get or create my coach code ───────────────────────────────
export const getMyCoachCode = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("coachCodes")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
  },
});

export const createCoachCode = mutation({
  args: { coachName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("coachCodes")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (existing) return existing;
    const code = "COACH-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const id = await ctx.db.insert("coachCodes", {
      clerkId: identity.subject,
      code,
      coachName: args.coachName,
      createdAt: Date.now(),
    });
    return await ctx.db.get(id);
  },
});

// ── Get my roster ─────────────────────────────────────────────
export const getMyRoster = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const roster = await ctx.db
      .query("coachRoster")
      .withIndex("by_coach", (q) => q.eq("coachClerkId", identity.subject))
      .take(100);
    // Batch-fetch profiles for connected students
    const studentIds = roster.filter(e => e.studentClerkId).map(e => e.studentClerkId!);
    const profiles = await Promise.all(
      [...new Set(studentIds)].map(id =>
        ctx.db.query("profiles").withIndex("by_clerk_id", (q) => q.eq("clerkId", id)).first()
      )
    );
    const profileMap = new Map(profiles.filter(Boolean).map(p => [p!.clerkId, p]));
    return roster.map(entry => ({
      ...entry,
      profile: entry.studentClerkId ? profileMap.get(entry.studentClerkId) ?? null : null,
    }));
  },
});

// ── Add player to roster ──────────────────────────────────────
export const addPlayerToRoster = mutation({
  args: { studentName: v.string(), studentEmail: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const coachCode = await ctx.db
      .query("coachCodes")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
    if (!coachCode) throw new Error("Create a coach code first");
    return await ctx.db.insert("coachRoster", {
      coachClerkId: identity.subject,
      studentName: args.studentName,
      studentEmail: args.studentEmail,
      coachCode: coachCode.code,
      connected: false,
      addedAt: Date.now(),
    });
  },
});

// ── Remove player from roster ────────────────────────────────
export const removePlayerFromRoster = mutation({
  args: { rosterId: v.id("coachRoster") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const entry = await ctx.db.get(args.rosterId);
    if (!entry || entry.coachClerkId !== identity.subject) throw new Error("Not authorized");
    await ctx.db.delete(args.rosterId);
  },
});

// ── Update coach notes on a player ───────────────────────────
export const updatePlayerNotes = mutation({
  args: { rosterId: v.id("coachRoster"), notes: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const entry = await ctx.db.get(args.rosterId);
    if (!entry || entry.coachClerkId !== identity.subject) throw new Error("Not authorized");
    await ctx.db.patch(args.rosterId, { notes: args.notes });
  },
});

// ── Connect student to coach via code ─────────────────────────
// Called when a student enters a coach code in settings
export const connectToCoach = mutation({
  args: { coachCode: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const code = await ctx.db
      .query("coachCodes")
      .withIndex("by_code", (q) => q.eq("code", args.coachCode.toUpperCase()))
      .first();
    if (!code) throw new Error("Coach code not found");
    // Find matching roster entry by email or update first unconnected slot
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .first();
    const rosterEntries = await ctx.db
      .query("coachRoster")
      .withIndex("by_coach_code", (q) => q.eq("coachCode", args.coachCode.toUpperCase()))
      .take(100);
    const match = rosterEntries.find(
      (e) => !e.connected && (e.studentEmail === profile?.email || !e.studentClerkId)
    );
    if (match) {
      await ctx.db.patch(match._id, {
        studentClerkId: identity.subject,
        connected: true,
      });
    }
    return code.coachName ?? "Coach";
  },
});
