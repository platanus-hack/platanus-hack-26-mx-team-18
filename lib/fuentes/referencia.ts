export type ReferenciaFuente = {
  etiqueta: string;
  url: string | null;
};

const ETIQUETAS: Record<string, string> = {
  ijcf_jalisco: "IJCF Jalisco (PFSI)",
  fiscalia_sinaloa: "Fiscalía Sinaloa — Occisos",
  rnpdno: "RNPDNO",
  firecrawl: "Búsqueda web",
};

export function etiquetaFuente(fuente: string | null | undefined): string {
  if (!fuente) return "Fuente no registrada";
  return ETIQUETAS[fuente] ?? fuente.replace(/_/g, " ");
}


export function referenciaForense(
  fuente: string | null | undefined,
  fuenteId: string | null | undefined,
): ReferenciaFuente {
  const etiqueta = etiquetaFuente(fuente);
  if (!fuente) return { etiqueta, url: null };

  switch (fuente) {
    case "fiscalia_sinaloa":
      if (!fuenteId) return { etiqueta, url: null };
      return {
        etiqueta,
        url: `https://fiscaliasinaloa.mx/Apps/ConsultaOcciso/Contact.aspx?id=${encodeURIComponent(fuenteId)}`,
      };
    case "ijcf_jalisco":
      return {
        etiqueta,
        url: "http://consultas.cienciasforenses.jalisco.gob.mx/registro_pfsi_v2.php",
      };
    case "firecrawl":
      if (fuenteId?.startsWith("http")) return { etiqueta, url: fuenteId };
      return { etiqueta, url: null };
    default:
      return { etiqueta, url: null };
  }
}
