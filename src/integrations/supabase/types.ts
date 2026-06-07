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
  public: {
    Tables: {
      ai_usage_logs: {
        Row: {
          action: string
          case_id: string | null
          created_at: string
          id: string
          model_used: string
          session_id: string | null
          tokens_input: number | null
          tokens_output: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          case_id?: string | null
          created_at?: string
          id?: string
          model_used: string
          session_id?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          case_id?: string | null
          created_at?: string
          id?: string
          model_used?: string
          session_id?: string | null
          tokens_input?: number | null
          tokens_output?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_logs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      case_adjournments: {
        Row: {
          approved: boolean | null
          approved_by: Database["public"]["Enums"]["court_party_role"] | null
          case_id: string
          created_at: string
          id: string
          reason: string | null
          requested_by: Database["public"]["Enums"]["court_party_role"]
          requested_date: string
        }
        Insert: {
          approved?: boolean | null
          approved_by?: Database["public"]["Enums"]["court_party_role"] | null
          case_id: string
          created_at?: string
          id?: string
          reason?: string | null
          requested_by: Database["public"]["Enums"]["court_party_role"]
          requested_date: string
        }
        Update: {
          approved?: boolean | null
          approved_by?: Database["public"]["Enums"]["court_party_role"] | null
          case_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          requested_by?: Database["public"]["Enums"]["court_party_role"]
          requested_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_adjournments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_evidence: {
        Row: {
          ai_analysis: string | null
          case_id: string
          created_at: string
          description: string | null
          file_hash: string | null
          file_name: string
          file_type: string
          file_url: string
          id: string
          provided_by: Database["public"]["Enums"]["evidence_party"]
          uploaded_by: string | null
        }
        Insert: {
          ai_analysis?: string | null
          case_id: string
          created_at?: string
          description?: string | null
          file_hash?: string | null
          file_name: string
          file_type: string
          file_url: string
          id?: string
          provided_by: Database["public"]["Enums"]["evidence_party"]
          uploaded_by?: string | null
        }
        Update: {
          ai_analysis?: string | null
          case_id?: string
          created_at?: string
          description?: string | null
          file_hash?: string | null
          file_name?: string
          file_type?: string
          file_url?: string
          id?: string
          provided_by?: Database["public"]["Enums"]["evidence_party"]
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_intake_messages: {
        Row: {
          case_id: string | null
          created_at: string
          file_url: string | null
          id: string
          message: string
          message_type: string | null
          ocr_extracted_text: string | null
          role: string
          user_id: string
          voice_recording_url: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          message: string
          message_type?: string | null
          ocr_extracted_text?: string | null
          role: string
          user_id: string
          voice_recording_url?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string
          file_url?: string | null
          id?: string
          message?: string
          message_type?: string | null
          ocr_extracted_text?: string | null
          role?: string
          user_id?: string
          voice_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_intake_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_reports: {
        Row: {
          ai_summary: string | null
          case_id: string
          created_at: string
          file_name: string
          file_type: string
          file_url: string
          id: string
          ocr_text: string | null
          report_type: string
          uploaded_by: string | null
        }
        Insert: {
          ai_summary?: string | null
          case_id: string
          created_at?: string
          file_name: string
          file_type: string
          file_url: string
          id?: string
          ocr_text?: string | null
          report_type: string
          uploaded_by?: string | null
        }
        Update: {
          ai_summary?: string | null
          case_id?: string
          created_at?: string
          file_name?: string
          file_type?: string
          file_url?: string
          id?: string
          ocr_text?: string | null
          report_type?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_reports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          ai_processing_status: string | null
          callback_number: string | null
          case_number: string
          category: string | null
          created_at: string
          defendant: string
          description: string | null
          id: string
          involved_person_status: string | null
          next_hearing_date: string | null
          plaintiff: string
          processing_eta: string | null
          status: Database["public"]["Enums"]["case_status"] | null
          title: string
          updated_at: string
          uploaded_by_relation: string | null
          user_id: string
          user_role: Database["public"]["Enums"]["court_party_role"]
          verdict: string | null
        }
        Insert: {
          ai_processing_status?: string | null
          callback_number?: string | null
          case_number: string
          category?: string | null
          created_at?: string
          defendant: string
          description?: string | null
          id?: string
          involved_person_status?: string | null
          next_hearing_date?: string | null
          plaintiff: string
          processing_eta?: string | null
          status?: Database["public"]["Enums"]["case_status"] | null
          title: string
          updated_at?: string
          uploaded_by_relation?: string | null
          user_id: string
          user_role: Database["public"]["Enums"]["court_party_role"]
          verdict?: string | null
        }
        Update: {
          ai_processing_status?: string | null
          callback_number?: string | null
          case_number?: string
          category?: string | null
          created_at?: string
          defendant?: string
          description?: string | null
          id?: string
          involved_person_status?: string | null
          next_hearing_date?: string | null
          plaintiff?: string
          processing_eta?: string | null
          status?: Database["public"]["Enums"]["case_status"] | null
          title?: string
          updated_at?: string
          uploaded_by_relation?: string | null
          user_id?: string
          user_role?: Database["public"]["Enums"]["court_party_role"]
          verdict?: string | null
        }
        Relationships: []
      }
      court_date_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          judge_decision: string | null
          reason: string
          requested_by: string
          requested_date: string | null
          session_id: string
          status: string | null
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          judge_decision?: string | null
          reason: string
          requested_by: string
          requested_date?: string | null
          session_id: string
          status?: string | null
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          judge_decision?: string | null
          reason?: string
          requested_by?: string
          requested_date?: string | null
          session_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_date_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "court_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_date_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_evidence_submissions: {
        Row: {
          accepted_by_judge: boolean | null
          ai_analysis: string | null
          file_name: string
          file_type: string
          file_url: string
          id: string
          ocr_text: string | null
          participant_id: string
          session_id: string
          submitted_at: string
        }
        Insert: {
          accepted_by_judge?: boolean | null
          ai_analysis?: string | null
          file_name: string
          file_type: string
          file_url: string
          id?: string
          ocr_text?: string | null
          participant_id: string
          session_id: string
          submitted_at?: string
        }
        Update: {
          accepted_by_judge?: boolean | null
          ai_analysis?: string | null
          file_name?: string
          file_type?: string
          file_url?: string
          id?: string
          ocr_text?: string | null
          participant_id?: string
          session_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_evidence_submissions_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "court_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_evidence_submissions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_hand_raises: {
        Row: {
          id: string
          judge_response: string | null
          participant_id: string
          raised_at: string
          reason: string | null
          responded_at: string | null
          session_id: string
          status: string | null
        }
        Insert: {
          id?: string
          judge_response?: string | null
          participant_id: string
          raised_at?: string
          reason?: string | null
          responded_at?: string | null
          session_id: string
          status?: string | null
        }
        Update: {
          id?: string
          judge_response?: string | null
          participant_id?: string
          raised_at?: string
          reason?: string | null
          responded_at?: string | null
          session_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_hand_raises_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "court_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_hand_raises_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_participants: {
        Row: {
          id: string
          is_active: boolean | null
          is_ai: boolean | null
          joined_at: string
          left_at: string | null
          participant_name: string
          role: string
          session_id: string
          user_id: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          is_ai?: boolean | null
          joined_at?: string
          left_at?: string | null
          participant_name: string
          role: string
          session_id: string
          user_id?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean | null
          is_ai?: boolean | null
          joined_at?: string
          left_at?: string | null
          participant_name?: string
          role?: string
          session_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_sessions: {
        Row: {
          adjournment_reason: string | null
          case_id: string
          court_code: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          id: string
          next_hearing_date: string | null
          started_at: string | null
          status: string
          video_recording_url: string | null
        }
        Insert: {
          adjournment_reason?: string | null
          case_id: string
          court_code: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          next_hearing_date?: string | null
          started_at?: string | null
          status?: string
          video_recording_url?: string | null
        }
        Update: {
          adjournment_reason?: string | null
          case_id?: string
          court_code?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          id?: string
          next_hearing_date?: string | null
          started_at?: string | null
          status?: string
          video_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_sessions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      court_transcripts: {
        Row: {
          audio_url: string | null
          created_at: string
          id: string
          message: string
          message_type: string | null
          participant_id: string | null
          sequence_number: number
          session_id: string
          speaker_name: string
          speaker_role: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          id?: string
          message: string
          message_type?: string | null
          participant_id?: string | null
          sequence_number?: number
          session_id: string
          speaker_name: string
          speaker_role: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          id?: string
          message?: string
          message_type?: string | null
          participant_id?: string | null
          sequence_number?: number
          session_id?: string
          speaker_name?: string
          speaker_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_transcripts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "court_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      court_witness_requests: {
        Row: {
          id: string
          judge_response: string | null
          relevance: string
          requested_at: string
          requested_by: string
          responded_at: string | null
          session_id: string
          status: string | null
          testified_at: string | null
          witness_description: string | null
          witness_name: string
        }
        Insert: {
          id?: string
          judge_response?: string | null
          relevance: string
          requested_at?: string
          requested_by: string
          responded_at?: string | null
          session_id: string
          status?: string | null
          testified_at?: string | null
          witness_description?: string | null
          witness_name: string
        }
        Update: {
          id?: string
          judge_response?: string | null
          relevance?: string
          requested_at?: string
          requested_by?: string
          responded_at?: string | null
          session_id?: string
          status?: string | null
          testified_at?: string | null
          witness_description?: string | null
          witness_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_witness_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "court_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_witness_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hearing_sessions: {
        Row: {
          case_id: string
          created_at: string
          id: string
          session_date: string
          session_number: number
          status: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          session_date?: string
          session_number?: number
          status?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          session_date?: string
          session_number?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hearing_sessions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      hearing_transcripts: {
        Row: {
          created_at: string
          id: string
          is_ai_generated: boolean | null
          message: string
          sequence_number: number
          session_id: string
          speaker_name: string
          speaker_role: Database["public"]["Enums"]["court_party_role"]
          voice_recording_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_ai_generated?: boolean | null
          message: string
          sequence_number: number
          session_id: string
          speaker_name: string
          speaker_role: Database["public"]["Enums"]["court_party_role"]
          voice_recording_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_ai_generated?: boolean | null
          message?: string
          sequence_number?: number
          session_id?: string
          speaker_name?: string
          speaker_role?: Database["public"]["Enums"]["court_party_role"]
          voice_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hearing_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "hearing_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_verifications: {
        Row: {
          admin_notes: string | null
          case_id: string
          created_at: string
          email: string
          face_match_percentage: number | null
          father_name: string
          full_name: string
          id: string
          id_document_type: string
          id_document_url: string
          intent: string
          phone_number: string
          relation_to_case: string
          reviewed_at: string | null
          reviewed_by: string | null
          selfie_url: string
          user_id: string | null
          verification_status: string | null
        }
        Insert: {
          admin_notes?: string | null
          case_id: string
          created_at?: string
          email: string
          face_match_percentage?: number | null
          father_name: string
          full_name: string
          id?: string
          id_document_type: string
          id_document_url: string
          intent: string
          phone_number: string
          relation_to_case: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_url: string
          user_id?: string | null
          verification_status?: string | null
        }
        Update: {
          admin_notes?: string | null
          case_id?: string
          created_at?: string
          email?: string
          face_match_percentage?: number | null
          father_name?: string
          full_name?: string
          id?: string
          id_document_type?: string
          id_document_url?: string
          intent?: string
          phone_number?: string
          relation_to_case?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          selfie_url?: string
          user_id?: string | null
          verification_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_verifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: string | null
          content: string | null
          created_at: string
          file_type: string | null
          file_url: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          category?: string | null
          content?: string | null
          created_at?: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          category?: string | null
          content?: string | null
          created_at?: string
          file_type?: string | null
          file_url?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          related_case_id: string | null
          related_session_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          related_case_id?: string | null
          related_session_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          related_case_id?: string | null
          related_session_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_session_id_fkey"
            columns: ["related_session_id"]
            isOneToOne: false
            referencedRelation: "court_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          preferred_language: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_court_code: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_session_participant: {
        Args: { _session_id: string }
        Returns: boolean
      }
      owns_court_participant: {
        Args: { _participant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      case_status:
        | "pending"
        | "in_progress"
        | "adjourned"
        | "verdict_delivered"
        | "closed"
      court_party_role:
        | "audience"
        | "judge"
        | "steno"
        | "public_prosecutor"
        | "defence_lawyer"
        | "pp_assistant"
        | "defence_assistant"
        | "accused"
        | "victim"
        | "victim_family"
        | "accused_family"
        | "police_staff"
      evidence_party: "prosecution" | "defence" | "court" | "police"
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
  public: {
    Enums: {
      app_role: ["admin", "user"],
      case_status: [
        "pending",
        "in_progress",
        "adjourned",
        "verdict_delivered",
        "closed",
      ],
      court_party_role: [
        "audience",
        "judge",
        "steno",
        "public_prosecutor",
        "defence_lawyer",
        "pp_assistant",
        "defence_assistant",
        "accused",
        "victim",
        "victim_family",
        "accused_family",
        "police_staff",
      ],
      evidence_party: ["prosecution", "defence", "court", "police"],
    },
  },
} as const
