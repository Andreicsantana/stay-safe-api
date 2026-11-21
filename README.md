# Stay Safe API

Backend service for **Stay Safe**, an emergency alert system designed for elderly dependents and their family carers. Provides authentication, profile management, real-time WebSocket notifications, geolocation reverse-geocoding, email alerts, and automatic alert escalation.

## Tech Stack

- **Runtime**: Node.js (>= 18)
- **Framework**: Express 5
- **Database**: PostgreSQL (`pg`)
- **Real-time**: WebSocket (`ws`)
- **Auth & Security**: `jsonwebtoken`, `bcrypt`, `express-rate-limit`, `cors`
- **Email**: Resend (`resend`)
- **Geocoding**: OpenStreetMap Nominatim (non-blocking, 3s timeout)
- **Testing & Lint**: `node:test`, `supertest`, ESLint

## Project Structure

```text
src/
├── app.js                     # Express app factory & middleware
├── index.js                   # Server entrypoint, env check, graceful shutdown
├── db/
│   ├── init.js                # Schema initialization
│   ├── pool.js                # PostgreSQL connection pool
│   └── seed.js                # Demo account seed
├── middleware/
│   └── auth.js                # Profile JWT & account JWT middlewares
├── repositories/
│   ├── alertRepository.js     # Alert SQL queries
│   └── profileRepository.js   # Profile SQL queries
├── routes/
│   ├── alerts.js              # Alert lifecycle endpoints
│   ├── auth.js                # Login & profile session endpoints
│   ├── profiles.js            # Profile CRUD endpoints
│   └── users.js               # Account registration
├── services/
│   ├── escalationWorker.js    # Persistent DB-backed escalation poller
│   └── mailer.js              # Resend email notification builder
├── utils/
│   ├── alertFormatter.js      # Consistent alert serialization & Maps URL
│   └── pinRateLimit.js        # Per-profile PIN attempt limiter
└── ws/
    └── server.js              # WebSocket server & event broadcasting
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:password@host:5432/dbname
JWT_SECRET=your-secret-key
ESCALATE_MS=30000
FRONTEND_URL=http://localhost:5173
RESEND_API_KEY=re_xxxxxxxxx
EMAIL_FROM=Stay Safe <onboarding@resend.dev>
```

### 3. Run locally

```bash
npm run dev
```

Seed demo data (optional):

```bash
npm run seed
```

### 4. Lint & Tests

```bash
npm run lint
npm test
```

## API Endpoints

### Health
- `GET /health` — Checks API and PostgreSQL connectivity (`200` / `503`).

### Users & Auth
- `POST /api/users/register` — Register a family account (`name`, `email`, `phone`, `password`).
- `POST /api/auth/login` — Authenticate and receive `accountToken` + `profiles` (each with `hasPin`).
- `POST /api/auth/select-profile` — Issue a 7-day profile JWT (`accessToken`). Requires `accountToken`.
- `POST /api/auth/create-profile` — Create a `carer` or `dependent` profile. Requires `accountToken`.
- `PATCH /api/auth/update-profile` — Update profile name or PIN. Requires `accountToken`.
- `DELETE /api/auth/delete-profile` — Delete a profile. Requires `accountToken`.
- `POST /api/auth/force-logout` — Disconnect a dependent device via WebSocket. Requires `accountToken`.

### Profiles (Profile JWT)
- `GET /api/profiles/me` — Current authenticated profile.
- `GET /api/profiles/my` — All profiles for the account.
- `POST /api/profiles` — Create a profile.
- `PATCH /api/profiles/:id` — Update a profile.
- `DELETE /api/profiles/:id` — Delete a profile.
- `GET /api/profiles/dependents` — List dependent profiles (`carer` only).

### Alerts (Profile JWT)
- `GET /api/alerts/active` — Active alerts for the current user/profile.
- `GET /api/alerts/active-for-me` — Latest active alert for the authenticated `dependent`.
- `GET /api/alerts?limit=20&offset=0` — Alert history.
- `GET /api/alerts/:id` — Single alert details.
- `POST /api/alerts/emit` — Emit an emergency alert (`dependent` only, optional `latitude`/`longitude`).
- `POST /api/alerts/:id/acknowledge` — Mark alert as acknowledged (`carer` only).
- `POST /api/alerts/:id/resolve` — Resolve alert (carer without PIN; dependent with PIN if configured, rate-limited to 5 failed attempts per 5 minutes).

## WebSocket Events (`/ws?token=<accessToken>`)

- `CONNECTED` — Initial handshake confirmation.
- `ALERT_STATE` — Initial active alert state sent on connect/reconnect.
- `NEW_ALERT` — Broadcast to carers when a dependent emits an alert.
- `ALERT_UPDATED` — Broadcast to carers when reverse-geocoded `address` completes.
- `ALERT_ACKNOWLEDGED` — Broadcast to dependent when a carer confirms they are on the way.
- `ALERT_RESOLVED` — Broadcast to all when an alert is resolved.
- `ALERT_ESCALATED` — Broadcast to all after `ESCALATE_MS` (default 30s) without response.
- `FORCE_LOGOUT` — Forces the target profile to sign out.

## Deployment

Configured for **Render** (`render.yaml`) and **Railway** (`railway.json`). Set `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `RESEND_API_KEY`, and `NODE_ENV=production` in your hosting environment.
