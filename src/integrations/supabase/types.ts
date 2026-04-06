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
  public: {
    Tables: {
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
          conversation_id: string
          id: string
          is_archived: boolean
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          is_archived?: boolean
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
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
      notifications: {
        Row: {
          created_at: string
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
      profiles: {
        Row: {
          bg_check_expires_at: string | null
          bg_check_status: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at: string | null
          booking_privileges: boolean
          consistency_score: number
          created_at: string
          email: string
          emergency_contact: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          extended_booking: boolean
          full_name: string
          id: string
          is_active: boolean
          location_id: string | null
          notif_email: boolean
          notif_in_app: boolean
          notif_sms: boolean
          onboarding_complete: boolean
          phone: string | null
          phone_verified: boolean
          role: Database["public"]["Enums"]["user_role"]
          tos_accepted_at: string | null
          total_hours: number
          updated_at: string
        }
        Insert: {
          bg_check_expires_at?: string | null
          bg_check_status?: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at?: string | null
          booking_privileges?: boolean
          consistency_score?: number
          created_at?: string
          email: string
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          extended_booking?: boolean
          full_name: string
          id: string
          is_active?: boolean
          location_id?: string | null
          notif_email?: boolean
          notif_in_app?: boolean
          notif_sms?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          phone_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          tos_accepted_at?: string | null
          total_hours?: number
          updated_at?: string
        }
        Update: {
          bg_check_expires_at?: string | null
          bg_check_status?: Database["public"]["Enums"]["bg_check_status"]
          bg_check_updated_at?: string | null
          booking_privileges?: boolean
          consistency_score?: number
          created_at?: string
          email?: string
          emergency_contact?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          extended_booking?: boolean
          full_name?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          notif_email?: boolean
          notif_in_app?: boolean
          notif_sms?: boolean
          onboarding_complete?: boolean
          phone?: string | null
          phone_verified?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          tos_accepted_at?: string | null
          total_hours?: number
          updated_at?: string
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
          updated_at: string
          volunteer_id: string
          volunteer_reported_hours: number | null
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
          updated_at?: string
          volunteer_id: string
          volunteer_reported_hours?: number | null
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
          updated_at?: string
          volunteer_id?: string
          volunteer_reported_hours?: number | null
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
    }
    Functions: {
      export_critical_data: { Args: never; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_coordinator_or_admin: { Args: never; Returns: boolean }
      my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      process_confirmation_reminders: { Args: never; Returns: undefined }
      recalculate_consistency: {
        Args: { p_volunteer_id: string }
        Returns: undefined
      }
      resolve_hours_discrepancy: {
        Args: { p_booking_id: string }
        Returns: undefined
      }
      score_shifts_for_volunteer:
        | {
            Args: { p_volunteer_id: string }
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
              time_type: Database["public"]["Enums"]["shift_time_type"]
              title: string
              total_score: number
              total_slots: number
            }[]
          }
        | {
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
              time_type: Database["public"]["Enums"]["shift_time_type"]
              title: string
              total_score: number
              total_slots: number
            }[]
          }
      send_self_confirmation_reminders: { Args: never; Returns: undefined }
      send_shift_reminders: { Args: never; Returns: undefined }
      transfer_admin_role: {
        Args: { from_admin_id: string; to_coordinator_id: string }
        Returns: undefined
      }
      update_volunteer_preferences: {
        Args: { p_volunteer_id: string }
        Returns: undefined
      }
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
