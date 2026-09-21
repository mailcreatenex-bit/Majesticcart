import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';

/**
 * "What shade am I?" — a photo in, two or three real products out.
 *
 * Two things this deliberately does not do:
 *
 *   • **It does not store the photo.** It is decoded, sent to Gemini, and the
 *     buffer goes out of scope. No `imageUrl` column, no S3 upload, nothing
 *     written to the database — a face photo isn't evidence like a recharge
 *     screenshot is, and the right amount of retention for it is none.
 *   • **It does not let the model invent products.** The prompt hands Gemini
 *     the real, current catalogue (name + a one-line description) and asks it
 *     to choose from that list by exact name; anything it returns that isn't
 *     an exact match to a real product is dropped rather than shown. A
 *     recommendation for a product that doesn't exist is worse than no
 *     recommendation.
 */

const MODEL = 'gemini-2.0-flash';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // ~4MB base64 payload; the frontend resizes before sending
const CANDIDATE_LIMIT = 40; // keeps the prompt small — this is a shade match, not a full catalogue dump

export interface ShadeMatch {
  name: string;
  slug: string;
  reason: string;
}

export interface ShadeFinderResult {
  summary: string;
  matches: ShadeMatch[];
}

@Injectable()
export class ShadeFinderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
  ) {}

  async analyze(imageBase64: string, mimeType: string): Promise<ShadeFinderResult> {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      throw new BadRequestException('Upload a JPEG, PNG or WEBP photo.');
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('That photo is too large. A phone selfie at normal size is plenty.');
    }

    const apiKey = await this.settings.requireGeminiKey();

    const candidates = await this.prisma.product.findMany({
      where: { isActive: true, category: { slug: 'makeup' } },
      select: { name: true, slug: true, description: true },
      take: CANDIDATE_LIMIT,
      orderBy: { sold: 'desc' },
    });
    if (candidates.length === 0) {
      throw new BadRequestException('No makeup products are listed yet, so there is nothing to match against.');
    }

    const catalogueBlock = candidates
      .map((c) => `- ${c.name}: ${(c.description ?? '').slice(0, 140)}`)
      .join('\n');

    // Scoped deliberately to shade-matching. Nothing here asks about age,
    // attractiveness, or anything else about the person in the photo — the
    // only judgement requested is which of the listed products suits their
    // apparent skin undertone and depth.
    const prompt = `You are a shade-matching assistant for an Indian cosmetics brand. Look at the photo of a
person's face and estimate their skin's undertone (warm, cool, or neutral) and depth (fair,
light, medium, tan, deep) in one plain, respectful sentence — no comments on anything else about
their appearance.

Then choose 2 to 3 products from this exact list that would suit that undertone and depth. Use the
product names EXACTLY as written below — do not invent or rename anything, and do not choose
anything not on this list.

Catalogue:
${catalogueBlock}

Respond with ONLY this JSON shape, no other text:
{"summary": "one sentence describing the undertone and depth", "matches": [{"name": "exact product name from the list", "reason": "one short phrase, e.g. 'warm golden-beige suits your undertone'"}]}`;

    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    };

    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach the shade-matching service. Please try again.');
    }

    if (res.status === 401 || res.status === 403) {
      // Almost always a bad or expired key, not a code bug — worth a message
      // that tells an admin where to look rather than a generic failure.
      throw new ServiceUnavailableException('The AI shade finder is not configured correctly. Ask an admin to check the Gemini API key under Settings.');
    }
    if (!res.ok) {
      throw new ServiceUnavailableException('Could not analyse that photo right now. Please try again in a moment.');
    }

    const json: any = await res.json().catch(() => null);
    const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ServiceUnavailableException('Could not analyse that photo right now. Please try again.');

    let parsed: { summary?: unknown; matches?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ServiceUnavailableException('Could not make sense of the result. Please try again.');
    }

    const summary = typeof parsed.summary === 'string' ? parsed.summary : 'Could not describe a match this time.';
    const bySlug = new Map(candidates.map((c) => [c.name, c.slug]));

    const matches: ShadeMatch[] = Array.isArray(parsed.matches)
      ? parsed.matches
          // The one real guard: only a product the catalogue actually has,
          // matched by exact name, ever reaches the response.
          .filter((m): m is { name: string; reason: string } =>
            !!m && typeof m.name === 'string' && bySlug.has(m.name) && typeof m.reason === 'string')
          .slice(0, 3)
          .map((m) => ({ name: m.name, slug: bySlug.get(m.name)!, reason: m.reason }))
      : [];

    return { summary, matches };
  }
}
