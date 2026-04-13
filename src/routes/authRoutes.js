const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { notifyAdmins } = require('../services/notificationService');
const { sendVerificationOTP, sendResetPasswordEmail, sendWelcomeEmail } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET no está definido en las variables de entorno.');
    process.exit(1);
}

// In-memory rate limiting simple
const rateLimits = new Map();
function checkRateLimit(key, limitMinutes = 2) {
    const now = Date.now();
    const lastAttempt = rateLimits.get(key);
    if (lastAttempt && now - lastAttempt < limitMinutes * 60 * 1000) {
        return false;
    }
    rateLimits.set(key, now);
    return true;
}

/**
 * Valida el token de Cloudflare Turnstile
 */
async function validateTurnstile(token, ip) {
    const SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
    if (!SECRET_KEY) {
        console.warn('⚠️ TURNSTILE_SECRET_KEY no configurada. Saltando validación (solo en desarrollo).');
        return true;
    }

    try {
        const formData = new URLSearchParams();
        formData.append('secret', SECRET_KEY);
        formData.append('response', token);
        formData.append('remoteip', ip);

        const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData
        });

        const outcome = await result.json();
        return outcome.success;
    } catch (err) {
        console.error('Error validando Turnstile:', err);
        return false;
    }
}

/**
 * Genera un código numérico aleatorio de 6 dígitos
 */
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// REGISTER PUBLIC (con OTP y Turnstile)
router.post('/register', async (req, res) => {
    try {
        const { nombre, apellido, username, email, password, captchaToken } = req.body;
        
        // 1. Validar Turnstile
        const isHuman = await validateTurnstile(captchaToken, req.ip);
        if (!isHuman) {
            return res.status(403).json({ error: 'Fallo la verificación de seguridad (Captcha)' });
        }

        if (!email || !password || !nombre) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }
        
        // Auto-generar username si el frontend no lo envió
        const finalUsername = username || email.split('@')[0];

        // Validar si ya existe
        const existingUser = await prisma.usuario.findFirst({
            where: { OR: [{ email }, { username: finalUsername }] }
        });
        if (existingUser) {
            return res.status(400).json({ error: 'El usuario o email ya existe' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // Generar OTP
        const otpCode = generateOTP();
        const otpExpira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

        const usuario = await prisma.usuario.create({
            data: {
                nombre,
                apellido,
                username: finalUsername,
                email,
                password_hash,
                id_rol: 4, 
                id_comercio_asignado: null,
                activo: true,
                email_verificado: false,
                otp_code: otpCode,
                otp_expira_en: otpExpira
            }
        });

        // Intentar enviar email (no bloqueante para el flujo, pero logueamos)
        try {
            await sendVerificationOTP(email, otpCode, nombre);
        } catch (mailErr) {
            console.error('Error enviando mail de bienvenida:', mailErr.message);
        }

        const { password_hash: _, ...userWithoutPass } = usuario;

        // Notificar a admins
        await notifyAdmins({
            titulo: 'Nuevo Registro (Pendiente Verificación)',
            mensaje: `El usuario ${nombre} ${apellido} (${email}) se ha registrado.`,
            tipo: 'SYSTEM'
        });

        res.status(201).json({ 
            user: userWithoutPass,
            message: 'Registro exitoso. Revisa tu email para el código de verificación.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error en el registro' });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { identifier, email, username, password, captchaToken } = req.body;
        const loginId = identifier || email || username;

        // 1. Validar Turnstile
        const isHuman = await validateTurnstile(captchaToken, req.ip);
        if (!isHuman) {
            return res.status(403).json({ error: 'Fallo la verificación de seguridad (Captcha)' });
        }

        if (!loginId || !password) {
            return res.status(400).json({ error: 'Falta identificador (email/username) o contraseña' });
        }

        const usuario = await prisma.usuario.findFirst({
            where: {
                OR: [{ email: loginId }, { username: loginId }],
                activo: true
            },
            include: { rol: true }
        });

        if (!usuario) {
            return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
        }

        // VALIDACIÓN DE EMAIL
        if (!usuario.email_verificado) {
            return res.status(403).json({ 
                error: 'Debes verificar tu email antes de ingresar',
                needsVerification: true,
                email: usuario.email
            });
        }

        const isMatch = await bcrypt.compare(password, usuario.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }

        // Generar JWT con el payload requerido
        const payload = {
            id_usuario: usuario.id_usuario,
            id_rol: usuario.id_rol,
            rol_nombre: usuario.rol.nombre_rol,
            id_comercio_asignado: usuario.id_comercio_asignado
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

        // Incluir datos completos del usuario en la respuesta (sin la contraseña)
        const userResponse = {
            ...payload,
            nombre: usuario.nombre,
            apellido: usuario.apellido,
            email: usuario.email,
            username: usuario.username,
        };

        res.json({ token, user: userResponse });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error en el login' });
    }
});

// VERIFICAR OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        if (!email || !otp) {
            return res.status(400).json({ error: 'Email y código requeridos' });
        }

        const usuario = await prisma.usuario.findUnique({
            where: { email }
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (usuario.email_verificado) {
            return res.status(400).json({ error: 'El email ya está verificado' });
        }

        if (usuario.otp_code !== otp) {
            return res.status(400).json({ error: 'Código inválido' });
        }

        if (new Date() > usuario.otp_expira_en) {
            return res.status(400).json({ error: 'El código ha expirado' });
        }

        // Activar usuario
        await prisma.usuario.update({
            where: { email },
            data: {
                email_verificado: true,
                otp_code: null,
                otp_expira_en: null
            }
        });

        // Email de Bienvenida (Verificación Exitosa)
        try {
            await sendWelcomeEmail(email, usuario.nombre);
        } catch (mailErr) {
            console.error('Error enviando mail de bienvenida:', mailErr.message);
        }

        res.json({ message: 'Cuenta verificada con éxito. Ya puedes iniciar sesión.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al verificar OTP' });
    }
});

// REENVIAR OTP
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email requerido' });

        // Rate Limit
        if (!checkRateLimit(`otp-${email}`, 2)) {
            return res.status(429).json({ error: 'Espera 2 minutos antes de solicitar otro código' });
        }

        const usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

        if (usuario.email_verificado) {
            return res.status(400).json({ error: 'Tu email ya está verificado' });
        }

        const newOtp = generateOTP();
        const newExp = new Date(Date.now() + 15 * 60 * 1000);

        await prisma.usuario.update({
            where: { email },
            data: { otp_code: newOtp, otp_expira_en: newExp }
        });

        await sendVerificationOTP(email, newOtp, usuario.nombre);

        res.json({ message: 'Código reenviado. Revisa tu bandeja de entrada.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al reenviar código' });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ error: 'Email requerido' });
        }

        // Rate Limit
        if (!checkRateLimit(`reset-${email}`, 5)) {
            return res.status(429).json({ error: 'Espera 5 minutos antes de otra solicitud' });
        }

        const usuario = await prisma.usuario.findFirst({
            where: { email, activo: true }
        });
        
        if (!usuario) {
            return res.json({ message: 'Si el email existe, recibirás instrucciones' });
        }
        
        const token = crypto.randomBytes(32).toString('hex');
        const expiraEn = new Date(Date.now() + 3600000); 
        
        await prisma.passwordResetToken.create({
            data: {
                id_usuario: usuario.id_usuario,
                token,
                expira_en: expiraEn
            }
        });
        
        // ENVIO REAL DE EMAIL
        try {
            await sendResetPasswordEmail(email, token, usuario.nombre);
        } catch (mailErr) {
            console.error('Error enviando reset email:', mailErr.message);
        }
        
        res.json({ message: 'Si el email existe, recibirás instrucciones para recuperar tu contraseña' });
    } catch (error) {
        console.error('Error en forgot-password:', error);
        res.status(500).json({ error: 'Error al procesar solicitud' });
    }
});

// RESET PASSWORD
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
        }

        const resetToken = await prisma.passwordResetToken.findUnique({
            where: { token },
            include: { usuario: true }
        });

        if (!resetToken || resetToken.expira_en < new Date()) {
            return res.status(400).json({ error: 'El token es inválido o ha expirado' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(newPassword, salt);

        await prisma.$transaction([
            prisma.usuario.update({
                where: { id_usuario: resetToken.id_usuario },
                data: { password_hash }
            }),
            prisma.passwordResetToken.delete({
                where: { id: resetToken.id }
            })
        ]);

        res.json({ message: 'Contraseña actualizada con éxito' });
    } catch (error) {
        console.error('Error en reset-password:', error);
        res.status(500).json({ error: 'Error al restablecer contraseña' });
    }
});


module.exports = router;
