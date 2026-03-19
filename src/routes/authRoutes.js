const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { notifyAdmins } = require('../services/notificationService');

const JWT_SECRET = process.env.JWT_SECRET || 'supers3cr3t';

// REGISTER PUBLIC
router.post('/register', async (req, res) => {
    try {
        const { nombre, apellido, username, email, password } = req.body;
        
        // Auto-generar username si el frontend no lo envió (basado en el email)
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

        const usuario = await prisma.usuario.create({
            data: {
                nombre,
                apellido,
                username: finalUsername,
                email,
                password_hash,
                id_rol: 4, // Siempre USUARIO por defecto
                id_comercio_asignado: null, // Siempre NULL por defecto
                activo: true
            }
        });

        const { password_hash: _, ...userWithoutPass } = usuario;

        // Notificar a los administradores del nuevo registro
        await notifyAdmins({
            titulo: 'Nuevo Registro Público',
            mensaje: `El usuario ${nombre} ${apellido} (${email}) se ha registrado en la plataforma. Espera asignación de rol y sede.`,
            tipo: 'SYSTEM'
        });

        res.status(201).json(userWithoutPass);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error en el registro' });
    }
});

// LOGIN
router.post('/login', async (req, res) => {
    try {
        const { identifier, email, username, password } = req.body;
        const loginId = identifier || email || username;

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

module.exports = router;
