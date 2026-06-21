export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Sexo = "Masculino" | "Femenino" | "Indeterminado";

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      coincidencias: {
        Row: {
          creado_en: string;
          forense_id: number;
          id: number;
          persona_id: number;
          puntaje: number;
          razon: string | null;
        };
        Insert: {
          creado_en?: string;
          forense_id: number;
          id?: number;
          persona_id: number;
          puntaje: number;
          razon?: string | null;
        };
        Update: {
          creado_en?: string;
          forense_id?: number;
          id?: number;
          persona_id?: number;
          puntaje?: number;
          razon?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "coincidencias_forense_id_fkey";
            columns: ["forense_id"];
            isOneToOne: false;
            referencedRelation: "forense";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coincidencias_persona_id_fkey";
            columns: ["persona_id"];
            isOneToOne: false;
            referencedRelation: "persona";
            referencedColumns: ["id"];
          },
        ];
      };
      forense: {
        Row: {
          actualizado_en: string
          creado_en: string
          edad_final: number | null
          edad_inicial: number | null
          estatura: number | null
          fecha_hallazgo: string
          fuente: string | null
          fuente_id: string | null
          id: number
          lugar_hallazgo_id: number | null
          rasgos: Json | null
          sexo: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          edad_final?: number | null
          edad_inicial?: number | null
          estatura?: number | null
          fecha_hallazgo: string
          fuente?: string | null
          fuente_id?: string | null
          id?: number
          lugar_hallazgo_id?: number | null
          rasgos?: Json | null
          sexo: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          edad_final?: number | null
          edad_inicial?: number | null
          estatura?: number | null
          fecha_hallazgo?: string
          fuente?: string | null
          fuente_id?: string | null
          id?: number
          lugar_hallazgo_id?: number | null
          rasgos?: Json | null
          sexo?: string
        }
        Relationships: [
          {
            foreignKeyName: "forense_lugar_hallazgo_id_fkey";
            columns: ["lugar_hallazgo_id"];
            isOneToOne: false;
            referencedRelation: "lugares";
            referencedColumns: ["id"];
          },
        ];
      };
      lugares: {
        Row: {
          estado: string | null
          id: number
          lugar: string
          municipio: string | null
        }
        Insert: {
          estado?: string | null
          id?: number
          lugar: string
          municipio?: string | null
        }
        Update: {
          estado?: string | null
          id?: number
          lugar?: string
          municipio?: string | null
        }
        Relationships: []
      }
      persona: {
        Row: {
          actualizado_en: string
          creado_en: string
          edad: number | null
          estatura: number | null
          fecha_desaparicion: string
          fuente: string | null
          fuente_id: string | null
          id: number
          nombre: string
          rasgos: Json | null
          sexo: string
          ultimo_lugar_id: number | null
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          edad?: number | null
          estatura?: number | null
          fecha_desaparicion: string
          fuente?: string | null
          fuente_id?: string | null
          id?: number
          nombre: string
          rasgos?: Json | null
          sexo: string
          ultimo_lugar_id?: number | null
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          edad?: number | null
          estatura?: number | null
          fecha_desaparicion?: string
          fuente?: string | null
          fuente_id?: string | null
          id?: number
          nombre?: string
          rasgos?: Json | null
          sexo?: string
          ultimo_lugar_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_ultimo_lugar_id_fkey";
            columns: ["ultimo_lugar_id"];
            isOneToOne: false;
            referencedRelation: "lugares";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    }
  ? R
  : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I;
  }
  ? I
  : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U;
  }
  ? U
  : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
