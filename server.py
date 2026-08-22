from __future__ import annotations

import json
import os
import re
import smtplib
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from email.message import EmailMessage
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin, urlparse

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
    "UK early careers insight programme applications",
    "UK student insight event applications",
    "UK technology law engineering spring insight applications",
    "UK first year trading programme applications",
    "UK FTTP student trading programme",
    "UK freshman insight trading programme applications",
    "UK first year insight programme applications",
    "UK first year internship applications",
    "UK student programme first year applications",
]
USER_AGENT = "SpringboardOpportunityResearch/2.0 (+local student careers tool)"
REQUEST_TIMEOUT = 15
SOURCES_PATH = ROOT / "sources.json"
SEED_LINKS_PER_EMPLOYER = 5
OPPORTUNITY_TERMS = (
    "spring week", "spring insight", "insight week", "insight programme", "insight program",
    "first year programme", "first-year programme", "first year program", "first-year program",
    "first year insight", "first-year insight", "first year internship", "first-year internship",
    "first year trading", "first-year trading", "freshman insight", "fttp",
)
db_lock = threading.Lock()
refresh_lock = threading.Lock()


def load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


load_dotenv()


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
            evidence TEXT, http_status INTEGER,
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
        CREATE TABLE IF NOT EXISTS application_workspaces (
            opportunity_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
        );
        CREATE TABLE IF NOT EXISTS seed_failures (
            id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL,
            careers_url TEXT NOT NULL, error TEXT NOT NULL, checked_at TEXT NOT NULL
        );
        """)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(opportunities)")}
        if "source_type" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown'")
        if "evidence_excerpt" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN evidence_excerpt TEXT")
        if "prep_tags" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN prep_tags TEXT")
        if "application_process" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN application_process TEXT")
        if "eligibility" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN eligibility TEXT")
        if "format" not in columns:
            connection.execute("ALTER TABLE opportunities ADD COLUMN format TEXT")
        if "process_confirmed" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN process_confirmed")
        if "acceptance_rate" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN acceptance_rate")
        if "perks" in columns:
            connection.execute("ALTER TABLE opportunities DROP COLUMN perks")


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


# Sites that host discussion, syndication, or social content rather than an employer's
# own application page. Results from these are noisy and frequently duplicate an
# opportunity that is already found on the employer's own site, so they are dropped
# entirely rather than kept as low-confidence entries.
EXCLUDED_DOMAINS = (
    "reddit.com", "targetjobs.co.uk", "brightnetwork.co.uk", "higherin.com",
    "e4s.co.uk", "fe.training", "trackr.co.uk", "gradcracker.com",
    "thestudentroom.co.uk", "instagram.com", "facebook.com", "linkedin.com",
    "twitter.com", "x.com", "youtube.com", "tiktok.com", "google.com",
    "quora.com", "pinterest.com", "wikipedia.org",
)
EXCLUDED_TERMS = ("tracker", "calendar", "guide", "what is", "how do you get", "complete guide", "free resources")


def _host_matches(host: str, domains: tuple[str, ...]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


def is_opportunity_candidate(result: dict) -> bool:
    link = result.get("link", "")
    haystack = f"{result.get('title', '')} {result.get('snippet', '')}".lower()
    host = urlparse(link).netloc.lower()
    if _host_matches(host, EXCLUDED_DOMAINS) or any(term in f"{haystack} {link.lower()}" for term in EXCLUDED_TERMS):
        return False
    return any(term in haystack for term in OPPORTUNITY_TERMS)


def source_type(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if _host_matches(host, EXCLUDED_DOMAINS):
        return "aggregator"
    if "career" in host or any(term in url.lower() for term in ("/careers", "/jobs", "/early-careers", "/students", "/graduates")):
        return "employer"
    return "unknown"


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
        "janestreet.com": "Jane Street", "macfarlanes.com": "Macfarlanes",
        "rothschildandco.com": "Rothschild & Co", "bakermckenzie.com": "Baker McKenzie",
        "hlc.com": "Hogan Lovells", "gainuk.org": "GAIN",
        "db.com": "Deutsche Bank", "hsbc.com": "HSBC", "deloitte.com": "Deloitte",
        "freshfields.com": "Freshfields", "mckinsey.com": "McKinsey & Company",
        "jobs.barclays": "Barclays", "gibsondunn.com": "Gibson Dunn",
    }
    for domain, company in known_domains.items():
        if host == domain or host.endswith(f".{domain}"):
            return company
    generic_titles = ("students", "law students", "graduates", "careers", "early careers", "students and graduates")
    cleaned = re.sub(r"\s*[-|:–—].*$", "", title).strip()
    if cleaned and cleaned.lower() not in generic_titles and not any(term in cleaned.lower() for term in ("spring", "insight", "programme", "program", "week")):
        return cleaned
    return host.removeprefix("www.").split(".")[0].replace("-", " ").title()


def extract_programme(title: str, snippet: str) -> str:
    return (title.strip() or snippet.strip() or "Insight opportunity")[:160]


def opportunity_type(title: str, text: str = "") -> str:
    lowered = f"{title} {text}".lower()
    is_trading = "trading" in lowered or "fttp" in lowered
    is_tech = any(term in lowered for term in ("technology", "engineering", "software"))
    is_first_year = "first year" in lowered or "first-year" in lowered
    if is_trading and is_tech:
        return "Trading & Technology insight programme"
    if is_trading:
        return "Trading insight programme"
    if is_first_year:
        return "First-year programme"
    if is_tech:
        return "Technology insight programme"
    return "Insight programme"


def infer_sector(text: str) -> str:
    """Returns every matching sector, comma-joined, since a programme (e.g. Jane
    Street's Trading and Technology Program) can genuinely span more than one."""
    lowered = text.lower()
    sector_order = ("Investment Banking", "Asset Management", "Trading & Quant", "Consulting", "Technology", "Law")
    sector_terms = {
        "Investment Banking": ("investment bank", "banking"),
        "Asset Management": ("asset management",),
        "Trading & Quant": ("trading", "quant"),
        "Consulting": ("consult",),
        "Technology": ("technology", "engineering", "software"),
        "Law": ("law",),
    }
    matched = [sector for sector in sector_order if any(term in lowered for term in sector_terms[sector])]
    return ", ".join(matched) if matched else "Other"


def infer_location(text: str) -> str | None:
    locations = ("London", "Edinburgh", "Manchester", "Birmingham", "Bristol", "Leeds", "UK", "United Kingdom")
    found = [location for location in locations if re.search(rf"\b{re.escape(location)}\b", text, re.I)]
    return ", ".join(dict.fromkeys(found)) or None


PROCESS_SECTION_TRIGGERS = ("our process", "application process", "recruitment process", "selection process", "how to apply", "hiring process", "our recruitment process", "the process", "our selection process")
PROCESS_STAGES = (
    ("Online application", ("online application", "application form")),
    ("Online assessment", ("online assessment", "numerical reasoning test", "situational judgement test", "psychometric test", "aptitude test", "online test", "verbal reasoning")),
    ("Technical assessment", ("technical assessment", "coding test", "coding challenge", "technical test")),
    ("Video interview", ("video interview", "recorded interview", "one-way interview", "digital interview")),
    ("Phone interview", ("phone interview", "telephone interview")),
    ("Case study", ("case study",)),
    ("Group exercise", ("group exercise", "group discussion", "group activity")),
    ("Assessment centre", ("assessment centre", "assessment center", "assessment day", "final round")),
    ("Interview", ("interview",)),
)


def extract_application_process(text: str) -> list[str] | None:
    """Only trust stage mentions found near an actual "process"/"how to apply"
    heading, rather than scanning the whole page, to avoid pulling in unrelated
    mentions of "interview" or "assessment" from elsewhere (e.g. news about the
    firm's other hiring programmes). Trigger phrases like "recruitment process" also
    turn up in unrelated GDPR/privacy-policy boilerplate ("...your data during the
    recruitment process..."), so a single stage match near a trigger isn't reliable
    evidence of a real, described process -- require at least two stages before
    trusting the result as page-confirmed; a lone match is discarded rather than
    reported as fact."""
    lowered = text.lower()
    trigger_positions = [m.start() for trigger in PROCESS_SECTION_TRIGGERS for m in re.finditer(re.escape(trigger), lowered)]
    if not trigger_positions:
        return None
    window = lowered[min(trigger_positions):min(trigger_positions) + 1200]
    matches: list[tuple[int, str]] = []
    specific_interview_found = False
    for stage_name, keywords in PROCESS_STAGES:
        if stage_name == "Interview":
            continue  # generic fallback, only used if no specific interview type matched
        for keyword in keywords:
            index = window.find(keyword)
            if index >= 0:
                matches.append((index, stage_name))
                if "interview" in stage_name.lower():
                    specific_interview_found = True
                break
    if not specific_interview_found:
        index = window.find("interview")
        if index >= 0:
            matches.append((index, "Interview"))
    matches.sort()
    seen: set[str] = set()
    stages = []
    for _, name in matches:
        if name not in seen:
            seen.add(name)
            stages.append(name)
    return stages[:6] if len(stages) >= 2 else None


# Specific compound phrases, not bare words, to avoid false positives -- e.g. bare
# "first year" would also match "in our first year of operation" in unrelated company
# history text, which has nothing to do with who's eligible to apply.
ELIGIBILITY_PATTERNS = (
    ("First-year students", r"first[- ]year (?:student|undergraduate|undergrad)"),
    ("Penultimate-year students", r"penultimate[- ]year (?:student|undergraduate|undergrad)"),
    ("Final-year students", r"final[- ]year (?:student|undergraduate|undergrad|graduating student)"),
    ("Any degree discipline", r"any degree (?:discipline|subject)|all degree disciplines"),
    ("Visa sponsorship available", r"(?:we )?sponsors? visas|visa sponsorship (?:is )?available"),
    ("Right to work required", r"must have (?:the )?right to work|right to work in the uk (?:is )?required"),
)


def extract_eligibility(text: str) -> list[str] | None:
    lowered = text.lower()
    found = [label for label, pattern in ELIGIBILITY_PATTERNS if re.search(pattern, lowered)]
    return found[:5] if found else None


FORMAT_PATTERNS = (
    ("Hybrid", r"hybrid (?:format|programme|program|event|week)"),
    ("Virtual", r"virtual (?:programme|program|insight|event|week)|conducted virtually|held virtually|takes place virtually"),
    ("In-person", r"in[- ]person (?:programme|program|event|week)|hosted in person|held in person|takes place in person"),
)


def extract_format(text: str) -> str | None:
    lowered = text.lower()
    for label, pattern in FORMAT_PATTERNS:
        if re.search(pattern, lowered):
            return label
    return None


DEADLINE_TRIGGERS = (
    "deadline", "closing date", "applications close", "apply by", "closes",
    "last date to apply", "apply before", "submit your application by",
    "application window closes", "priority deadline", "final deadline", "must apply by",
    # Longer, more specific phrases matter because sentences like "the event runs
    # 21-25 March. The deadline to apply is 3 January." put an unrelated date (the
    # event's end date) very close to the bare word "deadline" -- a longer phrase's
    # end sits right next to the *actual* deadline date, pulling the match there.
    "deadline to apply", "application deadline is", "the deadline is",
)
MONTH_NAMES = r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
DEADLINE_DATE_PATTERN = re.compile(
    # Ordinal suffixes ("4th December 2026") are an extremely common way UK career
    # pages write dates and must be matched, not just the bare-digit form.
    rf"\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{MONTH_NAMES})[,\s]+20\d{{2}}"
    rf"|(?:{MONTH_NAMES})\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+20\d{{2}}"
    r"|20\d{2}-\d{2}-\d{2}",
    re.I,
)
# How far (in characters) a date may sit from a deadline-related word and still count
# as its deadline. Career pages frequently put the actual date in a separate "key
# dates" table or heading well away from the word "deadline", or state the date
# *before* the label instead of after it, so a short one-directional window misses
# real deadlines that are further down the page.
DEADLINE_PROXIMITY_CHARS = 400


# "Trigger word, then date" ("closes 4th December") is overwhelmingly how deadlines
# are phrased. A plain symmetric nearest-neighbour search breaks down on pages that
# say "Applications open 8 Oct. Applications close 1 Feb" -- both dates sit almost
# equally close to the word "close", and a one-character margin can pick the *open*
# date instead of the close date. Penalizing backward (date-before-trigger) matches
# fixes that case while still allowing a backward match when it's the only option
# (e.g. "Key dates: 20 October 2026. This is the deadline.").
BACKWARD_MATCH_PENALTY = 4


def _closest_deadline_match(text: str) -> re.Match | None:
    lowered = text.lower()
    triggers = [(m.start(), m.end()) for trigger in DEADLINE_TRIGGERS for m in re.finditer(re.escape(trigger), lowered)]
    if not triggers:
        return None
    best_match, best_distance = None, None
    for date_match in DEADLINE_DATE_PATTERN.finditer(text):
        date_start, date_end = date_match.start(), date_match.end()
        local_best = None
        for trigger_start, trigger_end in triggers:
            if date_start >= trigger_end:
                distance = date_start - trigger_end
            else:
                distance = (trigger_start - date_end) * BACKWARD_MATCH_PENALTY
            if distance >= 0 and (local_best is None or distance < local_best):
                local_best = distance
        if local_best is not None and local_best <= DEADLINE_PROXIMITY_CHARS and (best_distance is None or local_best < best_distance):
            best_match, best_distance = date_match, local_best
    return best_match


def extract_deadline(text: str) -> str | None:
    match = _closest_deadline_match(text)
    if not match:
        return None
    raw = match.group(0)
    try:
        if re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
            parsed = datetime.strptime(raw, "%Y-%m-%d")
        else:
            # Strip ordinal suffixes ("4th" -> "4") and commas so both "4th December
            # 2026" and "December 4, 2026" reduce to plain tokens; the date pattern
            # matches both day-month-year and month-day-year order, and both
            # abbreviated ("Aug") and full ("August") month names, so figure out
            # which token is the day vs. the month name before parsing.
            cleaned = re.sub(r"(\d)(?:st|nd|rd|th)", r"\1", raw, flags=re.I).replace(",", "")
            tokens = cleaned.split()
            day, month_word, year = tokens if tokens[0].isdigit() else (tokens[1], tokens[0], tokens[2])
            parsed = datetime.strptime(f"{day} {month_word[:3]} {year}", "%d %b %Y")
        return parsed.strftime("%Y-%m-%d")
    except (ValueError, IndexError):
        return None


PROGRAMME_DATE_TRIGGERS = ("takes place", "held", "event dates", "programme dates", "program dates", "runs from", "programme will run")
PROGRAMME_DATE_PATTERN = re.compile(r"(?:\d{1,2}\s+\w+|\w+\s+\d{1,2})[^.!?]{0,50}?20\d{2}")


def extract_programme_dates(text: str) -> str | None:
    lowered = text.lower()
    trigger_positions = [m.start() for trigger in PROGRAMME_DATE_TRIGGERS for m in re.finditer(re.escape(trigger), lowered)]
    if not trigger_positions:
        return None
    best_match, best_distance = None, None
    for date_match in PROGRAMME_DATE_PATTERN.finditer(text):
        distance = min(abs(date_match.start() - position) for position in trigger_positions)
        if distance <= DEADLINE_PROXIMITY_CHARS and (best_distance is None or distance < best_distance):
            best_match, best_distance = date_match, distance
    return best_match.group(0).strip() if best_match else None


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
    primary_sector = sector.split(",")[0].strip()
    return {"Consulting": "coral", "Technology": "green", "Law": "purple", "Asset Management": "blue"}.get(primary_sector, "")


def render_with_playwright(url: str, browser=None) -> str | None:
    """Render a page's visible text. Pass an already-launched `browser` to reuse it
    across many URLs instead of paying browser-launch cost per call."""
    if browser is not None:
        page = browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            # Some career pages (e.g. Jane Street's) fetch the actual session/deadline
            # data via a delayed async call after the DOM is already "loaded", so the
            # real content -- including the deadline -- isn't there yet at
            # domcontentloaded. A short settle wait catches it without the timeout
            # risk of a full networkidle wait on pages with continuous background
            # polling (analytics beacons, etc).
            page.wait_for_timeout(200)
            return re.sub(r"\s+", " ", page.locator("body").inner_text(timeout=10_000)).strip()
        except Exception:
            return None
        finally:
            page.close()
    if sync_playwright is None:
        return None
    with sync_playwright() as playwright:
        own_browser = playwright.chromium.launch(headless=True)
        try:
            return render_with_playwright(url, browser=own_browser)
        finally:
            own_browser.close()


def render_html_with_playwright(url: str, browser=None) -> str | None:
    if browser is not None:
        page = browser.new_page(user_agent=USER_AGENT)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            page.wait_for_timeout(200)
            return page.content()
        except Exception:
            return None
        finally:
            page.close()
    if sync_playwright is None:
        return None
    with sync_playwright() as playwright:
        own_browser = playwright.chromium.launch(headless=True)
        try:
            return render_html_with_playwright(url, browser=own_browser)
        finally:
            own_browser.close()


def fetch_html(url: str, browser=None) -> str | None:
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
        html = response.text if response.status_code < 400 else ""
    except requests.RequestException:
        html = ""
    if len(html) < 500:
        rendered = render_html_with_playwright(url, browser=browser)
        if rendered:
            return rendered
    return html or None


def load_seed_employers() -> list[dict]:
    if not SOURCES_PATH.exists():
        return []
    try:
        return json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def links_from_sitemap(base_url: str) -> list[str]:
    sitemap_url = urljoin(base_url, "/sitemap.xml")
    try:
        response = requests.get(sitemap_url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
    except requests.RequestException:
        return []
    if not response.ok:
        return []
    return re.findall(r"<loc>\s*(.*?)\s*</loc>", response.text, re.I)


def _links_from_html(base_url: str, company: str, html: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    soup = BeautifulSoup(html, "html.parser")
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(" ", strip=True)
        href = urljoin(base_url, anchor["href"])
        haystack = f"{text} {href}".lower()
        if any(term in haystack for term in OPPORTUNITY_TERMS):
            url = canonical_url(href)
            if url:
                found.setdefault(url, {"url": url, "title": text or company, "snippet": "", "discovered_via": f"Direct crawl: {company}", "known_company": company})
    return found


def _links_from_sitemap_urls(company: str, sitemap_links: list[str]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for sitemap_link in sitemap_links:
        lowered = sitemap_link.lower()
        if any(term.replace(" ", "-") in lowered or term.replace(" ", "") in lowered for term in OPPORTUNITY_TERMS):
            url = canonical_url(sitemap_link)
            if url:
                found.setdefault(url, {"url": url, "title": company, "snippet": "", "discovered_via": f"Sitemap crawl: {company}", "known_company": company})
    return found


def search_seed_employers() -> tuple[list[dict], list[dict]]:
    """Crawl every known employer's careers hub page (and sitemap) directly for
    opportunity links, so coverage does not depend entirely on search-engine ranking.

    Runs the plain-HTTP fetches for all employers concurrently (they're independent
    I/O-bound calls), then falls back to a *single* shared Playwright browser instance
    for any site that plain HTTP couldn't read, instead of launching a new browser
    per site.
    """
    employers = load_seed_employers()
    candidates: dict[str, dict] = {}
    failures: list[dict] = []
    needs_playwright: list[dict] = []

    def quick_fetch(employer: dict) -> tuple[dict, str, list[str]]:
        base_url = employer["careers_url"]
        try:
            response = requests.get(base_url, headers={"User-Agent": USER_AGENT}, timeout=8)
            html = response.text if response.status_code < 400 else ""
        except requests.RequestException:
            html = ""
        sitemap_links = links_from_sitemap(base_url)
        return employer, html, sitemap_links

    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(quick_fetch, employer) for employer in employers]
        for future in as_completed(futures):
            employer, html, sitemap_links = future.result()
            found = dict(_links_from_sitemap_urls(employer.get("company", ""), sitemap_links))
            if html:
                found.update(_links_from_html(employer["careers_url"], employer.get("company", ""), html))
            if found:
                for url, candidate in list(found.items())[:SEED_LINKS_PER_EMPLOYER]:
                    candidates.setdefault(url, candidate)
            elif len(html) < 500:
                needs_playwright.append(employer)

    if needs_playwright and sync_playwright is not None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for employer in needs_playwright:
                    base_url = employer["careers_url"]
                    html = render_html_with_playwright(base_url, browser=browser)
                    if html:
                        found = _links_from_html(base_url, employer.get("company", ""), html)
                        for url, candidate in list(found.items())[:SEED_LINKS_PER_EMPLOYER]:
                            candidates.setdefault(url, candidate)
                    else:
                        failures.append({"company": employer.get("company", ""), "careers_url": base_url, "error": "could not fetch careers page (blocked, moved, or timed out)"})
            finally:
                browser.close()
    else:
        for employer in needs_playwright:
            failures.append({"company": employer.get("company", ""), "careers_url": employer["careers_url"], "error": "could not fetch careers page (blocked, moved, or timed out)"})

    return list(candidates.values()), failures

def prep_tags(text: str) -> list[str]:
    lowered = text.lower()
    if any(term in lowered for term in ("law", "legal", "solicitor")):
        return ["commercial awareness", "case study", "motivation"]
    if any(term in lowered for term in ("technology", "engineering", "software", "step")):
        return ["technical OA", "behavioural interview", "motivation"]
    return ["motivation", "commercial awareness", "numerical OA"]


def evidence_excerpt(text: str, status: str, deadline: str | None) -> str:
    # Locate the actual deadline match position rather than searching for the
    # normalized ISO date string, which never appears verbatim in page text
    # (pages say "15 September 2026", not "2026-09-15").
    if deadline:
        deadline_match = _closest_deadline_match(text)
        if deadline_match:
            index = deadline_match.start()
            return text[max(0, index - 90):index + 180].strip()
    phrases = ["applications closed", "apply now", "applications are open", "opening soon", "will open"]
    lowered = text.lower()
    for phrase in phrases:
        index = lowered.find(phrase)
        if index >= 0:
            return text[max(0, index - 90):index + 180].strip()
    return f"No direct status phrase found; classified as {status}."


def _company_for(candidate: dict) -> str:
    return candidate.get("known_company") or extract_company(candidate.get("title", ""), candidate["url"])


# Some career hub pages (very common for UK law firms) describe more than one
# genuinely distinct programme on a single URL -- e.g. a "First Year Insight Day"
# aimed at first-years alongside a separate "Vacation Scheme" aimed at
# penultimate/final-years, each with its own deadline and eligibility. Extracting
# proximity-based fields (deadline, eligibility...) across the *whole* page for a
# single opportunity record silently mixes signals from different programmes into
# one inconsistent row. These markers let us detect that case and split the page
# into per-programme sections instead.
PROGRAMME_MARKERS = (
    (r"first[- ]year insight (?:day|scheme|programme|program|week)", "First Year Insight Day/Scheme"),
    (r"first[- ]year (?:programme|program|scheme)\b", "First Year Programme"),
    (r"(?:summer|winter|spring|off[- ]cycle) vacation scheme", "Vacation Scheme"),
    (r"\bvacation scheme\b", "Vacation Scheme"),
    (r"spring (?:week|insight)", "Spring Week/Insight"),
    (r"insight (?:week|day)\b", "Insight Week/Day"),
    (r"summer internship", "Summer Internship"),
    (r"\bprime programme\b", "PRIME Programme"),  # PRIME: a common UK legal-sector access scheme
)
MIN_PROGRAMME_SECTION_LENGTH = 200


# Some markers overlap by construction (e.g. "First Year Insight Day" also contains
# the substring matched by the broader "Insight Day" pattern), so a phrase like that
# would otherwise register two anchors a few characters apart for what is really one
# mention. Patterns earlier in PROGRAMME_MARKERS are the more specific ones; once a
# position is claimed, any later pattern matching within this distance of it is
# treated as the same real-world mention and skipped, not a second programme.
NEAR_DUPLICATE_ANCHOR_DISTANCE = 150


def split_into_programme_sections(text: str) -> list[tuple[str | None, str]]:
    """Returns [(None, text)] when the page reads as a single programme. When two or
    more distinct programme names are found, returns one (label, section_text) pair
    per programme, each covering the text from that programme's first mention up to
    the next programme's first mention."""
    lowered = text.lower()
    anchors: list[tuple[int, str]] = []
    claimed_labels: set[str] = set()
    for pattern, label in PROGRAMME_MARKERS:
        if label in claimed_labels:
            continue
        match = re.search(pattern, lowered)
        if not match:
            continue
        position = match.start()
        if any(abs(position - existing_position) < NEAR_DUPLICATE_ANCHOR_DISTANCE for existing_position, _ in anchors):
            continue
        anchors.append((position, label))
        claimed_labels.add(label)
    if len(anchors) < 2:
        return [(None, text)]
    anchors.sort()
    sections = []
    for index, (start, label) in enumerate(anchors):
        end = anchors[index + 1][0] if index + 1 < len(anchors) else len(text)
        section_text = text[start:end]
        if len(section_text) >= MIN_PROGRAMME_SECTION_LENGTH:
            sections.append((label, section_text))
    return sections if len(sections) >= 2 else [(None, text)]


def _section_id(url: str, label: str | None) -> str:
    base_id = stable_id(url)
    if not label:
        return base_id
    suffix = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
    return f"{base_id}-{suffix}"[-80:]


def _build_opportunity(candidate: dict, http_status: int | None, text: str, rendered: bool, section_label: str | None = None) -> dict:
    checked_at = utc_now()
    url = candidate["url"] if not section_label else f"{candidate['url']}#{re.sub(r'[^a-z0-9]+', '-', section_label.lower()).strip('-')}"
    title_hint = section_label or candidate.get("title", "")
    initial_type = opportunity_type(title_hint, candidate.get("snippet", ""))
    initial_sector = infer_sector(title_hint)
    base = {"id": _section_id(candidate["url"], section_label), "company": _company_for(candidate), "programme": section_label or extract_programme(candidate.get("title", ""), candidate.get("snippet", "")), "sector": initial_sector, "location": None, "opportunity_url": url, "source_url": candidate["url"], "discovered_via": candidate["discovered_via"], "deadline": None, "programme_dates": None, "status": "unknown", "confidence": "low", "evidence": "Source could not be verified", "evidence_excerpt": None, "application_process": None, "eligibility": None, "format": None, "http_status": http_status, "checked_at": checked_at, "last_error": None, "logo": "?", "logo_class": "", "opportunity_type": initial_type, "source_type": source_type(candidate["url"]), "prep_tags": json.dumps(prep_tags(title_hint))}
    try:
        if len(text) < 100:
            raise RuntimeError(f"verification returned too little page text (HTTP {http_status})")
        deadline = extract_deadline(text)
        programme_dates = extract_programme_dates(text)
        status, evidence, confidence = classify_status(text, deadline, programme_dates)
        sector = infer_sector(f"{title_hint} {text}")
        opp_type = opportunity_type(title_hint, text)
        process = extract_application_process(text)
        eligibility = extract_eligibility(text)
        programme_format = extract_format(text)
        programme_name = section_label or extract_programme(candidate.get("title", ""), candidate.get("snippet", ""))
        base.update({"company": _company_for(candidate), "programme": programme_name, "sector": sector, "location": infer_location(text), "deadline": deadline, "programme_dates": programme_dates, "status": status, "confidence": confidence, "evidence": evidence, "evidence_excerpt": evidence_excerpt(text, status, deadline), "application_process": json.dumps(process) if process else None, "eligibility": json.dumps(eligibility) if eligibility else None, "format": programme_format, "logo": _company_for(candidate)[:3].upper(), "logo_class": sector_logo_class(sector), "source_type": source_type(candidate["url"]), "prep_tags": json.dumps(prep_tags(f"{title_hint} {text}")), "opportunity_type": opp_type})
        if http_status is not None and http_status >= 400 and not rendered:
            base.update({"status": "unknown", "confidence": "low", "evidence": f"Source returned HTTP {http_status}; page could not be verified"})
    except Exception as error:
        base["last_error"] = str(error)
    return base


def _finalize_candidate(candidate: dict, http_status: int | None, text: str, rendered: bool) -> list[dict]:
    if len(text) < 100:
        return [_build_opportunity(candidate, http_status, text, rendered)]
    sections = split_into_programme_sections(text)
    if len(sections) <= 1:
        return [_build_opportunity(candidate, http_status, text, rendered)]
    return [_build_opportunity(candidate, http_status, section_text, rendered, section_label=label) for label, section_text in sections]


# Sync Playwright forbids sharing one browser/driver across OS threads, but each
# thread starting its *own* sync_playwright() instance is explicitly supported. So
# rather than rendering every pending page sequentially through a single shared
# browser, split the work across a handful of threads, each owning its own browser --
# this is what actually cuts wall time, since with the deadline-completeness fallback
# most candidates end up needing a Playwright render.
PLAYWRIGHT_WORKERS = 5


def _render_html_batch(jobs: list[tuple]) -> dict:
    """jobs: list of (key, url). Returns {key: html_or_None}."""
    if not jobs or sync_playwright is None:
        return {key: None for key, _ in jobs}
    results: dict = {}
    lock = threading.Lock()

    def worker(chunk: list[tuple]) -> None:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for key, url in chunk:
                    html = render_html_with_playwright(url, browser=browser)
                    with lock:
                        results[key] = html
            finally:
                browser.close()

    chunks = [jobs[i::PLAYWRIGHT_WORKERS] for i in range(PLAYWRIGHT_WORKERS)]
    threads = [threading.Thread(target=worker, args=(chunk,)) for chunk in chunks if chunk]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


# Deliberately strict: broad phrases like "learn more", "application", or the general
# OPPORTUNITY_TERMS ("insight programme" etc.) match far too many links on a typical
# career page -- e.g. a company's press-release "Learn More" link, or a *different*
# regional variant of the same programme -- and following the wrong one would
# misattribute one programme's deadline to another, which is worse than finding no
# deadline at all. Only explicit apply-CTA phrasing is trusted here.
LINKED_PAGE_TERMS = ("apply now", "apply here", "apply today", "how to apply", "start your application", "begin your application", "apply online")


def _find_deadline_link(base_url: str, html: str) -> str | None:
    """Many career hub pages don't state a deadline themselves and instead link out
    to the actual application page that does. Look for the most likely same-domain
    "apply" link so a missing deadline can be chased down one hop."""
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")
    domain = urlparse(base_url).netloc
    base_path = urlparse(base_url).path.rstrip("/")
    base_normalized = base_url.rstrip("/")
    candidates: list[tuple[bool, str]] = []
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(" ", strip=True).lower()
        if not any(term in text for term in LINKED_PAGE_TERMS):
            continue
        href = urljoin(base_url, anchor["href"])
        if urlparse(href).netloc != domain or href.rstrip("/") == base_normalized:
            continue
        href_path = urlparse(href).path.rstrip("/")
        # Prefer a link whose path is related to the current page's path (a subpage
        # of this specific programme) over some other "Apply Now" elsewhere on the
        # site, to avoid wandering into a different programme variant.
        shares_path = bool(base_path) and (href_path.startswith(base_path) or base_path.startswith(href_path))
        candidates.append((shares_path, href))
    if not candidates:
        return None
    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return candidates[0][1]


def _augment_missing_deadlines(results: list[dict], html_by_url: dict[str, str | None]) -> list[dict]:
    """For any verified opportunity that still has no deadline, follow one promising
    same-domain link found on its own page and check that page for a deadline too."""
    link_jobs: list[tuple[int, str]] = []
    for index, item in enumerate(results):
        if not item or item.get("deadline"):
            continue
        link = _find_deadline_link(item["source_url"], html_by_url.get(item["source_url"]))
        if link:
            link_jobs.append((index, link))
    if not link_jobs:
        return results

    def fetch_text(url: str) -> str:
        try:
            response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
            return clean_text(response.text) if response.status_code < 400 else ""
        except requests.RequestException:
            return ""

    texts: dict[int, tuple[str, str]] = {}
    with ThreadPoolExecutor(max_workers=15) as pool:
        futures = {pool.submit(fetch_text, url): (index, url) for index, url in link_jobs}
        for future in as_completed(futures):
            index, url = futures[future]
            texts[index] = (url, future.result())

    render_jobs = [(index, url) for index, (url, text) in texts.items() if not any(term in text.lower() for term in DEADLINE_TRIGGERS)]
    rendered = _render_html_batch(render_jobs)

    for index, (url, text) in texts.items():
        rendered_html = rendered.get(index)
        if rendered_html:
            text = clean_text(rendered_html)
        deadline = extract_deadline(text)
        if not deadline:
            continue
        item = results[index]
        programme_dates = extract_programme_dates(text)
        status, evidence, confidence = classify_status(text, deadline, programme_dates)
        item.update({"deadline": deadline, "programme_dates": programme_dates or item.get("programme_dates"), "status": status, "confidence": confidence, "evidence": f"{evidence} (found on linked page)", "evidence_excerpt": evidence_excerpt(text, status, deadline)})
    return results


def verify_candidates(candidates: list[dict]) -> list[dict]:
    """Verify every candidate opportunity. The initial page fetch for each candidate
    is independent I/O, so it runs concurrently; any candidate whose plain-HTTP fetch
    was insufficient falls back to Playwright, parallelized across several browser
    instances (see PLAYWRIGHT_WORKERS). Opportunities still missing a deadline
    afterward get one more targeted pass that follows a likely "apply"/"details" link
    on their own page."""
    if not candidates:
        return []
    # Each candidate can expand into multiple opportunity rows if its page turns out
    # to describe several distinct programmes (see split_into_programme_sections), so
    # this holds one list per candidate index rather than one dict.
    results_by_index: list[list[dict] | None] = [None] * len(candidates)
    html_by_url: dict[str, str | None] = {}
    pending: list[tuple[int, dict, int | None]] = []

    def fetch_one(index: int, candidate: dict) -> tuple[int, dict, int | None, str, str]:
        try:
            response = requests.get(candidate["url"], headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT)
            status = response.status_code
            html = response.text if status < 400 else ""
        except requests.RequestException:
            status = None
            html = ""
        text = clean_text(html) if html else ""
        return index, candidate, status, text, html

    with ThreadPoolExecutor(max_workers=25) as pool:
        futures = [pool.submit(fetch_one, i, c) for i, c in enumerate(candidates)]
        for future in as_completed(futures):
            index, candidate, status, text, html = future.result()
            html_by_url[candidate["url"]] = html
            # A plain-HTTP fetch can return plenty of *static* text yet still miss a
            # deadline that a page only loads via a delayed async call (Jane Street's
            # FTTP page: the pre-render text is a substantial ~3KB, but the actual
            # per-location deadlines only appear after client-side JS runs). So don't
            # just gate the Playwright fallback on text length -- also retry with a
            # real browser whenever no deadline-shaped phrase turned up at all, since
            # that's specifically the information this tool exists to surface.
            has_deadline_signal = any(term in text.lower() for term in DEADLINE_TRIGGERS)
            if status is None or status >= 400 or len(text) < 300 or not has_deadline_signal:
                pending.append((index, candidate, status))
            else:
                results_by_index[index] = _finalize_candidate(candidate, status, text, rendered=False)

    if pending:
        rendered = _render_html_batch([(index, candidate["url"]) for index, candidate, _ in pending])
        for index, candidate, status in pending:
            html = rendered.get(index)
            if html:
                html_by_url[candidate["url"]] = html
            text = clean_text(html) if html else ""
            results_by_index[index] = _finalize_candidate(candidate, status, text, rendered=bool(html))

    flat_results = [item for sublist in results_by_index if sublist for item in sublist]
    flat_results = _augment_missing_deadlines(flat_results, html_by_url)
    return flat_results


def normalize_company(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def dedupe_opportunities(items: list[dict]) -> list[dict]:
    """Collapse entries that describe the same opportunity but were discovered at
    different URLs (e.g. an employer page and a syndicated copy of it), keeping the
    one with the best source and evidence."""
    source_rank = {"employer": 2, "unknown": 1, "aggregator": 0}
    confidence_rank = {"high": 2, "medium": 1, "low": 0}

    def score(item: dict) -> tuple:
        return (
            source_rank.get(item["source_type"], 0),
            confidence_rank.get(item["confidence"], 0),
            len(item.get("evidence_excerpt") or ""),
        )

    best: dict[tuple[str, str], dict] = {}
    for item in items:
        key = (normalize_company(item["company"]), item["opportunity_type"])
        current = best.get(key)
        if current is None or score(item) > score(current):
            best[key] = item
    return list(best.values())


def upsert_opportunity(item: dict) -> None:
    with db_lock, db_connect() as connection:
        old = connection.execute("SELECT status FROM opportunities WHERE id = ?", (item["id"],)).fetchone()
        connection.execute("""INSERT INTO opportunities (id, company, programme, sector, location, opportunity_url, source_url, discovered_via, deadline, programme_dates, status, confidence, evidence, application_process, eligibility, format, http_status, checked_at, last_error, logo, logo_class, opportunity_type, source_type, evidence_excerpt, prep_tags)
            VALUES (:id, :company, :programme, :sector, :location, :opportunity_url, :source_url, :discovered_via, :deadline, :programme_dates, :status, :confidence, :evidence, :application_process, :eligibility, :format, :http_status, :checked_at, :last_error, :logo, :logo_class, :opportunity_type, :source_type, :evidence_excerpt, :prep_tags)
            ON CONFLICT(id) DO UPDATE SET company=excluded.company, programme=excluded.programme, sector=excluded.sector, location=excluded.location, deadline=excluded.deadline, programme_dates=excluded.programme_dates, status=excluded.status, confidence=excluded.confidence, evidence=excluded.evidence, application_process=excluded.application_process, eligibility=excluded.eligibility, format=excluded.format, http_status=excluded.http_status, checked_at=excluded.checked_at, last_error=excluded.last_error, logo=excluded.logo, logo_class=excluded.logo_class, opportunity_type=excluded.opportunity_type, source_type=excluded.source_type, evidence_excerpt=excluded.evidence_excerpt, prep_tags=excluded.prep_tags""", item)
        if old is None or old["status"] != item["status"]:
            connection.execute("INSERT INTO status_history (opportunity_id, status, evidence, observed_at) VALUES (?, ?, ?, ?)", (item["id"], item["status"], item["evidence"], item["checked_at"]))
            send_status_alert(item, old["status"] if old else None)


def send_status_alert(item: dict, previous_status: str | None) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    recipient = os.getenv("ALERT_TO")
    if not smtp_host or not recipient:
        return
    message = EmailMessage()
    message["Subject"] = f"Springboard status change: {item['company']} is {item['status']}"
    message["From"] = os.getenv("ALERT_FROM", os.getenv("SMTP_USER", "springboard@localhost"))
    message["To"] = recipient
    message.set_content(f"{item['company']} - {item['programme']} changed from {previous_status or 'new'} to {item['status']}.\n\nEvidence: {item['evidence']}\nSource: {item['source_url']}\nChecked: {item['checked_at']}")
    try:
        with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587")), timeout=15) as smtp:
            smtp.starttls()
            if os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"):
                smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(message)
    except OSError:
        pass


def discover_and_refresh() -> dict:
    if not refresh_lock.acquire(blocking=False):
        return {"status": "already_running"}
    started = utc_now()
    try:
        candidates_by_url: dict[str, dict] = {}
        if os.getenv("SERPER_API_KEY"):
            candidates_by_url = {c["url"]: c for c in search_serper()}
        seed_count = len(load_seed_employers())
        seed_candidates, seed_failures = search_seed_employers()
        for candidate in seed_candidates:
            candidates_by_url.setdefault(candidate["url"], candidate)
        candidates = list(candidates_by_url.values())
        verified = dedupe_opportunities(verify_candidates(candidates))
        for item in verified:
            upsert_opportunity(item)
        with db_lock, db_connect() as connection:
            current_ids = [item["id"] for item in verified]
            if current_ids:
                placeholders = ",".join("?" for _ in current_ids)
                connection.execute(f"DELETE FROM opportunities WHERE id NOT IN ({placeholders})", current_ids)
            else:
                connection.execute("DELETE FROM opportunities")
            connection.execute("INSERT INTO discovery_runs (started_at, finished_at, query_count, result_count, verified_count) VALUES (?, ?, ?, ?, ?)", (started, utc_now(), len(SEARCH_QUERIES) + seed_count, len(candidates), len(verified)))
            connection.execute("DELETE FROM seed_failures")
            checked_at = utc_now()
            connection.executemany("INSERT INTO seed_failures (company, careers_url, error, checked_at) VALUES (?, ?, ?, ?)", [(f["company"], f["careers_url"], f["error"], checked_at) for f in seed_failures])
        return {"status": "complete", "candidates": len(candidates), "verified": len(verified), "seedFailures": len(seed_failures), "checkedAt": utc_now()}
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

        def _parse_list(raw: str | None) -> list | None:
            if not raw:
                return None
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return None

        item.update({
            "firm": item["company"], "role": item["programme"], "url": item["source_url"],
            "source": item["evidence"] or item["source_url"],
            "logoClass": item["logo_class"], "type": item["opportunity_type"],
            "application_process": _parse_list(item["application_process"]),
            "eligibility": _parse_list(item["eligibility"]),
        })
        opportunities.append(item)
    return opportunities


def default_workspace(opportunity_id: str) -> dict:
    return {
        "opportunity_id": opportunity_id,
        "eligibility": [{"label": "Check year-group eligibility", "complete": False}, {"label": "Check right-to-work requirements", "complete": False}, {"label": "Check location and programme dates", "complete": False}],
        "required_documents": [{"label": "CV", "document_id": None, "complete": False}, {"label": "Cover letter", "document_id": None, "complete": False}, {"label": "Transcript", "document_id": None, "complete": False}],
        "cv_document_id": None,
        "cover_letter_document_id": None,
        "oa_plan": ["Complete numerical reasoning drill", "Complete situational judgement drill"],
        "interview_questions": ["Why this firm?", "Why this programme?", "Tell me about a time you solved a difficult problem."],
        "reminder_enabled": False,
        "reminder_date": None,
        "notes": "",
        "submission_evidence": None,
        "status": "Saved",
    }


def get_workspace(opportunity_id: str) -> dict:
    with db_lock, db_connect() as connection:
        row = connection.execute("SELECT payload FROM application_workspaces WHERE opportunity_id = ?", (opportunity_id,)).fetchone()
    return json.loads(row["payload"]) if row else default_workspace(opportunity_id)


def save_workspace(opportunity_id: str, payload: dict) -> dict:
    payload["opportunity_id"] = opportunity_id
    updated_at = utc_now()
    with db_lock, db_connect() as connection:
        connection.execute("INSERT INTO application_workspaces (opportunity_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(opportunity_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", (opportunity_id, json.dumps(payload), updated_at))
    payload["updated_at"] = updated_at
    return payload


def scheduler() -> None:
    while True:
        if os.getenv("SERPER_API_KEY") or SOURCES_PATH.exists():
            discover_and_refresh()
        time.sleep(max(300, REFRESH_HOURS * 3600))


class AppHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "service": "springboard-api", "serperConfigured": bool(os.getenv("SERPER_API_KEY")), "playwrightAvailable": sync_playwright is not None, "seedEmployerCount": len(load_seed_employers())})
        elif path == "/api/opportunities":
            self.send_json({"opportunities": stored_opportunities(), "checkedAt": utc_now(), "source": "sqlite"})
        elif path in {"/api/discover", "/api/opportunities/refresh"}:
            self.send_json(discover_and_refresh())
        elif path == "/api/history":
            with db_lock, db_connect() as connection:
                query = urlparse(self.path).query
                opportunity_id = dict(part.split("=", 1) for part in query.split("&") if "=" in part).get("opportunity_id")
                if opportunity_id:
                    rows = connection.execute("SELECT * FROM status_history WHERE opportunity_id = ? ORDER BY observed_at DESC LIMIT 50", (opportunity_id,)).fetchall()
                else:
                    rows = connection.execute("SELECT * FROM status_history ORDER BY observed_at DESC LIMIT 200").fetchall()
            self.send_json({"history": [dict(row) for row in rows]})
        elif path == "/api/seed-health":
            with db_lock, db_connect() as connection:
                rows = connection.execute("SELECT company, careers_url, error, checked_at FROM seed_failures ORDER BY company").fetchall()
            self.send_json({"seedEmployerCount": len(load_seed_employers()), "failures": [dict(row) for row in rows]})
        elif path == "/api/workspace":
            query = dict(part.split("=", 1) for part in urlparse(self.path).query.split("&") if "=" in part)
            opportunity_id = query.get("opportunity_id")
            if not opportunity_id:
                self.send_json({"error": "opportunity_id is required"})
            else:
                self.send_json({"workspace": get_workspace(opportunity_id)})
        else:
            super().do_GET()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/workspace":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or "{}")
        opportunity_id = body.pop("opportunity_id", None)
        if not opportunity_id:
            self.send_json({"error": "opportunity_id is required"})
            return
        self.send_json({"workspace": save_workspace(opportunity_id, body)})

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
