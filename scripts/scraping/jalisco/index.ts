import { config as cargarEnv } from "dotenv";
import path from "path";
import { obtenerHtmlPfsi } from "./fetch";
import { parsearRegistrosPfsi } from "./parser";
import type { AdaptadorSalida, OpcionesScraper } from "./types";

cargarEnv({ path: path.resolve(process.cwd(), ".env.local") });
cargarEnv({ path: path.resolve(process.cwd(), ".env") });

function mostrarAyuda(): void {
  console.log(`
Uso: pnpm scrape:jalisco -- --inicio <fecha> [--fin <fecha>] [--limite <n>]

Opciones:
  --inicio, -i   Fecha inicial (DD/MM/YYYY o YYYY-MM-DD) [requerido]
  --fin, -f      Fecha final (DD/MM/YYYY o YYYY-MM-DD) [default: hoy]
  --limite, -l   Registros a imprimir [default: 100]
  --help, -h     Mostrar esta ayuda

Variables de entorno:
  FIRECRAWL_API_KEY   Clave de Firecrawl (.env.local)

Ejemplo:
  pnpm scrape:jalisco -- --inicio 19/09/2018 --fin 31/12/2024
`);
}

function normalizarFecha(valor: string, nombre: string): string {
  const recortado = valor.trim();

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(recortado)) return recortado;

  const iso = recortado.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  throw new Error(
    `${nombre}: formato inválido "${recortado}". Use DD/MM/YYYY o YYYY-MM-DD.`,
  );
}

function hoyDdMmAaaa(): string {
  const ahora = new Date();
  const dia = String(ahora.getDate()).padStart(2, "0");
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${ahora.getFullYear()}`;
}

function parsearArgs(argv: string[]): {
  opciones: OpcionesScraper;
  limite: number;
} {
  const args = argv.slice(2);
  let inicio: string | undefined;
  let fin: string | undefined;
  let limite = 100;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      mostrarAyuda();
      process.exit(0);
    }

    if (arg === "--inicio" || arg === "-i") {
      inicio = args[++i];
      continue;
    }

    if (arg === "--fin" || arg === "-f") {
      fin = args[++i];
      continue;
    }

    if (arg === "--limite" || arg === "-l") {
      limite = Number(args[++i]);
      continue;
    }
  }

  if (!inicio) {
    throw new Error("Falta --inicio. Ejecuta con --help para ver el uso.");
  }

  if (!Number.isFinite(limite) || limite < 1) {
    throw new Error("--limite debe ser un entero mayor a 0.");
  }

  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY no está definida en .env.local.");
  }

  return {
    opciones: {
      apiKey,
      fechaInicio: normalizarFecha(inicio, "--inicio"),
      fechaFin: normalizarFecha(fin ?? hoyDdMmAaaa(), "--fin"),
    },
    limite,
  };
}

function crearAdaptadorConsola(limite: number): AdaptadorSalida {
  return {
    nombre: "consola",
    async manejar(registros) {
      const vista = registros.slice(0, limite);
      console.log(JSON.stringify(vista, null, 2));
      console.log(
        `[jalisco] Total: ${registros.length}, mostrados: ${vista.length}`,
      );
    },
  };
}

async function principal() {
  const { opciones, limite } = parsearArgs(process.argv);
  const adaptador = crearAdaptadorConsola(limite);

  const html = await obtenerHtmlPfsi(opciones);
  const registros = parsearRegistrosPfsi(html);

  if (registros.length === 0) {
    throw new Error("[jalisco] No se encontraron registros en el HTML.");
  }

  await adaptador.manejar(registros);
}

principal().catch((error) => {
  console.error("[jalisco] Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
