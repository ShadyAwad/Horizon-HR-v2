import type { PoolClient } from 'pg';
export type AttendanceLocationMode = 'required' | 'optional' | 'disabled';
export const attendanceError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export async function attendancePolicy(client: PoolClient, tenantId: string) {
  return (await client.query(`SELECT location_mode AS "attendanceLocationMode",allow_unfiled_breaks AS "allowUnfiledBreaks",allow_custom_breaks AS "allowCustomBreaks" FROM attendance_policies WHERE tenant_id=$1`, [tenantId])).rows[0]
    || { attendanceLocationMode: 'required', allowUnfiledBreaks: true, allowCustomBreaks: true };
}
export async function lockAttendancePolicy(client: PoolClient, tenantId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('attendance-policy:' || $1,0))", [tenantId]);
}
export async function attendanceAudit(client: PoolClient, tenantId: string, employeeId: string, action: string, id: string, metadata: object = {}) {
  await client.query(`INSERT INTO audit_logs(tenant_id,actor_employee_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'attendance',$4,$5::jsonb)`, [tenantId,employeeId,action,id,JSON.stringify(metadata)]);
}
export function readCoordinates(body: {latitude?: unknown; longitude?: unknown}, mode: AttendanceLocationMode) {
  if (mode === 'disabled') return null;
  const missing = (v: unknown) => v === undefined || v === null || v === '';
  if (missing(body.latitude) && missing(body.longitude)) {
    if (mode === 'required') throw attendanceError(400,'Geolocation required for clock-in.');
    return null;
  }
  if (missing(body.latitude) || missing(body.longitude)) throw attendanceError(400,'Both location coordinates are required.');
  if (!['number','string'].includes(typeof body.latitude) || !['number','string'].includes(typeof body.longitude)) throw attendanceError(400,'Invalid coordinates.');
  const latitude = Number(body.latitude), longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw attendanceError(400,'Latitude must be -90 to 90 and longitude must be -180 to 180.');
  return { latitude, longitude };
}
