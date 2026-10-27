import { GET as streamProxyGET, OPTIONS as streamProxyOPTIONS } from '../stream-proxy/route';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return streamProxyOPTIONS();
}

export async function GET(req: Request) {
  return streamProxyGET(req as any);
}
