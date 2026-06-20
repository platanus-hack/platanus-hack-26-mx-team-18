import { Firecrawl } from "firecrawl";
import type { OpcionesScraper } from "./types";

const URL_PFSI =
  "http://consultas.cienciasforenses.jalisco.gob.mx/registro_pfsi_v2.php";

interface ExtraccionAccion {
  cantidadFilas: number;
  htmlResultados: string;
}

export async function obtenerHtmlPfsi(opciones: OpcionesScraper): Promise<string> {
  const cliente = new Firecrawl({ apiKey: opciones.apiKey });

  console.log(
    `[jalisco] ${URL_PFSI} (${opciones.fechaInicio} → ${opciones.fechaFin})`,
  );

  const resultado = await cliente.scrape(URL_PFSI, {
    formats: ["html"],
    onlyMainContent: false,
    waitFor: 3000,
    timeout: 120_000,
    actions: [
      { type: "wait", milliseconds: 2000 },
      {
        type: "executeJavascript",
        script: `
          (async function () {
            const parametros = new URLSearchParams({
              inicio: ${JSON.stringify(opciones.fechaInicio)},
              fin: ${JSON.stringify(opciones.fechaFin)},
              sexo: document.getElementById('sexo')?.value ?? '',
              tatuajes: document.getElementById('tatuajes')?.value ?? '',
            });

            const respuesta = await fetch('buscarpfsi_v2.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: parametros.toString(),
              cache: 'no-cache',
            });

            const carga = await respuesta.json();
            const contenedor = document.querySelector('#resultados');
            if (contenedor) contenedor.innerHTML = carga.datos ?? '';

            const cuerpoTabla = document.querySelector('#mytable tbody');
            return JSON.stringify({
              cantidadFilas: cuerpoTabla ? cuerpoTabla.querySelectorAll('tr').length : 0,
              htmlResultados: contenedor?.innerHTML ?? '',
            });
          })();
        `,
      },
      { type: "wait", milliseconds: 3000 },
    ],
  });

  const html = resultado.html;
  if (!html) throw new Error("Firecrawl no devolvió HTML.");

  const extraido = extraerResultadosDeAcciones(resultado);
  if (extraido?.cantidadFilas) {
    console.log(`[jalisco] Filas en DOM: ${extraido.cantidadFilas}`);
    return `<div id="resultados">${extraido.htmlResultados}</div>`;
  }

  if (html.includes("mytable") && html.includes("<tbody")) {
    console.log("[jalisco] Usando HTML completo de la página.");
    return html;
  }

  throw new Error(
    "No se encontraron resultados PFSI. Verifica el rango de fechas y FIRECRAWL_API_KEY.",
  );
}

function parsearExtraccionAccion(valor: unknown): ExtraccionAccion | null {
  const candidato =
    typeof valor === "string"
      ? (() => {
          try {
            return JSON.parse(valor) as ExtraccionAccion;
          } catch {
            return null;
          }
        })()
      : (valor as Partial<ExtraccionAccion> | null);

  if (
    candidato &&
    typeof candidato.cantidadFilas === "number" &&
    typeof candidato.htmlResultados === "string"
  ) {
    return candidato as ExtraccionAccion;
  }

  return null;
}

function extraerResultadosDeAcciones(resultado: {
  actions?: Record<string, unknown>;
}): ExtraccionAccion | null {
  const acciones = resultado.actions;
  if (!acciones) return null;

  const retornosJs = acciones.javascriptReturns as
    | Array<{ value: unknown }>
    | undefined;

  for (const fuente of [retornosJs?.map((r) => r.value), acciones.results as unknown[]]) {
    if (!Array.isArray(fuente)) continue;
    for (let i = fuente.length - 1; i >= 0; i--) {
      const parseado = parsearExtraccionAccion(fuente[i]);
      if (parseado?.cantidadFilas) return parseado;
    }
  }

  return null;
}
