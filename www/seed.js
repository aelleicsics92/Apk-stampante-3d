'use strict';
// Dati iniziali: inventario PDF + archivio stampe xlsx
// [id, colore, nuove, usate, hex, esaurito/riordina]
const SEED_F = [
  ['chocolate', 'Chocolate', 3, 1, '#5b3a29'],
  ['roasted', 'Roasted Chest.', 0, 1, '#8a5a3b'],
  ['beige', 'Beige (Rosa Chiaro)', 2, 1, '#efd5cb'],
  ['klein', 'Klein Blue', 0, 1, '#002fa7'],
  ['taro', 'Taro Purple', 2, 0, '#b9a2d8'],
  ['chocolate-solo', 'Chocolate (Solo)', 1, 0, '#5b3a29'],
  ['grigio', 'Grigio', 1, 0, '#8b9097'],
  ['magonita', 'Magonita (?)', 0, 1, '#8e7bb0'],
  ['sakura', 'Rosa (Sakura Pink)', 2, 0, '#f7c6d4'],
  ['galaxy', 'Galaxy Green / Viola', 0, 2, '#4f4a8f'],
  ['sunny', 'Sunny Orange', 2, 1, '#ff8a1f'],
  ['bone', 'Bone', 2, 1, '#eee5d0'],
  ['ice', 'Ice Blue', 2, 1, '#bfe4f3'],
  ['lavanda', 'Lavanda (Bubble)', 2, 1, '#c8b5ea'],
  ['red', 'Red', 2, 2, '#d62828'],
  ['midnight', 'Midnight', 0, 1, '#1c2541'],
  ['sage', 'Sage Green', 1, 1, '#9db38a'],
  ['mint', 'Verde Acqua (Mint)', 2, 1, '#a6e6d0'],
  ['giallo', 'Giallo', 3, 1, '#f8d21b'],
  ['blackmatt', 'Black Matt', 1, 1, '#262626'],
  ['bianco', 'Bianco', 0, 1, '#f4f4f4'],
  ['blugrey', 'Blu Grey', 1, 2, '#6f8397'],
  ['grass', 'Grass Green', 1, 1, '#3f9d46'],
  ['clay', 'Clay', 0, 2, '#b8704f', 1],
  ['oak', 'Oak', 0, 0, '#b38a58', 1],
  ['blacklucido', 'Black Lucido', 0, 0, '#0f0f0f', 1],
  ['magenta', 'Magenta', 0, 0, '#d6249f', 1],
  ['white', 'White', 0, 0, '#ffffff', 1],
];

const SEED_P = [
  ['Squirtle', 19, 'Blue, Bone, Chocolate, White'],
  ['Wartortle', 19, 'Klein Blue, Microacqua, Bone, Chocolate, White'],
  ['Togepi', 20, 'Bone, White, Black, Klein, Red, Sakura Pink'],
  ['Bastiodon', 23, 'Blue Klein, Oak, Chocolate, White, Grey'],
  ['E.T.', 35, 'Oak, Klein, Black, White'],
  ['Jiggly', 15, 'Sakura Pink, Klein, Ice Blue, Red, Black'],
  ['Cubone', 25, 'Chocolate, White Bone, White, Black, Oak'],
  ['Tony Chopper', 20, 'Sakura Pink, Red, Chocolate, White, Black, Klein, Oak, Grey'],
  ['Pantera Rosa', 15, 'Sakura, Yellow, Red, Black, White'],
  ['Groot', 20, 'Black, Sage Green, Beige, Oak, Grey'],
  ['Snoopy', 18, 'White, Black, Red'],
  ['Gatto Silvestro', 50, 'Black Widow, Opaco, Oak, Red, White, Midnight'],
];

// nome colore (xlsx) -> id filamento
const SEED_ALIAS = {
  'bone': 'bone', 'chocolate': 'chocolate', 'white': 'white', 'klein': 'klein',
  'klein blue': 'klein', 'blue klein': 'klein', 'microacqua': 'mint', 'black': 'blackmatt',
  'grey': 'grigio', 'sakura': 'sakura', 'sakura pink': 'sakura', 'red': 'red', 'oak': 'oak',
  'yellow': 'giallo', 'sage green': 'sage', 'beige': 'beige', 'midnight': 'midnight',
  'ice blue': 'ice', 'white bone': 'bone',
};

const DEF_SETTINGS = {
  kwh: 835, bolletta: 339, watt: 150, usuraOra: 0.25,
  fallimento: 10, ricarico: 2.5, costoKg: 18, soglia: 250,
};

function seedState() {
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filaments = SEED_F.map(([id, color, nuove, usate, hex, out]) => ({
    id: 'f_' + id, brand: '', type: '', color, hex, url: '', nuove, usate,
    peso: 1000, residuo: nuove * 1000 + usate * 500, costo: 0, note: '',
    riordina: out ? 1 : 0, u: 1,
  }));
  const prints = SEED_P.map(([nome, prezzo, cols]) => ({
    id: 'p_' + slug(nome), nome, prezzo, scorta: 0, minuti: 0, note: '', foto: 0, fu: 0, u: 1,
    colori: cols.split(',').map(s => s.trim()).map(n => {
      const fid = SEED_ALIAS[n.toLowerCase()];
      return { fid: fid ? 'f_' + fid : '', nome: n, g: 0 };
    }),
  }));
  return { filaments, prints, settings: { ...DEF_SETTINGS, u: 1 }, meta: { dirty: {}, photoDirty: {}, pushedAll: 0 } };
}
