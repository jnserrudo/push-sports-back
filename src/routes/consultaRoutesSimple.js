const express = require('express');
const router = express.Router();
const consultaControllerSimple = require('../controllers/consultaControllerSimple');
const authMiddleware = require('../middlewares/authMiddleware');

// Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware);

// GET /api/consultas - Listar consultas con filtros y paginación
router.get('/', consultaControllerSimple.listarConsultas);

// GET /api/consultas/estadisticas/resumen - Obtener estadísticas
router.get('/estadisticas/resumen', consultaControllerSimple.obtenerEstadisticas);

// GET /api/consultas/notificaciones/pendientes - Obtener consultas pendientes para badge
router.get('/notificaciones/pendientes', consultaControllerSimple.obtenerConsultasPendientes);

// GET /api/consultas/:id - Obtener consulta por ID
router.get('/:id', consultaControllerSimple.obtenerConsulta);

// PUT /api/consultas/:id/estado - Actualizar estado de consulta
router.put('/:id/estado', consultaControllerSimple.actualizarEstado);

// DELETE /api/consultas/:id - Eliminar consulta
router.delete('/:id', consultaControllerSimple.eliminarConsulta);

module.exports = router;
