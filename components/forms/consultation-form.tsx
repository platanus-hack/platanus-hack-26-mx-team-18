"use client";

import type { UserConsultationInput } from "@/types/forensic";

/**
 * Shell del formulario de consulta ciudadana.
 * Campos alineados con user_consultations y person_records.
 * TODO: Conectar submit → persistir user_consultation → ejecutar matching.
 */
export function ConsultationForm() {
  const fields: { name: keyof UserConsultationInput; label: string; type?: string }[] = [
    { name: "sex", label: "Sexo" },
    { name: "age_estimate_min", label: "Edad estimada (mín.)", type: "number" },
    { name: "age_estimate_max", label: "Edad estimada (máx.)", type: "number" },
    { name: "height_cm", label: "Estatura (cm)", type: "number" },
    { name: "weight_kg", label: "Peso (kg)", type: "number" },
    { name: "skin_tone", label: "Tono de piel" },
    { name: "hair_color", label: "Color de cabello" },
    { name: "hair_type", label: "Tipo de cabello" },
    { name: "eye_color", label: "Color de ojos" },
    { name: "discovery_date", label: "Fecha de desaparición/hallazgo", type: "date" },
    { name: "discovery_location", label: "Lugar de último avistamiento o hallazgo" },
    { name: "municipality", label: "Municipio" },
    { name: "state_code", label: "Estado (JAL / SIN)" },
    { name: "distinguishing_features", label: "Señas particulares" },
    { name: "clothing_description", label: "Descripción de vestimenta" },
    { name: "notes", label: "Notas adicionales" },
  ];

  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.name} className="block space-y-1">
            <span className="text-sm font-medium">{field.label}</span>
            {field.name === "notes" || field.name === "distinguishing_features" ? (
              <textarea
                name={field.name}
                rows={3}
                disabled
                placeholder="TODO: implementar"
                className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            ) : (
              <input
                name={field.name}
                type={field.type ?? "text"}
                disabled
                placeholder="TODO: implementar"
                className="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            )}
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled
        className="rounded-lg bg-neutral-400 px-6 py-2 text-sm font-medium text-white"
      >
        Buscar coincidencias (pendiente)
      </button>
    </form>
  );
}
