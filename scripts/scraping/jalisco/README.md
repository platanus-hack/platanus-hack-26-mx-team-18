# Scraper — Jalisco

Obtiene registros de personas no identificadas desde portales gubernamentales de Jalisco.

## Fuentes

Editar `sources.ts` con las URLs reales y notas de parsing.

## Ejecución

```bash
pnpm scrape:jalisco
```

## Próximos pasos

- [ ] Identificar URL(s) del portal gubernamental
- [ ] Implementar parser con cheerio
- [ ] Persistir en `raw_records` vía Supabase service role
- [ ] Manejar paginación y rate limiting
