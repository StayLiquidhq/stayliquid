import { Reader, type ReaderModel } from "@maxmind/geoip2-node";
import { existsSync, watch } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { gunzipSync } from "zlib";

import { logger } from "@/lib/logger";

const DATABASE_DIR = path.join(process.cwd(), "data");

const DATABASE_PATH = path.join(DATABASE_DIR, "GeoLite2-City.mmdb");

const DATABASE_URL = "https://cdn.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz";

const CACHE_TTL_MS = 60_000;

const CACHE_MAX_ENTRIES = 50_000;

const PREWARM_IPS = ["8.8.8.8", "1.1.1.1"];

export interface IpLocation {
  countryCode: string | null;
  region: string | null;
  regionCodes: string[];
}

const EMPTY_LOCATION: IpLocation = { countryCode: null, region: null, regionCodes: [] };

let reader: ReaderModel | null = null;

let initPromise: Promise<void> | null = null;

const cache = new Map<string, IpLocation & { cachedAt: number }>();

function cacheGet(ip: string): IpLocation | null {
  const entry = cache.get(ip);

  if (!entry) return null;

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(ip);

    return null;
  }

  return { countryCode: entry.countryCode, region: entry.region, regionCodes: entry.regionCodes };
}

function cacheSet(ip: string, location: IpLocation): void {
  cache.set(ip, { ...location, cachedAt: Date.now() });

  if (cache.size <= CACHE_MAX_ENTRIES) return;

  const overflow = cache.size - CACHE_MAX_ENTRIES;
  let removed = 0;

  for (const key of cache.keys()) {
    cache.delete(key);

    if (++removed >= overflow) break;
  }
}

function lookup(ip: string): IpLocation {
  if (!reader) return EMPTY_LOCATION;

  try {
    const response = reader.city(ip);
    const countryCode = response.country?.isoCode ?? null;

    const regionCodes = countryCode
      ? (response.subdivisions ?? [])
          .map((subdivision) => subdivision.isoCode)
          .filter((code): code is string => Boolean(code))
          .map((code) => `${countryCode}:${code.toUpperCase()}`)
      : [];

    return {
      countryCode,
      region: response.subdivisions?.[0]?.names?.en ?? null,
      regionCodes,
    };
  } catch {
    return EMPTY_LOCATION;
  }
}

export function resolveIpLocation(ip: string): IpLocation {
  const cached = cacheGet(ip);

  if (cached) return cached;

  if (!reader) {
    void initGeoIp();
  }

  const location = lookup(ip);
  cacheSet(ip, location);

  return location;
}

async function downloadDatabase(): Promise<void> {
  await mkdir(DATABASE_DIR, { recursive: true });

  const response = await fetch(DATABASE_URL, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new Error(`GeoIP download failed: ${response.status} ${response.statusText}`);
  }

  const compressed = Buffer.from(await response.arrayBuffer());
  await writeFile(DATABASE_PATH, gunzipSync(compressed));

  logger.info("MaxMind GeoIP database downloaded", { module: "geoip", path: DATABASE_PATH });
}

async function loadReader(): Promise<void> {
  const buffer = await readFile(DATABASE_PATH);
  reader = Reader.openBuffer(buffer);

  logger.info("MaxMind GeoIP database loaded into memory", {
    module: "geoip",
    size: buffer.byteLength,
  });
}

async function reload(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await loadReader();
  cache.clear();
  logger.info("MaxMind GeoIP database reloaded", { module: "geoip" });
}

function watchDatabase(): void {
  try {
    watch(DATABASE_PATH, (event) => {
      if (event !== "change") return;
      reload().catch((error) =>
        logger.error(
          "Failed to reload GeoIP database",
          { module: "geoip" },
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    });
  } catch (error) {
    logger.warn(
      "Could not watch GeoIP database for changes",
      { module: "geoip" },
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

export function initGeoIp(): Promise<void> {
  initPromise ??= (async () => {
    try {
      if (!existsSync(DATABASE_PATH)) {
        await downloadDatabase();
      }

      await loadReader();

      for (const ip of PREWARM_IPS) {
        cacheSet(ip, lookup(ip));
      }

      watchDatabase();
    } catch (error) {
      logger.error(
        "Failed to initialise GeoIP database; lookups will return null",
        { module: "geoip", path: DATABASE_PATH },
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  })();

  return initPromise;
}
