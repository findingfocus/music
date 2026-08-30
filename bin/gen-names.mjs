#!/usr/bin/env node
const LANDMARKS = [
  // Sangre de Cristo / Pecos
  'wheeler', 'truchas', 'venado', 'jicarita', 'picuris', 'lake', 'santa fe baldy',
  'penitente', 'gold hill', 'lobo', 'hermit', 'pecos baldy', 'comanche', 'chimayosos', 'trampas',
  // Jemez / Valles Caldera
  'chicoma', 'redondo', 'cerro grande', 'cerro caballo',
  // Sandia
  'sandia', 'north sandia', 'south sandia',
  // Manzano
  'manzano', 'mosca', 'gallo', 'capilla', 'bosque',
  // Mt Taylor / Zuni
  'taylor', 'sedgwick', 'cerro alto', 'bandera',
  // Nacimiento
  'pelon', 'polvadera',
  // Mogollon
  'whitewater', 'mogollon',
  // Black Range
  'mcknight', 'reeds', 'hillsboro',
  // Magdalena
  'south baldy', 'north baldy',
  // San Mateo
  'san mateo', 'vicks',
  // Organ / Doña Ana
  'organ', 'sugarloaf', 'dona ana',
  // Sacramento / Sierra Blanca
  'sierra blanca', 'sacramento', 'lookout', 'cat',
  // Guadalupe
  'el capitan', 'lost',
  // San Andres
  'san andres', 'salinas', 'nicoll',
  // Caballo / Fra Cristobal
  'caballo', 'fra cristobal',
  // Capitan / Sierra Oscura
  'capitan', 'nogal', 'tularosa', 'oscura',
  // Volcanic landmarks
  'sierra grande', 'shiprock', 'cabezon', 'capulin',
  // Big landforms
  'enchanted mesa', 'white sands', 'tent rocks', 'el morro', 'bisti', 'ah shi sle pah',
  'frijoles', 'chaco', 'brazos', 'jicarilla', 'zuni', 'acoma', 'mesilla', 'tijeras',
  'cerrillos', 'pedernal', 'chama', 'la bajada', 'malpais', 'city of rocks',
  'valley of fires', 'otero', 'chupadera', 'gran quivira', 'tecolote', 'robledo', 'granite'
];

const PROCESS = [
  'drift', 'oscillation', 'snowmelt', 'monsoon', 'erosion', 'uplift', 'mirage', 'resonance',
  'strata', 'fissure', 'talus', 'arroyo', 'playa', 'rincon', 'convection', 'refraction',
  'diffraction', 'sediment', 'eruption', 'gradient', 'caprock', 'mesa', 'canyon', 'pinnacle', 'wind'
];

function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

const L = LANDMARKS.length;
const P = PROCESS.length;
const TOTAL = L * P;
const rows = [];
for (let idx = 1; idx <= TOTAL; idx++) {
  const l = LANDMARKS[(idx - 1) % L];
  const pr = PROCESS[Math.floor((idx - 1) / L) % P];
  rows.push({ index: idx, landmark: l, process: pr, title: `${titleCase(l)} ${titleCase(pr)}` });
}
const out = { generated_at: new Date().toISOString(), landmarks: L, process: P, total: TOTAL, names: rows };
console.log(JSON.stringify(out, null, 2));