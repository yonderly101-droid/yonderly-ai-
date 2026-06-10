"""
Yonderly — WhatsApp AI
- Meta Cloud API: GET/POST /webhook (direct — no Pabbly needed)
- Pabbly Connect: POST /pabbly/reply (optional)
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
GRAPH_API = "https://graph.facebook.com/v21.0"

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


def log_conversation(customer_number, customer_message, yonderly_reply, source="whatsapp"):
    timestamp = datetime.now(timezone.utc).isoformat()
    entry = {
        "timestamp": timestamp,
        "customer_number": customer_number,
        "customer_message": customer_message,
        "yonderly_reply": yonderly_reply,
        "source": source,
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
                "source": source,
            })
        except Exception as e:
            print("Supabase log failed:", e)


def extract_meta_messages(payload):
    messages = []
    if not isinstance(payload, dict):
        return messages
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            for msg in value.get("messages") or []:
                if msg.get("type") != "text":
                    continue
                body = (msg.get("text") or {}).get("body") or ""
                sender = str(msg.get("from") or "").strip()
                if sender and body.strip():
                    messages.append({"from": sender, "body": body.strip()})
    return messages


def send_whatsapp_text(to_number, body):
    token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "").strip()
    phone_number_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    if not token or not phone_number_id:
        raise RuntimeError("WhatsApp send not configured")

    response = requests.post(
        f"{GRAPH_API}/{phone_number_id}/messages",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "text",
            "text": {"body": body},
        },
        timeout=30,
    )
    data = response.json()
    if not response.ok:
        raise RuntimeError(data.get("error", {}).get("message", "WhatsApp send failed"))
    return data


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


def handle_incoming_message(from_number, body, source="whatsapp"):
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
    log_conversation(from_number, body, reply, source=source)
    return reply


def check_pabbly_auth():
    """Optional shared secret if PABBLY_WEBHOOK_SECRET is set."""
    secret = os.environ.get("PABBLY_WEBHOOK_SECRET", "").strip()
    if not secret:
        return True
    provided = request.headers.get("X-Pabbly-Secret") or request.args.get("secret", "")
    return provided == secret


def register_whatsapp_routes(app):
    """Register WhatsApp endpoints (Meta direct + optional Pabbly)."""

    @app.route("/webhook", methods=["GET", "POST"])
    @app.route("/whatsapp", methods=["GET", "POST"])
    def meta_webhook():
        if request.method == "GET":
            mode = request.args.get("hub.mode")
            token = request.args.get("hub.verify_token")
            challenge = request.args.get("hub.challenge")
            expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "").strip()
            if mode == "subscribe" and token == expected and challenge:
                return challenge, 200, {"Content-Type": "text/plain"}
            return "Forbidden", 403

        payload = request.get_json(silent=True) or {}
        incoming = extract_meta_messages(payload)
        if not incoming:
            return jsonify({"status": "ok"}), 200

        errors = []
        for msg in incoming:
            try:
                reply = handle_incoming_message(
                    msg["from"], msg["body"], source="meta_cloud_api"
                )
                send_whatsapp_text(msg["from"], reply)
            except Exception as exc:
                errors.append(str(exc))
                try:
                    send_whatsapp_text(
                        msg["from"],
                        "Sorry, we could not process your message right now. Please try again shortly.",
                    )
                except Exception:
                    pass

        status = "partial" if errors else "ok"
        return jsonify({"status": status, "processed": len(incoming), "errors": errors or None}), 200

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
            reply = handle_incoming_message(
                customer_number, message, source="pabbly_connect"
            )
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
    print("  Yonderly — WhatsApp (Meta Cloud API + optional Pabbly)")
    print("=" * 50)
    print(f"\n  Meta webhook: http://127.0.0.1:{port}/webhook")
    print(f"  Pabbly reply: http://127.0.0.1:{port}/pabbly/reply\n")
    print(f"  Listening on port {port}")
    print("  Press Ctrl+C to stop\n")

    app.run(debug=True, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
