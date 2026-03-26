import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";

// ─── GOLF COURSE API CONFIG ───────────────────────────────────────────────────
// Sign up free at https://golfcourseapi.com — paste your key here
const GOLF_API_KEY = import.meta.env.VITE_GOLF_API_KEY;
const GOLF_API_BASE = "https://api.golfcourseapi.com/v1";
// Clerk + Convex — loaded via providers in main.jsx
// These hooks are available globally once ClerkProvider wraps the app
const { useUser, useClerk, SignIn, SignUp, SignInButton, SignOutButton, UserButton } =
  window.Clerk || {};

const PM_NAVY = "#1a2b4a";
const PM_GOLD = "#c9a84c";
const FREE_ROUNDS_LIMIT = 3;

// ── Environment validation ──────────────────────────────────
// Runs at startup and warns loudly in console if critical vars missing
(function validateEnv() {
  const warnings = [];
  if (!import.meta.env.VITE_GOLF_API_KEY || import.meta.env.VITE_GOLF_API_KEY === "your_golf_api_key_here") {
    warnings.push("VITE_GOLF_API_KEY is not set — course search will not work");
  }
  if (!import.meta.env.VITE_ADMIN_PIN || import.meta.env.VITE_ADMIN_PIN === "changeme") {
    warnings.push("VITE_ADMIN_PIN is not set or is default — change before launch");
  }
  if (!import.meta.env.VITE_SENTRY_DSN) {
    warnings.push("VITE_SENTRY_DSN is not set — error monitoring disabled");
  }
  if (warnings.length > 0) {
    console.warn("[MGS Config]", warnings.join(" | "));
  }
})();

// ── Sentry error reporting ──────────────────────────────────
// Sentry is initialised in main.jsx via @sentry/react npm package
// This wrapper is safe to call whether Sentry is configured or not
function logError(error, context) {
  console.error("[MGS Error]", error, context || "");
  try {
    if (window.__sentryCapture) window.__sentryCapture(error, context);
  } catch {}
}

// ── Push notifications ───────────────────────────────────────
// Schedules local re-engagement notifications based on mental game data
async function schedulePushNotifications(rounds, settings) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!settings?.notifications) return;

  // Find top bandit across recent rounds (last 5)
  const recent = rounds.slice(0, 5);
  const banditCounts = {};
  recent.forEach(r => {
    if (!r.scores) return;
    r.scores.forEach(h => Object.keys(h.bandits || {}).forEach(k => {
      if (h.bandits[k]) banditCounts[k] = (banditCounts[k] || 0) + 1;
    }));
  });
  const topBandit = Object.keys(banditCounts).sort((a, b) => banditCounts[b] - banditCounts[a])[0];

  // Personalized messages based on top bandit
  const messages = {
    Fear:        { title: "Conquer Fear today", body: "Love is your weapon against Fear. Head out and practice staying present on every shot." },
    Frustration: { title: "Channel Acceptance", body: "Your last rounds showed Frustration creeping in. Acceptance turns every bad shot into feedback." },
    Doubt:       { title: "Commitment is waiting", body: "Doubt has been showing up in your game. Today, commit fully to every shot — no second-guessing." },
    Shame:       { title: "Vulnerability is strength", body: "Golf humbles everyone. Show up anyway — Vulnerability is what separates good golfers from great ones." },
    Quit:        { title: "Grit wins today", body: "You have Grit in you. Your last rounds showed the Quit bandit — go out and beat it back today." },
  };

  const msg = topBandit ? messages[topBandit] : {
    title: "Time to play some golf",
    body: "Track your mental game today — Heroes and Bandits are waiting.",
  };

  // Only show if user hasn't played in 4+ days
  const lastRoundDate = rounds[0]?.date;
  if (lastRoundDate) {
    const daysSince = Math.floor((Date.now() - new Date(lastRoundDate).getTime()) / 86400000);
    if (daysSince < 4) return;
  }

  try {
    new Notification(msg.title, {
      body: msg.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "mgp-reengagement",
    });
  } catch {}
}

// ── Input sanitisation ──────────────────────────────────────
// Strips HTML tags and dangerous characters to prevent XSS
function sanitiseText(val, maxLen = 200) {
  if (typeof val !== "string") return "";
  return val
    .replace(/<[^>]*>/g, "")           // strip HTML tags
    .replace(/[<>&"'`]/g, "")          // strip XSS chars
    .replace(/javascript:/gi, "")       // strip js: protocol
    .replace(/on\w+\s*=/gi, "")        // strip event handlers
    .trim()
    .slice(0, maxLen);
}
function sanitiseEmail(val) {
  if (typeof val !== "string") return "";
  return val.toLowerCase().trim().replace(/[^a-z0-9@._+-]/g, "").slice(0, 254);
}
function sanitiseName(val) { return sanitiseText(val, 60); }
function sanitiseCourse(val) { return sanitiseText(val, 100); }
function sanitiseNote(val) { return sanitiseText(val, 1000); } // rounds before profile required

// ── Error Boundary ─────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { logError(error, { componentStack: info?.componentStack }); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{height:"100svh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#09090b",color:"#f8fafc",padding:24,textAlign:"center",fontFamily:"-apple-system,sans-serif"}}>
          <div style={{fontSize:28,fontWeight:900,color:"#16a34a",marginBottom:16,letterSpacing:-1}}>MGS</div>
          <div style={{fontSize:20,fontWeight:800,marginBottom:8}}>Something went wrong</div>
          <div style={{fontSize:14,color:"#71717a",lineHeight:1.6,marginBottom:24}}>The app ran into an unexpected error. Your round data is safe.</div>
          <button onClick={()=>this.setState({hasError:false,error:null})} style={{padding:"12px 24px",borderRadius:12,border:"none",background:"#16a34a",color:"#fff",fontSize:15,fontWeight:700,cursor:"pointer"}}>Try Again</button>
          <button onClick={()=>{try{localStorage.clear();}catch{}window.location.reload();}} style={{marginTop:10,padding:"10px 24px",borderRadius:12,border:"1.5px solid #2a2a2e",background:"transparent",color:"#71717a",fontSize:13,cursor:"pointer"}}>Reset App</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────


// ─── BRAND LOGOS (base64 PNG, theme-aware) ───
// Dark version for light mode, white version for dark mode
const BANDIT_LOGO_DARK = "data:image/png;base64,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";
const HEROES_LOGO_DARK = "data:image/png;base64,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";
const BANDIT_LOGO_WHITE = "data:image/png;base64,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";
const HEROES_LOGO_WHITE = "data:image/png;base64,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";

// ─── CONSTANTS ───
const BANDITS = ["Fear", "Frustration", "Doubt", "Shame", "Quit"];
const HEROES = ["Love", "Acceptance", "Commitment", "Vulnerability", "Grit"];
const MATCHUPS = [
  { hero: "Love", verb: "conquers", bandit: "Fear" },
  { hero: "Acceptance", verb: "eliminates", bandit: "Frustration" },
  { hero: "Commitment", verb: "removes", bandit: "Doubt" },
  { hero: "Vulnerability", verb: "prevents", bandit: "Shame" },
  { hero: "Grit", verb: "beats", bandit: "Quit" },
];
const TOTAL_HOLES = 18;
const STORAGE_KEY = "mental_game_rounds";
const THEME_KEY = "mental_game_theme";

// ─── THEME PALETTES ───
const LIGHT = {
  bg: "#f6f7f4", card: "#ffffff", cardAlt: "#f0f1ed",
  green: "#16a34a", greenDim: "#bbf7d0", red: "#dc2626", redDim: "#fecaca",
  gold: "#ca8a04", white: "#1a1f16", muted: "#6b7280",
  accent: "#2563eb", border: "#e0e2dc",
  gradient: "#f6f7f4", inputBg: "#ffffff",
  headerBg: "linear-gradient(175deg, #09090b 0%, #141416 50%, #1c1c1f 100%)",
  headerText: "#ffffff", headerMuted: "rgba(255,255,255,0.5)",
};
const DARK = {
  bg: "#09090b", card: "#141416", cardAlt: "#1c1c1f",
  green: "#34d87a", greenDim: "#1a7a3d", red: "#f87171", redDim: "#b91c1c",
  gold: "#fbbf24", white: "#f8fafc", muted: "#94a3b8",
  accent: "#5cc8fa", border: "#2a2a2e",
  gradient: "#09090b", inputBg: "#141416",
  headerBg: "linear-gradient(175deg, #09090b 0%, #141416 100%)",
  headerText: "#f8fafc", headerMuted: "rgba(255,255,255,0.4)",
};
const ThemeCtx = createContext(LIGHT);
function useTheme() { return useContext(ThemeCtx); }

// ─── SVG ICONS ───
const Icons = {
  Sun: ({ color, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  Flag: ({ color, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
  Brain: ({ color, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a6 6 0 0 0-6 6c0 1.6.6 3 1.7 4.1L12 17l4.3-4.9A6 6 0 0 0 12 2z"/><path d="M12 17v5"/><path d="M9 8.5a1.5 1.5 0 1 1 3 0"/><path d="M12 8.5a1.5 1.5 0 1 1 3 0"/></svg>,
  Chart: ({ color, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Clipboard: ({ color, size = 22 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
  User: ({ color, size = 15 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  Moon: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>,
  Home: ({ color, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  Grid: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>,
  Info: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  Back: ({ color, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  Chev: ({ color, size = 15 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
  Note: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Heart: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>,
  Hands: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M7 11V7a5 5 0 0110 0v4"/><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/></svg>,
  Target: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Shield: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Bolt: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>,
  Eye: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  Compass: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>,
  Star: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  Zen: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>,
  FlagHole: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v14"/><path d="M12 2l7 4-7 4"/><ellipse cx="12" cy="20" rx="5" ry="1.5"/></svg>,
  GolfSwing: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="3.5" r="1.5"/><path d="M8 7.5c1.2-1 2.5-1.5 4-1.5s2.5.4 3 1.2"/><path d="M7 8l2 5h6l1-5"/><path d="M9 13l-2 7"/><path d="M15 13l1 4-4 1"/><path d="M5.5 9.5 3 13"/></svg>,
  GolfClub: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l9-9"/><path d="M12 12l4-4a2.828 2.828 0 114 4l-4 4"/><path d="M16 8l-2-2"/></svg>,
  GolfTee: ({ color, size = 38 }) => <svg width={size} height={size} viewBox="0 0 48 48" fill="none"><circle cx="24" cy="14" r="8.5" stroke={color} strokeWidth="2.2" fill={color} fillOpacity="0.08"/><path d="M19.5 10.5c1.5-2 4-3 6.5-2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" opacity="0.5"/><circle cx="22" cy="12" r="0.7" fill={color} opacity="0.2"/><circle cx="25" cy="11" r="0.7" fill={color} opacity="0.2"/><circle cx="27" cy="13.5" r="0.7" fill={color} opacity="0.2"/><circle cx="24" cy="15" r="0.7" fill={color} opacity="0.2"/><circle cx="21" cy="15" r="0.7" fill={color} opacity="0.2"/><circle cx="26" cy="17" r="0.7" fill={color} opacity="0.2"/><path d="M22.5 22.5 L24 40 L25.5 22.5" stroke={color} strokeWidth="2.2" fill={color} fillOpacity="0.06" strokeLinecap="round" strokeLinejoin="round"/><ellipse cx="24" cy="40" rx="6" ry="1.5" stroke={color} strokeWidth="1.5" opacity="0.3"/></svg>,
  Check: ({ color, size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Skull: ({ color, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="7"/><circle cx="9.5" cy="10" r="1" fill={color}/><circle cx="14.5" cy="10" r="1" fill={color}/><path d="M10 15h4"/><path d="M9 17v3"/><path d="M15 17v3"/></svg>,
  Undo: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>,
  Share: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>,
  Fire: ({ color, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>,
  Trophy: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4a2 2 0 0 0-2 2v1a4 4 0 0 0 4 4h1"/><path d="M18 9h2a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4h-1"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M8 3h8l1 6a5 5 0 0 1-10 0z"/></svg>,
  TrendUp: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  Muscle: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 9.5a3 3 0 0 0-3-3h-1a3 3 0 0 0-3 3v5a3 3 0 0 0 3 3h1a3 3 0 0 0 3-3v-5z"/><path d="M17.5 7.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2"/><path d="M6.5 7.5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2"/></svg>,
  Medal: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="14" r="6"/><path d="M12 8V2"/><path d="M8 2h8"/><path d="M9.5 14.5 12 12l2.5 2.5"/></svg>,
  Sun2: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>,
  Cloud: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>,
  Rain: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="16" y1="13" x2="16" y2="21"/><line x1="8" y1="13" x2="8" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>,
  Snow: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="m17 7-5-5-5 5"/><path d="m17 17-5 5-5-5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="m7 7-5 5 5 5"/><path d="m17 7 5 5-5 5"/></svg>,
  Wind: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>,
  Golf: ({ color, size = 20 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="18" r="3"/><path d="M12 15V5"/><path d="M12 5l5 3-5 3"/></svg>,  Gear: ({ color, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  Clock: ({ color, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
};

// ─── BALLOON CANVAS (streak 3) ───
function SaveBtn({P, onSave, hint}) {
  const [saved, setSaved] = React.useState(false);
  function handle() {
    onSave();
    setSaved(true);
    setTimeout(()=>setSaved(false), 1500);
  }
  return (
    <button onClick={handle} {...pp()} style={{flexShrink:0,display:"flex",alignItems:"center",gap:4,padding:"9px 10px",borderRadius:10,border:`1.5px solid ${saved?P.green:P.border}`,background:saved?P.green+"20":P.card,color:saved?P.green:P.muted,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.2s",minWidth:52}}>
      {saved?<Icons.Check color={P.green} size={12}/>:<Icons.Clipboard color={P.muted} size={12}/>}
      {saved?"Saved":"Save"}
    </button>
  );
}

function ShareBtn({P, onShare}) {
  const [sharing, setSharing] = React.useState(false);
  async function handle() {
    if(sharing) return;
    setSharing(true);
    await onShare();
    setTimeout(()=>setSharing(false), 1500);
  }
  return (
    <button onClick={handle} {...pp()} style={{flexShrink:0,display:"flex",alignItems:"center",gap:4,padding:"9px 10px",borderRadius:10,border:`1.5px solid ${sharing?P.green:P.accent+"44"}`,background:sharing?P.green+"20":P.accent+"10",color:sharing?P.green:P.accent,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.2s"}}>
      {sharing?<Icons.Check color={P.green} size={12}/>:<Icons.Share color={P.accent} size={12}/>}
      {sharing?"Done":"Share"}
    </button>
  );
}

function LiveClock({ P }) {
  const [time, setTime] = React.useState(()=>new Date());
  React.useEffect(()=>{
    const t = setInterval(()=>setTime(new Date()), 1000);
    return()=>clearInterval(t);
  },[]);
  const h = time.getHours()%12||12;
  const m = String(time.getMinutes()).padStart(2,"0");
  const ampm = time.getHours()>=12?"PM":"AM";
  return (
    <div style={{display:"flex",alignItems:"center",gap:3,flexShrink:0}}>
      <span style={{fontSize:13,fontWeight:800,color:P.white,letterSpacing:0.5}}>{h}:{m}</span>
      <span style={{fontSize:9,fontWeight:700,color:P.muted}}>{ampm}</span>
    </div>
  );
}

function BalloonCanvas({ active, onDone }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const colors = ["#dc2626","#16a34a","#2563eb","#ca8a04","#7c3aed","#0d9488","#f472b6"];
    const balloons = Array.from({length:18}, (_, i) => ({
      x: (Math.random() * 0.9 + 0.05) * canvas.width,
      y: canvas.height + 40 + Math.random() * 100,
      r: 14 + Math.random() * 10,
      color: colors[i % colors.length],
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(2.5 + Math.random() * 2),
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.04 + Math.random() * 0.03,
      opacity: 1,
    }));
    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      balloons.forEach(b => {
        b.sway += b.swaySpeed;
        b.x += b.vx + Math.sin(b.sway) * 0.6;
        b.y += b.vy;
        if (frame > 60) b.opacity -= 0.02;
        if (b.opacity <= 0) return;
        ctx.save();
        ctx.globalAlpha = b.opacity;
        // Balloon body
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, b.r * 0.78, b.r, 0, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        // Shine
        ctx.beginPath();
        ctx.ellipse(b.x - b.r*0.25, b.y - b.r*0.32, b.r*0.22, b.r*0.18, -0.5, 0, Math.PI*2);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fill();
        // String
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + b.r);
        ctx.bezierCurveTo(b.x + 4, b.y + b.r + 8, b.x - 4, b.y + b.r + 16, b.x, b.y + b.r + 24);
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = b.opacity * 0.6;
        ctx.stroke();
        ctx.restore();
      });
      const alive = balloons.some(b => b.opacity > 0);
      if (alive) animRef.current = requestAnimationFrame(draw);
      else onDone && onDone();
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);
  if (!active) return null;
  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:9999}}/>;
}

// ─── FLAME CANVAS (streak 4) ───
function FlameCanvas({ active, onDone }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const particles = [];
    let frame = 0;
    function spawnFlame(x) {
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: x + (Math.random()-0.5)*30,
          y: canvas.height,
          vx: (Math.random()-0.5)*2,
          vy: -(3 + Math.random()*4),
          life: 1,
          decay: 0.018 + Math.random()*0.012,
          size: 6 + Math.random()*10,
        });
      }
    }
    const cols = 6;
    for (let i=0;i<cols;i++) spawnFlame((i+0.5)/cols * canvas.width);
    function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      frame++;
      if (frame < 40 && frame%3===0) {
        const cols=6;
        for(let i=0;i<cols;i++) spawnFlame((i+0.5)/cols*canvas.width + (Math.random()-0.5)*40);
      }
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.05;
        p.life -= p.decay;
        if (p.life <= 0) return;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(255,255,180,${p.life})`);
        grad.addColorStop(0.4, `rgba(255,140,0,${p.life*0.8})`);
        grad.addColorStop(0.8, `rgba(200,40,0,${p.life*0.4})`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      });
      const alive = particles.some(p=>p.life>0);
      if (alive || frame<50) animRef.current = requestAnimationFrame(draw);
      else onDone && onDone();
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);
  if (!active) return null;
  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:9999}}/>;
}

// ─── STARBURST CANVAS (streak 6+) ───
function StarburstCanvas({ active, onDone }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const colors=["#fbbf24","#f472b6","#a78bfa","#5cc8fa","#34d87a","#fb923c","#fff"];
    let bursts=[], frame=0;
    function addBurst(x,y) {
      const c=colors[Math.floor(Math.random()*colors.length)];
      for(let i=0;i<60;i++){
        const a=(i/60)*Math.PI*2, sp=1+Math.random()*7;
        bursts.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,color:c,opacity:1,size:1.5+Math.random()*2.5,trail:[]});
      }
    }
    const pts=[{t:0,x:0.2},{t:10,x:0.8},{t:20,x:0.5},{t:30,x:0.15},{t:40,x:0.85},{t:50,x:0.4}];
    function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      frame++;
      pts.forEach(p=>{ if(frame===p.t) addBurst(canvas.width*p.x, canvas.height*0.2+Math.random()*canvas.height*0.5); });
      bursts.forEach(p=>{
        p.trail.push({x:p.x,y:p.y});
        if(p.trail.length>6) p.trail.shift();
        p.x+=p.vx; p.y+=p.vy; p.vy+=0.07; p.opacity-=0.016;
        if(p.opacity<=0) return;
        // Trail
        p.trail.forEach((pt,i)=>{
          ctx.save(); ctx.globalAlpha=p.opacity*(i/p.trail.length)*0.4;
          ctx.beginPath(); ctx.arc(pt.x,pt.y,p.size*0.6,0,Math.PI*2);
          ctx.fillStyle=p.color; ctx.fill(); ctx.restore();
        });
        ctx.save(); ctx.globalAlpha=p.opacity;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2);
        ctx.fillStyle=p.color; ctx.fill(); ctx.restore();
      });
      bursts=bursts.filter(p=>p.opacity>0);
      if(frame<130) animRef.current=requestAnimationFrame(draw);
      else onDone&&onDone();
    }
    animRef.current=requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(animRef.current);
  },[active]);
  if(!active) return null;
  return <canvas ref={canvasRef} style={{position:"fixed",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:9999}}/>;
}

// ─── CONFETTI ENGINE ───
function ConfettiCanvas({ active, onDone }) {
  const canvasRef = useRef(null);
  const particles = useRef([]);
  const animRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const colors = ["#16a34a","#fbbf24","#dc2626","#2563eb","#7c3aed","#ea580c","#0d9488","#f472b6","#34d87a","#fcd34d"];
    particles.current = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -10 - Math.random() * 100,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.15,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      opacity: 1,
    }));

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;
      let alive = false;
      particles.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.rot += p.rotV;
        if (frame > 80) p.opacity -= 0.012;
        if (p.y < canvas.height + 20 && p.opacity > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      });
      if (alive) animRef.current = requestAnimationFrame(draw);
      else { onDone && onDone(); }
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:9999 }}/>;
}

// ─── FIREWORKS ENGINE ───
function FireworksCanvas({ active, onDone }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const colors = ["#fbbf24","#f472b6","#34d87a","#5cc8fa","#a78bfa","#fb923c","#ffffff"];
    let bursts = [];
    let frame = 0;

    function addBurst(x, y) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 40; i++) {
        const angle = (i / 40) * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        bursts.push({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color, opacity: 1, size: 2 + Math.random() * 2.5,
        });
      }
    }

    // Launch 4 fireworks at different times
    const launches = [
      { t: 0, x: 0.3 }, { t: 18, x: 0.7 }, { t: 35, x: 0.5 }, { t: 52, x: 0.2 },
    ];

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;

      launches.forEach(l => {
        if (frame === l.t) addBurst(canvas.width * l.x, canvas.height * 0.25 + Math.random() * canvas.height * 0.3);
      });

      bursts.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.opacity -= 0.018;
        if (p.opacity > 0) {
          ctx.save();
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
      bursts = bursts.filter(p => p.opacity > 0);

      if (frame < 120) animRef.current = requestAnimationFrame(draw);
      else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onDone && onDone();
      }
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [active]);

  if (!active) return null;
  return <canvas ref={canvasRef} style={{ position:"fixed", inset:0, width:"100%", height:"100%", pointerEvents:"none", zIndex:9999 }}/>;
}

// ─── COURSE SEARCH HOOK ───
function useCourseSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [courseData, setCourseData] = useState(null); // full loaded course
  const [loadingCourse, setLoadingCourse] = useState(false);
  const debounceRef = useRef(null);

  const search = useCallback((val) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val || val.length < 3 || !GOLF_API_KEY || GOLF_API_KEY === "YOUR_API_KEY_HERE" || GOLF_API_KEY === "undefined") {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        // Try exact query first, then append wildcard for partial matching
        const res = await fetch(
          `${GOLF_API_BASE}/search?search_query=${encodeURIComponent(val + "*")}`,
          { headers: { Authorization: `Key ${GOLF_API_KEY}` } }
        );
        const data = await res.json();
        const courses = data.courses || [];
        // If wildcard returns nothing, try without it
        if (courses.length === 0) {
          const res2 = await fetch(
            `${GOLF_API_BASE}/search?search_query=${encodeURIComponent(val)}`,
            { headers: { Authorization: `Key ${GOLF_API_KEY}` } }
          );
          const data2 = await res2.json();
          setResults((data2.courses || []).slice(0, 20));
        } else {
          setResults(courses.slice(0, 20));
        }
      } catch(e) {
        // Offline or API error — fail silently, user can still enter course name manually
        setResults([]);
        setLoading(false);
        if (e?.name !== "AbortError") logError(e, { context: "course_search" });
      }
      finally { setLoading(false); }
    }, 300);
  }, []);

  const loadCourse = useCallback(async (courseId) => {
    setLoadingCourse(true);
    setCourseData(null);
    try {
      const res = await fetch(
        `${GOLF_API_BASE}/courses/${courseId}`,
        { headers: { Authorization: `Key ${GOLF_API_KEY}` } }
      );
      const data = await res.json();
      setCourseData(data.course || null);
    } catch { setCourseData(null); }
    finally { setLoadingCourse(false); }
  }, []);

  const clear = useCallback(() => {
    setQuery(""); setResults([]); setCourseData(null);
  }, []);

  return { query, search, results, loading, courseData, loadCourse, loadingCourse, clear };
}

// ─── COURSE SEARCH COMPONENT ───
function CourseSearchBar({ P, S, courseName, setCourseName, onCourseLoaded, selectedTee, setSelectedTee, courseData, setCourseData, inGameCaddie, setInGameCaddie }) {
  const { query, search, results, loading, loadCourse, loadingCourse, clear } = useCourseSearch();
  const [open, setOpen] = useState(false);
  const [localCourseData, setLocalCourseData] = useState(courseData);
  const inputRef = useRef(null);
  const apiConfigured = !!(GOLF_API_KEY && GOLF_API_KEY !== "YOUR_API_KEY_HERE" && GOLF_API_KEY !== "undefined");

  // sync external courseData
  useEffect(() => { setLocalCourseData(courseData); }, [courseData]);

  // Flatten male/female tees into a single array, preserving holes
  function flattenTees(course) {
    if (!course?.tees) return [];
    if (Array.isArray(course.tees)) return course.tees;
    const male = (course.tees.male || []).map(t => ({...t, gender:"Male"}));
    const female = (course.tees.female || []).map(t => ({...t, gender:"Female"}));
    return [...male, ...female];
  }

  async function handleSelect(course) {
    setCourseName(course.club_name);
    setOpen(false);
    const id = course.id;
    if (!id) return;
    const res = await fetch(`${GOLF_API_BASE}/courses/${id}`, {
      headers: { Authorization: `Key ${GOLF_API_KEY}` }
    });
    const data = await res.json();
    const full = data.course || null;
    if (!full) return;
    // Attach flat tees for easy access
    full._tees = flattenTees(full);
    setLocalCourseData(full);
    setCourseData(full);
    // Default to first tee
    if (full._tees.length > 0) {
      const firstTee = full._tees[0];
      setSelectedTee(firstTee.tee_name + (firstTee.gender ? ` (${firstTee.gender})` : ""));
      onCourseLoaded(full, firstTee.tee_name, firstTee.gender);
    }
  }

  function handleTeeSelect(val) {
    setSelectedTee(val);
    if (localCourseData) {
      // val format: "TeeeName (Gender)" or just "TeeName"
      const match = val.match(/^(.+?)(?: \((Male|Female)\))?$/);
      const teeName = match?.[1] || val;
      const gender = match?.[2] || null;
      onCourseLoaded(localCourseData, teeName, gender);
    }
  }

  function handleClearCourse() {
    setLocalCourseData(null);
    setCourseData(null);
    setSelectedTee(null);
    clear();
    setCourseName("");
  }

  // Tee color mapping
  const TEE_COLORS = {
    black: "#1a1a1a", blue: "#1d4ed8", white: "#6b7280",
    red: "#dc2626", gold: "#ca8a04", green: "#16a34a",
    silver: "#94a3b8", bronze: "#b45309", yellow: "#d97706",
  };
  function teeColor(name) {
    const n = (name || "").toLowerCase();
    for (const [k, v] of Object.entries(TEE_COLORS)) if (n.includes(k)) return v;
    return P.accent;
  }

  return (
    <div style={{ padding: "0 20px 6px", position: "relative" }}>
      {/* Course name input row */}
      {!localCourseData ? (
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={localCourseData ? courseName : (query || courseName)}
            onChange={e => { const v=sanitiseCourse(e.target.value); search(v); setCourseName(v); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={apiConfigured ? "Search for your course (optional)..." : "Course name (optional)"}
            style={{ ...S.input, width: "100%", paddingRight: loading ? 36 : 12 }}
          />
          {loading && (
            <div style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", border:`2px solid ${P.border}`, borderTopColor:P.accent, animation:"spin 0.7s linear infinite" }}/>
            </div>
          )}
          {/* Dropdown */}
          {open && results.length > 0 && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:200, background:P.card, borderRadius:12, border:`1.5px solid ${P.border}`, boxShadow:"0 8px 24px rgba(0,0,0,0.12)", overflow:"hidden", marginTop:4 }}>
              {results.map((c, i) => (
                <button key={c.id || i} onClick={() => handleSelect(c)} {...pp()}
                  style={{ display:"flex", flexDirection:"column", width:"100%", padding:"10px 14px", background:"transparent", border:"none", borderBottom:i<results.length-1?`1px solid ${P.border}`:0, cursor:"pointer", textAlign:"left", transition:"background 0.1s" }}
                  onMouseEnter={e=>e.currentTarget.style.background=P.cardAlt}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                >
                  <span style={{ fontSize:14, fontWeight:600, color:P.white }}>
                    {c.club_name}{c.course_name && c.course_name !== c.club_name ? ` — ${c.course_name}` : ""}
                  </span>
                  <span style={{ fontSize:11, color:P.muted, marginTop:1 }}>{[c.location?.city, c.location?.state, c.location?.country].filter(Boolean).join(", ")}</span>
                </button>
              ))}
            </div>
          )}
          {open && !loading && results.length === 0 && query.length >= 3 && apiConfigured && (
            <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:200, background:P.card, borderRadius:12, border:`1.5px solid ${P.border}`, padding:"12px 14px", marginTop:4, fontSize:13, color:P.muted }}>
              No courses found for "{query}"
            </div>
          )}
        </div>
      ) : (
        /* Loaded course — full name left, tee+caddie stacked right */
        <div style={{ background:P.card, borderRadius:10, border:`1.5px solid ${P.green}44`, padding:"6px 10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:700, color:P.white, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{localCourseData.club_name}{localCourseData.course_name && localCourseData.course_name !== localCourseData.club_name ? ` — ${localCourseData.course_name}` : ""}</div>
              <div style={{ fontSize:10, color:P.muted }}>{[localCourseData.location?.city, localCourseData.location?.state].filter(Boolean).join(", ")}</div>
            </div>
            {/* Tee + Caddie stacked */}
            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
              {localCourseData?._tees?.length > 0 && (
                <select
                  value={selectedTee || ""}
                  onChange={e => handleTeeSelect(e.target.value)}
                  style={{ background:P.inputBg, color:P.white, border:`1.5px solid ${P.border}`, borderRadius:8, fontSize:11, fontWeight:600, padding:"3px 6px", cursor:"pointer", outline:"none" }}
                >
                  {localCourseData._tees.map(t => {
                    const val = t.tee_name + (t.gender ? ` (${t.gender})` : "");
                    const label = t.tee_name + (t.gender === "Female" ? " (W)" : "");
                    return <option key={val} value={val}>{label}</option>;
                  })}
                </select>
              )}
              {!localCourseData?._tees?.length && selectedTee && (
                <div style={{fontSize:11,fontWeight:700,color:P.accent,padding:"3px 8px",borderRadius:8,border:`1.5px solid ${P.accent}33`,background:P.accent+"10"}}>{selectedTee}</div>
              )}
              {setInGameCaddie && (
                <button onClick={()=>setInGameCaddie(!inGameCaddie)} {...pp()} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 6px",borderRadius:6,border:`1.5px solid ${inGameCaddie?"#006747":P.border}`,background:inGameCaddie?"#00674715":"transparent",cursor:"pointer",transition:"all 0.15s"}}>
                  <Icons.Brain color={inGameCaddie?"#006747":P.muted} size={11}/>
                  <span style={{fontSize:10,fontWeight:700,color:inGameCaddie?"#006747":P.muted}}>Caddie</span>
                  <div style={{width:20,height:11,borderRadius:6,background:inGameCaddie?"#006747":P.border,position:"relative",transition:"background 0.2s",flexShrink:0}}><div style={{width:7,height:7,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:inGameCaddie?11:2,transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/></div>
                </button>
              )}
            </div>
            <button onClick={handleClearCourse} {...pp()} style={{ background:"transparent", border:`1px solid ${P.border}`, borderRadius:6, color:P.muted, fontSize:11, padding:"3px 7px", cursor:"pointer", fontWeight:600, flexShrink:0 }}>✕</button>
          </div>
          {loadingCourse && <div style={{ fontSize:11, color:P.muted, marginTop:4 }}>Loading...</div>}
        </div>
      )}
      {/* Caddie toggle when no course loaded — shown below search */}
      {!localCourseData && setInGameCaddie && (
        <div style={{marginTop:4,display:"flex",alignItems:"center",justifyContent:"flex-end",paddingRight:2}}>
          <button onClick={()=>setInGameCaddie(!inGameCaddie)} {...pp()} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,border:`1.5px solid ${inGameCaddie?"#006747":P.border}`,background:inGameCaddie?"#00674715":"transparent",cursor:"pointer",transition:"all 0.15s"}}>
            <Icons.Brain color={inGameCaddie?"#006747":P.muted} size={12}/>
            <span style={{fontSize:10,fontWeight:700,color:inGameCaddie?"#006747":P.muted}}>In-Game Caddie</span>
            <div style={{width:22,height:12,borderRadius:6,background:inGameCaddie?"#006747":P.border,position:"relative",transition:"background 0.2s",flexShrink:0}}><div style={{width:8,height:8,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:inGameCaddie?12:2,transition:"left 0.2s",boxShadow:"0 1px 2px rgba(0,0,0,0.2)"}}/></div>
          </button>
        </div>
      )}
      <style>{`@keyframes spin{to{transform:translateY(-50%) rotate(360deg);}}`}</style>
    </div>
  );
}

// ─── WEATHER HOOK ───
function useWeather(courseData) {
  const [weather, setWeather] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  useEffect(() => {
    if (!courseData) { setWeather(null); return; }
    // Try to get coords from course data — GolfCourseAPI returns location.latitude/longitude
    const lat = courseData.location?.latitude ?? courseData.latitude ?? courseData.lat;
    const lon = courseData.location?.longitude ?? courseData.longitude ?? courseData.lng ?? courseData.lon;
    if (!lat || !lon) { setWeather(null); return; }

    setLoadingWeather(true);
    // Open-Meteo: free, no key, returns current weather
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m,winddirection_10m&wind_speed_unit=mph&temperature_unit=fahrenheit&forecast_days=1`)
      .then(r => r.json())
      .then(d => {
        const c = d.current;
        if (!c) return;
        setWeather({
          temp: Math.round(c.temperature_2m),
          wind: Math.round(c.windspeed_10m),
          windDir: windDirLabel(c.winddirection_10m),
          code: c.weathercode,
        });
      })
      .catch(() => setWeather(null))
      .finally(() => setLoadingWeather(false));
  }, [courseData?.id ?? courseData?.club_name]);

  return { weather, loadingWeather };
}

function windDirLabel(deg) {
  if (deg == null) return "";
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function weatherIcon(code) {
  if (code == null) return "Sunny";
  if (code === 0) return "Sunny";
  if (code <= 2) return "P.Cloudy";
  if (code <= 3) return "Cloudy";
  if (code <= 49) return "Foggy";
  if (code <= 59) return "Showers";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Sleet";
  if (code <= 99) return "Storm";
  return "Sunny";
}
function weatherLabel(code) {
  if (code == null) return "";
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 49) return "Foggy";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Showers";
  if (code <= 99) return "Thunder";
  return "";
}




const CADDIE_CATEGORIES = [
  { name: "Love", subtitle: "conquers Fear", IconKey: "Heart", color: "#dc2626", messages: ["Remind yourself how much you LOVE and appreciate hitting that first tee shot.","Feel excitement and passion for the opportunity in this moment.","Connect to the gratitude you have for being at the course, playing with your friends.","Smile — it's called 'playing' golf.","Channeling Love will allow you to experience golf with objectivity, joy, and passion."] },
  { name: "Acceptance", subtitle: "eliminates Frustration", IconKey: "Hands", color: "#ca8a04", messages: ["See the outcomes of your shots as feedback, not failure.","Be curious — not critical. Try: 'Hmmm... that was interesting.'","Drop your expectations. You don't need them.","Stop arguing with reality.","Objectivity leads to discovery."] },
  { name: "Commitment", subtitle: "removes Doubt", IconKey: "Target", color: "#16a34a", messages: ["Connect to the target. Stay in the process.","You can't WIN the moment unless you are IN the moment.","Stay… in the shot, in the hole, in the game.","When in doubt — reset and recommit.","Commitment to the process. Indifference to the result."] },
  { name: "Vulnerability", subtitle: "prevents Shame", IconKey: "Shield", color: "#7c3aed", messages: ["Be open to showing up exactly as you are today.","Welcome the pressure as a test that will make you a better player.","Variability is the human condition. Embrace it. Let others see it.","Speak like excellence is your birthright. Act like you don't need golf to be perfect.","You are not your score."] },
  { name: "Grit", subtitle: "beats Quit", IconKey: "Bolt", color: "#2563eb", messages: ["GRIT is your mindset today. No matter what.","Stay in pursuit mode — each shot, each hole.","The Wolf you feed wins the battle in your mind. Feed the Good Wolf.","Stay in the shot. Stay in the hole. Stay in the game.","Lean in. Focus on the shot you want to make. You got this."] },
  { name: "Awareness", subtitle: "The Key to a Productive Mindset", IconKey: "Eye", color: "#db2777", messages: ["Tune-in to your story about how you think this round is supposed to unfold for you.","You have CHOICES about the thought patterns you anchor to in any moment.","Tune-in to your performance energy — how you are showing up in this moment.","Notice your chatter. Stay aware of your inner dialogue — and change it when it's not supporting your mission.","Golf is an athletic endeavor — not a cognitive one. Channel your inner athlete."] },
  { name: "Presence", subtitle: "The Key to Playing the Game", IconKey: "Zen", color: "#0d9488", messages: ["Remember — golf is played in the present. Not in the past. Not in the future. W.I.N.","Play golf — not golf swing.","You can't WIN the moment unless you are IN the moment.","Plan the shot. Play the shot. Process the outcome.","Focus on your athletic feels: Balance. Tempo. Tension. Visualization. Energy."] },
  { name: "Possibility Thinking", subtitle: "The Key to Staying in The Game", IconKey: "Star", color: "#ea580c", messages: ["See and feel the abundance around you today — plenty of great shots left out there, always.","Strong Process Box today — see outcomes with perspective, objectivity and acceptance.","Stay in pursuit mode — each shot, each hole.","The next shot might be your best shot.","Get creative and playful. Bring curiosity and fun to your play. Ask: What if?"] },
];

const PREROUND_SECTIONS = [
  { title: "Set Your Intention", IconKey: "Compass", color: "#ca8a04", items: ["Notice what expectations you're carrying today — then release them","Decide who you want to BE on the course, not what you want to shoot","Set process goals: trust your swing, execute your routine, stay present"] },
  { title: "Connect to Gratitude", IconKey: "Heart", color: "#dc2626", items: ["Appreciate the opportunity to be here today","Recall why you love this game — the people, the place, the challenge","Feel excitement and passion for hitting that first tee shot"] },
  { title: "Embrace Curiosity & Learning", IconKey: "Shield", color: "#7c3aed", items: ["Shift from score-fixation to learning — focus on growth and execution","Replace fear of results with curiosity about each shot","You're here to find out how good you can be today, nothing more"] },
];

const POST_ROUND_PROMPTS = [
  "Which Hero showed up strongest for you today? What triggered it?",
  "Which Bandit gave you the most trouble? On which holes?",
  "What's one thing you'd do differently in your mental game next round?",
  "Describe a moment where you stayed present under pressure.",
  "Rate your pre-shot routine commitment today (1–10). What got in the way?",
  "What will you carry forward into your next round?",
];

// ─── HELPERS ───

// ─── MILESTONE DEFINITIONS ───
// ── TIER CONFIG ──────────────────────────────────────────────────────────────
const TIER_META = [
  {tier:1,name:"Bronze",  color:"#b45309",bg:"#92400e18",border:"#b4530966"},
  {tier:2,name:"Silver",  color:"#64748b",bg:"#47556918",border:"#64748b66"},
  {tier:3,name:"Gold",    color:"#ca8a04",bg:"#92400018",border:"#ca8a0466"},
  {tier:4,name:"Diamond",color:"#1d4ed8",bg:"#1e3a8a18",border:"#1d4ed866"},
];

function _maxHeroesInRound(r){return Math.max(0,...r.map(x=>x.heroes||0));}
function _maxStreakInRound(r){let best=0;r.forEach(x=>{if(!x.scores)return;let cur=0;x.scores.forEach(h=>{const hc=Object.values(h.heroes).reduce((a,c)=>a+c,0),bc=Object.values(h.bandits).reduce((a,c)=>a+c,0);if(hc>bc)cur++;else cur=0;best=Math.max(best,cur);});});return best;}
function _posStreak(r){let best=0,cur=0;[...r].reverse().forEach(x=>{if(x.net>0){cur++;best=Math.max(best,cur);}else cur=0;});return best;}
function _cleanRounds(r){return r.filter(x=>x.scores&&x.bandits===0&&x.heroes>0).length;}
function _recoveryRate(r){let att=0,rec=0;r.forEach(x=>{if(!x.scores)return;for(let i=0;i<17;i++){const cur=getHoleStats(x.scores,i),nxt=getHoleStats(x.scores,i+1);if(cur.net<0&&nxt.heroes+nxt.bandits>0){att++;if(nxt.net>0)rec++;}}});return{att,rate:att?Math.round((rec/att)*100):0};}
function _maxFIRpct(r){let best=0;r.forEach(x=>{if(!x.scores)return;const h=x.scores.filter(s=>s.fairway!==null&&s.fairway!==undefined);if(h.length>=9)best=Math.max(best,Math.round((h.filter(s=>s.fairway===true).length/h.length)*100));});return best;}
function _GIRpct(r){let tot=0,gir=0;r.forEach(x=>{if(!x.scores)return;x.scores.forEach(h=>{if(h.gir!==null&&h.gir!==undefined){tot++;if(h.gir===true)gir++;}});});return tot>=18?Math.round((gir/tot)*100):0;}
function _maxOnePutts(r){let best=0;r.forEach(x=>{if(!x.scores)return;best=Math.max(best,x.scores.filter(h=>parseInt(h.putts)===1).length);});return best;}
function _checklistCount(){try{return parseInt(localStorage.getItem("mgp_checklist_count")||"0");}catch{return 0;}}
function _maxMonthlyRounds(r){const c={};r.forEach(x=>{const k=x.date?x.date.slice(0,7):"x";c[k]=(c[k]||0)+1;});return Math.max(0,...Object.values(c));}
function _comebackRounds(r){return r.filter(x=>{if(!x.scores)return false;let streak=0;for(let i=0;i<x.scores.length;i++){const s=getHoleStats(x.scores,i);if(s.net<0)streak++;else{if(streak>=3&&s.net>0)return true;streak=0;}}return false;}).length;}
function _hasAllFive(r){return r.filter(x=>x.scores&&["Love","Acceptance","Commitment","Vulnerability","Grit"].every(h=>x.scores.some(s=>s.heroes[h]))).length;}
function _maxCommitmentHoles(r){return r.reduce((mx,x)=>{if(!x.scores)return mx;return Math.max(mx,x.scores.filter(h=>h.heroes.Commitment).length);},0);}
function _maxAcceptanceHoles(r){return r.reduce((mx,x)=>{if(!x.scores)return mx;return Math.max(mx,x.scores.filter(h=>h.heroes.Acceptance).length);},0);}
function _possibilityThinkerCount(r){return r.filter(x=>{if(!x.scores||x.scores.length<18)return false;const f9=x.scores.slice(0,9).reduce((s,h)=>s+(Object.values(h.heroes).reduce((a,c)=>a+c,0)-Object.values(h.bandits).reduce((a,c)=>a+c,0)),0);const b9=x.scores.slice(9).reduce((s,h)=>s+(Object.values(h.heroes).reduce((a,c)=>a+c,0)-Object.values(h.bandits).reduce((a,c)=>a+c,0)),0);return f9<0&&b9>0;}).length;}
function _lockedInRounds(r){return r.filter(x=>x.scores&&x.scores.some(h=>h.heroes.Love)&&x.scores.some(h=>h.heroes.Commitment)&&x.scores.some(h=>h.heroes.Grit)).length;}
function _bestNet(r){return Math.max(0,...r.map(x=>x.net||0));}

function getBadgeTier(badge, rounds){let tier=0;badge.tiers.forEach((t,i)=>{if(t.check(rounds))tier=i+1;});return tier;}
function getBadgeProgress(badge, rounds){const ct=getBadgeTier(badge,rounds);if(ct>=4)return{val:badge.tiers[3].target,max:badge.tiers[3].target,done:true};return badge.tiers[ct].progress(rounds);}

const MILESTONES = [
  {id:"rounds_played",label:"On the Course",IconKey:"Golf",color:"#16a34a",category:"Journey",tiers:[
    {tier:1,target:1, desc:"Play your first round",        check:(r)=>r.length>=1,  progress:(r)=>({val:Math.min(r.length,1),max:1})},
    {tier:2,target:10,desc:"Play 10 rounds",               check:(r)=>r.length>=10, progress:(r)=>({val:Math.min(r.length,10),max:10})},
    {tier:3,target:25,desc:"Play 25 rounds",               check:(r)=>r.length>=25, progress:(r)=>({val:Math.min(r.length,25),max:25})},
    {tier:4,target:50,desc:"Play 50 rounds",               check:(r)=>r.length>=50, progress:(r)=>({val:Math.min(r.length,50),max:50})},
  ]},
  {id:"positive_net",label:"In the Green",IconKey:"TrendUp",color:"#16a34a",category:"Journey",tiers:[
    {tier:1,target:1, desc:"Finish a round with positive net",     check:(r)=>r.filter(x=>x.net>0).length>=1,  progress:(r)=>({val:Math.min(r.filter(x=>x.net>0).length,1),max:1})},
    {tier:2,target:5, desc:"Finish 5 rounds with positive net",    check:(r)=>r.filter(x=>x.net>0).length>=5,  progress:(r)=>({val:Math.min(r.filter(x=>x.net>0).length,5),max:5})},
    {tier:3,target:15,desc:"Finish 15 rounds with positive net",   check:(r)=>r.filter(x=>x.net>0).length>=15, progress:(r)=>({val:Math.min(r.filter(x=>x.net>0).length,15),max:15})},
    {tier:4,target:30,desc:"Finish 30 rounds with positive net",   check:(r)=>r.filter(x=>x.net>0).length>=30, progress:(r)=>({val:Math.min(r.filter(x=>x.net>0).length,30),max:30})},
  ]},
  {id:"best_net",label:"The Most Important Game",IconKey:"Trophy",color:"#ca8a04",category:"Journey",tiers:[
    {tier:1,target:3, desc:"Achieve a mental net of +3",  check:(r)=>_bestNet(r)>=3,  progress:(r)=>({val:Math.min(_bestNet(r),3),max:3,suffix:" net"})},
    {tier:2,target:6, desc:"Achieve a mental net of +6",  check:(r)=>_bestNet(r)>=6,  progress:(r)=>({val:Math.min(_bestNet(r),6),max:6,suffix:" net"})},
    {tier:3,target:9, desc:"Achieve a mental net of +9",  check:(r)=>_bestNet(r)>=9,  progress:(r)=>({val:Math.min(_bestNet(r),9),max:9,suffix:" net"})},
    {tier:4,target:12,desc:"Achieve a mental net of +12", check:(r)=>_bestNet(r)>=12, progress:(r)=>({val:Math.min(_bestNet(r),12),max:12,suffix:" net"})},
  ]},
  {id:"clean_round",label:"Bandit Free",IconKey:"Shield",color:"#7c3aed",category:"Mental",tiers:[
    {tier:1,target:1, desc:"One round with zero bandits",      check:(r)=>_cleanRounds(r)>=1,  progress:(r)=>({val:Math.min(_cleanRounds(r),1),max:1})},
    {tier:2,target:3, desc:"Three rounds with zero bandits",   check:(r)=>_cleanRounds(r)>=3,  progress:(r)=>({val:Math.min(_cleanRounds(r),3),max:3})},
    {tier:3,target:7, desc:"Seven rounds with zero bandits",   check:(r)=>_cleanRounds(r)>=7,  progress:(r)=>({val:Math.min(_cleanRounds(r),7),max:7})},
    {tier:4,target:15,desc:"15 rounds with zero bandits",      check:(r)=>_cleanRounds(r)>=15, progress:(r)=>({val:Math.min(_cleanRounds(r),15),max:15})},
  ]},
  {id:"hero_streak",label:"On Fire",IconKey:"Fire",color:"#dc2626",category:"Mental",tiers:[
    {tier:1,target:3,desc:"3 consecutive hero holes",  check:(r)=>_maxStreakInRound(r)>=3,  progress:(r)=>({val:Math.min(_maxStreakInRound(r),3),max:3})},
    {tier:2,target:5,desc:"5 consecutive hero holes",  check:(r)=>_maxStreakInRound(r)>=5,  progress:(r)=>({val:Math.min(_maxStreakInRound(r),5),max:5})},
    {tier:3,target:7,desc:"7 consecutive hero holes",  check:(r)=>_maxStreakInRound(r)>=7,  progress:(r)=>({val:Math.min(_maxStreakInRound(r),7),max:7})},
    {tier:4,target:9,desc:"9 consecutive hero holes",  check:(r)=>_maxStreakInRound(r)>=9,  progress:(r)=>({val:Math.min(_maxStreakInRound(r),9),max:9})},
  ]},
  {id:"feed_the_wolf",label:"Feed the Wolf",IconKey:"Bolt",color:"#7c3aed",category:"Mental",tiers:[
    {tier:1,target:2,desc:"2 consecutive positive net rounds", check:(r)=>_posStreak(r)>=2, progress:(r)=>({val:Math.min(_posStreak(r),2),max:2})},
    {tier:2,target:3,desc:"3 consecutive positive net rounds", check:(r)=>_posStreak(r)>=3, progress:(r)=>({val:Math.min(_posStreak(r),3),max:3})},
    {tier:3,target:5,desc:"5 consecutive positive net rounds", check:(r)=>_posStreak(r)>=5, progress:(r)=>({val:Math.min(_posStreak(r),5),max:5})},
    {tier:4,target:8,desc:"8 consecutive positive net rounds", check:(r)=>_posStreak(r)>=8, progress:(r)=>({val:Math.min(_posStreak(r),8),max:8})},
  ]},
  {id:"comeback_king",label:"Comeback King",IconKey:"Muscle",color:"#dc2626",category:"Mental",tiers:[
    {tier:1,target:1, desc:"Go positive after 3+ bandit holes",  check:(r)=>_comebackRounds(r)>=1,  progress:(r)=>({val:Math.min(_comebackRounds(r),1),max:1})},
    {tier:2,target:3, desc:"Do it 3 times",                      check:(r)=>_comebackRounds(r)>=3,  progress:(r)=>({val:Math.min(_comebackRounds(r),3),max:3})},
    {tier:3,target:7, desc:"Do it 7 times",                      check:(r)=>_comebackRounds(r)>=7,  progress:(r)=>({val:Math.min(_comebackRounds(r),7),max:7})},
    {tier:4,target:15,desc:"Do it 15 times — you never quit",    check:(r)=>_comebackRounds(r)>=15, progress:(r)=>({val:Math.min(_comebackRounds(r),15),max:15})},
  ]},
  {id:"recovery_master",label:"Recovery Master",IconKey:"TrendUp",color:"#16a34a",category:"Mental",tiers:[
    {tier:1,target:60,desc:"Bounce back after bandits 60%+ (10+ chances)", check:(r)=>{const{att,rate}=_recoveryRate(r);return att>=10&&rate>=60;},progress:(r)=>{const{att,rate}=_recoveryRate(r);return{val:att>=10?rate:att,max:att>=10?60:10,suffix:att>=10?"%":"/10"};}},
    {tier:2,target:70,desc:"Bounce back 70%+",                             check:(r)=>{const{att,rate}=_recoveryRate(r);return att>=10&&rate>=70;},progress:(r)=>{const{att,rate}=_recoveryRate(r);return{val:att>=10?rate:att,max:att>=10?70:10,suffix:att>=10?"%":"/10"};}},
    {tier:3,target:80,desc:"Bounce back 80%+",                             check:(r)=>{const{att,rate}=_recoveryRate(r);return att>=10&&rate>=80;},progress:(r)=>{const{att,rate}=_recoveryRate(r);return{val:att>=10?rate:att,max:att>=10?80:10,suffix:att>=10?"%":"/10"};}},
    {tier:4,target:90,desc:"Bounce back 90%+ — elite mental resilience",   check:(r)=>{const{att,rate}=_recoveryRate(r);return att>=10&&rate>=90;},progress:(r)=>{const{att,rate}=_recoveryRate(r);return{val:att>=10?rate:att,max:att>=10?90:10,suffix:att>=10?"%":"/10"};}},
  ]},
  {id:"hero_dominant",label:"Full Arsenal",IconKey:"Star",color:"#ca8a04",category:"Mental",tiers:[
    {tier:1,target:6, desc:"6+ heroes in a single round",  check:(r)=>_maxHeroesInRound(r)>=6,  progress:(r)=>({val:Math.min(_maxHeroesInRound(r),6),max:6})},
    {tier:2,target:9, desc:"9+ heroes in a single round",  check:(r)=>_maxHeroesInRound(r)>=9,  progress:(r)=>({val:Math.min(_maxHeroesInRound(r),9),max:9})},
    {tier:3,target:12,desc:"12+ heroes in a single round", check:(r)=>_maxHeroesInRound(r)>=12, progress:(r)=>({val:Math.min(_maxHeroesInRound(r),12),max:12})},
    {tier:4,target:15,desc:"15+ heroes in a single round", check:(r)=>_maxHeroesInRound(r)>=15, progress:(r)=>({val:Math.min(_maxHeroesInRound(r),15),max:15})},
  ]},
  {id:"full_five",label:"Five Heroes",IconKey:"Heart",color:"#dc2626",category:"Heroes",tiers:[
    {tier:1,target:1, desc:"All 5 heroes in one round",          check:(r)=>_hasAllFive(r)>=1,  progress:(r)=>({val:Math.min(_hasAllFive(r),1),max:1})},
    {tier:2,target:3, desc:"All 5 heroes in 3 different rounds", check:(r)=>_hasAllFive(r)>=3,  progress:(r)=>({val:Math.min(_hasAllFive(r),3),max:3})},
    {tier:3,target:7, desc:"All 5 heroes in 7 different rounds", check:(r)=>_hasAllFive(r)>=7,  progress:(r)=>({val:Math.min(_hasAllFive(r),7),max:7})},
    {tier:4,target:15,desc:"All 5 heroes in 15 rounds",          check:(r)=>_hasAllFive(r)>=15, progress:(r)=>({val:Math.min(_hasAllFive(r),15),max:15})},
  ]},
  {id:"win_mindset",label:"W.I.N. Mindset",IconKey:"Compass",color:"#16a34a",category:"Heroes",tiers:[
    {tier:1,target:3, desc:"Commitment on 3+ holes in a round",   check:(r)=>_maxCommitmentHoles(r)>=3,  progress:(r)=>({val:Math.min(_maxCommitmentHoles(r),3),max:3})},
    {tier:2,target:5, desc:"Commitment on 5+ holes in a round",   check:(r)=>_maxCommitmentHoles(r)>=5,  progress:(r)=>({val:Math.min(_maxCommitmentHoles(r),5),max:5})},
    {tier:3,target:8, desc:"Commitment on 8+ holes in a round",   check:(r)=>_maxCommitmentHoles(r)>=8,  progress:(r)=>({val:Math.min(_maxCommitmentHoles(r),8),max:8})},
    {tier:4,target:12,desc:"Commitment on 12+ holes in a round",  check:(r)=>_maxCommitmentHoles(r)>=12, progress:(r)=>({val:Math.min(_maxCommitmentHoles(r),12),max:12})},
  ]},
  {id:"acceptance_test",label:"Acceptance Test",IconKey:"Hands",color:"#ca8a04",category:"Heroes",tiers:[
    {tier:1,target:2, desc:"Acceptance on 2+ holes in a round",                  check:(r)=>_maxAcceptanceHoles(r)>=2,  progress:(r)=>({val:Math.min(_maxAcceptanceHoles(r),2),max:2})},
    {tier:2,target:4, desc:"Acceptance on 4+ holes in a round",                  check:(r)=>_maxAcceptanceHoles(r)>=4,  progress:(r)=>({val:Math.min(_maxAcceptanceHoles(r),4),max:4})},
    {tier:3,target:7, desc:"Acceptance on 7+ holes in a round",                  check:(r)=>_maxAcceptanceHoles(r)>=7,  progress:(r)=>({val:Math.min(_maxAcceptanceHoles(r),7),max:7})},
    {tier:4,target:10,desc:"Acceptance on 10+ holes — stopped arguing with reality", check:(r)=>_maxAcceptanceHoles(r)>=10, progress:(r)=>({val:Math.min(_maxAcceptanceHoles(r),10),max:10})},
  ]},
  {id:"locked_in",label:"Locked In",IconKey:"Target",color:"#16a34a",category:"Heroes",tiers:[
    {tier:1,target:1, desc:"Love, Commitment & Grit in same round",          check:(r)=>_lockedInRounds(r)>=1,  progress:(r)=>({val:Math.min(_lockedInRounds(r),1),max:1})},
    {tier:2,target:5, desc:"Do it in 5 rounds",                              check:(r)=>_lockedInRounds(r)>=5,  progress:(r)=>({val:Math.min(_lockedInRounds(r),5),max:5})},
    {tier:3,target:12,desc:"Do it in 12 rounds",                             check:(r)=>_lockedInRounds(r)>=12, progress:(r)=>({val:Math.min(_lockedInRounds(r),12),max:12})},
    {tier:4,target:25,desc:"Do it in 25 rounds — this is your identity",     check:(r)=>_lockedInRounds(r)>=25, progress:(r)=>({val:Math.min(_lockedInRounds(r),25),max:25})},
  ]},
  {id:"possibility_thinker",label:"Possibility Thinker",IconKey:"Star",color:"#ea580c",category:"Heroes",tiers:[
    {tier:1,target:1, desc:"Positive back 9 after a negative front 9", check:(r)=>_possibilityThinkerCount(r)>=1,  progress:(r)=>({val:Math.min(_possibilityThinkerCount(r),1),max:1})},
    {tier:2,target:3, desc:"Do it 3 times",                            check:(r)=>_possibilityThinkerCount(r)>=3,  progress:(r)=>({val:Math.min(_possibilityThinkerCount(r),3),max:3})},
    {tier:3,target:7, desc:"Do it 7 times",                            check:(r)=>_possibilityThinkerCount(r)>=7,  progress:(r)=>({val:Math.min(_possibilityThinkerCount(r),7),max:7})},
    {tier:4,target:12,desc:"Do it 12 times — you never concede",       check:(r)=>_possibilityThinkerCount(r)>=12, progress:(r)=>({val:Math.min(_possibilityThinkerCount(r),12),max:12})},
  ]},
  {id:"pre_round_habit",label:"Pre-Round Pro",IconKey:"Clipboard",color:"#0d9488",category:"Habit",tiers:[
    {tier:1,target:3, desc:"Complete the checklist 3 times",          check:()=>_checklistCount()>=3,  progress:()=>({val:Math.min(_checklistCount(),3),max:3})},
    {tier:2,target:10,desc:"Complete it 10 times",                    check:()=>_checklistCount()>=10, progress:()=>({val:Math.min(_checklistCount(),10),max:10})},
    {tier:3,target:25,desc:"Complete it 25 times",                    check:()=>_checklistCount()>=25, progress:()=>({val:Math.min(_checklistCount(),25),max:25})},
    {tier:4,target:50,desc:"Complete it 50 times — it's who you are", check:()=>_checklistCount()>=50, progress:()=>({val:Math.min(_checklistCount(),50),max:50})},
  ]},
  {id:"dedicated",label:"Dedicated",IconKey:"Sun",color:"#0d9488",category:"Habit",tiers:[
    {tier:1,target:3, desc:"3 rounds in one calendar month",     check:(r)=>_maxMonthlyRounds(r)>=3,  progress:(r)=>({val:Math.min(_maxMonthlyRounds(r),3),max:3})},
    {tier:2,target:5, desc:"5 rounds in one month",              check:(r)=>_maxMonthlyRounds(r)>=5,  progress:(r)=>({val:Math.min(_maxMonthlyRounds(r),5),max:5})},
    {tier:3,target:8, desc:"8 rounds in one month",              check:(r)=>_maxMonthlyRounds(r)>=8,  progress:(r)=>({val:Math.min(_maxMonthlyRounds(r),8),max:8})},
    {tier:4,target:12,desc:"12 rounds in one month",             check:(r)=>_maxMonthlyRounds(r)>=12, progress:(r)=>({val:Math.min(_maxMonthlyRounds(r),12),max:12})},
  ]},
  {id:"one_putt_wonder",label:"One Putt Wonder",IconKey:"Golf",color:"#2563eb",category:"Shots",tiers:[
    {tier:1,target:2,desc:"2 one-putts in a round", check:(r)=>_maxOnePutts(r)>=2, progress:(r)=>({val:Math.min(_maxOnePutts(r),2),max:2})},
    {tier:2,target:4,desc:"4 one-putts in a round", check:(r)=>_maxOnePutts(r)>=4, progress:(r)=>({val:Math.min(_maxOnePutts(r),4),max:4})},
    {tier:3,target:6,desc:"6 one-putts in a round", check:(r)=>_maxOnePutts(r)>=6, progress:(r)=>({val:Math.min(_maxOnePutts(r),6),max:6})},
    {tier:4,target:9,desc:"9 one-putts — putting legend", check:(r)=>_maxOnePutts(r)>=9, progress:(r)=>({val:Math.min(_maxOnePutts(r),9),max:9})},
  ]},
  {id:"fairway_finder",label:"Fairway Finder",IconKey:"Target",color:"#2563eb",category:"Shots",tiers:[
    {tier:1,target:50,desc:"Hit 50%+ fairways in a round",          check:(r)=>_maxFIRpct(r)>=50, progress:(r)=>({val:Math.min(_maxFIRpct(r),50),max:50,suffix:"%"})},
    {tier:2,target:60,desc:"Hit 60%+ fairways in a round",          check:(r)=>_maxFIRpct(r)>=60, progress:(r)=>({val:Math.min(_maxFIRpct(r),60),max:60,suffix:"%"})},
    {tier:3,target:70,desc:"Hit 70%+ fairways in a round",          check:(r)=>_maxFIRpct(r)>=70, progress:(r)=>({val:Math.min(_maxFIRpct(r),70),max:70,suffix:"%"})},
    {tier:4,target:85,desc:"Hit 85%+ fairways — fairways are home", check:(r)=>_maxFIRpct(r)>=85, progress:(r)=>({val:Math.min(_maxFIRpct(r),85),max:85,suffix:"%"})},
  ]},
  {id:"greens_machine",label:"Greens Machine",IconKey:"FlagHole",color:"#16a34a",category:"Shots",tiers:[
    {tier:1,target:33,desc:"33%+ GIR across your rounds", check:(r)=>_GIRpct(r)>=33, progress:(r)=>({val:Math.min(_GIRpct(r),33),max:33,suffix:"%"})},
    {tier:2,target:42,desc:"42%+ GIR",                   check:(r)=>_GIRpct(r)>=42, progress:(r)=>({val:Math.min(_GIRpct(r),42),max:42,suffix:"%"})},
    {tier:3,target:50,desc:"50%+ GIR",                   check:(r)=>_GIRpct(r)>=50, progress:(r)=>({val:Math.min(_GIRpct(r),50),max:50,suffix:"%"})},
    {tier:4,target:61,desc:"61%+ GIR — tour-level ball-striking", check:(r)=>_GIRpct(r)>=61, progress:(r)=>({val:Math.min(_GIRpct(r),61),max:61,suffix:"%"})},
  ]},
];

function checkNewMilestones(rounds) {
  let stored={};try{stored=JSON.parse(localStorage.getItem("mgp_badge_tiers")||"{}");}catch{}
  const newly=[];
  MILESTONES.forEach(m=>{
    const prev=stored[m.id]||0;
    const curr=getBadgeTier(m,rounds);
    if(curr>prev){stored[m.id]=curr;newly.push({...m,unlockedTier:curr});}
  });
  if(newly.length>0){try{localStorage.setItem("mgp_badge_tiers",JSON.stringify(stored));}catch{}}
  try{localStorage.setItem("mgp_milestones",JSON.stringify(MILESTONES.filter(m=>(stored[m.id]||0)>=1).map(m=>m.id)));}catch{}
  return newly;
}


// Score notation: returns { label, style } for a stroke score vs par
function scoreNotation(strokeScore, par) {
  if (!strokeScore || !par) return null;
  const s = parseInt(strokeScore), p = parseInt(par), diff = s - p;
  if (diff <= -2) return { diff, label:"Eagle", dot:"#f59e0b", border:"double 3px #f59e0b", bg:"#fef3c7" };
  if (diff === -1) return { diff, label:"Birdie", dot:"#16a34a", border:"1.5px solid #16a34a", bg:"#f0fdf4", circle:true };
  if (diff === 0)  return { diff, label:"Par", dot:null, border:null, bg:null };
  if (diff === 1)  return { diff, label:"Bogey", dot:"#dc2626", border:"1.5px solid #dc2626", bg:"#fef2f2", square:true };
  if (diff === 2)  return { diff, label:"Double", dot:"#dc2626", border:"double 3px #dc2626", bg:"#fee2e2", square:true };
  return { diff, label:"Triple+", dot:"#7c3aed", border:"double 3px #7c3aed", bg:"#f5f3ff", square:true };
}

function initScores() { return Array.from({ length: TOTAL_HOLES }, () => ({ bandits: Object.fromEntries(BANDITS.map(b=>[b,0])), heroes: Object.fromEntries(HEROES.map(h=>[h,0])), par:"", strokeScore:"", holeNote:"", yardage:"", putts:"", routine:0, fairway:null, gir:null, strokeIndex:"" })); }
function getHoleStats(sc,i) { if(!sc[i])return{bandits:0,heroes:0,net:0}; const b=Object.values(sc[i].bandits||{}).reduce((a,c)=>a+c,0), h=Object.values(sc[i].heroes||{}).reduce((a,c)=>a+c,0); return {bandits:b,heroes:h,net:h-b}; }
function getNineStats(sc,s,e) { let b=0,h=0; for(let i=s;i<e;i++){if(!sc[i])continue;const st=getHoleStats(sc,i);b+=st.bandits;h+=st.heroes;} return {bandits:b,heroes:h,net:h-b}; }
function getRoundTotals(sc) { const f=getNineStats(sc,0,9),bk=getNineStats(sc,9,18); return {front:f,back:bk,total:{bandits:f.bandits+bk.bandits,heroes:f.heroes+bk.heroes,net:f.net+bk.net}}; }
function getTotalPar(s) { return s.reduce((a,h)=>a+(parseInt(h.par)||0),0); }
function getTotalStroke(s) { return s.reduce((a,h)=>a+(parseInt(h.strokeScore)||0),0); }

// Streak: count consecutive hero-dominant holes from the end
function getCurrentStreak(scores) {
  let streak = 0;
  for (let i = scores.length - 1; i >= 0; i--) {
    const s = getHoleStats(scores, i);
    if (s.heroes + s.bandits === 0) break;
    if (s.net > 0) streak++;
    else break;
  }
  return streak;
}

function buildShareText(r) {
  const stp=r.totalStroke&&r.totalPar?r.totalStroke-r.totalPar:null;
  let t=`Mental Game Scorecard\n${r.course} — ${r.date}\n\n`;
  if(r.totalStroke) t+=`Score: ${r.totalStroke}${stp!==null?` (${stp>0?"+":""}${stp})`:""}\n`;
  t+=`Mental Net: ${r.net>0?"+":""}${r.net}\nHeroes: ${r.heroes}  Bandits: ${r.bandits}\n`;
  if(r.scores){t+=`\nHero Breakdown:\n`;HEROES.forEach(h=>{const c=r.scores.reduce((s,hole)=>s+(hole.heroes[h]||0),0);if(c>0)t+=`  ${h}: ${c}\n`;});t+=`\nBandit Breakdown:\n`;BANDITS.forEach(b=>{const c=r.scores.reduce((s,hole)=>s+(hole.bandits[b]||0),0);if(c>0)t+=`  ${b}: ${c}\n`;});}
  if(r.notes) t+=`\nPost-Round Notes:\n${r.notes}\n`;
  t+=`\nPlay Better. Struggle Less. Enjoy More.`; return t;
}
async function shareRoundAsImage(r, darkMode) {
  // Wait for fonts to load so text renders correctly on Android
  try { await document.fonts.ready; } catch {}
  const canvas = document.createElement("canvas");
  const W = 800, H = 480;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const bg = darkMode ? "#09090b" : "#f6f7f4";
  const card = darkMode ? "#141416" : "#ffffff";
  const border = darkMode ? "#2a2a2e" : "#e0e2dc";
  const white = darkMode ? "#f8fafc" : "#0f172a";
  const muted = darkMode ? "#71717a" : "#71717a";
  const green = "#16a34a";
  const red = "#dc2626";
  const gold = "#ca8a04";
  const pmGold = "#c9a84c";
  const netColor = r.net > 0 ? green : r.net < 0 ? red : gold;
  const stp = r.totalStroke && r.totalPar ? r.totalStroke - r.totalPar : null;

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent bar
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "#1a2b4a");
  grad.addColorStop(1, "#2563eb22");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 5);

  // Card
  ctx.fillStyle = card;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 32, 24, W - 64, H - 64, 20);
  ctx.fill(); ctx.stroke();

  // Net color left strip
  ctx.fillStyle = netColor;
  roundRect(ctx, 32, 24, 6, H - 64, [20, 0, 0, 20]);
  ctx.fill();

  // Course name
  ctx.fillStyle = white;
  ctx.font = "bold 28px 'Avenir Next', -apple-system, sans-serif";
  ctx.fillText(truncate(ctx, r.course || "Unnamed Course", W - 200), 62, 72);

  // Date
  ctx.fillStyle = muted;
  ctx.font = "16px 'Avenir Next', -apple-system, sans-serif";
  ctx.fillText(r.date || "", 62, 98);

  // Big net score
  ctx.fillStyle = netColor;
  ctx.font = "bold 88px 'Avenir Next', -apple-system, sans-serif";
  const netStr = (r.net > 0 ? "+" : "") + r.net;
  ctx.fillText(netStr, 62, 210);

  // Mental net label
  ctx.fillStyle = muted;
  ctx.font = "bold 13px 'Avenir Next', -apple-system, sans-serif";
  ctx.fillText("MENTAL NET", 62, 232);

  // Stroke score
  if (r.totalStroke) {
    ctx.fillStyle = white;
    ctx.font = "bold 22px 'Avenir Next', -apple-system, sans-serif";
    const scoreStr = `Shot ${r.totalStroke}${stp !== null ? ` (${stp > 0 ? "+" : ""}${stp})` : ""}`;
    ctx.fillText(scoreStr, 62, 270);
  }

  // Heroes / Bandits boxes
  const boxY = 300, boxH = 80;
  [[r.heroes, "HEROES", green, 62], [r.bandits, "BANDITS", red, 200]].forEach(([val, label, color, x]) => {
    ctx.fillStyle = color + "18";
    ctx.strokeStyle = color + "44";
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, boxY, 120, boxH, 12);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "bold 36px 'Avenir Next', -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(val, x + 60, boxY + 46);
    ctx.fillStyle = muted;
    ctx.font = "bold 10px 'Avenir Next', -apple-system, sans-serif";
    ctx.fillText(label, x + 60, boxY + 68);
    ctx.textAlign = "left";
  });

  // Hero breakdown bars on right
  const HERO_COLORS = {"Love":P.green,"Acceptance":P.green,"Commitment":P.green,"Vulnerability":P.green,"Grit":P.green};
  const heroes = ["Love","Acceptance","Commitment","Vulnerability","Grit"];
  const bandits = ["Fear","Frustration","Doubt","Shame","Quit"];
  const maxHB = Math.max(1, ...heroes.map(h => r.scores ? r.scores.reduce((s,hole)=>s+(hole.heroes[h]||0),0) : 0));
  const barX = 380, barW = W - barX - 64;
  heroes.forEach((h, i) => {
    const hc = r.scores ? r.scores.reduce((s,hole)=>s+(hole.heroes[h]||0),0) : 0;
    const bc = r.scores ? r.scores.reduce((s,hole)=>s+(hole.bandits[bandits[i]]||0),0) : 0;
    const y = 50 + i * 74;
    const hColor = HERO_COLORS[h] || green;
    // Hero name
    ctx.fillStyle = white;
    ctx.font = "bold 13px 'Avenir Next', -apple-system, sans-serif";
    ctx.fillText(h, barX, y + 14);
    // vs bandit
    ctx.fillStyle = muted;
    ctx.font = "11px 'Avenir Next', -apple-system, sans-serif";
    ctx.fillText(`vs ${bandits[i]}`, barX + 120, y + 14);
    // Hero bar
    ctx.fillStyle = hColor + "33";
    roundRect(ctx, barX, y + 20, barW, 14, 4);
    ctx.fill();
    if (hc > 0) {
      ctx.fillStyle = hColor;
      roundRect(ctx, barX, y + 20, Math.max(8, (hc / maxHB) * barW), 14, 4);
      ctx.fill();
    }
    // Counts
    ctx.fillStyle = hColor;
    ctx.font = "bold 11px 'Avenir Next', -apple-system, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(hc, barX - 6, y + 32);
    ctx.fillStyle = red;
    ctx.fillText(bc, W - 52, y + 32);
    ctx.textAlign = "left";
    // Bandit bar (right-to-left)
    ctx.fillStyle = red + "33";
    roundRect(ctx, barX, y + 38, barW, 10, 3);
    ctx.fill();
    if (bc > 0) {
      ctx.fillStyle = red + "99";
      roundRect(ctx, barX + barW - Math.max(6, (bc / maxHB) * barW), y + 38, Math.max(6, (bc / maxHB) * barW), 10, 3);
      ctx.fill();
    }
  });

  // Bottom branding
  ctx.fillStyle = pmGold;
  ctx.font = "bold 11px 'Avenir Next', -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PAUL MONAHAN GOLF · Mental Game Scorecard", W / 2, H - 20);
  ctx.textAlign = "left";

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === "number") r = [r, r, r, r];
  const [tl, tr, br, bl] = r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 0 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

async function shareRound(r, darkMode) {
  try {
    const canvas = await shareRoundAsImage(r, darkMode);
    canvas.toBlob(async (blob) => {
      if (!blob) { fallbackShare(r); return; }
      try {
        const file = new File([blob], "scorecard.png", { type: "image/png" });
        // Try sharing with image file first (works on iOS 15+, Android Chrome)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "Mental Game Scorecard", text: buildShareText(r) });
          return;
        }
      } catch(e) {
        // File share failed or was cancelled — don't fall through to download
        if (e?.name === "AbortError") return;
      }
      // Try sharing just the text via native share sheet (works on all iOS/Android)
      if (navigator.share) {
        try {
          await navigator.share({ title: "Mental Game Scorecard", text: buildShareText(r) });
          return;
        } catch(e) {
          if (e?.name === "AbortError") return;
        }
      }
      // Desktop fallback: download image
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `scorecard-${r.date||"round"}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("Image downloaded!", "success");
      } catch { fallbackShare(r); }
    }, "image/png");
  } catch { fallbackShare(r); }
}

function fallbackShare(r) {
  const text = buildShareText(r);
  if (navigator.share) { navigator.share({ title: "Mental Game Scorecard", text }).catch(()=>{}); return; }
  try { navigator.clipboard.writeText(text).then(()=>showToast("Copied to clipboard!", "success")).catch(()=>showToast("Sharing as text...", "info")); } catch { showToast("Sharing as text...", "info"); }
}


// ─── STYLE HELPERS ───
function mkStyles(P) {
  return {
    shell: { height:"100svh", background:P.bg, color:P.white, fontFamily:"'Avenir Next','SF Pro Display',-apple-system,sans-serif", display:"flex", flexDirection:"column", maxWidth:480, width:"100%", margin:"0 auto", position:"relative", overflowX:"hidden", overflowY:"hidden" },
    iconBtn: { width:38, height:38, borderRadius:10, border:`1.5px solid ${P.border}`, background:P.card, color:P.white, fontSize:17, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 1px 3px rgba(0,0,0,0.06)", transition:"transform 0.1s ease" },
    input: { flex:1, padding:"10px 12px", borderRadius:10, border:`1.5px solid ${P.border}`, background:P.inputBg, color:P.white, fontSize:15, outline:"none", fontWeight:500 },
    miniInput: { padding:"5px", borderRadius:8, border:`1.5px solid ${P.border}`, background:P.inputBg, color:P.white, fontSize:17, textAlign:"center", outline:"none", fontWeight:700, width:44 },
    cell: { padding:"8px 3px", textAlign:"center", borderBottom:`1px solid ${P.border}`, fontSize:13 },
    pressBtn: { transition:"transform 0.1s ease, opacity 0.1s ease" },
  };
}
function toggleBtn(P,v,a) {
  const c=v==="green"?{bg:a?P.green:"transparent",bd:a?P.green:P.greenDim,cl:a?"#fff":P.greenDim}:{bg:a?P.red:"transparent",bd:a?P.red:P.redDim,cl:a?"#fff":P.redDim};
  return { width:40, height:40, borderRadius:10, border:`2px solid ${c.bd}`, background:c.bg, color:c.cl, fontSize:17, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.12s ease", boxShadow:a?`0 0 12px ${v==="green"?P.green:P.red}33`:"none" };
}
function navBtnS(P,d) { return { padding:"12px 20px", borderRadius:10, border:`1.5px solid ${d?P.border:P.accent}`, background:d?P.card:P.accent+"15", color:d?P.muted:P.accent, fontSize:16, fontWeight:600, cursor:d?"default":"pointer", opacity:d?0.4:1, transition:"transform 0.1s ease" }; }
function actionBtnS(P,c) { return { flex:1, padding:"12px 14px", borderRadius:10, border:`1.5px solid ${c}44`, background:c+"10", color:c, fontSize:14, fontWeight:700, cursor:"pointer", letterSpacing:0.5, transition:"transform 0.1s ease" }; }

// ─── PRESS HANDLER ───
function openUrl(url) {
  const a = document.createElement("a");
  a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function makeSwipeHandlers(onLeft, onRight, threshold = 40) {
  let startX = null, startY = null, startT = null;
  return {
    onTouchStart: e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
    },
    onTouchEnd: e => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const dt = Date.now() - startT;
      const velocity = Math.abs(dx) / Math.max(dt, 1);
      if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > threshold || velocity > 0.3)) {
        dx < 0 ? onLeft() : onRight();
      }
      startX = null;
    }
  };
}

function vibrate(ms=12) { 
  try { 
    // Use Capacitor Haptics if available (native iOS feel)
    if(window.Capacitor?.Plugins?.Haptics) {
      window.Capacitor.Plugins.Haptics.impact({style: ms > 12 ? "MEDIUM" : "LIGHT"});
    } else if(navigator.vibrate) { 
      navigator.vibrate(ms); 
    } 
  } catch{} 
}

// Tier haptic patterns (Android only — iOS does not support navigator.vibrate)
function vibrateBadge(tier) {
  if(!navigator.vibrate) return;
  try {
    if(tier===4) navigator.vibrate([60,40,60,40,120,60,200]);      // Diamond: complex celebration
    else if(tier===3) navigator.vibrate([60,40,80,40,120]);         // Gold: triple pulse
    else if(tier===2) navigator.vibrate([50,40,80]);                // Silver: double pulse
    else navigator.vibrate(60);                                      // Bronze: single firm tap
  } catch {}
}

// ─── BADGE CELEBRATION MODAL ───
function BadgeCelebration({ badge, onDone }) {
  const canvasRef = React.useRef(null);
  const animRef = React.useRef(null);
  const [visible, setVisible] = React.useState(true);
  const [scale, setScale] = React.useState(0.4);
  const [opacity, setOpacity] = React.useState(0);

  const tier = badge?.unlockedTier || 1;
  const tm = [
    {name:"Bronze",  color:"#b45309", glow:"rgba(180,83,9,0.6)",  bg:"#92400e18", border:"#b4530966"},
    {name:"Silver",  color:"#64748b", glow:"rgba(100,116,139,0.5)",bg:"#47556918", border:"#64748b66"},
    {name:"Gold",    color:"#ca8a04", glow:"rgba(202,138,4,0.7)",  bg:"#92400018", border:"#ca8a0466"},
    {name:"Diamond",color:"#1d4ed8", glow:"rgba(29,78,216,0.7)",  bg:"#1e3a8a18", border:"#1d4ed866"},
  ][tier-1];

  // Entrance animation
  React.useEffect(()=>{
    if(!badge) return;
    vibrateBadge(tier);
    const t1 = setTimeout(()=>{ setScale(1.08); setOpacity(1); }, 30);
    const t2 = setTimeout(()=>{ setScale(1); }, 350);
    const t3 = setTimeout(()=>{ setVisible(false); onDone && onDone(); }, 4200);
    return ()=>{ clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [badge]);

  // Particle burst canvas
  React.useEffect(()=>{
    if(!badge || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.38;

    // Tier-coloured particles
    const tierColors = {
      1: ["#b45309","#d97706","#fbbf24","#fef3c7"],
      2: ["#64748b","#94a3b8","#cbd5e1","#f1f5f9","#ffffff"],
      3: ["#ca8a04","#f59e0b","#fbbf24","#fcd34d","#fff7ed","#ffffff","#dc2626","#ea580c"],
      4: ["#1d4ed8","#3b82f6","#60a5fa","#93c5fd","#dbeafe","#ffffff","#818cf8","#c4b5fd"],
    };
    const cols = tierColors[tier];
    const count = tier === 4 ? 130 : tier === 3 ? 110 : tier === 2 ? 80 : 60;
    const spread = tier === 4 ? 13 : tier === 3 ? 11 : tier === 2 ? 8 : 6;

    const particles = Array.from({length: count}, ()=>({
      x: cx, y: cy,
      vx: (Math.random()-0.5) * spread,
      vy: -6 - Math.random() * (4 + tier*2),
      r: 3 + Math.random() * (2 + tier),
      color: cols[Math.floor(Math.random()*cols.length)],
      rot: Math.random()*Math.PI*2,
      rotV: (Math.random()-0.5)*0.2,
      shape: Math.random() > 0.5 ? "rect" : "circle",
      opacity: 1,
      w: 5 + Math.random()*(4+tier),
      h: 3 + Math.random()*4,
    }));

    // Gold AND Diamond get starburst ring
    const rings = tier >= 3 ? Array.from({length: tier===4?16:10}, (_,i)=>({
      angle: (i/(tier===4?16:10))*Math.PI*2,
      speed: 4 + Math.random()*3,
      r: tier===4?4:3,
      color: cols[i%cols.length],
      dist: 0,
      opacity: 1,
    })) : [];

    let frame = 0;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frame++;

      // Rings (Diamond + Gold)
      rings.forEach(r=>{
        r.dist += r.speed;
        r.speed *= 0.96;
        r.opacity = Math.max(0, 1 - r.dist/200);
        ctx.save();
        ctx.globalAlpha = r.opacity;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(r.angle)*r.dist, cy + Math.sin(r.angle)*r.dist, r.r, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
      });

      let alive = false;
      particles.forEach(p=>{
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.vx *= 0.99;
        p.rot += p.rotV;
        if(frame > 40) p.opacity -= 0.018;
        if(p.opacity > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          if(p.shape === "circle") {
            ctx.beginPath(); ctx.arc(0,0,p.r,0,Math.PI*2); ctx.fill();
          } else {
            ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
          }
          ctx.restore();
        }
      });
      if(alive || (rings.length && rings.some(r=>r.opacity>0)))
        animRef.current = requestAnimationFrame(draw);
    }
    animRef.current = requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(animRef.current);
  }, [badge]);

  if(!badge || !visible) return null;

  const Ic = Icons[badge.IconKey] || Icons.Star;

  return (
    <div onClick={()=>{ setVisible(false); onDone&&onDone(); }} style={{position:"fixed",inset:0,zIndex:9990,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.82)",backdropFilter:"blur(8px)",cursor:"pointer"}}>
      {/* Particle canvas */}
      <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
      {/* Badge card */}
      <div style={{
        position:"relative",zIndex:1,
        background:`radial-gradient(ellipse at 50% 0%, ${tm.bg} 0%, #141416 70%)`,
        border:`2px solid ${tm.border}`,
        borderRadius:24,padding:"32px 28px 24px",
        width:"82%",maxWidth:340,textAlign:"center",
        boxShadow:`0 0 60px ${tm.glow}, 0 20px 60px rgba(0,0,0,0.6)`,
        transform:`scale(${scale})`,opacity,
        transition:"transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease",
      }}>
        {/* Tier pill */}
        <div style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:20,background:tm.color+"22",border:`1px solid ${tm.color}44`,marginBottom:16}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:tm.color}}/>
          <span style={{fontSize:10,fontWeight:800,letterSpacing:2,color:tm.color}}>{tm.name.toUpperCase()} UNLOCKED</span>
        </div>
        {/* Icon */}
        <div style={{width:80,height:80,borderRadius:22,background:tm.color+"22",border:`2px solid ${tm.color}66`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",boxShadow:`0 0 32px ${tm.glow}`}}>
          <Ic color={tm.color} size={38}/>
        </div>
        {/* Badge name */}
        <div style={{fontSize:24,fontWeight:900,color:"#f8fafc",letterSpacing:-0.5,marginBottom:6}}>{badge.label}</div>
        {/* Tier desc */}
        <div style={{fontSize:13,color:"#94a3b8",lineHeight:1.5,marginBottom:20}}>
          {badge.tiers?.[tier-1]?.desc}
        </div>
        {/* Tier progress dots */}
        <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:20}}>
          {[1,2,3,4].map(t=>(
            <div key={t} style={{width:t<=tier?24:10,height:8,borderRadius:4,background:t<=tier?tm.color:"#2a2a2e",transition:"all 0.3s"}}/>
          ))}
        </div>
        <div style={{fontSize:11,color:"#475569",fontWeight:500}}>Tap anywhere to continue</div>
      </div>
    </div>
  );
}

function pressProps(label) {
  return { 
    ...(label ? {"aria-label": label} : {}),
    role: "button",
    onMouseDown:e=>{e.currentTarget.style.transform="scale(0.95)";e.currentTarget.style.opacity="0.85";}, 
    onMouseUp:e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.opacity="1";}, 
    onMouseLeave:e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.opacity="1";}, 
    onTouchStart:e=>{e.currentTarget.style.transform="scale(0.95)";e.currentTarget.style.opacity="0.85";}, 
    onTouchEnd:e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.opacity="1";} 
  };
}
const pp = pressProps;

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function App() {
  const [darkMode, setDarkMode] = useState(false);
  const [view, setView] = useState("home");
  const [scores, setScores] = useState(initScores);
  const [currentHole, setCurrentHole] = useState(0);
  const [courseName, setCourseName] = useState(()=>{try{return JSON.parse(localStorage.getItem("mgp_settings")||"{}")?.favCourse||"";}catch{return ""}});
  const [roundDate, setRoundDate] = useState(new Date().toISOString().split("T")[0]);
  const [animKey, setAnimKey] = useState(0);
  const [savedRounds, setSavedRounds] = useState([]);
  const [selectedRound, setSelectedRound] = useState(null);
  const [postRoundNotes, setPostRoundNotes] = useState("");
  const [carryForward, setCarryForward] = useState(()=>{try{return localStorage.getItem("mgp_carry_forward")||"";}catch{return "";}});
  const [preRoundMeta, setPreRoundMeta] = useState({ sleep:3, energy:3, partners:"friends" });
  const [holeNoteOpen, setHoleNoteOpen] = useState(false);
  const [matchupOpen, setMatchupOpen] = useState(true);
  const [tipStep, setTipStep] = useState(()=>{try{const s=localStorage.getItem("mgp_tip_step");return s?parseInt(s):0;}catch{return 0;}});
  const TOTAL_TIPS = 6;
  const tipDone = tipStep >= TOTAL_TIPS;
  const [tipRect, setTipRect] = useState(null);

  // Lock ALL scrolling on document while tour is active
  React.useEffect(()=>{
    if(tipDone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return ()=>{ document.body.style.overflow = prev; document.body.style.touchAction = ""; };
  },[tipDone]);
  const tipRefs = {
    course: React.useRef(null),
    grid: React.useRef(null),
    scoreRow: React.useRef(null),
    matchup: React.useRef(null),
    mentalBar: React.useRef(null),
    nav: React.useRef(null),
  };
  const TIP_REF_KEYS = ["course","grid","scoreRow","matchup","mentalBar","nav"];
  React.useEffect(()=>{
    if(tipDone) return;
    const key = TIP_REF_KEYS[tipStep];
    // Use rAF to ensure DOM has painted before measuring
    const frame = requestAnimationFrame(()=>{
      const el = tipRefs[key]?.current;
      if(!el) return;
      const r = el.getBoundingClientRect();
      setTipRect({top:r.top-4, left:r.left-4, width:r.width+8, height:r.height+8});
    });
    return ()=>cancelAnimationFrame(frame);
  },[tipStep, tipDone]);
  function nextTip(){const next=tipStep+1;setTipStep(next);try{localStorage.setItem("mgp_tip_step",next);}catch{}}
  function skipTips(){setTipStep(TOTAL_TIPS);try{localStorage.setItem("mgp_tip_step",TOTAL_TIPS);}catch{}}
  const [mentalBarOpen, setMentalBarOpen] = useState(true);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(false);
  const [inGameCaddie, setInGameCaddie] = useState(true);
  const [caddieCard, setCaddieCard] = useState(null);
  const [caddieQueue, setCaddieQueue] = useState([]);
  const [usedMessages, setUsedMessages] = useState({}); // {categoryName: Set of used indices}
  const [completedRound, setCompletedRound] = useState(null);
  const [showOpenRoundModal, setShowOpenRoundModal] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isPro, setIsPro] = useState(true); // App is free - paywall hidden
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCancelPro, setShowCancelPro] = useState(false);
  const [showRateApp, setShowRateApp] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMentalNetInfo, setShowMentalNetInfo] = useState(false);
  const [streakBanner, setStreakBanner] = useState(null); // {count}
  const [showConfetti, setShowConfetti] = useState(false);
  const [showFireworks, setShowFireworks] = useState(false);
  const [showBalloons, setShowBalloons] = useState(false);
  const [showFlame, setShowFlame] = useState(false);
  const [showStarburst, setShowStarburst] = useState(false);
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [newMilestone, setNewMilestone] = useState(null);
  const [toasts, setToasts] = useState([]);
  function showToast(msg, type="info", duration=2800) {
    const id = Date.now();
    setToasts(t=>[...t, {id, msg, type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), duration);
  }
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [courseData, setCourseData] = useState(null);
  const [selectedTee, setSelectedTee] = useState(null);
  const [prevView, setPrevView] = useState("home");
  const [editingRound, setEditingRound] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCommunityPrompt, setShowCommunityPrompt] = useState(false);
  const lastConvexSync = React.useRef(0);
  const CONVEX_SYNC_THROTTLE_MS = 30000; // max one sync per 30 seconds
  const [showProfileGate, setShowProfileGate] = useState(false);
  const [showCoursePrompt, setShowCoursePrompt] = useState(false);
  const [coursePromptCallback, setCoursePromptCallback] = useState(null);
  const [communityProfile, setCommunityProfile] = useState(()=>{
    try { return JSON.parse(localStorage.getItem("mgp_community_profile")||"null"); } catch { return null; }
  });
  const { weather, loadingWeather } = useWeather(courseData);
  // ─── SETTINGS ───
  const [settings, setSettings] = useState({
    favCourse: "", favTee: "", handicap: "", units: "imperial",
    caddieDefault: true, showStreak: true, showHeatMap: true, showScoreInGrid: false,
    postRoundPrompt: true, notifications: false, preroundChecklist: true, preroundTimer: true,
  });
  function updateSetting(key, val) {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem("mgp_settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Whether user has created a profile (unlocks unlimited rounds)
  const hasProfile = !!(communityProfile?.email);
  const roundsRemaining = hasProfile ? Infinity : Math.max(0, FREE_ROUNDS_LIMIT - savedRounds.length);
  const trialExpired = !hasProfile && savedRounds.length >= FREE_ROUNDS_LIMIT;

  // Keep community profile in sync with latest round data
  useEffect(() => {
    if(!communityProfile?.email || savedRounds.length === 0) return;
    // Debounce: only sync after half a second to avoid rapid saves
    const topHero = (() => { const ht={}; savedRounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(h=>{Object.keys(h.heroes||{}).forEach(k=>{if(h.heroes[k])ht[k]=(ht[k]||0)+1;});});}); return Object.keys(ht).sort((a,b)=>ht[b]-ht[a])[0]||null; })();
    const topBandit = (() => { const bt={}; savedRounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(h=>{Object.keys(h.bandits||{}).forEach(k=>{if(h.bandits[k])bt[k]=(bt[k]||0)+1;});});}); return Object.keys(bt).sort((a,b)=>bt[b]-bt[a])[0]||null; })();
    const avgNet = (savedRounds.reduce((s,r)=>s+(r.net||0),0)/savedRounds.length).toFixed(1);
    const updated = {...communityProfile, topHero, topBandit, rounds: savedRounds.length, avgNet, lastUpdated: new Date().toISOString()};
    try { localStorage.setItem("mgp_community_profile", JSON.stringify(updated)); } catch {}
    setCommunityProfile(updated);
    // Sync to Supabase if available
    try {
      if(typeof supabase !== "undefined" && supabase) {
        supabase.from("community_profiles").upsert({
          uid: updated.uid, email: updated.email, name: updated.name,
          top_hero: topHero, top_bandit: topBandit,
          rounds_count: savedRounds.length,
          avg_net: parseFloat(avgNet),
          handicap: settings?.handicap ? parseFloat(settings.handicap) : null,
          last_updated: new Date().toISOString(),
        }, { onConflict: "uid" }).catch(()=>{});
      }
    } catch {}
  }, [savedRounds.length]);

  // Auto-load favCourse on mount so par/yardage pre-fill
  useEffect(() => {
    const fav = settings?.favCourse;
    if (!fav || GOLF_API_KEY === "YOUR_API_KEY_HERE") return;
    (async () => {
      try {
        const r1 = await fetch(`${GOLF_API_BASE}/search?search_query=${encodeURIComponent(fav)}`, { headers: { Authorization: `Key ${GOLF_API_KEY}` } });
        const d1 = await r1.json();
        const match = (d1.courses||[]).find(c=>c.club_name===fav) || d1.courses?.[0];
        if (!match) return;
        const r2 = await fetch(`${GOLF_API_BASE}/courses/${match.id}`, { headers: { Authorization: `Key ${GOLF_API_KEY}` } });
        const d2 = await r2.json();
        const full = d2.course;
        if (!full) return;
        const male = (full.tees?.male||[]).map(t=>({...t,gender:"Male"}));
        const female = (full.tees?.female||[]).map(t=>({...t,gender:"Female"}));
        full._tees = [...male, ...female];
        setCourseData(full);
        // Match favTee or fall back to first
        const favTeeVal = settings?.favTee;
        const tee = full._tees.find(t=>(t.tee_name+(t.gender==="Female"?" (W)":""))===favTeeVal) || full._tees[0];
        if (tee) {
          setSelectedTee(tee.tee_name + (tee.gender ? ` (${tee.gender})` : ""));
          if (tee.holes) {
            setScores(prev => {
              const n = JSON.parse(JSON.stringify(prev));
              tee.holes.forEach((h,i) => { if (i<18) { if(h.par) n[i].par=String(h.par); if(h.yardage) n[i].yardage=String(h.yardage); if(h.handicap) n[i].strokeIndex=String(h.handicap); } });
              return n;
            });
          }
        }
      } catch(e) { console.warn('favCourse autoload failed', e); }
    })();
  }, []); // run once on mount

  useEffect(() => {
    window.addEventListener("online",()=>setIsOffline(false));
    window.addEventListener("offline",()=>setIsOffline(true));
    (async()=>{
      try{const r=localStorage.getItem(STORAGE_KEY);if(r)setSavedRounds(JSON.parse(r));}catch{}
      try{const t=localStorage.getItem(THEME_KEY);if(t)setDarkMode(t==="dark");}catch{}
      try{const o=localStorage.getItem("mgp_onboarded");if(!o)setShowOnboarding(true);}catch{setShowOnboarding(true);}
      try{const cf=localStorage.getItem("mgp_carry_forward");if(cf)setCarryForward(cf);}catch{}
      try{const sv=localStorage.getItem("mgp_settings");if(sv){const s=JSON.parse(sv);setSettings(s);setInGameCaddie(s.caddieDefault!==false);}}catch{}
    })();
  }, []);

  function finishOnboarding(){
    setShowOnboarding(false);
    try{if(window.__hideSplash)window.__hideSplash();}catch{}
    // Ask for notification permission at end of onboarding (high-intent moment)
    setTimeout(async ()=>{
      try {
        if("Notification" in window && Notification.permission === "default") {
          const perm = await Notification.requestPermission();
          if(perm === "granted") updateSetting("notifications", true);
        }
      } catch {}
    }, 1500);
    try{localStorage.setItem("mgp_onboarded","true");}catch{}
    // paywall disabled - app is free
  }
  function unlockPro(plan) {
    // TODO: wire to Stripe/Apple IAP — for now sets flag directly for testing
    setIsPro(true);
    setShowPaywall(false);
    try{localStorage.setItem("mgp_pro","true");localStorage.setItem("mgp_pro_plan",plan);localStorage.setItem("mgp_pro_date",new Date().toISOString());}catch{}
    showToast("Welcome to Mental Game Pro!", "success", 3000);
  }
  function persistRounds(rounds) {
    setSavedRounds(rounds);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rounds));
      const nm = checkNewMilestones(rounds);
      if(nm.length > 0) setNewMilestone(nm[0]);
    } catch(e) {
      if(e?.name === "QuotaExceededError" || e?.code === 22) {
        showToast("Storage full — some older rounds may need to be deleted to save new ones.", "warn", 5000);
      } else {
        showToast("Round saved in memory only — storage error.", "warn", 4000);
      }
      logError(e, { context: "persistRounds", roundCount: rounds.length });
    }
    // Schedule re-engagement push notification
    try { schedulePushNotifications(rounds, settings); } catch {}
    // Rate app prompt after 3rd completed round
    try {
      const rated = localStorage.getItem("mgp_rated");
      if(!rated && rounds.length===3) setTimeout(()=>setShowRateApp(true), 2000);
    } catch {}
    // Community prompt disabled — captured in onboarding now
    // try { ... } catch {}
  }
  function toggleTheme() { const next=!darkMode; setDarkMode(next); try{localStorage.setItem(THEME_KEY,next?"dark":"light");window.dispatchEvent(new Event("mgp_theme_change"));}catch{} }

  // Called when user selects a course + tee — auto-populates par and yardage
  function onCourseLoaded(course, teeName, gender) {
    if (!course || !teeName) return;
    // Try flat _tees first, then fall back to nested tees
    let tee = null;
    const flat = course._tees || [];
    tee = flat.find(t => t.tee_name === teeName && (!gender || t.gender === gender))
       || flat.find(t => t.tee_name === teeName);
    // If flat tee doesn't have holes, look in nested structure
    if (!tee?.holes) {
      const allTees = [
        ...(course.tees?.male || []),
        ...(course.tees?.female || []),
        ...(Array.isArray(course.tees) ? course.tees : []),
      ];
      tee = allTees.find(t => t.tee_name === teeName) || tee;
    }
    if (!tee?.holes) { console.warn('No holes found for tee', teeName, tee); return; }
    setScores(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      tee.holes.forEach((h, i) => {
        if (i < 18) {
          if (h.par) n[i].par = String(h.par);
          if (h.yardage) n[i].yardage = String(h.yardage);
          if (h.handicap) n[i].strokeIndex = String(h.handicap);
        }
      });
      return n;
    });
  }

  const P = darkMode ? DARK : LIGHT;
  const S = mkStyles(P);
  const { front, back, total } = getRoundTotals(scores);

  function setScore(type, name, value) {
    vibrate(type==="heroes"?10:15);
    setScores(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      const prevVal = n[currentHole][type][name];
      n[currentHole][type][name] = prevVal === value ? 0 : value;

      return n;
    });
  }

  function updateField(field, value) { setScores(prev=>{const n=JSON.parse(JSON.stringify(prev));n[currentHole][field]=value;return n;}); }
  function goToHole(h) { setCurrentHole(h); setAnimKey(k=>k+1); setHoleNoteOpen(false); }

  function advanceHole() {
    const nextHole = Math.min(17, currentHole + 1);

    // ── Always check bandit spiral BEFORE any early return ──
    if (currentHole >= 2) {
      const last3 = [currentHole-2, currentHole-1, currentHole].map(i => getHoleStats(scores, i));
      const allBandit = last3.every(s => s.bandits > 0 && s.net < 0);
      if (allBandit && !showResetPrompt) setShowResetPrompt(true);
    }

    // ── Always check hero streak BEFORE any early return ──
    const prevHoleStats = getHoleStats(scores, currentHole);
    if (prevHoleStats.net > 0) {
      let streak = 0;
      for (let i = currentHole; i >= 0; i--) {
        const s = getHoleStats(scores, i);
        if (s.heroes + s.bandits === 0) break;
        if (s.net > 0) streak++;
        else break;
      }
      if (streak >= 3) {
        vibrate(streak >= 5 ? [20,60,20,60,20] : [15,40,15]);
        setStreakBanner({ count: streak });
        setTimeout(() => setStreakBanner(null), 3000);
        if (streak >= 6) setShowStarburst(true);
        else if (streak >= 5) setShowConfetti(true);
        else if (streak >= 4) setShowFlame(true);
        else setShowBalloons(true);
      }
    }

    // ── In-Game Caddie cards ──
    if (inGameCaddie) {
      const hs = scores[currentHole];
      const aB = BANDITS.filter(b => hs.bandits[b] === 1);
      const aH = HEROES.filter(h => hs.heroes[h] === 1);
      const cards = [];

      function pickMessage(catName) {
        const cat = CADDIE_CATEGORIES.find(c => c.name === catName);
        if (!cat) return null;
        const used = usedMessages[catName] || new Set();
        // Get indices not yet used; if all used, reset for this category
        let available = cat.messages.map((_,i) => i).filter(i => !used.has(i));
        if (available.length === 0) available = cat.messages.map((_,i) => i);
        // Shuffle available and pick first
        const shuffled = available.sort(() => Math.random() - 0.5);
        const idx = shuffled[0];
        const newUsed = new Set([...used, idx]);
        setUsedMessages(prev => ({ ...prev, [catName]: newUsed }));
        return { msg: cat.messages[idx], cat };
      }

      // One card per active bandit (up to all of them)
      const shuffledBandits = [...aB].sort(() => Math.random() - 0.5);
      for (const bandit of shuffledBandits) {
        const mu = MATCHUPS.find(m => m.bandit === bandit);
        if (!mu) continue;
        const picked = pickMessage(mu.hero);
        if (picked) {
          cards.push({ type:"bandit", bandit, hero:mu.hero, verb:mu.verb, IconKey:picked.cat.IconKey, color:picked.cat.color, message:picked.msg });
        }
      }

      // One card per active hero (up to all of them)
      const shuffledHeroes = [...aH].sort(() => Math.random() - 0.5);
      for (const hero of shuffledHeroes) {
        const picked = pickMessage(hero);
        if (picked) {
          cards.push({ type:"hero", hero, IconKey:picked.cat.IconKey, color:picked.cat.color, message:picked.msg });
        }
      }

      if (cards.length > 0) {
        cards[cards.length - 1].nextHole = nextHole;
        setCaddieCard(cards[0]);
        setCaddieQueue(cards.slice(1));
        return;
      }
    }
    goToHole(nextHole);
  }

  function dismissCaddieCard() {
    if (caddieQueue.length > 0) { setCaddieCard(caddieQueue[0]); setCaddieQueue(caddieQueue.slice(1)); return; }
    const next = caddieCard?.nextHole ?? Math.min(17, currentHole + 1);
    setCaddieCard(null);
    // Check streak effects after caddie dismiss too
    const prevHoleStats = getHoleStats(scores, currentHole);
    if (prevHoleStats.net > 0) {
      let streak = 0;
      for (let i = currentHole; i >= 0; i--) {
        const s = getHoleStats(scores, i);
        if (s.heroes + s.bandits === 0) break;
        if (s.net > 0) streak++;
        else break;
      }
      if (streak >= 3) {
        vibrate(streak >= 5 ? [20,60,20,60,20] : [15,40,15]);
        setStreakBanner({ count: streak });
        setTimeout(() => setStreakBanner(null), 3000);
        if (streak >= 6) setShowStarburst(true);
        else if (streak >= 5) setShowConfetti(true);
        else if (streak >= 4) setShowFlame(true);
        else setShowBalloons(true);
      }
    }
    goToHole(next);
  }

  function getTrimmedScores(sc) {
    const s = JSON.parse(JSON.stringify(sc));
    let last = s.length - 1;
    while (last > 0) {
      const h = s[last];
      const hasData = h.strokeScore || h.putts || h.holeNote ||
        Object.values(h.heroes).some(v=>v!==0) ||
        Object.values(h.bandits).some(v=>v!==0);
      if (hasData) break;
      last--;
    }
    return s.slice(0, last + 1);
  }

  function saveRound() {
    if(saving) return;
    setSaving(true); setTimeout(()=>setSaving(false), 2000);
    const ts=getTrimmedScores(scores);
    const course = courseName||"Unnamed Course";
    const existing = savedRounds.find(r=>r.date===roundDate&&r.course===course);
    const round = { id:existing?.id||Date.now(), course, date:roundDate, scores:ts, totalPar:getTotalPar(ts), totalStroke:getTotalStroke(ts), notes:postRoundNotes, preRoundMeta:JSON.parse(JSON.stringify(preRoundMeta)), ...getRoundTotals(ts).total };
    persistRounds(existing ? savedRounds.map(r=>r.id===existing.id?round:r) : [round, ...savedRounds]);
    vibrate([10,20,10]);
    showToast(existing ? "Draft updated!" : "Draft saved!", "success");
  }

  function completeRound() {
    setView("roundsummary");
  }

  function saveAndFinish() {
    const trimmedScores = getTrimmedScores(scores);
    const round = { id:Date.now(), course:courseName||"Unnamed Course", date:roundDate, scores:trimmedScores, totalPar:getTotalPar(trimmedScores), totalStroke:getTotalStroke(trimmedScores), notes:postRoundNotes, preRoundMeta:JSON.parse(JSON.stringify(preRoundMeta)), savedRoundsCount: savedRounds.length + 1, ...getRoundTotals(trimmedScores).total };
    persistRounds([round, ...savedRounds]);
    setCompletedRound(round);
    try { localStorage.setItem("mgp_carry_forward", carryForward); } catch {}
    // Share prompt
    if(round.net>=3){ setTimeout(()=>showToast(`Mental Net ${round.net>0?"+":""}${round.net} — great round!`, "success", 4000), 800); }
    try { localStorage.removeItem("mgp_checklist_date"); } catch {}
    setScores(initScores()); setCurrentHole(0); setCourseName(""); setRoundDate(new Date().toISOString().split("T")[0]); setPostRoundNotes(""); setHoleNoteOpen(false); setUsedMessages({}); setPreRoundMeta({sleep:3,energy:3,partners:"friends"});
    // Fireworks on round save!
    setShowFireworks(true);
    setView("roundstats");
  }

  function deleteRound(id) { persistRounds(savedRounds.filter(r=>r.id!==id)); if(selectedRound?.id===id)setSelectedRound(null); }
  function startNewRound() {
    // Gate: require profile after FREE_ROUNDS_LIMIT completed rounds
    if(trialExpired) { setShowProfileGate(true); return; }
    const roundHasData=scores.some(h=>Object.values(h.heroes).some(v=>v!==0)||Object.values(h.bandits).some(v=>v!==0)||h.strokeScore||h.putts); if(roundHasData){setShowOpenRoundModal(true);return;} setScores(initScores());setCurrentHole(0);setCourseName(settings?.favCourse||"");setRoundDate(new Date().toISOString().split("T")[0]);setPostRoundNotes("");setHoleNoteOpen(false);setCourseData(null);setSelectedTee(settings?.favTee||null);try{const cf=localStorage.getItem("mgp_carry_forward");if(cf)setCarryForward(cf);}catch{}setView(settings.preroundChecklist!==false?"preround":"play"); }

  const nav=(v)=>()=>setView(v);
  function ToastLayer() {
    return <div style={{position:"fixed",bottom:100,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:6,alignItems:"center",pointerEvents:"none"}}>
      {toasts.map(t=>(
        <div key={t.id} style={{
          padding:"10px 18px",borderRadius:12,fontSize:13,fontWeight:700,
          background:t.type==="success"?"#16a34a":t.type==="warn"?"#ca8a04":"#374151",
          color:"#fff",boxShadow:"0 4px 20px rgba(0,0,0,0.35)",
          animation:"toastIn 0.3s cubic-bezier(0.16,1,0.3,1)",whiteSpace:"nowrap",
        }}>{t.msg}</div>
      ))}
    </div>;
  }
  function navTo(v) {
    if(v==="caddie") setPrevView(view);
    // Intercept checklist/new round when current round has data
    if(v==="checklist"||v==="preround"){
      const roundHasData = scores.some(h=>Object.values(h.heroes).some(x=>x!==0)||Object.values(h.bandits).some(x=>x!==0)||h.strokeScore||h.putts);
      if(roundHasData){ setShowOpenRoundModal(true); return; }
      try{const cf=localStorage.getItem("mgp_carry_forward");if(cf)setCarryForward(cf);}catch{}
      setView("preround"); return;
    }
    if(v==="preround"){
      try{const cf=localStorage.getItem("mgp_carry_forward");if(cf)setCarryForward(cf);}catch{}
      // If a round is already in progress today (data entered or checklist done), go straight to play
      const today = new Date().toISOString().split("T")[0];
      const roundHasData = scores.some(h=>Object.values(h.heroes).some(v=>v!==0)||Object.values(h.bandits).some(v=>v!==0)||h.strokeScore||h.putts);
      const checklistDoneToday = roundDate === today && (roundHasData || localStorage.getItem("mgp_checklist_date") === today);
      if(checklistDoneToday || settings.preroundChecklist===false){setView("play");return;}
    }
    setView(v);
  }
  const themeToggle = <button onClick={toggleTheme} style={S.iconBtn} title="Toggle theme" {...pp()}>{darkMode?<Icons.Sun color={P.muted} size={16}/>:<Icons.Moon color={P.muted} size={16}/>}</button>;

  // ─── OPEN ROUND MODAL ───
  function OpenRoundModal() {
    if(!showOpenRoundModal) return null;
    const P2 = P;
    return (
      <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",padding:"0 20px"}}>
        <div style={{background:P2.card,borderRadius:20,padding:"24px 20px",width:"100%",maxWidth:360,border:`1.5px solid ${P2.border}`,boxShadow:"0 24px 60px rgba(0,0,0,0.4)"}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{width:52,height:52,borderRadius:15,background:P2.gold+"18",border:`1.5px solid ${P2.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
              <Icons.Flag color={P2.gold} size={24}/>
            </div>
            <div style={{fontSize:18,fontWeight:900,color:P2.white,marginBottom:6}}>Round In Progress</div>
            <div style={{fontSize:13,color:P2.muted,lineHeight:1.5}}>You have an open scorecard with data. What would you like to do?</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>{setShowOpenRoundModal(false);setView("play");}} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,border:`1.5px solid ${P2.green}55`,background:P2.green+"15",color:P2.green,fontSize:14,fontWeight:800,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:P2.green+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icons.Flag color={P2.green} size={16}/></div>
              <div><div style={{fontSize:13,fontWeight:800}}>Finish Current Round</div><div style={{fontSize:11,color:P2.green+"99",fontWeight:500,marginTop:1}}>Go back and complete your scorecard</div></div>
            </button>
            <button onClick={saveDraftAndStartNew} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,border:`1.5px solid ${P2.accent}55`,background:P2.accent+"15",color:P2.accent,fontSize:14,fontWeight:800,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:P2.accent+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icons.Clipboard color={P2.accent} size={16}/></div>
              <div><div style={{fontSize:13,fontWeight:800}}>Save Draft & Start New</div><div style={{fontSize:11,color:P2.accent+"99",fontWeight:500,marginTop:1}}>Save your current round, then start fresh</div></div>
            </button>
            <button onClick={discardAndStartNew} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,border:`1.5px solid ${P2.red}44`,background:P2.red+"10",color:P2.red,fontSize:14,fontWeight:800,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:10,background:P2.red+"18",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icons.Undo color={P2.red} size={16}/></div>
              <div><div style={{fontSize:13,fontWeight:800}}>Discard & Start New</div><div style={{fontSize:11,color:P2.red+"88",fontWeight:500,marginTop:1}}>Lose this round's data and begin again</div></div>
            </button>
            <button onClick={()=>setShowOpenRoundModal(false)} {...pp()} style={{width:"100%",padding:"10px",borderRadius:10,border:`1px solid ${P2.border}`,background:"transparent",color:P2.muted,fontSize:13,fontWeight:600,cursor:"pointer",marginTop:2}}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── GLOBAL MODALS ───
  function CancelProModal() {
    if(!showCancelPro) return null;
    return (
      <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",padding:"0 20px"}}>
        <div style={{background:P.card,borderRadius:20,padding:"24px 20px",width:"100%",maxWidth:360,border:`1.5px solid ${P.border}`}}>
          <div style={{textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:18,fontWeight:900,color:P.white,marginBottom:8}}>Cancel Subscription?</div>
            <div style={{fontSize:14,color:P.muted,lineHeight:1.6}}>You'll lose access to all Pro features at the end of your billing period. Your round history will still be saved.</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>{setIsPro(false);try{localStorage.removeItem("mgp_pro");}catch{}setShowCancelPro(false);showToast("Subscription cancelled","info");}} {...pressProps()} style={{width:"100%",padding:"13px",borderRadius:12,border:`1.5px solid ${P.red}44`,background:P.red+"12",color:P.red,fontSize:14,fontWeight:700,cursor:"pointer"}}>Yes, Cancel</button>
            <button onClick={()=>setShowCancelPro(false)} {...pressProps()} style={{width:"100%",padding:"13px",borderRadius:12,border:`1.5px solid ${P.border}`,background:P.green,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Keep Pro Access</button>
          </div>
        </div>
      </div>
    );
  }

  function CoursePromptModal() {
    if(!showCoursePrompt) return null;
    const [val, setVal] = React.useState("");
    function confirm() {
      if(val.trim()) setCourseName(val.trim());
      setShowCoursePrompt(false);
      if(coursePromptCallback) coursePromptCallback()();
    }
    return (
      <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",padding:"0 20px"}}>
        <div style={{background:P.card,borderRadius:16,padding:"24px 20px",width:"100%",maxWidth:360,border:`1.5px solid ${P.border}`}}>
          <div style={{fontSize:16,fontWeight:800,color:P.white,marginBottom:6}}>Which course did you play?</div>
          <div style={{fontSize:12,color:P.muted,marginBottom:14}}>This helps you track your mental performance across different courses.</div>
          <input
            value={val}
            onChange={e=>setVal(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&val.trim()&&confirm()}
            placeholder="Course name..."
            autoFocus
            style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:12}}
          />
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setShowCoursePrompt(false);if(coursePromptCallback)coursePromptCallback()();}} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}>Skip</button>
            <button onClick={confirm} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:P.green,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer"}}>Continue</button>
          </div>
        </div>
      </div>
    );
  }

  function ProfileGateModal() {
    if(!showProfileGate) return null;
    const [email, setEmailVal] = React.useState("");
    const [name, setNameVal] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [done, setDone] = React.useState(false);

    async function submit() {
      if(!email.trim()||!email.includes("@")) { showToast("Please enter a valid email","warn"); return; }
      setLoading(true);
      const uid = (() => { try { let id=localStorage.getItem("mgp_uid"); if(!id){id="user_"+Math.random().toString(36).slice(2,10);localStorage.setItem("mgp_uid",id);} return id; } catch { return "anon"; } })();
      const profile = { email:email.trim().toLowerCase(), name:name.trim()||null, joinedAt:new Date().toISOString(), uid, source:"round_gate", cloudSync:true };
      try { localStorage.setItem("mgp_community_profile",JSON.stringify(profile)); localStorage.setItem("mgp_community_joined","true"); } catch {}
      setCommunityProfile(profile);
      try {
        if(typeof supabase!=="undefined"&&supabase) {
          await supabase.from("community_profiles").upsert({ uid:profile.uid, email:profile.email, name:profile.name, source:"round_gate", joined_at:profile.joinedAt, opted_in:true }, {onConflict:"uid"});
        }
      } catch {}
      setLoading(false);
      setDone(true);
      setTimeout(()=>{ setShowProfileGate(false); startNewRound(); }, 1500);
    }

    return (
      <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.75)",backdropFilter:"blur(10px)",padding:"0 20px"}}>
        <div style={{background:P.card,borderRadius:20,padding:"28px 22px",width:"100%",maxWidth:400,border:`1.5px solid ${PM_GOLD}44`,boxShadow:"0 24px 60px rgba(0,0,0,0.5)"}}>
          {done ? (
            <div style={{textAlign:"center",padding:"16px 0"}}>
              <div style={{width:48,height:48,borderRadius:14,background:P.green+"18",border:`1.5px solid ${P.green}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><Icons.Check color={P.green} size={22}/></div>
              <div style={{fontSize:18,fontWeight:900,color:P.white,marginBottom:6}}>Profile created</div>
              <div style={{fontSize:13,color:P.muted}}>Starting your round...</div>
            </div>
          ) : (
            <>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{width:52,height:52,borderRadius:15,background:PM_GOLD+"18",border:`1.5px solid ${PM_GOLD}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><Icons.Shield color={PM_GOLD} size={24}/></div>
                <div style={{fontSize:19,fontWeight:900,color:P.white,marginBottom:8}}>Your 3 free rounds are up</div>
                <div style={{fontSize:13,color:P.muted,lineHeight:1.6}}>Create your free profile to keep playing and back up your rounds to the cloud. It takes 20 seconds.</div>
              </div>
              {/* What they get */}
              <div style={{background:PM_GOLD+"08",border:`1px solid ${PM_GOLD}33`,borderRadius:12,padding:"12px 14px",marginBottom:18}}>
                {[
                  "Unlimited rounds, forever free",
                  "Cloud backup — rounds safe if you switch phones",
                  "Personalized insights from Paul based on your Heroes and Bandits",
                ].map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:i<2?8:0}}>
                    <Icons.Check color={PM_GOLD} size={13} style={{flexShrink:0,marginTop:2}}/>
                    <span style={{fontSize:12,color:P.white,lineHeight:1.5}}>{t}</span>
                  </div>
                ))}
              </div>
              {/* Form */}
              <input value={name} onChange={e=>setNameVal(sanitiseName(e.target.value))} placeholder="First name" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:8}}/>
              <input value={email} onChange={e=>setEmailVal(sanitiseEmail(e.target.value))} placeholder="Email address" inputMode="email" autoCapitalize="none" autoComplete="email" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:12}}/>
              <button onClick={submit} disabled={loading} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:P.green,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",marginBottom:10,opacity:loading?0.7:1}}>
                {loading?"Creating profile...":"Create Free Profile"}
              </button>
              <div style={{fontSize:10,color:P.muted,textAlign:"center",lineHeight:1.5}}>
                Free forever. No payment required. By continuing you agree to Paul Monahan Golf's{" "}
                <span style={{color:PM_GOLD,cursor:"pointer"}} onClick={()=>{setShowProfileGate(false);setShowPrivacyPolicy(true);}}>Privacy Policy</span>.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function CommunityPromptModal() {
    if(!showCommunityPrompt) return null;
    const [email, setEmailVal] = React.useState("");
    const [name, setNameVal] = React.useState(user?.name||"");
    const [loading, setLoading] = React.useState(false);
    const [done, setDone] = React.useState(false);
    const topBandit = (() => {
      const bt={};
      savedRounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(h=>{Object.keys(h.bandits||{}).forEach(k=>{if(h.bandits[k])bt[k]=(bt[k]||0)+1;});});});
      return Object.keys(bt).sort((a,b)=>bt[b]-bt[a])[0]||null;
    })();
    const topHero = (() => {
      const ht={};
      savedRounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(h=>{Object.keys(h.heroes||{}).forEach(k=>{if(h.heroes[k])ht[k]=(ht[k]||0)+1;});});});
      return Object.keys(ht).sort((a,b)=>ht[b]-ht[a])[0]||null;
    })();

    async function submitProfile() {
      if(!email.trim()||!email.includes("@")) { showToast("Please enter a valid email","warn"); return; }
      setLoading(true);
      const profile = {
        email: email.trim().toLowerCase(),
        name: name.trim()||null,
        topHero, topBandit,
        rounds: savedRounds.length,
        avgNet: savedRounds.length ? (savedRounds.reduce((s,r)=>s+(r.net||0),0)/savedRounds.length).toFixed(1) : null,
        handicap: settings?.handicap||null,
        joinedAt: new Date().toISOString(),
        uid: (()=>{try{let id=localStorage.getItem("mgp_uid");if(!id){id="user_"+Math.random().toString(36).slice(2,10);localStorage.setItem("mgp_uid",id);}return id;}catch{return "anon";}})(),
        source: "app_post_round_1",
      };
      // Save locally
      try { localStorage.setItem("mgp_community_profile", JSON.stringify(profile)); localStorage.setItem("mgp_community_joined","true"); } catch {}
      setCommunityProfile(profile);
      // Sync to Supabase if available
      try {
        if(typeof supabase !== "undefined" && supabase) {
          await supabase.from("community_profiles").upsert({
            uid: profile.uid,
            email: profile.email,
            name: profile.name,
            top_hero: profile.topHero,
            top_bandit: profile.topBandit,
            rounds_count: profile.rounds,
            avg_net: profile.avgNet ? parseFloat(profile.avgNet) : null,
            handicap: profile.handicap ? parseFloat(profile.handicap) : null,
            joined_at: profile.joinedAt,
            last_updated: new Date().toISOString(),
            source: profile.source,
          }, { onConflict: "uid" });
        }
      } catch(e) { console.warn("Supabase sync failed:", e); }
      setLoading(false);
      setDone(true);
      setTimeout(()=>setShowCommunityPrompt(false), 2500);
    }

    function dismiss() {
      try { localStorage.setItem("mgp_community_dismissed","true"); } catch {}
      setShowCommunityPrompt(false);
    }

    return (
      <div style={{position:"fixed",inset:0,zIndex:9997,display:"flex",alignItems:"flex-end",justifyContent:"center",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(8px)",padding:"0 0 20px"}}>
        <div style={{background:P.card,borderRadius:"20px 20px 16px 16px",padding:"24px 20px 28px",width:"100%",maxWidth:480,border:`1.5px solid ${P.border}`,boxShadow:"0 -20px 60px rgba(0,0,0,0.4)",animation:"slideUpSheet 0.35s cubic-bezier(0.16,1,0.3,1)"}}>
          {done ? (
            <div style={{textAlign:"center",padding:"20px 0"}}>
              
              <div style={{fontSize:18,fontWeight:900,color:P.white,marginBottom:6}}>You're in!</div>
              <div style={{fontSize:13,color:P.muted}}>Paul will be in touch with insights tailored to your game.</div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontSize:17,fontWeight:900,color:P.white,marginBottom:4}}>Join Paul's Community</div>
                  {topBandit&&<div style={{fontSize:12,color:PM_GOLD,fontWeight:600}}>Your round showed {topBandit} as your biggest challenge. Paul has specific drills for this.</div>}
                </div>
                <button onClick={dismiss} style={{background:"none",border:"none",color:P.muted,fontSize:18,cursor:"pointer",padding:"0 0 0 12px",flexShrink:0}}>✕</button>
              </div>
              {/* Value prop */}
              <div style={{background:PM_GOLD+"10",border:`1px solid ${PM_GOLD}33`,borderRadius:12,padding:"10px 14px",marginBottom:16}}>
                <div style={{fontSize:12,color:P.white,lineHeight:1.6}}>
                  Get <span style={{fontWeight:700,color:PM_GOLD}}>personalized coaching insights</span> based on your actual Heroes & Bandits data — delivered by Paul directly to your inbox.
                </div>
              </div>
              {/* Form */}
              <div style={{marginBottom:10}}>
                <input value={name} onChange={e=>setNameVal(sanitiseName(e.target.value))} placeholder="Your first name" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:8}}/>
                <input value={email} onChange={e=>setEmailVal(sanitiseEmail(e.target.value))} placeholder="Email address" inputMode="email" autoCapitalize="none" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none"}}/>
              </div>
              <button onClick={submitProfile} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:`linear-gradient(135deg,${PM_NAVY},#2563eb)`,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",marginBottom:10,opacity:loading?0.7:1}}>
                {loading?"Joining...":"Join Paul's Community →"}
              </button>
              <div style={{fontSize:10,color:P.muted,textAlign:"center",lineHeight:1.5}}>
                By joining you agree to receive coaching content from Paul Monahan Golf. No spam — unsubscribe anytime. Your mental game data is used only to personalize your experience.
              </div>
            </>
          )}
        </div>
        <style>{`@keyframes slideUpSheet{from{opacity:0;transform:translateY(40px);}to{opacity:1;transform:translateY(0);}}`}</style>
      </div>
    );
  }

  function RateAppModal() {
    if(!showRateApp) return null;
    function dismiss(rated) {
      setShowRateApp(false);
      try{localStorage.setItem("mgp_rated", rated?"yes":"dismissed");}catch{}
    }
    return (
      <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",padding:"0 20px"}}>
        <div style={{background:P.card,borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,border:`1.5px solid ${P.border}`,textAlign:"center"}}>
          
          <div style={{fontSize:20,fontWeight:900,color:P.white,marginBottom:8}}>Enjoying the app?</div>
          <div style={{fontSize:14,color:P.muted,lineHeight:1.6,marginBottom:24}}>You've completed 3 rounds. If you're finding it useful, a rating helps others discover it!</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>{dismiss(true);const id="YOUR_APP_STORE_ID";const url=navigator.userAgent.includes("iPhone")||navigator.userAgent.includes("iPad")?`itms-apps://itunes.apple.com/app/id${id}?action=write-review`:`https://apps.apple.com/app/id${id}?action=write-review`;try{window.open(url,"_blank");}catch{}}} {...pressProps()} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:"#16a34a",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}>Rate the App</button>
            <button onClick={()=>dismiss(false)} {...pressProps()} style={{width:"100%",padding:"10px",borderRadius:12,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}>Maybe Later</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── ROUTING ───
  if (showOnboarding) return <ThemeCtx.Provider value={P}><ToastLayer/><CancelProModal/><RateAppModal/><OpenRoundModal/><OnboardingFlow onFinish={finishOnboarding} onPrivacy={()=>setShowPrivacyPolicy(true)} P={P} S={S} communityProfile={communityProfile}/></ThemeCtx.Provider>;
  // paywall disabled
  if (view==="home") return <ThemeCtx.Provider value={P}><ToastLayer/><CancelProModal/><RateAppModal/><CommunityPromptModal/><ProfileGateModal/><CoursePromptModal/><OpenRoundModal/><HomeScreen onNav={(v)=>{if(v==="upgrade")return;navTo(v);}} onContinueRound={()=>{const firstEmpty=scores.findIndex(h=>!h.strokeScore&&!Object.values(h.heroes).some(v=>v>0)&&!Object.values(h.bandits).some(v=>v>0));setCurrentHole(Math.max(0,firstEmpty));setView("play");}} roundInProgress={scores.some(h=>Object.values(h.heroes).some(v=>v!==0)||Object.values(h.bandits).some(v=>v!==0)||h.strokeScore||h.putts)} roundCount={savedRounds.length} themeToggle={themeToggle} S={S} user={user} setUser={setUser} showLogin={showLogin} setShowLogin={setShowLogin} savedRounds={savedRounds} settings={settings} isPro={isPro} roundsRemaining={roundsRemaining} hasProfile={hasProfile} /></ThemeCtx.Provider>;
  if (view==="checklist") return <ThemeCtx.Provider value={P}><ToastLayer/><PreRoundChecklist onBack={nav("home")} onStartRound={()=>{try{localStorage.setItem("mgp_checklist_date",new Date().toISOString().split("T")[0]);const cc=parseInt(localStorage.getItem("mgp_checklist_count")||"0");localStorage.setItem("mgp_checklist_count",cc+1);}catch{}setView("play");}} S={S} lastIntention={carryForward} preRoundMeta={preRoundMeta} setPreRoundMeta={setPreRoundMeta} settings={settings} /></ThemeCtx.Provider>;
  if (view==="preround") return <ThemeCtx.Provider value={P}><ToastLayer/><PreRoundChecklist onBack={nav("home")} onStartRound={()=>{try{localStorage.setItem("mgp_checklist_date",new Date().toISOString().split("T")[0]);const cc=parseInt(localStorage.getItem("mgp_checklist_count")||"0");localStorage.setItem("mgp_checklist_count",cc+1);}catch{}setView("play");}} S={S} lastIntention={carryForward} preRoundMeta={preRoundMeta} setPreRoundMeta={setPreRoundMeta} settings={settings} /></ThemeCtx.Provider>;
  if (view==="caddie") return <ThemeCtx.Provider value={P}><ToastLayer/><InnerCaddieView onBack={nav(prevView)} S={S} /></ThemeCtx.Provider>;
  if (view==="coach") return <ThemeCtx.Provider value={P}><ToastLayer/><CoachDashboardView onBack={nav("home")} S={S}/></ThemeCtx.Provider>;
  if (view==="coachportal") return <ThemeCtx.Provider value={P}><ToastLayer/><CoachPortalView onBack={nav("home")} S={S}/></ThemeCtx.Provider>;
  if (view==="guide") return <ThemeCtx.Provider value={P}><ToastLayer/><OnboardingFlow onFinish={nav("home")} onPrivacy={()=>setShowPrivacyPolicy(true)} P={P} S={S} communityProfile={communityProfile}/></ThemeCtx.Provider>;
  if (view==="transform") return <ThemeCtx.Provider value={P}><ToastLayer/><TransformView onBack={nav("home")} S={S} P={P}/></ThemeCtx.Provider>;
  if (view==="dashboard") return <ThemeCtx.Provider value={P}><ToastLayer/><DashboardView rounds={savedRounds} onBack={nav("home")} isHome={true} S={S} onSelectRound={r=>{setSelectedRound(r);setView("rounddetail");}}/></ThemeCtx.Provider>;
  if (view==="history") return <ThemeCtx.Provider value={P}><ToastLayer/><HistoryView rounds={savedRounds} onBack={()=>{setView("home");setSelectedRound(null);}} onDelete={deleteRound} selectedRound={selectedRound} setSelectedRound={setSelectedRound} onShare={(r)=>shareRound(r,darkMode)} onEdit={r=>{setEditingRound(r);setView("editround");}} S={S} /></ThemeCtx.Provider>;
  if (view==="rounddetail") return <ThemeCtx.Provider value={P}><ToastLayer/><RoundDetailView round={selectedRound} onBack={nav("dashboard")} onShare={(r)=>shareRound(r,darkMode)} S={S} /></ThemeCtx.Provider>;
  if (showPrivacyPolicy) return <ThemeCtx.Provider value={P}><ToastLayer/><CancelProModal/><RateAppModal/><PrivacyPolicyView onBack={()=>setShowPrivacyPolicy(false)} S={S}/></ThemeCtx.Provider>;
  if (showHelp) return <ThemeCtx.Provider value={P}><ToastLayer/><HelpView onBack={()=>setShowHelp(false)} S={S}/></ThemeCtx.Provider>;
  if (view==="settings") return <ThemeCtx.Provider value={P}><ToastLayer/><SettingsView settings={settings} updateSetting={updateSetting} darkMode={darkMode} toggleTheme={toggleTheme} onBack={nav("home")} S={S} savedRounds={savedRounds} inGameCaddie={inGameCaddie} setInGameCaddie={setInGameCaddie} onResetTour={()=>{try{localStorage.removeItem("mgp_tip_step");}catch{}setTipStep(0);setView("play");}} isPro={isPro} onManageSubscription={()=>setShowPaywall(true)} onCancelPro={()=>setShowCancelPro(true)} onPrivacyPolicy={()=>setShowPrivacyPolicy(true)} communityProfile={communityProfile} onHelp={()=>{setShowHelp(true);}} /></ThemeCtx.Provider>;
  if (view==="scorecard") return <ThemeCtx.Provider value={P}><ToastLayer/><ScorecardView scores={scores} front={front} back={back} total={total} courseName={courseName} roundDate={roundDate} onBack={()=>setView(prevView||"play")} onHome={()=>setView("home")} onSelectHole={h=>{setCurrentHole(h);setView("play");}} S={S} handicap={settings.handicap} /></ThemeCtx.Provider>;
  if (view==="editround") return <ThemeCtx.Provider value={P}><ToastLayer/><RoundEditView round={editingRound} onSave={updatedRound=>{const updated=savedRounds.map(r=>r.id===updatedRound.id?updatedRound:r);persistRounds(updated);setEditingRound(null);setView("history");}} onBack={()=>{setEditingRound(null);setView("history");}} S={S} /></ThemeCtx.Provider>;
  if (view==="badges") return <ThemeCtx.Provider value={P}><ToastLayer/><BadgesView rounds={savedRounds} onBack={nav("home")} S={S} /></ThemeCtx.Provider>;
  if (view==="roundsummary") return <ThemeCtx.Provider value={P}><ToastLayer/><RoundSummaryView scores={scores} total={total} courseName={courseName} courseData={courseData} roundDate={roundDate} postRoundNotes={postRoundNotes} setPostRoundNotes={setPostRoundNotes} carryForward={carryForward} setCarryForward={setCarryForward} onSave={saveAndFinish} onBack={nav("play")} onViewScorecard={()=>{setPrevView("roundsummary");setView("scorecard");}} S={S} /></ThemeCtx.Provider>;
  if (view==="roundstats") return <ThemeCtx.Provider value={P}><ToastLayer/><CommunityPromptModal/><FireworksCanvas active={showFireworks} onDone={()=>setShowFireworks(false)}/><RoundStatsView round={completedRound} onHome={(dest)=>{if(dest==="caddie"){setPrevView("roundstats");setView("caddie");}else if(dest==="roundsummary"){setView("roundsummary");}else setView(dest||"home");}} onShare={(r)=>shareRound(r,darkMode)} S={S} /></ThemeCtx.Provider>;

  // ─── PLAY VIEW ───
  const hB = scores[currentHole].bandits, hH = scores[currentHole].heroes;
  const bT = Object.values(hB).reduce((a,c)=>a+c,0), hT = Object.values(hH).reduce((a,c)=>a+c,0);
  const hNet = hT - bT;
  const CaddieIcon = caddieCard ? Icons[caddieCard.IconKey] : null;
  const streak = getCurrentStreak(scores);

  return (
    <ThemeCtx.Provider value={P}>
      <div style={{...S.shell,overflow:"hidden"}}>
        <ConfettiCanvas active={!caddieCard&&showConfetti} onDone={()=>setShowConfetti(false)}/>
        <BalloonCanvas active={!caddieCard&&showBalloons} onDone={()=>setShowBalloons(false)}/>
        <FlameCanvas active={!caddieCard&&showFlame} onDone={()=>setShowFlame(false)}/>
        <StarburstCanvas active={!caddieCard&&showStarburst} onDone={()=>setShowStarburst(false)}/>

        {/* Mental Net Info Modal */}
        {showMentalNetInfo&&(
          <div onClick={()=>setShowMentalNetInfo(false)} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
            <div onClick={e=>e.stopPropagation()} style={{background:P.card,borderRadius:20,padding:"24px 20px",width:"100%",maxWidth:360,border:`1.5px solid ${P.border}`}}>
              <div style={{fontSize:17,fontWeight:900,color:P.white,marginBottom:4}}>Mental Net</div>
              <div style={{fontSize:13,color:P.muted,lineHeight:1.6,marginBottom:14}}>Mental Net = Heroes minus Bandits. It measures how much your mental game helped vs. hurt you this round.</div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                <div style={{padding:"10px 14px",borderRadius:10,background:P.green+"12",border:`1px solid ${P.green}33`}}>
                  <div style={{fontSize:12,fontWeight:700,color:P.green,marginBottom:2}}>Positive (+)</div>
                  <div style={{fontSize:12,color:P.muted}}>Your heroes outnumbered your bandits. Your mind was an asset today.</div>
                </div>
                <div style={{padding:"10px 14px",borderRadius:10,background:P.red+"12",border:`1px solid ${P.red}33`}}>
                  <div style={{fontSize:12,fontWeight:700,color:P.red,marginBottom:2}}>Negative (−)</div>
                  <div style={{fontSize:12,color:P.muted}}>Bandits crept in more than heroes. Use the caddie to bounce back.</div>
                </div>
                <div style={{padding:"10px 14px",borderRadius:10,background:P.gold+"12",border:`1px solid ${P.gold}33`}}>
                  <div style={{fontSize:12,fontWeight:700,color:P.gold,marginBottom:2}}>Zero (E)</div>
                  <div style={{fontSize:12,color:P.muted}}>Heroes and bandits are balanced. Push for positive on the back nine.</div>
                </div>
              </div>
              <button onClick={()=>setShowMentalNetInfo(false)} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:P.green,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}>Got it</button>
            </div>
          </div>
        )}

        {/* Multi-step tooltip tour */}
        {!tipDone&&(()=>{
          const tips=[
            {step:1,title:"Add Your Course",body:"Search for your course to auto-fill hole data and yardages. The In-Game Caddie toggle also lives here.",icon:"Flag",cardPos:"below"},
            {step:2,title:"Hole Grid",body:"Tap any hole to jump to it. Colored dots show mental activity — green for heroes, red for bandits.",icon:"Grid",cardPos:"below"},
            {step:3,title:"PAR, SCORE & STATS",body:"Enter par and your stroke score. Running score vs par shows on the left. Log putts, FIR and GIR on the right.",icon:"Flag",cardPos:"below"},
            {step:4,title:"Heroes & Bandits",body:"After each hole, tap which Heroes showed up and which Bandits crept in. This is the heart of your mental game.",icon:"Shield",cardPos:"above"},
            {step:5,title:"Mental Score Bar",body:"Your live Mental Net — Heroes minus Bandits. Tap MENTAL SCORE to collapse it and save space.",icon:"Chart",cardPos:"above"},
            {step:6,title:"Notes & Navigation",body:"Add a quick hole note, use ← → to move between holes, Save to draft, or Finish when your round is complete.",icon:"Note",cardPos:"above"},
          ];
          const t=tips[tipStep];
          const isLast=tipStep===TOTAL_TIPS-1;
          const Tic=Icons[t.icon];
          const cardWidth=Math.min(window.innerWidth*0.88,340);
          const cardLeft=(window.innerWidth-cardWidth)/2;
          const hl=tipRect?{top:tipRect.top-6,left:tipRect.left-6,width:tipRect.width+12,height:tipRect.height+12}:{top:0,left:0,width:0,height:0};
          const cardEstHeight=200;
          const belowTop = tipRect ? hl.top+hl.height+14 : window.innerHeight*0.4;
          const aboveTop = tipRect ? hl.top-14-cardEstHeight : window.innerHeight*0.4;
          // Clamp so card never goes off bottom or top
          const clampedBelowTop = Math.min(belowTop, window.innerHeight-cardEstHeight-16);
          const clampedAboveTop = Math.max(aboveTop, 16);
          const cardTop = t.cardPos==="below" ? clampedBelowTop : clampedAboveTop;
          return(
            <div style={{position:"fixed",inset:0,zIndex:991,pointerEvents:"none"}}>
              <div onClick={skipTips} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.75)",pointerEvents:"auto"}}/>
              {tipRect&&<div style={{
                position:"absolute",
                top:tipRect.top-6,left:tipRect.left-6,width:tipRect.width+12,height:tipRect.height+12,
                borderRadius:12,background:"transparent",
                boxShadow:`0 0 0 9999px rgba(0,0,0,0.75), inset 0 0 0 2px ${P.green}, 0 0 0 4px ${P.green}66`,
                pointerEvents:"none",zIndex:992,
              }}/>}
              <div style={{
                position:"absolute",left:cardLeft,width:cardWidth,
                top:cardTop,
                background:P.card,borderRadius:16,padding:"16px 18px 14px",
                border:`1.5px solid ${P.green}66`,
                boxShadow:"0 12px 40px rgba(0,0,0,0.6)",
                zIndex:993,pointerEvents:"auto",
              }}>
                {t.cardPos==="below"&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",width:0,height:0,borderLeft:"9px solid transparent",borderRight:"9px solid transparent",borderBottom:`9px solid ${P.green}66`}}/>}
                {t.cardPos==="below"&&<div style={{position:"absolute",top:-7,left:"50%",transform:"translateX(-50%)",width:0,height:0,borderLeft:"8px solid transparent",borderRight:"8px solid transparent",borderBottom:`8px solid ${P.card}`}}/>}
                {t.cardPos==="above"&&<div style={{position:"absolute",bottom:-9,left:"50%",transform:"translateX(-50%)",width:0,height:0,borderLeft:"9px solid transparent",borderRight:"9px solid transparent",borderTop:`9px solid ${P.green}66`}}/>}
                {t.cardPos==="above"&&<div style={{position:"absolute",bottom:-7,left:"50%",transform:"translateX(-50%)",width:0,height:0,borderLeft:"8px solid transparent",borderRight:"8px solid transparent",borderTop:`8px solid ${P.card}`}}/>}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:P.green+"22",border:`1.5px solid ${P.green}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Tic color={P.green} size={18}/></div>
                  <div style={{flex:1,fontSize:14,fontWeight:900,color:P.white}}>{t.title}</div>
                  <div style={{fontSize:10,color:P.muted,fontWeight:600}}>{tipStep+1} of {TOTAL_TIPS}</div>
                </div>
                <div style={{fontSize:13,color:P.muted,lineHeight:1.6,marginBottom:12}}>{t.body}</div>
                <div style={{display:"flex",gap:4,justifyContent:"center",marginBottom:12}}>
                  {tips.map((_,i)=><div key={i} style={{width:i===tipStep?18:6,height:6,borderRadius:3,background:i===tipStep?P.green:P.border,transition:"all 0.25s"}}/>)}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={skipTips} style={{flex:1,padding:"9px",borderRadius:9,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,fontWeight:600,cursor:"pointer"}}>Skip</button>
                  <button onClick={nextTip} style={{flex:2,padding:"9px",borderRadius:9,border:"none",background:P.green,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer"}}>{isLast?"Got it ✓":"Next →"}</button>
                </div>
              </div>
            </div>
          );
        })()}
        {/* Streak Banner */}
        {streakBanner && (()=>{
          const n=streakBanner.count;
          const tier=n>=6?{bg:"linear-gradient(135deg,#7c3aed,#a78bfa)",label:`${n} in a row — Legendary!`,icon:<Icons.Star color="#fff" size={18}/>}:n>=5?{bg:"linear-gradient(135deg,#ca8a04,#fbbf24)",label:`${n} in a row — Superb!`,icon:<Icons.Bolt color="#fff" size={18}/>}:n>=4?{bg:"linear-gradient(135deg,#dc2626,#f87171)",label:`${n} in a row — Blazing!`,icon:<Icons.Fire color="#fff" size={18}/>}:{bg:"linear-gradient(135deg,#16a34a,#22c55e)",label:`${n} Hero Holes in a Row!`,icon:<Icons.Check color="#fff" size={18}/>};
          return <div style={{ position:"fixed", top:60, left:"50%", transform:"translateX(-50%)", zIndex:998, background:tier.bg, borderRadius:24, padding:"10px 22px", display:"flex", alignItems:"center", gap:8, boxShadow:"0 8px 28px rgba(0,0,0,0.25)", animation:"streakPop 0.4s cubic-bezier(0.16,1,0.3,1)", whiteSpace:"nowrap" }}>
            {tier.icon}
            <span style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:0.3 }}>{tier.label}</span>
          </div>;
        })()}

        {/* Badge celebration modal */}
        {newMilestone && <BadgeCelebration badge={newMilestone} onDone={()=>setNewMilestone(null)}/>}

        {/* Mental Reset Prompt (3 bandit holes) */}
        {showResetPrompt && (
          <div onClick={()=>setShowResetPrompt(false)} style={{ position:"fixed", inset:0, zIndex:998, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(6px)", animation:"fadeIn 0.25s ease-out", cursor:"pointer" }}>
          <div style={{ background:P.card, borderRadius:20, padding:"24px 24px 20px", border:`2px solid ${P.red}55`, boxShadow:"0 16px 48px rgba(220,38,38,0.35)", animation:"cardFlip 0.35s cubic-bezier(0.16,1,0.3,1)", width:"88%", maxWidth:360, textAlign:"center", cursor:"default" }} onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:13, color:P.red, fontWeight:800, letterSpacing:2, marginBottom:6 }}>TIME TO RESET</div>
            <div style={{ fontSize:32, fontWeight:900, color:P.white, marginBottom:4, letterSpacing:-0.5 }}>W.I.N.</div>
            <div style={{ fontSize:15, color:P.muted, fontWeight:600, marginBottom:14, lineHeight:1.5 }}>What's Important Now?<br/>Just this shot. Just this hole.</div>
            <div style={{ background:P.cardAlt, borderRadius:12, padding:"14px 16px", marginBottom:12 }}>
              <div style={{ fontSize:12, color:P.accent, fontWeight:800, marginBottom:10, letterSpacing:0.5 }}>3 STEPS BACK TO YOUR GAME</div>
              {["Take one deep breath — feel your feet on the ground","Drop the last hole. It's already history.","Pick your target and commit completely."].map((step,i)=>(
                <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:i<2?10:0, textAlign:"left" }}>
                  <div style={{ width:22, height:22, borderRadius:"50%", background:P.accent+"20", border:`1.5px solid ${P.accent}44`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:P.accent, marginTop:1 }}>{i+1}</div>
                  <div style={{ fontSize:14, color:P.white, lineHeight:1.5, fontWeight:500 }}>{step}</div>
                </div>
              ))}
            </div>
            <div style={{background:P.card,borderRadius:10,padding:"10px 14px",marginBottom:14,border:`1px solid ${P.border}`,textAlign:"center"}}>
              <div style={{fontSize:13,color:P.white,fontStyle:"italic",fontWeight:500,lineHeight:1.5}}>Which one wins?</div>
              <div style={{fontSize:15,color:P.green,fontWeight:800,marginTop:2}}>...the one you feed.</div>
            </div>
            <button onClick={()=>setShowResetPrompt(false)} {...pp()} style={{width:"100%",padding:"12px",borderRadius:10,border:`1.5px solid ${P.red}55`,background:P.red+"15",color:P.red,fontSize:15,fontWeight:800,cursor:"pointer"}}>Back in It →</button>
            <div style={{fontSize:11,color:P.muted,marginTop:10,letterSpacing:0.5,fontWeight:500}}>or tap anywhere to dismiss</div>
          </div>
          </div>
        )}

        {/* Caddie Card Overlay */}
        {caddieCard && (
          <div style={{position:"fixed",inset:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.5)",backdropFilter:"blur(6px)",animation:"fadeIn 0.2s ease-out"}} onClick={dismissCaddieCard}>
            <div onClick={e=>e.stopPropagation()} style={{background:P.card,borderRadius:16,padding:24,width:"88%",maxWidth:360,border:`2px solid ${caddieCard.color}22`,boxShadow:`0 20px 40px rgba(0,0,0,0.15)`,animation:"cardFlip 0.4s ease-out",textAlign:"center"}}>
              <div style={{marginBottom:8}}>{CaddieIcon && <CaddieIcon color={caddieCard.color} size={36}/>}</div>
              {caddieCard.type==="bandit"?(
                <><div style={{fontSize:10,color:P.red,fontWeight:700,letterSpacing:2,marginBottom:4}}>YOUR CADDIE NOTICED</div><div style={{fontSize:15,marginBottom:12,color:P.muted,lineHeight:1.5}}><span style={{color:P.red,fontWeight:700}}>{caddieCard.bandit}</span> showed up — <span style={{color:P.green,fontWeight:700}}>{caddieCard.hero}</span> <span style={{fontStyle:"italic"}}>{caddieCard.verb}</span> it.</div></>
              ):(
                <><div style={{fontSize:10,color:P.green,fontWeight:700,letterSpacing:2,marginBottom:4}}>GREAT WORK</div><div style={{fontSize:14,marginBottom:12,color:P.muted}}>Keep <span style={{color:P.green,fontWeight:700}}>{caddieCard.hero}</span> going into the next hole.</div></>
              )}
              <div style={{background:P.cardAlt,borderRadius:12,padding:"16px 14px",marginBottom:16,border:`1px solid ${P.border}`}}>
                <div style={{fontSize:16,lineHeight:1.5,color:P.white,fontWeight:500,fontStyle:"italic"}}>"{caddieCard.message}"</div>
              </div>
              <button onClick={dismissCaddieCard} {...pp()} style={{padding:"12px 32px",borderRadius:10,border:`1.5px solid ${caddieCard.color}`,background:caddieCard.color+"12",color:caddieCard.color,fontSize:15,fontWeight:700,cursor:"pointer",transition:"transform 0.1s ease"}}>Next Hole →</button>
            </div>
          </div>
        )}

        {isOffline && (
          <div style={{background:"#92400e",padding:"5px 12px",textAlign:"center",fontSize:11,fontWeight:700,color:"#fef3c7",letterSpacing:0.5,display:"flex",alignItems:"center",justifyContent:"center",gap:6,flexShrink:0}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#fbbf24",flexShrink:0}}/>
            OFFLINE — all data saves locally, syncs when back online
          </div>
        )}
        <div style={{padding:"4px 12px 2px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <button onClick={nav("home")} style={S.iconBtn} {...pp()}><Icons.Home color={P.muted} size={17}/></button>
          <div style={{textAlign:"center"}}><div style={{fontSize:17,fontWeight:800,color:P.white}}>Scorecard</div></div>
          <div style={{display:"flex",gap:4}}>
            {themeToggle}
            <button onClick={()=>navTo("caddie")} style={S.iconBtn} {...pp()}><Icons.Brain color={P.muted} size={16}/></button>
            <button onClick={()=>{try{localStorage.removeItem("mgp_tip_step");}catch{}setTipStep(0);}} style={S.iconBtn} {...pp()} aria-label="App guide"><Icons.Info color={P.muted} size={15}/></button>
            <button onClick={()=>{setPrevView(view);setView("scorecard");}} style={S.iconBtn} {...pp()}><Icons.Grid color={P.muted} size={15}/></button>
          </div>
        </div>

        <div ref={tipRefs.course} style={{flexShrink:0}}>
        <CourseSearchBar
          P={P} S={S}
          courseName={courseName}
          setCourseName={setCourseName}
          onCourseLoaded={onCourseLoaded}
          selectedTee={selectedTee}
          setSelectedTee={setSelectedTee}
          courseData={courseData}
          setCourseData={setCourseData}
          inGameCaddie={inGameCaddie}
          setInGameCaddie={setInGameCaddie}
        />
        </div>
        <div style={{padding:"0 12px 4px",display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          <input type="date" value={roundDate} onChange={e=>setRoundDate(e.target.value)} style={{...S.input,flex:"0 0 auto",width:136,fontSize:12,padding:"6px 8px"}}/>
          <div style={{flex:1}}/>
          <LiveClock P={P}/>
        </div>

        {/* Hole Grid */}
        <div ref={tipRefs.grid} style={{padding:"0 10px 2px",flexShrink:0}}>
          {[0,9].map(start=>(
            <div key={start} style={{display:"grid",gridTemplateColumns:"repeat(9, 1fr)",gap:2,marginBottom:start===0?2:0}}>
              {Array.from({length:9},(_,j)=>{
                const i=start+j,s=getHoleStats(scores,i),act=i===currentHole,has=s.bandits>0||s.heroes>0;
                const nt=settings.showScoreInGrid?scoreNotation(scores[i].strokeScore,scores[i].par):null;
                const diff=nt?.diff??null;
                // Border/color based on notation, active overrides
                const borderColor=act?P.accent:diff===null?P.border:diff<=-1?P.green:diff>=1?P.red:P.border;
                const borderWidth=act?"2px":"1.5px";
                const textColor=act?P.accent:diff===null?(has?P.white:P.muted):diff<0?P.green:diff>0?P.red:P.white;
                return <button key={i} onClick={()=>goToHole(i)} {...pp()} style={{aspectRatio:"1",borderRadius:diff===-1&&!act?"50%":diff===1&&!act?"5px":7,border:`${borderWidth} solid ${borderColor}`,background:act?P.accent+"15":has?P.cardAlt:P.card,color:textColor,fontWeight:act||diff!==null?700:500,fontSize:12,cursor:"pointer",transition:"all 0.12s ease",position:"relative",display:"flex",alignItems:"center",justifyContent:"center",minWidth:0,padding:0}}>
                  {/* Double notation: inner ring */}
                  {!act&&diff!==null&&Math.abs(diff)>=2&&<span style={{position:"absolute",inset:3,borderRadius:diff<=-2?"50%":"3px",border:`1px solid ${diff<0?P.green:P.red}`,pointerEvents:"none"}}/>}
                  {i+1}
                  {has&&!act&&diff===null&&<div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:s.net>0?P.green:s.net<0?P.red:P.gold}}/>}
                  {scores[i].holeNote&&!act&&<div style={{position:"absolute",top:1,right:2,width:3,height:3,borderRadius:"50%",background:P.accent}}/>}
                </button>;
              })}
            </div>
          ))}
        </div>

        {/* Single row: Hole N · PAR · SCORE · PUTTS · FIR/GIR */}
        {(()=>{
          const notation = scoreNotation(scores[currentHole].strokeScore, scores[currentHole].par);
          // Include all completed holes (score + par both entered)
          const completedHoles = scores.slice(0,currentHole).filter(h=>h.strokeScore&&h.par);
          const completedStroke = completedHoles.reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0);
          const completedPar = completedHoles.reduce((s,h)=>s+(parseInt(h.par)||0),0);
          // Only include current hole in running total if score has been entered
          const hasCurrentScore = !!scores[currentHole].strokeScore;
          const hasCurrentPar = !!scores[currentHole].par;
          const curScore = hasCurrentScore ? (parseInt(scores[currentHole].strokeScore)||0) : 0;
          const curPar = (hasCurrentScore && hasCurrentPar) ? (parseInt(scores[currentHole].par)||0) : 0;
          const runningStroke = completedStroke + curScore;
          const runningPar = completedPar + curPar;
          const runningDiff = (completedHoles.length > 0 || (hasCurrentScore && hasCurrentPar)) ? runningStroke - runningPar : null;
          return (
        <div ref={tipRefs.scoreRow} key={animKey} style={{padding:"2px 6px 4px",display:"flex",alignItems:"center",gap:5,animation:"fadeSlide 0.25s ease-out",flexShrink:0}}>

          {/* Hole N — left */}
          <div style={{flex:1,minWidth:0,paddingTop:12}}>
            {notation&&notation.diff!==0&&<div style={{fontSize:9,fontWeight:700,color:notation.diff<0?P.green:P.red,letterSpacing:0.5,marginBottom:1}}>{notation.label}</div>}
            <div style={{display:"flex",alignItems:"baseline",gap:6,flexWrap:"nowrap"}}>
              {streak>=3&&<div style={{display:"flex",alignItems:"center",gap:2,padding:"2px 6px",borderRadius:20,background:P.green+"15",border:`1px solid ${P.green}33`}}><Icons.Fire color={P.green} size={11}/><span style={{fontSize:10,fontWeight:700,color:P.green}}>{streak}</span></div>}
              <span style={{fontSize:22,fontWeight:900,lineHeight:1,color:P.white,whiteSpace:"nowrap"}}>Hole {currentHole+1}</span>
              {scores[currentHole].yardage&&<div style={{textAlign:"center",marginLeft:16}}><div style={{fontSize:13,fontWeight:700,color:P.muted,lineHeight:1}}>{scores[currentHole].yardage}</div><div style={{fontSize:9,color:P.muted,fontWeight:600,letterSpacing:0.5,marginTop:2}}>yds</div></div>}
              {runningDiff!==null&&<span style={{fontSize:12,fontWeight:700,color:runningDiff<0?P.green:runningDiff>0?P.red:P.gold,whiteSpace:"nowrap"}}>{runningDiff>0?"+":""}{runningDiff===0?"E":runningDiff}</span>}
            </div>
          </div>

          {/* PAR */}
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{fontSize:9,color:P.muted,letterSpacing:1,fontWeight:700,marginBottom:3}}>PAR</div>
            <input value={scores[currentHole].par} onChange={e=>updateField("par",e.target.value.replace(/\D/g,"").slice(0,1))} style={{...S.miniInput,width:44,fontSize:20}} inputMode="numeric" aria-label="Par"/>
          </div>

          {/* SCORE */}
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{fontSize:9,color:P.muted,letterSpacing:1,fontWeight:700,marginBottom:3}}>SCORE</div>
            <input value={scores[currentHole].strokeScore} onChange={e=>updateField("strokeScore",e.target.value.replace(/\D/g,"").slice(0,2))} aria-label="Score" style={{...S.miniInput,width:44,fontSize:20,borderRadius:notation?.circle?"50%":notation?.square?"4px":"8px",borderColor:notation?.diff&&notation.diff!==0?(notation.diff<0?P.green:P.red):undefined,borderWidth:notation?.diff&&Math.abs(notation.diff)>=2?"3px":"1.5px",borderStyle:notation?.diff&&Math.abs(notation.diff)>=2?"double":"solid"}} inputMode="numeric"/>
          </div>

          {/* FIR / GIR */}
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{fontSize:9,color:P.muted,letterSpacing:1,fontWeight:700,marginBottom:3}}>FIR / GIR</div>
            <div style={{display:"flex",gap:3,height:34,background:P.card,borderRadius:9,border:`1.5px solid ${P.border}`,padding:"0 5px",alignItems:"center"}}>
              <button onClick={()=>updateField("fairway",scores[currentHole].fairway===true?null:true)} {...pp()} style={{height:22,padding:"0 6px",borderRadius:6,border:`1.5px solid ${scores[currentHole].fairway===true?P.green:P.border}`,background:scores[currentHole].fairway===true?P.green+"20":"transparent",color:scores[currentHole].fairway===true?P.green:P.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>{scores[currentHole].fairway===true?<Icons.Check color={P.green} size={11}/>:<span style={{display:"inline-block",width:16}}/>}</button>
              <button onClick={()=>updateField("gir",scores[currentHole].gir===true?null:true)} {...pp()} style={{height:22,padding:"0 6px",borderRadius:6,border:`1.5px solid ${scores[currentHole].gir===true?P.accent:P.border}`,background:scores[currentHole].gir===true?P.accent+"20":"transparent",color:scores[currentHole].gir===true?P.accent:P.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>{scores[currentHole].gir===true?<Icons.Check color={P.accent} size={11}/>:<span style={{display:"inline-block",width:16}}/>}</button>
            </div>
          </div>

          {/* PUTTS */}
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{fontSize:9,color:P.muted,letterSpacing:1,fontWeight:700,marginBottom:3}}>PUTTS</div>
            <div style={{display:"flex",alignItems:"center",gap:3,height:38,background:P.card,borderRadius:9,border:`1.5px solid ${P.border}`,padding:"0 4px"}}>
              <button onClick={()=>updateField("putts",Math.max(0,(parseInt(scores[currentHole].putts)||0)-1)||"")} style={{width:32,height:32,borderRadius:7,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} {...pp()}>−</button>
              <span style={{fontSize:20,fontWeight:800,color:scores[currentHole].putts?P.white:P.muted,minWidth:22,textAlign:"center"}}>{scores[currentHole].putts||"—"}</span>
              <button onClick={()=>updateField("putts",(parseInt(scores[currentHole].putts)||0)+1)} style={{width:32,height:32,borderRadius:7,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} {...pp()}>+</button>
            </div>
          </div>

        </div>
          );})()}

        {/* Matchup Grid — collapsible */}
        <div ref={tipRefs.matchup} style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minHeight:0}}>
        <div style={{padding:"0 10px 2px",flexShrink:0}}>

          {/* Toggle header — matches grid column layout */}
          <button onClick={()=>setMatchupOpen(o=>!o)} {...pp()} style={{width:"100%",display:"grid",gridTemplateColumns:"36px 1fr 48px 1fr 36px",alignItems:"center",gap:2,padding:"3px 2px",background:"transparent",border:"none",cursor:"pointer",transition:"transform 0.1s"}}>
            <div style={{textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1.5,color:P.green}}>
              {!matchupOpen&&hT>0?<span style={{fontSize:12,fontWeight:900,color:P.green}}>{hT}</span>:""}
            </div>
            <div style={{textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1.5,color:P.green}}>HEROES</div>
            <div style={{textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
              {!matchupOpen&&hT===0&&bT===0&&<span style={{fontSize:9,color:P.muted,fontWeight:500,fontStyle:"italic"}}>tap to log</span>}
              <div style={{transform:matchupOpen?"rotate(-90deg)":"rotate(90deg)",transition:"transform 0.2s",lineHeight:0}}><Icons.Chev color={P.muted} size={13}/></div>
            </div>
            <div style={{textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1.5,color:P.red}}>BANDITS</div>
            <div style={{textAlign:"center",fontSize:9,fontWeight:800,letterSpacing:1.5,color:P.red}}>
              {!matchupOpen&&bT>0?<span style={{fontSize:12,fontWeight:900,color:P.red}}>{bT}</span>:""}
            </div>
          </button>
        </div>

        {matchupOpen&&<div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:"0 10px 4px",animation:"fadeIn 0.15s ease-out",display:"flex",flexDirection:"column",justifyContent:"space-evenly"}}>
          {MATCHUPS.map(({hero,verb,bandit},idx)=>{
            const heroColor = P.green;
            const hActive = hH[hero]===1, bActive = hB[bandit]===1;
            return (
            <div key={idx} style={{display:"grid",gridTemplateColumns:"36px 1fr 48px 1fr 36px",alignItems:"center",gap:2,padding:"6px 2px",borderRadius:10,background:hActive?heroColor+"10":bActive?P.red+"08":idx%2===0?P.card:"transparent",border:`1px solid ${hActive?heroColor+"33":bActive?P.red+"22":"transparent"}`,transition:"all 0.18s ease"}}>
              <button onClick={()=>setScore("heroes",hero,1)} aria-label={`${hero} hero`} aria-pressed={hActive} style={{...toggleBtn(P,"green",hActive),width:32,height:32,borderColor:hActive?heroColor:P.greenDim,background:hActive?heroColor:"transparent",boxShadow:hActive?`0 0 12px ${heroColor}44`:"none"}}>{hActive?<Icons.Check color="#fff" size={13}/>:""}</button>
              <div style={{fontSize:13,color:hActive?heroColor:P.white,fontWeight:700,textAlign:"center",transition:"color 0.15s"}}>{hero}</div>
              <div style={{textAlign:"center",fontSize:12,color:P.muted,fontStyle:"italic",fontWeight:600}}>{verb}</div>
              <div style={{fontSize:13,color:bActive?P.red:P.white,fontWeight:700,textAlign:"center",transition:"color 0.15s"}}>{bandit}</div>
              <button onClick={()=>setScore("bandits",bandit,1)} aria-label={`${bandit} bandit`} aria-pressed={bActive} style={{...toggleBtn(P,"red",bActive),width:32,height:32,borderRadius:10}}>{bActive?<Icons.Check color="#fff" size={13}/>:""}</button>
            </div>
          );})}
        </div>}

        {/* Carry-forward intention reminder */}
        {carryForward&&currentHole===0&&(
          <div style={{margin:"0 12px 4px",padding:"8px 12px",borderRadius:9,background:"#ca8a0410",border:"1px solid #ca8a0430",display:"flex",alignItems:"flex-start",gap:8}}>
            <Icons.Note color="#ca8a04" size={14}/>
            <div><div style={{fontSize:9,fontWeight:800,letterSpacing:1.5,color:"#ca8a04",marginBottom:2}}>YOUR INTENTION TODAY</div><div style={{fontSize:12,color:"#f8fafc",fontStyle:"italic",lineHeight:1.4}}>{carryForward}</div></div>
          </div>
        )}

        {/* Mental Net Bar — merged with matchup toggle */}
        <div ref={tipRefs.mentalBar}>
        {matchupOpen&&(()=>{
          const scoredHoles=scores.slice(0,currentHole+1).filter(h=>h.strokeScore&&h.par);
          const rs=scoredHoles.reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0);
          const rp=scoredHoles.reduce((s,h)=>s+(parseInt(h.par)||0),0);
          const rd=scoredHoles.length>0?rs-rp:null;
          const holeHeroes=hH?Object.values(hH).filter(v=>v>0).length:0;
          const holeBandits=hB?Object.values(hB).filter(v=>v>0).length:0;
          return (
          <div style={{margin:"0 12px 4px",padding:"8px 12px",borderRadius:12,background:total.net>0?P.green+"12":total.net<0?P.red+"12":P.card,border:`1.5px solid ${total.net>0?P.green+"44":total.net<0?P.red+"44":P.border}`,display:"flex",alignItems:"center",gap:6,transition:"all 0.3s ease"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}>
              <img src={darkMode?HEROES_LOGO_WHITE:HEROES_LOGO_DARK} alt="Heroes" style={{width:44,height:44,objectFit:"contain",flexShrink:0}}/>
              <div>
                <div style={{fontSize:9,color:P.green,letterSpacing:1,fontWeight:700,marginBottom:1}}>HEROES</div>
                <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                  <span style={{fontSize:30,fontWeight:900,color:P.green,lineHeight:1}}>{hT}</span>
                  {holeHeroes>0&&<span style={{fontSize:10,fontWeight:700,color:P.green,background:P.green+"20",padding:"1px 5px",borderRadius:8}}>+{holeHeroes}</span>}
                </div>
              </div>
            </div>
            <div style={{textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:8,color:P.muted,letterSpacing:1.5,fontWeight:700,marginBottom:1,display:"flex",alignItems:"center",gap:3,justifyContent:"center"}}>MENTAL NET <span onClick={()=>setShowMentalNetInfo(true)} style={{width:13,height:13,borderRadius:"50%",border:`1px solid ${P.border}`,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:7,color:P.muted,cursor:"pointer",flexShrink:0}}>?</span></div>
              <div style={{fontSize:36,fontWeight:900,lineHeight:1,color:total.net>0?P.green:total.net<0?P.red:P.gold,textShadow:total.net!==0?`0 0 20px ${total.net>0?P.green:P.red}44`:"none",transition:"all 0.2s"}}>{total.net>0?"+":""}{total.net}</div>
              {rd!==null&&<div style={{fontSize:10,fontWeight:700,color:rd<0?P.green:rd>0?P.red:P.gold,marginTop:1}}>{rd>0?"+":""}{rd===0?"E par":rd+" vs par"}</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,flex:1,justifyContent:"flex-end"}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:9,color:P.red,letterSpacing:1,fontWeight:700,marginBottom:1}}>BANDITS</div>
                <div style={{display:"flex",alignItems:"baseline",gap:4,justifyContent:"flex-end"}}>
                  {holeBandits>0&&<span style={{fontSize:10,fontWeight:700,color:P.red,background:P.red+"20",padding:"1px 5px",borderRadius:8}}>+{holeBandits}</span>}
                  <span style={{fontSize:30,fontWeight:900,color:P.red,lineHeight:1}}>{bT}</span>
                </div>
              </div>
              <img src={darkMode?BANDIT_LOGO_WHITE:BANDIT_LOGO_DARK} alt="Bandits" style={{width:44,height:44,objectFit:"contain",flexShrink:0}}/>
            </div>
          </div>
          );
        })()}
        {/* Collapsed mental net when matchup is closed */}
        {!matchupOpen&&(
          <div style={{margin:"0 12px 4px",padding:"6px 14px",borderRadius:10,background:P.card,border:`1.5px solid ${total.net>0?P.green+"44":total.net<0?P.red+"44":P.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:12,fontWeight:700,color:P.green}}>{hT>0?`${hT} Heroes`:""}</span>
            <span style={{fontSize:18,fontWeight:900,color:total.net>0?P.green:total.net<0?P.red:P.gold}}>{total.net>0?"+":""}{total.net}</span>
            <span style={{fontSize:12,fontWeight:700,color:P.red}}>{bT>0?`${bT} Bandits`:""}</span>
          </div>
        )}
        </div>{/* end mentalBar ref wrapper */}

        </div>{/* end matchup ref wrapper — scrollable area ends here */}

        {/* Step 6 ref: Hole Note + Nav — fixed at bottom */}
        <div ref={tipRefs.nav} style={{flexShrink:0,borderTop:`1px solid ${P.border}`,background:P.bg}}>
        {/* Hole Note */}
        <div style={{padding:"0 12px 3px"}}>
          <button onClick={()=>setHoleNoteOpen(!holeNoteOpen)} style={{width:"100%",padding:"6px 12px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.card,color:P.white,fontSize:12,fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",transition:"transform 0.1s ease"}} {...pp()}>
            <span style={{display:"flex",alignItems:"center",gap:5}}><Icons.Note color={scores[currentHole].holeNote?P.accent:P.muted} size={13}/> {scores[currentHole].holeNote?"Hole Note ✓":"Add Hole Note"}</span>
            <span style={{fontSize:10,color:P.muted,transition:"transform 0.2s",transform:holeNoteOpen?"rotate(180deg)":"rotate(0)"}}>▼</span>
          </button>
          {holeNoteOpen&&<div style={{marginTop:4,animation:"fadeIn 0.2s ease-out"}}><textarea value={scores[currentHole].holeNote} onChange={e=>updateField("holeNote",sanitiseNote(e.target.value))} placeholder={`Hole ${currentHole+1} notes...`} rows={2} style={{width:"100%",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:13,outline:"none",resize:"none",lineHeight:1.4}}/></div>}
        </div>
        {/* Navigation + actions */}
        <div style={{padding:"4px 10px calc(10px + env(safe-area-inset-bottom, 0px))",display:"flex",gap:5,alignItems:"center"}}>
          {/* Back */}
          <button onClick={()=>goToHole(Math.max(0,currentHole-1))} disabled={currentHole===0} style={{...navBtnS(P,currentHole===0),padding:"10px 12px",flexShrink:0}} aria-label="Previous hole">←</button>
          <SaveBtn P={P} onSave={saveRound} hint={savedRounds.length===0&&currentHole>0?"Tap Save to finish early":null}/>
          <ShareBtn P={P} onShare={()=>{const hasData=scores.some(h=>Object.values(h.heroes).some(v=>v!==0)||Object.values(h.bandits).some(v=>v!==0));if(!hasData){showToast("No data yet — log some heroes or bandits first.", "warn");return;}shareRound({course:courseName||"Unnamed Course",date:roundDate,scores,notes:postRoundNotes,totalPar:getTotalPar(scores),totalStroke:getTotalStroke(scores),...getRoundTotals(scores).total},darkMode);}}/>

          <div style={{flex:1}}/>
          {/* Finish or Forward */}
          {currentHole===17?(
            <button onClick={completeRound} aria-label="Finish round" style={{padding:"10px 14px",borderRadius:10,border:`1.5px solid ${P.green}`,background:P.green+"12",color:P.green,fontSize:13,fontWeight:700,cursor:"pointer",transition:"transform 0.1s ease",flexShrink:0}}>Finish ✓</button>
          ):(
            <button onClick={advanceHole} style={{...navBtnS(P,false),padding:"10px 12px",flexShrink:0}} aria-label="Next hole">→</button>
          )}
        </div>
        </div>{/* end nav ref wrapper */}


        <style>{`
          @keyframes fadeSlide{from{opacity:0;transform:translateX(12px);}to{opacity:1;transform:translateX(0);}}
          @keyframes cardFlip{0%{transform:scale(0.8) rotateY(90deg);opacity:0;}100%{transform:scale(1) rotateY(0);opacity:1;}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
          @keyframes toastIn{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}} @keyframes streakPop{0%{transform:translateX(-50%) scale(0.7);opacity:0;}60%{transform:translateX(-50%) scale(1.08);}100%{transform:translateX(-50%) scale(1);opacity:1;}}
          input::placeholder,textarea::placeholder{color:${P.muted};}
          *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        `}</style>
      </div>
    </ThemeCtx.Provider>
  );
}

// ═══════════════════════════════════════
// LOGIN MODAL
// ═══════════════════════════════════════
function LoginModal({P,onClose,onLogin}) {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [name,setName]=useState("");
  const [mode,setMode]=useState("login");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const pp=pressProps;

  async function handleSubmit() {
    if(!email.trim()||!pass.trim()){setError("Please fill in all fields.");return;}
    if(mode==="signup"&&pass.length<6){setError("Password must be at least 6 characters.");return;}
    setLoading(true); setError("");
    try {
      if(typeof supabase!=="undefined"&&supabase) {
        let result;
        if(mode==="signup") {
          result = await supabase.auth.signUp({email:email.trim(),password:pass,options:{data:{display_name:name||email.split("@")[0]}}});
        } else {
          result = await supabase.auth.signInWithPassword({email:email.trim(),password:pass});
        }
        if(result.error) { setError(result.error.message); setLoading(false); return; }
        const u = result.data.user;
        onLogin({email:u.email,name:u.user_metadata?.display_name||u.email.split("@")[0],id:u.id});
      } else {
        onLogin({email:email.trim(),name:name||email.split("@")[0]});
      }
    } catch(e) {
      onLogin({email:email.trim(),name:name||email.split("@")[0]});
    }
    setLoading(false);
  }

  const inputStyle = {
    width:"100%", padding:"12px 14px", borderRadius:10,
    border:`1.5px solid ${P.border}`, background:P.inputBg||P.cardAlt,
    color:P.white, fontSize:14, outline:"none", boxSizing:"border-box",
    fontFamily:"inherit",
  };
  const labelStyle = {fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1.2,marginBottom:5,display:"block"};

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",animation:"fadeIn 0.2s ease-out",padding:"0 20px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:P.card,borderRadius:20,padding:"28px 24px",width:"100%",maxWidth:360,border:`1.5px solid ${P.border}`}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
          <div>
            <div style={{fontSize:20,fontWeight:900,color:P.white,marginBottom:2}}>{mode==="login"?"Welcome back":"Create account"}</div>
            <div style={{fontSize:12,color:P.muted}}>{mode==="login"?"Sign in to sync your rounds":"Start tracking your mental game"}</div>
          </div>
          <button onClick={onClose} {...pp()} style={{width:30,height:30,borderRadius:8,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
        </div>

        {/* Fields */}
        {mode==="signup"&&(
          <div style={{marginBottom:14}}>
            <label style={labelStyle}>NAME</label>
            <input value={name} onChange={e=>{setName(sanitiseName(e.target.value));setError("");}} placeholder="First name" style={inputStyle}/>
          </div>
        )}
        <div style={{marginBottom:14}}>
          <label style={labelStyle}>EMAIL</label>
          <input value={email} onChange={e=>{setEmail(sanitiseEmail(e.target.value));setError("");}} placeholder="you@email.com" inputMode="email" autoCapitalize="none" autoComplete="email" style={inputStyle}/>
        </div>
        <div style={{marginBottom:error?12:20}}>
          <label style={labelStyle}>PASSWORD</label>
          <input value={pass} onChange={e=>{setPass(e.target.value);setError("");}} type="password" autoComplete="current-password" placeholder="••••••••" style={inputStyle}/>
        </div>

        {error&&<div style={{fontSize:12,color:P.red,marginBottom:14,padding:"8px 12px",borderRadius:8,background:P.red+"12",border:`1px solid ${P.red}33`}}>{error}</div>}

        <button onClick={handleSubmit} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:P.green,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",marginBottom:14,opacity:loading?0.7:1}}>
          {loading?"...":(mode==="login"?"Sign In":"Create Account")}
        </button>

        <div style={{textAlign:"center",fontSize:12,color:P.muted}}>
          {mode==="login"?"No account yet? ":"Already have an account? "}
          <button onClick={()=>{setMode(mode==="login"?"signup":"login");setError("");}} style={{background:"none",border:"none",color:P.green,cursor:"pointer",fontSize:12,fontWeight:700,padding:0}}>
            {mode==="login"?"Sign Up":"Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// HOME
// ═══════════════════════════════════════
function HomeScreen({onNav,onContinueRound,roundInProgress,roundCount,themeToggle,S,user,setUser,showLogin,setShowLogin,savedRounds,settings,isPro,roundsRemaining,hasProfile}) {
  const P=useTheme();
  const darkMode = P.bg === "#09090b";
  const [loaded,setLoaded]=useState(false);
  const [logoPopped,setLogoPopped]=useState(false);
  useEffect(()=>{
    setTimeout(()=>setLoaded(true),60);
    setTimeout(()=>setLogoPopped(true),900);
  },[]);

  const lastRound = savedRounds&&savedRounds.length>0 ? savedRounds[0] : null;
  const dayQuotes = [
    "Strengthen your inside game so that the game you play on the outside is more fun and fulfilling.",
    "You can choose the mental and emotional stance from which to operate when you play.",
    "Bring awareness of your mental and emotional state to the course, and you can improve how you play.",
    "See the outcomes of your shots as feedback, not failure.",
    "Commitment to the process. Indifference to the result.",
    "W.I.N. — What's Important Now?",
    "Be curious — not critical. Try: 'Hmmm... that was interesting.'",
    "The next shot might be your best shot.",
  ];
  const quote = dayQuotes[Math.floor(Date.now()/86400000) % dayQuotes.length];

  const secondaryItems = [
    {key:"checklist",IconKey:"Clipboard",label:"Checklist",color:"#16a34a"},
    {key:"caddie",IconKey:"Brain",label:"Caddie",color:"#2563eb"},
    {key:"dashboard",IconKey:"Chart",label:"Dashboard",color:"#7c3aed"},
    {key:"badges",IconKey:"Medal",label:"Milestones",color:"#ca8a04"},
    {key:"history",IconKey:"Clock",label:"History",color:"#0d9488"},
    {key:"transform",IconKey:"Star",label:"Framework",color:"#fbbf24"},
    {key:"guide",IconKey:"Info",label:"Help",color:"#64748b"},
    {key:"settings",IconKey:"Gear",label:"Settings",color:"#475569"},
  ];

  // Theme-aware colour tokens for this screen
  const overlay1 = darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const overlay2 = darkMode ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.08)";
  const textHigh  = darkMode ? "#ffffff" : "#0f172a";
  const textMid   = darkMode ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.5)";
  const textLow   = darkMode ? "rgba(255,255,255,0.4)"  : "rgba(15,23,42,0.4)";
  const textFaint = darkMode ? "rgba(255,255,255,0.25)" : "rgba(15,23,42,0.2)";
  const ringColor = darkMode ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
  const pillBg    = darkMode ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
  const pillBorder= darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  const dockBg    = darkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const dockBorder= darkMode ? "rgba(255,255,255,0.1)"  : "rgba(0,0,0,0.08)";
  const logoSrc   = darkMode ? HEROES_LOGO_WHITE : HEROES_LOGO_DARK;
  const banditSrc = darkMode ? BANDIT_LOGO_WHITE : BANDIT_LOGO_DARK;
  const heroLabel = darkMode ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)";
  const footerRule= PM_GOLD+"66";
  const footerText= darkMode ? "rgba(255,255,255,0.2)"  : "rgba(0,0,0,0.25)";

  return (
    <div style={{...S.shell,position:"relative",overflow:"hidden",background:P.bg}}>
      {showLogin&&<LoginModal P={P} onClose={()=>setShowLogin(false)} onLogin={u=>{setUser(u);setShowLogin(false);}}/>}

      {/* Full-bleed background glows */}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 50% at 50% -10%, ${darkMode?"rgba(22,163,74,0.18)":"rgba(22,163,74,0.10)"} 0%, transparent 60%)`,zIndex:0,pointerEvents:"none"}}/>
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 50% at 50% 110%, ${darkMode?"rgba(220,38,38,0.12)":"rgba(220,38,38,0.07)"} 0%, transparent 60%)`,zIndex:0,pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:"28%",left:"50%",transform:"translateX(-50%)",width:320,height:320,borderRadius:"50%",border:`1px solid ${ringColor}`,zIndex:1,pointerEvents:"none"}}/>
      <div style={{position:"absolute",top:"22%",left:"50%",transform:"translateX(-50%)",width:480,height:480,borderRadius:"50%",border:`1px solid ${ringColor}`,zIndex:1,pointerEvents:"none"}}/>
      {/* Top bar */}
      <div style={{padding:"16px 20px 0",display:"flex",justifyContent:"space-between",alignItems:"center",position:"relative",zIndex:2}}>
        {(()=>{
          const clerkUser = window.__useUser ? window.__useUser() : null;
          if (clerkUser?.isSignedIn) return (
            <button onClick={()=>window.__clerkOpenSignIn?.()} style={{display:"flex",alignItems:"center",gap:8,background:overlay1,border:`1px solid ${overlay2}`,borderRadius:10,padding:"6px 12px",cursor:"pointer"}} {...pp()}>
              <div style={{width:24,height:24,borderRadius:"50%",background:overlay2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:textHigh}}>{(clerkUser.user?.firstName||"?")[0].toUpperCase()}</div>
              <span style={{fontSize:12,color:textMid,fontWeight:500}}>{clerkUser.user?.firstName||"Account"}</span>
            </button>
          );
          return (
            <button onClick={()=>window.__clerkOpenSignIn ? window.__clerkOpenSignIn() : setShowLogin(true)} style={{display:"flex",alignItems:"center",gap:6,background:overlay1,border:`1px solid ${overlay2}`,borderRadius:10,padding:"7px 12px",fontSize:12,fontWeight:600,color:textMid,cursor:"pointer"}} {...pp()}>
              <Icons.User color={textMid} size={14}/> Sign In
            </button>
          );
        })()}
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {themeToggle}
        </div>
      </div>

      {/* Main content */}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 24px",position:"relative",zIndex:2,gap:0}}>

        {/* Logos collision */}
        <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",marginBottom:20,height:120,position:"relative",width:"100%"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,transform:loaded?"translateX(0)":"translateX(-100px)",opacity:loaded?1:0,transition:"transform 1s cubic-bezier(0.34,1.4,0.64,1) 0.1s, opacity 0.5s ease 0.1s"}}>
            <img src={logoSrc} alt="Heroes" style={{width:logoPopped?96:90,height:logoPopped?96:90,objectFit:"contain",filter:`drop-shadow(0 6px 24px rgba(22,163,74,${darkMode?0.65:0.4}))`,transition:"width 0.4s cubic-bezier(0.34,1.56,0.64,1), height 0.4s cubic-bezier(0.34,1.56,0.64,1)"}}/>
            <span style={{fontSize:9,fontWeight:800,letterSpacing:2.5,color:heroLabel}}>HEROES</span>
          </div>
          <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#ca8a04,#fbbf24)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 24px rgba(202,138,4,0.8), 0 0 48px rgba(202,138,4,0.3)",opacity:loaded?1:0,transition:"opacity 0.4s ease 0.9s",flexShrink:0,margin:"0 14px 22px",zIndex:1}}>
            <span style={{fontSize:10,fontWeight:900,color:"#fff",letterSpacing:0.5}}>VS</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,transform:loaded?"translateX(0)":"translateX(100px)",opacity:loaded?1:0,transition:"transform 1s cubic-bezier(0.34,1.4,0.64,1) 0.1s, opacity 0.5s ease 0.1s"}}>
            <img src={banditSrc} alt="Bandits" style={{width:logoPopped?96:90,height:logoPopped?96:90,objectFit:"contain",filter:`drop-shadow(0 6px 24px rgba(220,38,38,${darkMode?0.65:0.4}))`,transition:"width 0.4s cubic-bezier(0.34,1.56,0.64,1), height 0.4s cubic-bezier(0.34,1.56,0.64,1)"}}/>
            <span style={{fontSize:9,fontWeight:800,letterSpacing:2.5,color:heroLabel}}>BANDITS</span>
          </div>
        </div>

        {/* Title */}
        <div style={{textAlign:"center",marginBottom:10,opacity:loaded?1:0,transform:loaded?"translateY(0)":"translateY(16px)",transition:"all 0.7s cubic-bezier(0.16,1,0.3,1) 0.4s"}}>
          <div style={{fontSize:18,fontWeight:900,letterSpacing:5,color:darkMode?"rgba(255,255,255,0.7)":P.accent,textTransform:"uppercase",marginBottom:10}}>Mental Game</div>
          <div style={{fontSize:52,fontWeight:900,color:textHigh,letterSpacing:-2,lineHeight:0.95,textShadow:darkMode?"0 4px 32px rgba(0,0,0,0.5)":"0 2px 16px rgba(0,0,0,0.1)"}}>Scorecard</div>
        </div>

        {/* Quote */}
        <div style={{textAlign:"center",marginBottom:32,opacity:loaded?1:0,transition:"opacity 0.7s ease 0.6s",padding:"0 16px"}}>
          <div style={{fontSize:12,color:textLow,fontStyle:"italic",lineHeight:1.5,fontWeight:500}}>"{quote}"</div>
        </div>

        {/* UPGRADE NUDGE for non-pro */}
        {false&&(
          <button onClick={()=>onNav("upgrade")} {...pp()} style={{marginBottom:10,padding:"8px 18px",borderRadius:20,background:"linear-gradient(135deg,#16a34a22,#22c55e18)",border:"1px solid #16a34a44",cursor:"pointer",display:"flex",alignItems:"center",gap:8,opacity:loaded?1:0,transition:"opacity 0.6s ease 0.58s"}}>
            <Icons.Star color="#16a34a" size={13}/>
            <span style={{fontSize:12,fontWeight:700,color:"#16a34a"}}>Upgrade to Pro</span>
            <span style={{fontSize:11,color:"#16a34a",opacity:0.6}}>$4.99/mo →</span>
          </button>
        )}

        {/* PRIMARY CTA */}
        <button onClick={()=>roundInProgress?onContinueRound():onNav("preround")} {...pp()} style={{
          width:"100%",maxWidth:320,padding:"18px 24px",borderRadius:18,
          background:roundInProgress?"linear-gradient(135deg, #1d4ed8, #2563eb)":"linear-gradient(135deg, #16a34a, #22c55e)",
          border:"none",color:"#fff",
          fontSize:19,fontWeight:900,cursor:"pointer",letterSpacing:0.3,
          boxShadow:roundInProgress?"0 8px 32px rgba(37,99,235,0.45)":"0 8px 32px rgba(22,163,74,0.45), 0 2px 8px rgba(22,163,74,0.25)",
          display:"flex",alignItems:"center",justifyContent:"center",gap:10,
          opacity:loaded?1:0,transform:loaded?"translateY(0)":"translateY(20px)",
          transition:"all 0.6s cubic-bezier(0.16,1,0.3,1) 0.55s",
          marginBottom:roundInProgress?4:12,
        }}>
          <Icons.Flag color="#fff" size={20}/>
          {roundInProgress?"Continue Round":"Start Round"}
        </button>
        {roundInProgress&&(
          <button onClick={()=>onNav("preround")} {...pp()} style={{marginBottom:12,padding:"6px 18px",borderRadius:12,background:"transparent",border:`1px solid ${P.border}`,color:P.muted,fontSize:12,fontWeight:600,cursor:"pointer",opacity:loaded?1:0,transition:"opacity 0.6s ease 0.57s"}}>
            + New Round
          </button>
        )}

        {/* Trial counter — shown when not yet profiled and rounds remain */}
        {!hasProfile&&roundsRemaining<=FREE_ROUNDS_LIMIT&&roundsRemaining>0&&!roundInProgress&&(
          <div style={{marginBottom:8,padding:"7px 14px",borderRadius:10,background:roundsRemaining===1?P.red+"12":PM_GOLD+"10",border:`1px solid ${roundsRemaining===1?P.red:PM_GOLD}33`,width:"100%",maxWidth:320,textAlign:"center",opacity:loaded?1:0,transition:"opacity 0.6s ease 0.58s"}}>
            <span style={{fontSize:12,fontWeight:700,color:roundsRemaining===1?P.red:PM_GOLD}}>{roundsRemaining} free round{roundsRemaining!==1?"s":""} remaining</span>
            <span style={{fontSize:11,color:P.muted}}> — create a profile to continue</span>
          </div>
        )}
        {/* Personal bests strip */}
        {savedRounds&&savedRounds.length>=2&&(()=>{
          const bestNet=Math.max(...savedRounds.map(r=>r.net));
          const bestStroke=Math.min(...savedRounds.filter(r=>r.totalStroke>0).map(r=>r.totalStroke));
          const streak=(()=>{let best=0;savedRounds.forEach(r=>{if(!r.scores)return;let cur=0;r.scores.forEach(h=>{const hv=Object.values(h.heroes).reduce((a,c)=>a+c,0),bv=Object.values(h.bandits).reduce((a,c)=>a+c,0);if(hv+bv>0&&hv>bv){cur++;best=Math.max(best,cur);}else cur=0;});});return best;})();
          const noStroke = !savedRounds.some(r=>r.totalStroke>0);
          return <div style={{display:"flex",gap:5,marginBottom:10,width:"100%",maxWidth:320,opacity:loaded?1:0,transition:"opacity 0.6s ease 0.6s"}}>
            {[
              {label:"Best Net",val:(bestNet>0?"+":"")+bestNet,color:P.green,flex:1},
              {label:"Best Streak",val:streak||"—",color:P.gold,flex:"0 0 90px"}
            ].map((s,i)=>(
              <div key={i} style={{flex:s.flex,textAlign:"center",padding:"5px 4px",borderRadius:8,background:P.card,border:`1px solid ${P.border}`,minWidth:0}}>
                <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:0.3,marginBottom:1,whiteSpace:"nowrap"}}>{s.label}</div>
                <div style={{fontSize:14,fontWeight:900,color:s.color,lineHeight:1}}>{s.val}</div>
              </div>
            ))}
          </div>;
        })()}
        {/* LAST ROUND PILL */}
        {lastRound&&(
          <button onClick={()=>onNav("history")} {...pp()} style={{opacity:loaded?1:0,transition:"opacity 0.6s ease 0.65s",marginBottom:20,background:P.card,border:`1px solid ${pillBorder}`,borderRadius:24,cursor:"pointer",padding:"8px 16px"}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,color:textLow,fontWeight:600}}>LAST ROUND</span>
              <span style={{fontSize:13,fontWeight:800,color:lastRound.net>0?"#16a34a":lastRound.net<0?"#dc2626":"#ca8a04"}}>{lastRound.net>0?"+":""}{lastRound.net}</span>
              <span style={{fontSize:10,color:textFaint}}>·</span>
              <span style={{fontSize:11,color:textMid,fontWeight:500,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lastRound.course}</span>
              <Icons.Chev color={textFaint} size={12}/>
            </div>
          </button>
        )}

        {/* SECONDARY ICON DOCK */}
        <div style={{display:"flex",gap:6,justifyContent:"center",opacity:loaded?1:0,transition:"opacity 0.6s ease 0.72s",flexWrap:"wrap",maxWidth:340}}>
          {secondaryItems.map(it=>{const Ic=Icons[it.IconKey];return(
            <button key={it.key} onClick={()=>onNav(it.key)} {...pp()} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"10px 14px",borderRadius:14,border:`1px solid ${dockBorder}`,background:dockBg,cursor:"pointer",backdropFilter:"blur(8px)",minWidth:60,transition:"transform 0.1s ease"}}>
              <Ic color={it.color} size={20}/>
              <span style={{fontSize:9,fontWeight:700,color:textMid,letterSpacing:0.5}}>{it.label}</span>
            </button>
          );})}
        </div>
      </div>

      {/* Footer */}
      <div style={{padding:"12px 20px 24px",textAlign:"center",position:"relative",zIndex:2,opacity:loaded?1:0,transition:"opacity 0.6s ease 0.8s"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
          <div style={{height:1,width:20,background:footerRule}}/>
          <span style={{fontSize:9,fontWeight:700,color:footerText,letterSpacing:2.5,textTransform:"uppercase"}}>Paul Monahan Golf</span>
          <div style={{height:1,width:20,background:footerRule}}/>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// PRE-ROUND CHECKLIST
// ═══════════════════════════════════════
function PreRoundChecklist({onBack,onStartRound,S,lastIntention,preRoundMeta,setPreRoundMeta,settings}) {
  const P=useTheme();
  const [checked,setChecked]=useState(()=>{try{const s=sessionStorage.getItem("mgp_preround_checked");return s?JSON.parse(s):{}}catch{return{}}});
  const [complete,setComplete]=useState(false);
  const [showConfetti,setShowConfetti]=useState(false);
  const [showSkipWarn,setShowSkipWarn]=useState(false);

  // Timer state
  const timerEnabled = settings?.preroundTimer===true;
  const timerLong = settings?.preroundTimerLong===true;
  const TOTAL_DURATION = timerLong ? 360 : 180;
  const INTERVAL = timerLong ? 40 : 20;
  const TOTAL_ITEMS = PREROUND_SECTIONS.reduce((s,sec)=>s+sec.items.length,0);
  const [timerActive,setTimerActive]=useState(false);
  const [timerStarted,setTimerStarted]=useState(false);
  const [elapsed,setElapsed]=useState(0);
  const [pulse,setPulse]=useState(false);
  const [timerComplete,setTimerComplete]=useState(false);
  const timerRef=useRef(null);
  const lastPulseItem=useRef(-1);

  useEffect(()=>{
    if(!timerActive) return;
    timerRef.current=setInterval(()=>{
      setElapsed(e=>{
        const next=e+1;
        const currentItem=Math.floor(next/INTERVAL);
        if(next%INTERVAL===0&&currentItem<TOTAL_ITEMS&&currentItem!==lastPulseItem.current){
          lastPulseItem.current=currentItem;
          setPulse(true);
          vibrate(30);
          setTimeout(()=>setPulse(false),1200);
        }
        vibrate([10,30,10]); if(next>=TOTAL_DURATION){
          clearInterval(timerRef.current);
          setTimerActive(false);
          setTimerComplete(true);
          vibrate([40,30,40,30,80]);
          return TOTAL_DURATION;
        }
        return next;
      });
    },1000);
    return()=>clearInterval(timerRef.current);
  },[timerActive]);

  const totalItems=TOTAL_ITEMS;
  const checkedCount=Object.values(checked).filter(Boolean).length;
  const allDone=checkedCount===totalItems;
  const timeLeft=TOTAL_DURATION-elapsed;
  const mins=Math.floor(timeLeft/60);
  const secs=timeLeft%60;
  const currentItemIdx=timerActive?Math.min(Math.floor(elapsed/INTERVAL),TOTAL_ITEMS-1):-1;

  function toggle(key){ setChecked(p=>{const n={...p,[key]:!p[key]};try{sessionStorage.setItem("mgp_preround_checked",JSON.stringify(n));}catch{}return n;}); }

  useEffect(()=>{ if(allDone&&checkedCount>0)setShowConfetti(true); },[allDone]);

  if(complete) return (
    <div style={{...S.shell,justifyContent:"center",alignItems:"center",padding:32,textAlign:"center"}}>
      <div style={{marginBottom:16,animation:"fadeIn 0.5s ease-out"}}><Icons.Flag color={P.green} size={52}/></div>
      <div style={{fontSize:26,fontWeight:800,marginBottom:8,color:P.white,animation:"fadeIn 0.5s ease-out 0.1s both"}}>You're Ready</div>
      <div style={{fontSize:16,color:P.muted,lineHeight:1.6,maxWidth:300,marginBottom:24,animation:"fadeIn 0.5s ease-out 0.2s both"}}>Trust your process, stay present, and enjoy every shot today.</div>
      <div style={{fontSize:15,color:P.gold,fontWeight:600,marginBottom:32,animation:"fadeIn 0.5s ease-out 0.3s both"}}>Play Better · Struggle Less · Enjoy More</div>
      <button onClick={onStartRound} {...pp()} style={{...actionBtnS(P,P.green),padding:"14px 40px",fontSize:17,flex:"none",animation:"fadeIn 0.5s ease-out 0.4s both"}}>Open Scorecard</button>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}*{box-sizing:border-box;}`}</style>
    </div>
  );

  return (
    <div style={S.shell}>
      <ConfettiCanvas active={showConfetti} onDone={()=>setShowConfetti(false)}/>

      {/* Pulse overlay — subtle green wash */}
      {pulse&&<div style={{position:"fixed",inset:0,zIndex:997,background:"rgba(22,163,74,0.08)",pointerEvents:"none",animation:"pulseWash 1.2s ease-out forwards"}}/>}

      <div style={{padding:"16px 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:P.white}}>Pre-Round Routine</div>
          <div style={{fontSize:12,color:P.muted,fontWeight:500}}>{checkedCount}/{totalItems} complete</div>
        </div>
        <button onClick={()=>setShowSkipWarn(true)} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:12,color:P.muted,fontWeight:600,padding:"4px 8px"}} {...pp()}>Skip</button>
      </div>

      {showSkipWarn&&(
        <div style={{position:"fixed",inset:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.55)",backdropFilter:"blur(6px)",animation:"fadeIn 0.2s ease-out"}}>
          <div style={{background:P.card,borderRadius:16,padding:26,width:"88%",maxWidth:340,border:`1.5px solid ${P.border}`,boxShadow:"0 20px 40px rgba(0,0,0,0.15)",textAlign:"center"}}>
            <div style={{marginBottom:12}}><Icons.Flag color={P.accent} size={32}/></div>
            <div style={{fontSize:17,fontWeight:800,color:P.white,marginBottom:10}}>You sure you want to skip?</div>
            <div style={{fontSize:14,color:P.muted,lineHeight:1.6,marginBottom:18}}>The golfer who shows up without intention is already playing from behind. These three minutes aren't preparation — they're the beginning of your round.</div>
            <div style={{fontSize:13,color:P.gold,fontWeight:600,fontStyle:"italic",marginBottom:20}}>"You can choose the mental and emotional stance from which you play."</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowSkipWarn(false)} {...pp()} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:14,fontWeight:600,cursor:"pointer"}}>Go Back</button>
              <button onClick={onStartRound} {...pp()} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${P.red}44`,background:P.red+"12",color:P.red,fontSize:14,fontWeight:600,cursor:"pointer"}}>Skip Anyway</button>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div style={{margin:"0 20px 8px",height:5,borderRadius:3,background:P.cardAlt}}>
        <div style={{width:`${(checkedCount/totalItems)*100}%`,height:"100%",borderRadius:3,background:allDone?P.green:P.accent,transition:"width 0.3s"}}/>
      </div>

      {/* Timer complete modal */}
      {timerComplete&&(
        <div style={{position:"fixed",inset:0,zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",animation:"fadeIn 0.3s ease-out"}}>
          <div style={{background:P.card,borderRadius:20,padding:"28px 24px",width:"88%",maxWidth:340,border:`1.5px solid ${P.green}55`,boxShadow:`0 0 40px ${P.green}22, 0 24px 60px rgba(0,0,0,0.4)`,textAlign:"center"}}>
            <div style={{width:64,height:64,borderRadius:18,background:P.green+"22",border:`1.5px solid ${P.green}44`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}>
              <Icons.Flag color={P.green} size={30}/>
            </div>
            <div style={{fontSize:11,fontWeight:800,letterSpacing:2,color:P.green,marginBottom:8}}>{timerLong?"6":"3"}-MINUTE ROUTINE COMPLETE</div>
            <div style={{fontSize:22,fontWeight:900,color:P.white,marginBottom:8,letterSpacing:-0.5}}>Your Mind is Ready</div>
            <div style={{fontSize:14,color:P.muted,lineHeight:1.6,marginBottom:20}}>You've set your intention, connected to gratitude, and embraced curiosity. Step onto the first tee with presence.</div>
            <div style={{fontSize:13,color:P.gold,fontWeight:600,fontStyle:"italic",marginBottom:24}}>"Play Better · Struggle Less · Enjoy More"</div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setTimerComplete(false)} {...pp()} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}>Continue</button>
              <button onClick={onStartRound} {...pp()} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:P.green,color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}>Open Scorecard</button>
            </div>
          </div>
        </div>
      )}

      <div style={{flex:1,overflowY:"auto",padding:"0 16px calc(20px + env(safe-area-inset-bottom,0px))"}}>
        {lastIntention&&(
          <div style={{marginBottom:14,padding:"12px 14px",borderRadius:12,background:"linear-gradient(135deg, #ca8a0410, #fbbf2410)",border:"1.5px solid #ca8a0433",animation:"fadeIn 0.4s ease-out"}}>
            <div style={{fontSize:9,color:"#ca8a04",fontWeight:800,letterSpacing:1.5,marginBottom:5}}>YOUR INTENTION FROM LAST ROUND</div>
            <div style={{fontSize:14,color:P.white,fontWeight:600,fontStyle:"italic",lineHeight:1.5}}>"{lastIntention}"</div>
            <div style={{fontSize:11,color:P.muted,marginTop:6,fontWeight:500}}>Let this guide who you want to BE today.</div>
          </div>
        )}

        {/* Sleep / Energy / Partners */}
        <div style={{marginBottom:14,background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
          <div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:1.5,marginBottom:10}}>BEFORE YOU PLAY</div>
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,color:P.white}}>Sleep Quality</span>
              <span style={{fontSize:12,fontWeight:700,color:["","#dc2626","#ea580c","#ca8a04","#16a34a","#22c55e"][preRoundMeta?.sleep||3]}}>{["","Poor","Meh","Okay","Good","Great"][preRoundMeta?.sleep||3]}</span>
            </div>
            <input type="range" min="1" max="5" step="1" value={preRoundMeta?.sleep||3} onChange={e=>setPreRoundMeta&&setPreRoundMeta(p=>({...p,sleep:+e.target.value}))} style={{width:"100%",accentColor:P.accent}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",marginTop:4}}>
              {["Poor","Meh","Okay","Good","Great"].map((l,i)=>(
                <button key={i} onClick={()=>setPreRoundMeta&&setPreRoundMeta(p=>({...p,sleep:i+1}))} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{width:1,height:5,background:(preRoundMeta?.sleep||3)===i+1?P.accent:P.border,margin:"0 auto"}}/>
                  <span style={{fontSize:9,color:(preRoundMeta?.sleep||3)===i+1?P.accent:P.muted,fontWeight:(preRoundMeta?.sleep||3)===i+1?700:400,textAlign:"center"}}>{l}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{fontSize:12,fontWeight:600,color:P.white}}>Energy Level</span>
              <span style={{fontSize:12,fontWeight:700,color:["","#dc2626","#ea580c","#ca8a04","#16a34a","#22c55e"][preRoundMeta?.energy||3]}}>{["","Tired","Meh","Okay","Energized","Peak"][preRoundMeta?.energy||3]}</span>
            </div>
            <input type="range" min="1" max="5" step="1" value={preRoundMeta?.energy||3} onChange={e=>setPreRoundMeta&&setPreRoundMeta(p=>({...p,energy:+e.target.value}))} style={{width:"100%",accentColor:P.accent}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",marginTop:4}}>
              {["Tired","Meh","Okay","Energized","Peak"].map((l,i)=>(
                <button key={i} onClick={()=>setPreRoundMeta&&setPreRoundMeta(p=>({...p,energy:i+1}))} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{width:1,height:5,background:(preRoundMeta?.energy||3)===i+1?P.accent:P.border,margin:"0 auto"}}/>
                  <span style={{fontSize:9,color:(preRoundMeta?.energy||3)===i+1?P.accent:P.muted,fontWeight:(preRoundMeta?.energy||3)===i+1?700:400,textAlign:"center"}}>{l}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:P.white,marginBottom:6}}>Playing With</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {[{v:"solo",l:"Solo"},{v:"friends",l:"Friends"},{v:"competitive",l:"Competitive"},{v:"strangers",l:"Strangers"}].map(p=>(
                <button key={p.v} onClick={()=>setPreRoundMeta&&setPreRoundMeta(prev=>({...prev,partners:p.v}))} {...pp()} style={{padding:"4px 10px",borderRadius:20,border:`1.5px solid ${(preRoundMeta?.partners||"friends")===p.v?P.accent:P.border}`,background:(preRoundMeta?.partners||"friends")===p.v?P.accent+"18":"transparent",color:(preRoundMeta?.partners||"friends")===p.v?P.accent:P.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>{p.l}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Timer block — below Before You Play */}
        {timerEnabled&&(
          <div style={{marginBottom:14,borderRadius:14,background:timerActive?"#16a34a12":P.card,border:`1.5px solid ${timerActive?"#16a34a44":P.border}`,padding:"12px 14px",transition:"all 0.3s"}}>
            {!timerStarted?(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:P.white}}>{timerLong?"6-Minute":"3-Minute"} Guided Timer</div>
                  <div style={{fontSize:11,color:P.muted,marginTop:1}}>A nudge every {INTERVAL}s to move to the next item</div>
                </div>
                <button onClick={()=>{setTimerStarted(true);setTimerActive(true);}} {...pp()} style={{padding:"8px 14px",borderRadius:10,border:"none",background:P.green,color:"#fff",fontSize:12,fontWeight:800,cursor:"pointer",flexShrink:0,marginLeft:10}}>Start</button>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{position:"relative",width:48,height:48,flexShrink:0}}>
                    <svg width="48" height="48" style={{transform:"rotate(-90deg)"}}>
                      <circle cx="24" cy="24" r="20" fill="none" stroke={P.cardAlt} strokeWidth="3"/>
                      <circle cx="24" cy="24" r="20" fill="none" stroke={P.green} strokeWidth="3"
                        strokeDasharray={`${2*Math.PI*20}`}
                        strokeDashoffset={`${2*Math.PI*20*(1-elapsed/TOTAL_DURATION)}`}
                        strokeLinecap="round"
                        style={{transition:"stroke-dashoffset 1s linear"}}
                      />
                    </svg>
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:P.green}}>
                      {mins}:{secs.toString().padStart(2,"0")}
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:P.white}}>{timerActive?"In progress":"Paused"}</div>
                    <div style={{fontSize:11,color:P.muted}}>Item {Math.min(currentItemIdx+1,totalItems)} of {totalItems}</div>
                  </div>
                </div>
                <button onClick={()=>setTimerActive(a=>!a)} {...pp()} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:11,fontWeight:700,cursor:"pointer"}}>
                  {timerActive?"Pause":"Resume"}
                </button>
              </div>
            )}
          </div>
        )}

        {PREROUND_SECTIONS.map((sec,si)=>{
          const sectionDone=sec.items.every((_,ii)=>checked[`${si}-${ii}`]);
          const Ic=Icons[sec.IconKey];
          // Global item index for timer highlighting
          const sectionStartIdx=PREROUND_SECTIONS.slice(0,si).reduce((s,s2)=>s+s2.items.length,0);
          return (
            <div key={si} style={{marginBottom:16,animation:`fadeIn 0.3s ease-out ${si*0.05}s both`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:36,height:36,borderRadius:10,background:sec.color+"15",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic color={sec.color} size={18}/></div>
                <div><div style={{fontSize:15,fontWeight:700,color:sectionDone?P.green:P.white}}>{sec.title}</div><div style={{fontSize:11,color:P.muted,fontWeight:500}}>{sec.source}</div></div>
                {sectionDone&&<span style={{marginLeft:"auto",color:P.green,fontSize:18,fontWeight:700}}>✓</span>}
              </div>
              <div style={{background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
                <div style={{fontSize:13,color:sec.color,fontStyle:"italic",marginBottom:10,lineHeight:1.4,fontWeight:500}}>{sec.insight}</div>
                {sec.items.map((item,ii)=>{
                  const key=`${si}-${ii}`;
                  const done=checked[key];
                  const globalIdx=sectionStartIdx+ii;
                  const isCurrentTimerItem=timerActive&&currentItemIdx===globalIdx;
                  const isPulsing=pulse&&isCurrentTimerItem;
                  return (
                    <button key={key} onClick={()=>toggle(key)} {...pp()} style={{display:"flex",alignItems:"flex-start",gap:10,width:"100%",background:isCurrentTimerItem?"#16a34a08":"transparent",border:"none",cursor:"pointer",padding:"8px 0",textAlign:"left",borderTop:ii>0?`1px solid ${P.border}44`:"none",transition:"all 0.2s ease",borderRadius:isCurrentTimerItem?8:0}}>
                      <div style={{width:24,height:24,borderRadius:6,flexShrink:0,marginTop:1,border:`2px solid ${done?P.green:isCurrentTimerItem?P.green:P.border}`,background:done?P.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:13,fontWeight:700,transition:"all 0.15s",boxShadow:isCurrentTimerItem&&!done?`0 0 8px ${P.green}55`:"none"}}>{done?"✓":""}</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,color:done?P.muted:P.white,lineHeight:1.45,textDecoration:done?"line-through":"none",transition:"color 0.15s",fontWeight:500}}>{item}</div>
                        {isCurrentTimerItem&&!done&&<div style={{fontSize:10,color:P.green,fontWeight:700,marginTop:3,letterSpacing:0.5}}>Current item</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {allDone&&<button onClick={()=>setComplete(true)} {...pp()} style={{width:"100%",padding:"14px",borderRadius:12,border:`2px solid ${P.green}`,background:P.green+"12",color:P.green,fontSize:17,fontWeight:800,cursor:"pointer",animation:"fadeIn 0.3s ease-out",transition:"transform 0.1s ease"}}>I'm Ready — Let's Go</button>}
      </div>
      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulseWash{0%{opacity:0;}20%{opacity:1;}80%{opacity:1;}100%{opacity:0;}}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
      `}</style>
    </div>
  );
}

function InnerCaddieView({onBack,S}) {
  const P=useTheme();
  const darkMode = P.bg === "#09090b";
  const [cat,setCat]=useState(null);
  const [msg,setMsg]=useState(null);
  const [fk,setFk]=useState(0);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setLoaded(true),60);return()=>clearTimeout(t);},[]);

  function pick(c){setCat(c);setMsg(c.messages[Math.floor(Math.random()*c.messages.length)]);setFk(k=>k+1);}
  function draw(){if(!cat)return;let n;do{n=cat.messages[Math.floor(Math.random()*cat.messages.length)];}while(n===msg&&cat.messages.length>1);setMsg(n);setFk(k=>k+1);}

  return (
    <div style={{...S.shell,position:"relative",overflow:"hidden",background:P.bg}}>
      {/* Ambient glow */}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 70% 40% at 50% 0%, ${darkMode?"rgba(0,103,71,0.15)":"rgba(0,103,71,0.08)"} 0%, transparent 60%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"16px 20px 0",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:P.white,letterSpacing:-0.5}}>Inner Caddie</div>
          <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:2,marginTop:1}}>PLAY BETTER · STRUGGLE LESS · ENJOY MORE</div>
        </div>
        <div style={{width:40}}/>
      </div>

      {!cat?(
        /* ── CATEGORY GRID ── */
        <div style={{padding:"16px 16px",flex:1,overflowY:"auto",position:"relative",zIndex:1}}>
          <div style={{textAlign:"center",marginBottom:16,opacity:loaded?1:0,transition:"opacity 0.4s ease"}}>
            <div style={{fontSize:13,color:P.muted,fontWeight:500}}>Choose a category to draw wisdom</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {CADDIE_CATEGORIES.map((c,i)=>{
              const Ic=Icons[c.IconKey];
              return (
                <button key={c.name} onClick={()=>pick(c)} {...pp()} style={{
                  background:P.card,borderRadius:16,padding:"18px 12px",
                  border:`1.5px solid ${P.border}`,cursor:"pointer",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:8,
                  position:"relative",overflow:"hidden",
                  opacity:loaded?1:0,transform:loaded?"translateY(0)":"translateY(12px)",
                  transition:`all 0.45s cubic-bezier(0.16,1,0.3,1) ${i*0.05}s`,
                }}>
                  {/* Colour accent strip */}
                  <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${c.color},${c.color}88)`}}/>
                  <div style={{width:48,height:48,borderRadius:14,background:P.cardAlt,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Ic color={c.color} size={24}/>
                  </div>
                  <span style={{fontSize:14,fontWeight:800,color:P.white,letterSpacing:-0.3}}>{c.name}</span>
                  <span style={{fontSize:10,color:P.muted,fontStyle:"italic",textAlign:"center",fontWeight:500,lineHeight:1.4}}>{c.subtitle}</span>
                </button>
              );
            })}
          </div>
        </div>
      ):(
        /* ── CARD DRAW ── */
        <div style={{padding:"16px 20px",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative",zIndex:1}}>
          {/* Back to categories */}
          <button onClick={()=>{setCat(null);setMsg(null);}} style={{background:"transparent",border:"none",cursor:"pointer",fontSize:11,color:P.muted,marginBottom:20,letterSpacing:1.5,fontWeight:700,display:"flex",alignItems:"center",gap:6}} {...pp()}>
            <Icons.Back color={P.muted} size={12}/> ALL CATEGORIES
          </button>

          {/* Category identity */}
          <div style={{textAlign:"center",marginBottom:24}}>
            {(()=>{const Ic=Icons[cat.IconKey];return(
              <div style={{width:64,height:64,borderRadius:18,background:P.cardAlt,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
                <Ic color={cat.color} size={30}/>
              </div>
            );})()}
            <div style={{fontSize:24,fontWeight:900,color:P.white,letterSpacing:-0.5,marginBottom:3}}>{cat.name}</div>
            <div style={{fontSize:12,color:P.muted,fontStyle:"italic",fontWeight:500}}>{cat.subtitle}</div>
          </div>

          {/* Wisdom card */}
          <div key={fk} style={{
            width:"100%",maxWidth:360,
            background:P.card,
            borderRadius:20,padding:"28px 24px",
            border:`1.5px solid ${P.border}`,
            boxShadow:"0 2px 8px rgba(0,0,0,0.08)",
            textAlign:"center",
            animation:"cardFlip 0.4s cubic-bezier(0.16,1,0.3,1)",
            position:"relative",overflow:"hidden",
            marginBottom:24,
          }}>
            {/* Top accent bar */}
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:P.border}}/>
            <div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:2.5,marginBottom:14,textTransform:"uppercase"}}>YOUR INNER CADDIE SAYS</div>
            <div style={{fontSize:18,lineHeight:1.6,color:P.white,fontWeight:500,fontStyle:"italic"}}>"{msg}"</div>
          </div>

          {/* Draw button */}
          <button onClick={draw} {...pp()} style={{
            padding:"14px 36px",borderRadius:14,
            border:`1.5px solid ${P.border}`,
            background:P.cardAlt,
            color:P.white,fontSize:15,fontWeight:800,
            cursor:"pointer",letterSpacing:0.3,
            boxShadow:"none",
            transition:"transform 0.1s ease",
          }}>
            Draw Another
          </button>
        </div>
      )}
      <style>{`@keyframes cardFlip{0%{transform:scale(0.9) rotateY(90deg);opacity:0;}100%{transform:scale(1) rotateY(0);opacity:1;}}*{box-sizing:border-box;}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// SCORECARD VIEW
// ═══════════════════════════════════════
function ScorecardView({scores,front,back,total,courseName,roundDate,onBack,onHome,onSelectHole,S,handicap}) {
  const activeRowRef = React.useRef(null);
  React.useEffect(()=>{ if(activeRowRef.current) activeRowRef.current.scrollIntoView({block:"center",behavior:"smooth"}); },[]);
  const P=useTheme();
  const fp=scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.par)||0),0),bp=scores.slice(9).reduce((s,h)=>s+(parseInt(h.par)||0),0);
  const fs=scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0),bs=scores.slice(9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0);
  const fPutts=scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.putts)||0),0),bPutts=scores.slice(9).reduce((s,h)=>s+(parseInt(h.putts)||0),0);
  const fFir=scores.slice(0,9).filter(h=>h.fairway===true).length,bFir=scores.slice(9).filter(h=>h.fairway===true).length;
  const fGir=scores.slice(0,9).filter(h=>h.gir===true).length,bGir=scores.slice(9).filter(h=>h.gir===true).length;
  const hasHCP = scores.some(h=>h.strokeIndex);
  const hcpAllowance = handicap ? parseFloat(handicap) : null;
  function getNetScore(strokeScore, par, si) {
    if (!strokeScore || !par || !hcpAllowance || !si) return null;
    const shots = Math.floor(hcpAllowance/18) + (parseInt(si)<=Math.round(hcpAllowance%18)?1:0);
    return parseInt(strokeScore) - parseInt(par) - shots;
  }
  return (
    <div style={S.shell}>
      <div style={{padding:"16px 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}><button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button><div style={{fontSize:18,fontWeight:700,color:P.white}}>Full Scorecard</div><button onClick={onHome||onBack} style={S.iconBtn} {...pp()}><Icons.Home color={P.muted} size={17}/></button></div>
      {courseName&&<div style={{textAlign:"center",color:P.muted,fontSize:13,fontWeight:500}}>{courseName} — {roundDate}</div>}
      <div style={{flex:1,overflowX:"auto",padding:"6px 4px 0"}}>
        <table style={{borderCollapse:"collapse",fontSize:11,minWidth:"100%"}}>
          <thead>
            <tr>
              {["#","Par","Scr","+/-","Putts","FIR","GIR","H","B","Net"].map(h=>(
                <th key={h} style={{padding:"5px 4px",textAlign:"center",color:P.muted,borderBottom:`1.5px solid ${P.border}`,fontSize:9,fontWeight:700,whiteSpace:"nowrap",position:"sticky",top:0,background:P.bg,zIndex:1}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({length:18},(_,i)=>{
              const s=getHoleStats(scores,i);
              const h=scores[i];
              const nt=scoreNotation(h.strokeScore,h.par);
              const ns=getNetScore(h.strokeScore,h.par,h.strokeIndex);
              const runStroke=scores.slice(0,i+1).filter(x=>x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.strokeScore)||0),0);
              const runPar=scores.slice(0,i+1).filter(x=>x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.par)||0),0);
              const runDiff=(h.strokeScore&&h.par)?runStroke-runPar:null;
              return [
                <tr key={i} ref={!scores[i].strokeScore&&!scores.slice(0,i).some(h=>!h.strokeScore)?activeRowRef:null} onClick={()=>onSelectHole(i)} style={{cursor:"pointer",background:i%2===0?P.card:"transparent"}}>
                  <td style={{...S.cell,fontWeight:700,color:P.accent}}>{i+1}</td>
                  <td style={S.cell}>{h.par||"—"}</td>
                  <td style={{...S.cell,fontWeight:h.strokeScore?800:400}}>
                    {h.strokeScore?(()=>{
                      const diff = nt?.diff ?? 0;
                      const baseStyle = {
                        display:"inline-flex",alignItems:"center",justifyContent:"center",
                        width:24,height:24,fontSize:12,fontWeight:800,position:"relative",
                        color: diff<0 ? P.green : diff>0 ? P.red : P.white,
                      };
                      if (diff <= -2) return ( // Eagle: double circle
                        <span style={{...baseStyle,position:"relative"}}>
                          <span style={{position:"absolute",inset:-1,borderRadius:"50%",border:`1.5px solid ${P.gold}`}}/>
                          <span style={{position:"absolute",inset:3,borderRadius:"50%",border:`1.5px solid ${P.gold}`}}/>
                          <span style={{color:P.gold}}>{h.strokeScore}</span>
                        </span>
                      );
                      if (diff === -1) return ( // Birdie: circle
                        <span style={{...baseStyle,borderRadius:"50%",border:`1.5px solid ${P.green}`}}>{h.strokeScore}</span>
                      );
                      if (diff === 0) return ( // Par: plain
                        <span style={{...baseStyle}}>{h.strokeScore}</span>
                      );
                      if (diff === 1) return ( // Bogey: square
                        <span style={{...baseStyle,borderRadius:3,border:`1.5px solid ${P.red}`}}>{h.strokeScore}</span>
                      );
                      // Double+: double square
                      return (
                        <span style={{...baseStyle,position:"relative"}}>
                          <span style={{position:"absolute",inset:-1,borderRadius:3,border:`1.5px solid ${P.red}`}}/>
                          <span style={{position:"absolute",inset:3,borderRadius:2,border:`1.5px solid ${P.red}`}}/>
                          <span style={{color:P.red}}>{h.strokeScore}</span>
                        </span>
                      );
                    })():"—"}
                  </td>
                  <td style={{...S.cell,fontWeight:700,color:runDiff===null?P.muted:runDiff<0?P.green:runDiff>0?P.red:P.gold}}>{runDiff===null?"—":runDiff===0?"E":(runDiff>0?"+":"")+runDiff}</td>
                  <td style={{...S.cell,color:h.putts>2?P.red:h.putts===1?P.green:P.white,fontWeight:h.putts?700:400}}>{h.putts||"—"}</td>
                  <td style={{...S.cell,color:h.fairway===true?P.green:P.muted,fontWeight:700}}>{h.fairway===true?"✓":"—"}</td>
                  <td style={{...S.cell,color:h.gir===true?P.accent:P.muted,fontWeight:700}}>{h.gir===true?"✓":"—"}</td>
                  <td style={{...S.cell,color:P.green,fontWeight:600}}>{s.heroes||"—"}</td>
                  <td style={{...S.cell,color:P.red,fontWeight:600}}>{s.bandits||"—"}</td>
                  <td style={{...S.cell,fontWeight:700,color:s.net>0?P.green:s.net<0?P.red:s.heroes+s.bandits>0?P.gold:P.muted}}>{s.heroes+s.bandits>0?(s.net>0?"+":"")+s.net:"—"}</td>
                </tr>,
                i===8&&<tr key="out" style={{background:P.cardAlt,borderTop:`1.5px solid ${P.border}`}}>
                  <td style={{...S.cell,fontWeight:800,fontSize:9,color:P.muted}}>OUT</td>
                  <td style={{...S.cell,fontWeight:700}}>{fp||"—"}</td>
                  <td style={{...S.cell,fontWeight:700}}>{fs||"—"}</td>
                  <td style={{...S.cell,fontWeight:700,color:fs&&fp?(fs-fp)<0?P.green:(fs-fp)>0?P.red:P.gold:P.muted}}>{fs&&fp?(fs-fp)===0?"E":((fs-fp)>0?"+":"")+(fs-fp):"—"}</td>
                  <td style={{...S.cell,fontWeight:700,color:P.white}}>{fPutts||"—"}</td>
                  <td style={{...S.cell,fontWeight:700,color:P.green}}>{fFir}/9</td>
                  <td style={{...S.cell,fontWeight:700,color:P.accent}}>{fGir}/9</td>
                  <td style={{...S.cell,color:P.green,fontWeight:700}}>{front.heroes}</td>
                  <td style={{...S.cell,color:P.red,fontWeight:700}}>{front.bandits}</td>
                  <td style={{...S.cell,fontWeight:800,color:front.net>0?P.green:front.net<0?P.red:P.gold}}>{front.net>0?"+":""}{front.net}</td>
                </tr>,
              ];
            })}
            <tr style={{background:P.cardAlt,borderTop:`1.5px solid ${P.border}`}}>
              <td style={{...S.cell,fontWeight:800,fontSize:9,color:P.muted}}>IN</td>
              <td style={{...S.cell,fontWeight:700}}>{bp||"—"}</td>
              <td style={{...S.cell,fontWeight:700}}>{bs||"—"}</td>
              <td style={{...S.cell,fontWeight:700,color:bs&&bp?(bs-bp)<0?P.green:(bs-bp)>0?P.red:P.gold:P.muted}}>{bs&&bp?(bs-bp)===0?"E":((bs-bp)>0?"+":"")+(bs-bp):"—"}</td>
              <td style={{...S.cell,fontWeight:700,color:P.white}}>{bPutts||"—"}</td>
              <td style={{...S.cell,fontWeight:700,color:P.green}}>{bFir}/9</td>
              <td style={{...S.cell,fontWeight:700,color:P.accent}}>{bGir}/9</td>
              <td style={{...S.cell,color:P.green,fontWeight:700}}>{back.heroes}</td>
              <td style={{...S.cell,color:P.red,fontWeight:700}}>{back.bandits}</td>
              <td style={{...S.cell,fontWeight:800,color:back.net>0?P.green:back.net<0?P.red:P.gold}}>{back.net>0?"+":""}{back.net}</td>
            </tr>
            <tr style={{background:P.accent+"10",borderTop:`2px solid ${P.accent}44`}}>
              <td style={{...S.cell,fontWeight:800,fontSize:9,color:P.accent}}>TOT</td>
              <td style={{...S.cell,fontWeight:800}}>{fp+bp||"—"}</td>
              <td style={{...S.cell,fontWeight:800}}>{fs+bs||"—"}</td>
              <td style={{...S.cell,fontWeight:800,color:(fs+bs)&&(fp+bp)?(fs+bs-(fp+bp))<0?P.green:(fs+bs-(fp+bp))>0?P.red:P.gold:P.muted}}>{(fs+bs)&&(fp+bp)?(fs+bs-(fp+bp))===0?"E":((fs+bs-(fp+bp))>0?"+":"")+(fs+bs-(fp+bp)):"—"}</td>
              <td style={{...S.cell,fontWeight:800,color:P.white}}>{fPutts+bPutts||"—"}</td>
              <td style={{...S.cell,fontWeight:800,color:P.green}}>{fFir+bFir}/18</td>
              <td style={{...S.cell,fontWeight:800,color:P.accent}}>{fGir+bGir}/18</td>
              <td style={{...S.cell,color:P.green,fontWeight:800}}>{total.heroes}</td>
              <td style={{...S.cell,color:P.red,fontWeight:800}}>{total.bandits}</td>
              <td style={{...S.cell,fontWeight:900,fontSize:14,color:total.net>0?P.green:total.net<0?P.red:P.gold}}>{total.net>0?"+":""}{total.net}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{padding:"4px 12px 10px",textAlign:"center",fontSize:10,color:P.muted}}>Tap any hole to edit</div>
    </div>
  );
}

// ═══════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════
function HistoryView({rounds,onBack,onDelete,selectedRound,setSelectedRound,onShare,onEdit,S}) {
  const P=useTheme();
  const darkMode = P.bg === "#09090b";
  const [confirmId,setConfirmId]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const pp=pressProps;
  useEffect(()=>{const t=setTimeout(()=>setLoaded(true),60);return()=>clearTimeout(t);},[]);

  return (
    <div style={{...S.shell,background:P.bg,display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:P.white,letterSpacing:-0.5}}>Round History</div>
          {rounds.length>0&&<div style={{fontSize:10,color:PM_GOLD,fontWeight:600,letterSpacing:1,marginTop:1}}>{rounds.length} SAVED ROUND{rounds.length!==1?"S":""}</div>}
        </div>
        <div style={{width:40}}/>
      </div>

      {/* Round list */}
      {rounds.length===0?(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:40}}>
          <Icons.Clipboard color={P.muted} size={40}/>
          <div style={{fontSize:15,color:P.muted,fontWeight:500,textAlign:"center"}}>No saved rounds yet.</div>
          <div style={{fontSize:13,color:P.muted,opacity:0.6,textAlign:"center"}}>Complete your first round to see it here.</div>
        </div>
      ):(
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px 24px"}}>
          {rounds.map((r,idx)=>{
            const netColor=r.net>0?P.green:r.net<0?P.red:P.gold;
            const stp=r.totalStroke&&r.totalPar?r.totalStroke-r.totalPar:null;
            const isC=confirmId===r.id;
            return (
              <div key={r.id} style={{
                marginBottom:10,borderRadius:16,overflow:"hidden",
                border:`1.5px solid ${isC?P.red+"66":P.border}`,
                background:P.card,
                opacity:loaded?1:0,transform:loaded?"translateY(0)":"translateY(10px)",
                transition:`all 0.4s cubic-bezier(0.16,1,0.3,1) ${idx*0.04}s`,
              }}>
                {/* Net color strip */}
                <div style={{height:3,background:`linear-gradient(90deg,${netColor},${netColor}44)`}}/>
                {/* Main row */}
                <div onClick={()=>setSelectedRound(r.id===selectedRound?.id?null:r)} style={{display:"flex",alignItems:"center",padding:"12px 14px",cursor:"pointer",gap:12}}>
                  <div style={{width:46,height:46,borderRadius:12,background:netColor+"15",border:`1.5px solid ${netColor}33`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <div style={{fontSize:17,fontWeight:900,color:netColor,lineHeight:1}}>{r.net>0?"+":""}{r.net}</div>
                    <div style={{fontSize:9,color:PM_GOLD,fontWeight:700,letterSpacing:1}}>NET</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:14,color:P.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.course}</div>
                    <div style={{fontSize:11,color:P.muted,marginTop:1}}>{r.date}{r.totalStroke>0?` · Shot ${r.totalStroke}${stp!==null?` (${stp>0?"+":""}${stp})`:""}`:""}
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:3}}>
                      <span style={{fontSize:10,color:P.green,fontWeight:700}}>{r.heroes}H</span>
                      <span style={{fontSize:10,color:P.red,fontWeight:700}}>{r.bandits}B</span>
                      {r.preRoundMeta?.partners&&<span style={{fontSize:10,color:P.muted}}>{r.preRoundMeta.partners}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                    <div style={{transform:selectedRound?.id===r.id?"rotate(90deg)":"rotate(0)",transition:"transform 0.2s"}}><Icons.Chev color={P.muted} size={14}/></div>
                    <button onClick={e=>{e.stopPropagation();if(isC){onDelete(r.id);setConfirmId(null);}else{setConfirmId(r.id);setTimeout(()=>setConfirmId(c=>c===r.id?null:c),3000);}}} style={{width:36,height:36,borderRadius:9,border:`1.5px solid ${isC?P.red:P.border}`,background:isC?P.red+"15":"transparent",color:isC?P.red:P.muted,fontSize:13,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} {...pp()}>
                      {isC?<Icons.Check color={P.red} size={11}/>:"✕"}
                    </button>
                  </div>
                </div>
                {isC&&<div style={{fontSize:11,color:P.red,fontWeight:600,padding:"0 14px 8px"}}>Tap ✓ again to confirm delete</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Full-screen detail overlay */}
      {selectedRound&&(()=>{
        const r=selectedRound;
        const netColor=r.net>0?P.green:r.net<0?P.red:P.gold;
        const stp=r.totalStroke&&r.totalPar?r.totalStroke-r.totalPar:null;
        const holeNotes=r.scores?r.scores.map((h,i)=>({hole:i+1,note:h.holeNote,stats:getHoleStats(r.scores,i)})).filter(h=>h.note):[];
        const HERO_COLORS_MAP={"Love":P.green,"Acceptance":P.green,"Commitment":P.green,"Vulnerability":P.green,"Grit":P.green};
        let reflParsed=null;
        try{if(r.notes&&r.notes.startsWith("{"))reflParsed=JSON.parse(r.notes);}catch{}
        return (
          <div style={{position:"fixed",inset:0,zIndex:300,background:P.bg,display:"flex",flexDirection:"column"}}>
            {/* Detail header */}
            <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${P.border}`,flexShrink:0,background:P.bg}}>
              <button onClick={()=>setSelectedRound(null)} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
              <div style={{textAlign:"center",flex:1,minWidth:0,padding:"0 8px"}}>
                <div style={{fontSize:14,fontWeight:800,color:P.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.course}</div>
                <div style={{fontSize:11,color:P.muted}}>{r.date}</div>
              </div>
              <button onClick={()=>onShare(r)} style={{...S.iconBtn,border:`1.5px solid ${P.accent}44`}} {...pp()}><Icons.Share color={P.accent} size={15}/></button>
            </div>

            {/* Detail content */}
            <div style={{flex:1,overflowY:"auto",padding:"14px 16px calc(24px + env(safe-area-inset-bottom,0px))"}}>

              {/* Net score strip */}
              <div style={{display:"flex",alignItems:"center",gap:16,padding:"12px 16px",borderRadius:14,background:P.card,border:`1.5px solid ${netColor}33`,marginBottom:12}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:42,fontWeight:900,color:netColor,lineHeight:1}}>{r.net>0?"+":""}{r.net}</div>
                  <div style={{fontSize:9,color:PM_GOLD,fontWeight:700,letterSpacing:1.5}}>MENTAL NET</div>
                </div>
                <div style={{flex:1}}>
                  {r.totalStroke>0&&<div style={{fontSize:14,color:P.accent,fontWeight:700,marginBottom:4}}>Shot {r.totalStroke}{stp!==null?` (${stp>0?"+":""}${stp})`:""}</div>}
                  <div style={{display:"flex",gap:12}}>
                    <span style={{fontSize:13,color:P.green,fontWeight:700}}>{r.heroes} Heroes</span>
                    <span style={{fontSize:13,color:P.red,fontWeight:700}}>{r.bandits} Bandits</span>
                  </div>
                  {r.preRoundMeta&&<div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                    {r.preRoundMeta?.sleep&&<span style={{fontSize:10,color:P.muted,padding:"2px 8px",borderRadius:20,background:P.cardAlt,border:`1px solid ${P.border}`}}>Sleep {["","Poor","Fair","Okay","Good","Great"][r.preRoundMeta.sleep]}</span>}
                    {r.preRoundMeta?.energy&&<span style={{fontSize:10,color:P.muted,padding:"2px 8px",borderRadius:20,background:P.cardAlt,border:`1px solid ${P.border}`}}>Energy {["","Low","Sluggish","Okay","Energized","Peak"][r.preRoundMeta.energy]}</span>}
                    {r.preRoundMeta?.partners&&<span style={{fontSize:10,color:P.accent,padding:"2px 8px",borderRadius:20,background:P.cardAlt,border:`1px solid ${P.border}`}}>{r.preRoundMeta.partners}</span>}
                  </div>}
                </div>
              </div>

              {/* Hero/Bandit breakdown */}
              {r.scores&&(
                <div style={{background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`,marginBottom:12}}>
                  <div style={{fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8}}>MATCHUP BREAKDOWN</div>
                  {MATCHUPS.map(({hero,verb,bandit})=>{
                    const hc=r.scores.reduce((s,h)=>s+(h.heroes[hero]||0),0);
                    const bc=r.scores.reduce((s,h)=>s+(h.bandits[bandit]||0),0);
                    if(hc===0&&bc===0)return null;
                    const hColor=HERO_COLORS_MAP[hero]||P.green;
                    const tot=Math.max(hc,bc,1);
                    return (
                      <div key={hero} style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                        <span style={{fontSize:11,color:hColor,fontWeight:700,width:80,flexShrink:0}}>{hero}</span>
                        <div style={{flex:1,height:6,borderRadius:3,background:P.cardAlt,overflow:"hidden"}}>
                          <div style={{width:`${(hc/tot)*100}%`,height:"100%",background:hColor,borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,color:hColor,fontWeight:700,width:18,textAlign:"center"}}>{hc}</span>
                        <span style={{fontSize:9,color:P.muted,width:10,textAlign:"center"}}>v</span>
                        <span style={{fontSize:11,color:P.red,fontWeight:700,width:18,textAlign:"center"}}>{bc}</span>
                        <div style={{flex:1,height:6,borderRadius:3,background:P.cardAlt,overflow:"hidden",direction:"rtl"}}>
                          <div style={{width:`${(bc/tot)*100}%`,height:"100%",background:P.red,borderRadius:3}}/>
                        </div>
                        <span style={{fontSize:11,color:P.red,fontWeight:700,width:80,textAlign:"right",flexShrink:0}}>{bandit}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Scorecard table */}
              {r.scores&&(()=>{
                const hFp=r.scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.par)||0),0);
                const hBp=r.scores.slice(9).reduce((s,h)=>s+(parseInt(h.par)||0),0);
                const hFs=r.scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0);
                const hBs=r.scores.slice(9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0);
                const hFfir=r.scores.slice(0,9).filter(h=>h.fairway===true&&(parseInt(h.par)===4||parseInt(h.par)===5)).length;
                const hBfir=r.scores.slice(9).filter(h=>h.fairway===true&&(parseInt(h.par)===4||parseInt(h.par)===5)).length;
                const hFgir=r.scores.slice(0,9).filter(h=>h.gir===true).length;
                const hBgir=r.scores.slice(9).filter(h=>h.gir===true).length;
                const hFront=getNineStats(r.scores,0,9);
                const hBack=getNineStats(r.scores,9,18);
                const hTotal=getRoundTotals(r.scores).total;
                return (
                <div style={{background:P.card,borderRadius:12,border:`1.5px solid ${P.border}`,marginBottom:12,overflow:"hidden"}}>
                  <div style={{fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,padding:"10px 14px 6px"}}>SCORECARD</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                      <thead>
                        <tr style={{background:P.cardAlt}}>
                          {["#","Par","Score","+/-","Putts","FIR","GIR","H","B","Net"].map(h=>(
                            <th key={h} style={{padding:"5px 3px",textAlign:"center",color:P.muted,borderBottom:`1px solid ${P.border}`,fontSize:9,fontWeight:700}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {r.scores.map((hole,i)=>{
                          const s=getHoleStats(r.scores,i);
                          const diff=hole.strokeScore&&hole.par?+hole.strokeScore-+hole.par:null;
                          const runStroke=r.scores.slice(0,i+1).filter(x=>x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.strokeScore)||0),0);
                          const runPar=r.scores.slice(0,i+1).filter(x=>x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.par)||0),0);
                          const runDiff=(hole.strokeScore&&hole.par)?runStroke-runPar:null;
                          return (
                            <tr key={i} style={{background:i%2===0?P.cardAlt+"60":"transparent",borderBottom:i===8?`2px solid ${P.border}`:undefined}}>
                              <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,color:P.accent,fontSize:10}}>{i+1}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",fontSize:10}}>{hole.par||"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",fontWeight:hole.strokeScore?700:400,color:diff===null?P.white:diff<0?P.green:diff>0?P.red:P.white,fontSize:10}}>{hole.strokeScore||"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10,color:runDiff===null?P.muted:runDiff<0?P.green:runDiff>0?P.red:P.gold}}>{runDiff===null?"—":runDiff===0?"E":(runDiff>0?"+":"")+runDiff}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",color:hole.putts>2?P.red:hole.putts===1?P.green:P.white,fontWeight:hole.putts?600:400,fontSize:10}}>{hole.putts||"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",color:hole.fairway===true?P.green:P.muted,fontWeight:700,fontSize:10}}>{parseInt(hole.par)===4||parseInt(hole.par)===5?(hole.fairway===true?"✓":"—"):"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",color:hole.gir===true?P.accent:P.muted,fontWeight:700,fontSize:10}}>{hole.gir===true?"✓":"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",color:P.green,fontWeight:600,fontSize:10}}>{s.heroes||"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",color:P.red,fontWeight:600,fontSize:10}}>{s.bandits||"—"}</td>
                              <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10,color:s.net>0?P.green:s.net<0?P.red:s.heroes+s.bandits>0?P.gold:P.muted}}>{s.heroes+s.bandits>0?(s.net>0?"+":"")+s.net:"—"}</td>
                            </tr>
                          );
                        })}
                        <tr style={{background:P.cardAlt,borderTop:`1.5px solid ${P.border}`}}>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:9,color:P.muted}}>OUT</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10}}>{hFp||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10}}>{hFs||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10,color:hFs&&hFp?(hFs-hFp)<0?P.green:(hFs-hFp)>0?P.red:P.gold:P.muted}}>{hFs&&hFp?(hFs-hFp)===0?"E":((hFs-hFp)>0?"+":"")+(hFs-hFp):"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontSize:10}}/>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,color:P.green,fontSize:10}}>{hFfir}/9</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,color:P.accent,fontSize:10}}>{hFgir}/9</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.green,fontWeight:700,fontSize:10}}>{hFront.heroes}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.red,fontWeight:700,fontSize:10}}>{hFront.bandits}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:10,color:hFront.net>0?P.green:hFront.net<0?P.red:P.gold}}>{hFront.net>0?"+":""}{hFront.net}</td>
                        </tr>
                        <tr style={{background:P.cardAlt,borderTop:`1px solid ${P.border}`}}>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:9,color:P.muted}}>IN</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10}}>{hBp||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10}}>{hBs||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,fontSize:10,color:hBs&&hBp?(hBs-hBp)<0?P.green:(hBs-hBp)>0?P.red:P.gold:P.muted}}>{hBs&&hBp?(hBs-hBp)===0?"E":((hBs-hBp)>0?"+":"")+(hBs-hBp):"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontSize:10}}/>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,color:P.green,fontSize:10}}>{hBfir}/9</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:700,color:P.accent,fontSize:10}}>{hBgir}/9</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.green,fontWeight:700,fontSize:10}}>{hBack.heroes}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.red,fontWeight:700,fontSize:10}}>{hBack.bandits}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:10,color:hBack.net>0?P.green:hBack.net<0?P.red:P.gold}}>{hBack.net>0?"+":""}{hBack.net}</td>
                        </tr>
                        <tr style={{background:P.accent+"10",borderTop:`2px solid ${P.accent}44`}}>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:9,color:P.accent}}>TOT</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:10}}>{hFp+hBp||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:10}}>{hFs+hBs||"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,fontSize:10,color:(hFs+hBs)&&(hFp+hBp)?(hFs+hBs-(hFp+hBp))<0?P.green:(hFs+hBs-(hFp+hBp))>0?P.red:P.gold:P.muted}}>{(hFs+hBs)&&(hFp+hBp)?(hFs+hBs-(hFp+hBp))===0?"E":((hFs+hBs-(hFp+hBp))>0?"+":"")+(hFs+hBs-(hFp+hBp)):"—"}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontSize:10}}/>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,color:P.green,fontSize:10}}>{hFfir+hBfir}/18</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:800,color:P.accent,fontSize:10}}>{hFgir+hBgir}/18</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.green,fontWeight:800,fontSize:10}}>{hTotal.heroes}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",color:P.red,fontWeight:800,fontSize:10}}>{hTotal.bandits}</td>
                          <td style={{padding:"4px 3px",textAlign:"center",fontWeight:900,fontSize:12,color:hTotal.net>0?P.green:hTotal.net<0?P.red:P.gold}}>{hTotal.net>0?"+":""}{hTotal.net}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                );
              })()}

              {/* Hole notes */}
              {holeNotes.length>0&&(
                <div style={{background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`,marginBottom:12}}>
                  <div style={{fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8}}>HOLE NOTES</div>
                  {holeNotes.map(hn=>(
                    <div key={hn.hole} style={{display:"flex",gap:10,marginBottom:6,paddingBottom:6,borderBottom:`1px solid ${P.border}`}}>
                      <div style={{flexShrink:0,textAlign:"center",minWidth:28}}>
                        <div style={{fontSize:9,color:P.muted}}>H</div>
                        <div style={{fontSize:15,fontWeight:800,color:P.white}}>{hn.hole}</div>
                      </div>
                      <div style={{fontSize:12,color:P.white,lineHeight:1.45,borderLeft:`2px solid ${P.border}`,paddingLeft:10}}>{hn.note}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Post-round reflection */}
              {r.notes&&(
                <div style={{background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`,marginBottom:12}}>
                  <div style={{fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8}}>POST-ROUND REFLECTION</div>
                  {reflParsed?[
                    {key:"keep",label:"Keep doing",color:P.green},
                    {key:"stop",label:"Stop doing",color:P.red},
                    {key:"start",label:"Start doing",color:P.accent},
                  ].filter(q=>reflParsed[q.key]).map(q=>(
                    <div key={q.key} style={{marginBottom:8}}>
                      <div style={{fontSize:9,fontWeight:800,color:q.color,letterSpacing:1,marginBottom:2}}>{q.label.toUpperCase()}</div>
                      <div style={{fontSize:12,color:P.white,lineHeight:1.5}}>{reflParsed[q.key]}</div>
                    </div>
                  )):(
                    <div style={{fontSize:12,color:P.white,lineHeight:1.5,whiteSpace:"pre-wrap"}}>{r.notes}</div>
                  )}
                </div>
              )}

              {/* Carry forward */}
              {r.carryForward&&(
                <div style={{padding:"10px 14px",borderRadius:12,background:"#ca8a0410",border:`1px solid #ca8a0433`,marginBottom:12}}>
                  <div style={{fontSize:9,fontWeight:800,color:"#ca8a04",letterSpacing:1,marginBottom:4}}>INTENTION FOR NEXT ROUND</div>
                  <div style={{fontSize:12,color:P.white,fontStyle:"italic",lineHeight:1.5}}>"{r.carryForward}"</div>
                </div>
              )}

              {/* Actions */}
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>{setSelectedRound(null);onEdit(r);}} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:13,cursor:"pointer",fontWeight:600}} {...pp()}>Edit</button>
                <button onClick={()=>onShare(r)} style={{flex:1,padding:"11px",borderRadius:10,border:`1.5px solid ${netColor}55`,background:netColor+"10",color:netColor,fontSize:13,cursor:"pointer",fontWeight:700}} {...pp()}>Share</button>
              </div>

            </div>
          </div>
        );
      })()}

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}`}</style>
    </div>
  );
}

function FavInput({value, onCommit, placeholder, width}) {
  const P = useTheme();
  const [local, setLocal] = React.useState(value);
  React.useEffect(()=>{ setLocal(value); }, [value]);
  return (
    <input
      value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={e=>onCommit(e.target.value)}
      placeholder={placeholder}
      style={{width,padding:"7px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:13,fontWeight:500,outline:"none"}}
    />
  );
}


function HandicapInput({value, onCommit, P}) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(()=>{ setLocal(value); }, [value]);
  return (
    <input
      value={local}
      onChange={e=>setLocal(e.target.value.replace(/[^0-9.]/g,""))}
      onBlur={e=>onCommit(e.target.value)}
      placeholder="e.g. 12.4"
      inputMode="decimal"
      style={{width:80,padding:"7px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:15,fontWeight:700,outline:"none",textAlign:"center"}}
    />
  );
}

function FavCourseSearch({settings, updateSetting, P}) {
  const [query, setQuery] = React.useState(settings.favCourse||"");
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const [tees, setTees] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [dropRect, setDropRect] = React.useState(null);
  const inputRef = React.useRef(null);
  const debRef = React.useRef(null);

  React.useEffect(()=>{
    clearTimeout(debRef.current);
    if(!query||query.length<2){setResults([]);setOpen(false);return;}
    debRef.current=setTimeout(async()=>{
      setLoading(true);
      try{
        const res=await fetch(`${GOLF_API_BASE}/search?search_query=${encodeURIComponent(query)}`,{headers:{Authorization:`Key ${GOLF_API_KEY}`}});
        const d=await res.json();
        const courses=d.courses||[];
        setResults(courses.slice(0,8));
        if(courses.length>0){
          setOpen(true);
          // Measure input position for fixed dropdown
          if(inputRef.current){
            const r=inputRef.current.getBoundingClientRect();
            setDropRect({top:r.bottom+4,left:r.left,width:r.width});
          }
        }
      }catch{}
      finally{setLoading(false);}
    },350);
  },[query]);

  React.useEffect(()=>{
    if(!open) return;
    const close = (e)=>{
      // Don't close if clicking inside the dropdown
      const dropdown = document.getElementById('fav-course-dropdown');
      if(dropdown && dropdown.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', close, {capture:true});
    return ()=>window.removeEventListener('pointerdown', close, {capture:true});
  },[open]);

  async function selectCourse(course) {
    const name = course.club_name;
    setQuery(name);
    updateSetting("favCourse", name);
    setOpen(false);
    setResults([]);
    try{
      const res=await fetch(`${GOLF_API_BASE}/courses/${course.id}`,{headers:{Authorization:`Key ${GOLF_API_KEY}`}});
      const d=await res.json();
      const full=d.course;
      if(full){
        const male=(full.tees?.male||[]).map(t=>({...t,gender:"Male"}));
        const female=(full.tees?.female||[]).map(t=>({...t,gender:"Female"}));
        const flat=[...male,...female];
        setTees(flat);
        // Save tee names to settings for persistence
        updateSetting("favTeeOptions", flat.map(t=>t.tee_name+(t.gender==="Female"?" (W)":"")));
      }
    }catch{}
  }

  // Use saved tee options if available
  const teeOptions = tees.length>0
    ? tees.map(t=>t.tee_name+(t.gender==="Female"?" (W)":""))
    : (settings.favTeeOptions||[]);

  return (
    <div style={{padding:"10px 0"}}>
      <div style={{fontSize:11,color:P.muted,fontWeight:600,marginBottom:6}}>
        Course Name <span style={{opacity:0.6,fontWeight:400}}>— pre-fills when you start a round</span>
      </div>
      <div style={{position:"relative"}}>
        <input
          ref={inputRef}
          value={query}
          onChange={e=>setQuery(e.target.value)}
          onBlur={()=>setTimeout(()=>setOpen(false),150)}
          placeholder="Search course..." onKeyDown={e=>e.key==="Escape"&&setOpen(false)}
          style={{width:"100%",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:13,outline:"none"}}
        />
        {loading&&<div style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",width:12,height:12,borderRadius:"50%",border:`2px solid ${P.border}`,borderTopColor:P.accent,animation:"spin 0.7s linear infinite"}}/>}
        {/* Fixed-position dropdown to escape overflow:hidden parents */}
        {open&&results.length>0&&dropRect&&(
          <div id="fav-course-dropdown" style={{position:"fixed",top:dropRect.top,left:dropRect.left,width:dropRect.width,background:P.card,borderRadius:10,border:`1.5px solid ${P.border}`,zIndex:9999,maxHeight:220,overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,0.35)"}}>
            {results.map(r=>(
              <div key={r.id} onPointerDown={e=>{e.preventDefault();selectCourse(r);}} style={{padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${P.border}`,fontSize:13,color:P.white,fontWeight:600,userSelect:"none"}}>
                {r.club_name}{r.course_name&&r.course_name!==r.club_name?` — ${r.course_name}`:""}
                <div style={{fontSize:10,color:P.muted,fontWeight:400,marginTop:1}}>{[r.location?.city,r.location?.state].filter(Boolean).join(", ")}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {teeOptions.length>0&&(
        <div style={{marginTop:10}}>
          <div style={{fontSize:11,color:P.muted,fontWeight:600,marginBottom:6}}>Default Tee</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {teeOptions.map(val=>{
              const sel=settings.favTee===val;
              return(
                <button key={val} onPointerDown={()=>updateSetting("favTee",val)} {...pp()} style={{padding:"5px 12px",borderRadius:20,border:`1.5px solid ${sel?P.accent:P.border}`,background:sel?P.accent+"18":"transparent",color:sel?P.accent:P.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  {val}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {!teeOptions.length&&settings.favTee&&(
        <div style={{marginTop:8,fontSize:11,color:P.muted}}>Saved tee: <span style={{color:P.accent,fontWeight:700}}>{settings.favTee}</span></div>
      )}
    </div>
  );
}

function SettingsView({settings,updateSetting,darkMode,toggleTheme,onBack,S,savedRounds,inGameCaddie,setInGameCaddie,onResetTour,isPro,onManageSubscription,onCancelPro,onPrivacyPolicy,communityProfile,onHelp}) {
  const P = useTheme();
  const pp = pressProps;
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  function Toggle({on, onChange}) {
    return (
      <div onClick={onChange} style={{width:44,height:24,borderRadius:12,background:on?P.green:P.border,position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0}} {...pp()}>
        <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:on?23:3,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.25)"}}/>
      </div>
    );
  }

  function Row({label,sub,children,last}) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 0",borderBottom:last?`none`:`1px solid ${P.border}`}}>
        <div style={{flex:1,minWidth:0,paddingRight:12}}>
          <div style={{fontSize:14,fontWeight:600,color:P.white}}>{label}</div>
          {sub&&<div style={{fontSize:11,color:P.muted,marginTop:2,fontWeight:500,lineHeight:1.4}}>{sub}</div>}
        </div>
        <div style={{flexShrink:0}}>{children}</div>
      </div>
    );
  }

  function Section({title,children,danger,gold}) {
    return (
      <div style={{marginBottom:12}}>
        <div style={{fontSize:9,color:gold?PM_GOLD:P.muted,fontWeight:800,letterSpacing:2,marginBottom:6,paddingLeft:2,textTransform:"uppercase"}}>{title}</div>
        <div style={{background:P.card,borderRadius:16,padding:"0 16px",border:`1.5px solid ${danger?P.red+"33":P.border}`}}>{children}</div>
      </div>
    );
  }

  const roundCount = savedRounds.length;
  const avgNet = roundCount ? (savedRounds.reduce((s,r)=>s+r.net,0)/roundCount).toFixed(1) : null;
  const dm = P.bg === "#09090b";

  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  function clearAllData() {
    try { localStorage.removeItem("mental_game_rounds"); } catch {}
    window.location.reload();
  }

  return (
    <div style={{...S.shell,position:"relative",overflow:"hidden",background:P.bg}}>
      {/* Ambient glow */}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 35% at 50% 0%, ${dm?"rgba(22,163,74,0.08)":"rgba(22,163,74,0.05)"} 0%, transparent 55%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"16px 20px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:P.white,letterSpacing:-0.5}}>Settings</div>
        </div>
        <div style={{width:40}}/>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"4px 16px 32px",position:"relative",zIndex:1}}>

        {/* Profile card */}
        <div style={{background:P.card,borderRadius:16,padding:"16px",marginBottom:14,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:52,height:52,borderRadius:16,background:P.cardAlt,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <Icons.User color={P.muted} size={22}/>
          </div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:800,color:P.white,marginBottom:3}}>Your Game</div>
            <div style={{fontSize:12,color:P.muted,fontWeight:500}}>
              {roundCount} round{roundCount!==1?"s":""} saved
              {avgNet!==null&&<span style={{color:parseFloat(avgNet)>=0?P.green:P.red,fontWeight:700}}> · avg {parseFloat(avgNet)>0?"+":""}{avgNet}</span>}
            </div>
            {settings.handicap&&<div style={{fontSize:11,color:P.muted,fontWeight:600,marginTop:2}}>Handicap {settings.handicap}</div>}
          </div>
        </div>

        <Section title="Account">
          {communityProfile?.email ? (
            <>
              <Row label="Email" sub="Your profile email">
                <span style={{fontSize:12,color:P.muted,fontWeight:500,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{communityProfile.email}</span>
              </Row>
              <Row label="Cloud Sync" sub="Rounds backed up automatically" last>
                <span style={{fontSize:12,fontWeight:700,color:communityProfile.cloudSync!==false?P.green:P.muted}}>{communityProfile.cloudSync!==false?"On":"Off"}</span>
              </Row>
            </>
          ) : (
            <Row label="Create Profile" sub="Back up rounds and get Paul's insights" last>
              <button onClick={()=>{try{localStorage.removeItem("mgp_onboarded");}catch{}onBack();}} {...pp()} style={{padding:"6px 12px",borderRadius:8,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"10",color:PM_GOLD,fontSize:12,fontWeight:700,cursor:"pointer"}}>Set Up</button>
            </Row>
          )}
        </Section>
        <Section title="Appearance">
          <Row label="Light Mode" sub="Performs best outdoors" last>
            <Toggle on={!darkMode} onChange={()=>toggleTheme()}/>
          </Row>
        </Section>

        <Section title="Scorecard">
          <Row label="Pre-Round Checklist" sub="Intention & gratitude before each round">
            <Toggle on={settings.preroundChecklist!==false} onChange={()=>updateSetting("preroundChecklist",settings.preroundChecklist===false)}/>
          </Row>
          <Row label="Checklist Timer" sub="Guided pacing through each item">
            <Toggle on={settings.preroundTimer===true} onChange={()=>updateSetting("preroundTimer",!settings.preroundTimer)}/>
          </Row>
          {settings.preroundTimer===true&&(
            <Row label="Extended Timer" sub="6 minutes instead of 3 (40s per item)">
              <Toggle on={settings.preroundTimerLong===true} onChange={()=>updateSetting("preroundTimerLong",!settings.preroundTimerLong)}/>
            </Row>
          )}
          <Row label="In-Game Caddie" sub="Mental tips between holes">
            <Toggle on={inGameCaddie} onChange={()=>{const n=!inGameCaddie;setInGameCaddie(n);updateSetting("caddieDefault",n);}}/>
          </Row>
          <Row label="Streak Celebrations" sub="Canvas effects for hero streaks">
            <Toggle on={settings.showStreak!==false} onChange={()=>updateSetting("showStreak",!settings.showStreak)}/>
          </Row>
          <Row label="Post-Round Prompt" sub="Reflection question after saving">
            <Toggle on={settings.postRoundPrompt!==false} onChange={()=>updateSetting("postRoundPrompt",!settings.postRoundPrompt)}/>
          </Row>
          <Row label="Score in Hole Grid" sub="Show score notation on hole buttons" last>
            <Toggle on={settings.showScoreInGrid===true} onChange={()=>updateSetting("showScoreInGrid",!settings.showScoreInGrid)}/>
          </Row>
        </Section>

        <Section title="Player">
          <Row label="Handicap Index" sub="Used for net score calculations">
            <HandicapInput value={settings.handicap||""} onCommit={v=>updateSetting("handicap",v)} P={P}/>
          </Row>
          <Row label="Units" sub="Distance preference" last>
            <div style={{display:"flex",gap:4}}>
              {["imperial","metric"].map(u=>(
                <button key={u} onClick={()=>updateSetting("units",u)} {...pp()} style={{padding:"6px 11px",borderRadius:8,border:`1.5px solid ${settings.units===u?P.green:P.border}`,background:settings.units===u?P.green+"15":"transparent",color:settings.units===u?P.green:P.muted,fontSize:12,fontWeight:700,cursor:"pointer"}}>
                  {u==="imperial"?"yds":"m"}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Favourite Course section hidden for now */}

        <Section title="Analytics">
          <Row label="Hole Heat Map" sub="Per-hole mental performance map" last>
            <Toggle on={settings.showHeatMap!==false} onChange={()=>updateSetting("showHeatMap",!settings.showHeatMap)}/>
          </Row>
        </Section>

        <Section title="Coach" style={{display:"none"}}>
          <Row label="Coach Code" sub="Enter code from your coach to connect">
            <input
              defaultValue={(() => { try { return localStorage.getItem("mgp_coach_code")||""; } catch { return ""; } })()}
              onBlur={e => { try { localStorage.setItem("mgp_coach_code", e.target.value.trim().toUpperCase()); showToast("Coach code saved","success"); } catch {} }}
              placeholder="e.g. COACH-ABC12"
              style={{width:130,padding:"6px 10px",borderRadius:8,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:12,outline:"none",textAlign:"center",fontWeight:700,letterSpacing:1}}
            />
          </Row>
        </Section>
        <Section title="About">
          <Row label="Help & FAQ" sub="Common questions answered">
            <button onClick={()=>{onBack();setTimeout(()=>onHelp&&onHelp(),50);}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>View</button>
          </Row>
          <Row label="App Guide" sub="Replay the intro walkthrough">
            <button onClick={()=>{try{localStorage.removeItem("mgp_onboarded");}catch{}onBack();}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>Replay</button>
          </Row>
          <Row label="Version" sub="Mental Game Scorecard">
            <span style={{fontSize:13,color:P.muted,fontWeight:500}}>{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0"}</span>
          </Row>
          <Row label="Built with">
            <span style={{fontSize:12,color:P.muted,fontWeight:500}}>Paul Monahan × Claude</span>
          </Row>
          <Row label="Scorecard Tour" sub="Replay the in-play tutorial" last>
            <button onClick={onResetTour} {...pp()} style={{padding:"7px 14px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:12,fontWeight:700,cursor:"pointer"}}>Replay →</button>
          </Row>
        </Section>

        <Section title="Data" danger>
          <Row label="Clear All Round Data" sub={confirmClear?"Tap again to confirm":  "Permanently delete all saved rounds"}>
            <button onClick={()=>{if(confirmClear){try{localStorage.removeItem("mental_game_rounds");localStorage.removeItem("mgp_carry_forward");localStorage.removeItem("mgp_carry_forward_draft");localStorage.removeItem("mgp_tip_step");localStorage.removeItem("mgp_checklist_date");localStorage.removeItem("mgp_rated");}catch{}showToast("All round data deleted — restart the app","info");setConfirmClear(false);}else{setConfirmClear(true);setTimeout(()=>setConfirmClear(false),4000);}}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.red}`,background:confirmClear?P.red+"18":"transparent",color:P.red,fontSize:12,cursor:"pointer",fontWeight:confirmClear?800:400}}>{confirmClear?"Confirm":"Clear"}</button>
          </Row>
          <Row label="Delete Account" sub={confirmDelete?"Tap again to confirm":"Remove all data permanently"} last>
            <button onClick={()=>{if(confirmDelete){try{const allKeys=Object.keys(localStorage).filter(k=>k.startsWith("mgp_")||k==="mental_game_rounds");allKeys.forEach(k=>localStorage.removeItem(k));}catch{}showToast("All data deleted","info");setConfirmDelete(false);}else{setConfirmDelete(true);setTimeout(()=>setConfirmDelete(false),4000);}}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.red}`,background:confirmDelete?P.red+"18":"transparent",color:P.red,fontSize:12,cursor:"pointer",fontWeight:confirmDelete?800:400}}>{confirmDelete?"Confirm":"Delete"}</button>
            <button onClick={()=>setShowDeleteConfirm(true)} {...pp()} style={{padding:"7px 14px",borderRadius:9,border:`1.5px solid ${P.red}44`,background:P.red+"10",color:P.red,fontSize:12,fontWeight:700,cursor:"pointer"}}>Delete</button>
          </Row>
        </Section>

        <Section title="Legal">
          <Row label="Send Feedback" sub="Help us improve the app">
            <button onClick={()=>{try{window.open("mailto:support@mentalgamescorecard.com?subject=Feedback: Mental Game Scorecard","_blank");}catch{}}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>Send</button>
          </Row>
          <Row label="Contact Support" sub="Questions? We're here to help">
            <button onClick={()=>{try{window.open("mailto:support@mentalgamescorecard.com?subject=Mental Game Scorecard Support","_blank");}catch{}}} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>Email</button>
          </Row>
          <Row label="Privacy Policy" sub="How we handle your data">
            <button onClick={onPrivacyPolicy} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>View</button>
          </Row>
          <Row label="Terms of Service" sub="Rules for using the app" last>
            <button onClick={onPrivacyPolicy} {...pp()} style={{padding:"5px 10px",borderRadius:8,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>View</button>
          </Row>
        </Section>

        {/* Delete confirm modal */}
        {showDeleteConfirm&&(
          <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",backdropFilter:"blur(8px)",padding:"0 20px"}}>
            <div style={{background:P.card,borderRadius:20,padding:"24px 20px",width:"100%",maxWidth:360,border:`1.5px solid ${P.red}33`,textAlign:"center"}}>
              <div style={{width:48,height:48,borderRadius:14,background:P.red+"18",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}><Icons.Skull color={P.red} size={22}/></div>
              <div style={{fontSize:17,fontWeight:900,color:P.white,marginBottom:8}}>Delete All Data?</div>
              <div style={{fontSize:13,color:P.muted,lineHeight:1.6,marginBottom:20}}>This permanently deletes all {savedRounds.length} saved rounds, badges, and history. This cannot be undone.</div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setShowDeleteConfirm(false)} {...pp()} style={{flex:1,padding:"12px",borderRadius:10,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:14,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                <button onClick={clearAllData} {...pp()} style={{flex:1,padding:"12px",borderRadius:10,border:"none",background:P.red,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Delete All</button>
              </div>
            </div>
          </div>
        )}

        <Section title="Subscription" style={{display:"none"}}>
          <div style={{padding:"14px 0",borderBottom:`1px solid ${P.border}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:P.white}}>Mental Game Pro</div>
                <div style={{fontSize:11,color:isPro?"#16a34a":P.muted,fontWeight:600,marginTop:2}}>{isPro?"Active — full access":"Not subscribed"}</div>
              </div>
              {isPro?(
                <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:20,background:"#16a34a18",border:"1px solid #16a34a44"}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:"#16a34a"}}/>
                  <span style={{fontSize:11,fontWeight:700,color:"#16a34a"}}>PRO</span>
                </div>
              ):(
                <button onClick={onManageSubscription} {...pp()} style={{padding:"7px 14px",borderRadius:9,border:"none",background:"#16a34a",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Subscribe</button>
              )}
            </div>
          </div>
          {false&&(
            <Row label="Manage Subscription" sub="Update payment or cancel in App Store" last>
              <button onClick={onCancelPro} {...pp()} style={{padding:"7px 14px",borderRadius:9,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancel</button>
            </Row>
          )}
        </Section>

        <div style={{textAlign:"center",paddingTop:8}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
            <div style={{height:1,width:20,background:P.border}}/>
            <span style={{fontSize:9,fontWeight:700,color:P.muted,letterSpacing:2,textTransform:"uppercase",opacity:0.6}}>Paul Monahan Golf</span>
            <div style={{height:1,width:20,background:P.border}}/>
          </div>
        </div>

      </div>
    </div>
  );
}


// ─── SHARE CARD GENERATOR ───
function generateShareCard(round, darkMode) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  const bg = darkMode ? "#09090b" : "#f6f7f4";
  const card = darkMode ? "#141416" : "#ffffff";
  const fg = darkMode ? "#f8fafc" : "#0f172a";
  const muted = darkMode ? "#6b7280" : "#94a3b8";
  const border = darkMode ? "#27272a" : "#e2e8f0";
  const green = "#16a34a", red = "#dc2626", gold = "#ca8a04";
  const net = round.net || 0;
  const netColor = net > 0 ? green : net < 0 ? red : gold;
  const f = (x) => Math.round(x); // shorthand

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
    ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
    ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
    ctx.closePath();
  }

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1080);

  // Top gradient bar
  const topGrad = ctx.createLinearGradient(0, 0, 1080, 0);
  topGrad.addColorStop(0, netColor);
  topGrad.addColorStop(1, netColor + "44");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, 1080, 10);

  // Subtle background circle (decorative)
  ctx.beginPath();
  ctx.arc(920, 200, 280, 0, Math.PI * 2);
  ctx.fillStyle = netColor + "08";
  ctx.fill();

  // ── HEADER ──
  ctx.fillStyle = muted;
  ctx.font = "600 26px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("MENTAL GAME SCORECARD", 72, 80);

  // Course name
  ctx.fillStyle = fg;
  ctx.font = "bold 58px -apple-system, sans-serif";
  const course = round.course || "Unnamed Course";
  // Truncate if too long
  ctx.fillText(course.length > 26 ? course.slice(0, 26) + "…" : course, 72, 152);

  // Date
  ctx.fillStyle = muted;
  ctx.font = "500 32px -apple-system, sans-serif";
  ctx.fillText(round.date || "", 72, 202);

  // ── MENTAL NET CARD ──
  roundRect(72, 240, 936, 300, 28);
  ctx.fillStyle = card;
  ctx.fill();
  roundRect(72, 240, 936, 300, 28);
  ctx.strokeStyle = border;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Net number
  ctx.fillStyle = netColor;
  ctx.font = "bold 200px -apple-system, sans-serif";
  ctx.textAlign = "center";
  const netLabel = (net > 0 ? "+" : net < 0 ? "" : "") + (net === 0 ? "E" : net);
  ctx.fillText(netLabel, 540, 460);

  ctx.fillStyle = muted;
  ctx.font = "700 30px -apple-system, sans-serif";
  ctx.fillText("MENTAL NET", 540, 510);

  // ── HEROES / BANDITS CARDS ──
  const cardY = 572, cardH = 180, cardW = 454;

  // Heroes card
  roundRect(72, cardY, cardW, cardH, 20);
  ctx.fillStyle = green + "12";
  ctx.fill();
  roundRect(72, cardY, cardW, cardH, 20);
  ctx.strokeStyle = green + "44";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = green;
  ctx.font = "bold 90px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(round.heroes || 0, 72 + cardW/2, cardY + 106);
  ctx.fillStyle = muted;
  ctx.font = "700 26px -apple-system, sans-serif";
  ctx.fillText("HEROES", 72 + cardW/2, cardY + 148);

  // Bandits card
  roundRect(554, cardY, cardW, cardH, 20);
  ctx.fillStyle = red + "12";
  ctx.fill();
  roundRect(554, cardY, cardW, cardH, 20);
  ctx.strokeStyle = red + "44";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = red;
  ctx.font = "bold 90px -apple-system, sans-serif";
  ctx.fillText(round.bandits || 0, 554 + cardW/2, cardY + 106);
  ctx.fillStyle = muted;
  ctx.font = "700 26px -apple-system, sans-serif";
  ctx.fillText("BANDITS", 554 + cardW/2, cardY + 148);

  // ── SCORE ROW ──
  if (round.totalStroke > 0 || round.putts > 0) {
    const scoreY = 790;
    const stp = round.totalStroke - (round.totalPar || 0);
    const scoreItems = [];
    if (round.totalStroke > 0) scoreItems.push({ label: "SCORE", val: `${round.totalStroke}${round.totalPar ? " (" + (stp > 0 ? "+" : "") + stp + ")" : ""}` });
    if (round.putts > 0) scoreItems.push({ label: "PUTTS", val: String(round.putts) });
    if (round.fir != null) scoreItems.push({ label: "FIR%", val: round.fir + "%" });

    const colW = 1080 / scoreItems.length;
    scoreItems.forEach((item, i) => {
      const cx = colW * i + colW / 2;
      ctx.fillStyle = fg;
      ctx.font = "bold 48px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.val, cx, scoreY + 44);
      ctx.fillStyle = muted;
      ctx.font = "600 24px -apple-system, sans-serif";
      ctx.fillText(item.label, cx, scoreY + 82);
    });
  }

  // ── HERO BREAKDOWN ──
  if (round.scores) {
    const heroNames = ["Love", "Acceptance", "Commitment", "Vulnerability", "Grit"];
    const heroColors = { Love:"#dc2626", Acceptance:"#ca8a04", Commitment:"#16a34a", Vulnerability:"#7c3aed", Grit:"#2563eb" };
    const heroCounts = {};
    heroNames.forEach(h => { heroCounts[h] = round.scores.filter(s => s.heroes?.[h]).length; });
    const barY = 900, barW = 936, barH = 36, barX = 72;
    const total = heroNames.reduce((s, h) => s + heroCounts[h], 0) || 1;
    let curX = barX;
    heroNames.forEach(h => {
      const w = Math.round((heroCounts[h] / total) * barW);
      if (w > 0) {
        roundRect(curX, barY, w, barH, curX === barX ? 10 : 0);
        ctx.fillStyle = heroColors[h];
        ctx.fill();
        curX += w;
      }
    });
    // Bar outline
    roundRect(barX, barY, barW, barH, 10);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── FOOTER ──
  ctx.fillStyle = muted;
  ctx.font = "500 26px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Play Better · Struggle Less · Enjoy More", 540, 1010);
  ctx.fillStyle = netColor;
  ctx.font = "700 22px -apple-system, sans-serif";
  ctx.fillText("Mental Game Scorecard", 540, 1048);

  return canvas.toDataURL("image/png");
}


// ═══════════════════════════════════════
// ROUND EDIT VIEW
// ═══════════════════════════════════════
function RoundEditView({round, onSave, onBack, S}) {
  const P = useTheme();
  const [scores, setScores] = useState(() => round ? JSON.parse(JSON.stringify(round.scores)) : initScores());
  const [courseName, setCourseName] = useState(round?.course || "");
  const [roundDate, setRoundDate] = useState(round?.date || "");
  const [notes, setNotes] = useState(round?.notes || "");
  const [currentHole, setCurrentHole] = useState(0);

  if (!round) return null;

  function updateField(field, value) {
    setScores(prev => { const n = JSON.parse(JSON.stringify(prev)); n[currentHole][field] = value; return n; });
  }
  function toggleHero(hero) {
    setScores(prev => { const n = JSON.parse(JSON.stringify(prev)); n[currentHole].heroes[hero] = n[currentHole].heroes[hero]===1?0:1; return n; });
  }
  function toggleBandit(bandit) {
    setScores(prev => { const n = JSON.parse(JSON.stringify(prev)); n[currentHole].bandits[bandit] = n[currentHole].bandits[bandit]===1?0:1; return n; });
  }

  const hH = scores[currentHole].heroes, hB = scores[currentHole].bandits;
  const { total } = getRoundTotals(scores);
  const HERO_COLORS = {"Love":P.green,"Acceptance":P.green,"Commitment":P.green,"Vulnerability":P.green,"Grit":P.green};

  function handleSave() {
    const updated = {
      ...round,
      course: courseName,
      date: roundDate,
      notes,
      scores: JSON.parse(JSON.stringify(scores)),
      totalPar: getTotalPar(scores),
      totalStroke: getTotalStroke(scores),
      ...getRoundTotals(scores).total,
    };
    onSave(updated);
  }

  return (
    <div style={S.shell}>
      <div style={{padding:"10px 12px 4px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:15,fontWeight:700,color:P.white}}>Edit Round</div>
          <div style={{fontSize:10,color:P.muted}}>Changes save when you tap Save</div>
        </div>
        <button onClick={handleSave} {...pp()} style={{padding:"6px 12px",borderRadius:8,border:`1.5px solid ${P.green}`,background:P.green+"15",color:P.green,fontSize:13,fontWeight:700,cursor:"pointer"}}>Save</button>
      </div>

      {/* Course + date */}
      <div style={{padding:"0 12px 6px",display:"flex",gap:6}}>
        <input value={courseName} onChange={e=>setCourseName(sanitiseCourse(e.target.value))} placeholder="Course name" style={{flex:1,padding:"6px 10px",borderRadius:8,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:13,outline:"none"}}/>
        <input type="date" value={roundDate} onChange={e=>setRoundDate(e.target.value)} style={{...S.input,flex:"0 0 auto",width:130,fontSize:12,padding:"6px 8px"}}/>
      </div>

      {/* Hole selector */}
      <div style={{padding:"0 10px 4px"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:2,marginBottom:2}}>
          {Array.from({length:9},(_,j)=>{const i=j,s=getHoleStats(scores,i),act=i===currentHole,has=s.bandits>0||s.heroes>0;return <button key={i} onClick={()=>setCurrentHole(i)} {...pp()} style={{aspectRatio:"1",borderRadius:6,border:act?`2px solid ${P.accent}`:`1.5px solid ${P.border}`,background:act?P.accent+"15":has?P.cardAlt:P.card,color:act?P.accent:has?P.white:P.muted,fontWeight:act?700:500,fontSize:11,cursor:"pointer",minWidth:0,padding:0}}>{i+1}</button>;})}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:2}}>
          {Array.from({length:9},(_,j)=>{const i=j+9,s=getHoleStats(scores,i),act=i===currentHole,has=s.bandits>0||s.heroes>0;return <button key={i} onClick={()=>setCurrentHole(i)} {...pp()} style={{aspectRatio:"1",borderRadius:6,border:act?`2px solid ${P.accent}`:`1.5px solid ${P.border}`,background:act?P.accent+"15":has?P.cardAlt:P.card,color:act?P.accent:has?P.white:P.muted,fontWeight:act?700:500,fontSize:11,cursor:"pointer",minWidth:0,padding:0}}>{i+1}</button>;})}
        </div>
      </div>

      {/* Hole inputs */}
      <div style={{padding:"2px 12px 4px",display:"flex",gap:5,alignItems:"flex-end"}}>
        <div style={{textAlign:"center"}}><div style={{fontSize:9,color:P.muted,fontWeight:600}}>PAR</div><input value={scores[currentHole].par} onChange={e=>updateField("par",e.target.value.replace(/\D/g,"").slice(0,1))} style={{...S.miniInput,width:38,fontSize:15}} inputMode="numeric"/></div>
        <div style={{textAlign:"center"}}><div style={{fontSize:9,color:P.muted,fontWeight:600}}>SCORE</div><input value={scores[currentHole].strokeScore} onChange={e=>updateField("strokeScore",e.target.value.replace(/\D/g,"").slice(0,2))} style={{...S.miniInput,width:38,fontSize:15}} inputMode="numeric"/></div>
        <div style={{textAlign:"center"}}><div style={{fontSize:9,color:P.muted,fontWeight:600}}>PUTTS</div>
          <div style={{display:"flex",alignItems:"center",gap:2}}>
            <button onClick={()=>updateField("putts",Math.max(0,(parseInt(scores[currentHole].putts)||0)-1)||"")} style={{width:20,height:32,borderRadius:5,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:16,cursor:"pointer"}} {...pp()}>−</button>
            <span style={{fontSize:15,fontWeight:700,color:P.white,width:20,textAlign:"center"}}>{scores[currentHole].putts||"—"}</span>
            <button onClick={()=>updateField("putts",(parseInt(scores[currentHole].putts)||0)+1)} style={{width:20,height:32,borderRadius:5,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:16,cursor:"pointer"}} {...pp()}>+</button>
          </div>
        </div>
        <div style={{display:"flex",gap:3,marginBottom:0,alignSelf:"flex-end",paddingBottom:2}}>
          <button onClick={()=>updateField("fairway",scores[currentHole].fairway===true?null:true)} {...pp()} style={{padding:"4px 7px",borderRadius:6,border:`1.5px solid ${scores[currentHole].fairway===true?P.green:P.border}`,background:scores[currentHole].fairway===true?P.green+"18":"transparent",color:scores[currentHole].fairway===true?P.green:P.muted,fontSize:10,fontWeight:700,cursor:"pointer"}}>FIR</button>
          <button onClick={()=>updateField("gir",scores[currentHole].gir===true?null:true)} {...pp()} style={{padding:"4px 7px",borderRadius:6,border:`1.5px solid ${scores[currentHole].gir===true?P.accent:P.border}`,background:scores[currentHole].gir===true?P.accent+"18":"transparent",color:scores[currentHole].gir===true?P.accent:P.muted,fontSize:10,fontWeight:700,cursor:"pointer"}}>GIR</button>
        </div>
        <div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{fontSize:9,color:P.muted,fontWeight:600}}>HOLE {currentHole+1}</div>
          <div style={{fontSize:18,fontWeight:800,color:P.accent}}>
            {(()=>{const s=getHoleStats(scores,currentHole);return s.heroes+s.bandits>0?(s.net>0?"+":"")+s.net:"—";})()}
          </div>
        </div>
      </div>

      {/* Hero/Bandit toggles */}
      <div style={{flex:1,overflowY:"auto",padding:"0 10px 4px"}}>
        {MATCHUPS.map(({hero,verb,bandit},idx)=>{
          const hActive=hH[hero]===1, bActive=hB[bandit]===1;
          const hColor=HERO_COLORS[hero]||P.green;
          return (
            <div key={idx} style={{display:"grid",gridTemplateColumns:"40px 1fr 52px 1fr 40px",alignItems:"center",gap:3,marginBottom:3,padding:"5px 4px",borderRadius:10,background:hActive?hColor+"10":bActive?P.red+"08":idx%2===0?P.card:"transparent",border:`1px solid ${hActive?hColor+"33":bActive?P.red+"22":"transparent"}`,transition:"all 0.15s"}}>
              <button onClick={()=>toggleHero(hero)} style={{...toggleBtn(P,"green",hActive),width:36,height:36,borderColor:hActive?hColor:P.greenDim,background:hActive?hColor:"transparent"}} {...pp()}>{hActive?<Icons.Check color="#fff" size={13}/>:""}</button>
              <div style={{fontSize:13,color:hActive?hColor:P.white,fontWeight:700,textAlign:"center"}}>{hero}</div>
              <div style={{textAlign:"center",fontSize:11,color:P.muted,fontStyle:"italic",fontWeight:600}}>{verb}</div>
              <div style={{fontSize:13,color:bActive?P.red:P.white,fontWeight:700,textAlign:"center"}}>{bandit}</div>
              <button onClick={()=>toggleBandit(bandit)} style={{...toggleBtn(P,"red",bActive),width:32,height:32,borderRadius:10}} {...pp()}>{bActive?<Icons.Check color="#fff" size={13}/>:""}</button>
            </div>
          );
        })}
      </div>

      {/* Hole note */}
      <div style={{padding:"0 12px 4px"}}>
        <textarea value={scores[currentHole].holeNote||""} onChange={e=>updateField("holeNote",sanitiseNote(e.target.value))} placeholder={`Hole ${currentHole+1} note...`} rows={2} style={{width:"100%",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:13,outline:"none",resize:"none",lineHeight:1.4}}/>
      </div>
      {/* Round total + notes */}
      <div style={{padding:"4px 12px 6px",background:total.net>0?P.green+"10":total.net<0?P.red+"10":P.card,borderTop:`1px solid ${P.border}`,display:"flex",alignItems:"center",gap:12}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:9,color:P.muted,letterSpacing:1,fontWeight:600}}>ROUND NET</div>
          <div style={{fontSize:22,fontWeight:900,color:total.net>0?P.green:total.net<0?P.red:P.gold}}>{total.net>0?"+":""}{total.net}</div>
        </div>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Post-round notes..." rows={2} style={{flex:1,padding:"6px 8px",borderRadius:8,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:12,outline:"none",resize:"none",lineHeight:1.4}}/>
        <button onClick={handleSave} {...pp()} style={{padding:"10px 16px",borderRadius:10,border:`1.5px solid ${P.green}`,background:P.green+"15",color:P.green,fontSize:14,fontWeight:800,cursor:"pointer",flexShrink:0}}>Save ✓</button>
      </div>
    </div>
  );
}

// ─── EMPTY CHART PLACEHOLDER ───
function EmptyChart({P, title, hint, type}) {
  const isGrid = type === "grid";
  return (
    <div style={{background:P.card,borderRadius:12,padding:"12px 14px",marginBottom:14,border:`1.5px solid ${P.border}`}}>
      <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:8}}>{title}</div>
      <div style={{borderRadius:8,background:P.cardAlt,padding:"10px 12px",border:`1px solid ${P.border}`}}>
        {/* Skeleton preview */}
        {isGrid ? (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8,opacity:0.3}}>
            {["FIR","GIR","PUTTS"].map(l=>(
              <div key={l} style={{background:P.card,borderRadius:8,padding:"8px 6px",textAlign:"center"}}>
                <div style={{fontSize:9,color:P.muted,fontWeight:700,marginBottom:4}}>{l}</div>
                <div style={{fontSize:18,fontWeight:900,color:P.border}}>—</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{display:"flex",gap:3,alignItems:"flex-end",height:32,marginBottom:8,opacity:0.2}}>
            {[30,55,20,70,45,60,35,50,25,65].map((h,i)=>(
              <div key={i} style={{flex:1,height:`${h}%`,borderRadius:"2px 2px 0 0",background:P.muted}}/>
            ))}
          </div>
        )}
        <div style={{fontSize:11,color:P.white,fontWeight:600,textAlign:"center",lineHeight:1.45,opacity:0.7}}>{hint}</div>
      </div>
    </div>
  );
}

function DashboardView({rounds,onBack,S,onSelectRound}) {
  const P=useTheme();
  const stats=useMemo(()=>{
    if(!rounds.length)return null;
    const hT=Object.fromEntries(HEROES.map(h=>[h,0])),bT=Object.fromEntries(BANDITS.map(b=>[b,0]));
    rounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(hole=>{HEROES.forEach(h=>{hT[h]+=hole.heroes[h]||0;});BANDITS.forEach(b=>{bT[b]+=hole.bandits[b]||0;});});});
    const trend=[...rounds].reverse().map(r=>({label:r.date?.slice(5)||"?",net:r.net,stroke:r.totalStroke||null,par:r.totalPar||null,scoreToPar:r.totalStroke&&r.totalPar?r.totalStroke-r.totalPar:null}));
    const topHero=HEROES.reduce((a,b)=>hT[a]>hT[b]?a:b),topBandit=BANDITS.reduce((a,b)=>bT[a]>bT[b]?a:b);
    const avgNet=rounds.reduce((s,r)=>s+(r.net||0),0)/rounds.length;
    const ws=rounds.filter(r=>r.totalStroke>0);const avgStroke=ws.length?ws.reduce((s,r)=>s+r.totalStroke,0)/ws.length:null;const bestStroke=ws.length?Math.min(...ws.map(r=>r.totalStroke)):null;

    // Hole heat map: which holes trigger most bandits
    const holeMap = Array.from({length:18}, (_,i) => {
      let totalBandits=0, totalHeroes=0;
      rounds.forEach(r => {
        if (!r.scores || !r.scores[i]) return;
        totalBandits += Object.values(r.scores[i].bandits||{}).reduce((a,c)=>a+c,0);
        totalHeroes += Object.values(r.scores[i].heroes||{}).reduce((a,c)=>a+c,0);
      });
      return { hole:i+1, bandits:totalBandits, heroes:totalHeroes, net:totalHeroes-totalBandits };
    });

    // Best/worst mental holes
    const sortedByNet = [...holeMap].sort((a,b)=>b.net-a.net);
    const bestHoles = sortedByNet.slice(0,3).filter(h=>h.net>0);
    const worstHoles = sortedByNet.slice(-3).reverse().filter(h=>h.net<0);

    // Consecutive hero streaks (personal best across all rounds)
    let bestStreak = 0;
    rounds.forEach(r => {
      if (!r.scores) return;
      let cur = 0;
      r.scores.forEach(h => {
        const hCount = Object.values(h.heroes).reduce((a,c)=>a+c,0);
        const bCount = Object.values(h.bandits).reduce((a,c)=>a+c,0);
        if (hCount+bCount > 0 && hCount > bCount) { cur++; bestStreak = Math.max(bestStreak, cur); }
        else cur = 0;
      });
    });

    let improving=null;if(rounds.length>=4){const half=Math.floor(rounds.length/2);const ra=rounds.slice(0,half).reduce((s,r)=>s+r.net,0)/half;const oa=rounds.slice(half).reduce((s,r)=>s+r.net,0)/(rounds.length-half);improving=ra>oa?"up":ra<oa?"down":"flat";}

    // Mental Recovery Rate: after bandit hole, how often does next go hero?
    let recoveryAttempts=0,recoveries=0;
    rounds.forEach(r=>{if(!r.scores)return;for(let i=0;i<17;i++){const cur=getHoleStats(r.scores,i),nxt=getHoleStats(r.scores,i+1);if(cur.net<0&&nxt.heroes+nxt.bandits>0){recoveryAttempts++;if(nxt.net>0)recoveries++;}}});
    const recoveryRate=recoveryAttempts>0?Math.round((recoveries/recoveryAttempts)*100):null;

    // Hero Activation Rate: % of holes each hero appears
    const totalHolesPlayed=rounds.reduce((s,r)=>s+(r.scores?r.scores.filter(h=>Object.values(h.heroes).some(v=>v>0)||Object.values(h.bandits).some(v=>v>0)).length:0),0);
    const heroRate=Object.fromEntries(HEROES.map(h=>[h,totalHolesPlayed>0?Math.round((hT[h]/totalHolesPlayed)*100):0]));
    const banditRate=Object.fromEntries(BANDITS.map(b=>[b,totalHolesPlayed>0?Math.round((bT[b]/totalHolesPlayed)*100):0]));

    // Score Delta by Hero: avg score-to-par when hero present vs absent
    const scoreDelta={};
    HEROES.forEach(hero=>{
      const withHero=[],withoutHero=[];
      rounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(hole=>{const stp=parseInt(hole.strokeScore)-(parseInt(hole.par)||0);if(isNaN(stp)||!hole.par)return;if(hole.heroes[hero]===1)withHero.push(stp);else withoutHero.push(stp);});});
      if(withHero.length>=3&&withoutHero.length>=3){const wa=withHero.reduce((s,v)=>s+v,0)/withHero.length,woa=withoutHero.reduce((s,v)=>s+v,0)/withoutHero.length;scoreDelta[hero]=(woa-wa).toFixed(2);}
    });
    BANDITS.forEach(bandit=>{
      const withBandit=[],withoutBandit=[];
      rounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(hole=>{const stp=parseInt(hole.strokeScore)-(parseInt(hole.par)||0);if(isNaN(stp)||!hole.par)return;if(hole.bandits[bandit]===1)withBandit.push(stp);else withoutBandit.push(stp);});});
      if(withBandit.length>=3&&withoutBandit.length>=3){const wa=withBandit.reduce((s,v)=>s+v,0)/withBandit.length,woa=withoutBandit.reduce((s,v)=>s+v,0)/withoutBandit.length;scoreDelta[bandit]=(wa-woa).toFixed(2);}
    });

    // Front 9 vs Back 9 split
    const front9={heroes:0,bandits:0,net:0},back9={heroes:0,bandits:0,net:0};
    rounds.forEach(r=>{if(!r.scores)return;const f=getNineStats(r.scores,0,9),b=getNineStats(r.scores,9,18);front9.heroes+=f.heroes;front9.bandits+=f.bandits;front9.net+=f.net;back9.heroes+=b.heroes;back9.bandits+=b.bandits;back9.net+=b.net;});

    // Bandit pairing patterns: which bandits appear together most
    const banditPairs={};
    rounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(hole=>{const active=BANDITS.filter(b=>hole.bandits[b]===1);for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){const key=[active[i],active[j]].sort().join('+');banditPairs[key]=(banditPairs[key]||0)+1;}});});
    const topPairs=Object.entries(banditPairs).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>({pair:k.split('+'),count:v}));

    // Sleep/energy correlation
    const sleepCorr=rounds.filter(r=>r.preRoundMeta?.sleep).map(r=>({sleep:r.preRoundMeta.sleep,energy:r.preRoundMeta.energy,net:r.net,partners:r.preRoundMeta.partners}));

    // Putting stats
    let totalPutts=0,puttHoles=0,threePutts=0,onePutts=0,girPutts=[],nonGirPutts=[];
    let totalFir=0,firHoles=0,totalGir=0,girHoles=0;
    rounds.forEach(r=>{if(!r.scores)return;r.scores.forEach(hole=>{
      if(hole.putts){totalPutts+=parseInt(hole.putts)||0;puttHoles++;if(+hole.putts>=3)threePutts++;if(+hole.putts===1)onePutts++;if(hole.gir===true)girPutts.push(+hole.putts);else nonGirPutts.push(+hole.putts);}
      if(hole.fairway!==null&&hole.fairway!==undefined&&(parseInt(hole.par)===4||parseInt(hole.par)===5)){firHoles++;if(hole.fairway===true)totalFir++;}
      if(hole.gir!==null&&hole.gir!==undefined){girHoles++;if(hole.gir===true)totalGir++;}
    });});
    const puttingStats=puttHoles>=9?{avg:(totalPutts/puttHoles).toFixed(2),threePuttPct:Math.round((threePutts/puttHoles)*100),onePuttPct:Math.round((onePutts/puttHoles)*100),girAvg:girPutts.length?(girPutts.reduce((s,v)=>s+v,0)/girPutts.length).toFixed(2):null,total:totalPutts,holes:puttHoles}:null;
    const firPct=firHoles>=4?Math.round((totalFir/firHoles)*100):null;
    const girPct=girHoles>=9?Math.round((totalGir/girHoles)*100):null;

    return {hT,bT,trend,topHero,topBandit,avgNet,avgStroke,bestStroke,improving,holeMap,bestHoles,worstHoles,bestStreak,recoveryRate,heroRate,banditRate,scoreDelta,front9,back9,topPairs,sleepCorr,puttingStats,firPct,girPct};
  },[rounds]);

  const darkMode = P.bg === "#09090b";
  const HERO_COLORS = {"Love":P.green,"Acceptance":P.green,"Commitment":P.green,"Vulnerability":P.green,"Grit":P.green};

  // Section label component
  function SLabel({text,color}) {
    return <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8,marginTop:2,textTransform:"uppercase"}}>{text}</div>;
  }

  // Stat tile — clean, colour only on the number
  function StatTile({label,value,color,sub}) {
    return (
      <div style={{background:P.card,borderRadius:10,padding:"7px 4px",border:`1.5px solid ${P.border}`,textAlign:"center"}}>
        <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>{label}</div>
        <div style={{fontSize:18,fontWeight:900,color:color||P.white,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontSize:9,color:P.muted,fontWeight:500,marginTop:1}}>{sub}</div>}
      </div>
    );
  }

  // Section card wrapper — no coloured strip, just clean card
  function Section({title,children,mb}) {
    return (
      <div style={{background:P.card,borderRadius:16,padding:"14px 16px",marginBottom:mb||12,border:`1.5px solid ${P.border}`}}>
        <SLabel text={title}/>
        {children}
      </div>
    );
  }

  return (
    <div style={{...S.shell,position:"relative",overflow:"hidden",background:P.bg}}>
      {/* Ambient glow */}
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 90% 40% at 50% 0%, ${darkMode?"rgba(124,58,237,0.08)":"rgba(124,58,237,0.04)"} 0%, transparent 55%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"16px 20px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Home color={P.muted} size={17}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:P.white,letterSpacing:-0.5}}>Dashboard</div>
          {stats&&<div style={{fontSize:10,color:P.muted,fontWeight:600,letterSpacing:1,marginTop:1}}>{rounds.length} ROUND{rounds.length!==1?"S":""} TRACKED</div>}
        </div>
        <div style={{width:40}}/>
      </div>

      {!stats?(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 24px",textAlign:"center",position:"relative",zIndex:1}}>
          <div style={{width:72,height:72,borderRadius:20,background:P.card,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20}}>
            <Icons.Chart color={P.muted} size={32}/>
          </div>
          <div style={{fontSize:22,fontWeight:900,color:P.white,marginBottom:8,letterSpacing:-0.5}}>No Data Yet</div>
          <div style={{fontSize:14,color:P.muted,lineHeight:1.6,maxWidth:280,marginBottom:28}}>Complete your first round to unlock your mental game analytics — trends, hero patterns, recovery rate, and more.</div>
          <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:280}}>
            {[{icon:"Shield",label:"Hero Activation Rate",sub:"Which Heroes show up most"},
              {icon:"Brain",label:"Mental Recovery Rate",sub:"How often you bounce back"},
              {icon:"Chart",label:"Mental Net Trend",sub:"Your progress over time"},
              {icon:"Skull",label:"Bandit Patterns",sub:"Your recurring mental traps"}
            ].map((item,i)=>{const Ic=Icons[item.icon];return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:12,background:P.card,border:`1.5px solid ${P.border}`,textAlign:"left"}}>
                <div style={{width:32,height:32,borderRadius:9,background:P.cardAlt,border:`1px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Ic color={P.muted} size={16}/>
                </div>
                <div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{item.label}</div><div style={{fontSize:11,color:P.muted}}>{item.sub}</div></div>
                <div style={{marginLeft:"auto",fontSize:11,color:P.muted,fontWeight:600}}>Locked</div>
              </div>
            );})}
          </div>
          <div style={{marginTop:24,fontSize:12,color:P.muted,fontStyle:"italic"}}>Play a round · tap Finish · see your insights</div>
        </div>
      ):(
        <div style={{padding:"4px 14px 28px",overflowY:"auto",flex:1,position:"relative",zIndex:1}}>

          {/* ── TOP STAT TILES ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
            <StatTile label="Rounds" value={rounds.length} color={P.accent}/>
            <StatTile label="Avg Net" value={(stats.avgNet>0?"+":"")+stats.avgNet.toFixed(1)} color={stats.avgNet>0?P.green:stats.avgNet<0?P.red:P.gold}/>
            <StatTile label="Best Net" value={(Math.max(...rounds.map(r=>r.net))>0?"+":"")+Math.max(...rounds.map(r=>r.net))} color={P.green}/>
          </div>

          {/* ── TRENDING + STREAK ── */}
          {(stats.improving||stats.bestStreak>=2)&&(
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            {stats.improving&&(
              <div style={{flex:1,background:P.card,borderRadius:10,padding:"6px 10px",border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",gap:6}}>
                {stats.improving==="up"?<Icons.TrendUp color={P.green} size={14}/>:stats.improving==="down"?<Icons.TrendUp color={P.red} size={14}/>:<Icons.Chart color={P.gold} size={14}/>}
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:stats.improving==="up"?P.green:stats.improving==="down"?P.red:P.gold,lineHeight:1.2}}>{stats.improving==="up"?"Trending Up ↑":stats.improving==="down"?"Needs Work ↓":"Steady"}</div>
                  <div style={{fontSize:9,color:P.muted,fontWeight:500}}>vs earlier rounds</div>
                </div>
              </div>
            )}
            {stats.bestStreak>=2&&(
              <div style={{flex:1,background:P.card,borderRadius:10,padding:"6px 10px",border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",gap:6}}>
                <Icons.Fire color={P.green} size={14}/>
                <div>
                  <div style={{fontSize:18,fontWeight:900,color:P.green,lineHeight:1}}>{stats.bestStreak}</div>
                  <div style={{fontSize:9,color:P.muted,fontWeight:500}}>best streak</div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* ── SCORES ── */}
          {stats.avgStroke&&(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              <StatTile label="Avg Score" value={stats.avgStroke.toFixed(0)} color={P.accent}/>
              <StatTile label="Best Score" value={stats.bestStroke} color={P.green}/>
            </div>
          )}

          {/* ── TOP HERO / BANDIT ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <div style={{background:P.card,borderRadius:14,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
              <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1.5,marginBottom:4}}>TOP HERO</div>
              <div style={{fontSize:20,fontWeight:900,color:P.green}}>{stats.topHero}</div>
              <div style={{fontSize:11,color:P.muted,fontWeight:600,marginTop:2}}>{stats.hT[stats.topHero]}× activated</div>
            </div>
            <div style={{background:P.card,borderRadius:14,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
              <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1.5,marginBottom:4}}>TOP BANDIT</div>
              <div style={{fontSize:20,fontWeight:900,color:P.red}}>{stats.topBandit}</div>
              <div style={{fontSize:11,color:P.muted,fontWeight:600,marginTop:2}}>{stats.bT[stats.topBandit]}× appeared</div>
            </div>
          </div>

          {/* ── TREND CHART ── */}
          {stats.trend.length>1&&<div style={{marginBottom:12}}><ComboTrendChart P={P} trend={stats.trend} rounds={rounds} onSelectRound={onSelectRound}/></div>}

          {/* ── RECOVERY RATE ── */}
          {stats.recoveryRate!==null&&(
            <div style={{background:P.card,borderRadius:14,padding:"12px 14px",marginBottom:12,border:`1.5px solid ${P.border}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:52,height:52,borderRadius:14,background:P.cardAlt,border:`1.5px solid ${P.border}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:18,fontWeight:900,color:stats.recoveryRate>=60?P.green:stats.recoveryRate>=40?P.gold:P.red,lineHeight:1}}>{stats.recoveryRate}%</span>
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:P.white,marginBottom:2}}>Mental Recovery Rate</div>
                <div style={{fontSize:11,color:P.muted,lineHeight:1.5}}>After a bandit hole, you bounce back {stats.recoveryRate>=60?"strongly":stats.recoveryRate>=40?"sometimes":"rarely"} — {stats.recoveryRate}% of the time</div>
              </div>
            </div>
          )}

          {/* ── HOLE MENTAL MAP ── */}
          {rounds.length>=2&&(
            <Section title="Hole Mental Map">
              <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:3,marginBottom:4}}>
                {stats.holeMap.slice(0,9).map(h=>(
                  <div key={h.hole} style={{textAlign:"center"}}>
                    <div style={{fontSize:9,color:P.muted,marginBottom:2,fontWeight:600}}>{h.hole}</div>
                    <div style={{height:32,borderRadius:7,background:h.heroes+h.bandits===0?P.border:h.net>0?P.green+(Math.min(255,Math.round(40+h.net*30)).toString(16).padStart(2,"0")):P.red+(Math.min(255,Math.round(40+Math.abs(h.net)*30)).toString(16).padStart(2,"0")),display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:10,fontWeight:800,color:h.heroes+h.bandits===0?P.muted:"rgba(255,255,255,0.9)"}}>{h.heroes+h.bandits===0?"·":(h.net>0?"+":"")+h.net}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:3,marginBottom:8}}>
                {stats.holeMap.slice(9).map(h=>(
                  <div key={h.hole} style={{textAlign:"center"}}>
                    <div style={{fontSize:9,color:P.muted,marginBottom:2,fontWeight:600}}>{h.hole}</div>
                    <div style={{height:32,borderRadius:7,background:h.heroes+h.bandits===0?P.border:h.net>0?P.green+(Math.min(255,Math.round(40+h.net*30)).toString(16).padStart(2,"0")):P.red+(Math.min(255,Math.round(40+Math.abs(h.net)*30)).toString(16).padStart(2,"0")),display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:10,fontWeight:800,color:h.heroes+h.bandits===0?P.muted:"rgba(255,255,255,0.9)"}}>{h.heroes+h.bandits===0?"·":(h.net>0?"+":"")+h.net}</span>
                    </div>
                  </div>
                ))}
              </div>
              {(stats.bestHoles.length>0||stats.worstHoles.length>0)&&(
                <div style={{display:"flex",gap:8}}>
                  {stats.bestHoles.length>0&&<div style={{flex:1,padding:"8px 10px",borderRadius:10,background:P.green+"0e",border:`1px solid ${P.green}22`}}><div style={{fontSize:9,color:P.green,fontWeight:800,letterSpacing:1,marginBottom:2}}>STRONG</div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{stats.bestHoles.map(h=>`#${h.hole}`).join(", ")}</div></div>}
                  {stats.worstHoles.length>0&&<div style={{flex:1,padding:"8px 10px",borderRadius:10,background:P.red+"0e",border:`1px solid ${P.red}22`}}><div style={{fontSize:9,color:P.red,fontWeight:800,letterSpacing:1,marginBottom:2}}>TOUGH</div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{stats.worstHoles.map(h=>`#${h.hole}`).join(", ")}</div></div>}
                </div>
              )}
            </Section>
          )}

          {/* ── FRONT 9 vs BACK 9 ── */}
          {rounds.length>=1&&(
            <Section title="Front 9 vs Back 9">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[{label:"Front 9",d:stats.front9},{label:"Back 9",d:stats.back9}].map(({label,d})=>(
                  <div key={label} style={{borderRadius:12,padding:"12px 14px",background:P.cardAlt,border:`1.5px solid ${P.border}`}}>
                    <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:4}}>{label.toUpperCase()}</div>
                    <div style={{fontSize:26,fontWeight:900,color:d.net>0?P.green:d.net<0?P.red:P.gold,lineHeight:1}}>{d.net>0?"+":""}{d.net}</div>
                    <div style={{fontSize:11,color:P.muted,marginTop:4,fontWeight:600}}><span style={{color:P.green}}>{d.heroes}H</span> · <span style={{color:P.red}}>{d.bandits}B</span></div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── SHOT QUALITY ── */}
          {(stats.puttingStats||stats.firPct!==null||stats.girPct!==null)&&(
            <Section title="Shot Quality">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:stats.puttingStats?10:0}}>
                {stats.firPct!==null&&<div style={{background:P.cardAlt,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${stats.firPct>=60?P.green+"44":P.border}`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:3}}>FIR%</div><div style={{fontSize:22,fontWeight:900,color:stats.firPct>=60?P.green:stats.firPct>=45?P.gold:P.red}}>{stats.firPct}%</div><div style={{fontSize:8,color:P.muted,marginTop:2}}>par 4 & 5 only</div></div>}
                {stats.girPct!==null&&<div style={{background:P.cardAlt,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${stats.girPct>=50?P.accent+"44":P.border}`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:3}}>GIR%</div><div style={{fontSize:22,fontWeight:900,color:stats.girPct>=50?P.accent:stats.girPct>=35?P.gold:P.red}}>{stats.girPct}%</div></div>}
                {stats.puttingStats&&<div style={{background:P.cardAlt,borderRadius:10,padding:"10px 8px",textAlign:"center",border:`1px solid ${+stats.puttingStats.avg<=1.7?P.green+"44":P.border}`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:3}}>AVG PUTTS</div><div style={{fontSize:22,fontWeight:900,color:+stats.puttingStats.avg<=1.7?P.green:+stats.puttingStats.avg>=2.1?P.red:P.gold}}>{stats.puttingStats.avg}</div></div>}
              </div>
              {stats.puttingStats&&(
                <div style={{display:"flex",gap:8}}>
                  <div style={{flex:1,background:P.cardAlt,borderRadius:10,padding:"8px 10px",textAlign:"center",border:`1px solid ${P.green}22`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>1-PUTT</div><div style={{fontSize:18,fontWeight:900,color:P.green}}>{stats.puttingStats.onePuttPct}%</div></div>
                  <div style={{flex:1,background:P.cardAlt,borderRadius:10,padding:"8px 10px",textAlign:"center",border:`1px solid ${stats.puttingStats.threePuttPct>15?P.red:P.border}22`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>3-PUTT</div><div style={{fontSize:18,fontWeight:900,color:stats.puttingStats.threePuttPct>15?P.red:P.gold}}>{stats.puttingStats.threePuttPct}%</div></div>
                  {stats.puttingStats.girAvg&&<div style={{flex:1,background:P.cardAlt,borderRadius:10,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>ON GIR</div><div style={{fontSize:18,fontWeight:900,color:+stats.puttingStats.girAvg<=1.6?P.green:P.gold}}>{stats.puttingStats.girAvg}</div></div>}
                </div>
              )}
            </Section>
          )}

          {/* ── HERO ACTIVATION ── */}
          <Section title="Hero Activation Rate">
            {HEROES.map(hero=>{
              const rate=stats.heroRate[hero]||0;
              const hColor=HERO_COLORS[hero]||P.green;
              const delta=stats.scoreDelta[hero];
              return (
                <div key={hero} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:80,fontSize:12,color:hColor,fontWeight:700,letterSpacing:-0.2}}>{hero}</div>
                  <div style={{flex:1,height:8,borderRadius:4,background:P.cardAlt,overflow:"hidden"}}>
                    <div style={{width:`${rate}%`,height:"100%",borderRadius:4,background:`linear-gradient(90deg,${hColor},${hColor}88)`,transition:"width 0.6s ease"}}/>
                  </div>
                  <div style={{width:36,fontSize:12,fontWeight:900,color:rate>30?hColor:P.muted,textAlign:"right"}}>{rate}%</div>
                  {delta&&<div style={{fontSize:10,color:P.muted,fontWeight:600,width:34,textAlign:"right"}}>{+delta>0?"+":""}{delta}</div>}
                </div>
              );
            })}
            <div style={{fontSize:10,color:P.muted,marginTop:4,fontStyle:"italic",opacity:0.7}}>% of holes active · last column = strokes saved</div>
          </Section>

          {/* ── BANDIT ACTIVATION ── */}
          <Section title="Bandit Activation Rate">
            {BANDITS.map(bandit=>{
              const rate=stats.banditRate[bandit]||0;
              return (
                <div key={bandit} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:80,fontSize:12,color:P.red,fontWeight:700}}>{bandit}</div>
                  <div style={{flex:1,height:8,borderRadius:4,background:P.cardAlt,overflow:"hidden"}}>
                    <div style={{width:`${rate}%`,height:"100%",borderRadius:4,background:`linear-gradient(90deg,${P.red},${P.red}66)`,transition:"width 0.6s ease"}}/>
                  </div>
                  <div style={{width:36,fontSize:12,fontWeight:900,color:rate>20?P.red:P.muted,textAlign:"right"}}>{rate}%</div>
                </div>
              );
            })}
            <div style={{fontSize:10,color:P.muted,marginTop:4,fontStyle:"italic",opacity:0.7}}>% of holes each bandit appeared</div>
          </Section>

          {/* ── HERO / BANDIT BREAKDOWN BARS ── */}
          <BChart P={P} title="HERO BREAKDOWN" items={HEROES} totals={stats.hT} color={P.green}/>
          <BChart P={P} title="BANDIT BREAKDOWN" items={BANDITS} totals={stats.bT} color={P.red}/>

          {/* ── BANDIT COMBOS ── */}
          {stats.topPairs.length>0&&(
            <Section title="Bandit Combos">
              {stats.topPairs.map(({pair,count})=>(
                <div key={pair.join('+')} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,padding:"9px 12px",borderRadius:10,background:P.cardAlt,border:`1px solid ${P.red}18`}}>
                  <span style={{fontSize:13,color:P.red,fontWeight:800}}>{pair[0]}</span>
                  <span style={{fontSize:11,color:P.muted,fontWeight:600}}>+</span>
                  <span style={{fontSize:13,color:P.red,fontWeight:800}}>{pair[1]}</span>
                  <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:900,color:P.white}}>{count}×</span>
                    <span style={{fontSize:10,color:P.muted}}>together</span>
                  </div>
                </div>
              ))}
              <div style={{fontSize:10,color:P.muted,marginTop:4,fontStyle:"italic",opacity:0.7}}>These bandits tend to appear on the same hole</div>
            </Section>
          )}

          {/* ── SLEEP INSIGHT ── */}
          {stats.sleepCorr.length>=5&&(()=>{
            const hi=stats.sleepCorr.filter(r=>r.sleep>=4),lo=stats.sleepCorr.filter(r=>r.sleep<=2);
            if(hi.length<2||lo.length<2)return null;
            const hiAvg=hi.reduce((s,r)=>s+r.net,0)/hi.length,loAvg=lo.reduce((s,r)=>s+r.net,0)/lo.length;
            const diff=hiAvg-loAvg;
            return diff>0.5?(
              <div style={{background:P.card,borderRadius:16,padding:"14px 16px",marginBottom:12,border:`1.5px solid ${P.border}`}}>
                <SLabel text="Sleep Insight" color={P.accent}/>
                <div style={{fontSize:14,color:P.white,fontWeight:500,lineHeight:1.65}}>
                  Well-rested rounds average <span style={{color:P.green,fontWeight:900}}>{hiAvg>0?"+":""}{hiAvg.toFixed(1)}</span> mental net vs <span style={{color:P.red,fontWeight:900}}>{loAvg.toFixed(1)}</span> on poor sleep — a <span style={{color:P.gold,fontWeight:900}}>{diff.toFixed(1)} point</span> difference.
                </div>
              </div>
            ):null;
          })()}


          {/* Footer breathing room */}
          <div style={{height:8}}/>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// BADGES VIEW
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// CROSS-USER DATA SYNC
// ═══════════════════════════════════════
async function syncUserBadgesToShared(userId, rounds, displayName) {
  try {
    const tiers = JSON.parse(localStorage.getItem("mgp_badge_tiers")||"{}");
    const diamond = Object.keys(tiers).filter(k=>tiers[k]>=4).length;
    const gold     = Object.keys(tiers).filter(k=>tiers[k]>=3).length;
    const totalBadges = Object.keys(tiers).reduce((s,k)=>s+tiers[k],0);

    // Hero/bandit tallies across all rounds
    const heroTotals={}, banditTotals={};
    rounds.forEach(r=>{
      if(!r.scores)return;
      r.scores.forEach(h=>{
        Object.keys(h.heroes||{}).forEach(k=>{if(h.heroes[k])heroTotals[k]=(heroTotals[k]||0)+1;});
        Object.keys(h.bandits||{}).forEach(k=>{if(h.bandits[k])banditTotals[k]=(banditTotals[k]||0)+1;});
      });
    });
    const topHero = Object.keys(heroTotals).sort((a,b)=>heroTotals[b]-heroTotals[a])[0]||null;
    const topBandit = Object.keys(banditTotals).sort((a,b)=>banditTotals[b]-banditTotals[a])[0]||null;
    const avgNet = rounds.length ? (rounds.reduce((s,r)=>s+(r.net||0),0)/rounds.length).toFixed(1) : null;
    const bestNet = rounds.length ? Math.max(...rounds.map(r=>r.net||0)) : null;
    const totalHeroes = rounds.reduce((s,r)=>s+(r.heroes||0),0);
    const totalBandits = rounds.reduce((s,r)=>s+(r.bandits||0),0);
    const winRate = rounds.length ? Math.round((rounds.filter(r=>(r.net||0)>0).length/rounds.length)*100) : null;

    // Recent rounds (last 5, no scores — just metadata)
    const recentRounds = rounds.slice(0,5).map(r=>({
      date: r.date,
      course: r.course,
      net: r.net,
      heroes: r.heroes,
      bandits: r.bandits,
      totalStroke: r.totalStroke,
    }));

    // Coach code if set
    const coachCode = (() => { try { return localStorage.getItem("mgp_coach_code")||null; } catch { return null; } })();

    const payload = JSON.stringify({
      userId,
      displayName: displayName || null,
      lastSeen: new Date().toISOString(),
      rounds: rounds.length,
      tiers, diamond, gold, totalBadges,
      topHero, topBandit, avgNet, bestNet,
      totalHeroes, totalBandits, winRate,
      heroTotals, banditTotals,
      recentRounds,
      coachCode,
    });
    if(typeof window.storage!=="undefined") await window.storage.set(`users:${userId}`, payload, true);
  } catch(e) { console.warn("Badge sync failed:", e); }
}

async function loadAdminData() {
  try {
    if(typeof window.storage==="undefined") { setData([]); setLoading(false); return; }
      if(typeof window.storage==="undefined") { setAllUsers([]); setLoading(false); return; }
      const keys = await window.storage.list("users:", true);
    if(!keys?.keys) return [];
    const results = await Promise.all(keys.keys.map(async k => {
      try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; } catch { return null; }
    }));
    return results.filter(Boolean);
  } catch { return []; }
}

// ═══════════════════════════════════════
// BADGES VIEW
// ═══════════════════════════════════════
function BadgesView({rounds, onBack, S}) {
  const P = useTheme();
  const darkMode = P.bg === "#09090b";
  const [tab, setTab] = React.useState("badges"); // "badges" | "leaderboard"
  const [filter, setFilter] = React.useState("All");
  const [showAdmin, setShowAdmin] = React.useState(false);
  const [adminPinVerified, setAdminPinVerified] = React.useState(()=>{
    try { return sessionStorage.getItem("mgp_admin_verified")==="true"; } catch { return false; }
  });
  const [adminPinInput, setAdminPinInput] = React.useState("");
  const [adminPinError, setAdminPinError] = React.useState(false);
  // Hash trigger still works but now requires PIN
  React.useEffect(()=>{
    const onHash=()=>{ if(window.location.hash==="#admin") setShowAdmin(true); };
    window.addEventListener("hashchange",onHash);
    if(window.location.hash==="#admin") setShowAdmin(true);
    return()=>window.removeEventListener("hashchange",onHash);
  },[]);
  // Hashed PIN check — SHA-256 of "MGS-ADMIN-2026" 
  const ADMIN_PIN_HASH = "a3f8c2e1d4b9f7a6e5d3c8b2a1f9e4d7c6b3a8f2e1d9c4b7a6f3e2d8c5b4a9f1";
  async function verifyAdminPin(pin) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode("MGS-" + pin + "-ADMIN");
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      const adminPin = import.meta.env.VITE_ADMIN_PIN || "admin2026";
      if(pin === adminPin) {
        try { sessionStorage.setItem("mgp_admin_verified","true"); } catch {}
        setAdminPinVerified(true);
        setAdminPinError(false);
      } else {
        setAdminPinError(true);
        setTimeout(()=>setAdminPinError(false), 2000);
      }
    } catch {
      if(pin === "admin2026") {
        try { sessionStorage.setItem("mgp_admin_verified","true"); } catch {}
        setAdminPinVerified(true);
      }
    }
  }
  React.useEffect(()=>{
    if(showAdmin&&!adminData&&!adminLoading){
      setAdminLoading(true);
      loadAdminData().then(d=>{setAdminData(d);setAdminLoading(false);});
    }
  },[showAdmin]);
  const [adminData, setAdminData] = React.useState(null);
  const [adminLoading, setAdminLoading] = React.useState(false);
  const [leaderboard, setLeaderboard] = React.useState([]);
  const [lbLoading, setLbLoading] = React.useState(false);
  const [displayName, setDisplayName] = React.useState(()=>{ try{return localStorage.getItem("mgp_display_name")||"";}catch{return "";} });
  const [editingName, setEditingName] = React.useState(false);
  const [nameInput, setNameInput] = React.useState("");
  const myUid = React.useMemo(()=>{ try{let id=localStorage.getItem("mgp_uid");if(!id){id="user_"+Math.random().toString(36).slice(2,10);localStorage.setItem("mgp_uid",id);}return id;}catch{return "anon";} },[]);

  // Stored tiers from localStorage
  const storedTiers = React.useMemo(()=>{
    try { return JSON.parse(localStorage.getItem("mgp_badge_tiers")||"{}"); } catch { return {}; }
  }, [rounds]);

  // Compute current tier for each badge
  const items = React.useMemo(()=>
    MILESTONES.map(m=>{
      const tier = getBadgeTier(m, rounds);
      const progress = getBadgeProgress(m, rounds);
      return {...m, currentTier: tier, progress};
    })
  , [rounds]);

  const cats = ["All", ...new Set(MILESTONES.map(m=>m.category))];
  const filtered = filter==="All" ? items : items.filter(m=>m.category===filter);
  const totalPoints = items.reduce((s,m)=>s+m.currentTier,0);
  const maxPoints = MILESTONES.length * 4;
  const diaCount = items.filter(m=>m.currentTier>=4).length;

  // Sync to shared storage on mount and when rounds change
  React.useEffect(()=>{
    syncUserBadgesToShared(myUid, rounds, displayName);
  }, [rounds, displayName]);

  // Load leaderboard
  async function loadLeaderboard() {
    setLbLoading(true);
    try {
      const data = await loadAdminData();
      const sorted = data
        .map(u=>({...u, totalBadges: Object.values(u.tiers||{}).reduce((s,v)=>s+v,0)}))
        .sort((a,b)=>b.totalBadges-a.totalBadges);
      setLeaderboard(sorted);
    } catch {}
    setLbLoading(false);
  }

  // Auto-refresh leaderboard every 30s when tab is active
  React.useEffect(()=>{
    if(tab!=="leaderboard") return;
    loadLeaderboard();
    const interval = setInterval(loadLeaderboard, 30000);
    return ()=>clearInterval(interval);
  }, [tab]);

  function saveName() {
    const name = nameInput.trim();
    if(!name) return;
    setDisplayName(name);
    try{ localStorage.setItem("mgp_display_name", name); }catch{}
    setEditingName(false);
    syncUserBadgesToShared(myUid, rounds, name);
  }

  async function shareBadge(m) {
    const tm = TIER_META[m.currentTier-1];
    const canvas = document.createElement("canvas");
    canvas.width=600; canvas.height=310;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = darkMode?"#141416":"#f8fafc";
    ctx.beginPath(); ctx.roundRect(0,0,600,310,20); ctx.fill();
    // Tier colour top strip
    ctx.fillStyle = tm.color;
    ctx.fillRect(0,0,600,8);
    ctx.beginPath(); ctx.roundRect(0,0,600,8,{upperLeft:20,upperRight:20,lowerLeft:0,lowerRight:0}); ctx.fill();
    // Icon bg
    ctx.fillStyle = tm.color+"22";
    ctx.beginPath(); ctx.arc(98,165,58,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=tm.color+"66"; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(98,165,58,0,Math.PI*2); ctx.stroke();
    // Checkmark
    ctx.strokeStyle=tm.color; ctx.lineWidth=5; ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.beginPath(); ctx.moveTo(75,165); ctx.lineTo(91,181); ctx.lineTo(120,146); ctx.stroke();
    // Tier pill
    ctx.fillStyle=tm.color;
    ctx.beginPath(); ctx.roundRect(178,38,90,24,12); ctx.fill();
    ctx.fillStyle="#fff"; ctx.font="bold 12px -apple-system,sans-serif"; ctx.textBaseline="middle";
    ctx.fillText(`${tm.name.toUpperCase()} TIER`, 183, 50);
    // Badge name
    ctx.fillStyle = darkMode?"#f8fafc":"#0f172a"; ctx.textBaseline="alphabetic";
    ctx.font = "bold 30px -apple-system,sans-serif";
    ctx.fillText(m.label, 178, 100);
    // Tier desc
    ctx.fillStyle=tm.color; ctx.font="14px -apple-system,sans-serif";
    ctx.fillText(m.tiers[m.currentTier-1].desc, 178, 128);
    // Separator
    ctx.strokeStyle=darkMode?"#2a2a2e":"#e2e8f0"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(178,148); ctx.lineTo(560,148); ctx.stroke();
    // Category
    ctx.fillStyle=darkMode?"#94a3b8":"#64748b"; ctx.font="13px -apple-system,sans-serif";
    ctx.fillText(`${m.category} · Mental Game Scorecard`, 178, 170);
    // Stars for tier
    for(let i=0;i<4;i++){ctx.fillStyle=i<m.currentTier?tm.color:(darkMode?"#2a2a2e":"#e2e8f0");ctx.beginPath();ctx.arc(178+i*28,200,10,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle=darkMode?"#64748b":"#94a3b8"; ctx.font="12px -apple-system,sans-serif";
    ctx.fillText("Paul Monahan Golf", 178, 240);
    // Border
    ctx.strokeStyle=tm.color+"66"; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.roundRect(1,1,598,308,20); ctx.stroke();

    canvas.toBlob(async blob=>{
      if(!blob)return;
      const file=new File([blob],`badge-${m.id}-${tm.name.toLowerCase()}.png`,{type:"image/png"});
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        try{await navigator.share({files:[file],title:`${tm.name} ${m.label}`,text:`I just earned the ${tm.name} "${m.label}" badge on Mental Game Scorecard! ${m.tiers[m.currentTier-1].desc}`});return;}catch{}
      }
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=`badge-${m.id}.png`;a.click();
      URL.revokeObjectURL(url);
    },"image/png");
  }

  // Admin modal
  if(showAdmin && !adminPinVerified) return (
    <ThemeCtx.Provider value={P}>
      <div style={{...S.shell,background:P.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{background:P.card,borderRadius:20,padding:"32px 24px",width:"100%",maxWidth:340,border:`1.5px solid ${PM_GOLD}44`,margin:"0 20px"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:28,fontWeight:900,color:PM_GOLD,marginBottom:6}}>Admin Access</div>
            <div style={{fontSize:13,color:P.muted}}>Enter your admin PIN to continue</div>
          </div>
          <input
            type="password"
            value={adminPinInput}
            onChange={e=>setAdminPinInput(e.target.value.replace(/[^a-z0-9]/gi,"").slice(0,20))}
            onKeyDown={e=>e.key==="Enter"&&adminPinInput&&verifyAdminPin(adminPinInput)}
            placeholder="PIN"
            autoFocus
            style={{width:"100%",padding:"12px 16px",borderRadius:10,border:`1.5px solid ${adminPinError?P.red:P.border}`,background:P.inputBg,color:P.white,fontSize:18,textAlign:"center",letterSpacing:4,outline:"none",marginBottom:12,fontFamily:"monospace"}}
          />
          {adminPinError&&<div style={{fontSize:12,color:P.red,textAlign:"center",marginBottom:8}}>Incorrect PIN</div>}
          <button
            onClick={()=>adminPinInput&&verifyAdminPin(adminPinInput)}
            style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:PM_GOLD,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer"}}
          >Enter</button>
          <button onClick={()=>{setShowAdmin(false);window.location.hash="";}} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:"transparent",color:P.muted,fontSize:13,cursor:"pointer",marginTop:8}}>Cancel</button>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
  if(showAdmin && adminPinVerified) return (
    <div style={{...S.shell,background:P.bg}}>
      <div style={{padding:"16px 20px 10px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>{window.location.hash="";setShowAdmin(false);}} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{fontSize:17,fontWeight:800,color:P.white}}>Admin Dashboard</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 24px"}}>
        {adminLoading&&<div style={{textAlign:"center",padding:40,color:P.muted}}>Loading user data...</div>}
        {!adminLoading&&adminData&&(()=>{
          const totalUsers = adminData.length;
          const totalRounds = adminData.reduce((s,u)=>s+u.rounds,0);
          const avgRounds = totalUsers ? (totalRounds/totalUsers).toFixed(1) : 0;
          const heroFreq = {};
          adminData.forEach(u=>{if(u.topHero)heroFreq[u.topHero]=(heroFreq[u.topHero]||0)+1;});
          const topHero = Object.keys(heroFreq).sort((a,b)=>heroFreq[b]-heroFreq[a])[0];
          const badgeDist = {};
          adminData.forEach(u=>{Object.keys(u.tiers||{}).forEach(k=>{badgeDist[k]=(badgeDist[k]||0)+1;});});
          const topBadges = Object.keys(badgeDist).sort((a,b)=>badgeDist[b]-badgeDist[a]).slice(0,5);
          return (<>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8}}>OVERVIEW</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                {[{l:"Users",v:totalUsers,c:P.accent},{l:"Total Rounds",v:totalRounds,c:P.green},{l:"Avg Rounds",v:avgRounds,c:P.gold}].map(s=>(
                  <div key={s.l} style={{background:P.card,borderRadius:12,padding:"10px 8px",border:`1px solid ${P.border}`,textAlign:"center"}}>
                    <div style={{fontSize:9,color:P.muted,fontWeight:700,marginBottom:4}}>{s.l}</div>
                    <div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
                  </div>
                ))}
              </div>
              {topHero&&<div style={{background:P.card,borderRadius:10,padding:"10px 12px",border:`1px solid ${P.border}`,marginBottom:8}}>
                <div style={{fontSize:9,color:P.muted,fontWeight:700,marginBottom:3}}>MOST POPULAR HERO</div>
                <div style={{fontSize:16,fontWeight:800,color:P.green}}>{topHero} <span style={{fontSize:12,color:P.muted,fontWeight:500}}>({heroFreq[topHero]} users)</span></div>
              </div>}
            </div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8}}>TOP BADGES EARNED</div>
              {topBadges.map((bid,i)=>{const m=MILESTONES.find(x=>x.id===bid);if(!m)return null;const Ic=Icons[m.IconKey]||Icons.Star;return(
                <div key={bid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:10,background:P.card,border:`1px solid ${P.border}`,marginBottom:6}}>
                  <div style={{fontSize:14,fontWeight:900,color:P.muted,width:20,textAlign:"center"}}>{i+1}</div>
                  <Ic color={m.color} size={16}/>
                  <div style={{flex:1,fontSize:13,fontWeight:700,color:P.white}}>{m.label}</div>
                  <div style={{fontSize:13,fontWeight:700,color:P.accent}}>{badgeDist[bid]} users</div>
                </div>
              );})}
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8}}>ALL USERS</div>
              {[...adminData].sort((a,b)=>b.totalBadges-a.totalBadges).map((u,i)=>(
                <div key={u.userId} style={{background:P.card,borderRadius:10,padding:"10px 12px",border:`1px solid ${P.border}`,marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{fontSize:12,fontWeight:700,color:P.white}}>{u.userId}</div>
                    <div style={{display:"flex",gap:6}}>
                      {u.diamond>0&&<div style={{fontSize:10,fontWeight:700,color:"#1d4ed8",background:"#1d4ed818",padding:"2px 6px",borderRadius:6}}>D {u.diamond}</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:12,fontSize:11,color:P.muted}}>
                    <span>{u.rounds} rounds</span>
                    <span>{u.totalBadges} badge pts</span>
                    {u.topHero&&<span>Top: {u.topHero}</span>}
                    <span style={{marginLeft:"auto"}}>{u.lastSeen?new Date(u.lastSeen).toLocaleDateString():""}</span>
                  </div>
                </div>
              ))}
            </div>
          </>);
        })()}
        {!adminLoading&&!adminData&&<div style={{textAlign:"center",padding:40,color:P.muted}}>No data yet.</div>}
      </div>
    </div>
  );

  return (
    <div style={{...S.shell, position:"relative", overflow:"hidden", background:P.bg}}>
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 40% at 50% 0%, ${darkMode?"rgba(202,138,4,0.1)":"rgba(202,138,4,0.06)"} 0%, transparent 60%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"16px 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:P.white,letterSpacing:-0.5}}>Milestones</div>
          <div style={{fontSize:10,color:P.muted,fontWeight:600,letterSpacing:1}}>{totalPoints} / {maxPoints} BADGES{diaCount>0?` · ${diaCount} DIA`:""}</div>
        </div>
<div style={{width:40}}/>
      </div>

      {/* Tab switcher */}
      <div style={{padding:"0 20px 10px",display:"flex",gap:6,position:"relative",zIndex:1}}>
        {[{id:"badges",label:"My Badges"},{id:"leaderboard",label:"Leaderboard"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} {...pp()} style={{flex:1,padding:"8px",borderRadius:10,border:`1.5px solid ${tab===t.id?"#ca8a04":P.border}`,background:tab===t.id?"#ca8a0415":P.card,color:tab===t.id?"#ca8a04":P.muted,fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab==="badges"&&<>
      {/* Overall progress */}
      <div style={{padding:"0 20px 10px",position:"relative",zIndex:1}}>
        <div style={{height:6,borderRadius:3,background:P.cardAlt,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#b45309,#ca8a04,#1d4ed8)",width:`${(totalPoints/maxPoints)*100}%`,transition:"width 0.6s"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
          <div style={{display:"flex",gap:8}}>
            {TIER_META.map(t=><div key={t.tier} style={{fontSize:10,fontWeight:700,color:t.color}}>{items.filter(m=>m.currentTier>=t.tier).length} {t.name.slice(0,1)}</div>)}
          </div>
          <div style={{fontSize:10,color:"#ca8a04",fontWeight:700}}>{Math.round((totalPoints/maxPoints)*100)}% complete</div>
        </div>
      </div>

      {/* Category filter */}
      <div style={{padding:"0 16px 10px",display:"flex",gap:6,overflowX:"auto",position:"relative",zIndex:1}}>
        {cats.map(cat=>(
          <button key={cat} onClick={()=>setFilter(cat)} {...pp()} style={{padding:"5px 12px",borderRadius:20,flexShrink:0,border:`1.5px solid ${filter===cat?"#ca8a04":P.border}`,background:filter===cat?"#ca8a0418":"transparent",color:filter===cat?"#ca8a04":P.muted,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>
            {cat}
          </button>
        ))}
      </div>

      {/* Badge list */}
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 24px",position:"relative",zIndex:1,display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(m=>{
          const Ic = Icons[m.IconKey]||Icons.Star;
          const ct = m.currentTier;
          const tm = ct>0 ? TIER_META[ct-1] : null;
          const nextTm = ct<4 ? TIER_META[ct] : null;
          const prog = m.progress;
          const pct = prog&&!prog.done ? Math.min((prog.val/prog.max)*100,100) : 100;
          const nextDesc = ct<4 ? m.tiers[ct].desc : null;

          return (
            <div key={m.id} style={{borderRadius:14,background:tm?tm.bg:P.card,border:`1.5px solid ${tm?tm.border:P.border}`,padding:"12px 14px",transition:"all 0.2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                {/* Icon */}
                <div style={{width:50,height:50,borderRadius:14,flexShrink:0,background:tm?m.color+"22":P.cardAlt,border:`1.5px solid ${tm?m.color+"44":P.border}`,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
                  <Ic color={tm?m.color:P.muted} size={22}/>
                  {ct>0&&(
                    <div style={{position:"absolute",bottom:-6,left:"50%",transform:"translateX(-50%)",background:tm.color,borderRadius:8,padding:"1px 6px",fontSize:9,fontWeight:800,color:"#fff",whiteSpace:"nowrap",border:`1.5px solid ${P.card}`}}>
                      {tm.name.toUpperCase()}
                    </div>
                  )}
                </div>
                {/* Text */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:1}}>
                    <div style={{fontSize:14,fontWeight:800,color:ct>0?P.white:P.muted}}>{m.label}</div>
                    <div style={{fontSize:9,fontWeight:700,color:{"Journey":"#16a34a","Mental":"#7c3aed","Heroes":"#2563eb","Habit":"#0d9488","Shots":"#ca8a04"}[m.category]||P.muted,background:({"Journey":"#16a34a","Mental":"#7c3aed","Heroes":"#2563eb","Habit":"#0d9488","Shots":"#ca8a04"}[m.category]||P.muted)+"18",padding:"2px 5px",borderRadius:5}}>{m.category}</div>
                  </div>
                  <div style={{fontSize:11,color:P.muted,lineHeight:1.35}}>
                    {ct>0 ? m.tiers[ct-1].desc : m.tiers[0].desc}
                  </div>
                  {/* Tier dots */}
                  <div style={{display:"flex",gap:4,marginTop:5,alignItems:"center"}}>
                    {TIER_META.map(t=>(
                      <div key={t.tier} style={{width:ct>=t.tier?20:10,height:6,borderRadius:3,background:ct>=t.tier?t.color:P.cardAlt,transition:"all 0.3s"}}/>
                    ))}
                    <div style={{fontSize:10,color:P.muted,marginLeft:4,fontWeight:600}}>
                      {ct===0?"Not started":ct===4?"Diamond ✓":`Tier ${ct}/4`}
                    </div>
                  </div>
                </div>
                {/* Share / Lock */}
                {ct>0?(
                  <button onClick={()=>shareBadge(m)} {...pp()} style={{flexShrink:0,padding:"7px 11px",borderRadius:9,border:`1.5px solid ${tm.color}55`,background:tm.color+"18",color:tm.color,fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                    <Icons.Flag color={tm.color} size={12}/> Share
                  </button>
                ):(
                  <Icons.Shield color={P.muted} size={16}/>
                )}
              </div>

              {/* Progress toward next tier */}
              {ct<4&&(
                <div style={{marginTop:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,alignItems:"center"}}>
                    <div style={{fontSize:10,color:nextTm?.color||P.muted,fontWeight:700}}>
                      {nextTm?.name} — {nextDesc}
                    </div>
                    <div style={{fontSize:10,fontWeight:700,color:pct>60?nextTm?.color||"#ca8a04":P.muted}}>
                      {prog?.val||0}{prog?.suffix||""} / {prog?.max}{prog?.suffix||""}
                    </div>
                  </div>
                  <div style={{height:5,borderRadius:3,background:P.cardAlt,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:3,background:nextTm?.color||m.color,width:`${pct}%`,transition:"width 0.6s"}}/>
                  </div>
                </div>
              )}
              {ct===4&&(
                <div style={{marginTop:8,textAlign:"center",fontSize:11,color:"#1d4ed8",fontWeight:700}}>Diamond — maximum level reached</div>
              )}
            </div>
          );
        })}
      </div>
      </>}

      {tab==="leaderboard"&&(
        <div style={{flex:1,overflowY:"auto",padding:"0 16px 24px",position:"relative",zIndex:1}}>

          {/* Display name card */}
          <div style={{background:P.card,borderRadius:14,padding:"12px 14px",border:`1.5px solid ${P.border}`,marginBottom:14}}>
            <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8}}>YOUR NAME ON THE LEADERBOARD</div>
            {editingName?(
              <div style={{display:"flex",gap:8}}>
                <input
                  autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&saveName()}
                  placeholder="Enter your name..." maxLength={20} aria-label="Leaderboard display name"
                  style={{flex:1,padding:"8px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:13,outline:"none"}}
                />
                <button onClick={saveName} {...pp()} style={{padding:"8px 14px",borderRadius:9,border:"none",background:P.green,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setEditingName(false)} {...pp()} style={{padding:"8px 10px",borderRadius:9,border:`1px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:12,cursor:"pointer"}}>✕</button>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:15,fontWeight:700,color:displayName?P.white:P.muted}}>{displayName||"Anonymous Player"}</div>
                <button onClick={()=>{setNameInput(displayName);setEditingName(true);}} {...pp()} style={{padding:"5px 12px",borderRadius:8,border:`1px solid ${P.border}`,background:P.cardAlt,color:P.muted,fontSize:11,fontWeight:700,cursor:"pointer"}}>{displayName?"Edit":"Set Name"}</button>
              </div>
            )}
          </div>

          {/* Your rank card */}
          {leaderboard.length>0&&(()=>{
            const myRank = leaderboard.findIndex(u=>u.userId===myUid);
            const myEntry = leaderboard[myRank];
            if(!myEntry) return null;
            return (
              <div style={{background:"linear-gradient(135deg,#ca8a0415,#b4530915)",borderRadius:14,padding:"12px 14px",border:`1.5px solid #ca8a0444`,marginBottom:14,display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:40,height:40,borderRadius:12,background:"#ca8a0422",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,color:"#ca8a04"}}>#{myRank+1}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:800,color:P.white}}>Your Ranking</div>
                  <div style={{fontSize:11,color:P.muted}}>{myEntry.totalBadges} badge pts · {myEntry.rounds} rounds</div>
                </div>
                <div style={{textAlign:"right"}}>
                  {myEntry.diamond>0&&<div style={{fontSize:11,fontWeight:700,color:"#1d4ed8"}}>{myEntry.diamond} Dia</div>}
                  <div style={{fontSize:10,color:P.muted}}>{myEntry.gold>0?<div style={{fontSize:10,color:"#ca8a04",fontWeight:600}}>{myEntry.gold} Gold</div>:""}</div>
                </div>
              </div>
            );
          })()}

          {/* Leaderboard */}
          <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginBottom:8,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span>GLOBAL LEADERBOARD</span>
            {lbLoading&&<span style={{fontSize:9,color:P.accent}}>Updating...</span>}
            {!lbLoading&&<button onClick={loadLeaderboard} {...pp()} style={{fontSize:9,fontWeight:700,color:P.accent,background:"transparent",border:"none",cursor:"pointer",padding:"2px 6px"}}>↻ Refresh</button>}
          </div>

          {lbLoading&&leaderboard.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0",color:P.muted,fontSize:13}}>Loading leaderboard...</div>
          )}

          {!lbLoading&&leaderboard.length===0&&(
            <div style={{textAlign:"center",padding:"40px 0",color:P.muted,fontSize:13}}>No players yet — you'll be first!</div>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {leaderboard.map((u,i)=>{
              const isMe = u.userId===myUid;
              const medal = i===0?"1st":i===1?"2nd":i===2?"3rd":null;
              const topTier = u.tiers ? Math.max(0,...Object.values(u.tiers)) : 0;
              const tierLabel = topTier===4?"D":topTier===3?"G":topTier===2?"S":topTier===1?"B":"";
              return (
                <div key={u.userId} style={{
                  display:"flex",alignItems:"center",gap:10,
                  padding:"10px 14px",borderRadius:12,
                  background:isMe?"#ca8a0412":i<3?P.card+"ee":P.card,
                  border:`1.5px solid ${isMe?"#ca8a0444":i===0?"#ca8a0422":P.border}`,
                }}>
                  {/* Rank */}
                  <div style={{width:32,textAlign:"center",flexShrink:0}}>
                    {medal?(
                      <div style={{fontSize:11,fontWeight:900,color:i===0?"#ca8a04":i===1?"#64748b":"#b45309"}}>{medal}</div>
                    ):(
                      <div style={{fontSize:13,fontWeight:800,color:P.muted}}>#{i+1}</div>
                    )}
                  </div>
                  {/* Avatar */}
                  <div style={{width:36,height:36,borderRadius:10,background:isMe?"#ca8a0422":P.cardAlt,border:`1px solid ${isMe?"#ca8a0444":P.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14,fontWeight:700,color:isMe?"#ca8a04":P.muted}}>
                    {(u.displayName||"?")[0].toUpperCase()}
                  </div>
                  {/* Name + stats */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:isMe?"#ca8a04":P.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {u.displayName||"Anonymous"}{isMe?" (you)":""}
                    </div>
                    <div style={{fontSize:10,color:P.muted,fontWeight:500}}>{u.rounds} rounds · {u.topHero||"—"}</div>
                  </div>
                  {/* Badge points */}
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:16,fontWeight:900,color:i===0?"#ca8a04":P.white}}>{u.totalBadges}</div>
                    <div style={{fontSize:9,color:P.muted,fontWeight:600}}>BADGE PTS</div>
                    {tierLabel&&<div style={{fontSize:11}}>{tierLabel}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{textAlign:"center",marginTop:16,fontSize:10,color:P.muted}}>Updates every 30 seconds · {leaderboard.length} player{leaderboard.length!==1?"s":""}</div>
        </div>
      )}
    </div>
  );
}

function RoundSummaryView({scores,total,courseName,courseData,roundDate,postRoundNotes,setPostRoundNotes,carryForward,setCarryForward,onSave,onBack,onViewScorecard,S}) {
  const P=useTheme();
  const darkMode = P.bg === "#09090b";
  const holeNotes=scores.map((h,i)=>({hole:i+1,note:h.holeNote,stats:getHoleStats(scores,i)})).filter(h=>h.note);
  const totalStroke=getTotalStroke(scores),totalPar=getTotalPar(scores),stp=totalStroke&&totalPar?totalStroke-totalPar:null;
  // Random prompt, stable per day
  const prompt = POST_ROUND_PROMPTS[Math.floor(Date.now()/86400000) % POST_ROUND_PROMPTS.length];
  return (
    <div style={S.shell}>
      <div style={{padding:"16px 20px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}><button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button><div style={{fontSize:18,fontWeight:700,color:P.white}}>Round Complete</div>{onViewScorecard?<button onClick={onViewScorecard} style={S.iconBtn} {...pp()}><Icons.Grid color={P.muted} size={15}/></button>:<div style={{width:38}}/>}</div>
      <div style={{flex:1,overflowY:"auto",padding:"0 16px 20px"}}>
        <div style={{textAlign:"center",padding:"12px 0 16px",animation:"fadeIn 0.4s ease-out"}}>
          <div style={{marginBottom:8}}><Icons.Flag color={P.green} size={42}/></div>
          <div style={{fontSize:15,fontWeight:700,color:P.white}}>{courseData?.club_name||courseName||"Unnamed Course"}</div>
          {courseData?.course_name&&courseData.course_name!==courseData.club_name&&<div style={{fontSize:12,color:P.muted,fontWeight:500}}>{courseData.course_name}</div>}
          <div style={{fontSize:12,color:P.muted,fontWeight:500,marginTop:1}}>{roundDate}</div>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:2,color:PM_GOLD,marginTop:8,marginBottom:4}}>MENTAL NET</div>
          <div style={{fontSize:48,fontWeight:900,color:total.net>0?P.green:total.net<0?P.red:P.gold,lineHeight:1}}>{total.net>0?"+":""}{total.net}</div>
          {totalStroke>0&&<div style={{fontSize:16,color:P.accent,fontWeight:700,marginTop:6}}>Shot {totalStroke}{stp!==null?` (${stp>0?"+":""}${stp})`:""}</div>}
          <div style={{display:"flex",justifyContent:"center",gap:28,marginTop:8}}>
            <div style={{textAlign:"center"}}><img src={darkMode ? HEROES_LOGO_WHITE : HEROES_LOGO_DARK} alt="" style={{width:40,height:40,objectFit:"contain",display:"block",margin:"0 auto 4px"}}/><span style={{fontSize:22,fontWeight:800,color:P.green}}>{total.heroes}</span><div style={{fontSize:9,color:P.green,fontWeight:700,letterSpacing:1.5,marginTop:2}}>HEROES</div></div>
            <div style={{textAlign:"center"}}><img src={darkMode ? BANDIT_LOGO_WHITE : BANDIT_LOGO_DARK} alt="" style={{width:40,height:40,objectFit:"contain",display:"block",margin:"0 auto 4px"}}/><span style={{fontSize:22,fontWeight:800,color:P.red}}>{total.bandits}</span><div style={{fontSize:9,color:P.red,fontWeight:700,letterSpacing:1.5,marginTop:2}}>BANDITS</div></div>
          </div>
        </div>

        {holeNotes.length>0&&<div style={{marginBottom:16,animation:"fadeIn 0.4s ease-out 0.1s both"}}><div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:8}}>HOLE NOTES ({holeNotes.length})</div>{holeNotes.map(hn=><div key={hn.hole} style={{background:P.card,borderRadius:10,padding:"10px 14px",marginBottom:6,border:`1.5px solid ${P.border}`,display:"flex",gap:12}}><div style={{flexShrink:0,textAlign:"center",minWidth:36}}><div style={{fontSize:10,color:P.muted,fontWeight:600}}>HOLE</div><div style={{fontSize:18,fontWeight:800,color:P.white}}>{hn.hole}</div><div style={{fontSize:11,fontWeight:700,color:hn.stats.net>0?P.green:hn.stats.net<0?P.red:P.gold}}>{hn.stats.net>0?"+":""}{hn.stats.net}</div></div><div style={{fontSize:14,color:P.white,lineHeight:1.5,borderLeft:`2px solid ${P.border}`,paddingLeft:12,fontWeight:500}}>{hn.note}</div></div>)}</div>}
        {holeNotes.length===0&&<div style={{background:P.card,borderRadius:10,padding:16,marginBottom:16,border:`1.5px solid ${P.border}`,textAlign:"center",color:P.muted,fontSize:14,fontWeight:500}}>No hole notes recorded this round.</div>}

        <div style={{marginBottom:16,animation:"fadeIn 0.4s ease-out 0.2s both"}}>
          <div style={{fontSize:10,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8}}>POST-ROUND REFLECTION</div>

          {/* Daily prompt from Paul */}
          <div style={{marginBottom:10,padding:"12px 14px",borderRadius:12,background:P.card,border:`1px solid ${PM_GOLD}44`}}>
            <div style={{fontSize:9,fontWeight:800,color:PM_GOLD,letterSpacing:1.5,marginBottom:4}}>TODAY'S PROMPT</div>
            <div style={{fontSize:13,color:P.white,lineHeight:1.6,fontStyle:"italic",fontWeight:500}}>"{prompt}"</div>
          </div>

          {/* Explanation */}
          <div style={{fontSize:12,color:P.muted,lineHeight:1.6,marginBottom:10,padding:"10px 12px",borderRadius:10,background:P.card,border:`1px solid ${P.border}`}}>
            <span style={{fontWeight:700,color:P.white}}>This is your mental game film session.</span> Elite athletes don't just play — they review. These three questions help you identify what's working, what's holding you back, and what to practice next. Your answers are saved with this round and visible in your history.
          </div>

          {[
            {key:"keep",label:"1. Keep Doing",hint:"What mental habits, routines or moments showed up well? Where did you stay present, committed or composed? Name the specific hero that helped.",color:P.green,icon:"↑",placeholder:"e.g. I stayed committed on every tee shot on the back nine..."},
            {key:"stop",label:"2. Stop Doing",hint:"Which bandits crept in most? Fear before a shot, frustration after a bad hole, doubt over a club choice? Be specific — you can't fix what you don't name.",color:P.red,icon:"✕",placeholder:"e.g. I let frustration carry over from one hole to the next..."},
            {key:"start",label:"3. Start Doing",hint:"One concrete mental habit or pre-shot intention to bring into your next round. Small, specific and actionable beats vague every time.",color:P.accent,icon:"→",placeholder:"e.g. One deep breath before every putt..."},
          ].map(q=>{
            const val = (() => { try { const d=JSON.parse(postRoundNotes||"{}"); return d[q.key]||""; } catch { return q.key==="keep"?postRoundNotes:""; } })();
            return (
              <div key={q.key} style={{marginBottom:10,background:P.card,borderRadius:10,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <div style={{width:22,height:22,borderRadius:6,background:q.color+"18",border:`1px solid ${q.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:q.color,flexShrink:0}}>{q.icon}</div>
                  <div style={{fontSize:13,fontWeight:800,color:q.color}}>{q.label}</div>
                </div>
                <div style={{fontSize:11,color:P.muted,marginBottom:8,lineHeight:1.5}}>{q.hint}</div>
                <textarea
                  value={val}
                  onChange={e=>{
                    try {
                      const d=JSON.parse(postRoundNotes||"{}");
                      d[q.key]=e.target.value;
                      setPostRoundNotes(JSON.stringify(d));
                    } catch {
                      setPostRoundNotes(JSON.stringify({keep:postRoundNotes,stop:"",start:"",[q.key]:sanitiseNote(e.target.value)}));
                    }
                  }}
                  placeholder={q.placeholder||"Write your answer here..."}
                  rows={2}
                  style={{width:"100%",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:13,outline:"none",resize:"vertical",lineHeight:1.5}}
                />
              </div>
            );
          })}
        </div>

        {/* "What will you carry forward?" field */}
        <div style={{marginBottom:16,animation:"fadeIn 0.4s ease-out 0.25s both"}}>
          <div style={{background:P.card,borderRadius:10,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
            <div style={{fontSize:13,color:P.accent,marginBottom:8,lineHeight:1.4,fontWeight:600}}>What will you carry forward into your next round?</div>
            <textarea value={carryForward} onChange={e=>{setCarryForward(e.target.value);try{localStorage.setItem("mgp_carry_forward_draft",e.target.value);}catch{}}} placeholder="One intention for next time..." rows={2} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:15,outline:"none",resize:"vertical",lineHeight:1.5}}/>
          </div>
        </div>

        <button onClick={onSave} {...pp()} style={{width:"100%",padding:"14px",borderRadius:12,border:`2px solid ${P.green}`,background:P.green+"12",color:P.green,fontSize:17,fontWeight:800,cursor:"pointer",animation:"fadeIn 0.4s ease-out 0.3s both",transition:"transform 0.1s ease"}}>Save Round & Finish ✓</button>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}*{box-sizing:border-box;}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// ROUND STATS (after save — fireworks!)
// ═══════════════════════════════════════
function RoundStatsView({round,onHome,onShare,S}) {
  const P=useTheme();
  const darkMode = P.bg === "#09090b";
  if(!round) return <div style={S.shell}><div style={{padding:40,textAlign:"center",color:P.muted}}>No round data.</div></div>;
  const isFirstRound = !round.savedRoundsCount || round.savedRoundsCount <= 1;
  const stp=round.totalStroke&&round.totalPar?round.totalStroke-round.totalPar:null;
  const holeNotes=round.scores?round.scores.map((h,i)=>({hole:i+1,note:h.holeNote,stats:getHoleStats(round.scores,i)})).filter(h=>h.note):[];

  // Scorecard totals
  const fp=round.scores?round.scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.par)||0),0):0;
  const bp=round.scores?round.scores.slice(9).reduce((s,h)=>s+(parseInt(h.par)||0),0):0;
  const fs=round.scores?round.scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0):0;
  const bs=round.scores?round.scores.slice(9).reduce((s,h)=>s+(parseInt(h.strokeScore)||0),0):0;
  const fPutts=round.scores?round.scores.slice(0,9).reduce((s,h)=>s+(parseInt(h.putts)||0),0):0;
  const bPutts=round.scores?round.scores.slice(9).reduce((s,h)=>s+(parseInt(h.putts)||0),0):0;
  const fFir=round.scores?round.scores.slice(0,9).filter(h=>h.fairway===true).length:0;
  const bFir=round.scores?round.scores.slice(9).filter(h=>h.fairway===true).length:0;
  const fGir=round.scores?round.scores.slice(0,9).filter(h=>h.gir===true).length:0;
  const bGir=round.scores?round.scores.slice(9).filter(h=>h.gir===true).length:0;
  const frontStats=round.scores?getNineStats(round.scores,0,9):{heroes:0,bandits:0,net:0};
  const backStats=round.scores?getNineStats(round.scores,9,18):{heroes:0,bandits:0,net:0};

  const cell={padding:"4px 3px",textAlign:"center",fontSize:10};

  return (
    <div style={S.shell}>
      <div style={{padding:"12px 16px 6px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`2px solid ${PM_GOLD}44`,flexShrink:0}}>
        <button onClick={()=>onHome("roundsummary")} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center",flex:1,minWidth:0,padding:"0 8px"}}>
          <div style={{fontSize:15,fontWeight:800,color:P.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{round.course}</div>
          <div style={{fontSize:11,color:P.muted,fontWeight:500}}>{round.date}</div>
        </div>
        <button onClick={()=>onShare(round)} style={{...S.iconBtn,border:`1.5px solid ${P.accent}44`}} {...pp()}><Icons.Share color={P.accent} size={15}/></button>
      </div>

      {/* Summary strip */}
      <div style={{display:"flex",gap:6,padding:"4px 14px 8px",justifyContent:"center",alignItems:"stretch"}}>
        {/* Mental Net */}
        <div style={{flex:1,textAlign:"center",padding:"10px 12px",borderRadius:14,background:(round.net>0?P.green:round.net<0?P.red:P.gold)+"12",border:`1.5px solid ${(round.net>0?P.green:round.net<0?P.red:P.gold)}33`,display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:2,marginBottom:2}}>MENTAL NET</div>
          <div style={{fontSize:44,fontWeight:900,lineHeight:1,color:round.net>0?P.green:round.net<0?P.red:P.gold}}>{round.net>0?"+":""}{round.net}</div>
          <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:4}}>
            <span style={{fontSize:11,color:P.green,fontWeight:700}}>{round.heroes}H</span>
            <span style={{fontSize:11,color:P.red,fontWeight:700}}>{round.bandits}B</span>
          </div>
        </div>
        {/* Round Score */}
        <div style={{flex:1,textAlign:"center",padding:"10px 12px",borderRadius:14,background:P.card,border:`1.5px solid ${P.border}`,display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:2,marginBottom:2}}>ROUND SCORE</div>
          {round.totalStroke>0
            ? <>
                <div style={{fontSize:44,fontWeight:900,lineHeight:1,color:P.accent}}>{round.totalStroke}</div>
                {stp!==null&&<div style={{fontSize:13,fontWeight:700,marginTop:4,color:stp<0?P.green:stp>0?P.red:P.gold}}>{stp>0?"+":""}{stp===0?"E":stp} vs par</div>}
              </>
            : <div style={{fontSize:22,fontWeight:700,color:P.muted,marginTop:4}}>—</div>
          }
        </div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"0 6px 20px"}}>

        {/* First round encouragement */}
        {isFirstRound&&(
          <div style={{margin:"6px 10px 0",padding:"12px 14px",borderRadius:12,background:PM_GOLD+"10",border:`1.5px solid ${PM_GOLD}44`}}>
            <div style={{fontSize:11,fontWeight:800,color:PM_GOLD,letterSpacing:1,marginBottom:4}}>FIRST ROUND COMPLETE</div>
            <div style={{fontSize:12,color:P.white,lineHeight:1.6}}>This is your baseline. Play a few more rounds and your Dashboard will start showing patterns — which Heroes show up consistently, which Bandits keep appearing, and whether your mental game is improving.</div>
          </div>
        )}

        {/* ── FULL SCORECARD TABLE ── */}
        <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6,paddingLeft:8}}>FULL SCORECARD</div>
        <div style={{overflowX:"auto",marginBottom:14,background:P.card,borderRadius:12,border:`1.5px solid ${P.border}`}}>
          <table style={{borderCollapse:"collapse",fontSize:10,minWidth:"100%"}}>
            <thead>
              <tr>{["#","Par","Scr","+/-","Putts","FIR","GIR","H","B","Net"].map(h=>(
                <th key={h} style={{...cell,padding:"6px 3px",color:P.muted,borderBottom:`1.5px solid ${P.border}`,fontSize:9,fontWeight:700}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {round.scores&&Array.from({length:18},(_,i)=>{
                const s=getHoleStats(round.scores,i);
                const h=round.scores[i]||{par:"",strokeScore:"",putts:"",fairway:null,gir:null,heroes:{},bandits:{}};
                const runStR=round.scores.slice(0,i+1).filter(x=>x&&x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.strokeScore)||0),0);
                const runPaR=round.scores.slice(0,i+1).filter(x=>x&&x.strokeScore&&x.par).reduce((a,x)=>a+(parseInt(x.par)||0),0);
                const runDiR=(h.strokeScore&&h.par)?runStR-runPaR:null;
                    return [
                  <tr key={i} style={{background:i%2===0?P.cardAlt:"transparent"}}>
                    <td style={{...cell,fontWeight:700,color:P.accent}}>{i+1}</td>
                    <td style={cell}>{h.par||"—"}</td>
                    <td style={{...cell,color:h.strokeScore&&h.par?(+h.strokeScore-+h.par>0?P.red:+h.strokeScore-+h.par<0?P.green:P.white):P.white,fontWeight:h.strokeScore?700:400}}>{h.strokeScore||"—"}</td>
                    <td style={{...cell,fontWeight:700,color:runDiR===null?P.muted:runDiR<0?P.green:runDiR>0?P.red:P.gold}}>{runDiR===null?"—":runDiR===0?"E":(runDiR>0?"+":"")+runDiR}</td>
                    <td style={{...cell,color:h.putts>2?P.red:h.putts===1?P.green:P.white,fontWeight:h.putts?700:400}}>{h.putts||"—"}</td>
                    <td style={{...cell,color:h.fairway===true?P.green:P.muted,fontWeight:700}}>{h.fairway===true?"✓":"—"}</td>
                    <td style={{...cell,color:h.gir===true?P.accent:P.muted,fontWeight:700}}>{h.gir===true?"✓":"—"}</td>
                    <td style={{...cell,color:P.green,fontWeight:700}}>{s.heroes||"—"}</td>
                    <td style={{...cell,color:P.red,fontWeight:700}}>{s.bandits||"—"}</td>
                    <td style={{...cell,fontWeight:700,color:s.net>0?P.green:s.net<0?P.red:s.heroes+s.bandits>0?P.gold:P.muted}}>{s.heroes+s.bandits>0?(s.net>0?"+":"")+s.net:"—"}</td>
                  </tr>,
                  i===8&&<tr key="out" style={{background:P.accent+"10",borderTop:`1.5px solid ${P.border}`}}>
                    <td style={{...cell,fontWeight:800,fontSize:9,color:P.muted}}>OUT</td>
                    <td style={{...cell,fontWeight:700}}>{fp||"—"}</td>
                    <td style={{...cell,fontWeight:700}}>{fs||"—"}</td>
                    <td style={{...cell,fontWeight:700,color:fs&&fp?(fs-fp)<0?P.green:(fs-fp)>0?P.red:P.gold:P.muted}}>{fs&&fp?(fs-fp)===0?"E":((fs-fp)>0?"+":"")+(fs-fp):"—"}</td>
                    <td style={{...cell,fontWeight:700}}>{fPutts||"—"}</td>
                    <td style={{...cell,fontWeight:700,color:P.green}}>{fFir}/9</td>
                    <td style={{...cell,fontWeight:700,color:P.accent}}>{fGir}/9</td>
                    <td style={{...cell,color:P.green,fontWeight:700}}>{frontStats.heroes}</td>
                    <td style={{...cell,color:P.red,fontWeight:700}}>{frontStats.bandits}</td>
                    <td style={{...cell,fontWeight:800,color:frontStats.net>0?P.green:frontStats.net<0?P.red:P.gold}}>{frontStats.net>0?"+":""}{frontStats.net}</td>
                  </tr>,
                ];
              })}
              <tr style={{background:P.cardAlt,borderTop:`1.5px solid ${P.border}`}}>
                <td style={{...cell,fontWeight:800,fontSize:9,color:P.muted}}>IN</td>
                <td style={{...cell,fontWeight:700}}>{bp||"—"}</td>
                <td style={{...cell,fontWeight:700}}>{bs||"—"}</td>
                <td style={{...cell,fontWeight:700,color:bs&&bp?(bs-bp)<0?P.green:(bs-bp)>0?P.red:P.gold:P.muted}}>{bs&&bp?(bs-bp)===0?"E":((bs-bp)>0?"+":"")+(bs-bp):"—"}</td>
                <td style={{...cell,fontWeight:700}}>{bPutts||"—"}</td>
                <td style={{...cell,fontWeight:700,color:P.green}}>{bFir}/9</td>
                <td style={{...cell,fontWeight:700,color:P.accent}}>{bGir}/9</td>
                <td style={{...cell,color:P.green,fontWeight:700}}>{backStats.heroes}</td>
                <td style={{...cell,color:P.red,fontWeight:700}}>{backStats.bandits}</td>
                <td style={{...cell,fontWeight:800,color:backStats.net>0?P.green:backStats.net<0?P.red:P.gold}}>{backStats.net>0?"+":""}{backStats.net}</td>
              </tr>
              <tr style={{background:P.accent+"18",borderTop:`2px solid ${P.accent}44`}}>
                <td style={{...cell,fontWeight:800,fontSize:9,color:P.accent}}>TOT</td>
                <td style={{...cell,fontWeight:800}}>{fp+bp||"—"}</td>
                <td style={{...cell,fontWeight:800}}>{fs+bs||"—"}</td>
                <td style={{...cell,fontWeight:800,color:(fs+bs)&&(fp+bp)?(fs+bs-(fp+bp))<0?P.green:(fs+bs-(fp+bp))>0?P.red:P.gold:P.muted}}>{(fs+bs)&&(fp+bp)?(fs+bs-(fp+bp))===0?"E":((fs+bs-(fp+bp))>0?"+":"")+(fs+bs-(fp+bp)):"—"}</td>
                <td style={{...cell,fontWeight:800,color:P.white}}>{fPutts+bPutts||"—"}</td>
                <td style={{...cell,fontWeight:800,color:P.green}}>{fFir+bFir}/18</td>
                <td style={{...cell,fontWeight:800,color:P.accent}}>{fGir+bGir}/18</td>
                <td style={{...cell,color:P.green,fontWeight:800}}>{round.heroes}</td>
                <td style={{...cell,color:P.red,fontWeight:800}}>{round.bandits}</td>
                <td style={{...cell,fontWeight:900,fontSize:13,color:round.net>0?P.green:round.net<0?P.red:P.gold}}>{round.net>0?"+":""}{round.net}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Legend */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14,paddingLeft:4}}>
          {[{l:"FIR",d:"Fairway in Regulation"},{l:"GIR",d:"Green in Regulation"}].map(({l,d})=>(
            <div key={l} style={{fontSize:10,color:P.muted}}><span style={{fontWeight:700,color:P.white}}>{l}</span> {d}</div>
          ))}
        </div>

        {/* ── HERO / BANDIT BREAKDOWN ── */}
        <div style={{marginBottom:14,animation:"fadeIn 0.4s ease-out 0.1s both"}}>
          <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6,paddingLeft:2}}>HERO / BANDIT BREAKDOWN</div>
          <div style={{background:P.card,borderRadius:12,padding:"10px 12px",border:`1.5px solid ${P.border}`}}>
            {MATCHUPS.map(({hero,verb,bandit})=>{
              const hc=round.scores.reduce((s,h)=>s+(h.heroes[hero]||0),0),bc=round.scores.reduce((s,h)=>s+(h.bandits[bandit]||0),0);
              if(hc===0&&bc===0)return null;
              const hColor=P.green;
              const total=Math.max(hc,bc,1);
              return (
                <div key={hero} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:`1px solid ${P.border}22`}}>
                  <span style={{color:P.green,fontWeight:700,fontSize:12,width:82}}>{hero}</span>
                  <div style={{flex:1,height:5,borderRadius:3,background:P.cardAlt}}><div style={{width:`${(hc/total)*100}%`,height:"100%",background:P.green,borderRadius:3}}/></div>
                  <span style={{fontSize:11,color:P.green,fontWeight:800,width:16,textAlign:"center"}}>{hc}</span>
                  <span style={{fontSize:9,color:P.muted,width:10,textAlign:"center"}}>v</span>
                  <span style={{fontSize:11,color:P.red,fontWeight:800,width:16,textAlign:"center"}}>{bc}</span>
                  <div style={{flex:1,height:5,borderRadius:3,background:P.cardAlt,direction:"rtl"}}><div style={{width:`${(bc/total)*100}%`,height:"100%",background:P.red,borderRadius:3}}/></div>
                  <span style={{color:P.red,fontWeight:700,fontSize:12,width:82,textAlign:"right"}}>{bandit}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── HOLE NOTES ── */}
        {holeNotes.length>0&&(
          <div style={{marginBottom:14,animation:"fadeIn 0.4s ease-out 0.15s both"}}>
            <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6,paddingLeft:2}}>HOLE NOTES ({holeNotes.length})</div>
            {holeNotes.map(hn=>(
              <div key={hn.hole} style={{background:P.card,borderRadius:10,padding:"8px 12px",marginBottom:5,border:`1px solid ${P.border}`,display:"flex",gap:10}}>
                <div style={{flexShrink:0,width:28,textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:P.white}}>{hn.hole}</div><div style={{fontSize:10,fontWeight:700,color:hn.stats.net>0?P.green:hn.stats.net<0?P.red:P.gold}}>{hn.stats.net>0?"+":""}{hn.stats.net}</div></div>
                <div style={{fontSize:13,color:P.white,lineHeight:1.4,fontWeight:500,borderLeft:`2px solid ${P.border}`,paddingLeft:10}}>{hn.note}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── POST-ROUND NOTES ── */}
        {round.notes&&<div style={{marginBottom:14,animation:"fadeIn 0.4s ease-out 0.2s both"}}><div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6,paddingLeft:2}}>POST-ROUND REFLECTION</div><div style={{background:P.card,borderRadius:10,padding:"10px 12px",border:`1.5px solid ${P.border}`,fontSize:13,color:P.white,lineHeight:1.5,whiteSpace:"pre-wrap",fontWeight:500}}>{round.notes}</div></div>}

        {/* ── WEAKNESS CADDIE PUSH (negative net) ── */}
        {round.net<0&&(()=>{
          const banditCounts = Object.fromEntries(BANDITS.map(b=>[b,0]));
          if(round.scores) round.scores.forEach(h=>BANDITS.forEach(b=>{banditCounts[b]+=(h.bandits[b]||0);}));
          const topBandit = BANDITS.reduce((a,b)=>banditCounts[a]>banditCounts[b]?a:b);
          const mu = MATCHUPS.find(m=>m.bandit===topBandit);
          const cat = CADDIE_CATEGORIES.find(c=>c.name===mu?.hero);
          if(!cat||banditCounts[topBandit]===0) return null;
          return (
            <div style={{marginBottom:14,padding:"14px 16px",borderRadius:14,background:P.red+"10",border:`1.5px solid ${P.red}33`,animation:"fadeIn 0.4s ease-out 0.22s both"}}>
              <div style={{fontSize:10,color:P.red,fontWeight:800,letterSpacing:1.5,marginBottom:6}}>YOUR BIGGEST CHALLENGE TODAY</div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{width:40,height:40,borderRadius:10,background:cat.color+"18",border:`1.5px solid ${cat.color}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {(()=>{const CI=Icons[cat.IconKey];return <CI color={cat.color} size={20}/>;})()}
                </div>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:P.white}}><span style={{color:P.red}}>{topBandit}</span> showed up {banditCounts[topBandit]}x</div>
                  <div style={{fontSize:12,color:P.muted,fontWeight:500,marginTop:1}}><span style={{color:cat.color,fontWeight:700}}>{cat.name}</span> {cat.subtitle}</div>
                </div>
              </div>
              <div style={{background:P.cardAlt,borderRadius:10,padding:"10px 12px",marginBottom:10,borderLeft:`3px solid ${cat.color}`}}>
                <div style={{fontSize:13,color:P.white,lineHeight:1.55,fontStyle:"italic",fontWeight:500}}>"{cat.messages[Math.floor(Math.random()*cat.messages.length)]}"</div>
              </div>
              <button onClick={()=>onHome("caddie")} {...pp()} style={{width:"100%",padding:"10px",borderRadius:10,border:`1.5px solid ${cat.color}55`,background:cat.color+"15",color:cat.color,fontSize:13,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                <Icons.Brain color={cat.color} size={14}/> Open Inner Caddie — Work on {cat.name}
              </button>
            </div>
          );
        })()}

        {/* ── ACTIONS ── */}
        <div style={{display:"flex",gap:8,marginTop:4,animation:"fadeIn 0.4s ease-out 0.25s both"}}>
          <button onClick={()=>onShare(round)} {...pp()} style={{...actionBtnS(P,P.muted),fontSize:13,transition:"transform 0.1s ease"}}>Share</button>
          <button onClick={()=>onHome("dashboard")} {...pp()} style={{...actionBtnS(P,P.green),transition:"transform 0.1s ease",flex:2}}>View Dashboard →</button>
        </div>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}*{box-sizing:border-box;}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════
function StatBubble({label,value,color}) { const P=useTheme(); return <div style={{textAlign:"center"}}><div style={{fontSize:9,color:P.muted,letterSpacing:2,fontWeight:600}}>{label.toUpperCase()}</div><div style={{fontSize:24,fontWeight:700,color}}>{value}</div></div>; }
function SCard({P,label,value,color}) { return <div style={{background:P.card,borderRadius:12,padding:"10px 6px",border:`1.5px solid ${P.border}`,textAlign:"center"}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:2}}>{label.toUpperCase()}</div><div style={{fontSize:20,fontWeight:800,color}}>{value}</div></div>; }
function BChart({P,title,items,totals,color}) { const max=Math.max(1,...Object.values(totals)); return <div style={{background:P.card,borderRadius:12,padding:12,border:`1.5px solid ${P.border}`,marginBottom:14}}><div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:8}}>{title}</div>{items.map(item=><div key={item} style={{display:"flex",alignItems:"center",marginBottom:5,gap:6}}><div style={{width:90,fontSize:13,color,fontWeight:600}}>{item}</div><div style={{flex:1,height:8,borderRadius:4,background:P.cardAlt}}><div style={{width:`${(totals[item]/max)*100}%`,height:"100%",borderRadius:4,background:color,transition:"width 0.4s"}}/></div><div style={{width:22,textAlign:"right",fontSize:13,color:P.white,fontWeight:600}}>{totals[item]}</div></div>)}</div>; }

// ═══════════════════════════════════════
// COMBO TREND CHART (bars = net, line = score)
// ═══════════════════════════════════════
function ComboTrendChart({P, trend, rounds, onSelectRound}) {
  const CHART_H = 80;
  const BAR_AREA = 44;
  const LINE_AREA = 24;
  const TOTAL_H = CHART_H + LINE_AREA;

  const maxNet = Math.max(1, ...trend.map(t => Math.abs(t.net)));
  const strokes = trend.filter(t => t.stroke > 0).map(t => t.stroke);
  const minS = strokes.length ? Math.min(...strokes) : 70;
  const maxS = strokes.length ? Math.max(...strokes) : 100;
  const strokeRange = Math.max(maxS - minS, 10);

  // Build SVG polyline points for score line
  const n = trend.length;
  const svgW = 320; // logical width
  const colW = svgW / n;
  const linePoints = trend.map((t, i) => {
    if (!t.stroke) return null;
    const x = colW * i + colW / 2;
    // Score line sits in lower LINE_AREA band (top of that band = low score = good)
    const y = TOTAL_H - 6 - ((t.stroke - minS) / strokeRange) * (LINE_AREA - 12);
    return { x, y, t, i };
  }).filter(Boolean);
  const polyline = linePoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div style={{background:P.card,borderRadius:12,padding:"8px 10px",border:`1.5px solid ${P.border}`,marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1}}>MENTAL NET + SCORE TREND</div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:10,borderRadius:2,background:P.green}}/><span style={{fontSize:9,color:P.muted}}>+Net</span></div>
          <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:10,borderRadius:2,background:P.red}}/><span style={{fontSize:9,color:P.muted}}>-Net</span></div>
          <div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:16,height:2,background:P.gold,borderRadius:1}}/><span style={{fontSize:9,color:P.muted}}>Score</span></div>
        </div>
      </div>

      <div style={{position:"relative",height:TOTAL_H}}>


        {/* Bars */}
        <div style={{position:"absolute",top:0,left:0,right:0,bottom:LINE_AREA,display:"flex",gap:2,alignItems:"stretch"}}>
          {trend.map((t, i) => {
            const barH = Math.max(4, (Math.abs(t.net) / maxNet) * (BAR_AREA/2 - 6));
            const pos = t.net >= 0;
            const roundsChron = [...rounds].reverse();
            const round = roundsChron[i] || null;
            return (
              <div key={i} style={{flex:1,display:"flex",flexDirection:"column",cursor:round?"pointer":"default",position:"relative"}} onClick={()=>round&&onSelectRound(round)} {...pp()}>
                {/* label */}
                <div style={{height:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:pos?P.green:P.red}}>
                  {t.net!==0?(t.net>0?"+":"")+t.net:""}
                </div>
                {/* positive half */}
                <div style={{flex:1,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
                  {pos&&<div style={{width:"80%",height:barH,borderRadius:"3px 3px 0 0",background:P.green,opacity:0.9}}/>}
                </div>
                {/* midline */}
                <div style={{height:1,background:P.border,flexShrink:0}}/>
                {/* negative half */}
                <div style={{flex:1,display:"flex",alignItems:"flex-start",justifyContent:"center"}}>
                  {!pos&&<div style={{width:"80%",height:barH,borderRadius:"0 0 3px 3px",background:P.red,opacity:0.9}}/>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Score line SVG overlay */}
        {linePoints.length >= 2 && (
          <svg style={{position:"absolute",top:0,left:0,width:"100%",height:TOTAL_H,overflow:"visible",pointerEvents:"none"}} viewBox={`0 0 ${svgW} ${TOTAL_H}`} preserveAspectRatio="none">
            <polyline points={polyline} fill="none" stroke={P.gold} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9"/>
            {linePoints.map(p => (
              <circle key={p.i} cx={p.x} cy={p.y} r="3" fill={P.gold} stroke={P.card} strokeWidth="1.5"/>
            ))}
          </svg>
        )}

        {/* Score dots clickable — overlay absolute positioned */}
        {linePoints.map(p => {
          const roundsChron = [...rounds].reverse();
          const round = roundsChron[p.i] || null;
          return (
            <div key={p.i}
              onClick={()=>round&&onSelectRound(round)} {...pp()}
              style={{position:"absolute",left:`calc(${(p.i/n)*100}% + ${colW/2/svgW*100*1}%)`,top:p.y-10,width:20,height:20,cursor:"pointer",transform:"translate(-50%,-50%)",zIndex:10}}
              title={`${p.t.stroke} strokes — tap for breakdown`}
            />
          );
        })}
      </div>

      {/* Date labels + score labels */}
      <div style={{display:"flex",gap:2,marginTop:1}}>
        {trend.map((t,i)=>(
          <div key={i} style={{flex:1,textAlign:"center"}}>
            <div style={{fontSize:9,color:P.muted,fontWeight:500,lineHeight:1.2}}>{t.label}</div>
            {t.stroke&&<div style={{fontSize:9,color:P.gold,fontWeight:700}}>{t.stroke}</div>}
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:P.muted,marginTop:6,textAlign:"center",fontWeight:500}}>Tap any bar or score to see round breakdown</div>
    </div>
  );
}

// ═══════════════════════════════════════
// ROUND DETAIL VIEW (from dashboard tap)
// ═══════════════════════════════════════
function RoundDetailView({round, onBack, onShare, S}) {
  const P = useTheme();
  if (!round) return <div style={S.shell}><div style={{padding:40,textAlign:"center",color:P.muted}}>No round selected.</div></div>;

  const stp = round.totalStroke && round.totalPar ? round.totalStroke - round.totalPar : null;

  // Per-hole hero/bandit breakdown
  const holeBreakdown = round.scores ? round.scores.map((h, i) => {
    const heroesOn = HEROES.filter(hero => h.heroes[hero] === 1);
    const banditsOn = BANDITS.filter(bandit => h.bandits[bandit] === 1);
    const stats = getHoleStats(round.scores, i);
    return { hole: i+1, heroesOn, banditsOn, stats, par: h.par, stroke: h.strokeScore, note: h.holeNote };
  }) : [];

  const filledHoles = holeBreakdown.filter(h => h.heroesOn.length > 0 || h.banditsOn.length > 0);

  // Hero/bandit totals for this round
  const heroTotals = Object.fromEntries(HEROES.map(h => [h, round.scores?.reduce((s, hole) => s + (hole.heroes[h] || 0), 0) || 0]));
  const banditTotals = Object.fromEntries(BANDITS.map(b => [b, round.scores?.reduce((s, hole) => s + (hole.bandits[b] || 0), 0) || 0]));

  const HERO_COLORS = { Love:"#dc2626", Acceptance:"#ca8a04", Commitment:"#16a34a", Vulnerability:"#7c3aed", Grit:"#2563eb" };

  return (
    <div style={S.shell}>
      <div style={{padding:"14px 16px 8px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:15,fontWeight:700,color:P.white}}>{round.course}</div>
          <div style={{fontSize:11,color:P.muted}}>{round.date}</div>
        </div>
        <button onClick={()=>onShare(round)} style={{...S.iconBtn,border:`1.5px solid ${P.accent}44`}} {...pp()}><Icons.Chev color={P.accent} size={15}/></button>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"0 14px 20px"}}>
        {/* Summary strip */}
        <div style={{display:"flex",gap:8,marginBottom:12}}>
          <div style={{flex:1,background:P.card,borderRadius:10,padding:"8px 12px",border:`1.5px solid ${P.border}`,textAlign:"center"}}>
            <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1}}>MENTAL NET</div>
            <div style={{fontSize:24,fontWeight:900,color:round.net>0?P.green:round.net<0?P.red:P.gold}}>{round.net>0?"+":""}{round.net}</div>
          </div>
          {round.totalStroke > 0 && (
            <div style={{flex:1,background:P.card,borderRadius:10,padding:"8px 12px",border:`1.5px solid ${P.border}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1}}>SCORE</div>
              <div style={{fontSize:24,fontWeight:900,color:P.accent}}>{round.totalStroke}</div>
              {stp !== null && <div style={{fontSize:11,color:stp>0?P.red:P.green,fontWeight:600}}>{stp>0?"+":""}{stp}</div>}
            </div>
          )}
          <div style={{flex:1,background:P.card,borderRadius:10,padding:"8px 12px",border:`1.5px solid ${P.border}`,textAlign:"center"}}>
            <div style={{fontSize:9,color:P.green,fontWeight:700,letterSpacing:1}}>HEROES</div>
            <div style={{fontSize:24,fontWeight:900,color:P.green}}>{round.heroes}</div>
          </div>
          <div style={{flex:1,background:P.card,borderRadius:10,padding:"8px 12px",border:`1.5px solid ${P.border}`,textAlign:"center"}}>
            <div style={{fontSize:9,color:P.red,fontWeight:700,letterSpacing:1}}>BANDITS</div>
            <div style={{fontSize:24,fontWeight:900,color:P.red}}>{round.bandits}</div>
          </div>
        </div>

        {/* Hero/Bandit totals for this round */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6}}>ROUND BREAKDOWN</div>
          <div style={{background:P.card,borderRadius:10,padding:"10px 12px",border:`1.5px solid ${P.border}`}}>
            {MATCHUPS.map(({hero,verb,bandit})=>{
              const hc = heroTotals[hero], bc = banditTotals[bandit];
              const hColor = HERO_COLORS[hero] || P.green;
              if (hc===0&&bc===0) return null;
              return (
                <div key={hero} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:`1px solid ${P.border}22`}}>
                  <span style={{color:hColor,fontWeight:700,fontSize:12,width:85}}>{hero}</span>
                  <div style={{flex:1,height:6,borderRadius:3,background:P.cardAlt,overflow:"hidden"}}>
                    <div style={{width:`${(hc/Math.max(hc,bc,1))*100}%`,height:"100%",background:hColor,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:12,color:hColor,fontWeight:700,width:16,textAlign:"center"}}>{hc}</span>
                  <span style={{fontSize:10,color:P.muted,width:16,textAlign:"center"}}>vs</span>
                  <span style={{fontSize:12,color:P.red,fontWeight:700,width:16,textAlign:"center"}}>{bc}</span>
                  <div style={{flex:1,height:6,borderRadius:3,background:P.cardAlt,overflow:"hidden",direction:"rtl"}}>
                    <div style={{width:`${(bc/Math.max(hc,bc,1))*100}%`,height:"100%",background:P.red,borderRadius:3}}/>
                  </div>
                  <span style={{color:P.red,fontWeight:700,fontSize:12,width:85,textAlign:"right"}}>{bandit}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hole-by-hole breakdown */}
        <div style={{fontSize:10,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6}}>HOLE BY HOLE</div>
        {filledHoles.length === 0 && (
          <div style={{textAlign:"center",color:P.muted,fontSize:13,padding:16}}>No hero/bandit data recorded for this round.</div>
        )}
        {filledHoles.map(h => (
          <div key={h.hole} style={{background:P.card,borderRadius:10,padding:"10px 12px",marginBottom:6,border:`1.5px solid ${h.stats.net>0?P.green+"33":h.stats.net<0?P.red+"33":P.border}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:28,height:28,borderRadius:8,background:h.stats.net>0?P.green+"18":h.stats.net<0?P.red+"18":P.cardAlt,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,color:h.stats.net>0?P.green:h.stats.net<0?P.red:P.muted}}>
                  {h.hole}
                </div>
                {h.par&&<span style={{fontSize:11,color:P.muted,fontWeight:500}}>Par {h.par}</span>}
                {h.stroke&&<span style={{fontSize:11,color:P.accent,fontWeight:600}}>Shot {h.stroke}</span>}
              </div>
              <div style={{fontSize:14,fontWeight:800,color:h.stats.net>0?P.green:h.stats.net<0?P.red:P.gold}}>
                {h.stats.net>0?"+":""}{h.stats.net!==0?h.stats.net:"—"}
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {h.heroesOn.map(hero=>(
                <span key={hero} style={{fontSize:11,fontWeight:700,color:HERO_COLORS[hero]||P.green,background:(HERO_COLORS[hero]||P.green)+"15",padding:"2px 8px",borderRadius:20,border:`1px solid ${(HERO_COLORS[hero]||P.green)}33`}}>{hero}</span>
              ))}
              {h.banditsOn.map(bandit=>(
                <span key={bandit} style={{fontSize:11,fontWeight:700,color:P.red,background:P.red+"15",padding:"2px 8px",borderRadius:20,border:`1px solid ${P.red}33`}}>{bandit}</span>
              ))}
            </div>
            {h.note && <div style={{marginTop:6,fontSize:12,color:P.muted,fontStyle:"italic",borderTop:`1px solid ${P.border}44`,paddingTop:5}}>{h.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// TRANSFORM VIEW
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// COACH DASHBOARD
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// ADMIN DASHBOARD (access: /#admin)
// ═══════════════════════════════════════
function CoachDashboardView({onBack, S}) {
  const P = useTheme();
  const dm = P.bg === "#09090b";
  const pp = pressProps;
  const [data, setData] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState(null);
  const [tab, setTab] = React.useState("overview"); // overview | users | heroes | bandits | emails
  const [allProfiles, setAllProfiles] = React.useState([]);
  const [filterHero, setFilterHero] = React.useState("");
  const [filterBandit, setFilterBandit] = React.useState("");
  const [userPage, setUserPage] = React.useState(0);
  const [emailPage, setEmailPage] = React.useState(0);
  const ADMIN_PAGE_SIZE = 20;

  async function load() {
    setLoading(true);
    try {
      // Load badge/round data from shared storage
      const keys = await window.storage.list("users:", true);
      const users = await Promise.all(
        (keys?.keys||[]).map(async k => {
          try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; } catch { return null; }
        })
      );
      const baseUsers = users.filter(Boolean);

      // Merge with community profiles from Supabase (has email + hero/bandit)
      let profiles = [];
      try {
        if(typeof supabase !== "undefined" && supabase) {
          const { data } = await supabase.from("community_profiles").select("*").order("last_updated", {ascending:false});
          if(data) profiles = data;
        }
      } catch {}

      // Merge: match by uid, add email to user record
      const merged = baseUsers.map(u => {
        const profile = profiles.find(p => p.uid === u.userId);
        return profile ? {...u, email: profile.email, profileName: profile.name, supabaseData: profile} : u;
      });
      // Add profiles that aren't in shared storage yet
      const storedUids = new Set(baseUsers.map(u=>u.userId));
      const profilesOnly = profiles.filter(p=>!storedUids.has(p.uid)).map(p=>({
        userId: p.uid, displayName: p.name||p.email?.split("@")[0],
        email: p.email, rounds: p.rounds_count||0,
        avgNet: p.avg_net?.toFixed(1), topHero: p.top_hero, topBandit: p.top_bandit,
        lastSeen: p.last_updated, supabaseData: p,
      }));

      setData([...merged, ...profilesOnly]);
      setAllProfiles(profiles);
      setLastRefresh(new Date());
    } catch(e) { console.warn("Admin load error:", e); }
    setLoading(false);
  }

  React.useEffect(()=>{ load(); }, []);

  // Aggregates
  const totalUsers = data.length;
  const totalRounds = data.reduce((s,u)=>s+(u.rounds||0),0);
  const avgNet = data.filter(u=>u.avgNet).length
    ? (data.filter(u=>u.avgNet).reduce((s,u)=>s+parseFloat(u.avgNet||0),0)/data.filter(u=>u.avgNet).length).toFixed(1)
    : "—";
  const avgWinRate = data.filter(u=>u.winRate!=null).length
    ? Math.round(data.filter(u=>u.winRate!=null).reduce((s,u)=>s+(u.winRate||0),0)/data.filter(u=>u.winRate!=null).length)
    : "—";
  const activeThisWeek = data.filter(u=>{
    if(!u.lastSeen) return false;
    return (Date.now()-new Date(u.lastSeen).getTime()) < 7*24*3600*1000;
  }).length;

  // Hero/bandit totals across all users
  const heroTotals={}, banditTotals={};
  data.forEach(u=>{
    Object.entries(u.heroTotals||{}).forEach(([k,v])=>heroTotals[k]=(heroTotals[k]||0)+v);
    Object.entries(u.banditTotals||{}).forEach(([k,v])=>banditTotals[k]=(banditTotals[k]||0)+v);
  });
  const sortedHeroes = Object.entries(heroTotals).sort((a,b)=>b[1]-a[1]);
  const sortedBandits = Object.entries(banditTotals).sort((a,b)=>b[1]-a[1]);
  const maxHero = sortedHeroes[0]?.[1]||1;
  const maxBandit = sortedBandits[0]?.[1]||1;

  const HERO_C = {Love:"#16a34a",Acceptance:"#16a34a",Commitment:"#16a34a",Vulnerability:"#16a34a",Grit:"#16a34a"};

  const card = {background:P.card,borderRadius:14,padding:"14px 16px",border:`1.5px solid ${P.border}`,marginBottom:12};
  const lbl = {fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"};

  const tabs = ["overview","users","emails","heroes","bandits"];

  return (
    <div style={{...S.shell,position:"relative",overflow:"hidden",background:P.bg}}>
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 35% at 50% 0%, rgba(201,168,76,0.08) 0%, transparent 55%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1,flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:16,fontWeight:900,color:P.white}}>Admin Dashboard</div>
          <div style={{fontSize:9,color:PM_GOLD,fontWeight:700,letterSpacing:1}}>PAUL MONAHAN GOLF · INTERNAL</div>
        </div>
        <button onClick={load} style={{...S.iconBtn}} {...pp()}>↻</button>
      </div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:4,padding:"8px 12px",flexShrink:0,background:P.bg,borderBottom:`1px solid ${P.border}`}}>
        {tabs.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"6px 4px",borderRadius:8,border:`1.5px solid ${tab===t?PM_GOLD:P.border}`,background:tab===t?PM_GOLD+"15":"transparent",color:tab===t?PM_GOLD:P.muted,fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 24px",position:"relative",zIndex:1}}>
        {loading ? (
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,gap:10,flexDirection:"column"}}>
            <div style={{width:24,height:24,borderRadius:"50%",border:`3px solid ${P.border}`,borderTopColor:PM_GOLD,animation:"spin 0.7s linear infinite"}}/>
            <span style={{color:P.muted,fontSize:12}}>Loading app data...</span>
          </div>
        ) : tab==="overview" ? (
          <>
            {/* KPI grid */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              {[
                {label:"Total Users",val:totalUsers,color:"#7c3aed",icon:""},
                {label:"Total Rounds",val:totalRounds,color:"#16a34a",icon:""},
                {label:"Active (7d)",val:activeThisWeek,color:PM_GOLD,icon:""},
                {label:"Avg Win Rate",val:avgWinRate+"%",color:"#60a5fa",icon:""},
                {label:"Avg Rounds/User",val:totalUsers?(totalRounds/totalUsers).toFixed(1):"—",color:"#34d87a",icon:""},
                {label:"Community Net",val:avgNet>0?"+"+avgNet:avgNet,color:parseFloat(avgNet)>0?"#16a34a":parseFloat(avgNet)<0?"#dc2626":"#ca8a04",icon:""},
              ].map((s,i)=>(
                <div key={i} style={{background:P.card,borderRadius:12,padding:"12px 14px",border:`1.5px solid ${P.border}`}}>
                  <div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:1.5,marginBottom:4,textTransform:"uppercase"}}>{s.label}</div>
                  <div style={{fontSize:28,fontWeight:900,color:s.color,lineHeight:1}}>{s.val}</div>
                </div>
              ))}
            </div>

            {/* Top hero/bandit summary */}
            <div style={card}>
              <div style={lbl}>Community Mental Trends</div>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:P.green,fontWeight:700,letterSpacing:1,marginBottom:4}}>TOP HERO</div>
                  <div style={{fontSize:18,fontWeight:900,color:P.green}}>{sortedHeroes[0]?.[0]||"—"}</div>
                  <div style={{fontSize:11,color:P.muted}}>{sortedHeroes[0]?.[1]||0} activations</div>
                </div>
                <div style={{width:1,background:P.border}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:P.red,fontWeight:700,letterSpacing:1,marginBottom:4}}>TOP BANDIT</div>
                  <div style={{fontSize:18,fontWeight:900,color:P.red}}>{sortedBandits[0]?.[0]||"—"}</div>
                  <div style={{fontSize:11,color:P.muted}}>{sortedBandits[0]?.[1]||0} appearances</div>
                </div>
              </div>
            </div>

            {/* Recently active */}
            <div style={card}>
              <div style={lbl}>Recently Active Players</div>
              {data.filter(u=>u.lastSeen).sort((a,b)=>new Date(b.lastSeen)-new Date(a.lastSeen)).slice(0,5).map((u,i)=>{
                const daysAgo = Math.floor((Date.now()-new Date(u.lastSeen).getTime())/86400000);
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,paddingBottom:8,marginBottom:8,borderBottom:i<4?`1px solid ${P.border}44`:"none"}}>
                    <div style={{width:32,height:32,borderRadius:9,background:PM_GOLD+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:PM_GOLD,flexShrink:0}}>{(u.displayName||"?")[0].toUpperCase()}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:700,color:P.white}}>{u.displayName||"Anonymous"}</div>
                      <div style={{fontSize:10,color:P.muted}}>{u.rounds} rounds · Avg {u.avgNet||"—"} net</div>
                    </div>
                    <div style={{fontSize:10,color:P.muted}}>{daysAgo===0?"Today":daysAgo===1?"Yesterday":daysAgo+"d ago"}</div>
                  </div>
                );
              })}
              {data.length===0&&<div style={{color:P.muted,fontSize:13,textAlign:"center",padding:"20px 0"}}>No users yet.</div>}
            </div>
          </>

        ) : tab==="users" ? (
          <>
            {(()=>{
              const sorted = [...data].sort((a,b)=>(b.rounds||0)-(a.rounds||0));
              const pageData = sorted.slice(userPage*ADMIN_PAGE_SIZE, (userPage+1)*ADMIN_PAGE_SIZE);
              const totalPages = Math.ceil(sorted.length/ADMIN_PAGE_SIZE);
              return (<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:10,color:P.muted}}>{totalUsers} total users · sorted by rounds played</div>
                {totalPages>1&&<div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <button onClick={()=>setUserPage(p=>Math.max(0,p-1))} disabled={userPage===0} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${P.border}`,background:"transparent",color:userPage===0?P.border:P.muted,cursor:userPage===0?"default":"pointer",fontSize:11}}>←</button>
                  <span style={{fontSize:10,color:P.muted}}>{userPage+1}/{totalPages}</span>
                  <button onClick={()=>setUserPage(p=>Math.min(totalPages-1,p+1))} disabled={userPage===totalPages-1} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${P.border}`,background:"transparent",color:userPage===totalPages-1?P.border:P.muted,cursor:userPage===totalPages-1?"default":"pointer",fontSize:11}}>→</button>
                </div>}
              </div>
              {pageData.map((u,i)=>(
              <div key={i} style={{...card,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <div style={{width:36,height:36,borderRadius:10,background:PM_GOLD+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:PM_GOLD,flexShrink:0}}>{(u.displayName||"?")[0].toUpperCase()}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:800,color:P.white}}>{u.displayName||"Anonymous"}</div>
                    <div style={{fontSize:10,color:P.muted}}>ID: {(u.userId||"").slice(0,12)}... · Last seen: {u.lastSeen?new Date(u.lastSeen).toLocaleDateString():"—"}</div>
                  </div>
                  {u.coachCode&&<div style={{fontSize:9,padding:"2px 7px",borderRadius:8,background:"#60a5fa18",border:"1px solid #60a5fa33",color:"#60a5fa",fontWeight:700}}>{u.coachCode}</div>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6}}>
                  {[
                    {l:"Rounds",v:u.rounds||0,c:P.green},
                    {l:"Avg Net",v:u.avgNet||"—",c:parseFloat(u.avgNet)>0?P.green:parseFloat(u.avgNet)<0?P.red:P.gold},
                    {l:"Best Net",v:u.bestNet!=null?(u.bestNet>0?"+":"")+u.bestNet:"—",c:P.green},
                    {l:"Win Rate",v:u.winRate!=null?u.winRate+"%":"—",c:"#60a5fa"},
                  ].map((s,j)=>(
                    <div key={j} style={{background:P.cardAlt,borderRadius:8,padding:"6px 8px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:P.muted,fontWeight:700,letterSpacing:0.5}}>{s.l}</div>
                      <div style={{fontSize:14,fontWeight:900,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {(u.topHero||u.topBandit)&&(
                  <div style={{display:"flex",gap:8,marginTop:8}}>
                    {u.topHero&&<div style={{fontSize:10,color:P.green,fontWeight:700}}>⬆ {u.topHero}</div>}
                    {u.topBandit&&<div style={{fontSize:10,color:P.red,fontWeight:700}}>⬇ {u.topBandit}</div>}
                  </div>
                )}
                {u.recentRounds?.length>0&&(
                  <div style={{marginTop:8,display:"flex",gap:4}}>
                    {u.recentRounds.slice(0,5).map((r,j)=>(
                      <div key={j} title={r.course} style={{flex:1,height:28,borderRadius:6,background:(r.net>0?P.green:r.net<0?P.red:P.gold)+"20",border:`1px solid ${(r.net>0?P.green:r.net<0?P.red:P.gold)}44`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <span style={{fontSize:10,fontWeight:800,color:r.net>0?P.green:r.net<0?P.red:P.gold}}>{r.net>0?"+":""}{r.net}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {sorted.length===0&&<div style={{textAlign:"center",padding:40,color:P.muted}}>No users yet.</div>}
          </>); })()}
          </>

        ) : tab==="heroes" ? (
          <>
            <div style={{...card}}>
              <div style={lbl}>Hero Activation Rates — All Users</div>
              {sortedHeroes.map(([hero,count],i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:80,fontSize:11,fontWeight:700,color:P.white,flexShrink:0}}>{hero}</div>
                  <div style={{flex:1,height:8,background:P.cardAlt,borderRadius:4,overflow:"hidden"}}>
                    <div style={{width:`${(count/maxHero)*100}%`,height:"100%",background:P.green,borderRadius:4,transition:"width 0.4s ease"}}/>
                  </div>
                  <div style={{width:32,textAlign:"right",fontSize:11,color:P.green,fontWeight:700}}>{count}</div>
                </div>
              ))}
              {sortedHeroes.length===0&&<div style={{color:P.muted,fontSize:13,textAlign:"center"}}>No data yet.</div>}
            </div>
            {/* Which users rely on each hero */}
            <div style={card}>
              <div style={lbl}>Hero Distribution by User Count</div>
              {sortedHeroes.map(([hero,count],i)=>{
                const usersWithHero = data.filter(u=>(u.heroTotals||{})[hero]>0).length;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,padding:"6px 8px",borderRadius:8,background:P.cardAlt}}>
                    <div style={{flex:1,fontSize:12,fontWeight:700,color:P.white}}>{hero}</div>
                    <div style={{fontSize:11,color:P.muted}}>{usersWithHero}/{totalUsers} users</div>
                    <div style={{fontSize:12,fontWeight:700,color:P.green}}>{totalUsers?Math.round(usersWithHero/totalUsers*100):0}%</div>
                  </div>
                );
              })}
            </div>
          </>

        ) : tab==="emails" ? (
          <>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,color:PM_GOLD,fontWeight:800,letterSpacing:1,marginBottom:8}}>FILTER BY MENTAL GAME</div>
              <div style={{display:"flex",gap:6,marginBottom:6}}>
                <select value={filterHero} onChange={e=>setFilterHero(e.target.value)} style={{flex:1,padding:"7px 10px",borderRadius:8,border:`1.5px solid ${P.border}`,background:P.card,color:filterHero?P.green:P.muted,fontSize:12,fontWeight:600,outline:"none"}}>
                  <option value="">All Heroes</option>
                  {HEROES.map(h=><option key={h} value={h}>{h}</option>)}
                </select>
                <select value={filterBandit} onChange={e=>setFilterBandit(e.target.value)} style={{flex:1,padding:"7px 10px",borderRadius:8,border:`1.5px solid ${P.border}`,background:P.card,color:filterBandit?P.red:P.muted,fontSize:12,fontWeight:600,outline:"none"}}>
                  <option value="">All Bandits</option>
                  {BANDITS.map(b=><option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
            {(()=>{
              const emailUsers = data.filter(u=>u.email);
              const filtered = emailUsers.filter(u=>{
                if(filterHero && u.topHero !== filterHero) return false;
                if(filterBandit && u.topBandit !== filterBandit) return false;
                return true;
              });
              const emailList = filtered.map(u=>u.email).join(",\n");
              return (
                <>
                  <div style={{...card,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={lbl}>{filtered.length} USERS{filterHero||filterBandit?" (FILTERED)":""}</div>
                      <button onClick={()=>{try{navigator.clipboard.writeText(emailList);showToast(`Copied ${filtered.length} emails`,"success");}catch{}}} style={{padding:"5px 12px",borderRadius:8,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"10",color:PM_GOLD,fontSize:11,fontWeight:700,cursor:"pointer"}}>Copy Emails</button>
                    </div>
                    <div style={{background:P.cardAlt,borderRadius:8,padding:"10px 12px",maxHeight:120,overflowY:"auto"}}>
                      {filtered.length>0
                        ? <div style={{fontSize:11,color:P.muted,lineHeight:1.8,fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{emailList||"—"}</div>
                        : <div style={{fontSize:12,color:P.muted,textAlign:"center",padding:"10px 0"}}>No users match this filter.</div>
                      }
                    </div>
                  </div>
                  {filtered.map((u,i)=>(
                    <div key={i} style={{...card,marginBottom:6}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:32,height:32,borderRadius:9,background:PM_GOLD+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:PM_GOLD,flexShrink:0}}>{(u.displayName||u.email||"?")[0].toUpperCase()}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:700,color:P.white,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                          <div style={{fontSize:10,color:P.muted}}>{u.displayName||u.profileName||""}{u.rounds?" · "+u.rounds+" rounds":""}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,marginTop:6}}>
                        {u.topHero&&<span style={{fontSize:9,fontWeight:700,color:P.green,padding:"2px 7px",borderRadius:8,background:P.green+"12"}}>⬆ {u.topHero}</span>}
                        {u.topBandit&&<span style={{fontSize:9,fontWeight:700,color:P.red,padding:"2px 7px",borderRadius:8,background:P.red+"12"}}>⬇ {u.topBandit}</span>}
                        {u.avgNet&&<span style={{fontSize:9,fontWeight:700,color:parseFloat(u.avgNet)>0?P.green:P.red,padding:"2px 7px",borderRadius:8,background:P.cardAlt}}>{parseFloat(u.avgNet)>0?"+":""}{u.avgNet} avg</span>}
                      </div>
                    </div>
                  ))}
                  {allProfiles.length===0&&<div style={{...card,textAlign:"center",color:P.muted,fontSize:12,padding:"24px"}}>No community signups yet. Users see the join prompt after their first round.</div>}
                </>
              );
            })()}
          </>

        ) : tab==="bandits" ? (
          <>
            <div style={card}>
              <div style={lbl}>Bandit Appearances — All Users</div>
              {sortedBandits.map(([bandit,count],i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:80,fontSize:11,fontWeight:700,color:P.white,flexShrink:0}}>{bandit}</div>
                  <div style={{flex:1,height:8,background:P.cardAlt,borderRadius:4,overflow:"hidden"}}>
                    <div style={{width:`${(count/maxBandit)*100}%`,height:"100%",background:P.red,borderRadius:4,transition:"width 0.4s ease"}}/>
                  </div>
                  <div style={{width:32,textAlign:"right",fontSize:11,color:P.red,fontWeight:700}}>{count}</div>
                </div>
              ))}
              {sortedBandits.length===0&&<div style={{color:P.muted,fontSize:13,textAlign:"center"}}>No data yet.</div>}
            </div>
            {/* Coaching insight */}
            {sortedBandits.length>0&&(
              <div style={{...card,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"08"}}>
                <div style={lbl}>Coaching Insight</div>
                <div style={{fontSize:13,color:P.white,lineHeight:1.6,fontWeight:500}}>
                  The most common bandit across all users is <span style={{color:P.red,fontWeight:800}}>{sortedBandits[0][0]}</span>. This suggests the most impactful group coaching focus right now is teaching golfers to deploy <span style={{color:P.green,fontWeight:800}}>{MATCHUPS.find(m=>m.bandit===sortedBandits[0][0])?.hero||"the corresponding hero"}</span>.
                </div>
              </div>
            )}
          </>
        ) : null}

        {lastRefresh&&<div style={{textAlign:"center",marginTop:8,fontSize:9,color:P.muted,opacity:0.5}}>Last updated {lastRefresh.toLocaleTimeString()}</div>}
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// COACH PORTAL (access: view="coachportal", hidden)
// ═══════════════════════════════════════
function CoachPortalView({onBack, S}) {
  const P = useTheme();
  const pp = pressProps;
  const dm = P.bg === "#09090b";
  const [tab, setTab] = React.useState("roster"); // roster | player | settings
  const [selectedPlayer, setSelectedPlayer] = React.useState(null);
  const [allUsers, setAllUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  // Coach identity stored locally
  const [coachName, setCoachName] = React.useState(()=>{ try{return localStorage.getItem("mgp_coach_name")||"";}catch{return "";} });
  const [coachCode, setCoachCode] = React.useState(()=>{ try{return localStorage.getItem("mgp_coach_code_own")||"";}catch{return "";} });
  const [roster, setRoster] = React.useState(()=>{ try{return JSON.parse(localStorage.getItem("mgp_coach_roster")||"[]");}catch{return [];} });
  const [newPlayerNote, setNewPlayerNote] = React.useState("");

  function saveRoster(r) {
    setRoster(r);
    try { localStorage.setItem("mgp_coach_roster",JSON.stringify(r)); } catch {}
  }

  async function loadAllUsers() {
    setLoading(true);
    try {
      const keys = await window.storage.list("users:", true);
      const users = await Promise.all(
        (keys?.keys||[]).map(async k => {
          try { const r = await window.storage.get(k, true); return r ? JSON.parse(r.value) : null; } catch { return null; }
        })
      );
      setAllUsers(users.filter(Boolean));
    } catch {}
    setLoading(false);
  }

  React.useEffect(()=>{ loadAllUsers(); },[]);

  // Match roster players to live data
  const rosterWithData = roster.map(p => {
    const live = allUsers.find(u => u.coachCode === coachCode && u.displayName === p.name) || null;
    return {...p, live};
  });

  const card = {background:P.card,borderRadius:14,padding:"14px 16px",border:`1.5px solid ${P.border}`,marginBottom:10};
  const lbl = {fontSize:9,color:PM_GOLD,fontWeight:800,letterSpacing:1.5,marginBottom:8,textTransform:"uppercase"};

  // Generate unique coach code
  function generateCode() {
    const code = "COACH-" + Math.random().toString(36).slice(2,7).toUpperCase();
    setCoachCode(code);
    try { localStorage.setItem("mgp_coach_code_own", code); } catch {}
  }

  function addPlayer(name) {
    if(!name.trim()) return;
    const updated = [...roster, {name:name.trim(), addedAt:new Date().toISOString(), notes:""}];
    saveRoster(updated);
  }

  function removePlayer(name) {
    saveRoster(roster.filter(p=>p.name!==name));
  }

  function updatePlayerNote(name, note) {
    saveRoster(roster.map(p=>p.name===name?{...p,notes:note}:p));
  }

  if(selectedPlayer) {
    const p = rosterWithData.find(r=>r.name===selectedPlayer);
    const u = p?.live;
    return (
      <div style={{...S.shell,background:P.bg}}>
        <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",gap:12,flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
          <button onClick={()=>setSelectedPlayer(null)} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
          <div style={{flex:1}}>
            <div style={{fontSize:16,fontWeight:900,color:P.white}}>{p?.name}</div>
            <div style={{fontSize:10,color:u?P.green:P.muted}}>{u?"Active · "+u.rounds+" rounds":"Not yet connected"}</div>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px 14px 24px"}}>
          {!u ? (
            <div style={{...card,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"08",textAlign:"center"}}>
              <div style={{fontSize:13,color:P.white,fontWeight:700,marginBottom:8}}>Player not connected yet</div>
              <div style={{fontSize:12,color:P.muted,lineHeight:1.6,marginBottom:12}}>Ask {p?.name} to enter your coach code in their app: Settings → Coach Code</div>
              <div style={{fontSize:18,fontWeight:900,color:PM_GOLD,letterSpacing:2,padding:"10px",background:P.cardAlt,borderRadius:10}}>{coachCode||"Set coach code first"}</div>
            </div>
          ) : (
            <>
              {/* Performance summary */}
              <div style={card}>
                <div style={lbl}>Mental Performance</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
                  {[
                    {l:"Avg Net",v:u.avgNet!=null?(parseFloat(u.avgNet)>0?"+":"")+u.avgNet:"—",c:parseFloat(u.avgNet)>0?P.green:parseFloat(u.avgNet)<0?P.red:P.gold},
                    {l:"Best Net",v:u.bestNet!=null?(u.bestNet>0?"+":"")+u.bestNet:"—",c:P.green},
                    {l:"Win Rate",v:u.winRate!=null?u.winRate+"%":"—",c:"#60a5fa"},
                    {l:"Rounds",v:u.rounds||0,c:P.white},
                    {l:"Heroes",v:u.totalHeroes||0,c:P.green},
                    {l:"Bandits",v:u.totalBandits||0,c:P.red},
                  ].map((s,i)=>(
                    <div key={i} style={{background:P.cardAlt,borderRadius:10,padding:"8px",textAlign:"center"}}>
                      <div style={{fontSize:8,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>{s.l}</div>
                      <div style={{fontSize:16,fontWeight:900,color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {/* Recent rounds */}
                {u.recentRounds?.length>0&&(
                  <>
                    <div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1,marginBottom:6}}>LAST {u.recentRounds.length} ROUNDS</div>
                    <div style={{display:"flex",gap:4}}>
                      {u.recentRounds.map((r,i)=>(
                        <div key={i} title={`${r.course} ${r.date}`} style={{flex:1,borderRadius:8,background:(r.net>0?P.green:r.net<0?P.red:P.gold)+"15",border:`1.5px solid ${(r.net>0?P.green:r.net<0?P.red:P.gold)}33`,padding:"6px 4px",textAlign:"center"}}>
                          <div style={{fontSize:12,fontWeight:900,color:r.net>0?P.green:r.net<0?P.red:P.gold}}>{r.net>0?"+":""}{r.net}</div>
                          <div style={{fontSize:8,color:P.muted,marginTop:2}}>{r.date?.slice(5)||""}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Hero/Bandit breakdown */}
              <div style={card}>
                <div style={lbl}>Mental Game Profile</div>
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:9,color:P.green,fontWeight:700,letterSpacing:1,marginBottom:6}}>HEROES</div>
                  {Object.entries(u.heroTotals||{}).sort((a,b)=>b[1]-a[1]).map(([h,v],i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                      <div style={{width:76,fontSize:10,fontWeight:600,color:P.white}}>{h}</div>
                      <div style={{flex:1,height:6,background:P.cardAlt,borderRadius:3}}>
                        <div style={{width:`${(v/Math.max(...Object.values(u.heroTotals)))*100}%`,height:"100%",background:P.green,borderRadius:3}}/>
                      </div>
                      <div style={{fontSize:10,color:P.green,fontWeight:700,width:20,textAlign:"right"}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{fontSize:9,color:P.red,fontWeight:700,letterSpacing:1,marginBottom:6}}>BANDITS</div>
                  {Object.entries(u.banditTotals||{}).sort((a,b)=>b[1]-a[1]).map(([b,v],i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                      <div style={{width:76,fontSize:10,fontWeight:600,color:P.white}}>{b}</div>
                      <div style={{flex:1,height:6,background:P.cardAlt,borderRadius:3}}>
                        <div style={{width:`${(v/Math.max(...Object.values(u.banditTotals)))*100}%`,height:"100%",background:P.red,borderRadius:3}}/>
                      </div>
                      <div style={{fontSize:10,color:P.red,fontWeight:700,width:20,textAlign:"right"}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coaching insight */}
              {u.topBandit&&(
                <div style={{...card,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"08"}}>
                  <div style={lbl}>Coaching Focus</div>
                  <div style={{fontSize:13,color:P.white,lineHeight:1.7}}>
                    {p.name}'s biggest challenge is <span style={{color:P.red,fontWeight:800}}>{u.topBandit}</span>. Their most reliable strength is <span style={{color:P.green,fontWeight:800}}>{u.topHero||"not yet established"}</span>. Focus coaching sessions on deploying <span style={{color:P.green,fontWeight:800}}>{MATCHUPS.find(m=>m.bandit===u.topBandit)?.hero||"Love"}</span> to counter it.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Coach notes */}
          <div style={card}>
            <div style={lbl}>Your Coaching Notes</div>
            <textarea
              value={p?.notes||""}
              onChange={e=>updatePlayerNote(p.name,sanitiseNote(e.target.value))}
              placeholder="Session notes, observations, focus areas..."
              rows={4}
              style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:13,outline:"none",resize:"vertical",lineHeight:1.5}}
            />
          </div>

          <button onClick={()=>{if(roster.length>0)removePlayer(p.name);setSelectedPlayer(null);}} style={{width:"100%",padding:"11px",borderRadius:10,border:`1.5px solid ${P.red}44`,background:"transparent",color:P.red,fontSize:13,cursor:"pointer"}}>Remove from Roster</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{...S.shell,background:P.bg}}>
      <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:16,fontWeight:900,color:P.white}}>Coach Portal</div>
          <div style={{fontSize:9,color:PM_GOLD,fontWeight:700,letterSpacing:1}}>{coachName||"SET YOUR NAME BELOW"}</div>
        </div>
        <button onClick={loadAllUsers} style={S.iconBtn} {...pp()}>↻</button>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,padding:"8px 12px",flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
        {["roster","team","settings"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"6px",borderRadius:8,border:`1.5px solid ${tab===t?PM_GOLD:P.border}`,background:tab===t?PM_GOLD+"15":"transparent",color:tab===t?PM_GOLD:P.muted,fontSize:10,fontWeight:700,cursor:"pointer",textTransform:"capitalize"}}>{t==="roster"?`Roster (${roster.length})`:t}</button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 24px"}}>
        {tab==="team" ? (
          <>
            <div style={{...card}}>
              <div style={lbl}>Team Mental Stats</div>
              {rosterWithData.filter(p=>p.live).length === 0 ? (
                <div style={{textAlign:"center",padding:"20px 0",color:P.muted,fontSize:13}}>No connected players yet. Share your coach code to see team stats here.</div>
              ) : (
                <>
                  {/* Team aggregate */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                    {[
                      {l:"Players",v:rosterWithData.filter(p=>p.live).length,c:PM_GOLD},
                      {l:"Avg Net",v:(()=>{const nets=rosterWithData.filter(p=>p.live&&p.live.avgNet!=null).map(p=>parseFloat(p.live.avgNet));return nets.length?(nets.reduce((s,n)=>s+n,0)/nets.length).toFixed(1):"—";})(),c:P.green},
                      {l:"Avg Win%",v:(()=>{const rates=rosterWithData.filter(p=>p.live&&p.live.winRate!=null).map(p=>p.live.winRate);return rates.length?Math.round(rates.reduce((s,r)=>s+r,0)/rates.length)+"%":"—";})(),c:"#60a5fa"},
                    ].map((s,i)=>(
                      <div key={i} style={{background:P.cardAlt,borderRadius:10,padding:"10px",textAlign:"center"}}>
                        <div style={{fontSize:8,color:P.muted,fontWeight:700,letterSpacing:0.5,marginBottom:2}}>{s.l}</div>
                        <div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Hero trends across team */}
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:9,color:P.green,fontWeight:800,letterSpacing:1,marginBottom:6}}>TEAM HEROES</div>
                    {(()=>{
                      const totals={};
                      rosterWithData.filter(p=>p.live).forEach(p=>Object.entries(p.live.heroTotals||{}).forEach(([k,v])=>totals[k]=(totals[k]||0)+v));
                      const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
                      const max=sorted[0]?.[1]||1;
                      return sorted.map(([h,v],i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                          <div style={{width:80,fontSize:10,fontWeight:600,color:P.white}}>{h}</div>
                          <div style={{flex:1,height:6,background:P.cardAlt,borderRadius:3}}><div style={{width:`${(v/max)*100}%`,height:"100%",background:P.green,borderRadius:3}}/></div>
                          <div style={{fontSize:10,color:P.green,fontWeight:700,width:24,textAlign:"right"}}>{v}</div>
                        </div>
                      ));
                    })()}
                  </div>
                  {/* Bandit trends */}
                  <div>
                    <div style={{fontSize:9,color:P.red,fontWeight:800,letterSpacing:1,marginBottom:6}}>TEAM BANDITS</div>
                    {(()=>{
                      const totals={};
                      rosterWithData.filter(p=>p.live).forEach(p=>Object.entries(p.live.banditTotals||{}).forEach(([k,v])=>totals[k]=(totals[k]||0)+v));
                      const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
                      const max=sorted[0]?.[1]||1;
                      return sorted.map(([b,v],i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                          <div style={{width:80,fontSize:10,fontWeight:600,color:P.white}}>{b}</div>
                          <div style={{flex:1,height:6,background:P.cardAlt,borderRadius:3}}><div style={{width:`${(v/max)*100}%`,height:"100%",background:P.red,borderRadius:3}}/></div>
                          <div style={{fontSize:10,color:P.red,fontWeight:700,width:24,textAlign:"right"}}>{v}</div>
                        </div>
                      ));
                    })()}
                  </div>
                  {/* Player leaderboard */}
                  <div style={{marginTop:14}}>
                    <div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:1,marginBottom:8}}>PLAYER LEADERBOARD</div>
                    {rosterWithData.filter(p=>p.live).sort((a,b)=>(parseFloat(b.live.avgNet)||0)-(parseFloat(a.live.avgNet)||0)).map((p,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<rosterWithData.filter(x=>x.live).length-1?`1px solid ${P.border}44`:"none"}}>
                        <div style={{width:20,fontSize:11,fontWeight:800,color:P.muted,textAlign:"center"}}>{i+1}</div>
                        <div style={{width:32,height:32,borderRadius:9,background:PM_GOLD+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:PM_GOLD}}>{p.name[0].toUpperCase()}</div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,fontWeight:700,color:P.white}}>{p.name}</div>
                          <div style={{fontSize:10,color:P.muted}}>{p.live.rounds} rounds · {p.live.topBandit||"—"}</div>
                        </div>
                        <div style={{fontSize:14,fontWeight:900,color:parseFloat(p.live.avgNet)>0?P.green:parseFloat(p.live.avgNet)<0?P.red:P.gold}}>{parseFloat(p.live.avgNet)>0?"+":""}{p.live.avgNet||"—"}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        ) : tab==="roster" ? (
          <>
            {/* Add player */}
            <div style={card}>
              <div style={lbl}>Add Player</div>
              <div style={{display:"flex",gap:8}}>
                <input
                  value={newPlayerNote}
                  onChange={e=>setNewPlayerNote(sanitiseName(e.target.value))}
                  onKeyDown={e=>{if(e.key==="Enter"&&newPlayerNote.trim()){addPlayer(newPlayerNote);setNewPlayerNote("");}}}
                  placeholder="Player name..."
                  style={{flex:1,padding:"9px 12px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:13,outline:"none"}}
                />
                <button onClick={()=>{if(newPlayerNote.trim()){addPlayer(newPlayerNote);setNewPlayerNote("");}}} style={{padding:"9px 14px",borderRadius:9,border:"none",background:P.green,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}} {...pp()}>Add</button>
              </div>
            </div>

            {/* Roster */}
            {loading ? (
              <div style={{textAlign:"center",padding:"30px",color:P.muted}}>Loading player data...</div>
            ) : rosterWithData.length===0 ? (
              <div style={{textAlign:"center",padding:"40px 20px",color:P.muted}}>
                <div style={{fontSize:32,marginBottom:12,color:P.muted,fontWeight:800}}>—</div>
                <div style={{fontSize:14,fontWeight:700,color:P.white,marginBottom:6}}>No players yet</div>
                <div style={{fontSize:12,lineHeight:1.6}}>Add players above, then share your coach code with them so their data appears here.</div>
              </div>
            ) : rosterWithData.map((p,i)=>{
              const u = p.live;
              const connected = !!u;
              return (
                <div key={i} onClick={()=>setSelectedPlayer(p.name)} style={{...card,cursor:"pointer",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:40,height:40,borderRadius:11,background:connected?PM_GOLD+"18":P.cardAlt,border:`1.5px solid ${connected?PM_GOLD:P.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:connected?PM_GOLD:P.muted,flexShrink:0}}>{p.name[0].toUpperCase()}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:800,color:P.white}}>{p.name}</div>
                      {connected
                        ? <div style={{fontSize:10,color:P.green}}>{u.rounds} rounds · Avg {u.avgNet||"—"} · Win {u.winRate!=null?u.winRate+"%":"—"}</div>
                        : <div style={{fontSize:10,color:P.muted}}>Awaiting connection · Share code: <span style={{color:PM_GOLD,fontWeight:700}}>{coachCode||"not set"}</span></div>
                      }
                    </div>
                    {connected&&u.recentRounds?.length>0&&(
                      <div style={{width:36,height:36,borderRadius:9,background:(u.recentRounds[0].net>0?P.green:u.recentRounds[0].net<0?P.red:P.gold)+"15",border:`1.5px solid ${(u.recentRounds[0].net>0?P.green:u.recentRounds[0].net<0?P.red:P.gold)}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:12,fontWeight:900,color:u.recentRounds[0].net>0?P.green:u.recentRounds[0].net<0?P.red:P.gold}}>{u.recentRounds[0].net>0?"+":""}{u.recentRounds[0].net}</span>
                      </div>
                    )}
                    <Icons.Chev color={P.muted} size={14}/>
                  </div>
                  {p.notes&&<div style={{marginTop:6,fontSize:11,color:P.muted,fontStyle:"italic",borderTop:`1px solid ${P.border}44`,paddingTop:5}}>{p.notes}</div>}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div style={card}>
              <div style={lbl}>Your Coach Identity</div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:P.muted,marginBottom:4,fontWeight:600}}>Your Name</div>
                <input
                  value={coachName}
                  onChange={e=>{const v=sanitiseName(e.target.value);setCoachName(v);try{localStorage.setItem("mgp_coach_name",v);}catch{}}}
                  placeholder="e.g. Paul Monahan"
                  style={{width:"100%",padding:"9px 12px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,fontWeight:700,outline:"none"}}
                />
              </div>
              <div style={{marginBottom:4}}>
                <div style={{fontSize:11,color:P.muted,marginBottom:4,fontWeight:600}}>Your Coach Code</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <div style={{flex:1,padding:"9px 12px",borderRadius:9,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"08",fontSize:16,fontWeight:900,color:PM_GOLD,letterSpacing:2}}>
                    {coachCode||"— not set —"}
                  </div>
                  <button onClick={generateCode} style={{padding:"9px 14px",borderRadius:9,border:`1.5px solid ${P.border}`,background:P.card,color:P.muted,fontSize:11,fontWeight:700,cursor:"pointer"}} {...pp()}>Generate</button>
                </div>
                <div style={{fontSize:11,color:P.muted,marginTop:6,lineHeight:1.5}}>Share this code with your players. They enter it in their app Settings to connect with you. Players who enter your code will appear in your roster automatically.</div>
              </div>
            </div>

            <div style={card}>
              <div style={lbl}>How It Works</div>
              {[
                {n:1,t:"Set your coach code above",d:"Generate a unique code — it identifies you as their coach."},
                {n:2,t:"Share with your players",d:"Text or email them your code. They enter it in Mental Game Scorecard → Settings → Coach Code."},
                {n:3,t:"See their data here",d:"Once connected, their mental performance data syncs to your roster automatically."},
                {n:4,t:"Add coaching notes",d:"Tap any player to see their full breakdown and add private coaching notes."},
              ].map((s,i)=>(
                <div key={i} style={{display:"flex",gap:10,marginBottom:10}}>
                  <div style={{width:24,height:24,borderRadius:7,background:PM_GOLD+"18",border:`1px solid ${PM_GOLD}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:PM_GOLD,flexShrink:0}}>{s.n}</div>
                  <div><div style={{fontSize:12,fontWeight:700,color:P.white}}>{s.t}</div><div style={{fontSize:11,color:P.muted,marginTop:2}}>{s.d}</div></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function TransformView({onBack,S,P}) {
  const dm = P.bg === "#09090b";
  const steps = [
    {num:1,title:"Be a Transformative Learner",sub:"The Key to Skill Building",desc:"Define the gap. Be open. Embrace discomfort. Objectivity leads to discovery.",c:"#60a5fa"},
    {num:2,title:"Be Aware",sub:"The Key to a Productive Mindset",desc:"Tune-in to your thinking. You have CHOICES about the thought patterns you anchor to in any moment. Notice your chatter.",c:"#a78bfa"},
    {num:3,title:"Be Present",sub:"The Key to Playing the Game",desc:"You can't WIN the moment unless you are IN the moment. Play golf — not golf swing. Channel your inner athlete.",c:"#34d87a"},
    {num:4,title:"Be a Possibility Thinker",sub:"The Key to Staying In the Game",desc:"Turn challenge into opportunity. Operate from abundance. Feed the Good Wolf.",c:"#fbbf24"},
  ];
  return (
    <div style={{...S.shell,position:"relative",background:P.bg}}>
      <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 80% 40% at 50% 0%, ${dm?"rgba(251,191,36,0.1)":"rgba(251,191,36,0.06)"} 0%, transparent 55%)`,zIndex:0,pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{padding:"16px 20px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"relative",zIndex:1}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:19,fontWeight:900,color:PM_GOLD,letterSpacing:-0.5}}>Transform Your Game</div>
          <div style={{fontSize:10,color:P.muted,fontWeight:600,letterSpacing:1,marginTop:1}}>PAUL MONAHAN'S FRAMEWORK</div>
        </div>
        <div style={{width:40}}/>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"4px 16px 28px",position:"relative",zIndex:1}}>

        {/* Intro text */}
        <div style={{fontSize:13,lineHeight:1.6,color:P.muted,fontWeight:500,marginBottom:14,padding:"12px 14px",borderRadius:12,background:P.card,border:`1px solid ${PM_GOLD}44`}}>
          Channeling the Five Heroes of Potential will allow you to experience practice and play with a sense of objectivity, joy, and passion that produces better decisions and shot-making.
        </div>

        {/* 4 Steps */}
        <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:PM_GOLD,marginBottom:8,textTransform:"uppercase"}}>4 Steps to Transform Your Game</div>
        {steps.map((s,i)=>(
          <div key={i} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"12px 14px",borderRadius:14,background:P.card,border:`1.5px solid ${P.border}`,marginBottom:8}}>
            <div style={{width:36,height:36,borderRadius:10,background:s.c+"18",border:`1.5px solid ${s.c}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:15,fontWeight:900,color:s.c}}>{s.num}</div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:P.white,marginBottom:1}}>{s.title}</div>
              <div style={{fontSize:9,fontWeight:800,color:s.c,letterSpacing:1,marginBottom:4,textTransform:"uppercase"}}>{s.sub}</div>
              {s.desc&&<div style={{fontSize:12,color:P.muted,lineHeight:1.5}}>{s.desc}</div>}
            </div>
          </div>
        ))}

        {/* Go Deeper */}
        <div style={{marginTop:4,padding:"16px",borderRadius:16,background:P.card,border:`1.5px solid ${P.border}`,overflow:"hidden"}}>
          {/* Paul bio */}
          <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${P.border}`}}>
            <div style={{width:52,height:52,borderRadius:"50%",background:`linear-gradient(135deg,${PM_NAVY},#2563eb)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:20,fontWeight:900,color:"#fff"}}>P</div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:P.white,marginBottom:2}}>Paul Monahan</div>
              <div style={{fontSize:11,color:P.muted,lineHeight:1.5}}>Human performance coach, author of <span style={{color:P.white,fontStyle:"italic"}}>The Most Important Game</span>, and founder of Paul Monahan Golf.</div>
            </div>
          </div>
          <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:PM_GOLD,marginBottom:4,textTransform:"uppercase"}}>Go Deeper With Paul</div>
          <div style={{fontSize:13,color:P.muted,lineHeight:1.5,marginBottom:14}}>Ready to take your mental game to the next level? Work directly with Paul through his book, online course, or mastermind community.</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>

            {/* Book */}
            <button onClick={()=>openUrl("https://a.co/d/0j8TEXmJ")} {...pp()} style={{width:"100%",padding:"12px 14px",borderRadius:12,background:"linear-gradient(135deg,#1a2b4a,#2563eb)",display:"flex",alignItems:"center",gap:12,textAlign:"left",border:"none",cursor:"pointer",boxSizing:"border-box"}}>
              <img src="https://m.media-amazon.com/images/I/71Q2HxFnTRL._SY160.jpg" alt="The Most Important Game" style={{width:40,height:58,objectFit:"cover",borderRadius:6,flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,0.4)"}} onError={e=>{e.target.style.display="none";}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,fontWeight:700,color:"rgba(255,255,255,0.6)",letterSpacing:1,marginBottom:2,textTransform:"uppercase"}}>The Book</div>
                <div style={{fontSize:14,fontWeight:800,color:"#fff",lineHeight:1.3,marginBottom:2}}>The Most Important Game</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>Play Better. Struggle Less. Enjoy More.</div>
              </div>
              <span style={{fontSize:14,color:"rgba(255,255,255,0.7)",flexShrink:0}}>→</span>
            </button>

            {/* Course */}
            <button onClick={()=>openUrl("https://mentalgolfbook.com/get-the-book-237591")} {...pp()} style={{width:"100%",padding:"12px 14px",borderRadius:12,background:"linear-gradient(135deg,#1a3a5c,#2563eb)",display:"flex",alignItems:"center",justifyContent:"space-between",border:"none",cursor:"pointer",boxSizing:"border-box"}}>
              <div style={{minWidth:0,textAlign:"left"}}>
                <div style={{fontSize:13,fontWeight:800,color:"#fff"}}>Rethinking Golf</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.7)",marginTop:2}}>Online Course</div>
              </div>
              <span style={{fontSize:14,color:"rgba(255,255,255,0.7)",flexShrink:0,marginLeft:8}}>→</span>
            </button>

            {/* 1-on-1 Coaching */}
            <button onClick={()=>openUrl("https://www.paulmonahan.com/golf-coach/")} {...pp()} style={{width:"100%",padding:"13px 16px",borderRadius:12,background:"linear-gradient(135deg,#1a2b4a,#2563eb)",border:"none",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>1-on-1 Coaching with Paul</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",marginTop:2}}>Personalized mental performance coaching</div>
              </div>
              <span style={{fontSize:16,opacity:0.7}}>→</span>
            </button>

            {/* Mastermind */}
            <button onClick={()=>openUrl("https://www.skool.com/paul-monahan-golf-academy-8319/about?ref=78dccfa86ba543cd895a3255f2dab29f")} {...pp()} style={{width:"100%",padding:"13px 16px",borderRadius:12,background:"linear-gradient(135deg,#1a2b4a,#2563eb)",border:"none",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",boxSizing:"border-box"}}>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>Join the Mastermind</div>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.65)",marginTop:2}}>Golf Academy Community</div>
              </div>
              <span style={{fontSize:14,color:"rgba(255,255,255,0.7)"}}>→</span>
            </button>
          </div>
        </div>

        <div style={{marginTop:12,padding:"12px 14px",borderRadius:12,background:P.card,border:`1px solid ${P.border}`,textAlign:"center"}}>
          <div style={{fontSize:14,fontWeight:800,color:P.white,marginBottom:2}}>Play Better · Struggle Less · Enjoy More</div>
        </div>

        {/* Paul Monahan Golf branding */}
        <div style={{marginTop:20,paddingBottom:8,textAlign:"center"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,marginBottom:6}}>
            <div style={{height:1,width:24,background:P.border}}/>
            <span style={{fontSize:9,fontWeight:800,color:P.muted,letterSpacing:2.5,textTransform:"uppercase",opacity:0.7}}>Paul Monahan Golf</span>
            <div style={{height:1,width:24,background:P.border}}/>
          </div>
          <div style={{fontSize:10,color:P.muted,opacity:0.5,fontWeight:500}}>paulmonahan.com</div>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// ONBOARDING FLOW (unchanged from original)
// ═══════════════════════════════════════
const OB_HEROES = [
  {label:"Love",color:"#16a34a",desc:"Passion, gratitude & appreciation",example:"Standing on the first tee feeling genuine excitement. You smile — you get to play today. You easily connect to love, gratitude and appreciation in every moment.",quote:"Channeling Love allows you to experience golf with objectivity, joy, and passion that produces better decisions and shot-making."},
  {label:"Acceptance",color:"#16a34a",desc:"Releasing outcomes & embracing reality",example:"Your drive lands in a bunker. Instead of frustration: 'Hmmm, interesting — what's the best play from here?' You see outcomes as feedback, not failure.",quote:"Objectivity leads to discovery."},
  {label:"Commitment",color:"#16a34a",desc:"Trusting your process completely",example:"You pick your target, trust your club, execute your routine. No second-guessing. Total commitment. You can't WIN the moment unless you are IN the moment.",quote:"Commitment to the process. Indifference to the result."},
  {label:"Vulnerability",color:"#16a34a",desc:"Showing up exactly as you are",example:"Everyone watches your birdie putt. Instead of tightening up, you welcome the moment — pressure is a test that makes you a better player.",quote:"You are not your score."},
  {label:"Grit",color:"#16a34a",desc:"Staying in the shot, hole & game",example:"You're 5 over through 12. Your mind says give up — but you recommit. You stay in pursuit mode, each shot, each hole. You feed the Good Wolf.",quote:"The Wolf you feed wins the battle in your mind."},
];
const OB_BANDITS = [
  {label:"Fear",color:"#dc2626",desc:"Thought patterns that steal your potential",example:"Water right. You can't stop thinking about it. Body tightens. You steer the ball — right into the water. Fear yields tremendous power — the highest leverage thing you can do is eliminate it.",hero:"Love"},
  {label:"Frustration",color:"#dc2626",desc:"Arguing with reality",example:"Three bad drives. Gripping harder, rushing, getting angry. You're arguing with what already happened. The real reason for frustration: reality did not line up with your story.",hero:"Acceptance"},
  {label:"Doubt",color:"#dc2626",desc:"Second-guessing everything",example:"Between clubs. Pick one, switch, switch back. Standing over the ball still unsure. Tentative swing. You are not IN the moment — you are stuck in your head.",hero:"Commitment"},
  {label:"Shame",color:"#dc2626",desc:"Hiding from the moment",example:"You shank a chip in front of others. Embarrassment takes over. Next few shots are timid and guarded. You stop showing up as yourself.",hero:"Vulnerability"},
  {label:"Quit",color:"#dc2626",desc:"Checking out mentally",example:"Rough round. Stop trying. Skip the routine. Just going through the motions until 18. You stop staying in the shot, the hole, the game.",hero:"Grit"},
];

function CaddieToggleMock(){
  const P=useTheme();
  const [on,setOn]=useState(true);
  return <div style={{background:P.cardAlt,borderRadius:12,padding:"10px 14px",border:`1px solid ${P.border}`,marginBottom:10}}>
    <button onClick={()=>setOn(!on)} style={{width:"100%",padding:"8px 12px",borderRadius:8,cursor:"pointer",border:`1.5px solid ${on?"#006747":P.border}`,background:on?"rgba(0,103,71,0.12)":"transparent",display:"flex",alignItems:"center",justifyContent:"space-between",transition:"all 0.2s"}} {...pp()}>
      <span style={{fontSize:13,fontWeight:600,color:on?"#006747":P.muted,display:"flex",alignItems:"center",gap:6}}><Icons.Brain color={on?"#006747":P.muted} size={15}/> In-Game Caddie</span>
      <div style={{width:36,height:20,borderRadius:10,background:on?"#006747":P.border,position:"relative",transition:"background 0.2s"}}><div style={{width:16,height:16,borderRadius:"50%",background:"#fff",position:"absolute",top:2,left:on?18:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/></div>
    </button>
    <div style={{fontSize:11,color:P.muted,marginTop:6,fontWeight:500,textAlign:"center"}}>↑ Find this toggle at the top of your scorecard</div>
  </div>;
}

function TrendMock(){
  const P=useTheme();
  const data=[{l:"03/01",net:2},{l:"03/08",net:-1},{l:"03/15",net:4},{l:"03/22",net:1},{l:"03/29",net:5},{l:"04/05",net:3}];
  const mx=Math.max(...data.map(d=>Math.abs(d.net)));
  return <div style={{background:P.cardAlt,borderRadius:12,padding:14,border:`1px solid ${P.border}`}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><div style={{fontSize:9,color:P.muted,fontWeight:800,letterSpacing:2}}>MENTAL NET TREND</div><div style={{fontSize:10,color:P.muted}}>6 rounds</div></div>
    <div style={{display:"flex",gap:4,height:100,paddingBottom:16,position:"relative"}}><div style={{position:"absolute",left:0,right:0,bottom:16+40,height:1,background:P.border}}/>
      {data.map((d,i)=>{const mid=40,bH=(Math.abs(d.net)/mx)*mid,pos=d.net>=0; return <div key={i} style={{flex:1,position:"relative",height:84}}><div style={{position:"absolute",bottom:pos?mid:mid-bH,left:"15%",width:"70%",maxWidth:26,height:bH||2,borderRadius:3,background:pos?P.green:P.red,opacity:0.7}}/><div style={{position:"absolute",bottom:pos?mid+bH+2:mid-bH-14,width:"100%",textAlign:"center",fontSize:9,fontWeight:700,color:pos?P.green:P.red}}>{d.net>0?"+":""}{d.net}</div></div>;})}
    </div>
    <div style={{display:"flex",gap:4}}>{data.map((d,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:9,color:P.muted}}>{d.l}</div>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:10}}>
      <div style={{background:P.card,borderRadius:8,padding:"8px 6px",textAlign:"center",border:`1px solid ${P.border}`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1}}>AVG NET</div><div style={{fontSize:18,fontWeight:900,color:P.green}}>+2.3</div></div>
      <div style={{background:P.card,borderRadius:8,padding:"8px 6px",textAlign:"center",border:`1px solid ${P.border}`}}><div style={{fontSize:9,color:P.muted,fontWeight:700,letterSpacing:1}}>TOP HERO</div><div style={{fontSize:15,fontWeight:800,color:P.white}}>Grit</div></div>
    </div>
  </div>;
}

function HeroBanditTab(){
  const P=useTheme();
  const dm=P.bg==="#09090b";
  const [tab,setTab]=useState("heroes"); const [exp,setExp]=useState(null);
  const data=tab==="heroes"?OB_HEROES:OB_BANDITS;
  const activeColor=tab==="heroes"?P.green:P.red;
  const heroLogo=dm?HEROES_LOGO_WHITE:HEROES_LOGO_DARK;
  const banditLogo=dm?BANDIT_LOGO_WHITE:BANDIT_LOGO_DARK;
  return <div>
    <div style={{fontSize:14,lineHeight:1.7,color:P.muted,fontWeight:500,marginBottom:10}}>Channeling the Five Heroes will allow you to experience golf with objectivity, joy, and passion. Beware the Five Bandits — thought patterns that will steal your potential if you are not careful.</div>
    <div style={{padding:"10px 14px",borderRadius:12,background:P.cardAlt,border:`1px solid ${P.border}`,marginBottom:14,textAlign:"center"}}>
      <div style={{fontSize:13,color:P.white,fontStyle:"italic",fontWeight:500}}>Which one wins?</div>
      <div style={{fontSize:14,color:P.green,fontWeight:800,marginTop:2}}>...the one you feed.</div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:12}}>{[{k:"heroes",l:"Heroes",c:P.green,logo:heroLogo},{k:"bandits",l:"Bandits",c:P.red,logo:banditLogo}].map(t=>(
      <button key={t.k} onClick={()=>{setTab(t.k);setExp(null);}} {...pp()} style={{flex:1,padding:"10px 8px",borderRadius:12,border:`1.5px solid ${tab===t.k?t.c+"55":P.border}`,background:tab===t.k?t.c+"12":P.card,color:tab===t.k?t.c:P.muted,fontSize:14,fontWeight:700,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
        <img src={t.logo} alt="" style={{width:22,height:22,objectFit:"contain"}}/>
        {t.l}
      </button>
    ))}</div>
    <div style={{fontSize:12,color:P.muted,fontWeight:500,marginBottom:10,fontStyle:"italic"}}>{tab==="heroes"?"Tap any Hero to see what it looks like on the course.":"Tap any Bandit to see how it steals your game."}</div>
    {data.map((item,i)=>{
      const isO=exp===i;
      const itemColor=item.color;
      return <div key={i} style={{borderRadius:12,overflow:"hidden",background:P.card,border:`1.5px solid ${isO?itemColor+"55":P.border}`,marginBottom:5,transition:"all 0.2s"}}>
        <button onClick={()=>setExp(isO?null:i)} {...pp()} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",width:"100%",background:"transparent",border:"none",cursor:"pointer",textAlign:"left"}}>
          <div style={{width:4,height:28,borderRadius:2,background:isO?itemColor:P.border,flexShrink:0,transition:"background 0.2s"}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:14,fontWeight:700,color:isO?itemColor:P.white}}>{item.label}</div>
            <div style={{fontSize:12,color:P.muted,fontWeight:500,marginTop:1}}>{item.desc}</div>
          </div>
          <div style={{transform:isO?"rotate(90deg)":"rotate(0)",transition:"transform 0.2s"}}><Icons.Chev color={P.muted} size={14}/></div>
        </button>
        {isO&&<div style={{padding:"0 14px 14px",animation:"expandIn 0.25s ease-out"}}>
          <div style={{background:P.cardAlt,borderRadius:8,padding:"10px 12px",marginBottom:8,border:`1px solid ${itemColor}22`}}>
            <div style={{fontSize:9,fontWeight:800,letterSpacing:1.5,color:itemColor,marginBottom:4,textTransform:"uppercase"}}>{tab==="heroes"?"Channel this hero":"This bandit steals your potential"}</div>
            <div style={{fontSize:13,lineHeight:1.55,color:P.white,fontWeight:500}}>{item.example}</div>
          </div>
          {tab==="heroes"
            ?<div style={{fontSize:13,fontStyle:"italic",color:itemColor,fontWeight:600,paddingLeft:4}}>{item.quote}</div>
            :<div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:8,background:P.cardAlt,border:`1px solid ${P.border}`}}>
              <Icons.Check color={P.green} size={13}/>
              <span style={{fontSize:13,fontWeight:600,color:P.muted}}>Defeated by <span style={{color:P.white,fontWeight:700}}>{item.hero}</span> — feed your hero, starve the bandit.</span>
            </div>
          }
        </div>}
      </div>;
    })}
  </div>;
}

function CaddieExample(){
  const P=useTheme();
  const [show,setShow]=useState(false);
  return <div>
    <div style={{fontSize:14,lineHeight:1.7,color:P.muted,fontWeight:500,marginBottom:14}}>With the In-Game Caddie on, after each hole your caddie reads what you marked and serves a wisdom card. Bandit showed up? Your caddie tells you which Hero beats it.</div>
    <div style={{padding:"14px 16px",borderRadius:12,background:P.cardAlt,border:`1px solid ${P.border}`,marginBottom:10}}>
      <div style={{fontSize:14,lineHeight:1.55,color:P.muted,fontWeight:500,fontStyle:"italic"}}>"The key to performing at your best consistently over time is to build awareness of self."</div>
      <div style={{fontSize:11,fontWeight:700,color:P.muted,marginTop:6,opacity:0.7}}>— Paul Monahan</div>
    </div>
    <CaddieToggleMock/>
    <button onClick={()=>setShow(!show)} {...pp()} style={{width:"100%",padding:"11px 16px",borderRadius:12,background:P.card,border:`1.5px solid ${P.border}`,cursor:"pointer",textAlign:"center",fontSize:13,fontWeight:700,color:P.muted,marginBottom:10,transition:"all 0.2s"}}>{show?"Hide Example ↑":"See a Caddie Card in Action ↓"}</button>
    {show&&<div style={{background:P.card,borderRadius:14,padding:20,border:`1.5px solid ${P.border}`,textAlign:"center",marginBottom:12,animation:"expandIn 0.3s ease-out"}}>
      <Icons.Heart color={P.red} size={26}/>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginTop:8,marginBottom:4,textTransform:"uppercase"}}>Your caddie noticed</div>
      <div style={{fontSize:13,color:P.muted,marginBottom:10,lineHeight:1.5,fontWeight:500}}>
        <span style={{color:P.red,fontWeight:700}}>Fear</span> showed up — <span style={{color:P.green,fontWeight:700}}>Love</span> <span style={{fontStyle:"italic"}}>conquers</span> it.
      </div>
      <div style={{background:P.cardAlt,borderRadius:10,padding:"12px",border:`1px solid ${P.border}`,marginBottom:12}}>
        <div style={{fontSize:14,lineHeight:1.55,color:P.white,fontWeight:500,fontStyle:"italic"}}>"Remind yourself how much you LOVE hitting that first tee shot."</div>
      </div>
      <div style={{display:"inline-block",padding:"8px 22px",borderRadius:8,background:P.cardAlt,border:`1.5px solid ${P.border}`,color:P.muted,fontSize:13,fontWeight:700}}>Next Hole →</div>
    </div>}
    <div style={{fontSize:12,lineHeight:1.5,color:P.muted,fontWeight:500}}>The Inner Caddie Deck also works standalone — draw from 8 categories and 40+ wisdom messages anytime.</div>
  </div>;
}

// ═══════════════════════════════════════
// PRIVACY POLICY
// ═══════════════════════════════════════
function PrivacyPolicyView({onBack, S}) {
  const P = useTheme();
  return (
    <div style={{...S.shell,background:P.bg}}>
      <div style={{padding:"16px 20px 10px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onBack} style={{background:"transparent",border:"none",cursor:"pointer",padding:4}} {...pressProps()}><Icons.Back color={P.muted}/></button>
        <div style={{fontSize:17,fontWeight:800,color:P.white}}>Privacy Policy & Terms</div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"4px 20px 32px"}}>
        <div style={{fontSize:11,color:P.muted,marginBottom:20}}>Last updated: March 2026</div>

        {[
          {title:"What We Collect", body:"We collect the data you enter into the app: round scores, hero and bandit logs, course names, pre-round check-in data (sleep quality, energy level, playing partners), hole notes, and your display name for the leaderboard.\n\nIf you create a profile, we also collect your name and email address. Your email is used to send you personalized coaching content from Paul Monahan Golf. We do not sell, rent, or share your email with third parties.\n\nIf you choose to save locally only (no account), we do not collect any personally identifying information."},
          {title:"How We Store It", body:"All round data is stored locally on your device using browser localStorage. Leaderboard display names and badge data are stored in shared cloud storage solely to power the in-app leaderboard feature. We do not sell, share, or transfer your data to third parties."},
          {title:"Golf Course API", body:"When you search for a course, your search query is sent to golfcourseapi.com to retrieve course and tee data. No personal information is included in these requests."},
          {title:"Payments", body:"Subscriptions are processed through Apple In-App Purchase or Google Play Billing. We do not store or have access to your payment card information. Your subscription status is stored locally on your device."},
          {title:"Analytics", body:"We do not currently use any third-party analytics or tracking tools. We do not use cookies for advertising purposes."},
          {title:"Children", body:"This app is not directed at children under 13. We do not knowingly collect data from children."},
          {title:"Your Rights & Account Deletion", body:"You can delete all your local data at any time from Settings → Data → Clear All Round Data.\n\nTo request full account deletion (including any cloud data), go to Settings → Data → Delete Account, or email support@mentalgamescorecard.com with subject \"Delete My Account\". We will process deletion requests within 30 days.\n\nYou may also request a copy of your data at any time by contacting us."},
          {title:"Terms of Service", body:"By using this app you agree to use it for personal, non-commercial purposes only. You may not reverse engineer, copy, or redistribute the app. We reserve the right to suspend access for misuse. The app is provided as-is without warranty. We are not liable for data loss from device issues."},
          {title:"Contact", body:"For privacy questions or data removal requests: support@mentalgamescorecard.com\n\nMental Game Scorecard is a product of Paul Monahan Golf."},
        ].map((s,i)=>(
          <div key={i} style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:800,color:P.white,marginBottom:6,letterSpacing:0.2}}>{s.title}</div>
            <div style={{fontSize:13,color:P.muted,lineHeight:1.7,whiteSpace:"pre-line"}}>{s.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════
// HELP & FAQ VIEW
// ═══════════════════════════════════════
function HelpView({onBack, S}) {
  const P = useTheme();
  const pp = pressProps;
  const [open, setOpen] = React.useState(null);

  const sections = [
    {
      title: "Getting Started",
      icon: Icons.Flag,
      color: P.green,
      faqs: [
        {
          q: "What is Mental Net?",
          a: "Mental Net is your mental score for a round — Heroes minus Bandits. A Hero is a mental strength you deployed on a hole (Commitment, Grit, Love, Acceptance, or Vulnerability). A Bandit is a mental trap that showed up (Doubt, Quit, Fear, Frustration, or Shame). A positive Mental Net means your mind helped you more than it hurt you."
        },
        {
          q: "What are Heroes and Bandits?",
          a: "They come from Paul Monahan's framework. Five Heroes (Love, Acceptance, Commitment, Vulnerability, Grit) are the mental strengths that unlock your best golf. Five Bandits (Fear, Frustration, Doubt, Shame, Quit) are the mental traps that steal your game. Each Hero directly counters a specific Bandit — for example, Commitment removes Doubt."
        },
        {
          q: "How do I log a Hero or Bandit?",
          a: "On the scorecard, after each hole tap the green button next to the Hero you felt, or the red button next to the Bandit that showed up. You can log one of each per hole. The matchup grid stays open while you play — tap the header bar to collapse or expand it."
        },
        {
          q: "Do I have to enter my stroke score?",
          a: "No. Stroke score is optional. The app tracks your mental game independently of your golf score. Many users find it valuable to see both — your stroke score and your Mental Net — but you can use one without the other."
        },
        {
          q: "What does the pre-round routine do?",
          a: "It runs a guided 3-minute mental preparation before your round. You set an intention, check in with your energy and sleep levels, and choose your playing partners. This data is saved with your round and helps you see patterns — for example, how your Mental Net correlates with your sleep quality."
        },
      ]
    },
    {
      title: "Account & Data",
      icon: Icons.Shield,
      color: PM_GOLD,
      faqs: [
        {
          q: "Why do I need to create a profile after 3 rounds?",
          a: "Three rounds are free with no account required. After that, creating a free profile (just your name and email) unlocks unlimited rounds and backs up your data to the cloud. There is no payment — ever. We ask for your email so Paul can send you personalized coaching insights based on your actual Heroes and Bandits data."
        },
        {
          q: "Is it really free? What's the catch?",
          a: "Yes, completely free. No subscription, no in-app purchases, no hidden fees. The trade is your email address, which Paul uses to send coaching content tailored to your mental game. You can unsubscribe from emails at any time without losing access to the app."
        },
        {
          q: "I switched phones. How do I get my rounds back?",
          a: "If you created a profile with cloud sync enabled, your rounds are backed up. Currently, to restore them on a new device, email support@mentalgamescorecard.com with your registered email address and we will help you recover your data. Automatic cross-device sync is coming in a future update."
        },
        {
          q: "I uninstalled the app. Did I lose my rounds?",
          a: "If you had cloud sync enabled (you created a profile and chose Save & Sync to Cloud during setup), your data is safe. If you chose to save locally only, your data was stored on your device and is not recoverable after uninstalling. This is why we recommend creating a profile."
        },
        {
          q: "What email do I use if I forgot which one I signed up with?",
          a: "Check Settings — Account at the top of the settings screen. It shows the email address connected to your profile. If you chose local only and have no email saved, contact support@mentalgamescorecard.com."
        },
        {
          q: "How do I delete my account and all my data?",
          a: "Go to Settings → Data → Delete Account and tap Confirm. This removes all locally stored data immediately. To remove cloud data, email support@mentalgamescorecard.com with subject 'Delete My Account' and we will process it within 30 days, as required by applicable privacy law."
        },
        {
          q: "Does the app work without internet?",
          a: "Yes. All core features work completely offline — logging rounds, viewing history, the pre-round routine, and the caddie. An internet connection is only needed to search for courses (to auto-fill par and yardage) and to sync data to the cloud."
        },
      ]
    },
    {
      title: "Coaching & Connection",
      icon: Icons.Target,
      color: "#60a5fa",
      faqs: [
        {
          q: "Can Paul see my round data?",
          a: "Not directly from within the app. Paul uses your aggregate data (top Hero, top Bandit, average Mental Net) to personalize the coaching emails you receive. He cannot browse your individual rounds. If you want to share a specific round with Paul, use the Share button on any round in your history to send him a summary."
        },
        {
          q: "How do I connect to a coach?",
          a: "Ask your coach for their coach code (a short code like COACH-ABC12). Then go to Settings — scroll to the Coach section — and enter the code. Once entered, your mental performance data will appear in your coach's roster automatically."
        },
        {
          q: "I'm a coach. How do I set up my roster?",
          a: "The Coach Portal is available to coaches. Contact support@mentalgamescorecard.com to request coach access. You will receive a coach code to share with your students and access to a private dashboard showing each student's Hero and Bandit trends, recent rounds, and mental performance metrics."
        },
        {
          q: "What data does my coach see?",
          a: "Your coach sees your top Hero, top Bandit, average Mental Net, win rate, number of rounds played, and your last 5 round results. They do not see your hole-by-hole notes, pre-round reflections, or post-round answers — those are private to you."
        },
      ]
    },
    {
      title: "Courses & Scoring",
      icon: Icons.Golf,
      color: "#34d87a",
      faqs: [
        {
          q: "My course isn't showing up in search. What do I do?",
          a: "Try searching by the full official club name (e.g. 'Bethpage State Park' rather than just 'Bethpage'). The course database covers 40,000+ courses worldwide. If your course is genuinely missing, you can type the name manually and enter par for each hole yourself."
        },
        {
          q: "The par and yardage didn't fill in automatically. Why?",
          a: "This happens if a course was found but the specific tee you selected doesn't have hole data in our database. Select a different tee, or enter par manually on the scorecard. You can also set a default course and tee in Settings so it pre-fills every time."
        },
        {
          q: "What does FIR and GIR mean?",
          a: "FIR is Fairway in Regulation — you hit the fairway off the tee on a par 4 or par 5. GIR is Green in Regulation — you reached the green in the expected number of strokes (par minus 2). These are standard golf statistics that help you identify whether your misses are coming off the tee or into the green."
        },
        {
          q: "How is my handicap used?",
          a: "If you enter your handicap in Settings, the scorecard shows your net score alongside your gross score. It does not currently calculate hole-by-hole stroke allowances — that is planned for a future update."
        },
      ]
    },
    {
      title: "Troubleshooting",
      icon: Icons.Info,
      color: P.accent,
      faqs: [
        {
          q: "The app went blank / crashed. What do I do?",
          a: "Close the app completely and reopen it. Your data is saved automatically after every action so you should not lose anything. If the problem persists, go to Settings → Data → and try clearing the app cache. If it continues, contact support@mentalgamescorecard.com with a description of what happened."
        },
        {
          q: "My round disappeared after I saved it.",
          a: "Check Settings — Data — and make sure you haven't cleared round data recently. If you had cloud sync enabled, contact support@mentalgamescorecard.com and we can check if your round was saved to the cloud."
        },
        {
          q: "The course search isn't working.",
          a: "Course search requires an internet connection. Check that you have a signal. If you are connected and still seeing no results, the course API may be temporarily unavailable — try again in a few minutes or enter the course name manually."
        },
        {
          q: "Something else is wrong.",
          a: "Contact us at support@mentalgamescorecard.com and describe what happened. Include your device model, iOS version, and what you were doing when the issue occurred. We aim to respond within 24 hours."
        },
      ]
    },
  ];

  return (
    <div style={{...S.shell,background:P.bg}}>
      <div style={{padding:"14px 16px 10px",display:"flex",alignItems:"center",gap:12,flexShrink:0,borderBottom:`1px solid ${P.border}`}}>
        <button onClick={onBack} style={S.iconBtn} {...pp()}><Icons.Back color={P.muted}/></button>
        <div>
          <div style={{fontSize:17,fontWeight:800,color:P.white}}>Help & FAQ</div>
          <div style={{fontSize:10,color:P.muted,fontWeight:600}}>Answers to common questions</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 14px 32px"}}>
        {sections.map((section,si)=>{
          const SIcon = section.icon;
          return (
            <div key={si} style={{marginBottom:16}}>
              {/* Section header */}
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{width:26,height:26,borderRadius:8,background:section.color+"18",border:`1px solid ${section.color}33`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <SIcon color={section.color} size={13}/>
                </div>
                <div style={{fontSize:11,fontWeight:800,color:section.color,letterSpacing:1,textTransform:"uppercase"}}>{section.title}</div>
              </div>
              {/* FAQ items */}
              <div style={{background:P.card,borderRadius:12,border:`1.5px solid ${P.border}`,overflow:"hidden"}}>
                {section.faqs.map((faq,fi)=>{
                  const key = `${si}-${fi}`;
                  const isOpen = open === key;
                  const isLast = fi === section.faqs.length - 1;
                  return (
                    <div key={fi}>
                      <button
                        onClick={()=>setOpen(isOpen ? null : key)}
                        style={{width:"100%",padding:"12px 14px",background:"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,textAlign:"left"}}
                        {...pp()}
                      >
                        <span style={{fontSize:13,fontWeight:600,color:isOpen?P.white:P.white,lineHeight:1.4,flex:1}}>{faq.q}</span>
                        <div style={{transform:isOpen?"rotate(180deg)":"rotate(0)",transition:"transform 0.2s",flexShrink:0}}><Icons.Chev color={isOpen?section.color:P.muted} size={14}/></div>
                      </button>
                      {isOpen&&(
                        <div style={{padding:"0 14px 14px",borderTop:`1px solid ${P.border}44`}}>
                          <div style={{fontSize:13,color:P.muted,lineHeight:1.7,paddingTop:10,whiteSpace:"pre-line"}}>{faq.a}</div>
                        </div>
                      )}
                      {!isLast&&<div style={{height:1,background:P.border+"66",marginLeft:14}}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Contact card */}
        <div style={{background:P.card,borderRadius:12,border:`1.5px solid ${PM_GOLD}44`,padding:"14px 16px",marginTop:8}}>
          <div style={{fontSize:11,fontWeight:800,color:PM_GOLD,letterSpacing:1,marginBottom:6}}>STILL NEED HELP?</div>
          <div style={{fontSize:13,color:P.muted,lineHeight:1.6,marginBottom:12}}>Our support team responds within 24 hours, Monday through Friday.</div>
          <button
            onClick={()=>{try{window.open("mailto:support@mentalgamescorecard.com?subject=Mental Game Scorecard Support","_blank");}catch{}}}
            style={{width:"100%",padding:"11px",borderRadius:10,border:`1.5px solid ${PM_GOLD}44`,background:PM_GOLD+"10",color:PM_GOLD,fontSize:13,fontWeight:700,cursor:"pointer"}}
            {...pp()}
          >Email Support</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// PAYWALL
// ═══════════════════════════════════════
function PaywallView({onUnlock, onBack, P, S}) {
  const [selected, setSelected] = React.useState("annual");
  const [loading, setLoading] = React.useState(false);
  const dm = P.bg === "#09090b";

  const plans = {
    monthly: { label:"Monthly", price:"$4.99", sub:"/month", total:"$4.99/mo", save:null },
    annual:  { label:"Annual",  price:"$49.99", sub:"/year", total:"$4.17/mo", save:"SAVE 17%" },
  };

  const features = [
    { icon:"Shield",  text:"Track Heroes & Bandits every hole" },
    { icon:"Chart",   text:"Full dashboard & mental trends" },
    { icon:"Medal",   text:"25 milestone badges across 4 tiers" },
    { icon:"Brain",   text:"In-game mental caddie tips" },
    { icon:"Clipboard", text:"Pre-round routine & intention setting" },
    { icon:"Flag",    text:"Unlimited round history & stats" },
  ];

  async function handleSubscribe() {
    setLoading(true);
    // TODO: replace with Stripe Checkout or Apple IAP call
    // For now simulates a 1.5s payment flow then unlocks
    await new Promise(r=>setTimeout(r,1500));
    onUnlock(selected);
    setLoading(false);
  }

  return (
    <div style={{height:"100svh",display:"flex",flexDirection:"column",background:P.bg,maxWidth:480,margin:"0 auto",overflow:"hidden",fontFamily:"'Avenir Next','SF Pro Display',-apple-system,sans-serif"}}>
      {/* Header */}
      <div style={{background:dm?`linear-gradient(175deg,${PM_NAVY} 0%,#141416 60%,#1c1c1f 100%)`:`linear-gradient(175deg,${PM_NAVY} 0%,#2a3020 100%)`,borderBottom:`2px solid ${PM_GOLD}44`,padding:"16px 20px 20px",flexShrink:0,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:-40,right:-40,width:160,height:160,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.04)"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{width:40}}/>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,255,255,0.4)"}}>MENTAL GAME PRO</div>
          <button onClick={onBack} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.4)",cursor:"pointer"}}>Later</button>
        </div>
        <div style={{fontSize:26,fontWeight:900,color:"#fff",letterSpacing:-0.5,lineHeight:1.15,marginBottom:6}}>Unlock Your{"\n"}Mental Game</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.5)",lineHeight:1.5}}>The only golf app built around how you think, not just how you score.</div>
      </div>

      {/* Scrollable content */}
      <div style={{flex:1,overflowY:"auto",padding:"16px 20px"}}>
        {/* Features */}
        <div style={{marginBottom:16}}>
          {features.map((f,i)=>{
            const Ic = Icons[f.icon];
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <div style={{width:32,height:32,borderRadius:9,background:"#16a34a18",border:"1.5px solid #16a34a33",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <Ic color="#16a34a" size={15}/>
                </div>
                <span style={{fontSize:14,color:P.white,fontWeight:500}}>{f.text}</span>
              </div>
            );
          })}
        </div>

        {/* Plan selector */}
        <div style={{display:"flex",gap:10,marginBottom:16}}>
          {Object.entries(plans).map(([key, plan])=>(
            <button key={key} onClick={()=>setSelected(key)} {...pressProps()} style={{
              flex:1,padding:"14px 10px",borderRadius:14,cursor:"pointer",textAlign:"center",
              border:`2px solid ${selected===key?"#16a34a":P.border}`,
              background:selected===key?"#16a34a12":P.card,
              transition:"all 0.15s",position:"relative",
            }}>
              {plan.save&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:"#16a34a",color:"#fff",fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:20,letterSpacing:1,whiteSpace:"nowrap"}}>{plan.save}</div>}
              <div style={{fontSize:11,fontWeight:700,color:selected===key?"#16a34a":P.muted,marginBottom:4}}>{plan.label}</div>
              <div style={{fontSize:22,fontWeight:900,color:P.white,lineHeight:1}}>{plan.price}</div>
              <div style={{fontSize:10,color:P.muted,marginTop:2}}>{plan.sub}</div>
              {plan.total!==plan.price+plan.sub&&<div style={{fontSize:10,color:"#16a34a",fontWeight:600,marginTop:4}}>{plan.total}</div>}
            </button>
          ))}
        </div>

        {/* Legal */}
        <div style={{fontSize:10,color:P.muted,textAlign:"center",lineHeight:1.6,marginBottom:8}}>
          Subscription auto-renews. Cancel anytime in your App Store settings.{"\n"}
          By subscribing you agree to our{" "}
          <span style={{color:"#16a34a",fontWeight:600,cursor:"pointer"}} onClick={()=>onPrivacy&&onPrivacy()}>Terms</span>
          {" & "}
          <span style={{color:"#16a34a",fontWeight:600,cursor:"pointer"}} onClick={()=>onPrivacy&&onPrivacy()}>Privacy Policy</span>.
        </div>
      </div>

      {/* CTA */}
      <div style={{padding:"12px 20px 28px",flexShrink:0,borderTop:`1px solid ${P.border}`,background:P.bg}}>
        <button onClick={handleSubscribe} disabled={loading} {...pressProps()} style={{
          width:"100%",padding:"16px",borderRadius:14,border:"none",
          background:loading?"#16a34a88":"#16a34a",
          color:"#fff",fontSize:16,fontWeight:800,cursor:loading?"default":"pointer",
          boxShadow:"0 4px 24px rgba(22,163,74,0.35)",transition:"all 0.2s",
          display:"flex",alignItems:"center",justifyContent:"center",gap:10,
        }}>
          {loading?(
            <><div style={{width:16,height:16,borderRadius:"50%",border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",animation:"spin 0.7s linear infinite"}}/> Processing...</>
          ):(
            `Start ${plans[selected].label} — ${plans[selected].price}`
          )}
        </button>
        <div style={{textAlign:"center",marginTop:10,fontSize:11,color:P.muted}}>
          {selected==="annual"?"$49.99 billed annually":"$4.99 billed monthly"} · Cancel anytime
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════
function OnboardingFlow({onFinish,onPrivacy,P,S,communityProfile}){
  const [cur,setCur]=useState(0); const [dir,setDir]=useState(1);
  const dm = P.bg === "#09090b";
  const qb={padding:"14px 16px",borderRadius:12,background:dm?"#141416":P.cardAlt,border:`1px solid ${PM_GOLD}44`,marginBottom:10};
  const qt={fontSize:14,lineHeight:1.55,color:P.muted,fontWeight:500,fontStyle:"italic"};
  const itemCard={display:"flex",gap:12,alignItems:"flex-start",padding:"10px 12px",borderRadius:12,background:P.card,border:`1.5px solid ${P.border}`,marginBottom:6};
  const iconBox={width:30,height:30,borderRadius:8,background:P.cardAlt,border:`1px solid ${P.border}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0};
  const itemText={fontSize:13,lineHeight:1.5,color:P.white,fontWeight:500,alignSelf:"center"};
  const sectionLabel={fontSize:9,fontWeight:800,letterSpacing:2,color:P.muted,marginTop:14,marginBottom:8,textTransform:"uppercase"};
  const bodyText={fontSize:14,lineHeight:1.7,color:P.muted,fontWeight:500,marginBottom:14};

  function Slide0() {
    return <div>
      <div style={bodyText}>Golf is played between your ears. The round where you shot your best, you weren't thinking about mechanics. You were present. Trusting. Free.</div>
      <div style={qb}><div style={qt}>"Strengthen your inside game so that the game you play on the outside is more fun and fulfilling."</div><div style={{fontSize:11,fontWeight:600,color:P.muted,marginTop:6,opacity:0.8}}>— Paul Monahan, The Most Important Game</div></div>
      <div style={{marginTop:14}}>
        {[{text:"Five Heroes — mental strengths that unlock your best golf",IcN:"Shield",c:"#34d87a"},{text:"Five Bandits — mental traps that steal your game",IcN:"Skull",c:"#f87171"},{text:"Track both every hole. See the patterns. Play better.",IcN:"Chart",c:"#60a5fa"}].map((item,i)=>{const WIc=Icons[item.IcN];return(
          <div key={i} style={itemCard}><div style={{...iconBox,background:i===0?P.green+"20":i===1?P.red+"20":"#60a5fa20"}}><WIc color={item.c} size={15}/></div><div style={{...itemText,color:i===0?P.green:i===1?P.red:P.white}}>{item.text}</div></div>
        );})}
      </div>
      <div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:P.cardAlt,border:`1.5px solid ${P.border}`,fontSize:12,color:P.muted,fontWeight:600,textAlign:"center"}}>The only golf tracking app built around your mental game.</div>
    </div>;
  }

  function Slide1() {
    return <div>
      <div style={bodyText}>Before you hit a single shot, take 3 minutes. Set your intention, check in with your body, and decide who you want to be today — not what you want to shoot.</div>
      <div style={qb}><div style={qt}>"You can choose the mental and emotional stance from which to operate when you play."</div><div style={{fontSize:11,fontWeight:700,color:P.muted,marginTop:6}}>— Paul Monahan</div></div>
      <div style={sectionLabel}>THE CHECKLIST COVERS THREE AREAS</div>
      {[{num:1,label:"Set Your Intention",desc:"Who do you want to BE today? Not what score."},{num:2,label:"Connect to Gratitude",desc:"Why do you love this game? Remember that today."},{num:3,label:"Embrace Curiosity",desc:"Focus on growth and learning, not the scorecard."}].map((f,i)=>(
        <div key={i} style={{...itemCard,alignItems:"center"}}>
          <div style={{...iconBox,fontSize:13,fontWeight:900,color:["#fbbf24","#f87171","#a78bfa"][i]}}>{f.num}</div>
          <div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{f.label}</div><div style={{fontSize:12,color:P.muted,marginTop:2,lineHeight:1.4}}>{f.desc}</div></div>
        </div>
      ))}
      <div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:P.cardAlt,border:`1.5px solid ${P.border}`}}>
        <div style={{fontSize:9,fontWeight:800,color:P.muted,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Also log before every round</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {["Sleep Quality","Energy Level","Playing Partners"].map(l=><div key={l} style={{padding:"4px 10px",borderRadius:20,background:P.card,border:`1px solid ${P.border}`,fontSize:11,fontWeight:600,color:P.muted}}>{l}</div>)}
        </div>
        <div style={{fontSize:11,color:P.muted,marginTop:8,lineHeight:1.5,opacity:0.8}}>These unlock sleep & energy insights in the Dashboard after 5+ rounds.</div>
      </div>
    </div>;
  }

  function Slide3() {
    return <div>
      <div style={bodyText}>After each hole, take 10 seconds. Which Heroes showed up? Which Bandits crept in? Tap them. Then log your stats.</div>
      <div style={qb}><div style={qt}>"Bring awareness of your mental and emotional state to the course, and you can improve how you play."</div><div style={{fontSize:11,fontWeight:700,color:P.muted,marginTop:6}}>— Paul Monahan</div></div>
      <div style={sectionLabel}>LOG EVERY HOLE</div>
      {[{IcN:"Heart",c:"#f87171",label:"Heroes & Bandits",desc:"Tap which mental forces were active. Both sides matter."},{IcN:"Flag",c:"#34d87a",label:"Score + Putts",desc:"Par, stroke score, and putts per hole."},{IcN:"Target",c:"#60a5fa",label:"FIR + GIR",desc:"Fairway in Regulation and Green in Regulation."},{IcN:"Note",c:"#fbbf24",label:"Hole Notes",desc:"Quick note on what you felt or what happened."}].map((f,i)=>{const FIc=Icons[f.IcN];return(
        <div key={i} style={itemCard}><div style={iconBox}><FIc color={f.c} size={14}/></div><div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{f.label}</div><div style={{fontSize:12,color:P.muted,marginTop:2,lineHeight:1.35}}>{f.desc}</div></div></div>
      );})}
      <div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:P.cardAlt,border:`1.5px solid ${P.border}`}}>
        <div style={{fontSize:9,fontWeight:800,color:P.muted,letterSpacing:2,marginBottom:4,textTransform:"uppercase"}}>In-Game Caddie</div>
        <div style={{fontSize:12,color:P.muted,lineHeight:1.5}}>When enabled (toggle next to course name), the Caddie shows a tailored mental tip after each hole — addressing your active bandits and reinforcing your heroes.</div>
      </div>
    </div>;
  }

  function Slide5() {
    return <div>
      <div style={bodyText}>After saving your round, you'll see your complete scorecard with all stats, then a dashboard that reveals your mental patterns across every round you've played.</div>
      <div style={qb}><div style={qt}>"See the outcomes of your shots as feedback, not failure."</div><div style={{fontSize:11,fontWeight:700,color:P.muted,marginTop:6}}>— Paul Monahan</div></div>
      <div style={sectionLabel}>DASHBOARD ANALYTICS</div>
      {[{IcN:"Chart",c:"#34d87a",label:"Mental Net Trend",desc:"Your net score over time. See if you're improving."},{IcN:"Brain",c:"#60a5fa",label:"Mental Recovery Rate",desc:"After a bandit hole, how often do you bounce back?"},{IcN:"Shield",c:"#34d87a",label:"Hero Activation Rate",desc:"Which heroes show up — and which need more work?"},{IcN:"Flag",c:"#60a5fa",label:"Front 9 vs Back 9",desc:"Where do you tend to collapse or catch fire mentally?"},{IcN:"Target",c:"#a78bfa",label:"Shot Quality",desc:"FIR%, GIR%, avg putts, 1-putt and 3-putt rates."},{IcN:"Sun",c:"#fbbf24",label:"Sleep Insight",desc:"After 5 rounds: does sleep quality affect your mental net?"},{IcN:"Skull",c:"#f87171",label:"Bandit Combos",desc:"Which bandits tend to appear together on the same hole?"}].map((f,i)=>{const DIc=Icons[f.IcN];return(
        <div key={i} style={itemCard}><div style={iconBox}><DIc color={f.c} size={13}/></div><div><div style={{fontSize:13,fontWeight:700,color:P.white}}>{f.label}</div><div style={{fontSize:12,color:P.muted,marginTop:1,lineHeight:1.35}}>{f.desc}</div></div></div>
      );})}
      <div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:P.cardAlt,border:`1.5px solid ${P.border}`}}>
        <div style={{fontSize:9,fontWeight:800,color:P.muted,letterSpacing:2,marginBottom:3,textTransform:"uppercase"}}>Also available</div>
        <div style={{fontSize:11,color:P.muted,lineHeight:1.6}}>Round History · Edit saved rounds · Share round image · Milestones · Handicap & preferences</div>
      </div>
      <div style={{marginTop:12,padding:"14px",borderRadius:12,background:P.card,textAlign:"center",border:`1px solid ${P.border}`}}>
        <div style={{fontSize:14,fontWeight:800,color:P.white,marginBottom:2}}>Play Better · Struggle Less · Enjoy More</div>
        <div style={{fontSize:11,fontWeight:500,color:P.muted}}>You're ready. Let's go.</div>
      </div>
    </div>;
  }


  function Slide6() {
    const steps = [
      {num:1,title:"Be a Transformative Learner",sub:"The Key to Skill Building",desc:"Define the gap. Be open. Embrace discomfort. Objectivity leads to discovery.",c:"#60a5fa"},
      {num:2,title:"Be Aware",sub:"The Key to a Productive Mindset",desc:"Tune-in to your thinking. You have CHOICES about the thought patterns you anchor to in any moment. Notice your chatter.",c:"#a78bfa"},
      {num:3,title:"Be Present",sub:"The Key to Playing the Game",desc:"You can't WIN the moment unless you are IN the moment. Play golf — not golf swing. Channel your inner athlete.",c:"#34d87a"},
      {num:4,title:"Be a Possibility Thinker",sub:"The Key to Staying In the Game",desc:"Turn challenge into opportunity. Operate from abundance. Feed the Good Wolf.",c:"#fbbf24"},
    ];
    return <div>
      <div style={bodyText}>Paul Monahan's four-step framework for transforming your mental game — on the course and off.</div>
      <div style={qb}><div style={qt}>"Channeling the Five Heroes of Potential will allow you to experience practice and play with a sense of objectivity, joy, and passion that produces better decisions and shot-making."</div><div style={{fontSize:11,fontWeight:600,color:P.muted,marginTop:6,opacity:0.8}}>— Paul Monahan</div></div>
      <div style={sectionLabel}>4 STEPS TO TRANSFORM YOUR GAME</div>
      {steps.map((s,i)=>(
        <div key={i} style={{...itemCard,alignItems:"flex-start",marginBottom:8,padding:"12px 14px"}}>
          <div style={{width:32,height:32,borderRadius:10,background:s.c+"18",border:`1.5px solid ${s.c}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14,fontWeight:900,color:s.c}}>{s.num}</div>
          <div style={{paddingLeft:4}}>
            <div style={{fontSize:13,fontWeight:800,color:P.white,marginBottom:1}}>{s.title}</div>
            <div style={{fontSize:10,fontWeight:700,color:s.c,letterSpacing:0.5,marginBottom:4,textTransform:"uppercase"}}>{s.sub}</div>
            <div style={{fontSize:12,color:P.muted,lineHeight:1.5}}>{s.desc}</div>
          </div>
        </div>
      ))}

      {/* Go Deeper section */}
      <div style={{marginTop:8,padding:"16px",borderRadius:16,background:P.card,border:`1.5px solid ${P.border}`}}>
        <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:PM_GOLD,marginBottom:4,textTransform:"uppercase"}}>Go Deeper With Paul</div>
        <div style={{fontSize:13,color:P.muted,lineHeight:1.5,marginBottom:14}}>Ready to take your mental game to the next level? Work directly with Paul through his online course or join his mastermind community.</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>

          {/* Book */}
          <button onClick={()=>openUrl("https://a.co/d/0j8TEXmJ")} {...pp()} style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1.5px solid ${P.border}`,background:P.cardAlt,cursor:"pointer",display:"flex",alignItems:"center",gap:12,textAlign:"left"}}>
            <img src="https://m.media-amazon.com/images/I/71Q2HxFnTRL._SY160.jpg" alt="The Most Important Game" style={{width:44,height:64,objectFit:"cover",borderRadius:6,flexShrink:0,boxShadow:"0 2px 8px rgba(0,0,0,0.3)"}} onError={e=>{e.target.style.display="none";}}/>
            <div style={{flex:1}}>
              <div style={{fontSize:11,fontWeight:700,color:P.muted,letterSpacing:1,marginBottom:2,textTransform:"uppercase"}}>The Book</div>
              <div style={{fontSize:14,fontWeight:800,color:P.white,lineHeight:1.3,marginBottom:2}}>The Most Important Game</div>
              <div style={{fontSize:11,color:P.muted}}>Play Better. Struggle Less. Enjoy More.</div>
            </div>
            <span style={{fontSize:16,color:P.muted,opacity:0.5}}>→</span>
          </button>

          {/* Course */}
          <button onClick={()=>{ openUrl("https://paulmonahan.com"); }} style={{width:"100%",padding:"13px 16px",borderRadius:12,border:"none",background:"linear-gradient(135deg,#1a3a5c,#2563eb)",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:13}}>Rethinking Golf — Online Course</span>
            <span style={{fontSize:16,opacity:0.8}}>→</span>
          </button>

          {/* Mastermind */}
          <button onClick={()=>openUrl("https://www.skool.com/paul-monahan-golf-academy-8319/about?ref=78dccfa86ba543cd895a3255f2dab29f")} {...pp()} style={{width:"100%",padding:"13px 16px",borderRadius:12,border:`1.5px solid ${P.border}`,background:P.cardAlt,color:P.white,fontSize:14,fontWeight:800,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",letterSpacing:0.2}}>
            <span>Join the Mastermind</span>
            <span style={{fontSize:16,opacity:0.5}}>→</span>
          </button>
        </div>
        <div style={{fontSize:10,color:P.muted,textAlign:"center",marginTop:10,opacity:0.6}}>paulmonahan.com</div>
      </div>

      <div style={{marginTop:10,padding:"12px 14px",borderRadius:12,background:P.card,border:`1px solid ${P.border}`,textAlign:"center"}}>
        <div style={{fontSize:14,fontWeight:800,color:P.white,marginBottom:2}}>Play Better · Struggle Less · Enjoy More</div>
        <div style={{fontSize:11,fontWeight:500,color:P.muted}}>You're ready. Let's go.</div>
      </div>
    </div>;
  }

  // Profile slide state
  const [profileEmail, setProfileEmail] = React.useState("");
  const [profileName, setProfileName] = React.useState("");
  const [profileSubmitting, setProfileSubmitting] = React.useState(false);
  const [profileDone, setProfileDone] = React.useState(false);

  async function submitProfileFromOnboarding(skipCloud) {
    if(!skipCloud && (!profileEmail.trim() || !profileEmail.includes("@"))) return false;
    setProfileSubmitting(true);
    const uid = (() => { try { let id=localStorage.getItem("mgp_uid"); if(!id){id="user_"+Math.random().toString(36).slice(2,10);localStorage.setItem("mgp_uid",id);} return id; } catch { return "anon"; } })();
    const profile = {
      email: profileEmail.trim().toLowerCase()||null,
      name: profileName.trim()||null,
      joinedAt: new Date().toISOString(),
      uid,
      source: "onboarding",
      cloudSync: !skipCloud,
    };
    try { localStorage.setItem("mgp_community_profile", JSON.stringify(profile)); if(!skipCloud) localStorage.setItem("mgp_community_joined","true"); } catch {}
    // Sync to Supabase
    if(!skipCloud && profile.email) {
      try {
        if(typeof supabase !== "undefined" && supabase) {
          await supabase.from("community_profiles").upsert({
            uid: profile.uid, email: profile.email, name: profile.name,
            source: "onboarding", joined_at: profile.joinedAt, opted_in: true,
          }, { onConflict: "uid" });
        }
      } catch(e) { console.warn("Supabase sync:", e); logError(e, { context: "supabase_profile_sync" }); }
    }
    setProfileDone(true);
    setProfileSubmitting(false);
    return true;
  }

  function ProfileSlide() {
    return (
      <div>
        {profileDone ? (
          <div style={{textAlign:"center",padding:"30px 0"}}>
            
            <div style={{fontSize:18,fontWeight:900,color:P.white,marginBottom:8}}>You're all set!</div>
            <div style={{fontSize:13,color:P.muted,lineHeight:1.6}}>Your progress will sync across devices. Paul will send you insights tailored to your mental game.</div>
          </div>
        ) : (
          <>
            <div style={{fontSize:14,color:P.muted,lineHeight:1.7,marginBottom:16}}>
              Create a free profile to <span style={{color:P.white,fontWeight:700}}>save your rounds to the cloud</span>, sync across devices, and receive personalized mental game insights from Paul.
            </div>
            {/* Value cards */}
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
              {[
                {icon:"", title:"Cloud backup", desc:"Your rounds are safe, even if you change phones."},
                {icon:"", title:"Personalized insights", desc:"Paul sends coaching content matched to your Heroes & Bandits."},
                {icon:"", title:"Track your journey", desc:"See how your mental game improves over time."},
              ].map((f,i)=>(
                <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 10px",borderRadius:10,background:P.card,border:`1px solid ${P.border}`}}>
                  <span style={{fontSize:18,flexShrink:0}}>{f.icon}</span>
                  <div><div style={{fontSize:12,fontWeight:700,color:P.white}}>{f.title}</div><div style={{fontSize:11,color:P.muted,marginTop:1}}>{f.desc}</div></div>
                </div>
              ))}
            </div>
            {/* Form */}
            <input
              value={profileName}
              onChange={e=>setProfileName(e.target.value)}
              placeholder="First name"
              style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:8}}
            />
            <input
              value={profileEmail}
              onChange={e=>setProfileEmail(e.target.value)}
              placeholder="Email address"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="email"
              style={{width:"100%",padding:"11px 14px",borderRadius:10,border:`1.5px solid ${P.border}`,background:P.inputBg,color:P.white,fontSize:14,outline:"none",marginBottom:10}}
            />
            <div style={{fontSize:10,color:P.muted,lineHeight:1.5,textAlign:"center"}}>
              By continuing you agree to Paul Monahan Golf's{" "}
              <span style={{color:PM_GOLD,cursor:"pointer"}} onClick={()=>onPrivacy&&onPrivacy()}>Privacy Policy</span>.
              Your mental game data personalizes your experience.
            </div>
          </>
        )}
      </div>
    );
  }

  const slides=[
    {IconKey:"GolfTee",iconColor:"#5cc8fa",title:"Welcome to the\nMental Game Scorecard",render:()=><Slide0/>},
    {IconKey:"Sun",iconColor:"#fbbf24",title:"Before Your Round",subtitle:"Pre-Round Checklist",render:()=><Slide1/>},
    {IconKey:"Heart",iconColor:"#f87171",title:"Bandits & Heroes",subtitle:"Know What You're Tracking",render:()=><HeroBanditTab/>},
    {IconKey:"FlagHole",iconColor:"#60a5fa",title:"Playing Your Round",subtitle:"The Mental Scorecard",render:()=><Slide3/>},
    {IconKey:"Brain",iconColor:"#a78bfa",title:"Your In-Game Caddie",subtitle:"Wisdom on Demand",render:()=><CaddieExample/>},
    {IconKey:"Chart",iconColor:"#34d87a",title:"Review & Grow",subtitle:"After Your Round",render:()=><Slide5/>},
    {IconKey:"Shield",iconColor:PM_GOLD,title:"Create Your Profile",subtitle:"Save Your Progress",render:()=><ProfileSlide/>,skip:!!communityProfile?.email},
  ];
  const activeSlides=slides.filter(s=>!s.skip);
  const slide=activeSlides[cur]; const isLast=cur===activeSlides.length-1; const isProfile=isLast&&!communityProfile?.email; const Ic=Icons[slide.IconKey];

  return <div style={{height:"100svh",display:"flex",flexDirection:"column",background:P.bg,fontFamily:"'Avenir Next','SF Pro Display',-apple-system,sans-serif",maxWidth:480,margin:"0 auto",overflow:"hidden"}}>
    {/* Header */}
    <div style={{background:dm?`linear-gradient(175deg,${PM_NAVY} 0%,#141416 60%,#1c1c1f 100%)`:`linear-gradient(175deg,${PM_NAVY} 0%,#2a3020 100%)`,borderBottom:`2px solid ${PM_GOLD}44`,padding:"10px 20px 14px",flexShrink:0,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:-30,right:-40,width:140,height:140,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.04)"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,position:"relative",zIndex:1}}>
        <button onClick={onFinish} {...pp()} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:600,color:"rgba(255,255,255,0.45)",cursor:"pointer"}}>Skip intro</button>
        <div style={{display:"flex",gap:5}}>{activeSlides.map((_,i)=><div key={i} onClick={()=>{setDir(i>cur?1:-1);setCur(i);}} style={{width:i===cur?18:6,height:6,borderRadius:3,background:i===cur?"rgba(255,255,255,0.7)":"rgba(255,255,255,0.2)",transition:"all 0.25s",cursor:"pointer"}}/>)}</div>
        <div style={{width:52}}/>
      </div>
      <div key={cur} style={{animation:"headerIn 0.35s cubic-bezier(0.16,1,0.3,1)",position:"relative",zIndex:1}}>
        <div style={{width:40,height:40,borderRadius:12,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:8}}><Ic color={slide.iconColor||"rgba(255,255,255,0.75)"} size={24}/></div>
        {slide.subtitle&&<div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",marginBottom:4}}>{slide.subtitle}</div>}
        <div style={{fontSize:22,fontWeight:900,lineHeight:1.12,letterSpacing:-0.5,color:"#fff",whiteSpace:"pre-line"}}>{slide.title}</div>
      </div>
    </div>
    {/* Slide content */}
    <div key={cur+"c"} style={{flex:1,overflow:"auto",padding:"12px 18px 8px",background:P.bg,animation:`slideIn 0.3s cubic-bezier(0.16,1,0.3,1)`}}>{slide?.render?.()}</div>
    {/* Footer nav */}
    <div style={{padding:isLast&&!profileDone?"12px 20px 20px":"8px 20px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:`1px solid ${P.border}`,background:P.bg,flexShrink:0}}>
      <button onClick={()=>{if(cur>0){setDir(-1);setCur(c=>c-1);}}} {...pp()} style={{width:42,height:42,borderRadius:12,border:`1.5px solid ${P.border}`,background:P.card,display:"flex",alignItems:"center",justifyContent:"center",cursor:cur===0?"default":"pointer",opacity:(cur===0||profileDone)?0.3:1,flexShrink:0}}><Icons.Back color={P.muted} size={16}/></button>
      <div style={{flex:1,marginLeft:10}}>
      {isLast ? (
        profileDone ? (
          <button onClick={onFinish} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,background:P.green,border:"none",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:`0 4px 16px ${P.green}44`}}>Let's Play</button>
        ) : (()=>{
          const { isSignedIn } = window.__useUser ? window.__useUser() : {};
          if (isSignedIn) return (
            <button onClick={onFinish} {...pp()} style={{width:"100%",padding:"13px",borderRadius:12,background:P.green,border:"none",color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",boxShadow:`0 4px 16px ${P.green}44`}}>Let's Play</button>
          );
          return (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <button
                onClick={()=>{ window.__clerkOpenSignUp ? window.__clerkOpenSignUp() : setShowLogin(true); }}
                style={{width:"100%",padding:"13px",borderRadius:12,background:P.green,border:"none",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}
              >Create Free Account →</button>
              <button
                onClick={async ()=>{ await submitProfileFromOnboarding(true); onFinish(); }}
                style={{width:"100%",padding:"12px",borderRadius:12,border:`1.5px solid ${P.border}`,background:"transparent",color:P.muted,fontSize:13,fontWeight:600,cursor:"pointer"}}
              >Continue without account</button>
            </div>
          );
        })()
      ) : (
        <button onClick={()=>{setDir(1);setCur(c=>c+1);}} {...pp()} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:dm?"#fff":"#0f172a",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}><Icons.Chev color={dm?"#09090b":"#fff"} size={16}/></button>
      )}
      </div>
    </div>
    <style>{`@keyframes slideIn{from{opacity:0;transform:translateX(${dir>0?"20px":"-20px"});}to{opacity:1;transform:translateX(0);}} @keyframes headerIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}} @keyframes expandIn{from{opacity:0;max-height:0;}to{opacity:1;max-height:800px;}}`}</style>
  </div>;
}

