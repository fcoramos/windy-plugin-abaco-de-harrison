import { describe, expect, it } from 'vitest';
import { richardsonNumber, scorerParameter, trappingExcess } from '../src/lib/profileMath';

describe('vertical profile diagnostics', () => {
    it('computes gradient Richardson number', () => {
        expect(richardsonNumber(0.0001, 0.02)).toBeCloseTo(0.25, 8);
    });

    it('computes Scorer parameter and protects the critical level', () => {
        expect(scorerParameter(0.0001, 10, 0)).toBeCloseTo(0.000001, 10);
        expect(scorerParameter(0.0001, 0.2, 0)).toBeNull();
    });

    it('evaluates the two-layer trapping threshold', () => {
        expect(trappingExcess(2e-6, 1e-7, 2000)).toBeGreaterThan(0);
        expect(trappingExcess(1e-7, 1e-7, 2000)).toBeLessThan(0);
    });
});
