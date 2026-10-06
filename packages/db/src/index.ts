import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export type Db = PrismaClient;

/** Creates a Prisma client on the node-postgres driver adapter. */
export function createDb(connectionString = process.env.DATABASE_URL): Db {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
