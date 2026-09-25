import assert from 'node:assert/strict';
import {
  getAttendanceRollupJobId,
  getQrExpiryCleanupJobId,
} from '../src/lib/hr-background';

const attendance = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  employeeId: '00000000-0000-4000-8000-000000000002',
  workDate: '2026-09-04',
};

const attendanceJobId = getAttendanceRollupJobId(attendance);
assert.match(attendanceJobId, /^[A-Za-z0-9-]+$/, 'Attendance rollup job ID must be BullMQ-safe.');
assert(!attendanceJobId.includes(':'), 'Attendance rollup job ID must not contain a colon.');
assert.equal(getAttendanceRollupJobId(attendance), attendanceJobId, 'Same attendance rollup must keep the same deterministic job ID.');
assert.notEqual(
  getAttendanceRollupJobId({ ...attendance, workDate: '2026-09-05' }),
  attendanceJobId,
  'A different attendance work date must remain a distinct job.',
);
assert.notEqual(
  getAttendanceRollupJobId({ ...attendance, employeeId: '00000000-0000-4000-8000-000000000003' }),
  attendanceJobId,
  'A different employee must remain a distinct job.',
);
assert.notEqual(
  getAttendanceRollupJobId({ ...attendance, tenantId: '00000000-0000-4000-8000-000000000005' }),
  attendanceJobId,
  'A different tenant must remain a distinct job.',
);

const qrJobId = getQrExpiryCleanupJobId({
  tenantId: attendance.tenantId,
  tokenRecordId: '00000000-0000-4000-8000-000000000004',
});
assert.match(qrJobId, /^[A-Za-z0-9-]+$/, 'QR expiry job ID must be BullMQ-safe.');
assert(!qrJobId.includes(':'), 'QR expiry job ID must not contain a colon.');

console.log('PASS  Deterministic BullMQ job IDs are colon-free and preserve semantic uniqueness.');