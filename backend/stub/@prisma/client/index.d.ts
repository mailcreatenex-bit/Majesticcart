// Minimal stand-in for the generated Prisma client, so tsc can check this
// codebase in an environment where binaries.prisma.sh is unreachable.
export type WalletKind = 'SHOPPING' | 'INCOME';
export type EntryDirection = 'CREDIT' | 'DEBIT';
export type LedgerCategory = 'RECHARGE'|'ORDER_PAYMENT'|'ORDER_REFUND'|'SELF_INCOME'|'DIRECT_INCOME'|'TEAM_INCOME'|'GENERATION_BONUS'|'ROYALTY'|'WITHDRAWAL_HOLD'|'WITHDRAWAL_REVERSAL'|'WALLET_TRANSFER'|'ADMIN_ADJUSTMENT';
export type CommissionType = 'SELF'|'DIRECT'|'TEAM'|'GENERATION'|'ROYALTY';
export type MemberStatus = 'ACTIVE'|'ON_HOLD'|'CLOSED';
export type OrderStatus = 'PLACED'|'PACKED'|'SHIPPED'|'DELIVERED'|'CANCELLED';
export interface Member {
  id: string; memberCode: string; name: string; phone: string; email: string | null;
  status: MemberStatus; isCompany: boolean; sponsorId: string | null; ancestorPath: string; depth: number;
  rankIndex: number; selfBvCenti: bigint; groupBvCenti: bigint;
  payoutUpi: string | null; payoutHolder: string | null; payoutBank: string | null;
  payoutAccount: string | null; payoutIfsc: string | null; lastDeviceId: string | null;
  joinedAt: Date; updatedAt: Date;
}
declare class Model {
  findUnique(a?: any): Promise<any>; findUniqueOrThrow(a?: any): Promise<any>;
  findFirst(a?: any): Promise<any>; findFirstOrThrow(a?: any): Promise<any>;
  findMany(a?: any): Promise<any[]>; create(a?: any): Promise<any>;
  createMany(a?: any): Promise<{ count: number }>; update(a?: any): Promise<any>;
  updateMany(a?: any): Promise<{ count: number }>; upsert(a?: any): Promise<any>;
  delete(a?: any): Promise<any>; deleteMany(a?: any): Promise<{ count: number }>; count(a?: any): Promise<number>;
  aggregate(a?: any): Promise<any>; groupBy(a?: any): Promise<any[]>;
}
export declare namespace Prisma {
  interface TransactionClient {
    member: Model; wallet: Model; ledgerEntry: Model; order: Model; orderItem: Model; orderEvent: Model;
    commission: Model; rankChange: Model; monthlyVolume: Model; royaltyRun: Model; royaltyPool: Model;
    recharge: Model; withdrawal: Model; securityAlert: Model; auditLog: Model; notification: Model;
    planVersion: Model; storeSetting: Model; product: Model; category: Model; deviceLink: Model;
    otpChallenge: Model; adminUser: Model; refreshToken: Model; numberSeries: Model; memberNote: Model;
    reportDefinition: Model; reportRun: Model;
    $queryRaw<T = unknown>(q: TemplateStringsArray, ...v: any[]): Promise<T>;
  }
  class PrismaClientKnownRequestError extends Error { code: string; meta?: Record<string, unknown>; }
  type InputJsonValue = string | number | boolean | null | InputJsonValue[] | { [k: string]: InputJsonValue };
  type JsonValue = InputJsonValue;
  function join(v: any[]): any;
}
export declare class PrismaClient implements Prisma.TransactionClient {
  constructor(options?: { log?: unknown[]; datasources?: unknown });
  member: Model; wallet: Model; ledgerEntry: Model; order: Model; orderItem: Model; orderEvent: Model;
  commission: Model; rankChange: Model; monthlyVolume: Model; royaltyRun: Model; royaltyPool: Model;
  recharge: Model; withdrawal: Model; securityAlert: Model; auditLog: Model; notification: Model;
  planVersion: Model; storeSetting: Model; product: Model; category: Model; deviceLink: Model;
  otpChallenge: Model; adminUser: Model; refreshToken: Model; numberSeries: Model; memberNote: Model;
  reportDefinition: Model; reportRun: Model;
  $queryRaw<T = unknown>(q: TemplateStringsArray, ...v: any[]): Promise<T>;
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, opts?: any): Promise<T>;
  $disconnect(): Promise<void>; $connect(): Promise<void>;
}
