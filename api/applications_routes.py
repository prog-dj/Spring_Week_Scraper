from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from auth.decorators import login_required
from models.applications import delete_application, list_applications, upsert_application
from models.opportunities import opportunity_exists

bp = Blueprint("applications", __name__, url_prefix="/api/applications")


@bp.route("", methods=["GET"])
@login_required
def get():
    return jsonify({"applications": list_applications(g.user["id"])})


@bp.route("", methods=["POST"])
@login_required
def post():
    body = request.get_json(force=True, silent=True) or {}
    opportunity_id = body.get("opportunity_id")
    if not opportunity_id:
        return jsonify({"error": "opportunity_id is required"}), 400
    if not opportunity_exists(opportunity_id):
        return jsonify({"error": "unknown opportunity_id"}), 400
    try:
        application = upsert_application(
            g.user["id"], opportunity_id,
            status=body.get("status", "Saved"),
            next_action=body.get("next_action"),
            progress=body.get("progress", 0),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify({"application": application})


@bp.route("/<opportunity_id>", methods=["DELETE"])
@login_required
def delete(opportunity_id: str):
    delete_application(g.user["id"], opportunity_id)
    return jsonify({"ok": True})
