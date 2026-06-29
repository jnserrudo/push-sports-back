const { seedTiposYMotivos } = require('../src/services/rectificationService');

async function main() {
  console.log('🌱 Seed de tipos y motivos de rectificación...');
  try {
    const resultado = await seedTiposYMotivos();
    console.log('✅ Seed completado:', resultado.message);
  } catch (error) {
    console.error('❌ Error en el seed de rectificaciones:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); });
