import re
from typing import Tuple

import bleach

# Simple text sanitizer: strip HTML and limit length
def sanitize_text(value: str, max_length: int = 1000) -> Tuple[str, bool]:
    if value is None:
        return "", True
    s = str(value).strip()
    if len(s) > max_length:
        return s[:max_length], False
    # remove dangerous HTML/content
    cleaned = bleach.clean(s, tags=[], attributes={}, strip=True)
    return cleaned, True


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

def validate_email(value: str) -> bool:
    if not value:
        return False
    return bool(EMAIL_RE.match(value))


ORDER_ID_RE = re.compile(r"^[A-Za-z0-9-_]{1,128}$")

def validate_order_id(value: str) -> bool:
    if not value:
        return False
    return bool(ORDER_ID_RE.match(value))


PHONE_RE = re.compile(r"^\+?[0-9\-\s]{7,20}$")

def validate_phone(value: str) -> bool:
    if not value:
        return False
    return bool(PHONE_RE.match(value))
