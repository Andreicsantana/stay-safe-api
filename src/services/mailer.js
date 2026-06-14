const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendAlertEmail(userEmail, dependentName, emittedAt, latitude, longitude, address) {
  if (!userEmail) return;

  const timeStr = new Date(emittedAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  
  const dateStr = new Date(emittedAt).toLocaleDateString("pt-BR");

  let locationHtml = "";
  if (latitude && longitude) {
    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`;
    locationHtml = `
      <div style="margin-top: 16px; padding: 12px; background-color: #fee2e2; border-left: 4px solid #dc2626;">
        <p style="margin: 0 0 8px; font-weight: bold; color: #991b1b;">📍 Localização do Alerta:</p>
        ${address ? `<p style="margin: 0 0 8px; color: #1f2937;">${address}</p>` : ""}
        <a href="${mapsLink}" target="_blank" style="display: inline-block; padding: 8px 12px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">
          Abrir no Google Maps
        </a>
      </div>
    `;
  }

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #1f2937;">
      <h2 style="color: #dc2626;">🚨 Alerta de Emergência Acionado</h2>
      <p>Olá,</p>
      <p>O perfil dependente <strong>${dependentName}</strong> acaba de acionar o botão de socorro.</p>
      <p><strong>Horário de ativação:</strong> ${dateStr} às ${timeStr}</p>
      ${locationHtml}
      <p style="margin-top: 16px;">Por favor, verifique o aplicativo imediatamente para mais detalhes ou para tomar as ações necessárias.</p>
      <br/>
      <p style="font-size: 12px; color: #6b7280;">Este é um email automático do sistema Stay Safe.</p>
    </div>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: "Stay Safe <onboarding@resend.dev>",
      to: userEmail,
      subject: `🚨 ALERTA DE EMERGÊNCIA: ${dependentName} precisa de ajuda!`,
      html: htmlContent,
    });

    if (error) {
      console.error("[ALERT] Erro ao enviar email", error);
    } else {
      console.info("[ALERT] Email enviado com sucesso", data);
    }
  } catch (error) {
    console.error("[ALERT] Erro ao enviar email", error);
  }
}

module.exports = { sendAlertEmail };
