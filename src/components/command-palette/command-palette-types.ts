import type { ReactNode } from 'react';

export type CommandType =
  | 'navigation'
  | 'internal_view'
  | 'open_existing_flow'
  | 'settings'
  | 'safe_utility';

export type CommandGroup =
  | 'workspace'
  | 'peopleOperations'
  | 'administration'
  | 'quickActions'
  | 'settings';

export type StanzaCommand = {
  id: string;
  type: CommandType;
  group: CommandGroup;
  label: string;
  description: string;
  keywords: readonly string[];
  icon: ReactNode;
  execute: () => void;
  mobileAvailable: boolean;
  dangerous: false;
  contextId?: string;
  sourceNavigationId?: string;
};

export type StanzaCommandInput = Omit<
  StanzaCommand,
  'dangerous' | 'mobileAvailable'
> & {
  allowed: boolean;
  mobileAvailable?: boolean;
};
