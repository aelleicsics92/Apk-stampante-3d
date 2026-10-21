'use strict';
// Nessun dato nell'APK: magazzino e stampe vivono solo nel database cloud.
const DEF_SETTINGS = {
  kwh: 835, bolletta: 339, watt: 150, usuraOra: 0.25,
  fallimento: 10, ricarico: 2.5, costoKg: 18, soglia: 250,
};
function seedState() {
  return { filaments: [], prints: [], settings: { ...DEF_SETTINGS, u: 1 }, meta: { dirty: {}, photoDirty: {}, pushedAll: 0 } };
}
