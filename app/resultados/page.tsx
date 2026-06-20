export default function ResultadosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Resultados de coincidencia</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Aquí se mostrarán los matches ordenados por score de similitud.
        </p>
      </div>

      {/* TODO: Renderizar match_results asociados a una user_consultation */}
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
        <p className="text-sm text-neutral-500">
          Sin resultados — la lógica de matching aún no está implementada.
        </p>
      </div>
    </div>
  );
}
