export const MS_TO_KT = 1.94384;

// Curva critica amarillo/rojo: V = C1 + K/(dP - X0), V en kt y dP en hPa.
export const NO_WAVE = 20;
export const CURVE_C1 = 13.1;
export const CURVE_K = 307;
export const CURVE_X0 = 1.1;

export type Diag = 'none' | 'light' | 'strong';

export const curveWind = (dp: number): number =>
    CURVE_C1 + CURVE_K / Math.max(dp - CURVE_X0, 0.1);

export const classify = (crossWindKt: number, dPressure: number): Diag => {
    if (crossWindKt < NO_WAVE) return 'none';
    return crossWindKt >= curveWind(dPressure) ? 'strong' : 'light';
};

/** Componente positiva Chile->Argentina, normal a una cresta expresada como rumbo. */
export const crossBarrierWindKt = (
    uEastMs: number,
    vNorthMs: number,
    crestBearingDeg: number,
): number => {
    const bearingRad = (crestBearingDeg * Math.PI) / 180;
    const nx = Math.cos(bearingRad);
    const ny = -Math.sin(bearingRad);
    return (uEastMs * nx + vNorthMs * ny) * MS_TO_KT;
};

export interface PressureLevelHeight {
    pressureHpa: number;
    heightM: number;
}

/**
 * Estima la presion en una elevacion interpolando ln(p) entre alturas geopotenciales.
 * Extrapola con los dos niveles mas cercanos cuando la superficie cae fuera del rango.
 */
export const pressureAtElevationHpa = (
    levels: PressureLevelHeight[],
    elevationM: number,
): number | null => {
    const valid = levels
        .filter(l => Number.isFinite(l.pressureHpa) && Number.isFinite(l.heightM))
        .sort((a, b) => a.heightM - b.heightM);
    if (valid.length < 2 || !Number.isFinite(elevationM)) return null;

    let lower = valid[0];
    let upper = valid[1];
    if (elevationM >= valid[valid.length - 1].heightM) {
        lower = valid[valid.length - 2];
        upper = valid[valid.length - 1];
    } else {
        for (let i = 0; i < valid.length - 1; i++) {
            if (elevationM >= valid[i].heightM && elevationM <= valid[i + 1].heightM) {
                lower = valid[i];
                upper = valid[i + 1];
                break;
            }
        }
    }
    const dz = upper.heightM - lower.heightM;
    if (dz <= 0) return null;
    const f = (elevationM - lower.heightM) / dz;
    return Math.exp(
        Math.log(lower.pressureHpa) + f * (Math.log(upper.pressureHpa) - Math.log(lower.pressureHpa)),
    );
};

/**
 * Ajuste altimetrico/QNH a partir de presion de estacion y elevacion, usando la
 * atmosfera estandar empleada por NWS (T0=288 K, gradiente 0,0065 K/m).
 */
export const qnhFromStationPressureHpa = (
    stationPressureHpa: number,
    elevationM: number,
): number => {
    const base = 288 / (288 - 0.0065 * Math.max(0, elevationM));
    return stationPressureHpa * Math.pow(base, 5.2561);
};

export interface LatLonLike {
    lat: number;
    lon: number;
}

export const greatCircleDistanceNm = (a: LatLonLike, b: LatLonLike): number => {
    const earthRadiusNm = 3440.065;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRad(b.lon - a.lon);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * earthRadiusNm * Math.asin(Math.sqrt(h));
};
