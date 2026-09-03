// Shared Supabase client for the quiz admin dashboard (login + dashboard pages).
//
// Replace the placeholders below with your Supabase project's URL and
// anon/publishable key — the SAME project already used by
// quality-system-quiz.html. Only ever use the anon/publishable key here;
// never the service-role/secret key.
const SUPABASE_URL = 'https://inhxaxyubvhitcimiahu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImluaHhheHl1YnZoaXRjaW1pYWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjEyMjksImV4cCI6MjEwMzkzNzIyOX0.g7H8YWgErqs0eq2aoVPbdRVC0HCEiFSGUYU-MnRlPGI';

const supabaseClient = (SUPABASE_URL !== 'YOUR_SUPABASE_URL' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, storageKey: 'inglasia-quiz-admin', autoRefreshToken: true }
    })
  : null;
