<div class="mt-15">
    {#if loading}
        <p class="xsec-status" role="status">{lang === 'es' ? 'Cargando perfil vertical…' : 'Loading vertical profile…'}</p>
    {:else if loadError}
        <p class="xsec-status error" role="alert">
            {lang === 'es' ? 'No se pudo cargar el perfil vertical.' : 'The vertical profile could not be loaded.'}
            <button on:click={refresh}>{lang === 'es' ? 'Reintentar' : 'Retry'}</button>
        </p>
    {:else if raw.length > 0 && raw.length < N}
        <p class="xsec-status warning" role="status">
            {lang === 'es'
                ? `Perfil parcial: ${raw.length} de ${N} columnas disponibles.`
                : `Partial profile: ${raw.length} of ${N} columns available.`}
        </p>
    {/if}
    <svg bind:this={svgEl}></svg>
    <div class="xsec-legend">
        <span><i class="sw terr"></i>{t.terrain}</span>
        <span><i class="sw cloud"></i>{t.clouds}</span>
        <span><i class="sw precip"></i>{t.precip}</span>
        <span><i class="sw icing"></i>{t.icing}</span>
        <span><i class="sw turbl"></i>{t.turbL}</span>
        <span><i class="sw turbs"></i>{t.turbS}</span>
        <span><i class="ln zero"></i>{t.zero}</span>
        <span><i class="ln trop"></i>{t.trop}</span>
        <span><i class="ln wave"></i>{t.wave}</span>
    </div>
</div>

<script lang="ts">
    import { select, scaleLinear, area, line, range } from 'd3';
    import { onMount, onDestroy } from 'svelte';
    import store from '@windy/store';
    import {
        loadCrossSection,
        sliceCrossSection,
        PROFILE_LEVELS,
        type WaypointRaw,
        type CrossColumn,
        type CrossCell,
        type TurbClass,
    } from './lib/profile';
    import { greatCircleDistanceNm } from './lib/calculations';
    import { PLUGIN_ACTIVE_EVENT } from './lib/lifecycle';
    import type { LatLon } from '@windy/interfaces.d';

    export let scl: LatLon;
    export let mdz: LatLon;
    export let nameOfThisPlugin: string;
    export let lang: 'es' | 'en' = 'es';
    export let instanceId: number;
    export let reversed = false;

    const N = 14; // columnas de datos SCL->MDZ (2 fetches por columna)
    const NS = 88; // franjas de render (interpolacion lineal entre columnas)
    const M2FT = 3.28084;
    const MAX_FT = 45000; // ~FL450; los datos llegan a 150 hPa (~44.600 ft)

    const L = {
        es: {
            terrain: 'Terreno',
            clouds: 'Nubes (HR)',
            precip: 'Precipitación',
            icing: 'Engelamiento (proxy)',
            turbL: 'Turb. ligera',
            turbS: 'Turb. fuerte',
            zero: 'Isoterma 0 °C',
            trop: 'Tropopausa',
            wave: 'Atrapamiento (Scorer)',
            alt: 'Altitud (hFt)',
        },
        en: {
            terrain: 'Terrain',
            clouds: 'Clouds (RH)',
            precip: 'Precipitation',
            icing: 'Icing (proxy)',
            turbL: 'Light turb.',
            turbS: 'Strong turb.',
            zero: '0 °C isotherm',
            trop: 'Tropopause',
            wave: 'Wave trapping (Scorer)',
            alt: 'Altitude (hFt)',
        },
    };
    $: t = L[lang];

    let svgEl: SVGSVGElement;
    let raw: WaypointRaw[] = [];
    let subscriptionId: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let loading = true;
    let loadError: unknown = null;
    let refreshSequence = 0;

    const refresh = () => {
        if (!scl) return;
        const sequence = ++refreshSequence;
        loading = true;
        loadError = null;
        loadCrossSection(scl, mdz, N, nameOfThisPlugin)
            .then(r => {
                if (sequence !== refreshSequence) return;
                raw = r;
                draw();
            })
            .catch(err => {
                if (sequence !== refreshSequence) return;
                loadError = err;
                console.error('[zonda] perfil vertical:', err);
            })
            .finally(() => {
                if (sequence === refreshSequence) loading = false;
            });
    };

    const releaseResources = () => {
        refreshSequence++;
        if (subscriptionId != null) {
            store.off(subscriptionId);
            subscriptionId = undefined;
        }
        resizeObserver?.disconnect();
        resizeObserver = undefined;
    };
    const handleActiveInstance = (event: Event) => {
        if ((event as CustomEvent<number>).detail !== instanceId) releaseResources();
    };

    onMount(() => {
        window.addEventListener(PLUGIN_ACTIVE_EVENT, handleActiveInstance);
        refresh();
        subscriptionId = store.on('timestamp', () => draw());
        resizeObserver = new ResizeObserver(() => draw());
        resizeObserver.observe(svgEl);
    });
    onDestroy(() => {
        window.removeEventListener(PLUGIN_ACTIVE_EVENT, handleActiveInstance);
        releaseResources();
    });

    $: if (svgEl && lang && reversed != null) draw();

    const SEV: Record<TurbClass, number> = { none: 0, light: 1, strong: 2 };
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
    /** Interpola valores opcionales: si falta un lado, usa el otro. */
    const lerpN = (a: number | null, b: number | null, f: number): number | null =>
        a == null ? b : b == null ? a : lerp(a, b, f);

    const draw = () => {
        if (!svgEl) return;
        const l = L[lang];
        select(svgEl).selectAll('*').remove();

        const margin = { top: 14, right: 12, bottom: 44, left: 46 };
        const width = svgEl.clientWidth - margin.left - margin.right;
        const height = svgEl.clientHeight - margin.top - margin.bottom;
        const svg = select(svgEl);
        const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        // ---- defs: tramas de turbulencia y desenfoque de nubes ----
        const defs = svg.append('defs');
        const mkHatch = (id: string, color: string, w: number, angle = 45) => {
            defs.append('pattern')
                .attr('id', id).attr('width', 7).attr('height', 7)
                .attr('patternUnits', 'userSpaceOnUse')
                .attr('patternTransform', `rotate(${angle})`)
                .append('line')
                .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 7)
                .attr('stroke', color).attr('stroke-width', w);
        };
        mkHatch('zonda-turbl', '#e8a01f', 2);
        mkHatch('zonda-turbs', '#e8442a', 3);
        mkHatch('zonda-icing', '#56c8e8', 2, -45);
        defs.append('filter')
            .attr('id', 'zonda-cloudblur')
            .attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%')
            .append('feGaussianBlur')
            .attr('stdDeviation', 4);

        const x = scaleLinear().domain([0, 1]).range([0, width]);
        const y = scaleLinear().domain([0, MAX_FT]).range([height, 0]);
        const yM = (m: number) => y(Math.max(0, Math.min(m * M2FT, MAX_FT)));

        // Fondo cielo
        g.append('rect').attr('width', width).attr('height', height).attr('fill', '#0d1622');

        // Rejilla + eje en cientos de pies (hFt), cada 5000 ft
        range(0, MAX_FT + 1, 5000).forEach(a => {
            g.append('line')
                .attr('x1', 0).attr('x2', width).attr('y1', y(a)).attr('y2', y(a))
                .attr('stroke', '#2a3a4d').attr('stroke-width', 0.6);
            g.append('text')
                .attr('x', -6).attr('y', y(a)).attr('text-anchor', 'end')
                .attr('dominant-baseline', 'middle').attr('fill', 'currentColor')
                .attr('font-size', '9px').text(`${a / 100}`);
        });
        g.append('text')
            .attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', -32)
            .attr('text-anchor', 'middle').attr('fill', 'currentColor').attr('font-size', '10px')
            .text(l.alt);

        if (!raw.length) return;

        const now = store.get('timestamp') as number;
        const baseCols = sliceCrossSection(raw, now);
        const cols: CrossColumn[] = reversed
            ? baseCols.slice().reverse().map(col => ({ ...col, frac: 1 - col.frac }))
            : baseCols;
        if (cols.length < 2) return;

        // ---- muestreador interpolado entre columnas ----
        const bracket = (fx: number) => {
            let i = 0;
            if (fx >= cols[cols.length - 1].frac) i = cols.length - 2;
            else {
                for (let j = 0; j < cols.length - 1; j++) {
                    if (fx >= cols[j].frac && fx <= cols[j + 1].frac) {
                        i = j;
                        break;
                    }
                }
            }
            const A = cols[i];
            const B = cols[i + 1];
            const span = B.frac - A.frac;
            const f = span > 0 ? Math.max(0, Math.min(1, (fx - A.frac) / span)) : 0;
            return { A, B, f, i };
        };
        const layerBottoms = PROFILE_LEVELS.slice(0, -1);
        const cellOf = (col: CrossColumn, lv: string): CrossCell | undefined =>
            col.cells.find(c => c.lvlBottom === lv);

        // ---- franjas: nubes + turbulencia (campo continuo) ----
        const gClouds = g.append('g').attr('filter', 'url(#zonda-cloudblur)');
        const stripW = width / NS;
        for (let k = 0; k < NS; k++) {
            const fx = (k + 0.5) / NS;
            const { A, B, f } = bracket(fx);
            const xL = k * stripW;
            for (const lv of layerBottoms) {
                const cA = cellOf(A, lv);
                const cB = cellOf(B, lv);
                if (!cA && !cB) continue;
                const top = lerpN(cA?.altTopM ?? null, cB?.altTopM ?? null, f) as number;
                const bot = lerpN(cA?.altBottomM ?? null, cB?.altBottomM ?? null, f) as number;
                const rh = lerpN(cA?.rh ?? null, cB?.rh ?? null, f) as number;
                const sev = lerpN(
                    cA ? SEV[cA.turb] : null,
                    cB ? SEV[cB.turb] : null,
                    f,
                ) as number;
                const yTop = yM(top);
                const h = Math.max(0, yM(bot) - yTop);
                if (h <= 0) continue;
                const cloud = Math.max(0, Math.min(1, (rh - 70) / 30));
                if (cloud > 0.03) {
                    gClouds.append('rect')
                        .attr('x', xL).attr('y', yTop)
                        .attr('width', stripW + 0.7).attr('height', h)
                        .attr('fill', '#e8eef5')
                        .attr('fill-opacity', 0.12 + cloud * 0.55);
                }
                const tm = lerpN(cA?.tMeanK ?? null, cB?.tMeanK ?? null, f) as number;
                if (cloud > 0.15 && tm <= 273.15 && tm >= 253.15) {
                    g.append('rect')
                        .attr('x', xL).attr('y', yTop)
                        .attr('width', stripW + 0.7).attr('height', h)
                        .attr('fill', 'url(#zonda-icing)')
                        .attr('fill-opacity', 0.85);
                }
                if (sev >= 0.75) {
                    g.append('rect')
                        .attr('x', xL).attr('y', yTop)
                        .attr('width', stripW + 0.7).attr('height', h)
                        .attr('fill', sev >= 1.5 ? 'url(#zonda-turbs)' : 'url(#zonda-turbl)')
                        .attr('fill-opacity', 0.9);
                }
            }
        }

        // ---- precipitacion (por columna de datos, desde la base nubosa) ----
        const colSpacing = width / (N - 1);
        cols.forEach(col => {
            if (col.precipMm <= 0.02) return;
            const cxp = x(col.frac);
            const cloudy = col.cells.filter(c => c.rh >= 70);
            const baseM = cloudy.length
                ? Math.min(...cloudy.map(c => c.altBottomM))
                : col.terrainM + 2500;
            const op = Math.max(0.25, Math.min(0.85, col.precipMm / 3));
            const yBase = yM(Math.max(baseM, col.terrainM + 150));
            const yTerr = yM(col.terrainM);
            for (let k = -2; k <= 2; k++) {
                const xx = cxp + k * (colSpacing / 6);
                g.append('line')
                    .attr('x1', xx).attr('y1', yBase).attr('x2', xx - 4).attr('y2', yTerr)
                    .attr('stroke', '#4ea3ff').attr('stroke-width', 1.4).attr('stroke-opacity', op);
            }
        });

        // ---- lineas interpoladas: isoterma 0 C y tropopausa (antes del terreno) ----
        // La tropopausa puede no resolverse en alguna columna: se rellena interpolando
        // entre vecinas (y extendiendo en los bordes) para que la linea no quede cortada.
        const fillSeries = (vals: (number | null)[]): (number | null)[] => {
            const idx = vals.map((v, i) => (v != null ? i : -1)).filter(i => i >= 0);
            if (!idx.length) return vals;
            return vals.map((v, i) => {
                if (v != null) return v;
                const prev = [...idx].reverse().find(j => j < i);
                const next = idx.find(j => j > i);
                if (prev == null && next == null) return null;
                if (prev == null) return vals[next as number];
                if (next == null) return vals[prev];
                const span = cols[next as number].frac - cols[prev].frac;
                const f = span > 0 ? (cols[i].frac - cols[prev].frac) / span : 0;
                return lerp(vals[prev] as number, vals[next as number] as number, f);
            });
        };
        const tropF = fillSeries(cols.map(cc => cc.tropopauseM));
        const samples = range(0, NS + 1).map(k => {
            const fx = k / NS;
            const { A, B, f, i } = bracket(fx);
            return {
                fx,
                terr: lerp(A.terrainM, B.terrainM, f),
                zero: lerpN(A.freezingM, B.freezingM, f),
                trop: lerpN(tropF[i], tropF[i + 1], f),
            };
        });
        type Smp = (typeof samples)[number];

        g.append('path')
            .datum(samples)
            .attr('fill', 'none')
            .attr('stroke', '#e84040').attr('stroke-width', 1.6)
            .attr('stroke-dasharray', '7,4')
            .attr('d', line<Smp>().defined(s => s.zero != null)
                .x(s => x(s.fx)).y(s => yM(s.zero as number)));

        g.append('path')
            .datum(samples)
            .attr('fill', 'none')
            .attr('stroke', '#cfd048').attr('stroke-width', 1.6)
            .attr('stroke-dasharray', '9,5')
            .attr('d', line<Smp>().defined(s => s.trop != null)
                .x(s => x(s.fx)).y(s => yM(s.trop as number)));
        const lastTrop = [...samples].reverse().find(s => s.trop != null);
        if (lastTrop) {
            g.append('text')
                .attr('x', width - 4).attr('y', yM(lastTrop.trop as number) - 4)
                .attr('text-anchor', 'end').attr('fill', '#cfd048')
                .attr('font-size', '9px').text('Trop.');
        }

        // ---- terreno (opaco, tapa lo anterior bajo su silueta) ----
        g.append('path')
            .datum(samples)
            .attr('fill', '#4a3a2c').attr('stroke', '#0d0d0d').attr('stroke-width', 1.2)
            .attr('d', area<Smp>().x(s => x(s.fx)).y0(height).y1(s => yM(s.terr)));

        // ---- interfase de atrapamiento (Scorer ec. 17) — sobre el terreno ----
        cols.forEach(col => {
            if (col.trappedAltM == null || col.trappedAltM * M2FT > MAX_FT) return;
            const cxp = x(col.frac);
            g.append('line')
                .attr('x1', Math.max(0, cxp - colSpacing * 0.42))
                .attr('x2', Math.min(width, cxp + colSpacing * 0.42))
                .attr('y1', yM(col.trappedAltM)).attr('y2', yM(col.trappedAltM))
                .attr('stroke', '#e84fd0').attr('stroke-width', 2.4)
                .attr('stroke-dasharray', '6,4');
        });

        // ---- eje de distancia: marcas cada 20 NM ----
        const totalDistanceNm = greatCircleDistanceNm(scl, mdz);
        const distanceTicks = range(
            20,
            Math.floor(totalDistanceNm / 20) * 20 + 1,
            20,
        );
        g.append('line')
            .attr('x1', 0).attr('x2', width).attr('y1', height).attr('y2', height)
            .attr('stroke', 'currentColor').attr('stroke-width', 0.8);
        distanceTicks.forEach(distanceNm => {
            const tickX = x(distanceNm / totalDistanceNm);
            g.append('line')
                .attr('x1', tickX).attr('x2', tickX)
                .attr('y1', height).attr('y2', height + 5)
                .attr('stroke', 'currentColor').attr('stroke-width', 0.8);
            g.append('text')
                .attr('x', tickX).attr('y', height + 15).attr('text-anchor', 'middle')
                .attr('fill', 'currentColor').attr('font-size', '9px')
                .text(`${distanceNm} NM`);
        });

        // ---- etiquetas de los extremos ----
        g.append('text').attr('x', 0).attr('y', height + 34).attr('text-anchor', 'start')
            .attr('fill', 'currentColor').attr('font-size', '13px').attr('font-weight', 'bold')
            .text(reversed ? 'MDZ' : 'SCL');
        g.append('text').attr('x', width).attr('y', height + 34).attr('text-anchor', 'end')
            .attr('fill', 'currentColor').attr('font-size', '13px').attr('font-weight', 'bold')
            .text(reversed ? 'SCL' : 'MDZ');
    };
</script>

<style lang="less">
    svg {
        width: 100%;
        height: 320px;
    }
    .xsec-status {
        margin: 8px 0;
        font-size: 12px;
        opacity: 0.9;

        &.error { color: #ffb4a8; }
        &.warning { color: #ffd782; }
        button { margin-left: 8px; }
    }
    .xsec-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
        margin-top: 6px;
        font-size: 11px;
        opacity: 0.9;

        span {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }
        .sw {
            width: 13px;
            height: 13px;
            border-radius: 2px;
            display: inline-block;
        }
        .ln {
            width: 18px;
            height: 0;
            display: inline-block;
        }
        .terr {
            background: #4a3a2c;
        }
        .cloud {
            background: #e8eef5;
            opacity: 0.75;
        }
        .precip {
            background: #4ea3ff;
        }
        .icing {
            background: repeating-linear-gradient(-45deg, #56c8e8 0 2px, transparent 2px 6px);
        }
        .turbl {
            background: repeating-linear-gradient(45deg, #e8a01f 0 2px, transparent 2px 6px);
        }
        .turbs {
            background: repeating-linear-gradient(45deg, #e8442a 0 3px, transparent 3px 6px);
        }
        .zero {
            border-top: 2px dashed #e84040;
        }
        .trop {
            border-top: 2px dashed #cfd048;
        }
        .wave {
            border-top: 2px dashed #e84fd0;
        }
    }
</style>
