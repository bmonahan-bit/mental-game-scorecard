// main-local.jsx — Local dev only, no Clerk/Convex required
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './mental-game-scorecard.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
