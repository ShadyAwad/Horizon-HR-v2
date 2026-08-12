import type express from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from '../../lib/hr-background';
import { recordAuditEvent } from '../audit/audit-events';
import { resolveScopedPermission } from '../organisation/scoped-permissions';

type Middleware = express.RequestHandler;
type Dependencies = { standardAuth: Middleware; mutationGuard: Middleware; rateLimiter: Middleware };
type GoalPriority = 'low' | 'normal' | 'high';
type GoalStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set<GoalPriority>(['low', 'normal', 'high']);
const EMPLOYEE_STATUSES = new Set(['active']);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function sendError(res: express.Response, error: unknown, fallback: string) {
  const value = error as { statusCode?: number; message?: string };
  if (!value.statusCode || value.statusCode >= 500) console.error('[Roster goals]', error);
  res.status(value.statusCode || 500).json({ success: false, error: value.statusCode ? value.message : fallback });
}

function strictFields(body: unknown, allowed: readonly string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Roster goal payload is invalid.');
  const keys = Object.keys(body);
  if (keys.some((key) => !allowed.includes(key))) throw fail(400, 'Roster goal payload contains unsupported fields.');
  return body as Record<string, unknown>;
}

function dateOnly(value: unknown, field: string) {
  if (typeof value !== 'string' || !DATE.test(value)) throw fail(400, `${field} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fail(400, `${field} is invalid.`);
  return value;
}

function weekStart(value: unknown) {
  const date = dateOnly(value, 'weekStart');
  if (new Date(`${date}T00:00:00.000Z`).getUTCDay() !== 1) throw fail(400, 'weekStart must be a Monday.');
  return date;
}

function optionalDate(value: unknown, field: string) {
  return value === undefined || value === null || value === '' ? null : dateOnly(value, field);
}

function requiredText(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim()) throw fail(400, `${field} is required.`);
  if (value.trim().length > maximum) throw fail(400, `${field} is too long.`);
  return value.trim();
}

function optionalText(value: unknown, field: string, maximum: number) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) throw fail(400, `${field} is invalid.`);
  return value.trim() || null;
}

function priority(value: unknown): GoalPriority {
  const next = typeof value === 'string' ? value as GoalPriority : 'normal';
  if (!PRIORITIES.has(next)) throw fail(400, 'priority is invalid.');
  return next;
}

function assertDueDateInWeek(start: string, dueDate: string | null) {
  if (!dueDate) return;
  const startTime = Date.parse(`${start}T00:00:00.000Z`);
  const dueTime = Date.parse(`${dueDate}T00:00:00.000Z`);
  if (dueTime < startTime || dueTime > startTime + (6 * 86_400_000)) {
    throw fail(400, 'dueDate must fall inside the selected roster week.');
  }
}

function asDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function safeGoal(row: any) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    assignedBy: { employeeId: row.created_by, displayName: row.created_by_name || 'Stanza supervisor' },
    team: row.team_id ? { id: row.team_id, name: row.team_name || 'Team' } : null,
    weekStart: asDate(row.roster_week_start),
    dueDate: row.due_date ? asDate(row.due_date) : null,
    title: row.title,
    description: row.description || null,
    priority: row.priority as GoalPriority,
    status: row.status as GoalStatus,
    completionNote: row.completion_note || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const goalSelect = `goal.id,goal.employee_id,goal.created_by,goal.team_id,goal.roster_week_start,goal.due_date,
  goal.title,goal.description,goal.priority,goal.status,goal.completion_note,goal.completed_at,goal.created_at,goal.updated_at,
  employee.full_name AS employee_name,creator.full_name AS created_by_name,team.name AS team_name`;
const goalJoins = `FROM roster_goals goal
  JOIN employees employee ON employee.tenant_id=goal.tenant_id AND employee.id=goal.employee_id
  JOIN employees creator ON creator.tenant_id=goal.tenant_id AND creator.id=goal.created_by
  LEFT JOIN organisation_teams team ON team.tenant_id=goal.tenant_id AND team.id=goal.team_id`;

async function loadActiveEmployee(client: PoolClient, tenantId: string, employeeId: string) {
  const employee = (await client.query(
    `SELECT id,full_name,department_id,team_id FROM employees
     WHERE tenant_id=$1 AND id=$2 AND is_active=true AND employment_status=ANY($3::text[])`,
    [tenantId, employeeId, [...EMPLOYEE_STATUSES]],
  )).rows[0];
  if (!employee) throw fail(404, 'Active employee not found.');
  return employee;
}

async function resolveCapabilities(client: PoolClient, tenantId: string, actorId: string, employeeId: string) {
  const canManage = (await resolveScopedPermission(client, {
    tenantId, actorEmployeeId: actorId, permissionKey: 'roster.goals.manage', targetEmployeeId: employeeId,
  })).allowed;
  const canViewScoped = canManage || (await resolveScopedPermission(client, {
    tenantId, actorEmployeeId: actorId, permissionKey: 'roster.goals.view_scoped', targetEmployeeId: employeeId,
  })).allowed;
  const canViewSelf = employeeId === actorId && (await resolveScopedPermission(client, {
    tenantId, actorEmployeeId: actorId, permissionKey: 'roster.goals.view_self', targetEmployeeId: actorId,
  })).allowed;
  const canComplete = canManage || (employeeId === actorId && (await resolveScopedPermission(client, {
    tenantId, actorEmployeeId: actorId, permissionKey: 'roster.goals.complete_self', targetEmployeeId: actorId,
  })).allowed);
  return { canView: canViewSelf || canViewScoped, canManage, canComplete };
}

async function validateTeam(client: PoolClient, tenantId: string, employeeId: string, teamId: string | null) {
  if (!teamId) return null;
  const team = (await client.query(
    `SELECT team.id,team.name FROM organisation_teams team
     WHERE team.tenant_id=$1 AND team.id=$2 AND team.is_active=true
       AND EXISTS (
         SELECT 1 FROM employees employee WHERE employee.tenant_id=team.tenant_id AND employee.id=$3
           AND (employee.team_id=team.id OR EXISTS (
             SELECT 1 FROM organisation_team_memberships membership
             WHERE membership.tenant_id=team.tenant_id AND membership.team_id=team.id AND membership.employee_id=employee.id
               AND (membership.ends_at IS NULL OR membership.ends_at>=CURRENT_DATE)
           ))
       )`,
    [tenantId, teamId, employeeId],
  )).rows[0];
  if (!team) throw fail(400, 'The selected active team does not include this employee.');
  return team;
}

async function loadLockedGoal(client: PoolClient, tenantId: string, goalId: string) {
  const goal = (await client.query(
    `SELECT * FROM roster_goals WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
    [tenantId, goalId],
  )).rows[0];
  if (!goal) throw fail(404, 'Roster goal not found.');
  return goal;
}

export function registerRosterGoalRoutes(app: express.Express, dependencies: Dependencies) {
  const { standardAuth, mutationGuard, rateLimiter } = dependencies;

  app.get('/api/roster/goals', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : user.employeeId;
      const selectedWeek = weekStart(req.query.weekStart);
      const includeOverdue = req.query.includeOverdue !== 'false';
      if (!isUuid(employeeId)) throw fail(400, 'employeeId is invalid.');
      const result = await withTenant(user.tenantId, async (client) => {
        await loadActiveEmployee(client, user.tenantId, employeeId);
        const capabilities = await resolveCapabilities(client, user.tenantId, user.employeeId, employeeId);
        if (!capabilities.canView) throw fail(403, 'You cannot view roster goals for this employee.');
        const rows = (await client.query(
          `SELECT ${goalSelect} ${goalJoins}
           WHERE goal.tenant_id=$1 AND goal.employee_id=$2
             AND (goal.roster_week_start=$3::date OR ($4::boolean AND goal.roster_week_start<$3::date AND goal.status IN ('pending','in_progress')))
           ORDER BY CASE WHEN goal.roster_week_start=$3::date THEN 0 ELSE 1 END,goal.due_date NULLS LAST,goal.created_at DESC
           LIMIT 200`,
          [user.tenantId, employeeId, selectedWeek, includeOverdue],
        )).rows.map(safeGoal);
        return {
          weekStart: selectedWeek,
          policy: { weekly: true, overdueCarryForward: includeOverdue, maximumReturned: 200 },
          capabilities,
          goals: rows.filter((goal) => goal.weekStart === selectedWeek),
          overdueGoals: rows.filter((goal) => goal.weekStart !== selectedWeek),
        };
      });
      res.json({ success: true, ...result });
    } catch (error) { sendError(res, error, 'Unable to load roster goals.'); }
  });

  app.get('/api/roster/goals/assignees', standardAuth, async (req, res) => {
    try {
      const user = req.authUser!;
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
      const assignees = await withTenant(user.tenantId, async (client) => {
        const candidates = (await client.query(
          `SELECT employee.id,employee.full_name,employee.department_id,employee.team_id,
             department.name AS department_name,team.name AS team_name
           FROM employees employee
           LEFT JOIN organisation_departments department ON department.tenant_id=employee.tenant_id AND department.id=employee.department_id
           LEFT JOIN organisation_teams team ON team.tenant_id=employee.tenant_id AND team.id=employee.team_id
           WHERE employee.tenant_id=$1 AND employee.is_active=true AND employee.employment_status='active'
             AND ($2::text='' OR employee.full_name ILIKE '%' || $2 || '%')
           ORDER BY employee.full_name ASC LIMIT 200`,
          [user.tenantId, search],
        )).rows;
        const allowed = [];
        for (const candidate of candidates) {
          const authority = await resolveScopedPermission(client, {
            tenantId: user.tenantId,
            actorEmployeeId: user.employeeId,
            permissionKey: 'roster.goals.manage',
            targetEmployeeId: candidate.id,
          });
          if (authority.allowed) allowed.push({
            id: candidate.id,
            fullName: candidate.full_name,
            departmentId: candidate.department_id || null,
            departmentName: candidate.department_name || null,
            teamId: candidate.team_id || null,
            teamName: candidate.team_name || null,
            authority: { source: authority.source, scope: authority.resolvedScope },
          });
        }
        return allowed;
      });
      res.json({ success: true, assignees });
    } catch (error) { sendError(res, error, 'Unable to load roster goal assignees.'); }
  });

  app.post('/api/roster/goals', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      const body = strictFields(req.body, ['employeeId', 'teamId', 'weekStart', 'dueDate', 'title', 'description', 'priority']);
      if (!isUuid(body.employeeId)) throw fail(400, 'employeeId is invalid.');
      const teamId = body.teamId === undefined || body.teamId === null || body.teamId === '' ? null : isUuid(body.teamId) ? body.teamId : (() => { throw fail(400, 'teamId is invalid.'); })();
      const selectedWeek = weekStart(body.weekStart);
      const dueDate = optionalDate(body.dueDate, 'dueDate');
      assertDueDateInWeek(selectedWeek, dueDate);
      const input = {
        employeeId: body.employeeId,
        teamId,
        weekStart: selectedWeek,
        dueDate,
        title: requiredText(body.title, 'title', 240),
        description: optionalText(body.description, 'description', 2000),
        priority: priority(body.priority),
      };
      const goal = await withTenant(user.tenantId, async (client) => {
        await loadActiveEmployee(client, user.tenantId, input.employeeId);
        const authority = await resolveScopedPermission(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey: 'roster.goals.manage', targetEmployeeId: input.employeeId });
        if (!authority.allowed) throw fail(403, 'You cannot assign roster goals to this employee.');
        await validateTeam(client, user.tenantId, input.employeeId, input.teamId);
        const row = (await client.query(
          `INSERT INTO roster_goals(tenant_id,employee_id,created_by,team_id,roster_week_start,due_date,title,description,priority)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [user.tenantId, input.employeeId, user.employeeId, input.teamId, input.weekStart, input.dueDate, input.title, input.description, input.priority],
        )).rows[0];
        await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.created', targetType: 'roster_goal', targetId: row.id, metadata: { employeeId: input.employeeId, teamId: input.teamId, weekStart: input.weekStart, priority: input.priority, status: 'pending' } });
        return safeGoal((await client.query(`SELECT ${goalSelect} ${goalJoins} WHERE goal.tenant_id=$1 AND goal.id=$2`, [user.tenantId, row.id])).rows[0]);
      });
      res.status(201).json({ success: true, goal });
    } catch (error) { sendError(res, error, 'Unable to create roster goal.'); }
  });

  app.patch('/api/roster/goals/:goalId', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!isUuid(req.params.goalId)) throw fail(400, 'Roster goal id is invalid.');
      const body = strictFields(req.body, ['employeeId', 'teamId', 'weekStart', 'dueDate', 'title', 'description', 'priority']);
      if (Object.keys(body).length === 0) throw fail(400, 'At least one roster goal field is required.');
      const goal = await withTenant(user.tenantId, async (client) => {
        const current = await loadLockedGoal(client, user.tenantId, req.params.goalId);
        if (current.status === 'cancelled') throw fail(409, 'Cancelled roster goals cannot be edited.');
        const oldAuthority = await resolveScopedPermission(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey: 'roster.goals.manage', targetEmployeeId: current.employee_id });
        if (!oldAuthority.allowed) throw fail(403, 'You cannot edit this roster goal.');
        const employeeId = body.employeeId === undefined ? current.employee_id : isUuid(body.employeeId) ? body.employeeId : (() => { throw fail(400, 'employeeId is invalid.'); })();
        if (employeeId !== current.employee_id) {
          await loadActiveEmployee(client, user.tenantId, employeeId);
          const nextAuthority = await resolveScopedPermission(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey: 'roster.goals.manage', targetEmployeeId: employeeId });
          if (!nextAuthority.allowed) throw fail(403, 'You cannot reassign this roster goal to that employee.');
        }
        const teamId = body.teamId === undefined ? current.team_id : body.teamId === null || body.teamId === '' ? null : isUuid(body.teamId) ? body.teamId : (() => { throw fail(400, 'teamId is invalid.'); })();
        const selectedWeek = body.weekStart === undefined ? asDate(current.roster_week_start) : weekStart(body.weekStart);
        const dueDate = body.dueDate === undefined ? (current.due_date ? asDate(current.due_date) : null) : optionalDate(body.dueDate, 'dueDate');
        assertDueDateInWeek(selectedWeek, dueDate);
        await validateTeam(client, user.tenantId, employeeId, teamId);
        const title = body.title === undefined ? current.title : requiredText(body.title, 'title', 240);
        const description = body.description === undefined ? current.description : optionalText(body.description, 'description', 2000);
        const nextPriority = body.priority === undefined ? current.priority : priority(body.priority);
        await client.query(
          `UPDATE roster_goals SET employee_id=$3,team_id=$4,roster_week_start=$5,due_date=$6,title=$7,description=$8,priority=$9,updated_by=$10,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2`,
          [user.tenantId, current.id, employeeId, teamId, selectedWeek, dueDate, title, description, nextPriority, user.employeeId],
        );
        await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.updated', targetType: 'roster_goal', targetId: current.id, metadata: { employeeId, teamId, weekStart: selectedWeek, priority: nextPriority, status: current.status } });
        if (employeeId !== current.employee_id) await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.reassigned', targetType: 'roster_goal', targetId: current.id, metadata: { previousEmployeeId: current.employee_id, employeeId, weekStart: selectedWeek, status: current.status } });
        return safeGoal((await client.query(`SELECT ${goalSelect} ${goalJoins} WHERE goal.tenant_id=$1 AND goal.id=$2`, [user.tenantId, current.id])).rows[0]);
      });
      res.json({ success: true, goal });
    } catch (error) { sendError(res, error, 'Unable to update roster goal.'); }
  });

  app.post('/api/roster/goals/:goalId/status', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!isUuid(req.params.goalId)) throw fail(400, 'Roster goal id is invalid.');
      const body = strictFields(req.body, ['status', 'completionNote']);
      if (body.status !== 'in_progress' && body.status !== 'completed') throw fail(400, 'status is invalid.');
      const nextStatus: 'in_progress' | 'completed' = body.status;
      const completionNote = optionalText(body.completionNote, 'completionNote', 1000);
      const goal = await withTenant(user.tenantId, async (client) => {
        const current = await loadLockedGoal(client, user.tenantId, req.params.goalId);
        const capabilities = await resolveCapabilities(client, user.tenantId, user.employeeId, current.employee_id);
        if (!capabilities.canComplete) throw fail(403, 'You cannot update this roster goal.');
        const allowed = current.status === 'pending'
          ? new Set(['in_progress', 'completed'])
          : current.status === 'in_progress' ? new Set(['completed']) : new Set<string>();
        if (!allowed.has(nextStatus)) throw fail(409, 'Roster goal status has already changed.');
        await client.query(
          `UPDATE roster_goals SET status=$3,completion_note=$4,completed_at=CASE WHEN $3='completed' THEN NOW() ELSE NULL END,updated_by=$5,updated_at=NOW()
           WHERE tenant_id=$1 AND id=$2`,
          [user.tenantId, current.id, nextStatus, nextStatus === 'completed' ? completionNote : null, user.employeeId],
        );
        const metadata = { employeeId: current.employee_id, previousStatus: current.status, status: nextStatus, weekStart: asDate(current.roster_week_start) };
        await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.status_changed', targetType: 'roster_goal', targetId: current.id, metadata });
        if (nextStatus === 'completed') await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.completed', targetType: 'roster_goal', targetId: current.id, metadata });
        return safeGoal((await client.query(`SELECT ${goalSelect} ${goalJoins} WHERE goal.tenant_id=$1 AND goal.id=$2`, [user.tenantId, current.id])).rows[0]);
      });
      res.json({ success: true, goal });
    } catch (error) { sendError(res, error, 'Unable to update roster goal status.'); }
  });

  app.post('/api/roster/goals/:goalId/cancel', rateLimiter, standardAuth, mutationGuard, async (req, res) => {
    try {
      const user = req.authUser!;
      if (!isUuid(req.params.goalId)) throw fail(400, 'Roster goal id is invalid.');
      strictFields(req.body || {}, []);
      const goal = await withTenant(user.tenantId, async (client) => {
        const current = await loadLockedGoal(client, user.tenantId, req.params.goalId);
        const authority = await resolveScopedPermission(client, { tenantId: user.tenantId, actorEmployeeId: user.employeeId, permissionKey: 'roster.goals.manage', targetEmployeeId: current.employee_id });
        if (!authority.allowed) throw fail(403, 'You cannot cancel this roster goal.');
        if (!['pending', 'in_progress'].includes(current.status)) throw fail(409, 'Roster goal can no longer be cancelled.');
        await client.query(`UPDATE roster_goals SET status='cancelled',completion_note=NULL,completed_at=NULL,updated_by=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [user.tenantId, current.id, user.employeeId]);
        await recordAuditEvent(client, { tenantId: user.tenantId, actorId: user.employeeId, action: 'roster.goal.cancelled', targetType: 'roster_goal', targetId: current.id, metadata: { employeeId: current.employee_id, previousStatus: current.status, status: 'cancelled', weekStart: asDate(current.roster_week_start) } });
        return safeGoal((await client.query(`SELECT ${goalSelect} ${goalJoins} WHERE goal.tenant_id=$1 AND goal.id=$2`, [user.tenantId, current.id])).rows[0]);
      });
      res.json({ success: true, goal });
    } catch (error) { sendError(res, error, 'Unable to cancel roster goal.'); }
  });
}
