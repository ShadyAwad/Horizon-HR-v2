import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'ar';

const translations = {
  en: {
    // Login
    'login.title': 'Horizon HR',
    'login.subtitle': 'Enterprise Authentication',
    'login.corporateId': 'Corporate ID',
    'login.biometricKey': 'Biometric Key',
    'login.authenticating': 'Authenticating...',
    'login.accessGranted': 'Access Granted',
    'login.enterSector': 'Enter Sector',

    // Dashboard
    'dash.elitePortal': 'Elite Portal',
    'dash.auth': 'Authenticated',
    'dash.terminate': 'Terminate',
    'dash.core': 'Core:',
    'dash.geoOp': 'Geo-Operations',
    'dash.roster': 'Weekly Roster',
    'dash.profile': 'Profile',
    'dash.perimeter': 'Perimeter Verification',
    'dash.hqSecure': 'HQ RADIAL STATUS: SECURE',
    'dash.clockIn': 'CLOCK IN',
    'dash.locating': 'LOCATING',
    'dash.verifying': 'VERIFYING',
    'dash.verified': 'VERIFIED',
    'dash.breach': 'BREACH',
    'dash.sysMsg': 'SYS',
    'dash.awaitingInput': 'Awaiting Biometric / Geo Input',
    'dash.rosterHub': 'Roster Hub: Current Sprint',
    'dash.weekView': 'Week View',
    'dash.applyLeave': 'Apply Leave',
    'dash.dayDate': 'Day / Date',
    'dash.shiftFrame': 'Shift Frame',
    'dash.locationRole': 'Location/Role',
    'dash.status': 'Status',
    'dash.abstained': 'ABSTAINED',
    'dash.scheduled': 'SCHEDULED',
    'dash.advParams': 'Advanced Params',
    'dash.adminsOnline': 'Admins Online',

    // Profile
    'profile.title': 'Employee Profile',
    'profile.subtitle': 'Personnel Ledger & Workflows',
    'profile.leaveName': 'Leave Balance',
    'profile.leaveDays': 'Days',
    'profile.loan': 'Active Loan Status',
    'profile.payroll': 'Payroll Details',
    'profile.grievance': 'File Grievance',

    // Signup
    'signup.title': 'Corporate Onboarding',
    'signup.subtitle': 'Register your Horizon instance',
    'signup.step1': 'Corporate Details',
    'signup.step2': 'Operations & Finance',
    'signup.step3': 'Geo-Perimeter',
    'signup.companyName': 'Company Legal Name',
    'signup.tenantSlug': 'Unique Tenant Slug',
    'signup.adminEmail': 'Admin Email',
    'signup.adminPass': 'Admin Password',
    'signup.currency': 'Base Operating Currency',
    'signup.capacity': 'Employee Capacity',
    'signup.loans': 'Enable Corporate Loans Policy',
    'signup.geoLat': 'Headquarters Latitude',
    'signup.geoLng': 'Headquarters Longitude',
    'signup.geoRadius': 'Bounding Radius (meters)',
    'signup.complete': 'Initialize Tenant Sandbox',
    'signup.back': 'Back',
    'signup.next': 'Next',
    'signup.login': 'Return to Login',
  },
  ar: {
    // Login
    'login.title': 'أفق للموارد البشرية',
    'login.subtitle': 'مصادقة الشركات',
    'login.corporateId': 'المعرف الوظيفي',
    'login.biometricKey': 'المفتاح البيومتري',
    'login.authenticating': 'جاري المصادقة...',
    'login.accessGranted': 'تم السماح بالدخول',
    'login.enterSector': 'دخول النظام',

    // Dashboard
    'dash.elitePortal': 'بوابة النخبة',
    'dash.auth': 'تمت المصادقة',
    'dash.terminate': 'إنهاء الجلسة',
    'dash.core': 'النظام الأساسي:',
    'dash.geoOp': 'العمليات الجغرافية',
    'dash.roster': 'الجدول الأسبوعي',
    'dash.profile': 'الملف الشخصي',
    'dash.perimeter': 'التحقق من المحيط الجغرافي',
    'dash.hqSecure': 'حالة المقر الرئيسي: آمن',
    'dash.clockIn': 'تسجيل الحضور',
    'dash.locating': 'جاري تحديد الموقع',
    'dash.verifying': 'جاري التحقق',
    'dash.verified': 'تم التحقق',
    'dash.breach': 'مخالفة',
    'dash.sysMsg': 'النظام',
    'dash.awaitingInput': 'بانتظار الإدخال البيومتري / الجغرافي',
    'dash.rosterHub': 'سجل الحضور: الدورة الحالية',
    'dash.weekView': 'عرض أسبوعي',
    'dash.applyLeave': 'طلب إجازة',
    'dash.dayDate': 'اليوم / التاريخ',
    'dash.shiftFrame': 'فترة المناوبة',
    'dash.locationRole': 'الموقع / الدور',
    'dash.status': 'الحالة',
    'dash.abstained': 'معتذر',
    'dash.scheduled': 'مجدول',
    'dash.advParams': 'خيارات متقدمة',
    'dash.adminsOnline': 'المسؤولين المتصلين',

    // Profile
    'profile.title': 'ملف الموظف',
    'profile.subtitle': 'سجل الموظفين وسير العمل',
    'profile.leaveName': 'رصيد الإجازات',
    'profile.leaveDays': 'أيام',
    'profile.loan': 'حالة القرض النشط',
    'profile.payroll': 'تفاصيل الراتب',
    'profile.grievance': 'تقديم شكوى',

    // Signup
    'signup.title': 'تسجيل الشركات',
    'signup.subtitle': 'إنشاء بوابة أفق الخاصة بك',
    'signup.step1': 'تفاصيل الشركة',
    'signup.step2': 'العمليات والمالية',
    'signup.step3': 'المحيط الجغرافي',
    'signup.companyName': 'الاسم القانوني للشركة',
    'signup.tenantSlug': 'المعرف الفريد للشركة',
    'signup.adminEmail': 'البريد الإلكتروني للمسؤول',
    'signup.adminPass': 'كلمة المرور للمسؤول',
    'signup.currency': 'عملة التشغيل الأساسية',
    'signup.capacity': 'سعة الموظفين',
    'signup.loans': 'تفعيل سياسة قروض الشركات',
    'signup.geoLat': 'خط عرض المقر الرئيسي',
    'signup.geoLng': 'خط طول المقر الرئيسي',
    'signup.geoRadius': 'نصف قطر المحيط (بالمتر)',
    'signup.complete': 'تهيئة بيئة الشركة',
    'signup.back': 'رجوع',
    'signup.next': 'التالي',
    'signup.login': 'العودة لتسجيل الدخول',
  }
};

type LanguageContextType = {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: keyof typeof translations.en) => string;
  isRtl: boolean;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'en';

  const savedLanguage = window.localStorage.getItem('horizon-language');
  return savedLanguage === 'ar' || savedLanguage === 'en' ? savedLanguage : 'en';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    window.localStorage.setItem('horizon-language', lang);
  }, [lang]);

  const t = (key: keyof typeof translations.en) => {
    return translations[lang][key] || translations.en[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, isRtl: lang === 'ar' }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
