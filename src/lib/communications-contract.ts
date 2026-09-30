export const COMMUNICATION_TYPES = ['welcome', 'account_setup', 'leave_status', 'payroll_notice', 'document_request', 'meeting_invitation', 'grievance_update', 'asset_reminder', 'hiring', 'custom'] as const;
export const COMMUNICATION_VARIABLES = ['employee_name', 'company_name', 'manager_name', 'role_name', 'leave_start', 'leave_end', 'meeting_date'] as const;
export type CommunicationCategory = typeof COMMUNICATION_TYPES[number];
export type TemplateVariable = typeof COMMUNICATION_VARIABLES[number];
export type TemplateValues = Partial<Record<TemplateVariable, string>>;
export type RelatedEntity = {
    type: 'employee' | 'candidate' | 'meeting' | 'grievance';
    id: string;
};
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export interface CommunicationMessage {
    id: string;
    tenant_id: string;
    sender_id: string;
    sender_name?: string;
    template_id: string | null;
    subject: string;
    body: string;
    body_json: unknown;
    category: CommunicationCategory;
    status: MessageStatus;
    recipient_ids: string[];
    recipients: string[];
    related_grievance_id?: string | null;
    related_employee_id: string | null;
    related_candidate_id: string | null;
    related_meeting_id: string | null;
    variables: TemplateValues;
    provider_id: string | null;
    failure_code: string | null;
    failure_reason: string | null;
    queued_at: string | null;
    scheduled_at: string | null;
    sent_at: string | null;
    first_attempt_at: string | null;
    attempts: number;
    version: number;
    invitation_ics: string | null;
    invitation_key: string | null;
    created_at: string;
    updated_at: string;
}
export interface CommunicationTemplate {
    id: string;
    tenant_id: string;
    name: string;
    subject: string;
    body: string;
    category: CommunicationCategory;
    active: boolean;
    allowed_variables: TemplateVariable[];
    created_by: string;
    created_at: string;
    updated_at: string;
}
export interface CommunicationMeeting {
    id: string;
    tenant_id: string;
    organizer_id: string;
    organizer_name?: string;
    title: string;
    notes: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
    location: string;
    status: 'scheduled' | 'completed' | 'cancelled';
    related_employee_id: string | null;
    version: number;
    created_at: string;
    updated_at: string;
}
export interface CommunicationPerson {
    id: string;
    email: string;
    full_name?: string;
    name?: string;
}
