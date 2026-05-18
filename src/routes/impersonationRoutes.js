const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Iniciar impersonación (solo admin)
router.post('/start', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id_usuario_impersonar } = req.body;
        const adminUser = req.user;

        if (!id_usuario_impersonar) {
            return res.status(400).json({ error: 'Se requiere el ID del usuario a impersonar' });
        }

        // Buscar el usuario a impersonar
        const usuarioImpersonar = await prisma.usuario.findUnique({
            where: { id_usuario: id_usuario_impersonar },
            include: { 
                rol: true,
                comercio_asignado: true
            }
        });

        if (!usuarioImpersonar) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (!usuarioImpersonar.activo) {
            return res.status(400).json({ error: 'No se puede impersonar un usuario inactivo' });
        }

        // No permitir impersonar a otro admin
        if (usuarioImpersonar.id_rol === 1) {
            return res.status(403).json({ error: 'No se puede impersonar a otro administrador' });
        }

        // Crear nuevo token con información de impersonación
        const tokenPayload = {
            id_usuario: adminUser.id_usuario,
            email: adminUser.email,
            id_rol: 1, // Mantener rol admin en el token base
            impersonation: {
                realUserId: adminUser.id_usuario,
                realUserEmail: adminUser.email,
                realUserName: `${adminUser.nombre || ''} ${adminUser.apellido || ''}`.trim(),
                impersonatedUserId: usuarioImpersonar.id_usuario,
                impersonatedUserEmail: usuarioImpersonar.email,
                impersonatedUserName: `${usuarioImpersonar.nombre} ${usuarioImpersonar.apellido}`,
                impersonatedUserRol: usuarioImpersonar.id_rol,
                impersonatedUserComercio: usuarioImpersonar.id_comercio_asignado
            }
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

        // Preparar datos del usuario impersonado para el frontend
        const impersonatedUserData = {
            id_usuario: usuarioImpersonar.id_usuario,
            nombre: usuarioImpersonar.nombre,
            apellido: usuarioImpersonar.apellido,
            email: usuarioImpersonar.email,
            id_rol: usuarioImpersonar.id_rol,
            id_comercio_asignado: usuarioImpersonar.id_comercio_asignado,
            comercio_asignado: usuarioImpersonar.comercio_asignado,
            rol: usuarioImpersonar.rol
        };

        res.json({
            message: 'Impersonación iniciada exitosamente',
            token,
            impersonatedUser: impersonatedUserData,
            realUser: {
                id_usuario: adminUser.id_usuario,
                nombre: adminUser.nombre,
                apellido: adminUser.apellido,
                email: adminUser.email
            }
        });

    } catch (error) {
        console.error('Error al iniciar impersonación:', error);
        res.status(500).json({ error: 'Error al iniciar impersonación' });
    }
});

// Detener impersonación
router.post('/stop', authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;

        // Verificar si hay impersonación activa
        if (!currentUser.impersonation) {
            return res.status(400).json({ error: 'No hay impersonación activa' });
        }

        const realUserId = currentUser.impersonation.realUserId;

        // Buscar el usuario admin original
        const adminUser = await prisma.usuario.findUnique({
            where: { id_usuario: realUserId },
            include: { 
                rol: true,
                comercio_asignado: true
            }
        });

        if (!adminUser) {
            return res.status(404).json({ error: 'Usuario administrador no encontrado' });
        }

        // Crear token normal sin impersonación
        const tokenPayload = {
            id_usuario: adminUser.id_usuario,
            email: adminUser.email,
            id_rol: adminUser.id_rol,
            nombre: adminUser.nombre,
            apellido: adminUser.apellido,
            id_comercio_asignado: adminUser.id_comercio_asignado
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

        const { password_hash, ...userWithoutPass } = adminUser;

        res.json({
            message: 'Impersonación detenida exitosamente',
            token,
            user: userWithoutPass
        });

    } catch (error) {
        console.error('Error al detener impersonación:', error);
        res.status(500).json({ error: 'Error al detener impersonación' });
    }
});

// Obtener estado actual de impersonación
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const currentUser = req.user;

        if (!currentUser.impersonation) {
            return res.json({
                isImpersonating: false,
                impersonatedUser: null,
                realUser: null
            });
        }

        // Buscar datos actualizados del usuario impersonado
        const impersonatedUser = await prisma.usuario.findUnique({
            where: { id_usuario: currentUser.impersonation.impersonatedUserId },
            include: { 
                rol: true,
                comercio_asignado: true
            }
        });

        const realUser = await prisma.usuario.findUnique({
            where: { id_usuario: currentUser.impersonation.realUserId },
            select: {
                id_usuario: true,
                nombre: true,
                apellido: true,
                email: true,
                id_rol: true
            }
        });

        res.json({
            isImpersonating: true,
            impersonatedUser: impersonatedUser ? {
                id_usuario: impersonatedUser.id_usuario,
                nombre: impersonatedUser.nombre,
                apellido: impersonatedUser.apellido,
                email: impersonatedUser.email,
                id_rol: impersonatedUser.id_rol,
                id_comercio_asignado: impersonatedUser.id_comercio_asignado,
                comercio_asignado: impersonatedUser.comercio_asignado,
                rol: impersonatedUser.rol
            } : null,
            realUser
        });

    } catch (error) {
        console.error('Error al obtener estado de impersonación:', error);
        res.status(500).json({ error: 'Error al obtener estado de impersonación' });
    }
});

module.exports = router;
