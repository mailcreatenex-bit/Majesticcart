/**
 * The category tree from the client's category sheet (MAJISTIC CART.pdf): six
 * top-level departments and the sub-categories under each.
 *
 * This is only the starting point. CatalogService writes it once, on first boot
 * after the tree was introduced, and from then on the admin console owns the
 * categories - renaming, adding and removing them there is never undone by a
 * restart.
 *
 * "Skin Care", "Makeup", "Hair Care", "Fragrance" and "Body Care" already existed
 * as flat categories with products in them. They are reused rather than
 * recreated, so their URLs and products are untouched; "Body Care" moves under
 * Bath & Body, where the sheet puts it.
 */
export const CATEGORY_TREE_KEY = 'catalog.category-tree.v1';

export const CATEGORY_TREE: { name: string; children: string[] }[] = [
  {
    name: 'Skin Care',
    children: [
      'Lip Care', 'Eye Care', 'Skin Care Gifts & Value Sets', 'Toners & Face Mists', 'Moisturizers',
      'Masks', 'Facial Kit', 'Aromatherapy', 'Specialised Skincare',
    ],
  },
  {
    name: 'Makeup',
    children: ['Eye Makeup', 'Face Makeup', 'Makeup Gifts & Value Sets', 'Brushes & Tools', 'Lip Makeup', 'Nails'],
  },
  {
    name: 'Hair Care',
    children: [
      'Hair Accessories', 'Hair Styling', 'Hair Care Gifts and Value Sets', 'Shampoo & Conditioners',
      'Hair Nourishment', 'Hair Care & Styling Tools',
    ],
  },
  {
    name: 'Personal Care',
    children: ['Diet & Nutrition', 'Shaving & Hair Removal', 'Feminine Hygiene', 'Gifts and Value Sets - Mom & Baby', 'Oral Care'],
  },
  {
    name: 'Fragrance',
    children: ['Fragrance for Women', 'Perfume for Men', 'Gifts and Value Sets - Fragrance'],
  },
  {
    name: 'Bath & Body',
    children: ['Body Care', 'Baby Care', 'Bath and Body Care Gifts and Value Sets'],
  },
];
