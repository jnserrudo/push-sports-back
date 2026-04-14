const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const jwt = require('jsonwebtoken');

// GET /api/public/catalog
// Catálogo público B2C. Devuelve productos activos con precio al público, variantes y stock distribuido por sucursal.
router.get('/catalog', async (req, res) => {
    try {
        const productos = await prisma.producto.findMany({
            where: { activo: true },
            select: {
                id_producto: true,
                nombre: true,
                descripcion: true,
                precio_venta_sugerido: true, // Precio al público
                imagen_url: true,
                usa_variantes: true,
                marca: { select: { nombre_marca: true } },
                categoria: { select: { nombre: true } },
                variantes: {
                    where: { activo: true },
                    select: {
                        id_variante: true,
                        atributos_valores: true,
                        precio_variante: true
                    }
                },
                inventarios: {
                    select: {
                        cantidad_actual: true,
                        comercio: { select: { id_comercio: true, nombre: true } }
                    }
                }
            },
            orderBy: { nombre: 'asc' }
        });

        // Formatear el resultado para que el frontend entienda fácilmente dónde hay stock
        const catalogFormateado = productos.map(prod => {
            // Filtrar comercios donde existan más de 0 unidades
            const disponibleEn = prod.inventarios
                .filter(inv => inv.cantidad_actual > 0)
                .map(inv => ({
                    id: inv.comercio.id_comercio,
                    sucursal: inv.comercio.nombre,
                    // cantidad: inv.cantidad_actual // Opcional ocultar cantidad exacta y poner solo 'Disponible'
                }));

            return {
                id: prod.id_producto,
                nombre: prod.nombre,
                descripcion: prod.descripcion,
                precio_base: prod.precio_venta_sugerido, // Usar el campo correcto del schema
                imagen: prod.imagen_url,
                marca: prod.marca?.nombre_marca || '',
                categoria: prod.categoria?.nombre || '',
                usa_variantes: prod.usa_variantes,
                variantes: prod.variantes,
                disponibilidad: disponibleEn
            };
        });

        res.json(catalogFormateado);
    } catch (error) {
        console.error('[PUBLIC] Error GET /catalog:', error);
        res.status(500).json({ error: 'Error al obtener el catálogo público.' });
    }
});

// POST /api/public/unsubscribe
// Desuscribe a un usuario del marketing usando un JWT token (generado por el email marketer)
router.post('/unsubscribe', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token de desuscripción requerido.' });
        }

        // Verificar el token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (!decoded.email) {
             return res.status(400).json({ error: 'Token inválido (falta identificador).' });
        }

        // Buscar el usuario
        const usuario = await prisma.usuario.findUnique({
            where: { email: decoded.email }
        });

        if (!usuario) {
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        // Actualizar preferencia si no estaba ya en false para evitar múltiples escrituras
        if (usuario.acepta_marketing) {
            await prisma.usuario.update({
                where: { email: decoded.email },
                data: { acepta_marketing: false }
            });
            
            // Auto-Auditoría: Registrar el opt-out
            try {
                const { registrarAuditoria } = require('../services/auditService');
                await registrarAuditoria({
                    entidad_afectada: 'Usuario',
                    accion: 'UPDATE',
                    id_registro_afectado: usuario.id_usuario,
                    datos_anteriores: { acepta_marketing: true },
                    datos_nuevos: { acepta_marketing: false },
                    descripcion_accion: 'Opt-out de Marketing vía email automático',
                    id_usuario: usuario.id_usuario // Atribuido a la acción propia
                });
            } catch (err) {
                console.error('[PUBLIC] Error registrando auditoría de unsubscribe:', err.message);
            }
        }

        res.json({ message: 'Te has desuscrito correctamente. Ya no recibirás emails promocionales.' });
    } catch (error) {
        console.error('[PUBLIC] Error POST /unsubscribe:', error);
        if (error.name === 'TokenExpiredError') {
             return res.status(401).json({ error: 'El enlace de desuscripción ha expirado. Contacta a soporte.' });
        }
        res.status(500).json({ error: 'Error procesando la solicitud de desuscripción.' });
    }
});

// GET /api/public/sucursales
// Retorna las sucursales activas con su dirección, coordenadas e imagen.
router.get('/sucursales', async (req, res) => {
    try {
        const sucursales = await prisma.comercio.findMany({
            where: { activo: true },
            select: {
                id_comercio: true,
                nombre: true,
                direccion: true,
                latitud: true,
                longitud: true,
                imagen_url: true
            },
            orderBy: { nombre: 'asc' }
        });
        res.json(sucursales);
    } catch (error) {
        console.error('[PUBLIC] Error GET /sucursales:', error);
        res.status(500).json({ error: 'Error al obtener las sucursales.' });
    }
});

module.exports = router;
