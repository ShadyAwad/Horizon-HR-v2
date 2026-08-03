import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type ShortcutMove = 'up' | 'down' | 'start' | 'end';

export function swapShortcutPositions(order: readonly string[], sourceId: string, targetId: string) {
  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...order];
  const next = [...order];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
  return next;
}

export function moveShortcutPosition(order: readonly string[], id: string, move: ShortcutMove) {
  const sourceIndex = order.indexOf(id);
  if (sourceIndex < 0) return [...order];
  const targetIndex = move === 'start'
    ? 0
    : move === 'end'
      ? order.length - 1
      : sourceIndex + (move === 'up' ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= order.length || targetIndex === sourceIndex) return [...order];
  const next = [...order];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

type Gesture = {
  active: boolean;
  captureTarget: HTMLElement;
  pointerId: number;
  sourceId: string;
  startX: number;
  startY: number;
  targetId: string;
  pointerType: string;
};

type LongPressSwapOptions = {
  attribute: `data-${string}`;
  onSwap: (sourceId: string, targetId: string) => void;
  holdMilliseconds?: number;
  scrollContainerRef?: RefObject<HTMLElement | null>;
};

const MOVE_TOLERANCE_PX = 9;

export function useLongPressShortcutSwap({
  attribute,
  onSwap,
  holdMilliseconds = 400,
  scrollContainerRef,
}: LongPressSwapOptions) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number; touch: boolean } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const onSwapRef = useRef(onSwap);
  useEffect(() => { onSwapRef.current = onSwap; }, [onSwap]);

  const clearHold = useCallback(() => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const releaseCapture = useCallback((gesture: Gesture) => {
    try {
      if (gesture.captureTarget.hasPointerCapture(gesture.pointerId)) {
        gesture.captureTarget.releasePointerCapture(gesture.pointerId);
      }
    } catch {
      // Pointer capture can already be gone after a browser-level cancellation.
    }
  }, []);

  const reset = useCallback((commit: boolean, suppressClick = false) => {
    clearHold();
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setDraggedId(null);
    setTargetId(null);
    setPreviewPoint(null);
    suppressClickRef.current = suppressClick;
    if (!gesture) return;
    releaseCapture(gesture);
    if (commit && gesture.active && gesture.sourceId !== gesture.targetId) {
      onSwapRef.current(gesture.sourceId, gesture.targetId);
    }
  }, [clearHold, releaseCapture]);

  useEffect(() => {
    const handleBlur = () => reset(false);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
      reset(false);
    };
  }, [reset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    reset(false);
    const captureTarget = event.currentTarget;
    gestureRef.current = {
      active: false,
      captureTarget,
      pointerId: event.pointerId,
      sourceId: id,
      startX: event.clientX,
      startY: event.clientY,
      targetId: id,
      pointerType: event.pointerType,
    };
    holdTimerRef.current = window.setTimeout(() => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gesture.active = true;
      suppressClickRef.current = true;
      try { gesture.captureTarget.setPointerCapture(gesture.pointerId); } catch { /* optional */ }
      setDraggedId(gesture.sourceId);
      setTargetId(gesture.sourceId);
      setPreviewPoint({ x: event.clientX, y: event.clientY, touch: gesture.pointerType === 'touch' });
      navigator.vibrate?.(12);
    }, holdMilliseconds);
  }, [holdMilliseconds, reset]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.active) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (distance > MOVE_TOLERANCE_PX) reset(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setPreviewPoint({ x: event.clientX, y: event.clientY, touch: gesture.pointerType === 'touch' });
    const scrollContainer = scrollContainerRef?.current;
    if (scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect();
      const edge = 36;
      const step = 12;
      if (event.clientY < rect.top + edge) scrollContainer.scrollTop -= step;
      if (event.clientY > rect.bottom - edge) scrollContainer.scrollTop += step;
    }
    const candidate = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(`[${attribute}]`)
      ?.getAttribute(attribute);
    if (!candidate || candidate === gesture.targetId) return;
    gesture.targetId = candidate;
    setTargetId(candidate);
  }, [attribute, reset, scrollContainerRef]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.active) {
      event.preventDefault();
      event.stopPropagation();
      reset(true, true);
    } else {
      reset(false);
    }
  }, [reset]);

  const onPointerCancel = useCallback(() => reset(false), [reset]);
  const onLostPointerCapture = useCallback(() => {
    if (gestureRef.current?.active) reset(false);
  }, [reset]);
  const consumeSuppressedClick = useCallback(() => {
    const suppressed = suppressClickRef.current;
    suppressClickRef.current = false;
    return suppressed;
  }, []);

  const bind = useCallback((id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(event, id),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  }), [onLostPointerCapture, onPointerCancel, onPointerDown, onPointerMove, onPointerUp]);

  return { bind, consumeSuppressedClick, draggedId, targetId, previewPoint };
}
