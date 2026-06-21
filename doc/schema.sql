-- ============================================================
-- Esquema: Sistema de identificacion forense / personas desaparecidas
-- Motor: PostgreSQL (Supabase)
-- ============================================================

-- ------------------------------------------------------------
-- LUGARES
-- ------------------------------------------------------------
CREATE TABLE lugares (
    id     SERIAL PRIMARY KEY,
    lugar  TEXT NOT NULL
);

-- ------------------------------------------------------------
-- PERSONA (reporte de persona desaparecida)
-- ------------------------------------------------------------
CREATE TABLE persona (
    id                  SERIAL PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL,
    edad                SMALLINT CHECK (edad >= 0 AND edad <= 120),
    estatura            NUMERIC(5,2), -- cm, admite decimales
    sexo                VARCHAR(20) NOT NULL
                          CHECK (sexo IN ('Masculino', 'Femenino', 'Indeterminado')),
    fecha_desaparicion  DATE NOT NULL,
    ultimo_lugar_id     INT REFERENCES lugares(id),
    rasgos              TEXT, -- senhas particulares: tatuajes, cicatrices, prendas, etc.
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- FORENSE (registro de restos no identificados)
-- ------------------------------------------------------------
CREATE TABLE forense (
    id                  SERIAL PRIMARY KEY,
    edad_inicial        SMALLINT CHECK (edad_inicial >= 0),
    edad_final          SMALLINT CHECK (edad_final >= edad_inicial),
    estatura            NUMERIC(5,2),
    sexo                VARCHAR(20) NOT NULL
                          CHECK (sexo IN ('Masculino', 'Femenino', 'Indeterminado')),
    fecha_hallazgo      DATE NOT NULL,
    lugar_hallazgo_id   INT REFERENCES lugares(id),
    rasgos              TEXT, -- senhas particulares encontradas: tatuajes, cicatrices, vestimenta, etc.
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- COINCIDENCIAS (relacion Forense <-> Persona)
-- ------------------------------------------------------------
CREATE TABLE coincidencias (
    id           SERIAL PRIMARY KEY,
    forense_id   INT NOT NULL REFERENCES forense(id) ON DELETE CASCADE,
    persona_id   INT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
    puntaje      NUMERIC(5,2) NOT NULL CHECK (puntaje >= 0), -- compat: score*100 (0-100)
    score        NUMERIC(6,5),  -- match 0..1 (promedio ponderado de campos comparables)
    desglose     JSONB,         -- desglose por campo {comparable, similitud, explicacion}
    razon        TEXT,          -- resumen corto legible del desglose
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (forense_id, persona_id)
);

-- ------------------------------------------------------------
-- Indices para acelerar el proceso de comparacion
-- ------------------------------------------------------------
CREATE INDEX idx_persona_sexo_estatura ON persona (sexo, estatura);
CREATE INDEX idx_forense_sexo_estatura ON forense (sexo, estatura);
CREATE INDEX idx_coincidencias_puntaje ON coincidencias (puntaje DESC);

-- ------------------------------------------------------------
-- Trigger generico para mantener actualizado_en al dia
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION actualizar_fecha_modificacion()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_persona_actualizado_en
    BEFORE UPDATE ON persona
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha_modificacion();

CREATE TRIGGER trg_forense_actualizado_en
    BEFORE UPDATE ON forense
    FOR EACH ROW EXECUTE FUNCTION actualizar_fecha_modificacion();

-- ------------------------------------------------------------
-- Seguridad a Nivel de Fila (RLS)
-- IMPORTANTE: Supabase expone cada tabla via API REST/PostgREST
-- automaticamente. Con RLS activo, Postgres niega TODO por defecto;
-- cada accion (leer/insertar/actualizar/borrar) requiere una politica
-- explicita que la permita.
--
-- Modelo de acceso de este proyecto:
--   * LECTURA  -> publica: cualquiera (rol anon, sin login) puede leer.
--   * ESCRITURA-> privada: solo usuarios autenticados (rol authenticated,
--                 es decir, las cuentas que ustedes creen en Supabase Auth)
--                 pueden insertar/actualizar/borrar.
-- ------------------------------------------------------------
ALTER TABLE lugares       ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona       ENABLE ROW LEVEL SECURITY;
ALTER TABLE forense       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coincidencias ENABLE ROW LEVEL SECURITY;

-- LECTURA publica (rol anon + authenticated)
CREATE POLICY "lectura_publica_lugares"       ON lugares       FOR SELECT USING (true);
CREATE POLICY "lectura_publica_persona"       ON persona       FOR SELECT USING (true);
CREATE POLICY "lectura_publica_forense"       ON forense       FOR SELECT USING (true);
CREATE POLICY "lectura_publica_coincidencias" ON coincidencias FOR SELECT USING (true);

-- ESCRITURA solo para usuarios autenticados.
-- FOR ALL cubre INSERT, UPDATE y DELETE en una sola politica.
-- USING -> filas que puede tocar (update/delete); WITH CHECK -> filas que
-- puede crear/dejar (insert/update). 'true' = todas, mientras este logueado.
CREATE POLICY "escritura_equipo_lugares"       ON lugares       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "escritura_equipo_persona"       ON persona       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "escritura_equipo_forense"       ON forense       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "escritura_equipo_coincidencias" ON coincidencias FOR ALL TO authenticated USING (true) WITH CHECK (true);
