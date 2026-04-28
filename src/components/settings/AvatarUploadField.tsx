import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import Avatar from "@/components/shared/Avatar";
import { useToast } from "@/hooks/use-toast";
import { useAvatarUrl } from "@/lib/avatar-url";
import { buildAvatarPath } from "@/lib/avatar-path";

interface Props {
  userId: string;
  /**
   * The bucket-relative storage path stored in `profiles.avatar_url`
   * (e.g. `aaaa-bbbb-cccc/avatar.jpg`). NOT a fully-qualified URL —
   * the avatars bucket is private, so display goes through
   * `useAvatarUrl` which resolves to a signed URL on render.
   */
  avatarUrl: string | null;
  fullName: string;
  /** Called after a successful upload or remove so the parent can refreshProfile(). */
  onChanged: () => Promise<void> | void;
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Avatar upload + remove field. Self-contained: owns its file input + uploading
 * state, performs the storage put / list / remove + profiles.avatar_url update,
 * and hands control back to the parent via onChanged().
 *
 * Storage: writes to the dedicated `avatars` bucket at path
 * `{userId}/avatar.{ext}`. Bucket is private; the column stores the
 * path and `useAvatarUrl` resolves to a signed URL on render. See
 * `supabase/migrations/20260428000002_avatars_bucket.sql`.
 */
export function AvatarUploadField({ userId, avatarUrl, fullName, onChanged }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const resolvedUrl = useAvatarUrl(avatarUrl);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_AVATAR_BYTES) {
      toast({ title: "File too large", description: "Please choose an image under 2 MB.", variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() ?? "png";
    const path = buildAvatarPath(userId, ext);

    // upsert:true + the canonical {userId}/avatar.{ext} naming means
    // re-uploads cleanly overwrite. The previous-extension orphan
    // problem (e.g. avatar.png lingering after upload of avatar.jpg)
    // is handled in the remove path below; we don't proactively scan
    // on every upload because the common path uses a single ext.
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Store the PATH (not a URL). Display surfaces resolve to a
    // signed URL via useAvatarUrl. Pre-migration this column held a
    // public URL — the new convention is path-only.
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: path, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (updateError) {
      toast({ title: "Error", description: updateError.message, variant: "destructive" });
    } else {
      toast({ title: "Photo updated", description: "Your avatar has been uploaded." });
    }

    await onChanged();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemove = async () => {
    setUploading(true);

    // Best-effort: list and remove anything in the user's avatar
    // folder (multiple extensions from past uploads can linger if
    // the user uploaded a .png then a .jpg, since upsert only
    // overwrites the same name).
    const { data: files } = await supabase.storage
      .from("avatars")
      .list(userId);

    if (files && files.length > 0) {
      const paths = files.map((f) => `${userId}/${f.name}`);
      await supabase.storage.from("avatars").remove(paths);
    }

    await supabase
      .from("profiles")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", userId);

    await onChanged();
    setUploading(false);
    toast({ title: "Photo removed", description: "Your avatar has been removed." });
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar avatarUrl={resolvedUrl} fullName={fullName} size="lg" />
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          {uploading ? "Uploading..." : "Upload Photo"}
        </Button>
        {avatarUrl && (
          <Button type="button" variant="ghost" size="sm" disabled={uploading} onClick={handleRemove}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            Remove Photo
          </Button>
        )}
      </div>
    </div>
  );
}
