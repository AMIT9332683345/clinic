# Clinic Queue App

Online token booking, live queue, reception, doctor panel, waiting-room TV and owner reports.
English only. Installable on Android (PWA).

```
clinic-queue-app/
├── backend/    Node + Express + MongoDB (deploy on Render)
└── frontend/   Static PWA, no build step (deploy on Vercel)
```

## 1. MongoDB (Atlas)
- Create or reuse your cluster. **Rotate any password that was ever shared in chat or email.**
- Network Access: allow `0.0.0.0/0` (Render free instances have no fixed IP).
- Copy the connection string and make sure it ends with a database name, e.g. `.../clinic?retryWrites=true&w=majority`.

## 2. Backend on Render
1. Push this folder to GitHub.
2. Render → **New → Blueprint** → pick the repo. `render.yaml` at the root already sets the
   service name, root directory, build/start commands, health check and timezone.
   When prompted, enter `MONGODB_URI` and `CLIENT_ORIGIN`; `JWT_SECRET` is generated.
3. Manual alternative: New → Web Service → Root Directory `backend` ·
   Build Command `npm ci` · Start Command `npm start`.
4. Environment variables:
   | Name | Value |
   |---|---|
   | `MONGODB_URI` | your Atlas connection string |
   | `JWT_SECRET` | any long random string |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://my-clinic.vercel.app` (comma-separate several) |
   | `CLINIC_TZ` | `Asia/Kolkata` |

   The API also accepts every `https://*.vercel.app` origin and `http://localhost:*`, so new
   Vercel preview/production hostnames work without editing `CLIENT_ORIGIN` after each deploy.
5. Deploy, then open `https://<your-service>.onrender.com/health` — it should return `{"ok":true}`.

## 3. Frontend on Vercel
1. Vercel → Add New Project → import this repo and keep the defaults.
   The root `vercel.json` publishes `frontend/` as a static site — no build step, no framework.
   Manual equivalent: Root Directory `frontend` · Framework Preset `Other` ·
   Build Command empty · Output Directory `.`.
2. `frontend/config.js` already points at the deployed backend (`API_URL`). Change that value if you
   deploy the API somewhere else, then redeploy. You can also open
   `https://your-app.vercel.app/?api=https://<your-service>.onrender.com` once to override it on
   a single device.
3. Turn **Deployment Protection** off (project → Settings → Deployment Protection → Vercel
   Authentication → **Disabled**), otherwise visitors get a Vercel login page instead of the app.
4. Use the stable production domain Vercel shows under **Domains** (e.g. `my-clinic.vercel.app`).
   Per-deployment URLs (`…-<hash>-….vercel.app`) change on every push.

> If Vercel still shows `FUNCTION_INVOCATION_FAILED` or a 500, the project's **Root Directory**
> is not the repo root: set it to `.` (or `frontend`), or delete the project and import it again.
> This folder needs no build step; any function/Express preset on the Vercel project must be removed.

## 4. Install on Android
Open the Vercel URL in Chrome → tap **Install app** on the home screen (or menu ⋮ → Add to Home screen).

## 5. Demo data (optional)
Fill an empty database with a working clinic: settings, two doctors, staff accounts,
today's live queue and the last 7 days of visits.

```
cd backend && npm run seed
```

Sign in with mobile + PIN:

| Role | Mobile | PIN |
|---|---|---|
| Owner | 9876500001 | 1234 |
| Reception | 9876500002 | 1234 |
| Doctor | 9876500003 | 1234 |

The seed only runs on a database with no tokens in the last 7 days. Use
`npm run seed -- --force` to replace the demo week with fresh data.
Delete the demo staff accounts (Settings → Staff accounts) before a real clinic starts using the app.

## 6. First use
- Open the app → **Staff sign in** → it asks you to create the owner account (name, mobile, PIN).
- Settings: set clinic name, OPD timing, token limit, doctors; add reception and doctor accounts.
- Share the booking link (`https://your-app.vercel.app/#/book`) on WhatsApp, Instagram or Google Maps.
- Waiting-room TV: open `https://your-app.vercel.app/#/tv` in the TV browser (Settings lists a TV link per doctor).

## Local development
```
cd backend && cp .env.example .env   # fill in values
npm install && npm run dev
cd ../frontend && npx serve .         # on localhost the app calls http://localhost:5000 automatically
```

## Notes
- Staff sign in with mobile + PIN. SMS OTP needs a paid SMS provider and can be added later.
- Live updates use polling (every 3–5 s). Render's free plan sleeps when idle, so the first request can take ~30 s.
