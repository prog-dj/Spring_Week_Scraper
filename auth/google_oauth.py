"""Google OAuth 2.0 client registration via Authlib. Authlib handles PKCE, the CSRF
`state` parameter, and ID-token verification (signature against Google's published
JWKS, `iss`/`aud`/`exp` checks) internally -- none of that is hand-rolled here."""
from __future__ import annotations

from authlib.integrations.flask_client import OAuth

oauth = OAuth()


def init_oauth(app) -> None:
    oauth.init_app(app)
    oauth.register(
        name="google",
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        client_kwargs={"scope": "openid email profile"},
    )
