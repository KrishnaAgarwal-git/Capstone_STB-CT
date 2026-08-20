import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL || "STB-CT <onboarding@resend.dev>";

const brandWrap = (title, bodyHtml) => `
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
    <h2 style="color: #16a34a; margin: 0 0 4px;">🌿 STB-CT</h2>
    <p style="color: #64748b; font-size: 13px; margin: 0 0 24px;">Sustainable Time Bank with Carbon Tracking</p>
    <h3 style="margin: 0 0 12px;">${title}</h3>
    ${bodyHtml}
    <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
      If you didn't request this, you can safely ignore this email.
    </p>
  </div>
`;

const send = async ({ to, subject, html, logFallbackLabel, logFallbackDetail }) => {
  if (!resend) {
    console.warn(
      `[email.service] RESEND_API_KEY is not set - skipping send. ${logFallbackLabel} for ${to}: ${logFallbackDetail}`
    );
    return { sent: false };
  }
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) {
    console.error(`[email.service] Resend failed to send "${subject}":`, error);
    throw new Error("Failed to send email");
  }
  return { sent: true };
};

export const sendVerificationEmail = ({ to, name, verificationUrl }) =>
  send({
    to,
    subject: "Verify your email for STB-CT",
    html: brandWrap(
      `Hi ${name}, verify your email`,
      `<p>Click below to verify your account and start tracking.</p>
       <a href="${verificationUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Verify email</a>
       <p style="color:#64748b;font-size:12px;margin-top:16px;">Or paste this link: ${verificationUrl}</p>
       <p style="color:#94a3b8;font-size:12px;">This link expires in 24 hours.</p>`
    ),
    logFallbackLabel: "Verification link",
    logFallbackDetail: verificationUrl,
  });

export const sendPasswordResetEmail = ({ to, name, resetUrl }) =>
  send({
    to,
    subject: "Reset your STB-CT password",
    html: brandWrap(
      `Hi ${name}, reset your password`,
      `<p>Click below to choose a new password.</p>
       <a href="${resetUrl}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a>
       <p style="color:#64748b;font-size:12px;margin-top:16px;">Or paste this link: ${resetUrl}</p>
       <p style="color:#94a3b8;font-size:12px;">This link expires in 1 hour.</p>`
    ),
    logFallbackLabel: "Password reset link",
    logFallbackDetail: resetUrl,
  });

export const sendContactNotification = ({ name, email, subject, message }) => {
  const receiver = process.env.CONTACT_RECEIVER_EMAIL;
  if (!receiver) {
    console.warn("[email.service] CONTACT_RECEIVER_EMAIL is not set - contact submission stored but not emailed");
    return { sent: false };
  }
  // Strip CR/LF from user-supplied fields so nothing can inject extra email headers.
  const clean = (s) => String(s || "").replace(/[\r\n]+/g, " ");
  return send({
    to: receiver,
    subject: `[Contact] ${clean(subject) || "New message"} — from ${clean(name)}`,
    html: brandWrap(
      "New contact form submission",
      `<p><strong>From:</strong> ${clean(name)} (${clean(email)})</p>
       <p><strong>Subject:</strong> ${clean(subject)}</p>
       <p style="white-space:pre-wrap;border-left:3px solid #16a34a;padding-left:12px;">${clean(message)}</p>`
    ),
    logFallbackLabel: "Contact submission",
    logFallbackDetail: `${name} <${email}>: ${message}`,
  });
};
