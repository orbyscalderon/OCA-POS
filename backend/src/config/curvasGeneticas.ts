// Curvas de referencia por línea genética — valores aproximados publicados por los
// proveedores (guías de manejo), en gramos/edad para engorde y % de postura/edad para
// ponedoras. Sirven para comparar el lote real contra el objetivo, no son exactos para
// cada condición de campo. Si el lote no tiene lineaGenetica, simplemente no hay
// comparativa (el resto del módulo sigue funcionando igual).

export interface PuntoPeso { edadDias: number; pesoG: number }
export interface PuntoPostura { edadDias: number; hdpPct: number }

export interface LineaGenetica {
  slug: string;
  nombre: string;
  especie: "broiler" | "layer";
  curvaPeso?: PuntoPeso[];
  curvaPostura?: PuntoPostura[];
}

export const LINEAS_GENETICAS: LineaGenetica[] = [
  {
    slug: "cobb500", nombre: "Cobb 500", especie: "broiler",
    curvaPeso: [
      { edadDias: 0, pesoG: 42 }, { edadDias: 7, pesoG: 180 }, { edadDias: 14, pesoG: 430 },
      { edadDias: 21, pesoG: 780 }, { edadDias: 28, pesoG: 1250 }, { edadDias: 35, pesoG: 1800 },
      { edadDias: 42, pesoG: 2400 }, { edadDias: 49, pesoG: 2900 },
    ],
  },
  {
    slug: "ross308", nombre: "Ross 308", especie: "broiler",
    curvaPeso: [
      { edadDias: 0, pesoG: 42 }, { edadDias: 7, pesoG: 190 }, { edadDias: 14, pesoG: 460 },
      { edadDias: 21, pesoG: 830 }, { edadDias: 28, pesoG: 1320 }, { edadDias: 35, pesoG: 1870 },
      { edadDias: 42, pesoG: 2440 }, { edadDias: 49, pesoG: 2960 },
    ],
  },
  {
    slug: "hubbard_flex", nombre: "Hubbard Flex", especie: "broiler",
    curvaPeso: [
      { edadDias: 0, pesoG: 42 }, { edadDias: 7, pesoG: 175 }, { edadDias: 14, pesoG: 420 },
      { edadDias: 21, pesoG: 760 }, { edadDias: 28, pesoG: 1220 }, { edadDias: 35, pesoG: 1760 },
      { edadDias: 42, pesoG: 2350 }, { edadDias: 49, pesoG: 2850 },
    ],
  },
  {
    slug: "lohmann_brown", nombre: "Lohmann Brown", especie: "layer",
    curvaPostura: [
      { edadDias: 126, hdpPct: 5 }, { edadDias: 140, hdpPct: 50 }, { edadDias: 154, hdpPct: 85 },
      { edadDias: 175, hdpPct: 93 }, { edadDias: 210, hdpPct: 94 }, { edadDias: 280, hdpPct: 90 },
      { edadDias: 350, hdpPct: 85 }, { edadDias: 420, hdpPct: 78 }, { edadDias: 490, hdpPct: 70 },
      { edadDias: 560, hdpPct: 60 },
    ],
  },
  {
    slug: "hyline_brown", nombre: "Hy-Line Brown", especie: "layer",
    curvaPostura: [
      { edadDias: 126, hdpPct: 5 }, { edadDias: 140, hdpPct: 52 }, { edadDias: 154, hdpPct: 87 },
      { edadDias: 175, hdpPct: 94 }, { edadDias: 210, hdpPct: 95 }, { edadDias: 280, hdpPct: 91 },
      { edadDias: 350, hdpPct: 86 }, { edadDias: 420, hdpPct: 79 }, { edadDias: 490, hdpPct: 71 },
      { edadDias: 560, hdpPct: 61 },
    ],
  },
  {
    slug: "isa_brown", nombre: "ISA Brown", especie: "layer",
    curvaPostura: [
      { edadDias: 126, hdpPct: 5 }, { edadDias: 140, hdpPct: 50 }, { edadDias: 154, hdpPct: 86 },
      { edadDias: 175, hdpPct: 93 }, { edadDias: 210, hdpPct: 94 }, { edadDias: 280, hdpPct: 90 },
      { edadDias: 350, hdpPct: 85 }, { edadDias: 420, hdpPct: 78 }, { edadDias: 490, hdpPct: 70 },
      { edadDias: 560, hdpPct: 60 },
    ],
  },
];

export function getLineaGenetica(slug: string | null | undefined): LineaGenetica | undefined {
  if (!slug) return undefined;
  return LINEAS_GENETICAS.find((l) => l.slug === slug);
}

// Interpolación lineal entre los dos puntos más cercanos a edadDias; fuera de rango, se
// pega al extremo más cercano en vez de extrapolar (evita valores absurdos).
function interpolar(puntos: { edadDias: number; valor: number }[], edadDias: number): number | null {
  if (puntos.length === 0) return null;
  const ordenados = [...puntos].sort((a, b) => a.edadDias - b.edadDias);
  if (edadDias <= ordenados[0].edadDias) return ordenados[0].valor;
  if (edadDias >= ordenados[ordenados.length - 1].edadDias) return ordenados[ordenados.length - 1].valor;
  for (let i = 0; i < ordenados.length - 1; i++) {
    const a = ordenados[i], b = ordenados[i + 1];
    if (edadDias >= a.edadDias && edadDias <= b.edadDias) {
      const t = (edadDias - a.edadDias) / (b.edadDias - a.edadDias);
      return a.valor + t * (b.valor - a.valor);
    }
  }
  return null;
}

export function pesoEstandarEnEdad(linea: LineaGenetica | undefined, edadDias: number): number | null {
  if (!linea?.curvaPeso) return null;
  const v = interpolar(linea.curvaPeso.map((p) => ({ edadDias: p.edadDias, valor: p.pesoG })), edadDias);
  return v != null ? Math.round(v) : null;
}

export function hdpEstandarEnEdad(linea: LineaGenetica | undefined, edadDias: number): number | null {
  if (!linea?.curvaPostura) return null;
  const v = interpolar(linea.curvaPostura.map((p) => ({ edadDias: p.edadDias, valor: p.hdpPct })), edadDias);
  return v != null ? Math.round(v * 10) / 10 : null;
}
