import { format } from "date-fns";

interface MessageBubbleProps {
  content: string;
  senderName: string;
  createdAt: string;
  isOwn: boolean;
}

export function MessageBubble({ content, senderName, createdAt, isOwn }: MessageBubbleProps) {
  return (
    <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"} mb-3`}>
      <p className="text-xs text-muted-foreground mb-1">{senderName}</p>
      <div
        className={`rounded-2xl px-4 py-2 max-w-[75%] ${
          isOwn
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted rounded-bl-md"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {format(new Date(createdAt), "MMM d, h:mm a")}
      </p>
    </div>
  );
}
