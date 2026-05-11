import express from 'express';
import Retell from 'retell-sdk';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
const PORT = process.env.PORT || 3000;

/**
 * Agent registry — loaded from AGENTS env var (JSON string).
 * Format: { "slug": "voipms_subaccount_username" }
 * Example: { "pablotest": "109704_pablotest", "ailyn": "109704_ailyn" }
 *
 * To add agents: update AGENTS in Railway dashboard — no redeploy needed.
 */
const AGENTS = (() => {
  try {
    return JSON.parse(process.env.AGENTS || '{}');
  } catch {
    console.error('Invalid AGENTS env var — must be valid JSON. Using empty registry.');
    return {};
  }
})();

console.log(`Agent registry loaded: ${Object.keys(AGENTS).join(', ') || '(empty)'}`);

/**
 * POST /incoming-call
 *
 * Handles two scenarios on the same Twilio SIP Domain:
 *
 * 1. INBOUND from VoIP.MS → Anna (normal flow)
 *    VoIP.MS IVR → sip:anna@[domain].sip.twilio.com
 *    → Twilio → POST /incoming-call (To = sip:anna@...)
 *    → Register call with Retell → TwiML bridges to Anna
 *
 * 2. TRANSFER from Retell → agent's IP phone (new flow)
 *    Retell Transfer Call → sip:pablotest@[domain].sip.twilio.com
 *    → Twilio → POST /incoming-call (To = sip:pablotest@...)
 *    → Lookup agent in registry → TwiML dials VoIP.MS with auth
 *    → VoIP.MS → agent's registered IP phone
 */
app.post('/incoming-call', async (req, res) => {
  // Extract the username part of the SIP To header
  // e.g. "sip:pablotest@anna.sip.twilio.com" → "pablotest"
  const toHeader = req.body.To || '';
  const username = toHeader.match(/sip:([^@]+)@/)?.[1]?.toLowerCase();

  // Log full body on transfer legs so we can see what Retell sends
  // (caller ID, custom headers, etc.) — useful for first test
  console.log(`Incoming call — To: ${toHeader} | username: ${username}`);
  console.log('Full request body:', JSON.stringify(req.body, null, 2));

  // --- TRANSFER FLOW ---
  if (username && AGENTS[username]) {
    const sipUser = AGENTS[username];
    const sipServer = process.env.VOIPMS_SIP_SERVER || 'montreal1.voip.ms';
    const voipmsUser = process.env.VOIPMS_USERNAME || '109704';
    const voipmsPass = process.env.VOIPMS_PASSWORD;

    // Try to extract the original customer number from the From/Caller field.
    // Retell may pass it in req.body.From or req.body.Caller.
    // Format is typically "+15141234567" or "sip:+15141234567@..."
    const fromHeader = req.body.From || req.body.Caller || '';
    const callerNumber = fromHeader.match(/\+?\d{7,15}/)?.[0] || '';

    console.log(`Transfer → ${sipUser}@${sipServer} | callerID: ${callerNumber || '(unknown)'}`);

    // Pass original caller ID so the agent's IP phone shows the customer's number.
    // Falls back to no callerId attribute if we couldn't extract a number.
    const callerIdAttr = callerNumber ? ` callerId="${callerNumber}"` : '';

    // Note: callerId removed temporarily — VoIP.MS returns 603 Decline when
    // the customer's mobile number is used as FROM (not an authorized DID).
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip username="${voipmsUser}" password="${voipmsPass}">sip:${sipUser}@${sipServer}</Sip>
  </Dial>
</Response>`);
  }

  // --- NORMAL FLOW → Retell (Anna) ---
  try {
    const fromRaw = req.body.From || req.body.Caller || '';
    const fromNumber = fromRaw.match(/\+?\d{7,15}/)?.[0] || '';
    console.log(`Registering Retell call — From: ${fromNumber || '(unknown)'}`);

    const { call_id } = await retell.call.registerPhoneCall({
      agent_id: process.env.RETELL_AGENT_ID,
      direction: 'inbound',
      ...(fromNumber && { from_number: fromNumber }),
      ...(process.env.RETELL_PHONE_NUMBER && { to_number: process.env.RETELL_PHONE_NUMBER }),
    });

    console.log(`Retell call registered: ${call_id}`);

    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:${call_id}@sip.retellai.com</Sip>
  </Dial>
</Response>`);
  } catch (err) {
    console.error('Error registering call with Retell:', err);
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We are experiencing technical difficulties. Please call back shortly.</Say>
</Response>`);
  }
});

// Health check — also shows loaded agents (useful for debugging)
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    agents: Object.keys(AGENTS),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
