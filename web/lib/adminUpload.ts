import { api, ApiError } from './api';

export type UploadPurpose = 'product-image' | 'brand-logo' | 'blog-cover' | 'page-image' | 'theme-asset';

/**
 * Upload a file straight to object storage from the admin console.
 *
 * Same shape as the member-facing recharge-screenshot upload
 * (`RechargeView.tsx`): a signed ticket from the API, then a direct `PUT`
 * from the browser — the file never passes through the Node process. Returns
 * the object's permanent public URL, ready to store on whatever it belongs
 * to (a product's gallery, a blog post's cover, ...).
 */
export async function uploadAdminImage(file: File, purpose: UploadPurpose): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new ApiError('Upload a JPG, PNG or WebP image.', 400);
  }
  const ticket = await api<{ uploadUrl: string; objectKey: string; publicUrl: string }>('/admin/media/upload-ticket', {
    method: 'POST',
    body: { purpose, contentType: file.type, contentLength: file.size },
  });

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!put.ok) throw new ApiError('The image could not be uploaded. Try again.', put.status);

  return ticket.publicUrl;
}
