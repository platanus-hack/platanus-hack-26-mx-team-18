# Arquitectura — Centralización Forense MX

## Propósito

Sistema para centralizar información forense de **personas no identificadas** en México. Usuarios comunes consultan coincidencias a partir de un formulario y reciben un score de similitud con registros recopilados de fuentes gubernamentales públicas.

**Alcance actual:** Jalisco (`JAL`) y Sinaloa (`SIN`).

## Flujo de datos

```text
Páginas gubernamentales (JAL / SIN)
        │
        ▼
scripts/scraping/{jalisco,sinaloa}   ← fetch + parse (cheerio)
        │
        ▼
scrape_runs + raw_records            ← payload crudo JSONB
        │
        ▼
scripts/normalization/               ← pendiente
        │
        ▼
person_records + person_images       ← datos normalizados
        │
        ▼
App Next.js: /consultar              ← user_consultations
        │
        ▼
match_results                        ← similarity_score (pendiente)
        │
        ▼
App Next.js: /resultados
```

## Estructura del repositorio

| Carpeta | Responsabilidad |
|---------|-----------------|
| `app/` | Páginas Next.js (App Router) |
| `components/` | UI — formularios, layout |
| `lib/supabase/` | Clientes Supabase (browser, server, middleware) |
| `lib/constants/` | Constantes de dominio (estados) |
| `types/` | Tipos TS — dominio y stub de BD |
| `scripts/scraping/` | Scrapers por estado |
| `scripts/normalization/` | Normalización raw → person_records |
| `supabase/migrations/` | Esquema SQL y seeds |

## Esquema de base de datos

| Tabla | Propósito |
|-------|-----------|
| `states` | Catálogo JAL, SIN |
| `data_sources` | Portales gubernamentales por estado |
| `scrape_runs` | Ejecuciones de scraping |
| `raw_records` | Datos crudos del scraper |
| `person_records` | Registro normalizado |
| `person_images` | Imágenes del registro |
| `user_consultations` | Formulario del usuario |
| `match_results` | Score y campos coincidentes |

### Referencia cruzada: SQL ↔ Formulario ↔ Tipos

| Campo SQL | Formulario (`/consultar`) | Tipo TS |
|-----------|---------------------------|---------|
| `sex` | Sexo | `UserConsultationInput.sex` |
| `age_estimate_min/max` | Edad estimada | `age_estimate_min/max` |
| `height_cm` | Estatura (cm) | `height_cm` |
| `weight_kg` | Peso (kg) | `weight_kg` |
| `skin_tone` | Tono de piel | `skin_tone` |
| `hair_color` | Color de cabello | `hair_color` |
| `hair_type` | Tipo de cabello | `hair_type` |
| `eye_color` | Color de ojos | `eye_color` |
| `discovery_date` | Fecha | `discovery_date` |
| `discovery_location` | Lugar | `discovery_location` |
| `municipality` | Municipio | `municipality` |
| `state_code` | Estado (JAL/SIN) | `state_code` |
| `distinguishing_features` | Señas particulares | `distinguishing_features` |
| `clothing_description` | Vestimenta | `clothing_description` |
| `notes` | Notas | `notes` (solo consulta) |

## Supabase local

```bash
# Instalar dependencias
pnpm install

# Requiere Supabase CLI instalado
supabase start
supabase db reset

# Regenerar tipos TS desde el esquema local
supabase gen types typescript --local > types/database.ts
```

## Variables de entorno

Ver `.env.example`. Copiar a `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL` — URL del proyecto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — clave anon (app + RLS)
- `SUPABASE_SERVICE_ROLE_KEY` — solo scripts server-side

## Scripts pnpm

```bash
pnpm dev              # Next.js dev server
pnpm scrape:jalisco   # Scraper Jalisco (placeholder)
pnpm scrape:sinaloa   # Scraper Sinaloa (placeholder)
pnpm scrape:all       # Ambos scrapers
```

## Checklist — próximos pasos

- [ ] Completar URLs en `scripts/scraping/{jalisco,sinaloa}/sources.ts`
- [ ] Implementar scrapers con cheerio → `raw_records`
- [ ] Implementar normalización → `person_records`
- [ ] Algoritmo de matching → `match_results`
- [ ] Conectar formulario `/consultar` con persistencia y resultados
- [ ] UI de resultados con score y detalle de coincidencias
- [ ] Regenerar `types/database.ts` con Supabase CLI

## Convenciones del equipo

- **Un scraper por estado** en su carpeta independiente
- **Sin lógica en la estructura inicial** — solo placeholders con comentarios TODO
- **Raw primero, normalizado después** — no escribir directo a `person_records` desde scrapers
- **RLS:** lectura pública de registros forenses; escritura vía service role
