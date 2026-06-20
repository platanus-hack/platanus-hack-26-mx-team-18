-- Centralización forense: esquema inicial
-- Alcance: Jalisco (JAL) y Sinaloa (SIN)

-- Enums
CREATE TYPE case_status AS ENUM ('unidentified', 'identified', 'archived');
CREATE TYPE scrape_run_status AS ENUM ('pending', 'running', 'completed', 'failed');

-- Trigger helper para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- states
CREATE TABLE states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER states_updated_at
  BEFORE UPDATE ON states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- data_sources
CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'government_portal',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_sources_state_id ON data_sources(state_id);

CREATE TRIGGER data_sources_updated_at
  BEFORE UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- scrape_runs
CREATE TABLE scrape_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  status scrape_run_status NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  records_found INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scrape_runs_source_id ON scrape_runs(source_id);
CREATE INDEX idx_scrape_runs_status ON scrape_runs(status);

CREATE TRIGGER scrape_runs_updated_at
  BEFORE UPDATE ON scrape_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- raw_records
CREATE TABLE raw_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id UUID NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id TEXT,
  raw_payload JSONB NOT NULL,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_raw_records_scrape_run_id ON raw_records(scrape_run_id);
CREATE INDEX idx_raw_records_source_id ON raw_records(source_id);

CREATE TRIGGER raw_records_updated_at
  BEFORE UPDATE ON raw_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- person_records (normalizado)
CREATE TABLE person_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  external_id TEXT,
  sex TEXT,
  age_estimate_min INTEGER,
  age_estimate_max INTEGER,
  height_cm NUMERIC(5, 2),
  weight_kg NUMERIC(5, 2),
  skin_tone TEXT,
  hair_color TEXT,
  hair_type TEXT,
  eye_color TEXT,
  discovery_date DATE,
  discovery_location TEXT,
  municipality TEXT,
  circumstances TEXT,
  distinguishing_features TEXT,
  clothing_description TEXT,
  case_status case_status NOT NULL DEFAULT 'unidentified',
  normalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_person_records_state_id ON person_records(state_id);
CREATE INDEX idx_person_records_source_id ON person_records(source_id);
CREATE INDEX idx_person_records_case_status ON person_records(case_status);

CREATE TRIGGER person_records_updated_at
  BEFORE UPDATE ON person_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- person_images
CREATE TABLE person_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_record_id UUID NOT NULL REFERENCES person_records(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  source_url TEXT,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_person_images_person_record_id ON person_images(person_record_id);

CREATE TRIGGER person_images_updated_at
  BEFORE UPDATE ON person_images
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- user_consultations
CREATE TABLE user_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sex TEXT,
  age_estimate_min INTEGER,
  age_estimate_max INTEGER,
  height_cm NUMERIC(5, 2),
  weight_kg NUMERIC(5, 2),
  skin_tone TEXT,
  hair_color TEXT,
  hair_type TEXT,
  eye_color TEXT,
  discovery_date DATE,
  discovery_location TEXT,
  municipality TEXT,
  state_code TEXT,
  distinguishing_features TEXT,
  clothing_description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER user_consultations_updated_at
  BEFORE UPDATE ON user_consultations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- match_results
CREATE TABLE match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id UUID NOT NULL REFERENCES user_consultations(id) ON DELETE CASCADE,
  person_record_id UUID NOT NULL REFERENCES person_records(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5, 4) NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  matched_fields JSONB NOT NULL DEFAULT '{}',
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_results_consultation_id ON match_results(consultation_id);
CREATE INDEX idx_match_results_person_record_id ON match_results(person_record_id);
CREATE INDEX idx_match_results_similarity_score ON match_results(similarity_score DESC);

CREATE TRIGGER match_results_updated_at
  BEFORE UPDATE ON match_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
-- Lectura pública de registros forenses para consulta ciudadana.
-- Escritura restringida a service_role (scrapers, normalización, matching).

ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura pública
CREATE POLICY "Public read states" ON states FOR SELECT USING (true);
CREATE POLICY "Public read data_sources" ON data_sources FOR SELECT USING (true);
CREATE POLICY "Public read person_records" ON person_records FOR SELECT USING (true);
CREATE POLICY "Public read person_images" ON person_images FOR SELECT USING (true);
CREATE POLICY "Public read match_results" ON match_results FOR SELECT USING (true);

-- Inserción de consultas ciudadanas (anon key)
CREATE POLICY "Public insert user_consultations" ON user_consultations
  FOR INSERT WITH CHECK (true);

-- Seed: estados
INSERT INTO states (code, name) VALUES
  ('JAL', 'Jalisco'),
  ('SIN', 'Sinaloa');

-- Seed: fuentes placeholder (URLs a completar por equipo de scraping)
INSERT INTO data_sources (state_id, name, url, source_type, is_active)
SELECT s.id, 'Portal forense Jalisco (placeholder)', '', 'government_portal', FALSE
FROM states s WHERE s.code = 'JAL';

INSERT INTO data_sources (state_id, name, url, source_type, is_active)
SELECT s.id, 'Portal forense Sinaloa (placeholder)', '', 'government_portal', FALSE
FROM states s WHERE s.code = 'SIN';
