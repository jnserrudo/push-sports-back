const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Obtener todos los eventos (Para Admin)
const getEvents = async (req, res) => {
    try {
        const events = await prisma.evento.findMany({
            orderBy: { created_at: 'desc' }
        });
        // Agregar conteo de leads (usuarios captados) a cada evento
        const eventosConLeads = await Promise.all(events.map(async (evento) => {
            const count = await prisma.usuario.count({
                where: { id_evento_origen: evento.id_evento }
            });
            return { ...evento, leads: count };
        }));

        res.json(eventosConLeads);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Error al obtener eventos' });
    }
};

// Obtener un solo evento por ID (Público, para la landing de registro)
const getEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const evento = await prisma.evento.findUnique({
            where: { id_evento: id }
        });
        if (!evento) {
            return res.status(404).json({ error: 'Evento no encontrado' });
        }
        res.json(evento);
    } catch (error) {
        // Podría ser un error de sintaxis UUID, retornar 404 seguro
        res.status(404).json({ error: 'Evento no válido' });
    }
};

// Crear evento
const createEvent = async (req, res) => {
    try {
        const { nombre, recompensa_texto, fecha_inicio, fecha_fin, activo } = req.body;
        const evento = await prisma.evento.create({
            data: { 
                nombre, 
                recompensa_texto,
                fecha_inicio: fecha_inicio ? new Date(fecha_inicio) : null,
                fecha_fin: fecha_fin ? new Date(fecha_fin) : null,
                activo: activo !== undefined ? activo : true
            }
        });
        res.status(201).json(evento);
    } catch (error) {
        console.error('Error creating event:', error);
        res.status(500).json({ error: 'Error al crear evento' });
    }
};

// Actualizar evento
const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, recompensa_texto, fecha_inicio, fecha_fin, activo } = req.body;
        const evento = await prisma.evento.update({
            where: { id_evento: id },
            data: { 
                nombre, 
                recompensa_texto,
                fecha_inicio: fecha_inicio ? new Date(fecha_inicio) : null,
                fecha_fin: fecha_fin ? new Date(fecha_fin) : null,
                activo
            }
        });
        res.json(evento);
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ error: 'Error al actualizar evento' });
    }
};

// Eliminar evento
const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        // Checkear si hay leads
        const count = await prisma.usuario.count({
            where: { id_evento_origen: id }
        });
        if (count > 0) {
            return res.status(400).json({ error: `No se puede eliminar porque tiene ${count} leads capturados asociados.` });
        }
        await prisma.evento.delete({
            where: { id_evento: id }
        });
        res.json({ message: 'Evento eliminado con éxito' });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Error al eliminar evento' });
    }
};

module.exports = {
    getEvents,
    getEventById,
    createEvent,
    updateEvent,
    deleteEvent
};
