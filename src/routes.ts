import { Router } from "express";
import { Job } from "bullmq";
import { z } from "zod";
import { emailQueue, EmailJobData, scheduleEmail } from "./queue";

export const api = Router();

type Status = "scheduled" | "queued" | "sending" | "sent" | "failed";

const STATE_MAP: Record<string, Status> = {
  delayed: "scheduled",
  waiting: "queued",
  prioritized: "queued",
  "waiting-children": "queued",
  active: "sending",
  completed: "sent",
  failed: "failed",
};

async function serialize(job: Job<EmailJobData>) {
  const state = await job.getState();
  return {
    id: job.id,
    to: job.data.to,
    subject: job.data.subject,
    body: job.data.body,
    html: !!job.data.html,
    sendAt: job.data.sendAt,
    createdAt: job.data.createdAt,
    status: STATE_MAP[state] ?? state,
    attempts: job.attemptsMade,
    processedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    previewUrl: (job.returnvalue as any)?.previewUrl ?? null,
    error: job.failedReason || null,
  };
}

const scheduleSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  html: z.boolean().optional(),
  // ISO 8601 timestamp. Omitted => send immediately.
  sendAt: z.string().datetime({ offset: true }).optional(),
});

// Schedule one email
api.post("/emails", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }
  const { sendAt, ...rest } = parsed.data;
  const when = sendAt ?? new Date().toISOString();
  const job = await scheduleEmail({ ...rest, sendAt: when });
  res.status(201).json(await serialize(job as Job<EmailJobData>));
});

// Schedule many emails at once: { emails: [...] }
api.post("/emails/bulk", async (req, res) => {
  const parsed = z.object({ emails: z.array(scheduleSchema).min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.flatten() });
  }
  const jobs = await Promise.all(
    parsed.data.emails.map(({ sendAt, ...rest }) =>
      scheduleEmail({ ...rest, sendAt: sendAt ?? new Date().toISOString() })
    )
  );
  res.status(201).json({ count: jobs.length, ids: jobs.map((j) => j.id) });
});

// List emails, optional ?status=scheduled|queued|sending|sent|failed
api.get("/emails", async (req, res) => {
  const wanted = typeof req.query.status === "string" ? req.query.status : undefined;
  const bullStates = Object.entries(STATE_MAP)
    .filter(([, s]) => !wanted || s === wanted)
    .map(([b]) => b) as any[];
  const jobs = await emailQueue.getJobs(bullStates, 0, 499, false);
  const rows = await Promise.all(jobs.filter(Boolean).map((j) => serialize(j as Job<EmailJobData>)));
  rows.sort((a, b) => new Date(b.sendAt).getTime() - new Date(a.sendAt).getTime());
  res.json(rows);
});

api.get("/emails/:id", async (req, res) => {
  const job = await emailQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  res.json(await serialize(job));
});

// Cancel a scheduled (not yet sending) email
api.delete("/emails/:id", async (req, res) => {
  const job = await emailQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  const state = await job.getState();
  if (state === "active" || state === "completed") {
    return res.status(409).json({ error: "cannot_cancel", status: STATE_MAP[state] });
  }
  await job.remove();
  res.status(204).end();
});

// Retry a failed email
api.post("/emails/:id/retry", async (req, res) => {
  const job = await emailQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "not_found" });
  if ((await job.getState()) !== "failed") return res.status(409).json({ error: "not_failed" });
  await job.retry();
  res.json(await serialize(job));
});

api.get("/stats", async (_req, res) => {
  const c = await emailQueue.getJobCounts(
    "delayed", "waiting", "prioritized", "active", "completed", "failed"
  );
  res.json({
    scheduled: c.delayed,
    queued: c.waiting + (c.prioritized ?? 0),
    sending: c.active,
    sent: c.completed,
    failed: c.failed,
  });
});
