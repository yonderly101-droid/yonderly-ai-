"""
Yonderly — Email AI Agent
Checks Gmail for new unread emails every 5 minutes, generates replies with Claude,
sends them automatically, and logs all conversations.
"""

import base64
import json
import os
import re
import time
from datetime import datetime, timezone
from email.mime.text import MIMEText
from pathlib import Path

import anthropic
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Load environment variables from .env file
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROFILE_PATH = BASE_DIR / "business_profile.json"
LOG_PATH = BASE_DIR / "email_log.json"
PENDING_PATH = BASE_DIR / "pending_replies.json"
CREDENTIALS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

# Gmail permissions: read emails, send emails, mark as read
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
]

CHECK_INTERVAL_SECONDS = 5 * 60  # 5 minutes
CLAUDE_MODEL = "claude-sonnet-4-20250514"

NEWSLETTER_SENDER_PATTERNS = [
    "noreply",
    "no-reply",
    "donotreply",
    "notifications",
    "newsletter",
    "marketing",
    "mail.",
    "email.",
    "send.",
    "shopifyemail.com",
    "market.",
]

MARKETING_LOCAL_PARTS = ("info", "support", "welcome", "contact", "hello", "news", "updates")

KNOWN_PLATFORM_DOMAINS = [
    "mailchimp.com",
    "sendgrid.net",
    "constantcontact.com",
    "hubspot.com",
    "linkedin.com",
    "facebookmail.com",
    "shopify.com",
    "shopifyemail.com",
    "squarespace.com",
    "mailgun.org",
    "amazonses.com",
    "stripe.com",
    "paypal.com",
    "intercom.io",
    "zendesk.com",
    "google.com",
    "microsoft.com",
    "twitter.com",
    "instagram.com",
    "pinterest.com",
    "etsy.com",
    "vidiq.com",
    "replit.com",
    "supabase.com",
    "arcads.ai",
    "acquire.com",
    "shein.com",
    "getkong.ai",
]

SUBJECT_MARKETING_KEYWORDS = [
    "unsubscribe",
    "% off",
    "%off",
    "deal",
    "offer",
    "sale",
    "newsletter",
    "notification",
    "welcome to",
    "replay now",
    "just listed",
    "while you were away",
    "special",
    "delightful",
    "boost",
]

GMAIL_SKIP_LABELS = {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"}


def load_business_profile():
    """Load the business profile that powers the AI agent."""
    if not PROFILE_PATH.exists():
        raise FileNotFoundError(
            f"business_profile.json not found. "
            f"Run the onboarding form first: python app.py"
        )
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load_email_log():
    """Load existing conversation log, or start a fresh list."""
    if LOG_PATH.exists():
        with open(LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_email_log(log):
    """Save conversation log to JSON file."""
    with open(LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)


def get_gmail_service():
    """
    Connect to Gmail using OAuth2.
    On first run, opens a browser window for you to sign in and grant access.
    """
    creds = None

    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_PATH.exists():
                raise FileNotFoundError(
                    f"credentials.json not found in {BASE_DIR}.\n"
                    "Follow the README to download it from Google Cloud Console."
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(CREDENTIALS_PATH), SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PATH, "w", encoding="utf-8") as token_file:
            token_file.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def extract_email_address(header_value):
    """Pull an email address out of a header like 'John <john@example.com>'."""
    match = re.search(r"<([^>]+)>", header_value)
    if match:
        return match.group(1).lower()
    return header_value.strip().lower()


def extract_customer_name(header_value):
    """Pull a display name out of a header like 'John Doe <john@example.com>'."""
    match = re.search(r"^(.+?)\s*<", header_value)
    if match:
        name = match.group(1).strip().strip('"').strip("'")
        if name:
            return name
    address = extract_email_address(header_value)
    return address.split("@")[0] if "@" in address else "Unknown"


def decode_email_body(payload):
    """Extract plain-text content from a Gmail message payload."""
    body_text = ""

    if "parts" in payload:
        for part in payload["parts"]:
            mime_type = part.get("mimeType", "")
            if mime_type == "text/plain" and "data" in part.get("body", {}):
                body_text = base64.urlsafe_b64decode(
                    part["body"]["data"]
                ).decode("utf-8", errors="replace")
                break
            elif mime_type.startswith("multipart/"):
                nested = decode_email_body(part)
                if nested:
                    body_text = nested
                    break
    elif payload.get("mimeType") == "text/plain" and "data" in payload.get("body", {}):
        body_text = base64.urlsafe_b64decode(
            payload["body"]["data"]
        ).decode("utf-8", errors="replace")

    return body_text.strip()


def get_header(headers, name):
    """Get a specific header value from a list of Gmail headers."""
    for header in headers:
        if header["name"].lower() == name.lower():
            return header["value"]
    return ""


def is_known_platform_domain(domain):
    """Check if an email domain belongs to a known marketing/platform sender."""
    domain = domain.lower()
    return any(domain == platform or domain.endswith(f".{platform}") for platform in KNOWN_PLATFORM_DOMAINS)


def is_credit_error(error):
    """Return True if Claude rejected the request due to low API credits."""
    message = str(error).lower()
    return "credit balance" in message or "too low to access the anthropic api" in message


def is_newsletter_or_marketing(email):
    """
    Return True if the email looks like a newsletter or marketing message.
    Real customer emails pass through; automated/marketing emails are skipped.
    """
    sender_address = extract_email_address(email["from"])
    subject_lower = email["subject"].lower()

    skip_labels = set(email.get("label_ids", []))
    if skip_labels & GMAIL_SKIP_LABELS:
        return True

    for pattern in NEWSLETTER_SENDER_PATTERNS:
        if pattern in sender_address:
            return True

    if "@" in sender_address:
        local_part, domain = sender_address.split("@", 1)
        if is_known_platform_domain(domain):
            return True
        if local_part in MARKETING_LOCAL_PARTS and is_known_platform_domain(domain):
            return True
        if local_part in MARKETING_LOCAL_PARTS and any(
            marker in domain for marker in ("mail.", "email.", "send.", "market.")
        ):
            return True

    if email.get("list_unsubscribe"):
        return True

    for keyword in SUBJECT_MARKETING_KEYWORDS:
        if keyword in subject_lower:
            return True

    return False


def fetch_unread_emails(service):
    """Get all unread messages from the inbox."""
    result = service.users().messages().list(
        userId="me",
        labelIds=["INBOX", "UNREAD"],
        maxResults=20,
    ).execute()

    messages = result.get("messages", [])
    if not messages:
        return []

    emails = []
    for msg_ref in messages:
        msg = service.users().messages().get(
            userId="me",
            id=msg_ref["id"],
            format="full",
        ).execute()

        headers = msg["payload"].get("headers", [])
        emails.append({
            "id": msg["id"],
            "thread_id": msg["threadId"],
            "from": get_header(headers, "From"),
            "subject": get_header(headers, "Subject") or "(no subject)",
            "body": decode_email_body(msg["payload"]),
            "message_id": get_header(headers, "Message-ID"),
            "list_unsubscribe": get_header(headers, "List-Unsubscribe"),
            "label_ids": msg.get("labelIds", []),
        })

    return emails


def build_system_prompt(profile):
    """Build the system prompt sent to Claude for every email."""
    business_name = profile["business_name"]
    business_profile = json.dumps(profile, indent=2)

    return (
        f"You are an AI employee for {business_name}. "
        f"Your job is to reply to customer emails on their behalf. "
        f"Use only the information in the business profile below to answer. "
        f"Never invent prices, services, or facts. "
        f"Match the tone specified. "
        f"Always sign off as 'The {business_name} Team, powered by Yonderly'. "
        f"Business profile: {business_profile}"
    )


def build_user_message(subject, customer_message):
    """Build the user message with the customer's email content."""
    return (
        f"Reply to this customer email. Write only the email body — no subject line.\n\n"
        f"Subject: {subject}\n\n"
        f"{customer_message}"
    )


def generate_reply(client, profile, subject, customer_message):
    """Send the customer email to Claude and get a reply."""
    system_prompt = build_system_prompt(profile)
    user_message = build_user_message(subject, customer_message)

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )

    return response.content[0].text.strip()


def send_reply(service, original_email, reply_text, profile):
    """Send the AI-generated reply back to the customer via Gmail."""
    customer_address = extract_email_address(original_email["from"])
    subject = original_email["subject"]
    reply_subject = subject if subject.lower().startswith("re:") else f"Re: {subject}"

    message = MIMEText(reply_text)
    message["to"] = customer_address
    message["from"] = profile["contact_email"]
    message["subject"] = reply_subject

    if original_email.get("message_id"):
        message["In-Reply-To"] = original_email["message_id"]
        message["References"] = original_email["message_id"]

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

    service.users().messages().send(
        userId="me",
        body={"raw": raw, "threadId": original_email["thread_id"]},
    ).execute()


def mark_as_read(service, message_id):
    """Mark an email as read so it won't be processed again."""
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"removeLabelIds": ["UNREAD"]},
    ).execute()


def log_conversation(customer_name, customer_email, subject, customer_message, yonderly_reply):
    """Append a conversation entry to email_log.json."""
    log = load_email_log()
    log.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "customer_name": customer_name,
        "customer_email": customer_email,
        "subject": subject,
        "customer_message": customer_message,
        "yonderly_reply": yonderly_reply,
    })
    save_email_log(log)


def load_pending_replies():
    """Load pending replies saved when PREVIEW_MODE is enabled."""
    if PENDING_PATH.exists():
        with open(PENDING_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_pending_replies(pending):
    with open(PENDING_PATH, "w", encoding="utf-8") as f:
        json.dump(pending, f, indent=2, ensure_ascii=False)


def process_email(service, client, profile, email):
    """Handle a single unread email: generate reply, send it, log it, mark read."""
    customer_address = extract_email_address(email["from"])
    customer_name = extract_customer_name(email["from"])
    business_email = profile["contact_email"].lower()

    # Skip emails sent from the business's own address (avoid reply loops)
    if customer_address == business_email:
        print(f"  Skipping own email: {email['subject']}")
        mark_as_read(service, email["id"])
        return

    # Skip if there's no readable body
    if not email["body"]:
        print(f"  Skipping empty email from {customer_address}")
        mark_as_read(service, email["id"])
        return

    # Skip newsletters and marketing emails
    if is_newsletter_or_marketing(email):
        print(
            f"  [SKIPPED - Newsletter/Marketing] {customer_name} "
            f"({customer_address}): {email['subject']}"
        )
        mark_as_read(service, email["id"])
        return

    print(f"  Processing email from {customer_name} ({customer_address}): {email['subject']}")

    try:
        reply = generate_reply(client, profile, email["subject"], email["body"])
    except Exception as e:
        if is_credit_error(e):
            print(
                "  [PAUSED] Anthropic credits exhausted. "
                "Add credits at https://console.anthropic.com/settings/billing"
            )
            return "credit_error"
        raise

    # If preview mode is enabled, save the drafted reply instead of sending
    preview_mode = os.environ.get("PREVIEW_MODE", "false").lower() in ("1", "true", "yes")
    if preview_mode:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "customer_email": customer_address,
            "customer_name": customer_name,
            "subject": email["subject"],
            "customer_message": email["body"],
            "yonderly_reply": reply,
            # store original metadata so sending later can include references
            "from": email.get("from", ""),
            "message_id": email.get("message_id"),
            "thread_id": email.get("thread_id"),
        }

        pending = load_pending_replies()
        pending.append(entry)
        save_pending_replies(pending)

        # Mark read to avoid re-processing and notify operator
        mark_as_read(service, email["id"])
        print(f"Reply drafted for {customer_address} — approve it on the dashboard before sending")
        return

    # Normal automatic sending
    send_reply(service, email, reply, profile)
    mark_as_read(service, email["id"])
    log_conversation(
        customer_name, customer_address, email["subject"], email["body"], reply
    )

    print(f"  Reply sent to {customer_name} ({customer_address})")


def run_check(service, client, profile):
    """Run one check cycle: fetch unread emails and process each one."""
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Checking for new emails...")

    emails = fetch_unread_emails(service)

    if not emails:
        print("  No new unread emails.")
        return

    print(f"  Found {len(emails)} unread email(s).")
    for email in emails:
        try:
            result = process_email(service, client, profile, email)
            if result == "credit_error":
                break
        except Exception as e:
            if is_credit_error(e):
                print(
                    "  [PAUSED] Anthropic credits exhausted. "
                    "Add credits at https://console.anthropic.com/settings/billing"
                )
                break
            print(f"  Error processing email {email['id']}: {e}")


def main():
    """Start the email agent and check for new emails every 5 minutes."""
    print("=" * 50)
    print("  Yonderly Email AI Agent")
    print("=" * 50)

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY not found. "
            "Copy .env.example to .env and add your API key."
        )

    profile = load_business_profile()
    print(f"\n  Business: {profile['business_name']}")
    print(f"  Monitoring: {profile['contact_email']}")
    print(f"  Checking every {CHECK_INTERVAL_SECONDS // 60} minutes")
    print(f"  Press Ctrl+C to stop\n")

    client = anthropic.Anthropic(api_key=api_key)
    service = get_gmail_service()

    print("  Gmail connected successfully!\n")

    while True:
        try:
            run_check(service, client, profile)
        except Exception as e:
            print(f"  Check failed: {e}")

        print(f"  Next check in {CHECK_INTERVAL_SECONDS // 60} minutes...")
        time.sleep(CHECK_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
