import { ConsultationForm } from "@/components/forms/consultation-form";

export default function ConsultarPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Consultar coincidencias</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Complete el formulario con los datos disponibles de la persona que
          busca. El sistema comparará contra registros forenses normalizados.
        </p>
      </div>

      <ConsultationForm />
    </div>
  );
}
