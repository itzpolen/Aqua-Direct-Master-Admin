# AquaDirect Admin Portal

Simple administrator dashboard built with React, TypeScript, Vite, and CSS. It authenticates through Supabase, checks the signed-in user's `admin.access` permission, and reads station applications, stations, and orders under the existing RLS policies.

## Setup

Use Node.js 20.19+ or 22.12+. From this directory:

```sh
npm install
```

Copy `.env.example` to `.env.local` and configure the AquaDirect Supabase project URL and public anon key:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Then run:

```sh
npm run dev
```

The signed-in user must have the `admin.access` permission in `user_roles` and `admin_permissions`. The Admin Accounts page additionally requires `roles.manage`. Granting admin access is limited to an existing account with a confirmed email address and is recorded in the admin audit log.

For live dashboard updates, apply `supabase/migrations/20261024090000_admin_portal_realtime.sql` to add the relevant tables to the `supabase_realtime` publication. The Admin Accounts page migration is `supabase/migrations/20261022230000_admin_account_management.sql`. The dashboard never uses a service-role key; database RLS and the audited database function authorize admin grants. Do not expose service-role or payment-provider secrets in this frontend.
