 # Yonderly — Your AI Employee for Customer Emails

Yonderly reads your business Gmail inbox and automatically replies to customer emails — in your voice, with your pricing, and your rules. You also get a dashboard to see every email Yonderly has handled.

**No coding experience needed.** Follow each step below in order.

---

## What You Get

| Part | What it does |
|------|-------------|
| **Onboarding form** | A web page where you tell Yonderly about your business |
| **Email agent** | A background script that checks Gmail every 5 minutes and replies for you |
| **Dashboard** | A web page showing every email Yonderly has replied to |

Your business info is saved to `business_profile.json`. All email conversations are logged to `email_log.json`.

---

## Before You Start

You will need:

1. A computer (Windows, Mac, or Linux)
2. **Python 3.10 or newer** — [download here](https://www.python.org/downloads/)
3. A **Gmail account** for your business (the one customers email)
4. An **Anthropic API key** (free credits when you sign up)
5. About **30–45 minutes** for the one-time Google setup

---

## Step 1 — Install Python

### On Windows

1. Go to [python.org/downloads](https://www.python.org/downloads/) and click **Download Python**
2. Run the installer
3. **Important:** On the first screen, check the box that says **"Add Python to PATH"**
4. Click **Install Now** and wait for it to finish
5. Open PowerShell (press `Win + R`, type `powershell`, press Enter)
6. Type `python --version` and press Enter — you should see something like `Python 3.12.x`

### On Mac

1. Open Terminal (search "Terminal" in Spotlight)
2. Type `python3 --version` — if you see a version number, Python is installed
3. If not, install from [python.org/downloads](https://www.python.org/downloads/) or run `brew install python`

---

## Step 2 — Install the Yonderly Packages

1. Open a terminal (PowerShell on Windows, Terminal on Mac)
2. Go to the Yonderly folder. On Windows, type:

```powershell
cd "C:\Users\ltmot\OneDrive\YON-AI AGENT"
```

3. Create a virtual environment (a private folder for Yonderly's packages):

```powershell
python -m venv venv
```

On Mac, use `python3` instead of `python` if needed.

4. Activate the virtual environment:

**Windows:**
```powershell
.\venv\Scripts\Activate
```

**Mac/Linux:**
```bash
source venv/bin/activate
```

You should see `(venv)` at the start of your command line.

5. Install everything Yonderly needs:

```powershell
pip install -r requirements.txt
```

Wait until it finishes with no red error messages.

> **Every time you open a new terminal** to run Yonderly, you need to activate the virtual environment again with the command above.

---

## Step 3 — Get Your Anthropic API Key

Anthropic makes Claude, the AI that writes your email replies. You need a free API key.

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Click **Sign Up** (or **Log In** if you already have an account)
3. Complete the sign-up process
4. Once logged in, click **API Keys** in the left sidebar (or go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
5. Click **Create Key**
6. Give it a name like `Yonderly`
7. Click **Create Key** and **copy the key immediately** — you won't be able to see it again
8. The key looks like: `sk-ant-api03-xxxxxxxxxxxxxxxx`

### Save your key in the project

1. In your Yonderly folder, find the file `.env.example`
2. **Copy** it and rename the copy to `.env` (just `.env`, no `.example`)
3. Open `.env` in Notepad (Windows) or TextEdit (Mac)
4. Replace the placeholder line:

```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

with your real key:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
```

5. Save and close the file.

> **Never share your `.env` file.** It contains your secret key.

---

## Step 4 — Fill Out the Onboarding Form

This teaches Yonderly about your business. Your answers are saved to `business_profile.json`.

1. Make sure your virtual environment is activated (`(venv)` visible in terminal)
2. Start the web app:

```powershell
python app.py
```

3. Open your browser and go to: **http://127.0.0.1:5000**
4. Fill in every field:
   - **Business name** — your company name
   - **What do you sell or offer?** — describe your services or products
   - **What are your prices?** — list your pricing
   - **Most common customer questions** — FAQs you get often
   - **Tone** — professional, friendly, or casual
   - **Customer contact email** — the Gmail address customers write to
   - **What should the AI never say or do?** — hard rules (e.g. "never offer discounts")
5. Click **Save & activate Yonderly**
6. You'll see: **"Yonderly is ready. Your AI employee will now handle your emails."**
7. Click **Go to Dashboard** to see your email activity (empty until the agent runs)

To stop the web app, press `Ctrl + C` in the terminal.

---

## Step 5 — Get Gmail API Credentials

This is a one-time setup so Yonderly can read and send emails from your business Gmail.

### 5a. Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Sign in with the **same Google account** that owns your business Gmail
3. At the top, click the project dropdown → **New Project**
4. Name it `Yonderly` → click **Create**
5. Wait a few seconds, then make sure **Yonderly** is selected in the top bar

### 5b. Enable the Gmail API

1. In the left menu (☰), go to **APIs & Services** → **Library**
2. In the search box, type **Gmail API**
3. Click **Gmail API** in the results
4. Click the blue **Enable** button
5. Wait until it says "API enabled"

### 5c. Set Up the OAuth Consent Screen

Google needs to know who is asking for Gmail access.

1. Go to **APIs & Services** → **OAuth consent screen**
2. Choose **External** → click **Create**
3. Fill in the required fields:
   - **App name:** `Yonderly`
   - **User support email:** pick your email from the dropdown
   - **Developer contact email:** your email address
4. Click **Save and Continue**
5. On the **Scopes** page, click **Save and Continue** (no changes needed)
6. On the **Test users** page, click **+ Add Users**
7. Type the **Gmail address** you want Yonderly to monitor (your business email)
8. Click **Add** → **Save and Continue**
9. Click **Back to Dashboard**

> While your app is in "Testing" mode, only the test users you added can connect. That's fine for getting started.

### 5d. Download credentials.json

1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** at the top → **OAuth client ID**
3. If asked to configure the consent screen first, follow step 5c above
4. For **Application type**, choose **Desktop app**
5. Name it `Yonderly Desktop`
6. Click **Create**
7. A popup appears — click **Download JSON**
8. Find the downloaded file (usually in your Downloads folder)
9. **Rename** it to exactly: `credentials.json`
10. **Move** it into your Yonderly project folder (the same folder as `app.py`)

Your project folder should now contain `credentials.json`.

---

## Step 6 — Start the Email Agent

The email agent runs in the background and handles your inbox.

1. Open a **new terminal** window (keep it separate from the web app)
2. Go to the Yonderly folder and activate the virtual environment:

```powershell
cd "C:\Users\ltmot\OneDrive\YON-AI AGENT"
.\venv\Scripts\Activate
```

3. Start the agent:

```powershell
python email_agent.py
```

4. **First time only:** A browser window opens asking you to sign in to Google
   - Choose the **business Gmail account** you added as a test user
   - Click **Continue** through any warnings (your app is in testing mode — that's normal)
   - Click **Allow** to grant Gmail access
5. Back in the terminal, you should see:

```
  Yonderly Email AI Agent
  Business: Your Business Name
  Monitoring: hello@yourbusiness.com
  Checking every 5 minutes
  Gmail connected successfully!
```

**Keep this terminal window open** while you want Yonderly to work. Press `Ctrl + C` to stop.

### What the agent does every 5 minutes

1. Checks your Gmail inbox for **unread** emails
2. Reads the subject and body of each one
3. Sends it to Claude AI along with your business profile
4. Claude writes a reply in your tone
5. Sends the reply back to the customer from your Gmail
6. Marks the original email as read
7. Logs everything to `email_log.json`

---

## Step 7 — View the Dashboard

The dashboard shows every email Yonderly has replied to.

1. Make sure the web app is running (`python app.py`)
2. Open your browser to: **http://127.0.0.1:5000/dashboard**
3. You'll see:
   - **Total emails handled** at the top
   - A table with time, customer name, subject, and reply preview
   - A **View full reply** button on each row to see the full conversation in a popup

Refresh the page after the email agent handles new emails to see updates.

---

## Step 8 — Test It

1. From a **different email address** (your personal email works), send a test message to your business Gmail
2. Make sure the email arrives in the **Inbox** and stays **unread**
3. Wait up to 5 minutes (the agent checks every 5 minutes)
4. Check your business inbox — you should see an automatic reply
5. Open the dashboard at **http://127.0.0.1:5000/dashboard** to see the logged conversation

---

## Running Both Parts at Once

Yonderly has two things that run separately:

| What | Command | URL |
|------|---------|-----|
| Web app (form + dashboard) | `python app.py` | http://127.0.0.1:5000 |
| Email agent (auto-replies) | `python email_agent.py` | (runs in terminal, no browser) |

You need **two terminal windows** — one for each. Both need the virtual environment activated first.

---

## File Reference

| File | What it is | Who creates it |
|------|-----------|----------------|
| `app.py` | Web app (form + dashboard) | Included |
| `email_agent.py` | Email AI agent | Included |
| `.env` | Your secret API keys | You (from `.env.example`) |
| `credentials.json` | Gmail connection file | You (from Google Cloud) |
| `token.json` | Keeps you logged into Gmail | Auto (first agent run) |
| `business_profile.json` | Your business brain | Auto (when you submit the form) |
| `email_log.json` | All email conversations | Auto (when agent replies) |

---

## Updating Your Business Profile

Changed your prices or tone?

1. Run `python app.py`
2. Go to http://127.0.0.1:5000
3. Update your answers and submit again

The email agent picks up changes automatically on its next check.

---

## Troubleshooting

### "python is not recognized"
Python isn't installed or wasn't added to PATH. Reinstall Python and check **"Add Python to PATH"** on Windows.

### "ANTHROPIC_API_KEY not found"
Your `.env` file is missing or the key isn't set. Make sure you copied `.env.example` to `.env` and pasted your real key.

### "credentials.json not found"
You haven't completed Step 5. Download OAuth credentials from Google Cloud Console and save as `credentials.json` in the project folder.

### "business_profile.json not found"
Run the onboarding form first (`python app.py`), fill it out, and submit.

### Gmail login fails or "Access blocked"
- Make sure you added your Gmail as a **Test user** in Google Cloud Console (Step 5c)
- Sign in with the **same Gmail address** you added as a test user

### No reply after 5+ minutes
- Confirm `email_agent.py` is still running (terminal window open, no errors)
- Confirm the test email is in **Inbox** (not Spam) and still **unread**
- Check the terminal for red error messages

### Dashboard shows 0 emails
- The email agent must be running and must have processed at least one email
- Refresh the dashboard page after an email is handled

---

## Need Help?

Check the terminal output for error messages — they usually explain what went wrong. The Troubleshooting section above covers the most common issues.

Built with Python, Flask, Gmail API, and Claude AI.
