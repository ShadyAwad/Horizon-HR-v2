import type { PoolClient } from 'pg';
import { parseOperationalPlan, validateOperationalPlan, resolveDateWindow, operationalIntent, type OperationalPlan } from '../../lib/operational-plan';
import type { EntityRoute, EntityChoices, EntityParameters, EntityResolution } from '../../lib/router-entities';
import { resolveWorkforceEntity } from './workforce-entity-execution';
import { listSupportTickets } from '../support/support-routes';
import { listHiringOperational, listAcceptedOfferOnboarding } from '../hiring/hiring-queries';
import { onboardingReadiness, requireHiring, type HiringActor } from '../hiring/onboarding-service';
export function operationalExecutor(key: string) {
    return async (c: PoolClient, u: HiringActor, query: string, choices: EntityChoices = {}, parameters: EntityParameters = {}): Promise<EntityRoute> => {
        const entities: EntityResolution[] = [], base = { entities, cases: [], locationMeaning: 'employee_current_team' as const };
        const fail = (status: 'unresolved' | 'ambiguous' | 'forbidden'): EntityRoute => ({ ...base, status });
        let plan = parseOperationalPlan(query);
        if (!plan)
            return fail('unresolved');
        if (parameters.plan) {
            const proposed = validateOperationalPlan(parameters.plan);
            const clean = { ...proposed.filters };
            for (const k of ['employeeName', 'assetName', 'locationName', 'jobName', 'candidateName'] as const)
                delete clean[k];
            if (proposed.domain !== plan.domain || proposed.resource !== plan.resource || JSON.stringify(Object.entries(clean).sort()) !== JSON.stringify(Object.entries(plan.filters).sort()))
                return fail('unresolved');
            plan = proposed;
        }
        if (operationalIntent(plan) !== key)
            return fail('unresolved');
        for (const k of ['employeeName', 'assetName', 'locationName', 'jobName', 'candidateName'] as const)
            if (parameters[k])
                plan.filters[k] = parameters[k];
        plan = validateOperationalPlan(plan);
        const f = plan.filters, ids: Record<string, string> = {}, resolve = async (type: 'employee' | 'asset' | 'location' | 'job_opening' | 'candidate', name?: string, employee?: string) => { if (name && !query.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
            return false; const e = await resolveWorkforceEntity(c, u, query, type, choices[type], employee); entities.push(e); if (e.entityId)
            ids[type] = e.entityId; return e.status === 'resolved'; };
        if (f.employeeName || /['’]s|معاه/u.test(query)) {
            if (!await resolve('employee', f.employeeName))
                return fail(entities.at(-1)?.status as any || 'unresolved');
        }
        if (f.assetName || /['’]s laptop|\b[A-Z]{2,}-[A-Z0-9]+-\d+\b/u.test(query)) {
            if (!await resolve('asset', f.assetName, ids.employee))
                return fail(entities.at(-1)?.status as any || 'unresolved');
        }
        if (f.locationName || /for .*warehouse|for .*office|مخزن|مستودع/iu.test(query)) {
            if (!await resolve('location', f.locationName))
                return fail(entities.at(-1)?.status as any || 'unresolved');
        }
        if (f.jobName || plan.resource === 'interviews' && /for .+ (?:today|tomorrow|this week|next week)|لوظيفه/iu.test(query)) {
            if (!await resolve('job_opening', f.jobName))
                return fail(entities.at(-1)?.status as any || 'unresolved');
        }
        if (f.candidateName) {
            if (!await resolve('candidate', f.candidateName))
                return fail(entities.at(-1)?.status as any || 'unresolved');
        }
        const clock = (await c.query("SELECT current_date::text today,current_setting('TimeZone') timezone")).rows[0], dates = resolveDateWindow(f, clock.today);
        let rows: any[] = [], total = 0;
        try {
            if (plan.resource === 'tickets') {
                const cross = plan.domain === 'composition';
                if (cross) {
                    await requireHiring(c, u, 'hiring.onboarding.view');
                    if (!dates.from)
                        return fail('unresolved');
                }
                const data = await listSupportTickets(c, u, { queue: 'true', pageSize: 5, status: f.status ?? '', assignment: f.assigned ?? '', olderThanDays: f.olderThanDays, ...(cross ? { startsFrom: dates.from, startsTo: dates.to } : { from: dates.from, to: dates.to }), damagedAssets: f.damagedAssets, laptopOnly: f.laptopOnly, requesterId: ids.employee, assetId: ids.asset, locationId: ids.location });
                rows = data.tickets.map((r: any) => ({ id: r.id, label: r.summary, detail: r.status + ' · ' + r.requester_name }));
                total = data.total;
            }
            else if (plan.resource === 'hires' && f.acceptedOffers) {
                if(Object.keys(f).some(k=>!['acceptedOffers','incomplete'].includes(k)))return fail('unresolved');
                rows=await listAcceptedOfferOnboarding(c,u);total=rows[0]?.total??0;
            }
            else if (plan.resource === 'hires') {
                if(f.incomplete)await requireHiring(c,u,'hiring.view');
                if (f.missingLaptop) {
                    await requireHiring(c, u, 'assets.view');
                }
                if (f.missingShift) {
                    await requireHiring(c, u, 'roster.view_all');
                }
                const data = await onboardingReadiness(c, u, { employeeId: ids.employee, from: dates.from, to: dates.to, state: f.state, kind: f.taskKind, overdue: f.overdue, missingLaptop: f.missingLaptop, missingShift: f.missingShift, incomplete: f.incomplete });
                rows = data.hires.slice(0, 5).map((r: any) => ({ id: r.id, label: r.full_name, detail: r.readiness + ' · ' + (r.reasons.join('; ') || 'Checklist complete') }));
                total = data.total;
            }
            else {
                rows = await listHiringOperational(c, u, plan, dates, { jobId: ids.job_opening, candidateId: ids.candidate });
                total = rows[0]?.total ?? 0;
            }
        }
        catch (e) {
            if ((e as any).statusCode === 403)
                return fail('forbidden');
            throw e;
        }
        return { ...base, status: 'resolved', items: rows, total, summary: 'Operational ' + plan.resource, operational: { kind: plan.domain === 'composition' || f.damagedAssets ? 'composition' : Object.keys(f).length ? 'filtered' : entities.length ? 'entity' : 'single_intent', plan, timeZone: clock.timezone, dateWindow: dates } };
    };
}
