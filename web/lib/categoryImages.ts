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
  makeup: '/home/editorial-6.jpg',
  cosmetics: '/home/editorial-6.jpg',
  'hair-care': '/home/hero-4.jpg',
  haircare: '/home/hero-4.jpg',
  'personal-care': '/home/category-personal-care-model.jpg',
  personalcare: '/home/category-personal-care-model.jpg',
  fragrance: '/home/editorial-5.jpg',
  perfume: '/home/editorial-5.jpg',
  'bath-body': '/home/category-bath-body-model.jpg',
  'bath-and-body': '/home/category-bath-body-model.jpg',
  'body-care': '/home/category-bath-body-model.jpg',
  bodycare: '/home/category-bath-body-model.jpg',
};

export const categoryImage = (slug: string, imageUrl?: string | null): string | undefined =>
  imageUrl || CATEGORY_IMAGES[slug];
