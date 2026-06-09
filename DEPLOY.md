# Deploy Yonderly — Git, Vercel, Domain & PayPal

---

## What's deployed where

| What | Where it runs |
|------|---------------|
| **Landing page** (yonderly.online) | Vercel |
| **PayPal subscriptions** | PayPal button on Vercel site |
| **Flask app + email agent** | Your computer (for now) |

---

## Part 1 — Push to GitHub

### 1a. Create a GitHub repo

1. Go to [github.com/new](https://github.com/new)
2. Name it `yonderly`
3. Keep it **Private** (recommended — has app code)
4. Do **not** add README or .gitignore (we already have them)
5. Click **Create repository**

### 1b. Push your code

Run these in PowerShell:

```powershell
cd "C:\Users\ltmot\OneDrive\YON-AI AGENT"
git init
git add .
git commit -m "Initial commit: Yonderly landing page, app, and PayPal integration"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/yonderly.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

## Part 2 — Deploy to Vercel

### Option A — From terminal (fastest)

```powershell
cd "C:\Users\ltmot\OneDrive\YON-AI AGENT"
vercel deploy --prod
```

Press **Enter** to accept defaults on first deploy.

### Option B — Connect GitHub (auto-deploy on every push)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository**
3. Select your `yonderly` repo
4. Framework: **Other** (static site)
5. Click **Deploy**

Every `git push` will now auto-update yonderly.online.

---

## Supabase — what to add and how to use it

This project uses Supabase as the main backend for auth, Postgres, storage, and server functions.

1. Create a Supabase project at https://app.supabase.com
2. Note the **Project URL** (e.g. https://xyz.supabase.co) and **API keys**:
   - `anon` (client-side public key)
   - `service_role` (server-side privileged key — keep secret)

3. In Vercel dashboard → Project → Settings → Environment Variables add:

| Name | Value | Notes |
|------|-------|-------|
| `SUPABASE_URL` | your project URL | e.g. https://xyz.supabase.co |
| `SUPABASE_ANON_KEY` | anon key | safe for client-side use |
| `SUPABASE_SERVICE_KEY` | service_role key | **server-only** (Edge functions or serverless)

4. Deploy an example Edge Function (see `api/supabase_example.js`) — it uses the REST API and the anon key to query a `messages` table.

Notes:
- Edge Functions are stateless and short-lived — use them for webhooks, light-weight API logic, and API composition.
- For background jobs or long-running workers use Railway / Docker hosts or a job queue (not Edge Functions).


---

## Part 3 — Connect yonderly.online

### 3a. Add domain in Vercel

```powershell
vercel domains add yonderly.online
vercel domains add www.yonderly.online
```

Or in Vercel Dashboard → Project → **Settings → Domains** → add both.

### 3b. DNS records at your domain registrar

| Type | Name | Value |
|------|------|-------|
| **A** | `@` | `76.76.21.21` |
| **CNAME** | `www` | `cname.vercel-dns.com` |

Wait 5–60 minutes for DNS to propagate. Vercel adds free HTTPS automatically.

---

## Part 4 — PayPal Business integration

### 4a. Create a PayPal Business account

1. Go to [paypal.com/business](https://www.paypal.com/business)
2. Sign up or upgrade to **Business** account
3. Complete business verification

### 4b. Create a $49/month subscription plan

1. Log in to [paypal.com](https://www.paypal.com)
2. Go to **Pay & Get Paid** → **Subscriptions** → **Create Plan**
3. Set up:
   - **Name:** Yonderly AI Employee
   - **Price:** $49 USD / month
   - **Billing cycle:** Monthly
4. Save and copy the **Plan ID** (starts with `P-`)

### 4c. Get your PayPal Client ID

1. Go to [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard)
2. **Apps & Credentials** → **Live** tab
3. Create app (or use default) → copy **Client ID**

### 4d. Add keys to Vercel

In Vercel Dashboard → your project → **Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `PAYPAL_CLIENT_ID` | Your Live Client ID |
| `PAYPAL_PLAN_ID` | Your Plan ID (P-xxx) |
| `PAYPAL_MODE` | `live` |

Apply to **Production**. Then redeploy:

```powershell
vercel deploy --prod
```

PayPal subscribe buttons will appear on the pricing and waitlist sections.

> **Testing first?** Use **Sandbox** credentials from the Sandbox tab in PayPal Developer, set `PAYPAL_MODE=sandbox`, and use sandbox Plan ID.

---

## Part 5 — Verify everything

- [ ] https://yonderly.online loads the landing page
- [ ] https://www.yonderly.online works
- [ ] PayPal subscribe button appears on pricing section
- [ ] Test payment with PayPal sandbox (before going live)
- [ ] SSL padlock shows in browser (HTTPS)

---

## Updating the site

```powershell
# Edit index.html, then:
Copy-Item index.html landing.html
git add .
git commit -m "Update landing page"
git push
# Vercel auto-deploys if GitHub is connected, or run:
vercel deploy --prod
```

---

## Part 6 — Production start, Docker, and stopping local server

This project can run locally for development (Flask dev server) or in production using `gunicorn`, a container, or a platform that respects a `Procfile`.

### 6a. `Procfile` (recommended for Railway/Heroku)

Create a file named `Procfile` at the repo root with this single line (already added):

```
web: gunicorn -w 4 -b 0.0.0.0:$PORT app:app
```

Railway, Heroku, and some PaaS providers will use that start command automatically.

### 6b. `Dockerfile` (already added)

Build and run locally:

```bash
docker build -t yonderly:latest .
docker run -p 8080:8080 -e PORT=8080 --env-file .secrets/.env yonderly:latest
```

On a host that provides a `$PORT` env var (Railway, Render), the `CMD` uses that value.

### 6c. Windows — stop the local Flask server

If you still see the site locally after deploying, a local process is still running. Common ways to stop it:

Find processes listening on a port (replace `5000` or `8080` as needed):

```powershell
netstat -ano | findstr :5000
netstat -ano | findstr :8080
```

That prints a PID in the last column. Stop it with:

```powershell
Stop-Process -Id <PID> -Force
```

If you started the Flask dev server from a terminal, simply close that terminal or press `Ctrl+C` in it.

### 6d. macOS / Linux — stop process on port

```bash
# find PID
lsof -i :5000
# kill
kill <PID>
# or force
kill -9 <PID>
```

### 6e. Vercel vs Railway vs Render (notes)

- Vercel: excellent for static/front-end. For a Flask backend you need to use a Docker deployment or Serverless Functions; Vercel's serverless Python support may be limited for long-running workers. If you rely on background agents (email polling), prefer Railway/Render or a Docker host.
- Railway: supports `Procfile` and Docker. It supplies a `$PORT` env var. Use the `Procfile` or Dockerfile above.
- Render: supports Docker and a simple `gunicorn` start command.

### 6f. Required environment variables (set these in host dashboard)

Add the same variables you use locally in the host's Environment Variables or Secrets section. At minimum:

```
PAYPAL_CLIENT_ID
PAYPAL_PLAN_ID
PAYPAL_MODE
ANTHROPIC_API_KEY
FLASK_SECRET_KEY
PREVIEW_MODE  # set to false in production unless you want drafts
```

### 6g. Check deployment logs

If your deployed site is not serving the app, get the host logs and paste them here — I can help interpret. Example commands for Railway/Render are available in the host dashboards.

---

If you want, I can also:

- Run `docker build` locally and verify the container starts (I can run commands in your workspace),
- Help configure Railway/Vercel with the correct start command and environment variables,
- Review deployment logs if you paste them here.

