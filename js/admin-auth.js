// Shared auth helpers for the quiz admin pages (quiz-admin-login.html, quiz-admin.html).
//
// IMPORTANT: the redirects here are a UX convenience only. The real security
// boundary is Supabase Auth + Row Level Security on the quiz_results table
// (see supabase/quiz_results.sql) — anon can only INSERT, only an
// authenticated session can SELECT. Even if someone bypasses these redirects
// entirely, the underlying data stays inaccessible without a valid session.

function adminConfigMissing() {
  return !supabaseClient;
}

async function getAdminSession() {
  if (adminConfigMissing()) return null;
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

function redirectToLogin() {
  window.location.replace('quiz-admin-login.html');
}

function redirectToDashboard() {
  window.location.replace('quiz-admin.html');
}

async function adminLogout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  redirectToLogin();
}
