from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_PATH = ROOT / "sources.json"
SEED_LINKS_PER_EMPLOYER = 5
SERPER_URL = "https://google.serper.dev/search"
USER_AGENT = "SpringrOpportunityResearch/2.0 (+local student careers tool)"
REQUEST_TIMEOUT = 15

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

OPPORTUNITY_TERMS = (
    "spring week", "spring insight", "insight week", "insight programme", "insight program",
    "first year programme", "first-year programme", "first year program", "first-year program",
    "first year insight", "first-year insight", "first year internship", "first-year internship",
    "first year trading", "first-year trading", "freshman insight", "fttp",
)

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
    # Job-board aggregators: their listing titles are the aggregator's own SEO
    # phrasing ("X Degree Apprenticeship Job (with Salaries)"), not the
    # employer's name, so extract_company() has nothing real to extract from
    # these pages -- and the listing itself typically just re-links to the
    # employer's own site anyway, which search already turns up separately.
    "indeed.com", "indeed.co.uk", "reed.co.uk", "totaljobs.com",
    "cv-library.co.uk", "monster.co.uk", "glassdoor.co.uk", "glassdoor.com",
    "simplyhired.co.uk", "adzuna.co.uk", "jobsite.co.uk", "careerjet.co.uk",
    "milkround.com", "prospects.ac.uk", "ratemyapprenticeship.co.uk",
    "apprenticeships.gov.uk", "the-trackr.com", "ucas.com",
)
EXCLUDED_TERMS = ("tracker", "calendar", "guide", "what is", "how do you get", "complete guide", "free resources")

# --- Degree Apprenticeships: a separate discovery track from spring weeks, see
# scraping/discovery.py's discover_da_candidates(). Tagged with a distinct
# `category` at the D1 layer so the two never mix in listings, dedup, or the
# stale-cleanup pass -- see worker/src/db/opportunities.ts.
DA_SEARCH_QUERIES = [
    "UK degree apprenticeship applications 2027",
    "UK engineering degree apprenticeship applications",
    "UK technology degree apprenticeship applications",
    "UK digital and technology solutions degree apprenticeship",
    "UK construction degree apprenticeship applications",
    "UK finance degree apprenticeship applications",
    "UK accountancy degree apprenticeship applications",
    "UK business management degree apprenticeship applications",
    "UK law degree apprenticeship solicitor applications",
    "UK nursing degree apprenticeship applications",
    "UK cyber security degree apprenticeship applications",
    "UK data degree apprenticeship applications",
    "UK police constable degree apprenticeship applications",
    "UK civil service degree apprenticeship applications",
]

# Broad enough to catch genuine Level 6/7 degree apprenticeships, but "degree"
# (or "level 6"/"level 7", the UK regulatory levels a degree apprenticeship
# sits at) must appear alongside "apprenticeship" -- otherwise this would also
# match ordinary Level 2/3 (non-degree) apprenticeship listings, a materially
# different and much more common thing that isn't what this tab is for.
DA_OPPORTUNITY_TERMS = (
    "degree apprenticeship", "degree apprenticeships",
    "level 6 apprenticeship", "level 7 apprenticeship",
    "level 6 apprentice", "level 7 apprentice",
    "higher and degree apprenticeship",
)
DA_EXCLUDED_TERMS = EXCLUDED_TERMS + ("level 2 apprenticeship", "level 3 apprenticeship", "gcse apprenticeship")

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

# Deliberately strict: broad phrases like "learn more", "application", or the general
# OPPORTUNITY_TERMS ("insight programme" etc.) match far too many links on a typical
# career page -- e.g. a company's press-release "Learn More" link, or a *different*
# regional variant of the same programme -- and following the wrong one would
# misattribute one programme's deadline to another, which is worse than finding no
# deadline at all. Only explicit apply-CTA phrasing is trusted here.
LINKED_PAGE_TERMS = ("apply now", "apply here", "apply today", "how to apply", "start your application", "begin your application", "apply online")


def serper_api_key() -> str | None:
    return os.getenv("SERPER_API_KEY")
