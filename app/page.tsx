import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Centralización de información forense
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400">
          Plataforma para consultar registros de personas no identificadas
          recopilados de fuentes gubernamentales públicas. Alcance inicial:
          Jalisco y Sinaloa.
        </p>
      </section>

      <section className="flex flex-wrap gap-4">
        <Link
          href="/consultar"
          className="rounded-lg bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Consultar coincidencias
        </Link>
        <Link
          href="/resultados"
          className="rounded-lg border border-neutral-300 px-6 py-3 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Ver resultados
        </Link>
      </section>

      <section className="rounded-lg border border-dashed border-neutral-300 p-6 dark:border-neutral-700">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Estado del proyecto
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Estructura inicial — scraping, normalización y matching pendientes de
          implementación. Ver{" "}
          <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
            docs/ARCHITECTURE.md
          </code>{" "}
          para la guía del equipo.
        </p>
      </section>
    </div>
  );
}
