from __future__ import annotations

import os

from dotenv import load_dotenv

from scraping.constants import ROOT

load_dotenv(ROOT / ".env")


class Config:
    ENV = os.getenv("FLASK_ENV", "production")
    IS_PRODUCTION = ENV != "development"

    SECRET_KEY = os.getenv("FLASK_SECRET_KEY")

    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

    PORT = int(os.getenv("SPRINGR_PORT", "4173"))

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Only require HTTPS-only cookies in production -- local dev runs over plain
    # http://127.0.0.1, and a Secure cookie would silently never be sent there.
    SESSION_COOKIE_SECURE = IS_PRODUCTION
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 30  # 30 days

    @classmethod
    def validate(cls) -> None:
        """Fail fast at boot rather than silently running with an insecure or
        non-functional configuration."""
        missing = []
        if not cls.SECRET_KEY:
            missing.append("FLASK_SECRET_KEY")
        if not cls.GOOGLE_CLIENT_ID:
            missing.append("GOOGLE_CLIENT_ID")
        if not cls.GOOGLE_CLIENT_SECRET:
            missing.append("GOOGLE_CLIENT_SECRET")
        if missing:
            raise RuntimeError(
                f"Missing required environment variable(s): {', '.join(missing)}. "
                "See .env.example / DEPLOY.md for how to obtain and set these."
            )
