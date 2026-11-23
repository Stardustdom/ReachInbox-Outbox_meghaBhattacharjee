"use client";
import { useRef, useState, type KeyboardEvent } from "react";
import { api } from "@/lib/api";
import { extractEmails, readLeadsFile } from "@/lib/leads";
import { Button } from "./ui/Button";
import { RichTextEditor } from "./ui/RichTextEditor";
import { useToast } from "./ui/Toast";
import { ArrowLeftIcon, CloseIcon, UploadIcon } from "./ui/icons";
import { SendLater } from "./SendLater";

const VISIBLE_CHIPS = 3;
const numberInput =
  "h-8 w-14 rounded-md bg-surface px-2 text-center text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

type Errors = Partial<
  Record<"recipients" | "subject" | "body" | "delay" | "hourly", string>
>;

export function ComposeView({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [subject, setSubject] = useState("");
  const [delay, setDelay] = useState("");
  const [hourly, setHourly] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [startAt, setStartAt] = useState(""); // '' = send now
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  // One key per compose session: double-clicks / retries can't schedule twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const addRecipients = (emails: string[]) => {
    if (emails.length)
      setRecipients((prev) => [...new Set([...prev, ...emails])]);
    setErrors((e) => ({ ...e, recipients: undefined }));
  };

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    const found = extractEmails(text);
    if (found.length === 0)
      setErrors((e) => ({
        ...e,
        recipients: `“${text}” is not a valid email address`,
      }));
    else addRecipients(found);
    setDraft("");
  };

  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (["Enter", ",", " ", "Tab"].includes(e.key) && draft.trim()) {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && !draft)
      setRecipients((r) => r.slice(0, -1));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const emails = await readLeadsFile(file);
      if (emails.length === 0)
        setErrors((e) => ({
          ...e,
          recipients: "No email addresses found in this file",
        }));
      else {
        addRecipients(emails);
        toast.success(
          `${emails.length} email${emails.length === 1 ? "" : "s"} detected in ${file.name}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read file");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const validate = () => {
    const next: Errors = {};
    if (recipients.length === 0)
      next.recipients = "Add at least one recipient or upload a CSV/TXT list";
    if (!subject.trim()) next.subject = "Subject is required";
    if (!bodyText.trim()) next.body = "Write a message";
    const d = Number(delay);
    if (delay === "" || !Number.isInteger(d) || d < 0)
      next.delay = "Enter the delay in seconds (0 or more)";
    const h = Number(hourly);
    if (hourly === "" || !Number.isInteger(h) || h < 1)
      next.hourly = "Enter an hourly limit of 1 or more";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.schedule(
        {
          subject: subject.trim(),
          body: bodyHtml,
          recipients,
          startAt: (startAt ? new Date(startAt) : new Date()).toISOString(),
          delaySeconds: Number(delay),
          hourlyLimit: Number(hourly),
        },
        idempotencyKey,
      );
      toast.success(
        res.duplicate
          ? "This campaign was already scheduled"
          : `Scheduled ${res.total} emails`,
      );
      onScheduled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setSubmitting(false);
    }
  };

  const chips = showAll ? recipients : recipients.slice(0, VISIBLE_CHIPS);
  const hidden = recipients.length - chips.length;

  return (
    <div className="mx-auto min-h-screen max-w-4xl px-4 py-5 sm:px-8">
      <div className="flex items-center gap-2">
        <button
          onClick={onClose}
          aria-label="Back"
          className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
        >
          <ArrowLeftIcon size={20} />
        </button>
        <h1 className="flex-1 text-lg font-semibold sm:text-xl">
          Compose New Email
        </h1>
        <SendLater value={startAt} onChange={setStartAt} />
        <Button
          variant="outline"
          size="sm"
          loading={submitting}
          onClick={() => void submit()}
        >
          {startAt ? "Send Later" : "Send"}
        </Button>
      </div>

      <div className="mt-6 space-y-3 text-sm sm:pl-10">
        <Row label="From">
          <span className="inline-block rounded-md bg-surface px-3 py-1.5 text-gray-700">
            Auto · rotating senders
          </span>
        </Row>

        <Row label="To" error={errors.recipients}>
          <div className="flex flex-1 flex-wrap items-center gap-1.5 border-b border-gray-200 pb-1.5">
            {chips.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs text-gray-800"
              >
                {r}
                <button
                  type="button"
                  aria-label={`Remove ${r}`}
                  onClick={() =>
                    setRecipients((all) => all.filter((x) => x !== r))
                  }
                  className="rounded-full p-0.5 text-gray-500 hover:bg-brand-100"
                >
                  <CloseIcon size={10} />
                </button>
              </span>
            ))}
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-full border border-brand-500/40 bg-brand-50 px-2 py-0.5 text-xs text-brand-700"
              >
                +{hidden}
              </button>
            )}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onDraftKey}
              onBlur={commitDraft}
              placeholder={recipients.length ? "" : "recipient@example.com"}
              className="min-w-[10rem] flex-1 bg-transparent py-1 placeholder:text-gray-400 focus:outline-none"
            />
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
            >
              <UploadIcon size={14} /> Upload List
            </button>
          </div>
          {recipients.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {recipients.length} email{recipients.length === 1 ? "" : "s"}{" "}
              detected
            </p>
          )}
        </Row>

        <Row label="Subject" error={errors.subject}>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={255}
            placeholder="Subject"
            className="w-full border-b border-gray-200 bg-transparent pb-1.5 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none"
          />
        </Row>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-1">
          <label className="flex items-center gap-2 text-gray-700">
            Delay between 2 emails(sec)
            <input
              type="number"
              min={0}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              placeholder="00"
              aria-label="Delay between emails in seconds"
              className={numberInput}
            />
          </label>
          <label className="flex items-center gap-2 text-gray-700">
            Hourly Limit
            <input
              type="number"
              min={1}
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
              placeholder="00"
              aria-label="Hourly limit"
              className={numberInput}
            />
          </label>
        </div>
        {(errors.delay || errors.hourly) && (
          <p className="text-xs text-red-600">
            {errors.delay ?? errors.hourly}
          </p>
        )}

        <RichTextEditor
          placeholder="Type Your Reply..."
          onChange={(html, text) => {
            setBodyHtml(html);
            setBodyText(text);
            if (text) setErrors((e) => ({ ...e, body: undefined }));
          }}
        />
        {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
        {startAt && (
          <p className="text-xs text-brand-700">
            Sending starts {new Date(startAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <span className="w-16 shrink-0 pt-1.5 text-xs font-medium text-gray-600 sm:text-sm">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        {children}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
