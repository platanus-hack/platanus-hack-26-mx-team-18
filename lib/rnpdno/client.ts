/**
 * Cliente para la API del RNPDNO (Registro Nacional de Personas Desaparecidas
 * y No Localizadas) — la "Consulta Pública": https://consultapublicarnpdno.segob.gob.mx
 *
 * El sitio es una app de JavaScript que habla con una API por detrás. Las
 * peticiones van "ofuscadas": se cifra un JSON {fecha, accion, data} con AES
 * (CryptoJS) usando una llave, y el resultado (en base64) viaja dentro de la
 * URL. La respuesta, en cambio, regresa como JSON normal.
 *
 * Flujo:
 *   1) Pedir un token con una llave fija conocida  -> POST /api/t/<blob>
 *   2) Ese token sirve como llave AES *y* como Bearer para todo lo demás.
 *   3) Pedir datos                                 -> POST /api/p/<blob>
 *
 * NOTA: son datos públicos (consulta pública) y de uso humanitario, pero son
 * DATOS PERSONALES de víctimas. Trátalos con cuidado y respeta el aviso de
 * privacidad del RNPDNO.
 */

import CryptoJS from "crypto-js";

const API = "https://apiconsultapublicarnpdno.segob.gob.mx/api";
const ORIGIN = "https://consultapublicarnpdno.segob.gob.mx";
// Llave fija que el propio sitio usa SOLO para obtener el token inicial.
const LLAVE_TOKEN = "z427FcQwMSPZuFbIjNWGDqUpw1MEo1DG7cIOBSuI3ps";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch con reintentos: el servidor del RNPDNO suele cortar la conexión
 * (ECONNRESET) o devolver errores 5xx cuando le pegas muchas veces seguidas.
 * Reintentamos con espera creciente (backoff) en vez de morir al primer fallo.
 */
async function fetchConReintentos(
  url: string,
  init: RequestInit,
  intentos = 5,
): Promise<Response> {
  let ultimoError: unknown;
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, init);
      // 5xx = el servidor está saturado/caído; vale la pena reintentar.
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      ultimoError = e;
      if (i === intentos) break;
      const espera = 1000 * 2 ** (i - 1); // 1s, 2s, 4s, 8s...
      console.warn(`   ⚠️  fallo de red (intento ${i}/${intentos}), reintento en ${espera / 1000}s…`);
      await dormir(espera);
    }
  }
  throw ultimoError;
}

/** Cifra {fecha, accion, data} con AES y lo deja en base64 (como hace el sitio). */
function empaquetar(accion: string, data: unknown, llave: string): string {
  const f = new Date();
  const payload = {
    fecha: `${f.getDay()}-${f.getMonth()}-${f.getFullYear()}`,
    accion,
    data,
  };
  const cifrado = CryptoJS.AES.encrypt(JSON.stringify(payload), llave).toString();
  return btoa(cifrado);
}

/** Filtros de búsqueda. Todos opcionales; vacío = todos los registros. */
export interface FiltrosRNPDNO {
  fechaInicial: string;
  fechaFinal: string;
  estado: string; // id del estado: "14" = Jalisco, "" = todos
  municipio: string; // id del municipio, "" = todos
}

export function filtrosVacios(estado = "", municipio = ""): FiltrosRNPDNO {
  return { fechaInicial: "", fechaFinal: "", estado, municipio };
}

/** Un registro tal como lo devuelve get_info_matriz. */
export interface VictimaRNPDNO {
  IDvictimadirecta: string;
  nombre: string;
  primerapellido: string;
  segundoapellido: string;
  Sexo: string; // "HOMBRE" | "MUJER" | ...
  edadActual: number | null;
  fechahechos: string | null; // ISO; fecha de la desaparición
  fechanacimiento: string | null;
  estado: string; // nombre, ej "JALISCO"
  municipio: string; // nombre, ej "GUADALAJARA"
  EstatusVictima: string;
}

export class ClienteRNPDNO {
  private token = "";

  /** Obtiene (y cachea) el token de sesión necesario para todo lo demás. */
  async obtenerToken(): Promise<string> {
    if (this.token) return this.token;
    const blob = empaquetar("token", null, LLAVE_TOKEN);
    const res = await fetchConReintentos(`${API}/t/${encodeURIComponent(blob)}`, {
      method: "POST",
      headers: { Origin: ORIGIN },
    });
    const json = await res.json();
    const token = json?.result?.data;
    if (!token) throw new Error("No se pudo obtener el token del RNPDNO");
    this.token = token;
    return token;
  }

  /** POST genérico a /p/ con la acción cifrada y el cuerpo indicado. */
  private async post(accion: string, data: unknown, body: unknown) {
    const token = await this.obtenerToken();
    const blob = empaquetar(accion, data, token);
    const res = await fetchConReintentos(`${API}/p/${encodeURIComponent(blob)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /** Cuántos registros hay para esos filtros. */
  async contar(filtros: FiltrosRNPDNO): Promise<number> {
    const r = await this.post("get_paginador", filtros, { rows: 10, page: 1 });
    if (!r?.result?.success) throw new Error("get_paginador falló");
    return Number(r.result.data) || 0;
  }

  /** Una página de registros (la "matriz"). */
  async pagina(filtros: FiltrosRNPDNO, page: number, rows: number): Promise<VictimaRNPDNO[]> {
    const r = await this.post("get_info_matriz", filtros, { rows, page });
    const data = r?.result?.data?.data;
    if (!Array.isArray(data)) return [];
    return data as VictimaRNPDNO[];
  }
}
