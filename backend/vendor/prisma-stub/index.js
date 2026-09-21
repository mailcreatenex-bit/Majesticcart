// Runtime stand-in for @prisma/client in the test bundle.
// The real client needs binaries.prisma.sh, which is unreachable in this
// environment. Tests import types from this package plus the error class for
// instanceof checks; nothing here is used at runtime by the services.
export class PrismaClient {}
export const Prisma = {
  PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
    constructor(message, meta) { super(message); this.code = meta?.code; this.meta = meta?.meta; }
  },
  join: (v) => v,
};
