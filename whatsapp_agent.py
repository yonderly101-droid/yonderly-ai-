"""
Yonderly — WhatsApp AI Agent
Receives WhatsApp messages via Twilio webhook, generates replies with Claude,
sends them back on WhatsApp, and logs conversations to whatsapp_log.json.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from flask import request

# sanitization
from utils.security import sanitize_text, validate_phone

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "business_profile.json"
LOG_PATH = BASE_DIR / "whatsapp_log.json"
CLAUDE_MODEL = "claude-sonnet-4-20250514"


def is_whatsapp_configured():
    """Check whether Twilio WhatsApp credentials are set."""
    return all([
        os.environ.get("TWILIO_ACCOUNT_SID", "").strip(),
        os.environ.get("TWILIO_AUTH_TOKEN", "").strip(),
        os.environ.get("TWILIO_WHATSAPP_NUMBER", "").strip(),
    ])


def load_business_profile():
    """Load the business profile that powers the AI agent."""
    if not PROFILE_PATH.exists():
        return None
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_whatsapp_log():
    """Load existing WhatsApp conversation log."""
    if LOG_PATH.exists():
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_whatsapp_log(log):
    """Save WhatsApp conversation log to JSON file."""
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)


def build_system_prompt(profile):
    """Build the system prompt sent to Claude for every WhatsApp message."""
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
    """Send the customer message to Claude and get a reply."""
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


def send_whatsapp_message(to_number, message):
    """Send a WhatsApp message back to the customer via Twilio."""
    from twilio.rest import Client

    account_sid = os.environ["TWILIO_ACCOUNT_SID"]
    auth_token = os.environ["TWILIO_AUTH_TOKEN"]
    from_number = os.environ["TWILIO_WHATSAPP_NUMBER"]

    client = Client(account_sid, auth_token)
    client.messages.create(
        body=message,
        from_=from_number,
        to=to_number,
    )


def log_conversation(customer_number, customer_message, yonderly_reply):
    """Append a conversation entry to whatsapp_log.json."""
    log = load_whatsapp_log()
    log.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "customer_number": customer_number,
        "customer_message": customer_message,
        "yonderly_reply": yonderly_reply,
    })
    save_whatsapp_log(log)


def handle_incoming_message(from_number, body):
    """Process an incoming WhatsApp message and return the AI reply text."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return "Yonderly is not configured yet. Please add your Anthropic API key."

    # sanitize and validate inputs
    cleaned_number = (from_number or "").strip()
    if not validate_phone(cleaned_number):
        return "Invalid phone number."

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


def register_whatsapp_routes(app):
    """Register the /whatsapp webhook route on a Flask app."""

    @app.route("/whatsapp", methods=["POST"])
    def whatsapp_webhook():
        """Receive incoming WhatsApp messages from Twilio."""
        if not is_whatsapp_configured():
            print("WhatsApp not configured yet")
            return "", 200

        from_number = request.form.get("From", "")
        body = request.form.get("Body", "").strip()

        if not from_number or not body:
            return "", 200

        try:
            reply = handle_incoming_message(from_number, body)
            send_whatsapp_message(from_number, reply)
            print(f"  WhatsApp reply sent to {from_number}")
        except Exception as e:
            print(f"  WhatsApp error for {from_number}: {e}")

        return "", 200


def main():
    """Run the WhatsApp agent as a standalone webhook server."""
    from flask import Flask

    app = Flask(__name__)
    register_whatsapp_routes(app)

    port = int(os.environ.get("WHATSAPP_PORT", 5001))

    print("=" * 50)
    print("  Yonderly WhatsApp AI Agent")
    print("=" * 50)

    if not is_whatsapp_configured():
        print("\n  WhatsApp not configured yet")
        print("  Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and")
        print("  TWILIO_WHATSAPP_NUMBER to your .env file.\n")
    else:
        print("\n  Twilio WhatsApp configured")
        print(f"  Webhook: http://127.0.0.1:{port}/whatsapp")
        print("  Point your Twilio sandbox webhook to this URL.\n")

    print(f"  Listening on port {port}")
    print("  Press Ctrl+C to stop\n")

    app.run(debug=True, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
