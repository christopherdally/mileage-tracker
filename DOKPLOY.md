# Deploying on Dokploy

Two ways to run it. **Option A is simplest**: Dokploy builds the app and runs its own Postgres alongside it.

Either way, push this folder to a Git repository Dokploy can read (GitHub, GitLab, Gitea or Bitbucket), and keep it private.

## Option A — Compose (app + database together)

1. In your Dokploy project choose **Create Service → Compose**.
2. **General**: connect your repository and branch. Set **Compose Path** to `./docker-compose.dokploy.yml`.
3. **Environment**: paste the variables below (with your own values) and save.
4. **Domains**: add a domain. Service `app`, container port `3000`, path `/`, HTTPS on with Let's Encrypt.
   Point an A record for that domain at your Dokploy server first.
5. Click **Deploy**. The first build takes a few minutes.
6. Open `https://<your-domain>`, sign in, and choose your own password when asked.

```env
# Letters and numbers only. Generate: openssl rand -hex 24
POSTGRES_PASSWORD=
# 32+ random characters. Generate: openssl rand -base64 48
JWT_SECRET=
# First account, created on the very first start only. You'll be asked to change the password at first sign-in.
ADMIN_USERNAME=cdallywales@gmail.com
ADMIN_PASSWORD=
TZ=Europe/London

# Backups: local (Docker volume on the server), s3, or both
BACKUP_TARGET=local
BACKUP_TIME=02:00
BACKUP_KEEP=30
# S3_BUCKET=
# S3_REGION=eu-west-2
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# S3_ENDPOINT=            # for Backblaze B2, R2, MinIO…
# S3_FORCE_PATH_STYLE=false
```

Data lives in two Docker volumes, `pgdata` (database, including receipt photos) and `backups`. Redeploys keep them.

## Option B — Application (Dockerfile) + a Dokploy Postgres database

Use this if you'd rather manage the database as a separate Dokploy service.

1. **Create Service → Database → PostgreSQL**. Note its **Internal Connection URL** and the Postgres version (the image tag, e.g. `postgres:16`).
2. **Create Service → Application**. Connect the repository.
   - **Build Type**: Dockerfile. Dockerfile path `Dockerfile`, build context `.`
   - **Build arguments** (only if your database isn't Postgres 16): `PG_CLIENT_VERSION=17` to match it, so backups work.
3. **Environment**:
   ```env
   DATABASE_URL=<the Internal Connection URL from step 1>
   JWT_SECRET=
   ADMIN_USERNAME=cdallywales@gmail.com
   ADMIN_PASSWORD=
   TRUST_PROXY=true
   TZ=Europe/London
   BACKUP_TARGET=local
   ```
4. **Advanced → Volumes**: add a volume mount, name `mileage-backups`, mount path `/backups` (otherwise local backups are lost on redeploy).
5. **Domains**: add your domain with container port `3000`, HTTPS on.
6. **Deploy**.

## After deploying

- **Install on your phone**: open the site in Safari (iPhone) or Chrome (Android) and use **Add to Home Screen**.
- **Health check**: `https://<your-domain>/api/health` returns `{"ok":true}`.
- **Locked out**: in Dokploy open the app container's terminal and run
  `npm run create-admin -- cdallywales@gmail.com 'a-new-password'`
- **Updates**: push to the branch and redeploy (or turn on auto-deploy). Phones show "A new version is ready" and reload when tapped.
- `ADMIN_PASSWORD` is only used when the database has no users. After first sign-in it's no longer needed and can be removed from the environment.


## Personal report archive

Users can upload past monthly PDFs (up to 3 MB) in Settings → Report archive or archive a past report directly from the report screen. Each upload is a separate snapshot. Reports use the existing S3_BUCKET, S3_PREFIX, S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_SSE and AWS credentials configuration. The application needs PutObject, GetObject and DeleteObject on `<S3_PREFIX>/reports/*`. Keep the bucket private. Report keys are isolated per user and all API operations enforce ownership. Reports are not rotated by BACKUP_KEEP. Startup migration creates report_archives metadata, which is included in database dumps; S3 objects themselves need bucket-level backup/versioning if required. Restoring older metadata may omit newer archive records. Deletes use S3 DeleteObject; bucket versioning/lifecycle policies determine retention of previous versions.
