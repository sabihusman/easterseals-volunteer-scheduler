import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/messaging/ConversationList";
import { ConversationThread } from "@/components/messaging/ConversationThread";
import { ComposeMessage } from "@/components/messaging/ComposeMessage";
import { BulkComposeMessage } from "@/components/messaging/BulkComposeMessage";
import { MessageSquarePlus, Megaphone, MessageSquare, Ban, ArrowLeft } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function Messages() {
  const { role, profile } = useAuth();
  const messagingBlocked = (profile as any)?.messaging_blocked === true;
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = () => setRefreshTrigger((t) => t + 1);

  const handleSelect = (id: string | null, names: Record<string, string>) => {
    setSelectedConvoId(id);
    setParticipantNames(names);
  };

  const handleComposeSent = (convoId: string) => {
    setSelectedConvoId(convoId);
    refresh();
  };

  return (
    <div className="h-[calc(100dvh-8rem)] md:h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
        <h1 className="text-2xl font-bold">Messages</h1>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setComposeOpen(true)}
            disabled={messagingBlocked}
          >
            <MessageSquarePlus className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">New Message</span>
            <span className="sm:hidden">New</span>
          </Button>
          {(role === "coordinator" || role === "admin") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkOpen(true)}
              disabled={messagingBlocked}
            >
              <Megaphone className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Bulk Message</span>
              <span className="sm:hidden">Bulk</span>
            </Button>
          )}
        </div>
      </div>

      {messagingBlocked && (
        <Alert variant="destructive" className="mb-4">
          <Ban className="h-4 w-4" />
          <AlertTitle>Messaging Disabled</AlertTitle>
          <AlertDescription>
            An administrator has blocked you from sending messages. You can still read existing conversations.
            Please contact your coordinator or admin if you believe this is a mistake.
          </AlertDescription>
        </Alert>
      )}

      {/* Split layout: side-by-side on md+, master/detail on mobile */}
      <div className="flex flex-1 border rounded-lg overflow-hidden bg-background min-h-0">
        {/* Left: Conversation list (hidden on mobile when a thread is open) */}
        <div
          className={`w-full md:w-80 md:shrink-0 md:border-r ${
            selectedConvoId ? "hidden md:block" : "block"
          }`}
        >
          <ConversationList
            selectedId={selectedConvoId}
            onSelect={handleSelect}
            refreshTrigger={refreshTrigger}
          />
        </div>

        {/* Right: Thread or empty state (takes full width on mobile when open) */}
        <div
          className={`flex-1 flex-col min-w-0 ${
            selectedConvoId ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedConvoId ? (
            <>
              {/* Thread header with mobile back button */}
              <div className="px-3 py-3 border-b bg-muted/30 flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden h-8 w-8 shrink-0"
                  onClick={() => handleSelect(null, {})}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <p className="font-medium text-sm truncate">
                  {Object.entries(participantNames)
                    .filter(([, name]) => name !== "You")
                    .map(([, name]) => name)
                    .join(", ") || "Conversation"}
                </p>
              </div>
              <ConversationThread
                conversationId={selectedConvoId}
                participantNames={participantNames}
                onMessageSent={refresh}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
              <MessageSquare className="h-12 w-12 mb-3" />
              <p className="text-lg font-medium">Select a conversation</p>
              <p className="text-sm">Or start a new one</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose dialogs */}
      <ComposeMessage open={composeOpen} onOpenChange={setComposeOpen} onSent={handleComposeSent} />
      <BulkComposeMessage open={bulkOpen} onOpenChange={setBulkOpen} onSent={refresh} />
    </div>
  );
}
