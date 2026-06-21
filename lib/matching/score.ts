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
 *     verdad se pueden comparar entre ambas fuentes (un campo no comparable se
 *     EXCLUYE del cálculo: ni numerador ni denominador, nunca cuenta como 0 ni
 *     como valor neutral), ACOTADO luego por un TECHO DE CERTEZA: el promedio
 *     mide qué tan BIEN coincide lo comparable, pero la pura demografía nunca
 *     identifica, así que sin una seña distintiva en común el score no pasa de
 *     TECHO_SIN_SEÑA (ver más abajo). Esto evita el falso 99% que salía cuando
 *     solo unos pocos campos demográficos eran comparables y coincidían.
 *
 *     Por último, el score se escala por la COBERTURA: qué FRACCIÓN del peso
 *     total de campos se pudo comparar. El promedio solo dice qué tan bien
 *     coincide lo comparable, pero coincidir en 2 datos no es tan contundente
 *     como coincidir en 5: con poca evidencia la confianza debe ser menor. Sin
 *     cobertura, llenar 2 campos en el buscador daba el mismo 50% que llenar
 *     todos. Ahora coincidir en pocos campos puntúa proporcionalmente más bajo.
 *
 * Se mantiene puro para reusarlo desde el script de cruce, una API o la web.
 *
 * NOTA sobre tatuajes y el esquema real: el spec modela los tatuajes como
 * conjuntos de (tipo, ubicación_cuerpo). En este repo, sin embargo, `rasgos`
 * es un jsonb donde la fuente (IJCF Jalisco) guarda los tatuajes y señas como
 * TEXTO LIBRE (no como pares estructurados) y el lado AM (RNPDNO) muchas veces
 * NO trae señas. Por eso `perfilRasgos()` no aplana el texto en una sola bolsa
 * de palabras, sino que lo separa en tres dimensiones independientes del orden:
 * FIGURA (qué dibujo/leyenda: águila, rosa, un nombre…), ZONA corporal canónica
 * (antebrazo≈brazo, pantorrilla≈pierna) y LADO (izquierdo/derecho). La compara-
 * ción (ver `scoreTatuajes`) prioriza la figura —la señal fuerte— y trata la
 * zona/lado como matices, de modo que:
 *   - que UNA fuente reporte señas y la otra no  -> NO comparable (se excluye;
 *     la ausencia de señas no es evidencia, no descarta el par);
 *   - "águila en brazo" vs "águila en pierna"   -> alto (misma figura);
 *   - "pierna izquierda" vs "pierna derecha"     -> alto (misma zona);
 *   - figuras/zonas distintas                    -> bajo pero con piso, porque
 *     un desacuerdo de tatuajes es evidencia DÉBIL, no motivo de descarte.
 * Razón de NO usar un LLM aquí: el cruce evalúa muchísimos pares (blocking) y
 * exige un score auditable y determinista; un LLM por par sería caro, lento y
 * no reproducible. El lugar correcto para NLP/LLM es ANTES, una sola vez por
 * registro, normalizando el texto libre a {tipo, zona, lado} estructurado que
 * este motor luego compara de forma determinista.
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

// Suma de TODOS los pesos. Es el denominador de la COBERTURA (ver `puntuar`):
// el máximo de evidencia que un par podría llegar a aportar si todos los campos
// fueran comparables.
const PESO_TOTAL = Object.values(PESOS).reduce((a, b) => a + b, 0);

// Constantes de decaimiento (años / cm / días hasta similitud 0).
const EDAD_DECAE_EN = 5; // años de distancia al rango forense hasta sim 0
const ESTATURA_DECAE_EN = 8; // cm de diferencia hasta sim 0
const FECHA_DECAE_EN = 365; // días entre desaparición y hallazgo hasta sim 0

// Sub-pesos INTERNOS del campo tatuajes (no confundir con PESOS.tatuajes, que
// es el peso del campo en el promedio global). Comparamos por dimensión y la
// FIGURA manda: un diseño compartido es la señal fuerte; zona y lado matizan.
const SUBPESO_FIGURA = 3;
const SUBPESO_ZONA = 1;
const SUBPESO_LADO = 0.5;
// Piso de similitud cuando AMBAS fuentes reportaron señas pero NO coinciden: en
// este dominio cada fuente registra subconjuntos distintos, así que el des-
// acuerdo es evidencia DÉBIL. El piso evita que una diferencia de tatuajes
// hunda el score y termine descartando un par que coincide en lo demás.
const PISO_TATUAJE = 0.25;

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

  // --- Campos derivados, para clientes que esperan un porcentaje 0-100 y un
  // veredicto directo (ej. la API de búsqueda). Son una VISTA de lo anterior,
  // no recalculan nada: `puntaje` = min(99, round(score*100)); `razon` = resumen (o el
  // motivo del descarte); `descartado` = un filtro duro lo hace imposible. ---
  puntaje: number; // 0..PUNTAJE_MAX
  razon: string;
  descartado: boolean;
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

// Variantes con que las fuentes escriben un mismo estado. La CLAVE es el texto
// YA normalizado (minúsculas, sin acentos); el VALOR es la forma canónica. Sin
// esto, "Distrito Federal"/"CDMX" no coinciden con "Ciudad de México" y el
// blocking descarta TODOS los pares de la CDMX (el front se queda vacío).
const ESTADO_CANON: Record<string, string> = {
  cdmx: "ciudad de mexico",
  "distrito federal": "ciudad de mexico",
  "mexico df": "ciudad de mexico",
  "mexico d f": "ciudad de mexico",
  "ciudad de mexico df": "ciudad de mexico",
  df: "ciudad de mexico",
  "d f": "ciudad de mexico",
  // Estado de México y sus formas cortas -> una sola clave (distinta de la CDMX).
  "estado de mexico": "mexico",
  "edo de mexico": "mexico",
  "edo mexico": "mexico",
  edomex: "mexico",
};

/** Estado normalizado y con variantes unificadas (CDMX/DF, Edo. Méx., etc.). */
export function normalizarEstado(estado: string | null | undefined): string {
  const n = normalizar(estado);
  return ESTADO_CANON[n] ?? n;
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

/** Tope de compatibilidad visible (0–100). Nunca mostramos 100%: es orientativo. */
export const PUNTAJE_MAX = 99;

// ---------------------------------------------------------------------------
// TECHO DE CERTEZA. El promedio ponderado mide qué tan BIEN coincide lo que se
// pudo comparar, pero no qué tan CONTUNDENTE es esa evidencia. Coincidir en pura
// demografía (sexo, edad, estatura, lugar, fecha) nunca identifica: mucha gente
// la comparte. Por eso el score se acota: sin una seña distintiva en común no
// puede pasar de TECHO_SIN_SEÑA; con un tatuaje/seña que coincide, el techo sube
// hacia TECHO_CON_SEÑA en proporción a QUÉ TAN fuerte coincide la seña (una seña
// que NO coincide casi no sube el techo; una idéntica lo sube del todo).
// ---------------------------------------------------------------------------
const TECHO_SIN_SEÑA = 0.5; // pura demografía: máx 50%
const TECHO_CON_SEÑA = 0.85; // con seña distintiva idéntica: máx 85%

export function acotarPuntaje(puntaje: number): number {
  return Math.min(PUNTAJE_MAX, Math.round(puntaje));
}

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
  "leyenda", "figura", "claves", "palabras", "tono", "ninguno", "ninguna",
  "ningun", "tatuaje", "tatuajes", "tiene", "señas", "senas", "particulares",
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

export function perfilRasgos(rasgos: unknown): PerfilRasgos {
  const perfil: PerfilRasgos = {
    reporto: false,
    figuras: new Set(),
    zonas: new Set(),
    lados: new Set(),
  };
  if (rasgos == null) return perfil;

  // Caso texto libre directo (algunas fuentes guardan `rasgos` como string).
  if (typeof rasgos === "string") {
    clasificarTexto(rasgos, perfil);
  } else if (typeof rasgos === "object") {
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
  const ep = normalizarEstado(persona.estado);
  const ef = normalizarEstado(forense.estado);
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
  const ep = normalizarEstado(p.estado);
  const ef = normalizarEstado(f.estado);
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
  const promedio = pesoComparable === 0 ? 0 : numerador / pesoComparable;

  // Techo de certeza según la evidencia distintiva (ver TECHO_SIN_SEÑA). La
  // "fuerza" de la seña es su similitud por encima del piso de tatuajes: una
  // seña que solo llega al piso (no coincide) no sube el techo; una idéntica lo
  // sube hasta TECHO_CON_SEÑA. Sin seña comparable, el techo queda en el mínimo.
  const t = desglose.tatuajes;
  const simSeña = t.comparable ? (t.similitud ?? 0) : 0;
  const fuerzaSeña = clamp01((simSeña - PISO_TATUAJE) / (1 - PISO_TATUAJE));
  const techo = TECHO_SIN_SEÑA + (TECHO_CON_SEÑA - TECHO_SIN_SEÑA) * fuerzaSeña;
  // ESCALAR (no cortar): mapeamos el promedio al rango [0, techo] multiplicando.
  // Un `Math.min` duro aplanaría todos los buenos candidatos al techo exacto y
  // mataría el ranking entre ellos; el escalado preserva el orden (mejor
  // demografía -> mayor score) y respeta el límite (promedio<=1 => score<=techo).
  //
  // COBERTURA: qué fracción del peso TOTAL de campos se pudo comparar. El
  // promedio dice qué tan bien coincide lo comparable, pero no cuánto se comparó:
  // coincidir en 2 campos no es tan contundente como coincidir en 5. Escalar por
  // la cobertura hace que poca evidencia -> menor score (coincidir en 2 datos ya
  // no da el mismo 50% que coincidir en todos) y preserva el ranking: a igual
  // calidad de coincidencia, gana el par que pudo comparar más campos.
  const cobertura = pesoComparable / PESO_TOTAL;
  const score = promedio * techo * cobertura;

  // Resumen corto legible (para la columna `razon`): campos comparables más
  // fuertes primero.
  const resumen =
    Object.entries(desglose)
      .filter(([, c]) => c.comparable)
      .sort((a, b) => (b[1].similitud ?? 0) - (a[1].similitud ?? 0))
      .map(([nombre, c]) => `${nombre}=${(c.similitud ?? 0).toFixed(2)}`)
      .join(" ") || "sin campos comparables";

  // Veredicto duro reutilizando las mismas reglas del blocking (sexos conocidos
  // distintos, estados distintos, hallazgo anterior a la desaparición). Se
  // calcula aparte para NO alterar el desglose: un par imposible igual reporta
  // su similitud campo por campo, solo que marcado como descartado.
  const block = pasaBlocking(persona, forense);
  const scoreRedondeado = Math.round(score * 1e5) / 1e5; // 5 decimales (numeric(6,5))

  return {
    score: scoreRedondeado,
    desglose,
    pesoComparable,
    resumen,
    puntaje: acotarPuntaje(Math.round(scoreRedondeado * 100)),
    razon: block.pasa ? resumen : block.razon,
    descartado: !block.pasa,
  };
}
