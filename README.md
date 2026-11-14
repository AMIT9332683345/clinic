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
2. Render → New → Web Service → pick the repo.
3. Root Directory: `backend` · Build Command: `npm install` · Start Command: `npm start`
4. Environment variables:
   | Name | Value |
   |---|---|
   | `MONGODB_URI` | your Atlas connection string |
   | `JWT_SECRET` | any long random string |
   | `CLIENT_ORIGIN` | your Vercel URL, e.g. `https://my-clinic.vercel.app` (comma-separate several) |
   | `CLINIC_TZ` | `Asia/Kolkata` |
5. Deploy, then open `https://<your-service>.onrender.com/health` — it should return `{"ok":true}`.

## 3. Frontend on Vercel
1. Edit `frontend/config.js` and set `API_URL` to your Render URL.
2. Vercel → Add New Project → same repo → **Root Directory: `frontend`** → Framework: Other → Deploy.
3. Go back to Render and set `CLIENT_ORIGIN` to the final Vercel URL.

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
cd ../frontend && npx serve .         # API_URL stays http://localhost:5000
```

## Notes
- Staff sign in with mobile + PIN. SMS OTP needs a paid SMS provider and can be added later.
- Live updates use polling (every 3–5 s). Render's free plan sleeps when idle, so the first request can take ~30 s.
