# Microsoft's official Playwright+Python image bundles Chromium and every OS-level
# dependency it needs (fonts, codecs, etc.) already installed and version-matched.
# Hand-installing Playwright's dependency list on a generic slim base is a common
# source of "works locally, breaks in the container" failures -- this avoids that.
# The tag version MUST match the `playwright` version pinned in requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Where the SQLite file lives. Mount a persistent volume at this path on your host
# (see DEPLOY.md) -- without one, all data is lost on every redeploy.
ENV SPRINGR_DB=/data/springr.db
RUN mkdir -p /data

EXPOSE 8080

# --workers 1: SQLite's file-locking does not tolerate multiple OS processes writing
# concurrently the way the app's in-process db_lock already tolerates multiple
# threads. --threads 8 keeps concurrent requests from blocking each other despite
# the single worker, matching the local dev server's threading behaviour.
CMD ["gunicorn", "--workers", "1", "--threads", "8", "--bind", "0.0.0.0:8080", "app:create_app()"]
