// Copy this file to config.js and fill in your real values.
// config.js is git-ignored — never commit it to a public repo.
//
// SUPABASE: Project Settings → API → Project URL + anon public key
// MEMBERS:  Add every team member here. The admin assigns each person a PIN.
//           id   → any unique short string (no spaces)
//           role → "admin" (can add/edit/delete content) or "member" (read + post only)
//           pin  → 4-digit number as a string, e.g. "1234"

window.COMPUTELAB_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_ID.supabase.co",
  supabasePublishableKey: "YOUR_SUPABASE_ANON_KEY",

  members: [
    { id: "arun",  name: "Arun Sharma",  group: "Algorithms",        role: "admin",  pin: "1234" },
    { id: "priya", name: "Priya Rao",    group: "ML Research",       role: "member", pin: "5678" },
    { id: "neil",  name: "Neil Kumar",   group: "Comp. Physics",     role: "member", pin: "9012" }
  ]
};
