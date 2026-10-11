// Company-email check shared by the contact page forms (message + booking).
// The booking function enforces the same list server-side in
// netlify/lib/calendly.mjs — keep the two in sync.
// Blocks free/personal webmail domains. Extend the list as needed — this is a
// denylist, not an exhaustive company-domain check.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr',
  'outlook.com', 'outlook.fr', 'live.com', 'live.co.uk', 'msn.com',
  'aol.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'gmx.com', 'gmx.net',
  'yandex.com', 'yandex.ru',
  'zoho.com',
  'fastmail.com', 'tutanota.com', 'hey.com',
  'inbox.com', 'rediffmail.com',
  'qq.com', '163.com', '126.com',
]);

function getEmailDomain(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

function isCompanyEmail(email) {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}
