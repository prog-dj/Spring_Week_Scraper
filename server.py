from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from datetime import date, datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

ROOT = Path(__file__).parent
DB_PATH = Path(os.getenv("SPRINGBOARD_DB", ROOT / "springboard.db"))
PORT = int(os.getenv("SPRINGBOARD_PORT", "4173"))
REFRESH_HOURS = float(os.getenv("SPRINGBOARD_REFRESH_HOURS", "6"))
SERPER_URL = "https://google.serper.dev/search"
SEARCH_QUERIES = [
    "UK spring week applications",
    "UK spring insight programme applications",
    "UK insight week students applications",
    "UK first year insight programme applications",
]
USER_AGENT = "SpringboardOpportunityResearch/2.0 (+local student careers tool)"
REQUEST_TIMEOUT = 15
db_lock = threading.Lock()
refresh_lock = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with db_lock, db_connect() as connection:
        connection.executescript("""
        CREATE TABLE IF NOT EXISTS opportunities (
            id TEXT PRIMARY KEY, company TEXT NOT NULL, programme TEXT NOT NULL,
            sector TEXT, location TEXT, opportunity_url TEXT NOT NULL UNIQUE,
            source_url TEXT NOT NULL, discovered_via TEXT NOT NULL, deadline TEXT,
            programme_dates TEXT, status TEXT NOT NULL, confidence TEXT NOT NULL,
            evidence TEXT, acceptance_rate TEXT, perks TEXT, http_status INTEGER,
            checked_at TEXT NOT NULL, last_error TEXT, logo TEXT, logo_class TEXT,
            opportunity_type TEXT
        );
        CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id TEXT NOT NULL,
            status TEXT NOT NULL, evidence TEXT, observed_at TEXT NOT NULL,
            FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
        );
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL,
            finished_at TEXT, query_count INTEGER NOT NULL,
            result_count INTEGER NOT NULL DEFAULT 0, verified_count INTEGER NOT NULL DEFAULT 0,
            error TEXT
        );
        """)


def stable_id(url: str) -> str:
    parsed = urlparse(url)._replace(query="", fragment="")
    return re.sub(r"[^a-z0-9]+", "-", parsed.geturl().lower()).strip("-")[-80:]


def canonical_url(value: str) -> str | None:
    if not value or not value.startswith(("http://", "https://")):
        return None
    parsed = urlparse(value)
    if not parsed.netloc:
        return None
    return parsed._replace(fragment="", query="").geturl().rstrip("/")


def clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for element in soup(["script", "style", "noscript", "svg"]):
        element.decompose()
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()


def is_opportunity_candidate(result: dict) -> bool:
    haystack = f"{result.get('title', '')} {result.get('snippet', '')}".lower()
    terms = ("spring week", "spring insight", "insight week", "insight programme", "insight program", "first year programme", "first-year programme")
    excluded = ("reddit.com", "targetjobs.co.uk", "brightnetwork.co.uk", "higherin.com", "e4s.co.uk", "fe.training", "tracker", "calendar", "guide", "what is", "how do you get", "complete guide", "free resources")
    link = result.get("link", "").lower()
    return any(term in haystack for term in terms) and not any(term in f"{link} {haystack}" for term in excluded)


def search_serper() -> list[dict]:
    api_key = os.getenv("SERPER_API_KEY")
    if not api_key:
        raise RuntimeError("SERPER_API_KEY is not configured")
    candidates: dict[str, dict] = {}
    for query in SEARCH_QUERIES:
        response = requests.post(SERPER_URL, headers={"X-API-KEY": api_key, "Content-Type": "application/json"}, json={"q": query, "gl": "uk", "hl": "en", "num": 20}, timeout=REQUEST_TIMEOUT)
        if not response.ok:
            detail = response.text[:500].replace("\n", " ")
            raise RuntimeError(f"Serper HTTP {response.status_code}: {detail}")
        for result in response.json().get("organic", []):
            url = canonical_url(result.get("link", ""))
            if url and is_opportunity_candidate(result):
                candidates.setdefault(url, {"url": url, "title": result.get("title", ""), "snippet": result.get("snippet", ""), "discovered_via": "Serper.dev"})
    return list(candidates.values())


def extract_company(title: str, url: str) -> str:
    host = urlparse(url).netloc.lower()
    known_domains = {
        "jpmorganchase.com": "J.P. Morgan", "blackrock.com": "BlackRock",
        "fidelityinternational.com": "Fidelity International", "ubs.com": "UBS",
        "pgcareers.com": "Procter & Gamble", "pwc.co.uk": "PwC",
        "cmsemergingtalent.com": "CMS", "goldmansachs.com": "Goldman Sachs",
    }
    for domain, company in known_domains.items():
        if host == domain or host.endswith(f".{domain}"):
            return company
    cleaned = re.sub(r"\s*[-|:–—].*$", "", title).strip()
    if cleaned and not any(term in cleaned.lower() for term in ("spring", "insight", "programme", "program", "week")):
        return cleaned
    return host.removeprefix("www.").split(".")[0].replace("-", " ").title()


def extract_programme(title: str, snippet: str) -> str:
    return (title.strip() or snippet.strip() or "Insight opportunity")[:160]


def infer_sector(text: str) -> str:
    lowered = text.lower()
    for term, sector in (("law", "Law"), ("consult", "Consulting"), ("technology", "Technology"), ("asset management", "Asset Management"), ("investment bank", "Investment Banking"), ("banking", "Investment Banking")):
        if term in lowered:
            return sector
    return "Other"


def infer_location(text: str) -> str | None:
    locations = ("London", "Edinburgh", "Manchester", "Birmingham", "Bristol", "Leeds", "UK", "United Kingdom")
    found = [location for location in locations if re.search(rf"\b{re.escape(location)}\b", text, re.I)]
    return ", ".join(dict.fromkeys(found)) or None


def extract_acceptance_rate(text: str) -> str | None:
    match = re.search(r"(?:acceptance rate|accept rate|offer rate)[^%]{0,80}?\b(\d{1,3})\s*%", text, re.I)
    return f"{match.group(1)}%" if match else None


def extract_perks(text: str) -> str | None:
    match = re.search(r"(?:what you(?:'|’)ll gain|you will gain|benefits|programme includes)[:\s]+(.{0,220}?)(?:deadline|eligibility|apply|application|location)", text, re.I)
    return re.sub(r"\s+", " ", match.group(1)).strip(" .:-") if match else None


def extract_deadline(text: str) -> str | None:
    pattern = r"(?:deadline|closing date|applications close|apply by|closes)[^.!?]{0,100}?\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,\s]+20\d{2}|20\d{2}-\d{2}-\d{2})\b"
    match = re.search(pattern, text, re.I)
    if not match:
        return None
    raw = match.group(1)
    try:
        parsed = datetime.strptime(raw, "%Y-%m-%d") if "-" in raw else datetime.strptime(re.sub(r"Sept?", "Sep", raw, flags=re.I), "%d %b %Y")
        return parsed.strftime("%Y-%m-%d")
    except ValueError:
        return None


def extract_programme_dates(text: str) -> str | None:
    match = re.search(r"(?:takes place|held|event dates?|programme dates?)[^.!?]{0,50}?((?:\d{1,2}\s+\w+|\w+\s+\d{1,2})[^.!?]{0,50}?20\d{2})", text, re.I)
    return match.group(1).strip() if match else None


def classify_status(text: str, deadline: str | None, programme_dates: str | None) -> tuple[str, str, str]:
    lowered = text.lower()
    if any(term in lowered for term in ("applications closed", "no longer accepting", "position has been filled", "role has closed")):
        return "closed", "Page explicitly says applications are closed", "high"
    if deadline:
        if datetime.strptime(deadline, "%Y-%m-%d").date() < date.today():
            return "closed", f"Published deadline {deadline} has passed", "high"
        return "open", f"Published deadline: {deadline}", "high"
    if any(term in lowered for term in ("applications open soon", "opening soon", "will open", "coming soon")):
        return "upcoming", "Page says applications will open soon", "medium"
    if any(term in lowered for term in ("apply now", "applications are open", "open for applications", "submit application")):
        return "open", "Page contains an active application instruction", "medium"
    if programme_dates:
        return "upcoming", f"Programme date found: {programme_dates}", "low"
    return "unknown", "No reliable application status evidence found", "low"


def sector_logo_class(sector: str) -> str:
    return {"Consulting": "coral", "Technology": "green", "Law": "purple", "Asset Management": "blue"}.get(sector, "")


def render_with_playwright(url: str) -> str | None:
    if sync_playwright is None:
        return None
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page(user_agent=USER_AGENT)
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            return re.sub(r"\s+", " ", page.locator("body").inner_text(timeout=10_000)).strip()
        finally:
            browser.close()


def verify_candidate(candidate: dict) -> dict:
    checked_at = utc_now()
    base = {"id": stable_id(candidate["url"]), "company": extract_company(candidate.get("title", ""), candidate["url"]), "programme": extract_programme(candidate.get("title", ""), candidate.get("snippet", "")), "sector": infer_sector(candidate.get("title", "")), "location": None, "opportunity_url": candidate["url"], "source_url": candidate["url"], "discovered_via": candidate["discovered_via"], "deadline": None, "programme_dates": None, "status": "unknown", "confidence": "low", "evidence": "Source could not be verified", "acceptance_rate": None, "perks": None, "http_status": None, "checked_at": checked_at, "last_error": None, "logo": "?", "logo_class": "", "opportunity_type": "Insight programme"}
    try:
        response = requests.get(candidate["url"], headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
        base["http_status"] = response.status_code
        text = clean_text(response.text) if response.status_code < 400 else ""
        rendered_text = None
        if response.status_code >= 400 or len(text) < 300:
            rendered_text = render_with_playwright(candidate["url"])
            text = rendered_text or ""
        if len(text) < 100:
            raise RuntimeError(f"verification returned too little page text (HTTP {response.status_code})")
        deadline = extract_deadline(text)
        programme_dates = extract_programme_dates(text)
        status, evidence, confidence = classify_status(text, deadline, programme_dates)
        base.update({"company": extract_company(candidate.get("title", ""), candidate["url"]), "programme": extract_programme(candidate.get("title", ""), candidate.get("snippet", "")), "sector": infer_sector(f"{candidate.get('title', '')} {text}"), "location": infer_location(text), "deadline": deadline, "programme_dates": programme_dates, "status": status, "confidence": confidence, "evidence": evidence, "acceptance_rate": extract_acceptance_rate(text), "perks": extract_perks(text), "logo": extract_company(candidate.get("title", ""), candidate["url"])[:3].upper(), "logo_class": sector_logo_class(infer_sector(candidate.get("title", "")))})
        if response.status_code >= 400 and rendered_text is None:
            base.update({"status": "unknown", "confidence": "low", "evidence": f"Source returned HTTP {response.status_code}; page could not be verified"})
    except Exception as error:
        base["last_error"] = str(error)
    return base


def upsert_opportunity(item: dict) -> None:
    with db_lock, db_connect() as connection:
        old = connection.execute("SELECT status FROM opportunities WHERE id = ?", (item["id"],)).fetchone()
        connection.execute("""INSERT INTO opportunities (id, company, programme, sector, location, opportunity_url, source_url, discovered_via, deadline, programme_dates, status, confidence, evidence, acceptance_rate, perks, http_status, checked_at, last_error, logo, logo_class, opportunity_type)
            VALUES (:id, :company, :programme, :sector, :location, :opportunity_url, :source_url, :discovered_via, :deadline, :programme_dates, :status, :confidence, :evidence, :acceptance_rate, :perks, :http_status, :checked_at, :last_error, :logo, :logo_class, :opportunity_type)
            ON CONFLICT(id) DO UPDATE SET company=excluded.company, programme=excluded.programme, sector=excluded.sector, location=excluded.location, deadline=excluded.deadline, programme_dates=excluded.programme_dates, status=excluded.status, confidence=excluded.confidence, evidence=excluded.evidence, acceptance_rate=excluded.acceptance_rate, perks=excluded.perks, http_status=excluded.http_status, checked_at=excluded.checked_at, last_error=excluded.last_error, logo=excluded.logo, logo_class=excluded.logo_class, opportunity_type=excluded.opportunity_type""", item)
        if old is None or old["status"] != item["status"]:
            connection.execute("INSERT INTO status_history (opportunity_id, status, evidence, observed_at) VALUES (?, ?, ?, ?)", (item["id"], item["status"], item["evidence"], item["checked_at"]))


def discover_and_refresh() -> dict:
    if not refresh_lock.acquire(blocking=False):
        return {"status": "already_running"}
    started = utc_now()
    try:
        candidates = search_serper()
        verified = [verify_candidate(candidate) for candidate in candidates]
        for item in verified:
            upsert_opportunity(item)
        with db_lock, db_connect() as connection:
            current_ids = [item["id"] for item in verified]
            if current_ids:
                placeholders = ",".join("?" for _ in current_ids)
                connection.execute(f"DELETE FROM opportunities WHERE id NOT IN ({placeholders})", current_ids)
            else:
                connection.execute("DELETE FROM opportunities")
            connection.execute("INSERT INTO discovery_runs (started_at, finished_at, query_count, result_count, verified_count) VALUES (?, ?, ?, ?, ?)", (started, utc_now(), len(SEARCH_QUERIES), len(candidates), len(verified)))
        return {"status": "complete", "candidates": len(candidates), "verified": len(verified), "checkedAt": utc_now()}
    except Exception as error:
        with db_lock, db_connect() as connection:
            connection.execute("INSERT INTO discovery_runs (started_at, finished_at, query_count, error) VALUES (?, ?, ?, ?)", (started, utc_now(), len(SEARCH_QUERIES), str(error)))
        return {"status": "error", "error": str(error), "checkedAt": utc_now()}
    finally:
        refresh_lock.release()


def stored_opportunities() -> list[dict]:
    with db_lock, db_connect() as connection:
        rows = connection.execute("SELECT * FROM opportunities ORDER BY CASE status WHEN 'open' THEN 1 WHEN 'upcoming' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END, deadline IS NULL, deadline").fetchall()
    opportunities = []
    for row in rows:
        item = dict(row)
        item.update({
            "firm": item["company"], "role": item["programme"], "url": item["source_url"],
            "source": item["evidence"] or item["source_url"], "rate": item["acceptance_rate"],
            "logoClass": item["logo_class"], "type": item["opportunity_type"],
        })
        opportunities.append(item)
    return opportunities


def scheduler() -> None:
    while True:
        if os.getenv("SERPER_API_KEY"):
            discover_and_refresh()
        time.sleep(max(300, REFRESH_HOURS * 3600))


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "service": "springboard-api", "serperConfigured": bool(os.getenv("SERPER_API_KEY")), "playwrightAvailable": sync_playwright is not None})
        elif path == "/api/opportunities":
            self.send_json({"opportunities": stored_opportunities(), "checkedAt": utc_now(), "source": "sqlite"})
        elif path in {"/api/discover", "/api/opportunities/refresh"}:
            self.send_json(discover_and_refresh())
        elif path == "/api/history":
            with db_lock, db_connect() as connection:
                rows = connection.execute("SELECT * FROM status_history ORDER BY observed_at DESC LIMIT 200").fetchall()
            self.send_json({"history": [dict(row) for row in rows]})
        else:
            super().do_GET()

    def send_json(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    init_db()
    threading.Thread(target=scheduler, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), AppHandler)
    print(f"Springboard running at http://127.0.0.1:{PORT}")
    server.serve_forever()
