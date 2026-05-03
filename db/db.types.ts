export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      cabinet_games: {
        Row: {
          device_id: string
          game_id: string
          installed: boolean | null
          installed_version: number | null
        }
        Insert: {
          device_id: string
          game_id: string
          installed?: boolean | null
          installed_version?: number | null
        }
        Update: {
          device_id?: string
          game_id?: string
          installed?: boolean | null
          installed_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cabinet_games_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "cabinet_games_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "cabinet_visible_games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cabinet_games_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      device_ledger: {
        Row: {
          amount: number
          balance_delta: number
          created_at: string | null
          device_id: string
          id: number
          metadata: Json | null
          source: string | null
          type: string
        }
        Insert: {
          amount: number
          balance_delta: number
          created_at?: string | null
          device_id: string
          id?: never
          metadata?: Json | null
          source?: string | null
          type: string
        }
        Update: {
          amount?: number
          balance_delta?: number
          created_at?: string | null
          device_id?: string
          id?: never
          metadata?: Json | null
          source?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_ledger_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
        ]
      }
      devices: {
        Row: {
          balance: number
          created_at: string | null
          device_id: string
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string | null
          device_id: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string | null
          device_id?: string
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      games: {
        Row: {
          box_art_url: string | null
          created_at: string | null
          emulator_core: string | null
          enabled: boolean
          id: string
          name: string
          package_url: string | null
          price: number
          rom_path: string | null
          type: string
          updated_at: string | null
          version: number
        }
        Insert: {
          box_art_url?: string | null
          created_at?: string | null
          emulator_core?: string | null
          enabled?: boolean
          id: string
          name: string
          package_url?: string | null
          price?: number
          rom_path?: string | null
          type: string
          updated_at?: string | null
          version?: number
        }
        Update: {
          box_art_url?: string | null
          created_at?: string | null
          emulator_core?: string | null
          enabled?: boolean
          id?: string
          name?: string
          package_url?: string | null
          price?: number
          rom_path?: string | null
          type?: string
          updated_at?: string | null
          version?: number
        }
        Relationships: []
      }
      live_config: {
        Row: {
          gold_chance_initial: number | null
          gold_chance_refill: number | null
          happy_hour: boolean | null
          id: boolean
          red_wild_chance: number | null
          reel_weights: Json | null
          reel_weights_free: Json | null
          updated_at: string | null
        }
        Insert: {
          gold_chance_initial?: number | null
          gold_chance_refill?: number | null
          happy_hour?: boolean | null
          id?: boolean
          red_wild_chance?: number | null
          reel_weights?: Json | null
          reel_weights_free?: Json | null
          updated_at?: string | null
        }
        Update: {
          gold_chance_initial?: number | null
          gold_chance_refill?: number | null
          happy_hour?: boolean | null
          id?: boolean
          red_wild_chance?: number | null
          reel_weights?: Json | null
          reel_weights_free?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      cabinet_visible_games: {
        Row: {
          box_art_url: string | null
          device_id: string | null
          emulator_core: string | null
          id: string | null
          name: string | null
          price: number | null
          rom_path: string | null
          type: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cabinet_games_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
