export type NavigationHistory = { entries: string[]; index: number };
export function visitDestination(history: NavigationHistory, destination: string): NavigationHistory {
 if (history.entries[history.index] === destination) return history;
 const entries = [...history.entries.slice(0, history.index + 1), destination].slice(-50);
 return { entries, index: entries.length - 1 };
}
export function historyTarget(history: NavigationHistory, direction: -1 | 1, allowed: (destination: string) => boolean) {
 for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
  if (allowed(history.entries[index])) return index;
 }
 return null;
}
