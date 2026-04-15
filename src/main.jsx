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

// Bridge
function ClerkBridge() {
  const { openSignUp, openSignIn, openUserProfile, signOut } = useClerk();
  const { user, isSignedIn, isLoaded } = useUser();

  // Assign synchronously on every render so they're always current
  window.__clerkOpenSignUp = () => openSignUp({});
  window.__clerkOpenSignIn = () => openSignIn({});
  window.__clerkOpenUserProfile = () => openUserProfile({});
  window.__clerkSignOut = () => signOut(() => { window.location.reload(); });
  window.__useUser = () => ({ user, isSignedIn, isLoaded });

  // Fire event when auth state changes so app can react without polling
  React.useEffect(() => {
    window.dispatchEvent(new Event("clerk:statechange"));
  }, [isSignedIn, isLoaded]);

  return null;
}

// Clerk appearance - responds to light/dark theme
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
          <App />
        </ConvexProviderWithClerk>
      </ClerkProviderWithTheme>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

requestAnimationFrame(() => requestAnimationFrame(hideSplash));
