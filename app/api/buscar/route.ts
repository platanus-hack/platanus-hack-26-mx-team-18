import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puntuar, type PersonaAM, type ForensePM } from "@/lib/matching/score";

/**
 * POST /api/buscar
 *
 * Recibe los datos ANTE MORTEM de una persona desaparecida y los cruza contra
 * los registros forenses (restos no identificados) usando el motor de score.
 * Devuelve las coincidencias más probables, ordenadas por puntaje.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const persona: PersonaAM = {
    id: -1,
    sexo: String(body.sexo ?? "Indeterminado"),
    edad: body.edad != null && body.edad !== "" ? Number(body.edad) : null,
    estatura:
      body.estatura != null && body.estatura !== "" ? Number(body.estatura) : null,
    fecha_desaparicion: String(body.fecha_desaparicion ?? "1900-01-01"),
    estado: body.estado ? String(body.estado) : null,
    municipio: body.municipio ? String(body.municipio) : null,
    rasgos: body.rasgos ? String(body.rasgos) : null,
  };

  const supabase = await createClient();

  // --- Filtros duros empujados a la base para reducir candidatos ---
  let base = supabase
    .from("forense")
    .select(
      "id,sexo,edad_inicial,edad_final,estatura,fecha_hallazgo,rasgos, lugar_hallazgo:lugares!forense_lugar_hallazgo_id_fkey(estado,municipio,lugar)",
    );

  if (persona.sexo === "Masculino" || persona.sexo === "Femenino") {
    base = base.in("sexo", [persona.sexo, "Indeterminado"]);
  }
  if (persona.fecha_desaparicion && /^\d{4}-\d{2}-\d{2}$/.test(persona.fecha_desaparicion)) {
    base = base.gte("fecha_hallazgo", persona.fecha_desaparicion);
  }

  // Paginación: traemos hasta 6000 candidatos ya filtrados.
  const PAGE = 1000;
  const MAX = 6000;
  type Row = {
    id: number;
    sexo: string;
    edad_inicial: number | null;
    edad_final: number | null;
    estatura: number | null;
    fecha_hallazgo: string;
    rasgos: unknown;
    lugar_hallazgo: { estado: string | null; municipio: string | null; lugar: string | null } | null;
  };
  const rows: Row[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await base.range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  // --- Puntuar cada candidato ---
  const matches = rows
    .map((r) => {
      const forense: ForensePM = {
        id: r.id,
        sexo: r.sexo,
        edad_inicial: r.edad_inicial,
        edad_final: r.edad_final,
        estatura: r.estatura,
        fecha_hallazgo: r.fecha_hallazgo,
        estado: r.lugar_hallazgo?.estado ?? null,
        municipio: r.lugar_hallazgo?.municipio ?? null,
        rasgos: r.rasgos,
      };
      const res = puntuar(persona, forense);
      const rasgos = (r.rasgos ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        puntaje: res.puntaje,
        razon: res.razon,
        descartado: res.descartado,
        sexo: r.sexo,
        edad_inicial: r.edad_inicial,
        edad_final: r.edad_final,
        estatura: r.estatura,
        fecha_hallazgo: r.fecha_hallazgo,
        estado: r.lugar_hallazgo?.estado ?? null,
        municipio: r.lugar_hallazgo?.municipio ?? null,
        tatuajes: typeof rasgos.tatuajes === "string" ? rasgos.tatuajes : null,
        senas: typeof rasgos.senas_particulares === "string" ? rasgos.senas_particulares : null,
      };
    })
    .filter((m) => !m.descartado && m.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, 8);

  return NextResponse.json({ total: rows.length, matches });
}
