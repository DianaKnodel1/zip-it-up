# Backend Sync & Migration Status Check

The user's manual deploy log shows that the backend migrations were skipped because `TARGET_DB_URL` is missing on the production server.

## Findings
- **Skipped Migrations:** The log explicitly states: `! TARGET_DB_URL fehlt (weder Umgebung noch /opt/apps/portal/.env.server) — SQL-Migrations werden NICHT eingespielt`.
- **Database Status:** Since migrations were skipped, new features like **Bot Automation**, **Proxy Pool**, **Assignment Groups**, and **Mailless Mode** schema changes are likely not active in the production database.
- **Runbook:** The `RUNBOOK.md` provides the exact path to fix this: adding the `TARGET_DB_URL` to `/opt/apps/portal/.env` on the Portal Host.

## Technical Details
- The self-hosted database is located at `190.97.167.123`.
- The Portal app is located at `190.97.167.124`.
- To fix the backend sync, the `TARGET_DB_URL` must be configured so `scripts/deploy.sh` can connect to the database and apply the `.sql` files in `supabase/manual-migrations/`.

## Steps to be performed by User on Server
1. Log in to **Portal Host** (`190.97.167.124`).
2. Add the database connection string to the environment:
   ```bash
   echo 'TARGET_DB_URL=postgresql://postgres:<PASSWORT>@190.97.167.123:5432/postgres' >> /opt/apps/portal/.env.server
   ```
   *(Note: Replace `<PASSWORT>` with the actual database password).*
3. Re-run the deployment script to apply migrations:
   ```bash
   bash /opt/apps/portal/scripts/deploy.sh
   ```

I will prepare a script `scripts/verify-backend.sh` that the user can run to check if migrations are applied.

## Changes to Codebase
- Create `scripts/verify-backend.sh` to allow the user to easily verify the database schema status.
- Update `scripts/deploy.sh` to be more verbose about *why* a connection might fail (pre-flight check improvements).
