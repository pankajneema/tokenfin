# Supabase email templates

TokenFin sends team invites itself (branded, via Resend) when `RESEND_API_KEY` is set — nothing to
configure here in that case.

Without Resend, invites go through **Supabase's own mailer**. Paste these templates so the email
looks right and the link opens the invitation directly:

1. Supabase → Authentication → URL Configuration → **Site URL** = your app URL (no trailing slash).
   Add `https://<your-app>/**` to **Redirect URLs**.
2. Authentication → Emails → **Invite user** → paste `invite.html`.
3. Authentication → Emails → **Magic Link** → paste `magic-link.html` (used when an email that already
   has an account is invited to another workspace).

Both links go to `/auth/confirm`, which verifies the token on the server and opens `/accept-invitation`.
Link lifetime is Authentication → Providers → Email → "Email OTP expiration" (max 24h); the invitation
itself stays valid for 7 days, so an expired link can still be accepted by signing in.
