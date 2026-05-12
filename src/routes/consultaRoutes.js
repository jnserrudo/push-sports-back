const express = require('express');
const router = express.Router();
const consultaController = require('../controllers/consultaController');
const { body } = require('express-validator');
const { authMiddleware } = require('../middlewares/authMiddleware');

// Validaciones para crear consulta
const crearConsultaValidations = [
  body('nombre_cliente')
    .trim()
    .notEmpty()
    .withMessage('El nombre del cliente es requerido')
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  
  body('telefono_cliente')
    .trim()
    .notEmpty()
    .withMessage('El teléfono del cliente es requerido')
    .matches(/^\+?[\d\s-]{8,}$/)
    .withMessage('El teléfono no es válido'),
  
  body('email_cliente')
    .optional()
    .trim()
    .isEmail()
    .withMessage('El email no es válido')
    .normalizeEmail(),
  
  body('id_sucursal')
    .notEmpty()
    .withMessage('La sucursal es requerida')
    .isUUID()
    .withMessage('ID de sucursal no válido'),
  
  body('metodo_entrega')
    .isIn(['retiro', 'envio'])
    .withMessage('El método de entrega debe ser "retiro" o "envio"'),
  
  body('comentarios')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Los comentarios no pueden superar los 500 caracteres'),
  
  body('items')
    .isArray({ min: 1 })
    .withMessage('Debe incluir al menos un producto'),
  
  body('items.*.id_producto')
    .notEmpty()
    .withMessage('El ID del producto es requerido')
    .isUUID()
    .withMessage('ID de producto no válido'),
  
  body('items.*.nombre_producto')
    .trim()
    .notEmpty()
    .withMessage('El nombre del producto es requerido'),
  
  body('items.*.cantidad')
    .isInt({ min: 1 })
    .withMessage('La cantidad debe ser un número entero mayor a 0'),
  
  body('items.*.precio_unitario')
    .isFloat({ min: 0 })
    .withMessage('El precio unitario debe ser un número mayor o igual a 0'),
  
  body('total')
    .isFloat({ min: 0 })
    .withMessage('El total debe ser un número mayor o igual a 0'),
  
  body('cantidad_items')
    .isInt({ min: 1 })
    .withMessage('La cantidad de items debe ser un número entero mayor a 0')
];

// Validaciones para actualizar estado
const actualizarEstadoValidations = [
  body('estado')
    .isIn(['PENDIENTE', 'EN_PROCESO', 'CONFIRMADO', 'CANCELADO'])
    .withMessage('Estado no válido')
];

// Validaciones para convertir a venta
const convertirAVentaValidations = [
  body('metodo_pago')
    .optional()
    .isIn(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'MERCADO_PAGO', 'OTRO'])
    .withMessage('Método de pago no válido'),
  
  body('observaciones')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Las observaciones no pueden superar los 500 caracteres')
];

// RUTAS PÚBLICAS (sin autenticación)
router.post('/', crearConsultaValidations, consultaController.crearConsulta);

// RUTAS PROTEGIDAS (requieren autenticación)
router.use(authMiddleware);

// Listar consultas con filtros y paginación
router.get('/', consultaController.listarConsultas);

// Obtener detalle de una consulta específica
router.get('/:id', consultaController.obtenerConsulta);

// Actualizar estado de consulta
router.put('/:id/estado', actualizarEstadoValidations, consultaController.actualizarEstado);

// Convertir consulta a venta
router.post('/:id/convertir-venta', convertirAVentaValidations, consultaController.convertirAVenta);

// Eliminar consulta
router.delete('/:id', consultaController.eliminarConsulta);

// Obtener estadísticas
router.get('/estadisticas/resumen', consultaController.obtenerEstadisticas);

// Obtener consultas pendientes para badge de notificaciones
router.get('/notificaciones/pendientes', consultaController.obtenerPendientes);

module.exports = router;
