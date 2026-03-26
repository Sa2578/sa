import nodemailer from "nodemailer";

interface SmtpConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export function createTransporter(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

export async function sendEmail(
  config: SmtpConfig,
  options: EmailOptions
) {
  const transporter = createTransporter(config);
  const result = await transporter.sendMail({
    ...options,
  });
  return result;
}

export function formatMailbox(email: string, name?: string | null) {
  if (!name?.trim()) return email;
  const escapedName = name.replace(/"/g, '\\"');
  return `"${escapedName}" <${email}>`;
}

export async function verifySmtp(config: SmtpConfig) {
  const transporter = createTransporter(config);
  await transporter.verify();
}
