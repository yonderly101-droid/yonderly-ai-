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
