# AI Film Studio — Deployment

Two supported shapes. Both run the same code; only the configuration differs.

| | **Offline / single host** | **Cloud-native** |
|---|---|---|
| Database | Embedded file driver (JSON + WAL) | PostgreSQL via Prisma |
| Media | Local filesystem | S3 / MinIO |
| Queue | In-process memory | Memory or Redis, worker in its own process |
| AI | Built-in Studio Engine (previs) | Real providers via keys |
| Auth | Open (one local profile) | Credentials, or SSO via env |
| Scale | 1 operator, 1 machine | N app instances behind a load balancer |

Everything below is also visible in-app at **Settings → Deployment**, which reads the
*live* runtime and tells you exactly what is outstanding.

---

## 1. Offline / single host

Zero configuration. No database server, no object store, no external API calls.

```bash
npm ci
npx prisma generate     # generates the client; no DATABASE_URL needed
npm run build
npm start               # http://localhost:3000
```

All state lives under `AFS_DATA_DIR` (default `./.afs-data`):

```
.afs-data/
├── db/          # embedded database (tables, indexes, WAL)
├── storage/     # every generated and uploaded media file
└── logs/
```

**Back up that one directory.** That is the entire product state.

Optional hardening for a shared machine:

```bash
AFS_AUTH_MODE=credentials npm start        # email + password, bcrypt, httpOnly JWT
AFS_DATA_DIR=/mnt/studio-data npm start    # move state to a bigger/faster disk
npm run worker                             # heavy renders in a separate process
```

The built-in **Studio Engine** needs no keys and no network. It renders honest
previsualisation media — SVG plates, procedural motion, synthesised scratch audio — and
labels it as such. Add provider keys later and the router starts preferring them; no
restart required, no reconfiguration of your projects.

---

## 2. Cloud-native stack

PostgreSQL + Redis + MinIO + app + separated media worker, all in one compose file.

```bash
cp .env.production.example .env
# generate two independent 32-byte secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# fill in AFS_ENCRYPTION_KEY, AFS_SESSION_SECRET, POSTGRES_PASSWORD, MINIO_ROOT_PASSWORD

docker compose up -d --build
docker compose exec app npx prisma db push     # first run only: create the schema
docker compose logs -f app worker
```

Open `http://localhost:3000`.

### What each service does

- **app** — Next.js standalone server. Handles requests, serves signed media URLs.
- **worker** — same image, different command. Claims export/encode/generation jobs so a
  10-minute render cannot block request handling. Scale with `docker compose up -d --scale worker=4`.
- **postgres** — all structured state: projects, versions, jobs, audit log, billing.
- **redis** — available for the queue driver and rate limiting.
- **minio** — S3-compatible object storage for every asset, frame, clip and render.
  Swap for real S3 by removing `AWS_S3_ENDPOINT` and setting `AWS_REGION`.

### Swapping MinIO for AWS S3

```env
AFS_STORAGE_DRIVER=s3
AWS_S3_BUCKET=your-bucket
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# leave AWS_S3_ENDPOINT unset
```

---

## 3. Environment reference

### Security (required in production)

| Var | Purpose |
|---|---|
| `AFS_ENCRYPTION_KEY` | AES-256-GCM key encrypting every provider credential at rest. Losing it invalidates all stored keys. |
| `AFS_SESSION_SECRET` | Signs JWTs and media URLs. Rotate by invalidating sessions. |
| `AFS_AUTH_MODE` | `open` (single local profile) or `credentials` (email + password). |
| `AFS_TRUST_PROXY` | Set to `1` behind a load balancer so `x-forwarded-for` is honoured for rate limiting. |

### Data

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string. Presence switches the driver to Prisma. |
| `AFS_DB_DRIVER` | auto | `file` or `prisma`. |
| `AFS_DATA_DIR` | `./.afs-data` | Root for the embedded DB, local storage and logs. |
| `AFS_STORAGE_DRIVER` | `local` | `local` or `s3`. |
| `AFS_STORAGE_DIR` | `$AFS_DATA_DIR/storage` | Local media root. |
| `AWS_S3_BUCKET` / `AWS_REGION` / `AWS_S3_ENDPOINT` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | S3 or S3-compatible target. |
| `AFS_S3_PUBLIC_BASE` | — | Optional CDN prefix for public reads. |

### Jobs and media

| Var | Default | Purpose |
|---|---|---|
| `AFS_QUEUE_DRIVER` | `memory` | `memory` or `redis`. |
| `REDIS_URL` | — | Required for the redis queue driver. |
| `AFS_WORKER_MODE` | `embedded` | `embedded` (in-process) or `external` (claim from a worker process). |
| `AFS_WORKER_CONCURRENCY` | `2` | Parallel jobs per worker. |
| `FFMPEG_PATH` | `ffmpeg` | Server-side H.264/H.265/ProRes encodes. Without it, the app exports via the in-browser renderer, stem mixdowns and project bundles — and says so rather than failing silently. |

### AI providers (all optional)

Platform-level keys let the whole studio work with no per-user setup. Users can still add
their own in **Settings → AI Providers**, which are encrypted and take precedence.

`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `FAL_KEY`,
`ELEVENLABS_API_KEY`, `SUNO_API_KEY`, `COMFYUI_URL`, `OLLAMA_BASE_URL`,
`OPENAI_IMAGE_MODEL`, `OPENAI_VIDEO_MODEL`, `OPENAI_TTS_MODEL`, `FAL_IMAGE_MODEL`,
`FAL_VIDEO_MODEL`, `REPLICATE_VIDEO_MODEL`, `REPLICATE_IMAGE_MODEL`, `REPLICATE_UPSCALE_MODEL`

The router selects per capability using cost, quality, latency, readiness and your
quality preset, and falls back automatically. **No keys → the built-in Studio Engine
serves previs output. Nothing breaks, nothing silently produces low-quality real output.**

---

## 4. Scaling checklist

- [ ] `AFS_DB_DRIVER=prisma` against managed PostgreSQL — the file driver is single-host by design.
- [ ] `AFS_STORAGE_DRIVER=s3` — otherwise instances cannot see each other's media.
- [ ] `AFS_WORKER_MODE=external` with ≥1 worker container; scale workers independently.
- [ ] `AFS_TRUST_PROXY=1` behind the LB; terminate TLS there.
- [ ] Rate limiting backed by Redis (`AFS_RATE_LIMIT_DRIVER=redis`) so limits are global, not per instance.
- [ ] Unique `AFS_ENCRYPTION_KEY` / `AFS_SESSION_SECRET`; store in your secret manager, not the repo.
- [ ] `AFS_AUTH_MODE=credentials`; wire SSO via `OIDC_*` if required.
- [ ] Backups: nightly `pg_dump` plus object-store versioning.
- [ ] Health checks: `GET /api/system` returns readiness and the deployment report.

---

## 5. Verification

```bash
node scripts/verify.mjs   # static guards: bundle purity, store selector stability, boot wiring
node scripts/smoke.mjs    # 70 end-to-end checks against a running server
```

Run smoke against production with `SMOKE_BASE_URL=https://your-host node scripts/smoke.mjs`.
