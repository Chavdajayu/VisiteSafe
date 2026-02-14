export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { residentUsername, visitorName, requestId } = req.body || {};
    if (!residentUsername || !visitorName || !requestId) {
      return res.status(400).json({ error: "Missing residentUsername, visitorName or requestId" });
    }
    console.log("Sending to external_id:", residentUsername);
    const payload = {
      app_id: "7304d154-c777-4f86-b61a-5a6e88976cd9",
      include_aliases: {
        external_id: [residentUsername]
      },
      target_channel: "push",
      headings: { en: "New Visitor Request" },
      contents: { en: `Visitor ${visitorName} is waiting at the gate.` },
      data: { requestId },
      buttons: [
        { id: "approve", text: "Approve" },
        { id: "reject", text: "Reject" }
      ]
    };
    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    const status = response.status;
    const result = await response.json().catch(() => ({}));
    console.log("OneSignal status:", status);
    console.log("OneSignal response:", result);
    if (!response.ok) {
      return res.status(status).json({ success: false, error: result?.errors || result });
    }
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error("OneSignal send error:", err);
    return res.status(500).json({ error: err.message });
  }
}
