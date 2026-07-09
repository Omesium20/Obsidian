# Email

`node/src/config/email.ts` configures nodemailer.

- **Dev/test**: points at Supabase's bundled SMTP (port 54325); sent mail is
  viewable in Mailpit (Supabase CLI's local stack). The containerized backend
  reaches it via the `SMTP_HOST=host.docker.internal` override
  ([environment.md](environment.md)).
- **Production**: requires `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, and SMTP
  credentials, and uses `secure: true`.

Consumers: `emailService.ts` — invitation emails and password-reset emails
(tokens SHA-256 hashed at rest, see [auth.md](auth.md)).
