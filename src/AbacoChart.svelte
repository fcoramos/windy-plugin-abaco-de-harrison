<div class="mt-15">
    {#if loading}
        <p class="chart-status" role="status">{lang === 'es' ? 'Cargando pronóstico…' : 'Loading forecast…'}</p>
    {:else if loadError}
        <p class="chart-status error" role="alert">
            {lang === 'es' ? 'No se pudo cargar el pronóstico.' : 'The forecast could not be loaded.'}
            <button on:click={refresh}>{lang === 'es' ? 'Reintentar' : 'Retry'}</button>
        </p>
    {/if}
    <svg bind:this={svgEl}></svg>
</div>

<script lang="ts">
    import { select, scaleLinear, axisBottom, axisLeft, line, area, range } from 'd3';
    import { onMount, onDestroy, createEventDispatcher } from 'svelte';
    import store from '@windy/store';
    import {
        loadZondaData,
        classify,
        curveWind,
        NO_WAVE,
        CURVE_C1,
        CURVE_K,
        CURVE_X0,
        type ZondaPoint,
        type ZondaSample,
    } from './lib/wind';
    import type { LatLon } from '@windy/interfaces.d';
    import type { Timestamp } from '@windy/types.d';
    import { PLUGIN_ACTIVE_EVENT } from './lib/lifecycle';

    export let pointWest: LatLon;
    export let pointEast: LatLon;
    export let pointUpper: LatLon;
    export let crestBearingDeg: number;
    export let lang: 'es' | 'en' = 'es';
    export let instanceId: number;

    const dispatch = createEventDispatcher<{ points: ZondaSample[] }>();

    let svgEl: SVGSVGElement;
    let series: ZondaPoint[] = [];
    let loading = true;
    let loadError: unknown = null;

    // ---- Dominio del abaco (identico a la imagen) ----
    const X_DOMAIN = [0, 30]; // dP hPa (SCEL - SAME)
    const Y_DOMAIN = [0, 90]; // viento 500 mb (kt)

    // ---- Textos del grafico segun idioma ----
    const L = {
        es: {
            strong: 'ONDA MOD/FUERTE',
            light: 'ONDA LIGERA',
            none: 'NO HAY ONDA',
            xAxis: 'Diferencia de QNH modelado (hPa): Santiago SCEL − Mendoza SAME',
            yAxis: 'VIENTO EN 500 MB (Kt.)',
            tipDp: 'dP',
            tipWind: 'Viento E-O 500hPa',
            tipDiag: 'Diagnostico',
            dNone: 'No hay onda',
            dLight: 'Onda ligera',
            dStrong: 'Onda mod/fuerte',
        },
        en: {
            strong: 'MOD/STRONG WAVE',
            light: 'LIGHT WAVE',
            none: 'NO WAVE',
            xAxis: 'Model-derived QNH difference (hPa): Santiago SCEL − Mendoza SAME',
            yAxis: 'WIND AT 500 MB (kt)',
            tipDp: 'dP',
            tipWind: 'E-W wind 500hPa',
            tipDiag: 'Diagnosis',
            dNone: 'No wave',
            dLight: 'Light wave',
            dStrong: 'Mod/strong wave',
        },
    };

    const diagText = (l: (typeof L)['es'], d: ZondaPoint) => {
        const c = classify(d.crossWindKt, d.dPressure);
        return c === 'strong' ? l.dStrong : c === 'light' ? l.dLight : l.dNone;
    };

    const HOUR = 3600 * 1000;
    let subscriptionId: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let refreshSequence = 0;

    const refresh = () => {
        if (!pointWest) return;
        const sequence = ++refreshSequence;
        loading = true;
        loadError = null;
        loadZondaData(pointWest, pointEast, pointUpper, crestBearingDeg)
            .then(data => {
                if (sequence !== refreshSequence) return;
                series = data;
                draw();
            })
            .catch(err => {
                if (sequence !== refreshSequence) return;
                loadError = err;
                console.error('[zonda] error cargando datos:', err);
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
        subscriptionId = store.on('timestamp', () => draw()); // redibuja al mover el timeline
        resizeObserver = new ResizeObserver(() => draw());
        resizeObserver.observe(svgEl);
    });
    onDestroy(() => {
        window.removeEventListener(PLUGIN_ACTIVE_EVENT, handleActiveInstance);
        releaseResources();
    });

    // Redibuja (con nuevas etiquetas) al cambiar el idioma, sin recargar datos.
    $: if (svgEl && lang) draw();

    /** Interpola linealmente el valor de la serie para un timestamp cualquiera. */
    const sampleAt = (ts: Timestamp): ZondaPoint | null => {
        if (!series.length) return null;
        if (ts < series[0].ts || ts > series[series.length - 1].ts) return null;
        for (let i = 0; i < series.length - 1; i++) {
            const a = series[i], b = series[i + 1];
            if (ts >= a.ts && ts <= b.ts) {
                const f = (ts - a.ts) / (b.ts - a.ts);
                const lerp = (x: number, y: number) => x + f * (y - x);
                return {
                    ts,
                    pWestHpa: lerp(a.pWestHpa, b.pWestHpa),
                    pEastHpa: lerp(a.pEastHpa, b.pEastHpa),
                    dPressure: lerp(a.dPressure, b.dPressure),
                    crossWindKt: lerp(a.crossWindKt, b.crossWindKt),
                };
            }
        }
        return null;
    };

    type Pt = ZondaSample & { idx: number };

    const draw = () => {
        if (!svgEl) return;
        const l = L[lang];
        select(svgEl).selectAll('*').remove();

        const margin = { top: 15, right: 15, bottom: 48, left: 55 };
        const width = svgEl.clientWidth - margin.left - margin.right;
        const height = svgEl.clientHeight - margin.top - margin.bottom;
        const g = select(svgEl).append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        const x = scaleLinear().domain(X_DOMAIN).range([0, width]);
        const y = scaleLinear().domain(Y_DOMAIN).range([height, 0]);

        // ===== 1. REGIONES DE COLOR =====
        g.append('rect').attr('x', 0).attr('y', 0)
            .attr('width', width).attr('height', y(NO_WAVE)).attr('fill', '#FFD400');

        const stepDp = 0.2;
        const redPts: [number, number][] = [];
        for (let dp = X_DOMAIN[0]; dp <= X_DOMAIN[1] + 0.001; dp += stepDp) {
            const w = curveWind(dp);
            if (w < Y_DOMAIN[1]) redPts.push([dp, Math.max(NO_WAVE, w)]);
        }
        const redArea = area<[number, number]>()
            .x(d => x(d[0])).y0(d => y(d[1])).y1(() => y(Y_DOMAIN[1]));
        g.append('path').datum(redPts).attr('fill', '#E8302A').attr('d', redArea);

        g.append('rect').attr('x', 0).attr('y', y(NO_WAVE))
            .attr('width', width).attr('height', height - y(NO_WAVE)).attr('fill', '#5BB8E8');

        // ===== 2. REJILLA =====
        const xTicks = range(0, 31, 5);
        const yTicks = range(0, 91, 10);
        xTicks.forEach(t => g.append('line')
            .attr('x1', x(t)).attr('x2', x(t)).attr('y1', 0).attr('y2', height)
            .attr('stroke', '#666').attr('stroke-width', 0.7));
        yTicks.forEach(t => g.append('line')
            .attr('x1', 0).attr('x2', width).attr('y1', y(t)).attr('y2', y(t))
            .attr('stroke', '#666').attr('stroke-width', 0.7));

        // ===== 3. CURVA DIVISORIA NEGRA =====
        // dP exacto donde la curva alcanza el tope del eje Y (para que la toque sin gap).
        const dpTop = CURVE_X0 + CURVE_K / (Y_DOMAIN[1] - CURVE_C1);
        const curveDomain: number[] = [];
        for (let dp = dpTop; dp < X_DOMAIN[1]; dp += 0.1) curveDomain.push(dp);
        curveDomain.push(X_DOMAIN[1]); // ancla el extremo derecho
        g.append('path').datum(curveDomain).attr('fill', 'none')
            .attr('stroke', 'black').attr('stroke-width', 4).attr('stroke-linejoin', 'round')
            .attr('d', line<number>().x(dp => x(dp)).y(dp => y(Math.min(curveWind(dp), Y_DOMAIN[1]))));

        // ===== 4. ETIQUETAS DE REGIONES =====
        g.append('text').attr('x', x(20)).attr('y', y(80)).attr('text-anchor', 'middle')
            .attr('fill', 'white').attr('font-weight', 'bold').attr('font-size', '15px')
            .text(l.strong);
        g.append('text').attr('x', x(5.5)).attr('y', y(37))
            .attr('fill', 'black').attr('font-weight', 'bold').attr('font-size', '14px')
            .text(l.light);
        g.append('text').attr('x', x(15)).attr('y', y(9)).attr('text-anchor', 'middle')
            .attr('fill', 'black').attr('font-weight', 'bold').attr('font-size', '14px')
            .text(l.none);

        // ===== 5. EJES =====
        g.append('g').attr('transform', `translate(0,${height})`)
            .call(axisBottom(x).tickValues(xTicks).tickFormat(d => `${d}`))
            .selectAll('text').attr('font-weight', 'bold');
        g.append('g').call(axisLeft(y).tickValues(yTicks).tickFormat(d => `${d}`))
            .selectAll('text').attr('font-weight', 'bold');
        g.append('text').attr('x', width / 2).attr('y', height + 42).attr('text-anchor', 'middle')
            .attr('fill', 'currentColor').attr('font-size', '11px')
            .text(l.xAxis);
        g.append('text').attr('transform', 'rotate(-90)').attr('x', -height / 2).attr('y', -42)
            .attr('text-anchor', 'middle').attr('fill', 'currentColor').attr('font-size', '11px')
            .text(l.yAxis);

        // ===== 6. LOS PUNTOS TEMPORALES =====
        const now = store.get('timestamp') as number;
        const offsets = [-6, 0, 6, 12, 18, 24];
        const labels = ['-6h', lang === 'es' ? 'AHORA' : 'NOW', '+6h', '+12h', '+18h', '+24h'];

        const pts: Pt[] = offsets
            .map((h, i) => {
                const s = sampleAt(now + h * HOUR);
                return s ? { ...s, label: labels[i], isNow: h === 0, idx: i } : null;
            })
            .filter((p): p is Pt => p !== null);

        // Publica los puntos para la tabla externa.
        dispatch('points', pts.map(({ idx: _idx, ...rest }) => rest));

        const cx = (v: number) => x(Math.max(X_DOMAIN[0], Math.min(X_DOMAIN[1], v)));
        const cy = (v: number) => y(Math.max(Y_DOMAIN[0], Math.min(Y_DOMAIN[1], v)));

        // Posicion en pixeles de cada punto
        const px = pts.map(d => cx(d.dPressure));
        const py = pts.map(d => cy(d.crossWindKt));

        // Linea que une los instantes
        g.append('path').datum(pts).attr('fill', 'none')
            .attr('stroke', 'white').attr('stroke-width', 2.5).attr('stroke-opacity', 0.9)
            .attr('d', line<Pt>().x((_d, i) => px[i]).y((_d, i) => py[i]));

        // --- Colocacion de etiquetas: junto a cada punto, hacia AFUERA de la
        //     trayectoria (normal a la linea local), no siempre arriba. ---
        const mx = px.reduce((a, b) => a + b, 0) / (px.length || 1);
        const my = py.reduce((a, b) => a + b, 0) / (py.length || 1);
        const DIST = 15;      // separacion etiqueta-marcador (px)
        const DIST_NOW = 19;  // AHORA un poco mas separado

        const placed = pts.map((d, i) => {
            const prev = i > 0 ? i - 1 : i;
            const next = i < px.length - 1 ? i + 1 : i;
            // normal a la tangente de la trayectoria en el punto
            let nx = -(py[next] - py[prev]);
            let ny = px[next] - px[prev];
            const len = Math.hypot(nx, ny);
            if (len < 0.001) { nx = 0; ny = 1; } // punto aislado -> hacia abajo
            else { nx /= len; ny /= len; }
            // orientar hacia afuera del centroide del grupo
            if ((px[i] - mx) * nx + (py[i] - my) * ny < 0) { nx = -nx; ny = -ny; }
            const dist = d.isNow ? DIST_NOW : DIST;
            const lx = Math.max(6, Math.min(width - 6, px[i] + nx * dist));
            const ly = Math.max(10, Math.min(height - 4, py[i] + ny * dist));
            const anchor = nx > 0.35 ? 'start' : nx < -0.35 ? 'end' : 'middle';
            const baseline = ny > 0.35 ? 'hanging' : ny < -0.35 ? 'auto' : 'middle';
            return { lx, ly, anchor, baseline };
        });

        const gp = g.selectAll<SVGGElement, Pt>('.pt').data(pts).join('g');

        // Escala de grises por orden temporal: mas oscuro a medida que avanza la hora.
        // El color del punto y el de su etiqueta coinciden, para leerlos de un vistazo.
        const n = pts.length;
        const shadeOf = (i: number) => {
            const tt = n > 1 ? i / (n - 1) : 0;        // 0 el mas antiguo .. 1 el mas futuro
            const v = Math.round(170 - tt * (170 - 17)); // #aaaaaa -> #111111
            const h = v.toString(16).padStart(2, '0');
            return `#${h}${h}${h}`;
        };
        // AHORA se mantiene distinto (blanco con aro negro); su etiqueta va blanca.
        const fillOf = (d: Pt, i: number) => (d.isNow ? '#ffffff' : shadeOf(i));

        // --- Marcadores ---
        gp.append('circle')
            .attr('cx', (_d, i) => px[i]).attr('cy', (_d, i) => py[i])
            .attr('r', d => (d.isNow ? 9 : 4.5))
            .attr('fill', (d, i) => fillOf(d, i))
            .attr('stroke', d => (d.isNow ? '#000' : 'white'))
            .attr('stroke-width', d => (d.isNow ? 2.5 : 1.5));

        // --- Etiquetas (mismo tono que su punto) ---
        gp.append('text')
            .attr('x', (_d, i) => placed[i].lx)
            .attr('y', (_d, i) => placed[i].ly)
            .attr('text-anchor', (_d, i) => placed[i].anchor)
            .attr('dominant-baseline', (_d, i) => placed[i].baseline)
            .attr('fill', (d, i) => fillOf(d, i))
            .attr('font-size', d => (d.isNow ? '13px' : '11px'))
            .attr('font-weight', d => (d.isNow ? 'bold' : 'normal'))
            // Halo blanco para los grises (legibles sobre amarillo/rojo/azul); halo negro
            // para AHORA, que va en blanco.
            .attr('paint-order', 'stroke')
            .attr('stroke', d => (d.isNow ? '#000' : '#fff'))
            .attr('stroke-width', d => (d.isNow ? 3 : 3.5))
            .attr('stroke-opacity', 0.9)
            .text(d => d.label);

        gp.append('title').text(d =>
            `${d.label}\n${l.tipDp}: ${d.dPressure.toFixed(1)} hPa\n` +
            `${l.tipWind}: ${d.crossWindKt.toFixed(0)} kt\n` +
            `${l.tipDiag}: ${diagText(l, d)}`);
    };
</script>

<style lang="less">
    svg { width: 100%; height: 420px; }
    .chart-status {
        margin: 8px 0;
        font-size: 12px;
        opacity: 0.85;

        &.error { color: #ffb4a8; }
        button { margin-left: 8px; }
    }
</style>
