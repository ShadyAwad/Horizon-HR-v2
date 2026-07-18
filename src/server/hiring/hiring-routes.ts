import type express from 'express';
import type { PoolClient } from 'pg';
import { validateEmail } from '../../lib/validation';
import { withTenant } from '../../lib/hr-background';
import {
  HIRING_NOTE_TYPES,
  HIRING_NOTE_VISIBILITIES,
  HIRING_STATUSES,
  canTransitionHiringStage,
  isFinalHiringTransition,
  isHiringStage,
  normalizeApplicantEmail,
  type HiringStage,
} from './hiring-rules';

type Middleware = express.RequestHandler;
type HiringRouteDependencies = {
  demoAuth: Middleware;
  requirePermission: (permission: string) => Middleware;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+()\d\s.-]{3,40}$/;
const asText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const hasPermission = (req: express.Request, permission: string) => req.authUser?.role === 'hr_admin' || Boolean(req.authUser?.permissions?.includes(permission));
const fail = (status: number, code: string, error: string) => Object.assign(new Error(error), { statusCode: status, code });
const validatedText = (value: unknown, max: number, field: string, required = false) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} is required.`);
  if (normalized.length > max) throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} must be ${max} characters or fewer.`);
  return normalized;
};
const validatedDate = (value: unknown, field: string) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
    throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} is invalid.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail(400, 'HIRING_VALIDATION_ERROR', `${field} is invalid.`);
  return date.toISOString();
};
const handleError = (res: express.Response, error: unknown, context: string) => {
  const typed = error as { statusCode?: number; code?: string; message?: string };
  if (!typed.statusCode || typed.statusCode >= 500) console.error(`[Hiring] ${context}:`, error);
  res.status(typed.statusCode || 500).json({ success: false, code: typed.code || 'HIRING_REQUEST_FAILED', error: typed.statusCode ? typed.message : 'Unable to complete hiring request.' });
};
const audit = (client: PoolClient, tenantId: string, actorId: string, action: string, entityType: string, entityId: string, metadata: object = {}) => client.query(
  `INSERT INTO audit_logs (tenant_id, actor_employee_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3::varchar,$4::varchar,$5,$6::jsonb)`,
  [tenantId, actorId, action, entityType, entityId, JSON.stringify(metadata)],
);
const outbox = (client: PoolClient, tenantId: string, eventType: string, payload: object) => client.query(
  `INSERT INTO outbox_events (tenant_id, event_type, payload) VALUES ($1,$2::varchar,$3::jsonb)`,
  [tenantId, eventType, JSON.stringify(payload)],
);
const assertUuid = (value: unknown, code = 'HIRING_APPLICANT_NOT_FOUND') => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw fail(404, code, 'Hiring record not found.');
  return value;
};
const eligibleReviewerWhere = `
  e.tenant_id = $1
  AND e.is_active = true
  AND e.employment_status = 'active'
  AND EXISTS (
    SELECT 1
    FROM employee_role_assignments era
    JOIN tenant_roles tr
      ON tr.tenant_id = era.tenant_id
     AND tr.id = era.role_id
     AND tr.is_active = true
    JOIN tenant_role_permissions trp
      ON trp.tenant_id = tr.tenant_id
     AND trp.role_id = tr.id
    WHERE era.tenant_id = e.tenant_id
      AND era.employee_id = e.id
      AND trp.permission_key = 'hiring.view'
  )`;

export function registerHiringRoutes(app: express.Express, { demoAuth, requirePermission }: HiringRouteDependencies) {
  app.get('/api/hiring/reviewers', demoAuth, requirePermission('hiring.assign'), async (req, res) => {
    try {
      const { tenantId } = req.authUser!;
      const reviewers = await withTenant(tenantId, async (client) => (await client.query(`
        SELECT e.id, e.full_name AS "displayName", e.role, e.job_title AS "roleLabel",
          COALESCE(array_remove(array_agg(DISTINCT trp.permission_key), NULL), ARRAY[]::varchar[]) AS permissions
        FROM employees e
        WHERE ${eligibleReviewerWhere}
        GROUP BY e.id ORDER BY e.full_name`, [tenantId])).rows);
      res.json({ success: true, reviewers });
    } catch (error) { handleError(res, error, 'Failed to load reviewers'); }
  });

  app.get('/api/hiring/applicants', demoAuth, requirePermission('hiring.view'), async (req, res) => {
    try {
      const { tenantId, employeeId } = req.authUser!;
      const page = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || '25'), 10) || 25));
      const stage = req.query.stage === undefined ? null : String(req.query.stage);
      const status = req.query.status === undefined ? 'active' : String(req.query.status);
      if (stage && !isHiringStage(stage)) throw fail(400, 'HIRING_INVALID_STAGE', 'Stage is invalid.');
      if (status && !HIRING_STATUSES.includes(status as never)) throw fail(400, 'HIRING_INVALID_STATUS', 'Status is invalid.');
      const ownerId = req.query.assignedToMe === 'true' ? employeeId : (req.query.ownerId ? assertUuid(String(req.query.ownerId)) : null);
      const filters = [asText(req.query.search, 160) || null, stage, status || null, asText(req.query.position, 160) || null, asText(req.query.department, 120) || null, ownerId];
      const result = await withTenant(tenantId, async (client) => {
        const params = [tenantId, ...filters, pageSize, (page - 1) * pageSize];
        const where = `a.tenant_id=$1 AND ($2::text IS NULL OR a.full_name ILIKE '%'||$2||'%' OR a.email ILIKE '%'||$2||'%') AND ($3::text IS NULL OR a.stage=$3) AND ($4::text IS NULL OR a.status=$4) AND ($5::text IS NULL OR a.position_title ILIKE '%'||$5||'%') AND ($6::text IS NULL OR a.department ILIKE '%'||$6||'%') AND ($7::uuid IS NULL OR a.current_owner_id=$7)`;
        const [rows, total] = await Promise.all([
          client.query(`SELECT a.id,a.full_name AS "fullName",a.email,a.phone,a.position_title AS "positionTitle",a.department,a.stage,a.status,a.applied_at AS "appliedAt",a.created_at AS "createdAt",a.updated_at AS "updatedAt",o.id AS "currentOwnerId",o.full_name AS "currentOwnerName",(SELECT max(n.created_at) FROM hiring_applicant_notes n WHERE n.tenant_id=a.tenant_id AND n.applicant_id=a.id AND n.deleted_at IS NULL) AS "latestNoteAt",(SELECT count(*)::int FROM hiring_handoffs h WHERE h.tenant_id=a.tenant_id AND h.applicant_id=a.id AND h.status='pending') AS "pendingHandoffs" FROM hiring_applicants a LEFT JOIN employees o ON o.tenant_id=a.tenant_id AND o.id=a.current_owner_id WHERE ${where} ORDER BY a.created_at DESC LIMIT $8 OFFSET $9`, params),
          client.query(`SELECT count(*)::int AS count FROM hiring_applicants a WHERE ${where}`, params.slice(0, 7)),
        ]);
        return { applicants: rows.rows, total: total.rows[0].count };
      });
      res.json({ success: true, ...result, page, pageSize });
    } catch (error) { handleError(res, error, 'Failed to list applicants'); }
  });

  app.post('/api/hiring/applicants', demoAuth, requirePermission('hiring.create'), async (req, res) => {
    try {
      const { tenantId, employeeId } = req.authUser!;
      const fullName = validatedText(req.body.fullName, 160, 'Full name', true);
      const positionTitle = validatedText(req.body.positionTitle, 160, 'Position title', true);
      const rawEmail = validatedText(req.body.email, 254, 'Email');
      const email = normalizeApplicantEmail(rawEmail); const phone = validatedText(req.body.phone, 40, 'Phone') || null;
      if (email && (!EMAIL_PATTERN.test(email) || !validateEmail(email).valid)) throw fail(400, 'HIRING_VALIDATION_ERROR', 'Email is invalid.');
      if (phone && !PHONE_PATTERN.test(phone)) throw fail(400, 'HIRING_VALIDATION_ERROR', 'Phone is invalid.');
      const ownerId = req.body.currentOwnerId ? assertUuid(req.body.currentOwnerId, 'HIRING_REVIEWER_NOT_FOUND') : null;
      const result = await withTenant(tenantId, async (client) => {
        if (ownerId && !(await client.query(`SELECT 1 FROM employees WHERE tenant_id=$1 AND id=$2`, [tenantId, ownerId])).rowCount) throw fail(404, 'HIRING_REVIEWER_NOT_FOUND', 'Reviewer not found.');
        const duplicate = email ? (await client.query(`SELECT id FROM hiring_applicants WHERE tenant_id=$1 AND lower(email)=$2 ORDER BY created_at DESC LIMIT 1`, [tenantId, email])).rows[0] : null;
        const applicant = (await client.query(`INSERT INTO hiring_applicants (tenant_id,full_name,email,phone,position_title,department,source,current_owner_id,created_by,applied_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [tenantId, fullName, email, phone, positionTitle, validatedText(req.body.department,120,'Department')||null, validatedText(req.body.source,120,'Source')||null, ownerId, employeeId, validatedDate(req.body.appliedAt, 'Applied date')])).rows[0];
        await client.query(`INSERT INTO hiring_stage_history (tenant_id,applicant_id,actor_id,new_stage,reason) VALUES ($1,$2,$3,'new','Applicant created')`, [tenantId, applicant.id, employeeId]);
        await audit(client, tenantId, employeeId, 'hiring.applicant.created', 'hiring_applicant', applicant.id, { stage: 'new', ownerId });
        await outbox(client, tenantId, 'hiring.applicant.created', { applicantId: applicant.id, ownerId });
        return { applicant, duplicate };
      });
      res.status(201).json({ success: true, applicant: result.applicant, warnings: result.duplicate ? [{ code: 'POSSIBLE_DUPLICATE_APPLICANT', applicantId: result.duplicate.id, message: 'A candidate with this email already exists.' }] : [] });
    } catch (error) { handleError(res, error, 'Failed to create applicant'); }
  });

  app.get('/api/hiring/applicants/:id', demoAuth, requirePermission('hiring.view'), async (req, res) => {
    try {
      const id = assertUuid(req.params.id); const { tenantId } = req.authUser!;
      const canViewNotes = hasPermission(req, 'hiring.view_notes'); const canViewHrOnly = hasPermission(req, 'hiring.edit');
      const detail = await withTenant(tenantId, async (client) => {
        const applicant = (await client.query(`SELECT a.*,o.full_name AS current_owner_name FROM hiring_applicants a LEFT JOIN employees o ON o.tenant_id=a.tenant_id AND o.id=a.current_owner_id WHERE a.tenant_id=$1 AND a.id=$2`, [tenantId,id])).rows[0];
        if (!applicant) throw fail(404, 'HIRING_APPLICANT_NOT_FOUND', 'Applicant not found.');
        const notes = canViewNotes ? (await client.query(`SELECT n.id,n.note_text,n.note_type,n.visibility,n.created_at,n.updated_at,e.full_name AS author_name,e.role AS author_role FROM hiring_applicant_notes n JOIN employees e ON e.tenant_id=n.tenant_id AND e.id=n.author_id WHERE n.tenant_id=$1 AND n.applicant_id=$2 AND n.deleted_at IS NULL AND ($3::boolean OR n.visibility='hiring_team') ORDER BY n.created_at DESC`, [tenantId,id,canViewHrOnly])).rows : [];
        const handoffs = (await client.query(`SELECT h.*,f.full_name AS from_user_name,t.full_name AS to_user_name,b.full_name AS handed_off_by_name FROM hiring_handoffs h LEFT JOIN employees f ON f.tenant_id=h.tenant_id AND f.id=h.from_user_id JOIN employees t ON t.tenant_id=h.tenant_id AND t.id=h.to_user_id JOIN employees b ON b.tenant_id=h.tenant_id AND b.id=h.handed_off_by WHERE h.tenant_id=$1 AND h.applicant_id=$2 ORDER BY h.created_at DESC`, [tenantId,id])).rows;
        const history = (await client.query(`SELECT s.*,e.full_name AS actor_name FROM hiring_stage_history s JOIN employees e ON e.tenant_id=s.tenant_id AND e.id=s.actor_id WHERE s.tenant_id=$1 AND s.applicant_id=$2 ORDER BY s.created_at DESC`, [tenantId,id])).rows;
        return { applicant, notes, handoffs, stageHistory: history };
      });
      res.json({ success: true, ...detail });
    } catch (error) { handleError(res, error, 'Failed to load applicant'); }
  });

  app.patch('/api/hiring/applicants/:id', demoAuth, requirePermission('hiring.edit'), async (req, res) => {
    try {
      const id=assertUuid(req.params.id); const {tenantId,employeeId}=req.authUser!; const updates: string[]=[]; const values: unknown[]=[tenantId,id]; const changed:string[]=[];
      const fields: Record<string,{column:string,max:number}>={fullName:{column:'full_name',max:160},phone:{column:'phone',max:40},positionTitle:{column:'position_title',max:160},department:{column:'department',max:120},source:{column:'source',max:120}};
      for (const [key,meta] of Object.entries(fields)) if (key in req.body) { const value=validatedText(req.body[key],meta.max,key,key==='fullName'||key==='positionTitle')||null; if(key==='phone'&&value&&!PHONE_PATTERN.test(value))throw fail(400,'HIRING_VALIDATION_ERROR','Phone is invalid.'); values.push(value); updates.push(`${meta.column}=$${values.length}`); changed.push(key); }
      if ('email' in req.body) { const email=normalizeApplicantEmail(validatedText(req.body.email,254,'Email')); if(email&&(!EMAIL_PATTERN.test(email)||!validateEmail(email).valid)) throw fail(400,'HIRING_VALIDATION_ERROR','Email is invalid.'); values.push(email); updates.push(`email=$${values.length}`); changed.push('email'); }
      if ('appliedAt' in req.body) { values.push(validatedDate(req.body.appliedAt, 'Applied date')); updates.push(`applied_at=$${values.length}`); changed.push('appliedAt'); }
      if (!updates.length) throw fail(400,'HIRING_VALIDATION_ERROR','No editable fields supplied.'); values.push(employeeId); updates.push(`updated_by=$${values.length}`,'updated_at=NOW()');
      const applicant=await withTenant(tenantId,async client=>{ const row=(await client.query(`UPDATE hiring_applicants SET ${updates.join(',')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,values)).rows[0]; if(!row)throw fail(404,'HIRING_APPLICANT_NOT_FOUND','Applicant not found.'); await audit(client,tenantId,employeeId,'hiring.applicant.updated','hiring_applicant',id,{changedFields:changed}); return row; });
      res.json({success:true,applicant});
    } catch(error){handleError(res,error,'Failed to update applicant');}
  });

  app.post('/api/hiring/applicants/:id/notes',demoAuth,requirePermission('hiring.add_notes'),async(req,res)=>{try{const id=assertUuid(req.params.id);const{tenantId,employeeId}=req.authUser!;const text=validatedText(req.body.noteText,5000,'Note text',true);const type=String(req.body.noteType||'general');const visibility=String(req.body.visibility||'hiring_team');if(!HIRING_NOTE_TYPES.includes(type as never)||!HIRING_NOTE_VISIBILITIES.includes(visibility as never))throw fail(400,'HIRING_VALIDATION_ERROR','Note is invalid.');if(visibility==='hr_only'&&!hasPermission(req,'hiring.edit'))throw fail(403,'HIRING_PERMISSION_DENIED','HR-only notes require HR access.');const note=await withTenant(tenantId,async client=>{if(!(await client.query(`SELECT 1 FROM hiring_applicants WHERE tenant_id=$1 AND id=$2`,[tenantId,id])).rowCount)throw fail(404,'HIRING_APPLICANT_NOT_FOUND','Applicant not found.');const row=(await client.query(`INSERT INTO hiring_applicant_notes(tenant_id,applicant_id,author_id,note_text,note_type,visibility)VALUES($1,$2,$3,$4,$5,$6)RETURNING *`,[tenantId,id,employeeId,text,type,visibility])).rows[0];await audit(client,tenantId,employeeId,'hiring.note.created','hiring_applicant_note',row.id,{applicantId:id,noteType:type,visibility});return row;});res.status(201).json({success:true,note});}catch(error){handleError(res,error,'Failed to add note');}});

  app.patch('/api/hiring/notes/:noteId',demoAuth,requirePermission('hiring.add_notes'),async(req,res)=>{try{const noteId=assertUuid(req.params.noteId,'HIRING_NOTE_NOT_EDITABLE');const{tenantId,employeeId}=req.authUser!;const text=validatedText(req.body.noteText,5000,'Note text',true);const note=await withTenant(tenantId,async client=>{const row=(await client.query(`UPDATE hiring_applicant_notes SET note_text=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND author_id=$3 AND deleted_at IS NULL RETURNING *`,[tenantId,noteId,employeeId,text])).rows[0];if(!row)throw fail(403,'HIRING_NOTE_NOT_EDITABLE','This note cannot be edited.');await audit(client,tenantId,employeeId,'hiring.note.updated','hiring_applicant_note',noteId,{applicantId:row.applicant_id});return row;});res.json({success:true,note});}catch(error){handleError(res,error,'Failed to edit note');}});

  app.post('/api/hiring/applicants/:id/stage', demoAuth, requirePermission('hiring.advance_stage'), async (req, res) => {
    try {
      const id = assertUuid(req.params.id);
      const { tenantId, employeeId } = req.authUser!;
      const target = req.body.targetStage;
      const reason = validatedText(req.body.reason, 2000, 'Transition reason') || null;
      if (!isHiringStage(target)) throw fail(400, 'HIRING_INVALID_STAGE', 'Target stage is invalid.');
      const permissions = req.authUser!.role === 'hr_admin'
        ? [...(req.authUser!.permissions || []), 'hiring.make_final_decision']
        : (req.authUser!.permissions || []);
      const applicant = await withTenant(tenantId, async (client) => {
        const current = (await client.query(`SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0];
        if (!current) throw fail(404, 'HIRING_APPLICANT_NOT_FOUND', 'Applicant not found.');
        if (req.body.expectedCurrentStage && req.body.expectedCurrentStage !== current.stage) throw fail(409, 'HIRING_STALE_STAGE', 'Applicant stage changed.');
        if (!canTransitionHiringStage(current.stage, target, permissions)) {
          const finalTransition = isFinalHiringTransition(current.stage, target);
          throw fail(finalTransition ? 403 : 409, finalTransition ? 'HIRING_PERMISSION_DENIED' : 'HIRING_INVALID_TRANSITION', 'Stage transition is not allowed.');
        }
        const row = (await client.query(`UPDATE hiring_applicants SET stage=$3,updated_by=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenantId, id, target, employeeId])).rows[0];
        await client.query(`INSERT INTO hiring_stage_history(tenant_id,applicant_id,actor_id,previous_stage,new_stage,reason)VALUES($1,$2,$3,$4,$5,$6)`, [tenantId, id, employeeId, current.stage, target, reason]);
        await client.query(`UPDATE hiring_handoffs SET status='completed',completed_at=NOW() WHERE tenant_id=$1 AND applicant_id=$2 AND status IN('pending','acknowledged')`, [tenantId, id]);
        await audit(client, tenantId, employeeId, 'hiring.stage.changed', 'hiring_applicant', id, { previousStage: current.stage, newStage: target, reason });
        await outbox(client, tenantId, 'hiring.stage.changed', { applicantId: id, previousStage: current.stage, newStage: target, currentOwnerId: row.current_owner_id });
        if (target === 'final_review') await outbox(client, tenantId, 'hiring.final_decision.requested', { applicantId: id, currentOwnerId: row.current_owner_id });
        return row;
      });
      res.json({ success: true, applicant });
    } catch (error) { handleError(res, error, 'Failed to change stage'); }
  });

  app.post('/api/hiring/applicants/:id/handoff', demoAuth, requirePermission('hiring.assign'), async (req, res) => {
    try {
      const id = assertUuid(req.params.id);
      const reviewerId = assertUuid(req.body.reviewerId, 'HIRING_REVIEWER_NOT_FOUND');
      const { tenantId, employeeId } = req.authUser!;
      const target = req.body.targetStage;
      const message = validatedText(req.body.message, 2000, 'Handoff message') || null;
      const permissions = req.authUser!.role === 'hr_admin'
        ? [...(req.authUser!.permissions || []), 'hiring.make_final_decision']
        : (req.authUser!.permissions || []);
      const result = await withTenant(tenantId, async (client) => {
        const applicant = (await client.query(`SELECT * FROM hiring_applicants WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id])).rows[0];
        if (!applicant) throw fail(404, 'HIRING_APPLICANT_NOT_FOUND', 'Applicant not found.');
        const reviewer = (await client.query(
          `SELECT e.id
             FROM employees e
            WHERE e.id = $2 AND ${eligibleReviewerWhere}
            FOR UPDATE`,
          [tenantId, reviewerId],
        )).rows[0];
        if (!reviewer) throw fail(422, 'HIRING_REVIEWER_INELIGIBLE', 'Reviewer is not eligible for Hiring review.');
        if (target !== undefined && (!isHiringStage(target) || !canTransitionHiringStage(applicant.stage, target, permissions))) throw fail(409, 'HIRING_INVALID_TRANSITION', 'Target stage is not allowed.');
        if ((await client.query(`SELECT 1 FROM hiring_handoffs WHERE tenant_id=$1 AND applicant_id=$2 AND to_user_id=$3 AND status='pending'`, [tenantId, id, reviewerId])).rowCount) throw fail(409, 'HIRING_HANDOFF_ALREADY_PENDING', 'A pending handoff already exists for this reviewer.');
        await client.query(`UPDATE hiring_handoffs SET status='completed',completed_at=NOW() WHERE tenant_id=$1 AND applicant_id=$2 AND status IN('pending','acknowledged')`, [tenantId, id]);
        const handoff = (await client.query(`INSERT INTO hiring_handoffs(tenant_id,applicant_id,from_user_id,to_user_id,handed_off_by,from_stage,to_stage,message)VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING *`, [tenantId, id, applicant.current_owner_id, reviewerId, employeeId, applicant.stage, target || null, message])).rows[0];
        await client.query(`UPDATE hiring_applicants SET current_owner_id=$3,stage=COALESCE($4,stage),updated_by=$5,updated_at=NOW() WHERE tenant_id=$1 AND id=$2`, [tenantId, id, reviewerId, target || null, employeeId]);
        if (target) {
          await client.query(`INSERT INTO hiring_stage_history(tenant_id,applicant_id,actor_id,previous_stage,new_stage,reason)VALUES($1,$2,$3,$4,$5,$6)`, [tenantId, id, employeeId, applicant.stage, target, 'Handoff']);
          await outbox(client, tenantId, 'hiring.stage.changed', { applicantId: id, previousStage: applicant.stage, newStage: target, currentOwnerId: reviewerId });
          if (target === 'final_review') await outbox(client, tenantId, 'hiring.final_decision.requested', { applicantId: id, currentOwnerId: reviewerId });
        }
        await audit(client, tenantId, employeeId, 'hiring.handoff.created', 'hiring_handoff', handoff.id, { applicantId: id, reviewerId, fromStage: applicant.stage, toStage: target || null });
        await outbox(client, tenantId, 'hiring.handoff.created', { applicantId: id, handoffId: handoff.id, reviewerId });
        return { handoff };
      });
      res.status(201).json({ success: true, ...result });
    } catch (error) { handleError(res, error, 'Failed to create handoff'); }
  });

  app.post('/api/hiring/handoffs/:id/acknowledge',demoAuth,requirePermission('hiring.view'),async(req,res)=>{try{const id=assertUuid(req.params.id,'HIRING_HANDOFF_NOT_ASSIGNED_TO_USER');const{tenantId,employeeId}=req.authUser!;const handoff=await withTenant(tenantId,async client=>{const current=(await client.query(`SELECT * FROM hiring_handoffs WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id])).rows[0];if(!current)throw fail(404,'HIRING_HANDOFF_NOT_ASSIGNED_TO_USER','Handoff not found.');if(current.to_user_id!==employeeId&&!hasPermission(req,'hiring.archive'))throw fail(403,'HIRING_HANDOFF_NOT_ASSIGNED_TO_USER','Handoff is not assigned to you.');if(current.status==='acknowledged')return current;if(current.status!=='pending')throw fail(409,'HIRING_HANDOFF_NOT_PENDING','Handoff is not pending.');const row=(await client.query(`UPDATE hiring_handoffs SET status='acknowledged',acknowledged_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id])).rows[0];await audit(client,tenantId,employeeId,'hiring.handoff.acknowledged','hiring_handoff',id,{applicantId:row.applicant_id});await outbox(client,tenantId,'hiring.handoff.acknowledged',{applicantId:row.applicant_id,handoffId:id,reviewerId:row.to_user_id});return row;});res.json({success:true,handoff});}catch(error){handleError(res,error,'Failed to acknowledge handoff');}});

  app.post('/api/hiring/applicants/:id/archive',demoAuth,requirePermission('hiring.archive'),async(req,res)=>{try{const id=assertUuid(req.params.id);const{tenantId,employeeId}=req.authUser!;const applicant=await withTenant(tenantId,async client=>{const row=(await client.query(`UPDATE hiring_applicants SET status='archived',archived_at=COALESCE(archived_at,NOW()),updated_by=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`,[tenantId,id,employeeId])).rows[0];if(!row)throw fail(404,'HIRING_APPLICANT_NOT_FOUND','Applicant not found.');await audit(client,tenantId,employeeId,'hiring.applicant.archived','hiring_applicant',id);await outbox(client,tenantId,'hiring.applicant.archived',{applicantId:id});return row;});res.json({success:true,applicant});}catch(error){handleError(res,error,'Failed to archive applicant');}});
}
