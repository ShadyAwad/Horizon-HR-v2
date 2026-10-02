import type { DemoContext } from './core';
import { employeeFixtures, fixtureId, demoAmount } from './core';
export async function seedFinanceAssets(ctx: DemoContext) {
    const admin = ctx.people.get('admin');
    for (const [i, p] of employeeFixtures.filter(e => e[0] !== 'former').entries()) {
        const id = await ctx.row('assets', p[0], { asset_tag: `NS-LAP-${String(i + 1).padStart(3, '0')}`, category: 'laptop', name: `Northstar work laptop ${i + 1}`, manufacturer: 'Fictional Devices', model: 'Workstation 14', serial_number: `DEMO-NS-${i + 1}`, status: i === 21 ? 'maintenance' : i === 22 ? 'available' : 'assigned', condition: i === 21 ? 'fair' : 'good', purchase_date: ctx.date(-240), purchase_cost: demoAmount(ctx, 32000), created_by: admin });
        if (i < 21)
            await ctx.row('asset_assignments', p[0], { asset_id: id, employee_id: ctx.people.get(p[0]), assigned_by: ctx.people.get('it-head'), assigned_at: ctx.time(p[0] === 'new' ? -5 : -180), status: 'active' });
    }
    for (const [key, category, name] of [['phone', 'phone', 'Client visit phone'], ['badge', 'badge', 'Sarah access card']] as const) {
        const id = await ctx.row('assets', key, { asset_tag: `NS-${key.toUpperCase()}-001`, category, name, status: key === 'badge' ? 'assigned' : 'available', condition: 'good', created_by: admin });
        if (key === 'badge')
            await ctx.row('asset_assignments', key, { asset_id: id, employee_id: ctx.people.get('employee'), assigned_by: ctx.people.get('it-head'), assigned_at: ctx.time(-90), status: 'active' });
    }
    const returned = await ctx.row('assets', 'returned-monitor', { asset_tag: 'NS-MON-001', category: 'monitor', name: 'Returned 24-inch monitor', status: 'available', condition: 'good', created_by: admin });
    await ctx.row('asset_assignments', 'returned-monitor', { asset_id: returned, employee_id: ctx.people.get('former'), assigned_by: ctx.people.get('it-head'), assigned_at: ctx.time(-180), returned_at: ctx.time(-30), return_condition: 'good', return_notes: 'Returned at the end of the fictional assignment.', status: 'returned' });
    const expenses = [['employee', 'pending', 'transport', 240, 'City transport', 'Client workshop transport'], ['employee', 'approved', 'meals', 380, 'Workshop cafe', 'Team meal during the client workshop'], ['ops', 'reimbursed', 'office_supplies', 1250, 'Office supply shop', 'Meeting-room stationery'], ['sales', 'rejected', 'travel', 6400, 'Travel desk', 'Unapproved itinerary; revised booking requested'], ['it', 'approved', 'software', 890, 'Software vendor', 'Monthly testing tool subscription'], ['designer', 'pending', 'travel', 2150, 'Intercity rail', 'Alexandria research session']] as const;
    for (const [i, [key, status, category, amount, merchant, reason]] of expenses.entries()) {
        const approved = ['approved', 'reimbursed'].includes(status);
        const claim = await ctx.row('expense_claims', String(i), { employee_id: ctx.people.get(key), merchant_name: merchant, expense_date: ctx.date(-i - 2), amount: demoAmount(ctx, amount), currency: ctx.currency, category, business_reason: reason, status, approver_employee_id: admin, approval_source: 'hr_admin', approval_scope_type: 'company', approval_decided_at: status === 'pending' ? null : ctx.time(-1, 10), approved_at: approved ? ctx.time(-1, 10) : null, rejected_at: status === 'rejected' ? ctx.time(-1, 10) : null, reimbursed_at: status === 'reimbursed' ? ctx.time(-1, 14) : null, reimbursed_by_employee_id: status === 'reimbursed' ? admin : null, reimbursement_external_reference: status === 'reimbursed' ? 'DEMO-REIMBURSEMENT-003' : null, idempotency_key: `northstar-fixture-${i}`, request_fingerprint: fixtureId('expense:' + i).replaceAll('-', '').padEnd(64, '0'), submitted_at: ctx.time(-i - 1, 9) });
        await ctx.row('expense_claim_history', `${i}:submitted`, { expense_claim_id: claim, actor_employee_id: ctx.people.get(key), action: 'submitted', previous_status: null, new_status: 'pending', metadata: JSON.stringify({ demoFixture: true }), created_at: ctx.time(-i - 1, 9) });
        if (status !== 'pending')
            await ctx.row('expense_claim_history', `${i}:decision`, { expense_claim_id: claim, actor_employee_id: admin, action: approved ? 'approved' : status, previous_status: 'pending', new_status: approved ? 'approved' : status, metadata: JSON.stringify({ demoFixture: true }), created_at: ctx.time(-1, 14) });
    }
    const reimbursement = fixtureId('expense_claims:2');
    await ctx.row('expense_claim_history', '2:reimbursement', { expense_claim_id: reimbursement, actor_employee_id: admin, action: 'reimbursed', previous_status: 'approved', new_status: 'reimbursed', metadata: JSON.stringify({ demoFixture: true }), created_at: ctx.time(-1, 14) });
    const payrollTime = (day: number) => { const d = new Date(ctx.now); d.setUTCDate(day); return d.toISOString(); };
    const previousMonth = new Date(ctx.now);
    previousMonth.setUTCDate(1);
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
    const end = new Date(ctx.now);
    end.setUTCDate(0);
    for (const p of employeeFixtures.filter(e => !['former', 'new'].includes(e[0]))) {
        const salary = demoAmount(ctx, p[6]);
        const record = await ctx.row('payroll_records', p[0], { employee_id: ctx.people.get(p[0]), pay_period_start: previousMonth.toISOString().slice(0, 10), pay_period_end: end.toISOString().slice(0, 10), base_salary: salary, bonuses: p[0] === 'employee' ? demoAmount(ctx, 1500) : 0, deductions: p[0] === 'employee' ? demoAmount(ctx, 500) : 0, net_pay: salary + (p[0] === 'employee' ? demoAmount(ctx, 1000) : 0), currency: ctx.currency, status: 'paid', generated_by: admin, approved_by: admin, approved_at: payrollTime(1), paid_at: payrollTime(1), generated_at: payrollTime(1) });
    }
    if (ctx.loans) {
        for (const [key, principal, balance, status] of [['qa', 6000, 4000, 'active'], ['employee', 3000, 0, 'paid']] as const) {
            const loan = await ctx.row('employee_loans', key, { employee_id: ctx.people.get(key), loan_name: 'Fictional equipment support loan', principal_amount: demoAmount(ctx, principal), outstanding_balance: demoAmount(ctx, balance), currency: ctx.currency, repayment_amount: demoAmount(ctx, 1000), repayment_frequency: 'monthly', status, issued_at: ctx.date(-120), due_date: ctx.date(60), created_by: admin, updated_by: admin });
            for (let i = 0; i < (principal - balance) / 1000; i++)
                await ctx.row('employee_loan_payments', `${key}:${i}`, { loan_id: loan, amount: demoAmount(ctx, 1000), created_at: ctx.time(-90 + i * 30) });
        }
    }
}
