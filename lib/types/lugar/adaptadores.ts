import { Database } from "../database.types";
import { Lugar } from "./types";

// Fila tal como viene de la tabla "lugares" en la base de datos.
type LugarFila = Database["public"]["Tables"]["lugares"]["Row"];

// Convierte una fila de la BD en el tipo de respuesta del back.
export function aLugar(fila: LugarFila): Lugar {
  return {
    id: fila.id,
    lugar: fila.lugar,
  };
}
