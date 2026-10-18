# legobuilds — contexto del proyecto para Claude Code

## Qué es
App personal de Randall para diseñar construcciones Lego nuevas **con las piezas que ya tiene** y seguirlas con **manuales interactivos paso a paso estilo Lego** (vista 3D/isométrica por paso, lista de piezas del paso, progreso, usable en celular y PC).

Randall no programa; construye con IA. Explica decisiones técnicas en una línea, no en párrafos. Responde en español, directo, números primero.

## Estado actual (2026-10-18)
- **Inventario lote 1 cargado y verificado:** 468 piezas, 140 formas, 258 combinaciones pieza+color, 12 familias de color. 467 vienen de Brickit (8 escaneos) + 1 manual (32306).
- Colección total estimada ~1000 piezas, sueltas, de sets de los 90s y 2000s, sin manuales. Faltan lotes por escanear.
- No hay app todavía. Solo pipeline de datos.

## Fuente de datos: Brickit (app Android, cuenta `rcruz17`, licencia Pro)
- Randall escanea sus piezas en **Brickit > Pockets** (un pocket por bolsa de 150–200 piezas). Pockets acumula; Quick Play NO (se sobrescribe).
- **Brickit no tiene API pública** (verificado: `/api/offer/...` da 404; el FAQ está vacío). La única salida de datos es el **link de compartir** `https://brickit.app/offer/<uuid>`.
- Ese link es un **snapshot congelado** al momento de compartir. Si Randall agrega escaneos, el link viejo NO cambia (verificado 2026-10-18: mismo link, mismos 467). Hay que generar un link nuevo desde la app.
- La página del link trae **todo** embebido en `window.__NUXT__`: cada pieza individual con `partNum` (número BrickLink/LDraw), `partGroup`, `partCategory`, `partSize`, `colorName`, `partImage`, `boundingBox` dentro de la foto del escaneo, y `scanImage`. `scripts/brickit_import.mjs` lo evalúa con `vm` y lo aplana.
- Los colores son **familias** (Blacks, Grays, Reds, Yellows, Blues, Greens, Whites, Browns, Turquoises, Pinks, Purples, Oranges), no el tono exacto. "Blues" mezcla azul claro y oscuro. Suficiente para diseñar; si un diseño exige tono exacto, Randall confirma a mano.
- Precisión del escaneo: buena en forma y cantidad, con errores ocasionales (ej. detectó una plate 1×5 `78329`, pieza de 2021+, improbable en sets de los 90s/2000s; probablemente una 1×4 o 1×6). Tratar cantidades de piezas raras con 1 unidad como "probables".

## Flujo de sincronización (ya implementado)
1. Randall en Brickit: Pockets > Share → copia el link nuevo.
2. Pega el link en `data/sources/brickit_links.txt` (reemplaza si es la colección completa; agrega si es un pocket extra). Piezas no reconocidas van a `data/manual_parts.csv`.
3. Push → `.github/workflows/sync-inventory.yml` corre `node scripts/brickit_import.mjs` y commitea `data/`. También corre a mano (Actions) y los domingos.
4. El script **verifica** que piezas y formas cuadren con lo que declara Brickit; si no cuadra, falla el job.

Mejoras pendientes al flujo (no urgentes): un formulario web en la app donde Randall pegue el link y dispare el workflow vía `repository_dispatch`; o un bookmarklet/atajo en Android que abra el link compartido y lo mande al repo.

## Archivos de datos (`data/`)
| Archivo | Qué es | Úsalo para |
|---|---|---|
| `inventory.json` | Fuente de verdad para la app. Totales, colores, y por pieza: grupo, categoría, tamaño, qty, imagen, desglose por color. | Cargar en la app, validar diseños. |
| `inventory.csv` | Una fila por pieza+color. | Revisar a mano, Excel. |
| `color_matrix.csv` | Piezas × colores. | Elegir paleta de un diseño. |
| `by_scan.csv` | Detalle por fuente y escaneo. | Saber en qué bolsa/pocket está una pieza. |
| `raw/<offer-id>.json` | Dump completo del link (incluye bounding boxes y fotos). | Localizador de piezas en la foto, debugging. |
| `manual_parts.csv` | Piezas agregadas a mano (formato: pieza,grupo,categoria,tamano,color,cantidad). | Lo edita Randall. |
| `sources/brickit_links.txt` | Links de Brickit a importar. | Lo edita Randall. |

**Regla:** `data/*.csv|json` y `data/raw/` los genera el script. No editarlos a mano; editar fuentes y correr `node scripts/brickit_import.mjs`.

## Números clave del inventario actual
- Por grupo: Bricks 225, Plates 157 (incluye tiles), Technic 31, Functional (bisagras/brazos) 19, Minifigs 12, Outdoor 11, Transport 10, Building 3.
- Top piezas: brick 1×2 `3004` (40), plate 1×2 `3023` (31), brick 2×2 `3003` (24), tile 2×2 `3068b` (22), slope 2×2 `3039` (21), brick 2×4 `3001` (19), plate 2×4 `3020` (15).
- Por color: negro 134 (29%), gris 78, rojo 49, amarillo 43, azul 41, verde 35, blanco 33, café 21, turquesa 17, rosa 8, morado 7, naranja 2.
- Mayor stock en un solo color: plate 1×2 negra 15, slope 2×2 negro 10, tile 2×2 amarillo 10, brick 2×4 negro 8.
- 75 de 140 formas tienen 1 sola pieza. Solo 6 ruedas, de 4 tipos.
- Implicación de diseño: modelos chicos/medianos (30–120 piezas), paleta negro+gris con acentos; muchos slopes → naves, vehículos, techos.

## Qué construir (orden sugerido)
1. **Validador de diseños**: dado un modelo (lista de pieza+color+qty), decir si se puede armar con `inventory.json`, qué falta y sustitutos de color.
2. **Generador de modelos**: Claude propone diseños en formato **LDraw (.ldr)** usando solo números de pieza del inventario. LDraw usa los mismos números que Brickit/BrickLink en casi todos los casos; mapear excepciones en `scripts/part_aliases.json` cuando aparezcan.
3. **Pasos de armado**: ordenar las piezas del .ldr en pasos (`0 STEP`), de abajo hacia arriba, 3–8 piezas por paso.
4. **Visor interactivo** (web, estático, deployable en GitHub Pages): render 3D del modelo por paso con Three.js + el loader LDraw de three.js (`three/examples/jsm/loaders/LDrawLoader.js`), que necesita la librería de partes LDraw (descargar `complete.zip` de ldraw.org o servir solo las piezas usadas). Por paso: piezas nuevas resaltadas, lista de piezas con imagen (`partImage` de Brickit), botón anterior/siguiente, barra de progreso, modo oscuro, celular primero. Guardar progreso en `localStorage`.
5. **Localizador de piezas**: usar `boundingBox` + `scanImage` del raw para mostrar en qué foto/pocket está cada pieza del paso.
6. **Biblioteca de construcciones**: `builds/<slug>/model.ldr` + `meta.json` (nombre, dificultad, piezas, estado: diseñado/armado/fallido) + fotos del resultado real.
7. Más adelante: PDF estilo manual Lego (BrickLink Studio importa .ldr y genera instrucciones; es plan B manual).

## Decisiones tomadas
- Stack: sin backend. Repo + GitHub Actions para datos, sitio estático para la app (GitHub Pages). Node ≥ 18 sin dependencias para scripts.
- Formato de modelos: LDraw, por ser texto plano, abierto, compatible con Studio y con three.js.
- Se descartó entrenar/usar un modelo de visión propio (YOLO/B200): menor precisión que Brickit y solo ~200 tipos de pieza.
- Se descartó Pileometer y la versión Quick Play de Brickit.
- Los dos CSV de la primera versión (`lego_lote1_consolidado.csv`, `lego_lote1_por_scan.csv`) quedaron obsoletos; no existen aquí.

## Límites conocidos
- Claude no puede probar físicamente la estabilidad de un modelo. Diseñar conservador (traslape de piezas, sin voladizos largos) e iterar con las fotos de Randall.
- Si Brickit cambia el formato de su página, el import falla con mensaje claro; revisar `window.__NUXT__` y ajustar `fetchOffer()`.

## Comandos
```bash
node scripts/brickit_import.mjs                 # regenerar data/ desde las fuentes
node scripts/brickit_import.mjs <url-brickit>   # probar un link sin tocar las fuentes
```
