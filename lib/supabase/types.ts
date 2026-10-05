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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          created_at: string | null
          device_id: string | null
          event_type: string
          geo_location: Json | null
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          device_id?: string | null
          event_type: string
          geo_location?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          device_id?: string | null
          event_type?: string
          geo_location?: Json | null
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      fiat_payouts: {
        Row: {
          accepted_at: string | null
          account_name: string | null
          account_number: string | null
          amount: number | null
          bank_name: string | null
          chain: string | null
          created_at: string
          fiat_transaction_id: string | null
          id: string
          message_details: Json | null
          onchain_tx: string | null
          paid_at: string | null
          payout_amount: number | null
          plan_id: string | null
          status: string
          token: string | null
          updated_at: string
          vendor_id: number | null
          wallet_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          account_name?: string | null
          account_number?: string | null
          amount?: number | null
          bank_name?: string | null
          chain?: string | null
          created_at?: string
          fiat_transaction_id?: string | null
          id?: string
          message_details?: Json | null
          onchain_tx?: string | null
          paid_at?: string | null
          payout_amount?: number | null
          plan_id?: string | null
          status?: string
          token?: string | null
          updated_at?: string
          vendor_id?: number | null
          wallet_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          account_name?: string | null
          account_number?: string | null
          amount?: number | null
          bank_name?: string | null
          chain?: string | null
          created_at?: string
          fiat_transaction_id?: string | null
          id?: string
          message_details?: Json | null
          onchain_tx?: string | null
          paid_at?: string | null
          payout_amount?: number | null
          plan_id?: string | null
          status?: string
          token?: string | null
          updated_at?: string
          vendor_id?: number | null
          wallet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiat_payouts_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiat_payouts_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          account_name: string | null
          bank_code: string | null
          bank_name: string | null
          chain: string | null
          created_at: string | null
          frequency: string | null
          id: string
          last_payout_date: string | null
          name: string
          next_payout_date: string | null
          payout_account_number: string | null
          payout_method: string
          payout_time: string | null
          payout_wallet_address: string | null
          plan_type: string
          received_amount: number | null
          recurrent_payout: number | null
          status: string
          target_amount: number | null
          target_date: string | null
          target_type: string | null
          token: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          chain?: string | null
          created_at?: string | null
          frequency?: string | null
          id?: string
          last_payout_date?: string | null
          name: string
          next_payout_date?: string | null
          payout_account_number?: string | null
          payout_method: string
          payout_time?: string | null
          payout_wallet_address?: string | null
          plan_type: string
          received_amount?: number | null
          recurrent_payout?: number | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          target_type?: string | null
          token?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_name?: string | null
          bank_code?: string | null
          bank_name?: string | null
          chain?: string | null
          created_at?: string | null
          frequency?: string | null
          id?: string
          last_payout_date?: string | null
          name?: string
          next_payout_date?: string | null
          payout_account_number?: string | null
          payout_method?: string
          payout_time?: string | null
          payout_wallet_address?: string | null
          plan_type?: string
          received_amount?: number | null
          recurrent_payout?: number | null
          status?: string
          target_amount?: number | null
          target_date?: string | null
          target_type?: string | null
          token?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      processed_transactions: {
        Row: {
          created_at: string | null
          id: string
          signature: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          signature: string
        }
        Update: {
          created_at?: string | null
          id?: string
          signature?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          description: string | null
          fiat_transaction_id: string | null
          id: string
          solana_signature: string | null
          transaction_hash: string | null
          type: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string
          description?: string | null
          fiat_transaction_id?: string | null
          id?: string
          solana_signature?: string | null
          transaction_hash?: string | null
          type: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          description?: string | null
          fiat_transaction_id?: string | null
          id?: string
          solana_signature?: string | null
          transaction_hash?: string | null
          type?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      transfer_recovery_jobs: {
        Row: {
          attempt_count: number
          chain: string
          completed_at: string | null
          created_at: string
          id: string
          key: string
          last_error: string | null
          next_attempt_at: string
          operation_type: string
          plan_id: string
          request: Json
          response: Json | null
          result: Json
          scope: string
          status: string
          token: string
          updated_at: string
          user_id: string | null
          wallet_id: string
        }
        Insert: {
          attempt_count?: number
          chain: string
          completed_at?: string | null
          created_at?: string
          id?: string
          key: string
          last_error?: string | null
          next_attempt_at?: string
          operation_type: string
          plan_id: string
          request?: Json
          response?: Json | null
          result?: Json
          scope: string
          status?: string
          token: string
          updated_at?: string
          user_id?: string | null
          wallet_id: string
        }
        Update: {
          attempt_count?: number
          chain?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          key?: string
          last_error?: string | null
          next_attempt_at?: string
          operation_type?: string
          plan_id?: string
          request?: Json
          response?: Json | null
          result?: Json
          scope?: string
          status?: string
          token?: string
          updated_at?: string
          user_id?: string | null
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_recovery_jobs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_recovery_jobs_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          email: string
          google_id: string | null
          has_created_plan: boolean | null
          id: string
          name: string | null
          picture: string | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          email: string
          google_id?: string | null
          has_created_plan?: boolean | null
          id?: string
          name?: string | null
          picture?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          email?: string
          google_id?: string | null
          has_created_plan?: boolean | null
          id?: string
          name?: string | null
          picture?: string | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: []
      }
      vendors: {
        Row: {
          chat_id: number
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          user_id: number
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          user_id: number
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          user_id?: number
          username?: string | null
        }
        Relationships: []
      }
      wallet_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          plan_id: string
          transaction_id: string
          user_id: string
          wallet_id: string
        }
        Insert: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          plan_id: string
          transaction_id: string
          user_id: string
          wallet_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          plan_id?: string
          transaction_id?: string
          user_id?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_events_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_events_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          address: string
          chain_type: string
          created_at: string | null
          has_webhook: boolean
          id: string
          plan_id: string
          updated_at: string | null
        }
        Insert: {
          address: string
          chain_type?: string
          created_at?: string | null
          has_webhook?: boolean
          id?: string
          plan_id: string
          updated_at?: string | null
        }
        Update: {
          address?: string
          chain_type?: string
          created_at?: string | null
          has_webhook?: boolean
          id?: string
          plan_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_fiat_payout: {
        Args: { p_payout_id: string; p_vendor_id: number }
        Returns: Json
      }
      complete_transfer_recovery_job: {
        Args: { p_key: string; p_response: Json; p_scope: string }
        Returns: undefined
      }
      create_plan_and_wallet: {
        Args: { p_plan: Json; p_user_id: string; p_wallet_address: string }
        Returns: Json
      }
      fail_transfer_recovery_job: {
        Args: { p_error: string; p_key: string; p_scope: string }
        Returns: undefined
      }
      mark_payout_as_paid: {
        Args: {
          p_payout_amount?: number
          p_payout_id: string
          p_vendor_id: number
        }
        Returns: undefined
      }
      mark_plan_broken: { Args: { p_plan_id: string }; Returns: undefined }
      mark_plan_completed: { Args: { p_plan_id: string }; Returns: undefined }
      mark_transfer_recovery_external_succeeded: {
        Args: { p_key: string; p_result: Json; p_scope: string }
        Returns: undefined
      }
      platform_total_saved: { Args: never; Returns: Json }
      process_transfer_recovery_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      record_fiat_payout: {
        Args: {
          p_amount: number
          p_currency: string
          p_description: string
          p_fiat_transaction_id: string
          p_is_solana: boolean
          p_plan_id: string
          p_tx: string
          p_wallet_id: string
        }
        Returns: undefined
      }
      record_payout_success: {
        Args: {
          p_last_payout_date: string
          p_next_payout_date: string
          p_plan_id: string
        }
        Returns: undefined
      }
      record_plan_break: {
        Args: {
          p_currency?: string
          p_fee_amount?: number
          p_fee_tx?: string
          p_is_solana?: boolean
          p_payout_amount?: number
          p_payout_tx: string
          p_plan_id: string
          p_recipient?: string
          p_wallet_id: string
        }
        Returns: undefined
      }
      record_recurring_payout: {
        Args: {
          p_amount: number
          p_currency: string
          p_is_solana?: boolean
          p_last_payout_date: string
          p_next_payout_date?: string
          p_plan_id: string
          p_recipient: string
          p_tx: string
          p_wallet_id: string
        }
        Returns: undefined
      }
      record_target_payout: {
        Args: {
          p_amount: number
          p_currency: string
          p_is_solana: boolean
          p_plan_id: string
          p_recipient: string
          p_tx: string
          p_wallet_id: string
        }
        Returns: undefined
      }
      transfer_recovery_already_applied: {
        Args: {
          p_job: Database["public"]["Tables"]["transfer_recovery_jobs"]["Row"]
        }
        Returns: boolean
      }
      transfer_recovery_response: {
        Args: {
          p_job: Database["public"]["Tables"]["transfer_recovery_jobs"]["Row"]
        }
        Returns: Json
      }
      upsert_transfer_recovery_job: {
        Args: {
          p_chain?: string
          p_key: string
          p_operation_type: string
          p_plan_id?: string
          p_request?: Json
          p_scope: string
          p_token?: string
          p_user_id?: string
          p_wallet_id?: string
        }
        Returns: string
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
