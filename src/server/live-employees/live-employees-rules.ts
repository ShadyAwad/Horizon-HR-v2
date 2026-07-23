export const LIVE_EMPLOYEE_STATUSES = ['clocked_in', 'on_break', 'overdue'] as const;

export type LiveEmployeeStatus = typeof LIVE_EMPLOYEE_STATUSES[number];

export const DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS = 12;

export function getLiveEmployeeOverdueHours(value = process.env.LIVE_EMPLOYEE_OVERDUE_HOURS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 72
    ? parsed
    : DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS;
}

export function deriveLiveEmployeeStatus(
  elapsedMinutes: number,
  hasActiveBreak: boolean,
  overdueHours = DEFAULT_LIVE_EMPLOYEE_OVERDUE_HOURS,
): LiveEmployeeStatus {
  if (elapsedMinutes >= overdueHours * 60) return 'overdue';
  if (hasActiveBreak) return 'on_break';
  return 'clocked_in';
}

