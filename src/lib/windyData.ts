import { getMeteogramForecastData, getPointForecastData } from '@windy/fetch';
import type { LatLon } from '@windy/interfaces.d';

type MeteogramPayload = Awaited<ReturnType<typeof getMeteogramForecastData>>;
type PointForecastPayload = Awaited<ReturnType<typeof getPointForecastData>>;

interface CacheEntry<T> {
    expiresAt: number;
    promise: Promise<T>;
}

const CACHE_MS = 5 * 60 * 1000;
const meteogramCache = new Map<string, CacheEntry<MeteogramPayload>>();
const pointCache = new Map<string, CacheEntry<PointForecastPayload>>();

const locationKey = ({ lat, lon }: LatLon): string => `${lat.toFixed(6)},${lon.toFixed(6)}`;

const cached = <T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    loader: () => Promise<T>,
): Promise<T> => {
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.promise;
    const promise = loader().catch(error => {
        cache.delete(key);
        throw error;
    });
    cache.set(key, { expiresAt: Date.now() + CACHE_MS, promise });
    return promise;
};

export const getEcmwfMeteogram = (location: LatLon): Promise<MeteogramPayload> =>
    cached(meteogramCache, locationKey(location), () =>
        getMeteogramForecastData('ecmwf', location),
    );

export const getEcmwfPointForecast = (
    location: LatLon,
    pluginName: string,
): Promise<PointForecastPayload> =>
    cached(pointCache, `${locationKey(location)}:${pluginName}`, () =>
        getPointForecastData('ecmwf', location, { plugin: pluginName }),
    );
