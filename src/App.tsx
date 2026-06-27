import { useState } from 'react';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Signup } from './pages/Signup';
import { LanguageProvider } from './lib/LanguageContext';
import { ThemeProvider } from './lib/ThemeContext';

export default function App() {
  const [authState, setAuthState] = useState<'login' | 'signup' | 'authenticated'>('login');

  return (
    <ThemeProvider>
      <LanguageProvider>
        <div className="w-full min-h-screen bg-slate-50 dark:bg-[#020617] transition-colors duration-300">
         {authState === 'authenticated' ? (
           <Dashboard onLogout={() => setAuthState('login')} />
         ) : authState === 'signup' ? (
           <Signup 
             onNavigateLogin={() => setAuthState('login')} 
             onSignupComplete={() => setAuthState('authenticated')} 
           />
         ) : (
           <Login 
             onLoginSuccess={() => setAuthState('authenticated')} 
             onNavigateSignup={() => setAuthState('signup')} 
           />
         )}
        </div>
      </LanguageProvider>
    </ThemeProvider>
  );
}
