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
    PostgrestVersion: "14.4"
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
      admin_action_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string | null
          id: string
          payload: Json | null
          volunteer_id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string | null
          id?: string
          payload?: Json | null
          volunteer_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string | null
          id?: string
          payload?: Json | null
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_log_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_action_log_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_mfa_resets: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          reset_by: string
          reset_method: string
          target_email: string
          target_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          reset_by: string
          reset_method?: string
          target_email: string
          target_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          reset_by?: string
          reset_method?: string
          target_email?: string
          target_user_id?: string
        }
        Relationships: []
      }
      confirmation_reminders: {
        Row: {
          booking_id: string
          id: string
          recipient_id: string
          recipient_type: Database["public"]["Enums"]["reminder_recipient"]
          reminder_number: number
          sent_at: string
        }
        Insert: {
          booking_id: string
          id?: string
          recipient_id: string
          recipient_type: Database["public"]["Enums"]["reminder_recipient"]
          reminder_number?: number
          sent_at?: string
        }
        Update: {
          booking_id?: string
          id?: string
          recipient_id?: string
          recipient_type?: Database["public"]["Enums"]["reminder_recipient"]
          reminder_number?: number
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confirmation_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "shift_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmation_reminders_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          cleared_at: string | null
          conversation_id: string
          id: string
          is_archived: boolean
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          cleared_at?: string | null
          conversation_id: string
          id?: string
          is_archived?: boolean
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          cleared_at?: string | null
          conversation_id?: string
          id?: string
          is_archived?: boolean
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          conversation_type: string
          created_at: string
          created_by: string
          department_id: string | null
          id: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          conversation_type?: string
          created_at?: string
          created_by: string
          department_id?: string | null
          id?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          conversation_type?: string
          created_at?: string
          created_by?: string
          department_id?: string | null
          id?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_coordinators: {
        Row: {
          assigned_at: string
          coordinator_id: string
          department_id: string
        }
        Insert: {
          assigned_at?: string
          coordinator_id: string
          department_id: string
        }
        Update: {
          assigned_at?: string
          coordinator_id?: string
          department_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_coordinators_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_coordinators_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      department_restrictions: {
        Row: {
          created_at: string
          department_id: string
          id: string
          reason: string | null
          restricted_by: string
          volunteer_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          reason?: string | null
          restricted_by: string
          volunteer_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          reason?: string | null
          restricted_by?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_restrictions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_restrictions_restricted_by_fkey"
            columns: ["restricted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_restrictions_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          allows_groups: boolean
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          location_id: string
          min_age: number
          name: string
          requires_bg_check: boolean
        }
        Insert: {
          allows_groups?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          min_age?: number
          name: string
          requires_bg_check?: boolean
        }
        Update: {
          allows_groups?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          min_age?: number
          name?: string
          requires_bg_check?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "departments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          expiry_days: number | null
          has_expiry: boolean
          id: string
          is_active: boolean
          is_required: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          expiry_days?: number | null
          has_expiry?: boolean
          id?: string
          is_active?: boolean
          is_required?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          expiry_days?: number | null
          has_expiry?: boolean
          id?: string
          is_active?: boolean
          is_required?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_registrations: {
        Row: {
          event_id: string
          id: string
          registered_at: string
          volunteer_id: string
        }
        Insert: {
          event_id: string
          id?: string
          registered_at?: string
          volunteer_id: string
        }
        Update: {
          event_id?: string
          id?: string
          registered_at?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          end_time: string | null
          event_date: string
          id: string
          is_active: boolean
          location: string | null
          max_attendees: number | null
          requires_bg_check: boolean
          start_time: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          end_time?: string | null
          event_date: string
          id?: string
          is_active?: boolean
          location?: string | null
          max_attendees?: number | null
          requires_bg_check?: boolean
          start_time?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          end_time?: string | null
          event_date?: string
          id?: string
          is_active?: boolean
          location?: string | null
          max_attendees?: number | null
          requires_bg_check?: boolean
          start_time?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          state: string | null
          timezone: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          state?: string | null
          timezone?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          state?: string | null
          timezone?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_backup_codes: {
        Row: {
          code_hash: string
          created_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mfa_backup_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          is_read: boolean
          link: string | null
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parental_consents: {
        Row: {
          consent_given_at: string | null
          consent_method: string
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          parent_email: string
          parent_name: string
          parent_phone: string | null
          updated_at: string
          volunteer_id: string
        }
        Insert: {
          consent_given_at?: string | null
          consent_method?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          parent_email: string
          parent_name: string
          parent_phone?: string | null
          updated_at?: string
          volunteer_id: string
        }
        Update: {
          consent_given_at?: string | null
          consent_method?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          parent_email?: string
          parent_name?: string
          parent_phone?: string | null
          updated_at?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parental_consents_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      private_note_access_log: {
        Row: {
          access_reason: string
          accessed_at: string
          admin_user_id: string
          id: string
          note_id: string
          volunteer_id: string
        }
        Insert: {
          access_reason: string
          accessed_at?: string
          admin_user_id: string
          id?: string
          note_id: string
          volunteer_id: string
        }
        Update: {
          access_reason?: string
          accessed_at?: string
          admin_user_id?: string
          id?: string
          note_id?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "private_note_access_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "private_note_access_log_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bg_check_expires_at: string | null
          bg_check_status: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at: string | null
          booking_privileges: boolean
          calendar_token: string | null
          consistency_score: number | null
          created_at: string
          date_of_birth: string | null
          email: string
          emergency_contact: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          extended_booking: boolean
          full_name: string
          id: string
          is_active: boolean
          is_minor: boolean
          location_id: string | null
          messaging_blocked: boolean
          notif_booking_changes: boolean | null
          notif_document_expiry: boolean | null
          notif_email: boolean
          notif_in_app: boolean
          notif_milestone: boolean | null
          notif_new_messages: boolean | null
          notif_shift_reminders: boolean | null
          notif_sms: boolean
          onboarding_complete: boolean
          phone: string | null
          phone_verified: boolean
          role: Database["public"]["Enums"]["user_role"]
          signin_count: number
          tos_accepted_at: string | null
          total_hours: number
          updated_at: string
          username: string | null
          volunteer_points: number | null
        }
        Insert: {
          avatar_url?: string | null
          bg_check_expires_at?: string | null
          bg_check_status?: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at?: string | null
          booking_privileges?: boolean
          calendar_token?: string | null
          consistency_score?: number | null
          created_at?: string
          date_of_birth?: string | null
          email: string
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          extended_booking?: boolean
          full_name: string
          id: string
          is_active?: boolean
          is_minor?: boolean
          location_id?: string | null
          messaging_blocked?: boolean
          notif_booking_changes?: boolean | null
          notif_document_expiry?: boolean | null
          notif_email?: boolean
          notif_in_app?: boolean
          notif_milestone?: boolean | null
          notif_new_messages?: boolean | null
          notif_shift_reminders?: boolean | null
          notif_sms?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          phone_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          signin_count?: number
          tos_accepted_at?: string | null
          total_hours?: number
          updated_at?: string
          username?: string | null
          volunteer_points?: number | null
        }
        Update: {
          avatar_url?: string | null
          bg_check_expires_at?: string | null
          bg_check_status?: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at?: string | null
          booking_privileges?: boolean
          calendar_token?: string | null
          consistency_score?: number | null
          created_at?: string
          date_of_birth?: string | null
          email?: string
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          extended_booking?: boolean
          full_name?: string
          id?: string
          is_active?: boolean
          is_minor?: boolean
          location_id?: string | null
          messaging_blocked?: boolean
          notif_booking_changes?: boolean | null
          notif_document_expiry?: boolean | null
          notif_email?: boolean
          notif_in_app?: boolean
          notif_milestone?: boolean | null
          notif_new_messages?: boolean | null
          notif_shift_reminders?: boolean | null
          notif_sms?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          phone_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          signin_count?: number
          tos_accepted_at?: string | null
          total_hours?: number
          updated_at?: string
          username?: string | null
          volunteer_points?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          note_id: string
          storage_path: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          note_id: string
          storage_path: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          note_id?: string
          storage_path?: string
          uploader_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_attachments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "shift_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_attachments_uploader_id_fkey"
            columns: ["uploader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_booking_slots: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          slot_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          slot_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_booking_slots_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "shift_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_booking_slots_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "shift_time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_bookings: {
        Row: {
          booking_status: Database["public"]["Enums"]["booking_status"]
          cancelled_at: string | null
          checked_in_at: string | null
          confirmation_status: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at: string | null
          confirmed_by: string | null
          coordinator_reported_hours: number | null
          counted_in_consistency: boolean
          created_at: string
          final_hours: number | null
          group_name: string | null
          group_size: number | null
          hours_source: string | null
          id: string
          is_group_booking: boolean
          late_cancel_notified: boolean
          promoted_at: string | null
          shift_id: string
          time_slot_id: string | null
          updated_at: string
          volunteer_id: string
          volunteer_reported_hours: number | null
          waitlist_offer_expires_at: string | null
        }
        Insert: {
          booking_status?: Database["public"]["Enums"]["booking_status"]
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmation_status?: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          coordinator_reported_hours?: number | null
          counted_in_consistency?: boolean
          created_at?: string
          final_hours?: number | null
          group_name?: string | null
          group_size?: number | null
          hours_source?: string | null
          id?: string
          is_group_booking?: boolean
          late_cancel_notified?: boolean
          promoted_at?: string | null
          shift_id: string
          time_slot_id?: string | null
          updated_at?: string
          volunteer_id: string
          volunteer_reported_hours?: number | null
          waitlist_offer_expires_at?: string | null
        }
        Update: {
          booking_status?: Database["public"]["Enums"]["booking_status"]
          cancelled_at?: string | null
          checked_in_at?: string | null
          confirmation_status?: Database["public"]["Enums"]["confirmation_status"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          coordinator_reported_hours?: number | null
          counted_in_consistency?: boolean
          created_at?: string
          final_hours?: number | null
          group_name?: string | null
          group_size?: number | null
          hours_source?: string | null
          id?: string
          is_group_booking?: boolean
          late_cancel_notified?: boolean
          promoted_at?: string | null
          shift_id?: string
          time_slot_id?: string | null
          updated_at?: string
          volunteer_id?: string
          volunteer_reported_hours?: number | null
          waitlist_offer_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_bookings_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bookings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "shift_bookings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bookings_time_slot_id_fkey"
            columns: ["time_slot_id"]
            isOneToOne: false
            referencedRelation: "shift_time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bookings_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_invitations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invite_email: string
          invite_name: string | null
          invited_by: string
          shift_id: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_email: string
          invite_name?: string | null
          invited_by: string
          shift_id: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_email?: string
          invite_name?: string | null
          invited_by?: string
          shift_id?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_invitations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "shift_invitations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_notes: {
        Row: {
          author_id: string
          booking_id: string
          content: string
          created_at: string
          id: string
          is_locked: boolean
          updated_at: string
        }
        Insert: {
          author_id: string
          booking_id: string
          content: string
          created_at?: string
          id?: string
          is_locked?: boolean
          updated_at?: string
        }
        Update: {
          author_id?: string
          booking_id?: string
          content?: string
          created_at?: string
          id?: string
          is_locked?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "shift_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_recurrence_rules: {
        Row: {
          allows_group: boolean
          created_at: string
          created_by: string
          department_id: string
          description: string | null
          end_date: string
          end_time: string | null
          id: string
          is_active: boolean
          recurrence_type: Database["public"]["Enums"]["recurrence_type"]
          requires_bg_check: boolean
          start_date: string
          start_time: string | null
          time_type: Database["public"]["Enums"]["shift_time_type"]
          title: string
          total_slots: number
        }
        Insert: {
          allows_group?: boolean
          created_at?: string
          created_by: string
          department_id: string
          description?: string | null
          end_date: string
          end_time?: string | null
          id?: string
          is_active?: boolean
          recurrence_type: Database["public"]["Enums"]["recurrence_type"]
          requires_bg_check?: boolean
          start_date: string
          start_time?: string | null
          time_type?: Database["public"]["Enums"]["shift_time_type"]
          title: string
          total_slots?: number
        }
        Update: {
          allows_group?: boolean
          created_at?: string
          created_by?: string
          department_id?: string
          description?: string | null
          end_date?: string
          end_time?: string | null
          id?: string
          is_active?: boolean
          recurrence_type?: Database["public"]["Enums"]["recurrence_type"]
          requires_bg_check?: boolean
          start_date?: string
          start_time?: string | null
          time_type?: Database["public"]["Enums"]["shift_time_type"]
          title?: string
          total_slots?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_recurrence_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_recurrence_rules_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_time_slots: {
        Row: {
          booked_slots: number
          created_at: string
          id: string
          shift_id: string
          slot_end: string
          slot_start: string
          total_slots: number
        }
        Insert: {
          booked_slots?: number
          created_at?: string
          id?: string
          shift_id: string
          slot_end: string
          slot_start: string
          total_slots?: number
        }
        Update: {
          booked_slots?: number
          created_at?: string
          id?: string
          shift_id?: string
          slot_end?: string
          slot_start?: string
          total_slots?: number
        }
        Relationships: [
          {
            foreignKeyName: "shift_time_slots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "shift_time_slots_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          allows_group: boolean
          booked_slots: number
          coordinator_note: string | null
          created_at: string
          created_by: string
          department_id: string
          description: string | null
          end_time: string | null
          id: string
          is_recurring: boolean
          max_group_size: number | null
          note_updated_at: string | null
          recurrence_parent: string | null
          recurrence_rule: string | null
          requires_bg_check: boolean
          shift_date: string
          start_time: string | null
          status: Database["public"]["Enums"]["shift_status"]
          time_type: Database["public"]["Enums"]["shift_time_type"]
          title: string
          total_slots: number
          updated_at: string
        }
        Insert: {
          allows_group?: boolean
          booked_slots?: number
          coordinator_note?: string | null
          created_at?: string
          created_by: string
          department_id: string
          description?: string | null
          end_time?: string | null
          id?: string
          is_recurring?: boolean
          max_group_size?: number | null
          note_updated_at?: string | null
          recurrence_parent?: string | null
          recurrence_rule?: string | null
          requires_bg_check?: boolean
          shift_date: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          time_type?: Database["public"]["Enums"]["shift_time_type"]
          title: string
          total_slots?: number
          updated_at?: string
        }
        Update: {
          allows_group?: boolean
          booked_slots?: number
          coordinator_note?: string | null
          created_at?: string
          created_by?: string
          department_id?: string
          description?: string | null
          end_time?: string | null
          id?: string
          is_recurring?: boolean
          max_group_size?: number | null
          note_updated_at?: string | null
          recurrence_parent?: string | null
          recurrence_rule?: string | null
          requires_bg_check?: boolean
          shift_date?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          time_type?: Database["public"]["Enums"]["shift_time_type"]
          title?: string
          total_slots?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_recurrence_parent_fkey"
            columns: ["recurrence_parent"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "shifts_recurrence_parent_fkey"
            columns: ["recurrence_parent"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_documents: {
        Row: {
          document_type_id: string
          expires_at: string | null
          file_name: string
          file_size: number | null
          file_type: string
          id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          storage_path: string
          updated_at: string
          uploaded_at: string
          volunteer_id: string
        }
        Insert: {
          document_type_id: string
          expires_at?: string | null
          file_name: string
          file_size?: number | null
          file_type: string
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path: string
          updated_at?: string
          uploaded_at?: string
          volunteer_id: string
        }
        Update: {
          document_type_id?: string
          expires_at?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
          uploaded_at?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_documents_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_preferences: {
        Row: {
          avg_advance_booking_days: number
          day_of_week_affinity: Json
          department_affinity: Json
          reliability_alpha: number
          reliability_beta: number
          time_of_day_affinity: Json
          total_interactions: number
          updated_at: string
          volunteer_id: string
        }
        Insert: {
          avg_advance_booking_days?: number
          day_of_week_affinity?: Json
          department_affinity?: Json
          reliability_alpha?: number
          reliability_beta?: number
          time_of_day_affinity?: Json
          total_interactions?: number
          updated_at?: string
          volunteer_id: string
        }
        Update: {
          avg_advance_booking_days?: number
          day_of_week_affinity?: Json
          department_affinity?: Json
          reliability_alpha?: number
          reliability_beta?: number
          time_of_day_affinity?: Json
          total_interactions?: number
          updated_at?: string
          volunteer_id?: string
        }
        Relationships: []
      }
      volunteer_private_notes: {
        Row: {
          content: string
          created_at: string
          department_id: string | null
          id: string
          is_locked: boolean
          shift_id: string | null
          title: string | null
          updated_at: string
          volunteer_id: string
        }
        Insert: {
          content: string
          created_at?: string
          department_id?: string | null
          id?: string
          is_locked?: boolean
          shift_id?: string | null
          title?: string | null
          updated_at?: string
          volunteer_id: string
        }
        Update: {
          content?: string
          created_at?: string
          department_id?: string | null
          id?: string
          is_locked?: boolean
          shift_id?: string | null
          title?: string | null
          updated_at?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_private_notes_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_private_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "volunteer_private_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_private_notes_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_shift_interactions: {
        Row: {
          created_at: string
          id: string
          interaction_type: Database["public"]["Enums"]["interaction_type"]
          shift_id: string
          volunteer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interaction_type: Database["public"]["Enums"]["interaction_type"]
          shift_id: string
          volunteer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interaction_type?: Database["public"]["Enums"]["interaction_type"]
          shift_id?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_shift_interactions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_fill_rates"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "volunteer_shift_interactions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_shift_reports: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          reminder_sent_at: string | null
          self_confirm_status: Database["public"]["Enums"]["self_confirm_status"]
          self_reported_hours: number | null
          shift_feedback: string | null
          star_rating: number | null
          submitted_at: string | null
          updated_at: string
          volunteer_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          reminder_sent_at?: string | null
          self_confirm_status?: Database["public"]["Enums"]["self_confirm_status"]
          self_reported_hours?: number | null
          shift_feedback?: string | null
          star_rating?: number | null
          submitted_at?: string | null
          updated_at?: string
          volunteer_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          reminder_sent_at?: string | null
          self_confirm_status?: Database["public"]["Enums"]["self_confirm_status"]
          self_reported_hours?: number | null
          shift_feedback?: string | null
          star_rating?: number | null
          submitted_at?: string | null
          updated_at?: string
          volunteer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_shift_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "shift_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_shift_reports_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      shift_fill_rates: {
        Row: {
          booked_slots: number | null
          day_of_week: number | null
          department_id: string | null
          fill_ratio: number | null
          shift_date: string | null
          shift_id: string | null
          time_type: Database["public"]["Enums"]["shift_time_type"] | null
          total_slots: number | null
        }
        Insert: {
          booked_slots?: number | null
          day_of_week?: never
          department_id?: string | null
          fill_ratio?: never
          shift_date?: string | null
          shift_id?: string | null
          time_type?: Database["public"]["Enums"]["shift_time_type"] | null
          total_slots?: number | null
        }
        Update: {
          booked_slots?: number | null
          day_of_week?: never
          department_id?: string | null
          fill_ratio?: never
          shift_date?: string | null
          shift_id?: string | null
          time_type?: Database["public"]["Enums"]["shift_time_type"] | null
          total_slots?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      volunteer_shift_reports_safe: {
        Row: {
          booking_id: string | null
          created_at: string | null
          id: string | null
          reminder_sent_at: string | null
          self_confirm_status:
            | Database["public"]["Enums"]["self_confirm_status"]
            | null
          self_reported_hours: number | null
          submitted_at: string | null
          updated_at: string | null
          volunteer_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          id?: string | null
          reminder_sent_at?: string | null
          self_confirm_status?:
            | Database["public"]["Enums"]["self_confirm_status"]
            | null
          self_reported_hours?: number | null
          submitted_at?: string | null
          updated_at?: string | null
          volunteer_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          id?: string | null
          reminder_sent_at?: string | null
          self_confirm_status?:
            | Database["public"]["Enums"]["self_confirm_status"]
            | null
          self_reported_hours?: number | null
          submitted_at?: string | null
          updated_at?: string | null
          volunteer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_shift_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "shift_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "volunteer_shift_reports_volunteer_id_fkey"
            columns: ["volunteer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_action_off_shift: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      admin_break_glass_read_notes: {
        Args: { reason: string; target_volunteer_id: string }
        Returns: Json
      }
      admin_delete_unactioned_shift: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      admin_emergency_mfa_reset: {
        Args: { target_email: string }
        Returns: Json
      }
      admin_update_shift_hours: {
        Args: { p_booking_id: string; p_hours: number }
        Returns: undefined
      }
      export_critical_data: { Args: never; Returns: Json }
      get_department_report: {
        Args: { date_from: string; date_to: string; dept_uuids: string[] }
        Returns: {
          attendance_rate: number
          avg_fill_rate: number
          avg_rating: number
          department_id: string
          department_name: string
          rated_shift_count: number
          total_cancellations: number
          total_confirmed: number
          total_no_shows: number
          total_shifts: number
          total_waitlisted: number
        }[]
      }
      get_email_by_username: { Args: { p_username: string }; Returns: string }
      get_shift_consistency: {
        Args: { shift_uuids: string[] }
        Returns: {
          attendance_rate: number
          attended: number
          cancelled: number
          no_shows: number
          shift_id: string
          total_bookings: number
        }[]
      }
      get_shift_popularity: {
        Args: { shift_uuids: string[] }
        Returns: {
          confirmed_count: number
          fill_ratio: number
          popularity_score: number
          shift_id: string
          view_count: number
          waitlist_count: number
        }[]
      }
      get_shift_rating_aggregates: {
        Args: { shift_uuids: string[] }
        Returns: {
          avg_rating: number
          rating_count: number
          shift_id: string
        }[]
      }
      get_unactioned_shifts: {
        Args: never
        Returns: {
          actioned_off: boolean
          booking_id: string
          checked_in: boolean
          department_name: string
          hours_since_end: number
          shift_date: string
          shift_end: string
          shift_id: string
          shift_title: string
          volunteer_email: string
          volunteer_id: string
          volunteer_name: string
        }[]
      }
      get_unread_conversation_count: { Args: never; Returns: number }
      has_active_booking_on: { Args: { p_shift_id: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_coordinator_for_my_dept: {
        Args: { p_coordinator_id: string }
        Returns: boolean
      }
      is_coordinator_or_admin: { Args: never; Returns: boolean }
      log_mfa_reset: { Args: { target_email: string }; Returns: undefined }
      mfa_consume_backup_code: { Args: { p_code: string }; Returns: boolean }
      mfa_generate_backup_codes: { Args: never; Returns: string[] }
      mfa_unused_backup_code_count: { Args: never; Returns: number }
      my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      notification_link_booking_id: {
        Args: { p_link: string }
        Returns: string
      }
      process_confirmation_reminders: { Args: never; Returns: undefined }
      promote_next_waitlist:
        | { Args: { p_shift_id: string }; Returns: string }
        | {
            Args: { p_shift_id: string; p_time_slot_id?: string }
            Returns: string
          }
      recalculate_consistency: {
        Args: { p_volunteer_id: string }
        Returns: undefined
      }
      recalculate_points: {
        Args: { volunteer_uuid: string }
        Returns: undefined
      }
      reconcile_shift_counters: { Args: never; Returns: undefined }
      resolve_hours_discrepancy: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      score_shifts_for_volunteer: {
        Args: { p_max_days?: number; p_volunteer_id: string }
        Returns: {
          booked_slots: number
          department_id: string
          department_name: string
          end_time: string
          fill_ratio: number
          novelty_bonus: number
          organizational_need: number
          preference_match: number
          requires_bg_check: boolean
          score_breakdown: Json
          shift_date: string
          shift_id: string
          start_time: string
          time_type: string
          title: string
          total_score: number
          total_slots: number
        }[]
      }
      send_self_confirmation_reminders: { Args: never; Returns: undefined }
      shift_end_at: {
        Args: { p_end_time: string; p_shift_date: string; p_time_type: string }
        Returns: string
      }
      shift_start_at: {
        Args: {
          p_shift_date: string
          p_start_time: string
          p_time_type: string
        }
        Returns: string
      }
      transfer_admin_role: {
        Args: { from_admin_id: string; to_coordinator_id: string }
        Returns: undefined
      }
      update_volunteer_preferences: {
        Args: { p_volunteer_id: string }
        Returns: undefined
      }
      username_available: { Args: { p_username: string }; Returns: boolean }
      waitlist_accept: { Args: { p_booking_id: string }; Returns: undefined }
      waitlist_decline: { Args: { p_booking_id: string }; Returns: undefined }
      warn_expiring_documents: { Args: never; Returns: undefined }
    }
    Enums: {
      bg_check_status: "pending" | "cleared" | "failed" | "expired"
      booking_status: "confirmed" | "cancelled" | "waitlisted"
      confirmation_status: "pending_confirmation" | "confirmed" | "no_show"
      interaction_type:
        | "viewed"
        | "signed_up"
        | "cancelled"
        | "completed"
        | "no_show"
      recurrence_type: "daily" | "weekly" | "biweekly" | "monthly"
      reminder_recipient: "coordinator" | "admin"
      self_confirm_status: "pending" | "attended" | "no_show"
      shift_status: "open" | "full" | "cancelled" | "completed"
      shift_time_type: "morning" | "afternoon" | "all_day" | "custom"
      user_role: "volunteer" | "coordinator" | "admin"
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
    Enums: {
      bg_check_status: ["pending", "cleared", "failed", "expired"],
      booking_status: ["confirmed", "cancelled", "waitlisted"],
      confirmation_status: ["pending_confirmation", "confirmed", "no_show"],
      interaction_type: [
        "viewed",
        "signed_up",
        "cancelled",
        "completed",
        "no_show",
      ],
      recurrence_type: ["daily", "weekly", "biweekly", "monthly"],
      reminder_recipient: ["coordinator", "admin"],
      self_confirm_status: ["pending", "attended", "no_show"],
      shift_status: ["open", "full", "cancelled", "completed"],
      shift_time_type: ["morning", "afternoon", "all_day", "custom"],
      user_role: ["volunteer", "coordinator", "admin"],
    },
  },
} as const
