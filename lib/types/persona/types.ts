import { Json, Sexo } from "../database.types";
import { Lugar } from "../lugar";

export type Persona = {
  id: number;
  nombre: string;
  edad: number | null;
  estatura: number | null;
  sexo: Sexo;
  fecha_desaparicion: string;
  ultimo_lugar: Lugar | null;
  rasgos: Json | null;
  creado_en: string;
  actualizado_en: string;
};
