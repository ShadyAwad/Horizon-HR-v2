import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TutorialOverlay } from './TutorialOverlay';
import { getEligibleTutorials } from './tutorial-registry';
import { isTutorialCurrent } from './tutorial-state';
import type { HelpAction, TutorialContext, TutorialDefinition, TutorialProgress, TutorialStep } from './tutorial-types';
import { recordDevRender } from '../../lib/render-diagnostics';
import { beginDevSpan, markDevPerformance, recordDevInteraction } from '../../lib/dev-performance';

export type TutorialController = {
  tutorials: readonly TutorialDefinition[];
  start: (id: string) => void;
  setAutoStart: (enabled: boolean) => void;
  reset: () => void;
};

type Props = {
  context: TutorialContext;
  activeModule: string;
  progress: TutorialProgress;
  updateProgress: (next: Partial<TutorialProgress>) => void;
  isBlocked: boolean;
  prepareTutorial: (tutorial: TutorialDefinition) => void;
  onReady: (controller: TutorialController) => void;
  onHelpAction: (action: HelpAction) => void;
};

type ActiveTutorial = { tutorial: TutorialDefinition; steps: readonly TutorialStep[]; index: number; automatic: boolean };

export function TutorialProvider({ context, activeModule, progress, updateProgress, isBlocked, prepareTutorial, onReady, onHelpAction }: Props) {
  const [active, setActive] = useState<ActiveTutorial | null>(null);
  const automaticStarted = useRef(false);
  const pendingStartTimer = useRef<number | null>(null);
  const pendingStartWasAutomatic = useRef(false);
  const blockedRef = useRef(isBlocked);
  blockedRef.current = isBlocked;
  const eligible = useMemo(() => {
    const finish = beginDevSpan('startup:tutorial-eligibility-calculation');
    const result = getEligibleTutorials(context);
    finish({ eligibleCount: result.length });
    return result;
  }, [context]);
  if (import.meta.env.DEV) {
    recordDevRender('TutorialProvider', {
      activeTutorial: active?.tutorial.id || 'none',
      activeStep: active?.index ?? -1,
      activeModule,
      blocked: isBlocked,
      eligible: eligible.map((tutorial) => tutorial.id).join('|'),
      autoStart: progress.tutorialsAutoStart,
    });
  }

  const clearPendingStart = useCallback((allowAutomaticRetry = false) => {
    if (pendingStartTimer.current !== null) window.clearTimeout(pendingStartTimer.current);
    if (allowAutomaticRetry && pendingStartWasAutomatic.current) automaticStarted.current = false;
    pendingStartTimer.current = null;
    pendingStartWasAutomatic.current = false;
  }, []);

  const start = useCallback((id: string, automatic = false) => {
    const tutorial = eligible.find((item) => item.id === id);
    if (!tutorial) return;
    clearPendingStart(true);
    prepareTutorial(tutorial);
    pendingStartWasAutomatic.current = automatic;
    pendingStartTimer.current = window.setTimeout(() => {
      pendingStartTimer.current = null;
      pendingStartWasAutomatic.current = false;
      if (automatic && blockedRef.current) return;
      const steps = tutorial.steps.filter((step) => (
        (!step.when || step.when(context))
        && (!step.target || document.querySelector(`[data-tutorial-target="${step.target}"]`))
      ));
      if (!steps.length) return;
      setActive({ tutorial, steps, index: 0, automatic });
    }, id === 'welcome' ? 180 : 140);
  }, [clearPendingStart, context, eligible, prepareTutorial]);

  useEffect(() => {
    if (!isBlocked) return;
    clearPendingStart(true);
    setActive((current) => {
      if (!current?.automatic) return current;
      automaticStarted.current = false;
      return null;
    });
  }, [clearPendingStart, isBlocked]);

  useEffect(() => () => clearPendingStart(), [clearPendingStart]);

  const finish = useCallback((completed: boolean, disableAutomatic = false) => {
    if (!active) return;
    const historyKey = completed ? 'completedTutorials' : 'dismissedTutorials';
    updateProgress({
      [historyKey]: { ...progress[historyKey], [active.tutorial.id]: active.tutorial.version },
      ...(disableAutomatic ? { tutorialsAutoStart: false } : {}),
    });
    setActive(null);
  }, [active, progress, updateProgress]);

  const advance = useCallback(() => {
    if (!active) return;
    const nextIndex = active.index + 1;
    if (nextIndex >= active.steps.length) { finish(true); return; }
    setActive((current) => current ? { ...current, index: nextIndex } : null);
  }, [active, finish]);

  const next = useCallback(() => {
    recordDevInteraction('tutorial-next', advance);
  }, [advance]);

  const back = useCallback(() => setActive((current) => current && current.index > 0 ? { ...current, index: current.index - 1 } : current), []);

  const runHelpAction = useCallback((action: HelpAction) => {
    setActive(null);
    if (action.type === 'start-tutorial') {
      start(action.tutorialId);
      return;
    }
    onHelpAction(action);
  }, [onHelpAction, start]);

  useEffect(() => {
    if (!active) return;
    const contract = active.steps[active.index]?.advanceOn;
    if (!contract) return;
    const advanceFromSafeAction = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; target?: string; value?: string }>).detail;
      if (!detail || detail.type !== contract.type) return;
      if (contract.target && detail.target !== contract.target) return;
      if (contract.value && detail.value !== contract.value) return;
      recordDevInteraction('tutorial-interaction-advance', advance);
    };
    window.addEventListener('stanza-tutorial-action', advanceFromSafeAction);
    return () => window.removeEventListener('stanza-tutorial-action', advanceFromSafeAction);
  }, [active, advance]);

  useEffect(() => {
    const isUnseen = (tutorial: TutorialDefinition) => !isTutorialCurrent(progress.completedTutorials, tutorial.id, tutorial.version) && !isTutorialCurrent(progress.dismissedTutorials, tutorial.id, tutorial.version);
    const candidate = eligible.find((tutorial) => tutorial.id === 'welcome' && isUnseen(tutorial))
      || eligible.find((tutorial) => tutorial.automatic && tutorial.module === activeModule && isUnseen(tutorial));
    markDevPerformance('startup:automatic-tutorial-decision', {
      blocked: isBlocked,
      candidate: candidate?.id || 'none',
      enabled: progress.tutorialsEnabled && progress.tutorialsAutoStart,
    }, true);
    if (automaticStarted.current || active || isBlocked || !progress.tutorialsEnabled || !progress.tutorialsAutoStart) return;
    if (!candidate) return;
    const timer = window.setTimeout(() => { automaticStarted.current = true; start(candidate.id, true); }, 450);
    return () => window.clearTimeout(timer);
  }, [active, activeModule, eligible, isBlocked, progress, start]);

  useEffect(() => {
    const controller: TutorialController = {
      tutorials: eligible,
      start: (id) => start(id),
      setAutoStart: (enabled) => updateProgress({ tutorialsAutoStart: enabled }),
      reset: () => updateProgress({ completedTutorials: {}, dismissedTutorials: {} }),
    };
    onReady(controller);
  }, [eligible, onReady, start, updateProgress]);

  if (!active) return null;
  return <TutorialOverlay
    tutorialId={active.tutorial.id}
    steps={active.steps}
    stepIndex={active.index}
    onBack={back}
    onNext={next}
    onSkip={(disableAutomatic) => finish(false, disableAutomatic)}
    onClose={() => finish(false)}
    onHelpAction={runHelpAction}
  />;
}
