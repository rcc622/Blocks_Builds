// Familias de color de Brickit -> color LDraw para el render 3D. Compartido por la app y scripts/build_models.mjs.
// Brickit solo da la familia ("Blues" mezcla azul claro y oscuro): el codigo LDraw es el tono tipico para dibujarlo.
// En model.txt se puede forzar otro tono de la misma familia: "Turquoises:43" (trans light blue), "Grays:72" (gris oscuro).
export const FAMILIES = {
  Blacks:     { es: 'Negro',    ldraw: 0,  hex: '#1B2A34' },
  Grays:      { es: 'Gris',     ldraw: 71, hex: '#969696' },
  Reds:       { es: 'Rojo',     ldraw: 4,  hex: '#B40000' },
  Yellows:    { es: 'Amarillo', ldraw: 14, hex: '#FAC80A' },
  Blues:      { es: 'Azul',     ldraw: 1,  hex: '#1E5AA8' },
  Greens:     { es: 'Verde',    ldraw: 2,  hex: '#00852B' },
  Whites:     { es: 'Blanco',   ldraw: 15, hex: '#F4F4F4' },
  Browns:     { es: 'Café',     ldraw: 70, hex: '#5F3109' },
  Turquoises: { es: 'Turquesa', ldraw: 3,  hex: '#069D9F' },
  Pinks:      { es: 'Rosa',     ldraw: 5,  hex: '#D3359D' },
  Purples:    { es: 'Morado',   ldraw: 22, hex: '#671F81' },
  Oranges:    { es: 'Naranja',  ldraw: 25, hex: '#D67923' },
};

// Codigos LDraw que tambien cuentan como cada familia (para leer .ldr hechos en Studio o a mano).
const EXTRA = { Blacks: [256], Grays: [7, 8, 72, 503], Reds: [36, 320], Yellows: [46, 191], Blues: [33, 41, 73, 272, 321],
  Greens: [10, 34, 288], Whites: [47], Browns: [6, 28, 308], Turquoises: [11, 43, 322], Pinks: [13, 29], Purples: [85, 30], Oranges: [57, 462] };

export function familyOfCode(code) {
  code = Number(code);
  for (const [fam, f] of Object.entries(FAMILIES)) if (f.ldraw === code || EXTRA[fam].includes(code)) return fam;
  return null;
}
