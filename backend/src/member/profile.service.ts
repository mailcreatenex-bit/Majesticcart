import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encryptField, decryptIfNeeded, blindIndex, lastFour, maskUpi, ctx as encCtx } from '../common/crypto';

/**
 * Member profile and payout details.
 *
 * This is the write path for the three encrypted columns. Everything that
 * enters `payoutAccount`, `payoutUpi` or `payoutIfsc` passes through here, so
 * there is one place to be right about the encryption rather than several.
 */

const RX = {
  name: /^\p{L}[\p{L}\p{M} .'-]{1,59}$/u,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  upi: /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  account: /^\d{9,18}$/,
  pincode: /^[1-9]\d{5}$/,
  phone: /^[6-9]\d{9}$/,
};

export interface PayoutInput {
  upi?: string;
  holder?: string;
  bank?: string;
  account?: string;
  ifsc?: string;
}

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * What the member sees on their own account screen.
   *
   * Masked rather than decrypted in full. There is no reason for a full account
   * number to travel to a browser and sit in its cache, and the member already
   * knows their own account — the last four is enough to confirm which one it is.
   */
  async payoutSummary(memberId: string) {
    const m = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { id: true, payoutUpi: true, payoutHolder: true, payoutBank: true, payoutAccount: true, payoutIfsc: true },
    });
    const upi = decryptIfNeeded(m.payoutUpi, encCtx.payoutUpi(m.id));
    const account = decryptIfNeeded(m.payoutAccount, encCtx.payoutAccount(m.id));

    return {
      hasPayoutMethod: !!(upi || account),
      upi: upi ? maskUpi(upi) : null,
      holder: m.payoutHolder,
      bank: m.payoutBank,
      accountLastFour: account ? lastFour(account) : null,
      ifsc: decryptIfNeeded(m.payoutIfsc, encCtx.payoutIfsc(m.id)),
    };
  }

  async savePayout(memberId: string, input: PayoutInput) {
    const upi = (input.upi ?? '').trim();
    const account = (input.account ?? '').replace(/\s/g, '');
    const ifsc = (input.ifsc ?? '').trim().toUpperCase();
    const holder = (input.holder ?? '').trim();
    const bank = (input.bank ?? '').trim();

    if (!upi && !account) throw new BadRequestException('Add a UPI ID or a bank account.');
    if (upi && !RX.upi.test(upi)) throw new BadRequestException('Enter a valid UPI ID, like name@okaxis.');
    if (account || ifsc) {
      if (!RX.account.test(account)) throw new BadRequestException('Account number should be 9 to 18 digits.');
      if (!RX.ifsc.test(ifsc)) throw new BadRequestException('Enter the 11-character IFSC, like SBIN0001234.');
      if (holder.length < 3) throw new BadRequestException("Enter the account holder's name.");
    }

    // A payout account shared across members is worth a look: it is either a
    // family sharing one bank account, which is normal, or one person collecting
    // the income of a fake downline, which is not. Flag rather than block —
    // a blanket block would lock out the legitimate case with no recourse.
    const upiIndex = upi ? blindIndex(upi, 'upi') : null;
    const accountIndex = account ? blindIndex(account, 'account') : null;
    await this.flagSharedPayout(memberId, upiIndex, accountIndex);

    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        // Encrypted and bound to this member's id: an attacker with write
        // access cannot move another member's account number into this row and
        // redirect their payouts.
        payoutUpi: upi ? encryptField(upi, encCtx.payoutUpi(memberId)) : null,
        payoutAccount: account ? encryptField(account, encCtx.payoutAccount(memberId)) : null,
        payoutIfsc: ifsc ? encryptField(ifsc, encCtx.payoutIfsc(memberId)) : null,
        payoutHolder: holder || null,
        payoutBank: bank || null,
        payoutUpiIndex: upiIndex,
        payoutAccountIndex: accountIndex,
      },
    });

    // Changing where money goes is worth an audit row and a notification: if
    // the member did not do it, this is how they find out.
    await this.prisma.auditLog.create({
      data: { actorType: 'MEMBER', actorId: memberId, action: 'payout.update', detail: { hasUpi: !!upi, hasAccount: !!account } },
    });
    await this.prisma.notification.create({
      data: {
        memberId,
        title: 'Payout details changed',
        body: 'Your withdrawal account was updated. If this was not you, contact customer care immediately.',
        kind: 'SECURITY',
      },
    });

    return this.payoutSummary(memberId);
  }

  private async flagSharedPayout(memberId: string, upiIndex: string | null, accountIndex: string | null) {
    const clauses = [
      ...(upiIndex ? [{ payoutUpiIndex: upiIndex }] : []),
      ...(accountIndex ? [{ payoutAccountIndex: accountIndex }] : []),
    ];
    if (!clauses.length) return;

    const others = await this.prisma.member.findMany({
      where: { OR: clauses, id: { not: memberId }, isCompany: false },
      select: { id: true, memberCode: true, name: true },
      take: 10,
    });
    if (others.length === 0) return;

    await this.prisma.securityAlert.create({
      data: {
        severity: others.length >= 2 ? 'HIGH' : 'MEDIUM',
        type: 'SHARED_PAYOUT_ACCOUNT',
        message: `Payout account also used by ${others.map((o) => o.memberCode).join(', ')}`,
        memberId,
        refType: 'member',
        refId: memberId,
      },
    });
  }

  /**
   * Point the member at an uploaded profile photo.
   *
   * The key is checked against the exact shape StorageService mints for this
   * member — `member-photo/<date>/<memberId>-<uuid>.<ext>` — so a member cannot
   * attach another member's file, or any other object in the bucket, as their
   * photo. Returns the previous key so the caller can delete the old file.
   */
  async setPhoto(memberId: string, objectKey: string): Promise<{ previous: string | null }> {
    const shape = new RegExp(`^member-photo/\\d{4}-\\d{2}-\\d{2}/${memberId}-[0-9a-f-]{36}\\.(jpg|png|webp)$`);
    if (!shape.test(objectKey)) throw new BadRequestException('That photo could not be used. Upload it again.');
    const current = await this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: { photoKey: true } });
    await this.prisma.member.update({ where: { id: memberId }, data: { photoKey: objectKey } });
    return { previous: current.photoKey };
  }

  async setNotifyExternal(memberId: string, external: boolean): Promise<void> {
    await this.prisma.member.update({ where: { id: memberId }, data: { notifyExternal: external } });
  }

  async saveProfile(memberId: string, patch: { name?: string; email?: string }) {
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim().replace(/\s+/g, ' ');
      if (!RX.name.test(name)) throw new BadRequestException('Enter your full name.');
      data.name = name;
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (email && !RX.email.test(email)) throw new BadRequestException('Enter a valid email.');
      if (email) {
        const clash = await this.prisma.member.findFirst({ where: { email, id: { not: memberId } }, select: { id: true } });
        if (clash) throw new ConflictException('This email is used by another account.');
      }
      data.email = email || null;
    }
    if (Object.keys(data).length === 0) return { ok: true as const };
    await this.prisma.member.update({ where: { id: memberId }, data });
    return { ok: true as const };
  }

  /** The saved delivery address, or null. Never throws for "not set yet". */
  async savedAddress(memberId: string) {
    const m = await this.prisma.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { name: true, phone: true, addressLine: true, city: true, state: true, pincode: true },
    });

    // All-or-nothing: a half-saved address pre-filled into checkout is worse
    // than an empty form, because the member does not notice what is missing.
    if (!m.addressLine || !m.city || !m.state || !m.pincode) return { address: null };

    return {
      address: {
        name: m.name,
        phone: m.phone,
        line: m.addressLine,
        city: m.city,
        state: m.state,
        pincode: m.pincode,
      },
    };
  }

  async saveAddress(memberId: string, a: { name: string; phone: string; line: string; city: string; state: string; pincode: string }) {
    if (!a.name?.trim()) throw new BadRequestException("Enter the recipient's name.");
    if (!RX.phone.test(a.phone ?? '')) throw new BadRequestException('Enter a valid 10-digit mobile number.');
    if ((a.line ?? '').trim().length < 6) throw new BadRequestException('Enter the full street address.');
    if (!a.city?.trim()) throw new BadRequestException('Enter the city.');
    if (!a.state?.trim()) throw new BadRequestException('Choose the state.');
    if (!RX.pincode.test(a.pincode ?? '')) throw new BadRequestException('Enter a valid 6-digit PIN code.');

    await this.prisma.member.update({
      where: { id: memberId },
      data: { addressLine: a.line.trim(), city: a.city.trim(), state: a.state.trim(), pincode: a.pincode },
    });
    return { ok: true as const };
  }
}
