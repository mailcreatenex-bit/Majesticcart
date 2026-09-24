/**
 * The brands the store carries, with the logo that goes in the home page carousel.
 *
 * Majestic Cart resells other companies' products, so its shelf is these names.
 * The list is a starting point: like the category tree, it is written once (see
 * CatalogService.seedBrands) and from then on the admin console owns it. Logos
 * live in the storefront's public/brands folder and are referenced by path, so
 * replacing one is just uploading a new file and changing the brand's logo.
 */
export const BRAND_SEED_KEY = 'catalog.brands.v1';

export const BRAND_SEED: { name: string; logo: string }[] = [
  { name: 'Lakmé', logo: 'lakme.png' },
  { name: 'Himalaya', logo: 'himalaya.svg' },
  { name: 'Ponds', logo: 'ponds.svg' },
  { name: 'Lotus Herbals', logo: 'lotus-herbals.png' },
  { name: 'Hindustan Unilever', logo: 'hindustan-unilever.svg' },
  { name: 'Dot & Key', logo: 'dot-and-key.svg' },
  { name: 'Maybelline New York', logo: 'maybelline.svg' },
  { name: "L'Oréal Paris", logo: 'loreal-paris.svg' },
  { name: 'Garnier', logo: 'garnier.svg' },
  { name: 'Nivea', logo: 'nivea.svg' },
  { name: 'Biotique', logo: 'biotique.png' },
  { name: 'Forest Essentials', logo: 'forest-essentials.png' },
  { name: 'Kama Ayurveda', logo: 'kama-ayurveda.png' },
  { name: 'Olay', logo: 'olay.svg' },
  { name: 'Revlon', logo: 'revlon.svg' },
  { name: 'Neutrogena', logo: 'neutrogena.svg' },
  { name: 'Vaseline', logo: 'vaseline.svg' },
  { name: 'Pantene', logo: 'pantene.svg' },
  { name: 'Gillette', logo: 'gillette.svg' },
  { name: 'Patanjali', logo: 'patanjali.svg' },
];
