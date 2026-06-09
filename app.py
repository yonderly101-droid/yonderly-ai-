"""
Yonderly — Business Onboarding Web App
Run this file to start the onboarding form and dashboard.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
import requests

from whatsapp_agent import register_whatsapp_routes

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "yonderly-dev-secret-change-me")
register_whatsapp_routes(app)

# PayPal configuration (use environment variables; do NOT store secrets in repo)
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_SECRET = os.getenv("PAYPAL_SECRET")
PAYPAL_MODE = os.getenv("PAYPAL_MODE", "sandbox")

PAYPAL_BASE = "https://api-m.sandbox.paypal.com" if PAYPAL_MODE == "sandbox" else "https://api-m.paypal.com"

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "business_profile.json"
LOG_PATH = BASE_DIR / "email_log.json"


def load_profile():
    """Load existing business profile if one exists."""
    if PROFILE_PATH.exists():
        with open(PROFILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def load_email_log():
    """Load all logged email conversations."""
    if LOG_PATH.exists():
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_profile(data: dict):
    """Save business profile to business_profile.json."""
    now = datetime.now(timezone.utc).isoformat()
    existing = load_profile() or {}

    profile = {
        "business_name": data["business_name"].strip(),
        "offerings": data["offerings"].strip(),
        "prices": data["prices"].strip(),
        "common_questions": data["common_questions"].strip(),
        "tone": data["tone"],
        "contact_email": data["contact_email"].strip().lower(),
        "restrictions": data["restrictions"].strip(),
        "created_at": existing.get("created_at", now),
        "updated_at": now,
    }

    with open(PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2, ensure_ascii=False)

    return profile


def format_timestamp(iso_string):
    """Turn an ISO timestamp into a readable date/time string."""
    try:
        dt = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        return dt.strftime("%b %d, %Y · %I:%M %p")
    except (ValueError, AttributeError):
        return iso_string or "—"


def reply_preview(text, max_length=80):
    """Short preview of a reply for the dashboard table."""
    if not text:
        return "—"
    one_line = " ".join(text.split())
    if len(one_line) <= max_length:
        return one_line
    return one_line[:max_length].rstrip() + "…"


def parse_log_timestamp(iso_string):
    """Parse an ISO timestamp from the email log."""
    if not iso_string:
        return None
    try:
        return datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
    except ValueError:
        return None


def compute_email_stats(raw_log):
    """Calculate dashboard stats from email_log.json."""
    total_count = len(raw_log)
    today_utc = datetime.now(timezone.utc).date()
    emails_today = 0
    last_active_dt = None

    for entry in raw_log:
        ts = parse_log_timestamp(entry.get("timestamp", ""))
        if ts:
            if ts.date() == today_utc:
                emails_today += 1
            if last_active_dt is None or ts > last_active_dt:
                last_active_dt = ts

    if last_active_dt:
        last_active = last_active_dt.strftime("%b %d, %Y · %I:%M %p")
    else:
        last_active = "—"

    return {
        "total_count": total_count,
        "emails_today": emails_today,
        "last_active": last_active,
    }


@app.route("/")
def index():
    """Show the onboarding form, pre-filled if a profile already exists."""
    profile = load_profile()
    return render_template("index.html", profile=profile)


@app.route("/submit", methods=["POST"])
def submit():
    """Handle form submission, save to business_profile.json, redirect to success."""
    required_fields = [
        "business_name",
        "offerings",
        "prices",
        "common_questions",
        "tone",
        "contact_email",
        "restrictions",
    ]

    missing = [field for field in required_fields if not request.form.get(field, "").strip()]
    if missing:
        flash("Please fill in all required fields before submitting.", "error")
        return redirect(url_for("index"))

    tone = request.form.get("tone", "").strip()
    if tone not in ("professional", "friendly", "casual"):
        flash("Please select a valid tone: professional, friendly, or casual.", "error")
        return redirect(url_for("index"))

    save_profile(request.form)
    return redirect(url_for("success"))


@app.route("/success")
def success():
    """Show confirmation after the business profile is saved."""
    profile = load_profile()
    if not profile:
        return redirect(url_for("index"))
    return render_template("success.html", profile=profile)


@app.route("/dashboard")
def dashboard():
    """Show all emails Yonderly has replied to."""
    profile = load_profile()
    raw_log = load_email_log()
    stats = compute_email_stats(raw_log)

    emails = []
    for entry in reversed(raw_log):
        emails.append({
            "timestamp": format_timestamp(entry.get("timestamp", "")),
            "customer_name": entry.get("customer_name", "Unknown"),
            "customer_email": entry.get("customer_email", ""),
            "subject": entry.get("subject", "(no subject)"),
            "customer_message": entry.get("customer_message", ""),
            "yonderly_reply": entry.get("yonderly_reply", ""),
            "reply_preview": reply_preview(entry.get("yonderly_reply", "")),
        })

    return render_template(
        "dashboard.html",
        profile=profile,
        emails=emails,
        stats=stats,
    )


@app.route('/pricing')
def pricing():
    """Render a simple pricing page with a PayPal button."""
    return render_template('pricing.html', paypal_client_id=PAYPAL_CLIENT_ID)


def get_paypal_token():
    """Obtain an access token from PayPal using client credentials."""
    if not PAYPAL_CLIENT_ID or not PAYPAL_SECRET:
        raise RuntimeError("PayPal credentials are not configured in environment variables")

    res = requests.post(
        f"{PAYPAL_BASE}/v1/oauth2/token",
        headers={"Accept": "application/json"},
        data={"grant_type": "client_credentials"},
        auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
        timeout=10,
    )
    res.raise_for_status()
    return res.json().get('access_token')


@app.route('/payment/success', methods=['POST'])
def payment_success():
    order_id = request.json.get('orderID')
    if not order_id:
        return jsonify({"success": False, "error": "missing orderID"}), 400

    try:
        token = get_paypal_token()
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

    # Verify the order with PayPal
    res = requests.get(
        f"{PAYPAL_BASE}/v2/checkout/orders/{order_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    if res.status_code != 200:
        return jsonify({"success": False, "error": "verification failed"}), 400

    order = res.json()

    if order.get('status') == 'COMPLETED':
        # TODO: mark user as paid in your DB / JSON file
        return jsonify({"success": True})
    else:
        return jsonify({"success": False}), 400


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"\n  Yonderly is running at http://127.0.0.1:{port}")
    print(f"  Dashboard: http://127.0.0.1:{port}/dashboard\n")
    app.run(debug=True, host="127.0.0.1", port=port)
