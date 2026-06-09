This folder holds local secret files moved out of the repository root.

- `credentials.json` and `token.json` were moved here to avoid accidental commits.
- `.env` was moved here if present. Keep this folder local and never commit it.

Recommendations:
- Rotate any credentials that were previously exposed in the repository or shared.
- Use environment variables for secrets in production (see `.env.example`).
- Store long-lived secrets in a secure secret manager (AWS Secrets Manager, GitHub Secrets, etc.).
