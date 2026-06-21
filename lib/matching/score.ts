/**
 * Motor de coincidencias persona <-> forense (lógica PURA, sin base de datos).
 *
 * Dos etapas:
 *
 *  1) BLOCKING — `pasaBlocking(persona, forense)` decide si un par es siquiera
 *     candidato. No puntúa: solo descarta imposibles, para no comparar todo
 *     contra todo. Reglas (ver función): mismo sexo, mismo estado, y que el
 *     hallazgo no sea anterior a la desaparición. Ante datos faltantes, DEJA
 *     PASAR (no descarta por falta de información).
 *
 *  2) SCORE — `puntuar(persona, forense)` devuelve un score 0..1 y el desglose
 *     campo por campo. El score es el PROMEDIO PONDERADO de los campos que de
 *     verdad se pueden comparar entre ambas fuentes. Un campo no comparable se
 *     EXCLUYE del cálculo (no entra ni en el numerador ni en el denominador);
 *     nunca cuenta como 0 ni como valor neutral.
 *
 * Se mantiene puro para reusarlo desde el script de cruce, una API o la web.
 *
 * NOTA sobre tatuajes y el esquema real: el spec modela los tatuajes como
 * conjuntos de (tipo, ubicación_cuerpo). En este repo, sin embargo, `rasgos`
 * es un jsonb donde la fuente (IJCF Jalisco) guarda los tatuajes y señas como
 * TEXTO LIBRE (no como pares estructurados). Por eso `conjuntoRasgos()` deriva
 * el conjunto a comparar tokenizando ese texto a descriptores normalizados; si
 * en el futuro `rasgos.tatuajes` llega como arreglo de objetos {tipo, ubicacion}
 * también lo soporta y construye los pares. La semántica de comparación de
 * conjuntos (|intersección| / |conjunto mayor|) es idéntica a la del spec.
 */

// ---------------------------------------------------------------------------
// Pesos por campo. NO tienen por qué sumar nada en particular: el score se
// normaliza dividiendo por la suma de pesos de los campos comparables.
// ---------------------------------------------------------------------------
export const PESOS = {
  tatuajes: 3,
  sexo: 2,
  edad: 2,
  estatura: 2,
  fecha: 1,
  lugar: 1,
} as const;

export type Campo = keyof typeof PESOS;

// Constantes de decaimiento (años / cm / días hasta similitud 0).
const EDAD_DECAE_EN = 5; // años de distancia al rango forense hasta sim 0
const ESTATURA_DECAE_EN = 8; // cm de diferencia hasta sim 0
const FECHA_DECAE_EN = 365; // días entre desaparición y hallazgo hasta sim 0

// ---------------------------------------------------------------------------
// Tipos de entrada (solo los campos que necesita el motor). El `estado` y el
// `municipio` se resuelven desde la tabla `lugares` antes de llamar al motor.
// ---------------------------------------------------------------------------
export interface PersonaAM {
  id: number;
  sexo: string; // "Masculino" | "Femenino" | "Indeterminado" | null
  edad: number | null; // dato puntual (min = max = edad)
  estatura: number | null; // cm
  fecha_desaparicion: string | null; // "YYYY-MM-DD"
  estado: string | null; // estado del último lugar visto
  municipio: string | null; // municipio del último lugar visto
  rasgos: unknown; // jsonb (texto u objeto con tatuajes/señas)
}

export interface ForensePM {
  id: number;
  sexo: string;
  edad_inicial: number | null; // rango estimado del forense...
  edad_final: number | null; // ...(min, max)
  estatura: number | null; // cm
  fecha_hallazgo: string | null; // "YYYY-MM-DD"
  estado: string | null; // estado del lugar de hallazgo
  municipio: string | null; // municipio del lugar de hallazgo
  rasgos: unknown; // jsonb (objeto: {tatuajes, senas_particulares, ...})
}

/** Resultado de un campo: si fue comparable, su similitud y una explicación. */
export interface CampoScore {
  comparable: boolean;
  similitud: number | null; // 0..1 cuando comparable; null si no comparable
  peso: number; // peso del campo (informativo, para auditar)
  explicacion: string; // por qué ese número (o por qué no comparable)
}

export type Desglose = Record<Campo, CampoScore>;

export interface Resultado {
  score: number; // 0..1
  desglose: Desglose;
  pesoComparable: number; // suma de pesos que entraron al promedio (denominador)
  resumen: string; // resumen corto legible (para la columna `razon`)
}

export interface BlockingResultado {
  pasa: boolean;
  razon: string; // por qué se descartó (o "candidato" si pasa)
}

// ---------------------------------------------------------------------------
// Utilidades.
// ---------------------------------------------------------------------------

/** Minúsculas y sin acentos: "Antebrazó" -> "antebrazo". null/"" -> "". */
function normalizar(texto: string | null | undefined): string {
  if (!texto) return "";
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de acento combinantes
    .trim();
}

/** Un sexo solo es comparable si se conoce y no es "Indeterminado". */
function sexoConocido(s: string | null | undefined): boolean {
  const n = normalizar(s);
  return n === "masculino" || n === "femenino";
}

/** Parsea "YYYY-MM-DD" a milisegundos; null si falta o es inválida. */
function fechaMs(f: string | null | undefined): number | null {
  if (!f) return null;
  const ms = Date.parse(f);
  return Number.isFinite(ms) ? ms : null;
}

const MS_DIA = 86_400_000;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const noComparable = (peso: number, explicacion: string): CampoScore => ({
  comparable: false,
  similitud: null,
  peso,
  explicacion,
});

// ---------------------------------------------------------------------------
// Extracción del conjunto de tatuajes/señas desde `rasgos` (jsonb).
//
// Devuelve { reporto, set }:
//   - reporto: la fuente DIO información de tatuajes/señas (haya o no tokens).
//   - set: descriptores normalizados a comparar como conjunto.
// `reporto` es true sii el set quedó no vacío, de modo que comparar nunca
// divide por cero.
// ---------------------------------------------------------------------------

// Campos del jsonb que consideramos "tatuajes / señas particulares".
const CLAVES_RASGOS = [
  "tatuajes",
  "senas_particulares",
  "senales_particulares",
  "senas",
  "señas",
  "marcas",
  "cicatrices",
];

// Palabras genéricas que no identifican: se descartan al tokenizar texto libre.
const VACIAS = new Set([
  "para", "como", "pero", "porque", "este", "esta", "esto", "esos", "esas",
  "unos", "unas", "una", "uno", "del", "los", "las", "con", "sin", "que",
  "color", "colores", "marca", "talla", "tinta", "negro", "negra", "blanco",
  "blanca", "visible", "parte", "lado", "tipo", "presenta", "localizado",
  "localizada", "ambos", "ambas", "sobre", "tres", "dos", "cual", "cuales",
  "leyenda", "figura", "claves", "palabras", "tono", "ninguno", "ninguna",
  "ningun", "tatuaje", "tatuajes", "tiene", "señas", "senas", "particulares",
]);

/** Tokeniza texto libre a descriptores significativos (>=4 letras, sin vacías). */
function tokenizar(texto: string, acc: Set<string>): void {
  for (const palabra of normalizar(texto).split(/[^a-z0-9ñ]+/)) {
    if (palabra.length >= 4 && !VACIAS.has(palabra)) acc.add(palabra);
  }
}

export function conjuntoRasgos(rasgos: unknown): { reporto: boolean; set: Set<string> } {
  const set = new Set<string>();
  if (rasgos == null) return { reporto: false, set };

  // Caso texto libre directo (algunas fuentes guardan `rasgos` como string).
  if (typeof rasgos === "string") {
    tokenizar(rasgos, set);
    return { reporto: set.size > 0, set };
  }

  if (typeof rasgos === "object") {
    const obj = rasgos as Record<string, unknown>;
    for (const clave of CLAVES_RASGOS) {
      const valor = obj[clave];
      if (valor == null) continue;

      if (typeof valor === "string") {
        tokenizar(valor, set);
      } else if (Array.isArray(valor)) {
        // Soporte para tatuajes estructurados: arreglo de {tipo, ubicacion}
        // (o de strings). Cada uno se vuelve un descriptor del conjunto.
        for (const item of valor) {
          if (typeof item === "string") {
            tokenizar(item, set);
          } else if (item && typeof item === "object") {
            const it = item as Record<string, unknown>;
            const tipo = normalizar(String(it.tipo ?? it.descripcion ?? ""));
            const ubic = normalizar(String(it.ubicacion ?? it.ubicacion_cuerpo ?? it.zona ?? ""));
            if (tipo || ubic) set.add(`${tipo}@${ubic}`);
          }
        }
      }
    }
  }
  return { reporto: set.size > 0, set };
}

// ---------------------------------------------------------------------------
// BLOCKING. Genera candidatos: descarta pares imposibles, deja pasar el resto.
// ---------------------------------------------------------------------------
export function pasaBlocking(persona: PersonaAM, forense: ForensePM): BlockingResultado {
  // 1) Mismo sexo. Si alguno es null o "Indeterminado", dejar pasar.
  if (sexoConocido(persona.sexo) && sexoConocido(forense.sexo)) {
    if (normalizar(persona.sexo) !== normalizar(forense.sexo)) {
      return { pasa: false, razon: "sexos distintos" };
    }
  }

  // 2) Mismo estado normalizado, cuando AMBOS lo tengan.
  const ep = normalizar(persona.estado);
  const ef = normalizar(forense.estado);
  if (ep && ef && ep !== ef) {
    return { pasa: false, razon: "estados distintos" };
  }

  // 3) Imposible hallar el cuerpo ANTES de la desaparición. Si falta alguna
  //    fecha, no descartar.
  const desap = fechaMs(persona.fecha_desaparicion);
  const hallazgo = fechaMs(forense.fecha_hallazgo);
  if (desap != null && hallazgo != null && hallazgo < desap) {
    return { pasa: false, razon: "hallazgo anterior a la desaparición" };
  }

  return { pasa: true, razon: "candidato" };
}

// ---------------------------------------------------------------------------
// Score por campo.
// ---------------------------------------------------------------------------

function scoreSexo(p: PersonaAM, f: ForensePM): CampoScore {
  const peso = PESOS.sexo;
  if (!sexoConocido(p.sexo) || !sexoConocido(f.sexo)) {
    return noComparable(peso, "no comparable: falta sexo o es Indeterminado");
  }
  const igual = normalizar(p.sexo) === normalizar(f.sexo);
  return {
    comparable: true,
    similitud: igual ? 1 : 0,
    peso,
    explicacion: igual ? `coincide (${p.sexo})` : `distinto (${p.sexo} vs ${f.sexo})`,
  };
}

function scoreEdad(p: PersonaAM, f: ForensePM): CampoScore {
  const peso = PESOS.edad;
  // Rango forense (tolera que solo venga uno de los dos extremos).
  const fa = f.edad_inicial ?? f.edad_final;
  const fb = f.edad_final ?? f.edad_inicial;
  if (p.edad == null || fa == null || fb == null) {
    return noComparable(peso, "no comparable: falta edad en alguna fuente");
  }
  const lo = Math.min(fa, fb);
  const hi = Math.max(fa, fb);

  if (p.edad >= lo && p.edad <= hi) {
    return {
      comparable: true,
      similitud: 1,
      peso,
      explicacion: `edad ${p.edad} dentro del rango ${lo}-${hi}`,
    };
  }
  const dist = p.edad < lo ? lo - p.edad : p.edad - hi;
  const sim = clamp01(1 - dist / EDAD_DECAE_EN);
  return {
    comparable: true,
    similitud: sim,
    peso,
    explicacion: `edad ${p.edad} a ${dist} año(s) del rango ${lo}-${hi}`,
  };
}

function scoreEstatura(p: PersonaAM, f: ForensePM): CampoScore {
  const peso = PESOS.estatura;
  if (p.estatura == null || f.estatura == null) {
    return noComparable(peso, "no comparable: falta estatura en alguna fuente");
  }
  const dif = Math.abs(p.estatura - f.estatura);
  const sim = clamp01(1 - dif / ESTATURA_DECAE_EN);
  return {
    comparable: true,
    similitud: sim,
    peso,
    explicacion: `diferencia ${dif} cm (${p.estatura} vs ${f.estatura})`,
  };
}

function scoreFecha(p: PersonaAM, f: ForensePM): CampoScore {
  const peso = PESOS.fecha;
  const desap = fechaMs(p.fecha_desaparicion);
  const hallazgo = fechaMs(f.fecha_hallazgo);
  if (desap == null || hallazgo == null) {
    return noComparable(peso, "no comparable: falta alguna fecha");
  }
  // La coherencia (hallazgo >= desaparición) ya se filtró en blocking; aquí
  // solo medimos cercanía. El clamp protege ante pares no filtrados.
  const dias = Math.max(0, Math.round((hallazgo - desap) / MS_DIA));
  const sim = clamp01(1 - dias / FECHA_DECAE_EN);
  return {
    comparable: true,
    similitud: sim,
    peso,
    explicacion: `${dias} día(s) entre desaparición y hallazgo`,
  };
}

function scoreLugar(p: PersonaAM, f: ForensePM): CampoScore {
  const peso = PESOS.lugar;
  const ep = normalizar(p.estado);
  const ef = normalizar(f.estado);
  if (!ep || !ef) {
    return noComparable(peso, "no comparable: falta clave geográfica (estado)");
  }
  if (ep !== ef) {
    return { comparable: true, similitud: 0, peso, explicacion: "estados distintos" };
  }
  const mp = normalizar(p.municipio);
  const mf = normalizar(f.municipio);
  if (mp && mf && mp === mf) {
    return { comparable: true, similitud: 1, peso, explicacion: `mismo municipio (${p.municipio})` };
  }
  return {
    comparable: true,
    similitud: 0.5,
    peso,
    explicacion: `mismo estado (${p.estado}), municipio distinto o desconocido`,
  };
}

function scoreTatuajes(p: PersonaAM, f: ForensePM, pre?: PreCalculo): CampoScore {
  const peso = PESOS.tatuajes;
  const rp = pre?.rasgosPersona ?? conjuntoRasgos(p.rasgos);
  const rf = pre?.rasgosForense ?? conjuntoRasgos(f.rasgos);

  // No comparable SOLO si NINGUNA de las dos fuentes reportó tatuajes/señas.
  if (!rp.reporto && !rf.reporto) {
    return noComparable(peso, "no comparable: ninguna fuente reportó tatuajes/señas");
  }

  // Si una reportó y la otra no, su set está vacío -> 0 coincidencias.
  let interseccion = 0;
  for (const t of rp.set) if (rf.set.has(t)) interseccion++;
  const mayor = Math.max(rp.set.size, rf.set.size);
  const sim = mayor === 0 ? 0 : interseccion / mayor;

  const detalle = rp.reporto && rf.reporto
    ? `${interseccion} en común de ${mayor} descriptor(es)`
    : "una fuente reportó tatuajes/señas y la otra no";
  return { comparable: true, similitud: sim, peso, explicacion: detalle };
}

// ---------------------------------------------------------------------------
// Score final: promedio ponderado de los campos COMPARABLES.
// ---------------------------------------------------------------------------

/** Conjuntos de rasgos ya calculados, para acelerar lotes grandes. */
export interface PreCalculo {
  rasgosPersona?: { reporto: boolean; set: Set<string> };
  rasgosForense?: { reporto: boolean; set: Set<string> };
}

export function puntuar(persona: PersonaAM, forense: ForensePM, pre?: PreCalculo): Resultado {
  const desglose: Desglose = {
    tatuajes: scoreTatuajes(persona, forense, pre),
    sexo: scoreSexo(persona, forense),
    edad: scoreEdad(persona, forense),
    estatura: scoreEstatura(persona, forense),
    fecha: scoreFecha(persona, forense),
    lugar: scoreLugar(persona, forense),
  };

  let numerador = 0;
  let pesoComparable = 0;
  for (const campo of Object.values(desglose)) {
    if (campo.comparable && campo.similitud != null) {
      numerador += campo.peso * campo.similitud;
      pesoComparable += campo.peso;
    }
  }
  const score = pesoComparable === 0 ? 0 : numerador / pesoComparable;

  // Resumen corto legible (para la columna `razon`): campos comparables más
  // fuertes primero.
  const resumen =
    Object.entries(desglose)
      .filter(([, c]) => c.comparable)
      .sort((a, b) => (b[1].similitud ?? 0) - (a[1].similitud ?? 0))
      .map(([nombre, c]) => `${nombre}=${(c.similitud ?? 0).toFixed(2)}`)
      .join(" ") || "sin campos comparables";

  return {
    score: Math.round(score * 1e5) / 1e5, // 5 decimales (columna numeric(6,5))
    desglose,
    pesoComparable,
    resumen,
  };
}
