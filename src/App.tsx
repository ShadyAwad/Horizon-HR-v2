import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Login } from './pages/Login';
import { LanguageProvider } from './lib/LanguageContext';
import { ThemeProvider } from './lib/ThemeContext';
import { DemoNoticeModal } from './components/DemoNoticeModal';
import { AuthShell, type AuthVisualState } from './components/AuthShell';
import { AuthTransitionLoader, type AuthTransition } from './components/AuthTransitionLoader';
import { apiFetch, apiUrl } from './lib/api';

const loadDashboard = () => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard }));
const loadSignup = () => import('./pages/Signup').then((module) => ({ default: module.Signup }));
const loadResetPassword = () => import('./pages/ResetPassword').then((module) => ({ default: module.ResetPassword }));
const Dashboard = lazy(loadDashboard);
const Signup = lazy(loadSignup);
const ResetPassword = lazy(loadResetPassword);
const AUTH_TRANSITION_MINIMUM_MS = 280;

const waitFor = (duration: number) => new Promise<void>((resolve) => window.setTimeout(resolve, duration));

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'hr_admin' | 'manager' | 'employee';
  jobTitle?: string | null;
  roleNames?: string[];
  permissions?: string[];
  tenantId: string;
  tenant?: string | { id: string; slug: string; companyName: string };
  profileImageUrl?: string | null;
};

const fallbackUser: AuthUser = {
  id: 'demo-employee',
  email: 'sarah.connor@horizon.local',
  name: 'Sarah Connor',
  role: 'hr_admin',
  tenantId: 'demo-tenant',
  tenant: 'Stanza Demo Company',
};

function getStoredUser() {
  if (typeof window === 'undefined') return fallbackUser;

  try {
    // Old clients stored bearer tokens here. Remove the token without sending it anywhere;
    // the next request will use the HttpOnly session cookie established at login.
    const storedUser = window.localStorage.getItem('horizon-auth-user');
    if (!storedUser) return fallbackUser;
    const parsed = JSON.parse(storedUser) as AuthUser & { authToken?: string };
    if (parsed.authToken) {
      delete parsed.authToken;
      window.localStorage.setItem('horizon-auth-user', JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return fallbackUser;
  }
}

export default function App() {
  const [authState, setAuthState] = useState<'login' | 'signup' | 'authenticated'>('login');
  const [authUser, setAuthUser] = useState<AuthUser>(getStoredUser);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authBackgroundPulse, setAuthBackgroundPulse] = useState<AuthVisualState>('idle');
  const [authTransition, setAuthTransition] = useState<AuthTransition | null>(null);
  const [focusLoginEmail, setFocusLoginEmail] = useState(false);
  const transitionInFlightRef = useRef<AuthTransition | null>(null);
  const authPulseResolveRef = useRef<(() => void) | null>(null);
  const [serviceWorkerRegistration, setServiceWorkerRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [showDemoNotice, setShowDemoNotice] = useState(() => {
    try {
      return window.localStorage.getItem('stanza-demo-notice-seen') !== 'true';
    } catch {
      return false;
    }
  });

  const dismissDemoNotice = () => {
    try {
      window.localStorage.setItem('stanza-demo-notice-seen', 'true');
    } catch {
      // Keep the notice dismissible when storage is unavailable.
    }
    setShowDemoNotice(false);
  };

  useEffect(() => {
    let cancelled = false;
    if (window.location.pathname === '/reset-password') {
      setSessionChecked(true);
      return () => { cancelled = true; };
    }

    void apiFetch(apiUrl('/api/auth/session'))
      .then(async (response) => {
        if (!response.ok) throw new Error('No active session.');
        const data = await response.json() as { success?: boolean; user?: AuthUser };
        if (!data.success || !data.user) throw new Error('No active session.');
        if (cancelled) return;
        setAuthUser(data.user);
        window.localStorage.setItem('horizon-auth-user', JSON.stringify(data.user));
        setAuthState('authenticated');
      })
      .catch(() => {
        if (!cancelled) window.localStorage.removeItem('horizon-auth-user');
      })
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const titles = {
      login: 'Login — Stanza',
      signup: 'Register Workspace — Stanza',
      authenticated: 'Dashboard — Stanza',
    };

    document.title = titles[authState];
  }, [authState]);

  useEffect(() => {
    const handleServiceWorkerUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<{ registration?: ServiceWorkerRegistration }>;
      if (customEvent.detail?.registration) {
        setServiceWorkerRegistration(customEvent.detail.registration);
      }
    };

    const handleControllerChange = () => {
      window.location.reload();
    };

    window.addEventListener('stanza-service-worker-update', handleServiceWorkerUpdate);
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange);

    return () => {
      window.removeEventListener('stanza-service-worker-update', handleServiceWorkerUpdate);
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  const applyServiceWorkerUpdate = () => {
    serviceWorkerRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  const isPasswordResetRoute = window.location.pathname === '/reset-password';
  const completeAuthPulse = () => {
    setAuthBackgroundPulse('idle');
    authPulseResolveRef.current?.();
    authPulseResolveRef.current = null;
  };

  const waitForAuthPulse = () => new Promise<void>((resolve) => {
    authPulseResolveRef.current = resolve;
  });

  const startAuthTransition = (transition: AuthTransition, complete: () => Promise<void> | void) => {
    if (transitionInFlightRef.current) return;

    transitionInFlightRef.current = transition;
    setAuthTransition(transition);
    const startedAt = performance.now();

    void (async () => {
      try {
        await complete();
      } finally {
        const remaining = AUTH_TRANSITION_MINIMUM_MS - (performance.now() - startedAt);
        if (remaining > 0) await waitFor(remaining);
        setAuthBackgroundPulse('idle');
        transitionInFlightRef.current = null;
        setAuthTransition(null);
      }
    })();
  };

  useEffect(() => {
    if (authState !== 'login' || isPasswordResetRoute) return;

    const preloadTimer = window.setTimeout(() => {
      void loadSignup();
    }, 700);

    return () => window.clearTimeout(preloadTimer);
  }, [authState, isPasswordResetRoute]);

  const beginLogin = (user?: AuthUser) => {
    const nextUser = user || fallbackUser;
    setAuthBackgroundPulse('success');
    const pulseComplete = waitForAuthPulse();
    startAuthTransition('logging-in', async () => {
      await Promise.all([loadDashboard(), pulseComplete]);
      setAuthUser(nextUser);
      window.localStorage.setItem('horizon-auth-user', JSON.stringify(nextUser));
      setAuthState('authenticated');
    });
  };

  const beginLogout = () => {
    setAuthBackgroundPulse('loading');
    startAuthTransition('logging-out', async () => {
      await waitFor(180);
      await apiFetch(apiUrl('/api/auth/logout'), { method: 'POST' }).catch(() => undefined);
      window.localStorage.removeItem('horizon-auth-user');
      setFocusLoginEmail(true);
      setAuthState('login');
    });
  };

  const updateAuthUser = (nextUser: AuthUser) => {
    setAuthUser(nextUser);
    window.localStorage.setItem('horizon-auth-user', JSON.stringify(nextUser));
  };

  const openSignup = () => {
    setFocusLoginEmail(false);
    setAuthBackgroundPulse('loading');
    startAuthTransition('opening-signup', async () => {
      await loadSignup();
      setAuthState('signup');
    });
  };

  const returnToLogin = () => {
    setAuthBackgroundPulse('loading');
    startAuthTransition('returning-login', () => {
      setFocusLoginEmail(true);
      setAuthState('login');
    });
  };

  const returnFromResetToLogin = () => {
    setAuthBackgroundPulse('loading');
    startAuthTransition('returning-login', () => {
      window.history.replaceState({}, '', '/');
      setFocusLoginEmail(true);
      setAuthState('login');
    });
  };

  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="w-full min-h-screen bg-[#020604] text-emerald-50 transition-colors duration-300">
         {!sessionChecked ? (
           <AuthShell pulseState="idle" onPulseComplete={() => undefined}>
             <AuthTransitionLoader transition="logging-in" />
           </AuthShell>
         ) : authState === 'authenticated' ? (
           <>
             <Suspense fallback={<AuthTransitionLoader transition="logging-in" overlay />}>
               <Dashboard
                 user={authUser}
                 onLogout={beginLogout}
                 onShowDemoNotice={() => setShowDemoNotice(true)}
                 onUserUpdate={updateAuthUser}
               />
             </Suspense>
             {authTransition === 'logging-out' && <AuthTransitionLoader transition="logging-out" overlay />}
           </>
         ) : (
           <AuthShell pulseState={authBackgroundPulse} onPulseComplete={completeAuthPulse}>
             {authTransition ? (
               <AuthTransitionLoader transition={authTransition} />
             ) : isPasswordResetRoute ? (
               <Suspense fallback={<AuthTransitionLoader transition="returning-login" />}>
                 <ResetPassword onNavigateLogin={returnFromResetToLogin} onPulseStateChange={setAuthBackgroundPulse} />
               </Suspense>
             ) : authState === 'signup' ? (
               <Suspense fallback={<AuthTransitionLoader transition="opening-signup" />}>
                 <Signup
                   onNavigateLogin={returnToLogin}
                   onSignupComplete={beginLogin}
                   onPulseStateChange={setAuthBackgroundPulse}
                 />
               </Suspense>
             ) : (
               <Login
                 onLoginSuccess={beginLogin}
                 onPulseStateChange={setAuthBackgroundPulse}
                 onNavigateSignup={openSignup}
                 focusEmailOnMount={focusLoginEmail}
               />
             )}
           </AuthShell>
         )}
         {serviceWorkerRegistration?.waiting && (
           <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-[#04110d]/95 p-3 text-xs text-emerald-50 shadow-2xl shadow-black/40 backdrop-blur-xl">
             <span>Stanza update ready.</span>
             <button
               type="button"
               onClick={applyServiceWorkerUpdate}
               className="rounded-lg bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-black transition hover:bg-emerald-400"
             >
               Refresh
             </button>
           </div>
         )}
         <DemoNoticeModal open={showDemoNotice} onClose={dismissDemoNotice} />
        </div>
      </LanguageProvider>
    </ThemeProvider>
  );
}
