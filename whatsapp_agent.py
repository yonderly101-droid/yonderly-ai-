"""
Yonderly — WhatsApp AI via Pabbly Connect
Pabbly calls POST /pabbly/reply with the customer message; Yonderly returns the AI reply.
Configure WhatsApp send/receive in Pabbly Connect — not in this app.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import anthropic
import requests
from dotenv import load_dotenv
from flask import jsonify, request

from utils.security import sanitize_text

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "business_profile.json"
LOG_PATH = BASE_DIR / "whatsapp_log.json"
CLAUDE_MODEL = "claude-sonnet-4-20250514"

try:
    from supabase_client import from_env as supabase_from_env
except Exception:
    supabase_from_env = None


def load_business_profile():
    if not PROFILE_PATH.exists():
        return None
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_whatsapp_log():
    if LOG_PATH.exists():
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_whatsapp_log(log):
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)


def build_system_prompt(profile):
    business_name = profile["business_name"]
    business_profile = json.dumps(profile, indent=2)

    return (
        f"You are an AI employee for {business_name}. "
        f"Your job is to reply to customer WhatsApp messages on their behalf. "
        f"Use only the information in the business profile below to answer. "
        f"Never invent prices, services, or facts. "
        f"Match the tone specified. "
        f"Keep replies concise for WhatsApp (2-3 short paragraphs max). "
        f"Always sign off as 'The {business_name} Team, powered by Yonderly'. "
        f"Business profile: {business_profile}"
    )


def generate_reply(client, profile, customer_message):
    system_prompt = build_system_prompt(profile)
    user_message = (
        f"Reply to this customer WhatsApp message. "
        f"Write only the message body — no labels or prefixes.\n\n"
        f"{customer_message}"
    )

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text.strip()


def extract_message_fields(data):
    """Accept flexible JSON keys from Pabbly Connect HTTP steps."""
    if not isinstance(data, dict):
        return "unknown", ""

    message = (
        data.get("message")
        or data.get("body")
        or data.get("text")
        or data.get("customer_message")
        or data.get("Message")
        or data.get("Body")
        or ""
    )
    if isinstance(message, dict):
        message = message.get("body") or message.get("text") or ""

    customer = (
        data.get("from")
        or data.get("customer_phone")
        or data.get("customer_number")
        or data.get("phone")
        or data.get("sender")
        or data.get("From")
        or "unknown"
    )

    return str(customer).strip(), str(message).strip()


def log_conversation(customer_number, customer_message, yonderly_reply):
    timestamp = datetime.now(timezone.utc).isoformat()
    entry = {
        "timestamp": timestamp,
        "customer_number": customer_number,
        "customer_message": customer_message,
        "yonderly_reply": yonderly_reply,
    }

    log = load_whatsapp_log()
    log.append(entry)
    save_whatsapp_log(log)

    if supabase_from_env:
        try:
            client = supabase_from_env()
            client.insert("whatsapp_messages", {
                "timestamp": timestamp,
                "customer_number": customer_number,
                "customer_message": customer_message,
                "yonderly_reply": yonderly_reply,
                "source": "pabbly_connect",
            })
        except Exception as e:
            print("Supabase log failed:", e)


def notify_pabbly(customer_number, customer_message, reply):
    """Optional: POST result to your Pabbly Connect webhook listener."""
    url = os.environ.get("PABBLY_WEBHOOK_URL", "").strip()
    if not url:
        return

    try:
        requests.post(
            url,
            json={
                "customer_number": customer_number,
                "customer_message": customer_message,
                "reply": reply,
                "business_name": (load_business_profile() or {}).get("business_name", "Test Salon"),
            },
            timeout=15,
        )
    except Exception as e:
        print(f"Pabbly notify failed: {e}")


def handle_incoming_message(from_number, body):
    """Process a customer message and return the AI reply text."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return "Yonderly is not configured yet. Please add your Anthropic API key."

    body, ok = sanitize_text(body, max_length=2000)
    if not ok:
        return "Message too long."

    profile = load_business_profile()
    if not profile:
        return "Yonderly is not set up yet. Please complete the business onboarding form."

    client = anthropic.Anthropic(api_key=api_key)
    reply = generate_reply(client, profile, body)
    log_conversation(from_number, body, reply)
    return reply


def check_pabbly_auth():
    """Optional shared secret if PABBLY_WEBHOOK_SECRET is set."""
    secret = os.environ.get("PABBLY_WEBHOOK_SECRET", "").strip()
    if not secret:
        return True
    provided = request.headers.get("X-Pabbly-Secret") or request.args.get("secret", "")
    return provided == secret


def register_whatsapp_routes(app):
    """Register Pabbly Connect endpoints (kept name for app.py compatibility)."""

    @app.route("/pabbly/reply", methods=["POST"])
    @app.route("/api/pabbly", methods=["POST"])
    def pabbly_reply():
        if not check_pabbly_auth():
            return jsonify({"error": "Unauthorized"}), 401

        data = request.get_json(silent=True) or {}
        customer_number, message = extract_message_fields(data)

        if not message:
            return jsonify({"error": "Missing customer message (use message, body, or text)"}), 400

        try:
            reply = handle_incoming_message(customer_number, message)
            profile = load_business_profile() or {}
            notify_pabbly(customer_number, message, reply)
            return jsonify({
                "reply": reply,
                "business_name": profile.get("business_name", "Test Salon"),
                "customer_number": customer_number,
            })
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/pabbly/health", methods=["GET"])
    def pabbly_health():
        return jsonify({"status": "ok", "service": "yonderly-pabbly"})


def register_pabbly_routes(app):
    """Alias for clarity in new code."""
    register_whatsapp_routes(app)


def main():
    from flask import Flask

    app = Flask(__name__)
    register_whatsapp_routes(app)

    port = int(os.environ.get("WHATSAPP_PORT", 5001))

    print("=" * 50)
    print("  Yonderly — Pabbly Connect AI Reply API")
    print("=" * 50)
    print(f"\n  POST http://127.0.0.1:{port}/pabbly/reply")
    print("  Use this URL in Pabbly Connect → Webhooks → API / HTTP Request\n")
    print(f"  Listening on port {port}")
    print("  Press Ctrl+C to stop\n")

    app.run(debug=True, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
