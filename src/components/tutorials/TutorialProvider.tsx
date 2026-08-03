import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TutorialOverlay } from './TutorialOverlay';
import { getEligibleTutorials } from './tutorial-registry';
import { isTutorialCurrent } from './tutorial-state';
import type { TutorialContext, TutorialDefinition, TutorialProgress, TutorialStep } from './tutorial-types';

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
  onReady: (controller: TutorialController) => void;
};

type ActiveTutorial = { tutorial: TutorialDefinition; steps: readonly TutorialStep[]; index: number; automatic: boolean };

export function TutorialProvider({ context, activeModule, progress, updateProgress, isBlocked, onReady }: Props) {
  const [active, setActive] = useState<ActiveTutorial | null>(null);
  const automaticStarted = useRef(false);
  const eligible = useMemo(() => getEligibleTutorials(context), [context]);

  const start = useCallback((id: string, automatic = false) => {
    const tutorial = eligible.find((item) => item.id === id);
    if (!tutorial) return;
    const steps = tutorial.steps.filter((step) => (
      (!step.when || step.when(context))
      && (!step.target || document.querySelector(`[data-tutorial-target="${step.target}"]`))
    ));
    if (!steps.length) return;
    setActive({ tutorial, steps, index: 0, automatic });
  }, [context, eligible]);

  const finish = useCallback((completed: boolean, disableAutomatic = false) => {
    if (!active) return;
    const historyKey = completed ? 'completedTutorials' : 'dismissedTutorials';
    updateProgress({
      [historyKey]: { ...progress[historyKey], [active.tutorial.id]: active.tutorial.version },
      ...(disableAutomatic ? { tutorialsAutoStart: false } : {}),
    });
    setActive(null);
  }, [active, progress, updateProgress]);

  const next = useCallback(() => {
    if (!active) return;
    const nextIndex = active.index + 1;
    if (nextIndex >= active.steps.length) { finish(true); return; }
    setActive((current) => current ? { ...current, index: nextIndex } : null);
  }, [active, finish]);

  const back = useCallback(() => setActive((current) => current && current.index > 0 ? { ...current, index: current.index - 1 } : current), []);

  useEffect(() => {
    if (automaticStarted.current || active || isBlocked || !progress.tutorialsEnabled || !progress.tutorialsAutoStart) return;
    const isUnseen = (tutorial: TutorialDefinition) => !isTutorialCurrent(progress.completedTutorials, tutorial.id, tutorial.version) && !isTutorialCurrent(progress.dismissedTutorials, tutorial.id, tutorial.version);
    const candidate = eligible.find((tutorial) => tutorial.id === 'welcome' && isUnseen(tutorial))
      || eligible.find((tutorial) => tutorial.automatic && tutorial.module === activeModule && isUnseen(tutorial));
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
  />;
}
