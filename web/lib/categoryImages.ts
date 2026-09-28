/**
 * Fallback photography for a category that has no admin-uploaded image yet
 * (Category.imageUrl, set from Admin > Catalogue > Categories). Unbranded
 * stock — see public/home/CREDITS.txt — shared by the homepage tiles and
 * each category's own page so the two never show a different default photo
 * for the same category.
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  'skin-care': '/home/category-skin-care.jpg',
  skincare: '/home/category-skin-care.jpg',
  makeup: '/home/category-makeup.jpg',
  cosmetics: '/home/category-makeup.jpg',
  'hair-care': '/home/category-hair-care.jpg',
  haircare: '/home/category-hair-care.jpg',
  'personal-care': '/home/category-personal-care.jpg',
  personalcare: '/home/category-personal-care.jpg',
  fragrance: '/home/category-fragrance.jpg',
  perfume: '/home/category-fragrance.jpg',
  'bath-body': '/home/category-bath-body.jpg',
  'bath-and-body': '/home/category-bath-body.jpg',
  'body-care': '/home/category-bath-body.jpg',
  bodycare: '/home/category-bath-body.jpg',
};

export const categoryImage = (slug: string, imageUrl?: string | null): string | undefined =>
  imageUrl || CATEGORY_IMAGES[slug];
