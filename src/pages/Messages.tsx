import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/messaging/ConversationList";
import { ConversationThread } from "@/components/messaging/ConversationThread";
import { ComposeMessage } from "@/components/messaging/ComposeMessage";
import { BulkComposeMessage } from "@/components/messaging/BulkComposeMessage";
import { MessageSquarePlus, Megaphone, MessageSquare } from "lucide-react";

export default function Messages() {
  const { role } = useAuth();
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null);
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = () => setRefreshTrigger((t) => t + 1);

  const handleSelect = (id: string, names: Record<string, string>) => {
    setSelectedConvoId(id);
    setParticipantNames(names);
  };

  const handleComposeSent = (convoId: string) => {
    setSelectedConvoId(convoId);
    refresh();
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-2xl font-bold">Messages</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setComposeOpen(true)}>
            <MessageSquarePlus className="h-4 w-4 mr-2" /> New Message
          </Button>
          {(role === "coordinator" || role === "admin") && (
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <Megaphone className="h-4 w-4 mr-2" /> Bulk Message
            </Button>
          )}
        </div>
      </div>

      {/* Split layout */}
      <div className="flex flex-1 border rounded-lg overflow-hidden bg-background min-h-0">
        {/* Left: Conversation list */}
        <div className="w-80 shrink-0">
          <ConversationList
            selectedId={selectedConvoId}
            onSelect={handleSelect}
            refreshTrigger={refreshTrigger}
          />
        </div>

        {/* Right: Thread or empty state */}
        <div className="flex-1 flex flex-col">
          {selectedConvoId ? (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b bg-muted/30">
                <p className="font-medium text-sm">
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
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
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
