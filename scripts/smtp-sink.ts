// Local SMTP sink for offline testing:  npx tsx scripts/smtp-sink.ts
// then run the server with SMTP_URL=smtp://localhost:2525
import { SMTPServer } from "smtp-server";

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, cb) {
    let size = 0;
    stream.on("data", (c) => (size += c.length));
    stream.on("end", () => {
      console.log(`[sink] received mail to=${session.envelope.rcptTo.map((r) => r.address)} bytes=${size}`);
      cb();
    });
  },
});
server.listen(Number(process.env.SINK_PORT ?? 2525), () => console.log("[sink] listening"));
