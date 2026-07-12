import { Resend } from 'resend';

type WelcomeEmailInput = {
  to: string;
  name: string;
  workspaceName: string;
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

async function sendEmail(input: { to: string; subject: string; html: string; text: string }) {
  const config = getConfig();

  if (!config) {
    console.error('[Email] RESEND_API_KEY and EMAIL_FROM must be configured for transactional delivery.');
    return { delivered: false, developmentFallback: !isProduction() };
  }

  try {
    const resend = new Resend(config.apiKey);
    const result = await resend.emails.send({ from: config.from, ...input });

    if (result.error) {
      console.error('[Email] Resend delivery failed:', result.error.message);
      return { delivered: false, developmentFallback: false };
    }

    return { delivered: true, developmentFallback: false };
  } catch (error) {
    console.error('[Email] Transactional delivery failed:', error);
    return { delivered: false, developmentFallback: false };
  }
}

export async function sendWelcomeEmail({ to, name, workspaceName }: WelcomeEmailInput): Promise<EmailDeliveryResult> {
  const loginUrl = `${(process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/`;
  const safeName = escapeHtml(name);
  const safeWorkspaceName = escapeHtml(workspaceName);
  const demoNote = process.env.VITE_ENABLE_DEMO_LOGIN !== 'false'
    ? '<p style="color:#9ca3af">This workspace may include portfolio demo fixtures. Do not use real sensitive data in demo mode.</p>'
    : '';

  return sendEmail({
    to,
    subject: 'Welcome to Stanza',
    html: `<main style="background:#020f0a;color:#e6fff5;padding:32px;font-family:Arial,sans-serif"><h1 style="color:#34d399">Welcome to Stanza</h1><p>Hello ${safeName},</p><p><strong>${safeWorkspaceName}</strong> is ready. Sign in to start managing workforce operations.</p><p><a href="${loginUrl}" style="display:inline-block;background:#10b981;color:#02120b;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">Open Stanza</a></p><p>${loginUrl}</p>${demoNote}</main>`,
    text: `Welcome to Stanza, ${name}. ${workspaceName} is ready. Sign in at ${loginUrl}`,
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
    console.log(`[password-reset] Development reset link for ${to}:\n${resetUrl}`);
  }

  return delivery;
}
