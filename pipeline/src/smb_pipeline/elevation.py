"""Station elevations from an external DEM service, cached on disk."""

import json
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import httpx

from smb_pipeline.geo import LatLon


class ElevationProvider(Protocol):
    def elevations(self, points: Sequence[LatLon]) -> list[float]:
        """Elevation in metres for each point, in the same order."""
        ...


class OpenMeteoElevation:
    """Copernicus 90 m DEM through the Open-Meteo API (no key, up to 100 points per call).

    The swisstopo height service is more precise but answers one point per request and
    was unreliable while this was written; it can be added as another provider.
    """

    URL = "https://api.open-meteo.com/v1/elevation"
    BATCH_SIZE = 100
    RETRIES = 5
    # The free tier counts every coordinate as one call and allows about 600 per minute.
    SECONDS_BETWEEN_BATCHES = 12.0
    DEFAULT_RETRY_AFTER_S = 60.0

    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=30)

    def elevations(self, points: Sequence[LatLon]) -> list[float]:
        result: list[float] = []
        for start in range(0, len(points), self.BATCH_SIZE):
            if start:
                time.sleep(self.SECONDS_BETWEEN_BATCHES)
            result.extend(self._fetch_batch(points[start : start + self.BATCH_SIZE]))
        return result

    def _fetch_batch(self, batch: Sequence[LatLon]) -> list[float]:
        params = {
            "latitude": ",".join(f"{p.lat:.5f}" for p in batch),
            "longitude": ",".join(f"{p.lon:.5f}" for p in batch),
        }
        for _ in range(self.RETRIES):
            response = self._client.get(self.URL, params=params)
            if response.status_code == httpx.codes.OK:
                values: list[float] = response.json()["elevation"]
                return values
            if response.status_code != httpx.codes.TOO_MANY_REQUESTS:
                response.raise_for_status()
            retry_after = response.headers.get("Retry-After")
            time.sleep(float(retry_after) if retry_after else self.DEFAULT_RETRY_AFTER_S)
        raise RuntimeError(f"elevation API still rate limited after {self.RETRIES} attempts")


class CachedElevation:
    """Wraps a provider and remembers every answer in a JSON file.

    Missing points are fetched in chunks and saved after each one, so an interrupted run
    keeps its progress.
    """

    def __init__(self, inner: ElevationProvider, cache_file: Path, chunk_size: int = 100) -> None:
        self._inner = inner
        self._file = cache_file
        self._chunk_size = chunk_size
        self._cache: dict[str, float] = (
            json.loads(cache_file.read_text()) if cache_file.exists() else {}
        )

    def elevations(self, points: Sequence[LatLon]) -> list[float]:
        missing = list({_key(p): p for p in points if _key(p) not in self._cache}.values())
        for start in range(0, len(missing), self._chunk_size):
            chunk = missing[start : start + self._chunk_size]
            for point, value in zip(chunk, self._inner.elevations(chunk), strict=True):
                self._cache[_key(point)] = value
            self._save()
        return [self._cache[_key(p)] for p in points]

    def _save(self) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        self._file.write_text(json.dumps(self._cache, indent=0, sort_keys=True))


def _key(p: LatLon) -> str:
    return f"{p.lat:.5f},{p.lon:.5f}"
