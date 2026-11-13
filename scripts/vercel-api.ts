import { createApi } from '../lib/api';
import { prisma } from '../lib/db';
import { adaptNode } from '../lib/transport';
const handle = createApi({ db: prisma });
export default async function handler(req: any, res: any) { await adaptNode(req, res, handle, true); }
