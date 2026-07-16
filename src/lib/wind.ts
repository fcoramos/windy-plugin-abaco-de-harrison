import type { LatLon } from '@windy/interfaces.d';
import type { Timestamp } from '@windy/types.d';
import { getEcmwfMeteogram } from './windyData';
import {
    crossBarrierWindKt,
    pressureAtElevationHpa,
    qnhFromStationPressureHpa,
    type PressureLevelHeight,
} from './calculations';
export {
    classify,
    curveWind,
    NO_WAVE,
    CURVE_C1,
    CURVE_K,
    CURVE_X0,
    MS_TO_KT,
} from './calculations';
export type { Diag } from './calculations';

export interface ZondaPoint {
    ts: Timestamp;
    pWestHpa: number;   // QNH modelado en SCL (hPa)
    pEastHpa: number;   // QNH modelado en MDZ (hPa)
    dPressure: number;  // QNH SCL - QNH MDZ (hPa)
    crossWindKt: number; // componente perpendicular a la cordillera en 500 hPa (kt)
}

/** Punto muestreado + etiqueta temporal, compartido entre el grafico y la tabla. */
export interface ZondaSample extends ZondaPoint {
    label: string;
    isNow: boolean;
}

interface PressurePair {
    pW: number; // QNH modelado en SCL (hPa)
    pE: number; // QNH modelado en MDZ (hPa)
    diff: number; // QNH SCL - QNH MDZ (hPa)
}

const QNH_LEVELS_HPA = [1000, 950, 925, 900, 850, 800, 700, 600, 500];

type MeteogramData = Record<string, number[]> & { hours: Timestamp[] };

/** Deriva QNH desde la presion en la elevacion del modelo y la atmosfera estandar. */
const qnhSeries = (
    data: MeteogramData,
    modelElevationM: number,
): Map<Timestamp, number> => {
    const out = new Map<Timestamp, number>();
    data.hours.forEach((ts, i) => {
        const levels: PressureLevelHeight[] = QNH_LEVELS_HPA.flatMap(pressureHpa => {
            const heightM = data[`gh-${pressureHpa}h`]?.[i];
            return heightM == null ? [] : [{ pressureHpa, heightM }];
        });
        const stationPressureHpa = pressureAtElevationHpa(levels, modelElevationM);
        if (stationPressureHpa != null) {
            out.set(ts, qnhFromStationPressureHpa(stationPressureHpa, modelElevationM));
        }
    });
    return out;
};

const qnhPairs = (
    west: Map<Timestamp, number>,
    east: Map<Timestamp, number>,
): Map<Timestamp, PressurePair> => {
    const out = new Map<Timestamp, PressurePair>();
    for (const [ts, pW] of west) {
        const pE = east.get(ts);
        if (pE != null) out.set(ts, { pW, pE, diff: pW - pE });
    }
    return out;
};

/**
 * Componente del viento perpendicular a la cordillera en 500 hPa (kt).
 * crestBearingDeg = orientacion de la cresta; la normal esta a +90 grados.
 * Positivo cuando el viento sopla desde el oeste (Chile) hacia el este (Argentina).
 */
const crossBarrierWind = (
    meteogram: Record<string, number[]> & { hours: Timestamp[] },
    crestBearingDeg: number,
): Map<Timestamp, number> => {
    const u = meteogram['wind_u-500h']; // m/s hacia el este
    const v = meteogram['wind_v-500h']; // m/s hacia el norte
    const hours = meteogram.hours;
    // Normal a la cresta en convencion de RUMBO (compas, horario desde el norte).
    // Cresta con rumbo B -> direccion de cresta (E,N) = (sin B, cos B);
    // su normal es (cos B, -sin B). Para una cresta N-S (crestBearingDeg = 0) la
    // normal apunta al ESTE, por lo que la componente perpendicular es la U
    // (oeste->este). Positivo = viento del oeste (Chile) hacia el este (Argentina).
    // [FIX] La version anterior usaba (crestBearingDeg + 90) con convencion
    // matematica, lo que para B=0 seleccionaba la componente N-S (a lo largo de la
    // cresta) en vez de la perpendicular. Contradecia el comentario de "positivo O->E".
    const out = new Map<Timestamp, number>();
    hours.forEach((ts, i) => {
        if (u?.[i] != null && v?.[i] != null) {
            out.set(ts, crossBarrierWindKt(u[i], v[i], crestBearingDeg));
        }
    });
    return out;
};

/** Carga y fusiona todos los datos en una serie ordenada por tiempo. */
export const loadZondaData = async (
    pointWest: LatLon,
    pointEast: LatLon,
    pointUpper: LatLon,
    crestBearingDeg: number,
): Promise<ZondaPoint[]> => {
    const [west, east, upper] = await Promise.all([
        getEcmwfMeteogram(pointWest),
        getEcmwfMeteogram(pointEast),
        getEcmwfMeteogram(pointUpper),
    ]);

    const westHeader = west.data.header as { modelElevation?: number; elevation?: number };
    const eastHeader = east.data.header as { modelElevation?: number; elevation?: number };
    const westData = west.data.data as unknown as MeteogramData;
    const eastData = east.data.data as unknown as MeteogramData;
    const upperData = upper.data.data as unknown as MeteogramData;
    const westQnh = qnhSeries(westData, westHeader.modelElevation ?? westHeader.elevation ?? 0);
    const eastQnh = qnhSeries(eastData, eastHeader.modelElevation ?? eastHeader.elevation ?? 0);
    const dP = qnhPairs(westQnh, eastQnh);
    const cw = crossBarrierWind(upperData, crestBearingDeg);

    const series: ZondaPoint[] = [];
    for (const [ts, pair] of dP) {
        let crossWindKt = cw.get(ts);
        if (crossWindKt === undefined) {
            // El meteograma puede tener paso distinto: tomamos el valor mas cercano.
            let best = Infinity;
            for (const [t, val] of cw) {
                const d = Math.abs(t - ts);
                if (d < best) { best = d; crossWindKt = val; }
            }
        }
        if (crossWindKt !== undefined) {
            series.push({
                ts,
                pWestHpa: pair.pW,
                pEastHpa: pair.pE,
                dPressure: pair.diff,
                crossWindKt,
            });
        }
    }
    return series.sort((a, b) => a.ts - b.ts);
};
