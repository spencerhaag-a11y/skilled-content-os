// Transactional email for the team-* functions.
//
// This project has no email provider: Supabase's built-in sender only issues
// Auth templates (invite/confirm/recovery) and cannot carry a custom body, and
// the GHL integration writes campaign drafts rather than sending to an address.
//
// So sending is feature-detected. Set RESEND_API_KEY (and optionally
// EMAIL_FROM) as Edge Function secrets and invites mail themselves with no
// code change. Until then send() reports notConfigured and the caller falls
// back to showing the credentials to the owner for out-of-band delivery —
// which is why team-invite returns the password in its response.

export interface SendResult {
  sent: boolean;
  /** Present when sent === false. */
  reason?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { sent: false, reason: "No email provider configured (RESEND_API_KEY is unset)." };
  }

  const from = Deno.env.get("EMAIL_FROM") ?? "Skilled Content OS <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return { sent: false, reason: `Email provider returned ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : "Email send failed." };
  }
}

/** The invite email body. Kept here so both branches render identically. */
export function inviteEmailBody(opts: {
  appUrl: string;
  firstName: string;
  email: string;
  password: string;
}): { subject: string; html: string; text: string } {
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi,";
  const subject = "Your Skilled Content OS login";

  const text = [
    greeting,
    "",
    "An account has been created for you in Skilled Content OS.",
    "",
    `Sign in:   ${opts.appUrl}`,
    `Username:  ${opts.email}`,
    `Temporary password:  ${opts.password}`,
    "",
    "You'll be asked to choose your own password the first time you sign in.",
    "This temporary password stops working at that point.",
  ].join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>${greeting}</p>
  <p>An account has been created for you in Skilled Content OS.</p>
  <table cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse">
    <tr><td style="padding:4px 16px 4px 0;color:#666">Sign in</td>
        <td style="padding:4px 0"><a href="${opts.appUrl}">${opts.appUrl}</a></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Username</td>
        <td style="padding:4px 0"><code>${opts.email}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Temporary password</td>
        <td style="padding:4px 0"><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px">${opts.password}</code></td></tr>
  </table>
  <p>You'll be asked to choose your own password the first time you sign in.
     This temporary password stops working at that point.</p>
</div>`.trim();

  return { subject, html, text };
}

/** The password-reset email body. Same shape as the invite, different framing. */
export function resetEmailBody(opts: {
  appUrl: string;
  firstName: string;
  email: string;
  password: string;
}): { subject: string; html: string; text: string } {
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi,";
  const subject = "Your Skilled Content OS password was reset";

  const text = [
    greeting,
    "",
    "Your account owner reset your password. Your previous one no longer works.",
    "",
    `Sign in:   ${opts.appUrl}`,
    `Username:  ${opts.email}`,
    `Temporary password:  ${opts.password}`,
    "",
    "You'll be asked to choose a new password the next time you sign in.",
  ].join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>${greeting}</p>
  <p>Your account owner reset your password. Your previous one no longer works.</p>
  <table cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse">
    <tr><td style="padding:4px 16px 4px 0;color:#666">Sign in</td>
        <td style="padding:4px 0"><a href="${opts.appUrl}">${opts.appUrl}</a></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Username</td>
        <td style="padding:4px 0"><code>${opts.email}</code></td></tr>
    <tr><td style="padding:4px 16px 4px 0;color:#666">Temporary password</td>
        <td style="padding:4px 0"><code style="background:#f4f4f5;padding:2px 6px;border-radius:4px">${opts.password}</code></td></tr>
  </table>
  <p>You'll be asked to choose a new password the next time you sign in.</p>
</div>`.trim();

  return { subject, html, text };
}
