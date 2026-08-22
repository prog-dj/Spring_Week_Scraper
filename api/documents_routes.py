"""Metadata only -- file bytes stay client-side (IndexedDB) for now. See
models/documents.py docstring for why server-side file storage is deferred scope."""
from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from auth.decorators import login_required
from models.documents import create_document, delete_document, list_documents

bp = Blueprint("documents", __name__, url_prefix="/api/documents")


@bp.route("", methods=["GET"])
@login_required
def get():
    return jsonify({"documents": list_documents(g.user["id"])})


@bp.route("", methods=["POST"])
@login_required
def post():
    body = request.get_json(force=True, silent=True) or {}
    name = body.get("name")
    doc_type = body.get("doc_type")
    if not name or not doc_type:
        return jsonify({"error": "name and doc_type are required"}), 400
    document = create_document(g.user["id"], name, doc_type, body.get("size_bytes"), body.get("status"))
    return jsonify({"document": document})


@bp.route("/<int:document_id>", methods=["DELETE"])
@login_required
def delete(document_id: int):
    delete_document(g.user["id"], document_id)
    return jsonify({"ok": True})
