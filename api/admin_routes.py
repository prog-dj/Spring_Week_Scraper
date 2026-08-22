"""The scraper trigger endpoints. Each run costs real money (Serper API calls) and
spins up Playwright browsers against many employer sites, so these must never be
publicly triggerable -- admin-only, gated by @admin_required. The background
scheduler (scraping.discovery.scheduler) calls discover_and_refresh() directly
in-process on a timer and never goes through HTTP, so it needs no separate
carve-out here."""
from __future__ import annotations

from flask import Blueprint, jsonify

from auth.decorators import admin_required
from scraping.discovery import discover_and_refresh

bp = Blueprint("admin", __name__, url_prefix="/api")


@bp.route("/discover")
@admin_required
def discover():
    return jsonify(discover_and_refresh())


@bp.route("/opportunities/refresh")
@admin_required
def refresh():
    return jsonify(discover_and_refresh())
