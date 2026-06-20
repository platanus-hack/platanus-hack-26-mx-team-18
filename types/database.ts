/**
 * Stub inicial alineado al esquema SQL.
 * Reemplazar con: supabase gen types typescript --local > types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type CaseStatus = "unidentified" | "identified" | "archived";
export type ScrapeRunStatus = "pending" | "running" | "completed" | "failed";

export interface Database {
  public: {
    Tables: {
      states: {
        Row: {
          id: string;
          code: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      data_sources: {
        Row: {
          id: string;
          state_id: string;
          name: string;
          url: string;
          source_type: string;
          is_active: boolean;
          last_scraped_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          state_id: string;
          name: string;
          url: string;
          source_type?: string;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          state_id?: string;
          name?: string;
          url?: string;
          source_type?: string;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      scrape_runs: {
        Row: {
          id: string;
          source_id: string;
          status: ScrapeRunStatus;
          started_at: string;
          finished_at: string | null;
          records_found: number;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_id: string;
          status?: ScrapeRunStatus;
          started_at?: string;
          finished_at?: string | null;
          records_found?: number;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          source_id?: string;
          status?: ScrapeRunStatus;
          started_at?: string;
          finished_at?: string | null;
          records_found?: number;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      raw_records: {
        Row: {
          id: string;
          scrape_run_id: string;
          source_id: string;
          external_id: string | null;
          raw_payload: Json;
          scraped_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          scrape_run_id: string;
          source_id: string;
          external_id?: string | null;
          raw_payload: Json;
          scraped_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          scrape_run_id?: string;
          source_id?: string;
          external_id?: string | null;
          raw_payload?: Json;
          scraped_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      person_records: {
        Row: {
          id: string;
          state_id: string;
          source_id: string;
          external_id: string | null;
          sex: string | null;
          age_estimate_min: number | null;
          age_estimate_max: number | null;
          height_cm: number | null;
          weight_kg: number | null;
          skin_tone: string | null;
          hair_color: string | null;
          hair_type: string | null;
          eye_color: string | null;
          discovery_date: string | null;
          discovery_location: string | null;
          municipality: string | null;
          circumstances: string | null;
          distinguishing_features: string | null;
          clothing_description: string | null;
          case_status: CaseStatus;
          normalized_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          state_id: string;
          source_id: string;
          external_id?: string | null;
          sex?: string | null;
          age_estimate_min?: number | null;
          age_estimate_max?: number | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          skin_tone?: string | null;
          hair_color?: string | null;
          hair_type?: string | null;
          eye_color?: string | null;
          discovery_date?: string | null;
          discovery_location?: string | null;
          municipality?: string | null;
          circumstances?: string | null;
          distinguishing_features?: string | null;
          clothing_description?: string | null;
          case_status?: CaseStatus;
          normalized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          state_id?: string;
          source_id?: string;
          external_id?: string | null;
          sex?: string | null;
          age_estimate_min?: number | null;
          age_estimate_max?: number | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          skin_tone?: string | null;
          hair_color?: string | null;
          hair_type?: string | null;
          eye_color?: string | null;
          discovery_date?: string | null;
          discovery_location?: string | null;
          municipality?: string | null;
          circumstances?: string | null;
          distinguishing_features?: string | null;
          clothing_description?: string | null;
          case_status?: CaseStatus;
          normalized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      person_images: {
        Row: {
          id: string;
          person_record_id: string;
          url: string;
          source_url: string | null;
          caption: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          person_record_id: string;
          url: string;
          source_url?: string | null;
          caption?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          person_record_id?: string;
          url?: string;
          source_url?: string | null;
          caption?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      user_consultations: {
        Row: {
          id: string;
          sex: string | null;
          age_estimate_min: number | null;
          age_estimate_max: number | null;
          height_cm: number | null;
          weight_kg: number | null;
          skin_tone: string | null;
          hair_color: string | null;
          hair_type: string | null;
          eye_color: string | null;
          discovery_date: string | null;
          discovery_location: string | null;
          municipality: string | null;
          state_code: string | null;
          distinguishing_features: string | null;
          clothing_description: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sex?: string | null;
          age_estimate_min?: number | null;
          age_estimate_max?: number | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          skin_tone?: string | null;
          hair_color?: string | null;
          hair_type?: string | null;
          eye_color?: string | null;
          discovery_date?: string | null;
          discovery_location?: string | null;
          municipality?: string | null;
          state_code?: string | null;
          distinguishing_features?: string | null;
          clothing_description?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sex?: string | null;
          age_estimate_min?: number | null;
          age_estimate_max?: number | null;
          height_cm?: number | null;
          weight_kg?: number | null;
          skin_tone?: string | null;
          hair_color?: string | null;
          hair_type?: string | null;
          eye_color?: string | null;
          discovery_date?: string | null;
          discovery_location?: string | null;
          municipality?: string | null;
          state_code?: string | null;
          distinguishing_features?: string | null;
          clothing_description?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      match_results: {
        Row: {
          id: string;
          consultation_id: string;
          person_record_id: string;
          similarity_score: number;
          matched_fields: Json;
          rank: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          consultation_id: string;
          person_record_id: string;
          similarity_score: number;
          matched_fields?: Json;
          rank?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          consultation_id?: string;
          person_record_id?: string;
          similarity_score?: number;
          matched_fields?: Json;
          rank?: number | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      case_status: CaseStatus;
      scrape_run_status: ScrapeRunStatus;
    };
  };
}
