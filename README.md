# Blocks Builds

Construcciones Lego personalizadas con mi inventario real de piezas, y manuales interactivos paso a paso.

**App:** https://rcc622.github.io/Blocks_Builds/ (se instala en el celular desde el menú del navegador → "Agregar a pantalla de inicio").

## Qué hace
- **Modelos:** cada uno con su manual 3D por pasos. Las piezas nuevas caen en su lugar; arrastra para girar.
- **¿Las tengo?** Cada modelo dice si tienes todas las piezas o cuáles faltan, con un color sustituto cuando hay.
- **¿Dónde está?** Toca una pieza y ves en qué foto de Brickit quedó, con la pieza marcada.
- **Mis piezas:** todo el inventario con búsqueda y filtros por tipo y color.

## Cómo actualizo mi inventario
1. En **Brickit**: Pockets → Share → elige **Blocks Builds** (o copia el link).
2. En la app, **Sincronizar** → pega el link → "Actualizar inventario". En ~2 minutos se refleja.
   - La primera vez: conectar GitHub con un token (la pantalla explica los 4 pasos).
   - Sin token: pega el link en [`data/sources/brickit_links.txt`](data/sources/brickit_links.txt) desde GitHub.
3. Piezas que Brickit no reconoció → [`data/manual_parts.csv`](data/manual_parts.csv) con su número BrickLink.

## Cómo pido un modelo nuevo
En la app: **Pedir un diseño**, o pídeselo a Claude Code en este repo ("diseña un camión con mis piezas"). Cuando lo armes, **Terminé** → "Algo falló" o "Mandar fotos" para que Claude lo ajuste.

## Estado
- Inventario lote 1: 468 piezas · 140 formas · 12 colores.
- Modelos: Faro (29 piezas), Casita amarilla (34), Nave Cuervo (38).
- Detalles técnicos y cómo diseñar modelos: [`CLAUDE.md`](CLAUDE.md).
