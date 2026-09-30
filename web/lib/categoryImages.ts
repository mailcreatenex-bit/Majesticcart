/**
 * Fallback photography for a category that has no admin-uploaded image yet
 * (Category.imageUrl, set from Admin > Catalogue > Categories). Unbranded
 * stock — see public/home/CREDITS.txt — shared by the homepage tiles and
 * each category's own page so the two never show a different default photo
 * for the same category.
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  'skin-care': '/home/skin-4.jpg',
  skincare: '/home/skin-4.jpg',
  makeup: '/home/category-makeup-2.jpg',
  cosmetics: '/home/category-makeup-2.jpg',
  'hair-care': '/home/category-haircare-2.jpg',
  haircare: '/home/category-haircare-2.jpg',
  'personal-care': '/home/category-personalcare-2.jpg',
  personalcare: '/home/category-personalcare-2.jpg',
  fragrance: '/home/category-fragrance-2.jpg',
  perfume: '/home/category-fragrance-2.jpg',
  'bath-body': '/home/category-bathbody-2.jpg',
  'bath-and-body': '/home/category-bathbody-2.jpg',
  'body-care': '/home/category-bathbody-2.jpg',
  bodycare: '/home/category-bathbody-2.jpg',
};

export const categoryImage = (slug: string, imageUrl?: string | null): string | undefined =>
  imageUrl || CATEGORY_IMAGES[slug];
