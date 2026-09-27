// One finite timer; a second click consumes the pending flip.
export function createLanyardClickArbiter(flip: () => void, expand: () => void, delay = 220) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return { click() {
    if (timer !== undefined) { cancel(); expand(); }
    else timer = setTimeout(() => { timer = undefined; flip(); }, delay);
  }, cancel };
}
