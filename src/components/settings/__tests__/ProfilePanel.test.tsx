import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Tier 2 test for ProfilePanel.
 *
 * Focus: profile save semantics. Email change must trigger
 * supabase.auth.updateUser({ email }) AND show a verification toast;
 * unchanged email must NOT call auth.updateUser. DOB onChange must
 * call setIsMinor with the right boolean.
 *
 * AvatarUploadField is stubbed — it has its own storage surface that
 * we don't want to drag into profile-save tests.
 */

const updateUserMock = vi.fn();
const profileUpdateMock = vi.fn();
const profileEqMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
    from: () => ({
      update: (...args: unknown[]) => {
        profileUpdateMock(...args);
        return { eq: (...eqArgs: unknown[]) => profileEqMock(...eqArgs) };
      },
    }),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/settings/AvatarUploadField", () => ({
  AvatarUploadField: () => <div data-testid="avatar-upload-stub" />,
}));

import { ProfilePanel } from "@/components/settings/ProfilePanel";
import type { SettingsProfile } from "@/components/settings/types";

const baseProfile: SettingsProfile = {
  id: "user-123",
  full_name: "Vol Tester",
  email: "vol@example.com",
  phone: "555-0100",
  emergency_contact_name: "EC Name",
  emergency_contact_phone: "555-0200",
  avatar_url: null,
  notif_email: true,
  notif_in_app: true,
  notif_sms: false,
  is_minor: false,
  username: "voltester",
  notif_shift_reminders: true,
  notif_new_messages: true,
  notif_milestone: true,
  notif_document_expiry: true,
  notif_booking_changes: true,
};

beforeEach(() => {
  updateUserMock.mockReset();
  profileUpdateMock.mockReset();
  profileEqMock.mockReset();
  toastMock.mockReset();
  // Default success.
  profileEqMock.mockResolvedValue({ error: null });
  updateUserMock.mockResolvedValue({ error: null });
});

interface RenderOptions {
  phone?: string;
  emergencyPhone?: string;
  isMinor?: boolean;
  setPhone?: (v: string) => void;
  setEmergencyPhone?: (v: string) => void;
  onSaved?: () => Promise<void> | void;
}

function renderPanel(opts: RenderOptions = {}) {
  const setPhone = opts.setPhone ?? vi.fn();
  const setEmergencyPhone = opts.setEmergencyPhone ?? vi.fn();
  const onSaved = opts.onSaved ?? vi.fn();
  render(
    <ProfilePanel
      userId="user-123"
      profile={baseProfile}
      phone={opts.phone ?? baseProfile.phone ?? ""}
      setPhone={setPhone}
      emergencyPhone={opts.emergencyPhone ?? baseProfile.emergency_contact_phone ?? ""}
      setEmergencyPhone={setEmergencyPhone}
      isMinor={opts.isMinor ?? false}
      onSaved={onSaved}
    />
  );
  return { setPhone, setEmergencyPhone, onSaved };
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
}

describe("ProfilePanel", () => {
  it("calls profiles.update only and shows 'Profile updated' toast when email is unchanged", async () => {
    renderPanel();
    clickSave();

    await waitFor(() => {
      expect(profileUpdateMock).toHaveBeenCalledTimes(1);
      expect(profileEqMock).toHaveBeenCalledWith("id", "user-123");
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Profile updated",
      }));
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("calls auth.updateUser AND shows verification toast when email changes", async () => {
    renderPanel();
    fireEvent.change(screen.getByDisplayValue(baseProfile.email!), {
      target: { value: "newemail@example.com" },
    });
    clickSave();

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ email: "newemail@example.com" });
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Verification sent",
      }));
    });
  });

  it("shows error toast and does NOT call auth.updateUser when profiles.update fails", async () => {
    profileEqMock.mockResolvedValue({ error: { message: "RLS denied" } });
    renderPanel();
    fireEvent.change(screen.getByDisplayValue(baseProfile.email!), {
      target: { value: "newemail@example.com" },
    });
    clickSave();

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error",
        description: "RLS denied",
        variant: "destructive",
      }));
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("shows error toast when auth.updateUser fails after profiles.update succeeds (partial save)", async () => {
    updateUserMock.mockResolvedValue({ error: { message: "auth backend down" } });
    renderPanel();
    fireEvent.change(screen.getByDisplayValue(baseProfile.email!), {
      target: { value: "newemail@example.com" },
    });
    clickSave();

    await waitFor(() => {
      expect(profileUpdateMock).toHaveBeenCalled();
      expect(updateUserMock).toHaveBeenCalled();
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Error updating email",
        description: "auth backend down",
        variant: "destructive",
      }));
    });
  });

  // DOB-driven setIsMinor tests removed in Half A — the panel no
  // longer captures DOB or mutates is_minor. is_minor is now answered
  // once at signup via the over-18 radio in Auth.tsx and is read-only
  // in this panel. See migration 20260501000000_remove_dob_capture.sql.

  it("does NOT send date_of_birth in the profile update payload", async () => {
    renderPanel();
    clickSave();
    await waitFor(() => {
      expect(profileUpdateMock).toHaveBeenCalledTimes(1);
    });
    const payload = profileUpdateMock.mock.calls[0][0];
    expect(payload).not.toHaveProperty("date_of_birth");
  });
});
