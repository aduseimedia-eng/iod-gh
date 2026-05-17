# Railway to Local Postgres Backup Sync

This project can keep Railway Postgres as the primary production database and maintain a local Postgres copy for disaster recovery.

## What Gets Protected

The full Railway backup command writes a JSON snapshot of every public table to:

```text
backups/railway/
```

The full Railway-to-local sync also copies the operational tables used by this app:

- `subscription_rates`
- `members`
- `subscriptions`
- `payments`
- `admin_users`
- `admin_activity_logs`

Use this as a one-way safety mirror from Railway to local Postgres. Avoid two-way sync unless you intentionally need to merge changes both ways.

## Required Environment

Set your local Postgres connection with the normal local variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=iod_ghana
DB_USER=postgres
DB_PASSWORD=your_local_postgres_password
DB_SSL=false
```

Set Railway's public Postgres URL with one of these:

```env
DATABASE_PUBLIC_URL=postgresql://...
```

or:

```env
RAILWAY_DATABASE_PUBLIC_URL=postgresql://...
```

If those are not set, the script tries to read the Railway Postgres variables through the Railway CLI.

## Manual Commands

Backup Railway to JSON only:

```powershell
npm run backup:railway:full
```

Backup Railway and sync into local Postgres:

```powershell
npm run sync:railway-to-local:full
```

The sync command creates a pre-sync local snapshot first, then upserts Railway data into local Postgres.

## Windows Daily Schedule

Run this once in PowerShell to schedule a daily 2:00 AM sync:

```powershell
$project = "C:\Users\aduse\Desktop\Code\Database Design"
$script = Join-Path $project "scripts\sync-railway-to-local.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName "IOD Railway to Local Postgres Sync" -Action $action -Trigger $trigger -Description "Backs up Railway Postgres and syncs it into local Postgres"
```

Check the latest scheduled run output here:

```text
sync-railway-to-local.log
```

## Important Safety Notes

- Treat Railway as the primary source of truth.
- Use `sync:railway-to-local:full` for backup protection.
- Do not run `sync:local-to-railway` unless you are intentionally pushing local data into production.
- Keep multiple files in `backups/railway/`; they are your point-in-time recovery trail.
- Test restore occasionally by opening the local app against the local Postgres copy.
