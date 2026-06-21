import { Database } from "../database.types";
import { aLugar } from "../lugar/adaptadores";
import { Forense } from "./types";

// Fila tal como viene de la tabla "forense" en la base de datos.
type ForenseFila = Database["public"]["Tables"]["forense"]["Row"];
type LugarFila = Database["public"]["Tables"]["lugares"]["Row"];

// Convierte una fila de la BD en el tipo de respuesta del back.
// `lugar` es la fila del lugar relacionado (por el join con "lugares");
// pasa `null` si el registro forense no tiene lugar de hallazgo.
export function aForense(fila: ForenseFila, lugar: LugarFila | null): Forense {
  return {
    id: fila.id,
    edad_inicial: fila.edad_inicial,
    edad_final: fila.edad_final,
    estatura: fila.estatura,
    sexo: fila.sexo,
    fecha_hallazgo: fila.fecha_hallazgo,
    lugar_hallazgo: lugar ? aLugar(lugar) : null,
    rasgos: fila.rasgos,
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}
