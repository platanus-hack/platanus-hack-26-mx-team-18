/**
 * Motor de coincidencias persona <-> forense (lógica PURA, sin base de datos).
 *
 * Dos etapas:
 *
 * Idea central (del documento del proyecto): no todas las características valen
 * igual. Un tatuaje o una seña particular es MUCHO más identificante que el
 * sexo o la estatura. Por eso cada variable tiene un "peso" distinto.
 *
 * Cómo se calcula el porcentaje (lo afinado en esta versión):
 *   1. Cada variable comparable aporta una fracción [0..1] de su peso según
 *      qué tan bien coincide (no es "todo o nada").
 *   2. El porcentaje NO es la suma cruda de puntos, sino qué proporción de la
 *      evidencia *disponible* corrobora la coincidencia:
 *          compatibilidad = puntos_obtenidos / evidencia_comparable
 *      Así, dos registros con pocos datos pero todos coincidentes no inflan el
 *      número, y dos registros con muchos datos coincidentes sí llegan alto.
 *   3. Hay un PISO de evidencia (no se puede llegar a 100% coincidiendo solo en
 *      el sexo) y un TECHO sin señas particulares (sin un rasgo distintivo en
 *      común, la certeza queda acotada por más que cuadre la demografía).
 *
 * Este archivo es lógica PURA (sin base de datos): se reusa en el script de
 * cruce masivo, en la API de búsqueda y en cualquier futuro cliente.
 */

// ---------------------------------------------------------------------------
// Pesos: importancia relativa de cada variable. Suman 100.
// Ajusta estos números para afinar el algoritmo.
// ---------------------------------------------------------------------------
export const PESOS = {
  rasgos: 45, // tatuajes y señas particulares -> lo más identificante
  edad: 18,
  estatura: 14,
  sexo: 9,
  lugar: 8,
  fecha: 6,
} as const;

// --- Parámetros de afinamiento ---
const TOL_EDAD = 5; // años de tolerancia fuera del rango de edad forense
const TOL_ESTATURA_EXACTA = 3; // cm: hasta aquí cuenta como "misma estatura"
const TOL_ESTATURA_MAX = 12; // cm: más allá de esto, la estatura no suma
const MAX_AÑOS_FECHA = 5; // si el hallazgo es >5 años tras la desaparición, no suma

// Evidencia mínima: aunque solo haya una variable comparable, el porcentaje se
// calcula como si hubiera al menos esta cantidad de "peso" en juego. Evita que
// coincidir únicamente en el sexo (9 pts) se vea como 100%.
const PISO_EVIDENCIA = 50;
// Sin ninguna seña particular en común, la certeza se acota a este techo, por
// muy bien que cuadre la demografía (edad, estatura, lugar, fecha, sexo).
const TECHO_SIN_SEÑAS = 75;
// Coincidencias por debajo de esto se consideran ruido y se reportan como 0.
const MINIMO_RELEVANTE = 8;

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
  puntaje: number; // 0 a 100 (porcentaje de compatibilidad)
  razon: string; // explicación legible de por qué coinciden
  descartado: boolean; // true = imposible que sean la misma persona
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
// Extracción del PERFIL de tatuajes/señas desde `rasgos` (jsonb).
//
// En lugar de aplanar todo en una sola bolsa de palabras (que confunde QUÉ es
// el tatuaje con DÓNDE está), separamos el texto en tres conjuntos, todos
// independientes del orden en que aparezcan los tatuajes:
//   - figuras: el dibujo/leyenda (águila, rosa, un nombre, una cruz…).
//   - zonas:   región corporal CANÓNICA (antebrazo y muñeca -> "brazo", etc.).
//   - lados:   "izquierdo" / "derecho".
//   - reporto: la fuente DIO información de tatuajes/señas (algún conjunto != ∅).
// `reporto` permite tratar "una fuente reportó y la otra no" como NO comparable.
// ---------------------------------------------------------------------------

/** Perfil de señas de una fuente, separado por dimensión (orden-independiente). */
export interface PerfilRasgos {
  reporto: boolean;
  figuras: Set<string>;
  zonas: Set<string>;
  lados: Set<string>;
}

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
  "leyenda", "figura", "claves", "palabras", "tono", "izquierdo", "izquierda",
  "derecho", "derecha", "anterior", "posterior", "superior", "inferior",
  "aproximadamente", "particular", "particulares", "senas", "seña", "señas",
  "cuerpo", "zona", "area", "region", "pequeño", "pequena", "grande", "varios",
  "varias", "diversos", "diversas", "tiene", "tienen", "aparente", "mismo",
]);

// Token (ya normalizado, sin acentos) -> región corporal canónica. Agrupa
// sinónimos y partes contiguas para que "antebrazo" y "muñeca" cuenten como la
// misma zona que "brazo", etc.
const ZONA_CANON: Record<string, string> = {
  brazo: "brazo", brazos: "brazo", antebrazo: "brazo", antebrazos: "brazo",
  bicep: "brazo", biceps: "brazo", triceps: "brazo", hombro: "brazo",
  hombros: "brazo", codo: "brazo", muneca: "brazo", munecas: "brazo",
  mano: "mano", manos: "mano", dedo: "mano", dedos: "mano", palma: "mano",
  nudillo: "mano", nudillos: "mano",
  pierna: "pierna", piernas: "pierna", muslo: "pierna", muslos: "pierna",
  pantorrilla: "pierna", rodilla: "pierna", rodillas: "pierna", gemelo: "pierna",
  tobillo: "pierna",
  pie: "pie", pies: "pie", talon: "pie", empeine: "pie",
  pecho: "torso", torax: "torso", abdomen: "torso", vientre: "torso",
  estomago: "torso", costado: "torso", costilla: "torso", costillas: "torso",
  busto: "torso", seno: "torso", senos: "torso", ombligo: "torso",
  espalda: "espalda", omoplato: "espalda", lumbar: "espalda", columna: "espalda",
  escapula: "espalda",
  cuello: "cuello", nuca: "cuello", garganta: "cuello",
  cara: "cara", rostro: "cara", mejilla: "cara", mejillas: "cara",
  frente: "cara", menton: "cara", barbilla: "cara", ceja: "cara", cejas: "cara",
  labio: "cara", labios: "cara", oreja: "cara", orejas: "cara", nariz: "cara",
  pomulo: "cara", parpado: "cara",
  cabeza: "cabeza", craneo: "cabeza",
  gluteo: "gluteo", gluteos: "gluteo", nalga: "gluteo", nalgas: "gluteo",
  cadera: "gluteo", caderas: "gluteo",
};

// Token -> lado canónico.
const LADO_CANON: Record<string, string> = {
  izquierdo: "izquierdo", izquierda: "izquierdo", izq: "izquierdo",
  derecho: "derecho", derecha: "derecho", der: "derecho",
};

/**
 * Clasifica cada palabra de un texto libre en su dimensión: primero lado, luego
 * zona corporal (sinónimos canonizados); si no es ninguna y es significativa
 * (>=4 letras, no vacía) se considera FIGURA (el qué del tatuaje).
 */
function clasificarTexto(texto: string | null | undefined, perfil: PerfilRasgos): void {
  for (const palabra of normalizar(texto).split(/[^a-z0-9ñ]+/)) {
    if (!palabra) continue;
    const lado = LADO_CANON[palabra];
    if (lado) { perfil.lados.add(lado); continue; }
    const zona = ZONA_CANON[palabra];
    if (zona) { perfil.zonas.add(zona); continue; }
    if (palabra.length >= 4 && !VACIAS.has(palabra)) perfil.figuras.add(palabra);
  }
}

/**
 * Raíz aproximada de una palabra (primeros 6 caracteres). Permite emparejar
 * variantes: "cicatriz"/"cicatrices", "tatuaje"/"tatuajes", "lunar"/"lunares".
 */
function raiz(palabra: string): string {
  return palabra.length > 6 ? palabra.slice(0, 6) : palabra;
}

/**
 * Aplana el campo `rasgos` (jsonb) a un texto. En `forense` es un objeto
 * {tatuajes, senas_particulares, ...}; en `persona` suele ser texto libre.
 * Con `claves` se eligen solo ciertos campos (ej. los más identificantes).
 */
export function textoDeRasgos(rasgos: unknown, claves?: string[]): string {
  if (rasgos == null) return "";
  if (typeof rasgos === "string") return rasgos;
  if (typeof rasgos === "object") {
    const obj = rasgos as Record<string, unknown>;
    for (const clave of CLAVES_RASGOS) {
      const valor = obj[clave];
      if (valor == null) continue;

      if (typeof valor === "string") {
        clasificarTexto(valor, perfil);
      } else if (Array.isArray(valor)) {
        // Tatuajes estructurados: arreglo de {tipo, ubicacion, lado} o strings.
        for (const item of valor) {
          if (typeof item === "string") {
            clasificarTexto(item, perfil);
          } else if (item && typeof item === "object") {
            const it = item as Record<string, unknown>;
            clasificarTexto(String(it.tipo ?? it.descripcion ?? ""), perfil);
            clasificarTexto(String(it.ubicacion ?? it.ubicacion_cuerpo ?? it.zona ?? ""), perfil);
            clasificarTexto(String(it.lado ?? it.lateralidad ?? ""), perfil);
          }
        }
      }
    }
  }

  perfil.reporto = perfil.figuras.size > 0 || perfil.zonas.size > 0 || perfil.lados.size > 0;
  return perfil;
}

/** Coeficiente de solapamiento |a∩b| / |conjunto mayor| (0 si alguno es ∅). */
function solapa(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(a.size, b.size);
}

/** ¿Comparten al menos un elemento? */
function intersecta(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
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

/**
 * Devuelve la compatibilidad (0-100) entre una persona y un forense.
 * Para acelerar lotes grandes se pueden pasar las palabras clave ya calculadas.
 */
export function puntuar(
  persona: PersonaAM,
  forense: ForensePM,
  pre?: { tokensPersona?: Set<string>; tokensForense?: Set<string> },
): Resultado {
  // --- Filtros duros: si se cumplen, es IMPOSIBLE que sean la misma persona ---

  // 1) Sexos conocidos y distintos.
  if (sexoConocido(persona.sexo) && sexoConocido(forense.sexo) && persona.sexo !== forense.sexo) {
    return { puntaje: 0, razon: "Sexos distintos", descartado: true };
  }
  // 2) No se puede hallar un cuerpo ANTES de que la persona desapareciera.
  if (persona.fecha_desaparicion > forense.fecha_hallazgo) {
    return { puntaje: 0, razon: "Hallazgo anterior a la desaparición", descartado: true };
  }

  // `puntos` = evidencia que corrobora; `evidencia` = evidencia comparable total.
  // El porcentaje final es puntos / evidencia (ver cabecera del archivo).
  let puntos = 0;
  let evidencia = 0;
  const razones: string[] = [];
  let huboSeña = false;

  // --- Sexo: solo es comparable si AMBOS lo tienen definido ---
  if (sexoConocido(persona.sexo) && sexoConocido(forense.sexo)) {
    evidencia += PESOS.sexo;
    // (los sexos distintos ya se descartaron arriba: aquí siempre coinciden)
    puntos += PESOS.sexo;
    razones.push(`sexo coincide (${persona.sexo})`);
  }

  // --- Edad: la persona cae dentro (o cerca) del rango estimado del forense ---
  if (persona.edad != null && forense.edad_inicial != null) {
    evidencia += PESOS.edad;
    const ini = forense.edad_inicial;
    const fin = forense.edad_final ?? forense.edad_inicial;
    if (persona.edad >= ini && persona.edad <= fin) {
      puntos += PESOS.edad;
      razones.push(`edad ${persona.edad} dentro del rango ${ini}-${fin}`);
    } else {
      const dist = persona.edad < ini ? ini - persona.edad : persona.edad - fin;
      if (dist <= TOL_EDAD) {
        puntos += PESOS.edad * (1 - dist / TOL_EDAD) * 0.6;
        razones.push(`edad ${persona.edad} cercana al rango ${ini}-${fin}`);
      }
    }
  }
  const igual = normalizar(p.sexo) === normalizar(f.sexo);
  return {
    comparable: true,
    similitud: igual ? 1 : 0,
    peso,
    explicacion: igual ? `coincide (${p.sexo})` : `distinto (${p.sexo} vs ${f.sexo})`,
  };
}

  // --- Estatura: cuanto más parecida, más fracción del peso ---
  if (persona.estatura != null && forense.estatura != null) {
    evidencia += PESOS.estatura;
    const d = Math.abs(persona.estatura - forense.estatura);
    if (d <= TOL_ESTATURA_EXACTA) {
      puntos += PESOS.estatura;
      razones.push(`estatura casi igual (${persona.estatura} vs ${forense.estatura} cm)`);
    } else if (d <= TOL_ESTATURA_MAX) {
      const factor = 1 - (d - TOL_ESTATURA_EXACTA) / (TOL_ESTATURA_MAX - TOL_ESTATURA_EXACTA);
      puntos += PESOS.estatura * factor;
      razones.push(`estatura parecida (${persona.estatura} vs ${forense.estatura} cm)`);
    }
  }
  const lo = Math.min(fa, fb);
  const hi = Math.max(fa, fb);

  // --- Lugar: mismo estado. Señal SUAVE (suma, nunca descarta): es común que
  // alguien desaparezca en un estado y sus restos aparezcan en otro. ---
  if (persona.estado && forense.estado) {
    evidencia += PESOS.lugar;
    if (mismoEstado(persona.estado, forense.estado)) {
      puntos += PESOS.lugar;
      razones.push(`mismo estado (${forense.estado})`);
    }
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

  // --- Cercanía temporal: hallazgo poco después de la desaparición = más probable ---
  const dias =
    (Date.parse(forense.fecha_hallazgo) - Date.parse(persona.fecha_desaparicion)) / 86_400_000;
  if (Number.isFinite(dias) && dias >= 0) {
    evidencia += PESOS.fecha;
    const años = dias / 365;
    if (años <= MAX_AÑOS_FECHA) {
      puntos += PESOS.fecha * (1 - años / MAX_AÑOS_FECHA);
      if (años <= 1) razones.push("hallazgo dentro del primer año");
    }
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

  // --- Rasgos: señas/tatuajes en común (lo más identificante) ---
  // Solo es "comparable" si AMBOS describieron rasgos. Si coincide al menos una
  // seña, libera el techo y se vuelve la evidencia más fuerte.
  const tP = pre?.tokensPersona ?? tokensPersona(persona);
  const tF = pre?.tokensForense ?? tokensForense(forense);
  if (tP.size > 0 && tF.size > 0) {
    evidencia += PESOS.rasgos;
    const raicesF = new Set([...tF].map(raiz));
    const comunes = [...tP].filter((t) => raicesF.has(raiz(t)));
    if (comunes.length > 0) {
      huboSeña = true;
      // Rendimientos decrecientes: 1 seña ya es fuerte, varias acercan al máximo.
      const fraccion = 1 - Math.pow(0.5, comunes.length);
      puntos += PESOS.rasgos * fraccion;
      razones.push(`señas en común: ${comunes.slice(0, 6).join(", ")}`);
    }
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
  const a = pre?.rasgosPersona ?? perfilRasgos(p.rasgos);
  const b = pre?.rasgosForense ?? perfilRasgos(f.rasgos);

  // No comparable si NINGUNA reportó señas.
  if (!a.reporto && !b.reporto) {
    return noComparable(peso, "no comparable: ninguna fuente reportó tatuajes/señas");
  }
  // Si SOLO una reportó, la ausencia en la otra no es evidencia (familias y
  // peritos registran subconjuntos distintos): se EXCLUYE, no se penaliza.
  if (!a.reporto || !b.reporto) {
    return noComparable(peso, "no comparable: solo una fuente reportó tatuajes/señas");
  }

  // Ambas reportaron: comparar dimensión por dimensión, solo las que ambas
  // fuentes informan. La FIGURA pesa más (señal fuerte); zona y lado matizan.
  const comps: { sim: number; w: number }[] = [];
  const detalle: string[] = [];

  if (a.figuras.size && b.figuras.size) {
    const sim = solapa(a.figuras, b.figuras);
    comps.push({ sim, w: SUBPESO_FIGURA });
    detalle.push(`figura ${sim.toFixed(2)}`);
  }
  if (a.zonas.size && b.zonas.size) {
    const sim = solapa(a.zonas, b.zonas);
    comps.push({ sim, w: SUBPESO_ZONA });
    detalle.push(`zona ${sim.toFixed(2)}`);
  }
  // El lado solo aporta si además comparten zona (un "izquierdo" de brazo no
  // dice nada frente a un "derecho" de pierna).
  if (a.lados.size && b.lados.size && intersecta(a.zonas, b.zonas)) {
    const sim = intersecta(a.lados, b.lados) ? 1 : 0.3;
    comps.push({ sim, w: SUBPESO_LADO });
    detalle.push(`lado ${sim.toFixed(2)}`);
  }

  // Ambas reportaron pero en dimensiones que no se solapan (p.ej. una solo dio
  // figura y la otra solo zona): no hay base de comparación -> no comparable.
  if (comps.length === 0) {
    return noComparable(peso, "no comparable: señas descritas en dimensiones distintas");
  }

  const pesoTotal = comps.reduce((s, c) => s + c.w, 0);
  const bruta = comps.reduce((s, c) => s + c.sim * c.w, 0) / pesoTotal;
  // Piso: un desacuerdo de señas es evidencia débil, nunca motivo de descarte.
  const sim = Math.max(PISO_TATUAJE, bruta);
  if (sim > bruta) detalle.push(`piso ${PISO_TATUAJE}`);

  return { comparable: true, similitud: sim, peso, explicacion: detalle.join(", ") };
}

// ---------------------------------------------------------------------------
// Score final: promedio ponderado de los campos COMPARABLES.
// ---------------------------------------------------------------------------

/** Perfiles de rasgos ya calculados, para acelerar lotes grandes. */
export interface PreCalculo {
  rasgosPersona?: PerfilRasgos;
  rasgosForense?: PerfilRasgos;
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

  // --- Normalización a porcentaje de compatibilidad ---
  const base = Math.max(evidencia, PISO_EVIDENCIA);
  let compat = (puntos / base) * 100;
  if (!huboSeña) compat = Math.min(compat, TECHO_SIN_SEÑAS);
  if (compat < MINIMO_RELEVANTE) compat = 0;

  return {
    puntaje: Math.round(compat * 100) / 100, // 2 decimales (columna numeric(5,2))
    razon: razones.join("; ") || "Sin coincidencias relevantes",
    descartado: false,
  };
}
