import type { DemoContext } from './core';
import { HIRING_STAGES } from '../../src/lib/hiring-stages';
export async function seedHiringGoals(ctx: DemoContext) {
    const admin = ctx.people.get('admin')!, manager = ctx.people.get('manager')!;
    const candidates = [['Amira Hassan', 'People Partner', 'Human Resources', 'new'], ['Karim Elmasry', 'Frontend Engineer', 'Engineering', 'new'], ['Lina Farouk', 'Finance Analyst', 'Finance', 'hr_review'], ['Omar Nabil', 'Operations Supervisor', 'Operations', 'hr_review'], ['Salma Youssef', 'Product Designer', 'Product', 'final_review'], ['Youssef Adel', 'Customer Success Lead', 'Sales & Success', 'final_review'], ['Noor Ibrahim', 'Finance Specialist', 'Finance', 'screening'], ['Tarek Samir', 'Support Specialist', 'IT', 'interview'], ['Hala Mostafa', 'Talent Partner', 'Human Resources', 'rejected'], ['Hana Nasser', 'Backend Engineer', 'Engineering', 'offer'], ['Zein Sami', 'Account Executive', 'Sales & Success', 'hiring_manager_review'], ['Rana Fathi', 'Product Researcher', 'Product', 'hired']] as const;
    await ctx.client.query("UPDATE hiring_applicants SET status='archived',archived_at=COALESCE(archived_at,NOW()) WHERE tenant_id=$1 AND (email=ANY($2::text[]) OR full_name LIKE 'Hiring Integration %')", [ctx.tenantId, ['amira.hassan', 'karim.elmasry', 'lina.farouk', 'omar.nabil', 'salma.youssef', 'youssef.adel', 'noor.ibrahim', 'tarek.samir', 'hala.mostafa'].map(n => n + '@stanza-demo.invalid')]);
    const canonical = ['new', 'screening', 'hr_review', 'hiring_manager_review', 'interview', 'final_review', 'offer', 'hired'];
    for (const [i, [name, title, department, stage]] of candidates.entries()) {
        if (!HIRING_STAGES.includes(stage))
            throw new Error('Invalid candidate stage');
        const id = await ctx.row('hiring_applicants', String(i), { full_name: name, email: `candidate-${i + 1}@northstar.example.invalid`, phone: `+20 100 000 ${String(1001 + i)}`, position_title: title, department, source: i % 2 ? 'Employee referral' : 'Northstar Careers', stage, status: 'active', current_owner_id: ['interview', 'hiring_manager_review'].includes(stage) ? ctx.people.get('recruiter') : admin, created_by: admin, updated_by: admin, applied_at: ctx.time(-24 + i), created_at: ctx.time(-24 + i), updated_at: ctx.time(-1) });
        const path = stage === 'rejected' ? ['new', 'screening', 'rejected'] : canonical.slice(0, canonical.indexOf(stage) + 1);
        for (const [j, current] of path.entries())
            await ctx.row('hiring_stage_history', `${i}:${j}`, { applicant_id: id, actor_id: admin, previous_stage: j ? path[j - 1] : null, new_stage: current, reason: 'Fictional Northstar structured recruiting review.', created_at: ctx.time(-24 + i + j) });
        await ctx.row('hiring_applicant_notes', `${i}:team`, { applicant_id: id, author_id: admin, note_text: `Fictional candidate for ${title}. Review the structured interview rubric.`, note_type: 'screening', visibility: 'hiring_team', created_at: ctx.time(-2) });
        if (stage === 'final_review')
            await ctx.row('hiring_applicant_notes', `${i}:decision`, { applicant_id: id, author_id: admin, note_text: 'Fictional final compensation review is pending; this is not a real hiring decision.', note_type: 'decision', visibility: 'hr_only', created_at: ctx.time(-1) });
    }
    const cycle = await ctx.row('performance_review_cycles', 'current', { name: 'Northstar current growth review', description: 'Fictional monthly coaching and delivery review.', review_period_start: ctx.date(-28), review_period_end: ctx.date(14), self_review_opens_at: ctx.time(-5), self_review_due_at: ctx.time(5), peer_review_due_at: ctx.time(8), manager_review_due_at: ctx.time(12), status: 'active', created_by: admin });
    const template = await ctx.row('performance_review_templates', 'delivery', { name: 'Delivery and collaboration', description: 'Small fictional review template.', is_active: true, created_by: admin });
    const question = await ctx.row('performance_review_questions', 'delivery', { template_id: template, prompt: 'Describe progress on reliable delivery and collaboration.', question_type: 'long_text', sort_order: 0, is_required: true });
    const monday = -((ctx.now.getUTCDay() + 6) % 7);
    const titles = ['Complete release accessibility checks', 'Document the client onboarding checklist', 'Improve release test coverage', 'Complete the team learning session'];
    for (const [i, key] of ['employee', 'qa', 'backend', 'designer', 'ops', 'it', 'new', 'hr', 'sales', 'success', 'manager'].entries()) {
        const employee = ctx.people.get(key)!;
        const complete = i % 4 === 0;
        const status = complete ? 'completed' : i % 4 === 2 ? 'at_risk' : 'active';
        const goal = await ctx.row('performance_goals', key, { employee_id: employee, cycle_id: cycle, title: titles[i % 4], description: 'Northstar delivery goal with a clear weekly checkpoint.', goal_type: 'goal', progress_percent: complete ? 100 : 35 + i * 3, status, starts_at: ctx.date(-14), due_at: ctx.date(status === 'at_risk' ? -1 : 7), created_by: i % 2 ? employee : manager, completed_at: complete ? ctx.time(-1) : null });
        await ctx.row('performance_goal_updates', key, { goal_id: goal, updated_by: employee, previous_progress: 0, new_progress: complete ? 100 : 35 + i * 3, note: 'Fictional checkpoint recorded.', created_at: ctx.time(-1) });
        await ctx.row('roster_goals', key, { employee_id: employee, created_by: i % 2 ? employee : manager, updated_by: employee, roster_week_start: ctx.date(monday), due_date: ctx.date(monday + 4), title: titles[i % 4], description: 'Weekly task supporting the delivery goal.', priority: i % 3 === 0 ? 'high' : 'normal', status: complete ? 'completed' : 'in_progress', completion_note: complete ? 'Checklist completed and shared with the team.' : null, completed_at: complete ? ctx.time(-1) : null });
    }
    for (const key of ['employee', 'qa', 'backend']) {
        const employee = ctx.people.get(key)!;
        const review = await ctx.row('performance_reviews', key, { cycle_id: cycle, employee_id: employee, manager_id: manager, template_id: template, status: 'self_review' });
        const assignment = await ctx.row('performance_review_assignments', `${key}:self`, { review_id: review, reviewer_employee_id: employee, reviewer_type: 'self', status: 'in_progress', due_at: ctx.time(5) });
        await ctx.row('performance_review_responses', key, { assignment_id: assignment, question_id: question, response_text: 'Fictional draft: completed release checks and improved handoff documentation.' });
        await ctx.row('performance_review_assignments', `${key}:manager`, { review_id: review, reviewer_employee_id: manager, reviewer_type: 'manager', status: 'pending', due_at: ctx.time(12) });
    }
}
