import { FRLG_SPECIES_METADATA } from '../frlgMetadata';

const sprites = import.meta.glob('../assets/frlg-targets/*/*.png', { eager: true, query: '?url&no-inline', import: 'default' }) as Record<string, string>;

export function FrlgSprite({ species, shiny = false }: { species: string; shiny?: boolean }) {
  const id = FRLG_SPECIES_METADATA[species as keyof typeof FRLG_SPECIES_METADATA]?.id;
  const src = sprites[`../assets/frlg-targets/${shiny ? 'shiny' : 'normal'}/${id}.png`];
  return src ? <img className="frlg-sprite" src={src} alt="" aria-hidden="true" /> : <span aria-hidden="true">◎</span>;
}
