import type { LiveEmployee, LiveEmployeeStatus } from '../api/live-employees';

export type LiveEmployeeFilter = 'all' | LiveEmployeeStatus | 'valid_geofence' | 'invalid_geofence';

export function summarizeLiveEmployees(employees: LiveEmployee[]) {
  return {
    total: employees.length,
    clockedIn: employees.filter((employee) => employee.status === 'clocked_in').length,
    onBreak: employees.filter((employee) => Boolean(employee.currentBreakStartedAt)).length,
    overdue: employees.filter((employee) => employee.status === 'overdue').length,
  };
}

export function filterLiveEmployees(
  employees: LiveEmployee[],
  filter: LiveEmployeeFilter,
  search: string,
) {
  const query = search.trim().toLocaleLowerCase();
  return employees.filter((employee) => {
    const matchesFilter =
      filter === 'all'
      || (filter === 'valid_geofence' && employee.isValidGeofence)
      || (filter === 'invalid_geofence' && !employee.isValidGeofence)
      || employee.status === filter;
    const matchesSearch = !query || [
      employee.displayName,
      employee.role,
      employee.department,
      employee.geofenceName,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  });
}

export function formatElapsedMinutes(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remaining = safeMinutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${remaining}m`;
}

