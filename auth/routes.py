from __future__ import annotations

from flask import Blueprint, redirect, session, url_for

from auth.google_oauth import oauth
from models.users import get_or_create_user_from_google_profile

bp = Blueprint("auth", __name__, url_prefix="/auth")


@bp.route("/login")
def login():
    redirect_uri = url_for("auth.callback", _external=True)
    # code_challenge_method="S256" is what makes Authlib generate and track a PKCE
    # code_verifier/code_challenge pair for this flow, on top of the state param it
    # always generates for CSRF protection.
    return oauth.google.authorize_redirect(redirect_uri, code_challenge_method="S256")


@bp.route("/callback")
def callback():
    # authorize_access_token() validates the `state` param against what was stored in
    # the session at /login, exchanges the code (+ PKCE verifier) for tokens, and
    # verifies the ID token's signature/iss/aud/exp against Google's JWKS.
    token = oauth.google.authorize_access_token()
    profile = token.get("userinfo") or oauth.google.parse_id_token(token)
    user = get_or_create_user_from_google_profile(
        google_sub=profile["sub"],
        email=profile["email"],
        name=profile.get("name"),
        avatar_url=profile.get("picture"),
    )
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    return redirect("/")


@bp.route("/logout")
def logout():
    session.clear()
    return redirect("/")
