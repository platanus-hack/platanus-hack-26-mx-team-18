import type { Database, Json } from "./database";

export type CaseStatus = Database["public"]["Enums"]["case_status"];

export interface PersonRecord {
  id: string;
  stateId: string;
  sourceId: string;
  externalId: string | null;
  sex: string | null;
  ageEstimateMin: number | null;
  ageEstimateMax: number | null;
  heightCm: number | null;
  weightKg: number | null;
  skinTone: string | null;
  hairColor: string | null;
  hairType: string | null;
  eyeColor: string | null;
  discoveryDate: string | null;
  discoveryLocation: string | null;
  municipality: string | null;
  circumstances: string | null;
  distinguishingFeatures: string | null;
  clothingDescription: string | null;
  caseStatus: CaseStatus;
  normalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserConsultationInput {
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
}

export interface MatchResult {
  id: string;
  consultationId: string;
  personRecordId: string;
  similarityScore: number;
  matchedFields: Json;
  rank: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonImage {
  id: string;
  personRecordId: string;
  url: string;
  sourceUrl: string | null;
  caption: string | null;
}
