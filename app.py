from __future__ import annotations

import os
import threading

from flask import Flask, g

from api import admin_routes, applications_routes, documents_routes, routes, saved_routes, workspace_routes
from auth import routes as auth_routes
from auth.decorators import load_current_user
from auth.google_oauth import init_oauth
from config import Config
from models.db import init_db
from scraping.discovery import scheduler

_scheduler_started = False
_scheduler_lock = threading.Lock()


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="")
    app.config.from_object(Config)
    Config.validate()

    init_db()
    init_oauth(app)

    app.register_blueprint(auth_routes.bp)
    app.register_blueprint(routes.bp)
    app.register_blueprint(admin_routes.bp)
    app.register_blueprint(workspace_routes.bp)
    app.register_blueprint(applications_routes.bp)
    app.register_blueprint(documents_routes.bp)
    app.register_blueprint(saved_routes.bp)

    app.before_request(load_current_user)

    @app.after_request
    def no_store(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.route("/")
    def index():
        return app.send_static_file("index.html")

    # The scheduler thread must start exactly once per deployment, not once per
    # gunicorn worker process (we run --workers 1 for SQLite's sake, so this mostly
    # guards against dev-server reloader double-invocation and repeated
    # create_app() calls in tests). RUN_SCHEDULER lets a specific deployed instance
    # opt in explicitly when multiple instances of the app exist.
    global _scheduler_started
    should_run_scheduler = os.getenv("RUN_SCHEDULER", "1") == "1"
    with _scheduler_lock:
        if should_run_scheduler and not _scheduler_started:
            threading.Thread(target=scheduler, daemon=True).start()
            _scheduler_started = True

    return app


if __name__ == "__main__":
    flask_app = create_app()
    print(f"Springr running at http://127.0.0.1:{Config.PORT}")
    flask_app.run(host="127.0.0.1", port=Config.PORT, debug=Config.ENV == "development")
