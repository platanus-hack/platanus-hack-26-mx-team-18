export type SexoPfsi = "Masculino" | "Femenino" | "Indeterminado";

export interface RegistroPfsi {
  edad_inicial: number | null;
  edad_final: number | null;
  estatura: number | null;
  sexo: SexoPfsi;
  fecha_hallazgo: string;
  lugar_hallazgo: string | null;
  rasgos: string | null;
}

export interface OpcionesScraper {
  apiKey: string;
  fechaInicio: string;
  fechaFin: string;
}

export interface AdaptadorSalida {
  nombre: string;
  manejar(registros: RegistroPfsi[]): Promise<void>;
}
