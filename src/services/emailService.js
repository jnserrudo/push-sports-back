const dotenv = require('dotenv');
const validator = require('validator');

dotenv.config();
 
// Configuración
const brevoApiKey = process.env.BREVO_API_KEY;
const fromEmail = process.env.FROM_EMAIL || 'jnserrudo@gmail.com';
const fromName = process.env.FROM_NAME || 'Push Sport';

/**
 * Template HTML para email de verificación (OTP)
 */
const generateVerificationEmailTemplate = (otpCode, nombre) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { background-color: #0d0d0d; color: #ffffff; font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; }
        .container { max-width: 500px; margin: 40px auto; padding: 40px 30px; border-radius: 24px; background: linear-gradient(145deg, #161616, #0a0a0a); border: 1px solid #262626; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
        .logo { font-size: 24px; font-weight: 900; letter-spacing: -1px; color: #ffffff; margin-bottom: 30px; text-transform: uppercase; }
        .logo span { color: #00e5ff; }
        .title { font-size: 22px; font-weight: 700; margin-bottom: 16px; color: #ffffff; }
        .text { font-size: 14px; color: #a3a3a3; line-height: 1.6; margin-bottom: 30px; }
        .otp-box { background: rgba(0, 229, 255, 0.05); margin: 30px 0; padding: 30px; border-radius: 16px; border: 1px dashed rgba(0, 229, 255, 0.3); }
        .otp-code { font-size: 42px; letter-spacing: 12px; font-weight: 800; margin: 0; color: #00e5ff; text-shadow: 0 0 20px rgba(0, 229, 255, 0.2); }
        .footer { font-size: 12px; color: #525252; margin-top: 40px; border-top: 1px solid #262626; padding-top: 20px; }
        .highlight { color: #00e5ff; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">PUSH<span>SPORT</span></div>
        <div class="title">Verificación de Seguridad</div>
        <div class="text">
            Hola <span class="highlight">${nombre}</span>,<br>
            Para completar tu acceso a la plataforma, ingresa el siguiente código de verificación de 6 dígitos:
        </div>
        <div class="otp-box">
            <p class="otp-code">${otpCode}</p>
        </div>
        <div class="text" style="font-size: 12px;">
            Este código expirará en <span class="highlight">15 minutos</span>.<br>
            Si no solicitaste este código, puedes ignorar este mensaje de forma segura.
        </div>
        <div class="footer">
            © 2026 Push Sport. Sistema de Gestión Profesional.
        </div>
    </div>
</body>
</html>
`;

/**
 * Template HTML para recuperación de contraseña
 */
const generateResetPasswordTemplate = (resetLink, nombre) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { background-color: #0d0d0d; color: #ffffff; font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 0; padding: 0; }
        .container { max-width: 500px; margin: 40px auto; padding: 40px 30px; border-radius: 24px; background: linear-gradient(145deg, #161616, #0a0a0a); border: 1px solid #262626; text-align: center; }
        .logo { font-size: 24px; font-weight: 900; letter-spacing: -1px; color: #ffffff; margin-bottom: 30px; text-transform: uppercase; }
        .logo span { color: #00e5ff; }
        .title { font-size: 22px; font-weight: 700; margin-bottom: 16px; color: #ffffff; }
        .text { font-size: 14px; color: #a3a3a3; line-height: 1.6; margin-bottom: 30px; }
        .btn { display: inline-block; background-color: #00e5ff; color: #000000; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: 800; font-size: 14px; text-transform: uppercase; transition: transform 0.2s; }
        .footer { font-size: 12px; color: #525252; margin-top: 40px; border-top: 1px solid #262626; padding-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">PUSH<span>SPORT</span></div>
        <div class="title">Recuperación de Acceso</div>
        <div class="text">
            Hola ${nombre},<br>
            Hemos recibido una solicitud para restablecer tu contraseña. Haz clic en el botón de abajo para continuar:
        </div>
        <a href="${resetLink}" class="btn">Restablecer Contraseña</a>
        <div class="text" style="font-size: 12px; margin-top: 30px;">
            Este enlace es válido por <span style="color: #00e5ff;">1 hora</span>.<br>
            Si no solicitaste este cambio, ignora este correo.
        </div>
        <div class="footer">
            © 2026 Push Sport.
        </div>
    </div>
</body>
</html>
`;

/**
 * Función genérica para enviar emails vía Brevo API
 */
const sendEmail = async (to, subject, text, html) => {
    const startTime = Date.now();
    console.log(`[EMAIL] Iniciando envío a: ${to}`);
    
    try {
        if (!to || !validator.isEmail(to)) {
            throw new Error('Email inválido');
        }

        if (!brevoApiKey) {
            console.warn('[EMAIL] ⚠️ BREVO_API_KEY no configurada. El correo se logueará en consola pero no se enviará.');
            console.log(`[DEBUG-EMAIL] Destino: ${to} | Asunto: ${subject} | HTML: ${html ? 'SÍ' : 'NO'}`);
            return { success: true, simulated: true };
        }

        const emailPayload = {
            to: [{ email: to }],
            sender: { name: fromName, email: fromEmail },
            subject,
            textContent: text || undefined,
            htmlContent: html || undefined
        };

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify(emailPayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || `Error ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`[EMAIL] ✅ Enviado en ${Date.now() - startTime}ms, ID: ${data.messageId}`);
        return { success: true, messageId: data.messageId };
    } catch (error) {
        console.error(`[EMAIL] ❌ Error:`, error.message);
        throw error;
    }
};

/**
 * Enviar OTP de verificación
 */
const sendVerificationOTP = async (email, otpCode, nombre) => {
    const subject = "Push Sport - Código de Verificación";
    const html = generateVerificationEmailTemplate(otpCode, nombre);
    return await sendEmail(email, subject, `Tu código de verificación es: ${otpCode}`, html);
};

/**
 * Enviar link de recuperación de contraseña
 */
const sendResetPasswordEmail = async (email, resetToken, nombre) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password/${resetToken}`;
    const subject = "Push Sport - Restablecer Contraseña";
    const html = generateResetPasswordTemplate(resetLink, nombre);
    return await sendEmail(email, subject, `Restablece tu contraseña en: ${resetLink}`, html);
};

/**
 * Template HTML para alerta de Stock Bajo
 */
const generateLowStockAlertTemplate = (producto, sucursal, cantidad, minimo) => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { background-color: #0d0d0d; color: #ffffff; font-family: 'Inter', sans-serif; margin: 0; padding: 0; }
        .container { max-width: 500px; margin: 40px auto; padding: 40px; border-radius: 24px; background: #161616; border: 1px solid #bf360c; }
        .header { color: #ff5722; font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px; }
        .title { font-size: 24px; font-weight: 800; color: #ffffff; margin-bottom: 10px; }
        .box { background: #000000; padding: 25px; border-radius: 16px; margin: 25px 0; border-left: 4px solid #ff5722; }
        .item-row { margin-bottom: 15px; }
        .label { font-size: 10px; color: #525252; text-transform: uppercase; font-weight: 900; }
        .value { font-size: 16px; color: #ffffff; font-weight: 700; }
        .critical { color: #ff5722; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">⚠️ Alerta de Inventario Crítico</div>
        <div class="title">Stock Mínimo Alcanzado</div>
        <div class="box">
            <div class="item-row">
                <div class="label">Producto</div>
                <div class="value">${producto}</div>
            </div>
            <div class="item-row">
                <div class="label">Sucursal</div>
                <div class="value">${sucursal}</div>
            </div>
            <div class="item-row">
                <div class="label">Estado Actual</div>
                <div class="value critical">${cantidad} unidades</div>
            </div>
            <div class="item-row">
                <div class="label">Umbral Configurado</div>
                <div class="value">${minimo} unidades</div>
            </div>
        </div>
    </div>
</body>
</html>
`;

/**
 * Template para Reporte Semanal (Resumen)
 */
const generateWeeklyReportTemplate = (data, nombreAdmin) => {
    const { totalVendido, cantidadVentas, topProductos, sucursal } = data;
    const topHtml = topProductos.map(p => `
        <tr style="border-bottom: 1px solid #262626;">
            <td style="padding: 12px 0; font-size: 13px; color: #ffffff;">${p.nombre}</td>
            <td style="padding: 12px 0; font-size: 13px; color: #00e5ff; text-align: right; font-weight: 800;">${p.cantidad} uds</td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { background-color: #0d0d0d; color: #ffffff; font-family: 'Inter', sans-serif; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 40px auto; padding: 40px; border-radius: 24px; background: #161616; }
            .logo { color: #00e5ff; font-weight: 900; font-size: 18px; margin-bottom: 30px; }
            .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
            .metric-card { background: #000000; padding: 20px; border-radius: 16px; }
            .metric-label { font-size: 10px; color: #525252; text-transform: uppercase; font-weight: 900; }
            .metric-value { font-size: 20px; color: #00e5ff; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">PUSH<span>SPORT</span> // ANALYTICS</div>
            <h2 style="margin: 0; font-size: 22px;">Resumen Semanal de Operaciones</h2>
            <p style="color: #525252; font-size: 13px;">${sucursal || 'Global'} · Período últimos 7 días</p>
            
            <div style="margin: 30px 0; padding: 20px; background: #000000; border-radius: 16px;">
                <div class="metric-label">Volumen Total Vendido</div>
                <div class="metric-value" style="font-size: 32px;">$${totalVendido.toLocaleString()}</div>
                <div class="metric-label" style="margin-top: 10px;">${cantidadVentas} transacciones completadas</div>
            </div>

            <h3 style="font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #525252; margin-top: 40px;">Top Productos con más salida</h3>
            <table>
                ${topHtml}
            </table>

            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #262626; font-size: 11px; color: #525252;">
                Este reporte ha sido generado automáticamente para ${nombreAdmin}.
            </div>
        </div>
    </body>
    </html>
    `;
};

/**
 * Enviar alerta de stock bajo
 */
const sendLowStockAlert = async (emails, data) => {
    const { producto, sucursal, cantidad, minimo } = data;
    const subject = `⚠️ ALERTA: Stock Bajo en ${sucursal} - ${producto}`;
    const html = generateLowStockAlertTemplate(producto, sucursal, cantidad, minimo);
    
    // Si emails es array, enviar individualmente o vía BCC (aquí individual por simplicidad)
    const targets = Array.isArray(emails) ? emails : [emails];
    for (const email of targets) {
        await sendEmail(email, subject, `Alerta de Stock Bajo: ${producto} en ${sucursal} (${cantidad}/${minimo})`, html);
    }
};

/**
 * Enviar Reporte Semanal
 */
const sendWeeklyReport = async (email, data, nombreAdmin) => {
    const subject = `📊 Reporte Semanal Push Sport - ${data.sucursal || 'Global'}`;
    const html = generateWeeklyReportTemplate(data, nombreAdmin);
    return await sendEmail(email, subject, "Tu reporte semanal ha llegado", html);
};

/**
 * Enviar Email de Bienvenida / Verificación Exitosa
 */
const sendWelcomeEmail = async (email, nombre) => {
    const subject = "🚀 ¡Bienvenido a Push Sport! Cuenta Verificada";
    const html = `
        <div style="background:#0d0d0d; color:#fff; padding:40px; font-family:sans-serif; text-align:center;">
            <h1 style="color:#00e5ff;">¡Hola ${nombre}!</h1>
            <p>Tu cuenta ha sido verificada con éxito.</p>
            <p>Ya puedes acceder a todas las funciones profesionales de la plataforma.</p>
            <br><br>
            <small>© 2026 Push Sport</small>
        </div>
    `;
    return await sendEmail(email, subject, "Cuenta verificada con éxito", html);
};

module.exports = {
    sendEmail,
    sendVerificationOTP,
    sendResetPasswordEmail,
    sendLowStockAlert,
    sendWeeklyReport,
    sendWelcomeEmail
};
