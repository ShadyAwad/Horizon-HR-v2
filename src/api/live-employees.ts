import { apiFetch, apiUrl } from '../lib/api';

export type LiveEmployeeStatus = 'clocked_in' | 'on_break' | 'overdue';

export type LiveEmployee = {
  employeeId: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  role: string;
  clockInTime: string;
  elapsedMinutes: number;
  status: LiveEmployeeStatus;
  isValidGeofence: boolean;
  geofenceName: string | null;
  currentBreakStartedAt: string | null;
  lastAttendanceActivityAt: string;
};

export type LiveEmployeesResponse = {
  success: true;
  generatedAt: string;
  overdueHours: number;
  employees: LiveEmployee[];
};

export async function fetchLiveEmployees(signal?: AbortSignal): Promise<LiveEmployeesResponse> {
  const response = await apiFetch(apiUrl('/api/hr/live-employees'), { signal });
  const data = await response.json().catch(() => ({})) as Partial<LiveEmployeesResponse> & { error?: string };
  if (!response.ok || !data.success) throw new Error(data.error || 'Unable to load live employees.');
  return data as LiveEmployeesResponse;
}

