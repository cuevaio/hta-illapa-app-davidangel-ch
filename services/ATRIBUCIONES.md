# Atribuciones y licencias

Cada capa muestra su atribución en la aplicación y la publica en `GET /capas` (`fuente.atribucion`, `fuente.licencia`).
Verificado el 2026-10-18 (ver `docs/viabilidad.md`).

## Capa `terreno` (primaria) — Terrain Tiles on AWS

- Fuente: bucket público `elevation-tiles-prod` (AWS Open Data, https://registry.opendata.aws/terrain-tiles/),
  formato Terrarium. En Perú los datos son SRTM (tierra), GMTED2010 (lagos y mar) y ETOPO1 (niveles bajos).
- Licencia: datos de dominio público de USGS (SRTM, GMTED2010) y NOAA (ETOPO1), con crédito según
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- Atribución: "United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S.
  Geological Survey. Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration."
- Tipo de modelo: el registro de AWS lo describe como "bare-earth", pero SRTM es radar de banda C y en zonas de
  selva no es terreno desnudo (afirmación sin verificar). Datum vertical sin documentar.
- Limitación conocida: SRTM tiene picos y pozos aislados de cientos de metros sobre ríos amazónicos (p. ej. −315 m
  cerca de Iquitos, en `terrarium/12/1215/2091`, `srtm/S04W074.tif`). Se sirven tal cual (v1 conserva los bytes de la
  fuente); ver `services/tiles/README.md`, Limitaciones.

## Capa `terreno-copernicus` (respaldo) — Copernicus DEM GLO-30

- Fuente: bucket público `copernicus-dem-30m` (https://registry.opendata.aws/copernicus-dem/), COG.
- Licencia: licencia Copernicus DEM, gratuita para GLO-30/GLO-90
  (https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).
  Los términos completos sobre redistribución pública de teselas derivadas están pendientes de revisión.
- Atribución (productos derivados): "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
  Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved."
- **Es un modelo digital de superficie (DSM)**: incluye vegetación y edificios. Datum vertical EGM2008.

## Imagen satelital (Fase 7) — Esri World Imagery, directa desde el navegador

- No es una capa de `services/tiles`: el navegador la pide directamente a Esri (excepción decidida en la Fase 7, L7) y
  no se guarda ni se redistribuye desde nuestro backend, como exigen los términos.
- Términos: Esri Master License Agreement y términos por producto de ArcGIS Location Platform
  (https://www.esri.com/content/dam/arcgisonline/docs/tou_summary.pdf,
  https://www.esri.com/content/dam/esrisites/en-us/media/legal/product-specific-terms-of-use/e300.pdf): prohíben
  redistribuir o autoalojar teselas y exigen autenticación (clave de ArcGIS Location Platform) para aplicaciones.
- Atribución mostrada mientras se ve la imagen: «Source: Esri, Vantor, Earthstar Geographics, and the GIS User
  Community» (`copyrightText` del servicio, leído en tiempo de ejecución) y «Powered by Esri»
  (https://developers.arcgis.com/documentation/esri-and-data-attribution/).
- **Modo prototipo** (`VITE_IMAGERY_PROVIDER=esri-prototipo`, por defecto sin clave): endpoint público sin clave, fuera
  de los términos de Esri; solo para prototipo o demo interna, con aviso visible. Para producción: `esri` con
  `VITE_IMAGERY_KEY` (ver README, Fase 7).

## Capas meteorológicas (Fase 7) — `services/weather`

Las sirve nuestro backend `services/weather` (`GET /api/layers`, campos `source` y `attribution` de cada capa); el
navegador no habla con NOAA. Todos los datos vienen del programa NOAA Open Data Dissemination (NODD) en AWS: datos
del Gobierno de EE. UU., de dominio público y sin restricciones de uso (https://www.noaa.gov/information-technology/open-data-dissemination).
NOAA pide citarla como fuente y no implicar su respaldo.

- Temperatura (2 m), viento (10 m), precipitación y potencial convectivo (CAPE) — `gfs-t2m`, `gfs-wind10m`,
  `gfs-precip`, `gfs-cape`: «NOAA/NCEP Global Forecast System» (GFS 0,25°, bucket `noaa-gfs-bdp-pds`,
  https://registry.opendata.aws/noaa-gfs-bdp-pds/). Es un **pronóstico** de modelo, no una observación; CAPE es un
  potencial de convección, no tormentas observadas.
- Rayos observados — `glm-lightning`: «NOAA GOES-19 Geostationary Lightning Mapper (GLM)» (GLM L2 LCFA, bucket
  `noaa-goes19`, https://registry.opendata.aws/noaa-goes/), vía NOAA Open Data Dissemination on AWS.
- Nubes observadas — `goes-clouds`: «NOAA GOES-19 ABI L2 products via the NOAA Open Data Dissemination program on
  AWS» (máscara de nubes ABI-L2-ACMF + banda 13 ABI-L2-CMIPF, bucket `noaa-goes19`). La muestra de respaldo
  `services/weather/sample/sample.png` es un producto derivado del escaneo GOES-19 del 2026-10-17 23:00 UTC, generado
  en peru-simulator con el mismo código.

## Capas previstas (Fase 8, aún no servidas)

- Cobertura — ESA WorldCover v200: CC BY 4.0. "© ESA WorldCover project 2021 / Contains modified Copernicus
  Sentinel data (2021) processed by ESA WorldCover consortium".
- Vías — extracto Geofabrik de OpenStreetMap: ODbL. "© OpenStreetMap contributors"
  (https://www.openstreetmap.org/copyright).
