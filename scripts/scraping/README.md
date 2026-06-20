# Scripts de scraping

Scrapers por estado que obtienen datos de páginas gubernamentales públicas y los persisten en Supabase.

## Estructura

```text
scripts/scraping/
├── shared/          # Tipos y config compartida
├── jalisco/         # Scraper Jalisco
└── sinaloa/         # Scraper Sinaloa
```

## Contrato de cada scraper

1. Crear un registro en `scrape_runs` con status `running`
2. Obtener HTML de las fuentes definidas en `sources.ts`
3. Parsear y extraer registros (implementación pendiente)
4. Insertar cada registro crudo en `raw_records` (`raw_payload` JSONB)
5. Actualizar `scrape_runs` → status `completed`, `records_found`, `finished_at`
6. En caso de error → status `failed`, `error_message`

La normalización de `raw_records` → `person_records` es un paso separado en `scripts/normalization/`.

## Variables de entorno

Los scrapers usan `SUPABASE_SERVICE_ROLE_KEY` (nunca exponer al cliente).

```bash
cp .env.example .env.local
# Completar credenciales de Supabase
```

## Ejecución

```bash
pnpm scrape:jalisco
pnpm scrape:sinaloa
pnpm scrape:all
```

## Supabase local

```bash
supabase start
supabase db reset
```
