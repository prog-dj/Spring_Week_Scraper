"""JS-rendered page fetching."""
from __future__ import annotations

import re
import threading

import requests

from scraping.constants import REQUEST_TIMEOUT, USER_AGENT

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


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


# Sync Playwright forbids sharing one browser/driver across OS threads, but each
# thread starting its *own* sync_playwright() instance is explicitly supported. So
# rather than rendering every pending page sequentially through a single shared
# browser, split the work across a handful of threads, each owning its own browser --
# this is what actually cuts wall time, since with the deadline-completeness fallback
# most candidates end up needing a Playwright render.
PLAYWRIGHT_WORKERS = 5


def render_html_batch(jobs: list[tuple]) -> dict:
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
