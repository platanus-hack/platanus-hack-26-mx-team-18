-- Cambia la columna `rasgos` de texto a jsonb en las tablas forense y persona.
-- El USING indica a Postgres cómo convertir los valores existentes:
-- los NULL se quedan NULL, el resto se envuelve como JSON con to_jsonb().

alter table public.forense
  alter column rasgos type jsonb
  using case when rasgos is null then null else to_jsonb(rasgos) end;

alter table public.persona
  alter column rasgos type jsonb
  using case when rasgos is null then null else to_jsonb(rasgos) end;
