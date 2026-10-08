import {operationalExecutor} from './operational-execution';
import {workforceExecutor} from './workforce-entity-execution';
import type { PoolClient } from 'pg';
import { CASE_STATUSES } from '../../lib/grievance-contract';
import { normalizeQuery } from '../../lib/intelligent-router';
import { type EntityChoices, type EntityParameters, type EntityRoute } from '../../lib/router-entities';
import type { CaseActor } from '../grievances/grievance-policy';
import { lookupEmployeeGrievances } from '../grievances/grievance-lookup';
import { entityResolvers } from './entity-resolvers';
/** Explicit allowlisted executor. Classifier parameters are only untrusted text. */
export async function executeEntityIntent(c: PoolClient, actor: CaseActor, query: string, choices: EntityChoices = {}, parameters: EntityParameters = {}): Promise<EntityRoute> {
 const employee = await entityResolvers.employee({ client: c, actor, query, proposed: parameters.employeeName, choice: choices.employee });
 const entities = [employee];
 const locationRequested = !!parameters.locationName || /\b(?:from|at|in)\s+\S|(?:من|في)\s+\S/u.test(query);
 if (locationRequested && employee.status !== 'forbidden') entities.push(await entityResolvers.location({ client: c, actor, query, proposed: parameters.locationName, choice: choices.location }));
 const base = { entities, cases: [], locationMeaning: 'employee_current_team' as const };
 const failed = entities.find(e => e.status !== 'resolved');
 if (failed) return { ...base, status: failed.status as 'ambiguous' | 'unresolved' | 'forbidden' };
 const normalized = normalizeQuery(query);
 const statuses = CASE_STATUSES.filter(s => new RegExp('(?:^| )' + s.replaceAll('_', ' ') + '(?: |$)').test(normalized));
 if (statuses.length > 1) return { ...base, status: 'unresolved' };
 const reference = query.match(/\bGRV-\d{4}-\d{6,}\b/i)?.[0].toUpperCase();
 const cases = await lookupEmployeeGrievances(c, actor, employee.entityId!, { locationId: entities.find(e => e.type === 'location')?.entityId, status: statuses[0], reference, category: /\bdisciplinary\b|تاديبي/u.test(normalized) ? 'conduct' : undefined });
 const selected = choices.case ? cases.find(row => row.id === choices.case) : cases.length === 1 ? cases[0] : undefined;
 return { ...base, status: selected ? 'resolved' : cases.length && !choices.case ? 'ambiguous' : 'unresolved', cases: cases.slice(0, 8), caseId: selected?.id };
}

export const entityExecutors = { operational_support_onboarding:operationalExecutor('operational_support_onboarding'),operational_support:operationalExecutor('operational_support'),operational_hiring:operationalExecutor('operational_hiring'),operational_onboarding:operationalExecutor('operational_onboarding'),operational_composition:operationalExecutor('operational_composition'), employee_grievance_lookup: executeEntityIntent, employee_equipment: workforceExecutor('employee_equipment'), asset_holder: workforceExecutor('asset_holder'), support_lookup: workforceExecutor('support_lookup'), support_report: workforceExecutor('support_report'), hiring_jobs_query: workforceExecutor('hiring_jobs_query'), hiring_candidates_query: workforceExecutor('hiring_candidates_query'), hiring_interviews_query: workforceExecutor('hiring_interviews_query') };
