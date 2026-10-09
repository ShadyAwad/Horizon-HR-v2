import type {CustomThemeConfig} from './custom-theme';
export type ColorPreviewEnvironment = {
  read: () => CustomThemeConfig;
  preview: (value: CustomThemeConfig) => void;
  commit: (value: CustomThemeConfig) => void;
  adjusting: (active: boolean) => void;
  frame: (fn: () => void) => number;
  cancelFrame: (id: number) => void;
  timeout: (fn: () => void, delay: number) => number;
  cancelTimeout: (id: number) => void;
};
/** A transient preview of the authoritative config, with one frame and one settle timer. */
export function createThemeColorPreview(env: ColorPreviewEnvironment) {
  let pending: CustomThemeConfig | undefined;
  let frame: number | undefined, timer: number | undefined;
  const cancelJobs = () => {
    if(frame !== undefined) env.cancelFrame(frame);
    if(timer !== undefined) env.cancelTimeout(timer);
    frame=timer=undefined;
  };
  const paint = () => { if(pending) env.preview(pending); };
  const flush = () => {
    cancelJobs();
    if(pending) { const value=pending; paint(); pending=undefined; env.commit(value); }
    env.adjusting(false);
  };
  return {
    queue(change: (value: CustomThemeConfig) => CustomThemeConfig) {
      pending=change(pending ?? env.read());
      env.adjusting(true);
      if(frame === undefined) frame=env.frame(() => {frame=undefined;paint();});
      if(timer !== undefined) env.cancelTimeout(timer);
      timer=env.timeout(flush,250);
    },
    flush,
    cancel() {cancelJobs();pending=undefined;env.adjusting(false);},
  };
}
