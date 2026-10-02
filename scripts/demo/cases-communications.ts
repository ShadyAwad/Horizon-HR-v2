import { fixtureId, type DemoContext } from './core';
export async function seedGrievances(ctx: DemoContext) {
    const admin = ctx.people.get('admin')!;
    const fixtures = [['submitted', 'employee', 'Workstation lighting question', 'Operations'], ['assigned', 'qa', 'Quiet testing room request', 'Operations'], ['in_progress', 'employee', 'Access-card replacement delay', 'IT'], ['waiting', 'designer', 'Shared equipment booking clarification', 'Operations'], ['resolved', 'ops', 'Storage-room signage improvement', 'Operations'], ['assigned', 'hr', 'Fictional confidential policy clarification', 'Human Resources']] as const;
    for (const [i, [status, person, title, dep]] of fixtures.entries()) {
        const confidential = i === 5;
        const assigned = status !== 'submitted';
        const existing = await ctx.client.query('SELECT created_at FROM grievances WHERE tenant_id=$1 AND id=$2', [ctx.tenantId, (await import('./core')).fixtureId(`grievances:${i}`)]);
        // Append-only history keeps its original timeline on refresh.
        const created = existing.rows[0]?.created_at ?? ctx.time(-10 + i);
        const caseId = await ctx.row('grievances', String(i), { employee_id: ctx.people.get(person), assigned_to: assigned ? admin : null, title, description: `Clearly fictional Northstar case: ${title.toLowerCase()}. No real personal allegation is represented.`, category: 'general', priority: i === 2 ? 'high' : 'normal', status, case_number: `GRV-DEMO-${String(i + 1).padStart(6, '0')}`, destination_department_id: ctx.departments.get(dep), assigned_department_id: assigned ? ctx.departments.get(dep) : null, confidentiality: confidential ? 'confidential' : 'standard', resolved_by: status === 'resolved' ? admin : null, resolved_at: status === 'resolved' ? ctx.time(-1) : null, resolution_summary: status === 'resolved' ? 'Fictional resolution: signage installed and reviewed with the team.' : null, created_at: created, updated_at: ctx.time(-1) });
        await ctx.row('grievance_case_events', `${i}:submitted`, { case_id: caseId, actor_id: ctx.people.get(person), kind: 'submitted', visibility: 'employee', metadata: JSON.stringify({ demoFixture: true }), created_at: created }, true);
        if (assigned) {
            await ctx.row('grievance_case_events', `${i}:triaged`, { case_id: caseId, actor_id: admin, kind: 'status_changed', visibility: 'employee', metadata: JSON.stringify({ previousStatus: 'submitted', newStatus: 'triaged', demoFixture: true }), created_at: ctx.time(-4) }, true);
            await ctx.row('grievance_case_events', `${i}:assigned`, { case_id: caseId, actor_id: admin, kind: 'assigned', visibility: 'internal', metadata: JSON.stringify({ demoFixture: true, assignedTo: admin, assignedDepartmentId: ctx.departments.get(dep) }), created_at: ctx.time(-3) }, true);
            await ctx.row('grievance_messages', `${i}:internal`, { case_id: caseId, actor_id: admin, kind: 'internal', body: 'Fictional handler note. Verify the internal checklist before the employee response.', created_at: ctx.time(-2) }, true);
            await ctx.row('grievance_messages', `${i}:response`, { case_id: caseId, actor_id: admin, kind: 'response', body: 'We have received this fictional request and are checking the next steps.', created_at: ctx.time(-2, 10) }, true);
        }
        if (status === 'resolved')
            await ctx.row('grievance_case_events', `${i}:progress`, { case_id: caseId, actor_id: admin, kind: 'status_changed', visibility: 'employee', metadata: JSON.stringify({ previousStatus: 'assigned', newStatus: 'in_progress', demoFixture: true }), created_at: ctx.time(-2) }, true);
        if (['in_progress', 'waiting', 'resolved'].includes(status))
            await ctx.row('grievance_case_events', `${i}:status`, { case_id: caseId, actor_id: admin, kind: 'status_changed', visibility: 'employee', metadata: JSON.stringify({ previousStatus: status === 'resolved' ? 'in_progress' : 'assigned', newStatus: status, demoFixture: true }), created_at: ctx.time(-1) }, true);
        if (status === 'waiting')
            await ctx.row('grievance_messages', `${i}:follow-up`, { case_id: caseId, actor_id: ctx.people.get(person), kind: 'follow_up', body: 'Fictional employee update: the equipment booking times are attached to the internal checklist.', created_at: ctx.time(-1) }, true);
        if (status === 'resolved')
            await ctx.row('grievance_messages', `${i}:resolution`, { case_id: caseId, actor_id: admin, kind: 'resolution', body: 'Fictional resolution: signage installed and reviewed with the team.', created_at: ctx.time(-1) }, true);
    }
    await ctx.client.query('INSERT INTO grievance_case_counters(tenant_id,last_number,permissions_migrated) VALUES($1,6,true) ON CONFLICT(tenant_id) DO UPDATE SET last_number=GREATEST(grievance_case_counters.last_number,6)', [ctx.tenantId]);
}
export async function seedCommunicationsFeed(ctx: DemoContext) {
    const admin = ctx.people.get('admin')!, employee = ctx.people.get('employee')!;
    const template = await ctx.row('communication_templates', 'welcome', { name: 'Northstar onboarding check-in', subject: 'Your first-week check-in', body: 'Welcome to Northstar Systems. Please review your first-week checklist with your manager.', category: 'welcome', created_by: admin });
    for (const [i, status] of ['scheduled', 'completed', 'cancelled'].entries()) {
        const day = status === 'scheduled' ? 3 : -5 - i;
        const meeting = await ctx.row('communication_meetings', status, { organizer_id: admin, title: `Northstar ${status === 'scheduled' ? 'upcoming onboarding' : status === 'completed' ? 'completed team check-in' : 'cancelled office planning'} meeting`, notes: 'Fictional meeting fixture. No invitation is sent.', starts_at: ctx.time(day, 12), ends_at: ctx.time(day, 13), timezone: 'Africa/Cairo', location: 'Cairo HQ meeting room', status, related_employee_id: employee });
        await ctx.client.query('INSERT INTO communication_meeting_attendees(tenant_id,meeting_id,employee_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [ctx.tenantId, meeting, employee]);
    }
    for (const [i, status] of ['draft', 'sent', 'failed'].entries()) {
        const message = await ctx.row('communication_messages', status, { sender_id: admin, template_id: template, subject: `[Fictional demo] ${status === 'draft' ? 'Onboarding checklist draft' : status === 'sent' ? 'Simulated onboarding history' : 'Simulated provider failure'}`, body: 'Clearly fictional Northstar communication. Seeded history only; no email was sent.', category: 'welcome', status, recipient_ids: [employee], recipients: ['employee@stanza-demo.invalid'], related_employee_id: employee, provider_id: status === 'sent' ? 'demo-simulation:no-delivery' : null, failure_code: status === 'failed' ? 'demo_simulation' : null, failure_reason: status === 'failed' ? 'Fictional failed-provider example; no provider was contacted.' : null, attempts: status === 'draft' ? 0 : 1, sent_at: status === 'sent' ? ctx.time(-2) : null, first_attempt_at: status === 'draft' ? null : ctx.time(-2), created_at: ctx.time(-3), updated_at: ctx.time(-2) });
        await ctx.client.query('INSERT INTO communication_message_events(tenant_id,message_id,status,code,created_at) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM communication_message_events WHERE tenant_id=$1 AND message_id=$2 AND code=$4)', [ctx.tenantId, message, status, 'demo_simulation_no_delivery', ctx.time(-2)]);
    }
    await ctx.client.query("UPDATE company_feed_posts SET status='archived',archived_at=COALESCE(archived_at,NOW()) WHERE tenant_id=$1 AND title='Welcome to Stanza Demo'", [ctx.tenantId]);
    const posts = [['Welcome our new engineers', 'Welcome Jana and the engineering team to the fictional Northstar office.', 'announcement'], ['Cairo HQ maintenance window', 'Meeting-room lighting maintenance is planned this Friday.', 'announcement'], ['Benefits and leave reminder', 'Review your upcoming leave plans with your manager before booking travel.', 'policy_update'], ['Quarterly delivery update', 'Our fictional client onboarding release passed its accessibility review.', 'general'], ['Engineering team achievement', 'Thank you to Sarah and the quality team for improving release coverage.', 'general'], ['Office planning session', 'The next office planning session will cover equipment and shared spaces.', 'announcement']] as const;
    for (const [i, [title, text, type]] of posts.entries()) {
        const post = await ctx.row('company_feed_posts', String(i), { author_employee_id: admin, title, content_text: text, content_json: JSON.stringify({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children: [{ type: 'text', version: 1, text, format: 0, detail: 0, mode: 'normal', style: '' }] }] } }), post_type: type, status: 'published', created_at: ctx.time(-i - 1), published_at: ctx.time(-i - 1) });
        await ctx.client.query("INSERT INTO company_feed_visibility(tenant_id,post_id,visibility_type) SELECT $1,$2,'all' WHERE NOT EXISTS(SELECT 1 FROM company_feed_visibility WHERE tenant_id=$1 AND post_id=$2 AND visibility_type='all')", [ctx.tenantId, post]);
    }
    // Processed in-app outbox fixtures demonstrate event history without creating delivery jobs.
    for (const [i, [type, key, entity]] of [['notification.leave_requested', 'manager', 'leave_requests'], ['notification.company_feed_posted', 'employee', 'company_feed_posts'], ['notification.grievance_assigned', 'admin', 'grievances']].entries())
        await ctx.row('outbox_events', String(i), { event_type: type, payload: JSON.stringify({ demoFixture: true, deliverySuppressed: true, channel: 'in_app', employeeId: ctx.people.get(key), entityType: entity }), processed_at: ctx.time(-1), created_at: ctx.time(-1) });
    for (const [i, [action, table]] of [['employee.updated', 'employees'], ['clock_out', 'time_logs'], ['leave_status_changed', 'leave_requests'], ['role.updated', 'tenant_roles'], ['grievance.assigned', 'grievances'], ['asset.assigned', 'assets']].entries())
        await ctx.row('audit_logs', String(i), { actor_employee_id: admin, action, entity_type: table, entity_id: table === 'grievances' ? fixtureId('grievances:1') : table === 'employees' ? employee : ctx.tables.get(table)?.values().next().value ?? employee, metadata: JSON.stringify({ demoFixture: true, company: 'Northstar Systems', source: 'guarded_demo_seed' }), created_at: ctx.time(-i - 1) });
}
