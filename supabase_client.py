"""
Minimal Supabase client helper (no external dependency)
Uses the Supabase REST API via requests and env vars:
  SUPABASE_URL (https://xxxx.supabase.co)
  SUPABASE_KEY (service_role or anon key)

This is intentionally lightweight so it works in the existing Python stack
without adding another third-party package.
"""

import os
import json
import requests
from typing import Any, Dict, Optional

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


class SupabaseClient:
    def __init__(self, url: str = SUPABASE_URL, key: str = SUPABASE_KEY):
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
        self.url = url
        self.key = key
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    def insert(self, table: str, row: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.url}/rest/v1/{table}"
        resp = requests.post(url, headers={**self.headers, "Prefer": "return=representation"}, data=json.dumps(row))
        resp.raise_for_status()
        return resp.json()

    def select(self, table: str, params: Optional[str] = None) -> Any:
        q = f"{self.url}/rest/v1/{table}"
        if params:
            q = f"{q}?{params}"
        resp = requests.get(q, headers=self.headers)
        resp.raise_for_status()
        return resp.json()


def from_env() -> SupabaseClient:
    return SupabaseClient()
