const express = require('express');
const router = express.Router();
const controller = require('../controllers/codigosProducto.controller');
const { authMiddleware: verifyToken } = require('../middlewares/authMiddleware');

// Rutas protegidas (todas asumen que requieren autenticación, si aplica el middleware global, se puede quitar de aquí)
router.get('/', verifyToken, controller.getAll);
router.get('/:id', verifyToken, controller.getById);
router.post('/', verifyToken, controller.create);
router.put('/:id', verifyToken, controller.update);
router.delete('/:id', verifyToken, controller.remove);

module.exports = router;
