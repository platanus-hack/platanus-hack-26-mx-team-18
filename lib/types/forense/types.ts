import { Json, Sexo } from "../database.types";
import { Lugar } from "../lugar";

export type Forense = {
  id: number;
  edad_inicial: number | null;
  edad_final: number | null;
  estatura: number | null;
  sexo: Sexo;
  fecha_hallazgo: string;
  lugar_hallazgo: Lugar | null;
  rasgos: Json | null;
  creado_en: string;
  actualizado_en: string;
};
