import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {
  initializeStanzaPreferences,
  StanzaPreferencesProvider,
} from './lib/StanzaPreferencesContext';

initializeStanzaPreferences();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StanzaPreferencesProvider>
      <App />
    </StanzaPreferencesProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
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
      });
      return;
    }

    navigator.serviceWorker.register('/service-worker.js')
      .then((registration) => {
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
