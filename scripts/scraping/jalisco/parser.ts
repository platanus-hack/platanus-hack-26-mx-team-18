import * as cheerio from "cheerio";
import type { RegistroPfsi, SexoPfsi } from "./types";

const URL_BASE =
  "http://consultas.cienciasforenses.jalisco.gob.mx/registro_pfsi_v2.php";

function limpiarCelda(texto: string | null | undefined): string | null {
  if (!texto) return null;

  const normalizado = texto
    .replace(/\u00a0/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalizado || /^no presenta$/i.test(normalizado)) return null;
  return normalizado;
}

function mapearSexo(valor: string | null): SexoPfsi {
  const normalizado = valor?.trim().toLowerCase() ?? "";

  if (["hombre", "masculino", "male"].includes(normalizado)) return "Masculino";
  if (["mujer", "femenino", "female"].includes(normalizado)) return "Femenino";
  return "Indeterminado";
}

function parsearRangoEdad(valor: string | null): {
  edad_inicial: number | null;
  edad_final: number | null;
} {
  if (!valor) return { edad_inicial: null, edad_final: null };

  const normalizado = valor.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizado || normalizado.includes("na")) {
    return { edad_inicial: null, edad_final: null };
  }

  const rango = normalizado.match(/(\d+)\s*-\s*(\d+)/);
  if (rango) {
    return {
      edad_inicial: Number(rango[1]),
      edad_final: Number(rango[2]),
    };
  }

  const unico = normalizado.match(/(\d+)/);
  if (unico) {
    const edad = Number(unico[1]);
    return { edad_inicial: edad, edad_final: edad };
  }

  return { edad_inicial: null, edad_final: null };
}

function parsearFechaHallazgo(valor: string | null): string | null {
  const coincidencia = valor?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!coincidencia) return null;

  const [, dia, mes, anio] = coincidencia;
  return `${anio}-${mes}-${dia}`;
}

function construirRasgos(datos: {
  nombreProbable: string | null;
  tatuajes: string | null;
  descripcionVestimenta: string | null;
  senasParticulares: string | null;
  urlImagen: string | null;
}): string | null {
  const secciones: string[] = [];

  if (datos.nombreProbable) secciones.push(`Nombre probable: ${datos.nombreProbable}`);
  if (datos.tatuajes) secciones.push(`Tatuajes: ${datos.tatuajes}`);
  if (datos.descripcionVestimenta) secciones.push(`Vestimenta: ${datos.descripcionVestimenta}`);
  if (datos.senasParticulares) secciones.push(`Señas particulares: ${datos.senasParticulares}`);
  if (datos.urlImagen) secciones.push(`Imagen: ${datos.urlImagen}`);

  return secciones.length > 0 ? secciones.join("\n") : null;
}

export function parsearRegistrosPfsi(html: string): RegistroPfsi[] {
  const $ = cheerio.load(html);
  const registros: RegistroPfsi[] = [];

  const filasTabla = $("#mytable tbody tr").length
    ? $("#mytable tbody tr")
    : $("#resultados #mytable tbody tr");

  filasTabla.each((_, fila) => {
    const celdas = $(fila).find("td");
    if (celdas.length < 9) return;

    const idFila = $(celdas[0]).text().trim();
    if (!idFila || !/^\d+$/.test(idFila)) return;

    const fechaIngreso = limpiarCelda($(celdas[1]).text());
    const fecha_hallazgo = parsearFechaHallazgo(fechaIngreso);
    if (!fecha_hallazgo) return;

    const srcImagen = $(celdas[0]).find("img").attr("src");
    let urlImagen: string | null = null;
    if (srcImagen?.trim()) {
      try {
        urlImagen = new URL(srcImagen.trim(), URL_BASE).href;
      } catch {
        urlImagen = srcImagen.trim();
      }
    }

    const { edad_inicial, edad_final } = parsearRangoEdad(
      limpiarCelda($(celdas[4]).text()),
    );

    registros.push({
      edad_inicial,
      edad_final,
      estatura: null,
      sexo: mapearSexo(limpiarCelda($(celdas[2]).text())),
      fecha_hallazgo,
      lugar_hallazgo: limpiarCelda($(celdas[8]).text()),
      rasgos: construirRasgos({
        nombreProbable: limpiarCelda($(celdas[3]).text()),
        tatuajes: limpiarCelda($(celdas[5]).text()),
        descripcionVestimenta: limpiarCelda($(celdas[6]).text()),
        senasParticulares: limpiarCelda($(celdas[7]).text()),
        urlImagen,
      }),
    });
  });

  return registros;
}
