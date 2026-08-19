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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string
          comment: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_status: string | null
          old_status: string | null
        }
        Insert: {
          action: string
          actor_id: string
          comment?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          comment?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_status?: string | null
          old_status?: string | null
        }
        Relationships: []
      }
      admin_notes: {
        Row: {
          content: string
          created_at: string
          created_by: string
          id: string
          profile_user_id: string
          updated_at: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by: string
          id?: string
          profile_user_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          id?: string
          profile_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      application_reminder_log: {
        Row: {
          application_id: string
          error: string | null
          id: string
          recipient_email: string
          reminder_kind: string
          sent_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          application_id: string
          error?: string | null
          id?: string
          recipient_email: string
          reminder_kind: string
          sent_at?: string
          status: string
          tenant_id?: string | null
        }
        Update: {
          application_id?: string
          error?: string | null
          id?: string
          recipient_email?: string
          reminder_kind?: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      application_stage_history: {
        Row: {
          actor_id: string | null
          application_id: string
          created_at: string
          from_stage: string | null
          id: string
          reason: string | null
          to_stage: string
        }
        Insert: {
          actor_id?: string | null
          application_id: string
          created_at?: string
          from_stage?: string | null
          id?: string
          reason?: string | null
          to_stage: string
        }
        Update: {
          actor_id?: string | null
          application_id?: string
          created_at?: string
          from_stage?: string | null
          id?: string
          reason?: string | null
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_stage_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_stage_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
        ]
      }
      applications: {
        Row: {
          address: string | null
          ai_decision: string | null
          ai_reason: string | null
          birth_date: string | null
          birth_place: string | null
          booking_status: string
          broker_tenant_id: string | null
          calendly_event_uri: string | null
          calendly_invitee_uri: string | null
          city: string | null
          cold_at: string | null
          cold_reason: string | null
          created_at: string
          email: string
          email_bounce_reason: string | null
          email_bounced_at: string | null
          email_status: string
          fasttrack_tenant_id: string | null
          first_name: string | null
          flow_type: string
          full_name: string
          id: string
          interview_completed_at: string | null
          interview_messages: Json
          interview_mode: string | null
          interview_recommendation: string | null
          interview_score: number | null
          interview_started_at: string | null
          interview_status: string
          interview_summary: string | null
          is_test: boolean
          last_name: string | null
          linked_application_id: string | null
          magic_token: string | null
          magic_token_expires_at: string | null
          message: string | null
          nationality: string | null
          phone: string | null
          postal_code: string | null
          registered_at: string | null
          scheduled_at: string | null
          source_landing_id: string | null
          source_slug: string | null
          stage: string
          stage_changed_at: string
          stage_changed_by: string | null
          status: string
          status_cold: boolean
          target_landing_id: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          ai_decision?: string | null
          ai_reason?: string | null
          birth_date?: string | null
          birth_place?: string | null
          booking_status?: string
          broker_tenant_id?: string | null
          calendly_event_uri?: string | null
          calendly_invitee_uri?: string | null
          city?: string | null
          cold_at?: string | null
          cold_reason?: string | null
          created_at?: string
          email: string
          email_bounce_reason?: string | null
          email_bounced_at?: string | null
          email_status?: string
          fasttrack_tenant_id?: string | null
          first_name?: string | null
          flow_type?: string
          full_name: string
          id?: string
          interview_completed_at?: string | null
          interview_messages?: Json
          interview_mode?: string | null
          interview_recommendation?: string | null
          interview_score?: number | null
          interview_started_at?: string | null
          interview_status?: string
          interview_summary?: string | null
          is_test?: boolean
          last_name?: string | null
          linked_application_id?: string | null
          magic_token?: string | null
          magic_token_expires_at?: string | null
          message?: string | null
          nationality?: string | null
          phone?: string | null
          postal_code?: string | null
          registered_at?: string | null
          scheduled_at?: string | null
          source_landing_id?: string | null
          source_slug?: string | null
          stage?: string
          stage_changed_at?: string
          stage_changed_by?: string | null
          status?: string
          status_cold?: boolean
          target_landing_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          ai_decision?: string | null
          ai_reason?: string | null
          birth_date?: string | null
          birth_place?: string | null
          booking_status?: string
          broker_tenant_id?: string | null
          calendly_event_uri?: string | null
          calendly_invitee_uri?: string | null
          city?: string | null
          cold_at?: string | null
          cold_reason?: string | null
          created_at?: string
          email?: string
          email_bounce_reason?: string | null
          email_bounced_at?: string | null
          email_status?: string
          fasttrack_tenant_id?: string | null
          first_name?: string | null
          flow_type?: string
          full_name?: string
          id?: string
          interview_completed_at?: string | null
          interview_messages?: Json
          interview_mode?: string | null
          interview_recommendation?: string | null
          interview_score?: number | null
          interview_started_at?: string | null
          interview_status?: string
          interview_summary?: string | null
          is_test?: boolean
          last_name?: string | null
          linked_application_id?: string | null
          magic_token?: string | null
          magic_token_expires_at?: string | null
          message?: string | null
          nationality?: string | null
          phone?: string | null
          postal_code?: string | null
          registered_at?: string | null
          scheduled_at?: string | null
          source_landing_id?: string | null
          source_slug?: string | null
          stage?: string
          stage_changed_at?: string
          stage_changed_by?: string | null
          status?: string
          status_cold?: boolean
          target_landing_id?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_broker_tenant_id_fkey"
            columns: ["broker_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_broker_tenant_id_fkey"
            columns: ["broker_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_fasttrack_tenant_id_fkey"
            columns: ["fasttrack_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_fasttrack_tenant_id_fkey"
            columns: ["fasttrack_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_linked_application_id_fkey"
            columns: ["linked_application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_linked_application_id_fkey"
            columns: ["linked_application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "applications_source_landing_id_fkey"
            columns: ["source_landing_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_target_landing_id_fkey"
            columns: ["target_landing_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reminder_log: {
        Row: {
          booking_id: string
          error: string | null
          recipient_email: string
          sent_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          booking_id: string
          error?: string | null
          recipient_email: string
          sent_at?: string
          status?: string
          tenant_id: string
        }
        Update: {
          booking_id?: string
          error?: string | null
          recipient_email?: string
          sent_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminder_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          status: string
          target: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          status?: string
          target?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          status?: string
          target?: string | null
        }
        Relationships: []
      }
      availability_exceptions: {
        Row: {
          end_time: string | null
          exception_date: string
          id: string
          is_blocked: boolean
          note: string | null
          schedule_id: string
          start_time: string | null
        }
        Insert: {
          end_time?: string | null
          exception_date: string
          id?: string
          is_blocked?: boolean
          note?: string | null
          schedule_id: string
          start_time?: string | null
        }
        Update: {
          end_time?: string | null
          exception_date?: string
          id?: string
          is_blocked?: boolean
          note?: string | null
          schedule_id?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          end_time: string
          id: string
          schedule_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          end_time: string
          id?: string
          schedule_id: string
          start_time: string
          weekday: number
        }
        Update: {
          end_time?: string
          id?: string
          schedule_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_schedules: {
        Row: {
          active: boolean
          buffer_after_minutes: number
          buffer_before_minutes: number
          created_at: string
          id: string
          landing_page_id: string | null
          max_days_ahead: number
          min_notice_hours: number
          name: string
          slot_duration_minutes: number
          tenant_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          id?: string
          landing_page_id?: string | null
          max_days_ahead?: number
          min_notice_hours?: number
          name?: string
          slot_duration_minutes?: number
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          id?: string
          landing_page_id?: string | null
          max_days_ahead?: number
          min_notice_hours?: number
          name?: string
          slot_duration_minutes?: number
          tenant_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_schedules_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_limits: {
        Row: {
          daily_limit: number
          employment_type: Database["public"]["Enums"]["employment_type"]
          min_pause_days: number
          monthly_limit: number | null
          updated_at: string
        }
        Insert: {
          daily_limit?: number
          employment_type: Database["public"]["Enums"]["employment_type"]
          min_pause_days?: number
          monthly_limit?: number | null
          updated_at?: string
        }
        Update: {
          daily_limit?: number
          employment_type?: Database["public"]["Enums"]["employment_type"]
          min_pause_days?: number
          monthly_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          admin_override: boolean
          assignment_id: string | null
          booking_date: string | null
          booking_time: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cancelled_by_role: string | null
          created_at: string
          id: string
          status: Database["public"]["Enums"]["booking_status"]
          time_slot_id: string | null
          user_id: string
        }
        Insert: {
          admin_override?: boolean
          assignment_id?: string | null
          booking_date?: string | null
          booking_time?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          time_slot_id?: string | null
          user_id: string
        }
        Update: {
          admin_override?: boolean
          assignment_id?: string | null
          booking_date?: string | null
          booking_time?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cancelled_by_role?: string | null
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          time_slot_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_time_slot_id_fkey"
            columns: ["time_slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      calendly_accounts: {
        Row: {
          calendly_user_uri: string | null
          created_at: string
          display_name: string
          id: string
          tenant_id: string | null
          updated_at: string
          webhook_signing_key: string
        }
        Insert: {
          calendly_user_uri?: string | null
          created_at?: string
          display_name: string
          id?: string
          tenant_id?: string | null
          updated_at?: string
          webhook_signing_key: string
        }
        Update: {
          calendly_user_uri?: string | null
          created_at?: string
          display_name?: string
          id?: string
          tenant_id?: string | null
          updated_at?: string
          webhook_signing_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendly_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendly_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          admin_hidden_at: string | null
          admin_note: string | null
          admin_note_updated_at: string | null
          admin_note_updated_by: string | null
          admin_unread: boolean
          created_at: string
          escalated_at: string | null
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_hidden_at?: string | null
          admin_note?: string | null
          admin_note_updated_at?: string | null
          admin_note_updated_by?: string | null
          admin_unread?: boolean
          created_at?: string
          escalated_at?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_hidden_at?: string | null
          admin_note?: string | null
          admin_note_updated_at?: string | null
          admin_note_updated_by?: string | null
          admin_unread?: boolean
          created_at?: string
          escalated_at?: string | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachment_name: string | null
          attachment_type: string | null
          attachment_url: string | null
          conversation_id: string | null
          created_at: string
          edited_at: string | null
          id: string
          is_ai: boolean
          message: string
          read: boolean
          receiver_id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_type?: string | null
          attachment_url?: string | null
          conversation_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          is_ai?: boolean
          message: string
          read?: boolean
          receiver_id: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_type?: string | null
          attachment_url?: string | null
          conversation_id?: string | null
          created_at?: string
          edited_at?: string | null
          id?: string
          is_ai?: boolean
          message?: string
          read?: boolean
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      cloudflare_accounts: {
        Row: {
          account_id: string
          api_token: string | null
          api_token_secret_name: string | null
          created_at: string
          id: string
          is_default: boolean
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          api_token?: string | null
          api_token_secret_name?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          api_token?: string | null
          api_token_secret_name?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cloudflare_zones: {
        Row: {
          cloudflare_account_id: string
          created_at: string
          domain: string
          id: string
          last_synced_at: string | null
          nameservers: string[]
          status: string
          updated_at: string
          zone_id: string
        }
        Insert: {
          cloudflare_account_id: string
          created_at?: string
          domain: string
          id?: string
          last_synced_at?: string | null
          nameservers?: string[]
          status?: string
          updated_at?: string
          zone_id: string
        }
        Update: {
          cloudflare_account_id?: string
          created_at?: string
          domain?: string
          id?: string
          last_synced_at?: string | null
          nameservers?: string[]
          status?: string
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cloudflare_zones_cloudflare_account_id_fkey"
            columns: ["cloudflare_account_id"]
            isOneToOne: false
            referencedRelation: "cloudflare_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          body_html: string
          content: string
          created_at: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          id: string
          is_active: boolean
          tenant_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body_html?: string
          content?: string
          created_at?: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          id?: string
          is_active?: boolean
          tenant_id: string
          title?: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_html?: string
          content?: string
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          id?: string
          is_active?: boolean
          tenant_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          company_signature_url: string | null
          created_at: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          generated_content: string
          id: string
          metadata: Json | null
          pdf_url: string | null
          signature_image_url: string | null
          signed_at: string
          signed_name: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          company_signature_url?: string | null
          created_at?: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          generated_content: string
          id?: string
          metadata?: Json | null
          pdf_url?: string | null
          signature_image_url?: string | null
          signed_at?: string
          signed_name: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          company_signature_url?: string | null
          created_at?: string
          employment_type?: Database["public"]["Enums"]["employment_type"]
          generated_content?: string
          id?: string
          metadata?: Json | null
          pdf_url?: string | null
          signature_image_url?: string | null
          signed_at?: string
          signed_name?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"]
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          notes: string | null
          status: Database["public"]["Enums"]["document_status"]
          tenant_id: string | null
          updated_at: string
          uploaded_by: string
          user_id: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["document_category"]
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          tenant_id?: string | null
          updated_at?: string
          uploaded_by: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["document_category"]
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          tenant_id?: string | null
          updated_at?: string
          uploaded_by?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_recipient_failures: {
        Row: {
          consecutive_failures: number
          created_at: string
          last_error: string | null
          last_failed_at: string | null
          recipient_email: string
          suppressed_at: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          last_error?: string | null
          last_failed_at?: string | null
          recipient_email: string
          suppressed_at?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          last_error?: string | null
          last_failed_at?: string | null
          recipient_email?: string
          suppressed_at?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_recipient_failures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_recipient_failures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          error_message: string | null
          id: string
          message_id: string
          metadata: Json | null
          recipient_email: string
          rendered_html: string | null
          rendered_subject: string | null
          sender_email: string | null
          status: string
          template_name: string | null
          tenant_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id: string
          metadata?: Json | null
          recipient_email: string
          rendered_html?: string | null
          rendered_subject?: string | null
          sender_email?: string | null
          status?: string
          template_name?: string | null
          tenant_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string
          metadata?: Json | null
          recipient_email?: string
          rendered_html?: string | null
          rendered_subject?: string | null
          sender_email?: string | null
          status?: string
          template_name?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          rate_limited_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          rate_limited_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          rate_limited_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token?: string
          used?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used?: boolean
        }
        Relationships: []
      }
      employee_contract_overrides: {
        Row: {
          application_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          html_body: string | null
          id: string
          monthly_salary_cents: number | null
          pdf_url: string | null
          start_date: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string | null
          weekly_hours: number | null
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          html_body?: string | null
          id?: string
          monthly_salary_cents?: number | null
          pdf_url?: string | null
          start_date?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          weekly_hours?: number | null
        }
        Update: {
          application_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          html_body?: string | null
          id?: string
          monthly_salary_cents?: number | null
          pdf_url?: string | null
          start_date?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string | null
          weekly_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_contract_overrides_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contract_overrides_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "employee_contract_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contract_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_appointments: {
        Row: {
          applicant_timezone: string | null
          application_id: string
          cancel_reason: string | null
          cancel_token: string
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          ends_at: string
          id: string
          rescheduled_from_id: string | null
          schedule_id: string
          starts_at: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          applicant_timezone?: string | null
          application_id: string
          cancel_reason?: string | null
          cancel_token?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          ends_at: string
          id?: string
          rescheduled_from_id?: string | null
          schedule_id: string
          starts_at: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          applicant_timezone?: string | null
          application_id?: string
          cancel_reason?: string | null
          cancel_token?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          rescheduled_from_id?: string | null
          schedule_id?: string
          starts_at?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_appointments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_appointments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "interview_appointments_rescheduled_from_id_fkey"
            columns: ["rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "interview_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_appointments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_tokens: {
        Row: {
          application_id: string | null
          created_at: string
          email: string
          id: string
          tenant_id: string
          token: string
          used: boolean
          used_at: string | null
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          email: string
          id?: string
          tenant_id: string
          token?: string
          used?: boolean
          used_at?: string | null
        }
        Update: {
          application_id?: string | null
          created_at?: string
          email?: string
          id?: string
          tenant_id?: string
          token?: string
          used?: boolean
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitation_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_tokens_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "invitation_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_resend_queue: {
        Row: {
          application_id: string
          attempts: number
          batch_id: string
          created_at: string
          email: string
          first_name: string | null
          full_name: string | null
          id: string
          last_error: string | null
          last_name: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          application_id: string
          attempts?: number
          batch_id: string
          created_at?: string
          email: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_error?: string | null
          last_name?: string | null
          scheduled_at: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          application_id?: string
          attempts?: number
          batch_id?: string
          created_at?: string
          email?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          last_error?: string | null
          last_name?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_resend_queue_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_resend_queue_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "v_application_email_routing"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "invite_resend_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_resend_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_verifications: {
        Row: {
          created_at: string
          id: string
          id_back_url: string | null
          id_front_url: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_flag: boolean
          selfie_url: string | null
          status: Database["public"]["Enums"]["kyc_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          id_back_url?: string | null
          id_front_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_flag?: boolean
          selfie_url?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          id_back_url?: string | null
          id_front_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_flag?: boolean
          selfie_url?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      landing_pages: {
        Row: {
          agb_url: string | null
          booking_mode: Database["public"]["Enums"]["landing_booking_mode"]
          booking_window_days: number
          branding: Json
          calendly_url: string | null
          cloudflare_zone_id: string | null
          contact_person_avatar_url: string | null
          contact_person_email: string | null
          contact_person_name: string | null
          contact_person_phone: string | null
          contact_person_role: string | null
          created_at: string
          domain: string
          event_description: string | null
          favicon_url: string | null
          flow_type: string
          id: string
          intermediate_company_name: string | null
          intermediate_logo_url: string | null
          interview_decision_prompt: string | null
          interview_mode: string
          interview_system_prompt: string | null
          interview_voice_id: string | null
          is_published: boolean
          linked_fasttrack_landing_id: string | null
          logo_url: string | null
          opening_hours: string | null
          partner_company_id: string | null
          recruiter_avatar_url: string | null
          recruiter_name: string | null
          redirect_delay_ms: number
          server_id: string | null
          slots: Json
          slug: string
          source_slug: string | null
          tenant_id: string | null
          theme_id: string
          updated_at: string
          widerruf_url: string | null
        }
        Insert: {
          agb_url?: string | null
          booking_mode?: Database["public"]["Enums"]["landing_booking_mode"]
          booking_window_days?: number
          branding?: Json
          calendly_url?: string | null
          cloudflare_zone_id?: string | null
          contact_person_avatar_url?: string | null
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          contact_person_role?: string | null
          created_at?: string
          domain: string
          event_description?: string | null
          favicon_url?: string | null
          flow_type?: string
          id?: string
          intermediate_company_name?: string | null
          intermediate_logo_url?: string | null
          interview_decision_prompt?: string | null
          interview_mode?: string
          interview_system_prompt?: string | null
          interview_voice_id?: string | null
          is_published?: boolean
          linked_fasttrack_landing_id?: string | null
          logo_url?: string | null
          opening_hours?: string | null
          partner_company_id?: string | null
          recruiter_avatar_url?: string | null
          recruiter_name?: string | null
          redirect_delay_ms?: number
          server_id?: string | null
          slots?: Json
          slug: string
          source_slug?: string | null
          tenant_id?: string | null
          theme_id: string
          updated_at?: string
          widerruf_url?: string | null
        }
        Update: {
          agb_url?: string | null
          booking_mode?: Database["public"]["Enums"]["landing_booking_mode"]
          booking_window_days?: number
          branding?: Json
          calendly_url?: string | null
          cloudflare_zone_id?: string | null
          contact_person_avatar_url?: string | null
          contact_person_email?: string | null
          contact_person_name?: string | null
          contact_person_phone?: string | null
          contact_person_role?: string | null
          created_at?: string
          domain?: string
          event_description?: string | null
          favicon_url?: string | null
          flow_type?: string
          id?: string
          intermediate_company_name?: string | null
          intermediate_logo_url?: string | null
          interview_decision_prompt?: string | null
          interview_mode?: string
          interview_system_prompt?: string | null
          interview_voice_id?: string | null
          is_published?: boolean
          linked_fasttrack_landing_id?: string | null
          logo_url?: string | null
          opening_hours?: string | null
          partner_company_id?: string | null
          recruiter_avatar_url?: string | null
          recruiter_name?: string | null
          redirect_delay_ms?: number
          server_id?: string | null
          slots?: Json
          slug?: string
          source_slug?: string | null
          tenant_id?: string | null
          theme_id?: string
          updated_at?: string
          widerruf_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_cloudflare_zone_id_fkey"
            columns: ["cloudflare_zone_id"]
            isOneToOne: false
            referencedRelation: "cloudflare_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_linked_fasttrack_landing_id_fkey"
            columns: ["linked_fasttrack_landing_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "partner_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "landing_servers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_servers: {
        Row: {
          agent_version: string | null
          bootstrap_token: string
          capacity: number
          created_at: string
          hostname: string
          id: string
          ip: unknown
          landing_count: number
          last_heartbeat_at: string | null
          name: string
          notes: string | null
          status: string
          themes_resync_done_at: string | null
          themes_resync_requested_at: string | null
          updated_at: string
        }
        Insert: {
          agent_version?: string | null
          bootstrap_token: string
          capacity?: number
          created_at?: string
          hostname: string
          id?: string
          ip: unknown
          landing_count?: number
          last_heartbeat_at?: string | null
          name: string
          notes?: string | null
          status?: string
          themes_resync_done_at?: string | null
          themes_resync_requested_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_version?: string | null
          bootstrap_token?: string
          capacity?: number
          created_at?: string
          hostname?: string
          id?: string
          ip?: unknown
          landing_count?: number
          last_heartbeat_at?: string | null
          name?: string
          notes?: string | null
          status?: string
          themes_resync_done_at?: string | null
          themes_resync_requested_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      partner_companies: {
        Row: {
          button_label: string
          calendly_account_id: string | null
          calendly_url: string
          created_at: string
          id: string
          intro_headline: string | null
          intro_subline: string | null
          logo_url: string | null
          name: string
          portal_register_url: string | null
          redirect_delay_ms: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          button_label?: string
          calendly_account_id?: string | null
          calendly_url: string
          created_at?: string
          id?: string
          intro_headline?: string | null
          intro_subline?: string | null
          logo_url?: string | null
          name: string
          portal_register_url?: string | null
          redirect_delay_ms?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          button_label?: string
          calendly_account_id?: string | null
          calendly_url?: string
          created_at?: string
          id?: string
          intro_headline?: string | null
          intro_subline?: string | null
          logo_url?: string | null
          name?: string
          portal_register_url?: string | null
          redirect_delay_ms?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_companies_calendly_account_id_fkey"
            columns: ["calendly_account_id"]
            isOneToOne: false
            referencedRelation: "calendly_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          admin_notes: string | null
          application_id: string | null
          birth_country: string | null
          birth_date: string | null
          birth_name: string | null
          birth_place: string | null
          city: string | null
          contract_signed_at: string | null
          created_at: string
          current_activity: string | null
          email_bounce_reason: string | null
          email_bounced_at: string | null
          email_status: string
          employment_start_date: string | null
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          family_status: string | null
          full_name: string
          health_insurance: string | null
          iban: string | null
          id: string
          last_reminder_sent_at: string | null
          last_seen_at: string | null
          leader_avatar_url: string | null
          leader_online: boolean | null
          leader_title: string | null
          living_since: string | null
          nationality: string | null
          onboarding_status: Database["public"]["Enums"]["onboarding_status"]
          phone: string | null
          previous_address: string | null
          signature_url: string | null
          social_security_number: string | null
          status: Database["public"]["Enums"]["employee_status"]
          street: string | null
          tax_number: string | null
          team_leader_id: string | null
          tenant_id: string | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          admin_notes?: string | null
          application_id?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_name?: string | null
          birth_place?: string | null
          city?: string | null
          contract_signed_at?: string | null
          created_at?: string
          current_activity?: string | null
          email_bounce_reason?: string | null
          email_bounced_at?: string | null
          email_status?: string
          employment_start_date?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          family_status?: string | null
          full_name: string
          health_insurance?: string | null
          iban?: string | null
          id?: string
          last_reminder_sent_at?: string | null
          last_seen_at?: string | null
          leader_avatar_url?: string | null
          leader_online?: boolean | null
          leader_title?: string | null
          living_since?: string | null
          nationality?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          previous_address?: string | null
          signature_url?: string | null
          social_security_number?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          street?: string | null
          tax_number?: string | null
          team_leader_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          admin_notes?: string | null
          application_id?: string | null
          birth_country?: string | null
          birth_date?: string | null
          birth_name?: string | null
          birth_place?: string | null
          city?: string | null
          contract_signed_at?: string | null
          created_at?: string
          current_activity?: string | null
          email_bounce_reason?: string | null
          email_bounced_at?: string | null
          email_status?: string
          employment_start_date?: string | null
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          family_status?: string | null
          full_name?: string
          health_insurance?: string | null
          iban?: string | null
          id?: string
          last_reminder_sent_at?: string | null
          last_seen_at?: string | null
          leader_avatar_url?: string | null
          leader_online?: boolean | null
          leader_title?: string | null
          living_since?: string | null
          nationality?: string | null
          onboarding_status?: Database["public"]["Enums"]["onboarding_status"]
          phone?: string | null
          previous_address?: string | null
          signature_url?: string | null
          social_security_number?: string | null
          status?: Database["public"]["Enums"]["employee_status"]
          street?: string | null
          tax_number?: string | null
          team_leader_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_log: {
        Row: {
          attempt: number
          email: string
          error: string | null
          id: string
          reminder_type: string
          sent_at: string
          status: string
          tenant_id: string | null
        }
        Insert: {
          attempt: number
          email: string
          error?: string | null
          id?: string
          reminder_type: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
        }
        Update: {
          attempt?: number
          email?: string
          error?: string | null
          id?: string
          reminder_type?: string
          sent_at?: string
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          created_at: string
          id: string
          is_active: boolean
          note: string | null
          sms_channel_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          sms_channel_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          created_at?: string
          id?: string
          is_active?: boolean
          note?: string | null
          sms_channel_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_assignments_sms_channel_id_fkey"
            columns: ["sms_channel_id"]
            isOneToOne: false
            referencedRelation: "sms_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_channels: {
        Row: {
          api_key: string | null
          api_secret: string | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          label: string
          last_test_at: string | null
          last_test_note: string | null
          last_test_ok: boolean | null
          phone_number: string
          provider: string
          rental_started_at: string | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          last_test_at?: string | null
          last_test_note?: string | null
          last_test_ok?: boolean | null
          phone_number: string
          provider?: string
          rental_started_at?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          api_key?: string | null
          api_secret?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          last_test_at?: string | null
          last_test_note?: string | null
          last_test_ok?: boolean | null
          phone_number?: string
          provider?: string
          rental_started_at?: string | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          assignment_id: string | null
          body: string
          channel_id: string | null
          created_at: string
          direction: string
          from_number: string
          id: string
          media_url: string | null
          provider_message_id: string | null
          status: string
          tenant_id: string | null
          to_number: string
          user_id: string | null
        }
        Insert: {
          assignment_id?: string | null
          body?: string
          channel_id?: string | null
          created_at?: string
          direction?: string
          from_number?: string
          id?: string
          media_url?: string | null
          provider_message_id?: string | null
          status?: string
          tenant_id?: string | null
          to_number?: string
          user_id?: string | null
        }
        Update: {
          assignment_id?: string | null
          body?: string
          channel_id?: string | null
          created_at?: string
          direction?: string
          from_number?: string
          id?: string
          media_url?: string | null
          provider_message_id?: string | null
          status?: string
          tenant_id?: string | null
          to_number?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sms_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_settings: {
        Row: {
          api_key: string
          created_at: string
          id: string
          provider: string
          updated_at: string
        }
        Insert: {
          api_key?: string
          created_at?: string
          id?: string
          provider?: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: []
      }
      step_feedback: {
        Row: {
          assignment_id: string
          block_id: string | null
          comment: string
          created_at: string
          created_by: string
          id: string
          resolved: boolean
          step_number: number
        }
        Insert: {
          assignment_id: string
          block_id?: string | null
          comment?: string
          created_at?: string
          created_by: string
          id?: string
          resolved?: boolean
          step_number: number
        }
        Update: {
          assignment_id?: string
          block_id?: string | null
          comment?: string
          created_at?: string
          created_by?: string
          id?: string
          resolved?: boolean
          step_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "step_feedback_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      submission_answers: {
        Row: {
          answer: string
          id: string
          question_id: string
          submission_id: string
        }
        Insert: {
          answer?: string
          id?: string
          question_id: string
          submission_id: string
        }
        Update: {
          answer?: string
          id?: string
          question_id?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "task_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_answers_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "task_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          reason: string
          source: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reason: string
          source?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reason?: string
          source?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppressed_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppressed_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          apinet_api_key: string | null
          apinet_model: string | null
          default_decision_prompt: string | null
          default_system_prompt: string | null
          default_voice_id: string | null
          elevenlabs_agent_id: string | null
          elevenlabs_api_key: string | null
          gemini_api_key: string | null
          gemini_model: string | null
          id: number
          openai_api_key: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          apinet_api_key?: string | null
          apinet_model?: string | null
          default_decision_prompt?: string | null
          default_system_prompt?: string | null
          default_voice_id?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          gemini_api_key?: string | null
          gemini_model?: string | null
          id?: number
          openai_api_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          apinet_api_key?: string | null
          apinet_model?: string | null
          default_decision_prompt?: string | null
          default_system_prompt?: string | null
          default_voice_id?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          gemini_api_key?: string | null
          gemini_model?: string | null
          id?: number
          openai_api_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      task_assignments: {
        Row: {
          admin_comment: string | null
          created_at: string
          id: string
          individual_case_number: string | null
          individual_email: string | null
          individual_hint: string | null
          individual_instructions: string | null
          individual_password: string | null
          individual_phone: string | null
          post_ident_pdf_name: string | null
          post_ident_pdf_url: string | null
          release_at: string | null
          sms_channel_id: string | null
          status: Database["public"]["Enums"]["task_assignment_status"]
          task_template_id: string
          updated_at: string
          user_id: string
          webid_client_name: string | null
          webid_confirmed_at: string | null
          webid_start_url: string | null
          webid_started_at: string | null
          webid_status: string
        }
        Insert: {
          admin_comment?: string | null
          created_at?: string
          id?: string
          individual_case_number?: string | null
          individual_email?: string | null
          individual_hint?: string | null
          individual_instructions?: string | null
          individual_password?: string | null
          individual_phone?: string | null
          post_ident_pdf_name?: string | null
          post_ident_pdf_url?: string | null
          release_at?: string | null
          sms_channel_id?: string | null
          status?: Database["public"]["Enums"]["task_assignment_status"]
          task_template_id: string
          updated_at?: string
          user_id: string
          webid_client_name?: string | null
          webid_confirmed_at?: string | null
          webid_start_url?: string | null
          webid_started_at?: string | null
          webid_status?: string
        }
        Update: {
          admin_comment?: string | null
          created_at?: string
          id?: string
          individual_case_number?: string | null
          individual_email?: string | null
          individual_hint?: string | null
          individual_instructions?: string | null
          individual_password?: string | null
          individual_phone?: string | null
          post_ident_pdf_name?: string | null
          post_ident_pdf_url?: string | null
          release_at?: string | null
          sms_channel_id?: string | null
          status?: Database["public"]["Enums"]["task_assignment_status"]
          task_template_id?: string
          updated_at?: string
          user_id?: string
          webid_client_name?: string | null
          webid_confirmed_at?: string | null
          webid_start_url?: string | null
          webid_started_at?: string | null
          webid_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_progress: {
        Row: {
          answers: Json
          assignment_id: string
          completed_steps: number[]
          current_step: number
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          assignment_id: string
          completed_steps?: number[]
          current_step?: number
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          assignment_id?: string
          completed_steps?: number[]
          current_step?: number
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_progress_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_questions: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          options: Json | null
          question: string
          question_type: string
          sort_order: number
          task_template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          options?: Json | null
          question: string
          question_type?: string
          sort_order?: number
          task_template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          options?: Json | null
          question?: string
          question_type?: string
          sort_order?: number
          task_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_questions_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_steps: {
        Row: {
          button_label: string
          content_blocks: Json
          created_at: string
          description: string
          id: string
          is_required: boolean
          step_number: number
          task_template_id: string
          title: string
          updated_at: string
        }
        Insert: {
          button_label?: string
          content_blocks?: Json
          created_at?: string
          description?: string
          id?: string
          is_required?: boolean
          step_number?: number
          task_template_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          button_label?: string
          content_blocks?: Json
          created_at?: string
          description?: string
          id?: string
          is_required?: boolean
          step_number?: number
          task_template_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_steps_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      task_submissions: {
        Row: {
          assignment_id: string
          created_at: string
          file_urls: string[]
          id: string
          notes: string | null
          review_comment: string | null
          review_status: string | null
          submitted_at: string
          updated_at: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          file_urls?: string[]
          id?: string
          notes?: string | null
          review_comment?: string | null
          review_status?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          file_urls?: string[]
          id?: string
          notes?: string | null
          review_comment?: string | null
          review_status?: string | null
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          compensation: number
          created_at: string
          created_by: string
          description: string
          id: string
          image_url: string | null
          instructions: string
          is_active: boolean
          is_published: boolean
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          compensation?: number
          created_at?: string
          created_by: string
          description?: string
          id?: string
          image_url?: string | null
          instructions?: string
          is_active?: boolean
          is_published?: boolean
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          compensation?: number
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          image_url?: string | null
          instructions?: string
          is_active?: boolean
          is_published?: boolean
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      tenant_default_tasks: {
        Row: {
          created_at: string
          id: string
          sort_order: number
          task_template_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sort_order: number
          task_template_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sort_order?: number
          task_template_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_default_tasks_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_default_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_default_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_smtp_health: {
        Row: {
          consecutive_fails: number
          last_fail_at: string | null
          last_fail_error: string | null
          last_verify_at: string | null
          last_verify_ok: boolean | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          consecutive_fails?: number
          last_fail_at?: string | null
          last_fail_error?: string | null
          last_verify_at?: string | null
          last_verify_ok?: boolean | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          consecutive_fails?: number
          last_fail_at?: string | null
          last_fail_error?: string | null
          last_verify_at?: string | null
          last_verify_ok?: boolean | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_smtp_health_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_smtp_health_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_enabled: boolean
          ai_escalation_keywords: string[] | null
          ai_fallback_text: string | null
          ai_faq_entries: Json | null
          ai_language_style: string | null
          ai_model: string | null
          ai_system_prompt: string | null
          allowed_employment_types: string[]
          application_received_body: string | null
          application_received_button_label: string | null
          application_received_subject: string | null
          bewerbung_magic_link_body: string | null
          bewerbung_magic_link_button: string | null
          bewerbung_magic_link_subject: string | null
          booking_confirmation_body: string | null
          booking_confirmation_button: string | null
          booking_confirmation_subject: string | null
          company_address: string | null
          company_ceo_name: string | null
          company_city: string | null
          company_contact_person: string | null
          company_email: string | null
          company_signature_url: string | null
          company_signer_name: string | null
          company_signer_title: string | null
          contract_additions: string | null
          created_at: string
          default_task_template_id: string | null
          domain: string
          domain_aliases: string[]
          email_signature: string | null
          emails_paused: boolean
          emails_paused_at: string | null
          emails_paused_by: string | null
          emails_paused_reason: string | null
          features: Json
          hero_subtitle: string
          hero_title: string
          id: string
          is_active: boolean
          landing_page_id: string | null
          logo_url: string | null
          name: string
          portal_theme: string
          primary_color: string | null
          primary_domain: string | null
          primary_domain_changed_at: string | null
          reminder_app_no_booking_body: string | null
          reminder_app_no_booking_subject: string | null
          reminder_app_no_show_body: string | null
          reminder_app_no_show_subject: string | null
          reminder_app_rebook_body: string | null
          reminder_app_rebook_subject: string | null
          reminder_app_registration_body: string | null
          reminder_app_registration_subject: string | null
          reminder_appointment_body: string | null
          reminder_appointment_subject: string | null
          reminder_chat_body: string | null
          reminder_chat_subject: string | null
          reminder_completion_body: string | null
          reminder_completion_subject: string | null
          reminder_confirm_body: string | null
          reminder_confirm_subject: string | null
          reminder_invite_body: string | null
          reminder_invite_subject: string | null
          reminder_no_booking_body: string | null
          reminder_no_booking_subject: string | null
          reminder_recovery_bewerber_body: string | null
          reminder_recovery_bewerber_subject: string | null
          reminder_recovery_body: string | null
          reminder_recovery_subject: string | null
          reply_to_email: string | null
          reset_email_body: string | null
          reset_email_subject: string | null
          sender_email: string | null
          sender_name: string | null
          smtp_debug_enabled: boolean
          smtp_health_status: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_username: string | null
          team_leader_avatar_url: string | null
          team_leader_name: string
          team_leader_online: boolean | null
          team_leader_response_time: string
          team_leader_title: string
          updated_at: string
          welcome_email_body: string | null
          welcome_email_subject: string | null
          whatsapp_number: string | null
        }
        Insert: {
          ai_enabled?: boolean
          ai_escalation_keywords?: string[] | null
          ai_fallback_text?: string | null
          ai_faq_entries?: Json | null
          ai_language_style?: string | null
          ai_model?: string | null
          ai_system_prompt?: string | null
          allowed_employment_types?: string[]
          application_received_body?: string | null
          application_received_button_label?: string | null
          application_received_subject?: string | null
          bewerbung_magic_link_body?: string | null
          bewerbung_magic_link_button?: string | null
          bewerbung_magic_link_subject?: string | null
          booking_confirmation_body?: string | null
          booking_confirmation_button?: string | null
          booking_confirmation_subject?: string | null
          company_address?: string | null
          company_ceo_name?: string | null
          company_city?: string | null
          company_contact_person?: string | null
          company_email?: string | null
          company_signature_url?: string | null
          company_signer_name?: string | null
          company_signer_title?: string | null
          contract_additions?: string | null
          created_at?: string
          default_task_template_id?: string | null
          domain: string
          domain_aliases?: string[]
          email_signature?: string | null
          emails_paused?: boolean
          emails_paused_at?: string | null
          emails_paused_by?: string | null
          emails_paused_reason?: string | null
          features?: Json
          hero_subtitle?: string
          hero_title?: string
          id?: string
          is_active?: boolean
          landing_page_id?: string | null
          logo_url?: string | null
          name: string
          portal_theme?: string
          primary_color?: string | null
          primary_domain?: string | null
          primary_domain_changed_at?: string | null
          reminder_app_no_booking_body?: string | null
          reminder_app_no_booking_subject?: string | null
          reminder_app_no_show_body?: string | null
          reminder_app_no_show_subject?: string | null
          reminder_app_rebook_body?: string | null
          reminder_app_rebook_subject?: string | null
          reminder_app_registration_body?: string | null
          reminder_app_registration_subject?: string | null
          reminder_appointment_body?: string | null
          reminder_appointment_subject?: string | null
          reminder_chat_body?: string | null
          reminder_chat_subject?: string | null
          reminder_completion_body?: string | null
          reminder_completion_subject?: string | null
          reminder_confirm_body?: string | null
          reminder_confirm_subject?: string | null
          reminder_invite_body?: string | null
          reminder_invite_subject?: string | null
          reminder_no_booking_body?: string | null
          reminder_no_booking_subject?: string | null
          reminder_recovery_bewerber_body?: string | null
          reminder_recovery_bewerber_subject?: string | null
          reminder_recovery_body?: string | null
          reminder_recovery_subject?: string | null
          reply_to_email?: string | null
          reset_email_body?: string | null
          reset_email_subject?: string | null
          sender_email?: string | null
          sender_name?: string | null
          smtp_debug_enabled?: boolean
          smtp_health_status?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          team_leader_avatar_url?: string | null
          team_leader_name?: string
          team_leader_online?: boolean | null
          team_leader_response_time?: string
          team_leader_title?: string
          updated_at?: string
          welcome_email_body?: string | null
          welcome_email_subject?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          ai_enabled?: boolean
          ai_escalation_keywords?: string[] | null
          ai_fallback_text?: string | null
          ai_faq_entries?: Json | null
          ai_language_style?: string | null
          ai_model?: string | null
          ai_system_prompt?: string | null
          allowed_employment_types?: string[]
          application_received_body?: string | null
          application_received_button_label?: string | null
          application_received_subject?: string | null
          bewerbung_magic_link_body?: string | null
          bewerbung_magic_link_button?: string | null
          bewerbung_magic_link_subject?: string | null
          booking_confirmation_body?: string | null
          booking_confirmation_button?: string | null
          booking_confirmation_subject?: string | null
          company_address?: string | null
          company_ceo_name?: string | null
          company_city?: string | null
          company_contact_person?: string | null
          company_email?: string | null
          company_signature_url?: string | null
          company_signer_name?: string | null
          company_signer_title?: string | null
          contract_additions?: string | null
          created_at?: string
          default_task_template_id?: string | null
          domain?: string
          domain_aliases?: string[]
          email_signature?: string | null
          emails_paused?: boolean
          emails_paused_at?: string | null
          emails_paused_by?: string | null
          emails_paused_reason?: string | null
          features?: Json
          hero_subtitle?: string
          hero_title?: string
          id?: string
          is_active?: boolean
          landing_page_id?: string | null
          logo_url?: string | null
          name?: string
          portal_theme?: string
          primary_color?: string | null
          primary_domain?: string | null
          primary_domain_changed_at?: string | null
          reminder_app_no_booking_body?: string | null
          reminder_app_no_booking_subject?: string | null
          reminder_app_no_show_body?: string | null
          reminder_app_no_show_subject?: string | null
          reminder_app_rebook_body?: string | null
          reminder_app_rebook_subject?: string | null
          reminder_app_registration_body?: string | null
          reminder_app_registration_subject?: string | null
          reminder_appointment_body?: string | null
          reminder_appointment_subject?: string | null
          reminder_chat_body?: string | null
          reminder_chat_subject?: string | null
          reminder_completion_body?: string | null
          reminder_completion_subject?: string | null
          reminder_confirm_body?: string | null
          reminder_confirm_subject?: string | null
          reminder_invite_body?: string | null
          reminder_invite_subject?: string | null
          reminder_no_booking_body?: string | null
          reminder_no_booking_subject?: string | null
          reminder_recovery_bewerber_body?: string | null
          reminder_recovery_bewerber_subject?: string | null
          reminder_recovery_body?: string | null
          reminder_recovery_subject?: string | null
          reply_to_email?: string | null
          reset_email_body?: string | null
          reset_email_subject?: string | null
          sender_email?: string | null
          sender_name?: string | null
          smtp_debug_enabled?: boolean
          smtp_health_status?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          team_leader_avatar_url?: string | null
          team_leader_name?: string
          team_leader_online?: boolean | null
          team_leader_response_time?: string
          team_leader_title?: string
          updated_at?: string
          welcome_email_body?: string | null
          welcome_email_subject?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_landing_page_id_fkey"
            columns: ["landing_page_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slots: {
        Row: {
          created_at: string
          created_by: string
          end_time: string
          id: string
          max_participants: number
          slot_date: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          end_time: string
          id?: string
          max_participants?: number
          slot_date: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          end_time?: string
          id?: string
          max_participants?: number
          slot_date?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_transactions: {
        Row: {
          amount: number
          assignment_id: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["transaction_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          assignment_id: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          assignment_id?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["transaction_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_transactions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "task_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      tenants_public: {
        Row: {
          ai_enabled: boolean | null
          company_address: string | null
          company_ceo_name: string | null
          company_city: string | null
          company_signature_url: string | null
          domain: string | null
          domain_aliases: string[] | null
          features: Json | null
          hero_subtitle: string | null
          hero_title: string | null
          id: string | null
          is_active: boolean | null
          logo_url: string | null
          name: string | null
          portal_theme: string | null
          primary_color: string | null
          team_leader_avatar_url: string | null
          team_leader_name: string | null
          team_leader_online: boolean | null
          team_leader_response_time: string | null
          team_leader_title: string | null
          whatsapp_number: string | null
        }
        Insert: {
          ai_enabled?: boolean | null
          company_address?: string | null
          company_ceo_name?: string | null
          company_city?: string | null
          company_signature_url?: string | null
          domain?: string | null
          domain_aliases?: string[] | null
          features?: Json | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          name?: string | null
          portal_theme?: string | null
          primary_color?: string | null
          team_leader_avatar_url?: string | null
          team_leader_name?: string | null
          team_leader_online?: boolean | null
          team_leader_response_time?: string | null
          team_leader_title?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          ai_enabled?: boolean | null
          company_address?: string | null
          company_ceo_name?: string | null
          company_city?: string | null
          company_signature_url?: string | null
          domain?: string | null
          domain_aliases?: string[] | null
          features?: Json | null
          hero_subtitle?: string | null
          hero_title?: string | null
          id?: string | null
          is_active?: boolean | null
          logo_url?: string | null
          name?: string | null
          portal_theme?: string | null
          primary_color?: string | null
          team_leader_avatar_url?: string | null
          team_leader_name?: string | null
          team_leader_online?: boolean | null
          team_leader_response_time?: string | null
          team_leader_title?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      v_application_email_routing: {
        Row: {
          application_id: string | null
          broker_smtp_ok: boolean | null
          broker_tenant_id: string | null
          broker_tenant_name: string | null
          created_at: string | null
          email: string | null
          fasttrack_smtp_ok: boolean | null
          fasttrack_tenant_id: string | null
          fasttrack_tenant_name: string | null
          flow_type: string | null
          full_name: string | null
          legacy_tenant_id: string | null
          source_landing_id: string | null
          target_landing_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_broker_tenant_id_fkey"
            columns: ["broker_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_broker_tenant_id_fkey"
            columns: ["broker_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_fasttrack_tenant_id_fkey"
            columns: ["fasttrack_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_fasttrack_tenant_id_fkey"
            columns: ["fasttrack_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_source_landing_id_fkey"
            columns: ["source_landing_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_target_landing_id_fkey"
            columns: ["target_landing_id"]
            isOneToOne: false
            referencedRelation: "landing_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_tenant_id_fkey"
            columns: ["legacy_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_tenant_id_fkey"
            columns: ["legacy_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_delete_user_cascade: {
        Args: { _actor_id: string; _user_id: string }
        Returns: undefined
      }
      admin_get_email_confirmations: {
        Args: never
        Returns: {
          email_confirmed: boolean
          user_id: string
        }[]
      }
      admin_get_user_contact: {
        Args: { _user_id: string }
        Returns: {
          email: string
          phone: string
        }[]
      }
      advance_application_stage: {
        Args: {
          _actor_id?: string
          _application_id: string
          _force?: boolean
          _reason?: string
          _to_stage: string
        }
        Returns: string
      }
      auto_complete_and_noshow_appointments: { Args: never; Returns: Json }
      auto_timeout_stale_interviews: { Args: never; Returns: number }
      book_appointment_by_token: {
        Args: {
          _applicant_timezone?: string
          _magic_token: string
          _starts_at: string
        }
        Returns: {
          appointment_id: string
          cancel_token: string
          ends_at: string
          error: string
          starts_at: string
        }[]
      }
      cancel_appointment_by_token: {
        Args: { _cancel_token: string; _reason?: string }
        Returns: {
          application_magic_token: string
          error: string
          ok: boolean
        }[]
      }
      consume_invitation_token: { Args: { _token: string }; Returns: undefined }
      get_application_by_magic_token: {
        Args: { _token: string }
        Returns: {
          application_id: string
          email: string
          full_name: string
          status: string
          tenant_id: string
        }[]
      }
      get_appointment_by_cancel_token: {
        Args: { _cancel_token: string }
        Returns: {
          applicant_email: string
          applicant_first_name: string
          application_magic_token: string
          appointment_id: string
          ends_at: string
          starts_at: string
          status: string
          tenant_name: string
        }[]
      }
      get_chat_thread_summaries: {
        Args: { _admin_id: string }
        Returns: {
          full_name: string
          last_at: string
          last_message: string
          unread: number
          user_id: string
        }[]
      }
      get_first_active_public_tenant: {
        Args: never
        Returns: {
          ai_enabled: boolean | null
          company_address: string | null
          company_ceo_name: string | null
          company_city: string | null
          company_signature_url: string | null
          domain: string | null
          domain_aliases: string[] | null
          features: Json | null
          hero_subtitle: string | null
          hero_title: string | null
          id: string | null
          is_active: boolean | null
          logo_url: string | null
          name: string | null
          portal_theme: string | null
          primary_color: string | null
          team_leader_avatar_url: string | null
          team_leader_name: string | null
          team_leader_online: boolean | null
          team_leader_response_time: string | null
          team_leader_title: string | null
          whatsapp_number: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenants_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_free_appointment_slots: {
        Args: { _from_date: string; _schedule_id: string; _to_date: string }
        Returns: {
          slot_end: string
          slot_start: string
        }[]
      }
      get_last_sign_ins: {
        Args: { _user_ids: string[] }
        Returns: {
          last_sign_in_at: string
          user_id: string
        }[]
      }
      get_my_sms_assignments: {
        Args: never
        Returns: {
          assigned_at: string
          assignment_id: string
          channel_id: string
          channel_is_active: boolean
          is_active: boolean
          label: string
          note: string
          phone_number: string
          provider: string
        }[]
      }
      get_public_tenant_by_domain: {
        Args: { _domain: string }
        Returns: {
          ai_enabled: boolean | null
          company_address: string | null
          company_ceo_name: string | null
          company_city: string | null
          company_signature_url: string | null
          domain: string | null
          domain_aliases: string[] | null
          features: Json | null
          hero_subtitle: string | null
          hero_title: string | null
          id: string | null
          is_active: boolean | null
          logo_url: string | null
          name: string | null
          portal_theme: string | null
          primary_color: string | null
          team_leader_avatar_url: string | null
          team_leader_name: string | null
          team_leader_online: boolean | null
          team_leader_response_time: string | null
          team_leader_title: string | null
          whatsapp_number: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tenants_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_schedule_for_application: {
        Args: { _magic_token: string }
        Returns: {
          applicant_email: string
          applicant_first_name: string
          booking_window_days: number
          event_description: string
          landing_page_id: string
          max_days_ahead: number
          min_notice_hours: number
          recruiter_name: string
          schedule_id: string
          slot_duration_minutes: number
          tenant_name: string
          timezone: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_staff: { Args: { _user_id: string }; Returns: boolean }
      validate_invitation_token: {
        Args: { _token: string }
        Returns: {
          application_id: string
          email: string
          tenant_id: string
          used: boolean
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user" | "admin_mitarbeiter"
      booking_status: "gebucht" | "bestätigt" | "abgeschlossen" | "storniert"
      document_category: "identitaet" | "auftrag" | "sonstiges"
      document_status: "hochgeladen" | "geprueft" | "abgelehnt"
      employee_status:
        | "registriert"
        | "angenommen"
        | "abgelehnt"
        | "deaktiviert"
      employment_type: "minijob" | "teilzeit" | "vollzeit"
      kyc_status:
        | "nicht_gestartet"
        | "eingereicht"
        | "in_pruefung"
        | "verifiziert"
        | "abgelehnt"
      landing_booking_mode: "calendly" | "internal"
      onboarding_status: "nicht_gestartet" | "in_bearbeitung" | "abgeschlossen"
      task_assignment_status:
        | "entwurf"
        | "zugewiesen"
        | "geplant"
        | "in_bearbeitung"
        | "eingereicht"
        | "in_pruefung"
        | "genehmigt"
        | "abgelehnt"
        | "nachbesserung"
        | "abgeschlossen"
      transaction_status:
        | "ausstehend"
        | "gutgeschrieben"
        | "genehmigt"
        | "ausgezahlt"
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
      app_role: ["admin", "user", "admin_mitarbeiter"],
      booking_status: ["gebucht", "bestätigt", "abgeschlossen", "storniert"],
      document_category: ["identitaet", "auftrag", "sonstiges"],
      document_status: ["hochgeladen", "geprueft", "abgelehnt"],
      employee_status: [
        "registriert",
        "angenommen",
        "abgelehnt",
        "deaktiviert",
      ],
      employment_type: ["minijob", "teilzeit", "vollzeit"],
      kyc_status: [
        "nicht_gestartet",
        "eingereicht",
        "in_pruefung",
        "verifiziert",
        "abgelehnt",
      ],
      landing_booking_mode: ["calendly", "internal"],
      onboarding_status: ["nicht_gestartet", "in_bearbeitung", "abgeschlossen"],
      task_assignment_status: [
        "entwurf",
        "zugewiesen",
        "geplant",
        "in_bearbeitung",
        "eingereicht",
        "in_pruefung",
        "genehmigt",
        "abgelehnt",
        "nachbesserung",
        "abgeschlossen",
      ],
      transaction_status: [
        "ausstehend",
        "gutgeschrieben",
        "genehmigt",
        "ausgezahlt",
      ],
    },
  },
} as const
