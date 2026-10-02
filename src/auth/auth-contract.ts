export type AuthVisualState = 'idle' | 'loading' | 'success' | 'error';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: 'hr_admin' | 'manager' | 'employee';
  jobTitle?: string | null;
  roleNames?: string[];
  permissions?: string[];
  tenantId: string;
  isDemoTenant?: boolean;
  tenant?: string | { id: string; slug: string; companyName: string };
  profileImageUrl?: string | null;
};
