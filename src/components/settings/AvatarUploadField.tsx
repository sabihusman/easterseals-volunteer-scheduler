import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import Avatar from "@/components/shared/Avatar";
import { useToast } from "@/hooks/use-toast";

interface Props {
  userId: string;
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
 */
export function AvatarUploadField({ userId, avatarUrl, fullName, onChanged }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

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
    const path = `avatars/${userId}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("volunteer-documents")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      toast({ title: "Upload failed", description: uploadError.message, variant: "destructive" });
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const { data: urlData } = supabase.storage.from("volunteer-documents").getPublicUrl(path);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: urlData.publicUrl, updated_at: new Date().toISOString() })
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

    // Best-effort: list and remove anything in the user's avatars folder
    // (the folder may have multiple extensions from past uploads).
    const { data: files } = await supabase.storage
      .from("volunteer-documents")
      .list(`avatars/${userId}`);

    if (files && files.length > 0) {
      const paths = files.map((f) => `avatars/${userId}/${f.name}`);
      await supabase.storage.from("volunteer-documents").remove(paths);
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
      <Avatar avatarUrl={avatarUrl} fullName={fullName} size="lg" />
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
