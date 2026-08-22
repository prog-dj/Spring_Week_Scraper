from __future__ import annotations

from functools import wraps

from flask import g, jsonify, session

from models.users import get_user_by_id


def load_current_user() -> None:
    """Registered as a Flask before_request hook -- populates flask.g.user for every
    request so route handlers don't each have to look it up."""
    user_id = session.get("user_id")
    g.user = get_user_by_id(user_id) if user_id else None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.get("user") is None:
            return jsonify({"error": "authentication required"}), 401
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = g.get("user")
        if user is None:
            return jsonify({"error": "authentication required"}), 401
        if not user["is_admin"]:
            return jsonify({"error": "admin access required"}), 403
        return view(*args, **kwargs)

    return wrapped
