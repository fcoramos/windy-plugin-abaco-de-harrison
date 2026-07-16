import type { LatLon } from '@windy/interfaces.d';
import type { Timestamp } from '@windy/types.d';
import { getEcmwfMeteogram, getEcmwfPointForecast } from './windyData';
import { richardsonNumber, scorerParameter, trappingExcess } from './profileMath';

/**
 * Perfil vertical (corte transversal) SCL -> MDZ.
 *
 * Diagnostico por capa (entre niveles estandar 1000-300 hPa):
 *
 *  1) Estabilidad estatica:  N^2 = (g/theta) * (d theta / dz)
 *     N^2 < 0  -> inestabilidad estatica (convectiva) -> turbulencia fuerte.
 *
 *  2) Inestabilidad dinamica (Kelvin-Helmholtz): numero de Richardson del gradiente
 *     Ri = N^2 / |dV/dz|^2.
 *     Ri < 0.25 -> dinamicamente inestable (AMS Glossary "gradient/critical Richardson
 *     number"; Miles 1961 / Howard 1961: condicion necesaria de inestabilidad) -> fuerte.
 *     0.25 <= Ri < 1 -> ligera (histeresis documentada: la turbulencia puede persistir
 *     hasta Ri ~ 1; AMS Glossary "critical Richardson number").
 *     NOTA: el criterio 0.25 es para gradientes locales; promediado en capas de
 *     0.7-2 km el Ri queda sesgado al alza -> diagnostico conservador.
 *
 *  3) Numero de Scorer:  l^2(z) = N^2/U^2 - (1/U)(d2U/dz2)   [Scorer 1949, ec. 13;
 *     AMS Glossary "Scorer parameter"], con U = componente zonal (perpendicular a una
 *     cordillera N-S). Condicion de onda atrapada de dos capas [Scorer 1949, ec. 17]:
 *         l1^2 - l2^2 > pi^2 / (4 h^2)
 *     con h = profundidad de la capa inferior sobre el terreno local. Aqui l1^2 y l2^2
 *     se aproximan como promedios ponderados por espesor bajo y sobre cada interfase
 *     candidata. Donde se cumple (con forzamiento de cresta >= CREST_WIND_MIN) se marca
 *     la interfase de atrapamiento y la capa inmediatamente inferior se clasifica al
 *     menos como ligera (zona de onda atrapada / rotores).
 *
 *  4) Nivel critico: |U| < CRITICAL_U por encima del nivel de cresta con forzamiento
 *     abajo -> absorcion / rompimiento de onda -> fuerte.
 *
 * Limitaciones: producto heuristico derivado del ECMWF global; no resuelve el
 * rompimiento de onda ni rotores explicitamente. El umbral de forzamiento (~25 kt) es
 * una regla operativa, no un resultado teorico. Se asume temperatura del meteograma en
 * K (conversion defensiva si llega en C) y viento en m/s.
 */

export const PROFILE_LEVELS = [
    '1000h',
    '925h',
    '850h',
    '700h',
    '600h',
    '500h',
    '400h',
    '300h',
    '200h',
    '150h',
] as const;

export type Lvl = (typeof PROFILE_LEVELS)[number];

const LEVEL_HPA: Record<Lvl, number> = {
    '1000h': 1000,
    '925h': 925,
    '850h': 850,
    '700h': 700,
    '600h': 600,
    '500h': 500,
    '400h': 400,
    '300h': 300,
    '200h': 200,
    '150h': 150,
};

const G = 9.80665;
const KAPPA = 0.2854; // R/cp (aire seco)

// ---- Umbrales (ver documentacion en el popup del plugin) ----
export const RI_STRONG = 0.25; // Ri critico (AMS; Miles/Howard 1961)
export const RI_LIGHT = 1.0; // histeresis turbulenta hasta Ri ~ 1 (AMS)
export const CREST_WIND_MIN = 13; // m/s (~25 kt) forzamiento de cresta - regla operativa
export const CRITICAL_U = 2; // m/s - nivel critico (U -> 0)
const FETCH_CONCURRENCY = 4;

export type TurbClass = 'none' | 'light' | 'strong';

export interface WaypointRaw {
    lat: number;
    lon: number;
    frac: number; // 0 en SCL, 1 en MDZ
    hours: Timestamp[];
    terrainM: number[]; // gh-surface por hora (m); puede venir vacio
    modelElevM: number | null; // elevacion de la grilla del modelo (header del point forecast)
    rh: Record<string, number[]>;
    gh: Record<string, number[]>;
    u: Record<string, number[]>;
    v: Record<string, number[]>;
    temp: Record<string, number[]>;
    ts: Timestamp[]; // del point forecast
    mm: number[]; // precip por paso (mm)
}

export interface CrossCell {
    lvlBottom: Lvl; // nivel de presion del borde inferior de la capa
    tMeanK: number; // temperatura media de la capa (K), para el proxy de engelamiento
    altBottomM: number;
    altTopM: number;
    rh: number; // %
    shear: number; // 1/s
    n2: number; // s^-2
    ri: number; // adimensional
    uMid: number; // m/s, componente zonal media de la capa
    l2: number | null; // m^-2 (null si |U| ~ 0: nivel critico potencial)
    turb: TurbClass;
}

export interface CrossColumn {
    frac: number;
    terrainM: number;
    precipMm: number;
    crestU: number; // m/s, componente zonal max entre 700 y 600 hPa
    trappedAltM: number | null; // altitud de la interfase de atrapamiento (Scorer ec. 17)
    freezingM: number | null; // altitud de la isoterma 0 C (null si no cruza; terreno si T<0 en superficie)
    tropopauseM: number | null; // tropopausa termica (aprox. OMM 1957, capas gruesas)
    cells: CrossCell[];
}

const toK = (t: number): number => (t < 150 ? t + 273.15 : t); // defensivo si viniera en C
const theta = (tK: number, pHpa: number): number => tK * Math.pow(1000 / pHpa, KAPPA);

const nearestIdx = (arr: number[], t: number): number => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
        const d = Math.abs(arr[i] - t);
        if (d < bd) {
            bd = d;
            best = i;
        }
    }
    return best;
};

/** Descarga meteograma (perfil) + point forecast (precip) en N waypoints SCL->MDZ. */
export const loadCrossSection = async (
    scl: LatLon,
    mdz: LatLon,
    nWaypoints: number,
    pluginName: string,
): Promise<WaypointRaw[]> => {
    const wps: { wp: LatLon; frac: number }[] = [];
    for (let i = 0; i < nWaypoints; i++) {
        const f = i / (nWaypoints - 1);
        wps.push({
            wp: { lat: scl.lat + f * (mdz.lat - scl.lat), lon: scl.lon + f * (mdz.lon - scl.lon) },
            frac: f,
        });
    }

    const results: Array<WaypointRaw | null> = new Array(wps.length).fill(null);
    let cursor = 0;
    const worker = async () => {
        while (cursor < wps.length) {
            const index = cursor++;
            const { wp, frac } = wps[index];
            try {
                const meteo = await getEcmwfMeteogram(wp);
                const point = await getEcmwfPointForecast(wp, pluginName).catch(error => {
                    console.warn('[zonda] precipitacion puntual no disponible:', error);
                    return null;
                });
                const m = meteo.data.data as unknown as Record<string, number[]> & {
                    hours: Timestamp[];
                };
                const rh: Record<string, number[]> = {};
                const gh: Record<string, number[]> = {};
                const u: Record<string, number[]> = {};
                const v: Record<string, number[]> = {};
                const temp: Record<string, number[]> = {};
                for (const lvl of PROFILE_LEVELS) {
                    rh[lvl] = m[`rh-${lvl}`] ?? [];
                    gh[lvl] = m[`gh-${lvl}`] ?? [];
                    u[lvl] = m[`wind_u-${lvl}`] ?? [];
                    v[lvl] = m[`wind_v-${lvl}`] ?? [];
                    temp[lvl] = m[`temp-${lvl}`] ?? [];
                }
                const pd = point?.data.data as
                    | { ts: Timestamp[]; mm?: number[] }
                    | undefined;
                const meteoHeader = meteo.data.header as {
                    elevation?: number;
                    modelElevation?: number;
                };
                const pointHeader = point?.data.header as
                    | { elevation?: number; modelElevation?: number }
                    | undefined;
                results[index] = {
                    lat: wp.lat,
                    lon: wp.lon,
                    frac,
                    hours: m.hours,
                    terrainM: m['gh-surface'] ?? [],
                    modelElevM:
                        meteoHeader.modelElevation ??
                        pointHeader?.modelElevation ??
                        meteoHeader.elevation ??
                        pointHeader?.elevation ??
                        null,
                    rh,
                    gh,
                    u,
                    v,
                    temp,
                    ts: pd?.ts ?? m.hours,
                    mm: pd?.mm ?? [],
                } as WaypointRaw;
            } catch (error) {
                console.warn('[zonda] columna del perfil no disponible:', wp, error);
            }
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(FETCH_CONCURRENCY, wps.length) }, () => worker()),
    );
    return results.filter((result): result is WaypointRaw => result != null);
};

interface LevelSample {
    lvl: Lvl;
    z: number; // m
    u: number; // m/s (zonal)
    v: number; // m/s (meridional)
    tK: number; // K (temperatura real)
    th: number; // K (temperatura potencial)
    rh: number; // %
}

/** Extrae y diagnostica la columna de cada waypoint para el timestamp seleccionado. */
export const sliceCrossSection = (raw: WaypointRaw[], ts: Timestamp): CrossColumn[] =>
    raw.map(w => {
        const hi = nearestIdx(w.hours as number[], ts);
        const pi = nearestIdx(w.ts as number[], ts);
        const ghs = w.terrainM[hi];
        const terrainM = ghs != null && ghs > 1 ? ghs : (w.modelElevM ?? 0);

        // ---- niveles validos, ordenados de abajo hacia arriba ----
        const levels: LevelSample[] = [];
        for (const lvl of PROFILE_LEVELS) {
            const z = w.gh[lvl]?.[hi];
            const u = w.u[lvl]?.[hi];
            const v = w.v[lvl]?.[hi];
            const t = w.temp[lvl]?.[hi];
            if (z == null || u == null || v == null || t == null) continue;
            const tk = toK(t);
            levels.push({ lvl, z, u, v, tK: tk, th: theta(tk, LEVEL_HPA[lvl]), rh: w.rh[lvl]?.[hi] ?? 0 });
        }

        // ---- curvatura d2U/dz2 en niveles interiores (dif. centradas, paso desigual) ----
        const upp: (number | null)[] = levels.map((_, k) => {
            if (k === 0 || k === levels.length - 1) return null;
            const zm = levels[k - 1].z,
                z0 = levels[k].z,
                zp = levels[k + 1].z;
            const d1 = z0 - zm,
                d2 = zp - z0,
                D = zp - zm;
            if (d1 <= 0 || d2 <= 0) return null;
            return (
                2 *
                (levels[k - 1].u / (d1 * D) - levels[k].u / (d1 * d2) + levels[k + 1].u / (d2 * D))
            );
        });

        // ---- capas ----
        const cells: CrossCell[] = [];
        for (let j = 0; j < levels.length - 1; j++) {
            const a = levels[j],
                b = levels[j + 1];
            const dz = b.z - a.z;
            if (dz <= 0) continue;
            if (b.z <= terrainM + 1) continue; // capa completamente bajo tierra (extrapolada)
            const thMean = (a.th + b.th) / 2;
            const n2 = (G / thMean) * ((b.th - a.th) / dz);
            const su = (b.u - a.u) / dz;
            const sv = (b.v - a.v) / dz;
            const shear = Math.hypot(su, sv);
            const ri = richardsonNumber(n2, shear);
            const uMid = (a.u + b.u) / 2;
            const c1 = upp[j],
                c2 = upp[j + 1];
            const curv = c1 != null && c2 != null ? (c1 + c2) / 2 : (c1 ?? c2 ?? 0);
            const l2 = scorerParameter(n2, uMid, curv);

            let turb: TurbClass = 'none';
            if (n2 < 0) turb = 'strong'; // inestabilidad estatica
            else if (ri < RI_STRONG) turb = 'strong'; // KH
            else if (ri < RI_LIGHT) turb = 'light';

            cells.push({
                lvlBottom: a.lvl,
                tMeanK: (a.tK + b.tK) / 2,
                altBottomM: Math.max(a.z, terrainM),
                altTopM: b.z,
                rh: (a.rh + b.rh) / 2,
                shear,
                n2,
                ri,
                uMid,
                l2,
                turb,
            });
        }

        // ---- forzamiento de cresta: componente zonal max entre 700 y 600 hPa ----
        const u700 = levels.find(l => l.lvl === '700h')?.u ?? -Infinity;
        const u600 = levels.find(l => l.lvl === '600h')?.u ?? -Infinity;
        const crestU = Math.max(u700, u600);
        const z600 = levels.find(l => l.lvl === '600h')?.z ?? terrainM + 3500;

        // ---- nivel critico: |U|~0 sobre la cresta con onda forzada abajo ----
        if (crestU >= CREST_WIND_MIN) {
            for (const c of cells) {
                if (c.altBottomM >= z600 && Math.abs(c.uMid) < CRITICAL_U) {
                    c.turb = 'strong';
                }
            }
        }

        // ---- tropopausa termica (aprox. OMM 1957 sobre capas gruesas) ----
        // Gradiente Gamma_j = -(dT/dz) por capa; primer punto sobre ~4.5 km donde
        // Gamma cae a <= 2 K/km y la capa siguiente (si esta a < 2.5 km) lo mantiene.
        let tropopauseM: number | null = null;
        {
            const lapses = levels.slice(0, -1).map((a, j) => {
                const b = levels[j + 1];
                return {
                    zm: (a.z + b.z) / 2,
                    lapse: ((a.tK - b.tK) / Math.max(b.z - a.z, 1)) * 1000,
                };
            });
            for (let j = 1; j < lapses.length; j++) {
                const cur = lapses[j];
                if (cur.zm < 4500 || cur.lapse > 2) continue;
                const nxt = lapses[j + 1];
                if (nxt && nxt.zm - cur.zm < 2500 && nxt.lapse > 2) continue; // no se sostiene
                const prev = lapses[j - 1];
                tropopauseM =
                    prev.lapse > 2
                        ? prev.zm + ((prev.lapse - 2) / (prev.lapse - cur.lapse)) * (cur.zm - prev.zm)
                        : cur.zm;
                break;
            }
            if (tropopauseM == null) {
                // Fallback: si el criterio estricto OMM no resuelve (capas gruesas,
                // inversiones), se toma el minimo del gradiente sobre 7 km si es < 4 K/km.
                let best: { zm: number; lapse: number } | null = null;
                for (const lp of lapses) {
                    if (lp.zm < 7000) continue;
                    if (!best || lp.lapse < best.lapse) best = lp;
                }
                if (best && best.lapse < 4) tropopauseM = best.zm;
            }
        }

        // ---- Scorer ec. (17): interfase de atrapamiento ----
        let trappedAltM: number | null = null;
        if (crestU >= CREST_WIND_MIN && cells.length >= 2) {
            let best = 0;
            let bestJ = -1;
            for (let j = 0; j < cells.length - 1; j++) {
                const h = cells[j].altTopM - terrainM; // profundidad capa inferior
                if (h <= 200) continue;
                const tropo = (c: CrossCell) => c.altBottomM < (tropopauseM ?? 11000);
                if (!tropo(cells[j])) break; // solo interfases dentro de la troposfera
                const lower = weightedL2(cells.slice(0, j + 1).filter(tropo));
                const upper = weightedL2(cells.slice(j + 1).filter(tropo));
                if (lower == null || upper == null) continue;
                const excess = trappingExcess(lower, upper, h);
                if (excess > 0 && excess > best) {
                    best = excess;
                    bestJ = j;
                }
            }
            if (bestJ >= 0) {
                trappedAltM = cells[bestJ].altTopM;
                // zona de onda atrapada / rotores bajo la interfase ganadora
                if (cells[bestJ].turb === 'none') cells[bestJ].turb = 'light';
            }
        }

        // ---- isoterma 0 C: primer cruce T=273.15 K de abajo hacia arriba ----
        let freezingM: number | null = null;
        if (levels.length) {
            if (levels[0].tK <= 273.15) {
                freezingM = terrainM; // congelacion en superficie
            } else {
                for (let j = 0; j < levels.length - 1; j++) {
                    const a = levels[j],
                        b = levels[j + 1];
                    if (a.tK > 273.15 && b.tK <= 273.15) {
                        const f = (a.tK - 273.15) / (a.tK - b.tK);
                        freezingM = a.z + f * (b.z - a.z);
                        break;
                    }
                }
            }
        }

        return {
            frac: w.frac,
            terrainM,
            precipMm: w.mm[pi] ?? 0,
            crestU,
            trappedAltM,
            freezingM,
            tropopauseM,
            cells,
        };
    });

/** Promedio de l2 ponderado por espesor de capa (ignora capas con l2 null). */
const weightedL2 = (cs: CrossCell[]): number | null => {
    let sw = 0;
    let s = 0;
    for (const c of cs) {
        if (c.l2 == null) continue;
        const w = c.altTopM - c.altBottomM;
        sw += w;
        s += c.l2 * w;
    }
    return sw > 0 ? s / sw : null;
};
