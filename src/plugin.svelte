<div class="plugin__mobile-header">
    {title}
</div>
<svelte:window on:keydown={handleGlobalKeydown} />
<section bind:this={pluginElement} class="plugin__content zonda-plugin">
    <div
        class="plugin__title plugin__title--chevron-back"
        on:click={() => bcast.emit('rqstOpen', 'menu')}
        on:keydown={event => event.key === 'Enter' && bcast.emit('rqstOpen', 'menu')}
        role="button"
        tabindex="0"
    >
        {title}
    </div>

    <div class="zonda-topbar">
        <h2 class="mb-0">{t.heading}</h2>
        <div class="zonda-lang zonda-segmented" role="group" aria-label="language">
            <button aria-pressed={lang === 'es'} class:active={lang === 'es'} on:click={() => (lang = 'es')}>ES</button>
            <button aria-pressed={lang === 'en'} class:active={lang === 'en'} on:click={() => (lang = 'en')}>EN</button>
        </div>
    </div>

    <p class="zonda-intro">{t.intro}</p>

    <p class="zonda-source">
        {t.source.pre}<a href={t.source.url} target="_blank" rel="noopener noreferrer"
            >{t.source.link}</a
        >{t.source.post}
    </p>

    <AbacoChart
        pointWest={locations.SCL}
        pointEast={locations.MDZ}
        pointUpper={locations.JuanFernandez}
        {crestBearingDeg}
        {lang}
        {instanceId}
        on:points={e => (points = e.detail)}
    />

    <!-- ===== Tabla de valores considerados ===== -->
    {#if points.length}
        <table class="zonda-table">
            <thead>
                <tr>
                    <th>{t.th.time}</th>
                    <th>SCL<br /><span class="u">QNH {t.th.hpa}</span></th>
                    <th>MDZ<br /><span class="u">QNH {t.th.hpa}</span></th>
                    <th>&Delta;P<br /><span class="u">{t.th.hpa}</span></th>
                    <th>{t.th.wind}<br /><span class="u">kt</span></th>
                    <th>{t.th.diag}</th>
                </tr>
            </thead>
            <tbody>
                {#each points as p}
                    <tr class:now={p.isNow}>
                        <td class="lbl">{p.label}</td>
                        <td>{p.pWestHpa.toFixed(1)}</td>
                        <td>{p.pEastHpa.toFixed(1)}</td>
                        <td>{p.dPressure.toFixed(1)}</td>
                        <td>{p.crossWindKt.toFixed(0)}</td>
                        <td class="diag">
                            <span class="dot" style="background:{DIAG_COLOR[diagOf(p)]}"></span>
                            {t.diag[diagOf(p)]}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}

    <!-- ===== Perfil vertical SCL -> MDZ ===== -->
    <div class="zonda-profile-head">
        <h3 class="zonda-subhead">
            {profileReversed ? t.profileHeadingReverse : t.profileHeading}
        </h3>
        <div
            class="zonda-route-direction zonda-segmented"
            role="group"
            aria-label={t.profileDirectionToggle}
        >
            <button
                type="button"
                aria-pressed={!profileReversed}
                class:active={!profileReversed}
                on:click={() => (profileReversed = false)}
            >SCL → MDZ</button>
            <button
                type="button"
                aria-pressed={profileReversed}
                class:active={profileReversed}
                on:click={() => (profileReversed = true)}
            >MDZ → SCL</button>
        </div>
    </div>
    <CrossSection
        scl={locations.SCL}
        mdz={locations.MDZ}
        reversed={profileReversed}
        {lang}
        {instanceId}
        nameOfThisPlugin={name}
    />
    <div class="zonda-gramet">
        <button on:click={openGramet}>
            {profileReversed ? t.grametBtnReverse : t.grametBtn}
        </button>
        <small>{t.grametNote}</small>
    </div>
    <button class="zonda-whatis" on:click={() => (showProfileInfo = true)}>
        {t.profileWhatIs}
    </button>

    <button class="zonda-whatis" on:click={() => (showInfo = true)}>
        {t.whatIs}
    </button>

    <small class="size-s zonda-foot">{t.disclaimer}</small>

    <!-- ===== Popup explicativo ===== -->
    {#if showInfo}
        <div
            class="zonda-modal-backdrop"
            role="presentation"
        >
            <div class="zonda-modal" role="dialog" aria-modal="true">
                <button aria-label={lang === 'es' ? 'Cerrar' : 'Close'} class="zonda-modal-close" on:click={() => (showInfo = false)}>&times;</button>
                <h3>{t.info.title}</h3>
                {#each t.info.body as para}
                    <p>{para}</p>
                {/each}
                <p class="zonda-modal-note">{t.info.note}</p>
            </div>
        </div>
    {/if}

    <!-- ===== Popup tecnico del perfil vertical ===== -->
    {#if showProfileInfo}
        <div
            class="zonda-modal-backdrop"
            role="presentation"
        >
            <div class="zonda-modal zonda-modal--wide" role="dialog" aria-modal="true">
                <button aria-label={lang === 'es' ? 'Cerrar' : 'Close'} class="zonda-modal-close" on:click={() => (showProfileInfo = false)}>&times;</button>
                <h3>{t.profileInfo.title}</h3>
                {#each t.profileInfo.body as para}
                    <p>{para}</p>
                {/each}
                <h4>{t.profileInfo.refsTitle}</h4>
                <ul class="zonda-refs">
                    {#each t.profileInfo.refs as r}
                        <li><a href={r.url} target="_blank" rel="noopener noreferrer">{r.label}</a></li>
                    {/each}
                </ul>
                <p class="zonda-modal-note">{t.profileInfo.note}</p>
            </div>
        </div>
    {/if}
</section>

<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import bcast from '@windy/broadcast';
    import store from '@windy/store';
    import { map } from '@windy/map';
    import config from './pluginConfig';
    import AbacoChart from './AbacoChart.svelte';
    import CrossSection from './CrossSection.svelte';
    import { classify, type Diag, type ZondaSample } from './lib/wind';
    import { PLUGIN_ACTIVE_EVENT } from './lib/lifecycle';
    import type { LatLon } from '@windy/interfaces.d';

    const { title, name } = config;
    const instanceHost = window as unknown as { __zondaInstanceSequence?: number };
    const instanceId = (instanceHost.__zondaInstanceSequence ?? 0) + 1;
    instanceHost.__zondaInstanceSequence = instanceId;
    let pluginElement: HTMLElement;

    // Orientación de la cresta andina central (aprox. N–S = 0°).
    // La componente perpendicular se proyecta sobre la normal a ese rumbo.
    const crestBearingDeg = 0;

    type Loc = 'SCL' | 'MDZ' | 'JuanFernandez';
    const locations: Record<Loc, LatLon> = {
        SCL: { lat: -33.393, lon: -70.786 },           // Aeropuerto Santiago (SCEL)
        MDZ: { lat: -32.831, lon: -68.792 },           // Aeropuerto Mendoza (SAME)
        JuanFernandez: { lat: -33.636, lon: -78.831 }, // Isla Juan Fernández
    };

    // ---- Fijos de la ruta SCL-MDZ dibujados en el mapa al abrir el plugin ----
    // FUENTE: AIP Chile (DGAC), SCEL "Lista de coordenadas", AMDT 102, 14 MAY 2026
    // (aipchile.dgac.gob.cl). Coordenadas convertidas de DMS a decimal.
    // ADVERTENCIA: verificar contra el ciclo AIRAC vigente / base de navegacion
    // certificada antes de cualquier uso operacional.
    interface FixDef {
        name: string;
        lat: number | null;
        lon: number | null;
    }
    const ROUTE_FIXES: FixDef[] = [
        { name: 'ASIMO', lat: -31.883333, lon: -70.316667 }, // 31 53'00"S 70 19'00"W
        { name: 'GUVOL', lat: -32.375, lon: -70.225 }, // 32 22'30"S 70 13'30"W
        { name: 'UMKAL', lat: -32.883333, lon: -70.0 }, // 32 53'00"S 70 00'00"W
        { name: 'NEBEG', lat: -33.8, lon: -69.9 }, // 33 48'00"S 69 54'00"W
        { name: 'ALBAL', lat: -34.183333, lon: -69.816667 }, // 34 11'00"S 69 49'00"W
        { name: 'ANKON', lat: -35.2, lon: -70.5 }, // 35 12.0'S 70 30.0'W
    ];
    const ROUTE_AIRPORTS = [
        { name: 'SCL', ...locations.SCL },
        { name: 'MDZ', ...locations.MDZ },
    ];

    let fixMarkers: unknown[] = [];
    const markerHost = window as unknown as { __zondaRouteMarkers?: unknown[] };

    const removeFixMarkers = (markers: unknown[]) => {
        for (const marker of markers) {
            try {
                (map as { removeLayer: (layer: unknown) => void }).removeLayer(marker);
            } catch {
                /* La capa puede haber sido retirada ya por Windy. */
            }
        }
    };

    const addFixMarkers = () => {
        try {
            const L = (window as unknown as { L?: any }).L;
            if (!L || !map) return;

            // Windy puede mantener el panel anterior en caché al volver al menú. Retirar
            // cualquier juego previo evita duplicados al reabrir el plugin en esa situación.
            if (markerHost.__zondaRouteMarkers) {
                removeFixMarkers(markerHost.__zondaRouteMarkers);
            }
            fixMarkers = [];
            for (const f of ROUTE_FIXES) {
                if (f.lat == null || f.lon == null) continue;
                const icon = L.divIcon({
                    className: 'zonda-fix',
                    html:
                        '<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">' +
                        '<svg width="16" height="14" viewBox="0 0 16 14">' +
                        '<path d="M8 1 L15 13 L1 13 Z" fill="rgba(255,255,255,0.92)" ' +
                        'stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
                        '<span style="font:bold 11px/1.1 sans-serif;color:#fff;' +
                        'text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000;margin-top:1px;">' +
                        f.name +
                        '</span></div>',
                    iconSize: [64, 28],
                    iconAnchor: [32, 8], // centro del triangulo sobre la coordenada del fijo
                });
                fixMarkers.push(L.marker([f.lat, f.lon], { icon, interactive: false }).addTo(map));
            }
            for (const airport of ROUTE_AIRPORTS) {
                const icon = L.divIcon({
                    className: 'zonda-airport',
                    html:
                        '<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">' +
                        '<svg width="16" height="16" viewBox="0 0 16 16">' +
                        '<circle cx="8" cy="8" r="6" fill="rgba(255,255,255,0.2)" ' +
                        'stroke="#fff" stroke-width="2"/></svg>' +
                        '<span style="font:bold 11px/1.1 sans-serif;color:#fff;' +
                        'text-shadow:0 0 3px #000,0 0 3px #000,0 1px 2px #000;margin-top:1px;">' +
                        airport.name +
                        '</span></div>',
                    iconSize: [64, 30],
                    iconAnchor: [32, 8], // centro del circulo sobre el aeropuerto
                });
                fixMarkers.push(
                    L.marker([airport.lat, airport.lon], { icon, interactive: false }).addTo(map),
                );
            }
            markerHost.__zondaRouteMarkers = fixMarkers;

            const routeCoordinates: [number, number][] = [];
            for (const f of ROUTE_FIXES) {
                if (f.lat != null && f.lon != null) routeCoordinates.push([f.lat, f.lon]);
            }
            for (const airport of ROUTE_AIRPORTS) {
                routeCoordinates.push([airport.lat, airport.lon]);
            }
            const latitudes = routeCoordinates.map(([lat]) => lat);
            const longitudes = routeCoordinates.map(([, lon]) => lon);
            const viewMarginDeg = 0.45;
            routeCoordinates.push(
                [Math.min(...latitudes) - viewMarginDeg, Math.min(...longitudes) - viewMarginDeg],
                [Math.max(...latitudes) + viewMarginDeg, Math.max(...longitudes) + viewMarginDeg],
            );
            const routeMap = map as unknown as {
                fitBounds?: (
                    bounds: [number, number][],
                    options: { padding: [number, number]; maxZoom: number; animate: boolean },
                ) => void;
            };
            routeMap.fitBounds?.(routeCoordinates, {
                padding: [48, 48],
                maxZoom: 7,
                animate: false,
            });
        } catch (err) {
            console.error('[zonda] fijos en mapa:', err);
        }
    };

    const handleActiveInstance = (event: Event) => {
        if ((event as CustomEvent<number>).detail === instanceId) return;
        pluginElement.style.display = 'none';
        removeFixMarkers(fixMarkers);
    };

    onMount(() => {
        window.addEventListener(PLUGIN_ACTIVE_EVENT, handleActiveInstance);
        window.dispatchEvent(new CustomEvent(PLUGIN_ACTIVE_EVENT, { detail: instanceId }));
        addFixMarkers();
    });
    onDestroy(() => {
        window.removeEventListener(PLUGIN_ACTIVE_EVENT, handleActiveInstance);
        removeFixMarkers(fixMarkers);
        if (markerHost.__zondaRouteMarkers === fixMarkers) {
            delete markerHost.__zondaRouteMarkers;
        }
        fixMarkers = [];
    });

    let lang: 'es' | 'en' = 'es';
    let profileReversed = false;
    let showInfo = false;
    let showProfileInfo = false;
    const handleGlobalKeydown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        showInfo = false;
        showProfileInfo = false;
    };

    /** Abre el GRAMET de Ogimet (GFS) para SCEL-SAME, con tref = instante del timeline. */
    const openGramet = () => {
        const ts = store.get('timestamp') as number;
        const tref = Math.floor(ts / 1000);
        const route = profileReversed ? 'same+scel' : 'scel+same';
        window.open(
            `https://www.ogimet.com/display_gramet.php?icao=${route}&hini=0&tref=${tref}&hfin=0&fl=250&enviar=Enviar`,
            '_blank',
            'noopener',
        );
    };
    let points: ZondaSample[] = [];

    const diagOf = (p: ZondaSample): Diag => classify(p.crossWindKt, p.dPressure);

    const DIAG_COLOR: Record<Diag, string> = {
        none: '#5BB8E8',
        light: '#FFD400',
        strong: '#E8302A',
    };

    const T = {
        es: {
            heading: 'Ábaco de Harrison — Viento Zonda',
            intro:
                'Diagnóstico de onda de montaña sobre los Andes centrales combinando la ' +
                'diferencia de QNH modelado SCEL−SAME con la componente de viento E–O (zonal) en ' +
                '500 hPa (~FL180) sobre el archipiélago Juan Fernández. Hasta 6 puntos muestran la ' +
                'evolución −6 h / ahora / +6 h / +12 h / +18 h / +24 h respecto al instante ' +
                'seleccionado en la línea de tiempo.',
            source: {
                pre: 'La ruta Santiago–Mendoza es la ',
                link: 'ruta aérea más turbulenta del mundo',
                post: ' (ranking Turbli 2025).',
                url: 'https://turbli.com/historical-data/most-turbulent-flight-routes-of-2025/',
            },
            whatIs: '¿Qué es el Ábaco de Harrison?',
            profileHeading: 'Perfil vertical Santiago → Mendoza',
            profileHeadingReverse: 'Perfil vertical Mendoza → Santiago',
            profileDirectionToggle: 'Invertir el sentido del perfil vertical',
            grametBtn: 'Abrir GRAMET SCEL→SAME en Ogimet (GFS)',
            grametBtnReverse: 'Abrir GRAMET SAME→SCEL en Ogimet (GFS)',
            grametNote:
                'Se abre en una pestaña nueva, con la hora del timeline como inicio. Producto de ' +
                'Ogimet basado en GFS: puede diferir del ECMWF usado en este plugin.',
            profileWhatIs: 'ⓘ ¿Qué muestra este perfil y en qué se basa?',
            profileInfo: {
                title: 'Perfil vertical SCL → MDZ: contenido y base técnica',
                body: [
                    'Corte vertical a lo largo de la línea SCL–MDZ, muestreado en 14 columnas con ' +
                        '(interpolación lineal entre columnas para el campo continuo) ' +
                        'datos ECMWF de Windy para el instante seleccionado en la línea de tiempo. ' +
                        'Eje vertical en cientos de pies (hFt) de altitud geopotencial: no es ' +
                        'estrictamente nivel de vuelo (altitud-presión), aunque a estos niveles la ' +
                        'diferencia es pequeña. Terreno: geopotencial de superficie del modelo ' +
                        '(orografía suavizada; no resuelve la cresta real). Nubes: humedad relativa ' +
                        'media de capa (opacidad ∝ HR entre 70 y 100 %; no es fracción nubosa del ' +
                        'modelo). Precipitación: precipitación del pronóstico puntual (mm por paso), ' +
                        'trazada desde la base nubosa. Isoterma 0 °C: línea roja discontinua, ' +
                        'interpolada de la temperatura por nivel (referencia de engelamiento). ' +
                        'Tropopausa: línea oliva discontinua, aproximación térmica de la OMM (1957) ' +
                        '— primer nivel donde el gradiente cae a ≤ 2 K/km y se mantiene ~2 km — ' +
                        'calculada sobre capas gruesas (precisión del orden de ±1 km).',
                    'Engelamiento (proxy derivado, trama celeste): se marca donde hay nube ' +
                        '(HR ≥ 70 %) y la temperatura media de la capa está entre 0 y −20 °C, el ' +
                        'rango donde se concentra el agua líquida sobreenfriada (NWS; FAA AC 00-6B: ' +
                        'casi todo el engelamiento ocurre entre 0 y −20 °C, con máximo entre −8 y ' +
                        '−12 °C). La API de datos de Windy no expone pronóstico de engelamiento por ' +
                        'niveles, así que esto es un diagnóstico derivado: no modela SLD / llovizna ' +
                        'engelante (posible bajo la base nubosa) ni gotas sobreenfriadas en Cb hasta ' +
                        '−40 °C, y no sustituye SIGMET/AIRMET.',
                    'Turbulencia — criterios por capa (niveles 1000–150 hPa; las capas bajo el ' +
                        'terreno del modelo se descartan): ' +
                        '(1) Estabilidad estática: N² = (g/θ)(Δθ/Δz); N² < 0 → inestabilidad ' +
                        'convectiva → fuerte. ' +
                        '(2) Inestabilidad dinámica (Kelvin–Helmholtz): número de Richardson del ' +
                        'gradiente, Ri = N²/|ΔV/Δz|². Ri < 0,25 → dinámicamente inestable ' +
                        '(valor crítico del AMS Glossary; condición necesaria de Miles 1961 / ' +
                        'Howard 1961) → fuerte. 0,25 ≤ Ri < 1 → ligera, por la histéresis ' +
                        'documentada (la turbulencia ya formada puede persistir hasta Ri ≈ 1). ' +
                        'Advertencia: el valor crítico 0,25 aplica a gradientes locales; promediado ' +
                        'en capas de 0,7–2 km el Ri queda sesgado al alza, así que el diagnóstico ' +
                        'es conservador. ' +
                        '(3) Nivel crítico: |U| < 2 m/s por encima del nivel de cresta con ' +
                        'forzamiento de onda abajo → absorción/rompimiento de onda → fuerte.',
                    'Número de Scorer: ℓ²(z) = N²/U² − (1/U)(d²U/dz²), con U = componente zonal ' +
                        '(perpendicular a una cordillera N–S) y el término de curvatura calculado ' +
                        'con diferencias centradas en los niveles interiores. Se usa el criterio ' +
                        'original de onda atrapada de dos capas (Scorer 1949, ec. 17): ' +
                        'ℓ₁² − ℓ₂² > π²/(4h²), con h la profundidad de la capa inferior sobre el ' +
                        'terreno local y ℓ₁², ℓ₂² promediados por espesor bajo y sobre la interfase. ' +
                        'Donde se cumple —y el forzamiento zonal en nivel de cresta (700–600 hPa) es ' +
                        '≥ 13 m/s (~25 kt)— se dibuja la interfase de atrapamiento (línea discontinua ' +
                        'magenta) y la capa inferior se marca al menos como ligera (zona de onda ' +
                        'atrapada / rotores); el análisis se limita a capas bajo la tropopausa. ' +
                        'Magnitudes típicas de ℓ: ~5×10⁻⁴ m⁻¹, rara vez ' +
                        '> 1×10⁻³ (EUMETSAT/SatManu); longitudes de onda de resonancia usuales ' +
                        '5–25 km (AMS).',
                    'Limitaciones: producto heurístico derivado de un modelo global — no resuelve ' +
                        'explícitamente el rompimiento de onda ni los rotores; el umbral de ~25 kt ' +
                        'es una regla operativa de pronóstico, no un resultado teórico; se asume ' +
                        'temperatura en K y viento en m/s en el meteograma (conversión defensiva ' +
                        'si la temperatura llegara en °C).',
                ],
                refsTitle: 'Referencias',
                refs: [
                    {
                        label: 'Scorer, R.S. (1949): Theory of waves in the lee of mountains. Q. J. R. Meteorol. Soc., 75, 41–56 (ecs. 13 y 17)',
                        url: 'https://rmets.onlinelibrary.wiley.com/doi/10.1002/qj.49707532308',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Scorer parameter',
                        url: 'https://glossary.ametsoc.org/wiki/Scorer_parameter',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Gradient Richardson number',
                        url: 'https://glossary.ametsoc.org/wiki/Gradient_richardson_number',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Critical Richardson number',
                        url: 'https://glossary.ametsoc.org/wiki/Critical_richardson_number',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Tropopause (definición térmica OMM 1957)',
                        url: 'https://glossary.ametsoc.org/wiki/tropopause/',
                    },
                    {
                        label: 'NWS — Icing Hazards (agua sobreenfriada predominante entre 0 y −20 °C)',
                        url: 'https://www.weather.gov/source/zhu/ZHU_Training_Page/icing_stuff/icing/icing.htm',
                    },
                    {
                        label: 'SKYbrary — In-Flight Icing (sobreenfriamiento hasta −40 °C; SLD en Cb)',
                        url: 'https://skybrary.aero/articles/flight-icing',
                    },
                    {
                        label: 'EUMETSAT/SatManu — Lee cloudiness: meteorological physical background',
                        url: 'https://resources.eumetrain.org/satmanu/CMs/LeeCl/navmenu.php?page=2.0.0',
                    },
                ],
                note:
                    'Herramienta de apoyo heurística; no sustituye SIGMET/AIRMET, cartas de tiempo ' +
                    'significativo ni el criterio del pronosticador o del despacho.',
            },
            disclaimer:
                'Modelo: ECMWF; QNH derivado, no observado. Herramienta de apoyo; no reemplaza los productos oficiales ni ' +
                'el criterio del pronosticador.',
            th: { time: 'Instante', hpa: 'hPa', wind: 'Viento', diag: 'Diagnóstico' },
            diag: { none: 'No hay onda', light: 'Onda ligera', strong: 'Onda mod/fuerte' },
            info: {
                title: '¿Qué es el Ábaco de Harrison?',
                body: [
                    'Es un diagrama empírico (ábaco o nomograma) usado en aviación para anticipar ' +
                        'la onda de montaña y la turbulencia asociada al cruce de los Andes centrales ' +
                        'entre Santiago (Chile) y Mendoza (Argentina), uno de los cruces más exigentes ' +
                        'del mundo.',
                    'Se lee cruzando dos variables. En el eje horizontal, la diferencia de presión ' +
                        '(QNH) entre Santiago y Mendoza, que refleja el forzamiento del flujo a través ' +
                        'de la cordillera. En el eje vertical, la intensidad del viento en torno a los ' +
                        '18.000 ft (~500 hPa, nivel de vuelo FL180). El punto donde se cruzan cae en una ' +
                        'zona de color: azul (sin onda), amarillo (onda ligera) y rojo (onda moderada a fuerte).',
                    'Aquí se grafican seis instantes (−6 h, ahora, +6 h, +12 h, +18 h, +24 h) respecto al ' +
                        'momento elegido en la línea de tiempo, de modo que la trayectoria indica si la ' +
                        'situación se agrava o se atenúa.',
                    'Como regla rápida asociada al ábaco, suele haber riesgo de turbulencia cuando la ' +
                        'presión (QNH) en Santiago supera a la de Mendoza en torno a 8–12 hPa, o cuando ' +
                        'Mendoza está unos 5 °C o más cálida que Santiago.',
                ],
                note:
                    'Es una herramienta heurística de apoyo; no reemplaza los productos oficiales de ' +
                    'pronóstico ni el criterio del despacho o del pronosticador.',
            },
        },
        en: {
            heading: 'Harrison Abacus — Zonda Wind',
            intro:
                'Mountain-wave diagnosis over the central Andes combining the model-derived SCEL−SAME QNH ' +
                'difference with the E–W (zonal) wind component at 500 hPa (~FL180) over the ' +
                'Juan Fernández archipelago. Up to 6 points show the −6 h / now / +6 h / +12 h / ' +
                '+18 h / +24 h evolution around the instant selected on the timeline.',
            source: {
                pre: 'The Santiago–Mendoza route is the ',
                link: 'most turbulent flight route in the world',
                post: ' (Turbli 2025 ranking).',
                url: 'https://turbli.com/historical-data/most-turbulent-flight-routes-of-2025/',
            },
            whatIs: 'What is the Harrison Abacus?',
            profileHeading: 'Vertical profile Santiago → Mendoza',
            profileHeadingReverse: 'Vertical profile Mendoza → Santiago',
            profileDirectionToggle: 'Reverse the vertical profile direction',
            grametBtn: 'Open SCEL→SAME GRAMET on Ogimet (GFS)',
            grametBtnReverse: 'Open SAME→SCEL GRAMET on Ogimet (GFS)',
            grametNote:
                'Opens in a new tab, starting at the timeline instant. Ogimet product based on ' +
                'GFS: it may differ from the ECMWF data used in this plugin.',
            profileWhatIs: 'ⓘ What does this profile show and what is it based on?',
            profileInfo: {
                title: 'SCL → MDZ vertical profile: content and technical basis',
                body: [
                    'Vertical cross-section along the SCL–MDZ line, sampled at 14 columns from ' +
                        '(linear interpolation between columns for the continuous field) ' +
                        "Windy's ECMWF data for the instant selected on the timeline. Vertical axis " +
                        'in hundreds of feet (hFt) of geopotential altitude: not strictly flight ' +
                        'level (pressure altitude), though the difference is small at these levels. ' +
                        'Terrain: model surface geopotential (smoothed orography; the real crest is ' +
                        'not resolved). Clouds: layer-mean relative humidity (opacity ∝ RH between ' +
                        '70 and 100%; not a model cloud fraction). Precipitation: point-forecast ' +
                        'precipitation (mm per step), drawn from cloud base. 0 °C isotherm: dashed ' +
                        'red line interpolated from per-level temperature (icing reference). ' +
                        'Tropopause: dashed olive line, WMO (1957) thermal approximation — lowest ' +
                        'level where the lapse rate drops to ≤ 2 K/km and holds for ~2 km — ' +
                        'computed over thick layers (accuracy on the order of ±1 km).',
                    'Icing (derived proxy, cyan hatch): flagged where there is cloud (RH ≥ 70%) ' +
                        'and the layer-mean temperature is between 0 and −20 °C, the range where ' +
                        'supercooled liquid water concentrates (NWS; FAA AC 00-6B: almost all icing ' +
                        'occurs between 0 and −20 °C, peaking between −8 and −12 °C). Windy\'s data ' +
                        'API does not expose a level-resolved icing forecast, so this is a derived ' +
                        'diagnostic: it does not model SLD / freezing drizzle (possible below cloud ' +
                        'base) nor supercooled droplets in Cb down to −40 °C, and it does not ' +
                        'replace SIGMET/AIRMET.',
                    'Turbulence — per-layer criteria (1000–150 hPa levels; layers below the model ' +
                        'terrain are discarded): ' +
                        '(1) Static stability: N² = (g/θ)(Δθ/Δz); N² < 0 → convective instability ' +
                        '→ strong. ' +
                        '(2) Dynamic (Kelvin–Helmholtz) instability: gradient Richardson number, ' +
                        'Ri = N²/|ΔV/Δz|². Ri < 0.25 → dynamically unstable (AMS Glossary critical ' +
                        'value; Miles 1961 / Howard 1961 necessary condition) → strong. ' +
                        '0.25 ≤ Ri < 1 → light, per the documented hysteresis (existing turbulence ' +
                        'can persist up to Ri ≈ 1). Caveat: the 0.25 critical value applies to ' +
                        'local gradients; averaged over 0.7–2 km layers the resolved Ri is biased ' +
                        'high, so the diagnosis is conservative. ' +
                        '(3) Critical level: |U| < 2 m/s above crest level with wave forcing below ' +
                        '→ wave absorption/breaking → strong.',
                    'Scorer parameter: ℓ²(z) = N²/U² − (1/U)(d²U/dz²), with U the zonal component ' +
                        '(perpendicular to a N–S range) and the curvature term computed with ' +
                        'centred differences at interior levels. The original two-layer trapped ' +
                        'lee-wave criterion is used (Scorer 1949, eq. 17): ℓ₁² − ℓ₂² > π²/(4h²), ' +
                        'with h the lower-layer depth above local terrain and ℓ₁², ℓ₂² ' +
                        'thickness-weighted below and above each candidate interface. Where it is ' +
                        'met — and the zonal crest-level forcing (700–600 hPa) is ≥ 13 m/s ' +
                        '(~25 kt) — the trapping interface is drawn (dashed magenta line) and the ' +
                        'layer below is flagged at least light (trapped-wave / rotor zone); the analysis is restricted to layers below the tropopause. ' +
                        'Typical ℓ magnitudes: ~5×10⁻⁴ m⁻¹, rarely > 1×10⁻³ (EUMETSAT/SatManu); ' +
                        'usual resonant wavelengths 5–25 km (AMS).',
                    'Limitations: heuristic product derived from a global model — it does not ' +
                        'explicitly resolve wave breaking or rotors; the ~25 kt threshold is an ' +
                        'operational forecasting rule, not a theoretical result; meteogram ' +
                        'temperature is assumed in K and wind in m/s (defensive conversion if ' +
                        'temperature arrived in °C).',
                ],
                refsTitle: 'References',
                refs: [
                    {
                        label: 'Scorer, R.S. (1949): Theory of waves in the lee of mountains. Q. J. R. Meteorol. Soc., 75, 41–56 (eqs. 13 and 17)',
                        url: 'https://rmets.onlinelibrary.wiley.com/doi/10.1002/qj.49707532308',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Scorer parameter',
                        url: 'https://glossary.ametsoc.org/wiki/Scorer_parameter',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Gradient Richardson number',
                        url: 'https://glossary.ametsoc.org/wiki/Gradient_richardson_number',
                    },
                    {
                        label: 'AMS Glossary of Meteorology — Critical Richardson number',
                        url: 'https://glossary.ametsoc.org/wiki/Critical_richardson_number',
                    },
                    {
                        label: 'EUMETSAT/SatManu — Lee cloudiness: meteorological physical background',
                        url: 'https://resources.eumetrain.org/satmanu/CMs/LeeCl/navmenu.php?page=2.0.0',
                    },
                ],
                note:
                    'Heuristic support tool; it does not replace SIGMET/AIRMET, significant ' +
                    "weather charts, or the forecaster's / dispatcher's judgment.",
            },
            disclaimer:
                'Model: ECMWF; derived, not observed QNH. Support tool; it does not replace official products or the ' +
                "forecaster's judgment.",
            th: { time: 'Time', hpa: 'hPa', wind: 'Wind', diag: 'Diagnosis' },
            diag: { none: 'No wave', light: 'Light wave', strong: 'Mod/strong wave' },
            info: {
                title: 'What is the Harrison Abacus?',
                body: [
                    'It is an empirical chart (abacus or nomogram) used in aviation to anticipate ' +
                        'mountain waves and the turbulence associated with crossing the central Andes ' +
                        'between Santiago (Chile) and Mendoza (Argentina), one of the most demanding ' +
                        'crossings in the world.',
                    'It is read by crossing two variables. On the horizontal axis, the pressure ' +
                        '(QNH) difference between Santiago and Mendoza, which reflects the forcing of the ' +
                        'flow across the range. On the vertical axis, the wind intensity around ' +
                        '18,000 ft (~500 hPa, flight level FL180). Where they cross falls in a coloured ' +
                        'zone: blue (no wave), yellow (light wave) and red (moderate to strong wave).',
                    'Six instants are plotted here (−6 h, now, +6 h, +12 h, +18 h, +24 h) relative to the ' +
                        'moment chosen on the timeline, so the path shows whether the situation is ' +
                        'worsening or easing.',
                    'As a quick rule tied to the abacus, turbulence risk tends to appear when the ' +
                        'pressure (QNH) in Santiago exceeds that of Mendoza by about 8–12 hPa, or when ' +
                        'Mendoza is around 5 °C or more warmer than Santiago.',
                ],
                note:
                    'It is a heuristic support tool; it does not replace official forecast products ' +
                    'or the judgment of dispatch or the forecaster.',
            },
        },
    };

    $: t = T[lang];
</script>

<style lang="less">
    .zonda-plugin {
        position: relative;
        /* Fix: en algunos entornos el rhpane no hace scroll y el contenido inferior
           queda oculto. Hacemos scrolleable la propia seccion cuando excede la vista. */
        overflow-y: auto;
        max-height: calc(100vh - 60px);
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    }
    .zonda-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }
    .zonda-segmented {
        display: inline-flex;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 4px;
        overflow: hidden;
        flex: 0 0 auto;

        button {
            background: transparent;
            color: inherit;
            border: 0;
            padding: 3px 9px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0.65;

            &.active {
                background: rgba(255, 255, 255, 0.18);
                opacity: 1;
                font-weight: bold;
            }
        }
    }
    .zonda-intro {
        line-height: 1.6;
        margin-top: 6px;
    }
    .zonda-profile-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-top: 20px;
    }
    .zonda-subhead {
        margin: 0;
        font-size: 15px;
    }
    .zonda-route-direction button {
        padding: 4px 9px;
        font-size: 11px;
    }
    .zonda-gramet {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 4px;

        small {
            opacity: 0.7;
            line-height: 1.4;
        }
    }
    .zonda-source {
        line-height: 1.5;
        margin: 4px 0 0;
        font-size: 12px;
        opacity: 0.85;

        a {
            color: inherit;
            text-decoration: underline;
        }
    }

    .zonda-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 14px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;

        th,
        td {
            padding: 4px 6px;
            text-align: right;
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }
        th {
            font-weight: bold;
            line-height: 1.15;
            border-bottom: 1px solid rgba(255, 255, 255, 0.3);
        }
        th .u {
            font-weight: normal;
            opacity: 0.6;
            font-size: 10px;
        }
        td.lbl,
        th:first-child {
            text-align: left;
        }
        td.diag,
        th:last-child {
            text-align: left;
            white-space: nowrap;
        }
        tr.now td {
            font-weight: bold;
            background: rgba(255, 255, 255, 0.06);
        }
        .dot {
            display: inline-block;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            margin-right: 4px;
            vertical-align: -1px;
        }
    }

    .zonda-whatis {
        display: inline-block;
        margin: 14px 0 4px;
        padding: 0;
        background: none;
        border: 0;
        color: inherit;
        font-size: 13px;
        text-decoration: underline;
        cursor: pointer;
    }
    .zonda-foot {
        display: block;
        margin-top: 8px;
        opacity: 0.75;
        line-height: 1.5;
    }

    .zonda-modal-backdrop {
        /* fixed: el backdrop debe cubrir la vista aunque el panel este scrolleado */
        position: fixed;
        inset: 0;
        z-index: 100;
        background: rgba(0, 0, 0, 0.55);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 24px 16px;
        z-index: 30;
        overflow-y: auto;
    }
    .zonda-modal {
        position: relative;
        max-width: 560px;
        width: 100%;
        background: #1b2330;
        color: #eef1f5;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 18px 20px 20px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);

        h3 {
            margin: 0 0 10px;
            padding-right: 24px;
        }
        p {
            line-height: 1.6;
            margin: 0 0 10px;
            font-size: 13px;
        }
    }
    .zonda-modal--wide {
        max-width: 640px;
    }
    .zonda-refs {
        margin: 4px 0 10px;
        padding-left: 18px;
        font-size: 12px;
        line-height: 1.6;

        a {
            color: inherit;
            text-decoration: underline;
        }
    }
    .zonda-modal h4 {
        margin: 12px 0 4px;
        font-size: 13px;
    }
    .zonda-modal-note {
        opacity: 0.7;
        font-style: italic;
        font-size: 12px !important;
    }
    .zonda-modal-close {
        position: absolute;
        top: 8px;
        right: 10px;
        background: none;
        border: 0;
        color: inherit;
        font-size: 22px;
        line-height: 1;
        cursor: pointer;
        opacity: 0.7;

        &:hover {
            opacity: 1;
        }
    }
</style>
