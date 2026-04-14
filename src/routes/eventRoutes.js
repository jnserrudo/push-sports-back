const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// RUTAS PÚBLICAS (sin token — para la landing page del QR)
router.get('/:id', eventController.getEventById);

// RUTAS PROTEGIDAS (requieren login)
router.use(authMiddleware);

router.get('/', eventController.getEvents);
router.post('/', roleMiddleware([1, 2]), eventController.createEvent);
router.put('/:id', roleMiddleware([1, 2]), eventController.updateEvent);
router.delete('/:id', roleMiddleware([1]), eventController.deleteEvent);

module.exports = router;
