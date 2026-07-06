export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      account_group_visibility: {
        Row: {
          account_id: number
          group_id: number
          id: number
          visible_from: string
          visible_until: string | null
        }
        Insert: {
          account_id: number
          group_id: number
          id?: number
          visible_from?: string
          visible_until?: string | null
        }
        Update: {
          account_id?: number
          group_id?: number
          id?: number
          visible_from?: string
          visible_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_group_visibility_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_group_visibility_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      account_members: {
        Row: {
          account_id: number
          added_at: string | null
          id: number
          ownership_type: string
          user_id: number
        }
        Insert: {
          account_id: number
          added_at?: string | null
          id?: number
          ownership_type: string
          user_id: number
        }
        Update: {
          account_id?: number
          added_at?: string | null
          id?: number
          ownership_type?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      account_transactions: {
        Row: {
          account_id: number
          created_at: string | null
          id: number
          transaction_id: number
          transaction_type: string
        }
        Insert: {
          account_id: number
          created_at?: string | null
          id?: number
          transaction_id: number
          transaction_type: string
        }
        Update: {
          account_id?: number
          created_at?: string | null
          id?: number
          transaction_id?: number
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_transactions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_name: string
          type: string | null
          subtype: string | null
          balance_available: number | null
          balance_current: number | null
          created_at: string | null
          currency_code: string | null
          id: number
          institution_name: string | null
          is_active: boolean | null
          is_joint_declared: boolean
          last_four: string | null
          plaid_account_id: string | null
          plaid_item_id: string | null
          updated_at: string | null
          user_id: number
        }
        Insert: {
          account_name: string
          type?: string | null
          subtype?: string | null
          balance_available?: number | null
          balance_current?: number | null
          created_at?: string | null
          currency_code?: string | null
          id?: number
          institution_name?: string | null
          is_active?: boolean | null
          is_joint_declared?: boolean
          last_four?: string | null
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          updated_at?: string | null
          user_id: number
        }
        Update: {
          account_name?: string
          type?: string | null
          subtype?: string | null
          balance_available?: number | null
          balance_current?: number | null
          created_at?: string | null
          currency_code?: string | null
          id?: number
          institution_name?: string | null
          is_active?: boolean | null
          is_joint_declared?: boolean
          last_four?: string | null
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action_source: string
          changed_at: string
          exported_at: string | null
          group_id: number | null
          id: number
          new_data: Json | null
          old_data: Json | null
          operation: string
          record_id: number | null
          table_name: string
          user_id: number | null
        }
        Insert: {
          action_source: string
          changed_at?: string
          exported_at?: string | null
          group_id?: number | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          operation: string
          record_id?: number | null
          table_name: string
          user_id?: number | null
        }
        Update: {
          action_source?: string
          changed_at?: string
          exported_at?: string | null
          group_id?: number | null
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          operation?: string
          record_id?: number | null
          table_name?: string
          user_id?: number | null
        }
        Relationships: []
      }
      group_memberships: {
        Row: {
          departed_at: string | null
          group_id: number
          id: number
          joined_group_at: string
          role: string
          user_id: number
        }
        Insert: {
          departed_at?: string | null
          group_id: number
          id?: number
          joined_group_at?: string
          role: string
          user_id: number
        }
        Update: {
          departed_at?: string | null
          group_id?: number
          id?: number
          joined_group_at?: string
          role?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          id: number
          is_syncing: boolean
          last_synced_at: string | null
          member_count: number | null
          name: string
          sync_started_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          is_syncing?: boolean
          last_synced_at?: string | null
          member_count?: number | null
          name: string
          sync_started_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          is_syncing?: boolean
          last_synced_at?: string | null
          member_count?: number | null
          name?: string
          sync_started_at?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          expires_at: string
          group_id: number | null
          id: number
          invitee_email: string
          invitee_user_id: number | null
          inviter_user_id: number
          status: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          expires_at?: string
          group_id?: number | null
          id?: number
          invitee_email: string
          invitee_user_id?: number | null
          inviter_user_id: number
          status?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          expires_at?: string
          group_id?: number | null
          id?: number
          invitee_email?: string
          invitee_user_id?: number | null
          inviter_user_id?: number
          status?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invitee_user_id_fkey"
            columns: ["invitee_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_inviter_user_id_fkey"
            columns: ["inviter_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: number
          token: string
          used_at: string | null
          user_id: number
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: number
          token: string
          used_at?: string | null
          user_id: number
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: number
          token?: string
          used_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "password_reset_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token_ciphertext: string
          access_token_iv: string
          access_token_tag: string
          created_at: string | null
          id: number
          institution_id: string | null
          institution_name: string | null
          last_synced_at: string | null
          plaid_item_id: string
          transactions_cursor: string | null
          updated_at: string | null
          user_id: number
        }
        Insert: {
          access_token_ciphertext: string
          access_token_iv: string
          access_token_tag: string
          created_at?: string | null
          id?: number
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_item_id: string
          transactions_cursor?: string | null
          updated_at?: string | null
          user_id: number
        }
        Update: {
          access_token_ciphertext?: string
          access_token_iv?: string
          access_token_tag?: string
          created_at?: string | null
          id?: number
          institution_id?: string | null
          institution_name?: string | null
          last_synced_at?: string | null
          plaid_item_id?: string
          transactions_cursor?: string | null
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_tokens: {
        Row: {
          created_at: string | null
          expires_at: string
          id: number
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
          user_id: number
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: number
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: number
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: number
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "refresh_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number | null
          category: string | null
          created_at: string | null
          description: string | null
          entry_method: string
          id: number
          merchant_name: string | null
          pending: boolean
          plaid_id: string | null
          transaction_date: string
          updated_at: string | null
          user_id: number
        }
        Insert: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          entry_method?: string
          id?: number
          merchant_name?: string | null
          pending?: boolean
          plaid_id?: string | null
          transaction_date: string
          updated_at?: string | null
          user_id: number
        }
        Update: {
          amount?: number | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          entry_method?: string
          id?: number
          merchant_name?: string | null
          pending?: boolean
          plaid_id?: string | null
          transaction_date?: string
          updated_at?: string | null
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          first_name: string
          id: number
          last_name: string
          password_hash: string
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name: string
          id?: number
          last_name: string
          password_hash: string
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string
          id?: number
          last_name?: string
          password_hash?: string
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
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
