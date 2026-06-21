export type CriteriosBusqueda = {
  nombre?: string | null;
  personaId?: number | null;
  edad?: string | number | null;
  estatura?: string | number | null;
  estado?: string | null;
  fecha_desaparicion?: string | null;
  rasgos?: string | null;
};

function noVacio(v: string | number | null | undefined): boolean {
  return v != null && String(v).trim() !== "";
}

/**
 * Evita búsquedas demasiado amplias (solo sexo) o con nombre libre no verificado.
 */
export function validarBusqueda(
  c: CriteriosBusqueda,
): { ok: true } | { ok: false; mensaje: string } {
  if (c.personaId != null) return { ok: true };

  const nombre = String(c.nombre ?? "").trim();
  if (nombre.length >= 2) {
    return {
      ok: false,
      mensaje:
        "Selecciona un nombre del registro o bórralo para buscar con otros datos.",
    };
  }

  const tieneCriterio =
    noVacio(c.edad) ||
    noVacio(c.estatura) ||
    noVacio(c.estado) ||
    noVacio(c.fecha_desaparicion) ||
    noVacio(c.rasgos);

  if (!tieneCriterio) {
    return {
      ok: false,
      mensaje: "Agrega al menos un dato además del sexo para buscar coincidencias.",
    };
  }

  return { ok: true };
}
