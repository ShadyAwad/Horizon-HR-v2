import type { DemoContext } from './core';
import { employeeFixtures, fixtureId } from './core';
import { rollupAttendanceWithClient } from '../../src/server/attendance/attendance-rollup';
export async function seedAttendance(ctx: DemoContext) {
    const { client, tenantId: t } = ctx;
    const admin = ctx.people.get('admin');
    const paid = await ctx.row('attendance_break_policies', 'coffee', { name: 'Coffee pause', duration_minutes: 15, maximum_uses: 2, requires_approval: false, paid: true, active: true });
    const meal = await ctx.row('attendance_break_policies', 'lunch', { name: 'Lunch break', duration_minutes: 30, maximum_uses: 1, requires_approval: true, paid: false, active: true });
    let absentDay = -3;
    while ([5, 6].includes(new Date(ctx.date(absentDay)).getUTCDay()))
        absentDay--;
    const policy = (await client.query('SELECT * FROM attendance_policies WHERE tenant_id=$1', [t])).rows[0];
    const allowUnfiled = policy?.allow_unfiled_breaks ?? true;
    for (const [index, person] of employeeFixtures.entries()) {
        const key = person[0];
        if (key === 'former')
            continue;
        const employee = ctx.people.get(key)!;
        for (let day = -14; day <= -1; day++) {
            const dow = new Date(ctx.date(day)).getUTCDay();
            if (dow === 5 || dow === 6 || (key === 'employee' && day === -7) || (key === 'new' && day < -6) || (index === 5 && day === absentDay) || (key === 'it' && [-12, -11].includes(day)))
                continue;
            const prior = await client.query('SELECT id FROM time_logs WHERE tenant_id=$1 AND employee_id=$2 AND clock_in_time >= $3::date AND clock_in_time < $3::date+1 AND id<>$4', [t, employee, ctx.date(day), fixtureId(`time_logs:${key}:${day}`)]);
            if (prior.rowCount) {
                await rollupAttendanceWithClient(client, { tenantId: t, employeeId: employee, workDate: ctx.date(day) });
                continue;
            }
            const late = (index + day) % 7 === 0;
            const minute = late ? 22 : 0;
            const endHour = (index + day) % 11 === 0 ? 16 : 17;
            const status = ctx.mode === 'disabled' ? 'disabled' : ctx.mode === 'optional' && (index + day) % 9 === 0 ? 'unavailable' : ctx.mode === 'optional' && (index + day) % 13 === 0 ? 'outside' : 'verified';
            const log = await ctx.row('time_logs', `${key}:${day}`, { employee_id: employee, clock_in_time: ctx.time(day, 9, minute), clock_out_time: ctx.time(day, endHour), clock_in_location: null, is_valid_geofence: status === 'verified', attendance_location_mode: ctx.mode, location_status: status });
            if (status === 'verified' || status === 'outside')
                await client.query('UPDATE time_logs SET clock_in_location=ST_SetSRID(ST_MakePoint($3,$4),4326) WHERE tenant_id=$1 AND id=$2', [t, log, (person[2] === 'Sales & Success' ? 29.9187 : 31.2357) + (status === 'outside' ? 0.1 : 0), person[2] === 'Sales & Success' ? 31.2001 : 30.0444]);
            await ctx.row('attendance_breaks', `${key}:${day}:coffee`, { employee_id: employee, time_log_id: log, started_at: ctx.time(day, 11), ended_at: ctx.time(day, 11, 15), break_policy_id: paid, policy_name: 'Coffee pause', planned_minutes: 15, paid: true, source: 'policy', exception_status: 'none' });
            const request = await ctx.row('break_requests', `${key}:${day}:lunch`, { employee_id: employee, requested_start_time: ctx.time(day, 13), requested_end_time: ctx.time(day, 13, 30), duration_minutes: 30, reason: 'Lunch during the scheduled office shift.', status: 'approved', reviewed_by: ctx.people.get(person[5] ?? 'admin'), reviewed_at: ctx.time(day, 10), break_policy_id: meal, created_at: ctx.time(day, 9, 30) });
            await ctx.row('attendance_breaks', `${key}:${day}:lunch`, { employee_id: employee, time_log_id: log, started_at: ctx.time(day, 13), ended_at: ctx.time(day, 13, 30), requested_break_id: request, break_policy_id: meal, policy_name: 'Lunch break', planned_minutes: 30, paid: false, source: 'approved_request', exception_status: 'none' });
            if (allowUnfiled && day === -2 && ['employee', 'qa'].includes(key))
                await ctx.row('attendance_breaks', `${key}:${day}:exception`, { employee_id: employee, time_log_id: log, started_at: ctx.time(day, 15), ended_at: ctx.time(day, 15, 10), paid: false, source: 'unfiled', exception_status: key === 'qa' ? 'resolved' : 'unresolved', reason: 'Fictional unrequested personal pause.', resolved_at: key === 'qa' ? ctx.time(day, 16) : null });
            await rollupAttendanceWithClient(client, { tenantId: t, employeeId: employee, workDate: ctx.date(day) });
            const overlap = await client.query("SELECT id FROM roster_shifts WHERE tenant_id=$1 AND employee_id=$2 AND status='scheduled' AND tstzrange(start_time,end_time,'[)') && tstzrange($3::timestamptz,$4::timestamptz,'[)') AND id<>$5", [t, employee, ctx.time(day, 9), ctx.time(day, 17), fixtureId(`roster_shifts:${key}:${day}`)]);
            if (!overlap.rowCount)
                await ctx.row('roster_shifts', `${key}:${day}`, { employee_id: employee, created_by: admin, updated_by: admin, start_time: ctx.time(day, 9), end_time: ctx.time(day, 17), status: 'scheduled', notes: 'Northstar regular office shift.' });
        }
    }
    await ctx.row('roster_shifts', 'absence-example', { employee_id: ctx.people.get('recruiter'), created_by: admin, updated_by: admin, start_time: ctx.time(absentDay, 9), end_time: ctx.time(absentDay, 17), status: 'scheduled', notes: 'Fictional absence example: scheduled shift with no attendance record.' });
    for (const key of ['employee', 'qa']) {
        const exists = await client.query("SELECT id FROM break_requests WHERE tenant_id=$1 AND employee_id=$2 AND status='pending'", [t, ctx.people.get(key)]);
        if (!exists.rowCount || exists.rows[0].id === fixtureId(`break_requests:${key}:pending`))
            await ctx.row('break_requests', `${key}:pending`, { employee_id: ctx.people.get(key), requested_start_time: ctx.time(0, 14), requested_end_time: ctx.time(0, 14, 20), duration_minutes: 20, reason: 'Short personal appointment during the afternoon shift.', status: 'pending', created_at: ctx.time(-1, 16) });
    }
    // No active shift is synthesized: a public demo must not look as though a real employee clocked in.
}
export async function seedLeave(ctx: DemoContext) {
    const entries = [['employee', 'approved', -7, -7, 'annual', 'Planned personal day.'], ['employee', 'pending', 7, 9, 'annual', 'Upcoming family visit.'], ['qa', 'pending', 4, 4, 'personal', 'Personal appointment.'], ['designer', 'approved', 3, 5, 'annual', 'Scheduled annual leave.'], ['sales', 'rejected', -4, -3, 'annual', 'Client coverage conflicts with the requested dates.'], ['it', 'approved', -12, -11, 'sick', 'Historical sick leave; fictional fixture.'], ['hr', 'pending', 10, 11, 'annual', 'Upcoming short break.']] as const;
    for (const [i, [key, status, start, end, type, reason]] of entries.entries()) {
        const manager = employeeFixtures.find(e => e[0] === key)![5];
        const decision = status !== 'pending';
        const id = await ctx.row('leave_requests', String(i), { employee_id: ctx.people.get(key), start_date: ctx.date(start), end_date: ctx.date(end), leave_type: type, reason, status, approver_employee_id: ctx.people.get(manager ?? 'admin'), approval_source: 'direct_manager', approval_scope_type: 'direct_reports', approval_decided_at: decision ? ctx.time(start < 0 ? start - 2 : -2) : null, approved_at: status === 'approved' ? ctx.time(start < 0 ? start - 2 : -2) : null, rejected_at: status === 'rejected' ? ctx.time(-6) : null, approved_by: decision ? ctx.people.get(manager ?? 'admin') : null, approval_note: decision ? 'Reviewed the team coverage plan.' : null, submitted_at: ctx.time(Math.min(start - 3, -3)), created_at: ctx.time(Math.min(start - 3, -3)) });
        await ctx.row('leave_request_history', `${i}:submitted`, { leave_request_id: id, actor_employee_id: ctx.people.get(key), action: 'submitted', previous_status: null, new_status: 'pending', metadata: JSON.stringify({ demoFixture: true }), created_at: ctx.time(Math.min(start - 3, -3)) });
        if (decision)
            await ctx.row('leave_request_history', `${i}:decision`, { leave_request_id: id, actor_employee_id: ctx.people.get(manager ?? 'admin'), action: status, previous_status: 'pending', new_status: status, metadata: JSON.stringify({ demoFixture: true }), created_at: ctx.time(start < 0 ? start - 2 : -2) });
    }
}
