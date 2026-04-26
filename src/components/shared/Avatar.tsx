interface AvatarProps {
  avatarUrl?: string | null;
  fullName: string;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-11 w-11 text-base",
};

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function Avatar({ avatarUrl, fullName, size = "md" }: AvatarProps) {
  const classes = sizeClasses[size];

  if (avatarUrl) {
    return (
      <div className={`${classes} rounded-full overflow-hidden flex-shrink-0`}>
        <img
          src={avatarUrl}
          alt={fullName}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${classes} rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium flex-shrink-0`}
    >
      {getInitials(fullName)}
    </div>
  );
}
