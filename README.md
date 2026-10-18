# legobuilds

Construcciones Lego personalizadas a partir de mi inventario real de piezas, con manuales interactivos paso a paso.

## Cómo actualizo mi inventario
1. En **Brickit** (Android): Pockets → Share → copiar link (`https://brickit.app/offer/...`).
2. Pegar el link en [`data/sources/brickit_links.txt`](data/sources/brickit_links.txt).
3. Piezas que Brickit no reconoció → agregar a [`data/manual_parts.csv`](data/manual_parts.csv) con su número BrickLink.
4. Commit + push. GitHub Actions regenera `data/` solo. También se puede correr a mano en **Actions → Sync inventario Brickit**.

Local: `node scripts/brickit_import.mjs`

## Estado
- Lote 1: 468 piezas · 140 formas · 12 familias de color (2026-10-11).
- App: pendiente. Ver [`CLAUDE.md`](CLAUDE.md) para el plan completo.
