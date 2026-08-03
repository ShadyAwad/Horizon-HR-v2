export type TutorialModule = 'dashboard' | 'geofence' | 'roster' | 'expenses' | 'hiring' | 'organisation';
export type TutorialPlacement = 'top' | 'bottom' | 'start' | 'end' | 'center';

export type TutorialContext = {
  permissions: readonly string[];
  availableModules: readonly string[];
  isMobile: boolean;
};

export type TutorialStep = {
  id: string;
  target?: string;
  placement: TutorialPlacement;
  titleKey: string;
  bodyKey: string;
  when?: (context: TutorialContext) => boolean;
};

export type TutorialDefinition = {
  id: string;
  version: number;
  module: TutorialModule;
  titleKey: string;
  automatic: boolean;
  replayable: boolean;
  eligible: (context: TutorialContext) => boolean;
  steps: readonly TutorialStep[];
};

export type TutorialProgress = {
  tutorialsEnabled: boolean;
  tutorialsAutoStart: boolean;
  completedTutorials: Record<string, number>;
  dismissedTutorials: Record<string, number>;
};
