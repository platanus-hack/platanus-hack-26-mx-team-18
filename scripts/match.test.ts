/**
 * Pruebas sintéticas del motor de coincidencias (lib/matching/score.ts).
 *
 * NO toca la base de datos: arma personas y forenses a mano y verifica el
 * blocking y el score campo por campo. Sirve para afinar pesos/umbrales sin
 * tener que correr el cruce real.
 *
 *   pnpm test:match
 *
 * Sale con código 1 si alguna aserción falla (útil en CI).
 */

import {
  pasaBlocking,
  puntuar,
  perfilRasgos,
  PESOS,
  type PersonaAM,
  type ForensePM,
} from "@/lib/matching/score";

// ---------------------------------------------------------------------------
// Mini-arnés de aserciones.
// ---------------------------------------------------------------------------
let pasaron = 0;
let fallaron = 0;

function ok(cond: boolean, nombre: string, detalle?: string) {
  if (cond) {
    pasaron++;
    console.log(`  ✅ ${nombre}`);
  } else {
    fallaron++;
    console.log(`  ❌ ${nombre}${detalle ? ` -> ${detalle}` : ""}`);
  }
}

/** Igualdad aproximada de flotantes (el score redondea a 5 decimales). */
function casi(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// Fábricas: una persona y un forense "todo comparable y coincidente" como base;
// cada prueba sobreescribe solo lo que le interesa.
// ---------------------------------------------------------------------------
function persona(p: Partial<PersonaAM> = {}): PersonaAM {
  return {
    id: 1,
    sexo: "Masculino",
    edad: 30,
    estatura: 175,
    fecha_desaparicion: "2020-01-01",
    estado: "Jalisco",
    municipio: "Guadalajara",
    rasgos: { tatuajes: "águila antebrazo" },
    ...p,
  };
}

function forense(f: Partial<ForensePM> = {}): ForensePM {
  return {
    id: 1,
    sexo: "Masculino",
    edad_inicial: 28,
    edad_final: 35,
    estatura: 175,
    fecha_hallazgo: "2020-01-01",
    estado: "Jalisco",
    municipio: "Guadalajara",
    rasgos: { tatuajes: "águila antebrazo" },
    ...f,
  };
}

// ---------------------------------------------------------------------------
// 1) BLOCKING
// ---------------------------------------------------------------------------
console.log("\n# Blocking");

ok(!pasaBlocking(persona(), forense({ sexo: "Femenino" })).pasa, "descarta sexos conocidos distintos");
ok(pasaBlocking(persona({ sexo: "Indeterminado" }), forense({ sexo: "Femenino" })).pasa,
  "deja pasar si un sexo es Indeterminado");
ok(pasaBlocking(persona({ sexo: null as unknown as string }), forense({ sexo: "Femenino" })).pasa,
  "deja pasar si falta el sexo");

ok(!pasaBlocking(persona({ estado: "Jalisco" }), forense({ estado: "Sinaloa" })).pasa,
  "descarta estados distintos cuando ambos lo tienen");
ok(pasaBlocking(persona({ estado: null }), forense({ estado: "Sinaloa" })).pasa,
  "deja pasar si falta el estado en una fuente");

ok(!pasaBlocking(persona({ fecha_desaparicion: "2021-01-01" }), forense({ fecha_hallazgo: "2020-01-01" })).pasa,
  "descarta hallazgo anterior a la desaparición");
ok(pasaBlocking(persona({ fecha_desaparicion: null }), forense({ fecha_hallazgo: "2020-01-01" })).pasa,
  "deja pasar si falta una fecha");

ok(pasaBlocking(persona(), forense()).pasa, "deja pasar un candidato válido");

// ---------------------------------------------------------------------------
// 2) SCORE — campo por campo
// ---------------------------------------------------------------------------
console.log("\n# Score por campo");

// sexo
ok(puntuar(persona(), forense()).desglose.sexo.similitud === 1, "sexo igual -> 1");
ok(puntuar(persona({ sexo: "Indeterminado" }), forense()).desglose.sexo.comparable === false,
  "sexo Indeterminado -> no comparable");

// edad: punto vs rango
ok(puntuar(persona({ edad: 30 }), forense({ edad_inicial: 28, edad_final: 35 })).desglose.edad.similitud === 1,
  "edad dentro del rango -> 1");
{
  const s = puntuar(persona({ edad: 26 }), forense({ edad_inicial: 28, edad_final: 35 })).desglose.edad.similitud!;
  ok(casi(s, 1 - 2 / 5), "edad a 2 años del rango -> 0.6", String(s));
}
ok(puntuar(persona({ edad: 20 }), forense({ edad_inicial: 28, edad_final: 35 })).desglose.edad.similitud === 0,
  "edad a >=5 años del rango -> 0");
ok(puntuar(persona({ edad: null }), forense()).desglose.edad.comparable === false,
  "falta edad -> no comparable");

// estatura
ok(casi(puntuar(persona({ estatura: 171 }), forense({ estatura: 175 })).desglose.estatura.similitud!, 0.5),
  "estatura dif 4cm -> 0.5");
ok(puntuar(persona({ estatura: 167 }), forense({ estatura: 175 })).desglose.estatura.similitud === 0,
  "estatura dif >=8cm -> 0");
ok(puntuar(persona({ estatura: null }), forense()).desglose.estatura.comparable === false,
  "falta estatura -> no comparable");

// fecha
ok(puntuar(persona({ fecha_desaparicion: "2020-01-01" }), forense({ fecha_hallazgo: "2020-01-01" })).desglose.fecha.similitud === 1,
  "mismo día -> 1");
ok(puntuar(persona({ fecha_desaparicion: "2020-01-01" }), forense({ fecha_hallazgo: "2020-12-31" })).desglose.fecha.similitud === 0,
  "365 días -> 0");
ok(puntuar(persona({ fecha_desaparicion: null }), forense()).desglose.fecha.comparable === false,
  "falta fecha -> no comparable");

// lugar
ok(puntuar(persona({ estado: "Jalisco", municipio: "Guadalajara" }), forense({ estado: "Jalisco", municipio: "Guadalajara" })).desglose.lugar.similitud === 1,
  "mismo municipio -> 1");
ok(puntuar(persona({ estado: "Jalisco", municipio: "Guadalajara" }), forense({ estado: "Jalisco", municipio: "Zapopan" })).desglose.lugar.similitud === 0.5,
  "mismo estado, distinto municipio -> 0.5");
ok(puntuar(persona({ estado: "Jalisco" }), forense({ estado: "Sinaloa" })).desglose.lugar.similitud === 0,
  "estados distintos -> 0");
ok(puntuar(persona({ estado: null }), forense()).desglose.lugar.comparable === false,
  "falta estado -> no comparable");

// tatuajes (texto libre -> figura / zona / lado por separado)

// Misma FIGURA, distinta zona: la figura manda -> alto.
// figura solapa=1 (w3); zona brazo vs pierna=0 (w1) -> (1*3+0*1)/4 = 0.75.
{
  const s = puntuar(
    persona({ rasgos: { tatuajes: "águila antebrazo" } }),
    forense({ rasgos: { tatuajes: "águila pierna" } }),
  ).desglose.tatuajes.similitud!;
  ok(casi(s, 0.75), "misma figura distinta zona -> 0.75 (figura manda)", String(s));
}

// Misma ZONA, distinto LADO (sin figura): NO debe descartar.
// "tatuaje" es palabra vacía -> sin figura; zona pierna solapa=1 (w1);
// lado izq vs der=0.3 (w0.5) -> (1*1+0.3*0.5)/1.5 ≈ 0.767.
{
  const s = puntuar(
    persona({ rasgos: { senas_particulares: "tatuaje en pierna izquierda" } }),
    forense({ rasgos: { senas_particulares: "tatuaje en pierna derecha" } }),
  ).desglose.tatuajes.similitud!;
  ok(s > 0.5, "misma zona distinto lado -> alto, no descarta", String(s));
}

// Zonas totalmente distintas sin figura común: bajo PERO con piso (no es 0).
// figura: una "aguila", otra "rosa" -> solapa 0 (w3); zona brazo vs pierna 0 (w1)
// -> bruta 0 -> piso 0.25.
{
  const s = puntuar(
    persona({ rasgos: { tatuajes: "águila brazo" } }),
    forense({ rasgos: { tatuajes: "rosa pierna" } }),
  ).desglose.tatuajes.similitud!;
  ok(casi(s, 0.25), "señas distintas -> piso 0.25 (no descarta)", String(s));
}

// Solapamiento parcial de figuras.
// figuras {aguila,cruz} vs {aguila} -> 1/2 (w3); zona brazo vs pierna 0 (w1)
// -> (0.5*3 + 0*1)/4 = 0.375.
{
  const s = puntuar(
    persona({ rasgos: { tatuajes: "águila antebrazo cruz" } }),
    forense({ rasgos: { tatuajes: "águila pierna" } }),
  ).desglose.tatuajes.similitud!;
  ok(casi(s, 0.375), "solapamiento parcial de figuras -> 0.375", String(s));
}

// Solo una fuente reportó -> NO comparable (se EXCLUYE, no descarta). Este es
// el caso real RNPDNO (AM sin señas) vs Jalisco (PM con señas).
{
  const c = puntuar(persona({ rasgos: { tatuajes: "rosa hombro" } }), forense({ rasgos: null })).desglose.tatuajes;
  ok(c.comparable === false, "solo una fuente reportó señas -> no comparable (no descarta)");
}
ok(puntuar(persona({ rasgos: null }), forense({ rasgos: { estatus: "x" } })).desglose.tatuajes.comparable === false,
  "ninguna fuente reportó tatuajes -> no comparable");

// ---------------------------------------------------------------------------
// 3) Promedio ponderado SOLO de campos comparables
// ---------------------------------------------------------------------------
console.log("\n# Promedio ponderado (solo comparables)");

// Todo comparable y coincidente -> score 1, denominador = suma de todos los pesos.
{
  const r = puntuar(persona(), forense());
  const pesoTotal = Object.values(PESOS).reduce((a, b) => a + b, 0);
  ok(r.score === 1, "todo coincide -> score 1", String(r.score));
  ok(r.pesoComparable === pesoTotal, "denominador = suma de todos los pesos", String(r.pesoComparable));
}

// Solo sexo y edad comparables (ambos 1) -> score 1 con denominador acotado.
{
  const r = puntuar(
    persona({ estatura: null, fecha_desaparicion: null, estado: null, rasgos: null }),
    forense({ estatura: null, fecha_hallazgo: null, estado: null, rasgos: null }),
  );
  ok(r.score === 1 && r.pesoComparable === PESOS.sexo + PESOS.edad,
    "campos no comparables se EXCLUYEN del denominador", `score=${r.score} peso=${r.pesoComparable}`);
}

// Caso mixto con número esperado calculado a mano.
{
  // estatura dif 8 -> 0 (w2); fecha 31 días -> 1-31/365 (w1); lugar mismo estado sin municipio -> 0.5 (w1).
  // sexo Indeterminado, edad null, tatuajes ninguno -> no comparables.
  const r = puntuar(
    persona({ sexo: "Indeterminado", edad: null, estatura: 170, fecha_desaparicion: "2020-01-01", municipio: "Guadalajara", rasgos: null }),
    forense({ estatura: 178, fecha_hallazgo: "2020-02-01", municipio: null, rasgos: null }),
  );
  const esperado = (0 * 2 + (1 - 31 / 365) * 1 + 0.5 * 1) / 4;
  ok(casi(r.score, esperado), "caso mixto coincide con el cálculo manual", `score=${r.score} esperado=${esperado.toFixed(5)}`);
}

// perfilRasgos: detección de "reportó", normalización de acentos y clasificación
// por dimensión (figura / zona canónica / lado).
ok(perfilRasgos({ tatuajes: "Águila" }).figuras.has("aguila"), "perfilRasgos normaliza acentos en figura");
ok(perfilRasgos({ estatus: "Con Vida" }).reporto === false, "rasgos sin tatuajes/señas -> reporto false");
{
  const pr = perfilRasgos({ tatuajes: "águila en antebrazo izquierdo" });
  ok(pr.figuras.has("aguila") && pr.zonas.has("brazo") && pr.lados.has("izquierdo"),
    "perfilRasgos separa figura/zona-canónica/lado del texto libre");
}
{
  const pr = perfilRasgos({ tatuajes: [{ tipo: "Águila", ubicacion_cuerpo: "Antebrazo", lado: "derecho" }] });
  ok(pr.figuras.has("aguila") && pr.zonas.has("brazo") && pr.lados.has("derecho"),
    "perfilRasgos soporta tatuajes estructurados {tipo, ubicacion_cuerpo, lado}");
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------
console.log(`\n${fallaron === 0 ? "✅" : "❌"} ${pasaron} pasaron, ${fallaron} fallaron.`);
if (fallaron > 0) process.exit(1);
