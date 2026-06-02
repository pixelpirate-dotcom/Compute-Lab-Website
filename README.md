# ComputeLab Workspace

A lightweight first version of the computational team's shared workspace.

## Run locally

Open `index.html` directly in a browser. No installation is required.

The Supabase project URL and public publishable key are configured in
`config.js`. Only authenticated users can open the shared workspace.

## Included workflows

- Team feed with posts and optional shared links
- Project, team member, and resource directories
- Presentation app launcher
- Administrator workspace for adding, editing, and removing managed content
- Password recovery
- Supabase schema with row-level security policies

## Connect Supabase

The next integration step is to connect the interface to your Supabase project.

1. Open your Supabase project dashboard.
2. Open **SQL Editor** and run `supabase-schema.sql`.
3. Enable the preferred authentication provider under **Authentication**.
4. Open `index.html` and create your account or sign in.
5. After your first signup, run the final commented `update` statement from the
   schema with your email address to make that account the first administrator.

Do not share the database password, service-role key, or secret key.

The schema file is intended for the first installation. If the tables already
exist, do not run the entire file again.

## Development email setup

Supabase's built-in email provider is intentionally limited and is not intended
for repeated signup testing. During private development, open **Authentication**
then **Providers**, select **Email**, turn off **Confirm email**, and save the
setting. New email/password accounts can then sign in without a confirmation
email.

Before inviting a real team, either turn confirmation back on and configure
custom SMTP or use another production-ready authentication provider.
