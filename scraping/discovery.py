"""Candidate discovery (Serper search + seed-employer crawling) and verification.
Persistence is not this module's concern -- scraping.push_adapter runs these
functions on a GitHub Actions schedule and POSTs the results to the Cloudflare
Worker's /internal/ingest endpoint, which writes to D1."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

from scraping.constants import (
    DEADLINE_TRIGGERS,
    EXCLUDED_DOMAINS,
    EXCLUDED_TERMS,
    LINKED_PAGE_TERMS,
    OPPORTUNITY_TERMS,
    REQUEST_TIMEOUT,
    SEARCH_QUERIES,
    SEED_LINKS_PER_EMPLOYER,
    SERPER_URL,
    SOURCES_PATH,
    USER_AGENT,
    serper_api_key,
)
from scraping.extraction import (
    canonical_url,
    classify_status,
    clean_text,
    evidence_excerpt,
    extract_application_process,
    extract_company,
    extract_deadline,
    extract_eligibility,
    extract_format,
    extract_identity_eligibility,
    extract_programme,
    extract_programme_dates,
    infer_location,
    infer_sector,
    normalize_company,
    opportunity_type,
    prep_tags,
    sector_logo_class,
    _section_id,
    split_into_programme_sections,
)
from scraping.playwright_render import (
    render_html_batch,
    render_html_with_playwright,
    sync_playwright,
)

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
    api_key = serper_api_key()
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


def _company_for(candidate: dict) -> str:
    return candidate.get("known_company") or extract_company(candidate.get("title", ""), candidate["url"])


def _build_opportunity(candidate: dict, http_status: int | None, text: str, rendered: bool, section_label: str | None = None) -> dict:
    checked_at = utc_now()
    url = candidate["url"] if not section_label else f"{candidate['url']}#{re.sub(r'[^a-z0-9]+', '-', section_label.lower()).strip('-')}"
    title_hint = section_label or candidate.get("title", "")
    initial_type = opportunity_type(title_hint, candidate.get("snippet", ""))
    initial_sector = infer_sector(title_hint)
    # Diversity-scheme naming ("Women in Banking", "Black Heritage Programme")
    # is often stated only in the title, never repeated in the page body -- so
    # this is checked even when verification below fails entirely.
    title_identity_eligibility = extract_identity_eligibility(title_hint)
    base = {"id": _section_id(candidate["url"], section_label), "company": _company_for(candidate), "programme": section_label or extract_programme(candidate.get("title", ""), candidate.get("snippet", "")), "sector": initial_sector, "location": None, "opportunity_url": url, "source_url": candidate["url"], "discovered_via": candidate["discovered_via"], "deadline": None, "programme_dates": None, "status": "unknown", "confidence": "low", "evidence": "Source could not be verified", "evidence_excerpt": None, "application_process": None, "eligibility": json.dumps(title_identity_eligibility) if title_identity_eligibility else None, "format": None, "http_status": http_status, "checked_at": checked_at, "last_error": None, "logo": "?", "logo_class": "", "opportunity_type": initial_type, "source_type": source_type(candidate["url"]), "prep_tags": json.dumps(prep_tags(title_hint))}
    try:
        if len(text) < 100:
            raise RuntimeError(f"verification returned too little page text (HTTP {http_status})")
        deadline = extract_deadline(text)
        programme_dates = extract_programme_dates(text)
        status, evidence, confidence = classify_status(text, deadline, programme_dates)
        sector = infer_sector(f"{title_hint} {text}")
        opp_type = opportunity_type(title_hint, text)
        process = extract_application_process(text)
        identity_eligibility = extract_identity_eligibility(f"{title_hint} {text}")
        eligibility = list(dict.fromkeys(identity_eligibility + (extract_eligibility(text) or [])))[:6] or None
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
    rendered = render_html_batch(render_jobs)

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
    instances. Opportunities still missing a deadline afterward get one more targeted
    pass that follows a likely "apply"/"details" link on their own page."""
    if not candidates:
        return []
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
            has_deadline_signal = any(term in text.lower() for term in DEADLINE_TRIGGERS)
            if status is None or status >= 400 or len(text) < 300 or not has_deadline_signal:
                pending.append((index, candidate, status))
            else:
                results_by_index[index] = _finalize_candidate(candidate, status, text, rendered=False)

    if pending:
        rendered = render_html_batch([(index, candidate["url"]) for index, candidate, _ in pending])
        for index, candidate, status in pending:
            html = rendered.get(index)
            if html:
                html_by_url[candidate["url"]] = html
            text = clean_text(html) if html else ""
            results_by_index[index] = _finalize_candidate(candidate, status, text, rendered=bool(html))

    flat_results = [item for sublist in results_by_index if sublist for item in sublist]
    flat_results = _augment_missing_deadlines(flat_results, html_by_url)
    return flat_results


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


# The old in-process discover_and_refresh()/scheduler() pair is gone -- that
# orchestration now lives in scraping.push_adapter.run(), triggered by GitHub
# Actions' cron instead of an always-on background thread, since Workers can't
# run either Playwright or a long-lived thread.
