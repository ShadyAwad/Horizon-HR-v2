export function createSerialSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const next = tail.then(work, work);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
