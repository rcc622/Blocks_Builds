# Blocks Builds (repo `Blocks_Builds`) — contexto del proyecto para Claude Code

## Qué es
App personal de Randall para armar construcciones Lego nuevas **con las piezas que ya tiene**, con **manuales interactivos paso a paso estilo Lego**: visor 3D por paso, recuadro de piezas del paso, progreso, celular primero, modo oscuro.

Randall no programa; construye con IA. Explica decisiones técnicas en una línea, no en párrafos. Responde en español, directo, números primero.

## Estado (2026-10-18)
- **App funcionando** (sitio estático, sin backend): biblioteca de modelos, manual 3D paso a paso, inventario con filtros, localizador de piezas en las fotos de Brickit, botón para actualizar inventario desde el celular, instalable como app (PWA, recibe links compartidos desde Brickit).
- **3 modelos diseñados y validados** contra el inventario: `faro` (29 piezas), `casita` (34), `nave-cuervo` (38). Ninguno armado físicamente todavía.
- **Inventario lote 1:** 468 piezas, 140 formas, 12 familias de color (467 Brickit + 1 manual `32306`). Colección total estimada ~1000; faltan lotes por escanear.
- Repo renombrado a `rcc622/Blocks_Builds` (2026-10-19); app en https://rcc622.github.io/Blocks_Builds/ . Pages activo, token del botón conectado. Pendiente: elegir logo (conceptos A/B/C; A "Escalón" está puesto como provisional).

## Estructura
| Ruta | Qué es |
|---|---|
| `index.html` | Shell de la app. three.js 0.180 por importmap desde jsDelivr (versión fija). |
| `app/app.js` | Router por hash y vistas: `#/` modelos, `#/b/<slug>/<paso>` manual (0 = resumen), `#/piezas`, `#/sync`. |
| `app/viewer.js` | Visor three.js + `LDrawLoader`: pasos (`0 STEP`), piezas nuevas caen en su lugar, encuadre por paso, modo "resaltar nuevas", miniaturas de piezas en color. |
| `app/check.js` | ¿Se puede armar? pieza+color vs inventario, sustitutos de color, piezas apartadas por modelos armados. **Compartido** con los scripts. |
| `app/colors.js` | Familias de Brickit → código de color LDraw. **Compartido** con los scripts. |
| `app/tokens.css`, `app/style.css` | Sistema de diseño (OKLCH, Plus Jakarta Sans + JetBrains Mono). Todo color/fuente sale de tokens. |
| `app/LDConfig.ldr` | Colores oficiales LDraw (los usa el visor). |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline mientras armas, `share_target` para recibir el link de Brickit. |
| `builds/<slug>/` | `meta.json` + `model.txt` (fuente) → generados: `model.ldr`, `model.mpd` (empaquetado con sus piezas). |
| `builds/index.json` | Catálogo generado para la app (piezas por paso, BOM, avisos). |
| `scripts/brickit_import.mjs` | Inventario desde links de Brickit (`--replace URL` / `--add URL` editan la lista). |
| `scripts/build_models.mjs` | Compila, revisa y empaqueta modelos. `--part` y `--catalog` para diseñar. |
| `scripts/check.test.mjs` | Prueba mínima de `check.js`. |

## Fuente de datos: Brickit (app Android, cuenta `rcruz17`, licencia Pro)
- Randall escanea en **Brickit > Pockets** (un pocket por bolsa de 150–200 piezas). Pockets acumula; Quick Play NO.
- **Brickit no tiene API pública.** La única salida es el link de compartir `https://brickit.app/offer/<uuid>`: un **snapshot congelado**; si escanea más, hay que compartir un link nuevo.
- La página trae todo en `window.__NUXT__`: por pieza `partNum` (BrickLink/LDraw), grupo, categoría, tamaño, `colorName`, `partImage`, `boundingBox`/`crop` en la foto y `scanImage` (URL firmada, vence ~1 año; el sync semanal la renueva).
- Colores = **familias** ("Blues" mezcla claro y oscuro). Si un diseño exige tono exacto, Randall confirma a mano.
- Precisión: buena en forma y cantidad, errores ocasionales (ej. `78329` plate 1×5, pieza 2021+, improbable). Piezas con 1 unidad = "probables".

## Flujo de sincronización
1. Brickit → Pockets → Share → **Blocks Builds** (si instaló la app) o copiar link.
2. En la app, `#/sync`: pegar link, elegir "toda mi colección" (reemplaza) o "pocket extra" (suma) → botón. Manda `repository_dispatch` con un token fine-grained de Randall (Contents: read/write, solo este repo, guardado solo en su navegador).
3. `.github/workflows/sync-inventory.yml` corre import + catálogo + modelos y commitea. `pages.yml` publica después de cada sync y cada push.
4. Sin token: editar `data/sources/brickit_links.txt` en GitHub. Piezas no reconocidas → `data/manual_parts.csv`.
5. El import **verifica** piezas/formas contra lo que declara Brickit; si no cuadra, falla el job.

## Datos (`data/`) — todo generado salvo `sources/` y `manual_parts.csv`
| Archivo | Para qué |
|---|---|
| `inventory.json` | Fuente de verdad de la app. Totales, colores, por pieza qty + desglose por color + imagen. |
| `locator.json` | Por `pieza|color`: en qué foto de escaneo y en qué caja. Fotos 3024×4032. |
| `part_catalog.csv` | Por pieza: archivo LDraw, descripción, ancho×fondo×alto, studs. **Úsalo para diseñar.** |
| `part_names.json` | Nombres LDraw (la app los traduce). |
| `inventory.csv`, `color_matrix.csv`, `by_scan.csv` | Para revisar a mano / Excel. |
| `raw/<offer-id>.json` | Dump completo del link. |

**Regla:** no editar generados a mano; editar fuentes y correr los scripts.

## Cómo diseñar un modelo nuevo (lo hace Claude)
1. Mira `data/part_catalog.csv` (medidas y colores con cantidad) y pensar en piezas comunes primero.
2. Crea `builds/<slug>/meta.json` (`name`, `description`, `difficulty` 1–3, `status: "diseñado"`, `tags`) y `builds/<slug>/model.txt`.
3. `model.txt`, una pieza por línea: `<pieza> <familia>[:codigoLDraw] <x> <z> <y> [giro]`
   - Rejilla: **x** a la derecha, **z hacia el frente**, **y** = altura de la base en **plates** (brick = 3, plate/tile = 1). x,z = esquina de la pieza en studs.
   - **Giro** alrededor del eje vertical: `0` la pendiente mira al frente (studs atrás), `90` mira a la izquierda, `180` atrás, `270` derecha. Un 1×2 con giro 90 queda 1 de ancho × 2 de fondo.
   - Pendientes invertidas (3665, 3660, 3747b, 4287c): su cara de abajo es solo la fila de atrás; con giro 0 sobresalen hacia el frente.
   - `STEP <título>` empieza un paso (3–8 piezas, de abajo hacia arriba). `#` comenta.
   - Color con tono exacto: `Turquoises:43` (transparente azul claro, p. ej. parabrisas `2437`), `Grays:72` (gris oscuro).
   - Medio stud a propósito: x/z con decimales (`59900 Reds 1.5 1.5 32`). Piezas cuya base sobresale (pétalos `15469`) también: x/z = esquina de su caja, ver con `--part`.
   - Bisagras, ruedas, minifigs: línea LDraw cruda `1 <color> x y z a b c d e f g h i pieza.dat` (pasa sin revisar estructura).
4. `node scripts/build_models.mjs <slug>` y corregir hasta que diga `OK inventario` y **sin avisos**:
   - `encimada`: dos piezas ocupan la misma celda.
   - `flotando`: no conecta (stud con cara de abajo) con nada que llegue al piso.
5. Revisar visualmente en la app (`#/b/<slug>/0`, girar el modelo, ver cada paso).
- `node scripts/build_models.mjs --part 3039 3747b` muestra tamaño, studs y cara de abajo de cada pieza con giro 0.
- Diseño conservador: traslapa juntas entre hiladas, nada de voladizos largos, amarra alas/salientes con placas que crucen al cuerpo.
- Números de pieza que LDraw nombra distinto → `scripts/part_aliases.json` (`{"970c03": "970c00"}`). Hoy faltan en LDraw: `32306`, `3814`, `41864`, `970c03`, `98560`.

## Diseños desde la app
- Ladrillo "Diseñar modelos nuevos" (biblioteca) → elige 1/3/5 + idea opcional → `repository_dispatch` `design-request` con el mismo token del sync.
- `.github/workflows/design-models.yml` corre Claude Code (`anthropics/claude-code-action@v1`) con el prompt de diseño de este archivo, herramientas limitadas a leer/escribir y `node scripts/build_models.mjs`; el workflow valida y commitea solo `builds/`. "Publicar app" corre después.
- Secreto `CLAUDE_CODE_OAUTH_TOKEN` guardado el 2026-10-19 (de `claude setup-token`, **vence ~2027-10-19**; renovarlo igual). En esta PC `claude` no está en PATH: el ejecutable de la app de escritorio está en `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<versión>\<hash>\claude.exe`. Alternativa sin vencimiento: `ANTHROPIC_API_KEY` (se cobra aparte). Sin secreto el job falla con mensaje claro y la app muestra "No se pudieron diseñar".
- En CI no hay revisión visual: al empezar sesión, abrir los modelos nuevos en la app y corregir lo raro.

## Retroalimentación de Randall
- En la app: "Algo falló" / "Mandar fotos" abren un issue de GitHub con etiqueta `resultado` (fotos adjuntas). Revisar issues al empezar sesión.
- Estado del modelo (Por armar / Armado / Necesita cambios) y progreso se guardan en el navegador de Randall. "Armado" aparta sus piezas para los demás modelos. Para dejarlo en el repo, cambiar `status` en `meta.json`.

## Decisiones tomadas
- Sin backend: repo + GitHub Actions para datos, GitHub Pages para la app. Node ≥ 18 sin dependencias. App sin build step (ES modules + importmap).
- Modelos en LDraw (texto, abierto, compatible con BrickLink Studio y three.js). El `.mpd` empaquetado evita cientos de peticiones en el celular.
- Piezas LDraw desde el mirror completo `gkjohnson/ldraw-parts-library` en GitHub (ldraw.org solo de respaldo, limita con 429). Cache en `.ldraw-cache/` (ignorado) o `$LDRAW_CACHE` en CI.
- Revisión estructural aproximada por rejilla (cajas, studs, cara de abajo): detecta encimadas y flotantes, no garantiza estabilidad.
- Imágenes de piezas: render 3D en color en el manual; fotos de Brickit en inventario.
- Diseño (Hallmark, playful, tema propio "manual de armado"): fondo de visor azul de manual con studs tenues, botón primario como ladrillo amarillo, número de paso grande. El visor queda medio-claro en modo oscuro para que se vean las piezas negras.
- Descartado: modelo de visión propio (YOLO), Pileometer, Brickit Quick Play.

## Límites conocidos
- Claude no prueba estabilidad física. Diseñar conservador e iterar con fotos de Randall.
- Si Brickit cambia su página, el import falla con mensaje claro; revisar `window.__NUXT__` en `fetchOffer()`.
- Ideas pendientes (no urgentes): PDF estilo manual (Studio importa el `.ldr` como plan B), sub-ensambles en el manual, filtros del inventario en la URL.

## Comandos
```bash
node scripts/brickit_import.mjs                    # regenerar data/ desde las fuentes
node scripts/brickit_import.mjs <url-brickit>      # probar un link sin tocar las fuentes
node scripts/build_models.mjs                      # compilar, revisar y empaquetar todos los modelos
node scripts/build_models.mjs nave-cuervo          # uno solo
node scripts/build_models.mjs --part 3039 3001     # medidas de piezas en la rejilla
node scripts/build_models.mjs --catalog            # data/part_catalog.csv + part_names.json
node scripts/check.test.mjs                        # prueba de la revisión de inventario
python -m http.server 8123                         # ver la app en http://localhost:8123
```
