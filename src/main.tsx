import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {
  initializeStanzaPreferences,
  StanzaPreferencesProvider,
} from './lib/StanzaPreferencesContext';
import { markDevPerformance } from './lib/dev-performance';

if (import.meta.env.LOGIN_AUTOFILL_DIAGNOSTIC) {
  void import('./diagnostics/login-autofill').then(({ installLoginAutofillDiagnostic }) => installLoginAutofillDiagnostic());
}

if (import.meta.env.LOGIN_ANIMATION_AUDIT) {
  void import('./diagnostics/login-animation-audit').then(({ installLoginAnimationAudit }) => installLoginAnimationAudit());
}

if (import.meta.env.LOGIN_CONTROL_DIAGNOSTIC) {
  void import('./diagnostics/login-control-transitions').then(({ installLoginControlTransitions }) => installLoginControlTransitions());
}

if(import.meta.env.DEV && new URLSearchParams(location.search).get('cursorProfile')==='1') void import('./diagnostics/cursor-browser-profile').then(m=>m.installCursorBrowserProfile());

markDevPerformance('startup:react-bootstrap-start', undefined, true);
initializeStanzaPreferences();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StanzaPreferencesProvider>
      <App />
    </StanzaPreferencesProvider>
  </StrictMode>,
);
markDevPerformance('startup:react-render-queued', undefined, true);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    markDevPerformance('startup:service-worker-initialization', { production: import.meta.env.PROD }, true);
    if (!import.meta.env.PROD) {
      // A production worker can survive a later local Vite session on the same
      // origin. Remove only Stanza's worker so development never serves cached
      // production HTML or assets.
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          const scriptUrl = registration.active?.scriptURL
            ?? registration.waiting?.scriptURL
            ?? registration.installing?.scriptURL;
          if (scriptUrl && new URL(scriptUrl).pathname === '/service-worker.js') {
            void registration.unregister();
          }
        }
        markDevPerformance('startup:service-worker-complete', { production: false }, true);
      });
      return;
    }

    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
        markDevPerformance('startup:service-worker-complete', { production: true }, true);
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('stanza-service-worker-update', {
                detail: { registration },
              }));
            }
          });
        });
      })
      .catch((error) => {
        console.error('[PWA] Service worker registration failed:', error);
      });
  });
}
