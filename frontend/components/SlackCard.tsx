"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { SlackStatus } from "@/lib/types";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";

export function SlackCard({
  slack,
  onChange,
}: {
  slack: SlackStatus | null;
  onChange: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const [testing, setTesting] = useState(false);

  if (!slack) return null;

  const sendTest = async () => {
    setTesting(true);
    try {
      await api.slackTest();
      toast.info("Test alert sent to Slack");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Slack request failed");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.slackDisconnect();
      toast.info("Slack disconnected");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Slack request failed");
    } finally {
      setBusy(false);
      onChange();
    }
  };

  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <p className="text-sm font-semibold">Slack alerts</p>
      {slack.connected ? (
        <>
          <p className="mt-0.5 text-xs text-gray-500">
            Connected to {slack.teamName ?? "workspace"}{" "}
            {slack.channel ? `· ${slack.channel}` : ""}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={testing}
              onClick={() => void sendTest()}
            >
              Test
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-gray-500">
            Get notified when a sender hits its hourly limit.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2 w-full"
            disabled={!slack.available}
            title={
              slack.available
                ? undefined
                : "Slack OAuth is not configured on the server"
            }
            onClick={() => (window.location.href = api.slackConnectUrl)}
          >
            Connect Slack
          </Button>
        </>
      )}
    </div>
  );
}
