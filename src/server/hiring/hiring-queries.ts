import type { PoolClient } from 'pg';
import type { OperationalPlan } from '../../lib/operational-plan';
import { requireHiring, type HiringActor } from './onboarding-service';
export async function listHiringOperational(c: PoolClient, u: HiringActor, plan: OperationalPlan, dates: {
    from?: string;
    to?: string;
}, entities: {
    jobId?: string;
    candidateId?: string;
} = {}) {
    await requireHiring(c, u, 'hiring.view');
    const f = plan.filters;
    if (plan.resource === 'offers') {
        await requireHiring(c, u, 'hiring.manage_offers');
        await requireHiring(c, u, 'compensation.manage');
        return (await c.query(`SELECT o.id,a.full_name label,o.expires_on::text detail,count(*) OVER()::int total FROM hiring_offers o JOIN hiring_applicants a ON a.tenant_id=o.tenant_id AND a.id=o.applicant_id WHERE o.tenant_id=$1 AND o.status='sent' AND o.expires_on>=current_date AND ($2::date IS NULL OR o.expires_on>=$2) AND ($3::date IS NULL OR o.expires_on<$3) AND ($4::uuid IS NULL OR a.id=$4) ORDER BY o.expires_on,o.id LIMIT 5`, [u.tenantId, dates.from ?? null, dates.to ?? null, entities.candidateId ?? null])).rows;
    }
    if (plan.resource === 'jobs')
        return (await c.query(`SELECT j.id,j.title label,j.status detail,count(*) OVER()::int total FROM hiring_jobs j WHERE j.tenant_id=$1 AND j.status='open' AND ($2::boolean=false OR NOT EXISTS(SELECT 1 FROM hiring_applicants a WHERE a.tenant_id=j.tenant_id AND a.job_id=j.id)) AND ($3::uuid IS NULL OR j.id=$3) ORDER BY j.created_at,j.id LIMIT 5`, [u.tenantId, f.noApplicants ?? false, entities.jobId ?? null])).rows;
    if (plan.resource === 'interviews')
        return (await c.query(`SELECT i.id,m.title label,m.starts_at::text detail,count(*) OVER()::int total FROM hiring_interviews i JOIN communication_meetings m ON m.tenant_id=i.tenant_id AND m.id=i.meeting_id JOIN hiring_applicants a ON a.tenant_id=i.tenant_id AND a.id=i.applicant_id WHERE i.tenant_id=$1 AND m.status='scheduled' AND ($2::date IS NULL OR m.starts_at>=$2) AND ($3::date IS NULL OR m.starts_at<$3) AND ($4::uuid IS NULL OR a.job_id=$4) ORDER BY m.starts_at,i.id LIMIT 5`, [u.tenantId, dates.from ?? null, dates.to ?? null, entities.jobId ?? null])).rows;
    return (await c.query(`SELECT a.id,a.full_name label,a.position_title||' · '||a.stage detail,count(*) OVER()::int total FROM hiring_applicants a WHERE a.tenant_id=$1 AND a.status='active' AND ($2::text IS NULL OR a.stage=$2) AND ($3::int IS NULL OR COALESCE((SELECT max(h.created_at) FROM hiring_stage_history h WHERE h.tenant_id=a.tenant_id AND h.applicant_id=a.id AND h.new_stage=a.stage),a.created_at)<now()-make_interval(days=>$3)) AND ($4::boolean=false OR EXISTS(SELECT 1 FROM hiring_interviews i JOIN communication_meetings m ON m.tenant_id=i.tenant_id AND m.id=i.meeting_id JOIN communication_meeting_attendees att ON att.tenant_id=m.tenant_id AND att.meeting_id=m.id WHERE i.tenant_id=a.tenant_id AND i.applicant_id=a.id AND m.status<>'cancelled' AND m.ends_at<=now() AND NOT EXISTS(SELECT 1 FROM hiring_evaluations v WHERE v.tenant_id=i.tenant_id AND v.interview_id=i.id AND v.author_id=att.employee_id))) AND ($5::uuid IS NULL OR a.job_id=$5) AND ($6::uuid IS NULL OR a.id=$6) ORDER BY a.created_at,a.id LIMIT 5`, [u.tenantId, f.stage ?? null, f.olderThanDays ?? null, f.waitingFeedback ?? false, entities.jobId ?? null, entities.candidateId ?? null])).rows;
}

/** Explicit accepted-offer → conversion → checklist composition; no salary projection. */
export async function listAcceptedOfferOnboarding(c: PoolClient,u: HiringActor) {
    await requireHiring(c,u,'hiring.view');
    await requireHiring(c,u,'hiring.manage_offers');
    await requireHiring(c,u,'hiring.onboarding.view');
    return (await c.query(`WITH accepted AS (
      SELECT a.id,a.full_name,a.created_at,a.hired_employee_id
      FROM hiring_applicants a WHERE a.tenant_id=$1 AND a.status='active'
      AND EXISTS(SELECT 1 FROM hiring_offers o WHERE o.tenant_id=a.tenant_id AND o.applicant_id=a.id AND o.status='accepted')
    ), state AS (
      SELECT a.*,count(t.id)::int task_count,count(t.id) FILTER(WHERE t.status<>'completed')::int pending
      FROM accepted a LEFT JOIN hiring_onboarding_tasks t ON t.tenant_id=$1 AND t.employee_id=a.hired_employee_id
      GROUP BY a.id,a.full_name,a.created_at,a.hired_employee_id
    ) SELECT id,full_name label,
      CASE WHEN hired_employee_id IS NULL THEN 'Awaiting explicit hire conversion; no employee checklist exists'
      WHEN task_count=0 THEN 'No onboarding checklist configured'
      ELSE pending::text||' onboarding tasks incomplete' END detail,count(*) OVER()::int total
      FROM state WHERE hired_employee_id IS NULL OR task_count=0 OR pending>0
      ORDER BY created_at,id LIMIT 5`,[u.tenantId])).rows;
}
