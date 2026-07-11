import { lazy, Suspense, useEffect, useState } from 'react';
import { Login } from './pages/Login';
import { LanguageProvider } from './lib/LanguageContext';
import { ThemeProvider } from './lib/ThemeContext';
import { DemoNoticeModal } from './components/DemoNoticeModal';

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Signup = lazy(() => import('./pages/Signup').then((module) => ({ default: module.Signup })));

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
  authToken?: string;
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
    const storedUser = window.localStorage.getItem('horizon-auth-user');
    return storedUser ? JSON.parse(storedUser) as AuthUser : fallbackUser;
  } catch {
    return fallbackUser;
  }
}

export default function App() {
  const [authState, setAuthState] = useState<'login' | 'signup' | 'authenticated'>('login');
  const [authUser, setAuthUser] = useState<AuthUser>(getStoredUser);
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

  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="w-full min-h-screen bg-[#020604] text-emerald-50 transition-colors duration-300">
         {authState === 'authenticated' ? (
           <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#020604] text-xs font-bold uppercase tracking-widest text-emerald-200">Loading workspace...</div>}>
             <Dashboard
               user={authUser}
               onLogout={() => {
                 window.localStorage.removeItem('horizon-auth-user');
                 setAuthState('login');
               }}
               onShowDemoNotice={() => setShowDemoNotice(true)}
             />
           </Suspense>
         ) : authState === 'signup' ? (
           <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#020604] text-xs font-bold uppercase tracking-widest text-emerald-200">Loading signup...</div>}>
             <Signup 
               onNavigateLogin={() => setAuthState('login')} 
               onSignupComplete={(user) => {
                 const nextUser = user || fallbackUser;
                 setAuthUser(nextUser);
                 window.localStorage.setItem('horizon-auth-user', JSON.stringify(nextUser));
                 setAuthState('authenticated');
               }} 
             />
           </Suspense>
         ) : (
           <Login 
             onLoginSuccess={(user) => {
               setAuthUser(user || fallbackUser);
               setAuthState('authenticated');
             }} 
             onNavigateSignup={() => setAuthState('signup')} 
           />
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
