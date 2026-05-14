import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function fetchTodaysCalls() {
  // Today in MDT (UTC-6): midnight MDT = 06:00 UTC
  const now = new Date();
  const msSinceMidnightMDT = (now.getUTCHours() * 60 + now.getUTCMinutes()) * 60000
    + now.getUTCSeconds() * 1000 - 6 * 3600000;
  const startUTC = new Date(now.getTime() - ((msSinceMidnightMDT % 86400000) + 86400000) % 86400000);
  startUTC.setUTCHours(6, 0, 0, 0); // midnight MDT = 06:00 UTC

  const endUTC = new Date(startUTC.getTime() + 24 * 3600000);

  const res = await fetch('https://api.retellai.com/v2/list-calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter_criteria: {
        agent_id: [process.env.RETELL_AGENT_ID],
        after_start_timestamp: startUTC.getTime(),
        before_start_timestamp: endUTC.getTime(),
      },
      limit: 100,
      sort_order: 'ascending',
    }),
  });

  if (!res.ok) throw new Error(`Retell API error: ${res.status}`);
  return res.json();
}

function toMDT(ts) {
  const d = new Date(ts - 6 * 3600000);
  return d.toISOString().slice(11, 16); // HH:MM
}

function buildHtml(calls, dateStr) {
  const total   = calls.length;
  const phone   = calls.filter(c => c.call_type === 'phone_call').length;
  const web     = calls.filter(c => c.call_type === 'web_call').length;
  const ok      = calls.filter(c => c.call_analysis?.call_successful === true).length;
  const fail    = calls.filter(c => c.call_analysis?.call_successful === false).length;
  const xfer    = calls.filter(c => c.disconnection_reason === 'call_transfer').length;
  const totalMin = Math.round(calls.reduce((s, c) => s + (c.duration_ms || 0), 0) / 60000);

  const maxDur  = calls.filter(c => c.disconnection_reason === 'max_duration_reached');
  const negSent = calls.filter(c => c.call_analysis?.user_sentiment === 'Negative');

  const row = (label, value) =>
    `<tr><td style="padding:6px 12px;border:1px solid #ddd"><b>${label}</b></td><td style="padding:6px 12px;border:1px solid #ddd">${value}</td></tr>`;

  let html = `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
  <h2 style="color:#1a1a1a">📞 ERA AI — Reporte Diario ${dateStr}</h2>

  <table style="border-collapse:collapse;width:100%;margin-bottom:24px">
    ${row('Total llamadas', `${total} &nbsp;(${phone} tel / ${web} web)`)}
    ${row('Exitosas', `✅ ${ok}`)}
    ${row('Fallidas', `❌ ${fail}`)}
    ${row('Transferidas exitosamente', `🔁 ${xfer}`)}
    ${row('Duración total', `~${totalMin} min`)}
  </table>
`;

  if (maxDur.length > 0) {
    html += `<h3 style="color:#c0392b">⚠️ Cortadas por tiempo máximo (posibles leads perdidos)</h3><ul>`;
    for (const c of maxDur) {
      const s = c.call_analysis?.call_summary || '(sin resumen)';
      html += `<li style="margin-bottom:6px">${s.substring(0, 250)}</li>`;
    }
    html += `</ul>`;
  }

  if (negSent.length > 0) {
    html += `<h3 style="color:#e67e22">😟 Sentiment negativo</h3><ul>`;
    for (const c of negSent) {
      const s = c.call_analysis?.call_summary || '(sin resumen)';
      html += `<li style="margin-bottom:6px">${s.substring(0, 250)}</li>`;
    }
    html += `</ul>`;
  }

  html += `<h3>📋 Todas las llamadas</h3>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <tr style="background:#f5f5f5">
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Hora MDT</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Dur.</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">OK</th>
      <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Resumen</th>
    </tr>`;

  for (const c of calls) {
    const t    = toMDT(c.start_timestamp);
    const dur  = Math.round((c.duration_ms || 0) / 1000) + 's';
    const flag = c.call_analysis?.call_successful === true ? '✅' : '❌';
    const sum  = (c.call_analysis?.call_summary || '').substring(0, 140);
    const bg   = c.disconnection_reason === 'max_duration_reached' ? '#fff3cd' : '';
    html += `<tr style="background:${bg}">
      <td style="padding:5px 8px;border:1px solid #ddd">${t}</td>
      <td style="padding:5px 8px;border:1px solid #ddd;white-space:nowrap">${dur}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${flag}</td>
      <td style="padding:5px 8px;border:1px solid #ddd">${sum}</td>
    </tr>`;
  }

  html += `</table>
  <p style="color:#888;font-size:12px;margin-top:24px">Generado automáticamente por ERA Railway Server · ${dateStr} 9pm MDT</p>
</div>`;

  return html;
}

export async function sendDailyReport() {
  try {
    const now     = new Date();
    const dateStr = new Date(now.getTime() - 6 * 3600000).toISOString().slice(0, 10);

    console.log(`[DailyReport] Fetching calls for ${dateStr}...`);
    const calls = await fetchTodaysCalls();
    console.log(`[DailyReport] ${calls.length} calls found — sending email...`);

    const { data, error } = await resend.emails.send({
      from: 'ERA AI Report <onboarding@resend.dev>',
      to: ['anna.ai@era.ca'],
      subject: `📞 ERA AI — Reporte ${dateStr} (${calls.length} llamadas)`,
      html: buildHtml(calls, dateStr),
    });

    if (error) {
      console.error('[DailyReport] Email error:', error);
    } else {
      console.log('[DailyReport] Email sent — id:', data?.id);
    }
  } catch (err) {
    console.error('[DailyReport] Fatal error:', err);
  }
}
