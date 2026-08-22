"""Public, read-only endpoints -- no login required. These mirror the original
stdlib-server API exactly so the existing frontend keeps working unchanged."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from models.opportunities import (
    seed_failure_rows,
    status_history,
    stored_opportunities,
    utc_now,
)
from scraping.constants import serper_api_key
from scraping.discovery import load_seed_employers
from scraping.playwright_render import sync_playwright

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/health")
def health():
    return jsonify({
        "ok": True,
        "service": "springr-api",
        "serperConfigured": bool(serper_api_key()),
        "playwrightAvailable": sync_playwright is not None,
        "seedEmployerCount": len(load_seed_employers()),
    })


@bp.route("/session")
def session_info():
    user = g.get("user")
    if not user:
        return jsonify({"authenticated": False})
    return jsonify({
        "authenticated": True,
        "name": user["name"],
        "email": user["email"],
        "avatarUrl": user["avatar_url"],
        "isAdmin": bool(user["is_admin"]),
    })


@bp.route("/opportunities")
def opportunities():
    return jsonify({"opportunities": stored_opportunities(), "checkedAt": utc_now(), "source": "sqlite"})


@bp.route("/history")
def history():
    return jsonify({"history": status_history(request.args.get("opportunity_id"))})


@bp.route("/seed-health")
def seed_health():
    return jsonify({"seedEmployerCount": len(load_seed_employers()), "failures": seed_failure_rows()})
