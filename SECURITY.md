# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include sensitive client, credential, or production data in a report. Use GitHub's private vulnerability reporting for this repository. If that option is unavailable, contact the repository owner privately and ask for a secure reporting channel.

Include the affected revision, reproduction steps, impact, and any suggested mitigation. The maintainers will acknowledge receipt, assess severity, and coordinate disclosure after a fix is available.

## Supported versions

Security fixes are applied to the current `main` branch. This repository does not currently publish supported release branches.

## Scope reminders

- Browser-only mode stores demo/practice data in that browser's `localStorage`; it is not shared, backed up, encrypted by this application, or suitable for production client data.
- Never commit `.env` files, database URLs, provider credentials, temporary passwords, session material, or real taxpayer/client data.
- Filing and some integration flows are explicitly simulated. Treat UI confirmation as evidence only where the product states that a real provider accepted the operation.
