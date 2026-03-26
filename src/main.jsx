// main.jsx — App entry point
// Place at: src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { ConvexReactClient } from 'convex/react';
import App from './mental-game-scorecard.jsx';

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ── Sentry ──────────────────────────────────────────────────
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

// ── Bridge — exposes Clerk hooks to the app file ────────────
function ClerkBridge() {
  const { openSignUp, openSignIn } = useClerk();
  const { user, isSignedIn, isLoaded } = useUser();

  // Expose to window so mental-game-scorecard.jsx can access
  window.__clerkOpenSignUp = () => openSignUp({});
  window.__clerkOpenSignIn = () => openSignIn({});
  window.__useUser = () => ({ user, isSignedIn, isLoaded });

  return null;
}

// ── Clerk appearance based on theme ────────────────────────
function getClerkAppearance(dark) {
  const bg = dark ? "#09090b" : "#ffffff";
  const card = dark ? "#18181b" : "#f4f4f5";
  const border = dark ? "#27272a" : "#e4e4e7";
  const text = dark ? "#f8fafc" : "#09090b";
  const muted = dark ? "#71717a" : "#52525b";
  const inputBg = dark ? "#09090b" : "#ffffff";
  return {
    variables: {
      colorPrimary: "#16a34a",
      colorBackground: bg,
      colorInputBackground: inputBg,
      colorInputText: text,
      colorText: text,
      colorTextSecondary: muted,
      colorDanger: "#dc2626",
      colorSuccess: "#16a34a",
      borderRadius: "12px",
      fontFamily: "inherit",
      fontSize: "14px",
    },
    elements: {
      card: { backgroundColor: card, border: `1.5px solid ${border}`, boxShadow: "none" },
      headerTitle: { color: text, fontWeight: 900 },
      headerSubtitle: { color: muted },
      formFieldInput: { backgroundColor: inputBg, border: `1.5px solid ${border}`, color: text, borderRadius: "10px" },
      formFieldLabel: { color: muted, fontWeight: 700, letterSpacing: "0.05em", fontSize: "10px" },
      formButtonPrimary: { backgroundColor: "#16a34a", borderRadius: "12px", fontWeight: 800, fontSize: "15px" },
      footerActionLink: { color: "#16a34a", fontWeight: 700 },
      identityPreviewText: { color: text },
      identityPreviewEditButton: { color: "#16a34a" },
      dividerLine: { backgroundColor: border },
      dividerText: { color: muted },
      socialButtonsBlockButton: { backgroundColor: card, border: `1.5px solid ${border}`, color: text },
      socialButtonsBlockButtonText: { color: text },
      otpCodeFieldInput: { backgroundColor: inputBg, border: `1.5px solid ${border}`, color: text },
    }
  };
}

function ClerkProviderWithTheme({ children }) {
  const [dark, setDark] = React.useState(() => {
    try { return localStorage.getItem("mental_game_theme") !== "light"; } catch { return true; }
  });

  React.useEffect(() => {
    const handler = () => {
      try { setDark(localStorage.getItem("mgp_theme") !== "light"); } catch {}
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

// ── Root ────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error has occurred</p>}>
      <ClerkProviderWithTheme>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <ClerkBridge />
          <App />
        </ConvexProviderWithClerk>
      </ClerkProviderWithTheme>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => requestAnimationFrame(hideSplash));
