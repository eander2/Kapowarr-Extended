# -*- coding: utf-8 -*-

"""
Fetch new-release data from League of Comic Geeks (LOCG).

LOCG's weekly release data is curated by retailers and the community, so it
tracks the actual on-sale week more accurately than ComicVine's cover-date
metadata. Used for the "New Releases" page as a complement to (not
replacement of) the ComicVine-backed Calendar.

Implementation notes:

* The site is fronted by Cloudflare bot challenges, so plain httpx/requests
  calls return 403. We use ``curl_cffi`` to impersonate a real Chrome TLS
  fingerprint, which currently clears the challenge.

* ``robots.txt`` declares ``Crawl-delay: 30``. We honour this with a
  module-level rate gate that throttles to one outbound request per 30s.

* All responses are persisted to a JSON file in the DB folder with tiered
  TTLs. Past weeks rarely change (30-day cache); current weeks may receive
  late additions (24-hour cache); future weeks evolve as solicitations
  refine (12-hour cache). On any fetch failure we fall back to stale cache
  rather than returning empty results.

* Selectors derived from live LOCG markup (April 2026); the
  ``alistairjcbrown/leagueofcomicgeeks`` Node library has stale selectors.
"""

from datetime import datetime, timezone
from json import dumps as json_dumps, loads as json_loads
from os import replace as os_replace
from os.path import dirname, join as path_join
from re import compile as re_compile, sub as re_sub
from time import sleep, time as now_time
from typing import Any, Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from curl_cffi import requests as cffi_requests

from backend.base.logging import LOGGER
from backend.internals.db import DBConnection


_LOCG_BASE = 'https://leagueofcomicgeeks.com'
_RELEASES_URL = f'{_LOCG_BASE}/comic/get_comics'
_REFERER = f'{_LOCG_BASE}/comics/new-comics'
_CACHE_FILE_NAME = 'locg_cache.json'

# robots.txt Crawl-delay = 30s. Hard cap on outbound request frequency.
_CRAWL_DELAY_SECONDS = 30

# Aggressive cache TTLs to minimise outbound traffic to LOCG.
_TTL_PAST_WEEK = 30 * 86400         # 30 days  — closed weeks rarely change
_TTL_CURRENT_WEEK = 24 * 3600       # 24 hours — late additions possible
_TTL_FUTURE_WEEK = 12 * 3600        # 12 hours — solicitations evolve

_REQUEST_TIMEOUT = 20

_ISSUE_NUMBER_PATTERN = re_compile(r'#\s*([\w./-]+)\s*$')
_ORDINAL_SUFFIX_PATTERN = re_compile(r'(\d+)(st|nd|rd|th)')

_BROWSER_USER_AGENT = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)


class _PersistentCache:
    """JSON-backed dict cache. Keyed by an opaque string."""

    def __init__(self, file_path: str) -> None:
        self._file_path = file_path
        self._data: Dict[str, Dict[str, Any]] = self._load()

    def _load(self) -> Dict[str, Dict[str, Any]]:
        try:
            with open(self._file_path) as f:
                return json_loads(f.read())
        except (FileNotFoundError, ValueError):
            return {}

    def _save(self) -> None:
        tmp_path = self._file_path + '.tmp'
        with open(tmp_path, 'w') as f:
            f.write(json_dumps(self._data))
        os_replace(tmp_path, self._file_path)

    def get(
        self, key: str, max_age_seconds: int
    ) -> Optional[List[Dict[str, Any]]]:
        entry = self._data.get(key)
        if entry is None:
            return None
        if now_time() - entry['ts'] > max_age_seconds:
            return None
        return entry['value']

    def get_stale(self, key: str) -> Optional[List[Dict[str, Any]]]:
        entry = self._data.get(key)
        return entry['value'] if entry else None

    def set(self, key: str, value: List[Dict[str, Any]]) -> None:
        self._data[key] = {'ts': now_time(), 'value': value}
        self._save()


# Lazy-init module state. The DB folder isn't known at import time.
_cache: Optional[_PersistentCache] = None
_last_request_at: float = 0.0


def _get_cache() -> _PersistentCache:
    global _cache
    if _cache is None:
        db_folder = dirname(DBConnection.file)
        _cache = _PersistentCache(path_join(db_folder, _CACHE_FILE_NAME))
    return _cache


def _respect_crawl_delay() -> None:
    global _last_request_at
    elapsed = now_time() - _last_request_at
    if elapsed < _CRAWL_DELAY_SECONDS:
        wait = _CRAWL_DELAY_SECONDS - elapsed
        LOGGER.debug('LOCG crawl-delay sleeping %.1fs', wait)
        sleep(wait)
    _last_request_at = now_time()


def _ttl_for(week_date: str) -> int:
    try:
        week = datetime.strptime(week_date, '%Y-%m-%d').date()
        today = datetime.now().date()
        delta = (today - week).days
    except ValueError:
        return _TTL_CURRENT_WEEK

    if delta > 7:
        return _TTL_PAST_WEEK
    if delta < -7:
        return _TTL_FUTURE_WEEK
    return _TTL_CURRENT_WEEK


def _split_title(full_title: str) -> Tuple[str, str]:
    """Split ``"Volume Title #N"`` into ``("Volume Title", "N")``.

    LOCG embeds the issue number inside the title text. If no number is
    present (one-shots, TPBs) the issue number is empty and the full text
    is returned as the volume title.
    """
    m = _ISSUE_NUMBER_PATTERN.search(full_title)
    if not m:
        return full_title.strip(), ''
    return full_title[:m.start()].strip(), m.group(1).strip()


def _parse_release_date(date_el: Any) -> str:
    """Extract ``YYYY-MM-DD`` from a ``.comic-details .date`` element.

    Prefers the ``data-date`` Unix timestamp attribute; falls back to
    parsing the text (e.g. ``"Apr 29th, 2026"``).
    """
    if date_el is None:
        return ''
    ts = date_el.get('data-date')
    if ts:
        try:
            return datetime.fromtimestamp(
                int(ts), tz=timezone.utc
            ).strftime('%Y-%m-%d')
        except (ValueError, OSError):
            pass
    text = _ORDINAL_SUFFIX_PATTERN.sub(r'\1', date_el.get_text(strip=True))
    for fmt in ('%b %d, %Y', '%B %d, %Y'):
        try:
            return datetime.strptime(text, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return ''


def _parse_list_html(
    html: str, include_variants: bool = False
) -> List[Dict[str, Any]]:
    if not html:
        return []

    soup = BeautifulSoup(html, 'html.parser')
    results: List[Dict[str, Any]] = []

    for item in soup.select('li[data-comic]'):
        # data-parent != "0" identifies variant covers of another comic.
        # By default we drop them — they share the parent's issue # and
        # would otherwise dominate the result set (e.g. 129/168 entries
        # for one observed week).
        is_variant = (item.get('data-parent') or '0') != '0'
        if is_variant and not include_variants:
            continue

        locg_id = item.get('data-comic')
        try:
            pulls = int(item.get('data-pulls') or '0')
        except ValueError:
            pulls = 0

        title_el = item.select_one('.title.color-primary > a')
        full_title = title_el.get_text(strip=True) if title_el else ''
        volume_title, issue_number = _split_title(full_title)

        link_el = item.select_one('.comic-cover-art a')
        url_path = link_el.get('href') if link_el else None

        cover_el = item.select_one('.comic-cover-art img')
        cover = cover_el.get('data-src') if cover_el else None

        publisher_el = item.select_one('.comic-details .publisher')
        publisher = (
            publisher_el.get_text(strip=True) if publisher_el else ''
        )

        release_date = _parse_release_date(
            item.select_one('.comic-details .date')
        )

        price_el = item.select_one('.comic-details .price')
        price = price_el.get_text(strip=True) if price_el else ''

        results.append({
            'locg_id': locg_id,
            'title': volume_title,
            'issue_number': issue_number,
            'publisher': publisher,
            'release_date': release_date,
            'cover': cover,
            'url': (_LOCG_BASE + url_path) if url_path else None,
            'price': price,
            'pulls': pulls,
            'is_variant': is_variant,
        })

    return results


class LeagueOfComicGeeks:
    """Thin wrapper around LOCG's undocumented ``/comic/get_comics`` endpoint."""

    def fetch_new_releases(
        self,
        week_date: str,
        publishers: Optional[List[str]] = None,
        include_variants: bool = False,
    ) -> List[Dict[str, Any]]:
        """Fetch issues releasing in the week containing ``week_date``.

        Args:
            week_date (str): A YYYY-MM-DD date inside the target week.
                LOCG normalises this server-side to the release Wednesday.

            publishers (List[str], optional): Restrict results to these
                publisher names (matched server-side). Defaults to all.

            include_variants (bool, optional): Include variant covers
                (which share the parent comic's issue number). Default
                False — typically variants are 70-80% of LOCG's listings
                and add noise without distinct release information.

        Returns:
            List[Dict[str, Any]]: Issue records with keys ``locg_id``,
                ``title``, ``issue_number``, ``publisher``,
                ``release_date`` (YYYY-MM-DD), ``cover``, ``url``,
                ``price``, ``pulls``, ``is_variant``. Empty list on
                persistent failure with no stale cache available.
        """
        cache_key = (
            f'{week_date}|{",".join(publishers or [])}|v={int(include_variants)}'
        )
        cache = _get_cache()
        ttl = _ttl_for(week_date)

        cached = cache.get(cache_key, ttl)
        if cached is not None:
            LOGGER.debug(
                'LOCG cache hit for %s (ttl %ds)', cache_key, ttl
            )
            return cached

        params: Dict[str, Any] = {
            'list': 'releases',
            'list_option': 'issue',
            'date_type': 'week',
            'date': week_date,
            'order': 'pulls',
            'view': 'list',
        }
        if publishers:
            params['publisher[]'] = publishers

        _respect_crawl_delay()

        try:
            response = cffi_requests.get(
                _RELEASES_URL,
                params=params,
                impersonate='chrome120',
                headers={
                    'Accept': 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': _REFERER,
                    'User-Agent': _BROWSER_USER_AGENT,
                },
                timeout=_REQUEST_TIMEOUT,
            )
        except Exception as e:
            LOGGER.warning(
                'LOCG request failed (%s: %s) — falling back to stale cache',
                type(e).__name__, e,
            )
            return cache.get_stale(cache_key) or []

        if response.status_code != 200:
            LOGGER.warning(
                'LOCG returned HTTP %d for week %s — likely Cloudflare '
                'block. Falling back to stale cache.',
                response.status_code, week_date,
            )
            return cache.get_stale(cache_key) or []

        try:
            payload = response.json()
        except Exception as e:
            LOGGER.warning(
                'LOCG response not JSON (%s); falling back to stale cache',
                type(e).__name__,
            )
            return cache.get_stale(cache_key) or []

        results = _parse_list_html(
            payload.get('list', ''), include_variants=include_variants
        )

        cache.set(cache_key, results)
        LOGGER.info(
            'LOCG fetched %d releases for week %s '
            '(LOCG normalised to %s, cached for %ds)',
            len(results), week_date,
            payload.get('configurator', {}).get('date', week_date),
            ttl,
        )
        return results
