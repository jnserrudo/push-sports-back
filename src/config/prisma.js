const { PrismaClient } = require('@prisma/client');
const { auditExtension } = require('../services/auditService');

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
//
// Learn more:
// https://pris.ly/d/help/next-js-best-practices

const globalForPrisma = global;

// Crear PrismaClient con extensión de auditoría
const createPrismaClient = () => {
    const client = new PrismaClient({
        log: ['query', 'info', 'warn', 'error'],
    });
    
    // Aplicar extensión de auditoría
    return client.$extends(auditExtension);
};

const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

module.exports = prisma;
