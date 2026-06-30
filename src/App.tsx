import { useState } from 'react';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Signup } from './pages/Signup';
import { LanguageProvider } from './lib/LanguageContext';
import { ThemeProvider } from './lib/ThemeContext';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'hr_admin' | 'manager' | 'employee';
  tenantId: string;
  tenant?: string | { id: string; slug: string; companyName: string };
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

  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="w-full min-h-screen bg-slate-50 dark:bg-[#020617] transition-colors duration-300">
         {authState === 'authenticated' ? (
           <Dashboard
             user={authUser}
             onLogout={() => {
               window.localStorage.removeItem('horizon-auth-user');
               setAuthState('login');
             }}
           />
         ) : authState === 'signup' ? (
           <Signup 
             onNavigateLogin={() => setAuthState('login')} 
             onSignupComplete={(user) => {
               const nextUser = user || fallbackUser;
               setAuthUser(nextUser);
               window.localStorage.setItem('horizon-auth-user', JSON.stringify(nextUser));
               setAuthState('authenticated');
             }} 
           />
         ) : (
           <Login 
             onLoginSuccess={(user) => {
               setAuthUser(user || fallbackUser);
               setAuthState('authenticated');
             }} 
             onNavigateSignup={() => setAuthState('signup')} 
           />
         )}
        </div>
      </LanguageProvider>
    </ThemeProvider>
  );
}
