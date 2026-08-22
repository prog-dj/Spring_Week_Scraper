from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from auth.decorators import login_required
from models.opportunities import opportunity_exists
from models.workspace import get_workspace, save_workspace

bp = Blueprint("workspace", __name__, url_prefix="/api/workspace")


@bp.route("", methods=["GET"])
@login_required
def get():
    opportunity_id = request.args.get("opportunity_id")
    if not opportunity_id:
        return jsonify({"error": "opportunity_id is required"}), 400
    return jsonify({"workspace": get_workspace(g.user["id"], opportunity_id)})


@bp.route("", methods=["POST"])
@login_required
def post():
    body = request.get_json(force=True, silent=True) or {}
    opportunity_id = body.pop("opportunity_id", None)
    if not opportunity_id:
        return jsonify({"error": "opportunity_id is required"}), 400
    if not opportunity_exists(opportunity_id):
        return jsonify({"error": "unknown opportunity_id"}), 400
    return jsonify({"workspace": save_workspace(g.user["id"], opportunity_id, body)})
