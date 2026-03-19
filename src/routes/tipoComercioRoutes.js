const express = require('express');
const router = express.Router();
const tipoComercioController = require('../controllers/tipoComercioController');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Get all
router.get('/', authMiddleware, tipoComercioController.getTiposComercio);

// Get single
router.get('/:id', authMiddleware, tipoComercioController.getTipoComercioById);

// Create (Admin only)
router.post('/', authMiddleware, roleMiddleware([1, 2]), tipoComercioController.createTipoComercio);

// Update (Admin only)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), tipoComercioController.updateTipoComercio);

// Delete (Admin only)
router.delete('/:id', authMiddleware, roleMiddleware([1, 2]), tipoComercioController.deleteTipoComercio);

module.exports = router;
