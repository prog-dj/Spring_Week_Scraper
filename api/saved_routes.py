from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from auth.decorators import login_required
from models.opportunities import opportunity_exists
from models.saved import add_saved, list_saved, remove_saved

bp = Blueprint("saved", __name__, url_prefix="/api/saved")


@bp.route("", methods=["GET"])
@login_required
def get():
    return jsonify({"saved": list_saved(g.user["id"])})


@bp.route("", methods=["POST"])
@login_required
def post():
    body = request.get_json(force=True, silent=True) or {}
    opportunity_id = body.get("opportunity_id")
    if not opportunity_id:
        return jsonify({"error": "opportunity_id is required"}), 400
    if not opportunity_exists(opportunity_id):
        return jsonify({"error": "unknown opportunity_id"}), 400
    add_saved(g.user["id"], opportunity_id)
    return jsonify({"ok": True})


@bp.route("/<opportunity_id>", methods=["DELETE"])
@login_required
def delete(opportunity_id: str):
    remove_saved(g.user["id"], opportunity_id)
    return jsonify({"ok": True})
