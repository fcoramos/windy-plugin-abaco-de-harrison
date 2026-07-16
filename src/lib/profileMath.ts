export const richardsonNumber = (n2: number, shear: number): number =>
    n2 / Math.max(shear * shear, 1e-10);

export const scorerParameter = (
    n2: number,
    windNormalMs: number,
    windCurvature: number,
): number | null =>
    Math.abs(windNormalMs) < 0.5
        ? null
        : n2 / (windNormalMs * windNormalMs) - windCurvature / windNormalMs;

export const trappingExcess = (
    lowerL2: number,
    upperL2: number,
    lowerLayerDepthM: number,
): number =>
    lowerL2 - upperL2 - (Math.PI * Math.PI) / (4 * lowerLayerDepthM * lowerLayerDepthM);
