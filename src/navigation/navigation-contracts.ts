import type { ReactNode } from 'react';

export type DashboardNavigationItem = {
  id: string;
  label: string;
  group: string;
  icon: ReactNode;
  badge?: number;
  active: boolean;
  onSelect: () => void;
};
