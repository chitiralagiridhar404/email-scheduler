import nodemailer, { Transporter } from "nodemailer";
import { redis } from "./redis";

const CREDS_KEY = "email-scheduler:ethereal-account";

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

let transporterPromise: Promise<{ transporter: Transporter; from: string }> | null = null;

/**
 * Ethereal accounts are created once and cached in Redis, so that restarts
 * keep using the same inbox (previews remain valid and we don't spam Ethereal).
 */
async function loadAccount(): Promise<EtherealAccount> {
  // Optional override (local testing / CI): SMTP_URL=smtp://user:pass@host:port
  if (process.env.SMTP_URL) {
    const u = new URL(process.env.SMTP_URL);
    return {
      user: decodeURIComponent(u.username) || "scheduler@local.test",
      pass: decodeURIComponent(u.password),
      smtp: { host: u.hostname, port: Number(u.port) || 25, secure: u.protocol === "smtps:" },
    };
  }
  const cached = await redis.get(CREDS_KEY);
  if (cached) return JSON.parse(cached) as EtherealAccount;

  const acc = await nodemailer.createTestAccount();
  const account: EtherealAccount = {
    user: acc.user,
    pass: acc.pass,
    smtp: acc.smtp,
  };
  await redis.set(CREDS_KEY, JSON.stringify(account));
  console.log(`[mailer] Created Ethereal account ${account.user}`);
  return account;
}

export function getMailer() {
  if (!transporterPromise) {
    transporterPromise = loadAccount().then((account) => ({
      from: `"ReachInbox Scheduler" <${account.user}>`,
      transporter: nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        ...(account.pass ? { auth: { user: account.user, pass: account.pass } } : {}),
        ...(process.env.SMTP_URL ? { tls: { rejectUnauthorized: false } } : {}),
      }),
    }));
    // Allow retry on next call if account creation failed (e.g. no network).
    transporterPromise.catch(() => (transporterPromise = null));
  }
  return transporterPromise;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
  accepted: string[];
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  html?: boolean;
}): Promise<SendResult> {
  const { transporter, from } = await getMailer();
  const info = await transporter.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    ...(opts.html ? { html: opts.body } : { text: opts.body }),
  });
  const preview = nodemailer.getTestMessageUrl(info);
  return {
    messageId: info.messageId,
    previewUrl: preview || null,
    accepted: (info.accepted as string[]) ?? [],
  };
}
