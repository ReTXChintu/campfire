import { FormEvent, useState } from "react";
import { useChat } from "@livekit/components-react";

export default function WatchPartyChat() {
  const { chatMessages, send, isSending } = useChat();
  const [draft, setDraft] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    await send(trimmed);
    setDraft("");
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Party Chat</h3>
        <span className="text-xs text-white/45">{chatMessages.length} messages</span>
      </div>
      <div className="mb-3 max-h-48 space-y-2 overflow-y-auto pr-1">
        {chatMessages.length === 0 ? (
          <p className="text-sm text-white/45">No chat yet.</p>
        ) : (
          chatMessages.map((message) => (
            <div key={`${message.from?.identity ?? "anon"}-${message.timestamp}`} className="rounded-lg bg-white/5 px-3 py-2">
              <p className="text-xs text-white/55">{message.from?.name || message.from?.identity || "Unknown"}</p>
              <p className="text-sm text-white/90">{message.message}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Say something..."
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30"
        />
        <button
          type="submit"
          disabled={isSending || draft.trim().length === 0}
          className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30"
        >
          Send
        </button>
      </form>
    </div>
  );
}
