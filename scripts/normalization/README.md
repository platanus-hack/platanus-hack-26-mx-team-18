# Normalización de datos

Paso intermedio entre scraping y consulta ciudadana.

## Propósito

Transformar registros crudos (`raw_records.raw_payload`) en registros normalizados (`person_records`) con campos estandarizados para matching.

## Flujo esperado (pendiente)

```text
raw_records → parser por estado → person_records + person_images
```

## Próximos pasos

- [ ] Crear `scripts/normalization/jalisco/` y `scripts/normalization/sinaloa/`
- [ ] Definir mapeo de campos por fuente gubernamental
- [ ] Marcar `normalized_at` y vincular `external_id`
- [ ] Script pnpm: `normalize:all`
