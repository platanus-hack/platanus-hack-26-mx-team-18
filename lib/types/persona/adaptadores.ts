import { Database } from "../database.types";
import { aLugar } from "../lugar/adaptadores";
import { Persona } from "./types";

// Fila tal como viene de la tabla "persona" en la base de datos.
type PersonaFila = Database["public"]["Tables"]["persona"]["Row"];
type LugarFila = Database["public"]["Tables"]["lugares"]["Row"];

// Convierte una fila de la BD en el tipo de respuesta del back.
// `lugar` es la fila del lugar relacionado (por el join con "lugares");
// pasa `null` si la persona no tiene último lugar registrado.
export function aPersona(fila: PersonaFila, lugar: LugarFila | null): Persona {
  return {
    id: fila.id,
    nombre: fila.nombre,
    edad: fila.edad,
    estatura: fila.estatura,
    sexo: fila.sexo,
    fecha_desaparicion: fila.fecha_desaparicion,
    ultimo_lugar: lugar ? aLugar(lugar) : null,
    rasgos: fila.rasgos,
    creado_en: fila.creado_en,
    actualizado_en: fila.actualizado_en,
  };
}
