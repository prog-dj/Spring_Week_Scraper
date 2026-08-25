"""Pure text-extraction logic: no network I/O. Given already-fetched page text, pulls
out deadlines, eligibility, format, application process, sector/company/type
classification, and multi-programme page splitting."""
from __future__ import annotations

import re
from datetime import date, datetime
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from scraping.constants import DEADLINE_TRIGGERS


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


# Degree apprenticeship employer domains not already covered by
# extract_company's spring-week known_domains map.
DA_KNOWN_DOMAINS = {
    "arm.com": "Arm", "baesystems.com": "BAE Systems", "rolls-royce.com": "Rolls-Royce",
    "mercedes-benz.co.uk": "Mercedes-Benz", "cgi.com": "CGI", "kier.co.uk": "Kier",
}

# Generic listing-page phrasing that shows up as a page <title> but is never a
# real company name -- either a job-board's own SEO phrasing ("X Jobs (with
# Salaries)") or a careers-hub page that covers many roles/employers at once
# ("Apprenticeships", "Search apprenticeships"). Checked in addition to the
# spring-week generic_titles/insight-programme guard below so DA titles fall
# back to the host-derived name instead of keeping this boilerplate verbatim.
DA_GENERIC_TITLE_TERMS = (
    "apprenticeship", "apprenticeships", "jobs", "with salaries", "vacancies",
    "search", "degree apprenticeship", "degree apprenticeships",
)


def extract_company(title: str, url: str, category: str = "spring_week") -> str:
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
        **(DA_KNOWN_DOMAINS if category == "degree_apprenticeship" else {}),
    }
    for domain, company in known_domains.items():
        if host == domain or host.endswith(f".{domain}"):
            return company
    generic_titles = ("students", "law students", "graduates", "careers", "early careers", "students and graduates")
    cleaned = re.sub(r"\s*[-|:–—].*$", "", title).strip()
    generic_terms = ("spring", "insight", "programme", "program", "week")
    if category == "degree_apprenticeship":
        generic_terms = DA_GENERIC_TITLE_TERMS
    if cleaned and cleaned.lower() not in generic_titles and not any(term in cleaned.lower() for term in generic_terms):
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
    Street's Trading and Technology Program) can genuinely span more than one.

    Only "Law" uses specific compound phrases rather than a bare word -- bare "law"
    matches both EEOC/equal-opportunity boilerplate ("protected under applicable
    federal, state, or local law") present on almost every career page, and generic
    sitewide nav menus (a Big 4 firm's "Tax & Law" business-area link appears on
    every one of its career pages, including ones about entirely unrelated
    programmes like Audit). The other sectors are left as bare/short terms
    deliberately: genuine descriptive text about them ("trading and technology
    models", "Wholesale Banking") is too varied in phrasing to reliably require a
    specific compound without also losing real matches -- narrower attempts here
    caused real regressions (Jane Street's trading content, JPMorgan's banking
    content) without a way to fully separate genuine nav-menu contamination from
    real signal, so those sectors keep the simpler, occasionally-noisier heuristic."""
    lowered = text.lower()
    sector_order = ("Investment Banking", "Asset Management", "Trading & Quant", "Consulting", "Technology", "Law")
    sector_terms = {
        "Investment Banking": ("investment bank", "banking"),
        "Asset Management": ("asset management",),
        "Trading & Quant": ("trading", "quant"),
        "Consulting": ("consult",),
        "Technology": ("technology", "engineering", "software"),
        "Law": ("law firm", "trainee solicitor", "training contract", "legal practice", "qualified solicitor"),
    }
    matched = [sector for sector in sector_order if any(term in lowered for term in sector_terms[sector])]
    return ", ".join(matched) if matched else "Other"


# Degree Apprenticeships get their own sector taxonomy -- the UK DA market
# spans fields (engineering, construction, nursing, policing) that spring
# weeks never touch, so reusing infer_sector()'s categories wouldn't fit.
def infer_da_sector(text: str) -> str:
    lowered = text.lower()
    sector_order = (
        "Engineering", "Technology & Digital", "Construction", "Finance & Accounting",
        "Business & Management", "Law", "Healthcare", "Cyber Security", "Public Sector",
    )
    sector_terms = {
        "Engineering": ("engineering", "manufacturing", "aerospace", "automotive"),
        "Technology & Digital": ("digital and technology", "software", "data ", "data analyst", "it apprentice"),
        "Construction": ("construction", "built environment", "civil engineering", "surveying"),
        "Finance & Accounting": ("accountancy", "accounting", "finance apprentice", "actuarial"),
        "Business & Management": ("business management", "chartered manager", "hr apprentice", "operations apprentice"),
        "Law": ("solicitor apprentice", "legal apprentice", "chartered legal executive"),
        "Healthcare": ("nursing", "nurse apprentice", "healthcare apprentice", "paramedic"),
        "Cyber Security": ("cyber security", "cybersecurity", "security analyst apprentice"),
        "Public Sector": ("police constable", "civil service", "policing apprentice"),
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


# Diversity-scheme naming is often the *only* signal a programme is
# identity-restricted -- e.g. "Women in Banking Insight Day" rarely repeats
# "for women" anywhere in the page body, the programme name is the eligibility
# statement. So this runs against the title/programme name as well as body
# text, not just body text like ELIGIBILITY_PATTERNS above. Patterns are
# anchored on how these schemes are actually named in the UK market (word
# boundaries + a scheme-ish qualifier) rather than bare group names, to avoid
# false positives like "Asian markets desk" or "black-box testing".
IDENTITY_ELIGIBILITY_PATTERNS = (
    ("Women", r"\bwomen'?s\b|\bwomen in\b|\bfor women\b|\bfemale[- ]only\b"),
    ("Black students", r"\bblack heritage\b|\bblack (?:student|talent|professional|future|scholar)s?\b|\bfor black\b"),
    ("Asian heritage students", r"\basian heritage\b|\bfor asian\b"),
    ("Mixed heritage students", r"\bmixed heritage\b"),
    ("BAME / ethnic minority students", r"\bbame\b|\bethnic minorit(?:y|ies)\b|\bunderrepresented (?:ethnic|racial) (?:group|minorit)"),
)


def extract_identity_eligibility(text: str) -> list[str]:
    lowered = text.lower()
    return [label for label, pattern in IDENTITY_ELIGIBILITY_PATTERNS if re.search(pattern, lowered)]


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


def prep_tags(text: str) -> list[str]:
    lowered = text.lower()
    if any(term in lowered for term in ("law", "legal", "solicitor")):
        return ["commercial awareness", "case study", "motivation"]
    if any(term in lowered for term in ("technology", "engineering", "software", "step")):
        return ["technical OA", "behavioural interview", "motivation"]
    return ["motivation", "commercial awareness", "numerical OA"]


def _trim_to_sentence(text: str, start: int, end: int, max_radius: int = 240) -> str:
    """Expand a match outward to the nearest sentence boundaries instead of a fixed
    character count, which regularly cut mid-word and pulled in unrelated leading or
    trailing boilerplate (e.g. an EEOC statement immediately after a deadline
    sentence). Falls back to the raw window if no boundary is found nearby."""
    window_start = max(0, start - max_radius)
    window_end = min(len(text), end + max_radius)
    window = text[window_start:window_end]
    local_start, local_end = start - window_start, end - window_start

    sentence_start = 0
    for punct in (". ", "! ", "? ", "\n"):
        position = window.rfind(punct, 0, local_start)
        if position != -1:
            sentence_start = max(sentence_start, position + len(punct))

    sentence_end = len(window)
    candidates = []
    for punct in (". ", "! ", "? ", "\n"):
        position = window.find(punct, local_end)
        if position != -1:
            candidates.append(position + 1)  # keep the terminating punctuation
    if candidates:
        sentence_end = min(candidates)

    excerpt = window[sentence_start:sentence_end].strip()
    return excerpt or window.strip()


def evidence_excerpt(text: str, status: str, deadline: str | None) -> str:
    # Locate the actual deadline match position rather than searching for the
    # normalized ISO date string, which never appears verbatim in page text
    # (pages say "15 September 2026", not "2026-09-15").
    if deadline:
        deadline_match = _closest_deadline_match(text)
        if deadline_match:
            return _trim_to_sentence(text, deadline_match.start(), deadline_match.end())
    # Unlike a deadline sentence, a bare "apply now" is just as likely to be a link
    # label sitting inside a nav/footer block ("...each region: Apply now more
    # Asia-Pacific more more more Germany...") as it is real prose. A link-list block
    # like that rarely has sentence punctuation nearby, so _trim_to_sentence falls
    # back to (most of) its search window instead of a real sentence -- a smaller
    # radius keeps that fallback window bounded, and rejecting excerpts that still
    # come back long treats "no nearby sentence found" as "not real evidence" rather
    # than surfacing nav clutter as if it were a status statement.
    phrases = ["applications closed", "apply now", "applications are open", "opening soon", "will open"]
    lowered = text.lower()
    for phrase in phrases:
        index = lowered.find(phrase)
        if index >= 0:
            excerpt = _trim_to_sentence(text, index, index + len(phrase), max_radius=120)
            if len(excerpt) <= 200:
                return excerpt
    return f"No direct status phrase found; classified as {status}."


def normalize_company(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
