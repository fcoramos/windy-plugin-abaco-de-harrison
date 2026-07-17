# windy-plugin-abaco-de-harrison

Plugin de Windy.com que reproduce el Abaco de Harrison para el diagnostico de viento
Zonda sobre los Andes centrales.

Autor: Francisco J. Ramos Francés ([GitHub: fcoramos](https://github.com/fcoramos)).
Contacto: [fcoramos@gmail.com](mailto:fcoramos@gmail.com).

## Concepto

- Eje X: diferencia de presion (dQNH) en hPa entre Santiago (SCEL) y Mendoza (SAME).
- Eje Y: componente de viento E-O (zonal) en 500 hPa (~FL180), en nudos, calculada sobre
  el archipielago Juan Fernandez. Para una cresta N-S la componente perpendicular a la
  cordillera coincide con la zonal (E-O).
- Regiones: azul "NO HAY ONDA" (< 20 kt), amarillo "ONDA LIGERA", rojo "ONDA MOD/FUERTE".
- Se dibujan hasta 6 puntos (-6h, AHORA, +6h, +12h, +18h, +24h) unidos por una linea, anclados
  al instante seleccionado en la linea de tiempo de Windy.

Contexto: la ruta SCL-MDZ es la ruta aerea mas turbulenta del mundo segun el ranking de
Turbli (https://turbli.com/historical-data/most-turbulent-flight-routes-of-2025/).

## Instalacion (desarrollo)

Proyecto basado en el template oficial de Windy (`@windycom/plugin-devtools` + rollup).

1. npm ci
2. npm start          (= rollup -w -c; sirve en https://localhost:9999/plugin.js)
3. Abre https://www.windy.com/developer-mode y carga https://localhost:9999/plugin.js
   (la primera vez el navegador pedira aceptar el certificado self-signed de localhost).
4. npm run build      (empaqueta dist/plugin.min.js para distribuir)

Antes de publicar, `npm run verify` ejecuta comprobacion de tipos, pruebas, build y
validacion del contenido de `dist`.

d3 se empaqueta en el bundle (viene de @windycom/plugin-devtools y esta listado como
dependencia). Los modulos `@windy/*` se externalizan: los provee Windy en runtime.

## Publicacion y futuras versiones

El repositorio publico es:

    https://github.com/fcoramos/windy-plugin-abaco-de-harrison

La publicacion se realiza con el workflow manual `.github/workflows/publish-plugin.yml`.
El secreto cifrado `WINDY_API_KEY` ya esta configurado en GitHub y no debe copiarse al
codigo, al README ni a un commit.

Para publicar una nueva version:

1. Realiza los cambios y ejecuta `npm run verify`.
2. Incrementa la version tanto en `package.json` como en `src/pluginConfig.ts`; Windy no
   permite volver a publicar la misma version.
3. Ejecuta `git add -A`, `git commit -m "descripcion del cambio"` y `git push`.
4. En GitHub abre `Actions` -> `publish-plugin` -> `Run workflow` y selecciona `main`.
5. Comprueba que las etapas de instalacion, verificacion y publicacion terminen en verde.

La version 1.0.0 se publico inicialmente con `private: true`. Desde la version 1.0.1 se
omite esa propiedad para solicitar que el plugin esté disponible publicamente. La
aprobacion final depende de la revision de Windy. Documentacion oficial:
https://docs.windy-plugins.com/getting-started/publishing-plugin.html

## Calibracion

La curva critica amarillo/rojo usa:

    V_critico = CURVE_C1 + CURVE_K / (dP - CURVE_X0)     [V en kt, dP en hPa]
    (inversa) dP_critico = CURVE_X0 + CURVE_K / (V - CURVE_C1)

Constantes actuales en src/AbacoChart.svelte (ajustadas a la tabla de referencia,
validas ~5..30 hPa):

    NO_WAVE  = 20      umbral horizontal "No hay onda" (azul)
    CURVE_C1 = 13.1    termino independiente de la curva
    CURVE_K  = 307
    CURVE_X0 = 1.1

## Advertencias / por verificar

- QNH MODELADO: el campo `pressure` del point forecast de Windy ya esta reducido al
  nivel medio del mar (MSLP), por lo que no se trata como presion de estacion. Para
  aproximar QNH, el plugin interpola log(p) en la elevacion del modelo usando las
  alturas geopotenciales de los niveles ECMWF y luego reduce esa presion de estacion
  con atmosfera estandar (T0=288 K, gradiente 0,0065 K/m, exponente 5,2561; formula
  NWS). Es una aproximacion de modelo, no el QNH observado ni certificado del METAR.
  Validar la diferencia SCL-SAME contra QNH oficiales antes de uso operacional.
- UNIDADES DEL METEOGRAMA (no verificado): el codigo asume que wind_u-500h y
  wind_v-500h vienen en m/s y los pasa a kt con MS_TO_KT = 1.94384. Confirma la
  unidad contra un valor conocido antes de fiarte del eje Y.
- DEFINICION DEL EJE Y (no verificado): el codigo grafica la COMPONENTE perpendicular
  a la cordillera. La descripcion habitual del abaco habla de "el viento a 18.000 ft",
  que podria ser la RAPIDEZ TOTAL del viento en 500 hPa y no solo la componente
  perpendicular. Si tu abaco de referencia usa rapidez total, cambiar crossBarrierWind
  por Math.hypot(u, v).
- SIGNO / RUMBO DE CRESTA: crossBarrierWind usa convencion de rumbo (compas). Con
  crestBearingDeg = 0 (cresta N-S) toma la componente U (oeste->este), positiva cuando
  el viento cruza de Chile a Argentina. Corrige un bug de la version previa que tomaba
  la componente a lo largo de la cresta (N-S).

## Perfil vertical: notas de render

- Eje vertical en cientos de pies (hFt) de altitud GEOPOTENCIAL hasta 45.000 ft
  (no es altitud-presion / nivel de vuelo estricto; la diferencia es pequena).
- 14 columnas de datos (2 fetches c/u) con interpolacion lineal entre columnas para un
  campo continuo; niveles 1000-150 hPa. Las capas de presion extrapoladas BAJO el
  terreno del modelo se descartan (antes pintaban nubes hasta 0 ft sobre la cordillera).
- Terreno: gh-surface del meteograma con fallback a header.modelElevation del point
  forecast (gh-surface puede venir vacio).
- Tropopausa: aproximacion termica OMM 1957 (gradiente <= 2 K/km sostenido ~2 km) sobre
  capas gruesas; precision del orden de +-1 km. El analisis de Scorer (ec. 17) se
  restringe a capas bajo la tropopausa. Si el criterio estricto no resuelve en una
  columna, se usa el minimo del gradiente sobre 7 km (< 4 K/km) y en el render los
  huecos se rellenan interpolando entre columnas vecinas.
- Engelamiento (proxy derivado, representado con puntos celestes): nube (HR >= 70 %) con temperatura media de capa entre
  0 y -20 C (NWS; FAA AC 00-6B). La API de Windy no expone engelamiento por niveles
  (solo un escalar opcional `icing` por paso de tiempo, sin documentar). El proxy no
  modela SLD/llovizna engelante ni Cb hasta -40 C; no sustituye SIGMET/AIRMET.
- Nubes: HR de capa >= 70 % con desenfoque gaussiano; turbulencia como trama diagonal
  (naranja ligera, roja fuerte) para no ensuciar el color de las nubes; precipitacion
  con barras diagonales desde la base nubosa; isoterma 0 C roja discontinua; terreno
  opaco dibujado encima de las capas y la interfase de Scorer (magenta) sobre el terreno.
- Boton GRAMET: abre el corte de Ogimet (GFS) para SCEL-SAME en pestana nueva con
  tref = instante del timeline. No se incrusta la imagen: Ogimet prohibe el acceso
  automatizado (robots.txt) y es un servicio gratuito con limites de uso; solo enlace
  iniciado por el usuario.

## Fijos de la ruta en el mapa

Al abrir el plugin se dibujan triangulos con etiqueta en los fijos de la ruta SCL-MDZ:
ASIMO, GUVOL, UMKAL, NEBEG, ALBAL y ANKON. Fuente para ASIMO, GUVOL, UMKAL, NEBEG
y ALBAL: AIP Chile (DGAC), SCEL "Lista de coordenadas", AMDT 102 (14 MAY 2026).
ANKON se configura en 35 12.0 S, 70 30.0 W. Los marcadores se eliminan al cerrar el
plugin. Los aeropuertos de Santiago (SCL) y Mendoza (MDZ) se muestran con circulos
etiquetados. Al abrir el plugin, el mapa ajusta automaticamente el centro y el zoom
para mostrar todos estos marcadores.

ADVERTENCIA: coordenadas verificadas contra el AIP publicado a la fecha del commit;
verificar contra el ciclo AIRAC vigente antes de uso operacional. Este plugin no es
fuente de navegacion.

## Interfaz

- Tabla bajo el grafico con los 6 instantes (-6h/AHORA/+6h/+12h/+18h/+24h): QNH
  modelado SCL, QNH modelado MDZ, dQNH, viento (kt) y diagnostico. Sirve para auditar
  los numeros.
- Enlace "¿Que es el Abaco de Harrison?" que abre un popup explicativo.
- Selector de idioma ES/EN que traduce todo el plugin, incluidas las etiquetas del
  grafico.
- Controles para minimizar el panel hacia la derecha, restaurarlo y cerrar la extension.
  En iPad horizontal, el panel y el mapa ocupan cada uno la mitad de la pantalla. En
  telefonos, los graficos, la leyenda y la tabla se compactan sin desbordamiento lateral.
- El pie de la extension muestra el correo de contacto y la version publicada.

## Perfil vertical SCL <-> MDZ (diagnostico por capa)

- Un selector segmentado, similar al de idioma, permite elegir el sentido visual y las
  distancias del corte entre SCL -> MDZ y MDZ -> SCL sin volver a descargar los datos
  meteorologicos. El enlace GRAMET de Ogimet adopta el mismo sentido seleccionado.

- Estabilidad: N2 = (g/theta)(d theta/dz); N2 < 0 -> convectiva -> fuerte.
- Dinamica (KH): Ri = N2/|dV/dz|2; Ri < 0.25 fuerte, 0.25-1 ligera (AMS Glossary
  gradient/critical Richardson number; Miles/Howard 1961). Capas gruesas sesgan Ri al
  alza: diagnostico conservador.
- Nivel critico: |U| < 2 m/s sobre el nivel de cresta con forzamiento abajo -> fuerte.
- Onda atrapada: numero de Scorer l2 = N2/U2 - (1/U)(d2U/dz2) con el criterio de dos
  capas de Scorer (1949, ec. 17): l1^2 - l2^2 > pi^2/(4 h^2); interfase dibujada en
  magenta discontinuo. Forzamiento requerido: U zonal >= 13 m/s (~25 kt, regla
  operativa) en 700-600 hPa.
- NO es un indice EDR ni un pronostico oficial. Referencias completas y limitaciones en
  el popup del plugin y en src/lib/profile.ts.
