// main.jsx — App entry point
// Place at: src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient, useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import App from './mental-game-scorecard.jsx';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Sentry
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'production',
    release: import.meta.env.VITE_APP_VERSION || '1.0.0',
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    beforeSend(event) {
      if (event.user) delete event.user.email;
      return event;
    },
  });
  window.__sentryCapture = (error, context) => {
    Sentry.captureException(error, { extra: context });
  };
}

// ─── Convex Bridge ──────────────────────────────────────────
// Subscribes to the user's cloud rounds and settings, and exposes
// mutation helpers as window globals that the app calls.
function ConvexBridge() {
  const { isSignedIn } = useUser();

  const rounds   = useQuery(api.rounds.getRounds,   isSignedIn ? {} : "skip");
  const settings = useQuery(api.settings.getSettings, isSignedIn ? {} : "skip");

  const upsertRoundMut        = useMutation(api.rounds.upsertRound);
  const bulkUpsertRoundsMut   = useMutation(api.rounds.bulkUpsertRounds);
  const deleteRoundMut        = useMutation(api.rounds.deleteRound);
  const upsertSettingsMut     = useMutation(api.settings.upsertSettings);

  React.useEffect(() => {
    // Expose data to the app
    window.__convexRounds   = rounds ?? null;
    window.__convexSettings = settings ?? null;
    window.__convexReady    = isSignedIn && rounds !== undefined;

    // Expose mutations to the app
    window.__convexUpsertRound = (round) => {
      if (!isSignedIn) return;
      upsertRoundMut(round).catch(e => console.error('convexUpsertRound', e));
    };

    window.__convexBulkUpsertRounds = (rounds) => {
      if (!isSignedIn || !rounds?.length) return;
      bulkUpsertRoundsMut({ rounds }).catch(e => console.error('convexBulkUpsert', e));
    };

    window.__convexDeleteRound = (roundId) => {
      if (!isSignedIn || !roundId) return;
      deleteRoundMut({ roundId }).catch(e => console.error('convexDeleteRound', e));
    };

    window.__convexUpsertSettings = (data, carryForward) => {
      if (!isSignedIn) return;
      upsertSettingsMut({ data, carryForward }).catch(e => console.error('convexUpsertSettings', e));
    };

    // Dispatch an event so the app re-checks Convex data
    window.dispatchEvent(new Event('convex_ready'));
  });

  return null;
}

// ─── Clerk Bridge ───────────────────────────────────────────
function ClerkBridge() {
  const { openSignUp, openSignIn, openUserProfile, signOut } = useClerk();
  const { user, isSignedIn, isLoaded } = useUser();
  const appUrl = window.location.origin;

  React.useEffect(() => {
    window.__clerkOpenSignIn = () => openSignIn({
      forceRedirectUrl: appUrl,
      fallbackRedirectUrl: appUrl,
    });
    window.__clerkOpenSignUp = () => openSignUp({
      forceRedirectUrl: appUrl,
      fallbackRedirectUrl: appUrl,
    });
    window.__clerkOpenUserProfile = () => openUserProfile({});
    window.__clerkSignOut = () => signOut(() => { window.location.reload(); });
    window.__useUser = () => ({ user, isSignedIn, isLoaded });
  });

  return null;
}

// ─── Clerk appearance ───────────────────────────────────────
function getClerkAppearance(dark) {
  const bg       = dark ? "#09090b" : "#ffffff";
  const card     = dark ? "#18181b" : "#ffffff";
  const border   = dark ? "#3f3f46" : "#d4d4d8";
  const text     = dark ? "#f8fafc" : "#09090b";
  const muted    = dark ? "#71717a" : "#52525b";
  const inputBg  = dark ? "#09090b" : "#f4f4f5";
  const socialBg = dark ? "#27272a" : "#f4f4f5";
  return {
    variables: {
      colorPrimary:         "#16a34a",
      colorBackground:      bg,
      colorInputBackground: inputBg,
      colorInputText:       text,
      colorText:            text,
      colorTextSecondary:   muted,
      colorDanger:          "#dc2626",
      borderRadius:         "12px",
      fontFamily:           "inherit",
      fontSize:             "15px",
    },
    elements: {
      card:                          { backgroundColor: card, border: `1.5px solid ${border}`, boxShadow: "none" },
      headerTitle:                   { color: text, fontWeight: 900 },
      headerSubtitle:                { color: muted },
      formFieldInput:                { backgroundColor: inputBg, border: `1.5px solid ${border}`, color: text, borderRadius: "10px" },
      formFieldLabel:                { color: muted, fontWeight: 700, fontSize: "11px", letterSpacing: "0.05em" },
      formButtonPrimary:             { backgroundColor: "#16a34a", borderRadius: "12px", fontWeight: 800, fontSize: "15px" },
      footerActionLink:              { color: "#16a34a", fontWeight: 700 },
      footerActionText:              { color: muted },
      footer:                        { backgroundColor: card },
      dividerLine:                   { backgroundColor: border },
      dividerText:                   { color: muted },
      socialButtonsBlockButton:      { backgroundColor: socialBg, border: `1.5px solid ${border}`, borderRadius: "10px", color: text },
      socialButtonsBlockButtonText:  { color: text, fontWeight: 600 },
      identityPreviewText:           { color: text },
      identityPreviewEditButton:     { color: "#16a34a" },
      otpCodeFieldInput:             { backgroundColor: inputBg, border: `1.5px solid ${border}`, color: text },
      // Push modal below notch on iOS PWA
      modalContent:                  { marginTop: "env(safe-area-inset-top, 0px)", paddingTop: "max(16px, env(safe-area-inset-top, 16px))", alignItems: "flex-start" },
      modalBackdrop:                 { paddingTop: "env(safe-area-inset-top, 0px)" },
    },
  };
}

function ClerkProviderWithTheme({ children }) {
  const [dark, setDark] = React.useState(() => {
    try { return localStorage.getItem("mental_game_theme") !== "light"; } catch { return true; }
  });
  React.useEffect(() => {
    const handler = () => {
      try { setDark(localStorage.getItem("mental_game_theme") !== "light"); } catch {}
    };
    window.addEventListener("mgp_theme_change", handler);
    return () => window.removeEventListener("mgp_theme_change", handler);
  }, []);
  return (
    <ClerkProvider publishableKey={clerkPubKey} appearance={getClerkAppearance(dark)}>
      {children}
    </ClerkProvider>
  );
}

function hideSplash() {
  try { if (window.__hideSplash) window.__hideSplash(); } catch {}
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error has occurred</p>}>
      <ClerkProviderWithTheme>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <ClerkBridge />
          <ConvexBridge />
          <App />
        </ConvexProviderWithClerk>
      </ClerkProviderWithTheme>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => requestAnimationFrame(hideSplash));
