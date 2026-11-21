const { Resend } = require("resend");
const { buildMapsUrl } = require("../utils/alertFormatter");

function buildAlertEmailPayload(userEmail, dependentName, emittedAt, latitude, longitude, address) {
  const dateObj = new Date(emittedAt || Date.now());
  const timeStr = dateObj.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dateStr = dateObj.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const mapsLink = buildMapsUrl(latitude, longitude);
  let locationHtml = "";
  if (address || mapsLink) {
    locationHtml = `
      <div style="margin-top: 16px; padding: 14px; background-color: #FAF6EF; border-left: 4px solid #C62828; border-radius: 4px;">
        <p style="margin: 0 0 8px; font-weight: bold; color: #1B1A17;">Localização informada:</p>
        ${address ? `<p style="margin: 0 0 10px; color: #1B1A17;">${address}</p>` : ""}
        ${
          mapsLink
            ? `<a href="${mapsLink}" target="_blank" rel="noreferrer" style="display: inline-block; padding: 10px 14px; background-color: #1F6F5C; color: #FFFFFF; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold;">Abrir localização no Google Maps</a>`
            : ""
        }
      </div>
    `;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #1B1A17; background-color: #FFFFFF;">
      <h2 style="color: #C62828; margin-top: 0;">ALERTA: ${dependentName} pediu ajuda</h2>
      <p>Olá,</p>
      <p>O perfil dependente <strong>${dependentName}</strong> acionou o botão de ajuda no Stay Safe.</p>
      <p><strong>Horário do pedido:</strong> ${dateStr} às ${timeStr} (horário de Brasília)</p>
      ${locationHtml}
      <p style="margin-top: 18px; font-weight: bold;">Abra o aplicativo Stay Safe e toque em "Estou indo" para confirmar o atendimento.</p>
      <p style="font-size: 12px; color: #635E54; margin-top: 24px;">Aviso automático enviado por e-mail pelo sistema Stay Safe.</p>
    </div>
  `;

  return {
    from: process.env.EMAIL_FROM || "Stay Safe <onboarding@resend.dev>",
    to: userEmail,
    subject: `ALERTA: ${dependentName} pediu ajuda`,
    html,
  };
}

async function sendAlertEmail(userEmail, dependentName, emittedAt, latitude, longitude, address) {
  if (!userEmail) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const payload = buildAlertEmailPayload(
    userEmail,
    dependentName,
    emittedAt,
    latitude,
    longitude,
    address
  );

  try {
    const { data, error } = await resend.emails.send(payload);
    if (error) {
      console.error("[ALERT] Erro ao enviar email", error);
    } else {
      console.info("[ALERT] Email enviado com sucesso", data);
    }
  } catch (error) {
    console.error("[ALERT] Erro ao enviar email", error);
  }
}

module.exports = { sendAlertEmail, buildAlertEmailPayload };
