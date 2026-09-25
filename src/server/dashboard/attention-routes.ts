import type express from 'express';
import { hasDatabaseConfig, withTenant } from '../../lib/hr-background';
import { hasPermissionClaim } from '../auth/permission-claims';

type AttentionRouteDependencies = {
  standardAuth: express.RequestHandler;
};

const dashboardAttentionStatuses = {
  breakRequests: ['pending'],
  grievances: ['open', 'under_review'],
  leaveRequests: ['pending'],
  payrollApproval: ['draft'],
  payrollPayment: ['approved'],
  resignationReview: ['pending'],
  resignationProcessing: ['approved'],
} as const;

export function registerDashboardAttentionRoutes(
  app: express.Express,
  { standardAuth: demoAuth }: AttentionRouteDependencies,
) {
  app.get('/api/dashboard/attention-counts', demoAuth, async (req, res) => {
    const authUser = req.authUser!;
    const { tenantId } = authUser;
  
    if (!hasDatabaseConfig()) {
      return res.status(503).json({ success: false, error: 'DATABASE_URL is required for dashboard attention counts' });
    }
  
    // These booleans mirror the mutation routes. Modules without a pending state or
    // per-user read model intentionally remain zero instead of inferring unread work.
    const canReviewBreakRequests = hasPermissionClaim(authUser, 'break_requests.review')
      || hasPermissionClaim(authUser, 'break_requests.view_all');
    const canReviewGrievances = authUser.role === 'manager' || authUser.role === 'hr_admin';
    const canReviewLeaveRequests = authUser.role === 'manager' || authUser.role === 'hr_admin';
    const canReviewResignations = authUser.role === 'manager'
      || hasPermissionClaim(authUser, 'resignations.review');
    const canProcessResignations = hasPermissionClaim(authUser, 'resignations.process');
    const canApprovePayroll = hasPermissionClaim(authUser, 'payroll.approve');
    const canMarkPayrollPaid = hasPermissionClaim(authUser, 'payroll.mark_paid');
    const canViewHiring = hasPermissionClaim(authUser, 'hiring.view');
    const canManageHiring = hasPermissionClaim(authUser, 'hiring.create') || hasPermissionClaim(authUser, 'hiring.edit');
    const canMakeHiringDecision = hasPermissionClaim(authUser, 'hiring.make_final_decision');
  
    try {
      const counts = await withTenant(tenantId, async (client) => {
        const result = await client.query<{
          grievances: number;
          resignations: number;
          leave_requests: number;
          break_requests: number;
          payroll: number;
        }>(
          `
            SELECT
              CASE WHEN $2::boolean THEN (
                SELECT COUNT(*)::integer FROM grievances
                WHERE tenant_id = $1 AND status = ANY($9::varchar[])
              ) ELSE 0 END AS grievances,
              (
                CASE WHEN $3::boolean THEN (
                  SELECT COUNT(*)::integer FROM resignation_requests
                  WHERE tenant_id = $1 AND status = ANY($10::varchar[])
                ) ELSE 0 END
                + CASE WHEN $4::boolean THEN (
                  SELECT COUNT(*)::integer FROM resignation_requests
                  WHERE tenant_id = $1 AND status = ANY($11::varchar[])
                ) ELSE 0 END
              )::integer AS resignations,
              CASE WHEN $5::boolean THEN (
                SELECT COUNT(*)::integer FROM leave_requests
                WHERE tenant_id = $1 AND status = ANY($12::varchar[])
              ) ELSE 0 END AS leave_requests,
              CASE WHEN $6::boolean THEN (
                SELECT COUNT(*)::integer FROM break_requests
                WHERE tenant_id = $1 AND status = ANY($13::varchar[])
              ) ELSE 0 END AS break_requests,
              (
                CASE WHEN $7::boolean THEN (
                  SELECT COUNT(*)::integer FROM payroll_records
                  WHERE tenant_id = $1 AND status = ANY($14::varchar[])
                ) ELSE 0 END
                + CASE WHEN $8::boolean THEN (
                  SELECT COUNT(*)::integer FROM payroll_records
                  WHERE tenant_id = $1 AND status = ANY($15::varchar[])
                ) ELSE 0 END
              )::integer AS payroll
          `,
          [
            tenantId,
            canReviewGrievances,
            canReviewResignations,
            canProcessResignations,
            canReviewLeaveRequests,
            canReviewBreakRequests,
            canApprovePayroll,
            canMarkPayrollPaid,
            [...dashboardAttentionStatuses.grievances],
            [...dashboardAttentionStatuses.resignationReview],
            [...dashboardAttentionStatuses.resignationProcessing],
            [...dashboardAttentionStatuses.leaveRequests],
            [...dashboardAttentionStatuses.breakRequests],
            [...dashboardAttentionStatuses.payrollApproval],
            [...dashboardAttentionStatuses.payrollPayment],
          ],
        );
        const hiring = canViewHiring ? Number((await client.query<{ count: number }>(`
          SELECT COUNT(DISTINCT a.id)::integer AS count
          FROM hiring_applicants a
          WHERE a.tenant_id=$1 AND a.status='active' AND (
            a.current_owner_id=$2
            OR EXISTS (SELECT 1 FROM hiring_handoffs h WHERE h.tenant_id=a.tenant_id AND h.applicant_id=a.id AND h.to_user_id=$2 AND h.status='pending')
            OR ($3::boolean AND a.current_owner_id IS NULL AND a.stage IN ('new','hr_review'))
            OR ($4::boolean AND a.stage='final_review' AND (a.current_owner_id IS NULL OR a.current_owner_id=$2))
          )
        `, [tenantId, authUser.employeeId, canManageHiring, canMakeHiringDecision])).rows[0]?.count || 0) : 0;
        return { ...result.rows[0], hiring };
      });
  
      res.json({
        success: true,
        counts: {
          grievances: counts.grievances,
          resignations: counts.resignations,
          leaveRequests: counts.leave_requests,
          breakRequests: counts.break_requests,
          payroll: counts.payroll,
          loans: 0,
          notifications: 0,
          hiring: counts.hiring,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Dashboard] Failed to load attention counts:', error);
      res.status(500).json({ success: false, error: 'Unable to load dashboard attention counts' });
    }
  });
}
