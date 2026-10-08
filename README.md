# Study Battle

A polished study companion built with React, Vite, and Supabase. Members can verify an email address, manage a password, time focus sessions, earn coins from completed study hours, add study buddies, compare public focus totals, and collect cosmetic store items.

The app is intentionally client-rendered. Supabase Auth owns account and password security; Postgres row-level security and database functions protect profile changes, study time, coins, and purchases. No Supabase service-role key or Gmail password belongs in this repository.

## What is included

- Sign up with username, email, and password; sign in; email verification; password reset; password update; sign out.
- Email links return to the app through Supabase PKCE callbacks.
- Persistent focus sessions with pause/resume. The database clock measures active time; closing or refreshing the browser does not erase an open session.
- 10 focus coins for each completed focused hour. Coin progress carries across sessions. The database awards coins so the browser cannot set its own balance.
- Study buddies by username, a public authenticated leaderboard, and a cosmetic-only coin store.
- Optional Stripe subscription checkout and billing portal, activated only by verified Stripe webhooks.
- Responsive dashboard, account settings, mobile navigation, reduced-motion support, and clear Supabase setup screen when environment variables are missing.

Plus uses Stripe Checkout at the recurring price configured in your Stripe account. The browser cannot turn Plus on: a signed Stripe webhook updates the account. The Plus button stays unavailable until the Edge Functions and Stripe secrets are configured.

## Requirements

- Node.js 20.19+ or 22.12+ and npm.
- A Supabase project.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the project URL and **publishable** key. In PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   Find these values in the Supabase dashboard under **Project Settings → API** (or **Connect**). The publishable/anon key is designed for frontend use. Never put a `service_role` or secret key in a `VITE_` variable.

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

3. Create the database schema. In the Supabase dashboard, open **SQL Editor** and run both SQL files in order: [`202610080001_initial_schema.sql`](supabase/migrations/202610080001_initial_schema.sql), then [`202610080002_billing.sql`](supabase/migrations/202610080002_billing.sql). They create tables, row-level security policies, the signup profile trigger, secure RPCs, product catalog, and private subscription record.

4. Configure Auth URLs. In **Authentication → URL Configuration**:

   - Set **Site URL** to `http://localhost:5173` for local development.
   - Add `http://localhost:5173/**` to **Redirect URLs**.
   - Before deployment, set Site URL to your real HTTPS site and add its redirect URL, such as `https://your-domain.example/**`. Keep the local URL while developing.

5. In **Authentication → Sign In / Providers → Email**, enable email signups and leave **Confirm email** enabled. Users must verify before they can sign in.

6. Start the app:

   ```bash
   npm run dev
   ```

   Open the local URL shown by Vite (normally `http://localhost:5173`). Restart the dev server after changing `.env`.

## Configure verification and password emails

Supabase Auth sends the confirmation and reset messages. Your frontend calls Supabase Auth; it never sends SMTP mail itself.

1. In **Authentication → SMTP Settings**, enable custom SMTP and enter the sender details. For a small personal test, Gmail SMTP can be configured with `smtp.gmail.com`, port `587` (STARTTLS), your full Gmail address, and a Google **App Password** as the SMTP password. Do not use your normal Google password. Google requires 2-Step Verification to create an App Password, and some account types or security settings do not offer that option.
2. Configure the sender name and sender email to match the Gmail account. Save the SMTP password only in Supabase's SMTP settings; do not add it to this project, `.env`, GitHub, or frontend code.
3. In **Authentication → Email Templates**, customize **Confirm signup** and **Reset password**. Starter HTML templates are in [`supabase/email-templates`](supabase/email-templates). Keep the Supabase `{{ .ConfirmationURL }}` placeholder in each button's link.
4. Test signup with an email address you can access, then test password reset and expired/invalid links.

### Email delivery notes

Supabase's built-in email sender is for trials and only delivers to pre-authorized team addresses, with a low send limit. Custom SMTP is needed for other users. Supabase currently applies a low initial rate limit to custom SMTP projects too; check the dashboard's current Auth rate limits.

Gmail App Passwords are a bridge for low-volume experiments, not a great long-term transactional mail setup. Google describes App Passwords as less secure and requires 2-Step Verification. Delivery, anti-spam decisions, and sending quotas are controlled by Google. For a public launch, use a transactional email provider (such as Resend, Postmark, Brevo, or Amazon SES) with a domain you control, and configure SPF/DKIM/DMARC as directed by the provider. Supabase's [custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp) explains the supported setup.

## Enable the Plus subscription

The project includes Stripe Checkout, subscription status sync, and the Stripe billing portal as Supabase Edge Functions. The monthly amount comes from the Stripe Price you configure; create a recurring USD `$4.99/month` Price if you want to use the amount shown in the app.

1. In Stripe, create a recurring product/Price, then configure the [customer portal](https://docs.stripe.com/customer-management) to let customers manage or cancel the plan.
2. Set these Edge Function secrets in your Supabase project (use your Stripe **test** keys until you are ready to accept payments):

   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_ID=price_... APP_SITE_URL=https://your-domain.example
   ```

   Supabase injects server-only secret keys into Edge Functions. For local Edge Function testing, `SUPABASE_SERVICE_ROLE_KEY` is available from the local stack; put the Stripe values and `APP_SITE_URL` in `supabase/functions/.env`, which is ignored by Git. Never use a secret/service-role key in the frontend or commit it.

3. Deploy the user-facing functions:

   ```bash
   supabase functions deploy create-checkout-session
   supabase functions deploy create-portal-session
   supabase functions deploy stripe-webhook
   ```

4. In Stripe Workbench, create a webhook endpoint for `https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook` and subscribe it to `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Set the endpoint's signing secret in Supabase:

   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

5. Run a test checkout, then verify that the signed webhook updates `billing_subscriptions` and `profiles.is_plus`. Cancel from the Stripe portal and verify Plus turns off after Stripe reports the cancellation.

The webhook verifies Stripe signatures. Checkout and portal functions validate the caller's Supabase access token and use the server-only Stripe and service-role credentials. The SQL coin-award function doubles hourly coins only after the verified webhook sets Plus active.

## Supabase Auth email redirect flow

The app uses the PKCE flow. Signup requests a confirmation redirect to `/?verified=1`; password reset requests a redirect to `/?mode=reset`. The app exchanges the one-time authorization code for a session and then displays the new-password form when appropriate. Those URLs must be included in the Supabase Redirect URL allow list. Do not disable email confirmations as a workaround for mail delivery problems.

## Database and security model

- `profiles` has no email or password field. Auth identity and credentials remain in `auth.users`.
- Authenticated users can read public profile fields for the leaderboard. Only their own profile is changed through narrow, `SECURITY DEFINER` functions.
- Clients can read their own session history but cannot insert, update, or delete sessions directly.
- Start, pause, resume, and finish operations are database functions tied to `auth.uid()`. Elapsed time is calculated from the database clock, including pauses.
- The finish function awards coins based on completed active time and carries partial hours forward.
- Store purchases deduct the database balance and create the collection entry atomically.
- Stripe checkout and subscription changes run through Edge Functions; only signed webhook events set the Plus flag.
- Friendship records are private to the account that created them. A profile exposes only username, focus total, streak, and Plus flag to authenticated users.

The initial migration grants profile and leaderboard fields to any signed-in user. Do not add sensitive personal data to `profiles` without changing its select policy and API design.

## Deploy to GitHub and host

1. Create an empty GitHub repository.
2. From this folder, initialize and push the project:

   ```bash
   git init
   git add .
   git commit -m "Build Study Battle Supabase app"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

3. Import the repository into Vercel, Netlify, or another static host. Set the two `VITE_SUPABASE_*` environment variables in the host's project settings, then deploy.
4. Update Supabase **Site URL** and **Redirect URLs** to the deployed HTTPS domain, and set `APP_SITE_URL` in Edge Function secrets to the same origin.
5. Test a brand-new signup, confirmation link, sign-in, password reset, session persistence, and store purchase on the deployed domain. Test subscription checkout with Stripe test mode before switching to live credentials.

Only `.env.example` is committed. `.env` is ignored by Git.

## Build

```bash
npm run build
npm run preview
```

## Before inviting the public

- Add CAPTCHA/bot protection and review Supabase Auth rate limits.
- Set up a production email sender and authenticated sending domain.
- Switch Stripe from test to live mode only after reviewing checkout, cancellation, webhook retry behavior, and the billing portal.
- Review privacy, terms, retention, account deletion, and any age-related requirements for your audience.
- Keep dependencies and Supabase policies current.

## Credits

Developed by **Bebo & Joe**.
