export type TutorialModule = string;
export type TutorialPlacement = 'top' | 'bottom' | 'start' | 'end' | 'center';
export type TutorialAdvanceAction = 'click' | 'module-change' | 'tab-change' | 'accordion-open';
export type HelpAction =
  | { type: 'open-article'; articleId: string }
  | { type: 'start-tutorial'; tutorialId: string }
  | { type: 'open-module'; moduleId: string }
  | { type: 'open-settings'; section: 'personalization'; target: 'lanyard' };

export type TutorialContext = {
  permissions: readonly string[];
  availableModules: readonly string[];
  isMobile: boolean;
  lanyardAvailable?: boolean;
  lanyardEnabled?: boolean;
};

export type TutorialStep = {
  id: string;
  target?: string;
  placement: TutorialPlacement;
  titleKey: string;
  bodyKey: string;
  primaryLabelKey?: string;
  compactTip?: boolean;
  when?: (context: TutorialContext) => boolean;
  advanceOn?: {
    type: TutorialAdvanceAction;
    target?: string;
    value?: string;
  };
  helpAction?: { labelKey: string; action: HelpAction };
};

export type TutorialDefinition = {
  id: string;
  version: number;
  module: TutorialModule;
  titleKey: string;
  descriptionKey: string;
  automatic: boolean;
  replayable: boolean;
  eligible: (context: TutorialContext) => boolean;
  automaticEligible?: (context: TutorialContext) => boolean;
  steps: readonly TutorialStep[];
};

export type TutorialProgress = {
  tutorialsEnabled: boolean;
  tutorialsAutoStart: boolean;
  completedTutorials: Record<string, number>;
  dismissedTutorials: Record<string, number>;
};
