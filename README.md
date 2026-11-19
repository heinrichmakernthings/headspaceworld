# Headspace · Sam's one-stop shop

Your Headspace app, ready to run on **Cloudflare** (free plan) with:

- **Cloud sync** between iPhone and laptop (Cloudflare D1 database)
- **A private link** so only your devices get in (no password), with an optional email login later (Cloudflare Access)
- **Apple Health**: steps, sleep, active energy, resting heart rate and workouts, sent by the Health Auto Export iPhone app
- **Google Calendar**: today's schedule on My day, a live Calendar page, and 📅＋ to push dated tasks into your calendar
- **Google Drive**: pin files and folders to project cards
- **Milanote and any other link**: pin boards to project cards (Milanote has no public API, so links are the reliable option)
- **Add to Home Screen** on iPhone so it opens like an app

Allow about 45 minutes for the first setup. Steps 1 to 5 get you a private, syncing app. Steps 6 and 7 add Google and Apple Health, and you can do those later.

---

## What's in the folder

```
public/              the app (index.html, iPhone icon, manifest)
src/worker.js        your Worker: serves the app and routes /api/*
src/api/...          the API endpoints
lib/util.js          shared helpers (login check, Google tokens)
schema.sql           database tables
wrangler.toml        Cloudflare settings (already set to your "headspaceworld" Worker; you fill in 4 values)
```

Headspace deploys into the **headspaceworld** Worker you already created, replacing its "Hello world" placeholder. Your address will be `https://headspaceworld.<your-subdomain>.workers.dev` (Workers & Pages → headspaceworld shows it).

## How it deploys

This repo is connected to your **headspaceworld** Worker through Cloudflare's Git integration. Every time something changes in this repo on GitHub, Cloudflare rebuilds and redeploys automatically. Nothing to install.

## 1. Connect the repo to Cloudflare (once)

1. Cloudflare dashboard → **Workers & Pages** → **headspaceworld** → **Settings** → **Builds**.
2. Click **Connect**, choose **GitHub**, allow Cloudflare to see this repo, and pick **headspaceworld**.
3. Leave the settings as they are (branch `main`, deploy command `npx wrangler deploy`) and save.
4. Check the **Deployments** tab: a build starts. When it says Success, Headspace is live.

## 2. Database

Already done: the `headspace` database exists (London region) with its tables, and its ID is in `wrangler.toml`.

## 3. Your private link (no password)

Headspace is locked with a **private link**: your address plus a secret key, like `https://headspaceworld.<you>.workers.dev/?k=...`.

- Open the link once on each device (laptop, iPhone). That device remembers it and syncs from then on.
- Anyone without the link sees an empty, unlinked Headspace and can't read or change your data.
- Lost it on a device? Connections → paste the link. Already linked somewhere? Connections → **Copy private link**.
- **iPhone:** open the link in Safari, then Share → Add to Home Screen. The home screen app keeps the link.
- The same key is your Apple Health token (Connections shows the exact header to paste).
- Only a one-way fingerprint of the key is stored in the database, so the key can't be read back out of it.

To change the key (if you ever share it by mistake), ask Claude to make a new one. Old links stop working straight away.

## 3b. Optional later: a proper login screen

If you want an email login on top, turn on Cloudflare Access:

1. **headspaceworld** → **Settings** → **Domains & Routes**.
2. Next to `workers.dev`, click **Enable Cloudflare Access**. (First time only: pick a Zero Trust team name and the **Free** plan.)
3. The pop-up shows your **team domain** and **AUD tag**. Copy both.
4. Click **Manage Cloudflare Access** and check only your email is allowed.
5. Let your iPhone send health data without a login screen (only needed for Apple Health): **Zero Trust → Access → Applications → Add an application → Self-hosted**, domain `headspaceworld.<your-subdomain>.workers.dev`, path `api/health/ingest`, policy action **Bypass**, Include → **Everyone**.

## 4. Login screen settings (only with 3b)

**headspaceworld** → **Settings** → **Variables and Secrets** → **Add** (type **Text**), one at a time:

| Name | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | your team domain, e.g. `https://sam.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag |
| `ALLOWED_EMAIL` | the email you sign in with |

Click **Deploy**. These live in Cloudflare, not in this repo, so they stay private and survive future deploys.

With Access on, open your address and sign in with the code Cloudflare emails you.

> **Bringing your existing data across:** in the old Headspace, click **Export backup** and copy the text. In the new one, click **Restore backup**, paste and confirm.

## 5. Put it on your iPhone

Open your address in **Safari** → Share → **Add to Home Screen**. Sign in once. It now opens full screen with the bubble icon and syncs with your laptop.

---

## 6. Google Calendar and Drive (optional)

**In [Google Cloud Console](https://console.cloud.google.com):**

1. Create a project called `Headspace`.
2. **APIs & Services → Library**: enable **Google Calendar API**, **Google Drive API** and **Google Picker API**.
3. **OAuth consent screen**: External, app name `Headspace`, your email as support and developer contact. Add scopes `openid`, `email`, `.../auth/calendar.events`, `.../auth/drive.file`.
4. **Publish the app** (Audience → *Publish app* / *In production*). This matters: while it's in *Testing*, Google logs you out every 7 days. You'll see a "Google hasn't verified this app" screen when you connect. That's expected for a personal app: tap **Advanced → Go to Headspace**.
5. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorised JavaScript origin: `https://headspaceworld.<your-subdomain>.workers.dev`
   - Authorised redirect URI: `https://headspaceworld.<your-subdomain>.workers.dev/api/google/callback`
6. **Credentials → Create credentials → API key**. Restrict it to the **Google Picker API** and to the website `https://headspaceworld.<your-subdomain>.workers.dev/*`.
7. Your **project number** (Dashboard / project settings) is the App ID.

**Then add them in Cloudflare:** headspaceworld → Settings → Variables and Secrets → Add, type **Secret**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`. Click Deploy.

In Headspace: **Connections → Connect Google**.

Headspace asks only for `drive.file`, so it can see only the Drive files you pick in the picker, never your whole Drive.

## 7. Apple Health (optional)

1. Make up a long random password (30+ letters and numbers; a password manager can generate one). Add it in Cloudflare: headspaceworld → Settings → Variables and Secrets → Add, type **Secret**, name `HEALTH_TOKEN`. Click Deploy.
2. On your iPhone, install **Health Auto Export (JSON+CSV)** (automations need its Premium tier).
3. **Automations → New automation → REST API**
   - URL: `https://headspaceworld.<your-subdomain>.workers.dev/api/health/ingest` (also shown with a Copy button in Connections)
   - Headers: `Authorization` = `Bearer <your token>`
   - Export format **JSON**, Aggregate data **Days** (important: mixing hourly and daily exports would double count), Period **Since last sync**
   - Health metrics: Step Count, Active Energy, Sleep Analysis, Resting Heart Rate, Apple Exercise Time, optionally Heart Rate Variability, Mindful Minutes, Weight
   - Turn on **Workouts** too
4. Tap **Manual sync**. In Headspace, **My day** now shows "Your body today", and Connections shows the last update time.
5. Add the app's **Automations widget** to your Home Screen so it keeps syncing in the background. iOS only releases Health data while your phone is unlocked, so updates arrive as you use your phone, not live.

Set your step goal in Connections. When you hit it or log a workout, "Move your body" ticks itself.

---

## 8. Extras

- **Your own domain** (for example `headspace.yourdomain.co.uk`): headspaceworld → Settings → Domains & Routes → Add custom domain. Then update the Access application domains and the Google origin and redirect URI to match.
- **Updating the app:** change files in this repo on GitHub (or ask Claude to push changes). Cloudflare redeploys automatically.
- **Run it on your computer:** `npm run db:local` once, then `npm run dev` and open http://localhost:8787. Locally there's no login (`.dev.vars` (copy it from `.dev.vars.example`) sets `DEV_NO_AUTH=1`) and the health token is `dev-health-token`.
- **Netlify:** this version uses Cloudflare's database and login, so it's Cloudflare-only. Cloudflare's free plan comfortably covers one person.

## API reference

All routes need your Cloudflare Access login except `/api/health/ingest`.

| Method | Route | What it does |
|---|---|---|
| GET | `/api/me` | Who you are, plus Google and Health connection status |
| POST | `/api/sync` | `{since, changes:[{collection,id,data|null}]}`. Saves your changes and returns everything changed since `since` |
| POST | `/api/health/ingest` | Health Auto Export webhook (`Authorization: Bearer HEALTH_TOKEN`) |
| GET | `/api/health/summary?days=7` | Daily steps, sleep, energy, resting HR, exercise, workouts |
| GET | `/api/google/auth` → `/api/google/callback` | Connect Google |
| GET | `/api/google/calendar?days=14` | Upcoming events from your primary calendar |
| POST | `/api/google/calendar` | `{title, date, time?, minutes?, detail?}`. Creates an event |
| GET | `/api/google/token` | Short-lived token for the Drive picker |
| POST | `/api/google/disconnect` | Revokes and forgets Google access |

Collections: `tasks`, `notes`, `projects`, `habits`, `journal`, `meta`. If the same item is edited on two devices before they sync, the last change saved wins.

## Security notes

- The API checks Cloudflare's signed login token on every request (not just the login screen) and only accepts `ALLOWED_EMAIL`.
- The health webhook accepts only requests carrying your `HEALTH_TOKEN`. Keep it secret. If it leaks, change it in Variables and Secrets and update the iPhone app.
- Google tokens are stored in your own D1 database, and "Disconnect" revokes them.
