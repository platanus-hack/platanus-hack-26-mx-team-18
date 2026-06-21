-- Rastreo de origen para la tabla persona (igual que hicimos con forense).
-- Permite saber de qué fuente salió cada persona y su ID original, para poder
-- re-correr el scraper sin duplicar (upsert por fuente + fuente_id).
--
--   fuente     -> ej: 'rnpdno'
--   fuente_id  -> el IDvictimadirecta del RNPDNO (un UUID)

alter table public.persona
  add column fuente    text,
  add column fuente_id text;

alter table public.persona
  add constraint persona_fuente_unica unique (fuente, fuente_id);

comment on column public.persona.fuente    is 'Origen del dato, ej: rnpdno';
comment on column public.persona.fuente_id is 'ID del registro en la fuente original (RNPDNO: IDvictimadirecta)';
