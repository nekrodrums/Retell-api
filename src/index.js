import express from 'express';
import Retell from 'retell-sdk';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });
const PORT = process.env.PORT || 3000;

/**
 * POST /incoming-call
 *
 * Twilio SIP Domain calls this webhook when VoIP.MS dials in via SIP URI.
 * We register the call with Retell and return a TwiML response that bridges
 * Twilio directly to Retell's SIP endpoint using the registered call_id.
 *
 * Flow:
 *   VoIP.MS IVR (opt 3/7/8/9)
 *     → sip:anna@[domain].sip.twilio.com
 *     → Twilio SIP Domain → POST /incoming-call
 *     → Retell registers call → returns call_id
 *     → TwiML: <Dial><Sip>sip:{call_id}@sip.retellai.com</Sip></Dial>
 *     → Twilio bridges to Retell → Anna answers
 */
app.post('/incoming-call', async (req, res) => {
  try {
    const { call_id } = await retell.call.registerPhoneCall({
      agent_id: process.env.RETELL_AGENT_ID,
      direction: 'inbound',
    });

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Sip>sip:${call_id}@sip.retellai.com</Sip>
  </Dial>
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('Error registering call with Retell:', err);
    // Fallback: play a message so the caller isn't left in silence
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We are experiencing technical difficulties. Please call back shortly.</Say>
</Response>`);
  }
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
