const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');
const { createNotification } = require('../services/notificationService');

// Listar usuarios (solo activos por defecto)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        // Solo SUPER_ADMIN puede ver inactivos si lo pide
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';
        
        const usuarios = await prisma.usuario.findMany({
            where: canSeeInactive ? {} : { activo: true },
            include: { rol: true, comercio_asignado: true }
        });
        res.json(usuarios);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// Crear usuario (Admin manual) - Protegido
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { nombre, apellido, username, email, password, id_rol, id_comercio_asignado } = req.body;

        // Validar que Supervisor (2) y Vendedor (3) tengan comercio
        if ((id_rol === 2 || id_rol === 3) && !id_comercio_asignado) {
            return res.status(400).json({ error: 'Supervisores y Vendedores deben tener un comercio asignado' });
        }

        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        const usuario = await prisma.usuario.create({
            data: {
                nombre,
                apellido,
                username: username || email, // Fallback si no hay username en el formulario
                email,
                password_hash,
                id_rol: parseInt(id_rol),
                id_comercio_asignado: (id_rol === 2 || id_rol === 3) ? id_comercio_asignado : null
            }
        });

        const { password_hash: _, ...userWithoutPass } = usuario;

        // Notificar al usuario si tiene comercio asignado
        if (id_comercio_asignado) {
            const commerce = await prisma.comercio.findUnique({ where: { id_comercio: id_comercio_asignado } });
            await createNotification({
                id_usuario: usuario.id_usuario,
                titulo: 'Nueva Sede Asignada',
                mensaje: `Se te ha asignado a la sede "${commerce?.nombre || 'Sucursal'}". Ya puedes operar en esta unidad.`,
                tipo: 'COMMERCE'
            });
        }

        res.status(201).json(userWithoutPass);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// Actualizar usuario (Promoción/Edición) - Solo SUPER_ADMIN
router.put('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apellido, username, email, id_rol, id_comercio_asignado, activo } = req.body;

        // Validar que Supervisor (2) y Vendedor (3) tengan comercio al ser promovidos o editados
        if (id_rol && (id_rol === 2 || id_rol === 3) && !id_comercio_asignado) {
            return res.status(400).json({ error: 'Para este rol es obligatorio asignar un comercio' });
        }

        const usuarioStatus = await prisma.usuario.findUnique({ where: { id_usuario: id } });
        if (!usuarioStatus) return res.status(404).json({ error: 'Usuario no encontrado' });

        const usuario = await prisma.usuario.update({
            where: { id_usuario: id },
            data: {
                nombre,
                apellido,
                username,
                email,
                id_rol: id_rol ? parseInt(id_rol) : undefined,
                id_comercio_asignado: (id_rol === 2 || id_rol === 3) ? id_comercio_asignado : (id_rol === 1 || id_rol === 4 ? null : undefined),
                activo
            }
        });

        // Notificar si cambió el comercio asignado
        if (id_comercio_asignado && id_comercio_asignado !== usuarioStatus.id_comercio_asignado) {
            const commerce = await prisma.comercio.findUnique({ where: { id_comercio: id_comercio_asignado } });
            await createNotification({
                id_usuario: id,
                titulo: 'Sede Actualizada',
                mensaje: `Se ha actualizado tu asignación a la sede "${commerce?.nombre || 'Sucursal'}".`,
                tipo: 'COMMERCE'
            });
        }

        // Notificar si cambió el rol de acceso
        if (id_rol && parseInt(id_rol) !== usuarioStatus.id_rol) {
            await createNotification({
                id_usuario: id,
                titulo: 'Permisos Actualizados',
                mensaje: `Tu nivel de acceso en la plataforma ha sido modificado por un Administrador.`,
                tipo: 'SYSTEM'
            });
        }

        res.json(usuario);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// Soft delete - Solo SUPER_ADMIN
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.usuario.update({
            where: { id_usuario: id },
            data: { activo: false }
        });
        res.json({ message: 'Usuario desactivado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
});

module.exports = router;
