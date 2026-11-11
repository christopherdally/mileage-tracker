// Outgoing email over SMTP. Only password reset uses it; with no SMTP_HOST that feature is simply off.
const env = process.env;

/** Public address of the app, used to build links in emails. */
export const appUrl = () => (env.APP_URL || '').trim().replace(/\/+$/, '');
export const mailConfigured = () => !!(env.SMTP_HOST && /^https?:\/\//.test(appUrl()));

let transport = null;
async function getTransport() {
  if (!transport) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const t = await getTransport();
  await t.sendMail({ from: env.SMTP_FROM || env.SMTP_USER || 'mileage@localhost', to, subject, text });
}
