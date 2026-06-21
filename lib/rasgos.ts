/** Claves internas de jsonb que no son señas visibles al usuario. */
const CLAVES_IGNORADAS = new Set(["_meta", "estatus"]);

/** Claves de señas en orden de prioridad para mostrar en formularios. */
const CLAVES_SENAS = [
  "senas_particulares",
  "tatuajes",
  "indumentarias",
  "senas",
] as const;

/**
 * Convierte `rasgos` (jsonb, string o null) en texto legible para inputs.
 * Evita `[object Object]` cuando la fuente guarda un objeto (ej. RNPDNO).
 */
export function rasgosATexto(rasgos: unknown): string {
  if (rasgos == null) return "";
  if (typeof rasgos === "string") return rasgos.trim();

  if (typeof rasgos === "object" && !Array.isArray(rasgos)) {
    const obj = rasgos as Record<string, unknown>;
    const partes: string[] = [];

    for (const clave of CLAVES_SENAS) {
      const v = obj[clave];
      if (typeof v === "string" && v.trim()) partes.push(v.trim());
    }

    if (partes.length > 0) return partes.join("; ");

    for (const [clave, v] of Object.entries(obj)) {
      if (CLAVES_IGNORADAS.has(clave)) continue;
      if (typeof v === "string" && v.trim()) partes.push(v.trim());
    }

    return partes.join("; ");
  }

  return "";
}
