# Privacy and external services

Self-hosted account, timer, intention, task, and preference data is stored in
the operator's PostgreSQL database. Redis carries realtime state. Operators are
responsible for access control, backups, retention, TLS, and applicable privacy
obligations.

Optional integrations are disabled when their credentials are absent:

- Sentry receives sanitized application errors and logs when its DSN is set in
  a production build.
- GitHub feedback creates an issue in the explicitly configured repository.
- OpenRouter receives task text, transcripts, and audio submitted to AI task
  capture or Assistant features. These user features are off by default.
- Firebase Cloud Messaging and Apple Push Notification service receive device
  tokens and notification payloads when an operator supplies credentials.

Operators must disclose enabled processors to their users and review each
provider's current terms, retention, region, and privacy policy.
