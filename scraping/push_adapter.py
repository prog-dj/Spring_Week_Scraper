"""Entry point for the GitHub Actions scraper workflow. Runs the exact same
candidate discovery / verification pipeline as the old discover_and_refresh()
(models.opportunities is never imported here -- those functions are D1-side
now, living in the Worker), then POSTs the results to the Worker's
/internal/ingest endpoint instead of writing to a local sqlite3 file.

The scraping logic itself (search_serper, search_seed_employers,
verify_candidates, dedupe_opportunities) is untouched, imported straight from
scraping.discovery -- only the persistence step differs from the original.
"""
from __future__ import annotations

import os
import sys

import requests

from scraping.constants import SEARCH_QUERIES, serper_api_key
from scraping.discovery import (
    dedupe_opportunities,
    load_seed_employers,
    search_seed_employers,
    search_serper,
    utc_now,
    verify_candidates,
)


def run() -> dict:
    worker_url = os.environ["SPRINGR_WORKER_URL"].rstrip("/")
    ingest_secret = os.environ["SPRINGR_INGEST_SECRET"]

    started = utc_now()
    try:
        candidates_by_url: dict[str, dict] = {}
        if serper_api_key():
            candidates_by_url = {c["url"]: c for c in search_serper()}
        seed_count = len(load_seed_employers())
        seed_candidates, seed_failures = search_seed_employers()
        for candidate in seed_candidates:
            candidates_by_url.setdefault(candidate["url"], candidate)
        candidates = list(candidates_by_url.values())
        verified = dedupe_opportunities(verify_candidates(candidates))

        payload = {
            "startedAt": started,
            "queryCount": len(SEARCH_QUERIES) + seed_count,
            "candidateCount": len(candidates),
            "verified": verified,
            "seedFailures": seed_failures,
        }
    except Exception as error:  # noqa: BLE001 -- top-level run, must always report
        payload = {
            "startedAt": started,
            "queryCount": len(SEARCH_QUERIES),
            "candidateCount": 0,
            "verified": [],
            "seedFailures": [],
            "error": str(error),
        }

    response = requests.post(
        f"{worker_url}/internal/ingest",
        json=payload,
        headers={"X-Ingest-Secret": ingest_secret},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


if __name__ == "__main__":
    result = run()
    print(result)
    if result.get("status") == "error_recorded":
        sys.exit(1)
