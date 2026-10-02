import { Resend } from 'resend';

type WelcomeEmailInput = {
  to: string;
  name: string;
  workspaceName: string;
  includeWorkspaceName: boolean;
  includeLoginEmail: boolean;
};

type PasswordResetEmailInput = {
  to: string;
  name: string;
  resetUrl: string;
};

export type EmailDeliveryResult = {
  delivered: boolean;
  developmentFallback: boolean;
};

const isProduction = () => process.env.NODE_ENV === 'production';

function getConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character);
}

export function emailProviderConfigured() { return Boolean(getConfig()); }
let provider: { key: string; client: Resend } | undefined;
export type ProviderResult = { ok: true; id: string } | { ok: false; kind: 'unconfigured' | 'transient' | 'permanent'; code: string };
export async function deliverEmail(input: { to: string | string[]; subject: string; text: string; html: string; attachments?: Array<{filename:string;content:Buffer}> }, idempotencyKey?: string): Promise<ProviderResult> {
  const config=getConfig();
  if(!config)return {ok:false,kind:'unconfigured',code:'PROVIDER_NOT_CONFIGURED'};
  provider ??= {key:config.apiKey,client:new Resend(config.apiKey)};
  if(provider.key!==config.apiKey)provider={key:config.apiKey,client:new Resend(config.apiKey)};
  try {
    const result=await provider.client.emails.send({from:config.from,...input},idempotencyKey?{idempotencyKey}:undefined);
    if(result.error){
      const status=Number(result.error.statusCode||0);
      const retryableNames=new Set(['rate_limit_exceeded','concurrent_idempotent_requests','application_error','internal_server_error']);
      const transient=status===429||status>=500||retryableNames.has(result.error.name);
      return {ok:false,kind:transient?'transient':'permanent',code:result.error.name==='rate_limit_exceeded'?'PROVIDER_RATE_LIMIT':transient?'PROVIDER_TEMPORARY_ERROR':'PROVIDER_REJECTED'};
    }
    if(!result.data?.id)return {ok:false,kind:'transient',code:'PROVIDER_EMPTY_RESPONSE'};
    return {ok:true,id:result.data.id};
  }catch{return {ok:false,kind:'transient',code:'PROVIDER_NETWORK_ERROR'};}
}
async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<EmailDeliveryResult> {
  const result=await deliverEmail(input);
  if(result.ok === true)return {delivered:true,developmentFallback:false};
  console.error('[Email] Transactional delivery failed:',result.code);
  return {delivered:false,developmentFallback:result.kind==='unconfigured'&&!isProduction()};
}

export async function sendWelcomeEmail({ to, name, workspaceName, includeWorkspaceName, includeLoginEmail }: WelcomeEmailInput): Promise<EmailDeliveryResult> {
  const loginUrl = `${(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/`;
  const safeName = escapeHtml(name);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const demoNote = process.env.STANZA_DEMO_ENV === 'true'
    ? '<p style="color:#9ca3af">This workspace may include portfolio demo fixtures. Do not use real sensitive data in demo mode.</p>'
    : '';

  const workspaceSection = includeWorkspaceName ? `<p><strong>Workspace:</strong> ${safeWorkspaceName}</p>` : '';
  const loginSection = includeLoginEmail ? `<p><strong>Sign-in email:</strong> ${escapeHtml(to)}</p>` : '';
  const textSections = [
    includeWorkspaceName ? `Workspace: ${workspaceName}` : '',
    includeLoginEmail ? `Sign-in email: ${to}` : '',
  ].filter(Boolean).join('\n');

  return sendEmail({
    to,
    subject: 'Welcome to Stanza',
    html: `<main style="background:#020f0a;color:#e6fff5;padding:32px;font-family:Arial,sans-serif"><h1 style="color:#34d399">Welcome to Stanza</h1><p>Hello ${safeName},</p><p>Your account is ready. Sign in to start managing workforce operations.</p>${workspaceSection}${loginSection}<p><a href="${loginUrl}" style="display:inline-block;background:#10b981;color:#02120b;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">Open Stanza</a></p><p>${loginUrl}</p><p style="color:#9ca3af">Stanza will never send or ask you to send your password by email.</p>${demoNote}</main>`,
    text: `Welcome to Stanza, ${name}. Your account is ready.\n${textSections}\n\nOpen Stanza: ${loginUrl}\n\nStanza will never send or ask you to send your password by email.`,
  });
}

export async function sendPasswordResetEmail({ to, name, resetUrl }: PasswordResetEmailInput): Promise<EmailDeliveryResult> {
  const safeName = escapeHtml(name);
  const safeResetUrl = escapeHtml(resetUrl);
  const delivery = await sendEmail({
    to,
    subject: 'Reset your Stanza password',
    html: `<main style="background:#020f0a;color:#e6fff5;padding:32px;font-family:Arial,sans-serif"><h1 style="color:#34d399">Reset your Stanza password</h1><p>Hello ${safeName},</p><p>Use the secure link below to choose a new password. It expires in 15 minutes.</p><p><a href="${safeResetUrl}" style="display:inline-block;background:#10b981;color:#02120b;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">Reset password</a></p><p>${safeResetUrl}</p><p style="color:#9ca3af">If you did not request this, ignore this email.</p></main>`,
    text: `Hello ${name}, reset your Stanza password within 15 minutes: ${resetUrl}\n\nIf you did not request this, ignore this email.`,
  });

  if (delivery.developmentFallback) {
    console.warn('[Email] Password-reset delivery is not configured; no reset link was logged.');
  }

  return delivery;
}
