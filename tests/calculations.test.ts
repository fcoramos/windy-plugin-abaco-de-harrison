import { describe, expect, it } from 'vitest';
import {
    classify,
    crossBarrierWindKt,
    greatCircleDistanceNm,
    pressureAtElevationHpa,
    qnhFromStationPressureHpa,
} from '../src/lib/calculations';

describe('aviation calculations', () => {
    it('converts station pressure to QNH with the standard atmosphere', () => {
        expect(qnhFromStationPressureHpa(954.5761585, 500)).toBeCloseTo(1013.25, 4);
        expect(qnhFromStationPressureHpa(1000, 0)).toBe(1000);
    });

    it('interpolates pressure logarithmically at model elevation', () => {
        const pressure = pressureAtElevationHpa(
            [
                { pressureHpa: 950, heightM: 500 },
                { pressureHpa: 925, heightM: 750 },
            ],
            625,
        );
        expect(pressure).toBeCloseTo(Math.sqrt(950 * 925), 8);
    });

    it('projects wind perpendicular to a north-south crest', () => {
        expect(crossBarrierWindKt(10, 4, 0)).toBeCloseTo(19.4384, 4);
        expect(crossBarrierWindKt(-10, 4, 0)).toBeCloseTo(-19.4384, 4);
    });

    it('computes the SCL-MDZ great-circle distance', () => {
        const distance = greatCircleDistanceNm(
            { lat: -33.393, lon: -70.786 },
            { lat: -32.831, lon: -68.792 },
        );
        expect(distance).toBeCloseTo(105.8, 1);
    });
});

describe('Harrison classification', () => {
    it('classifies sub-threshold wind as no wave', () => {
        expect(classify(19.9, 30)).toBe('none');
    });

    it('separates light and strong wave across the fitted curve', () => {
        expect(classify(25, 20)).toBe('light');
        expect(classify(30, 30)).toBe('strong');
    });
});
