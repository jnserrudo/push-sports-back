const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Basic health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API running' });
});

const prisma = require('./src/config/prisma');
const auditExtension = require('./src/services/auditService');

// Extender Prisma con el servicio de auditoría
const extendedPrisma = prisma.$extends(auditExtension);
global.prisma = extendedPrisma; // Sobrescribir para que las rutas usen el extendido

// Routes
const salesRoutes = require('./src/routes/salesRoutes');
const liquidationRoutes = require('./src/routes/liquidationRoutes');
const productRoutes = require('./src/routes/productRoutes');
const userRoutes = require('./src/routes/userRoutes');
const commerceRoutes = require('./src/routes/commerceRoutes');
const providerRoutes = require('./src/routes/providerRoutes');
const catalogRoutes = require('./src/routes/catalogRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const historyRoutes = require('./src/routes/historyRoutes');
const auditRoutes = require('./src/routes/auditRoutes');
const authRoutes = require('./src/routes/authRoutes');

app.use('/api/ventas', salesRoutes);
app.use('/api/liquidaciones', liquidationRoutes);
app.use('/api/productos', productRoutes);
app.use('/api/usuarios', userRoutes);
app.use('/api/comercios', commerceRoutes);
app.use('/api/proveedores', providerRoutes);
app.use('/api/catalogos', catalogRoutes);
app.use('/api/inventarios', inventoryRoutes);
app.use('/api/notificaciones', notificationRoutes);
app.use('/api/movimientos', historyRoutes);
app.use('/api/auditoria', auditRoutes);
app.use('/api', authRoutes);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
